"""Contrato del intérprete de mantenimiento y del motor SQLite que carga.

La versión completa del archivo sirve de pin del provisionador y de mínimo del producto dentro de esa misma
rama. Una rama distinta o una prepublicación necesitan su validación; no se aceptan por ser numéricamente mayores.
Este módulo solo consulta el contrato local cuando se llama y también admite ejecución directa con python -I.
"""

import re
import sys
from contextlib import closing
from pathlib import Path

ARCHIVO_VERSION = Path(__file__).resolve().parents[2] / ".python-version"
MAX_VERSION_BYTES = 64
CAMPOS_VERSION_INFO = 5
FORMATO_VERSION = re.compile(r"[1-9][0-9]*\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)")
SQLITE_MINIMO = (3, 54, 1)


class ErrorVersionPython(ValueError):
    """El runtime o su contrato local no permiten acreditar la versión de mantenimiento."""


class ErrorSQLite(ValueError):
    """El motor que carga el intérprete no acredita la versión y la búsqueda del catálogo."""


def version_minima() -> tuple[int, int, int]:
    """Lee el único pin de versión sin depender del cwd ni resolver instalaciones por red.

    Returns:
        Mayor, menor y parche mínimos de la rama admitida.

    Raises:
        ErrorVersionPython: Si falta el contrato o no declara una versión completa canónica.
    """
    try:
        with ARCHIVO_VERSION.open("rb") as archivo:
            contenido = archivo.read(MAX_VERSION_BYTES + 1)
        texto = contenido.decode("ascii").removesuffix("\n")
        if len(contenido) > MAX_VERSION_BYTES or FORMATO_VERSION.fullmatch(texto) is None:
            raise ErrorVersionPython("El contrato .python-version debe indicar una versión completa de Python.")
    except (OSError, UnicodeError) as error:
        raise ErrorVersionPython("No se ha podido verificar el contrato de versión de Python.") from error
    mayor, menor, parche = texto.split(".")
    return int(mayor), int(menor), int(parche)


def comprobar_python() -> str:
    """Exige la rama declarada, su parche mínimo y una versión final del intérprete en ejecución.

    Returns:
        Rama admitida, para cotejarla con el lock de dependencias.

    Raises:
        ErrorVersionPython: Si el contrato es inválido o el runtime no cumple todos sus requisitos.
    """
    minimo = version_minima()
    actual = sys.version_info
    if not (
        len(actual) == CAMPOS_VERSION_INFO
        and actual[3] == "final"
        and actual[:2] == minimo[:2]
        and actual[:3] >= minimo
    ):
        completa = ".".join(str(parte) for parte in minimo)
        rama = f"{minimo[0]}.{minimo[1]}"
        raise ErrorVersionPython(f"Se requiere Python {rama} desde {completa}, en versión final de esa misma rama.")
    return f"{minimo[0]}.{minimo[1]}"


def comprobar_sqlite() -> str:
    """Verifica por SQL la versión enlazada y una búsqueda FTS5 real en memoria.

    Returns:
        Versión del motor que ha creado y consultado el índice.

    Raises:
        ErrorSQLite: Si falta SQLite, su versión es antigua o FTS5 no devuelve la fila indexada.
    """
    try:
        import sqlite3
    except ImportError as error:
        raise ErrorSQLite("El Python de Faro necesita el módulo sqlite3 con FTS5.") from error
    try:
        with closing(sqlite3.connect(":memory:")) as conexion:
            actual = conexion.execute("SELECT sqlite_version()").fetchone()[0]
            if (
                re.fullmatch(r"[0-9]+(?:\.[0-9]+){2,3}", actual) is None
                or tuple(map(int, actual.split("."))) < SQLITE_MINIMO
            ):
                minima = ".".join(map(str, SQLITE_MINIMO))
                raise ErrorSQLite(f"Se requiere SQLite {minima} o posterior. El Python de Faro carga SQLite {actual}.")
            conexion.execute("CREATE VIRTUAL TABLE indice USING fts5(texto)")
            conexion.execute("INSERT INTO indice(rowid, texto) VALUES (1, 'Curso de datos'), (2, 'Aprendizaje')")
            if conexion.execute("SELECT rowid FROM indice WHERE indice MATCH 'datos'").fetchall() != [(1,)]:
                raise ErrorSQLite("La búsqueda FTS5 del Python de Faro no devuelve la fila indexada.")
    except sqlite3.Error as error:
        raise ErrorSQLite("El Python de Faro necesita SQLite con búsqueda FTS5 operativa.") from error
    return actual


if __name__ == "__main__":
    try:
        comprobar_python()
        print(f"SQLite {comprobar_sqlite()} con FTS5 operativo.")
    except (ErrorVersionPython, ErrorSQLite) as error:
        sys.exit(str(error))
