"""Proyección V9 desde admisión cotidiana: unidades, fechas y privacidad."""

import json
import sqlite3
import unittest
from contextlib import chdir
from copy import deepcopy
from dataclasses import replace
from pathlib import Path
from unittest.mock import patch

from plataforma_datos.comun.entrada_salida import sha256
from plataforma_datos.comun.nucleo import ValidacionFallida
from plataforma_datos.cursos import admision_catalogo as admision
from plataforma_datos.cursos import catalogo, registro_vigencia
from plataforma_datos.cursos import contrato_entrega_catalogo as contrato
from plataforma_datos.cursos import entrega_catalogo as entrega
from plataforma_datos.cursos import seleccion_entrega_catalogo as seleccion
from plataforma_datos.cursos.hechos_entrega_catalogo import proyectar_hechos
from plataforma_datos.cursos.pruebas import test_admision_catalogo as fixtures
from plataforma_datos.cursos.pruebas.test_catalogo import lote_base
from plataforma_datos.cursos.pruebas.test_vigencia import OFERTA, ficha, politica
from plataforma_datos.cursos.pruebas.test_vigencia import catalogo as lectura_catalogo
from plataforma_datos.cursos.pruebas.test_vigencia_fallos import error_http
from plataforma_datos.cursos.referencias_entrega_catalogo import naturalezas
from plataforma_datos.cursos.tipos_json import ObjetoJson
from plataforma_datos.cursos.vigencia import ErrorVigencia, evaluar_vigencia


