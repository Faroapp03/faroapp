"""Lo que comparten los consultores de las API: qué se pregunta por un curso y cómo se lee lo que responde.

Cada fuente que se comprueba por su API declara un `Consultor`: la dirección de su API que responde por un curso
retirado (o ninguna, si de ese curso no se puede preguntar) y cómo se decide con la respuesta. Lo que no deja decidir a
ninguna fuente, la falta de respuesta o un error del servidor, se lee aquí una sola vez.
"""

import json
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import date
from http import HTTPStatus

from plataforma_datos.comun.dia_de_consulta import dia_en_cataluna
from plataforma_datos.cursos.comprobacion_pagina.consulta_de_retirados import Ficha
from plataforma_datos.cursos.comprobacion_pagina.contrato import falla_el_servidor
from plataforma_datos.cursos.comprobacion_pagina.respuesta import Respuesta
from plataforma_datos.cursos.tipos_json import ValorJson

RECHAZOS = (HTTPStatus.UNAUTHORIZED, HTTPStatus.FORBIDDEN)


@dataclass(frozen=True, kw_only=True)
class Lectura:
    """Lo que la API dice de un curso: el veredicto, su motivo y el dato literal de la fuente que lo sostiene."""

    veredicto: str
    motivo: str
    dato: str | None = None


@dataclass(frozen=True, kw_only=True)
class Consultor:
    """Cómo se comprueba por su API un curso retirado de una fuente.

    `direccion` da, con el identificador del curso y las fichas servidas, la dirección de la API que responde por él,
    o None si de ese curso no se puede preguntar. `decidir` lee la respuesta del servidor con la hora en que se pidió.
    """

    direccion: Callable[[str, Mapping[str, Ficha]], str | None]
    decidir: Callable[[str, Respuesta, str], Lectura]


def dia_de(pedido_utc: str) -> date:
    """El día civil en Cataluña de la consulta: el mismo con que las lecturas de las fuentes leen un fin publicado.

    Returns:
        El día.
    """
    return dia_en_cataluna(pedido_utc)


def sin_respuesta(respuesta: Respuesta) -> Lectura | None:
    """Lo que queda cuando la API no contestó o el servidor falló: no es evidencia de nada.

    Returns:
        La lectura `sin_respuesta`, o None si el servidor contestó.
    """
    if respuesta.http is None:
        return Lectura(veredicto="sin_respuesta", motivo="error_de_red")
    if falla_el_servidor(respuesta.http):
        return Lectura(veredicto="sin_respuesta", motivo="error_del_servidor", dato=f"HTTP {respuesta.http}")
    return None


def dudoso(motivo: str, dato: object = None) -> Lectura:
    """Una respuesta que no deja decidir, con el dato literal que lo muestra.

    Returns:
        La lectura `dudoso`.
    """
    return Lectura(veredicto="dudoso", motivo=motivo, dato=None if dato is None else str(dato)[:200])


def por_el_fin(fin: str | None, publicado: str, pedido_utc: str) -> Lectura:
    """Lo que dice de un curso que sigue en la API su fin publicado: el día de fin aún cuenta, como en las lecturas.

    Args:
        fin: El fin en AAAA-MM-DD, o None si la fuente no lo publica legible.
        publicado: El dato literal de la fuente de donde sale el fin.
        pedido_utc: La hora de la consulta.

    Returns:
        `cerrado` si el fin ya pasó, `disponible` si no, y `dudoso` si no se lee.
    """
    if fin is None:
        return dudoso("fechas_ilegibles", publicado)
    if fin < dia_de(pedido_utc).isoformat():
        return Lectura(veredicto="cerrado", motivo="fin_pasado", dato=publicado)
    return Lectura(veredicto="disponible", motivo="en_la_oferta_de_hoy", dato=publicado)


def respuesta_ajena(respuesta: Respuesta) -> Lectura | None:
    """Una respuesta que no es la de la API: acceso rechazado u otro estado que no es un 200.

    Returns:
        La lectura `dudoso`, o None si la respuesta es un 200.
    """
    if respuesta.http in RECHAZOS:
        return dudoso("acceso_rechazado", f"HTTP {respuesta.http}")
    if respuesta.http != HTTPStatus.OK:
        return dudoso("respuesta_con_otra_forma", f"HTTP {respuesta.http}")
    return None


def json_de(respuesta: Respuesta, codificacion: str = "utf-8") -> ValorJson | None:
    """El JSON del cuerpo, o None si el cuerpo no es JSON en esa codificación.

    Returns:
        El valor JSON.
    """
    try:
        return json.loads(respuesta.cuerpo.decode(codificacion))
    except (UnicodeError, ValueError, RecursionError):
        return None
