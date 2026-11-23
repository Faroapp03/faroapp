"""La lectura del HTML y de los reconocedores: texto visible, título, datos incrustados y lo declarado por fuente."""

import re
import unittest

from plataforma_datos.cursos.comprobacion_pagina import vocabulario
from plataforma_datos.cursos.comprobacion_pagina.analisis import (
    AUSENTE,
    COMPLETO,
    PALABRAS_PRINCIPALES,
    analizar,
    normalizar,
)
from plataforma_datos.cursos.comprobacion_pagina.documento import decodificar, leer_documento
from plataforma_datos.cursos.comprobacion_pagina.pruebas import ejemplos as ej
from plataforma_datos.cursos.comprobacion_pagina.reconocedores import RECONOCEDORES, Reconocedor


class DocumentoPruebas(unittest.TestCase):
    """Lo que se lee del marcado."""

    def test_texto_visible_sin_scripts_estilos_ni_cabecera(self) -> None:
        """Solo cuenta el texto que ve una persona, con las líneas colapsadas."""
        cabecera = b"<head><title>Titulo</title></head>"
        html = cabecera + b"<body><style>p{}</style><p>Hola   mundo</p><script>x()</script><p>Adios</p>"
        documento = leer_documento(html, "text/html")
        self.assertEqual(documento.texto, "Hola mundo\nAdios")
        self.assertEqual((documento.titulo, documento.scripts, documento.datos_next), ("Titulo", 1, None))

    def test_titulo_social_y_datos_de_next(self) -> None:
        """Lee `og:title` y el JSON de `__NEXT_DATA__`."""
        html = b'<meta property="og:title" content="Social"><script id="__NEXT_DATA__">{"a": 1}</script>'
        documento = leer_documento(html, None)
        self.assertEqual((documento.titulo_social, documento.datos_next), ("Social", '{"a": 1}'))

    def test_codificacion_de_la_cabecera_o_del_meta(self) -> None:
        """Respeta la codificación declarada y, si no hay, la del `<meta>`; una desconocida cae a UTF-8."""
        texto = "Inscripció"
        self.assertEqual(decodificar(texto.encode("latin-1"), "text/html; charset=latin-1"), texto)
        self.assertEqual(decodificar(b'<meta charset="latin-1">' + texto.encode("latin-1"), None)[-10:], texto)
        self.assertEqual(decodificar(texto.encode(), "text/html; charset=inventada"), texto)

    def test_cuerpo_ilegible_no_rompe(self) -> None:
        """Bytes que no son HTML dan un documento vacío, no una excepción."""
        self.assertEqual(leer_documento(b"\xff\xfe\x00", "text/html").texto.strip("�\x00"), "")
        self.assertEqual(leer_documento(b"", None).texto, "")


class AnalisisPruebas(unittest.TestCase):
    """El título, las señales y los datos incrustados."""

    def test_aparicion_del_titulo(self) -> None:
        """Entero, por sus palabras principales o ausente."""
        reconocedor = RECONOCEDORES["claude_academy"]
        casos = [
            (f"<p>{ej.TITULO}</p>", COMPLETO),
            ("<p>Hojas de cálculo y vida diaria</p>", PALABRAS_PRINCIPALES),
            ("<p>Otro curso distinto</p>", AUSENTE),
        ]
        for cuerpo, esperado in casos:
            with self.subTest(cuerpo=cuerpo):
                self.assertEqual(analizar(ej.pagina(cuerpo), "text/html", ej.TITULO, reconocedor).titulo, esperado)
        self.assertEqual(analizar(b"", None, "", reconocedor).titulo, AUSENTE)

    def test_las_frases_de_plantilla_no_son_senales(self) -> None:
        """Lo que un reconocedor declara de menú o de pie se descarta aunque lleve una palabra de cierre."""
        cuerpo = ej.pagina("<p>Curs tancat per vacances</p><p>Curs tancat</p>")
        con = Reconocedor(idiomas=("ca",), plantilla=("curs tancat per vacances",))
        sin = Reconocedor(idiomas=("ca",))
        self.assertEqual([s.frase for s in analizar(cuerpo, None, "", con).cierre], ["Curs tancat"])
        self.assertEqual(len(analizar(cuerpo, None, "", sin).cierre), 1)
        self.assertEqual(analizar(ej.pagina("<p>Curs tancat per vacances</p>"), None, "", con).cierre, ())

    def test_la_huella_del_texto_no_cuenta_las_cifras(self) -> None:
        """Dos páginas que solo difieren en el identificador que repiten tienen la misma huella de texto."""
        reconocedor = RECONOCEDORES["barcelonactiva"]
        uno = analizar(ej.pagina("<p>Ficha 1234 de la actividad</p>"), None, "", reconocedor)
        otro = analizar(ej.pagina("<p>Ficha 998369006 de la actividad</p>"), None, "", reconocedor)
        self.assertEqual(uno.huella_texto, otro.huella_texto)

    def test_normalizar_quita_tildes_y_mayusculas(self) -> None:
        """La búsqueda de frases no distingue tildes ni mayúsculas."""
        self.assertEqual(normalizar("Inscripció TANCADA"), "inscripcio tancada")


class ReconocedoresPruebas(unittest.TestCase):
    """Lo declarado por fuente es coherente y está en un solo sitio."""

    def test_idiomas_y_patrones_validos(self) -> None:
        """Cada idioma declarado existe en el vocabulario y cada patrón es una expresión válida y normalizada."""
        self.assertEqual(set(vocabulario.CIERRE), set(vocabulario.IDIOMAS))
        self.assertEqual(set(vocabulario.APERTURA), set(vocabulario.IDIOMAS))
        for fuente, reconocedor in RECONOCEDORES.items():
            with self.subTest(fuente=fuente):
                self.assertTrue(set(reconocedor.idiomas) <= set(vocabulario.IDIOMAS))
                for _, patron in (*reconocedor.cierre(), *reconocedor.apertura()):
                    re.compile(patron)
                    self.assertEqual(patron, normalizar(patron))
                self.assertEqual([p for p in reconocedor.plantilla if p != normalizar(p)], [])

    def test_una_fuente_que_decide_por_su_pagina_declara_como_se_abre_un_curso(self) -> None:
        """Sin una señal de apertura propia o datos incrustados, la página de una fuente nunca daría `disponible`."""
        for fuente, reconocedor in RECONOCEDORES.items():
            with self.subTest(fuente=fuente):
                if reconocedor.ficha_decide:
                    self.assertTrue(reconocedor.apertura_propia or reconocedor.datos_embebidos)
                    if reconocedor.apertura_propia:
                        re.compile(reconocedor.apertura_propia)

    def test_cada_vocabulario_reconoce_sus_frases(self) -> None:
        """Una frase de cierre de cada idioma y una de apertura se reconocen tal cual."""
        casos = {
            "ca": ("Inscripció tancada", "Inscriu-te"),
            "es": ("Plazas agotadas", "Inscríbete"),
            "en": ("Sold out", "Enroll"),
        }
        for idioma, (cierre, apertura) in casos.items():
            with self.subTest(idioma=idioma):
                reconocedor = Reconocedor(idiomas=(idioma,))
                analisis = analizar(ej.pagina(f"<p>{cierre}</p><p>{apertura}</p>"), None, "", reconocedor)
                self.assertEqual(
                    ([s.frase for s in analisis.cierre], [s.frase for s in analisis.apertura]), ([cierre], [apertura])
                )


if __name__ == "__main__":
    unittest.main()
