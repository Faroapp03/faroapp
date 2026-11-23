"""Lector de piezas de PDF: cada tope y cada pieza dañada terminan en FormatoInesperado, nunca en otra excepción."""

import base64
import tempfile
import unittest
import zlib
from unittest import mock

from hypothesis import given, settings
from hypothesis import strategies as st
from hypothesis.configuration import set_hypothesis_home_dir

from plataforma_datos.comun import objetos_pdf
from plataforma_datos.comun.nucleo import FormatoInesperado
from plataforma_datos.comun.pruebas.ejemplos_pdf import _flujo, _pdf, pdf_de_prueba

# Los mismos ejemplos en cada ejecución, sin plazo por caso y sin escribir nada.
AJUSTES = settings(max_examples=300, derandomize=True, deadline=None, database=None)


class PiezasDanadas(unittest.TestCase):
    """Una pieza mal formada se rechaza con su motivo."""

    def test_piezas(self) -> None:
        """Hexadecimal sin cerrar o con otras letras, un número enorme y un diccionario cortado tras su clave."""
        for datos in (b"<414243", b"<41ZZ>", b"9" * 5000, b"<< /Clave"):
            with self.subTest(datos=datos[:12]), self.assertRaises(FormatoInesperado):
                objetos_pdf.valor(objetos_pdf.fichas(datos))

    def test_sin_piezas(self) -> None:
        """Pedir un valor donde no hay piezas."""
        with self.assertRaisesRegex(FormatoInesperado, "falta un valor"):
            objetos_pdf.valor([])

    def test_anidamiento(self) -> None:
        """Más de MAX_ANIDAMIENTO listas anidadas."""
        with self.assertRaisesRegex(FormatoInesperado, "niveles"):
            objetos_pdf.valor(objetos_pdf.fichas(b"[" * (objetos_pdf.MAX_ANIDAMIENTO + 1)))


class Topes(unittest.TestCase):
    """Los topes del documento: longitud que lleva a su propio objeto, ciclos y bombas de descompresión."""

    def test_longitud_que_lleva_a_su_objeto(self) -> None:
        """Un /Length que apunta a su propio flujo no recursa hasta RecursionError."""
        documento = objetos_pdf.Documento(_pdf([b"<< /Length 1 0 R >>\nstream\nabc\nendstream"]))
        with self.assertRaisesRegex(FormatoInesperado, "lleva otra vez a él"):
            documento.objeto(1)

    def test_longitud_que_no_es_un_numero(self) -> None:
        """Un /Length negativo o que no es un número."""
        for largo in (b"-1", b"(x)"):
            documento = objetos_pdf.Documento(_pdf([b"<< /Length " + largo + b" >>\nstream\nabc\nendstream"]))
            with self.subTest(largo=largo), self.assertRaisesRegex(FormatoInesperado, "longitud"):
                documento.objeto(1)

    def test_ciclo_en_prev(self) -> None:
        """Un Prev que vuelve a la misma tabla."""
        datos = pdf_de_prueba()
        tabla = datos.rindex(b"\nxref\n") + 1
        datos = datos.replace(b"/Root 1 0 R >>", b"/Root 1 0 R /Prev %d >>" % tabla)
        with self.assertRaisesRegex(FormatoInesperado, "Prev"):
            objetos_pdf.Documento(datos)

    def test_prev_que_no_es_una_posicion(self) -> None:
        """Un Prev que no es un entero."""
        datos = pdf_de_prueba().replace(b"/Root 1 0 R >>", b"/Root 1 0 R /Prev (x) >>")
        with self.assertRaisesRegex(FormatoInesperado, "Prev"):
            objetos_pdf.Documento(datos)

    def test_ciclo_en_kids(self) -> None:
        """Un nodo de páginas que es hijo de sí mismo."""
        documento = objetos_pdf.Documento(
            _pdf([b"<< /Type /Catalog /Pages 2 0 R >>", b"<< /Type /Pages /Kids [2 0 R] /Count 1 >>"])
        )
        with self.assertRaisesRegex(FormatoInesperado, "ya visitado"):
            documento.paginas()

    def test_ciclo_de_referencias(self) -> None:
        """Dos objetos que son referencias el uno del otro."""
        documento = objetos_pdf.Documento(_pdf([b"2 0 R", b"1 0 R"]))
        with self.assertRaisesRegex(FormatoInesperado, "a sí misma"):
            documento.resolver(objetos_pdf.Referencia(1, 0))

    def test_bomba_de_descompresion(self) -> None:
        """Un flujo que pasa de MAX_FLUJO_BYTES descomprimido."""
        documento = objetos_pdf.Documento(_pdf([_flujo(b"0" * 100)]))
        flujo = documento.objeto(1)
        with (
            mock.patch.object(objetos_pdf, "MAX_FLUJO_BYTES", 10),
            self.assertRaisesRegex(FormatoInesperado, "descomprimido"),
        ):
            documento.bytes_de(flujo)
        self.assertEqual(documento.bytes_de(flujo), b"0" * 100)
        self.assertEqual(zlib.decompress(flujo.crudo), b"0" * 100)


