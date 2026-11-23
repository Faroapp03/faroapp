"""Casos sintéticos de oferta realista: sin red, reloj ni base de datos."""

import copy
import json
import unittest
from datetime import datetime
from pathlib import Path
from unittest.mock import patch

from plataforma_datos.cursos.contrato_fichas import calendarios_edicion, normalizar_datos_edicion
from plataforma_datos.cursos.tipos_json import ObjetoJson
from plataforma_datos.cursos.vigencia import (
    ALCANCES_EVIDENCIA,
    CAMPOS_EVIDENCIA,
    CAMPOS_OBSERVACION,
    CAMPOS_OFERTA,
    CAMPOS_POLITICA,
    ESTADOS,
    ErrorVigencia,
    evaluar_vigencia,
)

AHORA = "2026-10-22T10:00:00Z"
OFERTA = {
    "id": "curso-ia-1",
    "fuente_id": "fuente-sintetica",
    "url": "https://example.org/curso-ia-1",
}


def evidencia(alcance: str, fecha: str = "2026-10-22T08:00:00Z", url: str | None = None) -> ObjetoJson:
    """Construye una captura sintética vinculada a un campo.

    Returns:
        El resultado de la operación sintética.
    """
    return {
        "alcance": alcance,
        "url": url or OFERTA["url"],
        "capturado_utc": fecha,
        "sha256": "a" * 64,
        "localizador": {"tipo": "campo", "valor": "/id" if alcance == "identidad" else alcance},
    }


def politica() -> ObjetoJson:
    """Declara los plazos y convenciones de la fuente sintética.

    Returns:
        El resultado de la operación sintética.
    """
    return {
        "fuente_id": OFERTA["fuente_id"],
        "version": "prueba-1",
        "ttl_ficha_segundos": 86400,
        "ttl_catalogo_segundos": None,
        "requiere_catalogo": False,
        "zona_fechas_dia": "Europe/Madrid",
        "inicio_dia_inclusivo": None,
        "fin_dia_inclusivo": None,
        "plazo_tecnico": "revision_interna",
        "evidencias": [evidencia("politica", "2026-10-01T00:00:00Z", "https://example.org/norma-fuente")],
    }


def ficha(
    fecha: str = "2026-10-22T08:00:00Z",
    *,
    identificador: str = "ficha-1",
    fuente: ObjetoJson | None = None,
    abierto: bool | None = True,
) -> ObjetoJson:
    """Construye una observación de ficha con su captura.

    Returns:
        El resultado de la operación sintética.
    """
    datos = normalizar_datos_edicion(fuente or {"estado": "actual_matricula_abierta", "coste_formacion": 0})
    campos = [c["campo"] for c in calendarios_edicion(datos)]
    original = datos["publicacion_original"]
    if any(
        original.get(c) is not None
        for c in ("fechas_matricula", "plazo_matricula", "inicio_matricula", "fin_matricula")
    ):
        campos.append(
            next(
                (c for c in ("fechas_matricula", "plazo_matricula") if original.get(c) is not None),
                "inicio_matricula/fin_matricula",
            )
        )
    calendarios = [evidencia("calendario", fecha) for _ in campos]
    for captura, campo in zip(calendarios, campos, strict=True):
        captura["localizador"]["valor"] = "/" + campo
    return {
        "id": identificador,
        "tipo": "ficha",
        "intentado_el": fecha,
        "terminado_el": fecha,
        "resultado": "correcta",
        "url_consultada": OFERTA["url"],
        "detalle": {
            "url_final": OFERTA["url"],
            "codigo_http": 200,
            "tipo_destino": "ficha",
            "identidad_observada": OFERTA["id"],
            "datos_edicion": datos,
            "acceso_abierto": abierto,
        },
        "evidencias": [evidencia(c, fecha) for c in ("identidad", "disponibilidad")] + calendarios,
    }


def catalogo(
    fecha: str = "2026-10-22T08:00:00Z",
    *,
    completo: bool = True,
    presente: bool | None = True,
    identificador: str = "catalogo-1",
) -> ObjetoJson:
    """Construye una observación de catálogo completo o parcial.

    Returns:
        El resultado de la operación sintética.
    """
    url = "https://example.org/catalogo"
    return {
        "id": identificador,
        "tipo": "catalogo",
        "intentado_el": fecha,
        "terminado_el": fecha,
        "resultado": "correcta",
        "url_consultada": url,
        "detalle": {
            "url_final": url,
            "codigo_http": 200,
            "tipo_destino": "catalogo",
            "identidad_buscada": OFERTA["id"],
            "lectura_completa": completo,
            "presente": presente,
        },
        "evidencias": [evidencia("catalogo", fecha, url)],
    }


def fallo(fecha: str = "2026-10-22T09:00:00Z", *, tipo: str = "ficha", identificador: str = "fallo-1") -> ObjetoJson:
    """Registra un intento fallido sin fabricar una captura positiva.

    Returns:
        El resultado de la operación sintética.
    """
    return {
        "id": identificador,
        "tipo": tipo,
        "intentado_el": fecha,
        "terminado_el": fecha,
        "resultado": "fallo",
        "url_consultada": OFERTA["url"],
        "detalle": {"motivo": "Fallo TLS sintético, sin respuesta de ficha"},
        "evidencias": [],
    }


