"""Lectura de Statistics Iceland: nominal original y rechazo de tablas ambiguas o incompletas."""

import unittest

import plataforma_datos.ia_y_trabajo.fuentes.ia_nacional_isl.lector as ia_nacional_isl
from plataforma_datos.comun.nucleo import FormatoInesperado

PX = """MATRIX="STI03266";
UNITS[en]="Percentage";
HEADING="Ár","Tækni";
VALUES("Starfsemi/Stærð")="Öll fyrirtæki","1 til 9 starfsmenn";
VALUES("Ár")="2025";
VALUES[en]("Technology")="Machine learning","Any of the specified technologies";
CODES("Starfsemi/Stærð")="A12","1-9";
CODES("Tækni")="A8","A9";
DATA=
8 50
5 29;"""


class Lectura(unittest.TestCase):
    """La celda se identifica por códigos únicos y etiquetas alineadas."""

    def test_islandia(self) -> None:
        """«All companies» · «Any of the specified technologies»; la clase menor, en islandés."""
        cifra = ia_nacional_isl.cifra_de_la_tabla(PX)
        self.assertEqual((cifra["valor"], cifra["anio"]), (50.0, 2025))
        self.assertEqual(
            (cifra["respuesta"], cifra["clase_menor"]), ("Any of the specified technologies", "1 til 9 starfsmenn")
        )
        with self.assertRaises(FormatoInesperado):
            ia_nacional_isl.cifra_de_la_tabla(PX.replace("STI03266", "STI03265"))

    def test_no_sobrescribe_claves_repetidas(self) -> None:
        """Dos declaraciones de la misma clave son ambiguas, aunque coincidan."""
        for clave in ('MATRIX="STI03266";', "DATA=8 50 5 29;"):
            with self.subTest(clave=clave), self.assertRaisesRegex(FormatoInesperado, "Hagstofa:.*repetida"):
                ia_nacional_isl.cifra_de_la_tabla(PX + "\n" + clave)

    def test_ausencias_diagnosticadas(self) -> None:
        """Cada clave consumida ausente se informa como formato, sin KeyError o IndexError."""
        claves = (
            "UNITS[en]",
            "HEADING",
            'VALUES("Starfsemi/Stærð")',
            'VALUES("Ár")',
            'VALUES[en]("Technology")',
            'CODES("Starfsemi/Stærð")',
            'CODES("Tækni")',
            "DATA",
        )
        for clave in claves:
            sentencias = [sentencia for sentencia in PX.split(";") if not sentencia.strip().startswith(clave + "=")]
            with self.subTest(clave=clave), self.assertRaisesRegex(FormatoInesperado, "Hagstofa:"):
                ia_nacional_isl.cifra_de_la_tabla(";".join(sentencias))

    def test_codigos_sin_duplicados(self) -> None:
        """Un código repetido puede hacer elegir la primera celda de dos posibles."""
        cambios = (('"A12","1-9"', '"A12","A12"'), ('"A8","A9"', '"A9","A9"'))
        for antes, despues in cambios:
            with self.subTest(codigos=despues), self.assertRaisesRegex(FormatoInesperado, "Hagstofa:.*códigos"):
                ia_nacional_isl.cifra_de_la_tabla(PX.replace(antes, despues))

    def test_etiquetas_alineadas_con_codigos(self) -> None:
        """Las etiquetas cortas o sobrantes no identifican de forma fiable la celda."""
        cambios = (
            ('"Öll fyrirtæki","1 til 9 starfsmenn"', '"Öll fyrirtæki"'),
            ('"Öll fyrirtæki","1 til 9 starfsmenn"', '"Öll fyrirtæki","1 til 9 starfsmenn","otra"'),
            ('"Machine learning","Any of the specified technologies"', '"Machine learning"'),
            (
                '"Machine learning","Any of the specified technologies"',
                '"Machine learning","Any of the specified technologies","otra"',
            ),
        )
        for antes, despues in cambios:
            with self.subTest(etiquetas=despues), self.assertRaisesRegex(FormatoInesperado, "Hagstofa:.*etiquetas"):
                ia_nacional_isl.cifra_de_la_tabla(PX.replace(antes, despues))

    def test_unidad_unica(self) -> None:
        """No tomar la primera de varias unidades declaradas."""
        with self.assertRaisesRegex(FormatoInesperado, "Hagstofa:.*UNITS"):
            ia_nacional_isl.cifra_de_la_tabla(PX.replace('"Percentage"', '"Percentage","otra"'))

    def test_numeros_ascii(self) -> None:
        """No aceptar escrituras Unicode ajenas al formato numérico de esta tabla."""
        for antes, despues in (("8 50", "8 ５０"), ("8 50", "8 ²"), ('"2025"', '"２０２５"'), ('"2025"', '"año"')):
            with self.subTest(valor=despues), self.assertRaisesRegex(FormatoInesperado, "Hagstofa:"):
                ia_nacional_isl.cifra_de_la_tabla(PX.replace(antes, despues))

    def test_dimensiones_y_celda(self) -> None:
        """Los tamaños y la fila o columna requerida se comprueban antes del acceso."""
        cambios = (("5 29;", "5;"), ('"A12","1-9"', '"otra","1-9"'), ('"A8","A9"', '"A8","otra"'))
        for antes, despues in cambios:
            with self.subTest(cambio=despues), self.assertRaises(FormatoInesperado):
                ia_nacional_isl.cifra_de_la_tabla(PX.replace(antes, despues))


if __name__ == "__main__":
    unittest.main()
