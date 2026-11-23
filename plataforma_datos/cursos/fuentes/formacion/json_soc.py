"""Lectura del JSON que publica el SOC: latin-1, sin campos repetidos ni constantes ajenas a JSON."""

import json
from typing import Any

from plataforma_datos.comun.entrada_salida import Json
from plataforma_datos.comun.nucleo import FormatoInesperado, exigir


def leer_json_latin1(datos: bytes) -> Json:
    """Lee un JSON codificado en latin-1, como lo publica el SOC.

    Args:
        datos: Bytes del archivo original.

    Returns:
        El valor JSON del archivo.
    """
    return json.loads(datos.decode("latin-1"))


def objeto_sin_repetidos(pares: list[tuple[str, Any]]) -> dict[str, Any]:
    """Rechaza campos JSON repetidos en vez de admitir silenciosamente el último.

    Returns:
        El objeto sin nombres repetidos.
    """
    objeto: dict[str, Any] = {}
    for clave, valor in pares:
        exigir(clave not in objeto, f"SOC: campo repetido {clave}")
        objeto[clave] = valor
    return objeto


def constante_no_admitida(_valor: str) -> None:
    """Rechaza NaN e infinitos, que no son valores JSON.

    Raises:
        FormatoInesperado: Siempre; la constante no pertenece a JSON.
    """
    raise FormatoInesperado("SOC: constante no admitida en JSON")