class EntregaCatalogoPruebas(unittest.TestCase):
    """Solo SQLite y recibos sintéticos propios, sin originales ni investigación V2."""

    def setUp(self) -> None:
        """Admite una copia V9 sin ejecutar ningún importador histórico."""
        self.fixture = fixtures.AdmisionCatalogoPruebas()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.base = self.fixture.caso.base
        self.raiz = self.base.parent
        self.area = self.raiz / "Área privada ñ"
        self.destino = self.raiz / "Entrega pública" / entrega.PUBLICO
        self.construir()

    def construir(self) -> None:
        """Fija el informe actual y un corte de proyección distinto de la captura."""
        solicitud = self.fixture.peticion()
        admision.admitir_snapshot(solicitud)
        self.solicitud = entrega.SolicitudEntrega(
            admision=solicitud,
            instalacion=self.raiz,
            sha256_admision=sha256(solicitud.validacion_destino),
            area=self.area,
            corte_utc="2026-10-23T12:00:00Z",
        )

    def admitir(self) -> ObjetoJson:
        """Prepara y valida realmente el artefacto público.

        Returns:
            DTO público sin originales o disponibilidad inferida.
        """
        entrega.preparar(self.solicitud)
        entrega.validar(self.solicitud)
        return json.loads((self.area / "validado" / entrega.PUBLICO).read_bytes())

    def privado(self) -> ObjetoJson:
        """Lee la proyección factual completa que nunca se exporta como recurso estático público.

        Returns:
            Catálogo privado con estado del registro y causas de retención.
        """
        self.admitir()
        return json.loads((self.area / "validado" / entrega.LINAJE).read_bytes())["catalogo_privado"]

    def confirmar_recurso(self) -> None:
        """Registra una confirmación real sintética y elige un corte dentro de su TTL."""
        registro_vigencia.registrar_unidad(self.base, self.fixture.caso.solicitud())
        self.construir()
        self.solicitud = replace(self.solicitud, corte_utc="2026-10-22T10:30:00Z")

    def test_recurso_y_edicion_sin_evaluacion_conservan_dominios(self) -> None:
        """Una unidad sin evaluación permanece desconocida, no cerrada ni abierta."""
        antes = self.base.read_bytes(), self.base.stat().st_mtime_ns
        publico = self.privado()
        self.assertEqual(publico["schema_version"], contrato.VERSION)
        self.assertEqual(publico["corte_proyeccion_utc"], self.solicitud.corte_utc)
        self.assertEqual(publico["unidades"][0]["id"], publico["ediciones"][0]["id"])
        self.assertEqual(publico["ediciones"][0]["programa_id"], "programa-con-ediciones")
        for grupo, tipo in (("unidades", "recurso"), ("ediciones", "edicion")):
            self.assertEqual(publico[grupo][0]["vigencia"]["motivo"], "sin_evaluacion")
            self.assertIsNone(publico[grupo][0]["vigencia"]["decision_en_corte"])
            self.assertEqual(publico["cobertura"][tipo]["sin_evaluacion"], 1)
        self.assertEqual((self.base.read_bytes(), self.base.stat().st_mtime_ns), antes)
        self.assertEqual(publico["disponibilidad_actual"], "no_determinada")

    def test_material_sin_edicion_no_inventa_unidad_temporal(self) -> None:
        """El catálogo ofrece descripción de material sin fabricar una edición."""
        lote = lote_base()
        lote["observado_utc"] = "2026-10-23T08:00:00Z"
        lote["ediciones"] = []
        lote["programas"][0].update(id="material-2", tipo_unidad="material_autoformacion")
        catalogo.cargar_lote(self.base, lote)
        self.construir()
        publico = self.privado()
        self.assertEqual(len(publico["unidades"]), 3)
        self.assertEqual(len(publico["ediciones"]), 1)
        material = next(u for u in publico["unidades"] if u["id"] == "material-2")
        self.assertEqual(material["tipo_unidad"], "material_autoformacion")
        self.assertEqual(material["vigencia"]["motivo"], "sin_evaluacion")
        self.assertEqual(publico["cobertura"]["recurso"]["total_unidades"], 2)

    def test_url_edicion_es_evaluada_y_no_heredada_del_programa(self) -> None:
        """La URL oficial de esa edición no se sustituye por el índice del programa."""
        solicitud = self.fixture.caso.solicitud("edicion")
        solicitud.oferta["url"] = "https://example.org/edicion-oficial"
        for observacion in solicitud.observaciones:
            observacion["url_consultada"] = solicitud.oferta["url"]
            observacion["detalle"]["url_final"] = solicitud.oferta["url"]
            for evidencia in observacion["evidencias"]:
                evidencia["url"] = solicitud.oferta["url"]
        registro_vigencia.registrar_unidad(self.base, solicitud)
        self.construir()
        publico = self.privado()
        self.assertEqual(publico["ediciones"][0]["vigencia"]["url_oferta_evaluada"], solicitud.oferta["url"])
        self.assertNotEqual(publico["unidades"][0]["url"], solicitud.oferta["url"])
        self.assertIsNone(publico["unidades"][0]["vigencia"]["url_oferta_evaluada"])

    def test_decision_antigua_conserva_corte_fechas_y_url_sin_rejuvenecer(self) -> None:
        """Exportar pasada la revisión interna no recalcula ni rejuvenece el corte anterior."""
        registro_vigencia.registrar_unidad(self.base, self.fixture.caso.solicitud())
        self.construir()
        antes = registro_vigencia.consultar_unidad(self.base, tipo="recurso", id="programa-1")["evaluacion"]
        with patch.object(registro_vigencia.vigencia, "evaluar_vigencia", side_effect=AssertionError("No evaluar")):
            publico = self.privado()
            entrega.exportar(self.solicitud, destino=self.destino)
        dato = publico["unidades"][0]["vigencia"]
        self.assertEqual(dato["decision_en_corte"], antes["resultado"]["estado"])
        self.assertEqual(dato["corte_utc"], antes["corte_utc"])
        for campo in ("cierra_el", "revisar_el", "ultimo_intento_fallido_el"):
            self.assertEqual(dato[campo], antes["resultado"][campo])
        self.assertLess(dato["revisar_el"], publico["corte_proyeccion_utc"])
        self.assertNotIn("vence_el", dato)
        self.assertEqual(dato["comprobado_el"], antes["resultado"]["comprobado_el"])
        self.assertIsNone(dato["publicacion_confirmada"])

    def test_cambio_cuerpo_requiere_admision_y_evaluacion_sin_borrar_historia(self) -> None:
        """La admisión de bytes nuevos no convierte el resultado viejo en vigente."""
        registro_vigencia.registrar_unidad(self.base, self.fixture.caso.solicitud())
        self.construir()
        lote = lote_base()
        lote["observado_utc"] = "2026-10-23T08:00:00Z"
        lote["programas"][0]["datos"]["modalidad"] = "online"
        lote["ediciones"] = []
        catalogo.cargar_lote(self.base, lote)
        with self.assertRaises(admision.ErrorAdmisionCatalogo):
            entrega.preparar(self.solicitud)
        self.construir()
        publico = self.privado()
        dato = publico["unidades"][0]["vigencia"]
        self.assertEqual(dato["motivo"], "recurso_modificado_requiere_evaluacion")
        self.assertEqual(dato["estado_registro"], "no_evaluado")
        self.assertIsNone(dato["url_oferta_evaluada"])
        self.assertIsNotNone(dato["decision_en_corte"])
        self.assertEqual(publico["cobertura"]["recurso"]["historicas_requieren_evaluacion"], 1)

    def test_evaluador_cambiado_se_conserva_como_historia_no_actual(self) -> None:
        """Se respeta el motivo nativo, sin atribuir cierre al cambio de código."""
        registro_vigencia.registrar_unidad(self.base, self.fixture.caso.solicitud())
        self.construir()
        firma = registro_vigencia.firma_evaluador()
        with patch.object(registro_vigencia, "firma_evaluador", return_value={**firma, "sha256": "f" * 64}):
            publico = self.privado()
        dato = publico["unidades"][0]["vigencia"]
        self.assertEqual(dato["motivo"], "evaluador_modificado_requiere_evaluacion")
        self.assertEqual(dato["estado_registro"], "no_evaluado")
        self.assertIsNone(dato["url_oferta_evaluada"])

    def test_repeticion_bytes_mtime_y_fuentes_intactos(self) -> None:
        """El corte explícito permite repetir sin alterar admisión, SQLite ni entrega."""
        self.admitir()
        entrega.exportar(self.solicitud, destino=self.destino)
        archivos = [*self.area.rglob("*.json"), self.destino, self.base, self.solicitud.admision.validacion_destino]
        antes = {p: (p.read_bytes(), p.stat().st_mtime_ns) for p in archivos}
        self.admitir()
        entrega.exportar(self.solicitud, destino=self.destino)
        self.assertEqual({p: (p.read_bytes(), p.stat().st_mtime_ns) for p in archivos}, antes)

    def test_codigo_de_proyeccion_distinto_obliga_a_preparar_de_nuevo(self) -> None:
        """Si cambia el código que proyecta la entrega, exportar se niega hasta preparar y validar de nuevo."""
        self.admitir()
        entrega.exportar(self.solicitud, destino=self.destino)
        antes = self.destino.read_bytes()
        codigo = entrega._codigo()
        cambiado = {**codigo, next(iter(codigo)): "0" * 64}
        with patch.object(entrega, "_codigo", return_value=cambiado):
            with self.assertRaisesRegex(ValidacionFallida, "Admisión desactualizada; preparar y validar de nuevo"):
                entrega.exportar(self.solicitud, destino=self.destino)
            self.assertEqual(self.destino.read_bytes(), antes)
            self.admitir()
            entrega.exportar(self.solicitud, destino=self.destino)

    def test_contrato_cerrado_sin_originales_rutas_evaluacion_o_prosa(self) -> None:
        """El consumidor solo recibe listas factuales y el resumen de decisión autorizado."""
        publico = self.admitir()
        texto = entrega.bytes_json(publico).decode()
        for clave in ("ficha_original", "archivo", "entradas", "trazabilidad", str(self.raiz), "politica"):
            self.assertNotIn(clave, texto)
        privado = self.privado()
        self.assertIsNone(privado["unidades"][0]["hechos"]["requisitos_publicados"]["valor"])
        self.assertIsNone(privado["unidades"][0]["hechos"]["idiomas_material_observado"]["valor"])
        self.assertFalse(publico["derechos"]["redistribuye_contenidos"])
        self.assertIsNone(publico["derechos"]["licencia_contenidos"])

    def test_preparado_alterado_con_checksum_nuevo_no_se_admite(self) -> None:
        """Una suma coherente no sustituye el contraste con la instantánea admitida."""
        self.confirmar_recurso()
        entrega.preparar(self.solicitud)
        ruta = self.area / "preparado" / entrega.PUBLICO
        dato = json.loads(ruta.read_bytes())
        dato["ofertas"][0]["titulo_programa"] = "Sustituido"
        dato["revision"] = entrega.sha256_json({k: v for k, v in dato.items() if k != "revision"})
        ruta.write_bytes(entrega.bytes_json(dato))
        with self.assertRaises(contrato.ErrorEntregaCatalogo):
            entrega.validar(self.solicitud)
        self.assertFalse((self.area / "validado" / "validacion.json").exists())

    def test_admitido_alterado_e_informe_vacio_conservan_destino(self) -> None:
        """No hay promoción parcial si falla un vínculo de la admisión común."""
        self.confirmar_recurso()
        self.admitir()
        entrega.exportar(self.solicitud, destino=self.destino)
        antes = self.destino.read_bytes()
        informe = self.area / "validado" / "validacion.json"
        original = informe.read_bytes()
        informe.write_text('{"estado":"Admitido","controles":[]}', encoding="utf-8")
        with self.assertRaises(ValidacionFallida):
            entrega.exportar(self.solicitud, destino=self.destino)
        informe.write_bytes(original)
        publico = self.area / "validado" / entrega.PUBLICO
        dato = json.loads(publico.read_bytes())
        dato["ofertas"][0]["titulo_programa"] = "Otro"
        dato["revision"] = entrega.sha256_json({k: v for k, v in dato.items() if k != "revision"})
        publico.write_bytes(entrega.bytes_json(dato))
        with self.assertRaises(ValidacionFallida):
            entrega.exportar(self.solicitud, destino=self.destino)
        self.assertEqual(self.destino.read_bytes(), antes)

    def test_frontiera_symlink_hardlink_y_entradas_no_se_escriben(self) -> None:
        """Ningún destino puede ser la instantánea, su informe o una referencia."""
        self.area.mkdir()
        (self.area / "preparado").symlink_to(self.raiz, target_is_directory=True)
        antes = self.base.read_bytes()
        with self.assertRaises(contrato.ErrorEntregaCatalogo):
            entrega.preparar(self.solicitud)
        self.assertEqual(self.base.read_bytes(), antes)
        (self.area / "preparado").unlink()
        self.admitir()
        alias = self.raiz / "alias de entrada.json"
        alias.hardlink_to(self.fixture.procedencia)
        for destino in (
            self.base,
            self.solicitud.admision.validacion_destino,
            self.fixture.procedencia,
            self.area / "validado" / entrega.PUBLICO,
            alias,
        ):
            with self.subTest(destino=destino), self.assertRaises(contrato.ErrorEntregaCatalogo):
                entrega.exportar(self.solicitud, destino=destino)
        self.assertEqual(self.base.read_bytes(), antes)

    def test_interrupcion_reemplazo_preserva_entrega_y_limpia_solo_temporal_propio(self) -> None:
        """Los originales y el destino anterior quedan intactos ante un fallo local."""
        self.admitir()
        self.destino.parent.mkdir()
        self.destino.write_bytes(b"anterior")
        with patch.object(Path, "replace", side_effect=OSError("fallo sintético")), self.assertRaises(OSError):
            entrega.exportar(self.solicitud, destino=self.destino)
        self.assertEqual(self.destino.read_bytes(), b"anterior")
        self.assertEqual(list(self.destino.parent.iterdir()), [self.destino])

    def test_naturaleza_opcional_ligada_a_referencia_no_a_proveedor(self) -> None:
        """Una fecha histórica sigue declarada y su cuerpo derivado no se convierte en HTTP."""
        evidencia = lote_base()["programas"][0]["evidencias"][0]
        mapa = {
            "mapa_acceso": [
                {
                    "catalogo_id": "programa-1",
                    "prueba_principal": evidencia,
                    "soporte": {
                        "canal": "negocio_curso",
                        "fecha_declarada_utc": evidencia["capturado_utc"],
                        "respuesta_http_original_conservada": False,
                    },
                }
            ]
        }
        self.fixture.procedencia.write_text(json.dumps(mapa), encoding="utf-8")
        self.construir()
        self.solicitud = replace(self.solicitud, naturalezas_referencias_id="recepcion-hp")
        publico = self.privado()
        referencia = publico["unidades"][0]["referencias"][0]
        self.assertEqual(referencia["naturaleza_fecha"], "declarada_historica")
        self.assertEqual(referencia["naturaleza_documento"], "derivado_negocio")
        self.assertEqual(referencia["fecha_referencia"], evidencia["capturado_utc"])
        with self.assertRaises(contrato.ErrorEntregaCatalogo):
            entrega.preparar(replace(self.solicitud, naturalezas_referencias_id="ajena"))

    def test_ausencia_naturalezas_y_desconocidos_no_son_bajas_o_gratuidad(self) -> None:
        """Un campo ausente no se interpreta como una declaración negativa."""
        publico = self.privado()
        unidad = publico["unidades"][0]
        self.assertTrue(all(r["naturaleza_fecha"] == "no_acreditada" for r in unidad["referencias"]))
        self.assertIsNone(unidad["hechos"]["coste_formacion_tipo"]["valor"])
        self.assertEqual(unidad["vigencia"]["estado_registro"], "no_evaluado")

    def test_limites_y_corte_anterior_rechazan_antes_de_exportar(self) -> None:
        """No se escoge una evaluación futura como si perteneciese al corte pedido."""
        with patch.object(entrega, "MAX_FILA", 1), self.assertRaises(contrato.ErrorEntregaCatalogo):
            entrega.preparar(self.solicitud)
        with patch.object(entrega, "MAX_PUBLICO", 1), self.assertRaises(contrato.ErrorEntregaCatalogo):
            entrega.preparar(self.solicitud)
        registro_vigencia.registrar_unidad(self.base, self.fixture.caso.solicitud())
        self.construir()
        with self.assertRaises(contrato.ErrorEntregaCatalogo):
            entrega.preparar(replace(self.solicitud, corte_utc="2026-10-21T08:00:00Z"))
        self.assertFalse(self.destino.exists())

    def test_desconocidos_de_contrato_relaciones_y_url_evaluada_no_se_admiten(self) -> None:
        """El DTO público no admite estructura ajena ni URLs de otra unidad."""
        self.confirmar_recurso()
        publico = self.admitir()
        for clave, valor in (("schema_version", 1), ("campo_privado", {})):
            dato = {**deepcopy(publico), clave: valor}
            dato["revision"] = entrega.sha256_json({k: v for k, v in dato.items() if k != "revision"})
            with self.assertRaises(contrato.ErrorEntregaCatalogo):
                contrato.validar_publico(dato)
        dato = deepcopy(publico)
        dato["ofertas"][0]["unidad"]["programa_id"] = "ajeno"
        with self.assertRaises(contrato.ErrorEntregaCatalogo):
            contrato.validar_publico(dato)

    def test_portabilidad_cwd_y_no_dependencia_del_conversor_diario(self) -> None:
        """Los caminos explícitos funcionan en Unicode sin importar la herramienta V2."""
        with chdir(self.raiz):
            self.admitir()
            entrega.exportar(self.solicitud, destino=self.destino)
        fuente = Path(entrega.__file__).read_text(encoding="utf-8")
        self.assertNotIn("convertir_investigacion_v2", fuente)
        self.assertNotIn("EntradasV2", fuente)
        self.assertNotIn(str(self.raiz), self.destino.read_text(encoding="utf-8"))

    def test_salida_publica_no_incluye_ocultas_ni_diagnosticos_del_registro(self) -> None:
        """Una matrícula cerrada permanece explicada solo en la proyección privada."""
        registro_vigencia.registrar_unidad(self.base, self.fixture.caso.solicitud("edicion", cerrada=True))
        self.construir()
        publico = self.admitir()
        texto = entrega.bytes_json(publico).decode()
        self.assertNotIn("estado_registro", texto)
        self.assertNotIn("no-disponible-publicamente", texto)
        self.assertNotIn("sin_evaluacion", texto)

    def test_publico_positivo_dias_despues_conserva_oferta_hechos_y_fechas(self) -> None:
        """Pasada la revisión interna, la misma oferta sigue publicada con sus hechos y fecha real."""
        self.confirmar_recurso()
        publico = self.admitir()
        self.assertEqual(publico["cobertura"], {"recurso": 1, "edicion": 0})
        oferta = publico["ofertas"][0]
        self.assertEqual(oferta["unidad"], {"tipo": "recurso", "id": "programa-1", "programa_id": "programa-1"})
        self.assertEqual(oferta["url"], "https://example.org/formacion/python")
        self.assertIsNone(oferta["hechos"]["acceso_fundae"]["valor"])
        self.assertIsNone(oferta["hechos"]["idiomas_material_observado"]["valor"])
        self.assertIsNone(oferta["cierra_el"])
        self.assertNotIn("vence_el", oferta)
        self.solicitud = replace(self.solicitud, corte_utc="2026-10-26T10:30:00Z")
        tarde = self.admitir()
        self.assertEqual(tarde["cobertura"], {"recurso": 1, "edicion": 0})
        posterior = tarde["ofertas"][0]
        for campo in ("hechos", "referencias", "comprobado_el", "corte_evaluacion_utc", "cierra_el", "url"):
            self.assertEqual(posterior[campo], oferta[campo])
        privado = self.privado()
        retenidas = [r["unidad"] for r in privado["retenciones_publicacion"]]
        self.assertNotIn(oferta["unidad"], retenidas)
        self.assertLess(privado["unidades"][0]["vigencia"]["revisar_el"], "2026-10-26T10:30:00Z")

    def test_404_posterior_publica_incidencia_sin_retirar_la_oferta(self) -> None:
        """Un 404 tras la confirmación mantiene la oferta y publica solo la fecha de la incidencia."""
        solicitud = self.fixture.caso.solicitud()
        caida = deepcopy(solicitud.observaciones[0])
        caida.update(id="enlace-404", intentado_el="2026-10-22T10:00:00Z", terminado_el="2026-10-22T10:00:01Z")
        caida["detalle"].update(
            codigo_http=404, tipo_destino="error", identidad_observada=None, datos_edicion=None, acceso_abierto=None
        )
        caida["evidencias"] = [
            {**caida["evidencias"][0], "alcance": "diagnostico", "capturado_utc": "2026-10-22T10:00:00Z"}
        ]
        solicitud = replace(solicitud, observaciones=[*solicitud.observaciones, caida], ahora="2026-10-22T10:05:00Z")
        registro_vigencia.registrar_unidad(self.base, solicitud)
        self.construir()
        self.solicitud = replace(self.solicitud, corte_utc="2026-10-24T10:00:00Z")
        publico = self.admitir()
        self.assertEqual(publico["cobertura"], {"recurso": 1, "edicion": 0})
        oferta = publico["ofertas"][0]
        self.assertEqual(oferta["incidencia_enlace_el"], "2026-10-22T10:00:01Z")
        self.assertLess(oferta["comprobado_el"], "2026-10-22T10:00:00Z")
        privado = self.privado()["unidades"][0]["vigencia"]
        self.assertEqual(privado["incidencia_enlace"]["tipo"], "no_encontrado")
        self.assertEqual(privado["incidencia_enlace"]["origen"], "ficha")
        self.assertNotIn("no_encontrado", entrega.bytes_json(publico).decode())

    def test_repeticion_tardia_bytes_identicos_sin_rejuvenecer_ni_duplicar_referencias(self) -> None:
        """Repetir la proyección de una oferta antigua da los mismos bytes y referencias únicas."""
        self.confirmar_recurso()
        self.solicitud = replace(self.solicitud, corte_utc="2026-10-26T10:30:00Z")
        primero = self.admitir()
        archivos = sorted(self.area.rglob("*.json"))
        antes = {p: (p.read_bytes(), p.stat().st_mtime_ns) for p in archivos}
        self.assertEqual(self.admitir(), primero)
        self.assertEqual({p: (p.read_bytes(), p.stat().st_mtime_ns) for p in archivos}, antes)
        oferta = primero["ofertas"][0]
        claves = [(r["url"], r["sha256"], r["fecha_referencia"]) for r in oferta["referencias"]]
        self.assertEqual(len(claves), len(set(claves)))
        self.assertLessEqual(oferta["comprobado_el"], oferta["corte_evaluacion_utc"])
        self.assertLess(oferta["corte_evaluacion_utc"], primero["corte_proyeccion_utc"])

    def test_edicion_acreditada_no_pre_publica_programa_como_recurso(self) -> None:
        """R1 evita volver a ofrecer un programa con ediciones por otra vía."""
        registro_vigencia.registrar_unidad(self.base, self.fixture.caso.solicitud("edicion"))
        self.construir()
        self.solicitud = replace(self.solicitud, corte_utc="2026-10-22T10:30:00Z")
        publico = self.admitir()
        self.assertEqual(publico["cobertura"], {"edicion": 1, "recurso": 0})
        self.assertEqual(
            publico["ofertas"][0]["unidad"],
            {"tipo": "edicion", "id": "programa-1", "programa_id": "programa-con-ediciones"},
        )
        privado = self.privado()
        padre = next(u for u in privado["unidades"] if u["id"] == "programa-con-ediciones")
        self.assertIsNone(padre["vigencia"])

    def test_recepcion_nueva_renueva_comprobacion_con_nueva_admision_y_conserva_captura_anterior(self) -> None:
        """La oferta antigua sigue publicada con su fecha; una recepción nueva la renueva sin reescribir el pasado."""
        solicitud = self.fixture.caso.solicitud()
        registro_vigencia.registrar_unidad(self.base, solicitud)
        self.construir()
        previa = self.admitir()["ofertas"]
        self.assertEqual(len(previa), 1)
        self.assertLess(previa[0]["comprobado_el"], "2026-10-23T12:00:00Z")
        anterior = deepcopy(solicitud.observaciones[0])
        nueva = deepcopy(anterior)
        nueva.update(id="recepcion-nueva", intentado_el="2026-10-23T12:00:00Z", terminado_el="2026-10-23T12:00:00Z")
        for evidencia in nueva["evidencias"]:
            evidencia["capturado_utc"] = nueva["intentado_el"]
        solicitud = replace(solicitud, observaciones=[anterior, nueva], ahora="2026-10-23T12:00:01Z")
        registro_vigencia.registrar_unidad(self.base, solicitud)
        with self.assertRaises(admision.ErrorAdmisionCatalogo):
            entrega.exportar(self.solicitud, destino=self.destino)
        self.construir()
        self.solicitud = replace(self.solicitud, corte_utc=solicitud.ahora)
        publico = self.admitir()
        self.assertEqual(len(publico["ofertas"]), 1)
        self.assertEqual(publico["ofertas"][0]["comprobado_el"], nueva["intentado_el"])
        estado = registro_vigencia.consultar_unidad(self.base, tipo="recurso", id="programa-1")
        self.assertEqual(estado["evaluacion"]["entradas"]["observaciones"][0], anterior)

    def test_confirmacion_heredada_insuficiente_no_sale_a_publico(self) -> None:
        """Un resultado viejo disponible no rellena acceso o fechas indispensables ausentes."""
        base_original = self.base.read_bytes()
        for caso in ("acceso", "comprobado", "version_anterior", "restriccion"):
            with self.subTest(caso=caso):
                self.base.write_bytes(base_original)
                solicitud = self.fixture.caso.solicitud()
                if caso == "acceso":
                    ficha = solicitud.observaciones[0]
                    ficha["detalle"]["acceso_abierto"] = None
                    ficha["detalle"]["datos_edicion"] = registro_vigencia.contrato_fichas.normalizar_datos_edicion({})
                if caso == "restriccion":
                    solicitud = self.fixture.caso.solicitud(cerrada=True)
                resultado = registro_vigencia.vigencia.evaluar_vigencia(
                    solicitud.oferta, solicitud.observaciones, solicitud.politica, ahora=solicitud.ahora
                )
                resultado["estado"] = "disponible-publicamente"
                if caso == "comprobado":
                    resultado["comprobado_el"] = None
                if caso == "version_anterior":
                    resultado["schema_version"] = 1
                with patch.object(registro_vigencia.vigencia, "evaluar_vigencia", return_value=resultado):
                    # Se simula un resultado heredado incoherente, no una respuesta remota.
                    # Cada subcaso parte de la misma base sintética sin historia.
                    registro_vigencia.registrar_unidad(self.base, solicitud)
                self.construir()
                self.solicitud = replace(self.solicitud, corte_utc="2026-10-22T11:00:00Z")
                self.assertEqual(self.admitir()["ofertas"], [])
                self.assertTrue(self.privado()["retenciones_publicacion"])

    def test_variantes_anuncios_y_centros_no_se_exportan_sin_procedencia(self) -> None:
        """Las entidades auxiliares permanecen privadas en vez de crear enlaces públicos huérfanos."""
        objetos = {
            "variantes": {"id": "variante-privada", "programa_id": "programa-1", "datos": {}},
            "centros": {"id": "centro-privado", "proveedor_id": "proveedor-1", "nombre": "Centro privado", "datos": {}},
            "anuncios": {
                "id": "anuncio-privado",
                "variante_id": "variante-privada",
                "proveedor_id": "proveedor-1",
                "centro_id": "centro-privado",
                "datos": {},
            },
        }
        with sqlite3.connect(self.base) as conexion:
            for tabla, objeto in objetos.items():
                datos = {
                    **objeto,
                    "datos": catalogo._json(objeto["datos"]),
                    "huella": catalogo.huella(objeto),
                }
                campos = ",".join(datos)
                conexion.execute(
                    "INSERT INTO " + tabla + "(" + campos + ") VALUES (" + ",".join("?" for _ in datos) + ")",
                    tuple(datos.values()),
                )
        self.confirmar_recurso()
        publico = self.admitir()
        for texto in ("variante-privada", "centro-privado", "anuncio-privado"):
            self.assertNotIn(texto, entrega.bytes_json(publico).decode())
        self.assertEqual(len(self.privado()["variantes"]), 1)
        self.assertEqual(len(self.privado()["anuncios"]), 1)


