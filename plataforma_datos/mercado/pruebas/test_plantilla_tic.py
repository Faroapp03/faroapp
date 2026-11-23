"""Identidades y denominadores distintos en las tablas de plantilla TIC de la ETICCE."""

import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from plataforma_datos.comun.nucleo import FormatoInesperado, ValidacionFallida
from plataforma_datos.mercado.fuentes.empresas.piezas import contrato_eticce, plantilla_tic

EMPRESAS = "I.1.1.B % de empresas con especialistas TIC en Inteligencia Artificial en 2025 (0)"
PERSONAL = "I.1.1.B % de personal especialista TIC en Inteligencia artificial en 2025 (4)"
VALOR_EMPRESAS = 3.82
VALOR_PERSONAL = 4.47


def series_propias() -> list[dict]:
    """Construye dos medidas que comparten código de cuestionario pero no población.

    Returns:
        Series mínimas con el formato de las capturas oficiales, sin datos operativos.
    """
    return [
        {
            "Nombre": f"Total Empresas, {literal}, Total",
            "MetaData": [
                {"T3_Variable": "Agrupación de actividad", "Nombre": "Total Empresas"},
                {"T3_Variable": "Principales variables", "Nombre": literal},
                {"T3_Variable": "Tamaño de la empresa", "Nombre": "Total"},
            ],
            "Data": [{"Valor": valor}],
        }
        for literal, valor in [(EMPRESAS, VALOR_EMPRESAS), (PERSONAL, VALOR_PERSONAL)]
    ]


def contrato_propio() -> dict:
    """Fija un contrato sintético para probar controles independientes de la captura real.

    Returns:
        Contrato de dos medidas con notas y firma semántica completa.
    """
    variables = {
        EMPRESAS: {"nota": "0", "base": "Total de empresas", "unidad": "porcentaje de empresas", "periodo": "2025"},
        PERSONAL: {
            "nota": "4",
            "base": "Total de personal especialista TIC",
            "unidad": "porcentaje de personal",
            "periodo": "2025",
        },
    }
    for datos in variables.values():
        datos.update(origen_periodo="Año explícito de la variable", precision_periodo="anual_explicito_en_variable")
    return {
        "id": plantilla_tic.IDENTIFICADOR,
        "edicion": "2025–1T2026",
        "anio": 2026,
        "clasificacion": "CNAE-2025",
        "poblacion": "Empresas de 10 o más personas del ámbito ETICCE",
        "partes": {
            "sectores": {
                "tabla": "82386",
                "sha256_definicion": plantilla_tic.firma(series_propias()),
                "notas": "Bases: empresas y personal TIC",
            }
        },
        "variables": variables,
    }


