"""Contratos de lectura anteriores y actuales ante la misma redirección de Cibernàrium."""

import unittest
from copy import deepcopy

from plataforma_datos.cursos.fuentes.barcelonactiva import adquisicion, lectura_censo
from plataforma_datos.cursos.fuentes.barcelonactiva import robot_cibernarium as robot
from plataforma_datos.cursos.pruebas import test_cibernarium_adquisicion as rx


class VersionLecturaCenso(unittest.TestCase):
    """Contrasta los hechos completos y exige una única interpretación para todos los registros."""

    def test_versiones_sin_marca_y_lectura_actual_sin_degradacion(self) -> None:
        """Un censo firmado admite las dos variantes históricas exactas y rechaza mezclas o un retroceso declarado."""
        caso = rx.AdquisicionCibernarium()
        caso.setUp()
        self.addCleanup(caso.doCleanups)
        fichas = {
            id: rx._captura(
                caso.original,
                robot.url_ficha(id),
                b"ficha",
                id=f"cibernarium:{id}",
                url_final=robot.ORIGEN + "/formacio?activityId=" + id,
            )
            for id in ("1", "2")
        }
        doc = {**caso.doc, "fichas": fichas}

        def reproduce(dato: dict) -> bool:
            return lectura_censo.reproduce(caso.original, doc, [], dato)

        actual = adquisicion.calcular(caso.original, doc, [])
        self.assertTrue(reproduce(actual))
        sin_marca = deepcopy(actual)
        del sin_marca[lectura_censo.CAMPO]
        self.assertTrue(reproduce(sin_marca))
        sin_marca["fichas"]["1"]["lectura"]["identificada"] = False
        self.assertFalse(reproduce(sin_marca))
        sin_marca["fichas"]["2"]["lectura"]["identificada"] = False
        self.assertTrue(reproduce(sin_marca))
        self.assertFalse(reproduce({**sin_marca, lectura_censo.CAMPO: lectura_censo.VERSION}))
        self.assertFalse(reproduce({**actual, lectura_censo.CAMPO: True}))
        sin_marca["censo"]["ediciones"].pop()
        self.assertFalse(reproduce(sin_marca))
