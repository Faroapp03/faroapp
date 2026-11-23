"""Pruebas autónomas del Eurobarómetro especial 554: lectura, universo y porcentajes publicados."""

import tempfile
import unittest
import zipfile
from pathlib import Path
from typing import Any
from unittest import mock

import plataforma_datos.ia_y_trabajo.fuentes.eurobarometro.lector as eurobarometro
from plataforma_datos.comun import hojas
from plataforma_datos.comun.nucleo import FormatoInesperado

# Las tres filas de texto se completan hasta las ocho filas de cabecera del volumen A.
FILAS_VACIAS_DE_CABECERA = 5
FILAS_DE_CABECERA = 3 + FILAS_VACIAS_DE_CABECERA


def hoja_del_eurobarometro() -> list[dict[str, str]]:
    """Hoja sintética del volumen A: cabecera, países y las dos filas «Total 'Agree'» (entrevistas y proporciones).

    Returns:
        Las filas de la hoja, cada una con sus celdas por columna.
    """
    cabecera = [
        {"H": "QB6.1. Texto de la pregunta"},
        {"H": eurobarometro.CAMPO},
        {"H": eurobarometro.BASE},
    ] + [{} for _ in range(FILAS_VACIAS_DE_CABECERA)]
    paises = {"C": eurobarometro.COLUMNA_UE27, "D": "ES", "E": "DE", "F": "FR", "G": "IT"}
    entrevistas = {"B": "Total 'Agree'", "C": "26411", "D": "1015", "E": "1520", "F": "1010", "G": "1020"}
    proporciones = {"B": "Total 'Agree'", "C": "0.565", "D": "0.74", "E": "0.53", "F": "0.71", "G": "1"}
    return [*cabecera, paises, entrevistas, proporciones]