class HechosEntregaCatalogoPruebas(unittest.TestCase):
    """Los campos filtrables no inventan conocimientos, idiomas, coste ni requisitos."""

    def test_campos_declarados_y_observados_separados_y_no_prosa(self) -> None:
        """La ficha en español no acredita que todo el material esté en español."""
        hechos = proyectar_hechos(
            {"idiomas_publicados": ["es"], "requisitos_publicados": "Texto ajeno extenso"}, alcance="unidad"
        )
        self.assertEqual(hechos["idiomas_declarados"]["valor"], ["es"])
        self.assertIsNone(hechos["idiomas_material_observado"]["valor"])
        self.assertEqual(hechos["requisitos_publicados"]["motivo"], "texto_no_redistribuido")

    def test_horas_modalidad_coste_y_moneda_sin_estimacion(self) -> None:
        """Semanas, certificado gratuito y moneda desconocida son dimensiones distintas."""
        datos = {
            "modalidad": "online",
            "horas": "25 horas",
            "coste_formacion_tipo": "gratis_parcial",
            "coste_certificado": {"importe": 40, "moneda": None},
            "costes_publicados": {"certificado_finalizacion_gratuito_declarado": False},
        }
        hechos = proyectar_hechos(datos, alcance="edicion")
        self.assertEqual(hechos["horas_publicadas"]["valor"], 25)
        self.assertEqual(hechos["horas_publicadas"]["unidad"], "h")
        self.assertEqual(hechos["modalidad"]["valor"], "en-linea")
        self.assertEqual(hechos["coste_formacion_tipo"]["valor"], "gratis_parcial")
        self.assertIsNone(hechos["coste_certificado"]["moneda"])
        self.assertFalse(hechos["certificado_gratuito"]["valor"])
        desconocidos = proyectar_hechos({"duracion": "2 semanas"}, alcance="unidad")
        self.assertIsNone(desconocidos["horas_publicadas"]["valor"])
        self.assertIsNone(desconocidos["coste_formacion_tipo"]["valor"])
        self.assertEqual(desconocidos["requisitos_publicados"]["motivo"], "no_consta_en_evidencia")

    def test_variante_conserva_modalidad_normalizada_e_idioma_propio(self) -> None:
        """La variante no pierde hechos por tener nombres de campo propios del productor."""
        hechos = proyectar_hechos(
            {
                "modalidad_normalizada": "en-linea",
                "modalidad_fuente": "Teleformación",
                "idioma_fuente": "Español",
                "horas_publicadas": 50,
            },
            alcance="unidad",
        )
        self.assertEqual(hechos["modalidad"]["valor"], "en-linea")
        self.assertEqual(hechos["idiomas_declarados"]["valor"], ["Español"])
        self.assertEqual(hechos["horas_publicadas"]["valor"], 50)
        contradictoria = proyectar_hechos(
            {"modalidad_normalizada": "en-linea", "modalidad": "presencial"}, alcance="unidad"
        )
        self.assertIsNone(contradictoria["modalidad"]["valor"])
        self.assertEqual(contradictoria["modalidad"]["motivo"], "declaraciones_contradictorias")

    def test_alias_contradictorios_no_usan_otro_fallback(self) -> None:
        """No se declara francés cuando las publicaciones conservadas se contradicen."""
        dato = {
            "idiomas_publicados": ["es"],
            "idiomas": ["en"],
            "hechos_ficha_principal": {"idioma_publicado_ficha": "fr"},
        }
        hecho = proyectar_hechos(dato, alcance="edicion")["idiomas_declarados"]
        self.assertIsNone(hecho["valor"])
        self.assertEqual(hecho["motivo"], "declaraciones_contradictorias")

    def test_idioma_de_ficha_conservado_se_lee_con_la_regla_vigente(self) -> None:
        """Un hecho de ficha guardado con el calendario detrás publica solo el idioma, corto o largo."""
        corto = "Català Data: Dimecres 4 de novembre, 10:00h - 13:00h Inscriure'm"
        largo = (
            "Català Data: Dijous 22 d’octubre, 10:00h - 14:00h Ubicació: Nou Barris Activa - Carrer Vilalba "
            "dels Arcs, 39, BARCELONA Inscriure'm >> Veure més edicions"
        )
        for literal in (corto, largo):
            for dato in (
                {"hechos_ficha_principal": {"idioma_publicado_ficha": literal}},
                {"idioma_ficha_principal": literal},
                {"hechos_ficha_principal": {"idioma_publicado_ficha": literal}, "idioma_ficha_principal": literal},
            ):
                with self.subTest(literal=literal[:30], campos=sorted(dato)):
                    hecho = proyectar_hechos(dato, alcance="edicion")["idiomas_declarados"]
                    self.assertEqual(hecho["valor"], ["Català"])
                    self.assertEqual(hecho["motivo"], "conocido")

    def test_literal_de_idioma_con_rotulo_de_otro_campo_no_se_publica(self) -> None:
        """Un idioma que arrastra otro campo de la ficha queda como no interpretable, nunca tal cual."""
        for dato in (
            {"idioma_publicado": "Català Ubicació: Cibernàrium-22@"},
            {"idiomas_publicados": ["es", "Idioma: Català"]},
            {"hechos_ficha_principal": {"idioma_publicado_ficha": "Data: Dimarts 27 d’octubre"}},
        ):
            with self.subTest(dato=dato):
                hecho = proyectar_hechos(dato, alcance="edicion")["idiomas_declarados"]
                self.assertIsNone(hecho["valor"])
                self.assertEqual(hecho["motivo"], "no_interpretable")

    def test_alias_monetarios_no_sustituyen_importe_y_moneda(self) -> None:
        """Una segunda declaración EUR no borra el precio USD incompatible."""
        for datos, campo in (
            ({"coste_formacion": {"importe": 10, "moneda": "USD"}, "matricula_eur": 999}, "coste_formacion"),
            ({"coste_certificado": {"importe": 25, "moneda": "USD"}, "certificado_coste_eur": 0}, "coste_certificado"),
        ):
            with self.subTest(campo=campo):
                hecho = proyectar_hechos(datos, alcance="edicion")[campo]
                self.assertIsNone(hecho["valor"])
                self.assertIsNone(hecho["moneda"])
                self.assertEqual(hecho["motivo"], "declaraciones_contradictorias")

    def test_alcance_monetario_es_de_origen_no_de_forma_diccionario(self) -> None:
        """Un importe de edición no se convierte en declaración general por ser objeto."""
        hecho = proyectar_hechos({"coste_formacion": {"importe": 80, "moneda": "EUR"}}, alcance="edicion")
        self.assertEqual(hecho["coste_formacion"]["alcance"], "edicion")
        datos = {
            "coste_formacion": {
                "alcance": "Declaración general del catálogo; admisión individual sin comprobar.",
                "importe": 0,
                "moneda": "EUR",
            },
            "costes_publicados": {"formacion": "gratis_formacion"},
        }
        for fuente, alcance in (("fundae:publicador:catalogo:3", "declaracion_general"), ("otra", "edicion")):
            hechos = proyectar_hechos(datos, alcance="edicion", proveedor_id=fuente)
            self.assertEqual(hechos["coste_formacion_tipo"]["alcance"], alcance)
            self.assertEqual(hechos["coste_formacion"]["alcance"], alcance)

    def test_origen_general_explicito_y_alias_exactos(self) -> None:
        """El contexto de proveedor acredita marco general sin reclasificar importes por su forma."""
        datos = {
            "requisitos_publicados": {"registro_previo_para_inscribirse": True},
            "costes_publicados": {"formacion": "gratis_formacion"},
        }
        generales = proyectar_hechos(datos, alcance="edicion", proveedor_id="hp-life")
        self.assertEqual(generales["requiere_registro_previo"]["alcance"], "declaracion_general")
        self.assertEqual(generales["coste_formacion_tipo"]["alcance"], "declaracion_general")
        iguales = proyectar_hechos(
            {
                "idiomas": ["es"],
                "idiomas_publicados": ["es"],
                "coste_formacion": {"importe": 10, "moneda": "EUR"},
                "matricula_eur": 10,
            },
            alcance="edicion",
        )
        self.assertEqual(iguales["idiomas_declarados"]["valor"], ["es"])
        self.assertEqual(iguales["coste_formacion"]["valor"], 10)
        self.assertEqual(iguales["coste_formacion"]["moneda"], "EUR")

    def test_naturaleza_de_referencia_no_se_hereda_por_proveedor(self) -> None:
        """Recibo conservado y negocio derivado son dimensiones distintas de la misma referencia."""
        principal = {"url": "https://example.org/curso", "sha256": "a" * 64, "capturado_utc": "2026-10-22T08:00:00Z"}
        item = {
            "catalogo_id": "hp:1",
            "prueba_principal": principal,
            "soporte": {
                "canal": "negocio_curso",
                "recibido_utc": principal["capturado_utc"],
                "respuesta_http_original_conservada": False,
            },
        }
        mapa = naturalezas({"mapa_acceso": [item]})
        clave = ("hp:1", principal["url"], principal["sha256"], principal["capturado_utc"])
        self.assertEqual(
            mapa[clave], {"naturaleza_fecha": "recepcion_conservada", "naturaleza_documento": "derivado_negocio"}
        )
        self.assertNotIn(("hp:1", principal["url"], "b" * 64, principal["capturado_utc"]), mapa)
        self.assertNotIn(("hp:2", *clave[1:]), mapa)

    def test_idiomas_como_conjunto_no_conflicto_por_orden_o_repeticion(self) -> None:
        """Solo las lenguas se comparan como conjunto de literales, sin traducir códigos."""
        datos = {"idiomas_publicados": ["es", "ca", "es"], "idiomas": ["ca", "es"]}
        idiomas = proyectar_hechos(datos, alcance="unidad")["idiomas_declarados"]
        self.assertEqual(idiomas["valor"], ["ca", "es"])
        self.assertEqual(idiomas["motivo"], "conocido")
        distinto = proyectar_hechos({"idiomas_publicados": ["es"], "idiomas": ["Español"]}, alcance="unidad")[
            "idiomas_declarados"
        ]
        self.assertIsNone(distinto["valor"])
        self.assertEqual(distinto["motivo"], "declaraciones_contradictorias")

    def test_acceso_marca_niveles_y_calendarios_no_tienen_default_inventado(self) -> None:
        """La ausencia de soporte normalizado queda explícita en dimensiones de acceso."""
        hechos = proyectar_hechos({}, alcance="edicion")
        for campo in (
            "acceso_fundae",
            "marca_comercial",
            "nivel_entrada",
            "nivel_salida",
            "calendario_matricula",
            "calendario_formacion",
            "calendario_aula",
        ):
            self.assertIsNone(hechos[campo]["valor"])
            self.assertEqual(hechos[campo]["motivo"], "sin_soporte_de_campo")
            self.assertEqual(hechos[campo]["alcance"], "edicion")

    def test_esquema_y_guardas_comparten_lista_cerrada(self) -> None:
        """El esquema documentado contiene exactamente la lista pública implementada."""
        esquema = json.loads(entrega.ESQUEMA.read_bytes())
        self.assertFalse(esquema["additionalProperties"])
        for nombre, campos in contrato.CAMPOS_COLECCIONES.items():
            definicion = esquema["properties"][nombre]["items"]["$ref"].split("/")[-1]
            self.assertEqual(set(esquema["$defs"][definicion]["required"]), set(campos))
            self.assertFalse(esquema["$defs"][definicion]["additionalProperties"])


