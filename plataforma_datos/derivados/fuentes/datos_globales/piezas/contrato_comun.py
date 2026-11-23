"""Las piezas comunes del contrato de `datos-globales.json`: forma de un id, de un país, de un año y de un texto doble.

Las usan el contrato (`contrato_datos_globales.py`) y la parte de las cifras calculadas (`contrato_calculado.py`).
Python estándar.
"""

import math
import re

LENGUAS = ("es", "ca")
# El id de un indicador, un recuento, una meta, una encuesta o un calculado: palabras en minúscula y cifras
# separadas por guiones.
ID = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")
ISO3 = re.compile(r"[A-Z]{3}")
# Años posibles de una cifra: desde la primera encuesta europea de la IA hasta un año que aún no puede haber llegado.
PRIMER_ANIO, ULTIMO_ANIO = 2016, 2100


def es_numero(valor: object) -> bool:
    """Si es un número finito: ni booleano, ni NaN, ni infinito (JSON no los admite).

    Returns:
        `True` si es un número finito (no booleano).
    """
    if not isinstance(valor, int | float) or isinstance(valor, bool):
        return False
    try:
        return math.isfinite(valor)
    except OverflowError:
        return False


def id_valido(valor: object) -> bool:
    """Si es un id con la forma del contrato.

    Returns:
        `True` si el id tiene la forma del contrato.
    """
    return isinstance(valor, str) and bool(ID.fullmatch(valor))


def texto_doble(valor: object) -> bool:
    """Si es un texto en castellano y en catalán, los dos con contenido.

    Returns:
        `True` si trae texto en castellano y en catalán, ambos no vacíos.
    """
    return (
        isinstance(valor, dict)
        and tuple(valor) == LENGUAS
        and all(isinstance(valor[lengua], str) and valor[lengua] for lengua in LENGUAS)
    )


def es_anio(anio: object) -> bool:
    """Si es un año entero posible.

    Returns:
        `True` si es un entero que cabe como año.
    """
    return isinstance(anio, int) and not isinstance(anio, bool) and PRIMER_ANIO <= anio <= ULTIMO_ANIO
