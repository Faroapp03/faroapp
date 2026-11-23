"""La categoría de la actividad se atribuye solo al material vinculado."""

import unittest

from plataforma_datos.cursos.fuentes.cibervoluntarios.lector import CapturaCiber, MaterialCiber
from plataforma_datos.cursos.fuentes.cibervoluntarios.nivel_actividad import extraer


class NivelActividad(unittest.TestCase):
    """Conserva identidad, fecha y localizador de la actividad."""

    def test_nivel_y_material(self) -> None:
        """Una actividad disponible da su nivel, no una certificación del alumno."""
        cap = CapturaCiber(
            url="https://www.cibervoluntarios.org/api/public/activity_catalogs?lang=es",
            sha256="a" * 64,
            bytes_cuerpo=123,
            inicio_utc="2026-11-18T09:00:00Z",
            recibido_utc="2026-11-18T09:01:00Z",
            http=200,
            completo=True,
            localizador="/",
        )
        material = MaterialCiber(
            id=42,
            actividad_id=7,
            tipo_actividad="Taller",
            tipo_material="Autoformación",
            idioma_publicado="Español",
            slug="curso",
            titulo="Curso",
            actividad_publicada={"status": "Disponible", "level": "Avanzado"},
            material_publicado={"status": "Disponible", "erased": False},
            captura=cap,
            localizador="/hydra:member/3/activityCatalogMaterials/1",
        )
        nivel = extraer(material)
        self.assertIsNotNone(nivel)
        self.assertEqual(nivel["valor"], "avanzado")
        self.assertEqual(nivel["material_id"], "42")
        self.assertEqual(nivel["actividad_id"], "7")
        self.assertEqual(nivel["localizador"], "/hydra:member/3/level")
        self.assertIsNone(
            extraer(MaterialCiber(**{**material.__dict__, "actividad_publicada": {"level": "No indicado"}}))
        )
