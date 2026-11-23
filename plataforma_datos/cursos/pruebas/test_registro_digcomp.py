"""Contraste de identidades y escalas del registro con publicaciones completas y alteradas."""

import unittest
from copy import deepcopy

from plataforma_datos.comun.nucleo import FormatoInesperado
from plataforma_datos.cursos.contrato_aprendizaje import cargar_registro, validar_registro
from plataforma_datos.cursos.fuentes.formacion.registro_aprendizaje import registro_desde_marco


# El grafo es sintético; su cobertura representa el contrato del suplemento, no cursos reales.
def marco_sintetico() -> dict:
    """Construye un marco con las tres escalas separadas y resultados identificados.

    Returns:
        Competencias, resultados y niveles de prueba.
    """
    competencias = [
        {"id": f"Competence/{area}.{n}", "titulo": f"Competencia {area}.{n}"}
        for area, total in ((1, 3), (2, 6), (3, 4), (4, 4), (5, 4))
        for n in range(1, total + 1)
    ]
    cuatro = (
        "Basic",
        "Basic",
        "Intermediate",
        "Intermediate",
        "Advanced",
        "Advanced",
        "Highly advanced",
        "Highly advanced",
    )
    seis = ("A1", "A2", "B1", "B2", "C1", "C1", "C2", "C2")
    return {
        "competencias": competencias,
        "niveles": [
            {
                "id": f"ProficiencyLevel/{c}_{i}",
                "nivel_cuatro": c,
                "nivel_ocho": i,
                "nivel_seis": s,
                "descripcion_cuatro": f"Descripción {c}",
                "descripcion_ocho": f"Descripción {i}",
                "alcance": "Prueba",
            }
            for i, (c, s) in enumerate(zip(cuatro, seis, strict=True), start=1)
        ],
        "resultados": [
            {
                "id": f"LearningOutcome/{i}",
                "competencia": "Competence/1.2",
                "tipo": "Skill",
                "texto": f"Resultado sintético {i}",
                "nivel": "ProficiencyLevel/Basic",
            }
            for i in range(500)
        ],
    }


def grafo_sintetico() -> dict:
    """Publica el marco sintético en la forma de entrada del lector real.

    Returns:
        Grafo JSON-LD sin afirmaciones de cursos.
    """
    marco = marco_sintetico()
    return {
        "@graph": [
            *[{"@type": "Competence", "@id": c["id"], "name": c["titulo"]} for c in marco["competencias"]],
            *[
                {
                    "@type": "ProficiencyLevel",
                    "@id": n["id"],
                    "four_levels_name": n["nivel_cuatro"],
                    "eight_levels_mapping": n["nivel_ocho"],
                    "six_levels_mapping": n["nivel_seis"],
                    "four_levels_description": n["descripcion_cuatro"],
                    "eight_levels_description": n["descripcion_ocho"],
                    "applies_to": n["alcance"],
                }
                for n in marco["niveles"]
            ],
            *[
                {
                    "@type": "LearningOutcome",
                    "@id": r["id"],
                    "description": r["texto"],
                    "type": r["tipo"],
                    "competence_id": r["competencia"],
                    "four_levels_proficiency_name": r["nivel"],
                }
                for r in marco["resultados"]
            ],
        ]
    }


PROCEDENCIA = {
    "archivo": "digcomp-3.0.jsonld",
    "sha256": "a" * 64,
    "url": "https://jeodpp.jrc.ec.europa.eu/ftp/jrc-opendata/DIGCOMP/DIGCOMP3.0/",
}


class RegistroDigcomp(unittest.TestCase):
    """No confunde una competencia del marco con aprendizaje acreditado por un curso."""

    def test_identidades_completas_orden_estable_y_sin_mutacion(self) -> None:
        """Reordenar nodos no cambia el registro; no se modifica la fuente."""
        marco = marco_sintetico()
        anterior = deepcopy(marco)
        registro = registro_desde_marco(marco, PROCEDENCIA)
        self.assertEqual(marco, anterior)
        marco["competencias"].reverse()
        marco["niveles"].reverse()
        marco["resultados"].reverse()
        self.assertEqual(registro_desde_marco(marco, PROCEDENCIA), registro)
        validar_registro(registro)
        self.assertEqual(registro["escalas"][0]["valores"], ["Basic", "Intermediate", "Advanced", "Highly advanced"])
        self.assertNotIn("cursos", registro)

    def test_cada_relacion_y_escala_debe_estar_justificada(self) -> None:
        """No basta conservar el número de filas para admitir otro significado."""
        casos = [
            ("competencias", 0, "id", "Competence/9.1"),
            ("competencias", 0, "id", []),
            ("competencias", 0, "titulo", None),
            ("niveles", 0, "nivel_ocho", 2),
            ("niveles", 0, "nivel_ocho", True),
            ("niveles", 0, "nivel_ocho", []),
            ("niveles", 0, "nivel_seis", "C2"),
            ("niveles", 0, "nivel_cuatro", "Advanced"),
            ("niveles", 0, "descripcion_cuatro", "Otra definición"),
            ("resultados", 0, "id", "LearningOutcome/1"),
            ("resultados", 0, "nivel", None),
            ("resultados", 0, "competencia", "Competence/9.1"),
            ("resultados", 0, "tipo", "LearningOutcome"),
        ]
        for grupo, indice, campo, valor in casos:
            with self.subTest(grupo=grupo, campo=campo, valor=valor):
                marco = marco_sintetico()
                marco[grupo][indice][campo] = valor
                with self.assertRaises(FormatoInesperado):
                    registro_desde_marco(marco, PROCEDENCIA)

    def test_entrada_incompleta_o_otra_procedencia_se_rechaza(self) -> None:
        """Un grafo truncado o atribuido a otro documento no genera vocabulario."""
        for grupo in ("competencias", "niveles", "resultados"):
            marco = marco_sintetico()
            marco[grupo].pop()
            with self.subTest(grupo=grupo), self.assertRaises(FormatoInesperado):
                registro_desde_marco(marco, PROCEDENCIA)
        for cambio in ({"archivo": "otro.jsonld"}, {"url": "https://example.org/"}, {"sha256": ""}):
            with self.subTest(cambio=cambio), self.assertRaises(FormatoInesperado):
                registro_desde_marco(marco_sintetico(), {**PROCEDENCIA, **cambio})

    def test_el_registro_instalado_identifica_el_marco_y_su_captura(self) -> None:
        """El vocabulario identifica una edición; no contiene correspondencias inventadas."""
        registro, huella = cargar_registro()
        self.assertEqual(len(huella), 64)
        self.assertEqual(len(registro["competencias"]), 21)
        self.assertTrue(all(c["marco"] == "DigComp" and c["version"] == "3.0" for c in registro["competencias"]))
        self.assertTrue(all("sha256:" in c["fuente"] for c in registro["competencias"]))
        self.assertEqual([e["id"] for e in registro["escalas"]], ["digcomp-four-levels"])
