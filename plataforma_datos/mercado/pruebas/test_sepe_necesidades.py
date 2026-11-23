"""Pruebas de las necesidades formativas por ocupación del SEPE (necesidades.py): lectura, IA, conjunto.

Fixtures autónomos con la forma de las fichas; preparación y validación en directorios temporales, sin red.
"""

import contextlib
import copy
import hashlib
import io
import re
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import plataforma_datos.mercado.fuentes.necesidades.lector as necesidades
from plataforma_datos.comun import entrada_salida
from plataforma_datos.comun.entrada_salida import guardar_json, guardar_jsonl, leer_json, leer_jsonl
from plataforma_datos.comun.nucleo import ERROR, Carpetas, FormatoInesperado, ValidacionFallida
from plataforma_datos.orquestacion import admision


def _boton(titulo: str) -> str:
    """El botón desplegable con el que el SEPE titula cada sección.

    Returns:
        El HTML del botón, con el título dentro.
    """
    return f'<button class="botonDesplegable" aria-expanded="true"><span>{titulo}</span><i></i></button>'


# Un porcentaje que ninguna ficha puede publicar: fuera de 0–100.
PORCENTAJE_IMPOSIBLE = 120.0
# Recuentos del fixture sintético: no se leen preparados ni originales operativos.
FICHAS_RECIENTES = 315
FICHAS_NO_ANTIGUAS = 322
FICHAS_IA = 57
ANIO_CON_PORCENTAJES = 2025

FICHA = f"""
<h3 class="informacion-perfiles">
  <span class="informacion-perfiles--perfil">2121 - Enfermeros no especializados</span>
  <span class="informacion-perfiles--fecha">Año de estudio - 2026</span>
</h3>
{_boton("Necesidades formativas destacadas en competencias técnico - profesionales")}
<table class="table"><tbody>
  <tr><td>Actividades de promoción de la salud</td><td>21,05%</td></tr>
  <tr><td>IA ( Inteligencia Artificial )</td><td>5,26%</td></tr>
</tbody></table>
{_boton("Necesidades formativas en competencias de idiomas")}
<table class="table t-idiomas">
  <thead><tr><th>Idiomas</th><th>Comprender la lengua hablada</th><th>Escribir</th></tr></thead>
  <tbody><tr><th>
    INGLÉS
    50%
  </th><td>75,00%</td><td>A</td></tr></tbody>
</table>
{_boton("Necesidades formativas en competencias digitales")}
<table class="table"><thead><tr><th>Nivel de competencia</th></tr></thead>
  <tbody><tr><td>Base de Datos</td><td>BÁSICO</td><td>0%</td></tr></tbody></table>
{_boton("Actividades Económicas más representativas en la contratación")}
<table class="table"><tbody><tr><td>Actividades hospitalarias</td><td>40%</td></tr></tbody></table>
"""


