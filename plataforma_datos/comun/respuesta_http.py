"""Límites de tiempo, tamaño e integridad de las respuestas HTTP de las fuentes."""

import os
import re
import socket
import time
import zlib
from collections.abc import Iterator
from contextlib import contextmanager, suppress
from functools import partial
from http.client import HTTPConnection, HTTPResponse
from threading import Timer

from plataforma_datos.comun.nucleo import FormatoInesperado

MAX_DIGITOS_LONGITUD_HTTP = 20


class LimiteDescargaExcedido(FormatoInesperado):
    """El límite local de recepción no permite comprobar el documento completo."""


def _interrumpir_lectura(conexion: socket.socket) -> None:
    """Despierta una lectura bloqueada, incluso si aún espera el fin de una trama HTTP."""
    # El servidor puede haber cerrado la conexión al mismo tiempo.
    with suppress(OSError):
        conexion.shutdown(socket.SHUT_RDWR)


@contextmanager
def vigilar_lectura(respuesta: HTTPResponse, hasta: float) -> Iterator[None]:
    """Despierta el socket aun dentro de una sola línea HTTP y verifica el reloj al recibir EOF.

    Yields:
        El turno de lectura hasta el límite monotónico.

    Raises:
        TimeoutError: Si se agotó el tiempo, también al recibir EOF sin longitud declarada.
    """
    restante = hasta - time.monotonic()
    if restante <= 0:
        raise TimeoutError("Plazo de la petición agotado antes de leer la respuesta")
    try:
        descriptor = respuesta.fileno()
    except (AttributeError, OSError):
        # Los cuerpos de memoria (también los de ciertos HTTPError) carecen de socket.
        descriptor = None
    if isinstance(descriptor, int):
        # El descriptor duplicado permite interrumpir el socket TLS o TCP sin tomar posesión del original.
        with socket.socket(fileno=os.dup(descriptor)) as conexion:
            alarma = Timer(restante, _interrumpir_lectura, args=(conexion,))
            alarma.daemon = True
            alarma.start()
            try:
                yield
            finally:
                alarma.cancel()
                alarma.join()
    else:
        yield
    if time.monotonic() >= hasta:
        raise TimeoutError("Plazo de la petición agotado durante la lectura")


class _RespuestaConPlazo(HTTPResponse):
    """Interrumpe también el goteo de cabeceras, antes de que urllib entregue la respuesta."""

    def __init__(
        self,
        sock: socket.socket,
        debuglevel: int = 0,
        method: str | None = None,
        url: str | None = None,
        *,
        hasta: float,
    ) -> None:
        super().__init__(sock, debuglevel, method, url)
        self.hasta = hasta

    def begin(self) -> None:
        """Lee las cabeceras HTTP con el mismo plazo que el cuerpo."""
        with vigilar_lectura(self, self.hasta):
            super().begin()


def conexion_con_plazo(tipo: type[HTTPConnection], hasta: float, host: str, **opciones: object) -> HTTPConnection:
    """Configura la clase de respuesta antes de que la propia conexión lea las cabeceras.

    Returns:
        Conexión con el transporte habitual y un límite de lectura explícito.
    """
    conexion = tipo(host, **opciones)
    conexion.response_class = partial(_RespuestaConPlazo, hasta=hasta)
    return conexion


def _longitud_http(respuesta: HTTPResponse, maximo: int) -> int | None:
    """Lee Content-Length cuando delimita el cuerpo; el framing chunked prevalece.

    Returns:
        La longitud declarada, o None si el cuerpo es chunked o termina con el cierre de conexión.

    Raises:
        FormatoInesperado: Si el framing o la longitud no se pueden verificar.
        LimiteDescargaExcedido: Si la longitud declarada supera la cota.
    """
    transferencia = respuesta.headers.get("Transfer-Encoding")
    if transferencia is not None:
        # El mismo criterio que HTTPResponse: normalizar espacios aquí podría admitir tramas sin decodificar.
        if not isinstance(transferencia, str) or transferencia.lower() != "chunked":
            raise FormatoInesperado("Codificación de transferencia HTTP no verificable.")
        return None
    todas = getattr(respuesta.headers, "get_all", None)
    if callable(todas) and len(todas("Content-Length", [])) > 1:
        raise FormatoInesperado("Longitud HTTP repetida no verificable.")
    valor = respuesta.headers.get("Content-Length")
    if valor is None:
        return None
    if (
        not isinstance(valor, str)
        or len(valor) > MAX_DIGITOS_LONGITUD_HTTP
        or re.fullmatch(r"[0-9]+", valor.strip()) is None
    ):
        raise FormatoInesperado("Longitud HTTP no verificable.")
    if int(valor) > maximo:
        raise LimiteDescargaExcedido("La longitud HTTP supera el límite de recepción.")
    return int(valor)


def leer_cuerpo(respuesta: HTTPResponse, url: str, plazo_s: float, maximo: int, trozo_lectura: int) -> bytes:
    """Lee el cuerpo entero de una respuesta, con tope de tamaño y de tiempo total.

    Args:
        respuesta: La respuesta abierta.
        url: La dirección, para el motivo del error.
        plazo_s: El tiempo total para leerla, en segundos.
        maximo: Cota de cable y contenido expandido, ya validada por el llamador.
        trozo_lectura: Máximo de bytes solicitados en una lectura.

    Returns:
        El cuerpo; como mucho MAX_DESCARGA_BYTES bytes.

    Raises:
        FormatoInesperado: Si no acaba dentro del plazo o el cuerpo resulta incompleto.
        LimiteDescargaExcedido: Si el cuerpo recibido supera la cota.
    """
    longitud = _longitud_http(respuesta, maximo)
    todas = getattr(respuesta.headers, "get_all", None)
    if callable(todas) and len(todas("Content-Encoding", [])) > 1:
        raise FormatoInesperado("Codificación de contenido HTTP repetida.")
    codificacion = respuesta.headers.get("Content-Encoding", "identity").strip().lower()
    if codificacion not in {"identity", "gzip", "deflate"}:
        raise FormatoInesperado("Codificación de contenido HTTP no admitida.")
    descompresor = (
        None
        if codificacion == "identity"
        else zlib.decompressobj(zlib.MAX_WBITS + 16 if codificacion == "gzip" else zlib.MAX_WBITS)
    )
    limite = time.monotonic() + plazo_s
    trozos: list[bytes] = []
    leidos = expandidos = 0
    while trozo := respuesta.read1(min(trozo_lectura, maximo + 1 - leidos)):
        leidos += len(trozo)
        if leidos > maximo:
            raise LimiteDescargaExcedido(f"{url}: la respuesta pasa de {maximo} bytes")
        try:
            contenido = descompresor.decompress(trozo, maximo + 1 - expandidos) if descompresor else trozo
        except zlib.error as error:
            raise FormatoInesperado("Contenido HTTP comprimido inválido.") from error
        expandidos += len(contenido)
        if expandidos > maximo:
            raise LimiteDescargaExcedido("El contenido HTTP descomprimido supera su límite.")
        trozos.append(contenido)
        if time.monotonic() > limite:
            raise FormatoInesperado(f"{url}: la descarga no acaba en {plazo_s} s")
    if longitud is not None and leidos != longitud:
        raise FormatoInesperado("Cuerpo HTTP incompleto respecto a Content-Length.")
    if descompresor and (not descompresor.eof or descompresor.unused_data or descompresor.unconsumed_tail):
        raise FormatoInesperado("Contenido HTTP comprimido incompleto o con datos adicionales.")
    return b"".join(trozos)
