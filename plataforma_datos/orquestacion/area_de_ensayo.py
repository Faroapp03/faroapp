"""Área de ensayo de una actualización: una copia del producto sin perfiles, registros, secretos ni estado privado.

Las dependencias instaladas se enlazan, no se copian. Los demás archivos deben ser propios: un enlace simbólico
rompería el aislamiento del área. El área tiene que estar fuera del producto y no existir todavía.
"""

import shutil
from collections.abc import Callable
from pathlib import Path

from plataforma_datos.comun.nucleo import DATOS_RELATIVOS

# Lo que no se copia al área: dependencias, cachés, estado local y secretos (que nunca salen de su sitio). Se excluye
# por nombre en cualquier nivel del árbol, no solo en la raíz: también una subcarpeta llamada «actualizaciones» (los
# informes y el estado) o «__pycache__» queda fuera.
NO_SE_COPIA = frozenset(
    {"node_modules", ".venv", ".git", "__pycache__", ".ruff_cache", ".wrangler", ".DS_Store", "actualizaciones"}
)
PREFIJOS_SECRETOS = (".dev.vars", ".env")
SUFIJO_DE_PLANTILLA = ".example"  # plantillas versionadas, sin secretos (.dev.vars.example): sí se copian


def es_secreto(nombre: str) -> bool:
    """Indica si un archivo es de secretos (.dev.vars, .env y sus variantes), que no sale de su sitio.

    Args:
        nombre: El nombre del archivo, sin carpeta.

    Returns:
        True si empieza por un prefijo de PREFIJOS_SECRETOS y no es su plantilla (SUFIJO_DE_PLANTILLA).
    """
    return nombre.startswith(PREFIJOS_SECRETOS) and not nombre.endswith(SUFIJO_DE_PLANTILLA)


def _ignorados(raiz: Path) -> Callable[[str, list[str]], set[str]]:
    """Construye el filtro de copytree que deja fuera NO_SE_COPIA, los secretos y el registro local del consumo.

    Args:
        raiz: La raíz del repositorio que se copia.

    Returns:
        La función que, para una carpeta y sus nombres, dice cuáles no se copian.
    """
    privados = {
        raiz / "registro",
        raiz / "config" / "conexiones" / "perfiles",
        raiz / DATOS_RELATIVOS / "ejecuciones",
    }

    def ignorar(directorio: str, nombres: list[str]) -> set[str]:
        """Elige los nombres de `directorio` que no se copian.

        Args:
            directorio: La carpeta que copytree está copiando.
            nombres: Lo que contiene.

        Returns:
            Los nombres que se quedan fuera.

        Raises:
            ValueError: Si un archivo a copiar es un enlace que rompe el aislamiento.
        """
        fuera = {nombre for nombre in nombres if nombre in NO_SE_COPIA or es_secreto(nombre)}
        fuera |= {nombre for nombre in nombres if Path(directorio) / nombre in privados}
        for nombre in set(nombres) - fuera:
            ruta = Path(directorio) / nombre
            if ruta.is_symlink():
                raise ValueError(f"el área requiere archivos propios, no un enlace: {ruta}")
        return fuera

    return ignorar


def comprobar_area(raiz: Path, area: Path) -> None:
    """Rechaza solapamientos y destinos existentes antes de copiar o reservar su limpieza.

    Raises:
        ValueError: Si el destino se solapa con el producto.
        FileExistsError: Si otro proceso ya posee el destino.
    """
    origen, destino = raiz.resolve(), area.resolve()
    if destino.is_relative_to(origen) or origen.is_relative_to(destino):
        raise ValueError("el área debe estar fuera del producto y no contenerlo")
    if area.exists() or area.is_symlink():
        raise FileExistsError(f"el área ya existe y no pertenece a esta ejecución: {area}")


def preparar_area(raiz: Path, area: Path) -> None:
    """Copia los archivos operativos sin estado privado; reutiliza las dependencias instaladas."""
    comprobar_area(raiz, area)
    shutil.copytree(raiz, area, ignore=_ignorados(raiz), symlinks=False)
    for nombre in ("node_modules", ".venv"):
        dependencias = raiz / nombre
        if dependencias.is_dir():
            (area / nombre).symlink_to(dependencias.resolve(), target_is_directory=True)
