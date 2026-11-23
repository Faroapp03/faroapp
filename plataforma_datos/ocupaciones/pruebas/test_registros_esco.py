"""Pruebas de la lectura de la captura de ESCO (registros_esco.py): cada control con conceptos mínimos en memoria."""

import copy
import unittest
from typing import Any

import plataforma_datos.ocupaciones.fuentes.esco.piezas.registros_esco as registros_esco
from plataforma_datos.comun.nucleo import FormatoInesperado

OCUPACION = "http://data.europa.eu/esco/occupation/o1"
COMPETENCIA = "http://data.europa.eu/esco/skill/s1"
ENTRADA = {"archivo": "pagina-1.json"}


def _ocupacion(**cambios: object) -> dict[str, Any]:
    """Construye una ocupación válida con una competencia esencial, con los campos de `cambios` sustituidos.

    Args:
        **cambios: Campos que sustituyen a los de la ocupación válida.

    Returns:
        El concepto de la ocupación.
    """
    concepto = {
        "uri": OCUPACION,
        "code": "2512.1",
        "status": "released",
        "preferredLabel": {"es": "desarrollador de software"},
        "description": {"es": {"literal": "Escribe programas.", "mimetype": "plain/text"}},
        "alternativeLabel": {"es": ["programador"]},
        "_links": {"hasEssentialSkill": [{"uri": COMPETENCIA}]},
    }
    return {**concepto, **cambios}


def _competencia(**cambios: object) -> dict[str, Any]:
    """Construye una competencia válida, esencial para la ocupación, con los campos de `cambios` sustituidos.

    Args:
        **cambios: Campos que sustituyen a los de la competencia válida.

    Returns:
        El concepto de la competencia.
    """
    concepto = {
        "uri": COMPETENCIA,
        "status": "released",
        "preferredLabel": {"es": "programar"},
        "_links": {
            "hasSkillType": {"uri": "http://data.europa.eu/esco/skill-type/skill"},
            "isEssentialForOccupation": [{"uri": OCUPACION}],
        },
    }
    return {**concepto, **cambios}


def _leer(ocupaciones: list[dict[str, Any]], competencias: list[dict[str, Any]]) -> registros_esco.LecturaDeLaCaptura:
    """Lee unos conceptos y comprueba la coherencia, como hace la preparación de ESCO.

    Args:
        ocupaciones: Los conceptos de ocupación.
        competencias: Los conceptos de competencia.

    Returns:
        La lectura, si todos los controles pasan.
    """
    total = {
        "occupation": len({concepto["uri"] for concepto in ocupaciones}),
        "skill": len({concepto["uri"] for concepto in competencias}),
    }
    lectura = registros_esco.LecturaDeLaCaptura({"version_solicitada": "v1.2.0", "total_api": total})
    for posicion, concepto in enumerate(ocupaciones, 1):
        lectura.ocupacion(copy.deepcopy(concepto), ENTRADA, posicion)
    for posicion, concepto in enumerate(competencias, 1):
        lectura.competencia(copy.deepcopy(concepto), ENTRADA, posicion)
    lectura.comprobar_coherencia()
    return lectura


class PruebaLecturaDeLaCaptura(unittest.TestCase):
    """Cada control de la lectura falla con su motivo; un par válido pasa."""

    def test_un_par_valido_pasa_con_sus_metricas(self) -> None:
        """Una ocupación y una competencia coherentes se leen; las métricas cuentan lo leído."""
        lectura = _leer([_ocupacion()], [_competencia()])
        metricas = registros_esco.metricas(lectura.datos)
        self.assertEqual((metricas["ocupaciones"], metricas["competencias"], metricas["relaciones"]), (1, 1, 1))
        self.assertEqual(registros_esco.campos_ausentes(lectura.datos)[0]["campo"], "descripcion_es")

    def test_cada_control_falla_con_su_motivo(self) -> None:
        """URI duplicada, concepto no publicado, código inválido, superior sin resolver e inversa que falta."""
        sin_inversa = _competencia(_links={"hasSkillType": {"uri": "http://data.europa.eu/esco/skill-type/skill"}})
        superior = {"hasEssentialSkill": [{"uri": COMPETENCIA}], "broaderOccupation": [{"uri": OCUPACION + "x"}]}
        casos = {
            "duplicada": ([_ocupacion(), _ocupacion(code="2512.2")], [_competencia()]),
            "no activo": ([_ocupacion(status="obsolete")], [_competencia()]),
            "código ESCO inválido": ([_ocupacion(code="25A")], [_competencia()]),
            "sin resolver": ([_ocupacion(_links=superior)], [_competencia()]),
            "inversas inconsistentes": ([_ocupacion()], [sin_inversa]),
        }
        for motivo, (ocupaciones, competencias) in casos.items():
            with self.subTest(motivo=motivo), self.assertRaisesRegex(FormatoInesperado, motivo):
                _leer(ocupaciones, competencias)

    def test_la_forma_inesperada_falla_con_motivo_y_uri(self) -> None:
        """Un concepto sin URI, un campo null o no textual o un enlace sin URI dan FormatoInesperado, no KeyError."""
        casos = {
            "sin URI": _ocupacion(uri=None),
            "preferredLabel": _ocupacion(preferredLabel=None),
            "descripción no textual": _ocupacion(description={"es": {"literal": 7}}),
            "alternativeLabel": _ocupacion(alternativeLabel=[]),
            "_links": _ocupacion(_links=None),
            "enlace sin URI": _ocupacion(_links={"hasEssentialSkill": [{"href": COMPETENCIA}]}),
        }
        for motivo, concepto in casos.items():
            with self.subTest(motivo=motivo), self.assertRaisesRegex(FormatoInesperado, motivo):
                _leer([concepto], [_competencia()])


if __name__ == "__main__":
    unittest.main()
