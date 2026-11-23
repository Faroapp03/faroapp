"""Controles optativos antes del cuerpo y topes de lectura reales, siempre sin red."""

import gzip
import io
import unittest
from collections.abc import Mapping
from http.client import HTTPResponse
from unittest import mock

from plataforma_datos.comun import red
from plataforma_datos.comun.nucleo import FormatoInesperado

URL = "https://ejemplo.invalid/documento"
LIMITE_PEQUENO = 64
CUERPO_GRANDE = b"a" * 512


def respuesta(cuerpo: bytes, cabeceras: bytes = b"", estado: int = 200) -> HTTPResponse:
    """Interpreta HTTP de memoria con status real.

    Returns:
        Respuesta abierta sin socket de red.
    """
    conexion = mock.Mock()
    conexion.makefile.return_value = io.BytesIO(
        f"HTTP/1.1 {estado} respuesta\r\n".encode() + cabeceras + b"\r\n" + cuerpo
    )
    recibida = HTTPResponse(conexion)
    recibida.begin()
    recibida.url = URL
    return recibida


class PruebaLimitesOptativos(unittest.TestCase):
    """Los valores por defecto permanecen; la activación expresa limita cable y descompresión."""

    def setUp(self) -> None:
        """Inyecta perfil y espera virtual sin leer configuración ni abrir conexiones."""
        for parche in (
            mock.patch.object(red.perfil_web, "leer_perfil", return_value=red.perfil_web.perfil_chrome()),
            mock.patch.object(red, "PAUSAS", red.PausasPorDominio(lambda: 0.0, lambda _s: None)),
        ):
            parche.start()
            self.addCleanup(parche.stop)

    def test_longitud_superior_se_rechaza_sin_leer_y_cierra(self) -> None:
        """Un Content-Length excesivo falla antes de acumular el cuerpo."""
        recibida = respuesta(CUERPO_GRANDE, f"Content-Length: {len(CUERPO_GRANDE)}\r\n".encode())
        with (
            mock.patch.object(red, "abrir_peticion", return_value=recibida),
            mock.patch.object(recibida, "read1") as leer,
        ):
            with self.assertRaises(FormatoInesperado):
                red.descargar_url(URL, maximo_bytes=LIMITE_PEQUENO)
            leer.assert_not_called()
        self.assertTrue(recibida.isclosed())

    def test_eof_sin_longitud_no_acumula_mas_que_tope_y_un_byte(self) -> None:
        """El límite se aplica durante la lectura, incluso sin longitud declarada."""
        recibida = respuesta(CUERPO_GRANDE)
        with (
            mock.patch.object(red, "abrir_peticion", return_value=recibida),
            mock.patch.object(recibida, "read1", wraps=recibida.read1) as leer,
            self.assertRaises(FormatoInesperado),
        ):
            red.descargar_url(URL, maximo_bytes=LIMITE_PEQUENO)
        self.assertTrue(all(0 < llamada.args[0] <= LIMITE_PEQUENO + 1 for llamada in leer.call_args_list))
        self.assertTrue(recibida.isclosed())

    def test_cuerpo_comprimido_no_elude_tope_expandido(self) -> None:
        """La misma cota limita bytes de cable y bytes descomprimidos."""
        comprimido = gzip.compress(CUERPO_GRANDE)
        recibida = respuesta(comprimido, f"Content-Encoding: gzip\r\nContent-Length: {len(comprimido)}\r\n".encode())
        with mock.patch.object(red, "abrir_peticion", return_value=recibida), self.assertRaises(FormatoInesperado):
            red.descargar_url(URL, maximo_bytes=LIMITE_PEQUENO)
        self.assertTrue(recibida.isclosed())

    def test_limite_invalido_falla_antes_de_abrir(self) -> None:
        """Booleanos, fracciones, infinitos o elevar la cota común no autorizan envío."""
        for limite in (0, -1, True, 1.0, float("inf"), red.MAX_DESCARGA_BYTES + 1):
            with self.subTest(limite=limite), mock.patch.object(red, "abrir_peticion") as abrir:
                with self.assertRaises(FormatoInesperado):
                    red.descargar_url(URL, maximo_bytes=limite)
                abrir.assert_not_called()

    def test_control_recibe_status_url_y_cabeceras_antes_del_cuerpo(self) -> None:
        """La clasificación de un parcial puede cerrar sin leer ni emitir recepción completa."""
        recibida = respuesta(b"parte", b"cOnTeNt-RaNgE: bytes 0-4/100\r\n", estado=206)
        observadas = []

        def comprobar(status: int, url_final: str, cabeceras: Mapping[str, str]) -> None:
            """Conserva hechos y rechaza el cuerpo antes de su primera lectura.

            Raises:
                FormatoInesperado: Siempre, para ejercitar cierre y error causal.
            """
            observadas.append((status, url_final, list(cabeceras.items())))
            raise FormatoInesperado("parcial de prueba")

        with (
            mock.patch.object(red, "abrir_peticion", return_value=recibida),
            mock.patch.object(recibida, "read1") as leer,
        ):
            with self.assertRaisesRegex(FormatoInesperado, "parcial de prueba"):
                red.descargar_url(URL, comprobar_cabeceras=comprobar)
            leer.assert_not_called()
        self.assertEqual(observadas, [(206, URL, [("cOnTeNt-RaNgE", "bytes 0-4/100")])])
        self.assertTrue(recibida.isclosed())

    def test_default_no_reduce_lectura_del_resto_de_fuentes(self) -> None:
        """No participar en la activación expresa conserva la respuesta completa anterior."""
        with mock.patch.object(red, "abrir_peticion", return_value=respuesta(CUERPO_GRANDE)):
            self.assertEqual(red.descargar_url(URL).datos, CUERPO_GRANDE)

    def test_excepcion_del_control_libera_turno_y_pausa_despues_del_cierre(self) -> None:
        """El segundo envío espera desde el cierre del anterior, incluso al rechazar cabeceras."""
        reloj = [0.0]
        esperas = []

        def dormir(segundos: float) -> None:
            """Avanza el reloj virtual sin bloquear el proceso."""
            esperas.append(segundos)
            reloj[0] += segundos

        recibida = respuesta(b"parcial", estado=206)
        cerrar = recibida.close

        def cierre_lento() -> None:
            """Representa siete segundos de cierre sin espera real."""
            reloj[0] += 7.0
            cerrar()

        pausa = red.PausasPorDominio(lambda: reloj[0], dormir)
        with (
            mock.patch.object(red, "PAUSAS", pausa),
            mock.patch.object(recibida, "close", side_effect=cierre_lento),
            mock.patch.object(red, "abrir_peticion", side_effect=[recibida, respuesta(b"completo")]),
        ):
            with self.assertRaises(FormatoInesperado):
                red.descargar_url(URL, comprobar_cabeceras=mock.Mock(side_effect=FormatoInesperado("parcial")))
            self.assertEqual(red.descargar_url(URL).datos, b"completo")
        self.assertEqual(esperas, [2.0])
        self.assertEqual(reloj, [9.0])
