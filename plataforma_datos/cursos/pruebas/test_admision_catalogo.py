"""Admisión cotidiana sobre SQLite propia, sin replay ni consultas remotas."""

import hashlib
import json
import shutil
import sqlite3
import unittest
from dataclasses import replace
from pathlib import Path
from unittest.mock import patch

from plataforma_datos.cursos import admision_catalogo as admision
from plataforma_datos.cursos import registro_vigencia as registro
from plataforma_datos.cursos.contrato_entrega_catalogo import ErrorEntregaCatalogo
from plataforma_datos.cursos.fronteras_entrega_catalogo import FronteraEscritura
from plataforma_datos.cursos.pruebas import test_vigencia_unidades as fixtures
from plataforma_datos.cursos.tipos_json import ObjetoJson


class AdmisionCatalogoPruebas(unittest.TestCase):
    """Las entradas, la salida y todas las alteraciones son sintéticas."""

    def setUp(self) -> None:
        """Crea V10 y una referencia de productor separada de la validación."""
        self.caso = fixtures.VigenciaUnidadesPruebas()
        self.caso.setUp()
        self.addCleanup(self.caso.doCleanups)
        self.raiz = self.caso.base.parent
        self.procedencia = self.raiz / "recepción ñ.json"
        self.procedencia.write_text('{"recepcion":"2026-10-22T08:00:00Z"}', encoding="utf-8")
        self.solicitud = self.peticion()

    def referencia(self, ruta: Path) -> admision.ReferenciaArchivo:
        """Fija bytes explícitos, nunca mtime ni un descubrimiento automático.

        Returns:
            Referencia local verificable.
        """
        return admision.ReferenciaArchivo(ruta=ruta, sha256=hashlib.sha256(ruta.read_bytes()).hexdigest())

    def peticion(self) -> admision.SolicitudAdmision:
        """Selecciona un área propia sin depender del directorio de ejecución.

        Returns:
            Solicitud completa de prueba.
        """
        return admision.SolicitudAdmision(
            snapshot=self.referencia(self.caso.base),
            procedencia={"recepcion-hp": self.referencia(self.procedencia)},
            validacion_destino=self.raiz / "salida propia" / "validacion.json",
        )

    def exigir(self) -> ObjetoJson:
        """Lee la admisión vinculada a los bytes exactos del informe.

        Returns:
            Informe admitido.
        """
        return admision.exigir_snapshot_admitido(
            self.solicitud, sha256_validacion=self.referencia(self.solicitud.validacion_destino).sha256
        )

    def test_admite_sin_v2_y_repetir_no_reescribe_ni_rejuvenece(self) -> None:
        """No convierte una unidad no evaluada en oferta ni altera la base."""
        original = self.caso.base.read_bytes(), self.caso.base.stat().st_mtime_ns
        informe = admision.admitir_snapshot(self.solicitud)
        salida = self.solicitud.validacion_destino
        contenido, fecha = salida.read_bytes(), salida.stat().st_mtime_ns
        self.assertEqual(admision.admitir_snapshot(self.solicitud), informe)
        self.assertEqual((salida.read_bytes(), salida.stat().st_mtime_ns), (contenido, fecha))
        self.assertEqual((self.caso.base.read_bytes(), self.caso.base.stat().st_mtime_ns), original)
        self.assertEqual(self.exigir(), informe)
        self.assertEqual(informe["cobertura"]["evaluaciones_vigencia"], 0)
        self.assertIsNone(informe["publicacion_confirmada"])
        self.assertNotIn(str(self.raiz), contenido.decode())

    def test_evaluacion_posterior_requiere_nueva_admision_sin_replay(self) -> None:
        """Añadir evidencia no cambia retrospectivamente el informe anterior."""
        admision.admitir_snapshot(self.solicitud)
        registro.registrar_unidad(self.caso.base, self.caso.solicitud())
        with self.assertRaises(admision.ErrorAdmisionCatalogo):
            self.exigir()
        self.solicitud = self.peticion()
        informe = admision.admitir_snapshot(self.solicitud)
        self.assertEqual(informe["cobertura"]["evaluaciones_vigencia"], 1)
        self.assertEqual(self.exigir(), informe)
        self.assertIsNone(informe["publicacion_confirmada"])

    def test_base_que_no_es_v10_se_rechaza_sin_escrituras(self) -> None:
        """La admisión no acepta ni convierte una base de otra versión."""
        for version in (8, 9):
            with self.subTest(version=version):
                with sqlite3.connect(self.caso.base) as conexion:
                    conexion.execute(f"PRAGMA user_version={version}")
                solicitud = self.peticion()
                antes = self.caso.base.read_bytes()
                with self.assertRaisesRegex(admision.ErrorAdmisionCatalogo, "V10"):
                    admision.admitir_snapshot(solicitud)
                self.assertEqual(self.caso.base.read_bytes(), antes)
                self.assertFalse(solicitud.validacion_destino.exists())

    def test_tamper_fuente_base_informe_y_codigo_impide_reutilizacion(self) -> None:
        """Aunque no toque consultar por cadencia, la admisión exige las mismas entradas."""
        admision.admitir_snapshot(self.solicitud)
        for ruta in (self.procedencia, self.caso.base, self.solicitud.validacion_destino):
            with self.subTest(ruta=ruta.name):
                anterior = ruta.read_bytes()
                ruta.write_bytes(anterior + b" ")
                with self.assertRaises(admision.ErrorAdmisionCatalogo):
                    self.exigir()
                ruta.write_bytes(anterior)
        with (
            patch.object(admision, "firma_codigo", return_value={"alterado": "f" * 64}),
            self.assertRaises(admision.ErrorAdmisionCatalogo),
        ):
            self.exigir()

    def test_controles_vacios_o_extra_y_version_ajena_no_se_aceptan(self) -> None:
        """La guarda común no basta si el contrato del catálogo no es completo."""
        informe = admision.admitir_snapshot(self.solicitud)
        for cambio in ({"controles": []}, {"schema_version": 2}, {"extra": True}):
            with self.subTest(cambio=cambio):
                self.solicitud.validacion_destino.write_text(json.dumps({**informe, **cambio}), encoding="utf-8")
                with self.assertRaises(admision.ErrorAdmisionCatalogo):
                    self.exigir()

    def test_ftsa_y_cuerpo_nativo_alterados_se_rechazan(self) -> None:
        """Un hash nuevo de archivo no legitima una incoherencia interna."""
        for sentencia in (
            "UPDATE programas_fts SET titulo='Texto sustituido'",
            "UPDATE proveedores SET nombre='Nombre sustituido'",
            "UPDATE programas SET datos='{}'",
        ):
            with self.subTest(sql=sentencia):
                antes = self.caso.base.read_bytes()
                with sqlite3.connect(self.caso.base) as conexion:
                    conexion.execute(sentencia)
                with self.assertRaises((admision.ErrorAdmisionCatalogo, registro.ErrorRegistroVigencia)):
                    admision.admitir_snapshot(self.peticion())
                self.caso.base.write_bytes(antes)

    def test_historia_alterada_no_se_admite_con_hash_nuevo(self) -> None:
        """La auditoría nativa V9 conserva la autoridad sobre evaluaciones históricas."""
        registro.registrar_unidad(self.caso.base, self.caso.solicitud())
        with sqlite3.connect(self.caso.base) as conexion:
            conexion.execute("UPDATE evaluaciones_vigencia SET huella_registro=?", ("f" * 64,))
        with self.assertRaises((admision.ErrorAdmisionCatalogo, registro.ErrorRegistroVigencia)):
            admision.admitir_snapshot(self.peticion())

    def test_wal_diario_pendiente_y_limites_no_se_ignoran(self) -> None:
        """No se abre una base viva ni se intenta recuperarla durante admisión."""
        lateral = self.caso.base.with_name(self.caso.base.name + "-wal")
        lateral.write_bytes(b"pendiente")
        with self.assertRaises(admision.ErrorAdmisionCatalogo):
            admision.admitir_snapshot(self.solicitud)
        lateral.unlink()
        with patch.object(admision, "MAX_SQLITE", 1), self.assertRaises(admision.ErrorAdmisionCatalogo):
            admision.admitir_snapshot(self.solicitud)
        with patch.object(admision, "MAX_ENTRADA", 1), self.assertRaises(admision.ErrorAdmisionCatalogo):
            admision.admitir_snapshot(self.solicitud)

    def test_limite_256_referencias_y_257_rechazada_sin_reemplazo(self) -> None:
        """La cota permite evidencias individuales y nunca descarta el exceso."""
        referencia = self.referencia(self.procedencia)
        entradas = {f"evidencia-{i}": referencia for i in range(256)}
        solicitud = replace(self.solicitud, procedencia=entradas)
        informe = admision.admitir_snapshot(solicitud)
        self.assertEqual(len(informe["procedencia"]), 256)
        antes = solicitud.validacion_destino.read_bytes()
        entradas["evidencia-excesiva"] = referencia
        with self.assertRaisesRegex(admision.ErrorAdmisionCatalogo, "excesiva"):
            admision.admitir_snapshot(solicitud)
        self.assertEqual(solicitud.validacion_destino.read_bytes(), antes)
        esquema = json.loads(admision.ESQUEMA.read_bytes())
        self.assertEqual(esquema["properties"]["procedencia"]["maxProperties"], admision.MAX_REFERENCIAS)

    def test_cota_total_de_bytes_sigue_acumulando_cada_referencia(self) -> None:
        """Más referencias no amplían la cota agregada ni permiten un informe parcial."""
        referencia = self.referencia(self.procedencia)
        solicitud = replace(self.solicitud, procedencia={"primera": referencia, "segunda": referencia})
        with (
            patch.object(admision, "MAX_TOTAL_ENTRADAS", self.procedencia.stat().st_size),
            self.assertRaises(admision.ErrorAdmisionCatalogo),
        ):
            admision.admitir_snapshot(solicitud)
        self.assertFalse(solicitud.validacion_destino.exists())

    def test_destino_y_padres_enlazados_no_escriben_entradas(self) -> None:
        """Se protegen los alias resueltos y duros del archivo de entrada."""
        for destino in (self.caso.base, self.procedencia):
            with self.subTest(destino=destino.name):
                antes = destino.read_bytes()
                with self.assertRaises(admision.ErrorAdmisionCatalogo):
                    admision.admitir_snapshot(replace(self.solicitud, validacion_destino=destino))
                self.assertEqual(destino.read_bytes(), antes)
        enlace = self.raiz / "alias"
        enlace.symlink_to(self.raiz, target_is_directory=True)
        with self.assertRaises(admision.ErrorAdmisionCatalogo):
            admision.admitir_snapshot(replace(self.solicitud, validacion_destino=enlace / "no.json"))
        duro = self.raiz / "duro.json"
        duro.hardlink_to(self.procedencia)
        with self.assertRaises(admision.ErrorAdmisionCatalogo):
            admision.admitir_snapshot(replace(self.solicitud, validacion_destino=duro))
        self.assertFalse((self.raiz / "no.json").exists())

    def test_fronteras_omiten_resolver_ficheros_distintos_y_detectan_un_alias_posterior(self) -> None:
        """Un directorio de salida existente permite comprobar cada archivo regular por identidad."""
        destino = self.solicitud.validacion_destino
        destino.parent.mkdir()
        frontera = FronteraEscritura(area=destino.parent, entradas=(self.procedencia,))
        resolver = Path.resolve
        with patch.object(Path, "resolve", autospec=True, side_effect=resolver) as resoluciones:
            admision._frontera(self.solicitud)
            frontera.comprobar(destino)
            self.assertNotIn(self.procedencia, [llamada.args[0] for llamada in resoluciones.call_args_list])

        destino.hardlink_to(self.procedencia)
        with self.assertRaisesRegex(admision.ErrorAdmisionCatalogo, "Alias duro"):
            admision._frontera(self.solicitud)
        with self.assertRaisesRegex(ErrorEntregaCatalogo, "Alias duro"):
            frontera.comprobar(destino)

        bajo_archivo = self.procedencia / "carpeta ausente" / "salida"
        with self.assertRaisesRegex(admision.ErrorAdmisionCatalogo, "Destino sobre una entrada"):
            admision._frontera(replace(self.solicitud, validacion_destino=bajo_archivo))
        with self.assertRaisesRegex(ErrorEntregaCatalogo, "Escritura sobre entrada"):
            frontera.comprobar(bajo_archivo)

    def test_interrupcion_no_cambia_validacion_anterior_ni_deja_temporal(self) -> None:
        """Un fallo antes del reemplazo conserva la admisión previa byte por byte."""
        admision.admitir_snapshot(self.solicitud)
        anterior = self.solicitud.validacion_destino.read_bytes()
        self.procedencia.write_text('{"otra":"recepcion"}', encoding="utf-8")
        solicitud = self.peticion()
        with (
            patch.object(Path, "replace", side_effect=OSError("Interrupción sintética")),
            self.assertRaises(OSError),
        ):
            admision.admitir_snapshot(solicitud)
        self.assertEqual(self.solicitud.validacion_destino.read_bytes(), anterior)
        self.assertEqual(list(self.solicitud.validacion_destino.parent.iterdir()), [self.solicitud.validacion_destino])

    def test_portabilidad_trasladar_entradas_no_cambia_reporte(self) -> None:
        """La identidad del informe no depende de rutas personales ni del cwd."""
        informe = admision.admitir_snapshot(self.solicitud)
        nueva = self.raiz / "Mis documentos Año 2026"
        nueva.mkdir()
        base = nueva / "otra.sqlite"
        procedencia = nueva / "referencia.json"
        shutil.copyfile(self.caso.base, base)
        shutil.copyfile(self.procedencia, procedencia)
        solicitud = admision.SolicitudAdmision(
            snapshot=self.referencia(base),
            procedencia={"recepcion-hp": self.referencia(procedencia)},
            validacion_destino=nueva / "validacion.json",
        )
        self.assertEqual(admision.admitir_snapshot(solicitud), informe)

    def test_versiones_booleanas_o_flotantes_no_sustituyen_enteros(self) -> None:
        """La igualdad numérica de Python no amplía el contrato JSON."""
        informe = admision.admitir_snapshot(self.solicitud)
        for cambio in ({"schema_version": True}, {"version_sqlite": 10.0}):
            with self.subTest(cambio=cambio):
                self.solicitud.validacion_destino.write_bytes(admision.bytes_json_admision({**informe, **cambio}))
                with self.assertRaises(admision.ErrorAdmisionCatalogo):
                    self.exigir()

    def test_lectura_reutiliza_guardia_comun_sin_repetir_auditoria(self) -> None:
        """Reutilizar exige bytes y controles, sin reevaluar cada unidad."""
        admision.admitir_snapshot(self.solicitud)
        with (
            patch.object(admision, "auditar", side_effect=AssertionError("No repetir auditoría")),
            patch.object(admision, "exigir_admitido", wraps=admision.exigir_admitido) as comun,
        ):
            informe = self.exigir()
        self.assertEqual(comun.call_count, 1)
        self.assertEqual(informe["estado"], "Admitido")

    def test_cambio_entrada_durante_auditoria_no_reemplaza_informe(self) -> None:
        """El rechazo conserva la admisión anterior aunque el archivo siga siendo JSON."""
        informe = admision.admitir_snapshot(self.solicitud)
        anterior = self.solicitud.validacion_destino.read_bytes()
        original = admision.auditar

        def cambiar(base: Path) -> ObjetoJson:
            cobertura = original(base)
            self.procedencia.write_text('{"cambiado":true}', encoding="utf-8")
            return cobertura

        with patch.object(admision, "auditar", side_effect=cambiar), self.assertRaises(admision.ErrorAdmisionCatalogo):
            admision.admitir_snapshot(self.solicitud)
        self.assertEqual(self.solicitud.validacion_destino.read_bytes(), anterior)
        self.assertEqual(json.loads(anterior), informe)

    def test_contrato_cambiado_o_ausente_invalida_admision(self) -> None:
        """El recurso efectivo participa en la firma, no solo una revisión de Git."""
        raiz_codigo = self.raiz / "código portable"
        for relativo in admision.CODIGO:
            destino = raiz_codigo / "plataforma_datos" / relativo
            destino.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(admision.RAIZ / "plataforma_datos" / relativo, destino)
        esquemas = raiz_codigo / "plataforma_datos" / "cursos" / "esquemas"
        esquemas.mkdir()
        for nombre in admision.CONTRATOS:
            shutil.copyfile(admision.ESQUEMA.parent / nombre, esquemas / nombre)
        with (
            patch.object(admision, "RAIZ", raiz_codigo),
            patch.object(admision, "ESQUEMA", esquemas / "admision_catalogo.json"),
        ):
            admision.admitir_snapshot(self.solicitud)
            recurso = esquemas / "registro_unidades_vigencia.json"
            anterior = recurso.read_bytes()
            recurso.write_bytes(anterior + b" ")
            with self.assertRaises(admision.ErrorAdmisionCatalogo):
                self.exigir()
            recurso.unlink()
            with self.assertRaises(FileNotFoundError):
                self.exigir()

    def test_sin_base_procedencia_o_informe_nunca_devuelve_cero(self) -> None:
        """Los errores permanecen visibles, no se convierten en catálogos vacíos."""
        with self.assertRaises(admision.ErrorAdmisionCatalogo):
            admision.admitir_snapshot(replace(self.solicitud, procedencia={}))
        with self.assertRaises(admision.ErrorAdmisionCatalogo):
            admision.exigir_snapshot_admitido(self.solicitud, sha256_validacion="f" * 64)
        self.caso.base.unlink()
        with self.assertRaises(admision.ErrorAdmisionCatalogo):
            admision.admitir_snapshot(self.solicitud)

    def test_esquema_declarativo_concuerda_con_contrato_efectivo(self) -> None:
        """El recurso y las guardas cerradas publican los mismos campos y controles."""
        esquema = json.loads(admision.ESQUEMA.read_bytes())
        informe = admision.admitir_snapshot(self.solicitud)
        self.assertEqual(set(esquema["required"]), set(informe))
        self.assertEqual(set(esquema["properties"]) - {"indices_evidencias"}, set(informe))
        self.assertFalse(esquema["additionalProperties"])
        self.assertEqual(esquema["properties"]["schema_version"]["enum"], [1, 2])
        self.assertEqual(informe["schema_version"], 1)
        for campo in ("tipo", "estado", "version_sqlite", "alcance"):
            self.assertEqual(esquema["properties"][campo]["const"], informe[campo])
        self.assertEqual([c["const"] for c in esquema["properties"]["controles"]["prefixItems"]], informe["controles"])
        self.assertEqual(set(esquema["properties"]["cobertura"]["required"]), set(informe["cobertura"]))

    def test_fts_duplicado_relacion_inexistente_y_diario_no_se_admiten(self) -> None:
        """También se rechazan duplicados exactos y relaciones que SQLite no comprobó al escribir."""
        for sentencia in (
            "INSERT INTO programas_fts(id,titulo,datos) SELECT id,titulo,datos FROM programas_fts",
            "UPDATE ediciones SET programa_id='inexistente'",
        ):
            with self.subTest(sql=sentencia):
                antes = self.caso.base.read_bytes()
                with sqlite3.connect(self.caso.base) as conexion:
                    conexion.execute(sentencia)
                with self.assertRaises((admision.ErrorAdmisionCatalogo, registro.ErrorRegistroVigencia)):
                    admision.admitir_snapshot(self.peticion())
                self.caso.base.write_bytes(antes)
        diario = self.caso.base.with_name(self.caso.base.name + "-journal")
        diario.write_bytes(b"pendiente")
        with self.assertRaises(admision.ErrorAdmisionCatalogo):
            admision.admitir_snapshot(self.peticion())

    def test_admision_de_historia_no_recalcula_resultado_o_renueva_fechas(self) -> None:
        """El evaluador sigue siendo la autoridad que ya guardó ese resultado en su corte."""
        registro.registrar_unidad(self.caso.base, self.caso.solicitud())
        antes = registro.consultar_unidad(self.caso.base, tipo="recurso", id="programa-1")
        with patch.object(registro.vigencia, "evaluar_vigencia", side_effect=AssertionError("No recalcular")):
            admision.admitir_snapshot(self.peticion())
        self.assertEqual(registro.consultar_unidad(self.caso.base, tipo="recurso", id="programa-1"), antes)
