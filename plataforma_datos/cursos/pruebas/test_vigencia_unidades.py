"""Identidad tipada sobre el catálogo V10 sin fabricar ediciones o consultas."""

import sqlite3
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from dataclasses import replace
from pathlib import Path
from unittest.mock import patch

from plataforma_datos.cursos import catalogo
from plataforma_datos.cursos import registro_vigencia as registro
from plataforma_datos.cursos import unidades_vigencia as unidades
from plataforma_datos.cursos.pruebas.test_catalogo import lote_base
from plataforma_datos.cursos.pruebas.test_vigencia import OFERTA, ficha, politica


class VigenciaUnidadesPruebas(unittest.TestCase):
    """Cada caso usa exclusivamente una base sintética propia."""

    def setUp(self) -> None:
        """Prepara recurso y edición de otro programa con el mismo ID en sus dominios."""
        temporal = tempfile.TemporaryDirectory(prefix="unidades Año ñ ")
        self.addCleanup(temporal.cleanup)
        self.base = Path(temporal.name) / "catalogo.sqlite"
        lote = lote_base()
        programa_edicion = deepcopy(lote["programas"][0])
        programa_edicion["id"] = "programa-con-ediciones"
        lote["programas"].append(programa_edicion)
        lote["ediciones"][0]["id"] = "programa-1"
        lote["ediciones"][0]["programa_id"] = programa_edicion["id"]
        catalogo.cargar_lote(self.base, lote)

    def solicitud(
        self, tipo: unidades.TipoUnidad = "recurso", *, cerrada: bool = False
    ) -> registro.SolicitudEvaluacionUnidad:
        """Declara una observación identificada sin cambiar su fecha de captura.

        Returns:
            Petición de prueba para el ID compartido por dos dominios distintos.
        """
        with sqlite3.connect(self.base) as conexion:
            tabla = "ediciones" if tipo == "edicion" else "programas"
            huella = conexion.execute("SELECT huella FROM " + tabla + " WHERE id='programa-1'").fetchone()[0]
        observacion = ficha(fuente={"inscripcion": "Matrícula cerrada"} if cerrada else None)
        oferta = {**OFERTA, "id": "programa-1", "url": "https://example.org/formacion/python"}
        observacion["url_consultada"] = oferta["url"]
        observacion["detalle"].update(identidad_observada=oferta["id"], url_final=oferta["url"])
        for evidencia in observacion["evidencias"]:
            evidencia["url"] = oferta["url"]
        return registro.SolicitudEvaluacionUnidad(
            unidad=registro.UnidadEvaluable(tipo=tipo, id="programa-1", huella=huella),
            oferta=oferta,
            observaciones=[observacion],
            politica=politica(),
            ahora="2026-10-22T10:00:00Z",
        )

    def registrar_edicion(self) -> None:
        """Crea historia previa con la API original de ediciones."""
        solicitud = self.solicitud("edicion")
        registro.registrar_evaluacion(
            self.base,
            registro.SolicitudEvaluacion(
                edicion_id=solicitud.unidad.id,
                oferta=solicitud.oferta,
                observaciones=solicitud.observaciones,
                politica=solicitud.politica,
                ahora=solicitud.ahora,
            ),
        )

    def test_historia_de_ediciones_se_lee_sin_recalcular_ni_reescribir(self) -> None:
        """La historia de la API de ediciones se lee igual por ambas vías, sin evaluar ni escribir."""
        self.registrar_edicion()
        antes = (
            registro.consultar_edicion(self.base, "programa-1"),
            registro.listar_ediciones(self.base),
            registro.historial_decisiones(self.base, "programa-1"),
        )
        contenido, fecha = self.base.read_bytes(), self.base.stat().st_mtime_ns
        with patch.object(registro.vigencia, "evaluar_vigencia", side_effect=AssertionError("No recalcular")):
            self.assertEqual(
                (
                    registro.consultar_edicion(self.base, "programa-1"),
                    registro.listar_ediciones(self.base),
                    registro.historial_decisiones(self.base, "programa-1"),
                ),
                antes,
            )
            tipada = registro.consultar_unidad(self.base, tipo="edicion", id="programa-1")
        self.assertEqual(tipada["evaluacion"], antes[0]["evaluacion"])
        self.assertEqual(tipada["estado_registro"], "evaluado")
        self.assertEqual((self.base.read_bytes(), self.base.stat().st_mtime_ns), (contenido, fecha))
        with sqlite3.connect(self.base) as conexion:
            self.assertEqual(conexion.execute("PRAGMA user_version").fetchone()[0], 10)

    def test_consultar_recurso_sin_evaluar_no_escribe(self) -> None:
        """Un recurso sin historia se declara sin evaluación y la consulta no toca la base."""
        antes = self.base.read_bytes(), self.base.stat().st_mtime_ns
        estado = registro.consultar_unidad(self.base, tipo="recurso", id="programa-1")
        self.assertEqual((estado["estado_registro"], estado["motivo"]), ("no_evaluado", "sin_evaluacion"))
        self.assertIsNone(estado["evaluacion"])
        self.assertEqual(registro.listar_unidades(self.base, tipo="recurso")["unidades"], [estado])
        self.assertEqual((self.base.read_bytes(), self.base.stat().st_mtime_ns), antes)

    def test_id_compartido_no_mezcla_capturas_decisiones_o_coberturas(self) -> None:
        """Recurso abierto y edición de otro programa con el mismo ID conservan historias distintas."""
        registro.registrar_unidad(self.base, self.solicitud("edicion", cerrada=True))
        pagina = registro.listar_ediciones(self.base)
        registro.registrar_unidad(self.base, self.solicitud())
        self.assertEqual(registro.listar_ediciones(self.base), pagina)
        edicion = registro.consultar_unidad(self.base, tipo="edicion", id="programa-1")
        recurso = registro.consultar_unidad(self.base, tipo="recurso", id="programa-1")
        self.assertEqual(edicion["evaluacion"]["schema_version"], 1)
        self.assertEqual(recurso["evaluacion"]["schema_version"], 2)
        self.assertEqual(edicion["evaluacion"]["resultado"]["estado"], "no-disponible-publicamente")
        self.assertEqual(recurso["evaluacion"]["resultado"]["estado"], "disponible-publicamente")
        for tipo in ("edicion", "recurso"):
            lista = registro.listar_unidades(self.base, tipo=tipo)
            self.assertEqual(lista["cobertura"]["total_unidades"], 1)
            self.assertEqual(lista["unidades"][0]["unidad"]["tipo"], tipo)
            historia = registro.historial_unidad(self.base, tipo=tipo, id="programa-1")
            self.assertEqual(len(historia["cambios"]), 1)
            self.assertEqual(
                historia["cambios"][0]["evaluacion"],
                edicion["evaluacion"] if tipo == "edicion" else recurso["evaluacion"],
            )
        with sqlite3.connect(self.base) as conexion:
            self.assertEqual(conexion.execute("SELECT count(*) FROM observaciones_vigencia").fetchone()[0], 2)

    def test_interrupcion_tras_sellar_revierte_sin_commit(self) -> None:
        """También KeyboardInterrupt cierra sin commit después de sellar una evaluación nueva."""
        self.registrar_edicion()
        antes = self.base.read_bytes()
        original = registro.almacen.sellar_evaluacion

        def interrumpir(conexion: sqlite3.Connection, id: int) -> None:
            original(conexion, id)
            raise KeyboardInterrupt

        with (
            patch.object(registro.almacen, "sellar_evaluacion", side_effect=interrumpir),
            self.assertRaises(KeyboardInterrupt),
        ):
            registro.registrar_unidad(self.base, self.solicitud())
        self.assertEqual(self.base.read_bytes(), antes)
        self.assertEqual(registro.consultar_edicion(self.base, "programa-1")["estado_registro"], "evaluado")
        self.assertEqual(
            registro.consultar_unidad(self.base, tipo="recurso", id="programa-1")["motivo"], "sin_evaluacion"
        )

    def test_historia_alterada_y_version_ajena_se_rechazan_sin_escribir(self) -> None:
        """Una historia corrupta o una base que no es V10 no se leen ni admiten registros."""
        self.registrar_edicion()
        with sqlite3.connect(self.base) as conexion:
            conexion.execute("UPDATE observaciones_vigencia SET huella=?", ("f" * 64,))
        antes = self.base.read_bytes()
        with self.assertRaises(registro.ErrorRegistroVigencia):
            registro.consultar_edicion(self.base, "programa-1")
        with self.assertRaises(registro.ErrorRegistroVigencia):
            registro.registrar_unidad(self.base, self.solicitud("edicion"))
        self.assertEqual(self.base.read_bytes(), antes)
        for version in (9, 11):
            with self.subTest(version=version):
                with sqlite3.connect(self.base) as conexion:
                    conexion.execute(f"PRAGMA user_version={version}")
                antes = self.base.read_bytes()
                with self.assertRaisesRegex(catalogo.ErrorCatalogo, "V10"):
                    registro.consultar_unidad(self.base, tipo="recurso", id="programa-1")
                with self.assertRaisesRegex(catalogo.ErrorCatalogo, "Versión de base no admitida"):
                    registro.registrar_unidad(self.base, self.solicitud())
                self.assertEqual(self.base.read_bytes(), antes)

    def test_unidad_inexistente_huella_obsoleta_url_y_tipo_no_se_inventan(self) -> None:
        """La admisión vincula entidad real y contenido exacto dentro de su transacción."""
        buena = self.solicitud()
        casos = [
            replace(buena, unidad=replace(buena.unidad, huella="f" * 64)),
            replace(
                buena,
                unidad=replace(buena.unidad, id="otro:programa-1"),
                oferta={**buena.oferta, "id": "otro:programa-1"},
            ),
            replace(buena, oferta={**buena.oferta, "url": "https://example.org/otra"}),
        ]
        for solicitud in casos:
            with self.subTest(unidad=solicitud.unidad):
                antes = self.base.read_bytes()
                with self.assertRaises(registro.ErrorRegistroVigencia):
                    registro.registrar_unidad(self.base, solicitud)
                self.assertEqual(self.base.read_bytes(), antes)
        with self.assertRaises(registro.ErrorRegistroVigencia):
            registro.UnidadEvaluable(tipo="programa", id="programa-1", huella="a" * 64)
        self.assertEqual(
            registro.consultar_unidad(self.base, tipo="recurso", id="ausente")["motivo"], "unidad_no_identificada"
        )

    def test_checks_rechazan_clave_tipo_destino_y_compatibilidad_ajenos(self) -> None:
        """Las restricciones SQL no permiten dos identidades para una misma clave."""
        registro.registrar_unidad(self.base, self.solicitud())
        for sentencia in (
            "UPDATE unidades_vigencia SET clave='[]'",
            "UPDATE unidades_vigencia SET tipo='programa'",
            "UPDATE unidades_vigencia SET programa_id='ausente'",
            "UPDATE observaciones_vigencia SET edicion_id='programa-1'",
            "UPDATE evaluaciones_vigencia SET edicion_id='programa-1'",
        ):
            with self.subTest(sql=sentencia), sqlite3.connect(self.base) as conexion:
                conexion.execute("PRAGMA foreign_keys=ON")
                with self.assertRaises(sqlite3.IntegrityError):
                    conexion.execute(sentencia)

    def test_fallo_tras_sellar_revierte_unidad_observacion_evaluacion_y_diario(self) -> None:
        """No queda identidad huérfana cuando falla la admisión final."""
        antes = self.base.read_bytes()
        original = registro.almacen.sellar_evaluacion

        def interrumpir(conexion: sqlite3.Connection, id: int) -> None:
            original(conexion, id)
            raise OSError("Fallo sintético final")

        with patch.object(registro.almacen, "sellar_evaluacion", side_effect=interrumpir), self.assertRaises(OSError):
            registro.registrar_unidad(self.base, self.solicitud())
        self.assertEqual(self.base.read_bytes(), antes)

    def test_replay_concurrente_no_duplica_captura_ni_rejuvenece(self) -> None:
        """Dos conexiones serializan la misma recepción en una sola evaluación."""
        solicitud = self.solicitud()
        with ThreadPoolExecutor(max_workers=2) as ejecutor:
            resultados = list(ejecutor.map(lambda _: registro.registrar_unidad(self.base, solicitud), range(2)))
        self.assertEqual(sorted(r["repetida"] for r in resultados), [False, True])
        estado = registro.consultar_unidad(self.base, tipo="recurso", id="programa-1")
        self.assertEqual(estado["evaluacion"]["entradas"]["observaciones"], solicitud.observaciones)
        antes = self.base.read_bytes(), self.base.stat().st_mtime_ns
        self.assertTrue(registro.registrar_unidad(self.base, solicitud)["repetida"])
        self.assertEqual((self.base.read_bytes(), self.base.stat().st_mtime_ns), antes)

    def test_cambio_recurso_conserva_historia_pero_exige_revaluacion(self) -> None:
        """La misma identidad no reutiliza la evaluación de otro contenido."""
        solicitud = self.solicitud()
        registro.registrar_unidad(self.base, solicitud)
        anterior = registro.consultar_unidad(self.base, tipo="recurso", id="programa-1")["evaluacion"]
        lote = lote_base()
        lote["ediciones"] = []
        lote["observado_utc"] = "2026-10-23T08:00:00Z"
        lote["programas"][0]["datos"]["modalidad"] = "online"
        catalogo.cargar_lote(self.base, lote)
        actual = registro.consultar_unidad(self.base, tipo="recurso", id="programa-1")
        self.assertEqual(actual["estado_registro"], "no_evaluado")
        self.assertEqual(actual["motivo"], "recurso_modificado_requiere_evaluacion")
        self.assertEqual(actual["evaluacion"], anterior)
        with self.assertRaises(registro.ErrorRegistroVigencia):
            registro.registrar_unidad(self.base, solicitud)

    def test_paginacion_tipo_e_historia_alterada_se_rechazan(self) -> None:
        """La revisión no se comparte entre dominios ni se rellena al corromper datos."""
        pagina = registro.listar_unidades(self.base, tipo="edicion")
        with self.assertRaises(registro.ErrorRegistroVigencia):
            registro.listar_unidades(
                self.base, tipo="recurso", despues_de="programa-1", revision_esperada=pagina["revision"]
            )
        registro.registrar_unidad(self.base, self.solicitud())
        with sqlite3.connect(self.base) as conexion:
            conexion.execute("UPDATE observaciones_vigencia SET registrado_utc='2027-01-01T00:00:00Z'")
        antes = self.base.read_bytes()
        with self.assertRaises(registro.ErrorRegistroVigencia):
            registro.consultar_unidad(self.base, tipo="recurso", id="programa-1")
        with self.assertRaises(registro.ErrorRegistroVigencia):
            registro.registrar_unidad(self.base, replace(self.solicitud(), ahora="2026-10-22T11:00:00Z"))
        self.assertEqual(self.base.read_bytes(), antes)

    def test_ddl_desconocido_no_se_admite_silenciosamente(self) -> None:
        """Una columna externa no se bendice: lectura y registro la rechazan sin escribir."""
        with sqlite3.connect(self.base) as conexion:
            conexion.execute("ALTER TABLE evaluaciones_vigencia ADD COLUMN ajena TEXT")
        antes = self.base.read_bytes()
        with self.assertRaisesRegex(catalogo.ErrorCatalogo, "Formato V10 no verificable"):
            registro.consultar_unidad(self.base, tipo="recurso", id="programa-1")
        with self.assertRaisesRegex(catalogo.ErrorCatalogo, "Formato V10 no verificable"):
            registro.registrar_unidad(self.base, self.solicitud())
        self.assertEqual(self.base.read_bytes(), antes)

    def test_64_cortes_de_recurso_conservan_una_adquisicion(self) -> None:
        """La evaluación local diaria no duplica evidencia ni se presenta como consulta nueva."""
        from datetime import UTC, datetime, timedelta

        solicitud = self.solicitud()
        for dia in range(64):
            corte = (datetime(2026, 10, 22, 10, tzinfo=UTC) + timedelta(days=dia)).isoformat()
            registro.registrar_unidad(self.base, replace(solicitud, ahora=corte))
        with sqlite3.connect(self.base) as conexion:
            self.assertEqual(conexion.execute("SELECT count(*) FROM observaciones_vigencia").fetchone()[0], 1)
            self.assertEqual(
                conexion.execute("SELECT count(*) FROM revisiones_observaciones_vigencia").fetchone()[0], 1
            )
            self.assertEqual(conexion.execute("SELECT count(*) FROM evaluaciones_vigencia").fetchone()[0], 64)
        estado = registro.consultar_unidad(self.base, tipo="recurso", id="programa-1")
        self.assertEqual(estado["evaluacion"]["entradas"]["observaciones"], solicitud.observaciones)
        resultado = estado["evaluacion"]["resultado"]
        # 63 días sin consulta nueva: la oferta no se retira ni se rejuvenece; solo queda revisión pendiente.
        self.assertEqual(resultado["estado"], "disponible-publicamente")
        self.assertEqual(resultado["comprobado_el"], solicitud.observaciones[0]["evidencias"][0]["capturado_utc"])
        self.assertLess(resultado["revisar_el"], resultado["evaluado_el"])

    def test_adquisiciones_distintas_con_mismo_sha_no_se_funden(self) -> None:
        """La nueva recepción mantiene su ID y hora aunque no cambie el cuerpo remoto."""
        from copy import deepcopy

        primera = self.solicitud()
        registro.registrar_unidad(self.base, primera)
        segunda = deepcopy(primera.observaciones[0])
        segunda.update(id="nueva-recepcion", intentado_el="2026-10-23T08:00:00Z", terminado_el="2026-10-23T08:00:00Z")
        for evidencia in segunda["evidencias"]:
            evidencia["capturado_utc"] = "2026-10-23T08:00:00Z"
        siguiente = replace(primera, observaciones=[*primera.observaciones, segunda], ahora="2026-10-23T09:00:00Z")
        registro.registrar_unidad(self.base, siguiente)
        with sqlite3.connect(self.base) as conexion:
            self.assertEqual(conexion.execute("SELECT count(*) FROM observaciones_vigencia").fetchone()[0], 2)
        estado = registro.consultar_unidad(self.base, tipo="recurso", id="programa-1")
        self.assertEqual(estado["evaluacion"]["entradas"]["observaciones"], siguiente.observaciones)
        self.assertEqual(estado["evaluacion"]["resultado"]["comprobado_el"], "2026-10-23T08:00:00Z")
        with self.assertRaisesRegex(registro.ErrorRegistroVigencia, "continuidad"):
            registro.registrar_unidad(
                self.base, replace(siguiente, observaciones=[segunda], ahora="2026-10-23T10:00:00Z")
            )

    def test_fk_corrupta_de_la_unidad_consultada_sigue_rechazada(self) -> None:
        """La guarda local detecta la relación rota; la admisión completa tampoco la permite."""
        solicitud = self.solicitud()
        registro.registrar_unidad(self.base, solicitud)
        registro.auditar_unidades_vigencia(self.base)
        with sqlite3.connect(self.base) as conexion:
            conexion.execute("PRAGMA ignore_check_constraints=ON")
            conexion.execute("UPDATE unidades_vigencia SET programa_id='ausente'")
        antes = self.base.read_bytes()
        with self.assertRaises(registro.ErrorRegistroVigencia):
            registro.consultar_unidad(self.base, tipo="recurso", id="programa-1")
        with self.assertRaises(registro.ErrorRegistroVigencia):
            registro.registrar_unidad(self.base, solicitud)
        with self.assertRaises(registro.ErrorRegistroVigencia):
            registro.auditar_unidades_vigencia(self.base)
        self.assertEqual(self.base.read_bytes(), antes)

    def test_lectura_no_recorre_unidades_o_fk_de_toda_la_base(self) -> None:
        """Leer el mismo recurso ejecuta igual SQL con una o diecisiete unidades admitidas."""
        from copy import deepcopy

        solicitud = self.solicitud()
        registro.registrar_unidad(self.base, solicitud)
        original = sqlite3.connect
        consultas = []

        def conectar(*args: object, **kwargs: object) -> sqlite3.Connection:
            conexion = original(*args, **kwargs)
            conexion.set_trace_callback(consultas.append)
            return conexion

        with patch.object(sqlite3, "connect", side_effect=conectar):
            registro.consultar_unidad(self.base, tipo="recurso", id="programa-1")
        cantidad = len(consultas)
        lote = lote_base()
        lote["ediciones"] = []
        lote["programas"] = [{**deepcopy(lote["programas"][0]), "id": f"programa-{i}"} for i in range(2, 18)]
        catalogo.cargar_lote(self.base, lote)
        with sqlite3.connect(self.base) as conexion:
            huellas = dict(conexion.execute("SELECT id,huella FROM programas"))
        for programa in lote["programas"]:
            id = programa["id"]
            observaciones = deepcopy(solicitud.observaciones)
            observaciones[0]["detalle"]["identidad_observada"] = id
            registro.registrar_unidad(
                self.base,
                replace(
                    solicitud,
                    unidad=registro.UnidadEvaluable(tipo="recurso", id=id, huella=huellas[id]),
                    oferta={**solicitud.oferta, "id": id},
                    observaciones=observaciones,
                ),
            )
        consultas.clear()
        with patch.object(sqlite3, "connect", side_effect=conectar):
            registro.consultar_unidad(self.base, tipo="recurso", id="programa-1")
        self.assertEqual(len(consultas), cantidad)
        self.assertFalse(any("foreign_key_check" in sql.lower() for sql in consultas))
        self.assertFalse(any("FROM unidades_vigencia" in sql and "WHERE" not in sql for sql in consultas))

    def test_recurso_abierto_se_registra_sin_edicion_ficticia(self) -> None:
        """Un recurso nativo puede evaluarse sin convertirlo en convocatoria."""
        self.base = self.base.with_name("solo-recurso.sqlite")
        lote = lote_base()
        lote["ediciones"] = []
        catalogo.cargar_lote(self.base, lote)
        with sqlite3.connect(self.base) as conexion:
            huella = conexion.execute("SELECT huella FROM programas WHERE id='programa-1'").fetchone()[0]
        observacion = ficha()
        observacion["detalle"]["identidad_observada"] = "programa-1"
        oferta = {**OFERTA, "id": "programa-1", "url": "https://example.org/formacion/python"}
        observacion["url_consultada"] = oferta["url"]
        observacion["detalle"]["url_final"] = oferta["url"]
        for evidencia in observacion["evidencias"]:
            evidencia["url"] = oferta["url"]
        solicitud = registro.SolicitudEvaluacionUnidad(
            unidad=registro.UnidadEvaluable(tipo="recurso", id="programa-1", huella=huella),
            oferta=oferta,
            observaciones=[observacion],
            politica=politica(),
            ahora="2026-10-22T10:00:00Z",
        )
        registro.registrar_unidad(self.base, solicitud)
        estado = registro.consultar_unidad(self.base, tipo="recurso", id="programa-1")
        self.assertEqual(estado["evaluacion"]["resultado"]["estado"], "disponible-publicamente")
        self.assertEqual(estado["evaluacion"]["schema_version"], 2)
        self.assertNotIn("edicion_id", estado)
        self.assertIsNone(estado["publicacion_confirmada"])
        with sqlite3.connect(self.base) as conexion:
            self.assertEqual(conexion.execute("SELECT count(*) FROM ediciones").fetchone()[0], 0)
        self.assertEqual(registro.consultar_edicion(self.base, "programa-1")["motivo"], "edicion_no_identificada")


if __name__ == "__main__":
    unittest.main()
