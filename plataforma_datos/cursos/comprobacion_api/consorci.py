"""Consorci: una edición retirada se busca en el conjunto de acciones programadas que lee su descarga (Socrata).

La edición (`<acción>-<grupo>-<inicio>-<fin>-<modalidad>`, `filas_publicadas.id_de_edicion`) se pide al conjunto
`ACCIONES`, el de la lectura, filtrado por su acción como la descarga filtra la oferta por su origen. Cada fila que
llega se identifica igual que en la lectura, así que solo cuenta la que es la misma edición.

- `disponible`: la edición sale y su fin publicado aún no ha pasado.
- `cerrado`: la edición sale, pero su fin publicado ya pasó.
- `no_existe`: la acción responde sin esa edición.
- `dudoso`: un fin que no se lee o una respuesta que no es una lista de filas.
"""

import re
from collections.abc import Mapping
from urllib.parse import urlencode

from plataforma_datos.comun import socrata
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
from plataforma_datos.cursos.fuentes.consorci.constantes import ACCIONES
from plataforma_datos.cursos.fuentes.consorci.filas_publicadas import fecha_iso, id_de_edicion

# Una acción sin guiones ni comillas, como las publicadas: así el identificador se parte sin ambigüedad y la acción
# va literal en el filtro.
EDICION = re.compile(r"(?P<accion>[^-'\s]{1,40})-(?P<grupo>[^-]{0,40})-(\d{8})?-(\d{8})?-[a-z]")
CAMPOS_DE_LA_EDICION = ("identificador", "num_grup", "data_inici", "data_final", "modalitat")


def direccion(curso: str, _fichas: Mapping[str, Ficha]) -> str | None:
    """Las filas de la acción de la edición en el conjunto de acciones programadas.

    Returns:
        Su dirección, o None si el identificador no es el de una edición.
    """
    edicion = EDICION.fullmatch(curso)
    if edicion is None:
        return None
    consulta = {"$where": f"identificador='{edicion['accion']}'", "$order": ":id"}
    return f"{socrata.API}/resource/{ACCIONES.identificador}.json?{urlencode(consulta)}"


def _de_la_edicion(fila: object, curso: str) -> bool:
    return (
        isinstance(fila, dict)
        and all(isinstance(fila.get(campo), str) for campo in CAMPOS_DE_LA_EDICION)
        and id_de_edicion(fila) == curso
    )


def decidir(curso: str, respuesta: Respuesta, pedido_utc: str) -> Lectura:
    """Lo que el conjunto de acciones de hoy dice de la edición.

    Returns:
        La lectura de la edición.
    """
    ajena = respuesta_ajena(respuesta)
    if ajena is not None:
        return ajena
    filas = json_de(respuesta)
    if not isinstance(filas, list):
        return dudoso("respuesta_con_otra_forma", type(filas).__name__)
    propias = [fila for fila in filas if _de_la_edicion(fila, curso)]
    if not propias:
        return Lectura(veredicto="no_existe", motivo="ausente_de_la_oferta")
    publicado = propias[0]["data_final"]
    return por_el_fin(fecha_iso(publicado), f"data_final={publicado}", pedido_utc)


CONSULTOR = Consultor(direccion=direccion, decidir=decidir)