class Filtros(unittest.TestCase):
    """ASCII85 con o sin sus marcas «<~» y «~>»."""

    def test_ascii85(self) -> None:
        """Las dos formas dan los mismos bytes."""
        codificado = base64.a85encode(b"Hola")
        documento = objetos_pdf.Documento(_pdf([b"1"]))
        for crudo in (codificado + b"~>", b"<~" + codificado + b"~>"):
            flujo = objetos_pdf.Flujo({"Filter": objetos_pdf.Nombre("ASCII85Decode")}, crudo)
            with self.subTest(crudo=crudo):
                self.assertEqual(documento.bytes_de(flujo), b"Hola")


class Propiedades(unittest.TestCase):
    """Para cualquier secuencia de bytes, leer piezas y un valor termina o falla con FormatoInesperado."""

    @AJUSTES
    @given(st.binary(max_size=200))
    def test_bytes_cualesquiera(self, datos: bytes) -> None:
        """Ni IndexError, ni ValueError, ni RecursionError: o un valor o el motivo."""
        try:
            objetos_pdf.valor(objetos_pdf.fichas(datos))
        except FormatoInesperado:
            return

    @AJUSTES
    @given(st.lists(st.sampled_from([b"<<", b">>", b"[", b"]", b"/A", b"1", b"0", b"R", b"(x)", b"<41>"]), max_size=40))
    def test_piezas_cualesquiera(self, piezas: list[bytes]) -> None:
        """Con piezas válidas en cualquier orden, igual."""
        try:
            objetos_pdf.valor(objetos_pdf.fichas(b" ".join(piezas)))
        except FormatoInesperado:
            return


