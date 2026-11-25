"""El orden en que `componer_catalogo` aplica las fuentes al almacén de Cursos, cada una en su tramo.

HP LIFE va primero; después, cada fuente con ciclo propio (`FUENTES_DE_COMPONER`) aplica sus conjuntos pendientes y su
conjunto validado, y al final las ediciones de FUNDAE y la reevaluación de los registros. Cada paso corre dentro de su
tramo (`fallo_del_paso.tramo`), para que el error que salga de él diga en qué tramo saltó. Qué hace cada aplicación lo
decide quien la entrega (`Aplicaciones`): este módulo solo fija el orden, las carpetas de trabajo y los tramos.
"""

from collections.abc import Callable
from pathlib import Path
from typing import NamedTuple

from plataforma_datos.cursos import almacen_catalogo as almacen
from plataforma_datos.cursos import operacion_fuente, reevaluar_registros
from plataforma_datos.cursos.fuentes.fundae import preinscripcion
from plataforma_datos.orquestacion.fallo_del_paso import FUENTES_DE_COMPONER, tramo

# La carpeta de trabajo de cada fuente que se aplica tras HP LIFE (`fallo_del_paso.FUENTES_DE_COMPONER`, en su orden).
CARPETAS_DE_LAS_FUENTES = {
    "cibervoluntarios": "ciber",
    "claude_academy": "academy",
    "fundae": "fundae",
    "barcelonactiva": "cibernarium",
}
BARCELONACTIVA = "barcelonactiva"


class Aplicaciones(NamedTuple):
    """Lo que aplica cada fuente al almacén: la función de HP LIFE y la de cada fuente de `FUENTES_DE_COMPONER`."""

    hp: Callable[[Path, Path, Path, Path, str], Path]
    por_fuente: dict[str, Callable[..., Path]]


def aplicar_las_fuentes(
    raiz: Path,
    areas: tuple[Path, Path],
    corte: str,
    sin_identidades: tuple[str, ...],
    aplicaciones: Aplicaciones,
) -> Path:
    """Aplica al almacén, cada una en su tramo, HP LIFE, las demás fuentes con sus pendientes y las reevaluaciones.

    Args:
        raiz: La instalación de la candidata.
        areas: Las carpetas de trabajo de la composición: la de dentro de la instalación y la externa.
        corte: El corte del ciclo.
        sin_identidades: Las fuentes que no se aplican hasta tener identidades admitidas.
        aplicaciones: Lo que aplica cada fuente.

    Returns:
        El almacén resultante: el de la raíz si nada cambia.
    """
    base = raiz / almacen.RUTA
    local, externo = areas
    with tramo("hp_life"):
        nueva = (
            base
            if "hp_life" in sin_identidades
            else aplicaciones.hp(raiz, base, externo, local / "hp" / almacen.RUTA, corte)
        )
    for fuente in FUENTES_DE_COMPONER:
        if fuente in sin_identidades:
            continue
        nombre, aplicar = CARPETAS_DE_LAS_FUENTES[fuente], aplicaciones.por_fuente[fuente]
        # Los ciclos admitidos sin catálogo instalado van antes, cada uno con su corte y sus auxiliares.
        with tramo(f"pendiente-{fuente}"):
            for numero, (propio, pendiente) in enumerate(operacion_fuente.leer_pendientes(fuente, raiz)):
                destino = local / f"{nombre}-pendiente-{numero}" / almacen.RUTA
                conjunto = (pendiente, corte) if fuente == BARCELONACTIVA else pendiente
                nueva = aplicar(raiz, nueva, destino, propio, conjunto)
        with tramo(fuente):
            nueva = aplicar(raiz, nueva, local / nombre / almacen.RUTA, corte)
    with tramo("fundae-ediciones"):
        nueva = preinscripcion.aplicar_si_cambia(raiz, nueva, local / "fundae-ediciones" / almacen.RUTA, corte)
    with tramo("reevaluacion"):
        return reevaluar_registros.aplicar_si_cambia(nueva, local / "reevaluacion" / almacen.RUTA, corte)
