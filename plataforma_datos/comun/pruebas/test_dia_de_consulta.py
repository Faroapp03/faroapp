"""El día de la consulta que se cita es el de Cataluña, también en el cambio de día y en el de hora de verano."""

import unittest

from plataforma_datos.comun.dia_de_consulta import dia_de_consulta, dia_iso_en_cataluna
from plataforma_datos.comun.nucleo import FormatoInesperado


class PruebaDiaDeConsulta(unittest.TestCase):
    """Un instante UTC se cita con el día civil de Cataluña, como DD/MM/AAAA."""

    def test_cambio_de_dia(self) -> None:
        """Pasada la medianoche en Barcelona ya es el día siguiente, aunque en UTC no; con horario de invierno (+1)."""
        casos = {
            "2026-11-14T22:59:59+00:00": "14/11/2026",
            "2026-11-14T23:00:00+00:00": "15/11/2026",
            "2026-11-14T23:40:38Z": "15/11/2026",
        }
        for instante, dia in casos.items():
            with self.subTest(instante=instante):
                self.assertEqual(dia_de_consulta(instante), dia)

    def test_cambio_de_hora_de_verano(self) -> None:
        """En verano la medianoche llega a las 22:00 UTC; el día de los cambios de hora también se cita bien."""
        casos = {
            "2026-07-14T21:59:59+00:00": "14/07/2026",
            "2026-07-14T22:00:00+00:00": "15/07/2026",
            # 29/03/2026: a las 01:00 UTC se pasa de +1 a +2.
            "2026-03-28T22:59:00+00:00": "28/03/2026",
            "2026-03-28T23:00:00+00:00": "29/03/2026",
            # 25/10/2026: a las 01:00 UTC se vuelve a +1; las 22:30 UTC del 24 ya son las 00:30 del 25.
            "2026-10-24T21:59:00+00:00": "24/10/2026",
            "2026-10-24T22:30:00+00:00": "25/10/2026",
            "2026-10-25T22:59:00+00:00": "25/10/2026",
        }
        for instante, dia in casos.items():
            with self.subTest(instante=instante):
                self.assertEqual(dia_de_consulta(instante), dia)

    def test_dia_anotado_sin_hora_se_cita_tal_cual(self) -> None:
        """Una captura hecha a mano anota solo el día civil (AAAA-MM-DD): se cita ese día, sin conversión."""
        self.assertEqual(dia_de_consulta("2026-10-21"), "21/10/2026")
        self.assertEqual(dia_iso_en_cataluna("2026-10-21"), "2026-10-21")
        self.assertEqual(dia_iso_en_cataluna("2028-02-29"), "2028-02-29")

    def test_dia_anotado_imposible_se_rechaza(self) -> None:
        """Un día que no existe no se cita, y una fecha con otra forma sin zona sigue siendo un error."""
        for valor in ("2026-02-30", "2026-13-01", "2027-02-29", "20261021", "2026-10-21T10:00", "2026-1-21"):
            with self.subTest(valor=valor), self.assertRaises(FormatoInesperado):
                dia_de_consulta(valor)

    def test_instante_sin_zona_o_mal_escrito_se_rechaza(self) -> None:
        """Sin zona horaria no se sabe qué día era en Cataluña: no se adivina."""
        for instante in ("2026-11-14T23:40:38", "ayer", ""):
            with self.subTest(instante=instante), self.assertRaises(FormatoInesperado):
                dia_de_consulta(instante)


if __name__ == "__main__":
    unittest.main()
