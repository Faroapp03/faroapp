"""Errores de pesos y forma antes de estimar; los ceros individuales de réplica siguen siendo válidos."""

import math
import unittest

import plataforma_datos.ia_y_trabajo.fuentes.encuestas_isco4.diseno as diseno
from plataforma_datos.comun.nucleo import FormatoInesperado

GRAD = {"4110": "gradiente_4", "4120": None}
ESTRUCTURA = diseno.Estructura(GRAD, set(GRAD), {"41": True}, set(GRAD), {})


class PruebasPesos(unittest.TestCase):
    """Una entrada defectuosa se diagnostica, sin truncar réplicas ni producir cifras no finitas."""

    def test_replicas_vacias_o_insuficientes(self) -> None:
        """Se necesitan el peso principal y al menos dos réplicas, también en la primera persona."""
        for pesos in ([], [1.0], [1.0, 1.0]):
            with self.subTest(pesos=pesos), self.assertRaisesRegex(FormatoInesperado, "encuesta.*dos réplicas"):
                diseno.exposicion_por_replicas([("4110", pesos)], ESTRUCTURA)

    def test_distintas_longitudes_no_se_truncan(self) -> None:
        """Las personas del mismo código tampoco pueden perder columnas al sumarse."""
        for codigo in ("4110", "4120"):
            for primero, segundo in ((3, 4), (4, 3)):
                with (
                    self.subTest(codigo=codigo, primero=primero, segundo=segundo),
                    self.assertRaisesRegex(FormatoInesperado, "encuesta.*mismo número de réplicas"),
                ):
                    diseno.exposicion_por_replicas([("4110", [1.0] * primero), (codigo, [1.0] * segundo)], ESTRUCTURA)

    def test_replicas_sin_denominador_positivo(self) -> None:
        """El peso fuera del denominador no hace estimable una réplica sin empleo dentro."""
        for fuera in ([], [(None, [1.0, 9.0, 9.0])]):
            with (
                self.subTest(fuera=fuera),
                self.assertRaisesRegex(FormatoInesperado, "encuesta.*réplica.*total positivo"),
            ):
                diseno.exposicion_por_replicas([("4110", [1.0, 0.0, 1.0]), *fuera], ESTRUCTURA)

    def test_peso_de_replica_negativo(self) -> None:
        """Un peso bootstrap negativo puede producir una fracción expuesta negativa aunque el total sea positivo."""
        with self.assertRaisesRegex(FormatoInesperado, "encuesta.*réplica.*negativo"):
            diseno.exposicion_por_replicas([("4110", [1.0, -1.0, 1.0]), ("4120", [1.0, 2.0, 1.0])], ESTRUCTURA)

    def test_pesos_no_finitos_en_replicas(self) -> None:
        """Ni el peso principal ni una réplica pueden introducir infinitos o NaN."""
        for peso in (math.inf, -math.inf, math.nan):
            for columna in range(3):
                pesos = [1.0] * 3
                pesos[columna] = peso
                with (
                    self.subTest(peso=peso, columna=columna),
                    self.assertRaisesRegex(FormatoInesperado, "encuesta.*peso.*(positivo|finito)"),
                ):
                    diseno.exposicion_por_replicas([("4110", pesos)], ESTRUCTURA)

    def test_pesos_no_finitos_en_taylor(self) -> None:
        """Un peso ocupado no finito se rechaza antes de acumularlo o redondear el empleo."""
        for peso in (math.inf, -math.inf, math.nan):
            with (
                self.subTest(peso=peso),
                self.assertRaisesRegex(FormatoInesperado, "encuesta.*peso.*(positivo|finito)"),
            ):
                diseno.exposicion_por_diseno([diseno.Persona(True, "4110", peso, "1", "a")], ESTRUCTURA)

    def test_totales_no_finitos_aunque_los_pesos_sean_finitos(self) -> None:
        """Una suma desbordada tampoco es un denominador válido; no se fija un tope artificial de peso."""
        personas = [diseno.Persona(True, "4110", 1e308, "1", upm) for upm in ("a", "b")]
        with self.subTest(metodo="Taylor"), self.assertRaisesRegex(FormatoInesperado, "encuesta.*total.*finito"):
            diseno.exposicion_por_diseno(personas, ESTRUCTURA)
        for codigo in ("4110", "4120"):
            for pesos in ([1e308, 1.0, 1.0], [1.0, 1e308, 1.0]):
                with (
                    self.subTest(codigo=codigo, pesos=pesos),
                    self.assertRaisesRegex(FormatoInesperado, "encuesta.*total.*finito"),
                ):
                    diseno.exposicion_por_replicas([("4110", pesos), (codigo, pesos)], ESTRUCTURA)

    def test_cero_individual_de_replica_con_total_positivo_se_conserva(self) -> None:
        """Dos réplicas extremas, con ceros individuales, conservan la cifra y su varianza bootstrap."""
        resultado = diseno.exposicion_por_replicas([("4110", [1.0, 0.0, 2.0]), ("4120", [1.0, 2.0, 0.0])], ESTRUCTURA)
        medida = {
            "valor": 50.0,
            "cota_minima": 50.0,
            "cota_maxima": 50.0,
            "error_tipico": round(100 * math.sqrt(0.5), 3),
            "desde_95": 0.0,
            "hasta_95": 100.0,
        }
        self.assertEqual(
            resultado,
            {
                "alguna": medida,
                "alta": medida,
                "empleo": 2,
                "empleo_dentro": 2,
                "parte_fuera": 0.0,
                "parte_codigo_invalido": 0.0,
                "parte_sin_correspondencia": 0.0,
                "muestra": {
                    "personas": 2,
                    "celdas": 2,
                    "celdas_de_menos_de_30": 2,
                    "personas_en_celdas_de_menos_de_30": 2,
                    "regla_nchs_n_30": False,
                    "replicas": 2,
                },
            },
        )


if __name__ == "__main__":
    unittest.main()
