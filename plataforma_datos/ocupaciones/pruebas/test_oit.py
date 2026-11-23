"""Pruebas de la tabla de la OIT (oit.py y tabla_a1_oit.py): lectura del original, aviso de la licencia y controles.

Piezas de la OIT: tareas de la clasificación, cruce con las notas del autor, filas sin tarea y márgenes.
"""

import tempfile
import unittest
from pathlib import Path
from typing import Any
from unittest import mock

import plataforma_datos.ocupaciones.fuentes.oit.lector as oit
import plataforma_datos.ocupaciones.fuentes.oit.piezas.constantes_oit as constantes_oit
import plataforma_datos.ocupaciones.fuentes.oit.piezas.tabla_a1_oit as tabla_a1_oit
from plataforma_datos.comun.nucleo import Descarga, FormatoInesperado, OriginalCambiado, ReglaDeCambio
from plataforma_datos.comun.red import conservar_o_sustituir
from plataforma_datos.ocupaciones.fuentes.oit.piezas.constantes_oit import HOLGURA, TOLERANCIA_A1


def _fila_del_autor(codigo: object, tarea: str, indice: int, nota: float) -> dict[str, Any]:
    """Compone una fila del archivo del autor con lo que lee el cruce.

    Args:
        codigo: La celda ISCO_08, tal como la entrega Excel.
        tarea: El texto de la tarea.
        indice: El índice de la tarea según el autor.
        nota: La nota de 2025.

    Returns:
        La fila, con las columnas que lee `_nota_autor`.
    """
    return {
        "ISCO_08": codigo,
        "Task_ISCO": tarea,
        "taskID": str(indice),
        "score_2025": str(nota),
        "mean_score_2025": "0.5",
        "SD_2025": "0.1",
        "potential25": "",
    }


class TareasOficiales(unittest.TestCase):
    """«(a) … (b) …» se parte en tareas con su letra y su texto de la misma pasada."""

    def test_letras_y_textos(self) -> None:
        """Cada tarea con su índice, su letra y su texto sin el punto y coma final."""
        tareas = oit._tareas_oficiales("(a) planning work;\r\n(b) directing staff.")
        self.assertEqual(
            tareas,
            [
                {"indice": 1, "letra": "a", "texto_en": "planning work"},
                {"indice": 2, "letra": "b", "texto_en": "directing staff"},
            ],
        )

    def test_cada_texto_conserva_su_letra(self) -> None:
        """«(a)uno» sin espacio abre su tarea; «(c)x» dentro de un texto no abre otra."""
        tareas = oit._tareas_oficiales("(a)uno (c)x sigue (b) dos")
        self.assertEqual(
            [(tarea["letra"], tarea["texto_en"]) for tarea in tareas], [("a", "uno (c)x sigue"), ("b", "dos")]
        )


class CruzarNotas(unittest.TestCase):
    """Las notas del autor se asignan a su tarea oficial por texto, con el código como lo guarde Excel."""

    ISCO = {"1111": {"tareas": [{"indice": 1, "texto_en": "planning work"}]}}

    def test_codigo_guardado_como_numero(self) -> None:
        """«1111.0» cruza con el grupo 1111."""
        with mock.patch.object(oit, "leer_xlsx", return_value=[_fila_del_autor("1111.0", "Planning work", 1, 0.4)]):
            notas, sin_tarea = oit._cruzar_notas(self.ISCO)
        self.assertEqual(list(notas), [("1111", 1)])
        self.assertEqual(sin_tarea, [])

    def test_dos_notas_para_una_tarea(self) -> None:
        """Una tarea oficial con dos notas del autor se rechaza."""
        filas = [_fila_del_autor("1111", "Planning work", 1, 0.4), _fila_del_autor("1111", "planning work", 2, 0.5)]
        with (
            mock.patch.object(oit, "leer_xlsx", return_value=filas),
            self.assertRaisesRegex(FormatoInesperado, "dos notas"),
        ):
            oit._cruzar_notas(self.ISCO)


