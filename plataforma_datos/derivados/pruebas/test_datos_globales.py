"""Composición de datos globales: nombres, series y rechazo contextual de entradas incompletas."""

import copy
import json
import unittest
from pathlib import Path
from unittest import mock

import plataforma_datos.derivados.fuentes.datos_globales.lector as datos_globales
from plataforma_datos.comun.nucleo import FormatoInesperado, ValidacionFallida


def entradas_minimas() -> dict:
    """Entradas de prueba para nombres, estructura y orden, sin fuentes operativas externas.

    Returns:
        Una copia independiente de las entradas mínimas.
    """
    return json.loads((Path(__file__).parent / "fixtures/entradas-globales-minimas.json").read_text(encoding="utf-8"))


class PruebaComposicion(unittest.TestCase):
    """Lo que la composición decide por su cuenta, con entradas mínimas."""

    def test_una_cifra_de_la_columna_de_poco_fiables_lleva_su_nota_aunque_no_traiga_marca(self) -> None:
        """Sin marca, una cifra que sale de pct_poco_fiable no se da como firme."""
        por_anio = {"2025": {"pct": None, "pct_poco_fiable": 12.5}}
        empresas = {
            "cataluna_por_seccion": {"actividades": {datos_globales.ACTIVIDADES_DE_LA_ENCUESTA: {"por_anio": por_anio}}}
        }
        (valor,) = datos_globales.serie_de_empresas_de_cataluna(empresas)
        self.assertEqual((valor["valor"], valor["nota"]), (12.5, "poco_fiable"))

    def test_una_entrada_sin_lo_que_lee_la_composicion_se_detiene_diciendo_la_ruta(self) -> None:
        """Una clave anidada que falta o un tipo que no es el esperado: FormatoInesperado con la fuente y la ruta."""
        entradas = entradas_minimas()
        empresas = copy.deepcopy(entradas["empresas"])
        del empresas["cataluna_por_seccion"]["actividades"][datos_globales.ACTIVIDADES_DE_LA_ENCUESTA]["por_anio"]
        with self.assertRaisesRegex(FormatoInesperado, "«empresas» no trae cataluna_por_seccion → actividades"):
            datos_globales.exigir_forma("empresas", empresas)
        with self.assertRaisesRegex(FormatoInesperado, r"«ceo-panel» no trae anio \(int\)"):
            datos_globales.exigir_forma("ceo-panel", {**entradas["ceo-panel"], "anio": "2025"})
        with (
            mock.patch.object(datos_globales, "leer_validado", side_effect=lambda _fuente: {}),
            self.assertRaisesRegex(FormatoInesperado, "«mundo-eurostat» no trae cifras"),
        ):
            datos_globales.leer_entradas()

    def test_en_catalan_el_gran_grupo_9_lleva_el_nombre_de_la_cco_2011(self) -> None:
        """En catalán, el gran grupo 9 se nombra como en la CCO-2011 (ca); los demás, como en la CIUO-2008 (ca)."""
        entradas = entradas_minimas()
        idescat = entradas["idescat"]
        nombres = {
            indicador["id"]: indicador["nombre"]["ca"]
            for indicador in datos_globales.indicadores(entradas["clasificaciones"], idescat)
            if indicador["id"].startswith(("empleo-isco-", "mujeres-isco-"))
        }
        self.assertEqual(idescat["cno11_ca"]["9"], "Ocupacions elementals")
        for grupo in "123456789":
            catalan = idescat["cno11_ca" if grupo == "9" else "isco08_ca"][grupo]
            self.assertEqual(nombres[f"empleo-isco-{grupo}"], f"Ocupació al gran grup {grupo}: {catalan}")
            self.assertEqual(nombres[f"mujeres-isco-{grupo}"], f"Dones al gran grup {grupo}: {catalan}")


