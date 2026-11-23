"""Cibervoluntarios: un material retirado se busca en la API pública de su catálogo, la que lee su descarga.

El material (`cibervoluntarios:material:<id>`) se publica en la ficha de su slug (`rutas_publicas.FICHA`); su API
filtra el catálogo por ese slug y la respuesta se lee con el lector de la fuente (`lector.extraer_materiales`). Un
mismo slug puede salir en dos materiales de la misma actividad, así que se busca por el identificador del material.

- `disponible`: el material y su actividad salen «Disponible» y sin borrar.
- `cerrado`: el material o su actividad salen borrados (`erased`) o «Descatalogado».
- `no_existe`: ningún material con ese slug.
- `dudoso`: otro estado, el slug en otro material sin el identificador publicado, o un filtro que no se aplicó.
"""

import hashlib
import re
from collections.abc import Mapping
from urllib.parse import parse_qs, unquote, urlencode, urlsplit

from plataforma_datos.cursos.comprobacion_api.consultor import Consultor, Lectura, dudoso, respuesta_ajena
from plataforma_datos.cursos.comprobacion_pagina.consulta_de_retirados import Ficha
from plataforma_datos.cursos.comprobacion_pagina.respuesta import Respuesta
from plataforma_datos.cursos.fuentes.cibervoluntarios import adquisicion, lector, lectura, rutas_publicas

MATERIAL = re.compile(re.escape(lectura.PREFIJO_MATERIAL) + r"(?P<id>[1-9][0-9]{0,11})")
FICHA = re.compile(re.escape(rutas_publicas.FICHA) + r"(?P<slug>[A-Za-z0-9%_.-]{1,200})")
FILTRO = "activityCatalogMaterials.slug"
CIERRES = {"borrado": "material_borrado", "descatalogado": "material_descatalogado"}


def _slug(curso: str, fichas: Mapping[str, Ficha]) -> str | None:
    ficha = fichas.get(curso)
    coincidencia = None if ficha is None else FICHA.fullmatch(ficha.url)
    return None if coincidencia is None else unquote(coincidencia["slug"])


def direccion(curso: str, fichas: Mapping[str, Ficha]) -> str | None:
    """El catálogo filtrado por el slug de la ficha servida del material.

    Returns:
        Su dirección, o None si el curso no es un material con su ficha servida.
    """
    slug = _slug(curso, fichas) if MATERIAL.fullmatch(curso) else None
    return None if slug is None else f"{adquisicion.API}?{urlencode({FILTRO: slug})}"


def _materiales(respuesta: Respuesta, pedido_utc: str) -> tuple[lector.MaterialCiber, ...]:
    captura = lector.CapturaCiber(
        url=respuesta.url,
        sha256=hashlib.sha256(respuesta.cuerpo).hexdigest(),
        bytes_cuerpo=len(respuesta.cuerpo),
        inicio_utc=pedido_utc,
        recibido_utc=pedido_utc,
        http=respuesta.http,
        completo=True,
        localizador="/hydra:member",
    )
    return lector.extraer_materiales(respuesta.cuerpo, captura)


def _estado(material: lector.MaterialCiber) -> Lectura:
    baja = material.baja_declarada
    if material.disponible:
        return Lectura(veredicto="disponible", motivo="material_disponible", dato="status=Disponible")
    if baja is not None and baja[0] in CIERRES:
        motivo, valor, campo, objeto = baja
        return Lectura(veredicto="cerrado", motivo=CIERRES[motivo], dato=f"{objeto}.{campo}={valor}")
    return dudoso("estado_desconocido", material.material_publicado.get("status"))


def decidir(curso: str, respuesta: Respuesta, pedido_utc: str) -> Lectura:
    """Lo que el catálogo filtrado por su slug dice del material.

    Returns:
        La lectura del material.
    """
    ajena = respuesta_ajena(respuesta)
    if ajena is not None:
        return ajena
    try:
        materiales = _materiales(respuesta, pedido_utc)
    except lector.ErrorLecturaCiber as error:
        return dudoso("respuesta_con_otra_forma", error)
    if not materiales:
        return Lectura(veredicto="no_existe", motivo="ausente_de_la_oferta")
    slug = parse_qs(urlsplit(respuesta.url).query)[FILTRO][0]
    con_el_slug = [material for material in materiales if material.slug == slug]
    if not con_el_slug:
        return dudoso("filtro_no_aplicado", f"{len(materiales)} materiales sin el slug")
    identificador = int(MATERIAL.fullmatch(curso)["id"])
    propio = [material for material in con_el_slug if material.id == identificador]
    if not propio:
        return dudoso("identificador_distinto", ",".join(str(material.id) for material in con_el_slug))
    return _estado(propio[0])


CONSULTOR = Consultor(direccion=direccion, decidir=decidir)
