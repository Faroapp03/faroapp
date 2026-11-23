"""Pruebas de las clasificaciones de ocupaciones (clasificaciones.py): la CNO-11 y su correspondencia con la CIUO-08."""

import unittest
from unittest import mock

import plataforma_datos.ocupaciones.fuentes.clasificaciones.lector as clasificaciones
from plataforma_datos.comun.entrada_salida import leer_json
from plataforma_datos.comun.nucleo import PAQUETE, FormatoInesperado


class PruebaClasificaciones(unittest.TestCase):
    """Tipos de correspondencia CNO-11 ↔ ISCO-08."""

    def test_tipo(self) -> None:
        """El tipo depende de cuántos códigos hay a cada lado."""
        self.assertEqual(clasificaciones._tipo(1, 1), "1:1")
        self.assertEqual(clasificaciones._tipo(3, 1), "1:n")
        self.assertEqual(clasificaciones._tipo(1, 2), "n:1")
        self.assertEqual(clasificaciones._tipo(2, 2), "n:m")

    def test_cno_esperada(self) -> None:
        """La CNO-11 completa suma sus 761 códigos (10 + 17 + 62 + 170 + 502)."""
        self.assertEqual(sum(clasificaciones.ESPERADO_CNO.values()), 761)


class PruebaLecturaDeLaCno(unittest.TestCase):
    """La jerarquía de la CNO-11 y la correspondencia, leídas de filas sintéticas en el orden de la hoja del INE."""

    HOJA = (
        ("1", "Directores"),
        ("A", "Directores y gerentes"),
        ("11", "Miembros del poder ejecutivo"),
        ("2", "Técnicos y profesionales científicos"),
        ("B", "Profesionales de la salud"),
        ("21", "Profesionales de la salud"),
        ("C", "Profesionales de la enseñanza"),
        ("22", "Profesionales de la enseñanza"),
        ("221", "Profesores de universidad"),
        ("2210", "Profesores de universidad"),
    )

    def leer(self) -> list[dict[str, str]]:
        """La CNO-11 leída de `HOJA`.

        Returns:
            Las filas de `_cno` para la hoja sintética.
        """
        with mock.patch.object(clasificaciones, "leer_xls", return_value={clasificaciones.HOJA_CNO: self.HOJA}):
            return clasificaciones._cno()

    def test_el_padre_de_cada_grupo_principal_es_su_gran_grupo(self) -> None:
        """Un grupo principal tras otro del mismo gran grupo (C tras B) también tiene su gran grupo por padre."""
        padres = {fila["codigo"]: fila["padre"] for fila in self.leer()}
        self.assertEqual((padres["A"], padres["B"], padres["C"]), ("1", "2", "2"))
        self.assertEqual((padres["22"], padres["221"], padres["2210"]), ("2", "22", "221"))

    def test_cada_codigo_hereda_el_ultimo_grupo_principal(self) -> None:
        """Un código de 2 a 4 cifras lleva la letra del último grupo principal; un gran grupo, ninguna."""
        letras = {fila["codigo"]: fila["grupo_principal"] for fila in self.leer()}
        self.assertEqual((letras["1"], letras["11"], letras["21"], letras["2210"]), ("", "A", "B", "C"))

    def test_la_cno_validada_tiene_todos_los_padres(self) -> None:
        """El paquete oficial conserva todos los códigos y sus padres, sin necesitar originales operativos."""
        cno = leer_json(PAQUETE / "clasificaciones.json")["cno11"]
        self.assertEqual(len(cno), sum(clasificaciones.ESPERADO_CNO.values()))
        sin_padre = [codigo for codigo, fila in cno.items() if fila["nivel"] != "1" and fila["padre"] not in cno]
        self.assertEqual(sin_padre, [])

    def test_un_padre_ausente_no_supera_el_control(self) -> None:
        """Un texto no vacío no basta: el padre debe existir en la jerarquía preparada."""
        for codigo_padre in ("9", ""):
            cno = [
                {"codigo": "1", "nivel": "1", "padre": ""},
                {"codigo": "", "nivel": "1", "padre": ""},
                {"codigo": "11", "nivel": "2", "padre": codigo_padre},
            ]
            with self.subTest(padre=codigo_padre), mock.patch.object(clasificaciones, "controles_de_huella"):
                incorrecta = clasificaciones._controles(cno, set(), [], {}, {})
                cno[-1]["padre"] = "1"
                correcta = clasificaciones._controles(cno, set(), [], {}, {})
                for controles, resultado in ((incorrecta, "ERROR"), (correcta, "correcto")):
                    padres = [control for control in controles.lista if "padre" in control["control"]]
                    self.assertEqual(len(padres), 1)
                    self.assertEqual(padres[0]["resultado"], resultado)

    def test_frecuencias_incoherentes_detienen_la_lectura(self) -> None:
        """Si FREC11 o FREC08 no cuentan lo que hay en la tabla, la correspondencia no se acepta."""
        cabecera = ["", "", ""], ["", "", ""], clasificaciones.CABECERA_CORRESPONDENCIA
        fila = ["1111", "Título", "2", "1111", "Título ISCO", "1"]
        with (
            mock.patch.object(clasificaciones, "leer_xls", return_value={"Hoja1": [*cabecera, fila]}),
            self.assertRaisesRegex(FormatoInesperado, "frecuencias del INE incoherentes"),
        ):
            clasificaciones._correspondencia({})

    def test_el_control_de_la_oit_usa_las_ocupaciones_que_se_le_pasan(self) -> None:
        """Los grupos ISCO-08 se contrastan con las ocupaciones de la OIT recibidas, sin leer el disco dentro."""
        with mock.patch.object(clasificaciones, "controles_de_huella"):
            coinciden = clasificaciones._controles([], {"1111"}, [], {}, {"1111": {}})
            difieren = clasificaciones._controles([], {"1111"}, [], {}, {"2222": {}})
        de_la_oit = [control for control in difieren.lista if "de la OIT" in control["control"]]
        self.assertEqual(len(de_la_oit), 1)
        self.assertEqual(de_la_oit[0]["resultado"], "ERROR")
        self.assertEqual(
            [control["resultado"] for control in coinciden.lista if "de la OIT" in control["control"]], ["correcto"]
        )

    def test_codigo_de_ocupacion_de_la_api(self) -> None:
        """«430 - Otros empleados…» es el 430; lo que no empieza por una cifra va a «No consta»."""
        self.assertEqual(clasificaciones.codigo_de_ocupacion("430 - Otros empleados administrativos"), "430")
        self.assertEqual(clasificaciones.codigo_de_ocupacion("No consta"), clasificaciones.CODIGO_NO_CONSTA)

    def test_codigos_en_cno_exige_el_nivel(self) -> None:
        """Un código que existe con otro nivel no vale; uno que no existe, tampoco."""
        cno = {"22": {"nivel": "2"}, "221": {"nivel": "3"}}
        self.assertTrue(clasificaciones.codigos_en_cno(["221"], cno, "3"))
        self.assertFalse(clasificaciones.codigos_en_cno(["22"], cno, "3"))
        self.assertFalse(clasificaciones.codigos_en_cno(["999"], cno, "3"))


if __name__ == "__main__":
    unittest.main()
