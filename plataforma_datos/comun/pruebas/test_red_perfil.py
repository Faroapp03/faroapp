"""Perfil de navegación y compresión comprobados sin abrir conexiones."""

import gzip
import hashlib
import io
import json
import tempfile
import unittest
import zlib
from email.message import Message
from pathlib import Path
from unittest import mock

from plataforma_datos.comun import red
from plataforma_datos.comun.nucleo import FormatoInesperado

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36"
PISTAS = '"Not:A-Brand";v="8", "Chromium";v="156", "Google Chrome";v="156"'
PISTAS_157 = '"Not-A.Brand";v="99", "Google Chrome";v="157", "Chromium";v="157"'
HTML = "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8"


def configuracion(agente: str = UA, pistas: str = PISTAS) -> str:
    """Construye la configuración de prueba, sin leer la del equipo.

    Returns:
        Configuración portable con las cuatro cabeceras de identidad.
    """
    return json.dumps(
        {
            "version": 1,
            "identidad": {
                "User-Agent": agente,
                "sec-ch-ua": pistas,
                "sec-ch-ua-mobile": "?0",
                "sec-ch-ua-platform": '"Windows"',
            },
        }
    )


class PruebaPerfilWeb(unittest.TestCase):
    """Comprueba lo que recibe el transporte y el cuerpo que llega a los lectores."""

    def setUp(self) -> None:
        """Prepara perfiles sintéticos y suprime esperas sin abrir sockets."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.raiz = Path(temporal.name)
        (self.raiz / "identidad-web.json").write_text(configuracion())
        for parche in (
            mock.patch.object(red.perfil_web, "RUTA_IDENTIDAD", self.raiz / "identidad-web.json"),
            mock.patch.object(Path, "home", side_effect=AssertionError("No consultar HOME")),
            mock.patch.object(red, "PAUSAS", red.PausasPorDominio(lambda: 0.0, lambda _s: None)),
        ):
            parche.start()
            self.addCleanup(parche.stop)

    @staticmethod
    def respuesta(cuerpo: bytes = b"datos", codificacion: str | None = None) -> mock.MagicMock:
        """Fabrica HTTP en memoria con su longitud real en el cable.

        Returns:
            El doble de una respuesta completa.
        """
        cabeceras = Message()
        cabeceras["Content-Length"] = str(len(cuerpo))
        cabeceras["Content-Type"] = "application/json"
        if codificacion is not None:
            cabeceras["Content-Encoding"] = codificacion
        respuesta = mock.MagicMock(url="https://ejemplo.invalid/final", headers=cabeceras)
        respuesta.__enter__.return_value = respuesta
        respuesta.read1.side_effect = io.BytesIO(cuerpo).read1
        return respuesta

    def test_api_envia_perfil_comun_sin_idioma_ni_navegacion_html(self) -> None:
        """Las cabeceras de cada lector no pueden sustituir la identidad central."""
        with mock.patch.object(red, "abrir_peticion", return_value=self.respuesta()) as abrir:
            red.descargar_url(
                "https://ejemplo.invalid/api",
                {"Accept": "application/json", "SEC-CH-UA": "falso", "Accept-Encoding": "br"},
            )
        enviados = {k.lower(): v for k, v in abrir.call_args.args[0].header_items()}
        self.assertEqual(enviados["user-agent"], UA)
        self.assertEqual(enviados["sec-ch-ua"], PISTAS)
        self.assertEqual(enviados["sec-ch-ua-mobile"], "?0")
        self.assertEqual(enviados["sec-ch-ua-platform"], '"Windows"')
        self.assertEqual(enviados["accept-encoding"], "gzip, deflate")
        self.assertEqual(enviados["accept"], "application/json")
        for nombre in ("accept-language", "sec-fetch-mode", "sec-fetch-site", "x-privado"):
            self.assertNotIn(nombre, enviados)

    def test_html_explicito_recibe_perfil_de_pagina(self) -> None:
        """Solo la navegación HTML autorizada añade idioma y Sec-Fetch."""
        with mock.patch.object(red, "abrir_peticion", return_value=self.respuesta()) as abrir:
            red.descargar_url("https://ejemplo.invalid/curso", perfil="pagina")
        peticion = abrir.call_args.args[0]
        self.assertEqual(peticion.get_header("Accept"), HTML)
        self.assertEqual(peticion.get_header("Accept-language"), "es-ES,es;q=0.9")
        self.assertEqual(peticion.get_header("Sec-fetch-mode"), "navigate")
        self.assertEqual(peticion.get_header("Sec-fetch-dest"), "document")

    def test_fuente_con_idioma_no_recibe_perfil_de_pagina(self) -> None:
        """Una fuente catalana conserva la negociación que declara su lector."""
        with mock.patch.object(red, "abrir_peticion", return_value=self.respuesta()) as abrir:
            red.descargar_url("https://ejemplo.invalid/ca/curs", {"Accept-Language": "ca"}, perfil="idioma-original")
        peticion = abrir.call_args.args[0]
        self.assertEqual(peticion.get_header("Accept-language"), "ca")
        self.assertIsNone(peticion.get_header("Sec-fetch-mode"))
        self.assertIsNone(peticion.get_header("Accept"))

    def test_pagina_no_se_aplica_a_un_post_o_accept_json(self) -> None:
        """Una petición API no se disfraza de navegación HTML por contradicción de opciones."""
        for opciones in ({"cuerpo": b"{}"}, {"cabeceras": {"Accept": "application/json"}}):
            with self.subTest(opciones=opciones), mock.patch.object(red, "abrir_peticion") as abrir:
                with self.assertRaises(FormatoInesperado):
                    red.descargar_url("https://ejemplo.invalid/api", perfil="pagina", **opciones)
                abrir.assert_not_called()

    def test_version_incoherente_o_pistas_incompletas_impiden_el_envio(self) -> None:
        """No se mezclan Chrome y pistas de otra versión ni se oculta una configuración rota."""
        for texto in (
            configuracion().replace("Chrome/156.", "Chrome/157."),
            configuracion().replace('"sec-ch-ua-mobile": "?0", ', ""),
        ):
            (self.raiz / "identidad-web.json").write_text(texto)
            with self.subTest(texto=texto), mock.patch.object(red, "abrir_peticion") as abrir:
                with self.assertRaises(FormatoInesperado):
                    red.descargar_url("https://ejemplo.invalid/datos")
                abrir.assert_not_called()

    def test_chrome_incompleto_impide_envio_antes_de_abrir(self) -> None:
        """Un UA parcial no entra como supuesto navegador alternativo sin pistas."""
        for version in ("156", "156.0", "156.0.0"):
            agente = UA.replace("Chrome/156.0.0.0", "Chrome/" + version)
            (self.raiz / "identidad-web.json").write_text(configuracion(agente))
            with (
                self.subTest(version=version),
                mock.patch.object(red, "abrir_peticion", return_value=self.respuesta()) as abrir,
            ):
                with self.assertRaises(FormatoInesperado):
                    red.descargar_url("https://ejemplo.invalid/datos")
                abrir.assert_not_called()

    def test_alternativos_no_entran_en_el_flujo_normal(self) -> None:
        """Repuestos potenciales requieren otro flujo explícito, no una configuración central."""
        agentes = (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:156.0) Gecko/20100101 Firefox/156.0",
            UA + " Edg/156.0.0.0",
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 "
            "(KHTML, like Gecko) Version/18.0 Safari/605.1.15",
        )
        for agente in agentes:
            (self.raiz / "identidad-web.json").write_text(configuracion(agente))
            with (
                self.subTest(agente=agente),
                mock.patch.object(red, "abrir_peticion", return_value=self.respuesta()) as abrir,
            ):
                with self.assertRaises(FormatoInesperado):
                    red.descargar_url("https://ejemplo.invalid/datos")
                abrir.assert_not_called()

    def test_chrome_sin_pistas_rechaza_configuracion_incompleta(self) -> None:
        """El JSON compartido exige las mismas cuatro cabeceras en todos los transportes."""
        (self.raiz / "identidad-web.json").write_text(json.dumps({"version": 1, "identidad": {"User-Agent": UA}}))
        with mock.patch.object(red, "abrir_peticion") as abrir, self.assertRaises(FormatoInesperado):
            red.descargar_url("https://ejemplo.invalid/datos")
        abrir.assert_not_called()

    def test_validar_agente_conserva_navegador_generico_para_consumidores(self) -> None:
        """La guarda genérica permanece independiente de la política del lector central."""
        agente = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:156.0) Gecko/20100101 Firefox/156.0"
        self.assertEqual(red.validar_agente(agente), agente)
        self.assertEqual(red.agente_de_usuario(agente=agente), agente)

    def test_sin_configuracion_no_hay_perfil_implicito(self) -> None:
        """Una entrega incompleta falla antes de consultar una fuente."""
        (self.raiz / "identidad-web.json").unlink()
        with mock.patch.object(red, "abrir_peticion") as abrir, self.assertRaises(FormatoInesperado):
            red.descargar_url("https://ejemplo.invalid/datos")
        abrir.assert_not_called()

    def test_gzip_y_deflate_entregan_y_registran_contenido_descomprimido(self) -> None:
        """No cambian los bytes del original por negociar compresión de transporte."""
        original = "contenido con acentos: formación".encode()
        for tipo, comprimido in (("gzip", gzip.compress(original)), ("deflate", zlib.compress(original))):
            comprobar = mock.Mock()
            with (
                self.subTest(tipo=tipo),
                mock.patch.object(red, "abrir_peticion", return_value=self.respuesta(comprimido, tipo)),
                mock.patch.object(red, "observar") as observar,
            ):
                salida = red.descargar_url("https://ejemplo.invalid/datos", comprobar=comprobar)
            self.assertEqual(salida.datos, original)
            self.assertEqual(hashlib.sha256(salida.datos).digest(), hashlib.sha256(original).digest())
            self.assertEqual(observar.call_args.args[-1], original)
            self.assertEqual(comprobar.call_args.args[0], original)
            self.assertNotIn("Content-Encoding", comprobar.call_args.args[1])
            self.assertEqual(comprobar.call_args.args[1]["Content-Length"], str(len(original)))

    def test_compresion_danada_truncada_no_soportada_o_con_exceso_no_se_observa(self) -> None:
        """El original anterior no recibe cuerpos corruptos ni expansión sin límite."""
        casos = [(b"roto", "gzip"), (gzip.compress(b"datos")[:-1], "gzip"), (b"x", "br")]
        for cuerpo, tipo in casos:
            with (
                self.subTest(tipo=tipo, cuerpo=cuerpo),
                mock.patch.object(red, "abrir_peticion", return_value=self.respuesta(cuerpo, tipo)),
                mock.patch.object(red, "observar") as observar,
                self.assertRaises(FormatoInesperado),
            ):
                red.descargar_url("https://ejemplo.invalid/datos")
            observar.assert_not_called()
        comprimido = gzip.compress(b"a" * 500)
        with (
            mock.patch.object(red, "MAX_DESCARGA_BYTES", 100),
            mock.patch.object(red, "abrir_peticion", return_value=self.respuesta(comprimido, "gzip")),
            mock.patch.object(red, "observar") as observar,
            self.assertRaises(FormatoInesperado),
        ):
            red.descargar_url("https://ejemplo.invalid/datos")
        observar.assert_not_called()

    def test_grease_chromium_marca_version_y_orden_por_major(self) -> None:
        """Casos literales independientes cubren las seis permutaciones oficiales de tres marcas."""
        casos = (
            (120, '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"'),
            (121, '"Not A(Brand";v="99", "Google Chrome";v="121", "Chromium";v="121"'),
            (122, '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"'),
            (123, '"Google Chrome";v="123", "Not:A-Brand";v="8", "Chromium";v="123"'),
            (124, '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"'),
            (125, '"Google Chrome";v="125", "Chromium";v="125", "Not.A/Brand";v="24"'),
            (156, PISTAS),
            (157, '"Not-A.Brand";v="99", "Google Chrome";v="157", "Chromium";v="157"'),
        )
        for mayor, esperado in casos:
            agente = UA.replace("Chrome/156.0.0.0", f"Chrome/{mayor}.0.0.0")
            (self.raiz / "identidad-web.json").write_text(configuracion(agente, esperado))
            with (
                self.subTest(mayor=mayor),
                mock.patch.object(red, "abrir_peticion", return_value=self.respuesta()) as abrir,
            ):
                red.descargar_url("https://ejemplo.invalid/datos")
                peticion = abrir.call_args.args[0]
                self.assertEqual(peticion.get_header("Sec-ch-ua"), esperado)
                self.assertEqual(peticion.get_header("User-agent"), agente)

    def test_version_estable_completa_genera_perfil_reducido_identico(self) -> None:
        """El build publicado es metadato, nunca una versión completa filtrada al UA."""
        from plataforma_datos.comun.perfil_web import perfil_chrome

        esperado = {
            "User-Agent": UA,
            "sec-ch-ua": PISTAS,
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": '"Windows"',
            "Accept-Encoding": "gzip, deflate",
        }
        self.assertEqual(perfil_chrome("156.0.8078.48"), esperado)
        self.assertEqual(perfil_chrome("156.0.0.0"), esperado)

    def test_ua_explicito_con_build_completo_no_se_corrige_silenciosamente(self) -> None:
        """La configuración incoherente falla antes del envío en lugar de sustituirse."""
        agente = UA.replace("156.0.0.0", "156.0.8078.48")
        (self.raiz / "identidad-web.json").write_text(configuracion(agente))
        with mock.patch.object(red, "abrir_peticion") as abrir, self.assertRaises(FormatoInesperado):
            red.descargar_url("https://ejemplo.invalid/datos")
        abrir.assert_not_called()

    def test_actualizar_version_cambia_agente_y_pistas_juntos(self) -> None:
        """La versión se deriva de la misma configuración, sin dejar pistas antiguas."""
        (self.raiz / "identidad-web.json").write_text(configuracion(UA.replace("156", "157"), PISTAS_157))
        with mock.patch.object(red, "abrir_peticion", return_value=self.respuesta()) as abrir:
            red.descargar_url("https://ejemplo.invalid/datos")
        peticion = abrir.call_args.args[0]
        self.assertEqual(peticion.get_header("User-agent"), UA.replace("156", "157"))
        self.assertEqual(peticion.get_header("Sec-ch-ua"), PISTAS_157)

    def test_redireccion_conserva_perfil_del_intento_aunque_cambie_configuracion(self) -> None:
        """No mezcla revisiones de identidad a mitad de una consulta."""
        with mock.patch.object(red, "abrir_peticion", return_value=self.respuesta()) as abrir:
            red.descargar_url("https://ejemplo.invalid/inicio", perfil="pagina")
        inicial = abrir.call_args.args[0]
        (self.raiz / "identidad-web.json").write_text(configuracion(UA.replace("156", "157"), PISTAS_157))
        salto = red._RedireccionSoloWeb().redirect_request(
            inicial, io.BytesIO(), 302, "Found", {}, "https://otro.invalid/final"
        )
        self.assertEqual(dict(salto.header_items()), dict(inicial.header_items()))

    def test_compresion_con_longitud_incorrecta_o_datos_extra_se_rechaza(self) -> None:
        """Framing y terminación se comprueban también cuando el contenido es comprimido."""
        comprimido = gzip.compress(b"correcto")
        corta = self.respuesta(comprimido, "gzip")
        corta.headers.replace_header("Content-Length", str(len(comprimido) + 1))
        repetida = self.respuesta(comprimido, "gzip")
        repetida.headers["Content-Encoding"] = "deflate"
        for respuesta in (corta, repetida, self.respuesta(comprimido + b"sobra", "gzip")):
            with mock.patch.object(red, "abrir_peticion", return_value=respuesta), self.assertRaises(FormatoInesperado):
                red.descargar_url("https://ejemplo.invalid/datos")

    def test_perfil_pagina_personal_no_modifica_html_ni_api(self) -> None:
        """El archivo personal queda fuera de la configuración del producto."""
        (self.raiz / ".curlrc-pagina").write_text('header = "Accept-Language: dato-personal"')
        with mock.patch.object(red, "abrir_peticion", return_value=self.respuesta()) as abrir:
            red.descargar_url("https://ejemplo.invalid/pagina", perfil="pagina")
        self.assertEqual(abrir.call_args.args[0].get_header("Accept-language"), "es-ES,es;q=0.9")
        with mock.patch.object(red, "abrir_peticion", return_value=self.respuesta()) as abrir:
            red.descargar_url("https://ejemplo.invalid/api", {"Accept": "application/json"})
        self.assertIsNone(abrir.call_args.args[0].get_header("Accept-language"))
