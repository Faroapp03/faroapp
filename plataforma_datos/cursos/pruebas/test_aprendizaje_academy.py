"""Dos fichas Academy: objetivos literales, condiciones y abstención por soporte cambiado."""

import copy
import hashlib
import html
import json
import unittest
from dataclasses import replace

from plataforma_datos.comun.huella_json import sha256_json
from plataforma_datos.cursos.aprendizaje_entrega import BloquesDeAprendizaje, generar_companero
from plataforma_datos.cursos.contenido_academy import TemarioAcademy
from plataforma_datos.cursos.fuentes.claude_academy import lector
from plataforma_datos.cursos.pruebas.test_acceso_publico_academy import captura
from plataforma_datos.cursos.pruebas.test_aprendizaje_entrega import RAIZ


class AprendizajeAcademyPruebas(unittest.TestCase):
    """No atribuye nivel, etapa completa, acceso personal ni coste de prácticas."""

    def setUp(self) -> None:
        """Construye bloques sintéticos a partir de la definición editorial versionada."""
        self.definicion = json.loads((RAIZ / "config/formacion/aprendizaje-revisado.json").read_bytes())
        self.definicion["fichas"] = [
            f
            for f in self.definicion["fichas"]
            if f["programa_id"] in {"claude-academy:claude-101", "claude-academy:introduction-to-claude-tag"}
        ]
        self.definicion["caminos"] = []
        self.cuerpos = {}
        for ficha in self.definicion["fichas"]:
            objetivos = [a for a in ficha["aprendizaje"]["afirmaciones"] if a["dimension"] == "resultado_previsto"]
            requisitos = [a for a in ficha["aprendizaje"]["afirmaciones"] if a["dimension"] == "requisito_entrada"]
            cuerpo = "<h1>Curso de prueba</h1><h2>Learning objectives</h2><p>By the end of this course:</p><ul>"
            cuerpo += "".join("<li>" + html.escape(a["evidencias"][0]["fragmento"]) + "</li>" for a in objetivos)
            cuerpo += "</ul><h2>Prerequisites</h2><ul>"
            cuerpo += "".join("<li>" + html.escape(a["evidencias"][0]["fragmento"]) + "</li>" for a in requisitos)
            cuerpo += "</ul><h2>Other information</h2><p>Logistics.</p>"
            identidad = ficha["programa_id"]
            self.cuerpos[identidad] = cuerpo
            bloques = BloquesDeAprendizaje("https://academy.claude.com/courses/" + identidad.split(":")[1])
            bloques.feed("<main>" + cuerpo + "</main>")
            bloques.close()
            ficha["firmas_semanticas"] = {
                a["id"]: [bloques.firmas[bloques.bloques.index(e["fragmento"])] for e in a["evidencias"]]
                for a in ficha["aprendizaje"]["afirmaciones"]
            }

    def actual(self, identidad: str, cuerpo: str | None = None) -> TemarioAcademy:
        """Reextrae una captura completa sintética con identidad exacta.

        Returns:
            Temario que conserva idioma de ficha y todos los bloques del lector.
        """
        url = "https://academy.claude.com/courses/" + identidad.split(":")[1]
        raw, meta = captura(url, "Curso de prueba · Claude Academy", cuerpo or self.cuerpos[identidad])
        raw = raw.replace(b"<html>", b'<html lang="en">')
        meta.update(bytes=len(raw), sha256=hashlib.sha256(raw).hexdigest())
        ficha = lector.extraer_ficha(raw, meta, url_esperada=url)
        return TemarioAcademy(ficha=ficha, cuerpo_html=raw.decode(), idioma="en")

    def generar(self, actual: TemarioAcademy | None = None) -> dict:
        """Usa el contrato público real con referencias de las capturas elegidas.

        Returns:
            Compañero ligado a esos bytes, sin cambiar su definición editorial.
        """
        contenidos = {f["programa_id"]: self.actual(f["programa_id"]) for f in self.definicion["fichas"]}
        if actual is not None:
            contenidos["claude-academy:claude-101"] = actual
        publico = json.loads((RAIZ / "pruebas/fixtures/catalogo-cursos-publico.utf8").read_bytes())
        modelo = publico["ofertas"][0]
        ofertas = []
        for identidad, contenido in contenidos.items():
            oferta = copy.deepcopy(modelo)
            oferta["unidad"] = {"id": identidad, "programa_id": identidad, "tipo": "recurso"}
            oferta["referencias"] = [
                {
                    "url": contenido.ficha.url,
                    "sha256": contenido.ficha.sha256_captura,
                    "fecha_referencia": contenido.ficha.capturado_utc,
                    "alcance": "entidad",
                    "naturaleza_fecha": "recepcion_conservada",
                    "naturaleza_documento": "no_acreditada",
                }
            ]
            ofertas.append(oferta)
        publico["ofertas"] = ofertas
        publico["cobertura"] = {"recurso": len(ofertas), "edicion": 0}
        publico["revision"] = sha256_json({k: v for k, v in publico.items() if k != "revision"})
        return generar_companero(json.dumps(publico).encode(), contenidos, self.definicion)

    def test_objetivos_condiciones_e_idioma_sin_inferir_niveles(self) -> None:
        """Las condiciones conservan plan, workspace, roles y sus matices literales."""
        fichas = self.generar()["fichas"]
        self.assertEqual(len(fichas), 2)
        for ficha in fichas:
            self.assertEqual(ficha["idioma_ficha"], "en")
            self.assertEqual(ficha["requisitos"], "publicados")
            self.assertEqual(len(ficha["aprendizaje"]["afirmaciones"]), 9)
            self.assertTrue(
                all(
                    a["competencia"] is None and a["nivel"] == {"escala": None, "valor": None}
                    for a in ficha["aprendizaje"]["afirmaciones"]
                )
            )
        textos = json.dumps(fichas)
        for literal in ("paid plan", "workspace", "certain roles", "Helpful, not required"):
            self.assertIn(literal, textos)
        self.assertFalse(
            any(c["criterio"] in {"caso_complejo", "procedimiento_verificable"} for f in fichas for c in f["cobertura"])
        )

    def test_objetivo_cambiado_retiene_su_cobertura_y_conserva_los_demas(self) -> None:
        """Un resultado distinto no reutiliza el soporte literal de la captura anterior."""
        id = "claude-academy:claude-101"
        salida = self.generar(self.actual(id, self.cuerpos[id].replace("Write clear prompts", "Do a different task")))
        ficha = salida["fichas"][0]
        self.assertEqual(len(ficha["aprendizaje"]["afirmaciones"]), 8)
        self.assertEqual([c["criterio"] for c in ficha["cobertura"]], ["tarea_sencilla"])

    def test_contexto_ajeno_o_negado_no_acredita_objetivos(self) -> None:
        """Ni una entidad ajena ni un contexto negado conserva las afirmaciones."""
        id = "claude-academy:claude-101"
        for cuerpo in (
            self.cuerpos[id].replace("Learning objectives", "Objectives NOT covered"),
            '<section itemid="https://example.test/otro">' + self.cuerpos[id] + "</section>",
        ):
            with self.subTest(cuerpo=cuerpo):
                ficha = self.generar(self.actual(id, cuerpo))["fichas"][0]
                self.assertEqual(ficha["cobertura"], [])

    def test_identidad_distinta_abstiene_sin_buscar_otra_captura(self) -> None:
        """La coincidencia de texto no presta objetivos entre programas."""
        original = self.actual("claude-academy:claude-101")
        otro = replace(original, ficha=replace(original.ficha, id="otro"))
        ficha = self.generar(otro)["fichas"][0]
        self.assertFalse(ficha["aprendizaje"]["contenido_observado"])
        self.assertEqual(ficha["aprendizaje"]["afirmaciones"], [])
        self.assertEqual(ficha["requisitos"], "sin_verificar")

    def test_localizador_ausente_o_ambiguo_retiene_afirmacion_sin_stopiteration(self) -> None:
        """Un bloque sin pareja exacta en el lector no toma un localizador conveniente."""
        id = "claude-academy:claude-101"
        actual = self.actual(id)
        texto = self.definicion["fichas"][0]["aprendizaje"]["afirmaciones"][1]["evidencias"][0]["fragmento"]
        original = next(b for b in actual.ficha.bloques if b.tipo == "li" and b.texto == texto)
        sin = tuple(b for b in actual.ficha.bloques if b.texto != texto)
        duplicado = original._replace(localizador="/otra-entidad " + original.localizador)
        for bloques in (sin, (*actual.ficha.bloques, duplicado)):
            with self.subTest(bloques=bloques):
                alterada = replace(actual, ficha=replace(actual.ficha, bloques=bloques))
                ficha = self.generar(alterada)["fichas"][0]
                self.assertEqual([c["criterio"] for c in ficha["cobertura"]], ["tarea_sencilla"])
                self.assertEqual(len(ficha["aprendizaje"]["afirmaciones"]), 8)

    def test_texto_repetido_en_otro_contexto_no_presta_su_localizador(self) -> None:
        """La posición del bloque contextual, no el primer texto igual, decide el vínculo."""
        id = "claude-academy:claude-101"
        texto = self.definicion["fichas"][0]["aprendizaje"]["afirmaciones"][1]["evidencias"][0]["fragmento"]
        ajeno = "<h2>Unrelated note</h2><ul><li>" + html.escape(texto) + "</li></ul>"
        cuerpo = self.cuerpos[id].replace("<h2>Learning objectives", ajeno + "<h2>Learning objectives")
        actual = self.actual(id, cuerpo)
        posiciones = [b for b in actual.ficha.bloques if b.tipo == "li" and b.texto == texto]
        self.assertEqual(len(posiciones), 2)
        ficha = self.generar(actual)["fichas"][0]
        afirmacion = next(a for a in ficha["aprendizaje"]["afirmaciones"] if a["id"] == "claude-101-objetivo-2")
        self.assertEqual(afirmacion["evidencias"][0]["localizador"]["valor"], posiciones[1].localizador)

    def test_nuevo_requisito_obliga_a_revisar_aunque_objetivos_sigan_iguales(self) -> None:
        """No basta conservar las condiciones conocidas si el proveedor añade otra."""
        id = "claude-academy:claude-101"
        cuerpo = self.cuerpos[id].replace(
            "</ul><h2>Other information", "<li>Professional experience is required.</li></ul><h2>Other information"
        )
        ficha = self.generar(self.actual(id, cuerpo))["fichas"][0]
        self.assertEqual(len(ficha["cobertura"]), 2)
        self.assertEqual(ficha["requisitos"], "sin_verificar")

    def test_renovar_solo_fecha_conserva_revision_y_todos_los_bloques(self) -> None:
        """Una fecha técnica nueva cambia el vínculo, no la revisión editorial."""
        original = self.actual("claude-academy:claude-101")
        nuevo = replace(original, ficha=replace(original.ficha, capturado_utc="2026-10-23T11:00:00Z"))
        ficha = self.generar(nuevo)["fichas"][0]
        self.assertEqual(len(ficha["aprendizaje"]["afirmaciones"]), 9)
        self.assertEqual(ficha["revision"], self.definicion["fichas"][0]["revision"])
        self.assertTrue(
            all(
                e["capturado_utc"] == nuevo.ficha.capturado_utc
                for a in ficha["aprendizaje"]["afirmaciones"]
                for e in a["evidencias"]
            )
        )


if __name__ == "__main__":
    unittest.main()
