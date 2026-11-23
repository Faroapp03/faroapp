"""Lectura de las respuestas JSON de la API Tempus del INE (https://servicios.ine.es/wstempus/js/ES/...).

Las tablas llegan como una lista de series («Nombre», «Data») y las variables como una lista de valores («Nombre»,
«Codigo»). Lo que no tiene esa forma no es una respuesta de la tabla: se rechaza antes de guardarlo.
"""

import json
import math
from typing import Any

from plataforma_datos.comun.nucleo import FormatoInesperado, exigir

# El INE sirve JSON con este tipo; algunas respuestas lo declaran como texto.
TIPOS_TEMPUS = ("application/json", "text/plain")
# FK_Periodo de la API Tempus para los trimestres 1 a 4 y para el dato anual.
TRIMESTRES = {19: 1, 20: 2, 21: 3, 22: 4}
ANUAL = 28


def lista_json(datos: bytes, que: str) -> list[dict[str, Any]]:
    """Una respuesta Tempus: una lista no vacía de objetos.

    Returns:
        La lista decodificada.

    Raises:
        FormatoInesperado: Si no es JSON o no es una lista no vacía de objetos.
    """
    try:
        contenido = json.loads(datos.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise FormatoInesperado(f"{que}: la respuesta no es JSON") from error
    exigir(isinstance(contenido, list) and bool(contenido), f"{que}: se esperaba una lista no vacía")
    exigir(all(isinstance(elemento, dict) for elemento in contenido), f"{que}: elementos que no son objetos")
    return contenido


def comprobar_tabla(datos: bytes, que: str) -> None:
    """Exige que cada serie de una tabla traiga su nombre y sus datos con año, periodo y valor."""
    for serie in lista_json(datos, que):
        exigir(isinstance(serie.get("Nombre"), str), f"{que}: serie sin nombre")
        exigir(isinstance(serie.get("Data"), list), f"{que}: serie sin datos: {serie.get('Nombre')!r}")
        for dato in serie["Data"]:
            exigir(
                isinstance(dato, dict) and {"Anyo", "FK_Periodo", "Valor"} <= dato.keys(),
                f"{que}: dato sin año, periodo o valor en {serie['Nombre']!r}",
            )


def comprobar_valores(datos: bytes, que: str) -> None:
    """Exige que cada valor de una variable traiga su nombre y su código."""
    for valor in lista_json(datos, que):
        exigir(
            isinstance(valor.get("Nombre"), str) and isinstance(valor.get("Codigo"), str),
            f"{que}: valor sin nombre o código",
        )


def cifra(valor: object, que: str) -> float | None:
    """Una cifra publicada: un número finito, o None si el INE no la da.

    Returns:
        La cifra, o None.
    """
    if valor is None:
        return None
    exigir(
        isinstance(valor, int | float) and not isinstance(valor, bool) and math.isfinite(valor),
        f"{que}: cifra inesperada {valor!r}",
    )
    return float(valor)
