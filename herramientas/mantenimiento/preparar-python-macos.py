"""Construye un CPython privado para Faro a partir de su distribución macOS y dos fuentes verificadas.

Ejecutar con el Python base de python-build-standalone de la versión indicada:
python3.12 -I preparar-python-macos.py Python-3.12.15.tar.xz sqlite-amalgamation-3540100.zip PREFIJO_NUEVO
La fuente de CPython y su SHA-256 se publican en https://www.python.org/downloads/release/python-31215/.
fuente-sqlite.py imprime la URL de SQLite y verifica la amalgamación. La compilación funciona sin red.
El prefijo es permanente: los venv con una copia del ejecutable localizan en él su biblioteca privada.
"""

import _sqlite3
import argparse
import ctypes
import hashlib
import io
import os
import platform
import re
import shutil
import ssl
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path

VERSION = "3.12.15"
BYTES_CPYTHON = 20_829_824
SHA256_CPYTHON = "c2c4321961fab0fb999d66e0cecf521c2ab3994c7992873ea99e306c1094fd5a"
HERRAMIENTAS = Path(__file__).resolve().parent
MODULOS = ("blob", "connection", "cursor", "microprotocols", "module", "prepare_protocol", "row", "statement", "util")
OPCIONES_SQLITE = (
    "DBSTAT_VTAB",
    "FTS3",
    "FTS3_PARENTHESIS",
    "FTS4",
    "FTS5",
    "GEOPOLY",
    "MATH_FUNCTIONS",
    "PERCENTILE",
    "RTREE",
)
LIBPYTHON = "libpython3.12.dylib"
ENTORNO = {"PATH": "/usr/bin:/bin:/usr/sbin:/sbin", "LC_ALL": "C"}


def fuentes_controlador(archivo: Path, trabajo: Path) -> Path:
    """Extrae del tar oficial los archivos del controlador nativo de CPython.

    Returns:
        La carpeta que contiene los archivos C y sus cabeceras.

    Raises:
        ValueError: Si el contenido del tar no coincide con el publicado por Python.
    """
    with archivo.open("rb") as entrada:
        datos = entrada.read(BYTES_CPYTHON + 1)
    if len(datos) != BYTES_CPYTHON or hashlib.sha256(datos).hexdigest() != SHA256_CPYTHON:
        raise ValueError("El tamaño o la huella SHA-256 del tar de CPython difieren de la publicación oficial.")
    directorio = f"Python-{VERSION}/Modules/_sqlite"
    with tarfile.open(fileobj=io.BytesIO(datos), mode="r:xz") as paquete:
        ficheros = (m for m in paquete if m.isfile() and m.name.startswith(directorio + "/"))
        paquete.extractall(trabajo, members=ficheros, filter="data")
    return trabajo / directorio


def compilar(python: Path, controlador: Path, sqlite: Path, destino: Path) -> None:
    """Compila el controlador nativo y el motor y enlaza el lanzador con la libpython privada."""
    trabajo = sqlite.parent
    entorno = {**ENTORNO, "TMPDIR": str(trabajo)}
    include = python / "include/python3.12"
    clang = ["/usr/bin/clang", "-arch", platform.machine(), "-O2", "-DNDEBUG", "-fvisibility=hidden"]
    motor = trabajo / "sqlite3.o"
    opciones = [f"-DSQLITE_ENABLE_{nombre}" for nombre in OPCIONES_SQLITE]
    subprocess.run(
        [*clang, *opciones, "-DSQLITE_THREADSAFE=1", "-c", sqlite / "sqlite3.c", "-o", motor], check=True, env=entorno
    )
    objetos = [motor]
    opciones_modulo = [
        "-DPy_BUILD_CORE_BUILTIN",
        "-DPyInit__sqlite3=PyInit__faro_sqlite3",
        f"-I{sqlite}",
        f"-I{include}",
        f"-I{include}/internal",
    ]
    for nombre in MODULOS:
        objeto = trabajo / f"{nombre}.o"
        subprocess.run(
            [*clang, *opciones_modulo, "-c", controlador / f"{nombre}.c", "-o", objeto], check=True, env=entorno
        )
        objetos.append(objeto)
    biblioteca = python / "lib" / LIBPYTHON
    subprocess.run(["/usr/bin/install_name_tool", "-id", f"@rpath/{LIBPYTHON}", biblioteca], check=True, env=entorno)
    subprocess.run(["/usr/bin/codesign", "--force", "--sign", "-", biblioteca], check=True, env=entorno)
    salida = trabajo / "python3.12"
    subprocess.run(
        [
            *clang,
            f"-I{include}",
            HERRAMIENTAS / "python-macos-sqlite.c",
            *objetos,
            f"-L{python / 'lib'}",
            "-lpython3.12",
            "-Xlinker",
            "-rpath",
            "-Xlinker",
            "@executable_path/../lib",
            "-Xlinker",
            "-rpath",
            "-Xlinker",
            destino / "lib",
            "-o",
            salida,
        ],
        check=True,
        env=entorno,
    )
    salida.replace(python / "bin/python3.12")


