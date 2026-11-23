"""Qué rutas de un módulo se publican y cuándo hace falta una persona.

Un módulo declara sus carpetas (modulos.carpetas). Tras producirlas en verde en el área, se publican las que el área
tiene. La primera publicación de una ruta declarada es automática: si lo publicado no la tiene todavía, la
sustitución (sustitucion.py) la crea con su diario, y un corte o un fallo a medias la retira. Una ruta que existe
en lo publicado y que el módulo ya no produce, o que cambia entre archivo y carpeta, no se publica sola.
Python estándar.
"""

from pathlib import Path


def rutas_a_publicar(raiz: Path, area: Path, rutas: tuple[str, ...], *, crea: bool) -> tuple[str, ...]:
    """Decide qué rutas del módulo se publican; las que no existen en el área ni en lo publicado no cuentan.

    Args:
        raiz: La raíz del repositorio (lo publicado).
        area: El área de ensayo (lo producido).
        rutas: Las rutas declaradas por el módulo, relativas.
        crea: Si una ruta que lo publicado todavía no tiene se publica sola (los módulos del registro).

    Returns:
        Las rutas que el área tiene, en el orden recibido.

    Raises:
        OSError: Si una ruta publicada desaparece, si cambia entre archivo y carpeta o, sin `crea`, si aparece.
    """
    desaparecen = [ruta for ruta in rutas if (raiz / ruta).exists() and not (area / ruta).exists()]
    if desaparecen:
        raise OSError(f"desaparece {', '.join(desaparecen)}: el módulo ya no la produce; se revisa y se publica a mano")
    presentes = tuple(ruta for ruta in rutas if (area / ruta).exists())
    nuevas = [ruta for ruta in presentes if not (raiz / ruta).exists()]
    if nuevas and not crea:
        raise OSError(f"aparece {', '.join(nuevas)}: se revisa y se publica a mano")
    cambian = [ruta for ruta in presentes if ruta not in nuevas and (raiz / ruta).is_dir() != (area / ruta).is_dir()]
    if cambian:
        raise OSError(f"{', '.join(cambian)} cambia entre archivo y carpeta: se revisa y se publica a mano")
    return presentes
