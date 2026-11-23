"""Pruebas del texto de PDF: fuentes, renglones y límites del lector."""

import unittest
from unittest import mock

from plataforma_datos.comun import pdf
from plataforma_datos.comun.nucleo import FormatoInesperado
from plataforma_datos.comun.objetos_pdf import Documento, Flujo
from plataforma_datos.comun.pruebas.ejemplos_pdf import CMAP, _flujo, _pdf, pdf_de_prueba


class PruebaPdf(unittest.TestCase):
    """El lector de PDF: tabla de referencias, flujos, fuentes y renglones, también girados."""

    def test_renglones_de_un_pdf_con_dos_paginas(self) -> None:
        """Diferencias por nombre de glifo, escapes octales, huecos de palabra, ToUnicode y una página apaisada."""
        self.assertEqual(
            pdf.texto(pdf_de_prueba()),
            ["Denominación: Atención", "Ocupaciones y", "Código", "Primera", "Segunda"],
        )

    def test_tabla_tounicode(self) -> None:
        """Una tabla ToUnicode da los bytes por código y el texto de cada código, de bfchar y de bfrange."""
        ancho, tabla = pdf.tabla_tounicode(CMAP)
        self.assertEqual(ancho, 2)
        self.assertEqual(tabla, {1: "C", 2: "ó", 3: "d", 4: "i", 5: "g", 6: "o"})

    def test_lo_que_no_lee_lo_dice(self) -> None:
        """Un archivo que no es un PDF, un PDF cifrado o con la tabla en un flujo fallan con su motivo."""
        with self.assertRaisesRegex(FormatoInesperado, "%PDF"):
            pdf.texto(b"<html></html>")
        cifrado = pdf_de_prueba().replace(b"/Root 1 0 R", b"/Root 1 0 R /Encrypt 3 0 R")
        with self.assertRaisesRegex(FormatoInesperado, "cifrado"):
            pdf.texto(cifrado)
        en_flujo = pdf_de_prueba()
        inicio = int(en_flujo.rsplit(b"startxref", 1)[1].split()[0])
        marca = b"11 0 obj"
        with self.assertRaisesRegex(FormatoInesperado, "flujo"):
            pdf.texto(en_flujo[:inicio] + marca + en_flujo[inicio + len(marca) :])

    def test_un_codigo_de_cero_bytes_en_la_tabla_tounicode_falla(self) -> None:
        """Un codespace «<>» daría códigos de 0 bytes: la tabla se rechaza en vez de leer sin avanzar."""
        with self.assertRaisesRegex(FormatoInesperado, "0 bytes"):
            pdf.tabla_tounicode(CMAP.replace(b"<0000> <FFFF>", b"<> <>"))

    def test_una_pagina_mal_formada_falla_con_su_motivo_y_su_numero(self) -> None:
        """Un error de Python al interpretar una página sale como FormatoInesperado con el número de la página."""
        for error in (IndexError("falta"), ValueError("endbfchar"), TypeError("no es bytes")):
            with (
                self.subTest(error=type(error).__name__),
                mock.patch.object(pdf, "_renglones", side_effect=error),
                self.assertRaisesRegex(FormatoInesperado, f"página 1 está mal formada .{type(error).__name__}"),
            ):
                pdf.texto(pdf_de_prueba())

    def test_una_tabla_que_declara_mas_entradas_de_las_que_caben_falla(self) -> None:
        """Una cabecera de bloque con más entradas de las que caben en el archivo falla antes de recorrerlas."""
        declarado = pdf_de_prueba().replace(b"xref\n0 11\n", b"xref\n0 100000\n")
        with self.assertRaisesRegex(FormatoInesperado, "declara 100000 entradas y no caben"):
            pdf.texto(declarado)


