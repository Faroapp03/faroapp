"""La admisión no reutiliza sellos tras cambiar el contrato ejecutable de canales."""

import unittest
from pathlib import Path
from unittest.mock import patch

from plataforma_datos.cursos import admision_catalogo as admision
from plataforma_datos.cursos.pruebas import test_admision_catalogo as fixtures


class AdmisionAtribucionPruebas(unittest.TestCase):
    """La alteración se simula en la lectura de huellas, nunca en archivos del producto."""

    def test_cambio_de_atribucion_exige_nueva_admision(self) -> None:
        """Una dependencia real del cargador participa en la guarda de la instantánea."""
        caso = fixtures.AdmisionCatalogoPruebas()
        caso.setUp()
        self.addCleanup(caso.doCleanups)
        admision.admitir_snapshot(caso.solicitud)
        sha = admision._sha

        def sustituida(ruta: Path) -> str:
            return "0" * 64 if ruta.name == "atribucion_temporal.py" else sha(ruta)

        with patch.object(admision, "_sha", side_effect=sustituida), self.assertRaises(admision.ErrorAdmisionCatalogo):
            caso.exigir()
