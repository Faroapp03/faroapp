"""Un fallo de consulta no invalida ni rejuvenece la evidencia anterior."""

import copy
import unittest
from dataclasses import replace
from http import HTTPStatus

from plataforma_datos.cursos import registro_vigencia as registro
from plataforma_datos.cursos.pruebas import test_vigencia_recurso_sin_edicion as recursos
from plataforma_datos.cursos.pruebas.test_vigencia import AHORA, OFERTA, catalogo, fallo, ficha, politica
from plataforma_datos.cursos.tipos_json import ObjetoJson
from plataforma_datos.cursos.vigencia import evaluar_vigencia


def error_http(codigo: int, *, tipo: str = "ficha", fecha: str = "2026-10-22T09:00:00Z") -> ObjetoJson:
    """Representa una respuesta recibida cuyo estado es un fallo técnico, no hechos nuevos del curso.

    Returns:
        Observación admitida por el contrato existente, con diagnóstico localizado.
    """
    constructor = ficha if tipo == "ficha" else catalogo
    observacion = constructor(fecha, identificador=f"error-{tipo}-{codigo}")
    observacion["detalle"].update(codigo_http=int(codigo), tipo_destino="error")
    if tipo == "ficha":
        observacion["detalle"].update(identidad_observada=None, datos_edicion=None, acceso_abierto=None)
    else:
        observacion["detalle"].update(lectura_completa=False, presente=None)
    observacion["evidencias"] = [{**observacion["evidencias"][0], "alcance": "diagnostico"}]
    return observacion


