"""El intervalo de Jeffreys y la beta incompleta, contra valores que se calculan por otro camino.

Cada valor de referencia sale de una fórmula exacta, no del propio código:
- la ley del arcoseno, `I_x(1/2, 1/2) = (2/π)·arcsen(√x)`, que es la beta de la prior de Jeffreys;
- los casos enteros, `I_x(1, b) = 1 - (1-x)^b` y `I_x(a, 1) = x^a`;
- la recurrencia `I_x(a, b+1) = I_x(a, b) + x^a (1-x)^b / (b·B(a, b))`, que lleva la ley del arcoseno hasta
  `b = 300,5` sumando términos positivos, sin fracciones continuas;
- el cuantil 97,5 % de la ji cuadrado con un grado de libertad (5,0239), que para `n` grande da el extremo superior de
  0 errores en `n` casos como `5,0239 / (2n)`.
"""

import math
import unittest
from unittest import mock

from plataforma_datos.cursos import intervalo_de_jeffreys as calculo
from plataforma_datos.cursos.intervalo_de_jeffreys import (
    ErrorDeIntervalo,
    beta_incompleta,
    cuantil_de_beta,
    intervalo_de_jeffreys,
)

JI_CUADRADO_1_CUANTIL_975 = 5.0239
PROPORCION_OBSERVADA = 0.05


def arcoseno(x: float) -> float:
    """La función de distribución de la beta 1/2, 1/2 (ley del arcoseno).

    Returns:
        `(2/π)·arcsen(√x)`.
    """
    return 2.0 / math.pi * math.asin(math.sqrt(x))


def por_recurrencia(x: float, b_final: float) -> float:
    """La beta incompleta de parámetros 1/2 y `b_final` llevada desde la ley del arcoseno sumando términos.

    Returns:
        `I_x(1/2, b_final)` con `b_final - 1/2` entero.
    """
    a, b, valor = 0.5, 0.5, arcoseno(x)
    while b < b_final:
        beta = math.exp(math.lgamma(a) + math.lgamma(b) - math.lgamma(a + b))
        valor += x**a * (1.0 - x) ** b / (b * beta)
        b += 1.0
    return valor


class BetaIncompleta(unittest.TestCase):
    """La función de distribución coincide con las fórmulas exactas."""

    def test_ley_del_arcoseno(self) -> None:
        """La beta 1/2, 1/2 es la ley del arcoseno en todo el rango."""
        for x in (1e-6, 0.001, 0.1, 0.3, 0.5, 0.77, 0.999):
            self.assertAlmostEqual(beta_incompleta(x, 0.5, 0.5), arcoseno(x), places=12)

    def test_casos_enteros(self) -> None:
        """Con un parámetro igual a 1 la beta es una potencia."""
        for x in (0.01, 0.3, 0.9):
            self.assertAlmostEqual(beta_incompleta(x, 1.0, 5.0), 1.0 - (1.0 - x) ** 5, places=12)
            self.assertAlmostEqual(beta_incompleta(x, 3.0, 1.0), x**3, places=12)

    def test_recurrencia_hasta_300_casos(self) -> None:
        """La beta de 0 errores en 300 casos coincide con la que sale de sumar términos desde el arcoseno."""
        for x in (0.002, 0.0083, 0.02):
            self.assertAlmostEqual(beta_incompleta(x, 0.5, 300.5), por_recurrencia(x, 300.5), places=10)

    def test_simetria_y_extremos(self) -> None:
        """`I_x(a, b) = 1 - I_(1-x)(b, a)`; por debajo de 0 vale 0 y por encima de 1 vale 1."""
        self.assertAlmostEqual(beta_incompleta(0.3, 2.5, 7.5), 1.0 - beta_incompleta(0.7, 7.5, 2.5), places=12)
        self.assertEqual((beta_incompleta(-1.0, 1.0, 2.0), beta_incompleta(2.0, 1.0, 2.0)), (0.0, 1.0))

    def test_parametros_no_positivos_se_rechazan(self) -> None:
        """Una beta sin parámetros positivos no existe."""
        with self.assertRaises(ErrorDeIntervalo):
            beta_incompleta(0.5, 0.0, 1.0)


class Cuantiles(unittest.TestCase):
    """El cuantil deshace la función de distribución."""

    def test_cuantil_del_arcoseno(self) -> None:
        """El cuantil de la beta 1/2, 1/2 es `sen²(πp/2)`."""
        for p in (0.025, 0.5, 0.975):
            self.assertAlmostEqual(cuantil_de_beta(p, 0.5, 0.5), math.sin(math.pi * p / 2.0) ** 2, places=12)

    def test_la_distribucion_en_el_cuantil_devuelve_la_probabilidad(self) -> None:
        """Para varias betas, `I(cuantil(p)) = p`."""
        for a, b in ((0.5, 0.5), (0.5, 300.5), (3.5, 96.5), (1.0, 2.0)):
            for p in (0.025, 0.5, 0.975):
                self.assertAlmostEqual(beta_incompleta(cuantil_de_beta(p, a, b), a, b), p, places=10)

    def test_probabilidad_fuera_de_rango_se_rechaza(self) -> None:
        """Una probabilidad menor que 0 o mayor que 1 no es un cuantil."""
        with self.assertRaises(ErrorDeIntervalo):
            cuantil_de_beta(1.5, 0.5, 0.5)