class EntradasIncompletas(unittest.TestCase):
    """Los errores identifican el dato requerido antes de indexarlo u ordenar por él."""

    def test_nombre_de_grupo_ausente(self) -> None:
        """Una clasificación incompleta identifica fuente y grupo."""
        for fuente, clave, grupo in (
            ("clasificaciones", "isco08_es", "4"),
            ("clasificaciones", "isco08_es", "0"),
            ("clasificaciones", "isco08_es", "9"),
            ("idescat", "isco08_ca", "4"),
            ("idescat", "isco08_ca", "0"),
            ("idescat", "cno11_ca", "9"),
        ):
            entradas = entradas_minimas()
            del entradas[fuente][clave][grupo]
            with (
                self.subTest(fuente=fuente, clave=clave),
                self.assertRaisesRegex(FormatoInesperado, f"{fuente}.*{clave}.*{grupo}"),
            ):
                datos_globales.indicadores(entradas["clasificaciones"], entradas["idescat"])

    def test_serie_eurostat_ausente(self) -> None:
        """La ausencia de una serie no escapa como KeyError."""
        for cifras in ({}, {"empresas-ia": None}, {"empresas-ia": []}):
            with self.subTest(cifras=cifras), self.assertRaisesRegex(FormatoInesperado, "mundo-eurostat.*cifras"):
                datos_globales.valores_por_territorio({"cifras": cifras}, {"paises": {}}, {"paises": {}}, {})

    def test_territorio_sin_correspondencia(self) -> None:
        """Una serie no puede asociarse a un país que no figura en territorios."""
        cifras = {fila["id"]: {} for fila in datos_globales.INDICADORES_EUROSTAT}
        cifras["empresas-ia"]["ES"] = []
        for correspondencias in ({}, {"ES": None}):
            with (
                self.subTest(correspondencias=correspondencias),
                self.assertRaisesRegex(FormatoInesperado, "mundo-eurostat.*ES"),
            ):
                datos_globales.valores_por_territorio(
                    {"cifras": cifras}, {"paises": {}}, {"paises": {}}, correspondencias
                )

    def test_parte_de_empleo_ausente(self) -> None:
        """La parte que falta se identifica en su país."""
        cifras = {fila["id"]: {} for fila in datos_globales.INDICADORES_EUROSTAT}
        for parte, otra in (("empleo", "mujeres"), ("mujeres", "empleo")):
            with self.subTest(parte=parte), self.assertRaisesRegex(FormatoInesperado, "ilostat.*ESP.*" + parte):
                datos_globales.valores_por_territorio(
                    {"cifras": cifras}, {"paises": {"ESP": {"anio": 2025, otra: {}}}}, {"paises": {}}, {}
                )

    def test_indicador_fuera_del_catalogo(self) -> None:
        """Una serie desconocida no puede ordenarse como si tuviera posición."""
        with self.assertRaisesRegex(FormatoInesperado, "ue-eurostat.*desconocido"):
            datos_globales.de_la_ue([{"indicador": "desconocido"}], {"cifras": {}}, [])
        entradas = entradas_minimas()
        entradas.update({"tic-llars": {"cifras": {}}, "clima-empresarial": {"cifras": {}}})
        with self.assertRaisesRegex(FormatoInesperado, "Cataluña.*desconocido"):
            datos_globales.cataluna(entradas, [{"indicador": "desconocido"}], ["empresas-ia"])

    def test_fecha_de_consulta_invalida_identifica_fuente_y_campo(self) -> None:
        """El calendario y el tipo se diagnostican con origen; una fecha bisiesta válida se conserva."""
        fuente = "mundo-eurostat"
        for consultado in ("2026-02-30", 7):
            with (
                self.subTest(consultado=consultado),
                self.assertRaisesRegex(FormatoInesperado, fuente + ".*consultado"),
            ):
                datos_globales._fecha_de_consulta(fuente, {"consultado": consultado})
        fecha_valida = "2024-02-29"
        self.assertEqual(
            datos_globales._fecha_de_consulta(fuente, {"consultado": fecha_valida}).isoformat(), fecha_valida
        )

    def test_validar_forma_defectuosa_se_detiene_antes_de_usarla(self) -> None:
        """Una estructura inválida no llega al cómputo de cobertura ni a publicación."""
        for entrada in (None, [], {"indicadores": None}, {"territorios": None}):
            with (
                self.subTest(entrada=entrada),
                mock.patch.object(datos_globales, "leer_json", return_value=entrada),
                mock.patch.object(datos_globales, "cerrar_validacion") as cerrar,
                self.assertRaises(ValidacionFallida),
            ):
                datos_globales.validar()
            cerrar.assert_not_called()


class PruebaMarcaSinNota(unittest.TestCase):
    """Una cifra de Cataluña con una marca de Eurostat que no tiene nota no se da como firme."""

    def test_marca_desconocida(self) -> None:
        """Una marca fuera de NOTA_DE_LA_MARCA detiene la composición diciendo cuál."""
        por_anio = {"2025": {"pct": 20.0, "marca": "x"}}
        empresas = {
            "cataluna_por_seccion": {"actividades": {datos_globales.ACTIVIDADES_DE_LA_ENCUESTA: {"por_anio": por_anio}}}
        }
        with self.assertRaisesRegex(FormatoInesperado, "la marca «x» de Eurostat en Cataluña, 2025"):
            datos_globales.serie_de_empresas_de_cataluna(empresas)

    def test_marca_compuesta_conocida_conserva_la_nota_prioritaria(self) -> None:
        """Una cifra regional be tiene la misma nota estimada que los demás consumidores de Eurostat."""
        por_anio = {"2026": {"pct": 20.0, "marca": "be"}}
        empresas = {
            "cataluna_por_seccion": {"actividades": {datos_globales.ACTIVIDADES_DE_LA_ENCUESTA: {"por_anio": por_anio}}}
        }
        (valor,) = datos_globales.serie_de_empresas_de_cataluna(empresas)
        self.assertEqual(valor, {"indicador": "empresas-ia", "valor": 20.0, "anio": 2026, "nota": "estimada"})


if __name__ == "__main__":
    unittest.main()
