"""Intervalo de Jeffreys para una proporción: la cota honesta de un error que se ha visto pocas veces o ninguna.

Con `errores` fallos en `total` observaciones, la proporción verdadera sigue (con la prior de Jeffreys, beta 0,5/0,5)
una beta de parámetros `errores + 0,5` y `total - errores + 0,5`. El intervalo al 95 % deja un 2,5 % de probabilidad
a cada lado. Con cero errores el extremo superior no es cero: dice hasta dónde puede llegar el error sin haberse
visto todavía, que es lo único que se puede afirmar.

La beta incompleta se calcula con la fracción continua de Lentz y los cuantiles se hallan por bisección: todo con la
biblioteca estándar, determinista y sin dependencias. Es una función pura.
"""

import math

NIVEL_POR_DEFECTO = 0.95
# La fracción continua converge en pocas decenas de pasos; el tope impide que un parámetro absurdo la deje girando.
MAX_ITERACIONES_FRACCION = 2000
# Lo que puede desviarse una probabilidad por el redondeo de sus últimas operaciones.
HOLGURA_DE_REDONDEO = 1e-9
PRECISION_FRACCION = 1e-15
# Un valor mínimo evita dividir por cero en el algoritmo de Lentz.
MINIMO_DE_LENTZ = 1e-300
PASOS_DE_BISECCION = 200


class ErrorDeIntervalo(ValueError):
    """Unos datos que no son un recuento posible, o una beta cuyo cálculo no converge."""


def _fraccion_continua(x: float, a: float, b: float) -> float:
    """La fracción continua de la beta incompleta (algoritmo de Lentz modificado).

    Returns:
        El valor de la fracción para `x`, `a` y `b`.

    Raises:
        ErrorDeIntervalo: Si no converge dentro del tope de iteraciones.
    """
    suma_ab, mas_a, menos_a = a + b, a + 1.0, a - 1.0
    c = 1.0
    d = 1.0 - suma_ab * x / mas_a
    d = 1.0 / (d if abs(d) > MINIMO_DE_LENTZ else MINIMO_DE_LENTZ)
    resultado = d
    for m in range(1, MAX_ITERACIONES_FRACCION + 1):
        doble = 2 * m
        # Término par y término impar de la fracción: cada paso aplica los dos.
        for numerador in (
            m * (b - m) * x / ((menos_a + doble) * (a + doble)),
            -(a + m) * (suma_ab + m) * x / ((a + doble) * (mas_a + doble)),
        ):
            d = 1.0 + numerador * d
            d = 1.0 / (d if abs(d) > MINIMO_DE_LENTZ else MINIMO_DE_LENTZ)
            c = 1.0 + numerador / (c if abs(c) > MINIMO_DE_LENTZ else MINIMO_DE_LENTZ)
            factor = d * c
            resultado *= factor
        if abs(factor - 1.0) < PRECISION_FRACCION:
            return resultado
    raise ErrorDeIntervalo(f"la beta incompleta no converge con x={x}, a={a}, b={b}")


def _probabilidad(valor: float) -> float:
    """Devuelve el valor como probabilidad, o se niega si el cálculo se salió de su rango.

    Un error de redondeo de un paso se recorta; más allá, el resultado no es una probabilidad y no se devuelve.

    Returns:
        El valor, entre 0 y 1.

    Raises:
        ErrorDeIntervalo: Si el valor queda fuera de 0 a 1 por más que el redondeo.
    """
    if not -HOLGURA_DE_REDONDEO <= valor <= 1.0 + HOLGURA_DE_REDONDEO:
        raise ErrorDeIntervalo("el cálculo de la beta no converge con estos parámetros")
    return min(1.0, max(0.0, valor))


def beta_incompleta(x: float, a: float, b: float) -> float:
    """La función de distribución de una beta: la probabilidad de que valga como mucho `x`.

    Returns:
        La beta incompleta regularizada, un número de 0 a 1.

    Raises:
        ErrorDeIntervalo: Si los parámetros no son positivos o el cálculo no converge.
    """
    if not (a > 0 and b > 0):
        raise ErrorDeIntervalo("los parámetros de la beta deben ser positivos")
    if x <= 0.0:
        return 0.0
    if x >= 1.0:
        return 1.0
    prefijo = math.exp(math.lgamma(a + b) - math.lgamma(a) - math.lgamma(b) + a * math.log(x) + b * math.log1p(-x))
    # La fracción converge deprisa a un lado de la media; al otro se usa la simetría de la beta.
    if x < (a + 1.0) / (a + b + 2.0):
        return _probabilidad(prefijo * _fraccion_continua(x, a, b) / a)
    return _probabilidad(1.0 - prefijo * _fraccion_continua(1.0 - x, b, a) / b)


def cuantil_de_beta(probabilidad: float, a: float, b: float) -> float:
    """El valor por debajo del cual queda esa probabilidad de una beta, hallado por bisección.

    Returns:
        El cuantil, un número de 0 a 1.

    Raises:
        ErrorDeIntervalo: Si la probabilidad no está entre 0 y 1 o la beta no se puede calcular.
    """
    if not 0.0 <= probabilidad <= 1.0:
        raise ErrorDeIntervalo("la probabilidad debe estar entre 0 y 1")
    bajo, alto = 0.0, 1.0
    for _ in range(PASOS_DE_BISECCION):
        medio = (bajo + alto) / 2.0
        if beta_incompleta(medio, a, b) < probabilidad:
            bajo = medio
        else:
            alto = medio
    return (bajo + alto) / 2.0


def intervalo_de_jeffreys(errores: int, total: int, nivel: float = NIVEL_POR_DEFECTO) -> tuple[float, float]:
    """El intervalo de Jeffreys de la proporción de errores, con `nivel` de confianza y las colas iguales.

    Returns:
        El extremo inferior y el superior, como proporciones de 0 a 1.

    Raises:
        ErrorDeIntervalo: Si el recuento no es posible (sin observaciones, negativo o con más errores que casos) o si
            el nivel no está entre 0 y 1.
    """
    if type(errores) is not int or type(total) is not int or not 0 <= errores <= total or total < 1:
        raise ErrorDeIntervalo("un intervalo necesita al menos una observación y 0 <= errores <= total")
    if not 0.0 < nivel < 1.0:
        raise ErrorDeIntervalo("el nivel de confianza debe estar entre 0 y 1")
    cola = (1.0 - nivel) / 2.0
    a, b = errores + 0.5, total - errores + 0.5
    return cuantil_de_beta(cola, a, b), cuantil_de_beta(1.0 - cola, a, b)
