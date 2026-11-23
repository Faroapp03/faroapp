"""Compromisos editoriales de temarios admitidos; no crea observaciones ni niveles."""

import copy
import json
import unittest
from dataclasses import replace

from plataforma_datos.cursos import aprendizaje_ciber as ciber
from plataforma_datos.cursos.aprendizaje_entrega import _ficha_actual, _validar_definicion
from plataforma_datos.cursos.contrato_aprendizaje import cargar_registro
from plataforma_datos.cursos.pruebas.test_aprendizaje_entrega import RAIZ

CIBER_FORENSE = "cibervoluntarios:material:10059787708"


class RevisionAprendizajeAmpliadoPruebas(unittest.TestCase):
    """Las coberturas tienen apoyos y mantienen todas sus condiciones publicadas."""

    def setUp(self) -> None:
        """Lee la definición que publica el generador común."""
        self.definicion = json.loads((RAIZ / "config/formacion/aprendizaje-revisado.json").read_bytes())
        self.fichas = {f["programa_id"]: f for f in self.definicion["fichas"]}

    def test_seis_academy_con_requisitos_y_sin_nivel_inferido(self) -> None:
        """No pierde restricciones de práctica tras añadir los cursos técnicos."""
        registro, sha = cargar_registro()
        _validar_definicion(self.definicion, registro, sha)
        for slug in (
            "claude-101",
            "introduction-to-claude-tag",
            "ai-capabilities-and-limitations",
            "ai-native-sdlc-playbook",
            "claude-code-101",
            "claude-platform-101",
        ):
            ficha = self.fichas["claude-academy:" + slug]
            self.assertEqual(ficha["requisitos"], "publicados")
            self.assertTrue(any(a["dimension"] == "requisito_entrada" for a in ficha["aprendizaje"]["afirmaciones"]))
        textos = json.dumps(self.definicion, ensure_ascii=False)
        for literal in (
            "certain roles",
            "Git repository and CI pipeline you are allowed to change",
            "Pro, Max, Team, or Enterprise",
            "After that, you add credit under Settings > Billing",
        ):
            self.assertIn(literal, textos)
        self.assertTrue(
            all(
                a["nivel"] == {"escala": None, "valor": None} and a["competencia"] is None
                for f in self.fichas.values()
                for a in f["aprendizaje"]["afirmaciones"]
            )
        )

    def test_descripcion_no_presenta_icono_pero_conserva_el_fragmento_literal(self) -> None:
        """El icono decorativo HTML no es texto del informe ni se pierde como evidencia."""
        iconos_conservados = []
        for ficha in self.fichas.values():
            for afirmacion in ficha["aprendizaje"]["afirmaciones"]:
                descripcion = afirmacion["descripcion"]
                self.assertNotIn("\ue02a", descripcion or "")
                for evidencia in afirmacion["evidencias"]:
                    fragmento = evidencia["fragmento"]
                    if fragmento.startswith("\ue02a"):
                        self.assertEqual(descripcion, fragmento.removeprefix("\ue02a").lstrip())
                        iconos_conservados.append(afirmacion["id"])
        self.assertTrue(iconos_conservados)

    def test_conceptos_hp_no_se_convierten_en_tarea_practica(self) -> None:
        """Ciencia de datos y estrategia conservan objetivos sin forzar una etapa."""
        for id in ("hp-life:355:es", "hp-life:452:es"):
            self.assertTrue(self.fichas[id]["aprendizaje"]["afirmaciones"])
            self.assertEqual(self.fichas[id]["cobertura"], [])

    def test_caso_complejo_es_verificacion_con_limites_y_condicion_previa(self) -> None:
        """La vía no exige programar y no se deduce del título del curso."""
        ficha = self.fichas[CIBER_FORENSE]
        coberturas = {c["criterio"]: c for c in ficha["cobertura"]}
        self.assertEqual(coberturas["caso_complejo"]["via"], "verificacion_rigurosa")
        textos = [a["descripcion"] for a in ficha["aprendizaje"]["afirmaciones"]]
        self.assertTrue(any("falsos positivos" in t for t in textos))
        self.assertTrue(any("flujos secuenciales" in t for t in textos))
        self.assertTrue(
            any(
                a["dimension"] == "requisito_entrada"
                and "Ya conoces lo básico sobre desinformación" in a["descripcion"]
                for a in ficha["aprendizaje"]["afirmaciones"]
            )
        )

    def test_falta_un_apoyo_no_conserva_caso_complejo_ni_procedimiento(self) -> None:
        """La configuración real no da cobertura avanzada si desaparece el protocolo."""
        ficha = self.fichas[CIBER_FORENSE]
        bloques = []
        for a in ficha["aprendizaje"]["afirmaciones"]:
            for e, firma in zip(a["evidencias"], ficha["firmas_semanticas"][a["id"]], strict=True):
                bloques.append(
                    ciber.BloqueCiber(
                        texto=e["fragmento"],
                        firma=firma,
                        evidencia={
                            **{k: v for k, v in e.items() if k not in {"localizador", "fragmento"}},
                            "localizador": e["localizador"]["valor"],
                        },
                    )
                )
        actual = ciber.TemarioCiber(
            programa_id=CIBER_FORENSE,
            idioma="es",
            bloques=tuple(bloques),
            contexto_condiciones_sha256=ficha["contexto_condiciones_sha256"],
        )
        self.assertEqual(_ficha_actual(ficha, actual)["cobertura"], ficha["cobertura"])
        sin = replace(actual, bloques=tuple(b for b in bloques if "flujos secuenciales" not in b.texto))
        salida = _ficha_actual(ficha, sin)
        self.assertEqual([c["criterio"] for c in salida["cobertura"]], ["fuentes_y_limites"])
        modificada = copy.deepcopy(ficha)
        modificada["programa_id"] = "cibervoluntarios:material:otro"
        self.assertEqual(_ficha_actual(modificada, actual)["cobertura"], [])


if __name__ == "__main__":
    unittest.main()
