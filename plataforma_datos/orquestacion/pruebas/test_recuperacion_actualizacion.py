"""Regresiones de fallos de disco y límites de comparación, con árboles temporales pequeños."""

import json
import shutil
import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest import mock

from plataforma_datos.comun.nucleo import FormatoInesperado
from plataforma_datos.orquestacion import piezas_de_la_actualizacion as piezas
from plataforma_datos.orquestacion import sustitucion


class PruebaRecuperacionYComparacion(unittest.TestCase):
    """El diario y el respaldo deben permitir reintentar una recuperación fallida."""

    def setUp(self) -> None:
        """Árboles de ensayo propios, nunca datos del repositorio."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.raiz, self.area = Path(temporal.name) / "raiz", Path(temporal.name) / "area"
        self.diario = self.raiz / sustitucion.CARPETA / sustitucion.ARCHIVO_DEL_DIARIO
        self.escribir(self.diario, {"fase": sustitucion.HECHO})
        self.vigente = self.raiz / "ejemplo"
        self.anterior = self.raiz / "ejemplo.anterior"
        self.escribir(self.vigente / "dato.json", "nuevo")
        self.escribir(self.anterior / "dato.json", "anterior")

    @staticmethod
    def escribir(ruta: Path, contenido: object) -> None:
        """Una entrada de la fixture, con sus carpetas."""
        ruta.parent.mkdir(parents=True, exist_ok=True)
        ruta.write_text(json.dumps(contenido), encoding="utf-8")

    def test_limpieza_fallida_conserva_hecho_y_no_restaura_lo_antiguo(self) -> None:
        """Un fallo al retirar el respaldo no puede perder la marca de promoción terminada."""
        borrar = shutil.rmtree

        def falla_respaldo(ruta: Path, *args: object, **kwargs: object) -> None:
            if Path(ruta) == self.anterior:
                if kwargs.get("ignore_errors"):
                    return
                raise OSError("no se puede retirar el respaldo")
            borrar(ruta, *args, **kwargs)

        with mock.patch.object(shutil, "rmtree", falla_respaldo), self.assertRaises(OSError):
            sustitucion.recuperar(self.raiz, ("ejemplo",))
        self.assertEqual(json.loads(self.diario.read_text())["fase"], sustitucion.HECHO)
        self.assertTrue(self.anterior.exists())
        self.assertEqual(sustitucion.recuperar(self.raiz, ("ejemplo",)), "completada")
        self.assertEqual(json.loads((self.vigente / "dato.json").read_text()), "nuevo")

    def test_diario_de_fase_desconocida_no_reemplaza_la_vigente(self) -> None:
        """La fase inválida nunca equivale a una autorización para deshacer la promoción."""
        for documento in ({"fase": "desconocida"}, {}, {"fase": None}, {"fase": []}, []):
            with self.subTest(documento=documento):
                self.escribir(self.diario, documento)
                self.escribir(self.vigente / "dato.json", "nuevo")
                self.escribir(self.anterior / "dato.json", "anterior")
                antes = {
                    ruta: ruta.read_bytes()
                    for ruta in (self.diario, self.vigente / "dato.json", self.anterior / "dato.json")
                }
                with self.assertRaises(OSError) as captura:
                    sustitucion.recuperar(self.raiz, ("ejemplo",))
                self.assertEqual(type(captura.exception).__name__, "RecuperacionIncompleta")
                self.assertIn(str(self.diario), str(captura.exception))
                self.assertIn(str(self.anterior), str(captura.exception))
                self.assertEqual({ruta: ruta.read_bytes() for ruta in antes}, antes)

    def test_hecho_sin_vigente_conserva_la_ultima_copia(self) -> None:
        """Un diario hecho con la vigente ausente requiere intervención, nunca borrar el respaldo."""
        shutil.rmtree(self.vigente)
        with self.assertRaises(OSError):
            sustitucion.recuperar(self.raiz, ("ejemplo",))
        self.assertEqual(json.loads((self.anterior / "dato.json").read_text()), "anterior")
        self.assertTrue(self.diario.exists())

    def test_doble_fallo_conserva_causa_diario_y_respaldo(self) -> None:
        """El fallo de recuperación informa de la causa inicial y deja los archivos recuperables."""
        shutil.rmtree(self.anterior)
        self.diario.unlink()
        self.escribir(self.area / "ejemplo" / "dato.json", "nuevo")
        renombrar = Path.rename
        inicial, restauracion = OSError("promoción fallida"), OSError("restauración fallida")

        def fallar(ruta: Path, destino: Path) -> Path:
            if ruta.name == "ejemplo.nuevo":
                raise inicial
            if ruta.name == "ejemplo.anterior":
                raise restauracion
            return renombrar(ruta, destino)

        with mock.patch.object(Path, "rename", fallar), self.assertRaises(OSError) as captura:
            sustitucion.sustituir(self.raiz, self.area, ("ejemplo",))
        error = captura.exception
        self.assertEqual(type(error).__name__, "RecuperacionIncompleta")
        self.assertIs(error.__cause__, inicial)
        self.assertIn(str(self.diario), str(error))
        self.assertIn(str(self.anterior), str(error))
        self.assertIn(str(restauracion), str(error))
        self.assertTrue(self.diario.exists())
        self.assertTrue((self.anterior / "dato.json").exists())

    def test_carpetas_de_originales_retiradas_se_informan(self) -> None:
        """Una carpeta ausente del área también contiene originales que desaparecen."""
        datos = getattr(piezas, "DATOS_RELATIVOS", Path("datos"))
        self.escribir(
            self.raiz / datos / "originales" / "retirada" / "procedencia.json",
            {"archivos": [{"archivo": "original.csv", "sha256": "abc"}]},
        )
        self.assertEqual(
            piezas.comparar_originales(self.raiz, self.area),
            [{"carpeta": "retirada", "cambian": [], "nuevos": [], "quitados": ["original.csv"]}],
        )

    def test_manifiesto_no_puede_declarar_recursos_ajenos(self) -> None:
        """La comparación no abre rutas fuera del paquete ni archivos que no sean JSON gestionados."""
        paquete = getattr(piezas, "PAQUETE_RELATIVO", Path("motor/paquete"))
        for nombre in ("README.md", "../fuera.json"):
            with self.subTest(nombre=nombre):
                for base in (self.raiz, self.area):
                    self.escribir(base / paquete / nombre, [1])
                    self.escribir(base / paquete / "manifiesto.json", {nombre: {"sha256": "abc"}})
                with self.assertRaisesRegex(FormatoInesperado, "manifiesto"):
                    piezas.comparar(self.raiz, self.area)

    def test_fecha_de_obtencion_no_depende_del_espacio_json(self) -> None:
        """La misma procedencia compacta, sangrada o con saltos tiene la misma fecha."""
        datos = getattr(piezas, "DATOS_RELATIVOS", Path("datos"))
        ruta = self.raiz / datos / "originales" / "manual" / "procedencia.json"
        ruta.parent.mkdir(parents=True, exist_ok=True)
        for texto in (
            '{"consultado":"2026-10-01"}',
            '{"consultado" : "2026-10-01"}',
            '{"consultado":\n  "2026-10-01"}',
            '{"consultado": "2026-10-01"}',
        ):
            with self.subTest(texto=texto):
                ruta.write_text(texto, encoding="utf-8")
                self.assertEqual(piezas.fecha_del_dato(self.raiz, "manual"), date(2026, 10, 1))

    def test_comparacion_solo_lee_json_declarados(self) -> None:
        """Los recursos ajenos existentes no se enumeran ni se interpretan."""
        paquete = getattr(piezas, "PAQUETE_RELATIVO", Path("motor/paquete"))
        for base in (self.raiz, self.area):
            self.escribir(base / paquete / "ejemplo.json", [1, 2])
            self.escribir(base / paquete / "manifiesto.json", {"ejemplo.json": {"sha256": "abc"}})
            self.escribir(base / paquete / "README.md", "no es parte del manifiesto")
            self.escribir(base / paquete / "globales" / "dato.json", {"reservado": True})
            self.escribir(base / paquete / "lecturas" / "dato.json", {"reservado": True})
        comparacion = piezas.comparar(self.raiz, self.area)
        self.assertEqual([fila["archivo"] for fila in comparacion.paquete], ["ejemplo.json"])
        self.assertEqual(comparacion.paquete[0]["estado"], "igual")
        self.assertEqual(comparacion.alarmas, [])


if __name__ == "__main__":
    unittest.main()