class SeleccionYContrato4Pruebas(unittest.TestCase):
    """Resultados de evaluación v2 fabricados: solo un límite publicado retira la oferta."""

    URL = "https://example.org/curso"
    CAPTURA = "2026-10-20T08:00:00Z"

    def privado(self, *, registro_previo: bool | None = True, **estado: object) -> ObjetoJson:
        """Catálogo privado mínimo con una unidad evaluada y un hecho fechado.

        Returns:
            Entrada de selección con la forma del linaje privado.
        """
        condicion = {
            "registro_previo_para_inscribirse": True,
            "alcance": "declaracion_general",
            "vigencia": {"comprobado_el": self.CAPTURA},
        }
        datos = (
            {}
            if registro_previo is None
            else {"requisitos_publicados": {"registro_previo_para_inscribirse": registro_previo}}
        )
        hechos = proyectar_hechos(datos, alcance="unidad", condiciones_actuales={"inscripcion": condicion})
        referencia = {
            "url": self.URL,
            "sha256": "a" * 64,
            "fecha_referencia": self.CAPTURA,
            "alcance": "entidad",
            "naturaleza_fecha": "recepcion_conservada",
            "naturaleza_documento": "no_acreditada",
        }
        vigencia = {
            "estado_registro": "evaluado",
            "motivo": "corte_conservado",
            "decision_en_corte": "disponible-publicamente",
            "corte_utc": "2026-10-20T09:00:00Z",
            "comprobado_el": self.CAPTURA,
            "cierra_el": None,
            "revisar_el": "2026-10-21T08:00:00Z",
            "ultimo_intento_fallido_el": None,
            "incidencia_enlace": None,
            "url_oferta_evaluada": self.URL,
            "publicacion_confirmada": None,
            "soporte_publicacion": None,
            **estado,
        }
        unidad = {
            "id": "p1",
            "proveedor_id": "proveedor-1",
            "titulo": "Curso",
            "tipo_unidad": "curso",
            "url": self.URL,
            "hechos": hechos,
            "referencias": [referencia],
            "evidencia_materia": None,
            "vigencia": vigencia,
        }
        return {
            "unidades": [unidad],
            "ediciones": [],
            "proveedores": [{"id": "proveedor-1", "nombre": "Proveedor"}],
            "derechos": contrato.DERECHOS,
        }

    def test_cierra_el_publicado_retiene_y_nulo_publica(self) -> None:
        """Revisión vencida y fallo no retienen; alcanzar `cierra_el` sí, con motivo propio."""
        corte = "2026-10-30T08:00:00Z"
        for estado, publicadas in (
            ({}, 1),
            ({"ultimo_intento_fallido_el": "2026-10-29T08:00:00Z"}, 1),
            ({"cierra_el": "2026-10-30T08:00:01Z"}, 1),
            ({"cierra_el": corte}, 0),
            ({"cierra_el": "2026-10-25T00:00:00Z"}, 0),
        ):
            with self.subTest(estado=estado):
                privado = self.privado(**estado)
                publico = seleccion.seleccionar(privado, corte)
                contrato.validar_publico(publico)
                self.assertEqual(len(publico["ofertas"]), publicadas)
                if publicadas:
                    oferta = publico["ofertas"][0]
                    self.assertEqual(oferta["cierra_el"], estado.get("cierra_el"))
                    self.assertEqual(oferta["comprobado_el"], self.CAPTURA)
                    self.assertEqual(
                        oferta["hechos"]["requiere_registro_previo"]["vigencia"], {"comprobado_el": self.CAPTURA}
                    )
                    self.assertFalse({"revisar_el", "ultimo_intento_fallido_el", "vence_el"} & set(oferta))
                    self.assertIsNone(oferta["incidencia_enlace_el"])
                else:
                    self.assertEqual(
                        privado["retenciones_publicacion"][0]["motivo"], "limite_publicado_alcanzado_en_corte"
                    )

    def test_incidencia_de_enlace_se_publica_como_aviso_sin_retirar(self) -> None:
        """Un 404 posterior publica solo la fecha de la incidencia; la oferta conserva datos y fecha."""
        incidencia = {"el": "2026-10-20T08:30:00Z", "origen": "ficha", "tipo": "no_encontrado", "codigo_http": 404}
        publico = seleccion.seleccionar(self.privado(incidencia_enlace=incidencia), "2026-10-30T08:00:00Z")
        contrato.validar_publico(publico)
        oferta = publico["ofertas"][0]
        self.assertEqual(oferta["incidencia_enlace_el"], "2026-10-20T08:30:00Z")
        self.assertEqual(oferta["comprobado_el"], self.CAPTURA)
        self.assertNotIn("no_encontrado", json.dumps(publico))

    def test_preinscripciones_exigen_centro_plazo_y_deduplican_solo_entre_las_vigentes(self) -> None:
        """Conserva las identidades privadas y publica el representante vigente de cada convocatoria."""
        privado = self.privado(cierra_el="2026-11-30T23:00:00Z")
        programa = privado["unidades"][0]
        url = "https://experienciafundae.es/ficha-curso/oferta/2/IFCT01"
        programa.update(id="fundae:oferta:programa:IFCT01", proveedor_id="fundae:publicador:catalogo:3", url=url)
        privado["proveedores"][0]["id"] = programa["proveedor_id"]
        ficha = {
            "inicio": "2026-10-01",
            "fin": "2026-11-30",
            "centro": "Centro de muestra",
            "sector": "Intersectorial",
            "colectivos": ["autonomos"],
        }
        for numero, grupo, fin in (
            (17, "b", "2026-11-30T23:00:00Z"),
            (105, "a", "2026-11-30T23:00:00Z"),
            (6, "a", "2026-10-29T23:00:00Z"),
            (10, "a", "2026-11-30T23:00:00Z"),
        ):
            edicion = {
                **programa,
                "id": f"fundae:edicion:{numero}",
                "programa_id": programa["id"],
                "preinscripcion": dict(ficha),
                "equivalencia_difusion": grupo * 64,
                "gratuidad_subvencionada_acreditada": True,
                "tramite_preinscripcion_acreditado": True,
                "vigencia": {**programa["vigencia"], "url_oferta_evaluada": url, "cierra_el": fin},
            }
            privado["ediciones"].append(edicion)
        programa["vigencia"] = None
        corte = "2026-10-30T08:00:00Z"
        publico = seleccion.seleccionar(privado, corte)
        self.assertEqual([o["unidad"]["id"] for o in publico["ofertas"]], ["fundae:edicion:10", "fundae:edicion:17"])
        self.assertEqual(publico["ofertas"][0]["preinscripcion"], ficha)
        self.assertEqual(len(privado["ediciones"]), 4)
        contrato.validar_publico(publico)
        for campo, motivo in (
            ("gratuidad_subvencionada_acreditada", "gratuidad_de_preinscripcion_sin_acreditar"),
            ("tramite_preinscripcion_acreditado", "tramite_de_preinscripcion_sin_acreditar"),
        ):
            for valor in (False, None):
                copia = deepcopy(privado)
                copia["ediciones"][-1][campo] = valor
                ofertas = seleccion.seleccionar(copia, corte)["ofertas"]
                self.assertEqual({o["unidad"]["id"] for o in ofertas}, {"fundae:edicion:105", "fundae:edicion:17"})
                self.assertIn(
                    ("fundae:edicion:10", motivo),
                    [(r["unidad"]["id"], r["motivo"]) for r in copia["retenciones_publicacion"]],
                )
        for cambio in (
            lambda f: f.pop("preinscripcion"),
            lambda f: f["preinscripcion"].update(colectivos=["cualquiera"]),
            lambda f: f["preinscripcion"].update(fin="2026-10-31"),
            lambda f: f["preinscripcion"].update(inicio="2026-11-05"),
            lambda f: f.update(url="https://example.org/otra"),
            lambda f: f["preinscripcion"].update(correo="privado"),
            lambda f: f["preinscripcion"].update(centro="   "),
            lambda f: f["preinscripcion"].update(sector="   "),
        ):
            dato = deepcopy(publico)
            cambio(dato["ofertas"][0])
            dato["revision"] = entrega.sha256_json({k: v for k, v in dato.items() if k != "revision"})
            with self.assertRaises(ValueError):
                contrato.validar_publico(dato)

    def test_evidencia_materia_v5_y_lectura_estricta_v4(self) -> None:
        """La evidencia solo pertenece a su edición y cada captura tiene su propio corte."""
        base = seleccion.seleccionar(self.privado(), "2026-10-30T08:00:00Z")
        oferta = base["ofertas"][0]
        oferta["unidad"] = {"tipo": "edicion", "id": "cibernarium-edicion:2", "programa_id": "cibernarium:1"}
        oferta["proveedor_id"] = "cibernarium"
        base["proveedores"] = [{"id": "cibernarium", "nombre": "Proveedor"}]
        base["cobertura"] = {"recurso": 0, "edicion": 1}
        vinculo = {"url": self.URL, "sha256": "a" * 64, "capturado_utc": self.CAPTURA, "localizador": "activities[0]"}
        oferta["evidencia_materia"] = {
            "version": 1,
            "actividad_id": "3",
            "programa_id": "cibernarium:1",
            "edicion_id": "cibernarium-edicion:2",
            "vinculo": vinculo,
            "contenido": {**vinculo, "metodo": "cibernarium-descripcion-api-v1", "sha256_captura": "b" * 64},
            "censo_ia": {**vinculo, "ambito": "ia"},
            "estado_censo": "parcial",
        }

        def validar(dato: ObjetoJson) -> None:
            dato["revision"] = entrega.sha256_json({k: v for k, v in dato.items() if k != "revision"})
            contrato.validar_publico(dato)

        validar(base)
        historico = deepcopy(base)
        historico["schema_version"] = 4
        del historico["ofertas"][0]["evidencia_materia"]
        validar(historico)
        for url in (
            "http://localhost/captura",
            "http://192.168.1.2/captura",
            "http://[::1]/captura",
            "http://0x7f000001/captura",
            "https://8.8.8.8/captura",
            "https://[2001:4860:4860::8888]/captura",
        ):
            dato = deepcopy(base)
            dato["ofertas"][0]["evidencia_materia"]["vinculo"]["url"] = url
            with self.subTest(url=url), self.assertRaises(ValueError):
                validar(dato)
        for cambiar in (
            lambda d: d["ofertas"][0].update(evidencia_materia=None),
            lambda d: d["ofertas"][0]["evidencia_materia"].update(estado_censo="completo", censo_ia=None),
        ):
            dato = deepcopy(base)
            cambiar(dato)
            validar(dato)
        for cambiar in (
            lambda d: d["ofertas"][0]["evidencia_materia"].update(programa_id="cibernarium:otro"),
            lambda d: d["ofertas"][0]["evidencia_materia"].update(edicion_id="cibernarium-edicion:otra"),
            lambda d: d["ofertas"][0]["evidencia_materia"]["contenido"].update(sha256_captura="z" * 64),
            lambda d: d["ofertas"][0]["evidencia_materia"]["vinculo"].update(capturado_utc="2026-10-31T00:00:00Z"),
            lambda d: d["ofertas"][0]["evidencia_materia"]["contenido"].update(capturado_utc="2026-10-31T00:00:00Z"),
            lambda d: d["ofertas"][0]["evidencia_materia"]["censo_ia"].update(capturado_utc="2026-10-31T00:00:00Z"),
            lambda d: d["ofertas"][0]["evidencia_materia"]["contenido"].update(metodo="otro"),
            lambda d: d["ofertas"][0]["evidencia_materia"]["vinculo"].update(url="file:///tmp/privado"),
            lambda d: d["ofertas"][0]["evidencia_materia"].update(estado_censo="sin-evidencia"),
            lambda d: d["ofertas"][0]["evidencia_materia"].update(descripcion="no redistribuible"),
            lambda d: d["ofertas"][0].pop("evidencia_materia"),
            lambda d: d.update(schema_version=4),
        ):
            dato = deepcopy(base)
            cambiar(dato)
            with self.subTest(dato=dato), self.assertRaises(ValueError):
                validar(dato)

    def test_seleccion_proyecta_evidencia_de_la_edicion_y_es_repetible(self) -> None:
        """La selección conserva exactamente el apoyo admitido, sin prestarlo a otra unidad."""
        privado = self.privado()
        programa = privado["unidades"][0]
        programa.update(id="cibernarium:1", proveedor_id="cibernarium")
        evidencia = {
            "version": 1,
            "actividad_id": "3",
            "programa_id": "cibernarium:1",
            "edicion_id": "cibernarium-edicion:2",
            "vinculo": {"url": self.URL, "sha256": "a" * 64, "capturado_utc": self.CAPTURA, "localizador": "fila"},
            "contenido": None,
            "censo_ia": None,
            "estado_censo": "sin-evidencia",
        }
        privado["ediciones"] = [
            {**programa, "id": "cibernarium-edicion:2", "programa_id": programa["id"], "evidencia_materia": evidencia}
        ]
        privado["proveedores"] = [{"id": "cibernarium", "nombre": "Proveedor"}]
        programa["vigencia"] = None
        primero = seleccion.seleccionar(deepcopy(privado), "2026-10-30T08:00:00Z")
        segundo = seleccion.seleccionar(deepcopy(privado), "2026-10-30T08:00:00Z")
        contrato.validar_publico(primero)
        self.assertEqual(primero, segundo)
        self.assertEqual(primero["ofertas"][0]["evidencia_materia"], evidencia)

    def test_condicion_secundaria_contradicha_no_retira_la_oferta(self) -> None:
        """Un registro contradicho queda desconocido, sin cerrar ni retirar la oferta."""
        publico = seleccion.seleccionar(self.privado(registro_previo=False), "2026-10-30T08:00:00Z")
        contrato.validar_publico(publico)
        self.assertEqual(len(publico["ofertas"]), 1)
        hecho = publico["ofertas"][0]["hechos"]["requiere_registro_previo"]
        self.assertEqual((hecho["valor"], hecho["motivo"]), (None, "declaraciones_contradictorias"))
        self.assertNotIn("vigencia", hecho)

    def test_contrato_fechas_de_oferta_y_hechos(self) -> None:
        """Rechaza `vence_el` y fechas incoherentes; acepta `cierra_el` nulo o futuro."""
        base = seleccion.seleccionar(self.privado(), "2026-10-30T08:00:00Z")
        self.assertEqual(base["schema_version"], contrato.VERSION)
        self.assertIsNone(base["ofertas"][0]["cierra_el"])
        contrato.validar_publico(base)

        def variante(cambio: object) -> ObjetoJson:
            dato = deepcopy(base)
            cambio(dato, dato["ofertas"][0], dato["ofertas"][0]["hechos"]["requiere_registro_previo"])
            dato["revision"] = entrega.sha256_json({k: v for k, v in dato.items() if k != "revision"})
            return dato

        contrato.validar_publico(variante(lambda _d, o, _h: o.update(cierra_el="2026-10-30T08:00:01Z")))
        # La incidencia puede ser del catálogo: anterior a la comprobación de la ficha, igual a ella o igual a la
        # evaluación. Solo se rechaza si es posterior a la evaluación.
        for fecha in ("2026-10-20T07:00:00Z", self.CAPTURA, "2026-10-20T09:00:00Z"):
            with self.subTest(incidencia_aceptada=fecha):
                contrato.validar_publico(variante(lambda _d, o, _h, f=fecha: o.update(incidencia_enlace_el=f)))

        def futuro(_d: ObjetoJson, o: ObjetoJson, h: ObjetoJson) -> None:
            fecha = "2026-10-30T08:00:01Z"
            h["vigencia"]["comprobado_el"] = fecha
            o["referencias"].append({**o["referencias"][0], "fecha_referencia": fecha, "sha256": "b" * 64})

        def retirado(_d: ObjetoJson, _o: ObjetoJson, h: ObjetoJson) -> None:
            h.update(valor=None, motivo="comprobacion_vencida")
            del h["vigencia"]

        rechazos = {
            "vence_el": lambda _d, o, _h: o.update(vence_el="2026-10-31T08:00:00Z"),
            "sin_cierra_el": lambda _d, o, _h: o.pop("cierra_el"),
            "cierra_en_corte": lambda _d, o, _h: o.update(cierra_el="2026-10-30T08:00:00Z"),
            "cierra_no_fecha": lambda _d, o, _h: o.update(cierra_el="pronto"),
            "comprobado_tras_evaluacion": lambda _d, o, _h: o.update(comprobado_el="2026-10-20T09:00:01Z"),
            "evaluacion_tras_proyeccion": lambda _d, o, _h: o.update(corte_evaluacion_utc="2026-10-30T08:00:01Z"),
            "hecho_con_vence": lambda _d, _o, h: h["vigencia"].update(vence_el="2026-10-21T08:00:00Z"),
            "hecho_futuro": futuro,
            "motivo_retirado": retirado,
            "version_3": lambda d, _o, _h: d.update(schema_version=3),
            "sin_incidencia": lambda _d, o, _h: o.pop("incidencia_enlace_el"),
            "incidencia_tras_evaluacion": lambda _d, o, _h: o.update(incidencia_enlace_el="2026-10-20T09:00:01Z"),
        }
        # Las fechas mal formadas se rechazan con el validador común de instantes UTC.
        for nombre, cambio in rechazos.items():
            with self.subTest(nombre=nombre), self.assertRaises((contrato.ErrorEntregaCatalogo, ErrorVigencia)):
                contrato.validar_publico(variante(cambio))


