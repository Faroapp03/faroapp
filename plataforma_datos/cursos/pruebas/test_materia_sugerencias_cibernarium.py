"""La evidencia clasificable nace de la descripción admitida, sin trasladar prosa al catálogo."""

import unittest
from copy import deepcopy
from unittest.mock import patch

from plataforma_datos.comun.huella_json import sha256_json
from plataforma_datos.cursos import materia_cibernarium as materia
from plataforma_datos.cursos import materia_sugerencias_cibernarium as sugerencias


class SugerenciasMateria(unittest.TestCase):
    """Contrasta el anclaje y la ausencia de inferencias negativas."""

    REGLAS = {
        "ia": ["inteligencia artificial", "intel ligencia artificial", "ia"],
        "datos": ["python", "programacion"],
        "seguridad": ["ciberseguridad"],
    }

    def test_objetivo_afirmativo_y_multitema(self) -> None:
        """Comprueba el caso y conserva el contrato."""
        actividad = {"description": "Aprèn Python i intel·ligència artificial.", "category": ""}
        self.assertEqual(sugerencias.sugerir(actividad, self.REGLAS), ["ia", "datos"])

    def test_negaciones_y_menciones_incidentales_no_atribuyen_materia(self) -> None:
        """Comprueba el caso y conserva el contrato."""
        actividad = {
            "description": "No cal saber Python. Descobreix internet. La ciberseguretat és important.",
            "category": "",
        }
        self.assertEqual(sugerencias.sugerir(actividad, self.REGLAS), [])
        actividad["description"] = "Aprèn sense coneixements de Python."
        self.assertEqual(sugerencias.sugerir(actividad, self.REGLAS), [])

    def test_reglas_reales_evitando_marcas_ambiguas(self) -> None:
        """Marcas aisladas y negaciones no son objetivos afirmativos de IA."""
        reglas, _ = sugerencias.leer_reglas()
        self.assertEqual(sugerencias.sugerir({"description": "Aprende la pintura de Claude Monet."}, reglas), [])
        self.assertNotIn("ia", sugerencias.sugerir({"description": "Aprende sobre la constelación Gemini."}, reglas))
        self.assertIn("ia", sugerencias.sugerir({"description": "Aprende a utilizar Google Gemini."}, reglas))
        self.assertNotIn(
            "seguridad", sugerencias.sugerir({"description": "No enseña seguridad en redes sociales."}, reglas)
        )
        self.assertIn("seguridad", sugerencias.sugerir({"description": "Aprende seguridad en redes sociales."}, reglas))

    def test_categoria_y_descripcion_vacia(self) -> None:
        """Comprueba el caso y conserva el contrato."""
        self.assertEqual(sugerencias.sugerir({"description": "", "category": "Python"}, self.REGLAS), [])
        self.assertEqual(
            sugerencias.sugerir({"description": "Benvinguda.", "category": "Ciberseguridad"}, self.REGLAS),
            ["seguridad"],
        )

    def test_la_proyeccion_exige_la_misma_huella_y_no_muta_la_evidencia(self) -> None:
        """Comprueba el caso y conserva el contrato."""
        actividad = {
            "title": "Curso",
            "description": "Aprèn Python.",
            "category": "",
            "categoryId": "1",
            "subCategoryId": "2",
        }
        huella = sha256_json([actividad[k] for k in materia.CAMPOS_CONTENIDO])
        anterior = {"id": {"contenido": {"sha256": huella}}}
        esperado = deepcopy(anterior)
        seleccion = {"id": {"actividad": actividad}}
        with (
            patch.object(materia, "_actuales", return_value=anterior),
            patch.object(materia, "_selecciones", return_value=seleccion),
            patch.object(sugerencias, "leer_reglas", return_value=(self.REGLAS, "a" * 64)),
        ):
            una = materia.actuales(object(), {"id"}, "2026-01-01T00:00:00Z")
            dos = materia.actuales(object(), {"id"}, "2026-01-01T00:00:00Z")
            self.assertEqual(una, dos)
            self.assertEqual(una["id"]["contenido"]["temas_sugeridos"], ["datos"])
            self.assertEqual(una["id"]["contenido"]["reglas_sha256"], "a" * 64)
            self.assertEqual(anterior, esperado)
            actividad["description"] = "Aprèn ciberseguretat."
            distinta = materia.actuales(object(), {"id"}, "2026-01-01T00:00:00Z")
            self.assertNotIn("temas_sugeridos", distinta["id"]["contenido"])


if __name__ == "__main__":
    unittest.main()
