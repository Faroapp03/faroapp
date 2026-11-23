"""Pruebas de la relación oficial de ocupaciones con certificados."""

import unittest

import plataforma_datos.cursos.fuentes.acreditacion.relaciones as relaciones
from plataforma_datos.cursos.pruebas.ejemplos_acreditacion import linea


class PruebaRelacion(unittest.TestCase):
    """La regla que relaciona una ocupación con un certificado (relaciones.py), con los casos que la motivaron."""

    GENERICAS = relaciones.que_no_distinguen({})
    # COMV0108: un código de la CNO-94 que el INE pasa a seis grupos, otro sin código propio y uno de la CNO-11.
    VENTA = {
        "codigo": "COMV0108",
        "ocupaciones": ["52201121"],
        "anexo": {
            "ocupaciones": [
                linea("53300010", "Dependiente de comercio", "cno94", ["5220", "5411", "5412", "5430", "5492", "5499"]),
                linea(None, "Vendedor/a", "sin-codigo", []),
                linea("52201121", "Dependiente de floristería", "cno11", ["5220"]),
            ]
        },
    }

    def ocupacion(
        self, eures: list[tuple[str, str, str]], nombres: list[str], del_isco: tuple[str, ...] = ()
    ) -> relaciones.Ocupacion:
        """Una ocupación con sus filas de EURES, sus nombres y los grupos de su ISCO-08.

        Returns:
            Códigos, grupos y palabras de la ocupación ESCO.
        """
        return relaciones.ocupacion(eures, list(del_isco), nombres, self.GENERICAS)

    def test_raices_y_palabras_que_no_distinguen(self) -> None:
        """Sin tildes, plural ni género; los puestos y las palabras de más de 100 ocupaciones no cuentan."""
        self.assertEqual(relaciones.raices("Dependientes de Comercio"), ["depend", "comerc"])
        self.assertEqual(relaciones.raiz("recepción"), relaciones.raiz("recepcionista"))
        self.assertIn(relaciones.raiz("técnico".replace("é", "e")), self.GENERICAS)
        frecuente = {
            f"o{numero}": ["experto en comercio"] for numero in range(relaciones.MAX_OCUPACIONES_CON_LA_PALABRA + 1)
        }
        self.assertIn("comerc", relaciones.que_no_distinguen(frecuente))
        self.assertNotIn("comerc", relaciones.que_no_distinguen({"o1": ["dependiente de comercio"]}))

    def test_raiz_de_palabras_cortas_tal_como_la_describe(self) -> None:
        """En palabras cortas, singular, plural y género pueden dar raíces distintas; en las largas coinciden."""
        self.assertEqual([relaciones.raiz(palabra) for palabra in ("jefe", "jefa", "jefes")], ["jefe", "jefa", "jef"])
        self.assertEqual(relaciones.raiz("dependientes"), relaciones.raiz("dependienta"))

    def test_las_raices_de_cada_texto_se_calculan_una_vez(self) -> None:
        """La regla recuerda las raíces de cada nombre y línea de anexo: no las repite por cada ocupación."""
        relaciones._palabras_de.cache_clear()
        tienda = self.ocupacion([("52201079", "exacta", "DEPENDIENTES DE COMERCIO, EN GENERAL")], ["dependiente"])
        for _ in range(3):
            relaciones.relacion(self.VENTA, tienda, self.GENERICAS)
        informe = relaciones._palabras_de.cache_info()
        self.assertGreater(informe.hits, 0)
        self.assertEqual(relaciones.RAICES_DE_FUNCIONES, frozenset({"calida"}))

    def test_codigos_grupos_y_palabras_de_una_ocupacion(self) -> None:
        """Las variantes más específicas no son sus códigos; sin código propio, sus grupos son los de su ISCO-08."""
        tienda = self.ocupacion(
            [("52201079", "exacta", "DEPENDIENTES DE COMERCIO, EN GENERAL"), ("52201165", "estrecha", "X")],
            ["asistente de tienda"],
            ["5220"],
        )
        self.assertEqual((tienda.codigos, tienda.grupos), (frozenset({"52201079"}), frozenset({"5220"})))
        self.assertTrue({"depend", "comerc", "tiend"} <= tienda.palabras)
        sin_codigo = self.ocupacion([("44221010", "estrecha", "RECEPCIONISTAS DE HOTEL")], ["recepcionista"], ["4422"])
        self.assertEqual((sin_codigo.codigos, sin_codigo.grupos), (frozenset(), frozenset({"4422"})))

    def test_por_grupo_solo_si_el_anexo_nombra_la_misma_ocupacion(self) -> None:
        """«Dependiente de comercio» vale para la asistente de tienda, no para el vendedor de gasolinera.

        Una ocupación de 8 cifras de otro oficio del mismo grupo («Dependiente de floristería») no relaciona al joyero.
        """
        tienda = self.ocupacion(
            [("52201079", "exacta", "DEPENDIENTES DE COMERCIO, EN GENERAL")], ["asistente de tienda"]
        )
        gasolinera = self.ocupacion([("54301015", "exacta", "EXPENDEDORES DE GASOLINERAS")], ["vendedor de gasolinera"])
        florista = self.ocupacion([("52201121", "exacta", "DEPENDIENTES DE FLORISTERÍA")], ["florista"])
        joyero = self.ocupacion([("52201307", "exacta", "DEPENDIENTES DE JOYERÍA")], ["vendedor de joyas"])
        self.assertEqual(relaciones.relacion(self.VENTA, tienda, self.GENERICAS), "grupo")
        self.assertIsNone(relaciones.relacion(self.VENTA, gasolinera, self.GENERICAS))
        self.assertEqual(relaciones.relacion(self.VENTA, florista, self.GENERICAS), "ocupacion")
        sin_floristeria = {**self.VENTA, "anexo": {"ocupaciones": self.VENTA["anexo"]["ocupaciones"][2:]}}
        self.assertIsNone(relaciones.relacion(sin_floristeria, joyero, self.GENERICAS), "otro oficio del grupo")
        self.assertIsNone(relaciones.relacion({**self.VENTA, "anexo": None, "ocupaciones": []}, tienda, self.GENERICAS))

    def test_sin_codigo_propio_cuenta_la_linea_de_otra_ocupacion_que_es_la_suya(self) -> None:
        """Sin código propio, una línea de 8 cifras de su grupo vale si nombra su ocupación con otras palabras."""
        hotel = {
            "codigo": "HOTA0308",
            "ocupaciones": ["44221010"],
            "anexo": {"ocupaciones": [linea("44221010", "Recepcionista de hotel", "cno11", ["4422"])]},
        }
        alojamientos = self.ocupacion(
            [("44221010", "estrecha", "RECEPCIONISTAS DE HOTEL")],
            ["recepcionista de alojamientos turísticos"],
            ["4422"],
        )
        camarera = self.ocupacion([], ["camarera de pisos"], ["4422"])
        self.assertEqual(relaciones.relacion(hotel, alojamientos, self.GENERICAS), "grupo")
        self.assertIsNone(relaciones.relacion(hotel, camarera, self.GENERICAS))

    def test_una_funcion_de_cualquier_oficio_sola_no_relaciona(self) -> None:
        """«Técnico en control de calidad» no dice de qué oficio: no relaciona por grupo los ensayos de motores.

        Con el oficio en la línea («… en industrias alimentarias») la relación por grupo sigue valiendo, y en un
        certificado de control de calidad la línea nombra su propio trabajo.
        """
        genericas = self.GENERICAS | {"contro", "indust"}  # las llevan más de 100 ocupaciones ESCO
        editorial = {
            "codigo": "ARGN0109",
            "ocupaciones": [],
            "anexo": {"ocupaciones": [linea("30730067", "- Técnico en control de calidad", "cno94", ["3119"])]},
        }
        carnicas = {
            "codigo": "INAI0109",
            "ocupaciones": [],
            "anexo": {
                "ocupaciones": [
                    linea("31601052", "Técnico en control de calidad en industrias alimentarias", "cno11", ["3119"])
                ]
            },
        }
        motores = relaciones.ocupacion(
            [], ["3119"], ["especialista en ensayos y control de calidad de motores de vehículos"], genericas
        )
        alimentos = relaciones.ocupacion([], ["3119"], ["técnico de control de calidad de alimentos"], genericas)
        self.assertIsNone(relaciones.relacion(editorial, motores, genericas))
        self.assertIsNone(relaciones.relacion(editorial, alimentos, genericas))
        self.assertEqual(relaciones.relacion(carnicas, alimentos, genericas), "grupo")
        textil_y_piel = {
            "codigo": "TCPF0312",
            "nombre_es": "Control de calidad de productos en textil y piel",
            "ocupaciones": [],
            "anexo": {
                "ocupaciones": [linea("31601159", "Técnicos en control de calidad, en general", "cno11", ["3119"])]
            },
        }
        calzado = relaciones.ocupacion([], ["3119"], ["técnico de calidad del calzado"], genericas)
        self.assertEqual(relaciones.relacion(textil_y_piel, calzado, genericas), "grupo")

    def test_grupo_isco_por_mayoria(self) -> None:
        """Un grupo sin ocupación ESCO lleva los certificados de más de la mitad de sus ocupaciones; si no, ninguno."""
        por_ocupacion = {"a": {"COMV0108": "grupo", "ARTB0112": "grupo"}, "b": {"COMV0108": "grupo"}, "c": {}}
        self.assertEqual(relaciones.del_grupo(por_ocupacion, ["a", "b", "c"]), {"COMV0108": "grupo"})
        self.assertEqual(relaciones.del_grupo(por_ocupacion, ["a", "c"]), {})
        self.assertEqual(relaciones.del_grupo(por_ocupacion, []), {})

    def test_variante_del_bloque(self) -> None:
        """Solo lo que la Agència no ofrece queda fuera: con solo eso, el bloque lo dice; sin nada, la línea neutra.

        Trasllat sanitari (SANT0208) es de Sanidad y se acredita como los demás; Tanatopràxia (SANP0108), no.
        """

        def variante(encontradas: dict[str, str]) -> str:
            """La variante, con Tanatopràxia como única cualificación que la Agència no acredita.

            Returns:
                Clase de variante de la relación.
            """
            return relaciones.variante(encontradas, {"SANP0108"})

        self.assertEqual(variante({"ADGD0308": "ocupacion", "SANP0108": "ocupacion"}), "por-ocupacion")
        self.assertEqual(variante({"ADGD0308": "grupo", "SANP0108": "ocupacion"}), "por-grupo")
        self.assertEqual(variante({"SANT0208": "ocupacion"}), "por-ocupacion")
        self.assertEqual(variante({"SANP0108": "ocupacion"}), "sanidad")
        self.assertEqual(variante({}), "sin-relacion")
