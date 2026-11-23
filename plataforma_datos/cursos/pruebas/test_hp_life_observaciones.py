"""Comprobaciones HP sintéticas: identidad, inferencia declarada y edad real."""

import hashlib
import json
import unittest
from copy import deepcopy
from dataclasses import asdict, replace

from plataforma_datos.cursos import politicas_vigencia
from plataforma_datos.cursos.fuentes.hp_life import lector
from plataforma_datos.cursos.fuentes.hp_life import observaciones_vigencia as puente
from plataforma_datos.cursos.fuentes.hp_life.recepciones import leer_recepcion
from plataforma_datos.cursos.tipos_json import ObjetoJson
from plataforma_datos.cursos.vigencia import evaluar_vigencia

URL = "https://www.life-global.org/es/course/431"
OFERTA = {"id": "hp-life:431:es", "fuente_id": "hp_life", "url": URL}
INICIO = "2026-10-23T02:07:18.086369+00:00"
FIN = "2026-10-23T02:07:20.814607+00:00"
AHORA = "2026-10-23T03:00:00Z"


def negocio() -> ObjetoJson:
    """Define datos sintéticos de una inscripción pública que conduce al login.

    Returns:
        Hechos explícitos; los textos globales de interfaz no se usan.
    """
    return {
        "id": 431,
        "code": "COD-431",
        "name": "Curso sintético",
        "language": "es",
        "body": "<p>Contenido propio.</p>",
        "type": "SelfPaced",
        "privacyLevel": "Public",
        "status": "Published",
        "isGroupMembershipRequired": False,
        "requiresLicenseToEnroll": False,
        "externalProductLocations": [],
    }


def recepcion(datos: ObjetoJson | None = None, **cambios: object) -> tuple[bytes, bytes]:
    """Construye una respuesta completa sin simular que se descargó de Internet.

    Returns:
        Bytes de HTML sintético y recibo con hash e intervalo propios.
    """
    cuerpo = (
        '<script type="application/json" id="__NEXT_DATA__">'
        + json.dumps({"props": {"pageProps": {"initialCourseData": datos if datos is not None else negocio()}}})
        + "</script>"
    ).encode()
    cuerpo += "".join(f'<script src="{url}"></script>' for url, _sha in puente.SOPORTES_METODO).encode()
    sha = hashlib.sha256(cuerpo).hexdigest()
    captura = asdict(
        lector.CapturaHpLife(
            url_solicitada=URL,
            url_final=URL,
            localizador="ficha-sintetica",
            formato="html_next",
            sha256_cuerpo=sha,
            bytes_cuerpo=len(cuerpo),
            http=200,
            completo=True,
            original_conservado=True,
            sha256_respuesta=sha,
            recibido_utc=FIN,
        )
    )
    captura.update(cambios)
    recibo = {
        "captura": captura,
        "inicio_utc": INICIO,
        "content_type": "text/html; charset=utf-8",
        "representacion_hash": "Cuerpo descomprimido; no bytes del cable",
    }
    return cuerpo, json.dumps(recibo).encode()


