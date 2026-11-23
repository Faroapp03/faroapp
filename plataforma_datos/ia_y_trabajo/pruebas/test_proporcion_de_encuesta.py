"""Intervalos y regla de presentación de proporciones de encuestas complejas."""

import unittest

import plataforma_datos.ia_y_trabajo.fuentes.tich.proporcion_de_encuesta as proporcion_de_encuesta


class PruebaProporcionDeEncuesta(unittest.TestCase):
    """Cuantiles, intervalo de Korn–Graubard y umbrales del NCHS."""

    def test_intervalo_de_korn_graubard(self) -> None:
        """Con n efectiva = n y grados = n − 1 es el de Clopper–Pearson; menos grados lo ensanchan (Korn y Graubard)."""
        inferior, superior = proporcion_de_encuesta.intervalo_korn_graubard(0.5, 10, 10, 9)
        self.assertAlmostEqual(inferior, 0.187086, places=5)
        self.assertAlmostEqual(superior, 0.812914, places=5)
        # En los dos extremos el intervalo se queda dentro de [0, 1] y llega al límite.
        self.assertEqual(proporcion_de_encuesta.intervalo_korn_graubard(0.0, 10, 3, 9), (0.0, 0.3084971078187606))
        cero_inferior, uno_superior = proporcion_de_encuesta.intervalo_korn_graubard(1.0, 10, 3, 9)
        self.assertEqual(uno_superior, 1.0)
        self.assertAlmostEqual(cero_inferior, 1 - 0.3084971078187606, places=12)
        ancho = [
            superior - inferior
            for inferior, superior in (
                proporcion_de_encuesta.intervalo_korn_graubard(0.2, 200, 100, grados) for grados in (199, 20)
            )
        ]
        self.assertGreater(ancho[1], ancho[0])

    def test_cuantil_de_la_t_de_student(self) -> None:
        """Los cuantiles del 97,5 % de las tablas: 12,706 con 1 grado, 2,228 con 10 y 1,960 en el límite."""
        self.assertAlmostEqual(proporcion_de_encuesta.cuantil_t(1), 12.7062, places=4)
        self.assertAlmostEqual(proporcion_de_encuesta.cuantil_t(10), 2.2281, places=4)
        self.assertAlmostEqual(proporcion_de_encuesta.cuantil_t(100_000), 1.9600, places=3)

    def test_regla_del_nchs(self) -> None:
        """Los umbrales de Parker y otros (2017), cada uno por su lado del límite."""
        regla = proporcion_de_encuesta.regla_nchs
        self.assertTrue(regla(0.3, 200, 150, (0.25, 0.35), 100)["publicable"])
        self.assertEqual(regla(0.3, 29, 29, (0.25, 0.35), 100)["motivos"], ["n o n efectiva < 30"])
        self.assertFalse(regla(0.5, 100, 40, (0.35, 0.65), 100)["publicable"])
        self.assertFalse(regla(0.05, 300, 150, (0.02, 0.09), 100)["publicable"])
        self.assertTrue(regla(0.05, 3000, 1500, (0.03, 0.08), 100)["publicable"])
        self.assertTrue(regla(0.02, 3000, 1500, (0.01, 0.04), 100)["publicable"])
        self.assertTrue(regla(0.0, 3000, 3000, (0.0, 0.001), 100)["revision"])
        self.assertFalse(regla(0.96, 300, 150, (0.9, 0.99), 100)["complemento_fiable"])


if __name__ == "__main__":
    unittest.main()
