"""El enunciado y la muestra de cada edición, comprobados con sus documentos; IAG_NO3, opcional.

Las pruebas con los documentos reales del INE (metodología y cuestionario de 2025 y 2026, microdatos de 2026) los leen
de la carpeta que da `FARO_EVIDENCIAS_TICH`, fuera del repositorio; sin ella, se omiten con su motivo.
"""

import csv
import io
import json
import os
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest import mock

import plataforma_datos.ia_y_trabajo.fuentes.tich.lector as tich
from plataforma_datos.comun.entrada_salida import sha256
from plataforma_datos.comun.nucleo import FormatoInesperado
from plataforma_datos.ia_y_trabajo.fuentes.tich import documentos_de_la_edicion as documentos
from plataforma_datos.ia_y_trabajo.fuentes.tich.constantes import FICHERO_CUESTIONARIO, VARIABLES
from plataforma_datos.ia_y_trabajo.fuentes.tich.edicion import primera
from plataforma_datos.ia_y_trabajo.fuentes.tich.motivos_no_uso import no_sabian_como

EVIDENCIAS = os.environ.get("FARO_EVIDENCIAS_TICH", "")
SIN_EVIDENCIAS = "sin FARO_EVIDENCIAS_TICH: los documentos y microdatos reales no viven en el repositorio"
# Huellas de los documentos reales capturados el 15/11/2026.
HUELLAS = {
    "metodologia-2025.pdf": "500f7157aaed28b5af9129d665458c2a2347f7fd83735812d070d2d13ca67905",
    "metodologia-2026.pdf": "0d90a3e3ef9cfcd29bd3a0982bd17ad707e1fdd57ea046b008a279adb610ede2",
    "cuestionario-2025.pdf": "f05b29e1e4d917d6fe201f11246b452c82d9132d9d81ca894fe7bd97a43948ae",
    "cuestionario-2026.pdf": "2172bcb98f59fb8b6b3e5867fecfbfa53f234318a3d86f7359fa2ff4a11d8290",
    "datos_2026.zip": "fe42a2dc1964bed0fae17f0daea94bb8354a4f8a1aeda1ed8b103191ed1536b6",
}


def diseno_de_la_pregunta() -> dict:
    """Un diseño de registro mínimo con las variables de la pregunta tal como las describe el INE.

    Returns:
        El diseño.
    """
    return {
        "layout": [
            {
                "name": "IAG",
                "description": "Uso de alguna herramienta de IA Generativa (últimos 3 meses)",
                "codelist_ref": "T_SINO",
            },
            {
                "name": "IAG_TRAB",
                "description": "Finalidad del uso de IA Generativa: Fines profesionales o relacionados con el trabajo",
                "codelist_ref": "T_SINO",
            },
        ],
        "codelists": {"T_SINO": dict(documentos.CODIGOS_SI_NO)},
    }


# Las dos preguntas con la redacción del cuestionario, como las da la extracción del PDF, y la de las razones para no
# usar IA generativa que las sigue en 2025: acaba con la misma frase de periodo que la segunda.
CUESTIONARIO = (
    "17. ¿Ha utilizado en los últimos tres meses alguna herramienta de IA Generativa (ChatGPT, Copilot, Gemini, "
    "LlaMA, Midjourney, etc) para crear contenido como texto, imágenes, código de programación o vídeos? SÍ 1 → "
    "pasar a pregunta 18 NO 6 → pasar a pregunta 19 18. ¿Para qué ha utilizado herramientas de IA Generativa en los "
    "últimos 3 meses? SÍ NO a) Para fines privados 1 6 b) Para fines profesionales o relacionados con el trabajo 1 6 "
    "c) Para la educación formal 1 6 19. ¿Cuáles fueron las razones por las que no utilizó herramientas de IA "
    "Generativa en los últimos 3 meses? SÍ NO a) No fue necesario 1 6"
)


