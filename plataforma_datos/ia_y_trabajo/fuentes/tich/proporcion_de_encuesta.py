"""Intervalo de Korn–Graubard y regla de publicación del NCHS para una proporción de una encuesta de diseño complejo.

Intervalo (Korn y Graubard, 1998, *Survey Methodology* 24(2):193-201; fórmulas (1)-(9) de Ward, 2019, «kg_nchs: A
command for Korn-Graubard confidence intervals and NCHS Data Presentation Standards for Proportions», *Stata Journal*,
PMC6896998): es el de Clopper–Pearson con el tamaño efectivo de la muestra en lugar del real.

- n* = p(1 − p) / var(p), el tamaño efectivo; si p = 0 o p = 1, n* = n. Con la varianza de Kish que puede dar un
  fichero sin conglomerados, n* es el tamaño efectivo de Kish, (Σw)² / Σw².
- n*_gl = n* · (t_{n−1} / t_gl)², con t el cuantil 1 − α/2 de la t de Student y gl los grados de libertad del diseño
  (unidades primarias menos estratos).
- x = n*_gl · p; los límites son los cuantiles α/2 de Beta(x, n*_gl − x + 1) y 1 − α/2 de Beta(x + 1, n*_gl − x), que
  es lo mismo que las fórmulas con la F de la referencia.

Regla de publicación (Parker y otros, 2017, *National Center for Health Statistics Data Presentation Standards for
Proportions*, Vital Health Stat 2(175); citada por la misma referencia): una proporción no se presenta si n < 30 o
n* < 30; si el intervalo de Korn–Graubard mide 0,30 o más; o si mide más de 0,05 y menos de 0,30 y su anchura relativa
(anchura / p) pasa del 130 %. Pide además revisión estadística, sin suprimir, si el intervalo mide 0,05 o menos y p es 0
o 1, o los grados de libertad son menos de 8; y que se mire el complemento (1 − p) con su propia anchura relativa.

Los umbrales están fijados aquí antes de calcular ninguna cifra y no se mueven después de ver el resultado.
Python estándar: la beta incompleta, por la fracción continua de Lentz.
"""

import math
from typing import Any

# Regla del NCHS (Parker y otros, 2017), al pie de la letra.
MUESTRA_MINIMA = 30
ANCHO_MAXIMO = 0.30
ANCHO_SIN_REGLA_RELATIVA = 0.05
ANCHO_RELATIVO_MAXIMO = 1.30
GRADOS_DE_LIBERTAD_MINIMOS = 8
CONFIANZA = 0.95

_EPSILON = 1e-15
_MINIMO = 1e-300
_ITERACIONES = 10_000


def _acotado(valor: float) -> float:
    """El valor, apartado de cero lo justo para poder dividir por él (Lentz).

    Returns:
        El valor, o el mínimo positivo si estaba demasiado cerca de cero.
    """
    return valor if abs(valor) > _MINIMO else _MINIMO


def _fraccion_continua(punto: float, a: float, b: float) -> float:
    """Fracción continua de la beta incompleta (método de Lentz modificado).

    Returns:
        El valor de la fracción continua.

    Raises:
        ArithmeticError: Si la fracción no converge en el máximo de iteraciones.
    """
    numerador, denominador = 1.0, 1 / _acotado(1.0 - (a + b) * punto / (a + 1))
    resultado = denominador
    for paso in range(1, _ITERACIONES + 1):
        for coeficiente in (
            paso * (b - paso) * punto / ((a + 2 * paso - 1) * (a + 2 * paso)),
            -(a + paso) * (a + b + paso) * punto / ((a + 2 * paso) * (a + 2 * paso + 1)),
        ):
            denominador = 1 / _acotado(1 + coeficiente * denominador)
            numerador = _acotado(1 + coeficiente / numerador)
            resultado *= denominador * numerador
        if abs(denominador * numerador - 1) < _EPSILON:
            return resultado
    raise ArithmeticError(f"la beta incompleta no converge con a={a}, b={b}, x={punto}")


