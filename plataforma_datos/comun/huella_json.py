"""Huella SHA-256 de un valor JSON canónico, la que identifica datos en catálogos, recibos y procedencias.

Python estándar.
"""

import hashlib
import json

from plataforma_datos.comun.entrada_salida import Json


class JsonNoCanonico(ValueError):
    """Un valor que no es JSON canónico: con claves que no son texto, objetos ajenos o números no finitos."""


def _validar(valor: Json) -> None:
    if valor is None or type(valor) in (str, bool, int, float):
        return
    if isinstance(valor, list):
        for elemento in valor:
            _validar(elemento)
        return
    if isinstance(valor, dict) and all(isinstance(clave, str) for clave in valor):
        for elemento in valor.values():
            _validar(elemento)
        return
    raise JsonNoCanonico("Se exige JSON con claves de texto, sin objetos ajenos")


def sha256_json(valor: Json) -> str:
    """Calcula SHA-256 de JSON canónico, diferenciando booleanos y números.

    Returns:
        Huella UTF-8 con claves ordenadas, sin espacios y sin números no finitos.

    Raises:
        JsonNoCanonico: Si el valor no es JSON canónico.
    """
    try:
        _validar(valor)
        serializado = json.dumps(valor, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)
    except (ValueError, TypeError, RecursionError) as error:
        raise JsonNoCanonico("Valor JSON no canónico") from error
    return hashlib.sha256(serializado.encode("utf-8")).hexdigest()