class PruebaLectura(unittest.TestCase):
    """Cómo se lee una ficha del SEPE."""

    def setUp(self) -> None:
        """La ficha de ejemplo, leída."""
        self.ficha = necesidades.leer_ficha(FICHA)

    def test_cabecera(self) -> None:
        """Código, ocupación y año salen de la cabecera de la ficha, no del nombre del archivo."""
        self.assertEqual(
            (self.ficha["cno"], self.ficha["ocupacion"], self.ficha["anio"]),
            ("2121", "Enfermeros no especializados", 2026),
        )

    def test_porcentaje_tal_cual(self) -> None:
        """El texto de la celda y su número; un nivel, una letra o una celda vacía no son un porcentaje."""
        primera = self.ficha["competencias"]["tecnicas"][0]
        self.assertEqual((primera["porcentaje_publicado"], primera["porcentaje"]), ("21,05%", 21.05))
        for texto in ("BÁSICO", "A", ""):
            self.assertIsNone(necesidades.porcentaje(texto))

    def test_idiomas_con_sus_destrezas(self) -> None:
        """El porcentaje del idioma va en su cabecera de fila; las destrezas, con el nombre de su columna."""
        ingles = self.ficha["competencias"]["idiomas"][0]
        self.assertEqual((ingles["competencia"], ingles["porcentaje"]), ("INGLÉS", 50.0))
        self.assertEqual(
            ingles["destrezas"],
            [
                {"destreza": "Comprender la lengua hablada", "valor_publicado": "75,00%", "porcentaje": 75.0},
                {"destreza": "Escribir", "valor_publicado": "A", "porcentaje": None},
            ],
        )

    def test_nivel_y_cabeceras_no_son_competencias(self) -> None:
        """La fila de <thead> no es una competencia; el nivel va aparte del porcentaje."""
        self.assertEqual(
            self.ficha["competencias"]["digitales"],
            [{"competencia": "Base de Datos", "porcentaje_publicado": "0%", "porcentaje": 0.0, "nivel": "BÁSICO"}],
        )

    def test_las_actividades_economicas_no_se_preparan(self) -> None:
        """La sección de actividades económicas se reconoce, pero no es una lista de competencias."""
        self.assertEqual(sorted(self.ficha["competencias"]), ["digitales", "idiomas", "tecnicas"])

    def test_una_seccion_desconocida_detiene_la_lectura(self) -> None:
        """Si el SEPE añade una sección, se revisa antes de prepararla."""
        with self.assertRaises(FormatoInesperado):
            necesidades.leer_ficha(FICHA + _boton("Necesidades formativas en competencias verdes"))

    def test_la_ia_nombrada(self) -> None:
        """«Inteligencia artificial» con o sin tildes y mayúsculas, o la sigla «IA» como palabra aparte."""
        self.assertEqual(necesidades.competencias_con_ia(self.ficha), ["IA ( Inteligencia Artificial )"])
        for texto in (
            "Inteligencia artificial y Machine Learning",
            "Herramientas de IA generativa",
            "INTELIGÈNCIA ARTIFICIAL",
        ):
            self.assertTrue(necesidades.nombra_la_ia(texto), texto)
        for texto in ("Multimedia", "Ia de contenidos", "Machine learning"):
            self.assertFalse(necesidades.nombra_la_ia(texto), texto)


def _fichas_de_prueba() -> list[dict]:
    """Fixture sintético de los recuentos que valida la fuente, sin copiar datos operativos.

    Returns:
        Fichas independientes: 315 del último año, 51 antiguas con ceros y dos páginas técnicas cortadas.
    """
    fichas = []
    codigos = [str(1000 + indice) for indice in range(373)] + ["5110", "5120"]
    for indice, codigo in enumerate(codigos):
        anio = 2026 if indice < FICHAS_RECIENTES else 2025 if indice < FICHAS_NO_ANTIGUAS else 2024
        nombre = "Herramientas de IA" if indice < FICHAS_IA else "Competencia de prueba"
        tecnicas = (
            []
            if codigo in {"5110", "5120"}
            else [
                {
                    "competencia": nombre,
                    "porcentaje_publicado": "0%" if anio < ANIO_CON_PORCENTAJES else "50%",
                    "porcentaje": 0.0 if anio < ANIO_CON_PORCENTAJES else 50.0,
                }
            ]
        )
        fichas.append(
            {
                "cno": codigo,
                "ocupacion": f"Ocupación {codigo}",
                "anio": anio,
                "competencias": {"tecnicas": tecnicas},
                "competencias_ia": [nombre] if indice < FICHAS_IA else [],
                "archivo": f"necesidades-{codigo}.html",
                "sha256": "huella",
                "url": f"https://example.test/{codigo}",
            }
        )
    return fichas


