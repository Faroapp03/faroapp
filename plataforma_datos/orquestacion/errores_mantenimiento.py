"""Por qué el servidor no confirmó una operación de mantenimiento: sin respuesta, rechazo o respuesta ilegible.

Solo depende de las formas cerradas del diario: lo importan a la vez el cliente que llama al servidor y el diario que
anota la causa, sin ciclos. Ningún error lleva texto del servidor, rutas ni credenciales.
"""

from plataforma_datos.orquestacion.formas_del_diario import CAUSA_SERVIDOR_RECHAZA, CAUSA_SERVIDOR_SIN_RESPUESTA


class ErrorMantenimiento(ValueError):
    """Un fallo o una respuesta ambigua no conceden permiso para ejecutar el motor."""

    causa: str | None = None


class ServidorSinRespuesta(ErrorMantenimiento):
    """No llegó respuesta a tiempo, se cortó la conexión o el servidor dijo que no pudo terminar (5xx).

    La operación es incierta: pudo quedar hecha. Repetir los mismos bytes es seguro, porque el servidor reconoce lo ya
    aplicado y responde `repetido`.
    """

    causa = CAUSA_SERVIDOR_SIN_RESPUESTA


class RechazoDelServidor(ErrorMantenimiento):
    """El servidor respondió y no admitió la operación (4xx): repetir lo mismo obtendría la misma respuesta."""

    causa = CAUSA_SERVIDOR_RECHAZA
