"""Un día rechazado deja escrita su causa con palabras cerradas: paquete retenido, generación no conservada, Citilab."""

import json
import tempfile
import unittest
from pathlib import Path

from plataforma_datos.comun.entrada_salida import guardar_json, sha256
from plataforma_datos.comun.nucleo import ErrorFuente
from plataforma_datos.cursos.fuentes.citilab.paginacion import totales_de_pagina
from plataforma_datos.orquestacion import causas_del_ciclo as causas
from plataforma_datos.orquestacion import diario_mantenimiento as diario
from plataforma_datos.orquestacion import generacion_operativa as generacion
from plataforma_datos.orquestacion import resumen_diario
from plataforma_datos.orquestacion.ejecucion_observada import causa_de_salida
from plataforma_datos.orquestacion.hora_limite_del_motor import MOTIVO as MOTIVO_SIN_TIEMPO
from plataforma_datos.orquestacion.pruebas.test_generacion_operativa import REVISION, preparar

CATALUNA = "var/actualizacion/originales/cataluna"
INFORME = f"{generacion.CARPETA_DE_INFORMES}/2026-11-22-042628"
COMIENZO = "2026-11-22T04:26:28+00:00"


class PruebaCicloQueSeRecupera(unittest.TestCase):
    """Fuentes en verde con su versión nueva, paquete retenido en su versión anterior y exportador real."""

    def setUp(self) -> None:
        """Instalación sintética cuyo paquete cita por huella un original de una fuente."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.carpeta = Path(temporal.name).resolve()
        self.raiz = self.carpeta / "candidato"
        preparar(self.raiz)
        origenes = {f"{CATALUNA}/edición.json": sha256(self.raiz / CATALUNA / "edición.json")}
        guardar_json(
            self.raiz / "datos/manifiesto.json",
            {"uno.json": {"sha256": sha256(self.raiz / "datos/uno.json"), "origenes": origenes}},
        )

    def publicar_version_nueva_de_la_fuente(self) -> None:
        """La fuente queda en verde y publica originales nuevos; el paquete retenido sigue citando los anteriores."""
        guardar_json(self.raiz / CATALUNA / "edición.json", {"edicion": "nueva"})
        guardar_json(
            self.raiz / CATALUNA / "procedencia.json",
            {"archivos": [{"archivo": "edición.json", "sha256": sha256(self.raiz / CATALUNA / "edición.json")}]},
        )

    def test_generacion_del_rechazo_no_se_conserva_y_se_sabe_por_que(self) -> None:
        """Reproduce el ciclo real: la exportación rechaza un paquete que cita originales que ya no están."""
        generacion.exportar_generacion(self.raiz, self.carpeta / "base", REVISION)
        self.publicar_version_nueva_de_la_fuente()
        # assertRaises retira la traza de la excepción, y la causa se lee justamente de ella.
        try:
            generacion.exportar_generacion(self.raiz, self.carpeta / "intento", REVISION)
        except ErrorFuente as error:
            causa = causas.causa_de_la_generacion(error)
        else:
            self.fail("La generación del intento se exportó")
        self.assertEqual(
            causa,
            {
                "clase": "HuellaIncorrecta",
                "comprobacion": "comprobar_originales_del_paquete",
                "causa": "paquete-cita-otros-originales",
            },
        )
        self.assertFalse((self.carpeta / "intento").exists())

    def escribir_ciclo(self, pasos: list[dict], alarmas: list[str], motivo: str = "") -> None:
        """Estado e informe del candidato como los deja la actualización con el paquete en ámbar."""
        estado = json.loads((self.raiz / generacion.ESTADO).read_bytes())
        estado["actualizacion"].update(comienzo_utc=COMIENZO, informe=f"{INFORME}.md")
        estado["modulos"]["paquete"].update(ultimo_intento_utc=COMIENZO, veredicto="ámbar", motivo=motivo)
        guardar_json(self.raiz / generacion.ESTADO, estado)
        guardar_json(self.raiz / f"{INFORME}.json", {"pasos": pasos, "comparacion": {"alarmas": alarmas}})

    def test_paquete_en_ambar_por_un_paso_en_rojo_dice_cual(self) -> None:
        """El paso del paquete que quedó en rojo llega al diario con su nombre cerrado y su código."""
        self.escribir_ciclo(
            [
                {"nombre": "citilab · descargar", "codigo": 1},
                {"nombre": "Exportar el paquete del motor", "codigo": 0},
                {"nombre": "Construir la web local y comprobar sus artefactos", "codigo": 2},
            ],
            [],
        )
        self.assertEqual(causas.causas_del_paquete(self.raiz), {"paso": "cotejar-web", "codigo": 2, "alarmas": []})

    def _anotado_en_el_diario(self) -> dict:
        ruta = self.carpeta / "diario.jsonl"
        with diario.abrir(ruta, {"run": "1"}, consola=False):
            causas.registrar_paquete(self.raiz, "rechazado")
        (evento,) = [json.loads(linea) for linea in ruta.read_text().splitlines()]
        return evento

    def test_un_paso_del_paquete_cortado_por_su_tope_llega_como_plazo_agotado(self) -> None:
        """El tope de una orden devuelve el código 124 sin excepción: el diario lo nombra con su causa y su paso."""
        self.escribir_ciclo([{"nombre": "Comprobaciones de los datos nuevos", "codigo": 124}], [])
        evento = self._anotado_en_el_diario()
        self.assertEqual(
            (evento["fase"], evento["estado"], evento["causa"], evento["paso"]),
            ("paquete", "retenido", "plazo-agotado", "comprobar-datos"),
        )

    def test_un_paquete_que_no_cabe_antes_de_la_hora_limite_dice_que_no_empezo(self) -> None:
        """El paquete sin empezar por la hora límite del motor llega como «sin-empezar» y «plazo-insuficiente»."""
        self.escribir_ciclo([], [], motivo=MOTIVO_SIN_TIEMPO)
        evento = self._anotado_en_el_diario()
        self.assertEqual((evento["paso"], evento["causa"]), ("sin-empezar", "plazo-insuficiente"))

    def test_un_paso_que_falla_sin_agotar_su_tope_no_lleva_causa_de_tiempo(self) -> None:
        """Un código distinto de 124 no se confunde con un plazo agotado."""
        self.escribir_ciclo([{"nombre": "Comprobaciones de los datos nuevos", "codigo": 1}], [])
        self.assertNotIn("causa", self._anotado_en_el_diario())

    def test_paquete_en_ambar_por_una_alarma_dice_tipo_y_archivo(self) -> None:
        """Las alarmas llegan por su tipo y el archivo del paquete; el texto libre no sale."""
        self.escribir_ciclo(
            [{"nombre": "Comprobaciones de los datos nuevos", "codigo": 0}],
            ["ocupaciones.json desaparece del paquete", "frase sin forma conocida"],
            motivo="ocupaciones.json desaparece del paquete",
        )
        self.assertEqual(
            causas.causas_del_paquete(self.raiz),
            {
                "paso": None,
                "codigo": None,
                "alarmas": [{"tipo": "desaparece", "archivo": "ocupaciones.json"}, {"tipo": "otra", "archivo": None}],
            },
        )

    def test_las_causas_llegan_al_diario_y_al_resumen_archivado(self) -> None:
        """Paquete retenido y generación no conservada constan en el diario y en su resumen cerrado."""
        self.escribir_ciclo([{"nombre": "Exportar el paquete del motor", "codigo": 1}], [])
        ruta = self.carpeta / "diario.jsonl"
        identidad = {"operacion": "ejecutar", "run": "44984285818", "intento": "1"}
        with diario.abrir(ruta, identidad, consola=False):
            causas.registrar_paquete(self.raiz, "rechazado")
            try:
                generacion.sin_recuperacion(self._con_exportacion_a_medias())
            except ValueError as error:
                causas.registrar_generacion_no_conservada(error)
        resumen = json.loads(resumen_diario.componer(ruta.read_text().splitlines(), "ejecutar", "44984285818", "1"))
        self.assertEqual(
            resumen["retenciones"],
            {
                # Sin línea de fallo en el diagnóstico del paso, el resumen no inventa tramo ni clase.
                "paquete": {
                    "paso": "exportar",
                    "codigo": 1,
                    "alarmas": [],
                    "legible": True,
                    "tramo": None,
                    "clase": None,
                    "errno": None,
                    "motivoAlmacen": None,
                },
                "generacion": {
                    "clase": "GeneracionInvalida",
                    "comprobacion": "sin_recuperacion",
                    "causa": "recuperacion-pendiente",
                },
                "candidato": None,
            },
        )

    def _con_exportacion_a_medias(self) -> Path:
        (self.raiz / ".datos-exportando-1").mkdir()
        return self.raiz

    def test_paquete_en_verde_no_anota_nada(self) -> None:
        """Sin retención no hay causa que anotar."""
        self.escribir_ciclo([], [])
        estado = json.loads((self.raiz / generacion.ESTADO).read_bytes())
        estado["modulos"]["paquete"]["veredicto"] = "verde"
        guardar_json(self.raiz / generacion.ESTADO, estado)
        self.assertIsNone(causas.causas_del_paquete(self.raiz))


class PruebaPaginaDeComprobacion(unittest.TestCase):
    """Citilab responde 202 con una página HTML: causa propia, distinta de la etapa rechazada."""

    def test_pagina_html_con_estado_2xx_tiene_causa_propia(self) -> None:
        """La página se reconoce por su tipo o por su cuerpo y la orquestación la anota con su causa cerrada."""
        for cabeceras, cuerpo in (
            ({"Content-Type": "text/html; charset=UTF-8"}, b"<!DOCTYPE html><title>Un momento</title>"),
            ({}, b"  <html><body>comprobando</body></html>"),
        ):
            with self.subTest(cabeceras=cabeceras), self.assertRaises(ErrorFuente) as fallo:
                totales_de_pagina(cuerpo, cabeceras, 1)
            self.assertEqual(causa_de_salida(1, f"✗ {fallo.exception}"), "pagina-de-comprobacion")

    def test_json_no_valido_sigue_siendo_etapa_rechazada(self) -> None:
        """Un cuerpo que no es HTML ni JSON conserva la causa general."""
        with self.assertRaises(ErrorFuente) as fallo:
            totales_de_pagina(b"{roto", {"Content-Type": "application/json"}, 1)
        self.assertEqual(causa_de_salida(1, str(fallo.exception)), "etapa-rechazada")


if __name__ == "__main__":
    unittest.main()