class PruebaEurobarometro(unittest.TestCase):
    """Los seis nominales del lector, sin el compositor ni datos globales."""

    def test_el_porcentaje_publicado_se_redondea_como_el_eurobarometro(self) -> None:
        """0,56000000000000005 es 56 y 0,665 sube a 67 (mitad hacia arriba)."""
        self.assertEqual(eurobarometro.porcentaje_entero("0.56000000000000005"), 56)
        self.assertEqual(eurobarometro.porcentaje_entero("0.665"), 67)
        self.assertEqual(eurobarometro.porcentaje_entero("0.565"), 57)

    def test_de_las_dos_filas_del_total_se_lee_la_de_proporciones(self) -> None:
        """Entrevistas y proporciones llevan la misma etiqueta: se publica la fila que solo tiene proporciones."""
        pregunta = eurobarometro.leer_pregunta(hoja_del_eurobarometro(), "Total 'Agree'")
        self.assertEqual(
            pregunta["proporciones"], {"EU27_2020": "0.565", "ESP": "0.74", "DEU": "0.53", "FRA": "0.71", "ITA": "1"}
        )
        self.assertEqual(pregunta["campo"], eurobarometro.CAMPO)
        self.assertEqual(pregunta["base"], eurobarometro.BASE)
        self.assertEqual(pregunta["pregunta"], "QB6.1. Texto de la pregunta")
        self.assertEqual(eurobarometro.porcentaje_entero(pregunta["proporciones"]["EU27_2020"]), 57)

    def test_sin_un_territorio_o_con_dos_filas_de_proporciones_la_hoja_no_se_lee(self) -> None:
        """Si falta la columna de un territorio o hay dos filas de proporciones, no hay una sola fila publicada."""
        sin_italia = [{col: val for col, val in fila.items() if val != "IT"} for fila in hoja_del_eurobarometro()]
        with self.assertRaisesRegex(FormatoInesperado, r"una sola fila de proporciones .* \(0\)"):
            eurobarometro.leer_pregunta(sin_italia, "Total 'Agree'")
        repetida = hoja_del_eurobarometro()
        repetida.append(dict(repetida[-1]))
        with self.assertRaisesRegex(FormatoInesperado, r"\(2\)"):
            eurobarometro.leer_pregunta(repetida, "Total 'Agree'")
        with self.assertRaisesRegex(FormatoInesperado, "cabecera de países"):
            eurobarometro.leer_pregunta(hoja_del_eurobarometro()[:FILAS_DE_CABECERA], "Total 'Agree'")

    def test_el_libro_se_lee_una_vez_para_todas_las_hojas_con_sus_textos_compartidos(self) -> None:
        """Cada hoja pedida, por su nombre, con los textos compartidos resueltos; una hoja que falta se dice."""
        principal = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
        relaciones = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        ruta = Path(temporal.name) / "volumen-a.xlsx"
        with zipfile.ZipFile(ruta, "w") as libro:
            libro.writestr("xl/sharedStrings.xml", f"<sst {principal}><si><t>Total 'Agree'</t></si></sst>")
            libro.writestr(
                "xl/_rels/workbook.xml.rels",
                '<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/>'
                '<Relationship Id="r2" Target="/xl/worksheets/sheet2.xml"/></Relationships>',
            )
            libro.writestr(
                "xl/workbook.xml",
                f'<workbook {principal} {relaciones}><sheets><sheet name="QB5" r:id="r1"/>'
                '<sheet name="QB3" r:id="r2"/></sheets></workbook>',
            )
            libro.writestr(
                "xl/worksheets/sheet1.xml",
                f'<worksheet {principal}><sheetData><row><c r="B12" t="s"><v>0</v></c></row></sheetData></worksheet>',
            )
            libro.writestr(
                "xl/worksheets/sheet2.xml",
                f'<worksheet {principal}><sheetData><row><c r="C3"><v>0.5</v></c><c r="D3"/></row></sheetData>'
                "</worksheet>",
            )
        filas = hojas.filas_xlsx_por_nombre(ruta, ["QB5", "QB3"])
        self.assertEqual(filas, {"QB5": [{"B": "Total 'Agree'"}], "QB3": [{"C": "0.5", "D": ""}]})
        with self.assertRaisesRegex(FormatoInesperado, "no tiene la hoja QB6_1"):
            hojas.filas_xlsx_por_nombre(ruta, ["QB6_1"])

    def test_una_proporcion_va_de_cero_a_uno_y_lo_demas_no_lo_es(self) -> None:
        """Una cifra de entrevistas, una negativa, una celda vacía o un texto no son proporciones."""
        for texto in ("0", "0.565", "1"):
            self.assertTrue(eurobarometro._es_proporcion(texto), texto)
        for texto in ("1015", "-0.1", "1.01", "", "n/a"):
            self.assertFalse(eurobarometro._es_proporcion(texto), texto)

    def test_la_fila_publicada_es_la_de_proporciones_aunque_la_etiqueta_se_repita(self) -> None:
        """«Total 'Important'» titula las entrevistas y la proporción: se lee la proporción; dos, se detiene."""
        cabecera = {"C": eurobarometro.COLUMNA_UE27, "D": "ES", "E": "DE", "F": "FR", "G": "IT"}
        entrevistas = {"B": "Total 'Important'", "C": "21802", "D": "791", "E": "1372", "F": "846", "G": "844"}
        proporcion = {"B": "Total 'Important'", "C": "0.82", "D": "0.79", "E": "0.86", "F": "0.84", "G": "0.81"}
        leida = eurobarometro.leer_pregunta([cabecera, entrevistas, proporcion], "Total 'Important'")
        self.assertEqual(leida["proporciones"]["EU27_2020"], "0.82")
        with self.assertRaises(FormatoInesperado):
            eurobarometro.leer_pregunta([cabecera, proporcion, proporcion], "Total 'Important'")


