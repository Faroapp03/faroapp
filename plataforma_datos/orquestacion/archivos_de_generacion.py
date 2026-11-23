"""Primitivas de lectura de una generación operativa: rutas propias, archivos regulares acotados y JSON estricto.

Todas fallan cerrado con GeneracionInvalida y un mensaje genérico, sin rutas ni contenido.
"""

import json
import re
import stat
from pathlib import Path, PurePosixPath
from typing import Any

from plataforma_datos.comun.entrada_salida import Json
from plataforma_datos.orquestacion.area_de_ensayo import es_secreto

MAX_MANIFIESTO_BYTES = 8 * 1024 * 1024
MAX_ARCHIVOS = 100_000
MAX_ARCHIVO_BYTES = 4 * 1024**3
ERROR_GENERICO = "Generación operativa no verificable."


class GeneracionInvalida(ValueError):
    """No se pueden trasladar estos bytes con las garantías del contrato."""


def _exigir(condicion: bool) -> None:
    if not condicion:
        raise GeneracionInvalida(ERROR_GENERICO)


def _hex(valor: object, patron: re.Pattern[str]) -> None:
    _exigir(isinstance(valor, str) and patron.fullmatch(valor) is not None)


def _ruta(valor: object) -> str:
    _exigir(isinstance(valor, str) and bool(valor) and not re.search(r"[\\:\x00-\x1f\x7f]", valor))
    partes = valor.split("/")
    _exigir(all(parte not in ("", ".", "..") for parte in partes))
    _exigir(not PurePosixPath(valor).is_absolute() and all(not es_secreto(parte) for parte in partes))
    return valor


def _propio(ruta: Path, directorio: bool = False) -> None:
    informacion = ruta.lstat()
    if directorio:
        _exigir(stat.S_ISDIR(informacion.st_mode))
    else:
        _exigir(stat.S_ISREG(informacion.st_mode) and informacion.st_nlink == 1)
        _exigir(informacion.st_size <= MAX_ARCHIVO_BYTES)


def _camino(raiz: Path, relativa: str) -> Path:
    ruta = raiz
    _propio(ruta, directorio=True)
    for parte in PurePosixPath(_ruta(relativa)).parts[:-1]:
        ruta = ruta / parte
        _propio(ruta, directorio=True)
    return raiz / relativa


def _pares(pares: list[tuple[str, Any]]) -> dict[str, Any]:
    resultado = {}
    for clave, valor in pares:
        _exigir(clave not in resultado)
        resultado[clave] = valor
    return resultado


def _constante_invalida(_texto: str) -> None:
    raise GeneracionInvalida(ERROR_GENERICO)


def _json(ruta: Path) -> Json:
    _propio(ruta)
    with ruta.open("rb") as archivo:
        contenido = archivo.read(MAX_MANIFIESTO_BYTES + 1)
    _exigir(len(contenido) <= MAX_MANIFIESTO_BYTES)
    return json.loads(contenido.decode("utf-8"), object_pairs_hook=_pares, parse_constant=_constante_invalida)


def _arbol(carpeta: Path) -> list[Path]:
    _propio(carpeta, directorio=True)
    archivos = []
    for indice, ruta in enumerate(carpeta.rglob("*"), start=1):
        _exigir(indice <= MAX_ARCHIVOS * 4)
        _ruta(ruta.relative_to(carpeta).as_posix())
        if ruta.is_dir() and not ruta.is_symlink():
            continue
        _propio(ruta)
        archivos.append(ruta)
        _exigir(len(archivos) <= MAX_ARCHIVOS)
    return archivos