COMPROBAR = """
import _sqlite3, ctypes, lzma, pathlib, sqlite3, ssl, sys
assert pathlib.Path(sys.base_prefix).resolve() == pathlib.Path(sys.argv[1])
assert sys.version == sys.argv[5]
assert _sqlite3.__spec__.origin == "built-in"
assert sqlite3.sqlite_version == _sqlite3.sqlite_version == sys.argv[2]
with sqlite3.connect(":memory:") as con:
    assert con.execute("SELECT sqlite_source_id()").fetchone() == (sys.argv[3],)
    con.execute("CREATE VIRTUAL TABLE formacion USING fts5(titulo)")
    con.execute("INSERT INTO formacion VALUES ('curso de idiomas')")
    fila = con.execute("SELECT titulo FROM formacion WHERE formacion MATCH 'idiomas'").fetchone()
    assert fila == ("curso de idiomas",)
    assert con.execute("SELECT json_valid('{}')").fetchone() == (1,)
assert ssl.OPENSSL_VERSION == sys.argv[4]
assert ctypes.CDLL(None).getpid() > 0 and lzma.decompress(lzma.compress(b"curso")) == b"curso"
"""


def verificar(python: Path, sqlite: Path) -> None:
    """Coteja el módulo en aislamiento con versión y origen de la cabecera ya verificada."""
    cabecera = (sqlite / "sqlite3.h").read_text()
    datos = dict(re.findall(r'^#define SQLITE_(VERSION|SOURCE_ID) +"([^"]+)"', cabecera, re.MULTILINE))
    subprocess.run(
        [
            python / "bin/python3.12",
            "-IS",
            "-c",
            COMPROBAR,
            python,
            datos["VERSION"],
            datos["SOURCE_ID"],
            ssl.OPENSSL_VERSION,
            sys.version,
        ],
        check=True,
        env=ENTORNO,
    )


def entregar(python: Path, destino: Path) -> None:
    """Publica el directorio completo mediante el renombrado exclusivo de macOS.

    Raises:
        OSError: Si apareciera un destino mientras se compilaba o no se puede instalar.
    """
    sistema = ctypes.CDLL(None, use_errno=True)
    renombrar = sistema.renamex_np
    renombrar.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_uint]
    renombrar.restype = ctypes.c_int
    rename_excl = 4  # RENAME_EXCL, Darwin <sys/stdio.h>
    if renombrar(os.fsencode(python), os.fsencode(destino), rename_excl) != 0:
        codigo = ctypes.get_errno()
        raise OSError(codigo, os.strerror(codigo), str(destino))


def preparar(fuente_python: Path, fuente_sqlite: Path, destino: Path) -> None:
    """Construye en un directorio temporal hermano y entrega el intérprete verificado.

    Raises:
        ValueError: Si el intérprete que prepara la copia no tiene la versión y distribución requeridas.
        FileExistsError: Si el destino ya existe.
    """
    base = Path(sys.base_prefix).resolve()
    if sys.platform != "darwin" or sys.implementation.name != "cpython" or platform.python_version() != VERSION:
        raise ValueError(f"Ejecuta el preparador con CPython {VERSION} para macOS.")
    if _sqlite3.__spec__.origin != "built-in" or not (base / "lib" / LIBPYTHON).is_file():
        raise ValueError("Se requiere la distribución de CPython con _sqlite3 incorporado y libpython compartida.")
    destino = destino.expanduser()
    destino = destino.parent.resolve() / destino.name
    if destino.exists() or destino.is_symlink():
        raise FileExistsError(f"El prefijo de destino ya existe: {destino}")
    if destino.is_relative_to(base):
        raise ValueError("Elige un prefijo de Faro fuera de la distribución base.")
    destino.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=destino.parent, prefix=".python-faro-") as temporal:
        trabajo = Path(temporal)
        sqlite = trabajo / "sqlite"
        subprocess.run(
            [sys.executable, "-IS", HERRAMIENTAS / "fuente-sqlite.py", fuente_sqlite, sqlite], check=True, env=ENTORNO
        )
        controlador = fuentes_controlador(fuente_python, trabajo)
        python = trabajo / "runtime"
        shutil.copytree(base, python, symlinks=True)
        compilar(python, controlador, sqlite, destino)
        verificar(python, sqlite)
        entregar(python, destino)
    print(destino / "bin/python3.12")


def principal() -> None:
    """Lee las rutas de los dos archivos de entrada y del nuevo prefijo."""
    argumentos = argparse.ArgumentParser(description=__doc__)
    argumentos.add_argument("cpython", type=Path)
    argumentos.add_argument("sqlite", type=Path)
    argumentos.add_argument("prefijo", type=Path)
    opciones = argumentos.parse_args()
    try:
        preparar(opciones.cpython, opciones.sqlite, opciones.prefijo)
    except (OSError, ValueError, subprocess.CalledProcessError, tarfile.TarError) as error:
        argumentos.exit(1, f"{error}\n")


if __name__ == "__main__":
    principal()