class PruebaLimitesDelTexto(unittest.TestCase):
    """Las entradas incoherentes fallan y los estados gráficos conservan su texto."""

    def test_bfchar_no_pierde_un_origen_sin_destino(self) -> None:
        """Una pareja incompleta no puede desaparecer de la tabla sin aviso."""
        with self.assertRaisesRegex(FormatoInesperado, "bfchar"):
            pdf.tabla_tounicode(b"1 beginbfchar <01> endbfchar")

    def test_unicode_invalido_no_llega_a_la_salida(self) -> None:
        """Un destino truncado o sustituto suelto falla antes de escribir JSON UTF-8."""
        for destino in (b"<D800>", b"<00>", b"/A"):
            with self.subTest(destino=destino), self.assertRaisesRegex(FormatoInesperado, "UTF-16"):
                pdf.tabla_tounicode(b"1 beginbfchar <01> " + destino + b" endbfchar")

    def test_glifo_sustituto_no_llega_a_la_salida(self) -> None:
        """Un nombre uniD800 tampoco puede producir un sustituto suelto."""
        with self.assertRaisesRegex(FormatoInesperado, "glifo"):
            self.leer(b"BT /F1 10 Tf (A) Tj", diferencias=b"65 /uniD800")

    def test_rangos_tounicode_incoherentes_se_rechazan(self) -> None:
        """No se omiten extremos invertidos, destinos de más o de menos ni restos."""
        for rango in (b"<02> <01> <0041>", b"<01> <02> [<0041>]", b"<01> <01> [<0041> <0042>]", b"<01>"):
            with self.subTest(rango=rango), self.assertRaisesRegex(FormatoInesperado, "rango"):
                pdf.tabla_tounicode(b"1 beginbfrange " + rango + b" endbfrange")

    def test_rango_no_confunde_nombres_con_delimitadores(self) -> None:
        """Los nombres escapados /#5B y /#5D no abren ni cierran una lista de destinos."""
        for rango in (b"<01> <01> /#5B <0041> ]", b"<01> <01> [ <0041> /#5D"):
            with self.subTest(rango=rango), self.assertRaisesRegex(FormatoInesperado, "rango"):
                pdf.tabla_tounicode(b"1 beginbfrange " + rango + b" endbfrange")

    def test_rango_destino_no_desborda_su_ultimo_byte(self) -> None:
        """El subconjunto soportado rechaza un rango que requeriría acarreo en el destino."""
        with self.assertRaisesRegex(FormatoInesperado, "destino"):
            pdf.tabla_tounicode(b"1 beginbfrange <01> <02> <00FF> endbfrange")

    def test_total_de_codigos_tounicode_tiene_tope(self) -> None:
        """Dos rangos pequeños no eluden el tope conjunto de la fuente."""
        with (
            mock.patch.object(pdf, "MAX_CODIGOS_POR_FUENTE", 2, create=True),
            self.assertRaisesRegex(FormatoInesperado, "fuente"),
        ):
            pdf.tabla_tounicode(b"2 beginbfrange <01> <02> <0041> <03> <04> <0043> endbfrange")

    def test_total_de_anchuras_tiene_tope(self) -> None:
        """El tope también cubre /W con varios rangos."""
        for anchuras in (b"/W [1 2 500 3 4 500]", b"/W [1 [500 500 500]]"):
            with (
                self.subTest(anchuras=anchuras),
                mock.patch.object(pdf, "MAX_CODIGOS_POR_FUENTE", 2, create=True),
                self.assertRaisesRegex(FormatoInesperado, "fuente"),
            ):
                self.leer(b"BT /F1 10 Tf (A) Tj", compuesta=anchuras)

    def test_anchuras_invertidas_o_incompletas_no_desaparecen(self) -> None:
        """Un /W mal formado no se sustituye por anchuras predeterminadas sin aviso."""
        for anchuras in (b"/W [3 1 500]", b"/W [1]", b"/W [1 2]"):
            with self.subTest(anchuras=anchuras), self.assertRaisesRegex(FormatoInesperado, "rango /W"):
                self.leer(b"BT /F1 10 Tf (A) Tj", compuesta=anchuras)

    def test_nombre_de_fuente_que_parece_delimitador(self) -> None:
        """Un nombre escapado /#5B o /#3C#3C sigue siendo nombre de fuente."""
        for nombre in (b"#5B", b"#3C#3C"):
            lector = pdf._Pagina(Documento(pdf_de_prueba()))
            lector.leer(b"BT /" + nombre + b" 10 Tf (A) Tj", {"Font": {"[": {}, "<<": {}}})
            with self.subTest(nombre=nombre):
                self.assertEqual(lector.renglones[0][1], "A")

    def test_q_restaurar_fuente_y_parametros_sin_rebobinar_texto(self) -> None:
        """Q recupera el estado gráfico mientras el punto de escritura sigue avanzando."""
        contenido = b"BT /F1 10 Tf q /F2 20 Tf 2 Tc 3 Tw 200 Tz 14 TL (A) Tj Q (A) Tj ET"
        documento = Documento(pdf_de_prueba())
        lector = pdf._Pagina(documento)
        lector.leer(contenido, {"Font": {"F1": {}, "F2": {"Encoding": {"Differences": [65, "B"]}}}})
        self.assertEqual(lector.renglones[0][1], "BA")
        estado = lector.estado
        self.assertEqual(
            (estado.cuerpo, estado.caracter, estado.palabra, estado.escala, estado.interlineado), (10, 0, 0, 1, 0)
        )
        self.assertEqual(estado.matriz[-2:], (29.0, 0.0))

    def test_formulario_hereda_fuente_y_aisla_sus_cambios(self) -> None:
        """Un Form sin Tf usa la fuente vigente y sus cambios no escapan al llamador."""
        self.assertEqual(self.leer(b"/F1 10 Tf /X Do BT (A) Tj", formulario=b"BT (A) Tj /F2 20 Tf ET"), ["AA"])

    def test_formulario_fallido_restaura_estado(self) -> None:
        """La excepción no deja recursos ni contador de formularios intermedios."""
        lector = pdf._Pagina(Documento(pdf_de_prueba()))
        recursos = {"XObject": {"X": Flujo({"Subtype": "Form"}, b"[")}}
        lector.recursos = recursos
        anterior = lector.estado
        with self.assertRaises(FormatoInesperado):
            lector._formulario(["X"])
        self.assertIs(lector.estado, anterior)
        self.assertIs(lector.recursos, recursos)
        self.assertEqual(lector.formularios_abiertos, 0)

    def test_formulario_recursivo_tiene_tope(self) -> None:
        """Un Form que se llama a sí mismo acaba con un motivo, sin desbordar la pila."""
        with self.assertRaisesRegex(FormatoInesperado, "formularios anidados"):
            self.leer(b"/X Do", formulario=b"/X Do")

    @staticmethod
    def leer(
        contenido: bytes, *, diferencias: bytes = b"", compuesta: bytes = b"", formulario: bytes = b""
    ) -> list[str]:
        """Lee un PDF pequeño con dos fuentes y un Form opcional.

        Returns:
            Sus renglones.
        """
        fuente = (
            b"<< /Subtype /Type0 /DescendantFonts [<< " + compuesta + b" >>] >>"
            if compuesta
            else b"<< /Subtype /Type1 /Encoding << /Differences [" + diferencias + b"] >> >>"
        )
        objetos = [
            b"<< /Type /Catalog /Pages 2 0 R >>",
            b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            b"<< /Type /Page /Resources << /Font << /F1 4 0 R /F2 5 0 R >> "
            b"/XObject << /X 7 0 R >> >> /Contents 6 0 R >>",
            fuente,
            b"<< /Subtype /Type1 /Encoding << /Differences [65 /B] >> >>",
            _flujo(contenido),
            _flujo(formulario).replace(b"<< /Length", b"<< /Subtype /Form /Length"),
        ]
        return pdf.texto(_pdf(objetos))
