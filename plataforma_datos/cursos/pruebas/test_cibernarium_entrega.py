"""La edición operativa conserva sus hechos hasta el catálogo público admitido."""

import json
import unittest
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch

from plataforma_datos.comun.entrada_salida import sha256
from plataforma_datos.cursos import almacen_catalogo as almacen
from plataforma_datos.cursos import entrega_catalogo as entrega
from plataforma_datos.cursos import registro_vigencia
from plataforma_datos.cursos.fuentes.barcelonactiva import negocio_actual
from plataforma_datos.cursos.fuentes.barcelonactiva import robot_cibernarium as robot
from plataforma_datos.cursos.pruebas import test_contenido_cibernarium as fixtures


class EntregaCibernarium(unittest.TestCase):
    """Aplica una recepción, admite su SQLite y prepara/valida la entrega real."""

    def setUp(self) -> None:
        """Construye las evidencias sintéticas con sus relojes independientes."""
        self.caso = fixtures.ContenidoCibernarium()
        self.caso.setUp()
        self.addCleanup(self.caso.doCleanups)

    def proyectar(self, base: Path, corte: str = "2026-10-23T22:00:00Z") -> tuple[dict, dict]:
        """Entrega pública y linaje; ninguna consulta o evaluación nueva.

        Returns:
            Datos efectivamente escritos y validados por el exportador común.
        """
        admision = almacen.solicitud(base)
        solicitud = entrega.SolicitudEntrega(
            admision=admision,
            instalacion=self.caso.ciclo.raiz,
            sha256_admision=sha256(admision.validacion_destino),
            area=self.caso.ciclo.raiz / (base.name + "-entrega"),
            corte_utc=corte,
        )
        antes = sha256(admision.snapshot.ruta), admision.snapshot.ruta.stat().st_mtime_ns
        with patch.object(registro_vigencia.vigencia, "evaluar_vigencia", side_effect=AssertionError("No reevaluar")):
            entrega.preparar(solicitud)
            entrega.validar(solicitud)
        self.assertEqual(antes, (sha256(admision.snapshot.ruta), admision.snapshot.ruta.stat().st_mtime_ns))
        salida = solicitud.area / "validado"
        return (
            json.loads((salida / entrega.PUBLICO).read_bytes()),
            json.loads((salida / entrega.LINAJE).read_bytes())["catalogo_privado"],
        )

    def test_matricula_y_condiciones_llegan_a_su_edicion_publica(self) -> None:
        """Una edición admitida transmite su gratuidad general y condiciones con fecha."""
        publico, privado = self.proyectar(self.caso.primera)
        self.assertEqual(len(publico["ofertas"]), 1)
        oferta = publico["ofertas"][0]
        self.assertEqual(oferta["unidad"]["id"], self.caso.id)
        coste = oferta["hechos"]["coste_formacion_tipo"]
        self.assertEqual(coste["valor"], "gratis_formacion")
        self.assertEqual(coste["alcance"], "declaracion_general")
        self.assertEqual(coste["vigencia"]["comprobado_el"], "2026-10-23T21:00:02Z")
        self.assertTrue(oferta["hechos"]["requiere_registro_previo"]["valor"])
        self.assertEqual(oferta["hechos"]["modalidad"]["valor"], "presencial")
        self.assertEqual(oferta["hechos"]["sincronia"]["valor"], "sincrona")
        self.assertNotIn("vigencia", privado["unidades"][0]["hechos"]["coste_formacion_tipo"])

    def test_categoria_infantil_retiene_sus_ediciones_y_conserva_el_mismo_titulo_en_otra_categoria(self) -> None:
        """La categoría nativa alcanza nuevas ediciones y la proyección repetida conserva los originales."""
        actividad = deepcopy(self.caso.ciclo.actividad)
        actividad["title"] = "EstàsON. Les científiques canviem el món! (9 a 12 anys)"
        actividad["categoryId"] = "42"
        otra = deepcopy(actividad["listEditions"][0])
        otra["activityId"] = "789"
        actividad["listEditions"].append(otra)
        ids = {self.caso.id, "cibernarium-edicion:789"}
        general = self.caso.ciclo.aplicar(actividad, "otra-categoria")
        visible, _ = self.proyectar(general)
        self.assertEqual({o["unidad"]["id"] for o in visible["ofertas"]}, ids)

        actividad.update(category="STEAM per infants", categoryId="1907")
        infantil = self.caso.ciclo.aplicar(actividad, "categoria-infantil")
        publico, privado = self.proyectar(infantil)
        self.assertEqual(publico["ofertas"], [])
        self.assertEqual({e["id"] for e in privado["ediciones"]}, ids)
        self.assertEqual(
            {(r["unidad"]["id"], r["motivo"]) for r in privado["retenciones_publicacion"]},
            {(id_edicion, "cibernarium_solo_infancia") for id_edicion in ids},
        )
        self.assertEqual(self.proyectar(infantil), (publico, privado))

    def test_evidencia_admitida_llega_a_exportacion_y_repeticion(self) -> None:
        """La evidencia de esa edición viaja sin prosa y la exportación repetida conserva los bytes."""
        evidencia = {
            "version": 1,
            "actividad_id": str(self.caso.ciclo.actividad["activityId"]),
            "programa_id": self.caso.ciclo.programa["id"],
            "edicion_id": self.caso.id,
            "vinculo": {
                "url": "https://example.org/captura",
                "sha256": "a" * 64,
                "capturado_utc": "2026-10-23T21:00:00Z",
                "localizador": "/activities/0/listEditions/0/activityId",
            },
            "contenido": None,
            "censo_ia": None,
            "estado_censo": "sin-evidencia",
        }
        admision = almacen.solicitud(self.caso.primera)
        solicitud = entrega.SolicitudEntrega(
            admision=admision,
            instalacion=self.caso.ciclo.raiz,
            sha256_admision=sha256(admision.validacion_destino),
            area=self.caso.ciclo.raiz / "evidencia-entrega",
            corte_utc="2026-10-23T22:00:00Z",
        )
        destino = self.caso.ciclo.raiz / "publica" / entrega.PUBLICO
        with patch.object(entrega.materia_cibernarium, "actuales", return_value={self.caso.id: evidencia}) as lector:
            entrega.preparar(solicitud)
            entrega.validar(solicitud)
            entrega.exportar(solicitud, destino=destino)
            original = destino.read_bytes()
            entrega.exportar(solicitud, destino=destino)
        self.assertEqual(destino.read_bytes(), original)
        self.assertEqual(json.loads(original)["ofertas"][0]["evidencia_materia"], evidencia)
        lector.assert_any_call(admision, {self.caso.id}, solicitud.corte_utc)

    def test_fallo_de_normas_no_rejuvenece_la_condicion_publica(self) -> None:
        """Actualizar la matrícula tras un 403 conserva la fecha válida de las normas."""
        segunda, _ = self.caso.siguiente(b"Forbidden", 403)
        publico, _ = self.proyectar(segunda, "2026-10-23T22:01:00Z")
        oferta = publico["ofertas"][0]
        self.assertEqual(oferta["comprobado_el"], "2026-10-23T21:45:00Z")
        self.assertEqual(oferta["hechos"]["coste_formacion_tipo"]["vigencia"]["comprobado_el"], "2026-10-23T21:00:02Z")

    def test_dias_despues_la_oferta_y_sus_hechos_conservan_valor_y_fecha(self) -> None:
        """La revisión interna vencida no retira la edición ni anula gratuidad, registro o calendario."""
        publico, privado = self.proyectar(self.caso.primera, "2026-10-25T10:00:00Z")
        estado = privado["ediciones"][0]["vigencia"]
        self.assertLess(estado["revisar_el"], "2026-10-25T10:00:00Z")
        self.assertEqual(len(publico["ofertas"]), 1)
        oferta = publico["ofertas"][0]
        self.assertEqual(oferta["comprobado_el"], estado["comprobado_el"])
        self.assertEqual(oferta["cierra_el"], estado["cierra_el"])
        self.assertNotIn("vence_el", oferta)
        for campo, valor in (("coste_formacion_tipo", "gratis_formacion"), ("requiere_registro_previo", True)):
            hecho = oferta["hechos"][campo]
            self.assertEqual((hecho["valor"], hecho["motivo"]), (valor, "conocido"))
            self.assertEqual(hecho["vigencia"], {"comprobado_el": "2026-10-23T21:00:02Z"})
        calendario = oferta["hechos"]["calendario_formacion"]
        self.assertEqual(calendario["motivo"], "conocido")
        self.assertEqual(set(calendario["vigencia"]), {"comprobado_el"})
        self.assertEqual(oferta["hechos"]["modalidad"]["valor"], "presencial")
        self.assertNotIn("comprobacion_vencida", json.dumps(publico))
        cerrado, privado = self.proyectar(self.caso.primera, estado["cierra_el"])
        self.assertEqual(cerrado["ofertas"], [])
        self.assertEqual(
            [r["motivo"] for r in privado["retenciones_publicacion"]], ["limite_publicado_alcanzado_en_corte"]
        )

    def test_cabecera_nueva_conserva_programa_y_publica_url_evaluada_de_la_edicion(self) -> None:
        """Una cabecera distinta con la misma edición no duplica ni conserva un enlace anterior."""
        self.caso.ciclo.actividad["activityId"] = "999"
        segunda, _ = self.caso.siguiente(fixtures.rx._normas())
        programas, ediciones = negocio_actual.leer(segunda / "catalogo.sqlite3")
        programa_id = self.caso.ciclo.programa["id"]
        self.assertEqual(set(programas), {programa_id})
        self.assertEqual(ediciones[self.caso.id]["programa_id"], programa_id)
        self.assertEqual(programas[programa_id]["url"], self.caso.ciclo.programa["url"])
        publico, _ = self.proyectar(segunda, "2026-10-23T22:01:00Z")
        self.assertEqual(len(publico["ofertas"]), 1)
        oferta = publico["ofertas"][0]
        self.assertEqual(oferta["unidad"], {"tipo": "edicion", "id": self.caso.id, "programa_id": programa_id})
        self.assertEqual(oferta["url"], robot.url_ficha("999"))
        self.assertEqual(oferta["comprobado_el"], "2026-10-23T21:45:00Z")
        self.assertEqual(oferta["hechos"]["coste_formacion_tipo"]["valor"], "gratis_formacion")
