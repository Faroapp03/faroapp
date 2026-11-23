"""Obtiene del ZIP oficial verificado los tres archivos que compilan SQLite para Faro."""

import argparse
import hashlib
import io
import shutil
import sys
import tempfile
import zipfile
from pathlib import Path

PAQUETE = "sqlite-amalgamation-3540100"
URL = f"https://www.sqlite.org/2026/{PAQUETE}.zip"
BYTES = 2_990_966
# SHA3-256 publicado por SQLite para la amalgamación 3.54.1.
SHA3 = "92281c86e2957f9b9305890f9ac04204caa7b677cc868dc326d942689df28e30"
ARCHIVOS = ("sqlite3.c", "sqlite3.h", "sqlite3ext.h")


def extraer(archivo: Path, destino: Path) -> None:
    """Verifica el mismo contenido que se extrae y entrega un directorio nuevo y completo.

    Raises:
        ValueError: Si el tamaño o la huella difieren de la distribución oficial.
        FileExistsError: Si el directorio de destino ya existe.
    """
    with archivo.open("rb") as entrada:
        datos = entrada.read(BYTES + 1)
    if len(datos) != BYTES or hashlib.sha3_256(datos).hexdigest() != SHA3:
        raise ValueError("El tamaño o la huella SHA3-256 del ZIP de SQLite difieren de la publicación oficial.")
    if destino.exists() or destino.is_symlink():
        raise FileExistsError(f"El destino de las fuentes de SQLite ya existe: {destino}")
    with tempfile.TemporaryDirectory(dir=destino.parent) as temporal, zipfile.ZipFile(io.BytesIO(datos)) as paquete:
        fuentes = Path(temporal) / "fuentes"
        fuentes.mkdir(mode=0o700)
        for nombre in ARCHIVOS:
            with paquete.open(f"{PAQUETE}/{nombre}") as entrada_zip, (fuentes / nombre).open("xb") as salida:
                shutil.copyfileobj(entrada_zip, salida)
        fuentes.rename(destino)


def principal() -> None:
    """Imprime la URL o verifica el archivo descargado antes de entregarlo al compilador."""
    if len(sys.argv) == 1:
        print(URL)
        return
    argumentos = argparse.ArgumentParser(description=__doc__)
    argumentos.add_argument("archivo", type=Path)
    argumentos.add_argument("destino", type=Path)
    opciones = argumentos.parse_args()
    try:
        extraer(opciones.archivo, opciones.destino)
    except (OSError, ValueError, zipfile.BadZipFile) as error:
        argumentos.exit(1, f"{error}\n")


if __name__ == "__main__":
    principal()