class RegresionesDeObjetos(unittest.TestCase):
    """Las piezas y estructuras defectuosas conservan un error del lector con motivo."""

    def test_continuacion_crlf_y_saltos_literales(self) -> None:
        """Una continuación consume CRLF entero y un salto literal se normaliza a LF."""
        for crudo, esperado in ((b"(a\\\r\nb)", b"ab"), (b"(a\rb\r\nc\nd)", b"a\nb\nc\nd")):
            with self.subTest(crudo=crudo):
                self.assertEqual(objetos_pdf.fichas(crudo), [esperado])

    def test_nombres_no_se_confunden_con_delimitadores_ni_referencias(self) -> None:
        """Los nombres escapados siguen siendo nombres y /R no cierra una referencia."""
        for crudo, nombre in ((b"/#5B", "["), (b"/#3C#3C", "<<")):
            with self.subTest(crudo=crudo):
                leido, fin = objetos_pdf.valor(objetos_pdf.fichas(crudo))
                self.assertIsInstance(leido, objetos_pdf.Nombre)
                self.assertEqual((leido, fin), (nombre, 1))
        self.assertEqual(objetos_pdf.valor(objetos_pdf.fichas(b"1 0 /R")), (1, 1))
        self.assertEqual(objetos_pdf.valor(objetos_pdf.fichas(b"[/#5D 1]")), ([objetos_pdf.Nombre("]"), 1], 4))

    def test_real_fuera_de_rango_falla_con_motivo(self) -> None:
        """Un decimal enorme no se convierte silenciosamente en infinito."""
        for signo in (b"", b"-"):
            with self.subTest(signo=signo), self.assertRaisesRegex(FormatoInesperado, "número"):
                objetos_pdf.valor(objetos_pdf.fichas(signo + b"9" * 5000 + b".0"))

    def test_marca_xref_desconocida_no_se_trata_como_libre(self) -> None:
        """Una entrada que no marca n ni f no oculta el objeto como si estuviera eliminado."""
        datos = _pdf([b"1"]).replace(b"00000 n ", b"00000 x ", 1)
        with self.assertRaisesRegex(FormatoInesperado, "marca"):
            objetos_pdf.Documento(datos)

    def test_claves_de_diccionario_son_nombres(self) -> None:
        """Una clave compuesta o un número no son claves de diccionario PDF."""
        for crudo in (b"<< [] 1 >>", b"<< 1 2 >>"):
            with self.subTest(crudo=crudo), self.assertRaisesRegex(FormatoInesperado, "clave"):
                objetos_pdf.valor(objetos_pdf.fichas(crudo))

    def test_filtros_danados_fallan_con_motivo(self) -> None:
        """Ni ASCII85 inválido ni Flate inválido o incompleto se aceptan ni exponen errores ajenos."""
        documento = objetos_pdf.Documento(_pdf([b"1"]))
        for filtro, crudo in (
            ("ASCII85Decode", b"v~>"),
            ("FlateDecode", b"roto"),
            ("FlateDecode", zlib.compress(b"hola")[:-1]),
        ):
            with self.subTest(filtro=filtro, crudo=crudo), self.assertRaisesRegex(FormatoInesperado, "flujo"):
                documento.bytes_de(objetos_pdf.Flujo({"Filter": objetos_pdf.Nombre(filtro)}, crudo))

    def test_predictor_no_admitido_falla_sin_devolver_bytes_erroneos(self) -> None:
        """Un predictor Flate no implementado falla tanto directo como en una lista de parámetros."""
        documento = objetos_pdf.Documento(_pdf([b"1"]))
        for parametros in ({"Predictor": 12}, [{"Predictor": 2}]):
            flujo = objetos_pdf.Flujo(
                {"Filter": objetos_pdf.Nombre("FlateDecode"), "DecodeParms": parametros}, zlib.compress(b"\x00Hola")
            )
            with self.subTest(parametros=parametros), self.assertRaisesRegex(FormatoInesperado, "Predictor"):
                documento.bytes_de(flujo)
        flujo = objetos_pdf.Flujo(
            {"Filter": objetos_pdf.Nombre("FlateDecode"), "DecodeParms": {"Predictor": 1}}, zlib.compress(b"Hola")
        )
        self.assertEqual(documento.bytes_de(flujo), b"Hola")

    def test_arbol_mal_formado_falla_con_motivo(self) -> None:
        """Raíz, Pages y Kids no producen KeyError, TypeError ni AttributeError."""
        casos = (
            [b"1"],
            [b"<< >>"],
            [b"<< /Pages 2 0 R >>", b"1"],
            [b"<< /Pages 2 0 R >>", b"<< /Kids 1 >>"],
            [b"<< /Pages 2 0 R >>", b"<< /Kids [3 0 R] >>", b"1"],
        )
        for objetos in casos:
            with self.subTest(objetos=objetos), self.assertRaisesRegex(FormatoInesperado, "PDF"):
                objetos_pdf.Documento(_pdf(objetos)).paginas()

    def test_longitud_fraccionaria_o_truncada_falla_con_motivo(self) -> None:
        """Length cuenta bytes enteros y no puede desbordar el contenido del archivo."""
        for largo in (b"1.5", b"999999"):
            datos = _pdf([b"<< /Length " + largo + b" >>\nstream\nabc\nendstream"])
            with self.subTest(largo=largo), self.assertRaisesRegex(FormatoInesperado, "longitud"):
                objetos_pdf.Documento(datos).objeto(1)

    def test_longitud_de_flujo_termina_en_endstream(self) -> None:
        """Una longitud corta o una marca de cierre dañada no entregan bytes parciales como flujo válido."""
        for contenido in (b"<< /Length 2 >>\nstream\nabc\nendstream", b"<< /Length 3 >>\nstream\nabc\nendstreaX"):
            with self.subTest(contenido=contenido), self.assertRaisesRegex(FormatoInesperado, "endstream"):
                objetos_pdf.Documento(_pdf([contenido])).objeto(1)

    def test_objeto_rechaza_cabecera_de_otro_numero(self) -> None:
        """Una entrada xref que apunta al objeto siguiente no devuelve su contenido como si fuera el solicitado."""
        datos = _pdf([b"111", b"222"])
        tabla = objetos_pdf.Documento(datos).desplazamientos
        propio = f"{tabla[1]:010d} 00000 n ".encode()
        ajeno = f"{tabla[2]:010d} 00000 n ".encode()
        datos = datos.replace(propio, ajeno, 1)
        with self.assertRaisesRegex(FormatoInesperado, "objeto 1"):
            objetos_pdf.Documento(datos).objeto(1)

    def test_entrada_libre_nueva_no_resucita_el_objeto_de_prev(self) -> None:
        """La eliminación en una actualización manda sobre la entrada en uso de la tabla anterior."""
        base = _pdf([b"1"])
        anterior = int(base.rsplit(b"startxref\n", 1)[1].split()[0])
        actualizada = base + (
            b"xref\n1 1\n0000000000 00001 f \ntrailer\n"
            b"<< /Size 2 /Root 1 0 R /Prev %d >>\nstartxref\n%d\n%%%%EOF\n" % (anterior, len(base))
        )
        self.assertIsNone(objetos_pdf.Documento(actualizada).objeto(1))

    def test_flujo_no_toma_marca_de_otro_objeto(self) -> None:
        """Un diccionario con Length sin stream no toma los bytes del objeto siguiente."""
        datos = _pdf([b"<< /Length 3 >>", _flujo(b"abc", comprimido=False)])
        self.assertEqual(objetos_pdf.Documento(datos).objeto(1), {"Length": 3})

    def test_flujo_sin_longitud_falla_con_motivo(self) -> None:
        """Un stream necesita un diccionario con Length, aunque sus bytes se puedan interpretar como piezas."""
        for cabecera in (b"<< >>", b"1"):
            with self.subTest(cabecera=cabecera), self.assertRaisesRegex(FormatoInesperado, "Length"):
                objetos_pdf.Documento(_pdf([cabecera + b"\nstream\nabc\nendstream"])).objeto(1)


