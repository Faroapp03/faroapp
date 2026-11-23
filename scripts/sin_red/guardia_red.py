"""Guardia de red de la batería Python: ninguna prueba puede salir de este equipo.

La aplica `scripts/pruebas_python.py` al empezar y, a través de `sitecustomize.py` de esta misma carpeta, todo
intérprete hijo que herede `FARO_PRUEBAS_SIN_RED=1` y esta carpeta en `PYTHONPATH`. Un intérprete lanzado con `-I`
ignora `PYTHONPATH` y no la hereda. Una prueba que olvide sustituir el transporte falla con un error claro en vez de
consultar una fuente real; los servidores de prueba en el bucle local siguen funcionando.
"""

import ipaddress
import socket

VARIABLE = "FARO_PRUEBAS_SIN_RED"
_APLICADA = "_faro_guardia_red"


class ConexionExternaProhibida(OSError):
    """Una prueba intentó salir de este equipo: las pruebas trabajan siempre sin red."""


def es_local(anfitrion: object) -> bool:
    """Indica si un anfitrión o una dirección de socket es de este equipo.

    Returns:
        True para el bucle local, «localhost», los sockets de archivo y las direcciones vacías; False para el resto.
    """
    if isinstance(anfitrion, tuple):
        if not anfitrion:
            return True
        anfitrion = anfitrion[0]
    if anfitrion is None or isinstance(anfitrion, (bytes, bytearray)) and not anfitrion:
        return True
    if isinstance(anfitrion, (bytes, bytearray)):
        anfitrion = bytes(anfitrion).decode("ascii", "replace")
    texto = str(anfitrion).strip("[]")
    if texto in ("localhost", ""):
        return True
    try:
        return ipaddress.ip_address(texto.split("%", 1)[0]).is_loopback
    except ValueError:
        return False


def _prohibir(que: str, destino: object) -> None:
    raise ConexionExternaProhibida(f"{que} externa prohibida en las pruebas: {destino!r}")


def _conexion_local(original):  # noqa: ANN001, ANN202 - envoltorio de métodos de socket con dirección final
    def envoltorio(self: socket.socket, direccion: object) -> object:
        if not es_local(direccion):
            _prohibir("Conexión", direccion)
        return original(self, direccion)

    return envoltorio


def _envio_local(original):  # noqa: ANN001, ANN202 - `sendto(datos[, opciones], dirección)`
    def envoltorio(self: socket.socket, datos: bytes, *resto: object) -> int:
        destino = resto[-1] if resto else None
        if not es_local(destino):
            _prohibir("Envío", destino)
        return original(self, datos, *resto)

    return envoltorio


def _resolucion_local(original):  # noqa: ANN001, ANN202 - funciones de socket cuyo primer argumento es el anfitrión
    def envoltorio(anfitrion: object, *argumentos: object, **opciones: object) -> object:
        if not es_local(anfitrion):
            _prohibir("Resolución", anfitrion)
        return original(anfitrion, *argumentos, **opciones)

    return envoltorio


def aplicar() -> None:
    """Sustituye en este proceso las conexiones, envíos UDP y resoluciones de nombres por versiones solo locales.

    Es idempotente. Cubre `connect`, `connect_ex`, `sendto`, `getaddrinfo`, `gethostbyname`, `gethostbyname_ex`,
    `gethostbyaddr` y `getnameinfo`; `create_connection` y las bibliotecas HTTP pasan por ellas.
    """
    if aplicada():
        return
    clase = socket.socket
    clase.connect = _conexion_local(clase.connect)
    clase.connect_ex = _conexion_local(clase.connect_ex)
    clase.sendto = _envio_local(clase.sendto)
    for nombre in ("getaddrinfo", "gethostbyname", "gethostbyname_ex", "gethostbyaddr", "getnameinfo"):
        setattr(socket, nombre, _resolucion_local(getattr(socket, nombre)))
    setattr(socket, _APLICADA, True)


def aplicada() -> bool:
    """Indica si la guardia está puesta en este proceso.

    Returns:
        True si `aplicar` ya se ejecutó aquí.
    """
    return bool(getattr(socket, _APLICADA, False))
