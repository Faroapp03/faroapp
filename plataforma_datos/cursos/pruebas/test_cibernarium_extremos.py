"""Los extremos de sesiones comparan instantes y no completan zonas ausentes."""

import unittest
from copy import deepcopy

from plataforma_datos.cursos.fuentes.barcelonactiva import robot_cibernarium as robot
from plataforma_datos.cursos.pruebas import test_robot_cibernarium as fixture


class ExtremosCibernarium(unittest.TestCase):
    """Pruebas causales de orden UTC con literales CET/CEST de la fuente."""

    def test_cambio_de_hora_no_invierte_extremos_de_dos_sesiones(self) -> None:
        """02:50 CEST precede a 02:10 CET aunque su representación textual sea mayor."""
        antes = fixture.sesion(inicio="Sun Oct 25 02:50:00 CEST 2026", fin="Sun Oct 25 02:55:00 CEST 2026")
        despues = fixture.sesion(inicio="Sun Oct 25 02:10:00 CET 2026", fin="Sun Oct 25 02:15:00 CET 2026")
        for sesiones in ([antes, despues], [despues, antes]):
            edicion = {"activityId": "200", "listSessions": deepcopy(sesiones)}
            copia = deepcopy(edicion)
            datos = robot.normalizar_edicion("cibernarium:100", fixture.actividad(), edicion)["datos"]
            self.assertEqual(
                datos["fechas_publicadas"],
                {
                    "tipo": "sesiones",
                    "inicio": "2026-10-25T02:50:00+02:00",
                    "fin": "2026-10-25T02:15:00+01:00",
                },
            )
            self.assertEqual(edicion, copia)
            self.assertEqual(len(datos["sesiones"]), 2)
            self.assertAlmostEqual(datos["horas_publicadas"], 10 / 60)

    def test_fecha_civil_y_hora_sin_zona_siguen_sin_admitirse_como_instante(self) -> None:
        """La corrección de comparación no añade una zona al dato publicado."""
        for fecha in ("2026-10-25", "2026-10-25T02:10:00", "Sun Oct 25 02:10:00 2026"):
            with self.subTest(fecha=fecha), self.assertRaises(robot.ErrorRobot):
                robot.normalizar_edicion(
                    "cibernarium:100",
                    fixture.actividad(),
                    {"activityId": "200", "listSessions": [fixture.sesion(inicio=fecha)]},
                )

    def test_extremo_ausente_no_se_completa_desde_otras_sesiones(self) -> None:
        """La información parcial conserva null, sin fabricar un periodo completo."""
        sesion = fixture.sesion()
        sesion["beginDateTime"] = None
        datos = robot.normalizar_edicion(
            "cibernarium:100", fixture.actividad(), {"activityId": "200", "listSessions": [sesion, fixture.sesion()]}
        )["datos"]
        self.assertEqual(datos["fechas_publicadas"], {"tipo": None, "inicio": None, "fin": None})
        self.assertIsNone(datos["sesiones"][0]["inicio"])
        self.assertIsNone(datos["horas_publicadas"])
