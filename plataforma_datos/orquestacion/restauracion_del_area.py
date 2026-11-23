"""Devolver las carpetas de un módulo a lo publicado sin perder las lecturas que sus fuentes emitieron en el ciclo.

Cuando un módulo falla, su área vuelve a la versión publicada para que los módulos siguientes solo lean versiones
publicadas. Las lecturas del censo son justo lo que más interesa conservar ese día, porque cuentan qué vio la fuente
cuando algo fue mal. Como cada lectura es inmutable y solo se añade, pasarla antes a lo publicado no cambia ningún dato
que se sirva ni ninguna lectura anterior: el área se restaura después y recibe las lecturas con todo lo demás.
El registro nunca detiene la ronda: un archivo ilegible no se conserva y queda dicho en el aviso que se devuelve.
"""

import shutil
from pathlib import Path

from plataforma_datos.comun.nucleo import DATOS_RELATIVOS
from plataforma_datos.cursos.lecturas.almacen_lecturas import CARPETA, copiar_lecturas

VALIDADOS = DATOS_RELATIVOS / "validados"


def conservar_lecturas(raiz: Path, area: Path, rutas: tuple[str, ...]) -> list[str]:
    """Añade a lo publicado las lecturas legibles que el área tiene en la carpeta validada de cada fuente.

    Returns:
        Los archivos de lecturas del área que no se han conservado, con su ruta relativa y su motivo.

    Raises:
        ErrorLectura: Si la carpeta de lecturas del área no es una carpeta propia.
    """
    no_conservadas = []
    for ruta in rutas:
        relativa = Path(ruta)
        if relativa.parent == VALIDADOS and (area / relativa / CARPETA).exists():
            no_copiadas = copiar_lecturas(area, raiz, relativa.name)
            no_conservadas += [f"{(relativa / CARPETA).as_posix()}/{archivo}" for archivo in no_copiadas]
    return no_conservadas


def devolver_a_lo_publicado(raiz: Path, area: Path, rutas: tuple[str, ...], *, conservar: bool) -> str:
    """Sustituye cada carpeta del área por su versión publicada; las que aún no se publicaron se retiran.

    Args:
        raiz: La raíz del repositorio (lo publicado).
        area: El área de ensayo.
        rutas: Las carpetas del módulo, relativas.
        conservar: Si las lecturas nuevas del área pasan antes a lo publicado; un ensayo no publica nada.

    Returns:
        El aviso que se añade al motivo del módulo si alguna lectura no se pudo conservar; vacío si no hay ninguno.
    """
    no_conservadas = conservar_lecturas(raiz, area, rutas) if conservar else []
    for ruta in rutas:
        shutil.rmtree(area / ruta, ignore_errors=True)
        if (raiz / ruta).exists():
            shutil.copytree(raiz / ruta, area / ruta, symlinks=True)
    return f"; lecturas ilegibles no conservadas: {', '.join(no_conservadas)}" if no_conservadas else ""
