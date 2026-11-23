"""Las dos medidas de exposición a la IA generativa de la OIT y las cotas sin supuestos de un empleo repartido.

«Alguna» exposición = gradientes 1 a 4; «alta» = gradiente 4 (WP140, tabla 5). El gradiente de cada grupo primario
ISCO-08 es el de la tabla A1 que valida la fuente `oit` (una sola fuente de verdad): aquí no se recalcula. Lo usa la
exposición calculada con microdatos de encuestas (`encuestas_isco4` y `encuestas_diseno`). Python estándar.
"""

from collections.abc import Iterable
from typing import Any

GRADIENTES_EXPUESTOS = ("gradiente_1", "gradiente_2", "gradiente_3", "gradiente_4")
GRADIENTE_ALTO = "gradiente_4"
MEDIDAS = ("alguna", "alta")


def expuesto(gradiente: str | None, medida: str) -> bool:
    """Indica si un grupo primario cuenta en la medida.

    Args:
        gradiente: El gradiente del grupo primario en la tabla A1, o None si no tiene nota.
        medida: «alguna» (G1–G4) o «alta» (G4).

    Returns:
        True si el gradiente entra en la medida.
    """
    return gradiente in GRADIENTES_EXPUESTOS if medida == "alguna" else gradiente == GRADIENTE_ALTO


def gradientes(ocupaciones: dict[str, dict[str, Any]]) -> dict[str, str | None]:
    """Devuelve el gradiente de cada grupo primario.

    Args:
        ocupaciones: Las ocupaciones validadas de la fuente `oit`, por código ISCO-08 de 4 dígitos.

    Returns:
        Código del grupo primario → su gradiente (None si no tiene nota).
    """
    return {codigo: ocupacion["gradiente"] for codigo, ocupacion in ocupaciones.items()}


def cotas_de_exposicion(destinos: Iterable[str], grad: dict[str, str | None]) -> dict[str, tuple[float, float]]:
    """Calcula las cotas sin supuestos de la fracción expuesta de un empleo que va a alguno de `destinos`.

    Con un solo destino, o con todos en el mismo caso, la fracción es exacta; si unos cuentan y otros no, va de 0 a 1.
    Sin ningún destino conocido, de 0 a 1.

    Args:
        destinos: Los grupos primarios ISCO-08 a los que puede ir ese empleo.
        grad: El gradiente de cada grupo primario (`gradientes`).

    Returns:
        Por medida, la pareja (mínimo, máximo) de la fracción expuesta, entre 0 y 1.
    """
    lista = [destino for destino in destinos if destino in grad]
    resultado = {}
    for medida in MEDIDAS:
        marcas = [expuesto(grad[destino], medida) for destino in lista]
        resultado[medida] = (float(bool(marcas) and all(marcas)), float(any(marcas))) if marcas else (0.0, 1.0)
    return resultado
