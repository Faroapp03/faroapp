"""Los niveles publicados conservan identidad y relaciones al preparar el marco."""

import unittest

from plataforma_datos.cursos.fuentes.formacion.marco_digcomp import digcomp


class NivelesDigcomp(unittest.TestCase):
    """Impide perder la escala de un resultado o convertirla en nivel de un curso."""

    def test_conserva_nivel_oficial_del_resultado(self) -> None:
        """El resultado identifica su escala de cuatro niveles sin inferir otro valor."""
        marco = digcomp(
            {
                "@graph": [
                    {
                        "@type": "LearningOutcome",
                        "@id": "LearningOutcome/LO1.2.01",
                        "description": "Evaluate the reliability of a source.",
                        "type": "Skill",
                        "competence_id": "Competence/1.2",
                        "ai_label": "AI-Explicit",
                        "four_levels_proficiency_name": "ProficiencyLevel/Intermediate",
                    }
                ]
            }
        )
        self.assertEqual(marco["resultados"][0]["nivel"], "ProficiencyLevel/Intermediate")

    def test_conserva_escalas_sin_confundirlas(self) -> None:
        """Los niveles de cuatro, seis y ocho tramos conservan su significado propio."""
        nivel = {
            "@type": "ProficiencyLevel",
            "@id": "ProficiencyLevel/Advanced_6",
            "four_levels_name": "Advanced",
            "eight_levels_mapping": 6,
            "six_levels_mapping": "C1",
            "four_levels_description": "Complex tasks autonomously.",
            "eight_levels_description": "Guide others on complex tasks.",
            "applies_to": "Working goals.",
        }
        marco = digcomp({"@graph": [nivel]})
        self.assertEqual(
            marco["niveles"],
            [
                {
                    "id": nivel["@id"],
                    "nivel_cuatro": "Advanced",
                    "nivel_ocho": 6,
                    "nivel_seis": "C1",
                    "descripcion_cuatro": nivel["four_levels_description"],
                    "descripcion_ocho": nivel["eight_levels_description"],
                    "alcance": nivel["applies_to"],
                }
            ],
        )
        self.assertEqual(nivel["eight_levels_mapping"], 6)

    def test_ausencia_no_inventa_nivel(self) -> None:
        """Un resultado sin relación permanece desconocido y una escala ausente, vacía."""
        marco = digcomp({"@graph": [{"@type": "LearningOutcome", "@id": "LearningOutcome/1"}]})
        self.assertIsNone(marco["resultados"][0]["nivel"])
        self.assertEqual(marco["niveles"], [])
