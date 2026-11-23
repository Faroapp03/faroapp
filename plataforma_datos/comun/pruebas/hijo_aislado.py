"""Intérpretes hijos con `-I` que también trabajan sin red.

La guardia de red de la batería llega a los hijos por `PYTHONPATH` y `sitecustomize.py`; `-I` ignora ambos. Cuando
lo que se prueba es justo el aislamiento (que el producto funciona sin `PYTHONPATH`, sin el directorio actual y sin
paquetes del usuario), el hijo conserva `-I` y se pone la guardia él mismo antes de ejecutar nada: la importa por su
ruta y la retira de `sys.path` en seguida, para que el código probado vea el mismo `sys.path` que vería sin ella.
"""

from pathlib import Path

CARPETA_GUARDIA = Path(__file__).resolve().parents[3] / "scripts/sin_red"
PROLOGO_SIN_RED = (
    "import sys\n"
    f"sys.path.insert(0, {str(CARPETA_GUARDIA)!r})\n"
    "import guardia_red\n"
    "guardia_red.aplicar()\n"
    "del sys.path[0]\n"
)
# Ejecuta como `__main__` el guion que llega como primer argumento, con el mismo `sys.argv` que tendría lanzado
# directamente (`python -I guion args…`): con `-I` tampoco se antepone su carpeta a `sys.path`.
_GUION = "import runpy\nsys.argv.pop(0)\nrunpy.run_path(sys.argv[0], run_name='__main__')\n"


def codigo_sin_red(codigo: str) -> str:
    """Antepone la guardia de red a un programa para `python -I -c`.

    Returns:
        El programa, que ya no puede salir de este equipo.
    """
    return PROLOGO_SIN_RED + codigo


def orden_de_guion_sin_red(python: str, guion: Path, *argumentos: str) -> list[str]:
    """Orden equivalente a `python -I -B guion argumentos…`, con la guardia puesta antes del guion.

    Returns:
        La orden lista para `subprocess`.
    """
    return [python, "-I", "-B", "-c", codigo_sin_red(_GUION), str(guion), *argumentos]
