"""Cierra los originales de cada canal registrado a partir del índice que sella su fuente."""

import re
from collections.abc import Iterator
from pathlib import Path

from plataforma_datos.comun.entrada_salida import comprobar_huella
from plataforma_datos.cursos.operacion_fuente import CANALES
from plataforma_datos.orquestacion.archivos_de_generacion import (
    MAX_MANIFIESTO_BYTES,
    _camino,
    _exigir,
    _json,
    _propio,
    _ruta,
)


def referencias(documento: object) -> Iterator[tuple[str, str]]:
    """Recorre los pares archivo y huella que declara una procedencia.

    Yields:
        Ruta relativa válida y huella SHA-256.
    """
    if isinstance(documento, list):
        for item in documento:
            yield from referencias(item)
    if isinstance(documento, dict):
        if {"archivo", "sha256"} <= documento.keys():
            huella = documento["sha256"]
            _exigir(isinstance(huella, str) and re.fullmatch(r"[0-9a-f]{64}", huella) is not None)
            yield _ruta(documento["archivo"]), huella
        for valor in documento.values():
            yield from referencias(valor)


def completar(raiz: Path, base: str, documento: dict, entradas: dict[str, str]) -> None:
    """Incorpora capturas omitidas por historiales antiguos sin seguir archivos o rutas ajenos al canal."""
    _exigir(bool(entradas))
    declarados = documento.get("canales_operativos", {})
    _exigir(isinstance(declarados, dict))
    if declarados:
        for nombre, sha in referencias(documento):
            _exigir(entradas.get(nombre) == sha)
    for canal, declaracion in declarados.items():
        _exigir(canal == CANALES.get(Path(base).name))
        indice = canal + "/procedencia.json"
        declaradas = {}
        for nombre, sha in referencias(declaracion):
            _exigir(nombre.startswith(canal + "/") and declaradas.setdefault(nombre, sha) == sha)
            _exigir(entradas[nombre] == sha)
        _exigir(indice in declaradas)
        ruta = _camino(raiz, base + "/" + indice)
        _propio(ruta)
        _exigir(ruta.stat().st_size <= MAX_MANIFIESTO_BYTES)
        comprobar_huella(ruta, declaradas[indice])
        anidado = _json(ruta)
        _exigir(isinstance(anidado, dict))
        for nombre, sha in referencias(anidado):
            _exigir(entradas.setdefault(canal + "/" + nombre, sha) == sha)
