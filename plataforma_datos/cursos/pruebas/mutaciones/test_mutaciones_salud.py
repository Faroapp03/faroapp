"""Mutaciones de la salud de la lectura: lo que una fuente publica cambia y la regla calibrada lo tiene que ver.

Cada prueba parte de dos semanas de lecturas sanas de una fuente de 500 cursos que pierde cinco al día sin explicar y
cambia una sola cosa en lo que publica después. La regla es la real, con la calibración que sale de la historia; la
lectura se califica como en la emisión. Para que la guarda del techo no se pueda quitar sin que nadie lo note, la
última prueba repite la degradación lenta con una regla mutada que ignora el techo y comprueba que esa regla no la ve.
"""

import unittest
from unittest import mock

from plataforma_datos.cursos.lecturas import salud
from plataforma_datos.cursos.lecturas.pruebas.historias import cursos, historia_diaria, hora


def degradacion_lenta() -> list[str]:
    """Tras dos semanas sanas, la fuente deja de publicar cada día el 9 % de sus cursos y no los repone.

    Returns:
        El estado de cada lectura de la degradación.
    """
    historia = historia_diaria(15)
    estados = []
    for dia in range(16, 23):
        censo = historia.censo
        historia.leer(hora(dia), censo - set(sorted(censo)[: len(censo) * 9 // 100]))
        estados.append(historia.lecturas[-1]["estado"])
    return estados


class MutacionesSaludPruebas(unittest.TestCase):
    """La regla calibrada no se acostumbra a lo que es un fallo de la fuente."""

    def test_m7_caida_del_diez_por_ciento_en_una_lectura(self) -> None:
        """Una lectura sin el 10 % de los cursos, además de las cinco salidas del día, sale anómala."""
        historia = historia_diaria(15)
        censo = historia.censo
        caida = (censo - set(sorted(censo)[: 5 + 50])) | cursos(50_000, 5)
        dato = historia.leer(hora(16), caida)
        self.assertEqual(dato["estado"], "anomala")
        self.assertIn("salidas_no_explicadas_en_bloque", dato["motivos"])
        self.assertEqual(dato["calibracion"]["origen"], "historia")

    def test_m8_degradacion_lenta_no_se_normaliza(self) -> None:
        """Siete días seguidos perdiendo el 9 %: cada lectura sale anómala aunque la historia ya lo haya visto."""
        self.assertEqual(degradacion_lenta(), ["anomala"] * 7)

    def test_m8_sin_techo_la_degradacion_se_normaliza(self) -> None:
        """Con una regla mutada que ignora el techo, la misma degradación acaba pareciendo normal."""
        with mock.patch.object(salud, "techo_de", lambda suelo, bruto: max(suelo, bruto)):
            estados = degradacion_lenta()
        self.assertIn("sana", estados)


if __name__ == "__main__":
    unittest.main()
