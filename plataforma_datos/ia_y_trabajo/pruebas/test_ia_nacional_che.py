"""Lectura de la medida nacional suiza y diagnóstico de tablas ambiguas."""

import unittest

import plataforma_datos.ia_y_trabajo.fuentes.ia_nacional_che.lector as ia_nacional_che
from plataforma_datos.comun.nucleo import FormatoInesperado

BFS = """Entreprises;2019;2021;2023
Kleine (5-49);5.400;8.600;8.300
Total;6.101;9.556;9.900
"""


class Lectura(unittest.TestCase):
    """La última columna debe ser el último año y el universo se identifica por su fila."""

    def test_suiza(self) -> None:
        """La fila «Total» del último año; la clase menor empieza en 5 personas; sin la fila, se para."""
        cifra = ia_nacional_che.cifra_del_grafico(BFS)
        self.assertEqual((cifra["valor"], cifra["anio"], cifra["clase_menor"]), (9.9, 2023, "Kleine (5-49)"))
        with self.assertRaises(FormatoInesperado):
            ia_nacional_che.cifra_del_grafico(BFS.replace("Total", "Gesamt"))

    def test_tabla_vacia_se_diagnostica(self) -> None:
        """Una captura vacía no debe escapar con IndexError."""
        with self.assertRaisesRegex(FormatoInesperado, "BFS:"):
            ia_nacional_che.cifra_del_grafico("")

    def test_cabecera_sin_anios_se_diagnostica(self) -> None:
        """Sin columnas anuales no hay celda Total que leer."""
        with self.assertRaisesRegex(FormatoInesperado, "BFS:.*cabecera"):
            ia_nacional_che.cifra_del_grafico("Entreprises\nKleine (5-49)\nTotal\n")

    def test_anios_repetidos_o_desordenados_se_rechazan(self) -> None:
        """La última posición no puede hacerse pasar por el año más reciente."""
        for anios in ("2019;2023;2023", "2019;2025;2023", "2023;2021;2019"):
            with self.subTest(anios=anios), self.assertRaisesRegex(FormatoInesperado, "BFS:.*años"):
                ia_nacional_che.cifra_del_grafico(BFS.replace("2019;2021;2023", anios))

    def test_digitos_unicode_se_diagnostican(self) -> None:
        """La comprobación isdigit acepta escrituras que no son números del CSV, algunas ni siquiera convertibles."""
        for antes, despues in (("2023", "²⁰²³"), ("2023", "٢٠٢٣"), ("9.900", "９.９００"), ("9.900", "⁹.⁹⁰⁰")):
            with self.subTest(despues=despues), self.assertRaisesRegex(FormatoInesperado, "BFS:"):
                ia_nacional_che.cifra_del_grafico(BFS.replace(antes, despues))

    def test_clase_menor_por_nombre_sin_depender_del_orden(self) -> None:
        """Otra fila anterior no cambia el universo si existe la clase explícita publicada."""
        texto = BFS.replace("Kleine (5-49);", "Mittlere (50-249);7.651;11.812;15.600\nKleine (5-49);")
        self.assertEqual(ia_nacional_che.cifra_del_grafico(texto), ia_nacional_che.cifra_del_grafico(BFS))

    def test_ausencia_de_clase_menor_se_diagnostica(self) -> None:
        """Una clase distinta no acredita el universo de cinco personas."""
        with self.assertRaisesRegex(FormatoInesperado, "BFS:.*clase"):
            ia_nacional_che.cifra_del_grafico(BFS.replace("Kleine (5-49)", "Mittlere (50-249)"))


if __name__ == "__main__":
    unittest.main()
