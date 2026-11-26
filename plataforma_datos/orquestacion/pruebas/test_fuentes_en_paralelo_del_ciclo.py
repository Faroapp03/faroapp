"""El modo de las fuentes del ciclo real lo decide una variable del repositorio, y la serie es el modo por omisión.

`FARO_FUENTES_EN_PARALELO=si` en el paso del candidato llega al supervisor (ejecutar_mantenimiento), que pasa
`--en-paralelo` a la orden del candidato; el candidato lo traduce a `Opciones(en_paralelo=True)`. Sin la variable, o
con cualquier otro valor, el candidato guarda las entradas y descarga en serie. `FARO_FUENTES_EN_SERIE` (vacía por
omisión) deja algunas fuentes en serie dentro de un ciclo en paralelo: llega como `--fuente-en-serie`.
"""

import io
import tempfile
import threading
import unittest
from contextlib import redirect_stdout
from dataclasses import replace
from pathlib import Path
from unittest import mock

from plataforma_datos.orquestacion import actualizar, candidato
from plataforma_datos.orquestacion import ejecutor_operativo as ejecutor
from plataforma_datos.orquestacion.descargas_en_paralelo import ModoDeLasFuentes
from plataforma_datos.orquestacion.ejecucion_observada import etapa_de_fuente
from plataforma_datos.orquestacion.pruebas import test_ejecutar_mantenimiento as casos_cli
from plataforma_datos.orquestacion.pruebas import test_ejecutor_operativo as casos_ejecutor
from plataforma_datos.orquestacion.pruebas.test_descargas_en_paralelo import REGISTRO, Reproduccion

VARIABLE = "FARO_FUENTES_EN_PARALELO"
EN_SERIE = "FARO_FUENTES_EN_SERIE"


class MotorQueAnota:
    """Hace de motor: anota con qué modo de fuentes lo llama el candidato y no actualiza nada."""

    def __init__(self) -> None:
        self.en_paralelo: list[bool] = []
        self.en_serie: list[tuple[str, ...]] = []

    def __call__(
        self, _raiz: Path, opciones: actualizar.Opciones, *_resto: object, **_claves: object
    ) -> actualizar.ResultadoActualizacion:
        """Anota el modo.

        Returns:
            Un intento que no llegó a completarse: el candidato lo rechaza sin seguir.
        """
        self.en_paralelo.append(opciones.en_paralelo)
        self.en_serie.append(opciones.fuentes_en_serie)
        return actualizar.ResultadoActualizacion(1, None, None, {})


