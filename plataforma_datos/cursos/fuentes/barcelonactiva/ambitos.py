"""Cibernàrium: el nombre del ámbito de IA y la instancia del portlet, leídos de su página pública de filtros.

La página `/ca/web/guest/formacions` publica cada ámbito en un bloque `<div class="scopeParent" idscope="N">` con su
enlace `javascript:_<portlet>_searchScope(N, '<nombre>')`. Ámbitos y subámbitos numeran por separado (también hay un
subámbito 22, `searchSubscope(22, …)`, que es otra cosa): aquí solo se lee `searchScope(22, …)` dentro del bloque
`idscope="22"`. El nombre tiene que seguir siendo «Intel·ligència Artificial (IA)»; si cambia o no aparece, el censo de
IA no se consulta y lo publicado se conserva. La instancia del portlet de esa misma página es la que usan las
direcciones del censo; si cambia, se usa la nueva y queda dicho.
"""

import html
import re
from http import HTTPStatus
from pathlib import Path
from typing import Any

from plataforma_datos.cursos.fuentes.barcelonactiva import adquisicion
from plataforma_datos.cursos.fuentes.barcelonactiva import robot_cibernarium as robot

FILTROS = robot.ORIGEN + "/ca/web/guest/formacions"
AMBITO_IA = "22"
NOMBRE_AMBITO_IA = "Intel·ligència Artificial (IA)"
# El bloque del ámbito 22 y, dentro de él, su enlace de búsqueda con la instancia del portlet y el nombre.
BLOQUE_AMBITO = re.compile(r'<div class="scopeParent" idscope="22">(.*?)</a>', re.DOTALL)
ENLACE_AMBITO = re.compile(r"javascript:_(cAct_INSTANCE_[A-Za-z0-9]{1,32})_searchScope\(22,\s*'([^']*)'\)")
# Motivos que detienen el censo de IA (el cambio de instancia solo se avisa).
PAGINA_CAIDA, SIN_PORTLET = "pagina-de-ambitos-caida", "portlet-no-encontrado"
SIN_NOMBRE, AMBITO_CAMBIADO = "ambito-ia-sin-nombre", "ambito-ia-cambiado"
DETIENEN = frozenset({PAGINA_CAIDA, SIN_PORTLET, SIN_NOMBRE, AMBITO_CAMBIADO})
PORTLET_CAMBIADO = "portlet-cambiado"
MOTIVOS = DETIENEN | {PORTLET_CAMBIADO}


def en_la_pagina(texto: str) -> tuple[str | None, str | None]:
    """La instancia del portlet y el nombre del ámbito 22 que publica la página de filtros.

    Returns:
        (instancia, nombre); None en lo que no aparece.
    """
    bloque = BLOQUE_AMBITO.search(texto)
    enlace = ENLACE_AMBITO.search(bloque.group(1)) if bloque else None
    if enlace is None:
        cualquiera = re.search(r"_(cAct_INSTANCE_[A-Za-z0-9]{1,32})_a_scope_", texto)
        return (cualquiera.group(1) if cualquiera else None), None
    return enlace.group(1), html.unescape(enlace.group(2))


def leer(carpeta: Path, captura: dict[str, Any]) -> tuple[str | None, str | None]:
    """Comprueba la página de filtros conservada: el ámbito 22 se llama como siempre y la instancia del portlet.

    Returns:
        (instancia, motivo): la instancia que usar, o None; y el motivo si el censo de IA no debe consultarse, si la
        instancia cambió (`portlet-cambiado`) o None si todo cuadra.
    """
    cuerpo, meta = adquisicion.pagina(carpeta, captura)
    if cuerpo is None or meta["http"] != HTTPStatus.OK or meta["completo"] is not True:
        return None, PAGINA_CAIDA
    instancia, nombre = en_la_pagina(cuerpo.decode("utf-8", "replace"))
    if instancia is None:
        return None, SIN_PORTLET
    if nombre is None:
        return instancia, SIN_NOMBRE
    if nombre != NOMBRE_AMBITO_IA:
        return instancia, AMBITO_CAMBIADO
    return instancia, (None if instancia == robot.PORTLET else PORTLET_CAMBIADO)
