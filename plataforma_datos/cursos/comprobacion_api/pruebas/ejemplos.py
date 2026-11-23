"""Respuestas grabadas de las API de cada fuente, escritas a mano con la forma que publican: sin red."""

import json

from plataforma_datos.cursos.comprobacion_api import citilab, consorci, fundae
from plataforma_datos.cursos.comprobacion_pagina.consulta_de_retirados import Ficha
from plataforma_datos.cursos.comprobacion_pagina.respuesta import Respuesta
from plataforma_datos.cursos.fuentes.cibervoluntarios import rutas_publicas
from plataforma_datos.cursos.fuentes.formacion import lector as lector_soc
from plataforma_datos.cursos.fuentes.fundae import tramite
from plataforma_datos.cursos.pruebas.test_citilab import ficha as ficha_citilab
from plataforma_datos.cursos.pruebas.test_lectura_soc import fila, ident, oferta

HORA = "2026-11-23T05:00:00Z"
# El día después del fin de la ficha de Citilab de las pruebas (24/11/2026) y de la edición del Consorci.
MAS_TARDE = "2026-12-20T05:00:00Z"

CURSO_SOC = ident(1)
OFERTA_SOC = oferta(fila(1, inicio="10/01/2026", fin="12/15/2026"), fila(2))

DIFUSION = 1971
EDICION_FUNDAE = f"fundae:edicion:{DIFUSION}"
CODIGO_FUNDAE = "IFCT0089"
FICHAS_FUNDAE = {EDICION_FUNDAE: Ficha(url=tramite.ficha(CODIGO_FUNDAE), titulo="Inteligencia artificial")}

MATERIAL = 905
SLUG = "youtube-intermedio"
MATERIAL_CIBER = f"cibervoluntarios:material:{MATERIAL}"
FICHAS_CIBER = {MATERIAL_CIBER: Ficha(url=rutas_publicas.FICHA + SLUG, titulo="YouTube intermedio")}

EDICION_CONSORCI = "294021-2-20261001-20261215-t"
FICHA_CITILAB = "812"


def respuesta(url: str, cuerpo: object, http: int = 200, tipo: str = "application/json") -> Respuesta:
    """Una respuesta de la API: el cuerpo en JSON (o tal cual, si ya son bytes) con su estado y su tipo.

    Returns:
        La respuesta grabada.
    """
    datos = cuerpo if isinstance(cuerpo, bytes) else json.dumps(cuerpo, ensure_ascii=False).encode()
    return Respuesta(url=url, http=http, url_final=url, tipo=tipo, cuerpo=datos)


def soc(cuerpo: bytes = OFERTA_SOC) -> Respuesta:
    """La oferta oficial del SOC.

    Returns:
        La respuesta, en latin-1 como la publica el SOC.
    """
    return respuesta(lector_soc.URL_OFERTA_SOC, cuerpo, tipo="application/json;charset=ISO-8859-1")


def difusiones(*filas: dict, http: int = 200) -> Respuesta:
    """La ficha de difusiones de la especialidad de FUNDAE.

    Returns:
        La respuesta.
    """
    return respuesta(fundae.direccion(EDICION_FUNDAE, FICHAS_FUNDAE), {"curso": {}, "centrosRFO": list(filas)}, http)


def difusion(inicio: str = "2026-09-01", fin: str = "2027-02-28", identificador: int = DIFUSION) -> dict:
    """Una difusión de FUNDAE con su plazo de preinscripción.

    Returns:
        La fila de la difusión.
    """
    return {
        "idDifusionAccionFormativa": identificador,
        "fechaPreinscripcionInicio": f"{inicio}T00:00:00",
        "fechaPreinscripcionFin": f"{fin}T00:00:00",
    }


def material(identificador: int = MATERIAL, slug: str = SLUG, **campos: object) -> dict:
    """Un material del catálogo de Cibervoluntarios.

    Returns:
        El material tal como lo publica la API.
    """
    return {"id": identificador, "slug": slug, "status": "Disponible", "erased": False, "lang": "es", **campos}


def catalogo(*materiales: dict, actividad: dict | None = None) -> Respuesta:
    """El catálogo de Cibervoluntarios filtrado por el slug, con una actividad que contiene esos materiales.

    Returns:
        La respuesta, en formato Hydra.
    """
    miembros = [] if not materiales else [{"id": 10, "status": "Disponible", "erased": False, **(actividad or {})}]
    if miembros:
        miembros[0]["activityCatalogMaterials"] = list(materiales)
    url = f"https://www.cibervoluntarios.org/api/public/activity_catalogs?activityCatalogMaterials.slug={SLUG}"
    return respuesta(url, {"hydra:totalItems": len(miembros), "hydra:member": miembros})


def accion(**campos: str) -> dict:
    """Una fila del conjunto de acciones programadas del Consorci, la de `EDICION_CONSORCI`.

    Returns:
        La fila tal como la publica Socrata.
    """
    base = {
        "identificador": "294021",
        "num_grup": "2",
        "data_inici": "2026-10-01T00:00:00.000",
        "data_final": "2026-12-15T00:00:00.000",
        "modalitat": "Teleformació",
    }
    return {**base, **campos}


def acciones(*filas: dict) -> Respuesta:
    """Las filas de la acción en el conjunto del Consorci.

    Returns:
        La respuesta de Socrata.
    """
    return respuesta(consorci.direccion(EDICION_CONSORCI, {}), list(filas))


def ficha_de_citilab(http: int = 200, **cambios: object) -> Respuesta:
    """La ficha de Citilab en su API WordPress.

    Returns:
        La respuesta.
    """
    return respuesta(citilab.direccion(FICHA_CITILAB, {}), ficha_citilab(id=int(FICHA_CITILAB), **cambios), http)


def comprobacion_antirrobots(http: int = 200) -> Respuesta:
    """La página HTML con que la web de Citilab responde a veces en lugar de los datos.

    Returns:
        La respuesta.
    """
    cuerpo = b"<!DOCTYPE html><html><body>Comprovant que no sou un robot</body></html>"
    return respuesta(citilab.direccion(FICHA_CITILAB, {}), cuerpo, http, "text/html; charset=UTF-8")