class ObservacionesHpLifePruebas(unittest.TestCase):
    """Pruebas sin red, archivos del proveedor ni SQLite reales."""

    def observar(self, datos: ObjetoJson | None = None, **cambios: object) -> ObjetoJson:
        """Usa el contrato de recepción, no un booleano de acceso aportado por la prueba.

        Returns:
            Observación pura del método versionado.
        """
        return puente.construir_observacion(leer_recepcion(*recepcion(datos, **cambios)), oferta=OFERTA)

    def evaluar(self, observaciones: list[ObjetoJson], ahora: str = AHORA) -> ObjetoJson:
        """Reutiliza el único evaluador con la política interna real.

        Returns:
            Resultado sin activar ni publicar.
        """
        return evaluar_vigencia(OFERTA, observaciones, politicas_vigencia.leer_politica("hp_life", "2"), ahora=ahora)

    def test_recurso_abierto_sin_edicion_ni_fecha_no_exige_calendario(self) -> None:
        """La inferencia acreditada conduce al login; no promete plaza, precio o acceso personal."""
        obs = self.observar()
        resultado = self.evaluar([obs])
        self.assertEqual(resultado["estado"], "disponible-publicamente")
        self.assertEqual(resultado["comprobado_el"], "2026-10-23T02:07:20.814607Z")
        self.assertEqual(resultado["revisar_el"], "2026-10-24T02:07:20.814607Z")
        self.assertIsNone(resultado["cierra_el"])
        self.assertIsNone(obs["detalle"]["datos_edicion"]["coste_formacion_tipo"])
        self.assertNotIn("faq", json.dumps(obs))

    def test_ausencias_restricciones_y_fecha_no_confirmada_no_fabrican_apertura(self) -> None:
        """Sin fundamento de la regla, identidad leída no equivale a disponibilidad."""
        for campo, valor in (
            ("isGroupMembershipRequired", True),
            ("requiresLicenseToEnroll", True),
            ("productId", "licencia"),
            ("externalProductLocations", [{}]),
            ("externalProductLocations", None),
            ("privacyLevel", "Unlisted"),
            ("type", "InstructorLed"),
            ("startDate", "2027-01-01"),
            ("isGroupMembershipRequired", None),
        ):
            with self.subTest(campo=campo, valor=valor):
                self.assertEqual(self.evaluar([self.observar(negocio() | {campo: valor})])["estado"], "sin-confirmar")

    def test_archivo_identificado_es_evidencia_contraria_no_fallo_tecnico(self) -> None:
        """Un estado Archived de esta identidad no se oculta detrás de una captura antigua abierta."""
        antigua = self.observar()
        cerrada = self.observar(negocio() | {"status": "Archived"}, recibido_utc="2026-10-23T02:10:00Z")
        self.assertEqual(self.evaluar([antigua, cerrada])["estado"], "no-disponible-publicamente")

    def test_error_y_parcial_conservan_confirmacion_sin_renovar_ni_retirar(self) -> None:
        """Una respuesta técnica nueva conserva la edad real y no retira al pasar la revisión."""
        buena = self.observar()
        for cambios in ({"http": 503}, {"http": 206}, {"completo": False}, {"http": 403}):
            intento = self.observar(**cambios, recibido_utc="2026-10-23T02:10:00Z")
            with self.subTest(cambios=cambios):
                actual = self.evaluar([buena, intento])
                self.assertEqual(actual["estado"], "disponible-publicamente")
                self.assertEqual(actual["comprobado_el"], "2026-10-23T02:07:20.814607Z")
                pasada = self.evaluar([buena, intento], "2026-10-24T02:07:20.814607Z")
                self.assertEqual(pasada["estado"], "disponible-publicamente")
                self.assertEqual(pasada["comprobado_el"], "2026-10-23T02:07:20.814607Z")
                self.assertEqual(pasada["revisar_el"], "2026-10-24T02:07:20.814607Z")

    def test_repeticion_idempotente_y_mismo_cuerpo_consultado_otro_dia_no_se_funden(self) -> None:
        """El ID liga metadatos completos, no solo el cuerpo; no reescribe la fecha anterior."""
        primera = self.observar()
        otra = self.observar(recibido_utc="2026-10-23T02:11:00Z")
        self.assertEqual(primera, self.observar())
        self.assertNotEqual(primera["id"], otra["id"])
        original = deepcopy([primera, otra])
        self.assertEqual(self.evaluar(original), self.evaluar(original[::-1]))
        self.assertEqual(original, [primera, otra])

    def test_recibo_corrupto_duplicado_antiguo_o_incompleto_no_se_adapta(self) -> None:
        """El recibo plano histórico no adquiere completitud por HTTP200 u original_conservado."""
        cuerpo, recibo = recepcion()
        for malo in (recibo + b" ", b"{}", recibo.replace(b'"http": 200', b'"http": 200, "http": 200')):
            if malo == recibo + b" ":
                # JSON admite whitespace: la identidad del recibo conserva esos bytes distintos.
                self.assertNotEqual(
                    leer_recepcion(cuerpo, malo).sha256_recibo, leer_recepcion(cuerpo, recibo).sha256_recibo
                )
                continue
            with self.subTest(recibo=malo[:100]), self.assertRaises(lector.ErrorFichaHpLife):
                leer_recepcion(cuerpo, malo)
        with self.assertRaises(lector.ErrorFichaHpLife):
            leer_recepcion(cuerpo + b"x", recibo)
        with self.assertRaises(lector.ErrorFichaHpLife):
            leer_recepcion(*recepcion(recibido_utc="2026-10-22T01:00:00Z"))

    def test_lectura_literal_distingue_producto_ausente_y_null(self) -> None:
        """La semántica falsy del JS se declara sin convertirla en gratuidad universal."""
        ausente = leer_recepcion(*recepcion())
        presente = leer_recepcion(*recepcion(negocio() | {"productId": None}))
        self.assertFalse(lector.extraer_ficha(ausente.cuerpo, ausente.captura).producto_declarado)
        self.assertTrue(lector.extraer_ficha(presente.cuerpo, presente.captura).producto_declarado)

    def test_no_se_reescribe_la_completitud_fuera_del_recibo(self) -> None:
        """Un objeto Python alterado no sustituye lo que acredita la recepción original."""
        original = leer_recepcion(*recepcion(completo=False))
        alterada = replace(original, captura=replace(original.captura, completo=True))
        with self.assertRaisesRegex(lector.ErrorFichaHpLife, "metadatos originales"):
            puente.construir_observacion(alterada, oferta=OFERTA)

    def test_cambio_de_codigo_oficial_no_hereda_inferencia_anterior(self) -> None:
        """Otro paquete construido exige contrastar su semántica; la ficha sigue siendo legible y conocida."""
        cuerpo, recibo = recepcion()
        cuerpo = cuerpo.replace(b"314db3a8a9fd4aee", b"0000000000000000")
        meta = json.loads(recibo)
        meta["captura"].update(
            sha256_cuerpo=hashlib.sha256(cuerpo).hexdigest(), sha256_respuesta=hashlib.sha256(cuerpo).hexdigest()
        )
        obs = puente.construir_observacion(leer_recepcion(cuerpo, json.dumps(meta).encode()), oferta=OFERTA)
        self.assertEqual(obs["detalle"]["identidad_observada"], OFERTA["id"])
        self.assertIsNone(obs["detalle"]["acceso_abierto"])
        self.assertEqual(self.evaluar([obs])["estado"], "sin-confirmar")
