"""Citilab: una ficha retirada se pide por su número a la API WordPress que lee su descarga.

La ficha (`citilab:formacio`, el número de la entrada) se pide a `API/formacio/<número>` con los mismos campos que la
descarga (`constantes.CONSULTAS`), y su fin se lee de la sección de duración con el lector de la fuente
(`lector.calendario_de_la_ficha`).

- `disponible`: la ficha sale publicada y su fin aún no ha pasado.
- `cerrado`: la ficha sale publicada, pero su fin ya pasó.
- `no_existe`: la API responde 404: ninguna ficha publicada con ese número.
- `dudoso`: una página de comprobación antirrobots en lugar de datos, un acceso rechazado, una ficha sin fin legible
  o una respuesta con otra forma. La comprobación antirrobots no se intenta saltar: la ficha queda sin decidir.
"""

import re
from collections.abc import Mapping
from http import HTTPStatus

from plataforma_datos.cursos.comprobacion_api.consultor import (
    Consultor,
    Lectura,
    dudoso,
    json_de,
    por_el_fin,
    respuesta_ajena,
)
from plataforma_datos.cursos.comprobacion_pagina.consulta_de_retirados import Ficha
from plataforma_datos.cursos.comprobacion_pagina.respuesta import Respuesta
from plataforma_datos.cursos.fuentes.citilab import lector, paginacion
from plataforma_datos.cursos.fuentes.citilab.constantes import API, CONSULTAS

FICHA = re.compile(r"[1-9][0-9]{0,11}")
RECURSO, CAMPOS, _ = CONSULTAS[0]


def direccion(curso: str, _fichas: Mapping[str, Ficha]) -> str | None:
    """La ficha en la API, con los campos que pide la descarga.

    Returns:
        Su dirección, o None si el identificador no es el número de una ficha.
    """
    return f"{API}/{RECURSO}/{curso}?_fields={CAMPOS}" if FICHA.fullmatch(curso) else None


def _es_la_ficha(ficha: object, curso: str) -> bool:
    if not isinstance(ficha, dict) or ficha.get("id") != int(curso):
        return False
    contenido = ficha.get("content")
    return isinstance(contenido, dict) and isinstance(contenido.get("rendered"), str)


def decidir(curso: str, respuesta: Respuesta, pedido_utc: str) -> Lectura:
    """Lo que la API de hoy dice de la ficha.

    Returns:
        La lectura de la ficha.
    """
    if paginacion.es_pagina_html(respuesta.cuerpo, {"Content-Type": respuesta.tipo or ""}):
        return dudoso("pagina_de_comprobacion", f"HTTP {respuesta.http}")
    if respuesta.http == HTTPStatus.NOT_FOUND:
        return Lectura(veredicto="no_existe", motivo="http_no_encontrada", dato=f"HTTP {respuesta.http}")
    ajena = respuesta_ajena(respuesta)
    if ajena is not None:
        return ajena
    ficha = json_de(respuesta)
    if not _es_la_ficha(ficha, curso):
        return dudoso("respuesta_con_otra_forma", type(ficha).__name__)
    _, _, fin = lector.calendario_de_la_ficha(ficha)
    return por_el_fin(fin, f"fin={fin}", pedido_utc)


CONSULTOR = Consultor(direccion=direccion, decidir=decidir)
