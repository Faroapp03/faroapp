"""Pruebas de los certificados que el SEPE relacionó con cada ocupación en 2016 (certificados2016.py).

El montaje de la tabla se prueba con celdas que copian la forma de las que lee certificados2016-celdas.swift; la
selección, con parejas pequeñas. Los nominales reales del conjunto y su cobertura se ejecutan aparte.
"""

import csv
import io
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from typing import Any
from unittest import mock

import plataforma_datos.cursos.fuentes.certificados2016.lector as c2016
from plataforma_datos.comun.nucleo import FormatoInesperado

type Celdas = list[dict[str, float | str]]


def celda(y0: float, y1: float, texto: str) -> dict[str, float | str]:
    """Una celda leída por posición.

    Returns:
        Celda con sus coordenadas verticales y su texto.
    """
    return {"y0": y0, "y1": y1, "texto": texto}


def pagina(numero: int, codigos: Celdas, nombres: Celdas, certificados: Celdas, unidades: Celdas) -> dict[str, object]:
    """Una página con la cabecera de cada columna delante.

    Returns:
        Página con su número y sus cuatro columnas de celdas.
    """
    cabecera = celda(0, 10, "Cabecera")
    columnas = [[cabecera, *columna] for columna in (codigos, nombres, certificados, unidades)]
    return {"pagina": numero, "celdas": columnas}


class PruebaTabla(unittest.TestCase):
    """Cómo se montan las filas con las celdas."""

    def test_bloques_unidades_y_salto_de_pagina(self) -> None:
        """Cada certificado va a su bloque; un bloque y unas unidades siguen en la página siguiente."""
        primera = pagina(
            1,
            [celda(10, 50, "4430")],
            [celda(10, 50, "Recepcionistas")],
            [celda(10, 30, "COMM0111 Atención"), celda(30, 50, "COMM0112 Ventas")],
            [celda(10, 30, "TODOS LAS UC"), celda(30, 50, "UC0001_2")],
        )
        segunda = pagina(2, [celda(10, 20, "")], [celda(10, 20, "")], [celda(10, 20, "")], [celda(10, 20, "UC556_3")])
        filas = c2016.filas_de_las_celdas("España", [primera, segunda])
        self.assertEqual(
            [(fila["cno4"], fila["certificado"], fila["unidades"]) for fila in filas],
            [("4430", "COMM0111", "todas"), ("4430", "COMM0112", "UC0001_2,UC556_3")],
        )


class PruebaSeleccion(unittest.TestCase):
    """Qué parejas se usan, con qué unidades y con qué ocupaciones."""

    def test_filas_repetidas_y_codigos_con_errata(self) -> None:
        """«Todas» manda sobre una lista; si no, la unión; las erratas del código se corrigen."""
        filas = [
            {"cno4": "2712", "certificado": "FCD0112", "unidades": "UC0226_3"},
            {"cno4": "2712", "certificado": "IFCD0112", "unidades": "todas"},
            {"cno4": "3820", "certificado": "COMM0111", "unidades": "UC0001_2"},
            {"cno4": "3820", "certificado": "COMM0111", "unidades": "UC0002_2"},
        ]
        self.assertEqual(
            c2016.parejas(filas), {("2712", "IFCD0112"): "todas", ("3820", "COMM0111"): "UC0001_2,UC0002_2"}
        )

    def test_unidades_del_certificado_vigente(self) -> None:
        """Cuatro cifras, sin nivel o ninguna: se nombran las que siguen; si no queda ninguna, la pareja no vale."""
        vigentes = ["UC0556_3", "UC0841_2", "UC0900_2"]
        self.assertEqual(c2016.unidades_nombradas_vigentes("UC556_3,UC0841_", vigentes), ["UC0556_3", "UC0841_2"])
        self.assertEqual(c2016.unidades_nombradas_vigentes("UC16364_3", vigentes), [])
        self.assertFalse(c2016.limita_a_unidades("todas"))
        self.assertFalse(c2016.limita_a_unidades(""))
        self.assertTrue(c2016.limita_a_unidades("UC16364_3"))

    def test_parejas_vigentes_y_las_que_quedan_fuera_por_su_motivo(self) -> None:
        """«Todas» no limita; unidades que ya no existen dejan la pareja fuera; un certificado ausente, también."""
        tabla = {
            ("1", "AAAA0001"): "todas",
            ("1", "AAAA0002"): "UC0556_3,UC9999_1",
            ("1", "AAAA0003"): "UC9999_1",
            ("1", "ZZZZ0000"): "todas",
        }
        catalogo = {
            "AAAA0001": {"unidades": [{"codigo": "UC0001_1"}]},
            "AAAA0002": {"unidades": [{"codigo": "UC0556_3"}]},
            "AAAA0003": {"unidades": [{"codigo": "UC0556_3"}]},
        }
        usadas, fuera = c2016.certificados_y_unidades_vigentes(tabla, catalogo)
        self.assertEqual(usadas, {("1", "AAAA0001"): [], ("1", "AAAA0002"): ["UC0556_3"]})
        self.assertEqual(fuera, {"certificado_no_vigente": 1, "ninguna_unidad_vigente": 1})

    def test_solo_un_grupo_sin_lo_previo_ni_lo_descartado(self) -> None:
        """Una ocupación de dos grupos no recibe nada; lo de más precedencia y lo descartado no se repite."""
        relaciones = {("4430", "COMM0111"): [], ("4430", "COMM0112"): ["UC0001_2"]}
        grupos = {"una": {"4430"}, "dos": {"4430", "4500"}, "previa": {"4430"}, "descartada": {"4430"}}
        previas = {"previa": {"COMM0111"}}
        nuevas = c2016.por_ocupacion(relaciones, grupos, previas, {("descartada", "COMM0112")})
        self.assertEqual(nuevas["una"], [["COMM0111", []], ["COMM0112", ["UC0001_2"]]])
        self.assertEqual(nuevas["previa"], [["COMM0112", ["UC0001_2"]]])
        self.assertEqual(nuevas["descartada"], [["COMM0111", []]])
        self.assertNotIn("dos", nuevas)


