"""La lengua del Course se separa del idioma de la web y de otras entidades JSON-LD."""

import json
import unittest
from types import SimpleNamespace

from plataforma_datos.cursos.fuentes.claude_academy.idioma_curso import extraer


class IdiomaAcademy(unittest.TestCase):
    """Solo el Course identificado puede aportar idioma de impartición."""

    def setUp(self) -> None:
        """Prepara un curso identificado."""
        self.url = "https://academy.claude.com/courses/introduction-to-evals"
        self.ficha = SimpleNamespace(url=self.url, titulo="Introduction to evals")
        self.curso = {
            "@type": "Course",
            "url": self.url,
            "name": self.ficha.titulo,
            "inLanguage": "en",
            "provider": {"@type": "Organization", "name": "Anthropic", "url": "https://www.anthropic.com"},
        }

    @staticmethod
    def pagina(objeto: dict) -> bytes:
        """Aísla un documento JSON-LD en HTML.

        Returns:
            Bytes de la página sintética.
        """
        return (
            '<html lang="fr"><script type="application/ld+json">' + json.dumps(objeto) + "</script></html>"
        ).encode()

    def test_solo_course_propio(self) -> None:
        """Respeta Course, nombre, URL y proveedor y no presta idiomas ajenos."""
        self.assertEqual(extraer(self.pagina(self.curso), self.ficha)["valor"], ["en"])
        for cambio in (
            {"@type": "WebPage"},
            {"@type": "Organization"},
            {"name": "Otro"},
            {"url": "https://academy.claude.com/courses/otro"},
            {"provider": {"name": "Otro"}},
        ):
            self.assertIsNone(extraer(self.pagina({**self.curso, **cambio}), self.ficha))
        self.assertIsNone(extraer(b'<html lang="en"></html>', self.ficha))

    def test_grafo_y_contradiccion(self) -> None:
        """Admite graph inequívoco y rechaza Course repetido."""
        graph = {"@graph": [{"@type": "WebPage", "inLanguage": "fr"}, self.curso]}
        self.assertEqual(extraer(self.pagina(graph), self.ficha)["valor"], ["en"])
        graph["@graph"].append({**self.curso, "inLanguage": "es"})
        self.assertIsNone(extraer(self.pagina(graph), self.ficha))

    def test_proyeccion_conserva_el_alcance_y_la_prueba(self) -> None:
        """El hecho del curso llega al productor con su propia fecha de captura."""
        from plataforma_datos.cursos.contenido_academy import TemarioAcademy, datos_para_entrega

        evidencia = {
            "url": self.url,
            "sha256": "a" * 64,
            "capturado_utc": "2026-10-20T09:00:00Z",
            "localizador": "Course/inLanguage",
        }
        ficha = SimpleNamespace(url=self.url, sha256_captura="a" * 64, capturado_utc="2026-10-20T09:00:00Z")
        actual = TemarioAcademy(
            ficha=ficha,
            cuerpo_html="",
            idioma=None,
            comprobado_el="2026-10-20T09:00:00Z",
            idioma_curso={"valor": ["en"], "alcance": "unidad", "evidencia": evidencia},
        )
        hecho = datos_para_entrega(actual, "2026-10-21T09:00:00Z")["idioma"]
        self.assertEqual(hecho["valor"], ["en"])
        self.assertEqual(hecho["vigencia"]["comprobado_el"], evidencia["capturado_utc"])
