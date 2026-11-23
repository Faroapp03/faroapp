"""Composición de la exposición calculada desde agregados validados de cuatro encuestas."""

import copy
import unittest

import plataforma_datos.derivados.fuentes.datos_globales.piezas.catalogo_calculado as catalogo_calculado
from plataforma_datos.comun.entrada_salida import leer_json
from plataforma_datos.comun.nucleo import RAIZ, FormatoInesperado

PAISES = {
    "BR": {"iso3": "BRA", "es": "Brasil", "ca": "Brasil"},
    "CL": {"iso3": "CHL", "es": "Chile", "ca": "Xile"},
    "CO": {"iso3": "COL", "es": "Colombia", "ca": "Colòmbia"},
    "UY": {"iso3": "URY", "es": "Uruguay", "ca": "Uruguai"},
}


class PruebasComposicionDeLoCalculado(unittest.TestCase):
    """La composición del bloque con el conjunto validado de `encuestas-isco4`."""

    def setUp(self) -> None:
        """Las entradas versionadas de la composición."""
        self.entradas = {
            "encuestas-isco4": leer_json(RAIZ / "plataforma_datos/ia_y_trabajo/pruebas/fixtures/encuestas-isco4.json"),
            "territorios": {"paises": PAISES},
        }

    def test_un_metodo_que_no_es_el_que_describe_la_encuesta_se_detiene(self) -> None:
        """Si el error de muestreo validado no es del método publicado, se detiene diciendo el país."""
        encuestas = copy.deepcopy(self.entradas["encuestas-isco4"])
        encuestas["CHL"]["error_de_muestreo"] = encuestas["COL"]["error_de_muestreo"]
        with self.assertRaisesRegex(FormatoInesperado, "«linealizacion_taylor» de CHL"):
            catalogo_calculado.calculados(encuestas, self.entradas["territorios"]["paises"])

    def test_un_pais_sin_licencia_ni_cita_se_detiene(self) -> None:
        """Un país del conjunto sin su encuesta publicada (licencia, cita) no se compone."""
        encuestas = {**self.entradas["encuestas-isco4"], "PER": self.entradas["encuestas-isco4"]["CHL"]}
        with self.assertRaisesRegex(FormatoInesperado, "se publican"):
            catalogo_calculado.calculados(encuestas, self.entradas["territorios"]["paises"])

    def test_el_validado_trae_las_cifras_de_encuestas_isco4(self) -> None:
        """Cada cifra publicada es la del conjunto validado; con solo cotas, valor null y cotas."""
        datos = {
            "calculados": catalogo_calculado.calculados(
                self.entradas["encuestas-isco4"], self.entradas["territorios"]["paises"]
            )
        }
        cifras = {
            (calculado["id"], valor["territorio"]): (valor["valor"], valor["cotas"] and valor["cotas"]["inferior"])
            for calculado in datos["calculados"]
            for valor in calculado["valores"]
        }
        self.assertEqual(
            cifras,
            {
                ("exposicion-alta", "BRA"): (4.983, None),
                ("exposicion-alta", "CHL"): (None, 2.485),
                ("exposicion-alta", "COL"): (2.966, None),
                ("exposicion-alta", "URY"): (9.49, None),
                ("exposicion-alguna", "BRA"): (29.225, None),
                ("exposicion-alguna", "CHL"): (None, 27.026),
                ("exposicion-alguna", "COL"): (None, 24.895),
                ("exposicion-alguna", "URY"): (29.957, None),
            },
        )

    def test_entradas_anidadas_con_ruta(self) -> None:
        """Un agregado mal formado se detiene con país y campo, sin KeyError/TypeError."""
        cambios = (
            ("CHL", lambda e: e.update(CHL=[])),
            ("error_de_muestreo", lambda e: e["CHL"].update(error_de_muestreo=None)),
            ("alta", lambda e: e["CHL"].update(alta=None)),
            ("desde_95", lambda e: e["CHL"]["alta"].pop("desde_95")),
            ("parte_sin_correspondencia", lambda e: e["CHL"].update(parte_sin_correspondencia="mucho")),
            ("fuente", lambda e: e["CHL"].pop("fuente")),
        )
        for campo, cambio in cambios:
            with self.subTest(campo=campo):
                encuestas = copy.deepcopy(self.entradas["encuestas-isco4"])
                cambio(encuestas)
                with self.assertRaisesRegex(
                    FormatoInesperado, "encuestas-isco4.*CHL" + ("" if campo == "CHL" else ".*" + campo)
                ):
                    catalogo_calculado.calculados(encuestas, self.entradas["territorios"]["paises"])

    def test_valores_e_intervalos_malformados_se_detienen(self) -> None:
        """La composición rechaza un valor o intervalo que no cumple el contrato calculado."""
        for cambio in ({"desde_95": -1}, {"desde_95": 9, "hasta_95": 2}, {"valor": True}, {"valor": 99}):
            with self.subTest(cambio=cambio):
                encuestas = copy.deepcopy(self.entradas["encuestas-isco4"])
                encuestas["BRA"]["alta"].update(cambio)
                with self.assertRaisesRegex(FormatoInesperado, "encuestas-isco4.*BRA.*alta"):
                    catalogo_calculado.calculados(encuestas, self.entradas["territorios"]["paises"])

    def test_nombres_territoriales_con_ruta(self) -> None:
        """Los nombres requeridos faltantes o de otra forma se diagnostican antes de componer."""
        for campo, cambio in (
            ("CHL", lambda p: p.pop("CL")),
            ("CL", lambda p: p.update(CL=[])),
            ("es", lambda p: p["CL"].pop("es")),
            ("iso3", lambda p: p["CL"].update(iso3=[])),
        ):
            with self.subTest(campo=campo):
                paises = copy.deepcopy(self.entradas["territorios"]["paises"])
                cambio(paises)
                with self.assertRaisesRegex(FormatoInesperado, "territorios.*" + campo):
                    catalogo_calculado.calculados(self.entradas["encuestas-isco4"], paises)


if __name__ == "__main__":
    unittest.main()
