"""Las tablas publicadas del INE de 2025 y 2026, leídas de sus capturas reales completas."""

import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import plataforma_datos.ia_y_trabajo.fuentes.tich.lector as tich
from plataforma_datos.comun.nucleo import FormatoInesperado
from plataforma_datos.ia_y_trabajo.fuentes.tich.constantes import (
    FILA_CONTRASTE,
    TOTAL_DEL_GRUPO,
    TOTAL_NACIONAL,
    USO_POR_TRABAJO,
)
from plataforma_datos.ia_y_trabajo.fuentes.tich.edicion import primera
from plataforma_datos.ia_y_trabajo.fuentes.tich.tablas_publicadas import (
    errores_publicados,
    filas_del_csv,
    uso_publicado,
)

DATOS = Path(__file__).parent / "datos" / "ine-tich"


def leer(nombre: str) -> str:
    """La captura, como la lee la fuente.

    Returns:
        Su texto.
    """
    return (DATOS / nombre).read_text(encoding="utf-8-sig")


class PruebaTablasPublicadas(unittest.TestCase):
    """Cada año trae su número de tabla y la de errores cambió de forma: las dos formas se leen; una tercera, no."""

    def test_las_capturas_son_las_del_ine_byte_a_byte(self) -> None:
        """Cada captura tiene la huella que declara su procedencia, con dirección e instante o día de captura."""
        procedencia = json.loads((DATOS / "procedencia.json").read_text(encoding="utf-8"))
        self.assertEqual(len(procedencia["archivos"]), 12)
        for archivo in procedencia["archivos"]:
            with self.subTest(archivo=archivo["archivo"]):
                contenido = (DATOS / archivo["archivo"]).read_bytes()
                self.assertEqual(hashlib.sha256(contenido).hexdigest(), archivo["sha256"])
                self.assertTrue(archivo["url"].startswith("https://www.ine.es/"))
                if archivo["archivo"].endswith(".pdf"):
                    self.assertEqual(archivo["capturado_utc"], "2026-11-15")
                else:
                    self.assertRegex(archivo["capturado_utc"], r"^2026-11-15T00:[34][0-9]:[0-9]{2}Z$")
                self.assertNotIn("capturado_el", archivo)

    def test_la_tabla_de_errores_se_lee_en_sus_dos_formas(self) -> None:
        """2025 (cuatro columnas, comunidades con código) y 2026 (tres columnas, «Total nacional» como una fila más)."""
        for nombre, total, cataluna, castilla in (
            ("76849.csv", 0.34, 1.08, 1.21),
            ("82907.csv", 0.35, 1.13, 1.03),
        ):
            with self.subTest(nombre=nombre):
                errores = errores_publicados(leer(nombre), nombre, FILA_CONTRASTE)
                self.assertEqual(len(errores), 18)
                self.assertEqual((errores[TOTAL_NACIONAL], errores["09"], errores["08"]), (total, cataluna, castilla))

    def test_una_tercera_forma_o_sin_total_nacional_se_detiene(self) -> None:
        """Otra cabecera, o una tabla sin la fila de contraste del total nacional, detiene la lectura con su motivo."""
        otra = "Comunidad;Uso;Año;Total\nTotal nacional;x;2026;0,3\n"
        with self.assertRaisesRegex(FormatoInesperado, "cabecera de la tabla de errores desconocida"):
            errores_publicados(otra, "otra.csv", FILA_CONTRASTE)
        sin_total = "\n".join(line for line in leer("82907.csv").splitlines() if "Total nacional" not in line)
        with self.assertRaisesRegex(FormatoInesperado, "falta"):
            errores_publicados(sin_total, "82907.csv", FILA_CONTRASTE)

    def test_la_tabla_de_uso_da_el_total_de_cada_anio_y_sus_grupos(self) -> None:
        """La misma forma en 2025 (76444) y 2026 (82804): uso por trabajo del total, 17,9 y 27,6."""
        for nombre, total in (("76444.csv", 17.9), ("82804.csv", 27.6)):
            with self.subTest(nombre=nombre):
                cifras = uso_publicado(leer(nombre), nombre)
                self.assertEqual(cifras[("Total Personas", "Total Personas", USO_POR_TRABAJO)], total)
                # La 76444 trae dos celdas que el INE no publica («..»): no tienen cifra y no detienen la lectura.
                sin_cifra = [clave for clave, valor in cifras.items() if valor is None]
                self.assertEqual(len(sin_cifra), 2 if nombre.startswith("76444") else 0)
                for grupo in ("Manual", "No Manual", "Trabajadores TIC"):
                    self.assertIn(("Total Personas", f"Ocupación principal: {grupo}", USO_POR_TRABAJO), cifras)

    def test_cabecera_desconocida_fila_repetida_o_corta_o_cifra_rara_se_detienen(self) -> None:
        """Ninguna tabla mal formada se lee a medias."""
        cabecera = leer("82804.csv").splitlines()[0]
        fila = "Total Personas;Total Personas;Total;10"
        for texto, motivo in (
            ("a;b;c;d\nx;y;z;1\n", "cabecera de la tabla de uso"),
            (f"{cabecera}\n{fila}\n{fila}\n", "fila repetida"),
            (f"{cabecera}\nTotal Personas;\n", "fila 2"),
            (f"{cabecera}\nTotal Personas;Total Personas;Total;abc\n", "cifra no numérica"),
        ):
            with self.subTest(motivo=motivo), self.assertRaisesRegex(FormatoInesperado, motivo):
                uso_publicado(texto, "tabla.csv")
        with self.assertRaisesRegex(FormatoInesperado, "sin cabecera"):
            filas_del_csv("", "vacia.csv")


