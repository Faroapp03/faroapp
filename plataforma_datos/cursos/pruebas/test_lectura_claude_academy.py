"""Fichas Academy sintéticas: integridad, identidad y texto completo sin capturas externas en Git."""

import hashlib
import unittest
from dataclasses import FrozenInstanceError

from plataforma_datos.cursos.fuentes.claude_academy.lector import ErrorFichaAcademy, extraer_ficha

URL = "https://academy.claude.com/courses/curso-ejemplo"
FECHA = "2026-10-22T16:00:00+00:00"


def pagina(contenido: str) -> bytes:
    """Envuelve contenido ficticio en la identidad mínima de una ficha Academy.

    Returns:
        HTML UTF-8 propio, sin copiar textos completos de cursos publicados.
    """
    return (
        "<!doctype html><html><head><title>Curso de ejemplo · Claude Academy</title>"
        f'<link rel="canonical" href="{URL}"><meta property="og:url" content="{URL}">'
        '<meta name="academy-prerender-path" content="/courses/curso-ejemplo">'
        "</head><body><nav>No forma parte de la ficha</nav><main><h1>Curso de ejemplo</h1>"
        + contenido
        + "</main><footer>Otro contenido externo</footer></body></html>"
    ).encode()


def metadatos(cuerpo: bytes) -> dict[str, object]:
    """Declara la captura sintética comprobable sin reloj ni red.

    Returns:
        Tamaño, huella, URL e instante ligados al cuerpo recibido.
    """
    return {
        "url_solicitada": URL,
        "url_final": URL,
        "http": 200,
        "completo": True,
        "bytes": len(cuerpo),
        "sha256": hashlib.sha256(cuerpo).hexdigest(),
        "archivo": "curso-ejemplo.html.body",
        "recibido_utc": FECHA,
    }


