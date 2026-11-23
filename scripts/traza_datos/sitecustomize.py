"""Traza de la medición (node scripts/verificar-datos.ts --medir) en los intérpretes de las pruebas Python.

Pone la misma guardia de red que scripts/sin_red/sitecustomize.py y, con FARO_TRAZA_DATOS y FARO_TRAZA_PRUEBA, anota
con un gancho de auditoría (evento «open») cada archivo que se abre de lo que produce la cadena de datos: una línea
«prueba<TAB>ruta» por archivo. Los hijos lo heredan por PYTHONPATH; uno lanzado con -I no lo hereda.
"""

import os
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
CARPETAS_TRAZADAS = (
    "datos/",
    "web/datos/",
    "web/recursos/",
    ".web-local/web/datos/",
    ".web-local/web/paquete/",
    ".web-local/web/recursos/",
    "var/actualizacion/validados/",
)

if os.environ.get("FARO_PRUEBAS_SIN_RED") == "1":
    sys.path.insert(0, str(RAIZ / "scripts" / "sin_red"))
    import guardia_red

    guardia_red.aplicar()


def ruta_trazada(ruta: str) -> str | None:
    """La ruta desde la raíz si cae en una carpeta trazada, siguiendo enlaces simbólicos.

    Returns:
        La ruta relativa con «/», o None si no es del paquete.
    """
    for candidata in (Path(ruta).resolve(), Path(ruta).absolute()):
        try:
            relativa = Path(candidata).relative_to(RAIZ).as_posix()
        except ValueError:
            continue
        if any(f"{relativa}/".startswith(carpeta) for carpeta in CARPETAS_TRAZADAS):
            return relativa
    return None


def _gancho(evento: str, argumentos: tuple) -> None:
    prueba = os.environ.get("FARO_TRAZA_PRUEBA")
    if evento != "open" or not prueba or not isinstance(argumentos[0], (str, bytes, os.PathLike)):
        return
    ruta = os.fsdecode(argumentos[0])
    if ruta.startswith(DESTINO):
        return
    trazada = ruta_trazada(ruta)
    if trazada is not None and trazada not in _VISTAS:
        _VISTAS.add(trazada)
        with Path(DESTINO).open("a", encoding="utf-8") as traza:
            traza.write(f"{prueba}\t{trazada}\n")


DESTINO = os.environ.get("FARO_TRAZA_DATOS", "")
_VISTAS: set[str] = set()
if DESTINO:
    sys.addaudithook(_gancho)