class PruebaConjunto(unittest.TestCase):
    """Etapas públicas con archivos temporales y controles de admisión."""

    def setUp(self) -> None:
        """Originales mínimos, procedencia y preparados autónomos para validar."""
        self.temporal = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporal.cleanup)
        raiz = Path(self.temporal.name)
        self.carpetas = Carpetas(raiz / "original", raiz / "preparado", raiz / "validado")
        self.carpetas.original.mkdir()
        self.fichas = _fichas_de_prueba()
        contenido = b"original sintetico"
        huella = hashlib.sha256(contenido).hexdigest()
        for ficha in self.fichas:
            ficha["sha256"] = huella
            (self.carpetas.original / ficha["archivo"]).write_bytes(contenido)
        self.procedencia = {
            "cita": "SEPE (fixture)",
            "licencia": "Licencia de prueba",
            "archivos": [
                {
                    "archivo": ficha["archivo"],
                    "sha256": huella,
                    "url": ficha["url"],
                    "consultado_utc": "2026-10-06T12:00:00Z",
                }
                for ficha in self.fichas
            ],
        }
        self.preparado = self.carpetas.preparado / "fichas.jsonl"
        guardar_json(self.carpetas.original / "procedencia.json", self.procedencia)
        for nombre, valor in (
            ("ORIGINAL", self.carpetas.original),
            ("FICHAS", self.preparado),
            ("PROCEDENCIA", self.carpetas.original / "procedencia.json"),
        ):
            parche = mock.patch.object(necesidades, nombre, valor)
            parche.start()
            self.addCleanup(parche.stop)
        for parche in (
            mock.patch.object(entrada_salida, "carpetas", return_value=self.carpetas),
            mock.patch.object(admision, "carpetas", return_value=self.carpetas),
            mock.patch.object(necesidades, "grupos_primarios", return_value={f["cno"] for f in self.fichas}),
        ):
            parche.start()
            self.addCleanup(parche.stop)

    def _validar(self, fichas: list[dict]) -> dict:
        """Valida un preparado y lee el resultado publicado.

        Returns:
            El conjunto escrito por la etapa real.
        """
        guardar_jsonl(self.preparado, fichas)
        with contextlib.redirect_stdout(io.StringIO()):
            necesidades.validar()
        return leer_json(self.carpetas.validado / "sepe-necesidades.json")

    def test_el_conjunto_se_reproduce(self) -> None:
        """Validar conserva contenido y orden de fichas, retirando solo el literal del porcentaje técnico."""
        conjunto = self._validar(self.fichas)
        esperadas = {
            ficha["cno"]: {
                "ocupacion": ficha["ocupacion"],
                "anio": ficha["anio"],
                "url": ficha["url"],
                "competencias": {
                    "tecnicas": [
                        {"competencia": fila["competencia"], "porcentaje": fila["porcentaje"]}
                        for fila in ficha["competencias"]["tecnicas"]
                    ]
                },
                "competencias_ia": ficha["competencias_ia"],
            }
            for ficha in self.fichas
        }
        self.assertEqual(conjunto["ocupaciones"], esperadas)
        self.assertEqual(list(conjunto["ocupaciones"]), [ficha["cno"] for ficha in self.fichas])
        self.assertEqual(
            (conjunto["cita"], conjunto["licencia"], conjunto["consulta"]),
            (self.procedencia["cita"], self.procedencia["licencia"], "2026-10-06"),
        )

    def test_los_controles_pasan_y_saltan(self) -> None:
        """Cada entrada defectuosa rechaza solo su control y no publica un conjunto nuevo."""
        self._validar(self.fichas)
        fuera = copy.deepcopy(self.fichas)
        fuera[0]["competencias"]["tecnicas"][0]["porcentaje"] = PORCENTAJE_IMPOSIBLE
        otra_huella = [{**self.fichas[0], "sha256": "0"}, *self.fichas[1:]]
        # La ficha de 2025 sin IA no afecta a otros recuentos: quitarla altera solo el número de fichas.
        for caso, fichas, control in (
            ("una ficha de menos", self.fichas[:321] + self.fichas[322:], "fichas, una por grupo primario"),
            ("un porcentaje de 120", fuera, "porcentajes publicados están entre 0 y 100"),
            ("una huella cambiada", otra_huella, "la huella de su original"),
        ):
            with self.subTest(caso):
                antes = (self.carpetas.validado / "sepe-necesidades.json").read_bytes()
                with self.assertRaises(ValidacionFallida):
                    self._validar(fichas)
                informe = leer_json(self.carpetas.validacion)
                fallidos = [c["control"] for c in informe["controles"] if c["resultado"] == ERROR]
                self.assertEqual(len(fallidos), 1, fallidos)
                self.assertIn(control, fallidos[0])
                self.assertEqual((self.carpetas.validado / "sepe-necesidades.json").read_bytes(), antes)

    def test_dice_que_mide_y_que_no(self) -> None:
        """La nota explica la cifra y todo_a_cero se deriva de las fichas antiguas con competencias."""
        conjunto = self._validar(self.fichas)
        self.assertIn("no es un % de empresas", conjunto["nota_porcentaje"])
        esperadas = [
            f["cno"] for f in self.fichas if f["anio"] < ANIO_CON_PORCENTAJES and f["competencias"]["tecnicas"]
        ]
        self.assertEqual(conjunto["todo_a_cero"], esperadas)
        for ficha in conjunto["ocupaciones"].values():
            for filas in ficha["competencias"].values():
                for fila in filas:
                    self.assertNotIn("porcentaje_publicado", fila)

    def test_preparar_reproduce_los_preparados(self) -> None:
        """La etapa preparar produce las filas esperadas desde HTML conservando sus metadatos."""
        original = self.carpetas.original / "necesidades-2121.html"
        original.write_text(FICHA, encoding="utf-8")
        huella = hashlib.sha256(original.read_bytes()).hexdigest()
        entrada = {"archivo": original.name, "sha256": huella, "url": "https://example.test/2121"}
        guardar_json(necesidades.PROCEDENCIA, {"archivos": [entrada]})
        with (
            mock.patch.object(necesidades, "comprobar_originales", return_value=[original]),
            contextlib.redirect_stdout(io.StringIO()),
        ):
            necesidades.preparar()
        esperada = necesidades.leer_ficha(FICHA)
        esperada.update(entrada)
        esperada["competencias_ia"] = ["IA ( Inteligencia Artificial )"]
        self.assertEqual(leer_jsonl(self.preparado), [esperada])