class EfectoDeLasFilasSinTarea(unittest.TestCase):
    """La media de la ocupación sin la fila y con ella; sin otras notas, un error con motivo."""

    def test_medias(self) -> None:
        """Dos notas propias (0,2 y 0,4) y una fila sin tarea (0,9)."""
        notas = {("1111", 1): {"nota": 0.2}, ("1111", 2): {"nota": 0.4}, ("2222", 1): {"nota": 1.0}}
        fila = {"isco08": "1111", "nota": 0.9}
        efecto = oit._efecto_filas_sin_tarea([fila], notas, {"1111": {"media": 0.3}})
        self.assertEqual(
            efecto, [{**fila, "media_publicada_a1": 0.3, "media_sin_la_fila": 0.3, "media_con_la_fila": 0.5}]
        )

    def test_ocupacion_sin_otras_notas(self) -> None:
        """Una fila de una ocupación sin notas no divide por cero: se rechaza nombrando la ocupación."""
        with self.assertRaisesRegex(FormatoInesperado, "3333"):
            oit._efecto_filas_sin_tarea([{"isco08": "3333", "nota": 0.9}], {("1111", 1): {"nota": 0.2}}, {})


class Margenes(unittest.TestCase):
    """La nota cabe en el margen de sus modelos con HOLGURA; las reconciliadas y las sin margen no se miran."""

    def test_dentro_y_fuera(self) -> None:
        """Los bordes con holgura entran; más allá, no."""

        def tarea(nota: float) -> dict[str, Any]:
            """Una tarea con margen [0,4, 0,6].

            Args:
                nota: Su nota.

            Returns:
                La tarea.
            """
            return {"margen": [0.4, 0.6], "metodo": "", "nota": nota}

        self.assertTrue(oit._en_margen(tarea(0.5)))
        self.assertTrue(oit._en_margen(tarea(0.6 + HOLGURA / 2)))
        self.assertFalse(oit._en_margen(tarea(0.6 + 2 * HOLGURA)))
        self.assertFalse(oit._en_margen(tarea(0.4 - 2 * HOLGURA)))
        self.assertTrue(oit._en_margen({**tarea(0.9), "metodo": oit.METODO_RECONCILIADO}))
        self.assertTrue(oit._en_margen({**tarea(0.9), "margen": None}))

    def test_difiere_de_la_tabla_a1(self) -> None:
        """Solo cuenta lo que pasa del redondeo o un gradiente distinto."""
        autor = {"media_ocupacion_autor": 0.5, "sd_ocupacion_autor": 0.1, "gradiente_autor": "G1"}
        a1 = {"media": 0.5, "sd": 0.1, "gradiente": "G1"}
        self.assertFalse(oit._difiere(autor, a1))
        self.assertTrue(oit._difiere({**autor, "media_ocupacion_autor": 0.5 + 2 * TOLERANCIA_A1 + 0.01}, a1))
        self.assertTrue(oit._difiere({**autor, "gradiente_autor": "G2"}, a1))