def beta_regularizada(punto: float, a: float, b: float) -> float:
    """Función beta incompleta regularizada I_x(a, b): la función de distribución de una Beta(a, b) en x = punto.

    Returns:
        La probabilidad acumulada, entre 0 y 1.
    """
    if punto <= 0:
        return 0.0
    if punto >= 1:
        return 1.0
    logaritmo = math.lgamma(a + b) - math.lgamma(a) - math.lgamma(b) + a * math.log(punto) + b * math.log1p(-punto)
    if punto < (a + 1) / (a + b + 2):
        return math.exp(logaritmo) * _fraccion_continua(punto, a, b) / a
    return 1 - math.exp(logaritmo) * _fraccion_continua(1 - punto, b, a) / b


def cuantil_beta(probabilidad: float, a: float, b: float) -> float:
    """El x de [0, 1] con I_x(a, b) = probabilidad, por bisección (la función es creciente).

    Returns:
        El punto de [0, 1] cuya probabilidad acumulada es la pedida.
    """
    inferior, superior = 0.0, 1.0
    while superior - inferior > _EPSILON:
        medio = (inferior + superior) / 2
        if beta_regularizada(medio, a, b) < probabilidad:
            inferior = medio
        else:
            superior = medio
    return (inferior + superior) / 2


def cuantil_t(grados: float, confianza: float = CONFIANZA) -> float:
    """El t con P(|T| ≤ t) = confianza para una t de Student con esos grados: P(|T| > t) = I_{g/(g+t²)}(g/2, 1/2).

    Returns:
        El cuantil positivo de la t de Student.
    """
    punto = cuantil_beta(1 - confianza, grados / 2, 0.5)
    return math.sqrt(grados * (1 - punto) / punto)


def intervalo_korn_graubard(
    proporcion: float, muestra: int, efectivo: float, grados: float, confianza: float = CONFIANZA
) -> tuple[float, float]:
    """Intervalo de Korn–Graubard de una proporción: Clopper–Pearson con n*_gl = n* · (t_{n−1} / t_gl)².

    Returns:
        Los límites inferior y superior del intervalo, entre 0 y 1.
    """
    efectivo = float(muestra) if proporcion in (0, 1) else efectivo
    ajustado = efectivo * (cuantil_t(muestra - 1, confianza) / cuantil_t(grados, confianza)) ** 2
    exitos = ajustado * proporcion
    alfa = 1 - confianza
    inferior = 0.0 if exitos == 0 else cuantil_beta(alfa / 2, exitos, ajustado - exitos + 1)
    superior = 1.0 if exitos == ajustado else cuantil_beta(1 - alfa / 2, exitos + 1, ajustado - exitos)
    return inferior, superior


def _supera_el_ancho_relativo(ancho: float, base: float) -> bool:
    """Condición (c) del NCHS: ancho en (0,05; 0,30) y ancho relativo a la base (p o 1 − p) por encima del 130 %.

    Returns:
        True si se cumple la condición.
    """
    return ANCHO_SIN_REGLA_RELATIVA < ancho < ANCHO_MAXIMO and (base == 0 or ancho / base > ANCHO_RELATIVO_MAXIMO)


def regla_nchs(
    proporcion: float, muestra: int, efectivo: float, intervalo: tuple[float, float], grados: float
) -> dict[str, Any]:
    """Si una proporción se presenta según el NCHS: los motivos para no hacerlo, la revisión y el complemento.

    Returns:
        La decisión con sus motivos, la revisión y el complemento.
    """
    ancho = intervalo[1] - intervalo[0]
    motivos = []
    if muestra < MUESTRA_MINIMA or efectivo < MUESTRA_MINIMA:
        motivos.append(f"n o n efectiva < {MUESTRA_MINIMA}")
    if ancho >= ANCHO_MAXIMO:
        motivos.append(f"intervalo de {ancho:.3f} de ancho (>= {ANCHO_MAXIMO})")
    elif _supera_el_ancho_relativo(ancho, proporcion):
        motivos.append(f"ancho relativo > {ANCHO_RELATIVO_MAXIMO:.0%} con un intervalo de {ancho:.3f}")
    revision = ancho <= ANCHO_SIN_REGLA_RELATIVA and (proporcion in (0, 1) or grados < GRADOS_DE_LIBERTAD_MINIMOS)
    return {
        "publicable": not motivos,
        "motivos": motivos,
        "revision": revision,
        "complemento_fiable": not _supera_el_ancho_relativo(ancho, 1 - proporcion),
    }