class PruebaCifrasDeLosGruposContrastados(unittest.TestCase):
    """Una celda sin cifra solo se tolera fuera de los grupos que se contrastan con los microdatos."""

    def _publicadas(self, texto: str) -> dict[str, dict[str, float]]:
        """Las cifras de los grupos contrastados, leídas por la fuente de una tabla de uso con este texto.

        Returns:
            {grupo: población y % de uso por trabajo}.
        """
        with tempfile.TemporaryDirectory() as carpeta:
            tabla = Path(carpeta) / "tabla.csv"
            tabla.write_text(texto, encoding="utf-8")
            with mock.patch.object(tich, "original", return_value=tabla):
                return tich._publicadas_uso(primera())

    def test_la_tabla_real_da_la_cifra_de_cada_grupo(self) -> None:
        """Con la 76444 entera, que trae una celda «..», los tres grupos tienen su población y su uso por trabajo."""
        cifras = self._publicadas(leer("76444.csv"))
        self.assertEqual(
            {grupo: (cifra["poblacion"], cifra["pct"]) for grupo, cifra in cifras.items()},
            {"manual": (6268320, 7.7), "no_manual": (15073460, 33.7), "tic": (764442, 73.0)},
        )

    def test_sin_la_cifra_de_un_grupo_contrastado_se_detiene(self) -> None:
        """«..» o una celda vacía en el total o en el uso por trabajo de Manual, No Manual o TIC detienen la lectura."""
        real = leer("76444.csv")
        for grupo in ("Manual", "No Manual", "Trabajadores TIC"):
            for categoria in (TOTAL_DEL_GRUPO, USO_POR_TRABAJO):
                linea = next(
                    fila
                    for fila in real.splitlines()
                    if fila.startswith(f"Total Personas;Ocupación principal: {grupo};{categoria};")
                )
                for marca in ("..", ""):
                    texto = real.replace(linea, linea.rsplit(";", 1)[0] + ";" + marca)
                    with (
                        self.subTest(grupo=grupo, categoria=categoria, marca=marca),
                        self.assertRaisesRegex(FormatoInesperado, f"falta la cifra publicada del grupo .*{grupo}"),
                    ):
                        self._publicadas(texto)


if __name__ == "__main__":
    unittest.main()
