"""Fallos internos frente a fallos de fuente, con recuperación y ciclo registrados."""

import io
import json
import shutil
import unittest
from collections.abc import Sequence
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

from plataforma_datos.comun.nucleo import FormatoInesperado
from plataforma_datos.orquestacion import actualizar, comprobaciones_remotas, errores_de_actualizacion
from plataforma_datos.orquestacion.ejecucion_observada import etapa_de_fuente
from plataforma_datos.orquestacion.piezas_de_la_actualizacion import CARPETA_DE_INFORMES
from plataforma_datos.orquestacion.pruebas import test_actualizacion_dependientes as fixtures
from plataforma_datos.orquestacion.pruebas.ayudas import Corte

SECRETO_SINTETICO = "token-sintetico-no-persistir"


class ActualizarErroresPruebas(unittest.TestCase):
    """El repositorio, los intentos y los cortes son exclusivos del fixture."""

    def setUp(self) -> None:
        """Monta cuatro módulos reales con dependencias y datos sintéticos propios."""
        self.caso = fixtures.PruebaActualizacionDependientes()
        self.caso.setUp()
        self.addCleanup(self.caso.doCleanups)
        self.raiz, self.area = self.caso.caso()
        self.ordenes: list[tuple[str, str]] = []
        self.base = fixtures.EjecutorDependencias()
        self.opciones = actualizar.Opciones(area=self.area, pausa=0, reintento=0)

    def ejecutor(self, orden: Sequence[str], area: Path) -> actualizar.Resultado:
        """Inyecta un error de programa después de una escritura aún no admitida.

        Returns:
            Éxito para las órdenes ajenas al fallo elegido.

        Raises:
            TypeError: Error interno con un mensaje que no debe persistirse.
        """
        identificada = etapa_de_fuente(orden)
        if identificada is not None:
            self.ordenes.append(identificada)
            if identificada == ("oit", "validar"):
                fixtures.archivo(area, "oit", 2).write_text("no admitido")
                raise TypeError(SECRETO_SINTETICO)
        return self.base(orden, area)

    def ejecutar_completa(self) -> actualizar.ResultadoActualizacion:
        """Ejecuta el ciclo real sobre cuatro módulos, sin lanzar procesos o red.

        Returns:
            Resultado persistido de esa misma actualización.
        """
        shutil.rmtree(self.area)
        with (
            patch.object(actualizar, "MODULOS", fixtures.REGISTRO),
            patch.object(
                actualizar,
                "ejecutar_paquete",
                return_value=(
                    [],
                    actualizar.Comparacion(None, [], []),
                    actualizar.ResultadoDelModulo(actualizar.VERDE),
                ),
            ) as paquete,
            redirect_stdout(io.StringIO()),
        ):
            resultado = actualizar.actualizar_con_resultado(self.raiz, self.opciones, self.ejecutor)
        paquete.assert_not_called()
        return resultado

    def trazas(self) -> list[dict]:
        """Lee solamente el registro técnico privado del fixture.

        Returns:
            Incidencias de orquestación guardadas, no errores de las fuentes.
        """
        carpeta = self.raiz / CARPETA_DE_INFORMES / "errores-orquestador"
        return [json.loads(p.read_bytes()) for p in carpeta.glob("*/error.json")]

    def test_error_interno_directo_no_es_ambar_y_restaura(self) -> None:
        """La función no transforma una programación defectuosa en fallo de fuente."""
        modulo = fixtures.POR_ID["oit"]
        with redirect_stdout(io.StringIO()), self.assertRaises(TypeError):
            actualizar.ejecutar_modulo(self.raiz, self.area, modulo, self.ejecutor, self.opciones)
        self.assertEqual(
            actualizar.huella(self.area, actualizar.carpetas(modulo)),
            actualizar.huella(self.raiz, actualizar.carpetas(modulo)),
        )

    def test_error_interno_de_revalidacion_no_se_convierte_en_false(self) -> None:
        """El fallo inesperado conserva la traza Python y devuelve el área a lo publicado."""
        modulo = fixtures.POR_ID["oit"]
        with self.assertRaises(TypeError):
            actualizar.revalidar(self.area, modulo, self.ejecutor, actualizar.carpetas(modulo), self.raiz)
        self.assertEqual(
            actualizar.huella(self.area, actualizar.carpetas(modulo)),
            actualizar.huella(self.raiz, actualizar.carpetas(modulo)),
        )

    def test_ciclo_rojo_registra_error_local_bloquea_dependientes_y_continua_independiente(self) -> None:
        """No se confirma ni se culpa a la fuente por un fallo interno de orquestación."""
        resultado = self.ejecutar_completa()
        self.assertEqual(resultado.codigo, actualizar.CODIGO_ROJO)
        self.assertEqual(resultado.resultados["oit"].veredicto, actualizar.ROJO)
        self.assertIn("orquestación", resultado.resultados["oit"].motivo)
        self.assertEqual(resultado.resultados["clasificaciones"].veredicto, actualizar.ROJO)
        self.assertEqual(resultado.resultados["cambra"].veredicto, actualizar.ROJO)
        self.assertEqual(resultado.resultados["citilab"].veredicto, actualizar.VERDE)
        self.assertFalse(any(n in ("clasificaciones", "cambra") for n, _e in self.ordenes))
        self.assertIn(("citilab", "validar"), self.ordenes)
        self.assertEqual(fixtures.archivo(self.raiz, "oit", 2).read_text(), "vigente")
        self.assertIsNotNone(resultado.informe)
        registro = comprobaciones_remotas.leer_registro(self.raiz)
        self.assertEqual(registro["ultimo_ciclo"]["resultado"], "fallo")
        self.assertEqual(registro["fuentes"]["oit"]["resultado"], "interrumpido")
        (traza,) = self.trazas()
        self.assertEqual(traza["origen"], "orquestador")
        self.assertEqual(traza["modulo"], "oit")
        self.assertEqual(traza["errores"][0]["tipo"], "TypeError")
        self.assertTrue(traza["errores"][0]["frames"])
        self.assertNotIn(SECRETO_SINTETICO, json.dumps(traza))
        self.assertTrue(traza["area_restaurada"])
        (ruta,) = (self.raiz / CARPETA_DE_INFORMES / "errores-orquestador").glob("*/error.json")
        self.assertEqual(ruta.stat().st_mode & 0o777, 0o600)
        self.assertEqual(ruta.parent.stat().st_mode & 0o777, 0o700)
        self.assertLessEqual(ruta.stat().st_size, errores_de_actualizacion.MAX_TRAZA_BYTES)
        self.assertNotIn(str(self.raiz), json.dumps(traza))

    def test_fallo_de_restauracion_detiene_preserva_area_y_cierra_rojo(self) -> None:
        """Una restauración fallida no permite ejecutar siquiera módulos independientes."""
        with patch.object(actualizar, "restaurar", side_effect=RuntimeError("restauración rota")):
            resultado = self.ejecutar_completa()
        self.assertEqual(resultado.codigo, actualizar.CODIGO_ROJO)
        self.assertTrue(self.area.is_dir())
        self.assertNotIn(("citilab", "descargar"), self.ordenes)
        self.assertEqual(fixtures.archivo(self.raiz, "oit", 2).read_text(), "vigente")
        self.assertEqual(comprobaciones_remotas.leer_registro(self.raiz)["ultimo_ciclo"]["resultado"], "fallo")
        (traza,) = self.trazas()
        self.assertFalse(traza["area_restaurada"])
        self.assertTrue({"RuntimeError", "TypeError"} <= {e["tipo"] for e in traza["errores"]})

    def test_error_interno_en_revalidacion_se_registra_y_no_confirma(self) -> None:
        """Un fallo conocido seguido de un bug al revalidar no termina en ámbar."""
        validar = 0

        def ejecutor(orden: Sequence[str], area: Path) -> actualizar.Resultado:
            nonlocal validar
            identificada = etapa_de_fuente(orden)
            if identificada is not None:
                self.ordenes.append(identificada)
            if identificada == ("oit", "validar"):
                validar += 1
                if validar == 1:
                    return actualizar.Resultado(1, "no validado")
                raise TypeError(SECRETO_SINTETICO)
            return self.base(orden, area)

        with (
            patch.object(self, "ejecutor", side_effect=ejecutor),
            patch.object(actualizar, "leer_estado", return_value={"oit": {"veredicto": actualizar.ROJO}}),
        ):
            resultado = self.ejecutar_completa()
        self.assertEqual(validar, 2)
        self.assertEqual(resultado.resultados["oit"].veredicto, actualizar.ROJO)
        (traza,) = self.trazas()
        self.assertTrue(any(f["funcion"] == "revalidar" for e in traza["errores"] for f in e["frames"]))
        self.assertEqual(comprobaciones_remotas.leer_registro(self.raiz)["ultimo_ciclo"]["resultado"], "fallo")

    def test_diagnostico_no_persistido_detiene_y_conserva_traza_segura_en_informe(self) -> None:
        """No continúa sin registro técnico; el informe conserva tipo y posiciones disponibles."""
        with patch.object(errores_de_actualizacion, "_guardar", side_effect=OSError("disco sintético")):
            resultado = self.ejecutar_completa()
        self.assertEqual(resultado.codigo, actualizar.CODIGO_ROJO)
        self.assertTrue(self.area.exists())
        self.assertNotIn(("citilab", "validar"), self.ordenes)
        informe = resultado.informe.read_text()
        self.assertIn("TypeError", informe)
        self.assertIn("persistencia", informe)
        self.assertNotIn(SECRETO_SINTETICO, informe)
        self.assertEqual(comprobaciones_remotas.leer_registro(self.raiz)["ultimo_ciclo"]["resultado"], "fallo")

    def test_interrupcion_al_restaurar_no_limpia_el_area_recuperable(self) -> None:
        """Una interrupción conserva inicio pendiente y área; no simula cierre completado."""
        with patch.object(actualizar, "restaurar", side_effect=Corte("proceso interrumpido")), self.assertRaises(Corte):
            self.ejecutar_completa()
        self.assertTrue(self.area.is_dir())
        self.assertNotIn(("citilab", "descargar"), self.ordenes)
        self.assertEqual(comprobaciones_remotas.leer_registro(self.raiz)["ultimo_ciclo"]["resultado"], "en-curso")

    def test_error_durante_publicacion_recupera_diario_y_no_promueve(self) -> None:
        """Un error de programa durante los renombrados restaura la raíz antes de continuar."""
        renombrar = Path.rename
        objetivo = fixtures.archivo(self.raiz, "oit", 0).parent

        def fallar(ruta: Path, destino: Path) -> Path:
            if ruta == objetivo.with_name(objetivo.name + ".nuevo"):
                raise TypeError(SECRETO_SINTETICO)
            return renombrar(ruta, destino)

        with patch.object(Path, "rename", fallar), patch.object(self, "ejecutor", side_effect=self.base):
            resultado = self.ejecutar_completa()
        self.assertEqual(resultado.codigo, actualizar.CODIGO_ROJO)
        self.assertEqual(fixtures.archivo(self.raiz, "oit", 0).read_text(), "vigente")
        self.assertEqual(fixtures.archivo(self.raiz, "oit", 2).read_text(), "vigente")
        self.assertEqual(resultado.resultados["citilab"].veredicto, actualizar.VERDE)
        self.assertFalse(list(self.raiz.rglob("*.anterior")))
        self.assertFalse(list(self.raiz.rglob("*.nuevo")))
        self.assertFalse((self.raiz / CARPETA_DE_INFORMES / actualizar.diario("oit")).exists())
        (traza,) = self.trazas()
        self.assertTrue(traza["area_restaurada"])

    def test_error_despues_de_hecho_no_inventa_reversion_y_detiene(self) -> None:
        """La publicación concluida se conserva, pero su error local impide otras promociones."""
        recuperar = actualizar.sustitucion.recuperar
        hubo_error = False

        def fallar(raiz: Path, rutas: tuple[str, ...], diario: str) -> str | None:
            nonlocal hubo_error
            documento = raiz / CARPETA_DE_INFORMES / diario
            if (
                not hubo_error
                and diario == actualizar.diario("oit")
                and documento.exists()
                and json.loads(documento.read_bytes())["fase"] == actualizar.sustitucion.HECHO
            ):
                hubo_error = True
                raise TypeError(SECRETO_SINTETICO)
            return recuperar(raiz, rutas, diario)

        with (
            patch.object(actualizar.sustitucion, "recuperar", side_effect=fallar),
            patch.object(self, "ejecutor", side_effect=self.base),
        ):
            resultado = self.ejecutar_completa()
        self.assertTrue(hubo_error)
        self.assertEqual(resultado.codigo, actualizar.CODIGO_ROJO)
        self.assertTrue(self.area.exists())
        self.assertEqual(fixtures.archivo(self.raiz, "oit", 0).read_text(), "nueva")
        self.assertNotIn("citilab", resultado.resultados)
        self.assertIn("PublicacionConcluidaConError", resultado.resultados["oit"].motivo)
        self.assertFalse(comprobaciones_remotas.leer_registro(self.raiz)["ultimo_ciclo"]["paquete_preparado"])

    def test_error_esperable_conserva_via_ambar_sin_traza_de_programacion(self) -> None:
        """El contrato ERRORES_CON_MOTIVO sigue distinguiendo fallos conocidos."""
        modulo = fixtures.POR_ID["oit"]
        with (
            patch.object(actualizar, "ejecutar_pasos", side_effect=FormatoInesperado("entrada no válida")),
            redirect_stdout(io.StringIO()),
        ):
            _pasos, resultado = actualizar.ejecutar_modulo(self.raiz, self.area, modulo, self.ejecutor, self.opciones)
        self.assertEqual(resultado.veredicto, actualizar.AMBAR)
        self.assertIn("entrada no válida", resultado.motivo)
        self.assertEqual(self.trazas(), [])
