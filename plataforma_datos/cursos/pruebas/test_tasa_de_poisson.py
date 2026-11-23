"""La tasa de Poisson y su límite, contra fórmulas cerradas y sumas directas, no contra el propio código."""

import math
import unittest

from plataforma_datos.cursos.tasa_de_poisson import (
    ErrorDeTasa,
    cola_con_dispersion,
    cola_de_poisson,
    cota_superior_de_la_dispersion,
    cota_superior_de_la_tasa,
    cuantil_de_gamma,
    dispersion_de,
    gamma_incompleta,
    limite_de_poisson,
)


def gamma_de_forma_entera(n: int, x: float) -> float:
    """P(n, x) = 1 - e^-x · Σ_{i<n} x^i / i!, la fórmula cerrada de la gamma de forma entera.

    Returns:
        La probabilidad acumulada.
    """
    return 1.0 - sum(math.exp(-x + i * math.log(x) - math.lgamma(i + 1)) for i in range(n))


def gamma_de_forma_semientera(n: int, x: float) -> float:
    """P(n + 1/2, x) = erf(√x) - e^-x · Σ_{j<n} x^(j+1/2) / Γ(j + 3/2), la fórmula cerrada de la forma semientera.

    Returns:
        La probabilidad acumulada.
    """
    return math.erf(math.sqrt(x)) - sum(math.exp(-x + (j + 0.5) * math.log(x) - math.lgamma(j + 1.5)) for j in range(n))


def cola_por_suma(recuento: int, media: float) -> float:
    """P(X > recuento) de un Poisson sumando sus probabilidades una a una.

    Returns:
        La probabilidad de la cola.
    """
    return 1.0 - sum(math.exp(-media + k * math.log(media) - math.lgamma(k + 1)) for k in range(recuento + 1))


def cola_binomial_negativa_por_suma(recuento: int, media: float, dispersion: float) -> float:
    """P(X > recuento) de una binomial negativa de media `media` y varianza `dispersion · media`, término a término.

    Returns:
        La probabilidad de la cola.
    """
    r, p = media / (dispersion - 1.0), 1.0 / dispersion
    terminos = (
        math.exp(math.lgamma(k + r) - math.lgamma(k + 1) - math.lgamma(r) + r * math.log(p) + k * math.log1p(-p))
        for k in range(recuento + 1)
    )
    return 1.0 - sum(terminos)


class GammaPruebas(unittest.TestCase):
    """La gamma incompleta y su cuantil coinciden con las fórmulas cerradas."""

    def test_forma_entera_y_semientera(self) -> None:
        """Por la serie y por la fracción continua, a ambos lados de `a + 1`."""
        for n in (1, 2, 5, 30, 200):
            for x in (0.1, 1.0, n * 0.7, n * 1.0, n * 1.6 + 3):
                with self.subTest(n=n, x=x):
                    self.assertAlmostEqual(gamma_incompleta(n, x), gamma_de_forma_entera(n, x), places=10)
        for n in (0, 1, 4, 20):
            for x in (0.05, 1.0, n + 0.5, 2.0 * n + 4):
                with self.subTest(n=n + 0.5, x=x):
                    self.assertAlmostEqual(gamma_incompleta(n + 0.5, x), gamma_de_forma_semientera(n, x), places=10)

    def test_cuantil_y_cota_de_jeffreys_sin_sucesos(self) -> None:
        """Sin sucesos la cota al 97,5 % cumple erf(√(cota·E)) = 0,975: la gamma de forma 1/2."""
        cota = cota_superior_de_la_tasa(0, 7.0, 0.975)
        self.assertAlmostEqual(math.erf(math.sqrt(cota * 7.0)), 0.975, places=12)
        self.assertAlmostEqual(gamma_de_forma_entera(9, cuantil_de_gamma(0.3, 9)), 0.3, places=12)

    def test_la_dispersion_ensancha_la_cota(self) -> None:
        """Con un factor φ, la cota es la de k/φ sucesos en E/φ de exposición y nunca más estrecha que la de Poisson."""
        self.assertAlmostEqual(
            cota_superior_de_la_tasa(40, 100.0, 0.975, 4.0), cota_superior_de_la_tasa(10, 25.0, 0.975), places=12
        )
        self.assertGreater(cota_superior_de_la_tasa(40, 100.0, 0.975, 4.0), cota_superior_de_la_tasa(40, 100.0, 0.975))

    def test_datos_imposibles_se_rechazan(self) -> None:
        """Un recuento negativo, una exposición nula, una dispersión menor que 1 o una probabilidad fuera de rango."""
        for llamada in (
            lambda: cota_superior_de_la_tasa(-1, 1.0, 0.975),
            lambda: cota_superior_de_la_tasa(1, 0.0, 0.975),
            lambda: cota_superior_de_la_tasa(1, 1.0, 0.975, 0.5),
            lambda: limite_de_poisson(-1.0, 0.001),
            lambda: limite_de_poisson(1.0, 1.0),
            lambda: gamma_incompleta(0.0, 1.0),
        ):
            with self.assertRaises(ErrorDeTasa):
                llamada()


