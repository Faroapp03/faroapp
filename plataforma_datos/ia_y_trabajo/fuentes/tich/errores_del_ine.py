"""Contraste de los errores de muestreo que publica el INE (jackknife con las secciones) con los de Kish de Faro.

El INE no publica errores del uso de la IA generativa ni por ocupación: se contrasta la variable de personas ocupadas
que sí tiene error publicado (`FILA_CONTRASTE`), en España y en cada comunidad, para saber si el intervalo de Faro es
más estrecho de lo que el diseño justifica.
"""

import math
from collections.abc import Iterable
from typing import Any

from plataforma_datos.comun.lugares import CODIGO_INE_DE_CATALUNA as CATALUNA
from plataforma_datos.comun.nucleo import Controles, exigir
from plataforma_datos.ia_y_trabajo.fuentes.tich.constantes import FILA_CONTRASTE, TOTAL_NACIONAL, VARIABLE_CONTRASTE


def mediana(valores: Iterable[float]) -> float:
    """La mediana (la media de las dos centrales si son pares).

    Returns:
        La mediana.

    Raises:
        FormatoInesperado: Si no hay valores que comparar.
    """
    orden = sorted(valores)
    exigir(bool(orden), "TIC-H: no hay valores para calcular la mediana del contraste")
    mitad = len(orden) // 2
    return orden[mitad] if len(orden) % 2 else round((orden[mitad - 1] + orden[mitad]) / 2, 2)


def razon_de_errores(publicado: float, calculado: float, area: str) -> float:
    """Compara el error publicado con uno de Kish utilizable, sin dividir por cero.

    Returns:
        La razón, con los dos decimales del contraste.

    Raises:
        FormatoInesperado: Si el error de Kish no es finito y positivo.
    """
    exigir(math.isfinite(calculado) and calculado > 0, f"TIC-H: error de Kish de {area} no finito y positivo")
    return round(publicado / calculado, 2)


def contraste_errores_ine(
    controles: Controles, calculado: dict[str, dict[str, float]], publicado: dict[str, float]
) -> dict[str, Any]:
    """Errores del INE (jackknife con las secciones) frente a los de Kish de Faro, en la misma variable y área.

    Returns:
        La comparación de los errores por ámbito.
    """
    areas = [area for area in publicado if area in calculado]
    controles.comprobar(
        len(areas) == len(publicado) and {TOTAL_NACIONAL, CATALUNA} <= set(areas),
        f"los {len(publicado)} errores de la tabla 76849 ({FILA_CONTRASTE.lower()}) tienen su cálculo con los "
        "microdatos, España y Cataluña incluidas",
    )
    exigir(bool(areas), "TIC-H: no hay áreas comunes para contrastar los errores del INE")
    razones = {
        lectura: {area: razon_de_errores(publicado[area], calculado[area][campo], area) for area in areas}
        for lectura, campo in (("cv_de_ocupadas", "cv_kish_pct"), ("puntos_de_16_a_74", "error_kish_puntos"))
    }
    por_debajo = all(razon < 1 for lectura in razones.values() for razon in lectura.values())
    medianas = {lectura: mediana(valores.values()) for lectura, valores in razones.items()}
    return {
        "variable": f"{FILA_CONTRASTE} ({VARIABLE_CONTRASTE} 1 o 2)",
        "por_que_esta": "El INE publica errores de muestreo de la TIC-H 2025 solo de unas variables principales, en "
        "España y por comunidad (tablas 76848 a 76851): ninguno del uso de la IA generativa ni por ocupación, ni para "
        "los grupos manuales, no manuales y TIC de la tabla 76444. Se contrasta la única variable de personas "
        "ocupadas que tiene error publicado. Ceuta y Melilla van juntas en la tabla y no se contrastan.",
        "error_ine": publicado,
        "calculado_con_kish": calculado,
        "razon_ine_entre_kish": razones,
        "razon_mediana": medianas,
        "lectura": (
            f"En las {len(areas)} áreas y en las dos lecturas posibles de la tabla, el error del INE es menor que el "
            f"de Kish de Faro (mediana ×{medianas['cv_de_ocupadas']} si es el CV del % de ocupadas; "
            f"×{medianas['puntos_de_16_a_74']} si son puntos del % de 16 a 74 años): el intervalo de Faro no es más "
            "estrecho que el del INE. La tabla no dice su base, así que no sirve para estimar el efecto de diseño de "
            "los conglomerados, y no se usa para corregir el intervalo."
            if por_debajo
            else "En alguna área o lectura el error del INE supera el de Kish de Faro: el intervalo de Faro puede ser "
            "más estrecho de lo que el diseño justifica. Ver las razones por área."
        ),
        "faro_no_mas_estrecho": por_debajo,
    }
