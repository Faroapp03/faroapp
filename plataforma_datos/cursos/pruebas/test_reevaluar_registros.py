"""Reproducción de observaciones archivadas sobre una SQLite sintética."""

import hashlib
import shutil
import sqlite3
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch

from plataforma_datos.comun.huella_json import sha256_json
from plataforma_datos.cursos import admision_catalogo as admision
from plataforma_datos.cursos import almacen_catalogo as almacen
from plataforma_datos.cursos import catalogo, politicas_vigencia, reevaluar_registros
from plataforma_datos.cursos import registro_vigencia as registro
from plataforma_datos.cursos import seleccion_entrega_catalogo as seleccion
from plataforma_datos.cursos.contrato_entrega_catalogo import ErrorEntregaCatalogo
from plataforma_datos.cursos.pruebas import test_cibernarium_actualizacion as barcelona
from plataforma_datos.cursos.pruebas.test_catalogo import lote_base
from plataforma_datos.cursos.pruebas.test_vigencia import ficha

CORTE = "2026-11-18T17:12:00Z"
CAPTURA = "2026-11-15T10:00:00Z"
ANTERIOR = "2026-11-15T12:00:00Z"


class ReevaluacionPruebas(unittest.TestCase):
    """La firma y el tiempo de decisión varían independientemente de la recepción formal."""

    def setUp(self) -> None:
        """Crea una edición y un recurso nativos con un cuerpo verificable."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.area = Path(temporal.name)
        self.base = self.area / "catalogo.sqlite3"
        lote = lote_base()
        recurso = deepcopy(lote["programas"][0])
        recurso["id"] = "recurso-1"
        lote["programas"].append(recurso)
        catalogo.cargar_lote(self.base, lote)
        self.firma = registro.firma_evaluador()
        self.anterior = deepcopy(self.firma)
        self.componente = next(k for k in self.anterior["archivos"] if k.endswith("matricula_actual.py"))
        self.anterior["archivos"][self.componente] = "a" * 64
        self.cuerpo = self.area / "curso.json"
        self.cuerpo.write_bytes(b'{"abierto":true}')
        self.sha = hashlib.sha256(self.cuerpo.read_bytes()).hexdigest()
        self.refs = {self.sha: admision.ReferenciaArchivo(ruta=self.cuerpo, sha256=self.sha)}

    def registrar(self, tipo: str = "edicion", *, fin: str | None = None) -> int:
        """Escribe observaciones con la firma anterior mediante el registro ordinario.

        Returns:
            Identidad de la evaluación anterior.
        """
        ident = "edicion-1" if tipo == "edicion" else "recurso-1"
        with sqlite3.connect(self.base) as db:
            tabla = "ediciones" if tipo == "edicion" else "programas"
            huella = db.execute("SELECT huella FROM " + tabla + " WHERE id=?", (ident,)).fetchone()[0]
        oferta = {"id": ident, "fuente_id": "fundae", "url": "https://example.org/formacion/python"}
        obs = ficha(CAPTURA, fuente={"estado": "actual_matricula_abierta", "fin_matricula": fin} if fin else None)
        obs["url_consultada"] = oferta["url"]
        obs["detalle"].update(identidad_observada=ident, url_final=oferta["url"])
        for ev in obs["evidencias"]:
            ev.update(sha256=self.sha, url=oferta["url"])
        self.anterior["sha256"] = sha256_json({k: self.anterior[k] for k in ("version_contrato_vigencia", "archivos")})
        with patch.object(registro, "firma_evaluador", return_value=self.anterior):
            return registro.registrar_unidad(
                self.base,
                registro.SolicitudEvaluacionUnidad(
                    unidad=registro.UnidadEvaluable(tipo=tipo, id=ident, huella=huella),
                    oferta=oferta,
                    observaciones=[obs],
                    politica=politicas_vigencia.leer_politica("fundae", "3"),
                    ahora=ANTERIOR,
                ),
            )["evaluacion_id"]

    def test_edicion_y_recurso_se_recalculan_sin_rejuvenecer_y_reintento_vacio(self) -> None:
        """Un plazo vencido y uno abierto se resuelven en el corte real sin duplicar observaciones."""
        self.registrar(fin="2026-11-16")
        self.registrar("recurso")
        peticiones = list(reevaluar_registros.solicitudes(self.base, self.refs, CORTE))
        self.assertEqual(len(peticiones), 2)
        destino = self.area / "candidata.sqlite3"
        shutil.copyfile(self.base, destino)
        for peticion in peticiones:
            registro.registrar_unidad(destino, peticion)
        ed = registro.consultar_unidad(destino, tipo="edicion", id="edicion-1")["evaluacion"]
        rec = registro.consultar_unidad(destino, tipo="recurso", id="recurso-1")["evaluacion"]
        self.assertEqual(ed["resultado"]["estado"], "no-disponible-publicamente")
        self.assertEqual(rec["resultado"]["estado"], "disponible-publicamente")
        self.assertEqual(rec["resultado"]["comprobado_el"], CAPTURA)
        self.assertEqual(ed["corte_utc"], CORTE)
        self.assertEqual(list(reevaluar_registros.solicitudes(destino, self.refs, CORTE)), [])
        with sqlite3.connect(destino) as db:
            self.assertEqual(db.execute("SELECT count(*) FROM observaciones_vigencia").fetchone()[0], 2)
            self.assertEqual(db.execute("SELECT count(*) FROM evaluaciones_vigencia").fetchone()[0], 4)

    def test_firma_sin_modulo_de_retiradas_no_reabre_en_esta_ni_en_otra_revision(self) -> None:
        """Un histórico que carece del contrato de negativas continúa pendiente de su productor."""
        self.anterior["archivos"].pop(next(k for k in self.anterior["archivos"] if k.endswith("retirada_proveedor.py")))
        self.registrar()
        self.assertEqual(list(reevaluar_registros.solicitudes(self.base, self.refs, CORTE)), [])
        otra = deepcopy(self.firma)
        otra["archivos"][self.componente] = "c" * 64
        otra["sha256"] = sha256_json({k: otra[k] for k in ("version_contrato_vigencia", "archivos")})
        with patch.object(registro, "firma_evaluador", return_value=otra):
            self.assertEqual(list(reevaluar_registros.solicitudes(self.base, self.refs, CORTE)), [])

    def test_falta_original_o_corte_conflictivo_conserva_historia(self) -> None:
        """Un SHA perdido o un corte ya ocupado nunca autoriza reescribir una decisión."""
        self.registrar()
        self.assertEqual(list(reevaluar_registros.solicitudes(self.base, {}, CORTE)), [])
        self.assertEqual(list(reevaluar_registros.solicitudes(self.base, self.refs, ANTERIOR)), [])

    def test_sha_de_un_cuerpo_declarado_alterado_interrumpe(self) -> None:
        """Una corrupción material se distingue de un original que jamás se admitió."""
        self.registrar()
        self.cuerpo.write_bytes(b'{"abierto":false}')
        with self.assertRaises(ErrorEntregaCatalogo):
            list(reevaluar_registros.solicitudes(self.base, self.refs, CORTE))

    def test_censo_heredado_no_reabre_una_edicion_y_un_recibo_propio_si_la_sostiene(self) -> None:
        """Una selección histórica puede seguir en el control aun después de desaparecer del último censo."""
        b = barcelona.AplicacionCibernarium()
        b.setUp()
        self.addCleanup(b.doCleanups)
        corte = "2026-10-24T10:00:00Z"
        self.anterior["sha256"] = sha256_json({k: self.anterior[k] for k in ("version_contrato_vigencia", "archivos")})
        with patch.object(registro, "firma_evaluador", return_value=self.anterior):
            base = b.aplicar(b.actividad)
        sqlite = base / "catalogo.sqlite3"
        id = "cibernarium-edicion:456"
        antigua = registro.consultar_unidad(sqlite, tipo="edicion", id=id)
        fuente = almacen.solicitud(base)
        refs = reevaluar_registros.contenido_aprendizaje.referencias_de_evidencia_indexadas(fuente)
        seleccionada = reevaluar_registros._selecciones(fuente, refs)
        self.assertIn(id, seleccionada["barcelonactiva"])
        destino = self.area / "admitida"
        self.assertEqual(reevaluar_registros.aplicar_si_cambia(base, destino, corte), destino)
        nueva = registro.consultar_unidad(destino / "catalogo.sqlite3", tipo="edicion", id=id)["evaluacion"]
        self.assertEqual(nueva["resultado"]["estado"], "disponible-publicamente")
        self.assertEqual(nueva["resultado"]["comprobado_el"], antigua["evaluacion"]["resultado"]["comprobado_el"])
        self.assertEqual(reevaluar_registros.aplicar_si_cambia(destino, self.area / "sin-cambios", corte), destino)
        leer = almacen.leer_documento_indexado

        def lectura_con_ausencia(ref: admision.ReferenciaArchivo, referencias: dict) -> dict:
            documento = leer(ref, referencias)
            if ref == fuente.procedencia["recibo-cibernarium"]:
                documento["resultados"] = []
                documento["ausentes_sin_interpretar_baja"] = [id]
            return documento

        with patch.object(almacen, "leer_documento_indexado", side_effect=lectura_con_ausencia):
            sin_edicion = reevaluar_registros._selecciones(fuente, refs)
        self.assertEqual(list(reevaluar_registros.solicitudes(sqlite, refs, corte, selecciones=sin_edicion)), [])
        estado = seleccion.estado_interno_de_unidad(antigua, corte)
        self.assertEqual(seleccion.motivo_de_retencion(estado, corte), "matricula_actual_de_edicion_por_confirmar")
        self.assertEqual(estado["comprobado_el"], antigua["evaluacion"]["resultado"]["comprobado_el"])

    def test_ficha_individual_exige_mismo_horario_estado_y_selector(self) -> None:
        """Releer HTML identifica el cierre concreto y rechaza un hecho o un selector ajenos."""
        from plataforma_datos.cursos.fuentes.barcelonactiva import contraste_ediciones, ficha_edicion

        b = barcelona.AplicacionCibernarium()
        b.setUp()
        self.addCleanup(b.doCleanups)
        url = ficha_edicion.url("456")
        cuerpo = (
            f'<meta property="og:url" content="{url}"><meta property="og:title" content="Activitat 123">'
            '<div id="edicionesList"><div class="item-ediciones izq item1">'
            '<li class="activity-session-date">Diumenge 25 d’octubre, 10:00h - 12:00h</li>'
            '<div class="dates">Dates: del 25/10/2026 al 25/10/2026</div>'
            '<span class="next-edition code-DISP2">Inscripció tancada.</span></div></div>'
        ).encode()
        cap = barcelona.rx._captura(b.original, url, cuerpo, id="cibernarium-edicion:456")
        diagnostico, observacion = contraste_ediciones.observar(b.original, cap, b.programa["titulo"], b.edicion)
        self.assertEqual(diagnostico, "ficha_individual_cerrada")
        refs = {cap["cuerpo"]["sha256"]: b.ref(b.original / cap["cuerpo"]["archivo"])}
        oferta = {"fuente_id": "barcelonactiva", "id": b.edicion["id"], "url": b.programa["url"]}
        soportes = reevaluar_registros._Soportes(refs)
        with catalogo.abrir_lectura(b.base) as db:
            self.assertTrue(soportes.reproducibles([observacion], oferta, db))
            for campo in ("estado", "selector", "identidad", "acceso"):
                alterada = deepcopy(observacion)
                if campo == "estado":
                    alterada["detalle"]["datos_edicion"]["estado_inscripcion"] = "sin-plazas"
                elif campo == "selector":
                    alterada["evidencias"][-1]["localizador"]["valor"] = "#otro"
                elif campo == "identidad":
                    alterada["detalle"]["identidad_observada"] = "cibernarium-edicion:999"
                else:
                    alterada["detalle"]["acceso_abierto"] = True
                with self.subTest(campo=campo):
                    self.assertFalse(soportes.reproducibles([alterada], oferta, db))

    def test_toma_tambien_un_cierre_recuperado_en_un_corte_anterior(self) -> None:
        """Un hecho llegado tarde al registro cuenta aunque falte en la última lista firmada."""
        self.registrar()
        ident = "edicion-1"
        anterior = registro.consultar_unidad(self.base, tipo="edicion", id=ident)["evaluacion"]
        entradas = anterior["entradas"]
        original = entradas["observaciones"][0]
        cierre = deepcopy(original)
        cierre["id"] = "cierre-tardio"
        fecha = "2026-11-15T10:30:00Z"
        cierre.update(intentado_el=fecha, terminado_el=fecha)
        cierre["detalle"]["datos_edicion"]["estado_inscripcion"] = "cerrada"
        cierre["detalle"]["acceso_abierto"] = None
        for apoyo in cierre["evidencias"]:
            apoyo["capturado_utc"] = fecha
        with patch.object(registro, "firma_evaluador", return_value=self.anterior):
            registro.registrar_unidad(
                self.base,
                registro.SolicitudEvaluacionUnidad(
                    unidad=registro.UnidadEvaluable(tipo="edicion", id=ident, huella=anterior["huella_edicion"]),
                    oferta=entradas["oferta"],
                    politica=entradas["politica"],
                    observaciones=[original, cierre],
                    ahora="2026-11-15T11:00:00Z",
                ),
            )
        (peticion,) = reevaluar_registros.solicitudes(self.base, self.refs, CORTE)
        self.assertCountEqual([o["id"] for o in peticion.observaciones], [original["id"], cierre["id"]])
        registro.registrar_unidad(self.base, peticion)
        resultado = registro.consultar_unidad(self.base, tipo="edicion", id=ident)["evaluacion"]["resultado"]
        self.assertEqual(resultado["estado"], "no-disponible-publicamente")
        self.assertEqual(resultado["comprobado_el"], fecha)

    def test_cabecera_movida_otra_edicion_y_fallo_transitorio_desde_capturas(self) -> None:
        """La ficha del horario ajeno deja pendiente, mientras un 503 conserva el dato hasta su fin."""
        from plataforma_datos.cursos import vigencia
        from plataforma_datos.cursos.fuentes.barcelonactiva import (
            contraste_ediciones,
            ficha_edicion,
            observaciones_actuales,
        )

        b = barcelona.AplicacionCibernarium()
        b.setUp()
        self.addCleanup(b.doCleanups)
        api = deepcopy(b.actividad)
        api["activityId"] = "789"
        cap = b.captura(api, "2026-10-23T21:01:02Z")
        oferta, previa = observaciones_actuales.construir(b.original, cap, actividad_id="789", edicion_id="456")
        self.assertNotEqual(oferta["url"], b.programa["url"])
        url = ficha_edicion.url("456")
        cuerpo = (
            f'<meta property="og:url" content="{url}"><meta property="og:title" content="Activitat 123">'
            '<div id="edicionesList"><div class="item-ediciones izq item1">'
            '<li class="activity-session-date">Divendres 30 d’octubre, 10:00h - 12:00h</li>'
            '<div class="dates">Dates: del 30/10/2026 al 30/10/2026</div>'
            '<span class="next-edition code-DISP2">Inscripció tancada.</span></div></div>'
        ).encode()
        ausente = barcelona.rx._captura(b.original, url, cuerpo, id=oferta["id"], fin="2026-10-23T21:30:00Z")
        caida = barcelona.rx._captura(
            b.original, url, b"Servicio temporalmente caido", id=oferta["id"], http=503, fin="2026-10-23T22:00:00Z"
        )
        no_encontrada = barcelona.rx._captura(
            b.original, url, b"Ficha no encontrada", id=oferta["id"], http=404, fin="2026-10-23T22:30:00Z"
        )
        refs = {
            dato["sha256"]: b.ref(b.original / dato["archivo"])
            for recepcion in (cap, ausente, caida, no_encontrada)
            for dato in (recepcion["cuerpo"], recepcion["intento"], recepcion["metadatos"])
        }
        soportes = reevaluar_registros._Soportes(refs)
        corte = "2026-10-24T09:00:00Z"
        original = vigencia.evaluar_vigencia(oferta, [previa], barcelona.matricula.politica(), ahora=corte)
        _, incidencia = contraste_ediciones.observar(b.original, no_encontrada, b.programa["titulo"], b.edicion)
        self.assertFalse(soportes.fallo_transitorio(incidencia, oferta))
        with catalogo.abrir_lectura(b.base) as db:
            for recepcion, estado in [(ausente, "sin-confirmar"), (caida, "disponible-publicamente")]:
                diagnostico, obs = contraste_ediciones.observar(b.original, recepcion, b.programa["titulo"], b.edicion)
                historial = [previa, obs]
                with self.subTest(diagnostico=diagnostico):
                    self.assertTrue(soportes.reproducibles(historial, oferta, db))
                    if recepcion == ausente:
                        ajena = {**oferta, "url": barcelona.robot.url_ficha("999")}
                        self.assertFalse(soportes.reproducibles(historial, ajena, db))
                    resultado = vigencia.evaluar_vigencia(
                        oferta, historial, barcelona.matricula.politica(), ahora=corte
                    )
                    self.assertEqual(resultado["estado"], estado)
                    self.assertEqual(resultado["comprobado_el"], original["comprobado_el"])
                    if recepcion == caida:
                        self.assertEqual(resultado["cierra_el"], original["cierra_el"])
                        seleccionada = {oferta["fuente_id"]: {oferta["id"]: obs["id"]}}
                        self.assertTrue(
                            reevaluar_registros._respaldo_actual(
                                {"entradas": {"oferta": oferta}, "resultado": original},
                                historial,
                                resultado,
                                seleccionada,
                                soportes,
                            )
                        )
                        for previa_invalida in [
                            {**original, "estado": "sin-confirmar"},
                            {**original, "cierra_el": None},
                            {**original, "cierra_el": "2026-10-24T23:00:00Z"},
                        ]:
                            self.assertFalse(
                                reevaluar_registros._respaldo_actual(
                                    {"entradas": {"oferta": oferta}, "resultado": previa_invalida},
                                    historial,
                                    resultado,
                                    seleccionada,
                                    soportes,
                                )
                            )
