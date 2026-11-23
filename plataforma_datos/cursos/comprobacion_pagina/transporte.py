"""Pide la página pública de un curso, o la API de su fuente, con el transporte común y la deja en la forma que se lee.

Usa `descargar_url` con la identidad genérica del producto, el turno y la pausa de cortesía por dominio y un instante
límite que incluye la espera del turno. La página se pide con el perfil de página y la API con el de datos, el mismo
con que la fuente descarga su oferta. Una respuesta de error (404, 500…) también es una observación y se conserva con
su estado; lo que no llegó a responder (red, plazo, certificado) queda sin estado.
"""

from collections.abc import Mapping
from urllib.error import HTTPError, URLError

from plataforma_datos.comun import perfil_web
from plataforma_datos.comun.nucleo import FormatoInesperado
from plataforma_datos.comun.red import descargar_url
from plataforma_datos.cursos.comprobacion_pagina.respuesta import Respuesta

# Una ficha de curso cabe de sobra en 2 MiB (la mayor del censo de verdad, la del SOC, tiene unos 225 KB), y también
# la respuesta de una API: la oferta entera del SOC ocupa unos 515 KB.
MAX_BYTES = 2 * 1024 * 1024
# La espera máxima de cada operación del socket: una ficha sana llega en menos de 10 s.
SEGUNDOS = 15


def _cuerpo_del_error(error: HTTPError) -> bytes:
    try:
        return error.read(MAX_BYTES)
    except (OSError, ValueError):
        return b""


def _pedir(url: str, hasta: float, perfil: perfil_web.Uso) -> Respuesta:
    estados: list[int] = []

    def anotar_estado(estado: int, _final: str, _cabeceras: Mapping[str, str]) -> None:
        estados.append(estado)

    try:
        descarga = descargar_url(
            url,
            segundos=SEGUNDOS,
            maximo_bytes=MAX_BYTES,
            comprobar_cabeceras=anotar_estado,
            perfil=perfil,
            hasta=hasta,
        )
    except HTTPError as error:
        final = error.url or url
        return Respuesta(
            url=url,
            http=error.code,
            url_final=final,
            saltos=int(final != url),
            tipo=error.headers.get("Content-Type") if error.headers else None,
            cuerpo=_cuerpo_del_error(error),
        )
    except (URLError, TimeoutError, OSError, FormatoInesperado):
        return Respuesta(url=url, http=None)
    return Respuesta(
        url=url,
        http=estados[-1],
        url_final=descarga.url_final,
        saltos=int(descarga.url_final != url),
        tipo=descarga.content_type or None,
        cuerpo=descarga.datos,
    )


def pedir_pagina(url: str, hasta: float) -> Respuesta:
    """Pide la página sin pasar del instante monotónico `hasta`.

    Returns:
        Lo observado: el estado HTTP, la dirección final, si hubo redirección, el tipo y el cuerpo; sin estado si no
        hubo respuesta.
    """
    return _pedir(url, hasta, "pagina")


def pedir_datos(url: str, hasta: float) -> Respuesta:
    """Pide la API de una fuente con el perfil de datos sin pasar del instante monotónico `hasta`.

    Returns:
        Lo observado, con la misma forma que una página.
    """
    return _pedir(url, hasta, "datos")
