"""Lectura de la tabla H9 de Cetic.br y rechazo de entradas ambiguas."""

import unittest

import plataforma_datos.ia_y_trabajo.fuentes.ia_nacional_bra.lector as ia_nacional_bra
from plataforma_datos.comun.nucleo import FormatoInesperado

HTML = """<table><caption><p class="titulo">H9 - EMPRESAS QUE UTILIZARAM TECNOLOGIAS DE INTELIGÊNCIA ARTIFICIAL</p>
<p class="olho">Total de empresas¹</p></caption><tr><th>Percentual (%)</th><th>Sim</th><th>Não</th></tr>
<tr><th colspan="2">TOTAL</th><td>17</td><td>83</td></tr></table>
<ul><li class="fonte">Fonte: {cita}</li><li class="fonte">{nota}</li></ul>"""


class Lectura(unittest.TestCase):
    """La celda TOTAL/Sim y sus textos nacionales se conservan."""

    def test_brasil(self) -> None:
        """La fila «TOTAL», «Sim»; la cita y la nota de que es un mínimo, literales."""
        pagina = HTML.format(cita=ia_nacional_bra.CITA, nota=ia_nacional_bra.NOTA)
        cifra = ia_nacional_bra.cifra_de_la_tabla(pagina)
        self.assertEqual(
            (cifra["valor"], cifra["titulo"], cifra["base"]), (17.0, ia_nacional_bra.TITULO, ia_nacional_bra.BASE)
        )
        with self.assertRaises(FormatoInesperado):
            ia_nacional_bra.cifra_de_la_tabla(pagina.replace("<td>83</td>", "<td>80</td>"))

    def test_titulo_y_base_duplicados_se_rechazan(self) -> None:
        """Una segunda etiqueta no puede quedar oculta tras la primera válida."""
        pagina = HTML.format(cita=ia_nacional_bra.CITA, nota=ia_nacional_bra.NOTA)
        for clase, texto in (("titulo", ia_nacional_bra.TITULO), ("olho", ia_nacional_bra.BASE)):
            for segundo in (texto, "Otra base o pregunta"):
                with self.subTest(clase=clase, segundo=segundo):
                    duplicada = pagina.replace("</caption>", f'<p class="{clase}">{segundo}</p></caption>')
                    with self.assertRaisesRegex(FormatoInesperado, "Cetic.br.*" + clase):
                        ia_nacional_bra.cifra_de_la_tabla(duplicada)

    def test_cifras_no_ascii_se_rechazan_con_contexto(self) -> None:
        """La tabla publica enteros ASCII; no se convierten otras escrituras."""
        pagina = HTML.format(cita=ia_nacional_bra.CITA, nota=ia_nacional_bra.NOTA)
        for si, no in (("¹⁷", "⁸³"), ("١٧", "٨٣")):
            with self.subTest(si=si, no=no):
                alterada = pagina.replace("<td>17</td>", f"<td>{si}</td>").replace("<td>83</td>", f"<td>{no}</td>")
                with self.assertRaisesRegex(FormatoInesperado, "Cetic.br: cifra inesperada"):
                    ia_nacional_bra.cifra_de_la_tabla(alterada)


if __name__ == "__main__":
    unittest.main()
