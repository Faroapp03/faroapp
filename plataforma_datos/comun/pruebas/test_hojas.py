"""Pruebas de los lectores propios de hojas de cálculo (.xlsx y .xls)."""

import struct
import tempfile
import unittest
import zipfile
from pathlib import Path
from xml.etree import ElementTree

from plataforma_datos.comun import constantes_hojas as formatos
from plataforma_datos.comun import hojas, nucleo
from plataforma_datos.comun.nucleo import FormatoInesperado

CADENAS = """<?xml version="1.0" encoding="UTF-8"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="3" uniqueCount="3">
<si><t>Código</t></si><si><t>Nombre &amp; más</t></si>
<si><r><t>Rico</t></r><r><t xml:space="preserve"> texto</t></r></si>
</sst>"""
HOJA = """<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
<row r="2"><c r="A2"><v>1113</v></c><c r="B2" t="inlineStr"><is><t>en línea &lt;1&gt;</t></is></c></row>
<row r="3"><c r="A3" t="s"><v>2</v></c><c r="C3"/></row>
</sheetData></worksheet>"""
HOJA_SIN_COMPARTIDAS = """<worksheet><sheetData>
<row r="1"><c r="A1" t="inlineStr"><is><t>clave</t></is></c></row>
<row r="2"><c r="A2" t="inlineStr"><is><t>valor</t></is></c></row>
</sheetData></worksheet>"""
# Firma de una entrada del directorio central de un zip (APPNOTE.TXT 4.3.12).
DIRECTORIO_CENTRAL = b"PK\x01\x02"
# Modo de una cadena BIFF: 0 = latin-1 comprimida, 1 = UTF-16.
BIFF_COMPRIMIDA = 0
BIFF_UTF16 = 1


def libro_xlsx(carpeta: Path, xml_por_hoja: dict[str, str], compartidas: str | None = CADENAS) -> Path:
    """Crea un .xlsx mínimo con las partes que lee `leer_xlsx`.

    Args:
        carpeta: carpeta donde se escribe «libro.xlsx».
        xml_por_hoja: XML de cada hoja por su nombre de parte («sheet1», «sheet2»…).
        compartidas: XML de la tabla de cadenas compartidas; None para un libro sin ella.

    Returns:
        Ruta del libro escrito.
    """
    ruta = carpeta / "libro.xlsx"
    with zipfile.ZipFile(ruta, "w") as libro:
        if compartidas is not None:
            libro.writestr("xl/sharedStrings.xml", compartidas)
        for nombre, xml in xml_por_hoja.items():
            libro.writestr(f"xl/worksheets/{nombre}.xml", xml)
    return ruta


