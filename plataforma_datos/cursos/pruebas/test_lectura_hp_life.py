"""Regresiones de integridad, identidad, alcance y lectura íntegra de HP LIFE."""

import dataclasses
import hashlib
import json
import unittest

from plataforma_datos.cursos.fuentes.hp_life.lector import (
    CapturaHpLife,
    ErrorFichaHpLife,
    extraer_condiciones_generales,
    extraer_ficha,
)
from plataforma_datos.cursos.tipos_json import ObjetoJson

URL = "https://www.life-global.org/es/course/431"
FECHA = "2026-10-22T16:11:37+00:00"


def _datos() -> ObjetoJson:
    return {
        "id": 431,
        "code": "HPL-ES41",
        "name": "Curso de prueba",
        "language": "es",
        "body": '<p>Texto <a href="https://ejemplo.test">enlace</a> y final.</p>\n<p>Segundo párrafo.</p>',
    }


def _cuerpo(datos: ObjetoJson) -> bytes:
    return json.dumps({"props": {"pageProps": {"initialCourseData": datos}}}).encode()


def _captura(cuerpo: bytes) -> CapturaHpLife:
    return CapturaHpLife(
        url_solicitada=URL,
        url_final=URL,
        localizador="captura-prueba",
        formato="json_next",
        sha256_cuerpo=hashlib.sha256(cuerpo).hexdigest(),
        bytes_cuerpo=len(cuerpo),
        http=200,
        completo=True,
        original_conservado=False,
        sha256_respuesta="a" * 64,
        recibido_utc=FECHA,
    )