MAX_ENTRADAS_DECLARADAS = 10**12


class PruebaPropiedadesDelPdf(unittest.TestCase):
    """El lector de PDF acaba ante cualquier tabla de referencias: la lee o falla con su motivo."""

    @AJUSTES
    @given(st.integers(min_value=0, max_value=MAX_ENTRADAS_DECLARADAS))
    def test_cualquier_numero_de_entradas_declarado_se_lee_o_falla_con_su_motivo(self, declaradas: int) -> None:
        """Declare las entradas que declare el bloque de la tabla, leer el PDF acaba con el documento o con el error."""
        base = pdf_de_prueba()
        self.assertIn(b"xref\n0 11\n", base)  # Si el PDF de prueba cambia de tamaño, esta prueba debe seguirlo.
        datos = base.replace(b"xref\n0 11\n", b"xref\n0 %d\n" % declaradas)
        try:
            documento = objetos_pdf.Documento(datos)
        except FormatoInesperado:
            return
        self.assertLessEqual(len(documento.desplazamientos), declaradas)


def setUpModule() -> None:
    """Da a Hypothesis una carpeta temporal para sus cachés, fuera del repositorio, mientras corre este módulo.

    Se hace al empezar las pruebas, no al importar el módulo: importarlo no cambia nada de Hypothesis. Al terminar,
    Hypothesis vuelve a su carpeta de omisión y la temporal se borra.
    """
    carpeta = tempfile.TemporaryDirectory(prefix="faro-hypothesis-")
    unittest.addModuleCleanup(carpeta.cleanup)
    unittest.addModuleCleanup(set_hypothesis_home_dir, None)
    set_hypothesis_home_dir(carpeta.name)


if __name__ == "__main__":
    unittest.main()
