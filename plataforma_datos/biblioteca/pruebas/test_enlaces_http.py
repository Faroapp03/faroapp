"""Recepción HTTP acotada por objetivo, sin deducir identidad de status o negociación."""

import hashlib
import io
import json
import tempfile
import unittest
from datetime import UTC, datetime, timedelta
from http.client import HTTPResponse
from pathlib import Path
from unittest import mock
from urllib.error import HTTPError

from plataforma_datos.biblioteca.fuentes.enlaces_lecturas import contrato, lector
from plataforma_datos.comun import red
from plataforma_datos.comun.nucleo import Carpetas

URL = "https://ejemplo.invalid/publicacion"
HTML = b"<html><body>" + b"Contenido de prueba legible, nunca consulta remota real. " * 8 + b"</body></html>"
AHORA = datetime(2026, 10, 23, 9, tzinfo=UTC)


def respuesta(status: int, cabeceras: bytes = b"", final: str = URL) -> HTTPResponse:
    """Interpreta un status real y cabeceras sin abrir red.

    Returns:
        Respuesta de memoria lista para la función central.
    """
    conexion = mock.Mock()
    conexion.makefile.return_value = io.BytesIO(
        f"HTTP/1.1 {status} respuesta\r\n".encode() + cabeceras + b"\r\n" + HTML
    )
    recibida = HTTPResponse(conexion)
    recibida.begin()
    recibida.url = final
    return recibida