class LimitePruebas(unittest.TestCase):
    """El límite es el menor recuento cuya cola no pasa de la probabilidad declarada."""

    def test_cola_de_poisson_por_suma(self) -> None:
        """La cola sale igual que sumando las probabilidades."""
        for media in (0.3, 4.0, 18.0, 90.0):
            for recuento in (0, 3, 12, 40, 120):
                with self.subTest(media=media, recuento=recuento):
                    self.assertAlmostEqual(cola_de_poisson(recuento, media), cola_por_suma(recuento, media), places=10)

    def test_el_limite_es_el_justo(self) -> None:
        """La cola del límite no pasa de 1/1000 y la del recuento anterior sí: ni uno más ni uno menos."""
        for media in (0.0, 0.05, 1.0, 6.0, 25.0, 140.0):
            limite = limite_de_poisson(media, 0.001)
            with self.subTest(media=media):
                self.assertLessEqual(cola_por_suma(limite, media) if media else 0.0, 0.001)
                if limite:
                    self.assertGreater(cola_por_suma(limite - 1, media), 0.001)
        self.assertEqual(limite_de_poisson(0.0, 0.001), 0)

    def test_con_dispersion_es_la_binomial_negativa(self) -> None:
        """La cola con dispersión coincide con la binomial negativa sumada término a término y es más ancha."""
        for media, dispersion in ((5.0, 1.5), (20.0, 3.0), (60.0, 2.2)):
            for recuento in (0, 10, 40, 90):
                with self.subTest(media=media, dispersion=dispersion, recuento=recuento):
                    self.assertAlmostEqual(
                        cola_con_dispersion(recuento, media, dispersion),
                        cola_binomial_negativa_por_suma(recuento, media, dispersion),
                        places=9,
                    )
            self.assertGreater(limite_de_poisson(media, 0.001, dispersion), limite_de_poisson(media, 0.001))

    def test_una_dispersion_de_redondeo_es_un_poisson(self) -> None:
        """Un factor que solo pasa de 1 por redondeo da la cola del Poisson, no una binomial negativa degenerada."""
        for recuento in (0, 3, 11):
            with self.subTest(recuento=recuento):
                self.assertAlmostEqual(
                    cola_con_dispersion(recuento, 2.85, 1.0000000000000002), cola_por_suma(recuento, 2.85), places=12
                )
        self.assertEqual(limite_de_poisson(2.85, 0.001, 1.0000000000000002), limite_de_poisson(2.85, 0.001))

    def test_cota_de_la_dispersion_con_la_ji_cuadrado(self) -> None:
        """Con dos tramos (un grado), X² = 3,6 y la cota es 3,6 / c con erf(√(c/2)) = 0,025, la ji cuadrado de 1."""
        cota = cota_superior_de_la_dispersion(((2, 10), (8, 10)), 0.975)
        self.assertAlmostEqual(math.erf(math.sqrt(3.6 / cota / 2.0)), 0.025, places=10)
        self.assertEqual(cota_superior_de_la_dispersion(((5, 10),), 0.975), 1.0)

    def test_dispersion_de_pearson(self) -> None:
        """X²/(n-1) a mano: recuentos 2 y 8 con la misma exposición dan (9 + 9) / 5 = 3,6; sin variación, 1."""
        self.assertAlmostEqual(dispersion_de(((2, 10), (8, 10))), 3.6, places=12)
        self.assertEqual(dispersion_de(((5, 10), (5, 10), (5, 10))), 1.0)
        self.assertEqual(dispersion_de(((5, 10),)), 1.0)
        self.assertEqual(dispersion_de(((0, 10), (0, 10))), 1.0)


if __name__ == "__main__":
    unittest.main()
