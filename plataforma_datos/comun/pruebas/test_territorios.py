"""Pruebas de los nombres de países de CLDR y los códigos de territorio (territorios.py)."""

import copy
import unittest
from typing import Any

import plataforma_datos.comun.fuentes.territorios.lector as territorios
from plataforma_datos.comun.nucleo import FormatoInesperado


class PruebaTerritorios(unittest.TestCase):
    """Solo países, con su código de tres letras y sus dos nombres."""

    def test_sin_agrupaciones_regiones_ni_variantes(self) -> None:
        """De los territorios de CLDR solo quedan los países: sin agrupaciones, regiones ni variantes de nombre."""

        def nombres(lengua: str, valores: dict[str, str]) -> dict[str, Any]:
            return {"main": {lengua: {"localeDisplayNames": {"territories": valores}}}}

        es = nombres("es", {"ES": "España", "EU": "Unión Europea", "150": "Europa", "XK": "Kosovo", "ES-alt-x": "?"})
        ca = nombres("ca", {"ES": "Espanya", "EU": "Unió Europea", "150": "Europa", "XK": "Kosovo"})
        codigos = {"supplemental": {"codeMappings": {"ES": {"_alpha3": "ESP"}, "EU": {}, "XK": {"_alpha3": "XKK"}}}}
        self.assertEqual(
            territorios.nombres_de_paises(es, ca, codigos),
            {
                "ES": {"iso3": "ESP", "es": "España", "ca": "Espanya"},
                "XK": {"iso3": "XKK", "es": "Kosovo", "ca": "Kosovo"},
            },
        )

    def test_los_codigos_reservados_o_de_uso_del_usuario_no_son_paises_salvo_kosovo(self) -> None:
        """ISO 3166-1, apartado 7: ni AA, QM–QZ, XA–XZ ni ZZ (salvo XK), ni los reservados excepcionalmente."""
        no_son = ("AA", "QM", "QO", "QZ", "XA", "XB", "XZ", "ZZ", "AC", "CP", "DG", "EA", "EU", "IC", "TA", "UN", "150")
        self.assertEqual([codigo for codigo in no_son if territorios.es_pais(codigo)], [])
        self.assertTrue(all(territorios.es_pais(codigo) for codigo in ("XK", "ES", "QA", "SH", "GB")))

    def test_los_tres_originales_tienen_que_ser_de_la_version_fijada(self) -> None:
        """Los de nombres, por la etiqueta de su dirección (cldr-json no la lleva dentro); los códigos, por la suya."""

        def procedencia(version_ca: str) -> dict[str, Any]:
            base = "https://raw.githubusercontent.com/unicode-org/cldr-json"
            ruta = "cldr-json/cldr-localenames-full/main"
            return {
                "archivos": [
                    {"archivo": "cldr-territorios-es.json", "url": f"{base}/48.0.0/{ruta}/es/territories.json"},
                    {"archivo": "cldr-territorios-ca.json", "url": f"{base}/{version_ca}/{ruta}/ca/territories.json"},
                ]
            }

        def codigos(version: str) -> dict[str, Any]:
            return {"supplemental": {"version": {"_unicodeVersion": "16.0.0", "_cldrVersion": version}}}

        territorios.comprobar_versiones(codigos("48"), procedencia("48.0.0"))
        with self.assertRaisesRegex(
            FormatoInesperado, r"se espera la versión 48.0.0; leídas \{'cldr-territorios-ca.json': '47.0.0'\}"
        ):
            territorios.comprobar_versiones(codigos("48"), procedencia("47.0.0"))
        with self.assertRaisesRegex(FormatoInesperado, r"leídas \{'cldr-codigos.json': '47'\}"):
            territorios.comprobar_versiones(codigos("47"), procedencia("48.0.0"))

    def test_los_codigos_propios_de_eurostat_pasan_a_iso(self) -> None:
        """Los codigos propios de eurostat pasan a iso."""
        self.assertEqual([territorios.iso2_de_eurostat(codigo) for codigo in ("EL", "UK", "ES")], ["GR", "GB", "ES"])