class Intervalo(unittest.TestCase):
    """El intervalo de Jeffreys con valores conocidos y con sus propiedades."""

    def test_cero_errores_en_300_casos_da_el_083_por_ciento(self) -> None:
        """El extremo superior de 0 de 300 es 0,83 %, y lo confirman la recurrencia y la ji cuadrado."""
        superior = intervalo_de_jeffreys(0, 300)[1]
        self.assertAlmostEqual(superior, 0.0083, delta=0.00005)
        self.assertAlmostEqual(por_recurrencia(superior, 300.5), 0.975, places=9)
        self.assertAlmostEqual(superior, JI_CUADRADO_1_CUANTIL_975 / (2 * 300), delta=0.00005)

    def test_sin_errores_la_cota_baja_al_haber_mas_casos(self) -> None:
        """Con más retiradas comprobadas sin error la cota es menor, y nunca es cero."""
        cotas = [intervalo_de_jeffreys(0, n)[1] for n in (1, 10, 100, 300)]
        self.assertEqual(cotas, sorted(cotas, reverse=True))
        self.assertGreater(cotas[-1], 0.0)

    def test_un_caso_sin_error_tiene_formula_cerrada(self) -> None:
        """Un caso sin error es una beta 1/2, 3/2: `arcoseno(x) + 2·√(x(1-x))/π`, el primer paso de la recurrencia."""
        superior = intervalo_de_jeffreys(0, 1)[1]
        cerrada = arcoseno(superior) + 2.0 * math.sqrt(superior * (1.0 - superior)) / math.pi
        self.assertAlmostEqual(cerrada, 0.975, places=10)
        self.assertAlmostEqual(beta_incompleta(superior, 0.5, 1.5), 0.975, places=10)

    def test_simetria_entre_errores_y_aciertos(self) -> None:
        """El intervalo de k errores en n es el espejo del de n-k."""
        inferior, superior = intervalo_de_jeffreys(3, 40)
        otro_inferior, otro_superior = intervalo_de_jeffreys(37, 40)
        self.assertAlmostEqual(inferior, 1.0 - otro_superior, places=12)
        self.assertAlmostEqual(superior, 1.0 - otro_inferior, places=12)

    def test_contiene_la_proporcion_observada_y_se_estrecha(self) -> None:
        """La proporción observada cae dentro y el intervalo es más corto con más casos."""
        corto = intervalo_de_jeffreys(5, 100)
        largo = intervalo_de_jeffreys(50, 1000)
        self.assertTrue(corto[0] < PROPORCION_OBSERVADA < corto[1])
        self.assertTrue(largo[0] < PROPORCION_OBSERVADA < largo[1])
        self.assertLess(largo[1] - largo[0], corto[1] - corto[0])

    def test_recuentos_imposibles_se_rechazan(self) -> None:
        """Sin observaciones, con errores de más o negativos, o con un nivel absurdo, no hay intervalo."""
        for errores, total, nivel in ((0, 0, 0.95), (3, 2, 0.95), (-1, 5, 0.95), (1, 5, 1.0), (1.0, 5, 0.95)):
            with self.subTest(errores=errores, total=total, nivel=nivel), self.assertRaises(ErrorDeIntervalo):
                intervalo_de_jeffreys(errores, total, nivel)


class NuncaDevuelveAlgoQueNoSeaUnaProbabilidad(unittest.TestCase):
    """Si el cálculo se sale de 0 a 1, se niega; el redondeo de un paso se recorta."""

    def test_un_calculo_desbocado_se_rechaza(self) -> None:
        """Una fracción que no converge y da un número enorme no llega a quien llama."""
        with (
            mock.patch.object(calculo, "_fraccion_continua", return_value=1e12),
            self.assertRaises(ErrorDeIntervalo),
        ):
            beta_incompleta(0.3, 2.0, 3.0)

    def test_el_redondeo_se_recorta(self) -> None:
        """Un valor que pasa de 1 solo por el último decimal se devuelve como 1."""
        self.assertEqual(calculo._probabilidad(1.0 + 1e-13), 1.0)
        self.assertEqual(calculo._probabilidad(-1e-13), 0.0)


if __name__ == "__main__":
    unittest.main()