class PruebaFuentesEnParaleloDelCiclo(unittest.TestCase):
    """Variable del repositorio → supervisor → orden del candidato → opciones de la actualización."""

    def orden_del_candidato(
        self, en_paralelo: bool, en_serie: tuple[str, ...] = ()
    ) -> tuple[list[str], str, Path, Path]:
        """Ejecuta un trabajo completo con el arnés del ejecutor y recoge la orden con que lanza el candidato.

        Returns:
            La orden, la acción del trabajo, la raíz candidata y el recibo que recibe.
        """
        caso = casos_ejecutor.PruebaEjecutorOperativo(methodName="runTest")
        self.addCleanup(caso.doCleanups)
        caso.setUp()
        caso.config = replace(caso.config, en_paralelo=en_paralelo, fuentes_en_serie=en_serie)
        ordenes: list[list[str]] = []
        interceptado = ejecutor.ejecutar_con_plazo  # el doble del arnés, que hace de motor

        def registrar(orden: list[str], *argumentos: object) -> object:
            ordenes.append(list(orden))
            return interceptado(orden, *argumentos)

        with mock.patch.object(ejecutor, "ejecutar_con_plazo", registrar):
            caso.ejecutar()
        del_candidato = [orden for orden in ordenes if "plataforma_datos.orquestacion.candidato" in orden]
        self.assertEqual(len(del_candidato), 1)
        orden = del_candidato[0]
        return orden, caso.config.accion, Path(orden[4]), Path(orden[-1])

    def test_sin_la_variable_la_orden_del_candidato_guarda_entradas_en_serie(self) -> None:
        """El candidato guarda las entradas también cuando descarga en serie."""
        orden, accion, raiz, recibo = self.orden_del_candidato(en_paralelo=False)
        self.assertEqual(
            orden,
            [
                str(raiz / ".venv/bin/python"),
                "-m",
                "plataforma_datos.orquestacion.candidato",
                accion,
                str(raiz),
                "--guardar-entradas",
                "--recibo",
                str(recibo),
            ],
        )

    def test_con_la_variable_la_orden_lleva_en_paralelo(self) -> None:
        """En paralelo, la misma orden con --en-paralelo antes del recibo."""
        orden, accion, raiz, recibo = self.orden_del_candidato(en_paralelo=True)
        self.assertEqual(orden[3:], [accion, str(raiz), "--en-paralelo", "--guardar-entradas", "--recibo", str(recibo)])

    def test_sin_el_paralelo_la_configuracion_no_admite_fuentes_en_serie(self) -> None:
        """La lista solo acompaña al paralelo: así la orden en serie es siempre la de hoy."""
        caso = casos_ejecutor.PruebaEjecutorOperativo(methodName="runTest")
        self.addCleanup(caso.doCleanups)
        caso.setUp()
        with self.assertRaises(ValueError):
            replace(caso.config, en_paralelo=False, fuentes_en_serie=("fundae",))

    def test_las_fuentes_en_serie_llegan_a_la_orden_del_candidato(self) -> None:
        """Cada fuente de la lista, con su propia opción, en el orden de la lista."""
        orden, accion, raiz, recibo = self.orden_del_candidato(en_paralelo=True, en_serie=("fundae", "tich"))
        self.assertEqual(
            orden[3:],
            [accion, str(raiz), "--en-paralelo", "--fuente-en-serie", "fundae", "--fuente-en-serie", "tich"]
            + ["--guardar-entradas", "--recibo", str(recibo)],
        )

    def test_solo_si_activa_el_paralelo_en_el_supervisor(self) -> None:
        """«si» activa; sin variable, «no», «SI», «true» o vacío, en serie."""
        cli = casos_cli.EjecutarMantenimientoTest(methodName="runTest")
        self.addCleanup(cli.doCleanups)
        cli.setUp()
        entorno = cli.entorno | {"FARO_ACCION": "comprobar-programada"}
        with mock.patch.object(casos_cli.cli, "_checkout_limpio"):
            configurar = casos_cli.cli.configuracion_ejecucion
            self.assertFalse(configurar(cli.checkout, cli.trabajo, entorno).en_paralelo)
            self.assertTrue(configurar(cli.checkout, cli.trabajo, entorno | {VARIABLE: "si"}).en_paralelo)
            for valor in ("no", "SI", "true", ""):
                with self.subTest(valor=valor):
                    self.assertFalse(configurar(cli.checkout, cli.trabajo, entorno | {VARIABLE: valor}).en_paralelo)
            self.assertEqual(configurar(cli.checkout, cli.trabajo, entorno).fuentes_en_serie, ())
            lista = entorno | {VARIABLE: "si", EN_SERIE: " fundae, tich ,"}
            self.assertEqual(configurar(cli.checkout, cli.trabajo, lista).fuentes_en_serie, ("fundae", "tich"))
            with self.assertRaises(ValueError):
                configurar(cli.checkout, cli.trabajo, lista | {EN_SERIE: "fundae,inventada"})
            # En serie la lista se ignora, también con un nombre que no es una fuente.
            for valor in ("fundae", "fundae,inventada"):
                with self.subTest(en_serie=valor):
                    self.assertEqual(
                        configurar(cli.checkout, cli.trabajo, entorno | {EN_SERIE: valor}).fuentes_en_serie, ()
                    )

    def test_el_candidato_lleva_la_opcion_hasta_las_opciones_de_la_actualizacion(self) -> None:
        """Sin --en-paralelo, en serie; con ella, `Opciones(en_paralelo=True)` en el motor."""
        self.assertFalse(candidato.opciones_de_la_accion("comprobar-programada").en_paralelo)
        opciones = candidato.opciones_de_la_accion("comprobar-programada", fuentes=ModoDeLasFuentes(True, ("fundae",)))
        self.assertTrue(opciones.en_paralelo)
        self.assertEqual(opciones.fuentes_en_serie, ("fundae",))
        with tempfile.TemporaryDirectory() as carpeta:
            raiz, recibo = Path(carpeta) / "candidato", Path(carpeta) / "recibo.json"
            raiz.mkdir()
            motor = MotorQueAnota()
            for argumentos in ([], ["--en-paralelo"], ["--en-paralelo", "--fuente-en-serie", "fundae"]):
                with (
                    self.subTest(argumentos=argumentos),
                    mock.patch.object(actualizar, "actualizar_con_resultado", motor),
                    redirect_stdout(io.StringIO()),
                ):
                    candidato.main(["comprobar-programada", str(raiz), "--recibo", str(recibo), *argumentos])
                recibo.unlink()
            self.assertEqual(motor.en_paralelo, [False, True, True])
            self.assertEqual(motor.en_serie, [(), (), ("fundae",)])

    def test_una_fuente_en_serie_la_descarga_la_serie_dentro_de_un_ciclo_en_paralelo(self) -> None:
        """Con fundae en la lista, su descarga corre en el hilo de la serie; las demás, en sus colas."""
        hilos: dict[str, str] = {}

        class AnotaElHilo(Reproduccion):
            def __call__(self, orden: list[str], area: Path) -> actualizar.Resultado:
                identificada = etapa_de_fuente(orden)
                if identificada is not None and identificada[1] == "descargar":
                    hilos[identificada[0]] = threading.current_thread().name
                return super().__call__(orden, area)

        with tempfile.TemporaryDirectory() as carpeta:
            raiz = Path(carpeta) / "raiz"
            for modulo in REGISTRO:
                for ruta in actualizar.carpetas(modulo):
                    (raiz / ruta).mkdir(parents=True)
                    (raiz / ruta / "dato.txt").write_bytes(b"vigente")
            area = Path(carpeta) / "area"
            actualizar.preparar_area(raiz, area)
            opciones = actualizar.Opciones(pausa=0, en_paralelo=True, fuentes_en_serie=("fundae",))
            with mock.patch.object(actualizar, "MODULOS", REGISTRO), redirect_stdout(io.StringIO()):
                actualizar.ejecutar_modulos(raiz, area, AnotaElHilo(), opciones)
        serie = threading.current_thread().name
        self.assertEqual(hilos["fundae"], serie)
        self.assertTrue(all(hilo != serie for fuente, hilo in hilos.items() if fuente != "fundae"))


if __name__ == "__main__":
    unittest.main()
