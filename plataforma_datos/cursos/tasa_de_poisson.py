"""La tasa de un suceso que se cuenta por exposición, y cuántos sucesos de una vez dejan de ser creíbles con ella.

Un suceso raro e independiente (un curso que se va sin que la fuente diga por qué) se cuenta como un proceso de Poisson:
con una tasa `λ` por unidad de exposición, en una exposición `e` se esperan `λ·e` sucesos. Con `k` sucesos vistos en
una exposición total `E`, la prior de Jeffreys deja para la tasa una gamma de forma `k + 0,5` y razón `E`; su cuantil
alto es la cota superior honesta de la tasa, también cuando no se ha visto ningún suceso. El límite de una observación
es el menor recuento que solo se supera con una probabilidad dada si la media es la de esa cota.

Si los recuentos varían entre tramos más de lo que permite un Poisson (el ritmo cambia de una semana a otra), el factor
de dispersión de Pearson lo mide y el modelo lo recoge: la cota se calcula con los sucesos y la exposición divididos por
ese factor (cuasi-Poisson) y el límite, con una binomial negativa de la misma media y la varianza multiplicada por él.
Como el factor medido con pocos tramos sale a menudo por debajo del real, se usa su cota superior: `X²` partido por el
cuantil bajo de la ji cuadrado de `n - 1` grados. Con un factor de 1 todo vuelve a ser el Poisson.

La gamma incompleta se calcula con su serie o con su fracción continua (algoritmo de Lentz) y los cuantiles se hallan
por bisección: todo con la biblioteca estándar, determinista y sin dependencias. Son funciones puras.
"""

import math
from collections.abc import Sequence

from plataforma_datos.cursos.intervalo_de_jeffreys import beta_incompleta

# La serie y la fracción continua convergen en pocas decenas de pasos; el tope impide que un parámetro absurdo las
# deje girando.
MAX_ITERACIONES = 10_000
PRECISION = 1e-15
# Un valor mínimo evita dividir por cero en el algoritmo de Lentz.
MINIMO_DE_LENTZ = 1e-300
PASOS_DE_BISECCION = 100
# La dispersión se mide con al menos dos tramos: con uno no hay variación entre tramos.
TRAMOS_PARA_DISPERSION = 2
# Por debajo de este exceso de varianza la binomial negativa es un Poisson, y calcularla como binomial negativa daría
# un parámetro de forma gigantesco que la beta incompleta no resuelve con precisión.
EXCESO_DE_DISPERSION_DESPRECIABLE = 1e-6


class ErrorDeTasa(ValueError):
    """Unos datos que no son un recuento o una exposición posibles, o un cálculo que no converge."""


def _serie(a: float, x: float) -> float:
    """La serie de la gamma incompleta inferior, que converge deprisa cuando `x < a + 1`.

    Returns:
        La gamma incompleta inferior regularizada.

    Raises:
        ErrorDeTasa: Si no converge dentro del tope de iteraciones.
    """
    termino = suma = 1.0 / a
    denominador = a
    for _ in range(MAX_ITERACIONES):
        denominador += 1.0
        termino *= x / denominador
        suma += termino
        if abs(termino) < abs(suma) * PRECISION:
            return suma * math.exp(-x + a * math.log(x) - math.lgamma(a))
    raise ErrorDeTasa(f"la serie de la gamma no converge con a={a}, x={x}")


def _fraccion_continua(a: float, x: float) -> float:
    """La fracción continua de la gamma incompleta superior, que converge deprisa cuando `x >= a + 1`.

    Returns:
        La gamma incompleta superior regularizada.

    Raises:
        ErrorDeTasa: Si no converge dentro del tope de iteraciones.
    """
    b = x + 1.0 - a
    c = 1.0 / MINIMO_DE_LENTZ
    d = 1.0 / b
    resultado = d
    for i in range(1, MAX_ITERACIONES + 1):
        numerador = -i * (i - a)
        b += 2.0
        d = numerador * d + b
        d = 1.0 / (d if abs(d) > MINIMO_DE_LENTZ else MINIMO_DE_LENTZ)
        c = b + numerador / c
        c = c if abs(c) > MINIMO_DE_LENTZ else MINIMO_DE_LENTZ
        factor = d * c
        resultado *= factor
        if abs(factor - 1.0) < PRECISION:
            return resultado * math.exp(-x + a * math.log(x) - math.lgamma(a))
    raise ErrorDeTasa(f"la fracción continua de la gamma no converge con a={a}, x={x}")


def gamma_incompleta(a: float, x: float) -> float:
    """La función de distribución de una gamma de forma `a` y razón 1: la probabilidad de que valga como mucho `x`.

    Returns:
        La gamma incompleta inferior regularizada, un número de 0 a 1.

    Raises:
        ErrorDeTasa: Si la forma no es positiva o el cálculo no converge.
    """
    if not a > 0:
        raise ErrorDeTasa("la forma de la gamma debe ser positiva")
    if x <= 0.0:
        return 0.0
    if x < a + 1.0:
        return _serie(a, x)
    return 1.0 - _fraccion_continua(a, x)


def cuantil_de_gamma(probabilidad: float, a: float) -> float:
    """El valor por debajo del cual queda esa probabilidad de una gamma de forma `a` y razón 1.

    Returns:
        El cuantil, un número no negativo.

    Raises:
        ErrorDeTasa: Si la probabilidad no está entre 0 y 1 sin tocarlos o la gamma no se puede calcular.
    """
    if not 0.0 < probabilidad < 1.0:
        raise ErrorDeTasa("la probabilidad del cuantil debe estar entre 0 y 1")
    bajo, alto = 0.0, a + 1.0
    while gamma_incompleta(a, alto) < probabilidad:
        bajo, alto = alto, alto * 2.0
    for _ in range(PASOS_DE_BISECCION):
        medio = (bajo + alto) / 2.0
        if gamma_incompleta(a, medio) < probabilidad:
            bajo = medio
        else:
            alto = medio
    return (bajo + alto) / 2.0