class PruebaRegresionesEurobarometro(unittest.TestCase):
    """Fronteras reproducidas de estructura, preparado y trazabilidad del libro."""

    def preparados(self) -> dict[str, Any]:
        """Diez preguntas sintéticas con textos, universos y cifras de referencia.

        Returns:
            El preparado autónomo esperado por la validación.
        """
        return {
            hoja: {
                "pregunta": texto,
                "campo": eurobarometro.CAMPO,
                "base": eurobarometro.BASE_DE_LA_PREGUNTA.get(hoja, eurobarometro.BASE),
                "proporciones": {codigo: str(valor / 100) for codigo, valor in cifras.items()},
            }
            for (hoja, (_, texto)), cifras in zip(
                eurobarometro.PREGUNTAS.items(), eurobarometro.REFERENCIA.values(), strict=True
            )
        }

    def validar(self, preparado: object, procedencia: object | None = None) -> mock.Mock:
        """Valida solo las entradas sintéticas, sin leer ni escribir archivos.

        Returns:
            El cierre observado para comprobar los controles y el conjunto.
        """
        if procedencia is None:
            procedencia = {
                "archivos": [{"archivo": eurobarometro.ARCHIVO, "descargado_utc": "2026-10-11T23:30:00-05:00"}]
            }
        entradas = {eurobarometro.HOJAS: preparado, eurobarometro.PROCEDENCIA: procedencia}
        with (
            mock.patch.object(eurobarometro, "leer_json", side_effect=entradas.__getitem__),
            mock.patch.object(eurobarometro, "controles_de_huella"),
            mock.patch.object(eurobarometro, "cerrar_validacion") as cerrar,
        ):
            eurobarometro.validar()
        return cerrar

    def test_un_territorio_duplicado_no_se_sobrescribe(self) -> None:
        """Dos columnas ES no pueden convertirse silenciosamente en una sola clave del diccionario."""
        filas = hoja_del_eurobarometro()
        filas[FILAS_DE_CABECERA]["I"] = "ES"
        filas[-1]["I"] = "0.74"
        with self.assertRaisesRegex(FormatoInesperado, "territorio.*ES.*duplicado"):
            eurobarometro.leer_pregunta(filas, "Total 'Agree'")

    def test_dos_cabeceras_de_paises_no_eligen_la_primera(self) -> None:
        """Una segunda cabecera, aunque coincida, hace ambigua la estructura de la hoja."""
        filas = hoja_del_eurobarometro()
        filas.append(dict(filas[FILAS_DE_CABECERA]))
        with self.assertRaisesRegex(FormatoInesperado, "cabecera de países.*2"):
            eurobarometro.leer_pregunta(filas, "Total 'Agree'")

    def test_porcentaje_entero_rechaza_no_finitos_tipos_y_fuera_de_rango(self) -> None:
        """Una función pública de proporciones no redondea entrevistas ni produce errores aritméticos crudos."""
        for valor in ("NaN", "sNaN", "Infinity", "-Infinity", "-0.1", "1.01", "n/a", "", None, True, 0.5, {}):
            with self.subTest(valor=valor), self.assertRaisesRegex(FormatoInesperado, "proporción"):
                eurobarometro.porcentaje_entero(valor)

    def test_el_preparado_rechaza_proporciones_invalidas_con_contexto(self) -> None:
        """El diagnóstico de una celda preparada dice hojas.json, pregunta y territorio."""
        for valor in ("NaN", "Infinity", "-0.1", "1.01", None, True, 0.5, {}):
            with self.subTest(valor=valor):
                preparado = self.preparados()
                preparado["QB3"]["proporciones"]["ESP"] = valor
                with self.assertRaisesRegex(FormatoInesperado, "hojas.json.*QB3.*ESP.*proporción"):
                    self.validar(preparado)

    def test_el_preparado_exige_preguntas_campos_y_territorios(self) -> None:
        """Las formas alteradas se rechazan antes de un KeyError o AttributeError sin contexto."""
        casos: list[tuple[object, str]] = [(None, "hojas.json"), ([], "hojas.json")]
        falta = self.preparados()
        del falta["QB3"]
        casos.append((falta, "hojas.json.*QB3"))
        for campo, valor in (("pregunta", None), ("base", []), ("campo", True), ("proporciones", [])):
            preparado = self.preparados()
            preparado["QB3"][campo] = valor
            casos.append((preparado, f"hojas.json.*QB3.*{campo}"))
        falta = self.preparados()
        del falta["QB3"]["proporciones"]["ESP"]
        casos.append((falta, "hojas.json.*QB3.*ESP"))
        extra = self.preparados()
        extra["QB3"]["proporciones"]["CAT"] = "0.5"
        casos.append((extra, "hojas.json.*QB3.*CAT"))
        for preparado, mensaje in casos:
            with self.subTest(mensaje=mensaje), self.assertRaisesRegex(FormatoInesperado, mensaje):
                self.validar(preparado)

    def test_consulta_selecciona_el_xlsx_aunque_haya_otro_archivo_antes(self) -> None:
        """La fecha pertenece al libro declarado, conservando su día civil sin conversión horaria."""
        procedencia = {
            "archivos": [
                {"archivo": "otro.txt", "descargado_utc": "2026-10-14T00:00:00Z"},
                {"archivo": eurobarometro.ARCHIVO, "descargado_utc": "2026-10-11T23:30:00-05:00"},
            ]
        }
        cerrar = self.validar(self.preparados(), procedencia)
        self.assertTrue(cerrar.call_args.args[2].admitido)
        self.assertEqual(cerrar.call_args.args[3]()["consultado"], "2026-10-11")

    def test_consulta_exige_un_solo_xlsx_y_fecha_valida_con_contexto(self) -> None:
        """Ausencia, repetición o fecha malformada del original tienen diagnóstico propio."""
        entrada = {"archivo": eurobarometro.ARCHIVO, "descargado_utc": "2026-10-11T00:00:00Z"}
        casos = [({}, "archivos"), ({"archivos": []}, "única"), ({"archivos": [entrada, entrada]}, "única")]
        for fecha in ("2026-02-30T00:00:00Z", "no-fecha", None, 2026):
            casos.append(({"archivos": [{**entrada, "descargado_utc": fecha}]}, "descargado_utc"))
        for procedencia, campo in casos:
            with (
                self.subTest(procedencia=procedencia),
                self.assertRaisesRegex(FormatoInesperado, f"SP554_Volume_A.xlsx.*{campo}"),
            ):
                self.validar(self.preparados(), procedencia)

    def test_la_base_especial_qb3_y_el_texto_no_se_sustituyen(self) -> None:
        """Cambiar base, campo o pregunta mantiene el control literal y la denegación de admisión."""
        for campo, valor in (("base", eurobarometro.BASE), ("campo", "2026"), ("pregunta", "Otra pregunta")):
            with self.subTest(campo=campo):
                preparado = self.preparados()
                preparado["QB3"][campo] = valor
                cerrar = self.validar(preparado)
                self.assertFalse(cerrar.call_args.args[2].admitido)

    def test_preparar_exige_la_huella_antes_de_leer_el_libro(self) -> None:
        """La guarda de integridad ya existente en original() detiene la preparación y conserva el preparado."""
        from plataforma_datos.comun.nucleo import HuellaIncorrecta

        with (
            mock.patch.object(eurobarometro, "original", side_effect=HuellaIncorrecta("huella alterada")),
            mock.patch.object(eurobarometro, "filas_xlsx_por_nombre") as leer,
            mock.patch.object(eurobarometro, "guardar_json") as guardar,
        ):
            with self.assertRaisesRegex(HuellaIncorrecta, "huella alterada"):
                eurobarometro.preparar()
            leer.assert_not_called()
            guardar.assert_not_called()


if __name__ == "__main__":
    unittest.main()