class VigenciaPruebas(unittest.TestCase):
    """Contrasta el contrato con entradas válidas, incompletas y adversas."""

    def setUp(self) -> None:
        """Prepara una base y capturas sintéticas para cada caso."""
        self.politica = politica()
        self.observaciones = [ficha()]

    def evaluar(self, *, ahora: str = AHORA) -> ObjetoJson:
        """Evalúa la oferta y comprueba que el límite publicado es posterior.

        Returns:
            El resultado de la operación sintética.
        """
        resultado = evaluar_vigencia(copy.deepcopy(OFERTA), self.observaciones, self.politica, ahora=ahora)
        self.assertNotIn("vence_el", resultado)
        if resultado["estado"] == "disponible-publicamente" and resultado["cierra_el"] is not None:
            self.assertLess(
                datetime.fromisoformat(ahora.replace("Z", "+00:00")),
                datetime.fromisoformat(resultado["cierra_el"].replace("Z", "+00:00")),
            )
        return resultado

    def test_curso_abierto_sin_fechas_solo_programa_revision_no_se_inventa_calendario(self) -> None:
        """El TTL fija la próxima revisión interna; sin fechas publicadas no hay cierre."""
        resultado = self.evaluar()
        self.assertEqual(resultado["estado"], "disponible-publicamente")
        self.assertEqual(resultado["comprobado_el"], "2026-10-22T08:00:00Z")
        self.assertEqual(resultado["revisar_el"], "2026-10-23T08:00:00Z")
        self.assertIsNone(resultado["cierra_el"])
        self.assertIsNone(resultado["ultimo_intento_fallido_el"])
        self.assertEqual(resultado["trazabilidad"]["limites_calculados"], [])
        self.assertEqual(resultado["alcance"], "disponibilidad-publica")

    def test_fallo_no_renueva_comprobacion_positiva_y_recuperacion_si(self) -> None:
        """Comprueba fallo no renueva comprobacion positiva y recuperacion si."""
        self.observaciones.append(fallo())
        caida = self.evaluar()
        self.assertEqual(caida["estado"], "disponible-publicamente")
        self.assertEqual(caida["ultimo_intento_el"], "2026-10-22T09:00:00Z")
        self.assertEqual(caida["comprobado_el"], "2026-10-22T08:00:00Z")
        self.assertEqual(caida["revisar_el"], "2026-10-23T08:00:00Z")
        self.assertEqual(caida["ultimo_intento_fallido_el"], "2026-10-22T09:00:00Z")
        self.observaciones.append(ficha("2026-10-22T09:30:00Z", identificador="recuperacion"))
        recuperada = self.evaluar()
        self.assertEqual(recuperada["estado"], "disponible-publicamente")
        self.assertEqual(recuperada["comprobado_el"], "2026-10-22T09:30:00Z")
        self.assertEqual(recuperada["revisar_el"], "2026-10-23T09:30:00Z")
        self.assertIsNone(recuperada["ultimo_intento_fallido_el"])
        self.assertEqual(len(self.observaciones), 3)

    def test_ttl_es_revision_interna_y_no_retira_la_oferta(self) -> None:
        """Cruzar el TTL solo deja la revisión pendiente: la oferta y sus fechas no cambian."""
        for ahora in ("2026-10-23T07:59:59.999999Z", "2026-10-23T08:00:00Z", "2026-10-23T08:00:00.000001Z"):
            with self.subTest(ahora=ahora):
                resultado = self.evaluar(ahora=ahora)
                self.assertEqual(resultado["estado"], "disponible-publicamente")
                self.assertEqual(resultado["comprobado_el"], "2026-10-22T08:00:00Z")
                self.assertEqual(resultado["revisar_el"], "2026-10-23T08:00:00Z")
        self.politica["ttl_ficha_segundos"] = 3600
        resultado = self.evaluar()
        self.assertEqual(resultado["estado"], "disponible-publicamente")
        self.assertEqual(resultado["revisar_el"], "2026-10-22T09:00:00Z")

    def test_catalogo_requerido_distingue_lectura_y_presencia(self) -> None:
        """Comprueba catalogo requerido distingue lectura y presencia."""
        self.politica.update(requiere_catalogo=True, ttl_catalogo_segundos=43200)
        for completo, presente, estado in [
            (False, False, "sin-confirmar"),
            (False, True, "sin-confirmar"),
            (True, False, "sin-confirmar"),
            (True, None, "sin-confirmar"),
            (True, True, "disponible-publicamente"),
        ]:
            with self.subTest(completo=completo, presente=presente):
                self.observaciones = [
                    ficha(),
                    catalogo(completo=completo, presente=presente),
                ]
                resultado = self.evaluar()
                self.assertEqual(resultado["estado"], estado)
                rastro = resultado["trazabilidad"]["catalogo"]
                self.assertEqual(rastro["ultima_lectura_completa_el"] is not None, completo)
                self.assertEqual(rastro["ultima_presencia_el"] is not None, presente is True)

    def test_catalogo_solo_nunca_acredita_acceso_a_la_ficha(self) -> None:
        """Comprueba catalogo solo nunca acredita acceso a la ficha."""
        self.observaciones = [catalogo()]
        self.assertEqual(self.evaluar()["estado"], "sin-confirmar")
        self.assertIsNone(self.evaluar()["comprobado_el"])

    def test_catalogo_inexistente_no_se_fabrica_para_curso_abierto(self) -> None:
        """Comprueba catalogo inexistente no se fabrica para curso abierto."""
        resultado = self.evaluar()
        self.assertEqual(resultado["estado"], "disponible-publicamente")
        self.assertIsNone(resultado["trazabilidad"]["catalogo"]["ultima_presencia_el"])
        self.politica.update(requiere_catalogo=True, ttl_catalogo_segundos=43200)
        self.assertEqual(self.evaluar()["estado"], "sin-confirmar")

    def test_fallo_catalogo_requerido_no_renueva_lectura_y_su_ttl_es_propio(self) -> None:
        """Comprueba fallo catalogo requerido no renueva lectura y su ttl es propio."""
        self.politica.update(requiere_catalogo=True, ttl_catalogo_segundos=43200)
        self.observaciones += [catalogo(), fallo(tipo="catalogo")]
        resultado = self.evaluar()
        self.assertEqual(resultado["estado"], "disponible-publicamente")
        self.assertEqual(
            resultado["trazabilidad"]["catalogo"]["ultima_lectura_completa_el"],
            "2026-10-22T08:00:00Z",
        )
        self.assertEqual(resultado["ultimo_intento_fallido_el"], "2026-10-22T09:00:00Z")
        self.observaciones.pop()
        tardia = self.evaluar(ahora="2026-10-22T20:00:00Z")
        self.assertEqual(tardia["estado"], "disponible-publicamente")
        self.assertEqual(tardia["revisar_el"], "2026-10-22T20:00:00Z")
        self.assertEqual(self.evaluar()["revisar_el"], "2026-10-22T20:00:00Z")

    def test_traslado_de_url_vale_con_identidad_pero_no_portada_o_otra_ficha(self) -> None:
        """Comprueba traslado de url vale con identidad pero no portada o otra ficha."""
        observacion = self.observaciones[0]
        destino = "https://example.net/nueva-ficha/ia-1"
        observacion["detalle"]["url_final"] = destino
        for e in observacion["evidencias"]:
            e["url"] = destino
        self.assertEqual(self.evaluar()["estado"], "disponible-publicamente")
        observacion["detalle"]["tipo_destino"] = "portada"
        self.assertEqual(self.evaluar()["estado"], "sin-confirmar")
        observacion["detalle"].update(tipo_destino="ficha", identidad_observada="otro-curso")
        self.assertEqual(self.evaluar()["estado"], "sin-confirmar")
        observacion["detalle"].update(identidad_observada=OFERTA["id"], codigo_http=404)
        self.assertEqual(self.evaluar()["estado"], "sin-confirmar")

    def test_http_200_sin_identidad_o_contenido_no_basta(self) -> None:
        """Comprueba que un HTTP 200 sin identidad o contenido no basta."""
        for campo in ("identidad_observada", "datos_edicion"):
            with self.subTest(campo=campo):
                self.observaciones = [ficha()]
                self.observaciones[0]["detalle"][campo] = None
                self.assertEqual(self.evaluar()["estado"], "sin-confirmar")

    def test_finalizado_archivado_cerrado_y_sin_plazas_no_son_disponibles(self) -> None:
        """Comprueba finalizado archivado cerrado y sin plazas no son disponibles."""
        for campo, valor in [
            ("estado_edicion", "finalizada"),
            ("estado_edicion", "archivada"),
            ("estado_inscripcion", "cerrada"),
            ("estado_inscripcion", "sin-plazas"),
        ]:
            with self.subTest(campo=campo, valor=valor):
                self.observaciones = [ficha()]
                self.observaciones[0]["detalle"]["datos_edicion"][campo] = valor
                self.assertEqual(self.evaluar()["estado"], "no-disponible-publicamente")

    def test_fin_inscripcion_distinto_de_fin_curso(self) -> None:
        """Comprueba fin inscripcion distinto de fin curso."""
        fuente = {
            "estado": "actual_matricula_abierta",
            "fechas_matricula": ["2026-10-01T00:00Z", "2026-10-22T09:00Z"],
            "fechas_edicion": ["2026-11-01T00:00Z", "2026-12-01T00:00Z"],
        }
        self.observaciones = [ficha(fuente=fuente, abierto=False)]
        resultado = self.evaluar()
        self.assertEqual(resultado["estado"], "no-disponible-publicamente")
        self.assertEqual(resultado["cierra_el"], "2026-10-22T09:00:00Z")
        self.assertIn("plazo_de_inscripcion_o_acceso_vencido", resultado["motivos"])

    def test_edicion_futura_puede_tener_matricula_actual_confirmada(self) -> None:
        """Comprueba edicion futura puede tener matricula actual confirmada."""
        fuente = {
            "estado": "futura",
            "inscripcion": "Matrícula vigente hasta el 30/10",
            "fechas_matricula": ["2026-10-01T00:00Z", "2026-10-30T00:00Z"],
            "fechas_edicion": ["2026-11-01T00:00Z", "2026-12-01T00:00Z"],
        }
        self.observaciones = [ficha(fuente=fuente, abierto=False)]
        self.assertEqual(self.evaluar()["estado"], "disponible-publicamente")
        self.observaciones = [ficha(fuente={"estado": "futura"}, abierto=None)]
        self.assertEqual(self.evaluar()["estado"], "sin-confirmar")

    def test_apertura_futura_no_se_activa_automaticamente_por_pasar_fecha(self) -> None:
        """Comprueba apertura futura no se activa automaticamente por pasar fecha."""
        self.politica["ttl_ficha_segundos"] = 7 * 86400
        fuente = {
            "estado": "actual_matricula_abierta",
            "fechas_matricula": ["2026-10-23T00:00Z", "2026-10-30T00:00Z"],
        }
        self.observaciones = [ficha(fuente=fuente, abierto=False)]
        self.assertEqual(self.evaluar()["estado"], "apertura-futura")
        self.assertEqual(self.evaluar(ahora="2026-10-24T00:00:00Z")["estado"], "sin-confirmar")
        self.observaciones.append(
            ficha(
                "2026-10-24T00:00:00Z",
                identificador="reapertura",
                fuente=fuente,
                abierto=False,
            )
        )
        self.assertEqual(
            self.evaluar(ahora="2026-10-24T00:00:00Z")["estado"],
            "disponible-publicamente",
        )

    def test_ventana_acceso_y_fin_curso_se_respetan_sin_usar_inicio_como_matricula(self) -> None:
        """Comprueba ventana acceso y fin curso se respetan sin usar inicio como matricula."""
        fuente = {
            "estado": "actual_matricula_abierta",
            "fechas_aula": ["2026-10-23T00:00Z", "2026-10-30T00:00Z"],
        }
        self.observaciones = [ficha(fuente=fuente)]
        self.assertEqual(self.evaluar()["estado"], "apertura-futura")
        fuente = {
            "estado": "actual_matricula_abierta",
            "fechas_edicion": ["2026-10-01T00:00Z", "2026-10-21T00:00Z"],
        }
        self.observaciones = [ficha(fuente=fuente)]
        self.assertIn("periodo_formativo_finalizado", self.evaluar()["motivos"])

    def test_dia_anterior_limite_y_posterior_con_precision_preservada(self) -> None:
        """Comprueba dia anterior limite y posterior con precision preservada."""
        self.politica["ttl_ficha_segundos"] = 7 * 86400
        fuente = {
            "estado": "actual_matricula_abierta",
            "fechas_matricula": {"fin": "2026-10-23"},
        }
        self.observaciones = [ficha(fuente=fuente, abierto=False)]
        antes = self.evaluar()
        limite = self.evaluar(ahora="2026-10-23T10:00:00Z")
        despues = self.evaluar(ahora="2026-10-24T10:00:00Z")
        self.assertEqual(
            [r["estado"] for r in (antes, limite, despues)],
            ["disponible-publicamente", "sin-confirmar", "no-disponible-publicamente"],
        )
        self.assertEqual(antes["cierra_el"], "2026-10-22T22:00:00Z")
        cota = antes["trazabilidad"]["limites_calculados"][0]
        self.assertEqual(cota["valor_publicado"], "2026-10-23")
        self.assertEqual(
            self.observaciones[0]["detalle"]["datos_edicion"]["fechas_matricula_detalle"]["fin"]["precision"],
            "dia",
        )

    def test_inclusion_dia_es_convencion_explicita_de_la_fuente(self) -> None:
        """Comprueba inclusion dia es convencion explicita de la fuente."""
        self.politica["ttl_ficha_segundos"] = 7 * 86400
        self.observaciones = [
            ficha(
                fuente={
                    "estado": "actual_matricula_abierta",
                    "fechas_matricula": {"fin": "2026-10-23"},
                },
                abierto=False,
            )
        ]
        self.politica["fin_dia_inclusivo"] = True
        resultado = self.evaluar(ahora="2026-10-23T21:59:59Z")
        self.assertEqual(resultado["estado"], "disponible-publicamente")
        self.assertEqual(resultado["cierra_el"], "2026-10-23T22:00:00Z")
        self.politica["fin_dia_inclusivo"] = False
        self.assertEqual(
            self.evaluar(ahora="2026-10-23T00:00:00Z")["estado"],
            "no-disponible-publicamente",
        )

    def test_inicio_de_dia_no_es_una_hora_publicada(self) -> None:
        """Comprueba inicio de dia no es una hora publicada."""
        self.politica["ttl_ficha_segundos"] = 7 * 86400
        fuente = {
            "estado": "actual_matricula_abierta",
            "fechas_matricula": {"inicio": "2026-10-22", "fin": "2026-10-30"},
        }
        self.observaciones = [ficha(fuente=fuente, abierto=False)]
        self.assertEqual(self.evaluar()["estado"], "sin-confirmar")
        self.politica["inicio_dia_inclusivo"] = True
        self.assertEqual(self.evaluar()["estado"], "disponible-publicamente")
        self.politica["inicio_dia_inclusivo"] = False
        self.assertEqual(self.evaluar()["estado"], "apertura-futura")

    def test_zona_acreditada_decide_dia_local_y_no_se_supone_utc(self) -> None:
        """Comprueba zona acreditada decide dia local y no se supone utc."""
        self.politica["ttl_ficha_segundos"] = 7 * 86400
        self.observaciones = [
            ficha(
                fuente={
                    "estado": "actual_matricula_abierta",
                    "fechas_matricula": {"fin": "2026-10-23"},
                },
                abierto=False,
            )
        ]
        self.assertEqual(self.evaluar(ahora="2026-10-22T22:30:00Z")["estado"], "sin-confirmar")
        self.politica["zona_fechas_dia"] = None
        self.assertEqual(self.evaluar()["estado"], "sin-confirmar")

    def test_zona_dia_con_cambio_estacional_no_suma_24_horas_a_la_cota(self) -> None:
        """Comprueba zona dia con cambio estacional no suma 24 horas a la cota."""
        self.politica.update(ttl_ficha_segundos=7 * 86400, fin_dia_inclusivo=True)
        self.observaciones = [
            ficha(
                fuente={
                    "estado": "actual_matricula_abierta",
                    "fechas_matricula": {"fin": "2026-10-25"},
                },
                abierto=False,
            )
        ]
        resultado = self.evaluar(ahora="2026-10-25T22:59:59Z")
        self.assertEqual(resultado["estado"], "disponible-publicamente")
        self.assertEqual(resultado["cierra_el"], "2026-10-25T23:00:00Z")

    def test_offsets_se_comparan_como_instantes_y_hora_sin_zona_queda_pendiente(self) -> None:
        """Comprueba offsets se comparan como instantes y hora sin zona queda pendiente."""
        fuente = {
            "estado": "actual_matricula_abierta",
            "fechas_matricula": ["2026-10-22T08:30+02:00", "2026-10-22T12:00+01:00"],
        }
        self.observaciones = [ficha(fuente=fuente, abierto=False)]
        self.assertEqual(self.evaluar()["estado"], "disponible-publicamente")
        self.assertEqual(self.evaluar()["cierra_el"], "2026-10-22T11:00:00Z")
        self.observaciones = [
            ficha(
                fuente={
                    "estado": "actual_matricula_abierta",
                    "fechas_matricula": {"fin": "2026-10-26T23:59"},
                },
                abierto=False,
            )
        ]
        self.assertEqual(self.evaluar()["estado"], "sin-confirmar")

    def test_fechas_invertidas_no_escapan_al_validador_de_fichas(self) -> None:
        """Comprueba fechas invertidas no escapan al validador de fichas."""
        datos = self.observaciones[0]["detalle"]["datos_edicion"]
        datos["fechas_matricula"] = {"inicio": "2026-10-23", "fin": "2026-10-21"}
        with self.assertRaisesRegex(ErrorVigencia, "intervalo invertido"):
            self.evaluar()

    def test_desfase_reloj_captura_o_comprobacion_se_rechaza(self) -> None:
        """Comprueba desfase reloj captura o comprobacion se rechaza."""
        for campo, valor in [
            ("intentado_el", "2026-10-23T00:00:00Z"),
            ("terminado_el", "2026-10-21T00:00:00Z"),
            ("terminado_el", "2026-10-23T00:00:00Z"),
        ]:
            with self.subTest(campo=campo, valor=valor):
                self.observaciones = [ficha()]
                self.observaciones[0][campo] = valor
                with self.assertRaises(ErrorVigencia):
                    self.evaluar()
        self.observaciones = [ficha()]
        self.observaciones[0]["evidencias"][0]["capturado_utc"] = "2026-10-22T07:59:59Z"
        with self.assertRaises(ErrorVigencia):
            self.evaluar()

    def test_certificado_de_pago_no_impide_formacion_gratuita_ni_acredita_elegibilidad(self) -> None:
        """Comprueba certificado de pago no impide formacion gratuita ni acredita elegibilidad."""
        self.observaciones = [
            ficha(
                fuente={
                    "estado": "actual_matricula_abierta",
                    "coste_formacion": 0,
                    "coste_certificado": "50 €",
                    "territorio": "Solo residentes de la comunidad",
                    "requisitos": "Conocimientos previos",
                }
            )
        ]
        resultado = self.evaluar()
        self.assertEqual(resultado["estado"], "disponible-publicamente")
        datos = self.observaciones[0]["detalle"]["datos_edicion"]
        self.assertEqual(datos["coste_formacion_tipo"], "gratis_formacion")
        self.assertIsNone(datos["admisibilidad_persona"])
        self.assertNotIn("idoneidad_pedagogica", resultado)

    def test_senales_sin_confirmar_o_falta_de_periodo_no_acreditan_disponible(self) -> None:
        """Comprueba senales sin confirmar o falta de periodo no acreditan disponible."""
        self.observaciones = [ficha(fuente={"inscripcion": "Botón Inscribirme"}, abierto=None)]
        self.assertEqual(self.evaluar()["estado"], "sin-confirmar")
        self.observaciones = [ficha(abierto=None)]
        self.assertEqual(self.evaluar()["estado"], "sin-confirmar")
        self.observaciones = []
        self.assertEqual(self.evaluar()["estado"], "sin-confirmar")

    def test_evidencia_de_identidad_estado_y_fechas_es_obligatoria_y_vinculada(self) -> None:
        """Comprueba evidencia de identidad estado y fechas es obligatoria y vinculada."""
        fuente = {
            "estado": "actual_matricula_abierta",
            "fechas_matricula": {"fin": "2026-10-30"},
        }
        for alcance in ("identidad", "disponibilidad", "calendario"):
            with self.subTest(alcance=alcance):
                self.observaciones = [ficha(fuente=fuente)]
                self.observaciones[0]["evidencias"] = [
                    e for e in self.observaciones[0]["evidencias"] if e["alcance"] != alcance
                ]
                with self.assertRaises(ErrorVigencia):
                    self.evaluar()
        self.observaciones = [ficha()]
        self.observaciones[0]["evidencias"][0]["url"] = "https://example.org/otra-ficha"
        with self.assertRaises(ErrorVigencia):
            self.evaluar()

    def test_entradas_adversas_rechazadas_por_la_api_real(self) -> None:
        """Comprueba entradas adversas rechazadas por la api real."""
        for campo, valor in [
            ("ttl_ficha_segundos", True),
            ("ttl_catalogo_segundos", 0),
            ("requiere_catalogo", 1),
            ("fin_dia_inclusivo", "sí"),
            ("zona_fechas_dia", "Zona/Inexistente"),
            ("fuente_id", "otra"),
            ("evidencias", []),
        ]:
            with self.subTest(campo=campo):
                self.politica = politica()
                self.politica[campo] = valor
                with self.assertRaises(ErrorVigencia):
                    self.evaluar()
        self.politica = politica()
        for ahora in (
            "2026-10-22",
            "2026-10-22T10:00:00",
            "2026-10-22T12:00:00+02:00",
            True,
        ):
            with self.subTest(ahora=ahora), self.assertRaises(ErrorVigencia):
                self.evaluar(ahora=ahora)

    def test_no_mutacion_orden_reproducible_e_idempotencia(self) -> None:
        """Comprueba no mutacion orden reproducible e idempotencia."""
        self.observaciones += [catalogo(), fallo("2026-10-22T07:00:00Z")]
        originales = copy.deepcopy((OFERTA, self.observaciones, self.politica))
        uno = self.evaluar()
        self.observaciones.reverse()
        dos = self.evaluar()
        self.assertEqual(uno, dos)
        self.observaciones.reverse()
        self.assertEqual((OFERTA, self.observaciones, self.politica), originales)
        self.assertEqual(self.evaluar(), uno)
        uno["trazabilidad"]["evidencias"][0]["url"] = "alterada en retorno"
        self.assertEqual((OFERTA, self.observaciones, self.politica), originales)

    def test_observaciones_simultaneas_discrepantes_no_eligen_una_por_orden(self) -> None:
        """Comprueba observaciones simultaneas discrepantes no eligen una por orden."""
        otra = ficha(identificador="discrepante")
        otra["detalle"]["datos_edicion"]["estado_inscripcion"] = "cerrada"
        self.observaciones.append(otra)
        uno = self.evaluar()
        self.observaciones.reverse()
        self.assertEqual(uno, self.evaluar())
        self.assertEqual(uno["estado"], "sin-confirmar")
        self.assertIn("fichas_simultaneas_discrepantes", uno["motivos"])

    def test_catalogo_de_otra_oferta_y_id_duplicado_se_rechazan(self) -> None:
        """Comprueba catalogo de otra oferta y id duplicado se rechazan."""
        self.observaciones.append(catalogo())
        self.observaciones[-1]["detalle"]["identidad_buscada"] = "otra-oferta"
        with self.assertRaises(ErrorVigencia):
            self.evaluar()
        self.observaciones = [ficha(), ficha()]
        with self.assertRaises(ErrorVigencia):
            self.evaluar()

    def test_no_reloj_red_o_sqlite_y_el_validador_de_fichas_se_ejecuta(self) -> None:
        """Comprueba no reloj red o sqlite y el validador de fichas se ejecuta."""
        with (
            patch("time.time", side_effect=AssertionError("reloj oculto")),
            patch("socket.socket", side_effect=AssertionError("red")),
            patch("sqlite3.connect", side_effect=AssertionError("SQLite")),
        ):
            self.assertEqual(self.evaluar()["estado"], "disponible-publicamente")
        with (
            patch(
                "plataforma_datos.cursos.vigencia.validar_datos_edicion",
                side_effect=ErrorVigencia("validación inyectada"),
            ),
            self.assertRaisesRegex(ErrorVigencia, "validación inyectada"),
        ):
            self.evaluar()

    def test_esquema_publicado_coincide_con_campos_y_vocabularios_ejecutados(self) -> None:
        """Comprueba esquema publicado coincide con campos y vocabularios ejecutados."""
        esquema = json.loads(
            (Path(__file__).resolve().parent.parent / "esquemas" / "contrato_vigencia.json").read_text()
        )
        defs = esquema["$defs"]
        for nombre, campos in [
            ("oferta", CAMPOS_OFERTA),
            ("politica", tuple(c for c in CAMPOS_POLITICA if c != "plazo_tecnico")),
            ("observacion", CAMPOS_OBSERVACION),
            ("evidencia", CAMPOS_EVIDENCIA),
        ]:
            with self.subTest(nombre=nombre):
                self.assertEqual(set(defs[nombre]["required"]), set(campos))
                self.assertFalse(defs[nombre]["additionalProperties"])
        # La entrada del evaluador exige el plazo técnico; el registro histórico cita
        # políticas anteriores por $defs/politica y por eso allí es opcional.
        entrada = esquema["properties"]["politica"]["allOf"]
        self.assertEqual(entrada[0], {"$ref": "#/$defs/politica"})
        self.assertEqual(set(defs["politica"]["required"]) | set(entrada[1]["required"]), set(CAMPOS_POLITICA))
        self.assertEqual(defs["politica"]["properties"]["plazo_tecnico"]["const"], "revision_interna")
        self.assertEqual(defs["resultado"]["properties"]["estado"]["enum"], list(ESTADOS))
        self.assertEqual(defs["resultado"]["properties"]["schema_version"]["const"], 2)
        self.assertEqual(set(defs["resultado"]["required"]), set(self.evaluar()))
        self.assertEqual(defs["evidencia"]["properties"]["alcance"]["enum"], list(ALCANCES_EVIDENCIA))
        # No basta con que el esquema exista: evaluar_vigencia ejecuta el contrato.
        with (
            patch(
                "plataforma_datos.cursos.vigencia.validar_entrada",
                side_effect=ErrorVigencia("contrato inyectado"),
            ),
            self.assertRaisesRegex(ErrorVigencia, "contrato inyectado"),
        ):
            self.evaluar()

    def test_fallo_catalogo_no_amplia_la_revision_positiva_previa(self) -> None:
        """Un fallo de catálogo no rejuvenece su comprobación ni aplaza la revisión."""
        self.politica.update(requiere_catalogo=True, ttl_catalogo_segundos=43200)
        self.observaciones.append(catalogo())
        previa = self.evaluar()
        self.observaciones.append(fallo(tipo="catalogo"))
        posterior = self.evaluar()
        self.assertEqual(previa["revisar_el"], "2026-10-22T20:00:00Z")
        self.assertEqual(posterior["revisar_el"], previa["revisar_el"])
        self.assertEqual(posterior["ultimo_intento_fallido_el"], "2026-10-22T09:00:00Z")
        self.assertEqual(posterior["estado"], "disponible-publicamente")
        self.assertEqual(
            posterior["trazabilidad"]["catalogo"]["ultima_positiva_el"],
            "2026-10-22T08:00:00Z",
        )

    def test_terminar_mas_tarde_no_refresca_una_captura_antigua(self) -> None:
        """Comprueba terminar mas tarde no refresca una captura antigua."""
        self.observaciones[0]["terminado_el"] = "2026-10-22T09:30:00Z"
        resultado = self.evaluar()
        self.assertEqual(resultado["comprobado_el"], "2026-10-22T08:00:00Z")
        self.assertEqual(resultado["revisar_el"], "2026-10-23T08:00:00Z")

    def test_periodo_invertido_del_normalizador_no_se_oculta_como_curso_abierto(self) -> None:
        """Comprueba periodo invertido del normalizador no se oculta como curso abierto."""
        self.observaciones = [
            ficha(
                fuente={
                    "estado": "actual_matricula_abierta",
                    "fechas_matricula": ["2026-10-24", "2026-10-21"],
                }
            )
        ]
        datos = self.observaciones[0]["detalle"]["datos_edicion"]
        self.assertEqual(datos["fechas_matricula"], {"inicio": None, "fin": None})
        self.assertTrue(datos["diagnosticos_normalizacion"])
        resultado = self.evaluar()
        self.assertEqual(resultado["estado"], "sin-confirmar")
        self.assertIn("calendario_publicado_no_resuelto", resultado["motivos"])

    def test_fallo_ficha_no_extiende_plazo_publicado_ya_conocido(self) -> None:
        """Comprueba fallo ficha no extiende plazo publicado ya conocido."""
        self.observaciones = [
            ficha(
                fuente={
                    "estado": "actual_matricula_abierta",
                    "fechas_matricula": {"fin": "2026-10-22T12:00Z"},
                },
                abierto=False,
            )
        ]
        previa = self.evaluar()
        self.observaciones.append(fallo())
        posterior = self.evaluar()
        self.assertEqual(previa["cierra_el"], "2026-10-22T12:00:00Z")
        self.assertEqual(posterior["cierra_el"], previa["cierra_el"])
        self.assertEqual(posterior["estado"], "disponible-publicamente")

    def test_intento_y_comprobacion_son_fechas_distintas_y_catalogo_sin_ttl_no_se_inventa(self) -> None:
        """Comprueba intento y comprobacion son fechas distintas y catalogo sin ttl no se inventa."""
        self.observaciones[0]["intentado_el"] = "2026-10-22T07:59:00Z"
        resultado = self.evaluar()
        self.assertEqual(resultado["ultimo_intento_el"], "2026-10-22T07:59:00Z")
        self.assertEqual(resultado["comprobado_el"], "2026-10-22T08:00:00Z")
        self.assertIsNone(resultado["trazabilidad"]["politica"]["ttl_catalogo_segundos"])
        self.politica["requiere_catalogo"] = True
        with self.assertRaisesRegex(ErrorVigencia, "TTL propio"):
            self.evaluar()

    def test_revision_matricula_activa_no_oculta_acceso_terminado(self) -> None:
        """Comprueba revision matricula activa no oculta acceso terminado."""
        self.observaciones = [
            ficha(
                fuente={
                    "estado": "actual_matricula_abierta",
                    "fechas_matricula": ["2026-10-01T00:00Z", "2026-10-30T00:00Z"],
                    "fechas_aula": ["2026-10-01T00:00Z", "2026-10-21T00:00Z"],
                },
                abierto=False,
            )
        ]
        resultado = self.evaluar()
        self.assertEqual(resultado["estado"], "sin-confirmar")
        self.assertEqual(resultado["cierra_el"], "2026-10-21T00:00:00Z")
        self.assertIn("fuente_contradictoria_matricula_abierta_y_acceso_finalizado", resultado["motivos"])

    def test_revision_captura_08_fin_0801_es_valida_y_no_rejuvenece(self) -> None:
        """Comprueba revision captura 08 fin 0801 es valida y no rejuvenece."""
        self.observaciones[0].update(intentado_el="2026-10-22T07:59:00Z", terminado_el="2026-10-22T08:01:00Z")
        resultado = self.evaluar()
        self.assertEqual(resultado["estado"], "disponible-publicamente")
        self.assertEqual(resultado["comprobado_el"], "2026-10-22T08:00:00Z")
        self.assertEqual(resultado["revisar_el"], "2026-10-23T08:00:00Z")
        self.assertEqual(resultado["ultimo_fin_el"], "2026-10-22T08:01:00Z")

    def test_revision_captura_vencida_no_se_refresca_al_terminar_proceso(self) -> None:
        """Comprueba revision captura vencida no se refresca al terminar proceso."""
        self.politica["ttl_ficha_segundos"] = 3600
        self.observaciones[0].update(intentado_el="2026-10-22T07:59:00Z", terminado_el="2026-10-22T09:30:00Z")
        resultado = self.evaluar()
        self.assertEqual(resultado["estado"], "disponible-publicamente")
        self.assertEqual(resultado["comprobado_el"], "2026-10-22T08:00:00Z")
        self.assertEqual(resultado["revisar_el"], "2026-10-22T09:00:00Z")

    def test_revision_multipagina_caduca_cada_apoyo_por_su_captura(self) -> None:
        """Comprueba revision multipagina caduca cada apoyo por su captura."""
        self.politica["ttl_ficha_segundos"] = 3600
        fuente = {
            "estado": "actual_matricula_abierta",
            "fechas_matricula": {"fin": "2026-10-30T00:00Z"},
        }
        self.observaciones = [ficha(fuente=fuente, abierto=False)]
        o = self.observaciones[0]
        o.update(intentado_el="2026-10-22T07:57:00Z", terminado_el="2026-10-22T08:10:00Z")
        for e in o["evidencias"]:
            e["capturado_utc"] = {
                "identidad": "2026-10-22T08:00:00Z",
                "disponibilidad": "2026-10-22T08:01:00Z",
                "calendario": "2026-10-22T07:58:00Z",
            }[e["alcance"]]
        soporte = next(e for e in o["evidencias"] if e["localizador"]["valor"] == "/fechas_matricula")
        fuente["vinculos_calendarios"] = {
            "fechas_matricula": {
                "tipo": "id",
                "valor": OFERTA["id"],
                "edicion": {"id": OFERTA["id"], "url": OFERTA["url"]},
                "evidencia": {k: copy.deepcopy(v) for k, v in soporte.items() if k != "alcance"},
            }
        }
        o["detalle"]["datos_edicion"] = normalizar_datos_edicion(fuente)
        resultado = self.evaluar(ahora="2026-10-22T08:59:00Z")
        self.assertEqual(resultado["estado"], "disponible-publicamente")
        self.assertEqual(resultado["comprobado_el"], "2026-10-22T07:58:00Z")
        self.assertEqual(resultado["revisar_el"], "2026-10-22T08:58:00Z")
        self.assertEqual(resultado["cierra_el"], "2026-10-30T00:00:00Z")

    def test_revision_procesamiento_lento_no_sustituye_cierre_mas_reciente(self) -> None:
        """Comprueba revision procesamiento lento no sustituye cierre mas reciente."""
        self.observaciones[0].update(intentado_el="2026-10-22T07:59:00Z", terminado_el="2026-10-22T09:45:00Z")
        cierre = ficha("2026-10-22T09:00:00Z", identificador="cierre")
        cierre["detalle"]["datos_edicion"]["estado_inscripcion"] = "cerrada"
        cierre["terminado_el"] = "2026-10-22T09:10:00Z"
        self.observaciones.append(cierre)
        resultado = self.evaluar()
        self.assertEqual(resultado["estado"], "no-disponible-publicamente")
        self.assertEqual(resultado["comprobado_el"], "2026-10-22T09:00:00Z")
        self.observaciones.reverse()
        self.assertEqual(resultado, self.evaluar())

    def test_revision_recuperacion_ordena_captura_no_fin_del_proceso(self) -> None:
        """Comprueba revision recuperacion ordena captura no fin del proceso."""
        caida = fallo("2026-10-22T09:00:00Z")
        caida["terminado_el"] = "2026-10-22T09:15:00Z"
        recuperacion = ficha("2026-10-22T09:30:00Z", identificador="recuperacion")
        recuperacion["terminado_el"] = "2026-10-22T09:40:00Z"
        self.observaciones += [caida, recuperacion]
        resultado = self.evaluar()
        self.assertEqual(resultado["estado"], "disponible-publicamente")
        self.assertEqual(resultado["comprobado_el"], "2026-10-22T09:30:00Z")

    def test_revision_apoyos_solapados_discrepantes_quedan_pendientes(self) -> None:
        """Comprueba revision apoyos solapados discrepantes quedan pendientes."""
        primero = self.observaciones[0]
        primero["terminado_el"] = "2026-10-22T09:30:00Z"
        otra_evidencia = copy.deepcopy(primero["evidencias"][1])
        otra_evidencia["capturado_utc"] = "2026-10-22T09:00:00Z"
        primero["evidencias"].append(otra_evidencia)
        cierre = ficha("2026-10-22T08:30:00Z", identificador="cierre-intermedio")
        cierre["detalle"]["datos_edicion"]["estado_inscripcion"] = "cerrada"
        self.observaciones.append(cierre)
        resultado = self.evaluar()
        self.assertEqual(resultado["estado"], "sin-confirmar")
        self.observaciones.reverse()
        self.assertEqual(resultado, self.evaluar())

    def test_revision_ventana_futura_y_periodo_formativo_no_se_confunden(self) -> None:
        """Comprueba revision ventana futura y periodo formativo no se confunden."""
        fuente = {
            "estado": "actual_matricula_abierta",
            "fechas_matricula": ["2026-10-01T00:00Z", "2026-10-30T00:00Z"],
        }
        for campo, estado in [
            ("fechas_aula", "disponible-publicamente"),
            ("fechas_edicion", "disponible-publicamente"),
        ]:
            with self.subTest(campo=campo):
                datos = {**fuente, campo: ["2026-10-23T00:00Z", "2026-11-01T00:00Z"]}
                self.observaciones = [ficha(fuente=datos, abierto=False)]
                self.assertEqual(self.evaluar()["estado"], estado)

    def test_matricula_actual_y_acceso_futuro_son_decisiones_distintas(self) -> None:
        """Comprueba matricula actual y acceso futuro son decisiones distintas."""
        fuente = {
            "estado": "actual_matricula_abierta",
            "fechas_aula": ["2026-10-23T00:00Z", "2026-11-01T00:00Z"],
        }
        self.observaciones = [ficha(fuente=fuente, abierto=False)]
        self.assertEqual(self.evaluar()["estado"], "apertura-futura")
        fuente["fechas_matricula"] = ["2026-10-01T00:00Z", "2026-10-30T00:00Z"]
        self.observaciones = [ficha(fuente=fuente, abierto=False)]
        resultado = self.evaluar()
        self.assertEqual(resultado["estado"], "disponible-publicamente")
        self.assertIn("matricula_abierta_con_contenido_de_acceso_futuro", resultado["motivos"])
        fuente["fechas_matricula"] = ["2026-10-23T00:00Z", "2026-10-30T00:00Z"]
        self.observaciones = [ficha(fuente=fuente, abierto=False)]
        self.assertEqual(self.evaluar()["estado"], "apertura-futura")

    def test_revision_catalogo_caduca_por_captura_no_por_procesamiento(self) -> None:
        """Comprueba revision catalogo caduca por captura no por procesamiento."""
        self.politica.update(requiere_catalogo=True, ttl_catalogo_segundos=3600)
        self.observaciones = [ficha("2026-10-22T09:30:00Z"), catalogo()]
        self.observaciones[1].update(intentado_el="2026-10-22T07:59:00Z", terminado_el="2026-10-22T09:30:00Z")
        resultado = self.evaluar()
        self.assertEqual(resultado["estado"], "disponible-publicamente")
        self.assertEqual(resultado["revisar_el"], "2026-10-22T09:00:00Z")
        self.assertEqual(
            resultado["trazabilidad"]["catalogo"]["ultima_positiva_el"],
            "2026-10-22T08:00:00Z",
        )
        self.assertEqual(
            resultado["trazabilidad"]["catalogo"]["ultimo_fin_el"],
            "2026-10-22T09:30:00Z",
        )

    def test_revision_causalidad_se_sigue_validando_con_capturas_distintas(self) -> None:
        """Comprueba revision causalidad se sigue validando con capturas distintas."""
        for fecha in ("2026-10-22T07:58:00Z", "2026-10-22T08:02:00Z"):
            with self.subTest(fecha=fecha):
                self.observaciones = [ficha()]
                self.observaciones[0].update(
                    intentado_el="2026-10-22T07:59:00Z",
                    terminado_el="2026-10-22T08:01:00Z",
                )
                self.observaciones[0]["evidencias"][0]["capturado_utc"] = fecha
                with self.assertRaisesRegex(ErrorVigencia, "intervalo"):
                    self.evaluar()

    def test_revision_invariante_de_disponibilidad_en_calendarios_combinados(self) -> None:
        """Comprueba revision invariante de disponibilidad en calendarios combinados."""
        positivos = 0
        for ttl in (3600, 10800, 86400):
            self.politica["ttl_ficha_segundos"] = ttl
            for fin_matricula in (
                "2026-10-21T00:00Z",
                "2026-10-22T10:00Z",
                "2026-10-30T00:00Z",
            ):
                for fin_acceso in (
                    "2026-10-21T00:00Z",
                    "2026-10-22T10:00Z",
                    "2026-10-30T00:00Z",
                ):
                    with self.subTest(ttl=ttl, matricula=fin_matricula, acceso=fin_acceso):
                        self.observaciones = [
                            ficha(
                                fuente={
                                    "estado": "actual_matricula_abierta",
                                    "fechas_matricula": {"fin": fin_matricula},
                                    "fechas_aula": {"fin": fin_acceso},
                                },
                                abierto=False,
                            )
                        ]
                        resultado = self.evaluar()
                        if resultado["estado"] == "disponible-publicamente":
                            positivos += 1
                            self.assertGreater(
                                datetime.fromisoformat(resultado["cierra_el"].replace("Z", "+00:00")),
                                datetime.fromisoformat(AHORA.replace("Z", "+00:00")),
                            )
        self.assertGreater(positivos, 0)

    def test_revision_calendario_nuevo_no_se_descarta_por_estado_antiguo(self) -> None:
        """Comprueba revision calendario nuevo no se descarta por estado antiguo."""
        fuente = {
            "estado": "actual_matricula_abierta",
            "fechas_matricula": {"fin": "2026-10-30T00:00Z"},
            "fechas_aula": {"fin": "2026-10-21T00:00Z"},
        }
        antigua = ficha(fuente=fuente, abierto=False)
        antigua["terminado_el"] = AHORA
        for e in antigua["evidencias"]:
            if e["alcance"] == "calendario":
                e["capturado_utc"] = AHORA
        fuente_nueva = {**fuente, "fechas_aula": {"fin": "2026-10-30T00:00Z"}}
        nueva = ficha(
            "2026-10-22T09:00:00Z",
            identificador="otra-comprobacion",
            fuente=fuente_nueva,
            abierto=False,
        )
        self.observaciones = [antigua, nueva]
        resultado = self.evaluar()
        self.assertEqual(resultado["estado"], "sin-confirmar")
        self.observaciones.reverse()
        self.assertEqual(resultado, self.evaluar())


if __name__ == "__main__":
    unittest.main()
