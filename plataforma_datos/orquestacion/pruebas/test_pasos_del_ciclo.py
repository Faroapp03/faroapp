"""Cada paso del ciclo deja su hora real y el supervisor la copia a su diario, también si el ciclo se corta."""

import json
import tempfile
import unittest
from pathlib import Path

from plataforma_datos.orquestacion import diario_mantenimiento, pasos_del_ciclo

EXPORTAR = ("/ruta/privada/python", "-m", "plataforma_datos.orquestacion.exportar_paquete")
COMPROBAR = ("npm", "run", "verificar:datos")


def _cortar(_orden: tuple[str, ...], _area: Path) -> int:
    """Hace de un supervisor que corta el ciclo en medio del paso: nada después de empezar llega a escribirse.

    Raises:
        KeyboardInterrupt: Siempre, como una interrupción que no es un error del paso.
    """
    raise KeyboardInterrupt


class RegistroDeLosPasos(unittest.TestCase):
    """El registro se escribe al empezar el paso y se completa al terminar."""

    def setUp(self) -> None:
        """Usa una raíz de candidato propia."""
        carpeta = tempfile.TemporaryDirectory()
        self.addCleanup(carpeta.cleanup)
        self.raiz = Path(carpeta.name)

    def test_un_paso_en_marcha_ya_tiene_su_registro_y_al_terminar_lo_completa(self) -> None:
        """Mientras corre, el paso tiene inicio y no fin; al terminar, su fin y su código. El resultado no cambia."""
        durante = []

        def ejecutor(orden: tuple[str, ...], _area: Path) -> int:
            durante.append(pasos_del_ciclo.leer(self.raiz)[-1])
            return 3 if orden == COMPROBAR else 0

        observado = pasos_del_ciclo.observar(self.raiz, ejecutor, lambda codigo: codigo)
        self.assertEqual([observado(orden, self.raiz) for orden in (EXPORTAR, COMPROBAR)], [0, 3])
        self.assertEqual([(r["numero"], r["fin"], r["codigo"]) for r in durante], [(1, None, None), (2, None, None)])
        registros = pasos_del_ciclo.leer(self.raiz)
        self.assertEqual(
            [(r["paso"], r["codigo"]) for r in registros], [("exportar-paquete", 0), ("verificar-datos", 3)]
        )
        self.assertTrue(all(r["inicio"] <= r["fin"] for r in registros))
        self.assertNotIn("privada", "".join(p.read_text() for p in (self.raiz / pasos_del_ciclo.CARPETA).iterdir()))

    def test_la_clave_nunca_lleva_rutas(self) -> None:
        """Una orden sin módulo ni guion se nombra con la clave genérica."""
        self.assertEqual(pasos_del_ciclo.clave(("/usr/bin/env", "/home/runner/x")), pasos_del_ciclo.OTRA)


class LosPasosLleganAlDiario(unittest.TestCase):
    """El supervisor copia los registros; el que no tiene fin es el paso en que se cortó el ciclo."""

    def _diario(self, raiz: Path) -> list[dict]:
        with diario_mantenimiento.abrir(raiz / "diario.jsonl", {"run": "1"}, consola=False):
            diario_mantenimiento.registrar_intentos(raiz)
        return [json.loads(x) for x in (raiz / "diario.jsonl").read_text().splitlines()]

    def test_el_paso_sin_fin_se_copia_como_cortado(self) -> None:
        """Como el 23/11: el plazo corta el ciclo en medio de un paso, y el diario dice cuál y desde cuándo."""
        with tempfile.TemporaryDirectory() as carpeta:
            raiz = Path(carpeta)
            observado = pasos_del_ciclo.observar(
                raiz, lambda orden, _a: _cortar(orden, _a) if orden == COMPROBAR else 0, int
            )
            observado(EXPORTAR, raiz)
            with self.assertRaises(KeyboardInterrupt):
                observado(COMPROBAR, raiz)
            lineas = [x for x in self._diario(raiz) if x["fase"] == pasos_del_ciclo.FASE]
        self.assertEqual(
            [(x["estado"], x["numero"], x["paso"], x["codigo"]) for x in lineas],
            [("terminado", 1, "exportar-paquete", 0), ("cortado", 2, "verificar-datos", None)],
        )
        self.assertIsNone(lineas[1]["fin"])
        self.assertIsNotNone(lineas[1]["inicio"])

    def test_unos_registros_ilegibles_no_detienen_al_supervisor(self) -> None:
        """Un registro sin su forma se anota como problema y el supervisor sigue."""
        with tempfile.TemporaryDirectory() as carpeta:
            raiz = Path(carpeta)
            (raiz / pasos_del_ciclo.CARPETA).mkdir(parents=True)
            (raiz / pasos_del_ciclo.CARPETA / "001.json").write_text('{"numero": 1}')
            (linea,) = self._diario(raiz)
        self.assertEqual(
            (linea["fase"], linea["estado"], linea["motivo"]), ("paso-ciclo", "problema", "registros-ilegibles")
        )


if __name__ == "__main__":
    unittest.main()
