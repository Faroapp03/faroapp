"""Los PDF reales de la TIC-H que viven en el repositorio se leen con `pypdf` y casan por partes con la serie.

Son copias byte a byte de los del INE (`datos/ine-tich/procedencia.json`): la metodología y el cuestionario de 2026 y el
cuestionario de 2025. Un cambio de la biblioteca o de las expresiones que los leen falla aquí, en la batería normal.
"""

import unittest
from pathlib import Path
from unittest import mock

from plataforma_datos.ia_y_trabajo.fuentes.tich import documentos_de_la_edicion as documentos
from plataforma_datos.ia_y_trabajo.pruebas.test_documentos_tich import diseno_de_la_pregunta

DATOS = Path(__file__).parent / "datos" / "ine-tich"
METODOLOGIA_2026 = DATOS / "metodologia-2026.pdf"
CUESTIONARIOS = {"2025": DATOS / "cuestionario-2025.pdf", "2026": DATOS / "cuestionario-2026.pdf"}


class PruebaDocumentosReales(unittest.TestCase):
    """Secciones en muestra de la metodología de 2026 y enunciado de los cuestionarios de 2025 y 2026."""

    @classmethod
    def setUpClass(cls) -> None:
        """Extrae una sola vez el texto de cada cuestionario."""
        cls.textos = {
            anio: documentos.texto_del_pdf(ruta.read_bytes(), ruta.name) for anio, ruta in CUESTIONARIOS.items()
        }

    def test_la_metodologia_de_2026_da_2500_secciones_y_216_en_cataluna(self) -> None:
        """Las dos cifras, una sola vez cada una, con la huella del PDF."""
        leidas = documentos.secciones_en_muestra(METODOLOGIA_2026.read_bytes(), METODOLOGIA_2026.name)
        self.assertEqual(
            leidas,
            {
                "espana": 2500,
                "cataluna": 216,
                "sha256": "0d90a3e3ef9cfcd29bd3a0982bd17ad707e1fdd57ea046b008a279adb610ede2",
            },
        )

    def test_los_dos_cuestionarios_casan_con_la_serie_en_cada_parte(self) -> None:
        """2025 y 2026 traen la pregunta, el periodo, la opción de trabajo y los códigos de la serie."""
        for anio, texto in self.textos.items():
            with self.subTest(anio=anio):
                self.assertEqual(documentos.diferencias_del_enunciado(diseno_de_la_pregunta(), texto, anio), [])

    def test_un_cambio_de_una_sola_parte_se_marca_solo_en_esa_parte(self) -> None:
        """Otra redacción de la segunda pregunta es «pregunta», no también «periodo»; otro periodo es «periodo»."""
        for anio, texto in self.textos.items():
            for antes, despues, partes in (
                ("¿Para qué ha utilizado", "¿Con qué fin ha empleado", ["pregunta"]),
                ("en los últimos 3 meses? SÍ NO a) Para", "en los últimos 6 meses? SÍ NO a) Para", ["periodo"]),
                ("¿Ha utilizado en los últimos tres meses", "¿Ha utilizado en el último año", ["periodo"]),
                ("b) Para fines profesionales", "b) Por trabajo", ["opciones"]),
            ):
                with self.subTest(anio=anio, antes=antes):
                    self.assertEqual(texto.count(antes), 1)
                    cambiado = texto.replace(antes, despues)
                    diferencias = documentos.diferencias_del_enunciado(diseno_de_la_pregunta(), cambiado, anio)
                    self.assertEqual(documentos.partes_distintas(diferencias), partes)


class PruebaVarianteDelDiseno(unittest.TestCase):
    """Un retoque de la descripción del diseño de registro se admite solo como variante de ese año."""

    def test_una_variante_del_diseno_solo_vale_para_su_anio_y_su_parte(self) -> None:
        """«(3 últimos meses)» en `IAG`: periodo distinto; con su variante de 2026, casa en 2026 y no en 2027."""
        diseno = diseno_de_la_pregunta()
        diseno["layout"][0]["description"] = "Uso de alguna herramienta de IA Generativa (3 últimos meses)"
        self.assertEqual(documentos.partes_distintas(documentos.diferencias_del_diseno(diseno, "2026")), ["periodo"])
        variante = {"2026": {"IAG": {"periodo": "(3 últimos meses)"}}}
        with mock.patch.object(documentos, "VARIANTES_DEL_DISENO", variante):
            self.assertEqual(documentos.diferencias_del_diseno(diseno, "2026"), [])
            otro_anio = documentos.diferencias_del_diseno(diseno, "2027")
            otra_parte = documentos.diferencias_del_diseno(
                {**diseno, "codelists": {"T_SINO": {"1": "Sí", "2": "No"}}}, "2026"
            )
        self.assertEqual(documentos.partes_distintas(otro_anio), ["periodo"])
        self.assertEqual(documentos.partes_distintas(otra_parte), ["codigos"])


if __name__ == "__main__":
    unittest.main()