def _pearson(tramos: Sequence[tuple[int, int]]) -> tuple[float, int] | None:
    """El estadístico de Pearson de unos recuentos frente a una tasa común, y sus grados de libertad.

    Returns:
        `X²` y `n - 1`; `None` con menos de dos tramos con exposición o sin ningún suceso, donde no hay nada que medir.
    """
    expuestos = [(sucesos, exposicion) for sucesos, exposicion in tramos if exposicion > 0]
    total = sum(sucesos for sucesos, _ in expuestos)
    if len(expuestos) < TRAMOS_PARA_DISPERSION or total == 0:
        return None
    tasa = total / sum(exposicion for _, exposicion in expuestos)
    pearson = sum((sucesos - tasa * exposicion) ** 2 / (tasa * exposicion) for sucesos, exposicion in expuestos)
    return pearson, len(expuestos) - 1


def dispersion_de(tramos: Sequence[tuple[int, int]]) -> float:
    """El factor de dispersión de Pearson de unos recuentos con su exposición: `X² / (n - 1)`, nunca por debajo de 1.

    Args:
        tramos: Cada tramo, como sus sucesos y su exposición.

    Returns:
        El factor; 1 si no hay nada que medir.
    """
    medida = _pearson(tramos)
    return 1.0 if medida is None else max(1.0, medida[0] / medida[1])


def cota_superior_de_la_dispersion(tramos: Sequence[tuple[int, int]], nivel: float) -> float:
    """La cota superior del factor de dispersión: `X² / χ²` con el cuantil `1 - nivel` de `n - 1` grados, al menos 1.

    Returns:
        El factor que el de verdad solo supera con probabilidad `1 - nivel`; 1 si no hay nada que medir.
    """
    medida = _pearson(tramos)
    if medida is None:
        return 1.0
    pearson, grados = medida
    # La ji cuadrado de `g` grados es una gamma de forma g/2 y razón 1/2.
    return max(1.0, pearson / (2.0 * cuantil_de_gamma(1.0 - nivel, grados / 2.0)))


def cota_superior_de_la_tasa(sucesos: int, exposicion: float, nivel: float, dispersion: float = 1.0) -> float:
    """La cota superior de Jeffreys de una tasa: el cuantil `nivel` de la gamma `k/φ + 0,5` con razón `E/φ`.

    Con un factor de dispersión `φ` de 1 es la cota de Jeffreys de una tasa de Poisson; con uno mayor, los sucesos
    pesan como `k/φ` sucesos independientes y la cota se ensancha.

    Returns:
        La tasa por unidad de exposición que solo se supera con probabilidad `1 - nivel`.

    Raises:
        ErrorDeTasa: Si el recuento no es un entero no negativo, la exposición no es positiva, el factor es menor que
            1 o el nivel no está entre 0 y 1.
    """
    if type(sucesos) is not int or sucesos < 0:
        raise ErrorDeTasa("los sucesos deben ser un entero no negativo")
    if not (isinstance(exposicion, int | float) and math.isfinite(exposicion) and exposicion > 0):
        raise ErrorDeTasa("la exposición debe ser un número positivo")
    if not (math.isfinite(dispersion) and dispersion >= 1.0):
        raise ErrorDeTasa("el factor de dispersión debe ser 1 o mayor")
    return cuantil_de_gamma(nivel, sucesos / dispersion + 0.5) / (exposicion / dispersion)


def cola_de_poisson(recuento: int, media: float) -> float:
    """La probabilidad de que un Poisson de esa media pase de `recuento`: P(X > recuento) = P(recuento + 1, media).

    Returns:
        La probabilidad de la cola, un número de 0 a 1.
    """
    if media <= 0.0:
        return 0.0
    return gamma_incompleta(recuento + 1.0, media)


def cola_con_dispersion(recuento: int, media: float, dispersion: float) -> float:
    """P(X > recuento) para una binomial negativa de esa media y varianza `dispersion · media`; con 1, el Poisson.

    Con `r = media / (φ - 1)` y `p = 1 / φ`, la función de distribución es la beta incompleta `I_p(r, recuento + 1)`.

    Returns:
        La probabilidad de la cola, un número de 0 a 1.
    """
    if media <= 0.0:
        return 0.0
    if dispersion - 1.0 < EXCESO_DE_DISPERSION_DESPRECIABLE:
        return cola_de_poisson(recuento, media)
    return 1.0 - beta_incompleta(1.0 / dispersion, media / (dispersion - 1.0), recuento + 1.0)


def limite_de_poisson(media: float, probabilidad_de_superarlo: float, dispersion: float = 1.0) -> int:
    """El menor recuento que solo se supera con, como mucho, la probabilidad dada, con esa media y esa dispersión.

    Returns:
        El límite: ver más sucesos que él tiene una probabilidad no mayor que `probabilidad_de_superarlo`.

    Raises:
        ErrorDeTasa: Si la media es negativa o no finita, o la probabilidad no está entre 0 y 1 sin tocarlos.
    """
    if not (math.isfinite(media) and media >= 0.0):
        raise ErrorDeTasa("la media debe ser un número no negativo")
    if not 0.0 < probabilidad_de_superarlo < 1.0:
        raise ErrorDeTasa("la probabilidad de superar el límite debe estar entre 0 y 1")
    # La cola solo baja al subir el recuento: el primero que basta es el límite.
    recuento = 0
    while cola_con_dispersion(recuento, media, dispersion) > probabilidad_de_superarlo:
        recuento += 1
    return recuento
