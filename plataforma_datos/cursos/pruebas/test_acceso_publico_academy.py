"""Índice y texto didáctico Academy: ni HTTP200 ni una muestra acreditan todo un curso."""

import hashlib
import unittest
from dataclasses import replace

from plataforma_datos.cursos.fuentes.claude_academy import acceso_publico as acceso
from plataforma_datos.cursos.fuentes.claude_academy import lector

CURSO = "https://academy.claude.com/courses/ejemplo"
LECCION = CURSO + "/introduccion"
FECHA = "2026-10-23T10:00:00Z"


def captura(url: str, titulo: str, contenido: str) -> tuple[bytes, dict]:
    """Construye HTML sintético completamente identificado y su referencia exacta.

    Returns:
        Cuerpo completo y metadatos con URL, fecha y huella propios.
    """
    cuerpo = (
        f'<html><head><title>{titulo}</title><link rel="canonical" href="{url}">'
        f'<meta property="og:url" content="{url}"></head><body><main>{contenido}</main></body></html>'
    ).encode()
    return cuerpo, {
        "url_solicitada": url,
        "url_final": url,
        "http": 200,
        "completo": True,
        "bytes": len(cuerpo),
        "sha256": hashlib.sha256(cuerpo).hexdigest(),
        "archivo": "captura.body",
        "recibido_utc": FECHA,
    }


def ficha() -> lector.FichaAcademy:
    """Lee la ficha completa sintética, sin construir identidades manualmente.

    Returns:
        Ficha con vínculo literal Start course al mismo curso.
    """
    body, meta = captura(
        CURSO,
        "Curso de ejemplo · Claude Academy",
        '<h1>Curso de ejemplo</h1><a href="/courses/ejemplo/introduccion">Start course</a>',
    )
    return lector.extraer_ficha(body, meta, url_esperada=CURSO)


class AccesoPublicoAcademyPruebas(unittest.TestCase):
    """Lectores puros: sin red, escritura ni reloj."""

    def test_indice_deduplica_ids_sin_incluir_rutas_ajenas(self) -> None:
        """No crea identidades de queries, lecciones o dominios externos."""
        body, meta = captura(
            acceso.INDICE,
            "Courses · Claude Academy",
            '<h1>Courses</h1><a href="/courses/ejemplo">Uno</a><a href="/courses/ejemplo">Repetido</a>'
            '<a href="https://ajeno.test/courses/ajeno">Ajeno</a><a href="/courses/otro?q=x">Query</a>'
            '<a href="/courses/ejemplo/introduccion">Lección</a>',
        )
        indice = acceso.extraer_indice(body, meta)
        self.assertEqual(indice.urls, (CURSO,))
        self.assertEqual(indice.capturado_utc, FECHA)

    def test_indice_incompleto_vacio_o_ajeno_no_acredita_ausencias(self) -> None:
        """Una página rota o vacía no retira recursos."""
        for contenido in ("<h1>Courses</h1>", '<h1>Login</h1><a href="/courses/ejemplo">Uno</a>'):
            body, meta = captura(acceso.INDICE, "Courses · Claude Academy", contenido)
            with self.assertRaises(lector.ErrorFichaAcademy):
                acceso.extraer_indice(body, meta)
        body, meta = captura(
            acceso.INDICE, "Courses · Claude Academy", '<h1>Courses</h1><a href="/courses/ejemplo">Uno</a>'
        )
        with self.assertRaises(lector.ErrorFichaAcademy):
            acceso.extraer_indice(body, {**meta, "completo": False})

    def test_gratuidad_solo_con_declaracion_completa_no_negada_ni_contradictoria(self) -> None:
        """Conserva incertidumbre ante prosa distinta; no busca una palabra free."""
        for textos, reconocida in (
            ([acceso.RESUMEN_GRATUIDAD], True),
            ([acceso.RESUMEN_GRATUIDAD, "Some courses are paid."], False),
            ([acceso.DECLARACION], True),
            ([acceso.DECLARACION, "Free courses on Claude and AI, from Anthropic."], True),
            (["Free courses on Claude and AI, from Anthropic.", acceso.DECLARACION], True),
            ([acceso.DECLARACION, "Free courses on Claude and AI, from Anthropic.", "Some courses are paid."], False),
            (["Courses are not free."], False),
            (["Explore our free courses and paid courses."], False),
            ([acceso.DECLARACION, "Some courses require payment."], False),
            ([acceso.DECLARACION, "All courses require an enrollment fee of 30 euros."], False),
            ([acceso.DECLARACION, "Tuition is charged upon enrollment."], False),
            ([acceso.DECLARACION, "An optional printed certificate costs 10 euros."], True),
            (["A free introduction is available."], False),
        ):
            body, meta = captura(
                acceso.PORTADA, "Claude Academy", "<h1>Academy</h1>" + "".join(f"<p>{t}</p>" for t in textos)
            )
            declaracion = acceso.declaracion_gratuidad(body, meta)
            self.assertEqual(declaracion is not None, reconocida)
            if declaracion is not None:
                self.assertEqual(
                    declaracion.texto, acceso.DECLARACION if acceso.DECLARACION in textos else acceso.RESUMEN_GRATUIDAD
                )

    def test_inicio_literal_del_mismo_curso_sin_aceptar_subcadenas(self) -> None:
        """Un CTA negado, ambiguo o de otro curso no autoriza acceso."""
        fuente = ficha()
        self.assertEqual(acceso.enlace_inicio(fuente).href, LECCION)
        for texto, href in (
            ("Do not Start course", LECCION),
            ("Start course", "/courses/otro/inicio"),
            ("Start course", "https://ajeno.test/courses/ejemplo/inicio"),
        ):
            cambiada = replace(fuente, enlaces=(lector.EnlaceAcademy(texto, href, "/main/a"),))
            self.assertIsNone(acceso.enlace_inicio(cambiada))

    def test_leccion_exige_identidad_y_articulo_con_texto_no_solo_http_200(self) -> None:
        """Acredita el texto de esta lección; no evalúa vídeo, prácticas o curso entero."""
        body, meta = captura(
            LECCION,
            "Introducción · Curso de ejemplo · Claude Academy",
            "<h1>Introducción</h1><article><h2>Summary</h2><p>Texto didáctico de ejemplo.</p></article>",
        )
        leccion = acceso.extraer_leccion(body, meta, ficha=ficha())
        self.assertEqual(leccion.curso_id, "ejemplo")
        self.assertIn("Texto didáctico de ejemplo.", leccion.contenido)
        self.assertEqual(leccion.capturado_utc, FECHA)
        for titulo, contenido in (
            ("Introducción · Otro curso · Claude Academy", "<h1>Introducción</h1><article><p>Texto.</p></article>"),
            ("Introducción · Curso de ejemplo · Claude Academy", "<h1>Introducción</h1><p>Sign in to continue</p>"),
        ):
            body, meta = captura(LECCION, titulo, contenido)
            with self.assertRaises(lector.ErrorFichaAcademy):
                acceso.extraer_leccion(body, meta, ficha=ficha())


if __name__ == "__main__":
    unittest.main()