class EquivalenciaDelDocumento(unittest.TestCase):
    """La equivalencia no oculta revisiones del estudio aunque sus cifras A1 sean idénticas."""

    def setUp(self) -> None:
        """Documento sintético con las tres raíces de WP140 y sin red."""
        self.documento = (
            '<div id="wp-main"><h1>Study 2025</h1><p>Method: two models.</p>'
            '<p>Figure 16 <a href="https://pgmyrek.github.io/2025_GenAI_scores_ISCO08/">data</a></p>'
            f"<p>{constantes_oit.TITULO_TABLA_A1}</p><table><tr><td>Gradient 4</td><td>4110</td></tr></table>"
            '<img src="figure16.png" alt="Exposure gradients" /></div>'
            f'<div id="copyright"><p>CC BY 4.0</p><p>{oit.AVISO_ADAPTACION}</p><p>{oit.AVISO_TRADUCCION}</p>'
            '<a href="https://doi.org/10.54394/HETP0387">DOI</a>'
            '<a href="/cdn-cgi/l/email-protection#01404142">'
            '<span data-cfemail="01404142">[email&#160;protected]</span></a></div>'
            '<div class="ilo-footnotes-repo"><p>Study footnote.</p></div>'
        ).encode()
        self.equivalentes = tabla_a1_oit.equivalencia_del_original({"archivo": oit.DOCUMENTO})

    def test_revision_relevante_exige_aceptacion_aunque_a1_no_cambie(self) -> None:
        """Los avisos, método, identidad y referencias del estudio necesitan revisión cuando cambian."""
        for antes, despues in (
            (oit.AVISO_ADAPTACION.encode(), b"Aviso retirado"),
            (b"two models", b"three models"),
            (b"Study 2025", b"Study 2026"),
            (b"CC BY 4.0", b"All rights reserved"),
            (b"HETP0387", b"OTRO0000"),
            (b"Gradient 4", b"Gradient 3"),
            (b"2025_GenAI_scores_ISCO08/", b"2026_GenAI_scores_ISCO08/"),
            (b"figure16.png", b"figure16-revised.png"),
            (b"Study footnote.", b"Revised study footnote."),
            (b"01404142", b"01404143"),
        ):
            with self.subTest(antes=antes), tempfile.TemporaryDirectory() as temporal:
                nueva = self.documento.replace(antes, despues)
                destino = Path(temporal) / oit.DOCUMENTO
                destino.write_bytes(self.documento)
                with self.assertRaises(OriginalCambiado):
                    conservar_o_sustituir(
                        destino,
                        Descarga(nueva, "https://example.org", "text/html"),
                        ReglaDeCambio(self.equivalentes, None, False),
                    )
                self.assertEqual(destino.read_bytes(), self.documento)

    def test_plantilla_espacios_scripts_y_ofuscacion_equivalentes(self) -> None:
        """La presentación y una nueva clave XOR del mismo correo no son otra revisión del estudio."""
        nueva = self.documento.replace(b"01404142", b"02434241")
        nueva = nueva.replace(b"<h1>", b'<h1 class="nuevo">').replace(b"two models", b"two   models")
        nueva = nueva.replace(b"Method:", b"<script>analytics()</script><style>p { color: red }</style>Method:")
        nueva += b"<footer>New template</footer><script>analytics()</script><style>p { color: red }</style>"
        self.assertTrue(self.equivalentes(self.documento, nueva))

    def test_raices_ausentes_repetidas_o_sin_cierre_no_se_equiparan(self) -> None:
        """Un documento que pierde sus delimitadores no produce dos firmas vacías iguales."""
        for nueva in (
            self.documento.replace(b'id="wp-main"', b'id="otro"'),
            self.documento + b'<div id="copyright">Otra licencia</div>',
            self.documento[:-6],
            self.documento.replace(b'id="wp-main"', b'id="wp-main" id="otro"'),
            self.documento.replace(b'figure16.png"', b'figure16.png" src="otra.png"'),
            self.documento.replace(b'<div id="wp-main">', b'<div id="wp-main"/>'),
            self.documento + b"<script>Sin cierre",
            self.documento + b"<style>Sin cierre",
            self.documento.replace(b"Study 2025", b'<div class="overlay-button">Study 2025'),
            self.documento.replace(b"Study 2025", b"Study \xff2025"),
            self.documento.replace(b"01404142", b"no-hex"),
        ):
            with self.subTest(nueva=nueva[-80:]), self.assertRaises(FormatoInesperado):
                self.equivalentes(self.documento, nueva)


