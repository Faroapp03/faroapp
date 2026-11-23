"""Primitivas del contrato privado de los trabajos: JSON acotado, objetos cerrados, enteros, huellas e instantes.

Todas fallan cerrado con AlmacenTrabajoInvalido y un mensaje genérico, sin reflejar el contenido. Las usan el almacén
de trabajos y la validación de sus recibos.
"""

import json
import re
from datetime import datetime
from typing import Any

MAX_ENTERO = 2**53 - 1
ERROR = "Trabajo conservado no verificable."


class AlmacenTrabajoInvalido(ValueError):
    """Contenido, correlación o referencia que no cumple el contrato privado."""


def exigir(condicion: bool) -> None:
    """Lanza el error genérico del contrato si la condición no se cumple.

    Raises:
        AlmacenTrabajoInvalido: Si no se cumple.
    """
    if not condicion:
        raise AlmacenTrabajoInvalido(ERROR)


def objeto(valor: object, claves: str) -> dict[str, Any]:
    """Exige un objeto con exactamente esas claves, separadas por comas.

    Returns:
        El mismo objeto.
    """
    exigir(type(valor) is dict and set(valor) == set(claves.split(",")))
    return valor


def _pares(pares: list[tuple[str, Any]]) -> dict[str, Any]:
    resultado: dict[str, Any] = {}
    for clave, valor in pares:
        exigir(clave not in resultado)
        resultado[clave] = valor
    return resultado


def _constante(_valor: str) -> None:
    raise AlmacenTrabajoInvalido(ERROR)


def _json(contenido: bytes, cota: int) -> dict[str, Any]:
    exigir(type(contenido) is bytes and 0 < len(contenido) <= cota)
    try:
        valor = json.loads(contenido.decode("utf-8"), object_pairs_hook=_pares, parse_constant=_constante)
    except (ValueError, RecursionError):
        raise AlmacenTrabajoInvalido(ERROR) from None
    exigir(type(valor) is dict)
    return valor


def _bytes(valor: dict[str, Any]) -> bytes:
    return json.dumps(valor, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()


def _entero(valor: object, minimo: int = 0) -> None:
    exigir(type(valor) is int and minimo <= valor <= MAX_ENTERO)


def hexa(valor: object, patron: re.Pattern[str]) -> None:
    """Exige un texto que case entero con el patrón hexadecimal dado."""
    exigir(isinstance(valor, str) and patron.fullmatch(valor) is not None)


def instante(valor: object) -> None:
    """Exige un instante UTC AAAA-MM-DDTHH:MM:SSZ válido.

    Raises:
        AlmacenTrabajoInvalido: Si no lo es.
    """
    exigir(isinstance(valor, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z", valor) is not None)
    try:
        datetime.strptime(valor, "%Y-%m-%dT%H:%M:%SZ")
    except ValueError:
        raise AlmacenTrabajoInvalido(ERROR) from None


def _fecha(valor: object) -> None:
    exigir(isinstance(valor, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", valor) is not None)
    try:
        datetime.strptime(valor, "%Y-%m-%d")
    except ValueError:
        raise AlmacenTrabajoInvalido(ERROR) from None
