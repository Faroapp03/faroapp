"""Descubre altas de HP LIFE recorriendo su índice público y uniéndolo con las identidades conocidas.

Una alta es un curso que el índice declara y el catálogo no conoce: entra como candidata con la evidencia de su
página. Las bajas salen de este mismo censo en `bajas.py`, solo si es completo.
"""

from collections.abc import Callable, Collection
from dataclasses import dataclass
from pathlib import Path

from plataforma_datos.cursos import recepciones_catalogo as recepciones
from plataforma_datos.cursos.fuentes.hp_life import adquisicion, indice
from plataforma_datos.cursos.fuentes.hp_life.lector import ErrorFichaHpLife
from plataforma_datos.cursos.fuentes.hp_life.recepciones import leer_recepcion


@dataclass(frozen=True, kw_only=True)
class RecorridoIndice:
    """Lo conservado y lo leído al recorrer el índice; `censo` dice si cubre el total declarado."""

    adquiridas: tuple[adquisicion.AdquisicionHpLife, ...]
    paginas: tuple[indice.PaginaIndice, ...]
    censo: indice.CensoIndice


def recorrer(*, area: Path, reloj: Callable[[], str] = recepciones.ahora_utc) -> RecorridoIndice:
    """Lee las páginas del índice, en serie, hasta cubrir el total que declaran o hasta que una falle.

    Una página caída, incompleta o mal formada detiene el recorrido: lo ya leído se conserva y el censo
    queda parcial; no se interpreta como el final del índice.

    Returns:
        Intentos y recepciones conservados, páginas leídas y censo resultante.
    """
    adquiridas, paginas = [], []
    for numero in range(1, indice.MAX_PAGINAS + 1):
        adquirida = adquisicion.recibir_indice(numero, area=area, reloj=reloj)
        adquiridas.append(adquirida)
        rx = adquirida.recepcion
        if rx is None:
            break
        try:
            recepcion = leer_recepcion(rx.cuerpo.ruta.read_bytes(), rx.recibo.ruta.read_bytes())
            pagina = indice.extraer_indice(recepcion.cuerpo, recepcion.captura)
        except ErrorFichaHpLife:
            break
        paginas.append(pagina)
        if sum(len(p.cursos) for p in paginas) >= pagina.total or not pagina.cursos:
            break
    return RecorridoIndice(
        adquiridas=tuple(adquiridas),
        paginas=tuple(paginas),
        censo=indice.censo(paginas),
    )


def altas(censo: indice.CensoIndice, conocidas: Collection[str]) -> tuple[indice.CursoIndice, ...]:
    """Cursos que el índice lista, el catálogo no conoce y tienen un idioma con el que la fuente da altas.

    Una alta se descubre aunque el censo sea parcial: lo visto en una página es evidencia directa de que existe.

    Returns:
        Las altas, en el orden del índice.
    """
    conocidas = set(conocidas)
    return tuple(c for c in censo.cursos if c.identidad not in conocidas and c.idioma in indice.IDIOMAS_ALTA)