class PruebaFormatoCldr(unittest.TestCase):
    """Los originales inválidos se explican antes de producir un catálogo recortado."""

    def setUp(self) -> None:
        """Una captura mínima válida con dos países para aislar errores de forma y pérdidas."""
        self.es = {"main": {"es": {"localeDisplayNames": {"territories": {"ES": "España", "FR": "Francia"}}}}}
        self.ca = {"main": {"ca": {"localeDisplayNames": {"territories": {"ES": "Espanya", "FR": "França"}}}}}
        self.codigos = {
            "supplemental": {
                "codeMappings": {"ES": {"_alpha3": "ESP"}, "FR": {"_alpha3": "FRA"}},
                "version": {"_cldrVersion": "48"},
            }
        }
        self.procedencia = {
            "archivos": [
                {"archivo": nombre, "url": f"https://ejemplo.test/cldr-json/48.0.0/{lengua}"}
                for nombre, lengua in ((territorios.NOMBRES_ES, "es"), (territorios.NOMBRES_CA, "ca"))
            ]
        }

    def test_la_estructura_de_nombres_declara_archivo_y_campo(self) -> None:
        """Un objeto ausente o de otro tipo no escapa como KeyError ni AttributeError."""
        for es in ({}, {"main": []}, {"main": {"es": {"localeDisplayNames": {"territories": []}}}}):
            with self.subTest(es=es), self.assertRaisesRegex(FormatoInesperado, "cldr-territorios-es.json.*main"):
                territorios.nombres_de_paises(es, self.ca, self.codigos)

    def test_la_estructura_de_codigos_declara_archivo_y_campo(self) -> None:
        """Las correspondencias deben ser un objeto, incluido cada país utilizado."""
        for codigos in ({}, {"supplemental": {"codeMappings": []}}, {"supplemental": {"codeMappings": {"ES": None}}}):
            with self.subTest(codigos=codigos), self.assertRaisesRegex(FormatoInesperado, "cldr-codigos.json"):
                territorios.nombres_de_paises(self.es, self.ca, codigos)

    def test_las_ausencias_de_nombre_ca_o_iso3_conservan_el_filtro(self) -> None:
        """Una correspondencia o nombre ausente conserva la omisión declarada por la fuente."""
        ca, codigos = copy.deepcopy(self.ca), copy.deepcopy(self.codigos)
        del ca["main"]["ca"]["localeDisplayNames"]["territories"]["FR"]
        del codigos["supplemental"]["codeMappings"]["FR"]
        for nombres_ca, correspondencias in ((ca, self.codigos), (self.ca, codigos)):
            with self.subTest(ca=nombres_ca):
                self.assertEqual(list(territorios.nombres_de_paises(self.es, nombres_ca, correspondencias)), ["ES"])

    def test_los_nombres_y_codigos_son_textos_con_forma(self) -> None:
        """Ni nombres vacíos ni ISO3 numéricos o incompletos llegan a preparar."""
        for valor in (123, "ES", []):
            codigos = copy.deepcopy(self.codigos)
            codigos["supplemental"]["codeMappings"]["FR"]["_alpha3"] = valor
            with self.subTest(valor=valor), self.assertRaisesRegex(FormatoInesperado, "cldr-codigos.json.*FR"):
                territorios.nombres_de_paises(self.es, self.ca, codigos)
        for valor in (None, 123, "", []):
            ca = copy.deepcopy(self.ca)
            ca["main"]["ca"]["localeDisplayNames"]["territories"]["FR"] = valor
            with self.subTest(valor=valor), self.assertRaisesRegex(FormatoInesperado, "cldr-territorios-ca.json.*FR"):
                territorios.nombres_de_paises(self.es, ca, self.codigos)

    def test_cq_conserva_la_omision_de_cldr48_sin_inventar_iso3(self) -> None:
        """La captura fijada nombra CQ en ambas lenguas y no le asigna alfa-3."""
        self.es["main"]["es"]["localeDisplayNames"]["territories"]["CQ"] = "Sark"
        self.ca["main"]["ca"]["localeDisplayNames"]["territories"]["CQ"] = "Sark"
        paises = territorios.nombres_de_paises(self.es, self.ca, self.codigos)
        self.assertEqual(list(paises), ["ES", "FR"])

    def test_version_y_procedencia_invalidas_se_diagnostican(self) -> None:
        """Las versiones o entradas de procedencia mal formadas no producen errores de indexación."""
        for codigos, procedencia, archivo in (
            ({}, self.procedencia, territorios.CODIGOS),
            (self.codigos, {}, "procedencia.json"),
            (self.codigos, {"archivos": [None]}, "procedencia.json"),
            (self.codigos, {"archivos": [{"archivo": territorios.NOMBRES_ES, "url": None}]}, "procedencia.json"),
        ):
            with self.subTest(archivo=archivo), self.assertRaisesRegex(FormatoInesperado, archivo):
                territorios.comprobar_versiones(codigos, procedencia)


if __name__ == "__main__":
    unittest.main()
