"""Ayudas de las pruebas de los productores epa, eaes y ofertas: carpetas de datos aisladas y un doble de la red.

Los recortes de `recortes/` son trozos fieles de los originales reales de la carpeta oficial
(var/actualizacion/originales/{epa,eaes,ofertas}, capturas del 20 y 21/10/2026): se copian series, hojas y valores
enteros, con sangría; nunca se inventan cifras.
"""

import contextlib
import tempfile
import unittest
from collections.abc import Callable, Mapping
from email.message import Message
from http.client import HTTPResponse
from pathlib import Path
from typing import NamedTuple
from unittest import mock
from urllib.error import HTTPError
from urllib.request import Request

from plataforma_datos.comun import descarga_acotada, entrada_salida, red
from plataforma_datos.comun.nucleo import Descarga
from plataforma_datos.comun.pruebas.test_observacion_remota import respuesta_http

RECORTES = Path(__file__).resolve().parent / "recortes"


class Respuesta(NamedTuple):
    """Lo que devuelve el doble de la red para una dirección."""

    datos: bytes
    tipo: str = "application/json;charset=UTF-8"
    final: str | None = None
    estado: int = 200


# Lo que responde un portal por una dirección que no existe (un mes aún no publicado).
NO_PUBLICADO = Respuesta(b"", estado=404)
PRIMER_ERROR_HTTP = 400


def recorte(nombre: str) -> bytes:
    """Los bytes de un recorte.

    Returns:
        El contenido del archivo de `recortes/`.
    """
    return (RECORTES / nombre).read_bytes()


def red_falsa(respuestas: Mapping[str, Respuesta], pedidas: list[str]) -> Callable[..., Descarga]:
    """Un doble de `red.descargar_url` que aplica los controles de cabeceras y de cuerpo que recibe.

    Returns:
        La función que sustituye a `descargar_url`.
    """

    def descargar(url: str, **opciones: object) -> Descarga:
        pedidas.append(url)
        respuesta = respuestas.get(url, NO_PUBLICADO)
        if respuesta.estado >= PRIMER_ERROR_HTTP:
            # urllib convierte los errores HTTP en una excepción antes de entregar la respuesta.
            raise HTTPError(url, respuesta.estado, "error", Message(), None)
        final = respuesta.final or url
        cabeceras = {"Content-Type": respuesta.tipo}
        comprobar_cabeceras = opciones.get("comprobar_cabeceras")
        if callable(comprobar_cabeceras):
            comprobar_cabeceras(respuesta.estado, final, cabeceras)
        comprobar = opciones.get("comprobar")
        if callable(comprobar):
            comprobar(respuesta.datos, cabeceras)
        return Descarga(respuesta.datos, final, respuesta.tipo)

    return descargar


def transporte_falso(respuestas: Mapping[str, Respuesta], pedidas: list[str]) -> Callable[..., HTTPResponse]:
    """Un doble de `red.abrir_peticion`, el punto más bajo de la petición.

    La identidad, el turno, el plazo, el tope de bytes y los controles de cabeceras y de cuerpo son los reales.

    Returns:
        La función que sustituye a `abrir_peticion`.
    """

    def abrir(peticion: Request, timeout: float) -> HTTPResponse:
        pedidas.append(peticion.full_url)
        respuesta = respuestas.get(peticion.full_url, NO_PUBLICADO)
        if respuesta.estado >= PRIMER_ERROR_HTTP:
            raise HTTPError(peticion.full_url, respuesta.estado, "error", Message(), None)
        cabeceras = f"Content-Type: {respuesta.tipo}\r\nContent-Length: {len(respuesta.datos)}\r\n".encode()
        http = respuesta_http(cabeceras, respuesta.datos)
        http.url = respuesta.final or peticion.full_url
        return http

    return abrir


class ConDatosAislados(unittest.TestCase):
    """Cada prueba escribe originales, preparados y validados en una carpeta temporal propia."""

    def setUp(self) -> None:
        """Redirige las carpetas de datos a una carpeta temporal."""
        carpeta = tempfile.TemporaryDirectory()
        self.addCleanup(carpeta.cleanup)
        self.datos = Path(carpeta.name)
        for constante in ("ORIGINALES", "PREPARADOS", "VALIDADOS"):
            parche = mock.patch.object(entrada_salida, constante, self.datos / constante.lower())
            parche.start()
            self.addCleanup(parche.stop)
        self.pedidas: list[str] = []

    def con_red(self, respuestas: Mapping[str, Respuesta]) -> mock._patch:
        """El doble de la red para las direcciones dadas; cualquier otra responde 404, como un mes sin publicar.

        Returns:
            El parche, para usarlo con `with`.
        """
        return mock.patch.object(descarga_acotada, "descargar_url", red_falsa(respuestas, self.pedidas))

    def con_transporte(self, respuestas: Mapping[str, Respuesta]) -> contextlib.ExitStack:
        """El camino real de la petición, con el transporte doblado en `red.abrir_peticion` y sin pausas reales.

        Returns:
            Los parches, para usarlos con `with`.
        """
        pila = contextlib.ExitStack()
        pila.enter_context(
            mock.patch.object(red, "abrir_peticion", side_effect=transporte_falso(respuestas, self.pedidas))
        )
        pila.enter_context(mock.patch.object(red, "PAUSAS", red.PausasPorDominio(lambda: 0.0, lambda _segundos: None)))
        return pila
