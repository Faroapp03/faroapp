"""Hechos por edición desde la misma selección Cibernàrium admitida, sin red."""

import hashlib
import unittest
from copy import deepcopy
from pathlib import Path

from plataforma_datos.cursos import almacen_catalogo as almacen
from plataforma_datos.cursos import contenido_aprendizaje, contenido_cibernarium, registro_vigencia
from plataforma_datos.cursos.fuentes.barcelonactiva import (
    actualizacion,
    adquisicion,
    control_actual,
    matricula_actual,
    negocio_actual,
)
from plataforma_datos.cursos.pruebas import test_cibernarium_actualizacion as ciclo
from plataforma_datos.cursos.pruebas import test_cibernarium_adquisicion as rx


class ContenidoCibernarium(unittest.TestCase):
    """Ejecuta recepción, SQLite, aplicación y consumidor productivos sobre fixtures."""

    def setUp(self) -> None:
        """Compone una edición inicial con normas anteriores a la página API."""
        self.ciclo = ciclo.AplicacionCibernarium()
        self.ciclo.setUp()
        self.addCleanup(self.ciclo.doCleanups)
        self.primera = self.ciclo.aplicar(self.ciclo.actividad, "primera")
        self.id = self.ciclo.edicion["id"]

    def leer(self, destino: Path, corte: str = ciclo.CORTE, evaluaciones: dict | None = None) -> dict:
        """Resuelve exclusivamente el índice de la candidata recibida.

        Returns:
            Hechos por edición; nunca busca originales fuera de la instantánea.
        """
        solicitud = almacen.solicitud(destino)
        ids = set(negocio_actual.leer(solicitud.snapshot.ruta)[1])
        propias = evaluaciones or {
            id: registro_vigencia.consultar_edicion(solicitud.snapshot.ruta, id)["evaluacion"] for id in ids
        }
        return contenido_cibernarium.actuales(
            solicitud, ids, contenido_aprendizaje.referencias_de_evidencia_indexadas(solicitud), propias, corte
        )

    def siguiente(self, cuerpo: bytes, http: int = 200) -> tuple[Path, dict]:
        """Renueva API y conserva el intento independiente de normas.

        Returns:
            Segunda candidata admitida y su conjunto reproducido.
        """
        solicitud = almacen.solicitud(self.primera)
        entrada = almacen.EntradaCatalogo(
            admision=solicitud, sha256_admision=hashlib.sha256(solicitud.validacion_destino.read_bytes()).hexdigest()
        )
        api = self.ciclo.captura(self.ciclo.actividad, "2026-10-23T21:45:00Z")
        normas = rx._captura(self.ciclo.original, adquisicion.NORMAS, cuerpo, http=http, fin="2026-10-23T21:44:00Z")
        documento = {
            "schema_version": 1,
            "fuente_id": "barcelonactiva",
            "canal": "cibernarium",
            "capturas": [api],
            "auxiliares": {"normas": normas},
            "fichas": {},
            "historial": [],
        }
        conjunto = adquisicion.calcular(self.ciclo.original, documento, [self.ciclo.programa])
        destino = self.ciclo.raiz / "segunda"
        actualizacion.aplicar(
            entrada, conjunto=conjunto, original=self.ciclo.original, destino=destino, corte="2026-10-23T22:01:00Z"
        )
        return destino, conjunto

    def test_ficha_admitida_llega_a_referencias_de_la_edicion(self) -> None:
        """La captura solo se vincula mediante el contexto de su padre conocido."""
        solicitud = almacen.solicitud(self.primera)
        entrada = almacen.EntradaCatalogo(
            admision=solicitud, sha256_admision=hashlib.sha256(solicitud.validacion_destino.read_bytes()).hexdigest()
        )
        api = self.ciclo.captura(self.ciclo.actividad, "2026-10-23T21:45:00Z")
        normas = rx._captura(self.ciclo.original, adquisicion.NORMAS, rx._normas(), fin="2026-10-23T21:44:00Z")
        actividad_id = self.ciclo.programa["id"].removeprefix("cibernarium:")
        from plataforma_datos.cursos.fuentes.barcelonactiva import robot_cibernarium as robot

        ficha = rx._captura(
            self.ciclo.original,
            robot.url_ficha(actividad_id),
            b"<html>Ficha propia</html>",
            id=self.ciclo.programa["id"],
            fin="2026-10-23T21:43:00Z",
        )
        documento = {
            "schema_version": 1,
            "fuente_id": "barcelonactiva",
            "canal": "cibernarium",
            "capturas": [api],
            "auxiliares": {"normas": normas},
            "fichas": {actividad_id: ficha},
            "historial": [],
        }
        conjunto = adquisicion.calcular(self.ciclo.original, documento, [self.ciclo.programa])
        destino = self.ciclo.raiz / "con-ficha"
        actualizacion.aplicar(
            entrada, conjunto=conjunto, original=self.ciclo.original, destino=destino, corte="2026-10-23T22:01:00Z"
        )
        extra = self.leer(destino, "2026-10-23T22:01:00Z")[self.id]
        self.assertTrue(
            any(
                r["url"] == robot.url_ficha(actividad_id) and r["sha256"] == ficha["cuerpo"]["sha256"]
                for r in extra["referencias"]
            )
        )
        solicitud_dos = almacen.solicitud(destino)
        entrada_dos = almacen.EntradaCatalogo(
            admision=solicitud_dos,
            sha256_admision=hashlib.sha256(solicitud_dos.validacion_destino.read_bytes()).hexdigest(),
        )
        api_dos = self.ciclo.captura(self.ciclo.actividad, "2026-10-23T21:55:00Z")
        fallo = rx._captura(
            self.ciclo.original,
            robot.url_ficha(actividad_id),
            b"Forbidden",
            id=self.ciclo.programa["id"],
            http=403,
            fin="2026-10-23T21:54:00Z",
        )
        documento_dos = {**documento, "capturas": [api_dos], "fichas": {actividad_id: fallo}}
        conjunto_dos = adquisicion.calcular(self.ciclo.original, documento_dos, [self.ciclo.programa])
        final = self.ciclo.raiz / "ficha-con-fallo"
        actualizacion.aplicar(
            entrada_dos,
            conjunto=conjunto_dos,
            original=self.ciclo.original,
            destino=final,
            corte="2026-10-23T22:02:00Z",
        )
        extra_dos = self.leer(final, "2026-10-23T22:02:00Z")[self.id]
        self.assertTrue(any(r["sha256"] == ficha["cuerpo"]["sha256"] for r in extra_dos["referencias"]))
        self.assertFalse(any(r["sha256"] == fallo["cuerpo"]["sha256"] for r in extra_dos["referencias"]))

    def test_hechos_y_calendario_propios_sin_heredar_html_o_fecha_de_matricula(self) -> None:
        """Matrícula actual permite solicitar una edición futura, sin prometer acceso."""
        dato = self.leer(self.primera)[self.id]
        self.assertEqual(dato["formacion"]["valor"], "gratis_formacion")
        self.assertEqual(dato["formacion"]["alcance"], "declaracion_general")
        self.assertTrue(dato["inscripcion"]["registro_previo_para_inscribirse"])
        self.assertEqual(dato["matricula_actual"]["metodo"], matricula_actual.METODO)
        self.assertEqual(len(dato["calendarios_propios"]), 1)
        calendario = dato["calendarios_propios"][0]
        self.assertEqual(calendario["valor"]["tipo"], "sesiones")
        self.assertEqual(calendario["vinculo_edicion"]["edicion"]["id"], self.id)
        self.assertEqual(calendario["valor"]["sesiones"][0]["inicio"], "2026-10-25T10:00:00+01:00")
        self.assertEqual(dato["edicion_id"], self.id)
        self.assertFalse(set(dato) & {"idioma", "idiomas_declarados", "horas_publicadas", "fechas_matricula"})

    def test_normas_y_matricula_conservan_valor_y_fecha_propia_dias_despues(self) -> None:
        """El tiempo no anula el marco general ni la matrícula; cada uno conserva su captura."""
        dato = self.leer(self.primera, "2026-10-27T10:00:00Z")[self.id]
        self.assertEqual(dato["formacion"]["valor"], "gratis_formacion")
        self.assertTrue(dato["inscripcion"]["registro_previo_para_inscribirse"])
        self.assertEqual(dato["formacion"]["vigencia"], {"comprobado_el": "2026-10-23T21:00:02Z"})
        self.assertEqual(dato["inscripcion"]["vigencia"], {"comprobado_el": "2026-10-23T21:00:02Z"})
        self.assertEqual(set(dato["matricula_actual"]["vigencia"]), {"comprobado_el"})
        for hecho in (dato["formacion"], dato["inscripcion"], dato["matricula_actual"], *dato["calendarios_propios"]):
            self.assertNotIn("vigente", hecho)

    def test_api_nueva_no_renueva_ni_invalida_normas_anteriores(self) -> None:
        """Tras un 403 de normas, la API renovada no cambia la fecha de la declaración general."""
        antes = self.leer(self.primera)[self.id]
        segunda, _ = self.siguiente(b"Forbidden", 403)
        despues = self.leer(segunda, "2026-10-27T10:00:00Z")[self.id]
        self.assertEqual(despues["formacion"], antes["formacion"])
        self.assertEqual(despues["formacion"]["vigencia"], {"comprobado_el": "2026-10-23T21:00:02Z"})
        self.assertEqual(despues["matricula_actual"]["vigencia"], {"comprobado_el": "2026-10-23T21:45:00Z"})

    def test_bueno_luego_403_conserva_normas_y_fecha_pero_registra_intento(self) -> None:
        """Una denegación técnica no borra ni rejuvenece la afirmación seleccionada."""
        antes = self.leer(self.primera)[self.id]
        segunda, _ = self.siguiente(b"Forbidden", 403)
        despues = self.leer(segunda, "2026-10-23T22:01:00Z")[self.id]
        self.assertEqual(antes["formacion"], despues["formacion"])
        self.assertEqual(antes["inscripcion"], despues["inscripcion"])
        self.assertEqual(despues["matricula_actual"]["vigencia"]["comprobado_el"], "2026-10-23T21:45:00Z")
        solicitud = almacen.solicitud(segunda)
        refs = contenido_aprendizaje.referencias_de_evidencia_indexadas(solicitud)
        control = almacen.leer_documento_indexado(solicitud.procedencia["control-cibernarium"], refs)
        control_actual.validar(control)
        ctx = next(iter(control["contextos"].values()))
        self.assertNotEqual(ctx["normas"], ctx["normas_intento"])

    def test_bueno_luego_200_contrario_no_rescata_la_declaracion_anterior(self) -> None:
        """El mismo documento identificado deja de acreditar formación gratuita."""
        cuerpo = rx._normas().replace(
            b"Totes les activitats de Barcelona Activa s\xc3\xb3n gratu\xc3\xaftes", b"Declaracio modificada"
        )
        segunda, _ = self.siguiente(cuerpo)
        dato = self.leer(segunda, "2026-10-27T10:00:00Z")[self.id]
        self.assertIsNone(dato["formacion"]["valor"])
        self.assertEqual(dato["formacion"]["vigencia"]["comprobado_el"], "2026-10-23T21:44:00Z")
        self.assertEqual(dato["formacion"]["motivo"], "declaracion_general_no_interpretable")

    def test_faq_identificada_ambigua_selecciona_incertidumbre_sin_borrar_api(self) -> None:
        """La ambigüedad factual no se oculta bajo una consulta anterior favorable."""
        cuerpo = rx._normas() + rx._normas()
        segunda, conjunto = self.siguiente(cuerpo)
        self.assertEqual(
            conjunto["auxiliares"]["normas"]["lectura"]["diagnostico"], "faq_identificada_no_interpretable"
        )
        dato = self.leer(segunda, "2026-10-23T22:01:00Z")[self.id]
        self.assertIsNone(dato["formacion"]["valor"])
        self.assertEqual(dato["matricula_actual"]["vigencia"], {"comprobado_el": "2026-10-23T21:45:00Z"})

    def test_observacion_distinta_no_autoriza_la_recepcion_del_control(self) -> None:
        """La presencia de otra prueba en el historial no sustituye el vínculo exacto."""
        solicitud = almacen.solicitud(self.primera)
        evaluacion = deepcopy(registro_vigencia.consultar_edicion(solicitud.snapshot.ruta, self.id)["evaluacion"])
        evaluacion["entradas"]["observaciones"][0]["detalle"]["acceso_abierto"] = True
        self.assertEqual(self.leer(self.primera, evaluaciones={self.id: evaluacion}), {})

    def test_primer_intento_403_no_convierte_datos_historicos_en_gratuidad_actual(self) -> None:
        """Sin selección identificada se emiten desconocidos, no un marco gratis."""
        self.ciclo.normas = rx._captura(self.ciclo.original, adquisicion.NORMAS, b"Forbidden", http=403)
        destino = self.ciclo.aplicar(self.ciclo.actividad, "sin-normas-identificadas")
        dato = self.leer(destino)[self.id]
        self.assertIsNone(dato["formacion"]["valor"])
        self.assertIsNone(dato["inscripcion"]["registro_previo_para_inscribirse"])
        self.assertEqual(dato["formacion"]["motivo"], "normas_sin_seleccion_identificada")

    def test_corte_anterior_no_expone_capturas_futuras(self) -> None:
        """El consumidor tampoco convierte una revisión posterior en conocimiento previo."""
        self.assertEqual(self.leer(self.primera, "2026-10-23T20:59:59Z"), {})

    def test_codificacion_no_interpretable_no_rescata_normas_anteriores(self) -> None:
        """Un HTML200 identificado ilegible no se transforma en fallo técnico favorable."""
        segunda, conjunto = self.siguiente(b"<html>\xff</html>")
        self.assertEqual(
            conjunto["auxiliares"]["normas"]["lectura"]["diagnostico"], "faq_identificada_no_interpretable"
        )
        self.assertIsNone(self.leer(segunda, "2026-10-23T22:01:00Z")[self.id]["formacion"]["valor"])

    def test_dos_ediciones_no_comparten_calendario_ni_hechos_html(self) -> None:
        """El ID común de actividad nunca sustituye el vínculo de cada edición."""
        actividad = deepcopy(self.ciclo.actividad)
        otra = deepcopy(actividad["listEditions"][0])
        otra["activityId"] = "789"
        otra["listSessions"][0].update(
            beginDateTime="Mon Nov 02 09:00:00 CET 2026", endDateTime="Mon Nov 02 12:00:00 CET 2026"
        )
        actividad["listEditions"].append(otra)
        destino = self.ciclo.aplicar(actividad, "dos-ediciones")
        datos = self.leer(destino)
        primera = datos[self.id]["calendarios_propios"][0]
        segunda = datos["cibernarium-edicion:789"]["calendarios_propios"][0]
        self.assertEqual(primera["vinculo_edicion"]["edicion"]["id"], self.id)
        self.assertEqual(segunda["vinculo_edicion"]["edicion"]["id"], "cibernarium-edicion:789")
        self.assertNotEqual(primera["valor"], segunda["valor"])
        self.assertFalse(set(datos["cibernarium-edicion:789"]) & {"idioma", "idiomas_declarados", "horas_publicadas"})

    def test_sesiones_propias_exactas_no_se_convierten_en_periodo_continuo(self) -> None:
        """Un hueco entre dos sesiones publicadas no acredita cursado durante ese hueco."""
        actividad = deepcopy(self.ciclo.actividad)
        otra = deepcopy(actividad["listEditions"][0]["listSessions"][0])
        otra.update(beginDateTime="Tue Oct 27 10:00:00 CET 2026", endDateTime="Tue Oct 27 12:00:00 CET 2026")
        actividad["listEditions"][0]["listSessions"].append(otra)
        destino = self.ciclo.aplicar(actividad, "sesiones-propias")
        dato = self.leer(destino)[self.id]
        calendario = dato["calendarios_propios"][0]
        self.assertEqual(
            calendario["valor"],
            {
                "tipo": "sesiones",
                "sesiones": [
                    {"inicio": "2026-10-25T10:00:00+01:00", "fin": "2026-10-25T12:00:00+01:00"},
                    {"inicio": "2026-10-27T10:00:00+01:00", "fin": "2026-10-27T12:00:00+01:00"},
                ],
            },
        )
        self.assertEqual(calendario["vinculo_edicion"]["edicion"]["id"], dato["edicion_id"])
        self.assertEqual(calendario["evidencia"], calendario["vinculo_edicion"]["evidencia"])
        self.assertTrue(calendario["evidencia"]["localizador"]["valor"].endswith("/listSessions"))
        self.assertEqual(calendario["vigencia"], dato["matricula_actual"]["vigencia"])

    def test_ventana_publicada_de_aula_no_fabrica_sesiones_ni_fecha_matricula(self) -> None:
        """El intervalo de acceso al Campus conserva su dimensión y soporte propios."""
        actividad = deepcopy(self.ciclo.actividad)
        actividad["formationType"] = "ONLINE"
        actividad["listEditions"][0].update(
            listSessions=[],
            sessionsOnline={"startDate": "Sun Oct 25 10:00:00 CET 2026", "endDate": "Thu Dec 31 23:59:00 CET 2026"},
        )
        destino = self.ciclo.aplicar(actividad, "aula-propia")
        dato = self.leer(destino)[self.id]
        self.assertEqual(len(dato["calendarios_propios"]), 1)
        calendario = dato["calendarios_propios"][0]
        self.assertEqual(
            calendario["valor"],
            {
                "tipo": "ventana-acceso",
                "inicio": "2026-10-25T10:00:00+01:00",
                "fin": "2026-12-31T23:59:00+01:00",
            },
        )
        self.assertTrue(calendario["evidencia"]["localizador"]["valor"].endswith("/sessionsOnline"))
        self.assertFalse(any(c["valor"]["tipo"] == "matricula" for c in dato["calendarios_propios"]))