class PruebaXlsx(unittest.TestCase):
    """Lector propio de .xlsx."""

    def setUp(self) -> None:
        """Carpeta temporal propia de cada prueba, que se borra al terminar aunque la prueba falle."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.carpeta = Path(temporal.name)

    def test_cabecera_cadenas_compartidas_y_en_linea(self) -> None:
        """La primera fila da nombre a las columnas; las cadenas compartidas, ricas y en línea se resuelven."""
        filas = hojas.leer_xlsx(libro_xlsx(self.carpeta, {"sheet1": HOJA}))
        self.assertEqual(
            filas,
            [{"Código": "1113", "Nombre & más": "en línea <1>"}, {"Código": "Rico texto", "C": ""}],
        )

    def test_otra_hoja_y_libro_sin_cadenas_compartidas(self) -> None:
        """Se puede elegir la hoja y el libro puede no tener tabla de cadenas compartidas."""
        ruta = libro_xlsx(self.carpeta, {"sheet1": HOJA, "sheet2": HOJA_SIN_COMPARTIDAS}, compartidas=None)
        self.assertEqual(hojas.leer_xlsx(ruta, hoja=2), [{"clave": "valor"}])

    def test_guias_foneticas_y_celdas_sin_referencia(self) -> None:
        """Las guías fonéticas (<rPh>) no forman parte del texto, y una celda sin referencia no se puede situar."""
        compartidas = '<sst><si><t>Base</t><rPh sb="0" eb="1"><t>fonética</t></rPh></si></sst>'
        hoja = (
            '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row><row r="2">'
            '<c t="inlineStr"><is><t>sin sitio</t></is></c><c r="A2"><v>7</v></c></row></sheetData></worksheet>'
        )
        ruta = libro_xlsx(self.carpeta, {"sheet1": hoja}, compartidas=compartidas)
        self.assertEqual(hojas.leer_xlsx(ruta), [{"Base": "7"}])

    def test_indice_negativo_de_cadena_compartida(self) -> None:
        """Una referencia negativa no selecciona la última cadena compartida del libro."""
        hoja = HOJA.replace("<v>2</v>", "<v>-1</v>")
        with self.assertRaisesRegex(FormatoInesperado, "índice de cadena compartida negativo"):
            hojas.leer_xlsx(libro_xlsx(self.carpeta, {"sheet1": hoja}))

    def test_hoja_inexistente(self) -> None:
        """Pedir una hoja que no existe es un error con su motivo, no una lista vacía."""
        with self.assertRaisesRegex(FormatoInesperado, "no contiene xl/worksheets/sheet3.xml"):
            hojas.leer_xlsx(libro_xlsx(self.carpeta, {"sheet1": HOJA}), hoja=3)

    def test_un_archivo_que_no_es_un_zip_detiene_la_lectura(self) -> None:
        """Un .xlsx que no es un zip no da filas vacías: la lectura se detiene con el error del formato."""
        ruta = self.carpeta / "falso.xlsx"
        ruta.write_bytes(b"no es un libro")
        with self.assertRaises(zipfile.BadZipFile):
            hojas.leer_xlsx(ruta)

    def test_un_xml_mal_formado_detiene_la_lectura(self) -> None:
        """Una hoja cortada a mitad de una etiqueta no se lee a medias: la lectura se detiene."""
        with self.assertRaises(ElementTree.ParseError):
            hojas.leer_xlsx(libro_xlsx(self.carpeta, {"sheet1": "<worksheet><sheetData><row"}))

    def test_una_parte_que_declara_mas_que_el_tope_no_se_descomprime(self) -> None:
        """Una bomba de descompresión: la parte declara más bytes que el tope y se rechaza antes de descomprimirla."""
        libro = bytearray(libro_xlsx(self.carpeta, {"sheet1": HOJA}).read_bytes())
        # Cada entrada del directorio central (APPNOTE.TXT 4.3.12) declara su tamaño sin comprimir en el desplazamiento
        # 24, en 4 bytes little-endian; se declara uno mayor que el tope sin cambiar el contenido.
        inicio = libro.find(DIRECTORIO_CENTRAL)
        while inicio >= 0:
            libro[inicio + 24 : inicio + 28] = struct.pack("<I", nucleo.MAX_DESCARGA_BYTES + 1)
            inicio = libro.find(DIRECTORIO_CENTRAL, inicio + len(DIRECTORIO_CENTRAL))
        ruta = self.carpeta / "bomba.xlsx"
        ruta.write_bytes(bytes(libro))
        with self.assertRaisesRegex(FormatoInesperado, "más que el tope"):
            hojas.leer_xlsx(ruta)


class PruebaXlsxPorNombre(unittest.TestCase):
    """Las hojas se buscan por su nombre en el libro, con su relación, y se leen como `filas_xlsx`."""

    def test_hojas_por_nombre_y_hoja_que_falta(self) -> None:
        """Cada hoja pedida se lee por su nombre, con cadenas en línea; una hoja que no existe da su motivo."""
        libro_xml = (
            '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="'
            'http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
            '<sheet name="QB5" sheetId="1" r:id="rId2"/><sheet name="QB3" sheetId="2" r:id="rId1"/></sheets></workbook>'
        )
        relaciones = (
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Target="worksheets/sheet1.xml"/>'
            '<Relationship Id="rId2" Target="/xl/worksheets/sheet2.xml"/></Relationships>'
        )
        with tempfile.TemporaryDirectory() as temporal:
            ruta = libro_xlsx(Path(temporal), {"sheet1": HOJA_SIN_COMPARTIDAS, "sheet2": HOJA})
            with zipfile.ZipFile(ruta, "a") as libro:
                libro.writestr("xl/workbook.xml", libro_xml)
                libro.writestr("xl/_rels/workbook.xml.rels", relaciones)
            filas = hojas.filas_xlsx_por_nombre(ruta, ["QB3", "QB5"])
            self.assertEqual(filas["QB3"], [{"A": "clave"}, {"A": "valor"}])
            self.assertEqual(filas["QB5"][1], {"A": "1113", "B": "en línea <1>"})
            with self.assertRaisesRegex(FormatoInesperado, "no tiene la hoja QB9"):
                hojas.filas_xlsx_por_nombre(ruta, ["QB9"])

    def test_relacion_sin_destino_identifica_libro_y_hoja(self) -> None:
        """Una relación incompleta no se convierte en una ruta ficticia dentro del ZIP."""
        for atributo in ("", ' Target=""'):
            with self.subTest(atributo=atributo), tempfile.TemporaryDirectory() as temporal:
                ruta = Path(temporal) / "volumen-a.xlsx"
                with zipfile.ZipFile(ruta, "w") as libro:
                    libro.writestr(
                        "xl/_rels/workbook.xml.rels",
                        f'<Relationships><Relationship Id="r1"{atributo}/></Relationships>',
                    )
                    libro.writestr(
                        "xl/workbook.xml",
                        '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
                        '<sheets><sheet name="QB5" r:id="r1"/></sheets></workbook>',
                    )
                with self.assertRaisesRegex(FormatoInesperado, "volumen-a.xlsx.*QB5.*Target"):
                    hojas.filas_xlsx_por_nombre(ruta, ["QB5"])


class PruebaXls(unittest.TestCase):
    """Lector propio de .xls (BIFF8 en OLE2)."""

    def test_rk(self) -> None:
        """Números RK: entero, entero entre 100, negativo y double truncado."""
        self.assertEqual(hojas._rk((1113 << 2) | formatos.RK_ENTERO), 1113.0)
        self.assertEqual(hojas._rk((12345 << 2) | formatos.RK_ENTERO | formatos.RK_ENTRE_100), 123.45)
        self.assertEqual(hojas._rk(((-7 & 0x3FFFFFFF) << 2) | formatos.RK_ENTERO), -7.0)
        alto = struct.unpack("<Q", struct.pack("<d", 2.5))[0] >> 32
        self.assertEqual(hojas._rk(alto & 0xFFFFFFFC), 2.5)

    def test_cadena_biff(self) -> None:
        """Cadenas BIFF en UTF-16 y en latin-1 comprimido."""
        self.assertEqual(hojas._cadena_biff("añ".encode("utf-16-le"), 0, 2, BIFF_UTF16), "añ")
        self.assertEqual(hojas._cadena_biff(b"xa\xf1o", 1, 3, BIFF_COMPRIMIDA), "año")

    def test_un_xls_truncado_se_rechaza(self) -> None:
        """Un .xls con la firma OLE2 pero cortado tras la cabecera se rechaza con un error propio, sin leer de más."""
        with tempfile.TemporaryDirectory() as temporal:
            ruta = Path(temporal) / "cortado.xls"
            ruta.write_bytes(formatos.FIRMA_OLE2 + bytes(100))
            with self.assertRaisesRegex(FormatoInesperado, "sector OLE2"):
                hojas.leer_xls(ruta)

    def test_no_ole2(self) -> None:
        """Un archivo que no es OLE2 se rechaza con un error propio."""
        with tempfile.TemporaryDirectory() as temporal:
            ruta = Path(temporal) / "falso.xls"
            ruta.write_bytes(b"no es un libro")
            with self.assertRaises(FormatoInesperado):
                hojas.leer_xls(ruta)


if __name__ == "__main__":
    unittest.main()