class PruebaPlantillaTIC(unittest.TestCase):
    """El código I.1.1.B no puede sustituir a la identidad de medida."""

    def setUp(self) -> None:
        """Usa un contrato cerrado de dos series, no el hogar o las capturas del operador."""
        self.contrato = contrato_propio()
        parche = mock.patch.object(plantilla_tic, "contrato", return_value=self.contrato)
        parche.start()
        self.addCleanup(parche.stop)
        self.edicion = {
            "anio": 2026,
            "nombre": "2025–1T2026",
            "plantilla_tic": {"contrato": plantilla_tic.IDENTIFICADOR, "tablas": {"sectores": "82386"}},
        }
        self.notas = '<ul id="capaListadoNotas"><li>Bases: empresas y personal TIC</li></ul>'

    def filas(self, series: list[dict] | None = None) -> list[dict]:
        """Normaliza únicamente las dos series propias.

        Returns:
            Filas con identidad, base y periodo separados.
        """
        return plantilla_tic.normalizar(
            "sectores", series_propias() if series is None else series, self.notas, self.edicion
        )

    def test_igual_codigo_no_fusiona_empresas_y_personal(self) -> None:
        """La regresión conserva simultáneamente 3.82 y 4.47 con bases distintas."""
        filas = self.filas()
        self.assertEqual([f["valor"] for f in filas], [VALOR_EMPRESAS, VALOR_PERSONAL])
        self.assertEqual([f["nota"] for f in filas], ["0", "4"])
        self.assertEqual([f["unidad"] for f in filas], ["porcentaje de empresas", "porcentaje de personal"])
        self.assertNotEqual(filas[0]["base"], filas[1]["base"])
        self.assertTrue(all(f["periodo"] == "2025" for f in filas))
        self.assertTrue(all(f["territorio"] == "España" for f in filas))
        self.assertEqual([f["serie"] for f in filas], [s["Nombre"] for s in series_propias()])

    def test_cambio_de_literal_nota_categoria_y_serie_se_rechaza(self) -> None:
        """Los mismos valores no admiten una definición ni localizador diferente."""
        original = series_propias()
        for campo in ("literal", "categoria", "serie", "duplicada", "parcial", "periodo_nuevo"):
            series = copy.deepcopy(original)
            if campo == "literal":
                series[1]["MetaData"][1]["Nombre"] = PERSONAL.replace("(4)", "(0)")
            elif campo == "categoria":
                series[1]["MetaData"][0]["Nombre"] = "Otro ámbito"
            elif campo == "serie":
                series[1]["Nombre"] = "Otra serie"
            elif campo == "duplicada":
                series.append(series[0])
            elif campo == "periodo_nuevo":
                series[0]["Data"][0]["Anyo"] = 2024
            else:
                series.pop()
            with self.subTest(campo=campo), self.assertRaises(FormatoInesperado):
                self.filas(series)

    def test_notas_y_edicion_ajenas_no_se_aceptan(self) -> None:
        """No se deduce periodo del reloj ni se acepta una base modificada."""
        for pagina in ("sin notas", self.notas * 2, self.notas.replace("personal TIC", "empresas")):
            with self.subTest(pagina=pagina), self.assertRaises(FormatoInesperado):
                plantilla_tic.normalizar("sectores", series_propias(), pagina, self.edicion)
        for cambio in (
            {"anio": 2099},
            {"nombre": "2026–1T2027"},
            {"plantilla_tic": {"contrato": "ajeno", "tablas": {"sectores": "82386"}}},
        ):
            with self.subTest(cambio=cambio), self.assertRaises(FormatoInesperado):
                plantilla_tic.normalizar("sectores", series_propias(), self.notas, {**self.edicion, **cambio})

    def test_nulo_no_se_convierte_en_cero_y_booleanos_no_son_cifras(self) -> None:
        """Los valores no publicados permanecen nulos; false no es 0."""
        series = series_propias()
        series[0]["Data"][0]["Valor"] = None
        self.assertIsNone(self.filas(series)[0]["valor"])
        for valor in (False, True, float("nan"), float("inf"), -1, 101, "3.82"):
            series[0]["Data"][0]["Valor"] = valor
            with self.subTest(valor=valor), self.assertRaises(FormatoInesperado):
                self.filas(series)

    def test_comparacion_estricta_no_confunde_cero_y_false(self) -> None:
        """La igualdad de filas preparadas compara tipos JSON además de valores."""
        self.assertFalse(plantilla_tic.mismas_filas([{"valor": 0}], [{"valor": False}]))
        self.assertTrue(plantilla_tic.mismas_filas([{"valor": 0}], [{"valor": 0}]))
        self.assertEqual(json.loads(json.dumps(self.filas())), self.filas())


class PruebaAdmisionPlantilla(unittest.TestCase):
    """La nueva medida requiere su contrato real, conservando admisiones históricas de D.1."""

    def test_el_bloque_nuevo_no_se_admite_solo_con_dos_contratos(self) -> None:
        """Omitir el tercer vínculo no convierte plantilla TIC en un conjunto histórico."""
        validacion = {
            "cobertura": {"edicion": "2025–1T2026"},
            "recursos_de_validacion": contrato_eticce.vinculos_actuales(),
        }
        self.assertEqual(len(contrato_eticce.recursos_registrados(validacion)), 2)
        with self.assertRaises(ValidacionFallida):
            contrato_eticce.recursos_registrados(validacion, {"plantilla_tic": {}})
        validacion["cobertura"]["plantilla_tic"] = {"contrato": plantilla_tic.IDENTIFICADOR}
        with self.assertRaises(ValidacionFallida):
            contrato_eticce.recursos_registrados(validacion)

    def test_cambiar_recurso_impide_admitir_y_no_cambia_bytes_fijados(self) -> None:
        """La lectura fijada sirve al cálculo; una mutación posterior impide la admisión."""
        with tempfile.TemporaryDirectory() as temporal:
            ruta = Path(temporal) / "contrato.json"
            ruta.write_bytes(plantilla_tic.RUTA_CONTRATO.read_bytes())
            with (
                mock.patch.object(contrato_eticce, "RUTA_PLANTILLA", ruta),
                contrato_eticce.recursos_en_uso(incluir_plantilla=True) as recursos,
            ):
                observado = plantilla_tic.contrato()
                validacion = {
                    "cobertura": {"edicion": "2025–1T2026", "plantilla_tic": {}},
                    "recursos_de_validacion": recursos,
                }
                contrato_eticce.comprobar_admision(validacion)
                ruta.write_bytes(ruta.read_bytes() + b" ")
                self.assertEqual(plantilla_tic.contrato(), observado)
                with self.assertRaises(ValidacionFallida):
                    contrato_eticce.comprobar_admision(validacion)


if __name__ == "__main__":
    unittest.main()
