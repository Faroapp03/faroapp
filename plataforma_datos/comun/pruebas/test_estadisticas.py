"""Pruebas comunes de los lectores de tablas del INE y del Idescat, con fixtures sintéticos."""

import unittest

from plataforma_datos.comun import estadisticas
from plataforma_datos.comun.nucleo import FormatoInesperado


class PruebaLectores(unittest.TestCase):
    """JSON-stat 2.0 y Tempus se leen como celdas planas, con su estado y sus notas."""

    def test_jsonstat_con_valores_y_estados_por_posicion(self) -> None:
        """La última dimensión varía más deprisa; `value` y `status` pueden ir en diccionario por posición."""
        tabla = {
            "class": "dataset",
            "id": ["YEAR", "SEX"],
            "size": [2, 2],
            "dimension": {
                "YEAR": {"category": {"index": {"2022": 0, "2023": 1}}},
                "SEX": {"category": {"index": ["M", "F"], "label": {"M": "hombres", "F": "mujeres"}}},
            },
            "value": {"0": 10, "1": 12, "3": 15},
            "status": {"2": ".."},
        }
        celdas = estadisticas.celdas_jsonstat(tabla)
        self.assertEqual(celdas[1].claves, {"YEAR": "2022", "SEX": "F"})
        self.assertEqual([celda.valor for celda in celdas], [10, 12, None, 15])
        self.assertEqual(celdas[2].estado, "..")
        self.assertEqual(estadisticas.etiquetas_jsonstat(tabla, "SEX"), {"M": "hombres", "F": "mujeres"})

    def test_jsonstat_que_no_cuadra_no_se_lee(self) -> None:
        """Un tamaño distinto del número de categorías es otra tabla, no esta."""
        tabla = {"class": "dataset", "id": ["A"], "size": [3], "dimension": {"A": {"category": {"index": ["x"]}}}}
        with self.assertRaises(FormatoInesperado):
            estadisticas.celdas_jsonstat(tabla)
        with self.assertRaises(FormatoInesperado):
            estadisticas.celdas_jsonstat({"class": "error", "status": "416"})

    def test_tempus_con_codigos_nombres_y_notas(self) -> None:
        """Un valor sin código se nombra por su nombre; las notas de cada cifra llegan con ella."""
        serie = {
            "COD": "X1",
            "MetaData": [
                {"T3_Variable": "Sexo", "Nombre": "Total", "Codigo": ""},
                {"T3_Variable": "OCUPACIONES", "Nombre": "Oficinistas", "Codigo": "43"},
            ],
            "Data": [{"Anyo": 2023, "Valor": -1.5, "Notas": [{"texto": "nota"}]}, {"Anyo": 2022, "Valor": None}],
        }
        primera, segunda = estadisticas.celdas_tempus([serie])
        self.assertEqual(primera.codigos, {"Sexo": "Total", "OCUPACIONES": "43"})
        self.assertEqual((primera.anio, primera.valor, primera.notas), (2023, -1.5, ("nota",)))
        self.assertEqual((segunda.valor, segunda.notas), (None, ()))

    def test_jsonstat_no_reasigna_valores_con_posiciones_invalidas(self) -> None:
        """Las posiciones deben cubrir 0…n−1 una vez, sin huecos ni texto convertido en número."""
        for indice in (
            {"a": 1, "b": 2},
            {"a": 0, "b": 0},
            {"a": -1, "b": 0},
            {"a": 0.5, "b": 1.5},
            {"a": 0, "b": "1"},
            {"a": 0, "b": True},
        ):
            tabla = {
                "class": "dataset",
                "id": ["A"],
                "size": [2],
                "dimension": {"A": {"category": {"index": indice}}},
                "value": [10, 20],
            }
            with self.subTest(indice=indice), self.assertRaisesRegex(FormatoInesperado, "posiciones"):
                estadisticas.celdas_jsonstat(tabla)

    def test_jsonstat_con_posiciones_numericamente_enteras(self) -> None:
        """Un número entero escrito como float conserva su posición y no necesita normalización."""
        tabla = {
            "class": "dataset",
            "id": ["A"],
            "size": [2],
            "dimension": {"A": {"category": {"index": {"b": 1.0, "a": 0.0}}}},
            "value": [10, 20],
        }
        celdas = estadisticas.celdas_jsonstat(tabla)
        self.assertEqual([(celda.claves["A"], celda.valor) for celda in celdas], [("a", 10), ("b", 20)])

    def test_tempus_sin_metadatos_no_se_lee(self) -> None:
        """Sin `tip=AM` no hay códigos: la serie no se puede interpretar."""
        with self.assertRaises(FormatoInesperado):
            estadisticas.celdas_tempus([{"COD": "X1", "Data": []}])


class PruebaTopeYSoloLectura(unittest.TestCase):
    """El tamaño declarado no puede pedir más celdas que el tope, y las claves de una celda no se pueden cambiar."""

    def test_tamano_declarado_mayor_que_el_tope(self) -> None:
        """Un «size» que pasa de MAX_CELDAS_JSONSTAT se rechaza antes de crear celdas, aunque «value» esté vacío."""
        lado = 400
        self.assertGreater(lado * lado, estadisticas.MAX_CELDAS_JSONSTAT)
        indice = {"category": {"index": [str(numero) for numero in range(lado)]}}
        tabla = {"class": "dataset", "id": ["a", "b"], "size": [lado, lado], "value": {}}
        tabla["dimension"] = {"a": indice, "b": indice}
        with self.assertRaisesRegex(FormatoInesperado, "más que el tope"):
            estadisticas.celdas_jsonstat(tabla)

    def test_claves_de_solo_lectura(self) -> None:
        """Las celdas de una serie de Tempus comparten códigos que nadie puede modificar."""
        serie = {"MetaData": [{"T3_Variable": "Sexo", "Codigo": "1", "Nombre": "Hombres"}], "Data": []}
        serie["Data"] = [{"Anyo": 2022, "Valor": 1.0}, {"Anyo": 2023, "Valor": 2.0}]
        primera, _ = estadisticas.celdas_tempus([serie])
        with self.assertRaises(TypeError):
            primera.codigos["Sexo"] = "6"


if __name__ == "__main__":
    unittest.main()