class TestLecturaHpLife(unittest.TestCase):
    """Casos independientes sin red, rutas, SQLite ni reloj del sistema."""

    def test_cuerpo_integro_y_ausencias_desconocidas(self) -> None:
        """No corta tras enlaces ni convierte silencio en gratuidad o requisitos negativos."""
        datos = _datos()
        cuerpo = _cuerpo(datos)
        ficha = extraer_ficha(cuerpo, _captura(cuerpo))
        self.assertEqual(ficha.cuerpo_html, datos["body"])
        self.assertEqual(ficha.id, "hp-life:431:es")
        self.assertIsNone(ficha.certificado)
        self.assertIsNone(ficha.requiere_licencia)
        self.assertIsNone(ficha.precios_curso)
        self.assertIsNone(ficha.costes_practica)
        self.assertIsNone(ficha.inicio_publicado)
        self.assertIsNone(ficha.destinatarios_curso)

    def test_explicitos_no_son_inferencias(self) -> None:
        """False explícito, duración cero y fechas publicadas se preservan literalmente."""
        datos = _datos() | {"requiresLicenseToEnroll": False, "hasCertificate": True, "duration": "00:00:00"}
        cuerpo = _cuerpo(datos)
        ficha = extraer_ficha(cuerpo, _captura(cuerpo))
        self.assertIs(ficha.requiere_licencia, False)
        self.assertIs(ficha.certificado, True)
        self.assertEqual(ficha.duracion_publicada, "00:00:00")
        self.assertIsNone(ficha.costes_practica)

    def test_html_next_no_necesita_interfaz(self) -> None:
        """La entrada HTML utiliza solo negocio Next y no exige mensajes de interfaz."""
        datos = _datos()
        cuerpo = b'<html><script id="__NEXT_DATA__" type="application/json">' + _cuerpo(datos) + b"</script></html>"
        captura = dataclasses.replace(_captura(cuerpo), formato="html_next")
        self.assertEqual(extraer_ficha(cuerpo, captura).titulo, datos["name"])

    def test_script_ausente_multiple_o_truncado(self) -> None:
        """No acepta HTML incompleto ni una elección ambigua de árbol."""
        script = b'<script id="__NEXT_DATA__" type="application/json">' + _cuerpo(_datos()) + b"</script>"
        for cuerpo in (b"<html></html>", script + script, script.removesuffix(b"</script>")):
            with self.subTest(cuerpo=cuerpo[:30]), self.assertRaises(ErrorFichaHpLife):
                extraer_ficha(cuerpo, dataclasses.replace(_captura(cuerpo), formato="html_next"))

    def test_movimiento_slug_conserva_identidad(self) -> None:
        """Un slug nuevo con el mismo identificador no crea otro programa."""
        cuerpo = _cuerpo(_datos())
        captura = dataclasses.replace(_captura(cuerpo), url_final=URL + "-otro-titulo")
        self.assertEqual(extraer_ficha(cuerpo, captura).id_fuente, 431)

    def test_identidad_y_urls_incompatibles(self) -> None:
        """Rechaza portada, otro curso, idioma distinto y destinos ajenos."""
        cuerpo = _cuerpo(_datos())
        for url in (
            URL.replace("431", "143"),
            URL.replace("/es/", "/en/"),
            "https://www.life-global.org/es",
            "https://otra.test/es/course/431",
        ):
            with self.subTest(url=url), self.assertRaises(ErrorFichaHpLife):
                extraer_ficha(cuerpo, dataclasses.replace(_captura(cuerpo), url_final=url))

    def test_id_numerico_no_booleano(self) -> None:
        """No admite True como identificador ni número como booleano publicado."""
        for datos in (_datos() | {"id": True}, _datos() | {"hasCertificate": 1}):
            cuerpo = _cuerpo(datos)
            with self.assertRaises(ErrorFichaHpLife):
                extraer_ficha(cuerpo, _captura(cuerpo))

    def test_sha_original_y_derivado_no_se_intercambian(self) -> None:
        """Los dos hashes son independientes y el cuerpo físico se verifica siempre."""
        cuerpo = _cuerpo(_datos())
        captura = _captura(cuerpo)
        self.assertNotEqual(extraer_ficha(cuerpo, captura).captura.sha256_cuerpo, captura.sha256_respuesta)
        for cambio in (
            {"sha256_cuerpo": "a" * 64},
            {"original_conservado": True},
            {"bytes_cuerpo": 1},
            {"completo": False},
            {"http": 500},
            {"http": None},
        ):
            with self.subTest(cambio=cambio), self.assertRaises(ErrorFichaHpLife):
                extraer_ficha(cuerpo, dataclasses.replace(captura, **cambio))
        original = dataclasses.replace(captura, original_conservado=True, sha256_respuesta=captura.sha256_cuerpo)
        self.assertTrue(extraer_ficha(cuerpo, original).captura.original_conservado)

    def test_fecha_declarada_no_es_recepcion(self) -> None:
        """Un extracto histórico no adquiere fecha de recepción por pasar por el lector."""
        cuerpo = json.dumps({"campos": _datos()}).encode()
        captura = dataclasses.replace(
            _captura(cuerpo),
            formato="curso_observado",
            recibido_utc=None,
            fecha_declarada_utc=FECHA,
            sha256_respuesta=None,
            http=None,
        )
        ficha = extraer_ficha(cuerpo, captura)
        self.assertFalse(ficha.arbol_next)
        self.assertIsNone(ficha.captura.recibido_utc)
        self.assertIsNone(ficha.captura.http)
        self.assertIs(ficha.captura.original_conservado, False)
        self.assertEqual(ficha.captura.fecha_declarada_utc, FECHA)
        for fecha in ("2026-10-22", "ayer", "2026-10-22T12:00:00+02:00"):
            with self.subTest(fecha=fecha), self.assertRaises(ErrorFichaHpLife):
                extraer_ficha(cuerpo, dataclasses.replace(captura, fecha_declarada_utc=fecha))

    def test_http_desconocido_no_disfraza_captura_nueva(self) -> None:
        """La excepción histórica no se aplica a recepción real u original conservado."""
        cuerpo = json.dumps({"campos": _datos()}).encode()
        captura = dataclasses.replace(_captura(cuerpo), formato="curso_observado", http=None)
        with self.assertRaises(ErrorFichaHpLife):
            extraer_ficha(cuerpo, captura)
        original = dataclasses.replace(
            captura,
            recibido_utc=None,
            original_conservado=True,
            sha256_respuesta=captura.sha256_cuerpo,
        )
        with self.assertRaises(ErrorFichaHpLife):
            extraer_ficha(cuerpo, original)

    def test_json_ambiguo_y_utf8_invalido(self) -> None:
        """No elige silenciosamente una clave duplicada o un número no JSON."""
        for cuerpo in (b'{"props":{},"props":{}}', b'{"props":NaN}', b"\xff"):
            with self.subTest(cuerpo=cuerpo), self.assertRaises(ErrorFichaHpLife):
                extraer_ficha(cuerpo, _captura(cuerpo))

    def test_destinatario_y_requisito_completos(self) -> None:
        """Secciones y declaraciones explícitas conservan texto después de enlaces."""
        html = (
            "<p>Este curso está dirigido a docentes.</p><h2>Requisitos</h2>"
            '<p>Leer <a href="x">guía</a> y crear cuenta.</p><p>Segundo requisito.</p>'
            "<h2>Contenido</h2><p>Practicar.</p>"
        )
        cuerpo = _cuerpo(_datos() | {"body": html})
        ficha = extraer_ficha(cuerpo, _captura(cuerpo))
        self.assertEqual([d.texto for d in ficha.destinatarios_curso or ()], ["Este curso está dirigido a docentes."])
        self.assertEqual(
            [d.texto for d in ficha.requisitos_curso or ()], ["Leer guía y crear cuenta.", "Segundo requisito."]
        )

    def test_general_no_es_del_curso_ni_precio_de_herramienta(self) -> None:
        """La FAQ aporta alcance general; no rellena requisitos o precio de prácticas."""
        html = (
            "<h3>Los cursos de HP LIFE son gratuitos</h3>"
            "<p>Son gratuitos para todas las personas en todas partes.</p>"
            "<h3>Inscribirse en un curso.</h3><p>Debe iniciar sesión para inscribirse.</p>"
            "<h3>Cómo obtener una Certificación de finalización.</h3><p>Complete todas las lecciones.</p>"
            "<h3>Administrar cuenta</h3><p>dato-privado-no-extraer</p>"
        )
        cuerpo_general = json.dumps({"props": {"pageProps": {"staticHelpTopics": html}}}).encode()
        captura_general = dataclasses.replace(
            _captura(cuerpo_general),
            url_solicitada="https://www.life-global.org/es/help",
            url_final="https://www.life-global.org/es/help",
        )
        generales = extraer_condiciones_generales(cuerpo_general, captura_general)
        cuerpo = _cuerpo(_datos())
        ficha = extraer_ficha(cuerpo, _captura(cuerpo), condiciones_generales=generales)
        self.assertIsNotNone(generales.destinatarios)
        self.assertIsNone(ficha.destinatarios_curso)
        self.assertIsNone(ficha.costes_practica)
        self.assertNotIn("dato-privado-no-extraer", repr(generales))
        self.assertEqual(generales.registro[0].alcance if generales.registro else None, "general")

    def test_no_inventa_destinatario_por_gratuidad(self) -> None:
        """Un encabezado de gratuidad sin público declarado deja destinatario desconocido."""
        cuerpo = b"<h3>Los cursos de HP LIFE son gratuitos</h3><p>Precio cero.</p>"
        captura = dataclasses.replace(
            _captura(cuerpo),
            formato="html_general_observado",
            url_solicitada="https://www.life-global.org/es/help",
            url_final="https://www.life-global.org/es/help",
        )
        generales = extraer_condiciones_generales(cuerpo, captura)
        self.assertIsNone(generales.destinatarios)
        self.assertIsNotNone(generales.gratuidad)

    def test_contenido_empresarial_no_es_condicion_de_acceso(self) -> None:
        """Público objetivo, precios y requisitos empresariales no se atribuyen al alumno."""
        html = (
            "<h2>Público objetivo</h2><p>Segmentar clientes.</p>"
            "<h2>Precios</h2><p>Fijar el precio del producto.</p>"
            "<h2>Requisitos de financiación</h2><p>Estudiar préstamos.</p>"
        )
        cuerpo = _cuerpo(_datos() | {"body": html})
        ficha = extraer_ficha(cuerpo, _captura(cuerpo))
        self.assertIsNone(ficha.destinatarios_curso)
        self.assertIsNone(ficha.requisitos_curso)
        self.assertIsNone(ficha.precios_curso)

    def test_registro_precio_y_practica_separados(self) -> None:
        """Una tarifa de prácticas explícita no cambia el precio declarado del curso."""
        html = (
            "<h2>Precio del curso</h2><p>Curso gratuito.</p>"
            "<h2>Registro</h2><p>Crear cuenta para inscribirse.</p>"
            "<h2>Costes de práctica</h2><p>La herramienta externa cuesta 10 EUR.</p>"
        )
        cuerpo = _cuerpo(_datos() | {"body": html})
        ficha = extraer_ficha(cuerpo, _captura(cuerpo))
        self.assertEqual([d.texto for d in ficha.precios_curso or ()], ["Curso gratuito."])
        self.assertEqual([d.texto for d in ficha.registro_curso or ()], ["Crear cuenta para inscribirse."])
        self.assertEqual([d.texto for d in ficha.costes_practica or ()], ["La herramienta externa cuesta 10 EUR."])

    def test_localizador_no_admite_ruta(self) -> None:
        """El contrato no requiere ni acepta una ruta del ordenador de captura."""
        cuerpo = _cuerpo(_datos())
        for localizador in ("/tmp/curso.json", "../curso.json", "a\\curso.json"):
            with self.subTest(localizador=localizador), self.assertRaises(ErrorFichaHpLife):
                extraer_ficha(cuerpo, dataclasses.replace(_captura(cuerpo), localizador=localizador))

    def test_resultado_inmutable_y_repetible(self) -> None:
        """La misma entrada produce el mismo resultado y no permite mutación posterior."""
        cuerpo = _cuerpo(_datos())
        captura = _captura(cuerpo)
        ficha = extraer_ficha(cuerpo, captura)
        self.assertEqual(ficha, extraer_ficha(cuerpo, captura))
        with self.assertRaises(dataclasses.FrozenInstanceError):
            ficha.titulo = "otro"


if __name__ == "__main__":
    unittest.main()