class IncidenciaDeCatalogoDePuntaAPuntaPruebas(unittest.TestCase):
    """Evaluador → selección → validación pública con catálogo requerido: canales independientes."""

    EVALUACION = "2026-10-22T10:00:00Z"

    def publicar(self, observaciones: list[ObjetoJson]) -> tuple[ObjetoJson, ObjetoJson]:
        """Evalúa con el evaluador real, convierte con la entrega real y selecciona y valida el público.

        Returns:
            Resultado del evaluador y oferta pública validada.
        """
        regla = {**politica(), "requiere_catalogo": True, "ttl_catalogo_segundos": 43200}
        resultado = evaluar_vigencia(deepcopy(OFERTA), deepcopy(observaciones), regla, ahora=self.EVALUACION)
        evaluacion = {
            "corte_utc": self.EVALUACION,
            "resultado": resultado,
            "entradas": {"oferta": deepcopy(OFERTA), "observaciones": deepcopy(observaciones), "politica": regla},
        }
        fila = {"estado_registro": "evaluado", "motivo": "corte_conservado", "unidad": {"id": OFERTA["id"]}}
        estado = entrega.estado_interno_de_unidad({**fila, "evaluacion": evaluacion}, self.EVALUACION)
        privado = SeleccionYContrato4Pruebas().privado(**estado)
        privado["unidades"][0].update(id=OFERTA["id"], url=OFERTA["url"])
        for referencia in privado["unidades"][0]["referencias"]:
            referencia["url"] = OFERTA["url"]
        publico = seleccion.seleccionar(privado, self.EVALUACION)
        contrato.validar_publico(publico)
        self.assertEqual(privado["retenciones_publicacion"], [])
        return resultado, publico["ofertas"][0]

    def caida(self, fecha: str) -> ObjetoJson:
        """404 del catálogo requerido en esa fecha.

        Returns:
            Respuesta de catálogo no encontrada.
        """
        observacion = error_http(404, tipo="catalogo", fecha=fecha)
        observacion["id"] = "catalogo-404"
        return observacion

    def test_catalogo_404_anterior_a_la_ficha_publica_ambas_fechas_y_el_aviso(self) -> None:
        """Catálogo 08:00 → catálogo 404 09:00 → ficha válida 09:30 → evaluación 10:00: se publica."""
        observaciones = [
            lectura_catalogo("2026-10-22T08:00:00Z"),
            self.caida("2026-10-22T09:00:00Z"),
            ficha("2026-10-22T09:30:00Z"),
        ]
        resultado, oferta = self.publicar(observaciones)
        self.assertEqual(resultado["estado"], "disponible-publicamente")
        self.assertEqual(resultado["incidencia_enlace"]["origen"], "catalogo")
        self.assertEqual(oferta["comprobado_el"], "2026-10-22T09:30:00Z")
        self.assertEqual(oferta["incidencia_enlace_el"], "2026-10-22T09:00:00Z")
        self.assertEqual(oferta["corte_evaluacion_utc"], self.EVALUACION)

    def test_fechas_iguales_de_incidencia_comprobacion_y_evaluacion(self) -> None:
        """Una incidencia igual a la comprobación de la ficha o igual a la evaluación también se publica."""
        for caida, comprobada in (
            ("2026-10-22T09:30:00Z", "2026-10-22T09:30:00Z"),
            (self.EVALUACION, "2026-10-22T09:30:00Z"),
            (self.EVALUACION, self.EVALUACION),
        ):
            with self.subTest(incidencia=caida, ficha=comprobada):
                observaciones = [lectura_catalogo("2026-10-22T08:00:00Z"), self.caida(caida), ficha(comprobada)]
                resultado, oferta = self.publicar(observaciones)
                self.assertEqual(resultado["estado"], "disponible-publicamente")
                self.assertEqual(oferta["comprobado_el"], comprobada)
                self.assertEqual(oferta["incidencia_enlace_el"], caida)


