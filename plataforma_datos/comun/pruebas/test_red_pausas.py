"""Turnos por dominio y saltos HTTP, con reloj virtual y respuestas en memoria."""

import io
import unittest
from email.message import Message
from unittest import mock
from urllib.error import URLError
from urllib.request import HTTPHandler, Request
from urllib.request import build_opener as construir_abridor
from urllib.response import addinfourl

from plataforma_datos.comun import red, socrata
from plataforma_datos.comun.nucleo import FormatoInesperado


class RelojVirtual:
    """Un reloj inyectado cuyo dormir solo adelanta una cifra."""

    def __init__(self) -> None:
        self.ahora = 0.0
        self.esperas: list[float] = []

    def leer(self) -> float:
        """Devuelve el instante virtual.

        Returns:
            Los segundos transcurridos en la simulación.
        """
        return self.ahora

    def dormir(self, segundos: float) -> None:
        """Registra la espera y adelanta el reloj sin detener el proceso."""
        self.esperas.append(segundos)
        self.ahora += segundos


class PruebaPausasDeRed(unittest.TestCase):
    """La espera precede al intento real y el fin se conserva incluso tras un error."""

    def setUp(self) -> None:
        """Inyecta reloj, controlador e identidad para no consultar configuración o red reales."""
        self.reloj = RelojVirtual()
        self.control = red.PausasPorDominio(self.reloj.leer, self.reloj.dormir)
        for parche in (
            mock.patch.object(red, "PAUSAS", self.control),
            mock.patch.object(red.perfil_web, "leer_perfil", return_value=red.perfil_web.perfil_chrome()),
        ):
            parche.start()
            self.addCleanup(parche.stop)

    @staticmethod
    def respuesta() -> mock.MagicMock:
        """Una respuesta que ejercita el lector real sin sockets.

        Returns:
            Un contexto HTTP de prueba.
        """
        respuesta = mock.MagicMock(url="https://ejemplo.invalid/final", headers={})
        respuesta.__enter__.return_value = respuesta
        respuesta.read1.side_effect = io.BytesIO(b"datos").read1
        return respuesta

    def test_dos_segundos_desde_el_fin_incluido_el_cierre(self) -> None:
        """Leer y cerrar siete segundos no sustituye a los dos segundos que siguen al cierre."""
        inicios = []

        def abrir(_req: Request, timeout: float) -> mock.MagicMock:
            """Registra el intento y simula que cerrar la respuesta tarda siete segundos.

            Returns:
                La respuesta simulada.
            """
            inicios.append(self.reloj.ahora)
            respuesta = self.respuesta()
            respuesta.__exit__.side_effect = lambda *_a: setattr(self.reloj, "ahora", self.reloj.ahora + 7)
            return respuesta

        with mock.patch.object(red, "abrir_peticion", side_effect=abrir):
            red.descargar_url("https://ejemplo.invalid/a")
            red.descargar_url("https://ejemplo.invalid/b")
        self.assertEqual(inicios, [0.0, 9.0])
        self.assertEqual(self.reloj.esperas, [2.0])

    def test_otro_dominio_no_hereda_la_pausa(self) -> None:
        """Dos hosts distintos no comparten el historial de cortesía."""
        with mock.patch.object(red, "abrir_peticion", side_effect=lambda *_a, **_k: self.respuesta()):
            red.descargar_url("https://uno.invalid/a")
            red.descargar_url("https://otro.invalid/a")
        self.assertEqual(self.reloj.esperas, [])

    def test_host_normalizado_comparte_puerto_esquema_y_punto_final(self) -> None:
        """Cambiar puerto, esquema o grafía del mismo hostname no elude el intervalo."""
        with mock.patch.object(red, "abrir_peticion", side_effect=lambda *_a, **_k: self.respuesta()):
            red.descargar_url("https://EJEMPLO.invalid:443/a")
            red.descargar_url("http://ejemplo.invalid.:8080/b")
        self.assertEqual(self.reloj.esperas, [2.0])
        self.assertEqual(red._dominio("https://mañana.invalid/a"), red._dominio("https://xn--maana-pta.invalid/b"))

    def test_limite_exacto_y_tiempo_parcial_transcurrido(self) -> None:
        """Solo espera el resto del intervalo, y nada al llegar exactamente a la cota."""
        with mock.patch.object(red, "abrir_peticion", side_effect=lambda *_a, **_k: self.respuesta()):
            red.descargar_url("https://ejemplo.invalid/a")
            self.reloj.ahora += 0.75
            red.descargar_url("https://ejemplo.invalid/b")
            self.reloj.ahora += 2
            red.descargar_url("https://ejemplo.invalid/c")
        self.assertEqual(self.reloj.esperas, [1.25])

    def test_error_al_abrir_actualiza_fin_sin_ocultar_causa(self) -> None:
        """La siguiente consulta espera después del error, no desde el inicio antiguo."""
        inicios = []
        error = URLError("fallo sintético")

        def abrir(_req: Request, timeout: float) -> mock.MagicMock:
            """Falla tras cinco segundos solo el primer intento.

            Returns:
                Una respuesta desde el segundo intento.

            Raises:
                URLError: En el primer intento.
            """
            inicios.append(self.reloj.ahora)
            if len(inicios) == 1:
                self.reloj.ahora += 5
                raise error
            return self.respuesta()

        with mock.patch.object(red, "abrir_peticion", side_effect=abrir):
            with self.assertRaises(URLError) as captura:
                red.descargar_url("https://ejemplo.invalid/a")
            red.descargar_url("https://ejemplo.invalid/b")
        self.assertIs(captura.exception, error)
        self.assertEqual(inicios, [0.0, 7.0])

    def test_control_de_contenido_fallido_tambien_deja_pausa(self) -> None:
        """Un rechazo posterior a recibir el cuerpo no autoriza el siguiente intento inmediato."""
        error = FormatoInesperado("rechazo sintético")
        with mock.patch.object(red, "abrir_peticion", side_effect=lambda *_a, **_k: self.respuesta()):
            with self.assertRaises(FormatoInesperado):
                red.descargar_url("https://ejemplo.invalid/a", comprobar=mock.Mock(side_effect=error))
            red.descargar_url("https://ejemplo.invalid/b")
        self.assertEqual(self.reloj.esperas, [2.0])

    def test_redireccion_real_del_abridor_respeta_cierre_y_cadena_a_b_a(self) -> None:
        """El hook de urllib se ejecuta después de cerrar cada respuesta y antes del siguiente HTTP."""
        reloj = self.reloj
        inicios: list[tuple[str, float, str]] = []
        rutas = {
            "https://a.invalid/inicio": "https://b.invalid/salto",
            "https://b.invalid/salto": "https://a.invalid/final",
        }

        class Cuerpo(io.BytesIO):
            """Cada cierre HTTP adelanta un segundo; no se abre ningún socket."""

            def close(self) -> None:
                """Registra una sola terminación de cuerpo."""
                if not self.closed:
                    reloj.ahora += 1
                super().close()

        class HTTPFalso(HTTPHandler):
            """Responde antes que cualquier handler que pudiera abrir sockets."""

            handler_order = 1

            def http_open(self, req: Request) -> addinfourl:
                """Devuelve un salto o cuerpo final, conservando el camino real de urllib.

                Returns:
                    Una respuesta HTTP en memoria.
                """
                inicios.append((req.full_url, reloj.ahora, req.get_header("User-agent")))
                cabeceras = Message()
                cabeceras["Content-Length"] = "0"
                if req.full_url in rutas:
                    cabeceras["Location"] = rutas[req.full_url]
                respuesta = addinfourl(Cuerpo(), cabeceras, req.full_url, 302 if req.full_url in rutas else 200)
                respuesta.msg = "Found" if req.full_url in rutas else "OK"
                return respuesta

            https_open = http_open

        def construir(*manejadores: object) -> object:
            """Inserta el transporte que solo fabrica respuestas.

            Returns:
                El abridor real con el handler sintético prioritario.
            """
            return construir_abridor(*manejadores, HTTPFalso())

        with mock.patch.object(red, "build_opener", side_effect=construir):
            red.descargar_url("https://a.invalid/inicio")
            red.descargar_url("https://b.invalid/final")
        self.assertEqual([i[1] for i in inicios], [0.0, 1.0, 3.0, 6.0])
        self.assertTrue(all(i[2] == red.AGENTE for i in inicios))
        self.assertEqual(self.reloj.esperas, [1.0, 2.0])

    def test_socrata_no_rebaja_la_pausa_comun(self) -> None:
        """El segundo que decía robots no permite rebajar los dos de la política vigente."""
        self.assertGreaterEqual(socrata.PAUSA_DE_SOCRATA_S, 2.0)
        self.assertEqual(socrata.PAUSA_DE_SOCRATA_S, red.PAUSA_ENTRE_PETICIONES_S)

    def test_error_en_destino_redirigido_deja_turno_para_su_siguiente_intento(self) -> None:
        """Una cadena fallida registra también el dominio al que llegó el salto."""
        error = URLError("fallo en destino del salto")
        inicios: list[tuple[str, float]] = []

        def abrir(req: Request, timeout: float) -> mock.MagicMock:
            """Cierra la primera respuesta antes del hook y falla en el destino redirigido.

            Returns:
                La respuesta del intento posterior.

            Raises:
                URLError: Tras alcanzar el destino del salto.
            """
            inicios.append((req.full_url, self.reloj.ahora))
            if req.full_url == "https://a.invalid/inicio":
                manejador = red._RedireccionSoloWeb()
                siguiente = manejador.redirect_request(req, io.BytesIO(), 302, "Found", {}, "https://b.invalid/final")
                self.reloj.ahora += 3
                manejador.https_request(siguiente)
                inicios.append((siguiente.full_url, self.reloj.ahora))
                self.reloj.ahora += 4
                raise error
            return self.respuesta()

        with mock.patch.object(red, "abrir_peticion", side_effect=abrir):
            with self.assertRaises(URLError) as captura:
                red.descargar_url("https://a.invalid/inicio")
            red.descargar_url("https://b.invalid/final")
        self.assertIs(captura.exception, error)
        self.assertEqual([i[1] for i in inicios], [0.0, 3.0, 9.0])
        self.assertEqual(self.reloj.esperas, [2.0])

    def test_error_leyendo_el_cuerpo_tambien_retrasa_el_siguiente_intento(self) -> None:
        """El reloj de cortesía registra el fin del fallo de lectura, separado del inicio."""
        error = URLError("cuerpo interrumpido")
        respuesta = self.respuesta()

        def fallo(_cantidad: int) -> bytes:
            """Simula cinco segundos de lectura antes del fallo.

            Raises:
                URLError: Al recibir el cuerpo.
            """
            self.reloj.ahora += 5
            raise error

        respuesta.read1.side_effect = fallo
        with mock.patch.object(red, "abrir_peticion", side_effect=[respuesta, self.respuesta()]):
            with self.assertRaises(URLError):
                red.descargar_url("https://ejemplo.invalid/a")
            red.descargar_url("https://ejemplo.invalid/b")
        self.assertEqual(self.reloj.ahora, 7.0)
        self.assertEqual(self.reloj.esperas, [2.0])

    def test_consulta_anidada_no_elude_el_fin_de_la_consulta_exterior(self) -> None:
        """Una llamada desde el control de contenido no inicia otra conexión con la respuesta aún abierta."""

        def comprobar(_datos: bytes, _cabeceras: object) -> None:
            """Intenta una consulta reentrante durante el control de la primera."""
            red.descargar_url("https://ejemplo.invalid/anidada")

        with (
            mock.patch.object(red, "abrir_peticion", return_value=self.respuesta()) as abrir,
            self.assertRaises(FormatoInesperado),
        ):
            red.descargar_url("https://ejemplo.invalid/a", comprobar=comprobar)
        self.assertEqual(abrir.call_count, 1)

    def test_api_publica_comparte_turno_con_descargar_url_y_libera_tras_error(self) -> None:
        """Un cliente externo y el descargador existente comparten el mismo fin y la misma exclusión."""
        error = URLError("cliente externo fallido")
        with self.assertRaises(URLError) as captura, red.turno_por_dominio("https://ejemplo.invalid/externo"):
            self.reloj.ahora += 5
            raise error
        self.assertIs(captura.exception, error)
        with mock.patch.object(red, "abrir_peticion", return_value=self.respuesta()):
            red.descargar_url("https://ejemplo.invalid/a")
        self.assertEqual(self.reloj.ahora, 7.0)
        self.assertEqual(self.reloj.esperas, [2.0])

    def test_api_publica_cubre_redireccion_y_reintento_explicitos(self) -> None:
        """El cliente instrumenta cada nuevo intento del mismo contexto sin crear otro limitador."""
        with red.turno_por_dominio("https://a.invalid/inicio"):
            self.reloj.ahora += 1
            red.registrar_redireccion("https://a.invalid/inicio", "https://b.invalid/salto")
            self.assertEqual(self.reloj.ahora, 1.0)
            self.reloj.ahora += 1
            red.registrar_redireccion("https://b.invalid/salto", "https://a.invalid/final")
            self.assertEqual(self.reloj.ahora, 3.0)
            self.reloj.ahora += 1
            red.registrar_redireccion("https://a.invalid/final", "https://a.invalid/final")
            self.assertEqual(self.reloj.ahora, 6.0)
        self.assertEqual(self.reloj.esperas, [1.0, 2.0])

    def test_hook_publico_fuera_del_turno_o_con_origen_ajeno_se_rechaza(self) -> None:
        """Una llamada de retorno aislada no reserva ni ejecuta un envío sin propiedad del turno."""
        with self.assertRaises(FormatoInesperado):
            red.registrar_redireccion("https://a.invalid/a", "https://a.invalid/b")
        with red.turno_por_dominio("https://a.invalid/a"):
            with self.assertRaises(FormatoInesperado):
                red.registrar_redireccion("https://otro.invalid/a", "https://b.invalid/b")
            with self.assertRaises(FormatoInesperado):
                red.registrar_redireccion("https://a.invalid/a", "file:///no-se-abre")
        self.assertEqual(self.reloj.esperas, [])