class PruebaEstadoEntrePaginas(unittest.TestCase):
    """Lo que pasa de una página a la siguiente va al certificado correcto o a ninguno."""

    def test_una_ultima_celda_sin_bloque_no_recibe_unidades_ajenas(self) -> None:
        """Si la última celda tiene código pero no bloque, las unidades de la página siguiente no van a otra fila."""
        primera = pagina(
            1,
            [celda(10, 30, "4430")],
            [celda(10, 30, "Recepcionistas")],
            [celda(10, 30, "COMM0111 Atención"), celda(30, 50, "COMM0112 Ventas")],
            [celda(10, 30, "UC0001_2"), celda(30, 50, "")],
        )
        segunda = pagina(2, [celda(10, 20, "")], [celda(10, 20, "")], [celda(10, 20, "")], [celda(10, 20, "UC0009_2")])
        filas = c2016.filas_de_las_celdas("España", [primera, segunda])
        self.assertEqual([(fila["certificado"], fila["unidades"]) for fila in filas], [("COMM0111", "UC0001_2")])

    def test_las_pendientes_solo_pasan_a_la_pagina_siguiente(self) -> None:
        """Unas unidades al pie que la página siguiente no recoge no se quedan para una página posterior."""
        primera = pagina(
            1, [celda(10, 50, "4430")], [celda(10, 50, "R")], [celda(10, 30, "")], [celda(10, 30, "UC0007_2")]
        )
        segunda = pagina(
            2, [celda(10, 50, "")], [celda(10, 50, "")], [celda(10, 30, "Sin código")], [celda(10, 30, "")]
        )
        tercera = pagina(
            3, [celda(10, 50, "")], [celda(10, 50, "")], [celda(10, 30, "COMM0111 A")], [celda(10, 30, "")]
        )
        filas = c2016.filas_de_las_celdas("España", [primera, segunda, tercera])
        self.assertEqual([(fila["certificado"], fila["unidades"]) for fila in filas], [("COMM0111", "")])