class PruebaRecepcionHTTPBiblioteca(unittest.TestCase):
    """Ejercita productor y lector central con sus límites y hechos realmente recibidos."""

    def setUp(self) -> None:
        """Aísla todo el almacenamiento y la identidad del transporte de prueba."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.base = Path(temporal.name)
        self.carpetas = Carpetas(*(self.base / nombre for nombre in ("original", "preparado", "validado")))
        for parche in (
            mock.patch.object(lector, "carpetas", return_value=self.carpetas),
            mock.patch.object(lector, "ahora", return_value=AHORA),
            mock.patch.object(red.perfil_web, "leer_perfil", return_value=red.perfil_web.perfil_chrome()),
            mock.patch.object(red, "PAUSAS", red.PausasPorDominio(lambda: 0.0, lambda _s: None)),
        ):
            parche.start()
            self.addCleanup(parche.stop)

    def test_206_y_content_range_con_casing_o_destino_generico_no_son_respuesta_completa(self) -> None:
        """Ninguna combinación de parcial y destino puede acreditar identidad o tapar una positiva."""
        for status, cabeceras, final in (
            (206, b"Content-Type: text/html\r\n", URL),
            (200, b"cOnTeNt-RaNgE: bytes 0-100/999\r\n", URL),
            (200, b"Content-Range: bytes 0-100/999\r\n", "https://ejemplo.invalid/"),
        ):
            with self.subTest(status=status, final=final):
                recibida = respuesta(status, cabeceras, final)
                with (
                    mock.patch.object(red, "abrir_peticion", return_value=recibida),
                    mock.patch.object(recibida, "read1", wraps=recibida.read1) as leer,
                ):
                    captura, descarga, hechos = lector._recibir(URL)
                    leer.assert_not_called()
                self.assertEqual(captura.resultado, "fallo_temporal")
                self.assertEqual(captura.error_tipo, "RespuestaParcial")
                self.assertIsNone(descarga)
                self.assertEqual(hechos["codigo_http"], status)
                self.assertEqual(hechos["url_final"], final)
                self.assertFalse(hechos["cuerpo_completo"])
                self.assertTrue(recibida.isclosed())

    def test_tope_ocho_mib_esta_en_el_lector_central_y_no_solo_en_pdf(self) -> None:
        """La cabecera excesiva se rechaza antes de solicitar el cuerpo."""
        recibida = respuesta(200, f"Content-Length: {lector.MAX_BYTES + 1}\r\n".encode())
        with (
            mock.patch.object(red, "abrir_peticion", return_value=recibida),
            mock.patch.object(recibida, "read1", wraps=recibida.read1) as leer,
        ):
            captura, descarga, hechos = lector._recibir(URL)
            leer.assert_not_called()
        self.assertEqual(captura.resultado, "fallo_temporal")
        self.assertIsNone(descarga)
        self.assertEqual(captura.error_tipo, "LimiteDescargaExcedido")
        self.assertEqual(contrato.evaluar(captura, None, None, contrato.Contexto(AHORA, 7))["estado"], "limite_tamano")
        self.assertFalse(hechos["cuerpo_completo"])
        self.assertTrue(recibida.isclosed())

    def test_hechos_http_inmutables_ligados_a_captura_sin_cookies(self) -> None:
        """El inventario propio conserva status y cabeceras técnicas, no secretos del servidor."""
        recibida = respuesta(200, b"CONTENT-TYPE: text/html\r\nSet-Cookie: secreto=1\r\n")
        with mock.patch.object(red, "abrir_peticion", return_value=recibida):
            captura, descarga, hechos = lector._recibir(URL)
        self.assertIsNotNone(descarga)
        self.assertEqual(captura.content_type, "text/html")
        self.assertEqual(hechos["codigo_http"], 200)
        self.assertTrue(hechos["cuerpo_completo"])
        self.assertEqual(hechos["cabeceras"], {"content-type": ["text/html"]})
        lector.conservar(captura, descarga.datos)
        lector.conservar_http(captura, hechos)
        archivos = list((self.carpetas.original / "http").glob("*.json"))
        self.assertEqual(len(archivos), 1)
        antes = (archivos[0].read_bytes(), archivos[0].stat().st_mtime_ns)
        lector.conservar_http(captura, hechos)
        self.assertEqual(antes, (archivos[0].read_bytes(), archivos[0].stat().st_mtime_ns))
        documento = json.loads(antes[0])
        self.assertEqual(documento["captura_sha256"], hashlib.sha256(lector._bytes(lector.asdict(captura))).hexdigest())
        self.assertEqual(documento["finalizado_utc"], captura.capturado_utc)
        self.assertNotIn(b"secreto", antes[0])

    def test_html_sensible_a_idioma_y_pdf_no_negocian_es_por_defecto(self) -> None:
        """Variantes lingüísticas preservan negociación original; PDF no usa navegación HTML."""
        for url, esperado in ((URL, "navigate"), (URL + ".pdf", None)):
            with self.subTest(url=url), mock.patch.object(red, "abrir_peticion", return_value=respuesta(200)) as abrir:
                lector._recibir(url)
            cabeceras = {k.lower(): v for k, v in abrir.call_args.args[0].header_items()}
            self.assertNotIn("accept-language", cabeceras)
            self.assertEqual(cabeceras.get("sec-fetch-mode"), esperado)
            self.assertIn("user-agent", cabeceras)
            self.assertIn("sec-ch-ua", cabeceras)

    def test_parcial_generico_conserva_ultima_confirmacion_y_fecha(self) -> None:
        """El productor conserva la buena previa; parcial no demuestra pérdida de identidad."""
        from plataforma_datos.biblioteca.fuentes.enlaces_lecturas.contrato import Captura

        catalogo = self.base / "catalogo.json"
        catalogo.write_text(json.dumps({"lecturas": [{"id": "uno", "enlace": URL}]}))
        previa = (AHORA - timedelta(days=1)).isoformat()
        huella = hashlib.sha256(HTML).hexdigest()
        buena = Captura(
            url=URL,
            url_final=URL,
            capturado_utc=previa,
            cuerpo_sha256=huella,
            content_type="text/html",
            resultado="respuesta",
            codigo_http=None,
        )
        lector.conservar(buena, HTML)
        (self.carpetas.original / "identidades.json").write_text(
            json.dumps(
                {
                    "version": 1,
                    "decisiones": {
                        "uno:enlace": [
                            {
                                "url": URL,
                                "url_final": URL,
                                "cuerpo_sha256": huella,
                                "revisado_utc": previa,
                                "texto_sha256": None,
                            }
                        ]
                    },
                }
            )
        )
        for status in (200, 206):
            recibida = respuesta(status, b"Content-Range: bytes 0-100/999\r\n", "https://ejemplo.invalid/")
            with mock.patch.object(red, "abrir_peticion", return_value=recibida):
                captura, descarga, hechos = lector._recibir(URL)
            lector.conservar(captura, None)
            lector.conservar_http(captura, hechos)
            self.assertIsNone(descarga)
            with mock.patch.object(lector, "CATALOGO", catalogo):
                fila = lector._crear()["objetivos"][0]
            self.assertEqual(fila["estado"], "fallo_temporal")
            self.assertEqual(fila["ultima_confirmacion"]["capturado_utc"], previa)
            self.assertEqual(fila["ultima_confirmacion"]["cuerpo_sha256"], huella)

    def test_content_type_repetido_contrario_es_fallo_no_identidad(self) -> None:
        """Preserva ambas declaraciones; la diferencia de nombre no permite ocultar una contradicción."""
        recibida = respuesta(200, b"Content-Type: text/html\r\nCONTENT-TYPE: application/pdf\r\n")
        with mock.patch.object(red, "abrir_peticion", return_value=recibida):
            captura, descarga, hechos = lector._recibir(URL)
        self.assertEqual(captura.error_tipo, "CabecerasContradictorias")
        self.assertIsNone(descarga)
        self.assertEqual(hechos["cabeceras"]["content-type"], ["text/html", "application/pdf"])

    def test_destino_inseguro_conserva_el_diagnostico_antes_de_leer(self) -> None:
        """Un destino sin HTTPS queda registrado sin descargar ni atribuir una baja editorial."""
        destino = "http://ejemplo.invalid/publicacion"
        recibida = respuesta(200, final=destino)
        with (
            mock.patch.object(red, "abrir_peticion", return_value=recibida),
            mock.patch.object(recibida, "read1", wraps=recibida.read1) as leer,
        ):
            captura, descarga, hechos = lector._recibir(URL)
            leer.assert_not_called()
        self.assertEqual(captura.error_tipo, "DestinoNoSeguro")
        self.assertIsNone(descarga)
        self.assertEqual(hechos["url_final"], destino)
        self.assertFalse(hechos["cuerpo_completo"])
        self.assertEqual(
            contrato.evaluar(captura, None, None, contrato.Contexto(AHORA, 7))["estado"], "destino_no_seguro"
        )

    def test_errores_http_conservan_su_codigo_y_separan_url_ausente_de_fallo(self) -> None:
        """La recepción real del error conserva códigos sin convertir cortafuegos en retirada."""
        for codigo, esperado in (
            (404, "http_no_encontrado"),
            (410, "http_retirado"),
            (403, "http_error"),
            (503, "http_error"),
        ):
            with self.subTest(codigo=codigo):
                error = HTTPError(URL, codigo, "Respuesta de prueba", {}, io.BytesIO(b""))
                with mock.patch.object(red, "abrir_peticion", side_effect=error):
                    captura, descarga, hechos = lector._recibir(URL)
                self.assertIsNone(descarga)
                self.assertEqual(hechos["codigo_http"], codigo)
                self.assertEqual(contrato.evaluar(captura, None, None, contrato.Contexto(AHORA, 7))["estado"], esperado)
