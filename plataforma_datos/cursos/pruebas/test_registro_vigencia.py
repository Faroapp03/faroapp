"""Persistencia de decisiones por edición, sin publicar ni crear hechos por ausencia."""

import json
import sqlite3
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch

from plataforma_datos.cursos import catalogo
from plataforma_datos.cursos import registro_vigencia as registro
from plataforma_datos.cursos.pruebas.test_catalogo import lote_base
from plataforma_datos.cursos.pruebas.test_vigencia import OFERTA, ficha, politica


class RegistroVigenciaPruebas(unittest.TestCase):
    """Toda escritura usa exclusivamente una candidata temporal con negocio realista."""

    def setUp(self) -> None:
        """Crea catálogo V10 aislado; no se toca ninguna SQLite real."""
        temporal = tempfile.TemporaryDirectory(prefix="vigencia Año ñ ")
        self.addCleanup(temporal.cleanup)
        self.base = Path(temporal.name) / "catalogo.sqlite"
        catalogo.cargar_lote(self.base, lote_base())

    def solicitud(self, corte: str = "2026-10-22T10:00:00Z", *, cerrada: bool = False) -> registro.SolicitudEvaluacion:
        """Prepara captura identificada de una edición exacta con reloj explícito.

        Returns:
            Solicitud que el evaluador real debe resolver, sin resultados inyectados.
        """
        oferta = {**OFERTA, "id": "edicion-1"}
        observacion = ficha(fuente={"inscripcion": "Matrícula cerrada"} if cerrada else None)
        observacion["detalle"]["identidad_observada"] = "edicion-1"
        return registro.SolicitudEvaluacion(
            edicion_id="edicion-1", oferta=oferta, observaciones=[observacion], politica=politica(), ahora=corte
        )

    def capturar(self, solicitud: registro.SolicitudEvaluacion, fecha: str, identidad: str) -> None:
        """Asigna una captura sintética nueva sin alterar sus fechas por el corte de evaluación."""
        observacion = solicitud.observaciones[0]
        observacion.update(id=identidad, intentado_el=fecha, terminado_el=fecha)
        for evidencia in observacion["evidencias"]:
            evidencia["capturado_utc"] = fecha

    def filas(self, tabla: str) -> list[tuple]:
        """Lee tablas propias para cotejo de atomicidad e historia.

        Returns:
            Filas en orden de su identidad persistida.
        """
        with sqlite3.connect(self.base) as conexion:
            return conexion.execute("SELECT * FROM " + tabla + " ORDER BY id").fetchall()

    def test_lectura_sin_catalogo_o_evaluacion_no_inventa_ocultas(self) -> None:
        """Ausencia y desconocido son explícitos, sin contador ficticio o publicación."""
        ausente = self.base.with_name("no-existe.sqlite")
        self.assertEqual(registro.consultar_edicion(ausente, "edicion-1")["estado_registro"], "no_disponible")
        self.assertFalse(ausente.exists())
        estado = registro.consultar_edicion(self.base, "edicion-1")
        self.assertEqual(estado["estado_registro"], "no_evaluado")
        self.assertIsNone(estado["evaluacion"])
        self.assertEqual(estado["visibilidad_publica"], "sin_confirmacion")
        self.assertIsNone(estado["publicacion_confirmada"])
        self.assertIsNone(estado["proximo_reintento"])

    def test_registro_nace_vacio_y_las_lecturas_no_cambian_negocio_ni_rejuvenecen(self) -> None:
        """El catálogo V10 nace sin evaluaciones; consultar y listar no escriben nada."""
        tablas = ("proveedores", "programas", "ediciones", "ejecuciones", "evidencias", "versiones")
        antes = {t: self.filas(t) for t in tablas}
        contenido, fecha = self.base.read_bytes(), self.base.stat().st_mtime_ns
        registro.consultar_edicion(self.base, "edicion-1")
        registro.listar_ediciones(self.base)
        registro.historial_decisiones(self.base, "edicion-1")
        self.assertEqual({t: self.filas(t) for t in tablas}, antes)
        self.assertEqual((self.base.read_bytes(), self.base.stat().st_mtime_ns), (contenido, fecha))
        self.assertEqual(self.filas("evaluaciones_vigencia"), [])
        self.assertEqual(self.filas("cambios_decision_vigencia"), [])

    def test_herramientas_del_catalogo_conservan_v10_y_su_registro(self) -> None:
        """Buscar, resumen e importación mantienen el registro y la versión del catálogo."""
        registro.registrar_evaluacion(self.base, self.solicitud())
        anteriores = self.filas("evaluaciones_vigencia")
        catalogo.cargar_lote(self.base, lote_base())
        self.assertEqual(len(catalogo.buscar(self.base, "Python")), 1)
        self.assertEqual(catalogo.resumen(self.base)["ediciones"], 1)
        self.assertEqual(self.filas("evaluaciones_vigencia"), anteriores)
        with sqlite3.connect(self.base) as conexion:
            self.assertEqual(conexion.execute("PRAGMA user_version").fetchone()[0], catalogo.VERSION_SQLITE_CONTENIDOS)

    def test_registra_calculo_real_y_repeticion_es_idempotente(self) -> None:
        """El mismo corte conserva ID, filas, fecha de registro y soportes originales."""
        solicitud = self.solicitud()
        original = deepcopy(solicitud.observaciones)
        primera = registro.registrar_evaluacion(self.base, solicitud)
        estado = registro.consultar_edicion(self.base, "edicion-1")
        filas = self.filas("evaluaciones_vigencia"), self.filas("cambios_decision_vigencia")
        segunda = registro.registrar_evaluacion(self.base, solicitud)
        self.assertEqual(primera["evaluacion_id"], segunda["evaluacion_id"])
        self.assertTrue(segunda["repetida"])
        self.assertEqual((self.filas("evaluaciones_vigencia"), self.filas("cambios_decision_vigencia")), filas)
        self.assertEqual(registro.consultar_edicion(self.base, "edicion-1"), estado)
        self.assertEqual(solicitud.observaciones, original)
        self.assertEqual(estado["evaluacion"]["resultado"]["estado"], "disponible-publicamente")
        self.assertEqual(estado["evaluacion"]["entradas"]["observaciones"], original)
        self.assertEqual(estado["evaluacion"]["evaluador"]["sha256"], registro.firma_evaluador()["sha256"])

    def test_corte_repetido_en_conflicto_se_rechaza_sin_borrar_historia(self) -> None:
        """La misma identidad temporal no permite sustituir entrada, política o resultado."""
        registro.registrar_evaluacion(self.base, self.solicitud())
        anteriores = self.filas("evaluaciones_vigencia"), self.filas("cambios_decision_vigencia")
        with self.assertRaisesRegex(registro.ErrorRegistroVigencia, "conflicto"):
            registro.registrar_evaluacion(self.base, self.solicitud(cerrada=True))
        self.assertEqual((self.filas("evaluaciones_vigencia"), self.filas("cambios_decision_vigencia")), anteriores)

    def test_evaluacion_antigua_tardia_no_desplaza_actual(self) -> None:
        """Se conserva el cálculo histórico sin reabrir una decisión más nueva."""
        reciente = self.solicitud("2026-10-22T12:00:00Z", cerrada=True)
        self.capturar(reciente, "2026-10-22T11:00:00Z", "cierre")
        registro.registrar_evaluacion(self.base, reciente)
        nueva = registro.consultar_edicion(self.base, "edicion-1")
        antigua = registro.registrar_evaluacion(self.base, self.solicitud())
        self.assertFalse(antigua["actual"])
        self.assertEqual(registro.consultar_edicion(self.base, "edicion-1"), nueva)
        self.assertEqual(len(self.filas("evaluaciones_vigencia")), 2)
        self.assertEqual(len(self.filas("cambios_decision_vigencia")), 1)

    def test_diario_solo_decisiones_no_inventa_ocultacion_o_reaparicion(self) -> None:
        """Un corte nuevo igual no duplica transición; cierre y vuelta no afirman publicación."""
        observaciones = []
        for hora, cerrada in ((10, False), (11, False), (12, True), (13, False)):
            solicitud = self.solicitud(f"2026-10-22T{hora}:00:00Z", cerrada=cerrada)
            self.capturar(solicitud, f"2026-10-22T{hora - 1:02}:00:00Z", f"captura-{hora}")
            observaciones.extend(solicitud.observaciones)
            solicitud.observaciones[:] = deepcopy(observaciones)
            registro.registrar_evaluacion(self.base, solicitud)
        self.assertEqual(len(self.filas("evaluaciones_vigencia")), 4)
        self.assertEqual(len(self.filas("cambios_decision_vigencia")), 3)
        pagina = registro.historial_decisiones(self.base, "edicion-1", limite=2)
        self.assertEqual(len(pagina["cambios"]), 2)
        self.assertIsNotNone(pagina["siguiente"])
        self.assertTrue(all(c["alcance"] == "decision_no_publicacion" for c in pagina["cambios"]))
        siguiente = registro.historial_decisiones(self.base, "edicion-1", limite=2, antes_de=pagina["siguiente"])
        self.assertEqual(len(siguiente["cambios"]), 1)
        self.assertIsNone(siguiente["siguiente"])
        self.assertEqual(registro.consultar_edicion(self.base, "edicion-1")["visibilidad_publica"], "sin_confirmacion")

    def test_ficha_identificada_cerrada_no_es_disponibilidad_confirmada(self) -> None:
        """comprobado_el puede existir en un cierre; el registro no lo renombra como oferta abierta."""
        registro.registrar_evaluacion(self.base, self.solicitud(cerrada=True))
        resultado = registro.consultar_edicion(self.base, "edicion-1")["evaluacion"]["resultado"]
        self.assertEqual(resultado["estado"], "no-disponible-publicamente")
        self.assertIsNotNone(resultado["comprobado_el"])
        self.assertNotIn("ultima_disponibilidad_confirmada", resultado)

    def test_fallo_en_diario_revierte_evaluacion_entera(self) -> None:
        """Una excepción SQL después del primer INSERT no deja evaluación sin su transición."""
        with sqlite3.connect(self.base) as conexion:
            conexion.execute(
                "CREATE TRIGGER fallo_diario BEFORE INSERT ON cambios_decision_vigencia "
                "BEGIN SELECT RAISE(ABORT,'fallo simulado'); END"
            )
        with self.assertRaises(catalogo.ErrorCatalogo):
            registro.registrar_evaluacion(self.base, self.solicitud())
        self.assertEqual(self.filas("evaluaciones_vigencia"), [])
        self.assertEqual(self.filas("cambios_decision_vigencia"), [])

    def test_no_admite_programa_o_prefijo_como_identidad_de_edicion(self) -> None:
        """La relación exacta existe en SQLite y en oferta.id, no por coincidencia de título."""
        for edicion_id in ("programa-1", "otro:edicion-1"):
            solicitud = self.solicitud()
            alterada = registro.SolicitudEvaluacion(
                edicion_id=edicion_id,
                oferta=solicitud.oferta,
                observaciones=solicitud.observaciones,
                politica=solicitud.politica,
                ahora=solicitud.ahora,
            )
            with self.assertRaises(registro.ErrorRegistroVigencia):
                registro.registrar_evaluacion(self.base, alterada)
        self.assertEqual(self.filas("evaluaciones_vigencia"), [])

    def test_cambio_negocio_no_reutiliza_evaluacion_anterior_como_actual(self) -> None:
        """La identidad se conserva, pero el cambio de edición requiere nueva evaluación."""
        registro.registrar_evaluacion(self.base, self.solicitud())
        lote = lote_base()
        lote["ediciones"][0]["datos"]["fecha_inicio"] = "2026-12-01"
        lote["observado_utc"] = "2026-10-23T08:00:00Z"
        catalogo.cargar_lote(self.base, lote)
        estado = registro.consultar_edicion(self.base, "edicion-1")
        self.assertEqual(estado["estado_registro"], "no_evaluado")
        self.assertIsNotNone(estado["evaluacion"])
        fila = registro.listar_ediciones(self.base)["ediciones"][0]
        self.assertEqual(fila["estado_registro"], "no_evaluado")
        self.assertEqual(fila["evaluacion"], estado["evaluacion"])

    def test_cambio_evaluador_conserva_historia_pero_exige_revalidar(self) -> None:
        """Una función nueva no convierte la evaluación antigua en un cálculo actual."""
        registro.registrar_evaluacion(self.base, self.solicitud())
        firma = registro.firma_evaluador()
        nueva = {**firma, "sha256": "f" * 64}
        with patch.object(registro, "firma_evaluador", return_value=nueva):
            estado = registro.consultar_edicion(self.base, "edicion-1")
            fila = registro.listar_ediciones(self.base)["ediciones"][0]
        self.assertEqual(fila["evaluacion"], estado["evaluacion"])
        self.assertEqual(fila["estado_registro"], "no_evaluado")
        self.assertEqual(estado["estado_registro"], "no_evaluado")
        self.assertEqual(estado["motivo"], "evaluador_modificado_requiere_evaluacion")
        self.assertEqual(estado["evaluacion"]["evaluador"]["sha256"], firma["sha256"])

    def test_metadatos_de_fila_alterados_se_rechazan(self) -> None:
        """La huella de edición en columna también tiene que coincidir con el registro íntegro."""
        registro.registrar_evaluacion(self.base, self.solicitud())
        with sqlite3.connect(self.base) as conexion, self.assertRaises(sqlite3.IntegrityError):
            conexion.execute("UPDATE evaluaciones_vigencia SET huella_edicion=?", ("f" * 64,))
        with sqlite3.connect(self.base) as conexion:
            conexion.execute("PRAGMA ignore_check_constraints=ON")
            conexion.execute("UPDATE evaluaciones_vigencia SET huella_edicion=?", ("f" * 64,))
        with self.assertRaises(registro.ErrorRegistroVigencia):
            registro.consultar_edicion(self.base, "edicion-1")

    def test_diario_no_mezcla_evaluaciones_de_otra_edicion(self) -> None:
        """Un enlace SQL corrupto no puede enseñar el historial de una edición diferente."""
        registro.registrar_evaluacion(self.base, self.solicitud())
        lote = lote_base()
        lote["ediciones"] = [{**lote["ediciones"][0], "id": "edicion-2"}]
        catalogo.cargar_lote(self.base, lote)
        with sqlite3.connect(self.base) as conexion, self.assertRaises(sqlite3.IntegrityError):
            conexion.execute("UPDATE cambios_decision_vigencia SET edicion_id='edicion-2'")
        with sqlite3.connect(self.base) as conexion:
            conexion.execute("PRAGMA ignore_check_constraints=ON")
            conexion.execute("UPDATE cambios_decision_vigencia SET edicion_id='edicion-2'")
        with self.assertRaises(registro.ErrorRegistroVigencia):
            registro.historial_decisiones(self.base, "edicion-2")

    def test_omitir_cierre_posterior_no_reabre_al_evaluar_captura_antigua(self) -> None:
        """Un corte nuevo no acepta sustituir el conjunto ya conocido por un subconjunto antiguo."""
        registro.registrar_evaluacion(self.base, self.solicitud())
        cierre = self.solicitud("2026-10-22T12:00:00Z", cerrada=True)
        self.capturar(cierre, "2026-10-22T11:00:00Z", "cierre-11")
        cierre.observaciones.extend(self.solicitud().observaciones)
        registro.registrar_evaluacion(self.base, cierre)
        antes = self.filas("evaluaciones_vigencia"), self.filas("cambios_decision_vigencia")
        with self.assertRaisesRegex(registro.ErrorRegistroVigencia, "continuidad"):
            registro.registrar_evaluacion(self.base, self.solicitud("2026-10-22T13:00:00Z"))
        self.assertEqual((self.filas("evaluaciones_vigencia"), self.filas("cambios_decision_vigencia")), antes)
        self.assertEqual(
            registro.consultar_edicion(self.base, "edicion-1")["evaluacion"]["resultado"]["estado"],
            "no-disponible-publicamente",
        )

    def test_id_observacion_no_puede_cambiar_sus_bytes_en_otro_corte(self) -> None:
        """La misma captura no adquiere otro contenido al cambiar el reloj de evaluación."""
        registro.registrar_evaluacion(self.base, self.solicitud())
        with self.assertRaisesRegex(registro.ErrorRegistroVigencia, "conflicto"):
            registro.registrar_evaluacion(self.base, self.solicitud("2026-10-22T11:00:00Z", cerrada=True))
        self.assertEqual(len(self.filas("evaluaciones_vigencia")), 1)

    def test_listado_pagina_y_cobertura_no_oculta_ediciones_no_evaluadas(self) -> None:
        """La colección incluye falta de evaluación; sus cifras no representan oferta publicada."""
        registro.registrar_evaluacion(self.base, self.solicitud())
        lote = lote_base()
        lote["ediciones"] = [{**lote["ediciones"][0], "id": "edicion-2"}]
        catalogo.cargar_lote(self.base, lote)
        pagina = registro.listar_ediciones(self.base, limite=1)
        self.assertEqual(pagina["cobertura"]["total_ediciones"], 2)
        self.assertEqual(pagina["cobertura"]["sin_evaluacion"], 1)
        self.assertEqual(pagina["ediciones"][0]["edicion_id"], "edicion-1")
        otra = registro.listar_ediciones(
            self.base, limite=1, despues_de=pagina["siguiente"], revision_esperada=pagina["revision"]
        )
        self.assertEqual(otra["ediciones"][0]["estado_registro"], "no_evaluado")
        self.assertIsNone(otra["siguiente"])
        self.assertNotIn("ocultas", pagina["cobertura"])
        ausente = registro.listar_ediciones(self.base.with_name("ausente.sqlite"))
        self.assertIsNone(ausente["cobertura"])
        self.assertIsNone(ausente["ediciones"])

    def test_continuacion_de_lista_exige_misma_revision(self) -> None:
        """Una segunda página no mezcla una edición cambiada después de la primera."""
        primera = registro.listar_ediciones(self.base)
        registro.registrar_evaluacion(self.base, self.solicitud())
        with self.assertRaisesRegex(registro.ErrorRegistroVigencia, "reiniciar"):
            registro.listar_ediciones(self.base, despues_de="edicion-1", revision_esperada=primera["revision"])
        with self.assertRaises(registro.ErrorRegistroVigencia):
            registro.listar_ediciones(self.base, despues_de="edicion-1")
        self.assertNotEqual(registro.listar_ediciones(self.base)["revision"], primera["revision"])

    def test_archivos_cambian_durante_calculo_no_escribe_evaluacion(self) -> None:
        """El productor exige artefactos congelados a ambos lados del cálculo real."""
        firma = registro.firma_evaluador()
        nueva = {**firma, "sha256": "f" * 64}
        with (
            patch.object(registro, "firma_evaluador", side_effect=[firma, nueva]),
            self.assertRaisesRegex(registro.ErrorRegistroVigencia, "cambió"),
        ):
            registro.registrar_evaluacion(self.base, self.solicitud())
        self.assertEqual(self.filas("evaluaciones_vigencia"), [])

    def test_historia_alterada_no_se_presenta_como_admitida(self) -> None:
        """Una corrupción del resultado rompe integridad en lectura y al intentar escribir otra vez."""
        registro.registrar_evaluacion(self.base, self.solicitud())
        original = self.base.read_bytes()
        for resellar in (False, True):
            with self.subTest(sello_fisico_rehecho=resellar):
                self.base.write_bytes(original)
                with sqlite3.connect(self.base) as conexion:
                    conexion.row_factory = sqlite3.Row
                    fila = conexion.execute("SELECT id,contenido FROM evaluaciones_vigencia").fetchone()
                    contenido = registro.almacen._leer_compartido(conexion, json.loads(fila[1]), None)
                    contenido["registro"]["resultado"]["estado"] = "no-disponible-publicamente"
                    alterado = registro.almacen._guardar_compartido(conexion, contenido, set())
                    conexion.execute(
                        "UPDATE evaluaciones_vigencia SET contenido=? WHERE id=?", (json.dumps(alterado), fila[0])
                    )
                    if resellar:
                        registro.almacen.sellar_evaluacion(conexion, fila[0])
                antes = self.base.read_bytes()
                with self.assertRaises(registro.ErrorRegistroVigencia):
                    registro.consultar_edicion(self.base, "edicion-1")
                with self.assertRaises(registro.ErrorRegistroVigencia):
                    registro.registrar_evaluacion(self.base, self.solicitud("2026-10-22T11:00:00Z"))
                self.assertEqual(self.base.read_bytes(), antes)


if __name__ == "__main__":
    unittest.main()
