"""Los descriptores de Citilab y del Consorci dicen una sola verdad, la misma que hace su código."""

import unittest

from plataforma_datos.contratos.fuentes import cargar_fuente
from plataforma_datos.cursos.fuentes.formacion.constantes import MAX_DIAS_COPIA_CURSOS
from plataforma_datos.orquestacion.estado_de_los_datos import plazo

# Fuentes de cursos que se descargan cada día con su lector y cuya copia vigila la aplicación.
DIARIAS = ("citilab", "consorci")


class PruebaPlazoDeCursos(unittest.TestCase):
    """Política, frecuencia, intervalo y aviso no se contradicen."""

    def test_politica_e_intervalo_son_diarios(self) -> None:
        """La política declarada coincide con la consulta diaria que programa su conjunto."""
        for fuente in DIARIAS:
            descriptor = cargar_fuente(fuente)
            with self.subTest(fuente=fuente):
                self.assertEqual(descriptor.actualizacion.politica, "diaria")
                self.assertTrue(descriptor.actualizacion.frecuencia.startswith("Consulta diaria"))
                # El plazo lo fija MAX_DIAS_COPIA_CURSOS: el texto no repite una cifra que podría quedar desfasada.
                self.assertNotRegex(descriptor.actualizacion.frecuencia, r"\d")
                self.assertEqual({c.intervalo_dias for c in descriptor.conjuntos}, {1})

    def test_panel_y_aplicacion_avisan_con_el_mismo_plazo(self) -> None:
        """El panel pide revisar la copia el mismo día en que la aplicación la da por antigua."""
        for fuente in DIARIAS:
            with self.subTest(fuente=fuente):
                self.assertEqual(cargar_fuente(fuente).actualizacion.renovar_dias, MAX_DIAS_COPIA_CURSOS)
                self.assertEqual(plazo(fuente), MAX_DIAS_COPIA_CURSOS)


if __name__ == "__main__":
    unittest.main()