class PruebaFichaAcademy(unittest.TestCase):
    """La ausencia de un campo interpretado no se convierte en un hecho negativo."""

    def test_requisitos_incluyen_inline_y_todos_los_parrafos(self) -> None:
        """Reproduce fielmente el corte previo ante enlaces y elementos anidados."""
        cuerpo = pagina(
            '<h2 id="recommended-prerequisites"><strong>Recommended prerequisites</strong></h2>'
            '<p>Participants should complete <a href="/courses/base"><em>Base Sample</em></a> before starting.</p>'
            "<p>A tool is recommended; <strong>any <code>assistant</code></strong> works.</p>"
            "<h2>Another section</h2><p>Later material.</p>"
        )
        ficha = extraer_ficha(cuerpo, metadatos(cuerpo), url_esperada=URL)
        self.assertIsNotNone(ficha.requisitos)
        texto = ficha.requisitos[0].texto
        self.assertEqual(
            texto,
            "Participants should complete Base Sample before starting.\nA tool is recommended; any assistant works.",
        )
        self.assertNotIn("Later material", texto)
        self.assertEqual(ficha.enlaces[0].texto, "Base Sample")
        self.assertEqual(ficha.enlaces[0].href, "/courses/base")
        self.assertIn("#recommended-prerequisites", ficha.requisitos[0].localizador)
        self.assertEqual(ficha.requisitos[0].sha256_texto, hashlib.sha256(texto.encode()).hexdigest())

    def test_requisitos_del_articulo_no_absorben_indice_de_curso(self) -> None:
        """El último apartado termina en su artículo, conservando el índice como contenido."""
        cuerpo = pagina(
            '<article><h2 id="prerequisites">Prerequisites</h2>'
            "<p>A repository and CI pipeline you are allowed to change.</p></article>"
            '<nav aria-label="Course outline"><ul><li>Introduction</li><li>Hooks as approval gates</li></ul></nav>'
        )
        ficha = extraer_ficha(cuerpo, metadatos(cuerpo), url_esperada=URL)
        self.assertEqual(ficha.requisitos[0].texto, "A repository and CI pipeline you are allowed to change.")
        self.assertIn("Hooks as approval gates", ficha.contenido)
        self.assertIn("#prerequisites", ficha.requisitos[0].localizador)

    def test_articulo_anidado_delimita_su_ultimo_apartado(self) -> None:
        """No toma una lista hermana como requisito de una sección interior."""
        cuerpo = pagina(
            "<article><article><h2>Prerequisites</h2><p>A tool account.</p></article>"
            "<ul><li>Course quiz</li></ul></article>"
        )
        ficha = extraer_ficha(cuerpo, metadatos(cuerpo), url_esperada=URL)
        self.assertEqual(ficha.requisitos[0].texto, "A tool account.")
        self.assertIn("Course quiz", ficha.contenido)

    def test_destinatarios_separados_y_subseccion_completa(self) -> None:
        """La sección incluye listas y subtítulos hasta el siguiente encabezado de igual nivel."""
        cuerpo = pagina(
            "<h2>Who this course is for</h2><p>Practitioners.</p>"
            "<h3>Groups</h3><ul><li>Group <strong>A</strong>.</li><li>Group B.</li></ul>"
            "<h2>Prerequisites</h2><p>Read the guide.</p>"
        )
        ficha = extraer_ficha(cuerpo, metadatos(cuerpo), url_esperada=URL)
        self.assertIn("Group A.", ficha.destinatarios[0].texto)
        self.assertIn("Group B.", ficha.destinatarios[0].texto)
        self.assertNotIn("Read the guide", ficha.destinatarios[0].texto)
        self.assertEqual(ficha.requisitos[0].texto, "Read the guide.")

    def test_parrafos_sin_encabezado_se_retienen_en_orden(self) -> None:
        """No se pierden introducciones ni frases finales por carecer de un título."""
        cuerpo = pagina(
            "<p>First <strong>complete</strong> statement.</p>"
            "<p>This course is designed for makers.</p><div>Untitled final text.</div>"
        )
        ficha = extraer_ficha(cuerpo, metadatos(cuerpo), url_esperada=URL)
        self.assertIn("First complete statement.", ficha.contenido)
        self.assertIn("Untitled final text.", ficha.contenido)
        self.assertLess(ficha.contenido.index("First complete"), ficha.contenido.index("Untitled final"))
        self.assertEqual(ficha.destinatarios[0].texto, "This course is designed for makers.")
        self.assertIsNone(ficha.requisitos)

    def test_ausencia_es_desconocida_y_no_comparte_licencia(self) -> None:
        """No se fabrica no-requisitos ni independencia de marca o licencia general."""
        cuerpo = pagina("<p>A general introduction to the lesson.</p>")
        ficha = extraer_ficha(cuerpo, metadatos(cuerpo), url_esperada=URL)
        self.assertIsNone(ficha.destinatarios)
        self.assertIsNone(ficha.requisitos)
        self.assertFalse(hasattr(ficha, "sin_requisitos"))
        self.assertFalse(hasattr(ficha, "dependencia_marca"))
        self.assertFalse(hasattr(ficha, "licencia"))

    def test_destinatarios_de_la_presentacion_del_curso(self) -> None:
        """Un público que realiza la actividad formativa queda ligado al párrafo íntegro."""
        textos = (
            "This course helps builders develop new skills. Further details follow.",
            "This course empowers faculty, instructional designers, and educational leaders to apply these methods.",
            "This course helps nonprofit staff—whether in operations or management—build practical skills.",
            "This Train the Trainer course prepares pK–12 educators to facilitate workshops for other teachers.",
        )
        for texto in textos:
            with self.subTest(texto=texto):
                cuerpo = pagina(f"<article><p>{texto}</p></article>")
                ficha = extraer_ficha(cuerpo, metadatos(cuerpo), url_esperada=URL)
                self.assertIsNotNone(ficha.destinatarios)
                self.assertEqual([e.texto for e in ficha.destinatarios], [texto])
                self.assertIn("/article[1]/p[1]", ficha.destinatarios[0].localizador)
                self.assertEqual(ficha.destinatarios[0].sha256_texto, hashlib.sha256(texto.encode()).hexdigest())
                self.assertIsNone(ficha.requisitos)

    def test_resumen_junto_al_titulo_puede_declarar_su_publico(self) -> None:
        """El sujeto elíptico se admite en la entradilla de la propia ficha."""
        cuerpo = pagina("").replace(
            b"<h1>Curso de ejemplo</h1>",
            b"<header><div><h1>Curso de ejemplo</h1>"
            b"<p>Helps <strong>students</strong> build skills. More details.</p></div></header>",
        )
        ficha = extraer_ficha(cuerpo, metadatos(cuerpo), url_esperada=URL)
        self.assertIsNotNone(ficha.destinatarios)
        self.assertEqual(ficha.destinatarios[0].texto, "Helps students build skills. More details.")
        self.assertIn("/header[1]/div[1]/p[1]", ficha.destinatarios[0].localizador)

    def test_el_ambito_explicito_del_mismo_curso_conserva_los_destinatarios(self) -> None:
        """Una ficha de curso puede identificarse con una URL relativa y un fragmento."""
        cuerpo = pagina(
            '<article itemscope itemtype="https://schema.org/Course" itemid="/courses/curso-ejemplo#course">'
            "<h2>Course overview</h2><p>This course helps students build practical skills.</p></article>"
        )
        ficha = extraer_ficha(cuerpo, metadatos(cuerpo), url_esperada=URL)
        self.assertIsNotNone(ficha.destinatarios)
        self.assertIn("/article[1]/p[1]", ficha.destinatarios[0].localizador)

    def test_menciones_ajenas_objetivos_y_negaciones_conservan_publico_desconocido(self) -> None:
        """Un título comercial, colaborador, ejemplo de lección o beneficiario de otra acción es insuficiente."""
        for html in (
            "<article><p>Created with teachers and students.</p></article>",
            "<article><p>This lesson helps builders develop practical skills.</p></article>",
            "<article><p>Helps students build practical skills.</p></article>",
            "<article><p>This course helps build practical skills for teachers.</p></article>",
            "<article><p>This course helps assess how students learn.</p></article>",
            "<article><p>This course helps software tools for educators build lessons.</p></article>",
            "<article><p>This course does not prepare students to facilitate workshops.</p></article>",
            "<article><p>This course helps teachers' pupils learn by example.</p></article>",
            "<article><h2>About the partners</h2><p>This course helps students build projects.</p></article>",
            "<article><blockquote><p>This course helps students build projects.</p></blockquote></article>",
            "<article><aside><p>This course helps students build projects.</p></aside></article>",
            "<nav><article><p>This course helps students build projects.</p></article></nav>",
            '<div itemscope itemtype="https://schema.org/Course" itemid="/courses/otro">'
            "<article><p>This course helps students build projects.</p></article></div>",
            '<article itemscope itemtype="Course" itemid="https://[">'
            "<p>This course helps students build.</p></article>",
            '<article><p><span itemscope itemtype="https://schema.org/Product" itemid="#tool">'
            "This course helps students build projects.</span></p></article>",
            "<header><p>Helps students build projects.</p></header>",
            "<article><p>Course for teachers</p></article><article><p>This course helps students build.</p></article>",
        ):
            with self.subTest(html=html):
                cuerpo = pagina(html)
                ficha = extraer_ficha(cuerpo, metadatos(cuerpo), url_esperada=URL)
                self.assertIsNone(ficha.destinatarios)
                self.assertIsNone(ficha.requisitos)

    def test_faq_details_con_anidados_y_panel_oculto(self) -> None:
        """Una respuesta de acordeón cerrada sigue siendo evidencia de la captura."""
        cuerpo = pagina(
            "<details><summary>What prerequisites do I need?</summary>"
            '<p>Complete <a href="/courses/base"><strong>Base</strong></a> first.</p>'
            "<p>Then read the <em>whole</em> guide.</p></details>"
            '<button aria-controls="audience">Who is this course for?</button>'
            '<div id="audience" role="region" hidden><p>People doing <strong>practice</strong>.</p></div>'
        )
        ficha = extraer_ficha(cuerpo, metadatos(cuerpo), url_esperada=URL)
        self.assertIn("Complete Base first.", ficha.requisitos[0].texto)
        self.assertIn("Then read the whole guide.", ficha.requisitos[0].texto)
        self.assertEqual(ficha.requisitos[0].tipo, "faq")
        self.assertEqual(ficha.destinatarios[0].texto, "People doing practice.")
        self.assertIn("#audience", ficha.destinatarios[0].localizador)

    def test_pregunta_sin_respuesta_no_se_rellena(self) -> None:
        """Un control vacío no acredita la respuesta ni ausencia de requisitos."""
        cuerpo = pagina('<button aria-controls="ausente">What prerequisites do I need?</button>')
        ficha = extraer_ficha(cuerpo, metadatos(cuerpo), url_esperada=URL)
        self.assertIsNone(ficha.requisitos)
        self.assertIn("What prerequisites", ficha.contenido)

    def test_panel_duplicado_es_ambiguo(self) -> None:
        """No se escoge una respuesta entre dos elementos con la misma identidad."""
        cuerpo = pagina(
            '<button aria-controls="answer">Who is this for?</button>'
            '<div id="answer">One</div><div id="answer">Two</div>'
        )
        with self.assertRaisesRegex(ErrorFichaAcademy, "ambiguo"):
            extraer_ficha(cuerpo, metadatos(cuerpo), url_esperada=URL)

    def test_metadatos_incompletos_o_alterados_se_rechazan(self) -> None:
        """La integridad se comprueba antes de presentar contenido de una ficha."""
        cuerpo = pagina("<p>Example.</p>")
        for campo, valor in (
            ("completo", False),
            ("completo", 1),
            ("http", 206),
            ("bytes", 0),
            ("sha256", "0" * 64),
            ("url_final", "https://academy.claude.com/"),
            ("recibido_utc", "2026-10-22"),
            ("archivo", "../ajeno.html"),
        ):
            meta = {**metadatos(cuerpo), campo: valor}
            with self.subTest(campo=campo), self.assertRaises(ErrorFichaAcademy):
                extraer_ficha(cuerpo, meta, url_esperada=URL)

    def test_identidad_canonical_titulo_y_slug_coherentes(self) -> None:
        """Portada, canonical ajeno, título cambiado y metadata de otra ficha se rechazan."""
        original = pagina("<p>Example.</p>")
        for cuerpo in (
            original.replace(b'rel="canonical"', b'rel="otro"'),
            original.replace(b"<h1>Curso de ejemplo</h1>", b"<h1>Curso distinto</h1>"),
            original.replace(
                b'name="academy-prerender-path" content="/courses/curso-ejemplo"',
                b'name="academy-prerender-path" content="/courses/otro"',
            ),
            original.replace(b"<main>", b"<main><h1>Duplicado</h1>"),
        ):
            with self.subTest(cuerpo=cuerpo[:30]), self.assertRaises(ErrorFichaAcademy):
                extraer_ficha(cuerpo, metadatos(cuerpo), url_esperada=URL)
        with self.assertRaises(ErrorFichaAcademy):
            extraer_ficha(original, metadatos(original), url_esperada="https://academy.claude.com/courses/otro")

    def test_truncamiento_no_se_disfraza_con_metadatos_declarados_completos(self) -> None:
        """Incluso un hash recalculado no sustituye los cierres documentales esperados."""
        cuerpo = pagina("<p>Some <strong>complete</strong> paragraph.</p>")
        for alterado in (cuerpo[:-20], cuerpo.replace(b"</main>", b""), cuerpo + b"\xff"):
            with self.subTest(tamano=len(alterado)), self.assertRaises(ErrorFichaAcademy):
                extraer_ficha(alterado, metadatos(alterado), url_esperada=URL)

    def test_scripts_y_pagina_externa_no_se_confunden_con_contenido(self) -> None:
        """Se conserva el main; scripts y estilos no se convierten en hechos formativos."""
        cuerpo = pagina("<p>Visible.</p><script>privateCode()</script><style>.example { color: red }</style>")
        ficha = extraer_ficha(cuerpo, metadatos(cuerpo), url_esperada=URL)
        self.assertIn("Visible.", ficha.contenido)
        self.assertNotIn("privateCode", ficha.contenido)
        self.assertNotIn("color: red", ficha.contenido)
        self.assertNotIn("No forma parte de la ficha", ficha.contenido)
        self.assertNotIn("Otro contenido externo", ficha.contenido)

    def test_titulo_svg_no_sustituye_la_identidad_documental(self) -> None:
        """El título accesible de un dibujo no es el title del documento HTML."""
        cuerpo = pagina("<svg><title>Decorative title</title></svg><p>Complete paragraph.</p>")
        ficha = extraer_ficha(cuerpo, metadatos(cuerpo), url_esperada=URL)
        self.assertEqual(ficha.titulo_documento, "Curso de ejemplo · Claude Academy")
        self.assertIn("Complete paragraph.", ficha.contenido)

    def test_determinismo_e_inmutabilidad(self) -> None:
        """La misma captura conserva fecha y huella; no usa reloj ni conserva listas mutables."""
        cuerpo = pagina("<p>Unmapped text.</p>")
        uno = extraer_ficha(cuerpo, metadatos(cuerpo), url_esperada=URL)
        dos = extraer_ficha(cuerpo, metadatos(cuerpo), url_esperada=URL)
        self.assertEqual(uno, dos)
        self.assertEqual(uno.capturado_utc, FECHA)
        self.assertEqual(uno.sha256_captura, hashlib.sha256(cuerpo).hexdigest())
        self.assertIsInstance(uno.bloques, tuple)
        with self.assertRaises(FrozenInstanceError):
            uno.titulo = "ajeno"


if __name__ == "__main__":
    unittest.main()