class PruebaEnunciado(unittest.TestCase):
    """El enunciado se compara por partes; cada parte distinta se nombra, y una variante aceptada del año pasa."""

    def test_el_mismo_enunciado_no_tiene_diferencias_aunque_cambien_espacios_y_numero(self) -> None:
        """La extracción parte palabras y el número de la pregunta cambia: no son diferencias."""
        partido = (
            CUESTIONARIO.replace("ChatGPT,", "ChatGPT ,").replace("17.", "28.").replace("programación", "progra mación")
        )
        self.assertEqual(documentos.diferencias_del_enunciado(diseno_de_la_pregunta(), partido, "2026"), [])

    def test_cada_parte_distinta_se_nombra(self) -> None:
        """Otra pregunta, otro periodo, otra opción u otros códigos, en el diseño o en el cuestionario."""
        sin_iag = diseno_de_la_pregunta()
        sin_iag["layout"] = sin_iag["layout"][1:]
        opcion = diseno_de_la_pregunta()
        opcion["layout"][1]["description"] = "Finalidad del uso de IA Generativa: Trabajo"
        lista = diseno_de_la_pregunta()
        lista["layout"][0]["codelist_ref"] = "T_FRECUENCIA"
        codigos = diseno_de_la_pregunta()
        codigos["codelists"]["T_SINO"] = {"1": "Sí", "2": "No"}
        for diseno, cuestionario, partes in (
            (sin_iag, CUESTIONARIO, ["pregunta"]),
            (opcion, CUESTIONARIO, ["opciones"]),
            (lista, CUESTIONARIO, ["codigos"]),
            (codigos, CUESTIONARIO, ["codigos"]),
            (diseno_de_la_pregunta(), CUESTIONARIO.replace("tres meses", "doce meses"), ["periodo"]),
            (diseno_de_la_pregunta(), CUESTIONARIO.replace("trabajo 1 6", "trabajo 1 2"), ["codigos"]),
        ):
            with self.subTest(partes=partes):
                diferencias = documentos.diferencias_del_enunciado(diseno, cuestionario, "2026")
                self.assertEqual(documentos.partes_distintas(diferencias), partes, diferencias)

    def test_la_frase_del_periodo_repetida_en_otra_pregunta_no_es_una_diferencia(self) -> None:
        """La pregunta de las razones para no usar IA repite el final del periodo (2025) o lo cierra con «:» (2026)."""
        con_dos_puntos = CUESTIONARIO.replace("meses? SÍ NO a) No fue", "meses: a) No fue")
        self.assertNotEqual(con_dos_puntos, CUESTIONARIO)
        for cuestionario in (CUESTIONARIO, con_dos_puntos):
            with self.subTest(cuestionario=cuestionario[-60:]):
                self.assertEqual(
                    documentos.diferencias_del_enunciado(diseno_de_la_pregunta(), cuestionario, "2025"), []
                )

    def test_una_diferencia_real_se_detecta_aunque_el_periodo_se_repita(self) -> None:
        """Otro periodo en una sola de las dos preguntas, otra opción o una pregunta ausente."""
        segunda_sin_pregunta = CUESTIONARIO[: CUESTIONARIO.index("18. ")] + CUESTIONARIO[CUESTIONARIO.index("19. ") :]
        primera_sin_pregunta = CUESTIONARIO[CUESTIONARIO.index("18. ") :]
        for cuestionario, partes in (
            (CUESTIONARIO.replace("tres meses", "doce meses"), ["periodo"]),
            (
                CUESTIONARIO.replace(
                    "utilizado herramientas de IA Generativa en los últimos 3",
                    "utilizado herramientas de IA Generativa en los últimos 12",
                ),
                ["periodo"],
            ),
            (CUESTIONARIO.replace("b) Para fines profesionales", "b) Para fines laborales"), ["opciones"]),
            (segunda_sin_pregunta, ["pregunta", "periodo", "opciones", "codigos"]),
            (primera_sin_pregunta, ["pregunta", "periodo", "codigos"]),
        ):
            with self.subTest(partes=partes, cuestionario=cuestionario[:40]):
                diferencias = documentos.diferencias_del_enunciado(diseno_de_la_pregunta(), cuestionario, "2025")
                self.assertEqual(documentos.partes_distintas(diferencias), partes, diferencias)

    def test_una_variante_aceptada_del_anio_no_es_una_diferencia(self) -> None:
        """Un retoque declarado para ese año, con su evidencia, pasa; en otro año sigue siendo distinto."""
        retocado = CUESTIONARIO.replace(
            "¿Ha utilizado en los últimos tres meses", "¿Ha usado en los tres últimos meses"
        )
        variante = {
            "2026": {
                "periodo": (
                    "¿Ha usado en los tres últimos meses",
                    "¿Para qué ha utilizado herramientas de IA Generativa en los últimos 3 meses?",
                )
            }
        }
        with mock.patch.object(documentos, "VARIANTES_ACEPTADAS", variante):
            self.assertEqual(documentos.diferencias_del_enunciado(diseno_de_la_pregunta(), retocado, "2026"), [])
            distintas = documentos.diferencias_del_enunciado(diseno_de_la_pregunta(), retocado, "2027")
        self.assertEqual(documentos.partes_distintas(distintas), ["periodo"])

    def test_un_pdf_roto_se_detiene_y_un_fallo_ajeno_no_se_oculta(self) -> None:
        """Lo que no es PDF se detiene con su nombre; un error que no es de lectura no se convierte en otro."""
        with self.assertRaisesRegex(FormatoInesperado, "cuestionario.pdf no se puede leer"):
            documentos.texto_del_pdf(b"no es un pdf", "cuestionario.pdf")
        with (
            mock.patch.object(documentos, "PdfReader", side_effect=RuntimeError("fallo del programa")),
            self.assertRaises(RuntimeError),
        ):
            documentos.texto_del_pdf(b"%PDF", "cuestionario.pdf")