class PruebaOit(unittest.TestCase):
    """Tareas oficiales ISCO-08 y notas del autor."""

    def test_tareas_oficiales(self) -> None:
        """La lista «Tasks include» se separa por sus letras, sin el punto y coma final."""
        bruto = "(a) preparing budgets;\n(b) checking accounts (monthly); (c) reporting."
        self.assertEqual(
            oit._tareas_oficiales(bruto),
            [
                {"indice": 1, "letra": "a", "texto_en": "preparing budgets"},
                {"indice": 2, "letra": "b", "texto_en": "checking accounts (monthly)"},
                {"indice": 3, "letra": "c", "texto_en": "reporting"},
            ],
        )

    def test_margen_entre_modelos(self) -> None:
        """La nota ha de quedar entre sus dos modelos, salvo si la tarea se reconcilió."""
        self.assertTrue(oit._en_margen({"margen": [0.2, 0.4], "nota": 0.3, "metodo": "average"}))
        self.assertFalse(oit._en_margen({"margen": [0.2, 0.4], "nota": 0.5, "metodo": "average"}))
        self.assertTrue(oit._en_margen({"margen": [0.2, 0.4], "nota": 0.5, "metodo": "reconciled"}))
        self.assertTrue(oit._en_margen({"margen": None, "nota": 0.5, "metodo": "average"}))

    def test_diferencia_con_tabla_a1(self) -> None:
        """Una diferencia de redondeo a dos decimales no cuenta; un gradiente distinto, sí."""
        a1 = {"media": 0.34, "sd": 0.1, "gradiente": "gradiente_1"}
        autor = {"media_ocupacion_autor": 0.3401, "sd_ocupacion_autor": 0.1003, "gradiente_autor": "gradiente_1"}
        self.assertFalse(oit._difiere(autor, a1))
        self.assertTrue(oit._difiere({**autor, "gradiente_autor": "gradiente_2"}, a1))

    def test_filas_a1(self) -> None:
        """La tabla A1 se localiza por su título y se lee celda a celda."""
        html = (
            f"<p>{constantes_oit.TITULO_TABLA_A1}</p><table><tr><th>Exposure</th><th>4-digit code</th></tr>"
            "<tr><td>Gradient 4</td><td><b>4110</b></td></tr></table>"
        )
        self.assertEqual(tabla_a1_oit._filas_a1(html), [["Exposure", "4-digit code"], ["Gradient 4", "4110"]])
        with self.assertRaises(FormatoInesperado):
            tabla_a1_oit._filas_a1("<table></table>")

    def test_filas_a1_sin_cierre(self) -> None:
        """Sin «</table>» tras el título, la lectura falla en vez de tomar el resto del documento."""
        html = f"<p>{constantes_oit.TITULO_TABLA_A1}</p><table><tr><td>Gradient 4</td></tr>"
        with self.assertRaises(FormatoInesperado):
            tabla_a1_oit._filas_a1(html)

    def test_tabla_a1_fila_por_fila(self) -> None:
        """Una fila buena se lee; un código repetido, una fila corta o una cifra no numérica fallan con su motivo."""
        gradiente = next(iter(constantes_oit.GRADIENTES))
        fila = [gradiente, "4110", "General office clerks", "0.5", "0.1"]
        cabecera = constantes_oit.CABECERA_TABLA_A1
        self.assertEqual(tabla_a1_oit._tabla_a1([cabecera, fila])["4110"]["media"], 0.5)
        for filas, motivo in (
            ([cabecera, fila, fila], "repetido"),
            ([cabecera, fila[:4]], "incompleta"),
            ([cabecera, [*fila[:3], "n/d", "0.1"]], "4110"),
            ([cabecera, [*fila[:3], "nan", "0.1"]], "4110"),
        ):
            with self.subTest(motivo=motivo), self.assertRaisesRegex(FormatoInesperado, motivo):
                tabla_a1_oit._tabla_a1(filas)


if __name__ == "__main__":
    unittest.main()
