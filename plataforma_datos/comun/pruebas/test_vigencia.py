"""Pruebas del bloque `vigencia` (vigencia.py): periodo, publicación, siguiente edición prevista y fuente."""

import unittest

from plataforma_datos.comun import vigencia
from plataforma_datos.comun.nucleo import Controles, FormatoInesperado


class PruebaVigencia(unittest.TestCase):
    """El bloque `vigencia` de cada archivo nuevo del paquete."""

    def test_bloque_correcto(self) -> None:
        """Periodo, publicación, siguiente edición (o ninguna) y fuente."""
        bloque = vigencia.bloque("2025-T1", "2025-10-22", "2026-10-22", "calendario del INE", "INE")
        self.assertEqual(vigencia.problemas(bloque), [])
        self.assertEqual(vigencia.problemas({**bloque, "siguiente_prevista": None}), [])

    def test_lo_que_no_cuadra(self) -> None:
        """Un campo que falta, una fecha mal escrita o una siguiente edición anterior a la publicada."""
        bloque = vigencia.bloque("2025-T1", "2025-10-22", "2026-10-22", "calendario del INE", "INE")
        self.assertTrue(vigencia.problemas({clave: valor for clave, valor in bloque.items() if clave != "fuente"}))
        self.assertTrue(vigencia.problemas({**bloque, "publicado": "22/10/2025"}))
        self.assertTrue(vigencia.problemas({**bloque, "siguiente_prevista": "2025-01-01"}))

    def test_fechas_imposibles_o_que_no_son_texto(self) -> None:
        """Un mes o un día imposible, cifras no ASCII o un año escrito como número son problemas, no excepciones."""
        bloque = vigencia.bloque("2025-T1", "2025-10-22", "2026-10-22", "calendario del INE", "INE")
        for campo, valor in (
            ("publicado", "2026-13-45"),
            ("publicado", "2026-02-30"),
            ("publicado", "\u0662\u0660\u0662\u0665"),
            ("publicado", 2025),
            ("publicado", None),
            ("siguiente_prevista", 2026),
        ):
            with self.subTest(campo=campo, valor=valor):
                self.assertTrue(vigencia.problemas({**bloque, campo: valor}))
        self.assertEqual(vigencia.problemas({**bloque, "publicado": "2025", "siguiente_prevista": "2026-02"}), [])

    def test_el_anio_cero_no_es_fecha_con_ninguna_precision(self) -> None:
        """El calendario no tiene año cero, tanto con año solo como con mes o día."""
        for fecha in ("0000", "0000-01", "0000-01-01"):
            with self.subTest(fecha=fecha):
                self.assertFalse(vigencia.fecha_valida(fecha))

    def test_los_textos_vacios_se_nombran_en_el_motivo(self) -> None:
        """Una fecha válida no oculta qué campo de texto está vacío."""
        bloque = vigencia.bloque("2025-T1", "2025-10-22", None, "calendario INE", "INE")
        for campo in ("periodo", "fuente", "calendario"):
            with self.subTest(campo=campo):
                problemas = vigencia.problemas({**bloque, campo: ""})
                self.assertEqual(len(problemas), 1)
                self.assertIn(campo, problemas[0])

    def test_cada_archivo_nuevo_del_paquete_lleva_su_vigencia(self) -> None:
        """Censo, encuesta de empresas y datos mensuales admiten periodos de distinta precisión."""
        bloques = {
            "sectores": vigencia.bloque("2021-01-01", "2023", None, "censo decenal", "INE"),
            "empresas": vigencia.bloque("2025-T1", "2025-10-22", "2026-10-22", "calendario INE", "ETICCE"),
            "observatori": vigencia.bloque("2026-06", "2026-07", None, "publicación mensual", "Observatori"),
        }
        controles = Controles()
        vigencia.comprobar(controles, bloques)
        self.assertTrue(controles.admitido, controles.fallidos)
        controles = Controles()
        bloques["empresas"]["siguiente_prevista"] = "2025-01-01"
        vigencia.comprobar(controles, bloques)
        self.assertEqual(len(controles.fallidos), 1)
        self.assertIn("empresas", controles.fallidos[0])


