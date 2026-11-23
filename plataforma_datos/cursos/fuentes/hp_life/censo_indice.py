"""Censo del índice de HP LIFE reproducido desde las páginas conservadas.

Lee cada página con sus bytes y su recibo; una página ausente, caída o ilegible queda sin noticia y vuelve parcial
el censo, sin parar la fuente. Lo que devuelve es lo que la composición del catálogo necesita: qué cursos se han visto
y en qué página, y si el censo es completo.
"""

import re
from collections.abc import Callable

from plataforma_datos.cursos.fuentes.hp_life import bajas, indice
from plataforma_datos.cursos.fuentes.hp_life.lector import ErrorFichaHpLife
from plataforma_datos.cursos.fuentes.hp_life.recepciones import leer_recepcion
from plataforma_datos.cursos.tipos_json import ObjetoJson

PREFIJO = "indice-"
ID = re.compile(r"hp-life:[1-9][0-9]*:[a-z]{2}")


def clave(pagina: int) -> str:
    """Nombre de una página en los auxiliares de la procedencia.

    Returns:
        Clave `indice-N`.
    """
    return f"{PREFIJO}{pagina}"


def _numero(nombre: str) -> int | None:
    resto = nombre.removeprefix(PREFIJO)
    return int(resto) if nombre.startswith(PREFIJO) and indice.PAGINA.fullmatch(resto) else None


def _leer_pagina(captura: ObjetoJson, leer: Callable[[ObjetoJson], bytes]) -> indice.PaginaIndice | None:
    if captura.get("cuerpo") is None or captura.get("recibo") is None:
        return None
    try:
        recepcion = leer_recepcion(leer(captura["cuerpo"]), leer(captura["recibo"]))
        return indice.extraer_indice(recepcion.cuerpo, recepcion.captura)
    except ErrorFichaHpLife:
        return None


def calcular(auxiliares: ObjetoJson, leer: Callable[[ObjetoJson], bytes]) -> ObjetoJson | None:
    """Reproduce el censo del índice desde los auxiliares de una consulta.

    Returns:
        El censo (completitud, motivo, páginas con su evidencia, cursos y página donde se ven) o None si la
        consulta no trajo índice.
    """
    numeradas = {n: c for k, c in auxiliares.items() if (n := _numero(k)) is not None}
    if not numeradas:
        return None
    leidas, sin_noticia = {}, []
    for numero in sorted(numeradas):
        pagina = _leer_pagina(numeradas[numero], leer)
        if pagina is None or pagina.pagina != numero:
            sin_noticia.append(numero)
        else:
            leidas[numero] = pagina
    censo = indice.censo(list(leidas.values()))
    cursos: dict[str, int] = {}
    for numero, pagina in leidas.items():
        for curso in pagina.cursos:
            cursos.setdefault(curso.identidad, numero)
    return {
        "completo": censo.completo,
        "motivo": censo.motivo,
        "paginas": [
            {
                "pagina": n,
                "total": p.total,
                "cuerpo": numeradas[n]["cuerpo"],
                "recibo": numeradas[n]["recibo"],
                "recibido_utc": p.captura.recibido_utc,
            }
            for n, p in leidas.items()
        ],
        "paginas_sin_noticia": sin_noticia,
        "cursos": cursos,
        "otros_idiomas": sorted(i for i in cursos if i.rsplit(":", 1)[1] not in indice.IDIOMAS_ALTA),
    }


def identidades_de_alta(censo: ObjetoJson | None) -> set[str]:
    """Cursos del censo con un idioma que la fuente admite.

    Returns:
        Identidades que pueden darse de alta; vacío sin censo.
    """
    if censo is None:
        return set()
    return set(censo["cursos"]) - set(censo["otros_idiomas"])


def altas_pendientes(pendientes: list[ObjetoJson], fuente: str) -> set[str]:
    """Altas de HP LIFE admitidas en una consulta anterior y todavía sin instalar.

    Returns:
        Sus identidades; vacío para otra fuente.
    """
    return {c["id"] for c in pendientes if fuente == "hp_life" and ID.fullmatch(c["id"])}


def reproduce(auxiliares: ObjetoJson, leer: Callable[[ObjetoJson], bytes], conjunto: ObjetoJson) -> bool:
    """Comprueba que el censo y las bajas de un conjunto admitido salen de las páginas conservadas.

    Returns:
        True si ambos coinciden con lo recalculado.
    """
    censo = calcular(auxiliares, leer)
    return censo == conjunto.get("indice") and (
        censo is None or bajas.decidir(censo, conjunto["recepciones"]) == conjunto.get("bajas")
    )