class VigenciaConFallosPruebas(unittest.TestCase):
    """Separa incertidumbre de transporte y hechos de disponibilidad."""

    def test_fallo_conserva_confirmacion_vigente_y_su_diagnostico(self) -> None:
        """La oferta sigue visible y el intento fallido sigue siendo rastreable."""
        observaciones = [ficha(), fallo()]
        originales = copy.deepcopy(observaciones)
        resultado = evaluar_vigencia(OFERTA, observaciones, politica(), ahora=AHORA)
        self.assertEqual(resultado["estado"], "disponible-publicamente")
        self.assertEqual(resultado["comprobado_el"], "2026-10-22T08:00:00Z")
        self.assertEqual(resultado["revisar_el"], "2026-10-23T08:00:00Z")
        self.assertEqual(resultado["ultimo_intento_el"], "2026-10-22T09:00:00Z")
        self.assertEqual(resultado["ultimo_intento_fallido_el"], "2026-10-22T09:00:00Z")
        self.assertIn("fallo-1", resultado["trazabilidad"]["observaciones"])
        self.assertIsNone(resultado["trazabilidad"]["capturas"]["fallo-1"]["comprobado_el"])
        self.assertEqual(observaciones, originales)
        self.assertEqual(resultado, evaluar_vigencia(OFERTA, observaciones[::-1], politica(), ahora=AHORA))
        self.assertEqual(resultado, evaluar_vigencia(OFERTA, observaciones, politica(), ahora=AHORA))

    def test_fallo_no_prolonga_ni_retira_al_pasar_la_revision(self) -> None:
        """Pasada la revisión interna, el fallo no retira ni rejuvenece la última comprobación."""
        resultado = evaluar_vigencia(OFERTA, [ficha(), fallo()], politica(), ahora="2026-10-23T08:00:00Z")
        self.assertEqual(resultado["estado"], "disponible-publicamente")
        self.assertEqual(resultado["comprobado_el"], "2026-10-22T08:00:00Z")
        self.assertEqual(resultado["revisar_el"], "2026-10-23T08:00:00Z")
        self.assertEqual(resultado["ultimo_intento_fallido_el"], "2026-10-22T09:00:00Z")

    def test_fallo_sin_historial_no_acredita_disponibilidad(self) -> None:
        """No se fabrica confirmación donde nunca hubo una."""
        resultado = evaluar_vigencia(OFERTA, [fallo()], politica(), ahora=AHORA)
        self.assertEqual(resultado["estado"], "sin-confirmar")
        self.assertIsNone(resultado["comprobado_el"])

    def test_fallo_posterior_no_resucita_apertura_anterior_a_un_cierre(self) -> None:
        """La última respuesta de la fuente manda sobre una apertura más vieja."""
        cerrada = ficha("2026-10-22T08:30:00Z", identificador="cerrada")
        cerrada["detalle"]["datos_edicion"]["estado_inscripcion"] = "cerrada"
        resultado = evaluar_vigencia(OFERTA, [ficha(), cerrada, fallo()], politica(), ahora=AHORA)
        self.assertEqual(resultado["estado"], "no-disponible-publicamente")
        self.assertIn("inscripcion_cerrada_o_sin_plazas", resultado["motivos"])

    def test_otra_identidad_o_portada_es_incidencia_del_enlace_y_conserva_la_oferta(self) -> None:
        """Si la URL ya no lleva a este curso, falla el enlace: se avisa sin retirar ni rejuvenecer."""
        for campo, valor in [("identidad_observada", "otro-curso"), ("tipo_destino", "portada")]:
            with self.subTest(campo=campo):
                cambiada = ficha("2026-10-22T08:30:00Z", identificador="cambiada")
                cambiada["detalle"][campo] = valor
                resultado = evaluar_vigencia(OFERTA, [ficha(), cambiada, fallo()], politica(), ahora=AHORA)
                self.assertEqual(resultado["estado"], "disponible-publicamente")
                self.assertEqual(resultado["comprobado_el"], "2026-10-22T08:00:00Z")
                self.assertEqual(resultado["incidencia_enlace"]["tipo"], "otra_identidad")
                self.assertIsNotNone(resultado["ultimo_intento_fallido_el"])

    def test_fallo_no_resuelve_respuestas_simultaneas_contradictorias(self) -> None:
        """Las evidencias incompatibles siguen pendientes después del fallo."""
        cerrada = ficha(identificador="cerrada")
        cerrada["detalle"]["datos_edicion"]["estado_inscripcion"] = "cerrada"
        resultado = evaluar_vigencia(OFERTA, [ficha(), cerrada, fallo()], politica(), ahora=AHORA)
        self.assertEqual(resultado["estado"], "sin-confirmar")
        self.assertIn("fichas_simultaneas_discrepantes", resultado["motivos"])

    def test_catalogo_conserva_su_plazo_y_retirada_comprobada(self) -> None:
        """El catálogo requerido conserva su confirmación; su TTL solo programa la revisión."""
        regla = politica()
        regla.update(requiere_catalogo=True, ttl_catalogo_segundos=43200)
        observaciones = [ficha(), catalogo(), fallo(tipo="catalogo")]
        resultado = evaluar_vigencia(OFERTA, observaciones, regla, ahora=AHORA)
        self.assertEqual(resultado["estado"], "disponible-publicamente")
        self.assertEqual(resultado["revisar_el"], "2026-10-22T20:00:00Z")
        self.assertEqual(
            evaluar_vigencia(OFERTA, observaciones, regla, ahora="2026-10-22T20:00:00Z")["estado"],
            "disponible-publicamente",
        )
        observaciones.append(catalogo("2026-10-22T08:30:00Z", presente=False, identificador="ausencia"))
        self.assertEqual(evaluar_vigencia(OFERTA, observaciones, regla, ahora=AHORA)["estado"], "sin-confirmar")

    def test_fallo_no_extiende_inscripcion_que_termina_antes_del_ttl(self) -> None:
        """El calendario acreditado también limita la conservación."""
        anterior = ficha(
            fuente={
                "estado": "actual_matricula_abierta",
                "fechas_matricula": {"fin": "2026-10-22T09:30Z"},
            },
            abierto=False,
        )
        resultado = evaluar_vigencia(OFERTA, [anterior, fallo()], politica(), ahora=AHORA)
        self.assertEqual(resultado["estado"], "no-disponible-publicamente")
        self.assertIn("plazo_de_inscripcion_o_acceso_vencido", resultado["motivos"])

    def test_errores_tecnicos_http_no_anulan_ni_renuevan_ficha_vigente(self) -> None:
        """Los errores transitorios conservan comprobación, calendario y fecha originales."""
        for codigo in (
            HTTPStatus.INTERNAL_SERVER_ERROR,
            HTTPStatus.BAD_GATEWAY,
            HTTPStatus.SERVICE_UNAVAILABLE,
            HTTPStatus.GATEWAY_TIMEOUT,
            HTTPStatus.NETWORK_AUTHENTICATION_REQUIRED,
            HTTPStatus.TOO_MANY_REQUESTS,
            HTTPStatus.REQUEST_TIMEOUT,
        ):
            with self.subTest(codigo=codigo):
                respuesta = error_http(codigo)
                resultado = evaluar_vigencia(OFERTA, [ficha(), respuesta], politica(), ahora=AHORA)
                self.assertEqual(resultado["estado"], "disponible-publicamente")
                self.assertEqual(resultado["comprobado_el"], "2026-10-22T08:00:00Z")
                self.assertEqual(resultado["revisar_el"], "2026-10-23T08:00:00Z")
                self.assertEqual(resultado["ultimo_intento_el"], respuesta["intentado_el"])
                self.assertEqual(resultado["ultimo_intento_fallido_el"], respuesta["terminado_el"])
                self.assertIn(respuesta["id"], resultado["trazabilidad"]["observaciones"])

    def test_error_http_catalogo_conserva_su_confirmacion_y_plazo(self) -> None:
        """La misma separación se aplica al catálogo requerido, con su revisión independiente."""
        regla = politica()
        regla.update(requiere_catalogo=True, ttl_catalogo_segundos=43200)
        for codigo in (HTTPStatus.SERVICE_UNAVAILABLE, HTTPStatus.TOO_MANY_REQUESTS, HTTPStatus.REQUEST_TIMEOUT):
            with self.subTest(codigo=codigo):
                resultado = evaluar_vigencia(
                    OFERTA, [ficha(), catalogo(), error_http(codigo, tipo="catalogo")], regla, ahora=AHORA
                )
                self.assertEqual(resultado["estado"], "disponible-publicamente")
                self.assertEqual(resultado["revisar_el"], "2026-10-22T20:00:00Z")
                self.assertEqual(resultado["ultimo_intento_fallido_el"], "2026-10-22T09:00:00Z")

    def test_error_http_sin_confirmacion_no_fabrica_y_tras_la_revision_no_rejuvenece(self) -> None:
        """Conservar una prueba no permite inventarla ni rejuvenecerla al pasar la revisión."""
        respuesta = error_http(HTTPStatus.SERVICE_UNAVAILABLE)
        sin_previa = evaluar_vigencia(OFERTA, [respuesta], politica(), ahora=AHORA)
        self.assertEqual(sin_previa["estado"], "sin-confirmar")
        self.assertIsNone(sin_previa["revisar_el"])
        self.assertEqual(sin_previa["ultimo_intento_fallido_el"], "2026-10-22T09:00:00Z")
        pasada = evaluar_vigencia(OFERTA, [ficha(), respuesta], politica(), ahora="2026-10-23T08:00:00Z")
        self.assertEqual(pasada["estado"], "disponible-publicamente")
        self.assertEqual(pasada["comprobado_el"], "2026-10-22T08:00:00Z")
        self.assertEqual(pasada["revisar_el"], "2026-10-23T08:00:00Z")

    def test_cierre_identificado_antes_o_despues_de_error_http_no_se_ignora(self) -> None:
        """Una respuesta válida de cierre sigue prevaleciendo sobre una apertura antigua."""
        for fecha in ("2026-10-22T08:30:00Z", "2026-10-22T09:30:00Z"):
            with self.subTest(fecha=fecha):
                cerrada = ficha(fecha, identificador="cierre-identificado")
                cerrada["detalle"]["datos_edicion"]["estado_inscripcion"] = "cerrada"
                resultado = evaluar_vigencia(
                    OFERTA, [ficha(), cerrada, error_http(HTTPStatus.SERVICE_UNAVAILABLE)], politica(), ahora=AHORA
                )
                self.assertEqual(resultado["estado"], "no-disponible-publicamente")
                self.assertIn("inscripcion_cerrada_o_sin_plazas", resultado["motivos"])

    def test_http_404_410_no_se_convierten_en_cierre_ni_se_ignoran(self) -> None:
        """Un destino ausente es incidencia de esa URL: no retira la oferta ni se pierde el aviso."""
        for codigo in (HTTPStatus.NOT_FOUND, HTTPStatus.GONE):
            with self.subTest(codigo=codigo):
                resultado = evaluar_vigencia(OFERTA, [ficha(), error_http(codigo)], politica(), ahora=AHORA)
                self.assertEqual(resultado["estado"], "disponible-publicamente")
                self.assertEqual(resultado["comprobado_el"], "2026-10-22T08:00:00Z")
                self.assertEqual(
                    resultado["incidencia_enlace"],
                    {
                        "el": "2026-10-22T09:00:00Z",
                        "origen": "ficha",
                        "tipo": "no_encontrado",
                        "codigo_http": int(codigo),
                    },
                )

    def test_auth_y_redireccion_no_identificada_conservan_confirmacion_y_fallo(self) -> None:
        """Un bloqueo o redirección sin ficha no es un cambio factual de la oferta."""
        for codigo in (
            HTTPStatus.UNAUTHORIZED,
            HTTPStatus.FORBIDDEN,
            HTTPStatus.PROXY_AUTHENTICATION_REQUIRED,
            HTTPStatus.MOVED_PERMANENTLY,
            HTTPStatus.FOUND,
            HTTPStatus.SEE_OTHER,
            HTTPStatus.NOT_MODIFIED,
            HTTPStatus.TEMPORARY_REDIRECT,
            HTTPStatus.PERMANENT_REDIRECT,
        ):
            with self.subTest(codigo=codigo):
                respuesta = error_http(codigo)
                observaciones = [ficha(), respuesta]
                antes = copy.deepcopy(observaciones)
                resultado = evaluar_vigencia(OFERTA, observaciones, politica(), ahora=AHORA)
                self.assertEqual(resultado["estado"], "disponible-publicamente")
                self.assertEqual(resultado["comprobado_el"], "2026-10-22T08:00:00Z")
                self.assertEqual(resultado["revisar_el"], "2026-10-23T08:00:00Z")
                self.assertEqual(resultado["ultimo_intento_el"], respuesta["intentado_el"])
                self.assertIn(respuesta["id"], resultado["trazabilidad"]["observaciones"])
                self.assertIsNone(resultado["trazabilidad"]["capturas"][respuesta["id"]]["comprobado_el"])
                self.assertEqual(evaluar_vigencia(OFERTA, observaciones[::-1], politica(), ahora=AHORA), resultado)
                self.assertEqual(observaciones, antes)

    def test_auth_y_redireccion_sin_previa_o_tras_revision_no_crean_ni_retiran(self) -> None:
        """El fallo no fabrica historia ni cambia la revisión de la última ficha válida."""
        for codigo in (HTTPStatus.FORBIDDEN, HTTPStatus.PERMANENT_REDIRECT):
            with self.subTest(codigo=codigo):
                respuesta = error_http(codigo)
                sin_previa = evaluar_vigencia(OFERTA, [respuesta], politica(), ahora=AHORA)
                self.assertEqual(sin_previa["estado"], "sin-confirmar")
                self.assertIsNone(sin_previa["comprobado_el"])
                pasada = evaluar_vigencia(OFERTA, [ficha(), respuesta], politica(), ahora="2026-10-23T08:00:00Z")
                self.assertEqual(pasada["estado"], "disponible-publicamente")
                self.assertEqual(pasada["comprobado_el"], "2026-10-22T08:00:00Z")
                self.assertEqual(pasada["revisar_el"], "2026-10-23T08:00:00Z")

    def test_auth_catalogo_no_anula_censo_previo_ni_su_plazo(self) -> None:
        """Un catálogo bloqueado no se convierte en catálogo vacío o completo recién leído."""
        regla = politica()
        regla.update(requiere_catalogo=True, ttl_catalogo_segundos=43200)
        for codigo in (HTTPStatus.FORBIDDEN, HTTPStatus.TEMPORARY_REDIRECT):
            with self.subTest(codigo=codigo):
                respuesta = error_http(codigo, tipo="catalogo")
                resultado = evaluar_vigencia(OFERTA, [ficha(), catalogo(), respuesta], regla, ahora=AHORA)
                self.assertEqual(resultado["estado"], "disponible-publicamente")
                self.assertEqual(resultado["revisar_el"], "2026-10-22T20:00:00Z")
                self.assertEqual(resultado["trazabilidad"]["catalogo"]["ultima_positiva_el"], "2026-10-22T08:00:00Z")

    def test_http_403_con_campos_de_cierre_no_inventa_hecho_de_fuente(self) -> None:
        """Un cuerpo de cortafuegos no acredita cierre por traer un campo interpretado."""
        respuesta = ficha("2026-10-22T09:00:00Z", identificador="cuerpo-403")
        respuesta["detalle"]["codigo_http"] = int(HTTPStatus.FORBIDDEN)
        respuesta["detalle"]["datos_edicion"]["estado_inscripcion"] = "cerrada"
        resultado = evaluar_vigencia(OFERTA, [ficha(), respuesta], politica(), ahora=AHORA)
        self.assertEqual(resultado["estado"], "disponible-publicamente")
        self.assertEqual(resultado["comprobado_el"], "2026-10-22T08:00:00Z")

    def test_bloqueo_no_resucita_ni_oculta_cierre_identificado(self) -> None:
        """Una respuesta 200 pertinente de cierre manda antes o después del bloqueo."""
        for fecha in ("2026-10-22T08:30:00Z", "2026-10-22T09:30:00Z"):
            with self.subTest(fecha=fecha):
                cerrada = ficha(fecha, identificador="cierre-real")
                cerrada["detalle"]["datos_edicion"]["estado_inscripcion"] = "cerrada"
                resultado = evaluar_vigencia(
                    OFERTA, [ficha(), cerrada, error_http(HTTPStatus.FORBIDDEN)], politica(), ahora=AHORA
                )
                self.assertEqual(resultado["estado"], "no-disponible-publicamente")
                self.assertIn("inscripcion_cerrada_o_sin_plazas", resultado["motivos"])

    def test_recurso_v9_conserva_confirmacion_tras_403_y_sin_consulta_nueva_no_se_retira(self) -> None:
        """El único registro aplica la misma regla al recurso nativo sin edición."""
        caso = recursos.RecursoSinEdicionPruebas()
        caso.setUp()
        self.addCleanup(caso.doCleanups)
        inicial = replace(caso.solicitud(), ahora="2026-10-22T08:15:00Z")
        registro.registrar_unidad(caso.base, inicial)
        respuesta = error_http(HTTPStatus.FORBIDDEN)
        respuesta["url_consultada"] = inicial.oferta["url"]
        respuesta["detalle"]["url_final"] = inicial.oferta["url"]
        for evidencia in respuesta["evidencias"]:
            evidencia["url"] = inicial.oferta["url"]
        comprobacion = replace(inicial, observaciones=[*inicial.observaciones, respuesta], ahora=AHORA)
        registro.registrar_unidad(caso.base, comprobacion)
        actual = registro.consultar_unidad(caso.base, tipo="recurso", id="programa-1")["evaluacion"]
        self.assertEqual(actual["schema_version"], 2)
        self.assertEqual(actual["resultado"]["estado"], "disponible-publicamente")
        self.assertEqual(actual["resultado"]["comprobado_el"], "2026-10-22T08:00:00Z")
        registro.registrar_unidad(caso.base, replace(comprobacion, ahora="2026-10-23T08:00:00Z"))
        pasada = registro.consultar_unidad(caso.base, tipo="recurso", id="programa-1")["evaluacion"]["resultado"]
        self.assertEqual(pasada["estado"], "disponible-publicamente")
        self.assertEqual(pasada["comprobado_el"], "2026-10-22T08:00:00Z")
        self.assertEqual(pasada["revisar_el"], "2026-10-23T08:00:00Z")
        self.assertEqual(pasada["ultimo_intento_el"], "2026-10-22T09:00:00Z")
        self.assertEqual(pasada["ultimo_intento_fallido_el"], "2026-10-22T09:00:00Z")

    def test_un_cuerpo_http_503_no_acredita_cierre_aunque_el_adaptador_lo_marque(self) -> None:
        """El error HTTP no se eleva a hecho de fuente solo por traer campos de curso."""
        respuesta = ficha("2026-10-22T09:00:00Z", identificador="cuerpo-error")
        respuesta["detalle"]["codigo_http"] = int(HTTPStatus.SERVICE_UNAVAILABLE)
        respuesta["detalle"]["datos_edicion"]["estado_inscripcion"] = "cerrada"
        resultado = evaluar_vigencia(OFERTA, [ficha(), respuesta], politica(), ahora=AHORA)
        self.assertEqual(resultado["estado"], "disponible-publicamente")
        self.assertEqual(resultado["comprobado_el"], "2026-10-22T08:00:00Z")

    def test_redireccion_otra_identidad_no_sustituye_confirmacion(self) -> None:
        """Una identidad no nula pero ajena no acredita una respuesta de esta oferta."""
        for codigo in (301, 302, 303, 304, 307, 308):
            cambio = ficha("2026-10-22T09:00:00Z", identificador=f"redir-ajena-{codigo}")
            cambio["detalle"].update(
                codigo_http=codigo,
                identidad_observada="otra-oferta",
                url_final="https://example.org/otra-oferta",
            )
            for evidencia in cambio["evidencias"]:
                evidencia["url"] = cambio["detalle"]["url_final"]
            observaciones = [ficha(), cambio]
            with self.subTest(codigo=codigo):
                resultado = evaluar_vigencia(OFERTA, observaciones, politica(), ahora=AHORA)
                self.assertEqual(resultado["estado"], "disponible-publicamente")
                self.assertEqual(resultado["comprobado_el"], "2026-10-22T08:00:00Z")
                self.assertEqual(resultado["revisar_el"], "2026-10-23T08:00:00Z")
                self.assertIsNone(resultado["ultimo_intento_fallido_el"])
                self.assertEqual(resultado["incidencia_enlace"]["tipo"], "redireccion_sin_identidad")
                self.assertEqual(resultado["incidencia_enlace"]["codigo_http"], codigo)
                self.assertIsNone(resultado["trazabilidad"]["capturas"][cambio["id"]]["comprobado_el"])
                traza = resultado["trazabilidad"]["capturas"][cambio["id"]]
                self.assertEqual(traza["resultado_consulta"], "fallo")
                self.assertEqual(traza["motivo_consulta"], "la_ficha_ya_no_lleva_a_este_curso")
                self.assertEqual(resultado["ultimo_intento_el"], cambio["intentado_el"])
                self.assertEqual(resultado, evaluar_vigencia(OFERTA, observaciones[::-1], politica(), ahora=AHORA))
                pasada = evaluar_vigencia(OFERTA, observaciones, politica(), ahora="2026-10-23T08:00:00Z")
                self.assertEqual(pasada["estado"], "disponible-publicamente")
                self.assertEqual(pasada["comprobado_el"], "2026-10-22T08:00:00Z")

    def test_destino_final_200_identificado_si_renueva_confirmacion(self) -> None:
        """Un destino canónico distinto con identidad exacta conserva el caso positivo."""
        actual = ficha("2026-10-22T09:00:00Z", identificador="redir-correcta")
        actual["detalle"]["url_final"] = "https://example.org/curso-canonico"
        for evidencia in actual["evidencias"]:
            evidencia["url"] = actual["detalle"]["url_final"]
        resultado = evaluar_vigencia(OFERTA, [ficha(), actual], politica(), ahora=AHORA)
        self.assertEqual(resultado["estado"], "disponible-publicamente")
        self.assertEqual(resultado["comprobado_el"], "2026-10-22T09:00:00Z")
        self.assertEqual(resultado["revisar_el"], "2026-10-23T09:00:00Z")
        self.assertIsNone(resultado["ultimo_intento_fallido_el"])