class PruebaDocumentosDeLaAdmitida(unittest.TestCase):
    """La edición admitida no lee ni analiza sus PDF: lo que dicen está en su estado."""

    def test_las_secciones_y_las_huellas_salen_del_estado_sin_leer_ningun_pdf(self) -> None:
        """2.500 y 216 de la primera edición, con las huellas de su metodología y su cuestionario."""
        edicion = primera()
        with (
            mock.patch.object(documentos, "texto_del_pdf", side_effect=AssertionError("no se lee el PDF")),
            mock.patch.object(documentos, "secciones_en_muestra", side_effect=AssertionError("no se lee el PDF")),
        ):
            leidos = documentos.de_la_admitida(
                diseno_de_la_pregunta(), edicion["secciones"], edicion["documentos"], edicion["anio"]
            )
        self.assertEqual(
            leidos["secciones_en_muestra"], {"espana": 2500, "cataluna": 216, "sha256": HUELLAS["metodologia-2025.pdf"]}
        )
        self.assertEqual(
            leidos["enunciado"], {"diferencias": [], "sha256_cuestionario": HUELLAS["cuestionario-2025.pdf"]}
        )

    def test_un_diseno_de_registro_sin_la_pregunta_detiene_la_admitida_y_dice_la_parte(self) -> None:
        """El diseño de registro llega con los microdatos y sí se comprueba."""
        sin_iag = diseno_de_la_pregunta()
        sin_iag["layout"] = sin_iag["layout"][1:]
        diferencias = documentos.de_la_admitida(sin_iag, primera()["secciones"], primera()["documentos"], "2025")
        self.assertEqual(documentos.partes_distintas(diferencias["enunciado"]["diferencias"]), ["pregunta"])


class PruebaIagNo3Opcional(unittest.TestCase):
    """Sin IAG_NO3 en la edición, `tich` se calcula y el motivo queda sin contraste."""

    def test_sin_la_variable_se_leen_las_demas_y_el_motivo_queda_sin_calculo(self) -> None:
        """El cuestionario sin IAG_NO3 se lee; el cálculo del motivo no tiene clases ni descripción."""
        texto = "\t".join(VARIABLES) + "\n" + "\t".join("1" for _ in VARIABLES) + "\n"
        interno = io.BytesIO()
        nombres = tich.estado.nombres(primera())
        with zipfile.ZipFile(interno, "w") as escrito:
            escrito.writestr(nombres.diseno, json.dumps(diseno_de_la_pregunta()))
            escrito.writestr(nombres.datos, texto)
        with tempfile.TemporaryDirectory() as temporal:
            microdatos = Path(temporal) / "microdatos.zip"
            with zipfile.ZipFile(microdatos, "w") as escrito:
                escrito.writestr(FICHERO_CUESTIONARIO, interno.getvalue())
            with mock.patch.object(tich, "original", return_value=microdatos):
                filas, diseno = tich._cuestionario(primera())
        self.assertNotIn("IAG_NO3", filas[0])
        self.assertEqual(no_sabian_como(filas, 100.0, tich.estimar, diseno), {"descripcion": None, "por_clase": {}})


@unittest.skipUnless(EVIDENCIAS, SIN_EVIDENCIAS)
class PruebaDocumentosReales(unittest.TestCase):
    """Con los PDF reales de 2025 y 2026: las secciones en muestra, con su huella, y el mismo enunciado."""

    def test_secciones_en_muestra_y_enunciado_de_2025_y_2026(self) -> None:
        """2.500 secciones en España y 216 en Cataluña en las dos ediciones; el enunciado no cambia."""
        carpeta = Path(EVIDENCIAS)
        for nombre, huella in HUELLAS.items():
            self.assertEqual(sha256(carpeta / nombre), huella, nombre)
        with zipfile.ZipFile(carpeta / "datos_2026.zip") as externo:
            interno = zipfile.ZipFile(io.BytesIO(externo.read(FICHERO_CUESTIONARIO)))
        with interno:
            diseno = json.loads(interno.read("dr_TICHcuestionario_2026.json"))
            cabecera = next(
                csv.reader(
                    io.StringIO(interno.read("CSV/TICHcuestionario_2026.tab").decode("latin-1")[:4000]), delimiter="\t"
                )
            )
        self.assertLessEqual(set(VARIABLES), set(cabecera))
        for anio in ("2025", "2026"):
            with self.subTest(anio=anio):
                leidos = documentos.leer_documentos(
                    diseno, carpeta / f"metodologia-{anio}.pdf", carpeta / f"cuestionario-{anio}.pdf", anio
                )
                self.assertEqual(
                    leidos["secciones_en_muestra"],
                    {"espana": 2500, "cataluna": 216, "sha256": HUELLAS[f"metodologia-{anio}.pdf"]},
                )
                self.assertEqual(leidos["enunciado"]["diferencias"], [])
                self.assertEqual(leidos["enunciado"]["sha256_cuestionario"], HUELLAS[f"cuestionario-{anio}.pdf"])


if __name__ == "__main__":
    unittest.main()
