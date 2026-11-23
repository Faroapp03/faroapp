"""Contratos públicos de lugares mediante casos sintéticos."""

import unittest

from plataforma_datos.comun import lugares


class PruebaLugares(unittest.TestCase):
    """Resultados de los auxiliares comunes en sus entradas válidas."""

    def test_capitalizacion_de_municipios(self) -> None:
        """Los casos publicados conservan su capitalización, con artículos y elisiones."""
        casos = {
            "L'HOSPITALET DE LLOBREGAT": "L'Hospitalet de Llobregat",
            "VILANOVA I LA GELTRÚ": "Vilanova i la Geltrú",
            "LA SEU D'URGELL": "La Seu d'Urgell",
            "EL PRAT DE LLOBREGAT": "El Prat de Llobregat",
            "VILA-SECA": "Vila-seca",
        }
        for publicado, legible in casos.items():
            with self.subTest(publicado=publicado):
                self.assertEqual(lugares.municipio_legible(publicado), legible)

    def test_comarca_solo_en_cataluna(self) -> None:
        """La comarca publicada vale si el municipio es de Cataluña por su código INE; fuera, o sin comarca, no hay."""
        self.assertEqual(lugares.comarca_en_cataluna("08019", "13"), "13")
        self.assertEqual(lugares.comarca_en_cataluna("43123", "36"), "36")
        self.assertIsNone(lugares.comarca_en_cataluna("28079", "13"))
        self.assertIsNone(lugares.comarca_en_cataluna("08019", ""))


if __name__ == "__main__":
    unittest.main()