class PruebaEntradasDefectuosas(unittest.TestCase):
    """Cambios de maqueta no asignan porcentajes a destrezas equivocadas."""

    def test_idiomas_sin_cabecera_se_rechazan_con_motivo(self) -> None:
        """Falta de thead produce un error de fuente legible."""
        html = re.sub(r"<thead>.*?</thead>", "", FICHA, count=1, flags=re.DOTALL)
        with self.assertRaisesRegex(FormatoInesperado, "idiomas.*cabecera"):
            necesidades.leer_ficha(html)

    def test_idiomas_con_celdas_de_mas_o_de_menos_se_rechazan(self) -> None:
        """Cada columna necesita exactamente un valor; no se trunca ni se omite."""
        for sustituto in ("", "<td>A</td><td>B</td>"):
            with self.subTest(sustituto=sustituto), self.assertRaisesRegex(FormatoInesperado, "destrezas"):
                necesidades.leer_ficha(FICHA.replace("<td>A</td>", sustituto))

    def test_preparar_identifica_el_original_que_falla(self) -> None:
        """Un error de estructura nombra el HTML entre todas las fichas."""
        with tempfile.TemporaryDirectory() as temporal:
            raiz = Path(temporal)
            original = raiz / "necesidades-2121.html"
            original.write_text("<html>sin ficha</html>", encoding="utf-8")
            procedencia = raiz / "procedencia.json"
            guardar_json(procedencia, {"archivos": [{"archivo": original.name}]})
            with (
                mock.patch.object(necesidades, "PROCEDENCIA", procedencia),
                mock.patch.object(necesidades, "comprobar_originales", return_value=[original]),
                self.assertRaisesRegex(FormatoInesperado, original.name),
            ):
                necesidades.preparar()


if __name__ == "__main__":
    unittest.main()
