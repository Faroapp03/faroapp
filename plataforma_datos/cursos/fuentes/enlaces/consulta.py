"""Una consulta de un enlace con las guardas de red comunes, que siempre termina en una observación.

Usa la descarga común (identidad genérica, pausa de dos segundos por dominio, plazo y tope de bytes). Un fallo de red
no es una excepción de este módulo: es una observación inconcluyente que dice por qué, para que se anote sin cambiar lo
que ve la persona.
"""

import hashlib
from collections.abc import Callable, Mapping
from datetime import UTC, datetime
from http.client import HTTPException
from typing import Final
from urllib.error import HTTPError
from urllib.parse import urlsplit

from plataforma_datos.comun import red
from plataforma_datos.comun.nucleo import FormatoInesperado
from plataforma_datos.cursos.fuentes.enlaces.observaciones import PROGRAMAS, Observacion, observacion

SEGUNDOS_POR_CONSULTA: Final = 30
# Una web o una ficha no se leen enteras: basta su código. El PDF de un programa se lee para comprobar que lo es.
MAX_BYTES_DE_UNA_WEB: Final = 256 * 1024
MAX_BYTES_DE_UN_PDF: Final = 8 * 1024 * 1024
CABECERA_PDF: Final = b"%PDF-"

type Reloj = Callable[[], datetime]


def _ahora() -> datetime:
    return datetime.now(UTC)


def _instante(reloj: Reloj) -> str:
    return reloj().replace(microsecond=0).isoformat()


def _otro_origen(pedida: str, final: str) -> bool:
    return urlsplit(pedida).hostname != urlsplit(final).hostname


def _sin_respuesta(reloj: Reloj, motivo: str) -> Observacion:
    return observacion(_instante(reloj), None, None, motivo=motivo)


def _al_pasar_el_limite(url: str, es_programa: bool, recibidos: list[tuple[int, str]], reloj: Reloj) -> Observacion:
    """La observación de una respuesta cuyo cuerpo pasó del límite de bytes.

    Una web o una ficha no necesitan su cuerpo: si ya se leyeron el código y el destino, bastan. Un programa necesita el
    PDF entero para su huella, así que no concluye.

    Returns:
        La observación con el código y el destino leídos, o inconcluyente por el límite.
    """
    if es_programa or not recibidos:
        return _sin_respuesta(reloj, "limite")
    codigo, final = recibidos[-1]
    return observacion(_instante(reloj), codigo, final, otro_origen=_otro_origen(url, final))


def consultar(url: str, conjunto: str, reloj: Reloj = _ahora) -> Observacion:
    """Pide un enlace y anota lo que respondió.

    Un 404 o un 410 de urllib llegan como HTTPError y son una respuesta. Los fallos de red, los plazos y los límites de
    tamaño son observaciones inconcluyentes con su motivo. Una redirección a otro origen se sigue y se anota.

    Args:
        url: La dirección.
        conjunto: El conjunto del enlace; en un programa se comprueba además que lo recibido sea un PDF.
        reloj: El reloj, para las pruebas.

    Returns:
        La observación.
    """
    es_programa = conjunto == PROGRAMAS
    recibidos: list[tuple[int, str]] = []

    def anotar_codigo(codigo: int, destino: str, _cabeceras: Mapping[str, str]) -> None:
        recibidos.append((codigo, destino))

    try:
        descarga = red.descargar_url(
            url,
            segundos=SEGUNDOS_POR_CONSULTA,
            maximo_bytes=MAX_BYTES_DE_UN_PDF if es_programa else MAX_BYTES_DE_UNA_WEB,
            comprobar_cabeceras=anotar_codigo,
            perfil="datos" if es_programa else "pagina",
        )
    except HTTPError as error:
        final = error.url or url
        error.close()
        return observacion(_instante(reloj), error.code, final, otro_origen=_otro_origen(url, final))
    except red.LimiteDescargaExcedido:
        return _al_pasar_el_limite(url, es_programa, recibidos, reloj)
    except TimeoutError:
        return _sin_respuesta(reloj, "plazo")
    except (HTTPException, OSError, FormatoInesperado):
        return _sin_respuesta(reloj, "red")
    otro = _otro_origen(url, descarga.url_final)
    if not es_programa:
        return observacion(_instante(reloj), recibidos[-1][0], descarga.url_final, otro_origen=otro)
    es_pdf = descarga.datos.startswith(CABECERA_PDF)
    huella = hashlib.sha256(descarga.datos).hexdigest() if es_pdf else None
    return observacion(
        _instante(reloj), recibidos[-1][0], descarga.url_final, es_pdf=es_pdf, huella=huella, otro_origen=otro
    )