class FronteraConElLectorWebPruebas(unittest.TestCase):
    """El contrato del productor resuelve los casos compartidos igual que el lector web.

    La misma tabla la ejerce `pruebas/formacion/catalogo-cursos-publico.test.ts` con `leerCatalogo`:
    una entrega que aquí se admitiera y allí no dejaría la página de cursos sin ninguna oferta.
    """

    CARPETA = Path(__file__).resolve().parents[3] / "pruebas" / "fixtures"

    def test_casos_compartidos_con_el_lector_web(self) -> None:
        """Cada caso de la tabla se admite o se rechaza como espera el lector web."""
        base = json.loads((self.CARPETA / "catalogo-cursos-publico.utf8").read_bytes())
        tabla = json.loads((self.CARPETA / "catalogo-cursos-publico-fronteras.json").read_text(encoding="utf-8"))
        for caso in tabla["casos"]:
            with self.subTest(caso=caso["nombre"]):
                dato = deepcopy(base)
                if caso["ruta"]:
                    *camino, ultimo = caso["ruta"]
                    destino = dato
                    for paso in camino:
                        destino = destino[paso]
                    destino[ultimo] = caso["valor"] + "a" * caso.get("relleno", 0)
                dato["revision"] = entrega.sha256_json({k: v for k, v in dato.items() if k != "revision"})
                if caso["admitido"]:
                    contrato.validar_publico(dato)
                else:
                    with self.assertRaises((contrato.ErrorEntregaCatalogo, catalogo.ErrorCatalogo)):
                        contrato.validar_publico(dato)
