"""Las dos medidas de exposición de la OIT y las cotas sin supuestos de un empleo repartido."""

import unittest

import plataforma_datos.ia_y_trabajo.fuentes.encuestas_isco4.medidas_de_exposicion as medidas

GRAD = {"4110": "gradiente_4", "4120": "gradiente_1", "4130": None, "5110": "no_expuesta", "5120": "exposicion_minima"}


class PruebasMedidas(unittest.TestCase):
    """Cuentas exactas con resultado conocido."""

    def test_alguna_es_g1_a_g4_y_alta_solo_g4(self) -> None:
        """«Alguna» cuenta los gradientes 1 a 4; «alta», solo el 4; sin nota o fuera de los gradientes, ninguna."""
        self.assertEqual(
            [medidas.expuesto(f"gradiente_{numero}", "alguna") for numero in range(1, 5)], [True, True, True, True]
        )
        self.assertEqual(
            [medidas.expuesto(f"gradiente_{numero}", "alta") for numero in range(1, 5)], [False, False, False, True]
        )
        for gradiente in (None, "no_expuesta", "exposicion_minima"):
            self.assertFalse(medidas.expuesto(gradiente, "alguna"), gradiente)
            self.assertFalse(medidas.expuesto(gradiente, "alta"), gradiente)

    def test_gradientes_de_la_fuente_oit(self) -> None:
        """Cada grupo primario lleva el gradiente de la fuente `oit`, sin recalcularlo."""
        ocupaciones = {"4110": {"gradiente": "gradiente_4", "nota": 0.6}, "4130": {"gradiente": None}}
        self.assertEqual(medidas.gradientes(ocupaciones), {"4110": "gradiente_4", "4130": None})

    def test_cotas_sin_supuestos(self) -> None:
        """Un destino: exacto; destinos mixtos: de 0 a 1; todos sin exposición: 0 exacto; ninguno conocido: de 0 a 1."""
        self.assertEqual(medidas.cotas_de_exposicion(["4110"], GRAD)["alta"], (1.0, 1.0))
        self.assertEqual(medidas.cotas_de_exposicion(["4110", "4130"], GRAD)["alguna"], (0.0, 1.0))
        self.assertEqual(medidas.cotas_de_exposicion(["5110", "5120"], GRAD)["alguna"], (0.0, 0.0))
        self.assertEqual(medidas.cotas_de_exposicion(["9999"], GRAD), {"alguna": (0.0, 1.0), "alta": (0.0, 1.0)})


if __name__ == "__main__":
    unittest.main()
