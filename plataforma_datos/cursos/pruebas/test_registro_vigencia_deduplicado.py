"""Crecimiento, cronología e integridad del registro de vigencia compacto V10."""

import json
import sqlite3
import tempfile
import unittest
from copy import deepcopy
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest.mock import patch

from plataforma_datos.cursos import catalogo
from plataforma_datos.cursos import registro_vigencia as registro
from plataforma_datos.cursos.pruebas.test_catalogo import lote_base
from plataforma_datos.cursos.pruebas.test_vigencia import OFERTA, ficha, politica
from plataforma_datos.cursos.tipos_json import ObjetoJson


class VigenciaDeduplicadaPruebas(unittest.TestCase):
    """Usa el evaluador real y solo SQLite sintéticas temporales."""

    def setUp(self) -> None:
        """Crea un catálogo V10 de negocio sintético, sin catálogos reales."""
        temporal = tempfile.TemporaryDirectory(prefix="vigencia-deduplicada-")
        self.addCleanup(temporal.cleanup)
        self.base = Path(temporal.name) / "catalogo.sqlite"
        catalogo.cargar_lote(self.base, lote_base())

    def solicitud(self, dia: int, observaciones: list[ObjetoJson]) -> registro.SolicitudEvaluacion:
        """Prepara un corte explícito posterior a las capturas recibidas.

        Returns:
            Solicitud sin modificar los soportes aportados.
        """
        corte = datetime(2026, 10, 22, 9, tzinfo=UTC) + timedelta(days=dia)
        return registro.SolicitudEvaluacion(
            edicion_id="edicion-1",
            oferta={**OFERTA, "id": "edicion-1"},
            observaciones=deepcopy(observaciones),
            politica=politica(),
            ahora=corte.isoformat(),
        )

    def captura(self, dia: int, *, cerrada: bool = False) -> ObjetoJson:
        """Construye una adquisición propia, aunque comparta SHA de cuerpo con otra.

        Returns:
            Captura sintética completa, con ID y fechas originales independientes.
        """
        fecha = (datetime(2026, 10, 22, 8, tzinfo=UTC) + timedelta(days=dia)).isoformat()
        observacion = ficha(
            fecha, identificador=f"captura-{dia}", fuente={"inscripcion": "Matrícula cerrada"} if cerrada else None
        )
        observacion["detalle"]["identidad_observada"] = "edicion-1"
        return observacion

    def test_dos_cortes_se_leen_sin_recalcular_con_revision_y_recepcion_originales(self) -> None:
        """La lectura no evalúa ni escribe; la revisión pública y la fecha de recepción no se renuevan."""
        observaciones = []
        for dia in range(2):
            observaciones.append(self.captura(dia, cerrada=dia == 1))
            registro.registrar_evaluacion(self.base, self.solicitud(dia, list(reversed(observaciones))))
        with sqlite3.connect(self.base) as conexion:
            evaluaciones = conexion.execute(
                "SELECT id,registrado_utc FROM evaluaciones_vigencia ORDER BY id"
            ).fetchall()
            self.assertEqual(
                conexion.execute(
                    "SELECT registrado_utc FROM observaciones_vigencia WHERE observacion_id='captura-0'"
                ).fetchone()[0],
                evaluaciones[0][1],
            )
            self.assertEqual(conexion.execute("SELECT count(*) FROM observaciones_vigencia").fetchone()[0], 2)
            self.assertEqual(
                conexion.execute(
                    "SELECT evaluacion_id,anterior_id FROM cambios_decision_vigencia ORDER BY id"
                ).fetchall(),
                [(evaluaciones[0][0], None), (evaluaciones[1][0], evaluaciones[0][0])],
            )
            conexion.row_factory = sqlite3.Row
            revision_publica = registro._huella(
                {
                    "evaluador": registro.firma_evaluador()["sha256"],
                    "ediciones": [dict(f) for f in registro._metadatos(conexion)],
                }
            )
        datos, fecha = self.base.read_bytes(), self.base.stat().st_mtime_ns
        with patch.object(registro.vigencia, "evaluar_vigencia", side_effect=AssertionError("No recalcular")):
            estado = registro.consultar_edicion(self.base, "edicion-1")
            self.assertEqual(registro.listar_ediciones(self.base)["revision"], revision_publica)
            self.assertEqual(len(registro.historial_decisiones(self.base, "edicion-1")["cambios"]), 2)
        self.assertEqual(estado["evaluacion"]["entradas"]["observaciones"], list(reversed(observaciones)))
        self.assertEqual(estado["evaluacion"]["resultado"]["estado"], "no-disponible-publicamente")
        self.assertEqual((self.base.read_bytes(), self.base.stat().st_mtime_ns), (datos, fecha))

    def test_huella_de_registro_alterada_se_rechaza_sin_escribir(self) -> None:
        """Una evaluación con sello alterado no se lee ni sirve de base para un corte nuevo."""
        observaciones = [self.captura(0)]
        registro.registrar_evaluacion(self.base, self.solicitud(0, observaciones))
        with sqlite3.connect(self.base) as conexion:
            conexion.execute("UPDATE evaluaciones_vigencia SET huella_registro=?", ("f" * 64,))
        antes = self.base.read_bytes()
        with self.assertRaises(registro.ErrorRegistroVigencia):
            registro.consultar_edicion(self.base, "edicion-1")
        with self.assertRaises(registro.ErrorRegistroVigencia):
            registro.registrar_evaluacion(self.base, self.solicitud(1, observaciones))
        self.assertEqual(self.base.read_bytes(), antes)

    def test_64_capturas_y_64_cortes_no_duplican_cuerpos_ni_prefijos(self) -> None:
        """Crece una observación y un delta por captura, no 2080 copias de 64 cuerpos."""
        observaciones = []
        for dia in range(64):
            observaciones.append(self.captura(dia))
            registro.registrar_evaluacion(self.base, self.solicitud(dia, observaciones))
        with sqlite3.connect(self.base) as conexion:
            self.assertEqual(conexion.execute("SELECT count(*) FROM observaciones_vigencia").fetchone()[0], 64)
            self.assertEqual(
                conexion.execute(
                    "SELECT sum(json_array_length(ids)) FROM revisiones_observaciones_vigencia"
                ).fetchone()[0],
                64,
            )
            self.assertTrue(
                all(
                    registro.almacen._leer_compartido(conexion, json.loads(f[0]), None)["formato_registro"]
                    == registro.almacen.FORMATO_UNIDADES
                    for f in conexion.execute("SELECT contenido FROM evaluaciones_vigencia")
                )
            )
        self.assertEqual(
            registro.consultar_edicion(self.base, "edicion-1")["evaluacion"]["entradas"]["observaciones"], observaciones
        )

    def test_sin_capturas_nuevas_reutiliza_revision_y_cuerpo(self) -> None:
        """Reevaluar64cortes conserva una sola adquisición y una sola revisión."""
        observaciones = [self.captura(0)]
        for dia in range(64):
            registro.registrar_evaluacion(self.base, self.solicitud(dia, observaciones))
        with sqlite3.connect(self.base) as conexion:
            for tabla in ("observaciones_vigencia", "revisiones_observaciones_vigencia"):
                self.assertEqual(conexion.execute("SELECT count(*) FROM " + tabla).fetchone()[0], 1)
            self.assertEqual(conexion.execute("SELECT count(*) FROM evaluaciones_vigencia").fetchone()[0], 64)

    def test_orden_y_llegada_tardia_no_reescriben_conjuntos_anteriores(self) -> None:
        """La llegada posterior no se une a otro corte ni altera su orden de entrada."""
        cierre = self.captura(2, cerrada=True)
        registro.registrar_evaluacion(self.base, self.solicitud(2, [cierre]))
        actual = registro.consultar_edicion(self.base, "edicion-1")
        antigua = self.captura(0)
        registro.registrar_evaluacion(self.base, self.solicitud(0, [antigua]))
        self.assertEqual(registro.consultar_edicion(self.base, "edicion-1"), actual)
        with self.assertRaisesRegex(registro.ErrorRegistroVigencia, "continuidad"):
            registro.registrar_evaluacion(self.base, self.solicitud(3, [cierre]))
        registro.registrar_evaluacion(self.base, self.solicitud(3, [cierre, antigua]))
        registro.registrar_evaluacion(self.base, self.solicitud(4, [antigua, cierre]))
        estado = registro.consultar_edicion(self.base, "edicion-1")
        self.assertEqual(estado["evaluacion"]["entradas"]["observaciones"], [antigua, cierre])
        # El cierre posterior manda: ni la captura antigua tardía ni el reloj lo tapan.
        self.assertEqual(estado["evaluacion"]["resultado"]["estado"], "no-disponible-publicamente")
        self.assertEqual(actual["evaluacion"]["entradas"]["observaciones"], [cierre])

    def test_cuerpo_o_revision_alterada_se_rechazan_sin_nuevo_corte(self) -> None:
        """El sello físico protege fechas de recepción, identidad y referencias, no solo resultado."""
        observaciones = [self.captura(0)]
        registro.registrar_evaluacion(self.base, self.solicitud(0, observaciones))
        original = self.base.read_bytes()
        for tabla, cambio in (
            ("observaciones_vigencia", "registrado_utc='2026-12-01T00:00:00Z'"),
            ("revisiones_observaciones_vigencia", "ids=" + repr(json.dumps(["captura-ajena"]))),
            ("revisiones_observaciones_vigencia", "base_id=id"),
        ):
            with self.subTest(tabla=tabla):
                self.base.write_bytes(original)
                with sqlite3.connect(self.base) as conexion:
                    conexion.execute("UPDATE " + tabla + " SET " + cambio)
                with self.assertRaises(registro.ErrorRegistroVigencia):
                    registro.registrar_evaluacion(self.base, self.solicitud(1, observaciones))
        self.base.write_bytes(original)

    def test_fallo_final_no_deja_cuerpos_o_revisiones_huerfanos(self) -> None:
        """La observación nueva y su evaluación pertenecen a la misma transacción."""
        antes = self.base.read_bytes()
        sellar = registro.almacen.sellar_evaluacion

        def fallar(conexion: sqlite3.Connection, identificador: int) -> None:
            sellar(conexion, identificador)
            lectura = registro.consultar_edicion(self.base, "edicion-1")
            self.assertEqual(lectura["estado_registro"], "no_evaluado")
            self.assertIsNone(lectura["evaluacion"])
            raise registro.ErrorRegistroVigencia("Después de escribir todos los objetos")

        with (
            patch.object(registro.almacen, "sellar_evaluacion", side_effect=fallar),
            self.assertRaises(registro.ErrorRegistroVigencia),
        ):
            registro.registrar_evaluacion(self.base, self.solicitud(0, [self.captura(0)]))
        self.assertEqual(self.base.read_bytes(), antes)
        with sqlite3.connect(self.base) as conexion:
            for tabla in ("observaciones_vigencia", "revisiones_observaciones_vigencia", "evaluaciones_vigencia"):
                self.assertEqual(conexion.execute("SELECT count(*) FROM " + tabla).fetchone()[0], 0)

    def test_tamper_resultado_antiguo_no_actual_bloquea_nuevo_registro(self) -> None:
        """La continuidad conserva la guarda de toda historia sin expandir sus listas."""
        observaciones = [self.captura(0)]
        registro.registrar_evaluacion(self.base, self.solicitud(0, observaciones))
        registro.registrar_evaluacion(self.base, self.solicitud(1, observaciones))
        with sqlite3.connect(self.base) as conexion:
            fila = conexion.execute("SELECT id,contenido FROM evaluaciones_vigencia ORDER BY id LIMIT 1").fetchone()
            contenido = registro.almacen._leer_compartido(conexion, json.loads(fila[1]), None)
            contenido["registro"]["resultado"]["motivos"] = ["alterado"]
            alterado = registro.almacen._guardar_compartido(conexion, contenido, set())
            conexion.execute("UPDATE evaluaciones_vigencia SET contenido=? WHERE id=?", (json.dumps(alterado), fila[0]))
        antes = self.base.read_bytes()
        with self.assertRaises(registro.ErrorRegistroVigencia):
            registro.registrar_evaluacion(self.base, self.solicitud(2, observaciones))
        self.assertEqual(self.base.read_bytes(), antes)
        # Aunque se rehaga el sello físico, el sello lógico delata la alteración al leer la historia.
        with sqlite3.connect(self.base) as conexion:
            conexion.row_factory = sqlite3.Row
            registro.almacen.sellar_evaluacion(conexion, fila[0])
        with self.assertRaisesRegex(registro.ErrorRegistroVigencia, "alterada"):
            registro.historial_decisiones(self.base, "edicion-1")


if __name__ == "__main__":
    unittest.main()
