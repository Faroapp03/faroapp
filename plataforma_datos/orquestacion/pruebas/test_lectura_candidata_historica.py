"""Los estados históricos se leen sin volver a abrir el registro operativo."""

import unittest
from copy import deepcopy

from plataforma_datos.orquestacion.contrato_comprobaciones_panel import validar_catalogo_panel


class LecturaCandidataHistoricaPruebas(unittest.TestCase):
    """La modalidad histórica se conserva y no permite inventar fuentes operativas."""

    def test_catalogo_conserva_lectura_candidata_y_rechaza_cambio_de_modalidad(self) -> None:
        """La comprobación no altera la evidencia del estado."""
        snapshot = {
            "fuentes": [{"id": "activa"}],
            "catalogoFuentes": [
                {"id": "activa", "nombre": "Fuente activa", "tema": "comun", "modalidad": "operativa"},
                {"id": "pasada", "nombre": "Lectura anterior", "tema": "cursos", "modalidad": "lectura-candidata"},
            ],
        }
        antes = deepcopy(snapshot)
        validar_catalogo_panel(snapshot)
        self.assertEqual(snapshot, antes)
        snapshot["catalogoFuentes"][1]["modalidad"] = "operativa"
        with self.assertRaises(ValueError):
            validar_catalogo_panel(snapshot)
