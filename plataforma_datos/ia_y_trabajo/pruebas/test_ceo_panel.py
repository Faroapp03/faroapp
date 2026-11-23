"""Pruebas del Panel Ciutadà del CEO (`ceo_panel`) sin dependencias del compositor."""

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

import plataforma_datos.ia_y_trabajo.fuentes.ceo_panel.lector as ceo_panel
from plataforma_datos.comun.nucleo import FormatoInesperado


def fila(modo: str, respuesta: str, peso: str) -> dict[str, str]:
    """Compone una fila de los microdatos, con solo las columnas que se leen.

    Args:
        modo: modo de administración de la encuesta (en línea o papel).
        respuesta: respuesta a la pregunta, con la etiqueta del CEO.
        peso: peso de la fila, con coma decimal; en blanco si el modo no tiene la pregunta.

    Returns:
        Fila del CSV por nombre de columna.
    """
    return {ceo_panel.MODO: modo, ceo_panel.VARIABLE: respuesta, ceo_panel.PESO: peso}


class PruebaLectura(unittest.TestCase):
    """De las filas del CSV a los pesos de cada respuesta en línea."""

    def test_solo_cuentan_las_respuestas_en_linea_con_su_peso(self) -> None:
        """El papel no tiene la pregunta (peso en blanco): cuenta en la muestra, no en la base."""
        filas = [
            fila(ceo_panel.EN_LINEA, "7", ",5"),
            fila(ceo_panel.EN_LINEA, "7", "1,5"),
            fila(ceo_panel.EN_LINEA, "0 Gens probable", "2"),
            fila("Paper", "Valor perdut per mode d'administració de l'enquesta", " "),
        ]
        leido = ceo_panel.leer_microdatos(filas)
        self.assertEqual(leido["filas"], 4)
        self.assertEqual(leido["por_modo"], {"En línia": 3, "Paper": 1})
        self.assertEqual(leido["ponderado_en_linea"], {"0 Gens probable": 2.0, "7": 2.0})

    def test_de_7_a_10_sobre_toda_la_base_con_las_omisiones_dentro(self) -> None:
        """Como la tabla del CEO: las omisiones están en la base; la media, sin ellas."""
        ponderado = dict.fromkeys(ceo_panel.ESCALA, 0.0)
        ponderado.update({"10 Totalment probable": 1.0, "8": 1.0, "2": 1.0, ceo_panel.OMISION: 1.0})
        self.assertEqual(ceo_panel.porcentaje_de_7_a_10(ponderado), 50.0)
        self.assertEqual(ceo_panel.media(ponderado), 6.67)

    def test_el_redondeo_es_a_la_mitad_hacia_arriba(self) -> None:
        """10,85 sube a 10,9 y 2,675 a 2,68, donde round de Python da 10,8 y 2,67 por la representación binaria."""
        self.assertEqual(ceo_panel.redondeo(10.85, 1), 10.9)
        self.assertEqual(ceo_panel.redondeo(2.675, 2), 2.68)
        self.assertEqual(ceo_panel.redondeo(51.438356, 1), 51.4)

    def test_las_frecuencias_publicadas_se_redondean_como_las_del_ceo(self) -> None:
        """846,5 es 847 en la tabla del CEO (round de Python daría 846, al par); lo que falta es 0."""
        ponderado = {"7": 1236.6, "8": 846.5, "9": 227.4}
        self.assertEqual(
            ceo_panel.frecuencias_publicadas(ponderado), {"7": 1237, "8": 847, "9": 227, "10 Totalment probable": 0}
        )


class PruebaMicrodatosConOtraForma(unittest.TestCase):
    """Si el CEO cambia el archivo, la lectura se detiene diciendo qué falta y dónde."""

    def test_una_columna_que_falta(self) -> None:
        """Sin la columna del peso, el error nombra la fila y la columna, no un KeyError sin contexto."""
        fila = {ceo_panel.MODO: ceo_panel.EN_LINEA, ceo_panel.VARIABLE: "7"}
        with self.assertRaisesRegex(FormatoInesperado, f"fila 1 .*{ceo_panel.PESO}"):
            ceo_panel.leer_microdatos([fila])

    def test_un_peso_que_no_es_un_numero(self) -> None:
        """Un peso ilegible o no finito detiene la lectura con su fila."""
        for peso in ("abc", "inf", "nan"):
            fila = {ceo_panel.MODO: ceo_panel.EN_LINEA, ceo_panel.VARIABLE: "7", ceo_panel.PESO: peso}
            with self.subTest(peso=peso), self.assertRaisesRegex(FormatoInesperado, "fila 2"):
                ceo_panel.leer_microdatos([{**fila, ceo_panel.PESO: "1,5"}, fila])

    def test_la_consulta_se_toma_del_csv_y_no_del_primer_archivo(self) -> None:
        """La fecha de consulta es la del CSV aunque la procedencia traiga otro archivo antes."""
        procedencia = {
            "archivos": [
                {"archivo": "ficha.pdf", "descargado_utc": "2026-01-01T00:00:00Z"},
                {"archivo": ceo_panel.ARCHIVO, "descargado_utc": "2026-10-05T10:00:00Z"},
            ]
        }
        self.assertEqual(ceo_panel.consulta_del_csv(procedencia), "2026-10-05")
        with self.assertRaises(FormatoInesperado):
            ceo_panel.consulta_del_csv({"archivos": [procedencia["archivos"][0]]})

    def test_no_se_redondea_una_cifra_no_finita(self) -> None:
        """El redondeo de las tablas no acepta infinitos ni NaN."""
        with self.assertRaises(FormatoInesperado):
            ceo_panel.redondeo(float("inf"), 1)