class PruebaVigenciaEurostat(unittest.TestCase):
    """La consulta y la vigencia de cada tabla, con errores diagnosticados antes de publicar."""

    def entrada(self) -> tuple[list[dict], dict, dict]:
        """Una tabla con dos periodos y una descarga a las 23:30 UTC, ya de madrugada en Cataluña.

        Returns:
            Filas, tablas y procedencia.
        """
        return (
            [{"tabla": "demo", "anio": 2024}, {"tabla": "demo", "anio": 2025}],
            {"demo": {"actualizado": "2026-10-10"}},
            {"archivos": [{"archivo": "eurostat-demo.json", "descargado_utc": "2026-10-11T23:30:00+00:00"}]},
        )

    def test_vigencia_y_consulta_completas(self) -> None:
        """El máximo año, la publicación y el día de consulta en Cataluña: las 23:30 UTC del 11 son ya el día 12."""
        consulta, bloques = vigencia.de_eurostat(*self.entrada())
        self.assertEqual(consulta, {"eurostat-demo.json": "2026-10-12"})
        self.assertEqual(
            bloques,
            {
                "demo": vigencia.bloque(
                    "2025",
                    "2026-10-10",
                    None,
                    "Eurostat no publica una fecha para la versión siguiente: se actualiza cuando llega la encuesta "
                    "de cada país.",
                    "Eurostat, demo (https://doi.org/10.2908/DEMO), versión filtrada, consultada el 12/10/2026",
                )
            },
        )

    def test_no_hay_tablas_para_la_vigencia(self) -> None:
        """Un preparado sin tablas no deja al consumidor calcular max() sobre consultas vacías."""
        with self.assertRaisesRegex(FormatoInesperado, "Eurostat.*sin tablas"):
            vigencia.de_eurostat([], {}, {"archivos": []})

    def test_tabla_sin_filas_se_nombra(self) -> None:
        """Una tabla sin filas falla por su nombre, sin max() sobre una secuencia vacía."""
        _, tablas, procedencia = self.entrada()
        with self.assertRaisesRegex(FormatoInesperado, "demo.*sin filas"):
            vigencia.de_eurostat([], tablas, procedencia)

    def test_fecha_de_descarga_invalida_nombra_el_original(self) -> None:
        """Una consulta que no es instante ISO se atribuye al original concreto."""
        for fecha in (None, 2026, "2026-02-30T00:00:00Z", "no-fecha"):
            with self.subTest(fecha=fecha):
                filas, tablas, procedencia = self.entrada()
                procedencia["archivos"][0]["descargado_utc"] = fecha
                with self.assertRaisesRegex(FormatoInesperado, "eurostat-demo.json.*fecha"):
                    vigencia.de_eurostat(filas, tablas, procedencia)

    def test_falta_el_original_de_la_tabla(self) -> None:
        """Una tabla sin su original de procedencia no produce una cita aparente."""
        filas, tablas, _ = self.entrada()
        with self.assertRaisesRegex(FormatoInesperado, "demo.*original"):
            vigencia.de_eurostat(filas, tablas, {"archivos": []})

    def test_publicacion_invalida_se_nombra(self) -> None:
        """Una fecha de publicación mal formada se atribuye a su tabla."""
        for fecha in (None, 2026, "2026-02-30", "2026-13-01"):
            with self.subTest(fecha=fecha):
                filas, tablas, procedencia = self.entrada()
                tablas["demo"]["actualizado"] = fecha
                with self.assertRaisesRegex(FormatoInesperado, "demo.*publicación"):
                    vigencia.de_eurostat(filas, tablas, procedencia)


if __name__ == "__main__":
    unittest.main()
