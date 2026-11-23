"""Comprueba la orientación conservadora de objetivos FUNDAE."""

import unittest

from plataforma_datos.cursos.nivel_objetivos_fundae import orientar


class TestNivelObjetivosFundae(unittest.TestCase):
    """Contrasta señales y abstenciones de la clasificación."""

    def test_senales_de_complejidad_y_no_por_tecnologia(self) -> None:
        """Una tecnología por sí sola no determina la dificultad."""
        self.assertEqual(
            orientar("Utilizar las funciones básicas de las aplicaciones informáticas")["valor"], "inicial"
        )
        self.assertEqual(
            orientar("Diseñar y publicar una página web desde cero con hojas de estilo")["valor"], "intermedio"
        )
        self.assertEqual(orientar("Diseñar y optimizar arquitecturas de datos a gran escala")["valor"], "avanzado")
        self.assertIsNone(orientar("Aplicar inteligencia artificial para mejorar la productividad"))
        self.assertIsNone(orientar("Usar Python"))
        self.assertIsNone(orientar("Conceptos avanzados y herramientas básicas"))

    def test_negaciones_y_senales_contradictorias_se_abstienen(self) -> None:
        """Descarta afirmaciones negadas o con niveles en conflicto."""
        self.assertIsNone(orientar("No se requiere diseñar arquitecturas a gran escala"))
        self.assertIsNone(orientar("Conceptos básicos para diseñar arquitecturas a gran escala"))
        self.assertIsNone(orientar("Conocimientos básicos de modelado, iluminación, texturizado y render"))
        self.assertIsNone(orientar(""))
        self.assertIsNone(orientar(None))