class PruebaLimitesAuditados(unittest.TestCase):
    """Estructura del CSV/preparado y trazabilidad antes de cualquier cálculo."""

    def test_preparar_exige_csv_con_columnas_unicas_y_datos(self) -> None:
        """Vacío, sin filas, columna repetida o separador cambiado: diagnóstico con archivo."""
        cabecera = f"{ceo_panel.MODO};{ceo_panel.VARIABLE};{ceo_panel.PESO}"
        casos = (
            "",
            cabecera + "\n",
            cabecera + f";{ceo_panel.PESO}\nEn línia;7;1;9\n",
            cabecera.replace(";", ",") + "\nEn línia,7,1\n",
        )
        with TemporaryDirectory() as temporal:
            ruta = Path(temporal) / ceo_panel.ARCHIVO
            for contenido in casos:
                ruta.write_text(contenido, encoding=ceo_panel.CODIFICACION)
                with (
                    self.subTest(contenido=contenido),
                    patch.object(ceo_panel, "comprobar_originales"),
                    patch.object(ceo_panel, "original", return_value=ruta),
                    patch.object(ceo_panel, "guardar_json"),
                    self.assertRaisesRegex(FormatoInesperado, ceo_panel.ARCHIVO),
                ):
                    ceo_panel.preparar()

    def test_peso_negativo_y_modo_desconocido_se_nombran(self) -> None:
        """Una ponderación negativa o un modo nuevo no se incorpora silenciosamente."""
        self.assertEqual(
            ceo_panel.leer_microdatos([fila(ceo_panel.EN_LINEA, "7", "0")])["ponderado_en_linea"], {"7": 0.0}
        )
        for registro, contexto in (
            (fila(ceo_panel.EN_LINEA, "7", "-1"), "peso.*fila 1"),
            (fila("Telèfon", "7", "1"), "modo.*fila 1"),
        ):
            with self.subTest(registro=registro), self.assertRaisesRegex(FormatoInesperado, contexto):
                ceo_panel.leer_microdatos([registro])

    def test_preparado_malformado_se_diagnostica_antes_de_calcular(self) -> None:
        """Tipos y pesos del preparado inválidos producen un error contextual."""
        correcto = {
            "filas": 12,
            "por_modo": {ceo_panel.EN_LINEA: 12},
            "ponderado_en_linea": dict.fromkeys((*ceo_panel.ESCALA, ceo_panel.OMISION), 1.0),
        }
        casos = [[], {}, {**correcto, "por_modo": []}, {**correcto, "ponderado_en_linea": []}]
        for valor in ("1", True, -1, float("nan"), float("inf")):
            casos.append({**correcto, "ponderado_en_linea": {**correcto["ponderado_en_linea"], "7": valor}})
        casos.extend({**correcto, "filas": valor} for valor in ("12", True, -1))
        casos.append({**correcto, "por_modo": {"Telèfon": 12}})
        for preparado in casos:
            with (
                self.subTest(preparado=preparado),
                patch.object(ceo_panel, "controles_de_huella"),
                self.assertRaisesRegex(FormatoInesperado, "ceo-panel.*frecuencias.json"),
            ):
                ceo_panel._controles(preparado, {"archivos": []})

    def test_escala_literal_sin_denominador_no_divide_por_cero(self) -> None:
        """Ni una base nula ni solo omisiones permiten calcular la media."""
        for omision in (0.0, 5.0):
            preparado = {
                "filas": 12,
                "por_modo": {ceo_panel.EN_LINEA: 12},
                "ponderado_en_linea": {**dict.fromkeys(ceo_panel.ESCALA, 0.0), ceo_panel.OMISION: omision},
            }
            with (
                self.subTest(omision=omision),
                patch.object(ceo_panel, "controles_de_huella"),
                self.assertRaisesRegex(FormatoInesperado, "ceo-panel.*base.*positiva"),
            ):
                ceo_panel._controles(preparado, {"archivos": []})

    def test_consulta_exige_fecha_civil_real_con_contexto(self) -> None:
        """La fecha imposible o de otro tipo dice qué archivo y campo fallaron."""
        self.assertEqual(
            ceo_panel.consulta_del_csv(
                {"archivos": [{"archivo": ceo_panel.ARCHIVO, "descargado_utc": "2026-10-05T00:30:00+02:00"}]}
            ),
            "2026-10-05",
        )
        for fecha in ("2026-02-30T12:00:00Z", "no es fecha", None, 20261011):
            with (
                self.subTest(fecha=fecha),
                self.assertRaisesRegex(FormatoInesperado, f"{ceo_panel.ARCHIVO}.*descargado_utc"),
            ):
                ceo_panel.consulta_del_csv({"archivos": [{"archivo": ceo_panel.ARCHIVO, "descargado_utc": fecha}]})


if __name__ == "__main__":
    unittest.main()
