"""Contrasta el intérprete, la biblioteca mapeada y el identificador de SQLite con las fuentes verificadas."""

import re
import sqlite3
import subprocess
import sys
from contextlib import closing
from pathlib import Path


def comprobar(prefijo: Path, entorno: Path, cabecera: Path) -> None:
    """Confirma la identidad y ejecuta la prueba FTS5 del producto con el entorno del supervisor.

    Raises:
        ValueError: Si la biblioteca o el intérprete proceden de otro prefijo o de fuentes diferentes.
    """
    if Path(sys.base_prefix).resolve() != prefijo or Path(sys.prefix).resolve() != entorno:
        raise ValueError("Python no procede del prefijo privado esperado.")
    biblioteca = prefijo / "lib" / "libsqlite3.so.0"
    mapas = Path("/proc/self/maps").read_text().splitlines()
    if not any(linea.split(maxsplit=5)[-1] == str(biblioteca) for linea in mapas):
        raise ValueError("Python no tiene cargada la biblioteca SQLite privada del job.")
    definiciones = dict(re.findall(r'^#define SQLITE_(VERSION|SOURCE_ID)\s+"([^"]+)"', cabecera.read_text(), re.M))
    with closing(sqlite3.connect(":memory:")) as db:
        identidad = db.execute("SELECT sqlite_version(), sqlite_source_id()").fetchone()
    if identidad != (definiciones["VERSION"], definiciones["SOURCE_ID"]):
        raise ValueError("El motor SQLite no se corresponde con la fuente verificada.")
    contrato = Path(__file__).resolve().parents[2] / "plataforma_datos" / "comun" / "entorno_python.py"
    subprocess.run([sys.executable, "-I", str(contrato)], env={"LD_LIBRARY_PATH": str(prefijo / "lib")}, check=True)
    print(f"SQLite {identidad[0]} · {identidad[1]} · {biblioteca}")


if __name__ == "__main__":
    comprobar(*(Path(argumento).resolve() for argumento in sys.argv[1:]))