class PruebaEntradas(unittest.TestCase):
    """Una entrada dañada se detiene con su contexto, antes de admitir relaciones."""

    def test_unidad_sin_nivel_y_con_tres_cifras(self) -> None:
        """Las dos erratas admitidas pueden coexistir sin perder una unidad vigente única."""
        self.assertEqual(c2016.unidad_vigente("UC556_", ["UC0556_3"]), "UC0556_3")
        self.assertIsNone(c2016.unidad_vigente("UC556_", ["UC0556_2", "UC0556_3"]))

    def test_tabla_vacia_no_se_admite(self) -> None:
        """Los controles no admiten una extracción sin filas."""
        with self.assertRaisesRegex(FormatoInesperado, "certificados2016: no hay filas para validar"):
            c2016._controles([], {}, set(), {}, {})

    def test_tsv_danado_se_rechaza_con_ruta_y_linea(self) -> None:
        """La cabecera, la anchura y los campos utilizados no se aceptan por accidente."""
        cabecera = "\t".join(c2016.COLUMNAS) + "\n"
        fila = "4430\tRecepción\tCOMM0111\tAtención\t\t872\t1\tEspaña\n"
        casos = {
            "cabecera": ("certificado\tcno4\nCOMM0111\t4430\n", "cabecera"),
            "truncada": (cabecera + "4430\tRecepción\tCOMM0111\n", "línea 2"),
            "sobrante": (cabecera + fila.rstrip("\n") + "\textra\n", "línea 2"),
            "codigo": (cabecera + fila.replace("4430", "443"), "línea 2"),
            "pagina": (cabecera + fila.replace("872", "0"), "línea 2"),
            "sin_filas": (cabecera, "sin filas"),
        }
        with tempfile.TemporaryDirectory() as temporal:
            ruta = Path(temporal) / "tabla.tsv"
            for nombre, (contenido, motivo) in casos.items():
                with self.subTest(caso=nombre):
                    ruta.write_text(contenido, encoding="utf-8")
                    with self.assertRaisesRegex(FormatoInesperado, f"tabla.tsv.*{motivo}"):
                        c2016.leer_tabla(ruta)
            ruta.write_text(cabecera + fila, encoding="utf-8")
            self.assertEqual(c2016.leer_tabla(ruta)[0]["unidades"], "")

    def test_preparar_conserva_la_tabla_si_falla_la_escritura(self) -> None:
        """Una avería al generar el TSV conserva el preparado previo completo."""
        entrada = pagina(872, [celda(10, 50, "4430")], [], [celda(10, 50, "COMM0111 A")], [])

        def interrumpir(escritor: csv.DictWriter, filas: list[dict[str, Any]]) -> None:
            escritor.writerow(filas[0])
            raise OSError("corte de escritura")

        with tempfile.TemporaryDirectory() as temporal:
            tabla = Path(temporal) / "tabla.tsv"
            tabla.write_bytes(b"preparado previo\n")
            with (
                mock.patch.object(c2016, "TABLA", tabla),
                mock.patch.object(c2016, "comprobar_originales", return_value=[Path("celdas.jsonl")]),
                mock.patch.object(c2016, "CELDAS", {"España": "celdas.jsonl"}),
                mock.patch.object(c2016, "leer_jsonl", return_value=[entrada]),
                mock.patch.object(c2016.csv.DictWriter, "writerows", interrumpir),
                redirect_stdout(io.StringIO()),
                self.assertRaisesRegex(OSError, "corte de escritura"),
            ):
                c2016.preparar()
            self.assertEqual(tabla.read_bytes(), b"preparado previo\n")

    def test_tsv_no_utf8_tiene_motivo(self) -> None:
        """Un TSV de otra codificación explica qué archivo no se pudo leer."""
        with tempfile.TemporaryDirectory() as temporal:
            ruta = Path(temporal) / "tabla.tsv"
            ruta.write_bytes(b"\xff")
            with self.assertRaisesRegex(FormatoInesperado, "tabla.tsv.*UTF-8"):
                c2016.leer_tabla(ruta)

    def test_celdas_danadas_identifican_ambito_pagina_y_columna(self) -> None:
        """Una geometría inválida o una columna ausente no produce filas incompletas."""
        correcta = pagina(872, [celda(10, 50, "4430")], [], [celda(10, 50, "COMM0111 A")], [])
        casos = [
            ({"pagina": 872, "celdas": []}, "cuatro columnas"),
            ({"pagina": 872, "celdas": [[], [], [], []]}, "columna 1"),
            (pagina(872, [celda(50, 10, "4430")], [], [], []), "columna 1.*celda 2"),
            (pagina(872, [celda(float("nan"), 50, "4430")], [], [], []), "columna 1.*celda 2"),
            (pagina(872, [celda(10**400, 10**401, "4430")], [], [], []), "columna 1.*celda 2"),
            (pagina(872, [celda(1e308, 1.7e308, "4430")], [], [], []), "columna 1.*celda 2"),
            ({"pagina": 872, "celdas": [[{"texto": "Cabecera"}], [], [], []]}, "columna 1.*celda 1"),
        ]
        for entrada, motivo in casos:
            with (
                self.subTest(motivo=motivo),
                self.assertRaisesRegex(FormatoInesperado, f"España.*872.*{motivo}"),
            ):
                c2016.filas_de_las_celdas("España", [entrada])
        self.assertEqual(c2016.filas_de_las_celdas("España", [correcta])[0]["certificado"], "COMM0111")


if __name__ == "__main__":
    unittest.main()
