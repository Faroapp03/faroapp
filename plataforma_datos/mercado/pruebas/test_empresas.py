"""Pruebas del uso de la IA en las empresas (empresas.py): lectura del formato actual, edición nueva y tabla de paso.

El formato de INEbase y de Tempus se prueba con fragmentos mínimos que copian el de la edición 2024–1T2025;
la edición nueva se simula con la red falsa. Los controles usan un ejemplo pequeño propio, sin entradas operativas.
"""

import copy
import io
import json
import os
import shutil
import tempfile
import unittest
from contextlib import redirect_stdout, suppress
from decimal import ROUND_HALF_UP, Decimal
from http.client import HTTPResponse
from pathlib import Path
from unittest import mock
from urllib.error import HTTPError
from urllib.request import Request

import plataforma_datos.mercado.fuentes.empresas.lector as empresas
import plataforma_datos.mercado.fuentes.empresas.piezas.cifras_empresas as cifras_empresas
import plataforma_datos.mercado.fuentes.empresas.piezas.constantes_empresas as constantes_empresas
import plataforma_datos.mercado.fuentes.empresas.piezas.controles_empresas as controles_empresas
from plataforma_datos.comun import entrada_salida, red
from plataforma_datos.comun import observacion_remota as observacion
from plataforma_datos.comun.nucleo import Controles, Descarga, FormatoInesperado, ValidacionFallida
from plataforma_datos.comun.pruebas.test_observacion_remota import respuesta_http
from plataforma_datos.comun.textos_y_cifras import numero_es
from plataforma_datos.mercado.fuentes.empresas.piezas import calendario_ine
from plataforma_datos.mercado.pruebas import ayuda_calendario
from plataforma_datos.orquestacion import cobertura_empresas, generacion_operativa

# Divisiones de la NACE Rev. 2: de la 01 a la 99, salvo los números que esa clasificación no usa.
DIVISIONES = frozenset(range(1, 100))


def setUpModule() -> None:
    """Las fechas de cada edición, del recorte real del calendario del INE; ninguna prueba lo descarga de la red."""
    parche = ayuda_calendario.fechas_del_recorte()
    parche.start()
    unittest.addModuleCleanup(parche.stop)


DIVISIONES_SIN_NACE = frozenset({4, 34, 40, 44, 48, 54, 57, 67, 76, 83, 89})
# Captura histórica de 2025: una revisión oficial posterior no está obligada a mantener estas cifras.
CIFRAS_DE_REFERENCIA_CATALUNA = {2025: {"C10-S951_X_K": 24.0, "F": 10.9, "G": 23.7, "I": 15.5, "N": 17.1}}

# Fragmentos con la forma de las páginas de INEbase el 06/10/2026.
RESULTADOS = """
<a href="/dynt3/inebase/index.htm?padre=12804&amp;capsel=12805"><span class="title">Comercio Electrónico en 2024 por
agrupación de actividad económica (excepto CNAE 56, 64-66 y 95.1) y tamaño de la empresa</span></a>
<a href="/dynt3/inebase/index.htm?padre=12804&amp;capsel=12806"><span class="title">Las TIC en las empresas (primer
trimestre de {anio}) por agrupación de actividad económica (excepto CNAE 56, 64-66 y 95.1) y tamaño</span></a>
<a href="/dynt3/inebase/index.htm?padre=12807&amp;capsel=12809"><span class="title">Las TIC en las empresas (primer
trimestre de {anio})</span></a>
<a href="/dynt3/inebase/index.htm?padre=12810&amp;capsel=12811"><span class="title">Las TIC en las empresas con 10 o más
empleados (primer trimestre de {anio}) por sectores de actividad (excepto CNAE 56, 64-66 y 95.1)</span></a>
<a href="/dynt3/inebase/index.htm?padre=12802&amp;capsel=12813"><span class="title">Errores de muestreo</span></a>
"""
CAPITULO = """
<a href="/jaxi/Tabla.htm?tpx=76386&amp;L=0">Cloud computing</a>
<a href="/jaxi/Tabla.htm?tpx={tabla}&amp;L=0">Inteligencia artificial</a>
<a href="/jaxi/Tabla.htm?tpx=76423&amp;L=0">Error estándar de variable Inteligencia Artificial, por distintos
estratos</a>
"""


def _a_la_decima(valor: float) -> float:
    """Redondeo a la décima como el que se lee en la web de Eurostat (10,85 → 10,9), sin el sesgo del binario.

    Returns:
        El valor redondeado a una décima, con la mitad hacia arriba.
    """
    return float(Decimal(str(valor)).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP))


def pagina(texto: str) -> Descarga:
    """Una página de INEbase como la devuelve la red.

    Returns:
        Descarga simulada de la página, en UTF-8.
    """
    return Descarga(texto.encode("utf-8"), "https://www.ine.es", "text/html")


def serie(agrupacion: str, pregunta: str, tamano: str, valor: float) -> dict[str, object]:
    """Una serie de Tempus de una edición, sin año en el dato, como la tabla 76387.

    Returns:
        Serie con su nombre, sus metadatos y su dato.
    """
    return {
        "Nombre": f"{agrupacion}, {pregunta}, {tamano}",
        "MetaData": [
            {"T3_Variable": "Agrupación de actividad (excepto CNAE 56, 64-66 y 95.1)", "Nombre": agrupacion},
            {"T3_Variable": "Principales variables", "Nombre": pregunta},
            {"T3_Variable": "Tamaño de la empresa", "Nombre": tamano},
        ],
        "Data": [{"Valor": valor}],
    }


class EjemploEmpresas:
    """Tres agrupaciones y dos grupos CNO propios; ninguna cifra representa una estadística publicada."""

    @classmethod
    def setUpClass(cls) -> None:
        """Construye el ejemplo y sustituye solo las entradas de sectores externas a empresas."""
        cls.existentes = {10, 41, 45, 55, 56, 64, 84}
        pregunta = "E.1 % de empresas que emplean tecnologías de Inteligencia Artificial"
        dimension = "Agrupación de actividad (excepto CNAE 56, 64-66 y 95.1)"

        def fila(parte: str, agrupacion: str, valor: float, territorio: str = "Total nacional") -> dict:
            return {
                "parte": parte,
                "pregunta": pregunta,
                "dimension": dimension,
                "agrupacion": agrupacion,
                "tamano": "Total",
                "territorio": territorio,
                "valor": valor,
            }

        grupos = [
            ("1. Total Industria (CNAE 10-39)", 11.0),
            ("2. Total Construcción (CNAE 41-43)", 10.9),
            ("3. Total Servicios (CNAE 45-82)", 12.0),
        ]
        cls.ine = [fila("sectores", nombre, valor) for nombre, valor in grupos]
        cls.ine += [fila("sectores", "Total Empresas", 21.14), fila("menos_de_10", "Total", 5.0)]
        cls.ine += [fila("errores", nombre, 0.5) for nombre, _ in grupos]
        cls.ine += [
            fila("comunidades", nombre, valor, "Cataluña")
            for nombre, valor in [
                ("Total Empresas", 24.0),
                ("Industria", 11.0),
                ("Construcción", 10.9),
                ("Servicios", 12.0),
            ]
        ]
        cls.eurostat = [
            {"nace": codigo, "etiqueta": codigo, "valor": valor, "marca": None}
            for codigo, valor in [("C-E", 11.0), ("F", 10.9), ("G-N_X_I56_K", 12.0), ("I", 15.5)]
        ]
        cls.cataluna = [
            {"anio": anio, "nace": codigo, "etiqueta": codigo, "valor": valor, "marca": None}
            for anio in (2023, 2024, 2025)
            for codigo, valor in [
                ("C10-S951_X_K", 24.0),
                ("F", 10.9),
                ("G", 23.7),
                ("I", 15.5),
                ("N", 17.1),
                ("C-E", 11.0),
            ]
        ]
        cls.edicion = {
            "anio": 2025,
            "nombre": "2024–1T2025",
            "tablas": dict.fromkeys(constantes_empresas.CAPITULOS, "1"),
            "eurostat": {"actualizado": "2026-06-15", "consulta": "06/10/2026"},
            "eurostat_cataluna": {"actualizado": "2026-06-15", "consulta": "06/10/2026"},
        }
        cls.grupos = [
            {"territorio": "cataluna", "nivel": "3", "cno11": "571", "personas": 1000, "actividades": {"84": 1000}},
            {
                "territorio": "cataluna",
                "nivel": "3",
                "cno11": "960",
                "personas": 1000,
                "actividades": {"41": 900, "84": 100},
            },
        ]
        cls.parches = [
            mock.patch.dict(cifras_empresas.NOMBRES_EUROSTAT, {"G-N_X_I56_K": "Servicios del ejemplo"}),
            mock.patch.object(cifras_empresas, "leer_jsonl", return_value=cls.grupos),
            mock.patch.object(controles_empresas, "divisiones_existentes", return_value=cls.existentes),
        ]
        for parche in cls.parches:
            parche.start()
            cls.addClassCleanup(parche.stop)
        cls.conjunto = cifras_empresas.conjunto(cls.ine, cls.eurostat, cls.cataluna, cls.edicion, cls.existentes)


class PruebaEdicion(unittest.TestCase):
    """Dónde están las tablas de la edición vigente y cómo se detecta una edición nueva."""

    def test_capitulos_de_la_pagina_de_resultados(self) -> None:
        """El año sale del «primer trimestre»; cada parte, de su capítulo (no del de comercio electrónico)."""
        anio, direcciones = empresas.capitulos(RESULTADOS.format(anio=2025))
        self.assertEqual(anio, 2025)
        self.assertEqual(set(direcciones), set(constantes_empresas.CAPITULOS))
        self.assertTrue(direcciones["sectores"].endswith("capsel=12806"))
        self.assertTrue(direcciones["menos_de_10"].endswith("capsel=12809"))

    def test_solo_se_siguen_enlaces_del_ine_por_https(self) -> None:
        """Un capítulo cuyo enlace lleva a otro sitio, a otro puerto, con credenciales o sin cifrar detiene la sonda."""
        self.assertEqual(empresas.direccion_del_ine("/dynt3/a?capsel=1"), "https://www.ine.es/dynt3/a?capsel=1")
        self.assertEqual(empresas.direccion_del_ine("https://www.ine.es/b?capsel=2"), "https://www.ine.es/b?capsel=2")
        ajenos = [
            "https://otro.example/x?capsel=12806",
            "//otro.example/x?capsel=12806",
            "http://www.ine.es/x?capsel=12806",
            "https://www.ine.es@otro.example/x?capsel=12806",
            "https://www.ine.es.otro.example/x?capsel=12806",
            "https://www.ine.es:8443/x?capsel=12806",
            "file:///etc/passwd?capsel=12806",
        ]
        for ajeno in ajenos:
            with self.subTest(enlace=ajeno):
                pagina_hostil = RESULTADOS.format(anio=2026).replace(
                    "/dynt3/inebase/index.htm?padre=12804&amp;capsel=12806", ajeno
                )
                with (
                    mock.patch.object(empresas, "descargar_url", side_effect=[pagina(pagina_hostil)]) as descargar,
                    self.assertRaisesRegex(FormatoInesperado, "fuera de https://www.ine.es"),
                ):
                    empresas.edicion_publicada()
                self.assertEqual(descargar.call_count, 1, "no se pide nada fuera del INE")

    def test_tabla_de_cada_capitulo(self) -> None:
        """La tabla de IA se encuentra por su título; la de errores, por su comienzo («…, por distintos estratos»)."""
        texto = CAPITULO.format(tabla="76387")
        self.assertEqual(empresas.tabla_del_capitulo(texto, "Inteligencia artificial"), "76387")
        self.assertEqual(
            empresas.tabla_del_capitulo(texto, "Error estándar de variable Inteligencia Artificial"), "76423"
        )
        self.assertIsNone(empresas.tabla_del_capitulo(texto, "Comercio electrónico"))

    def test_edicion_publicada_con_la_red_simulada(self) -> None:
        """La sonda lee la página de resultados y cada capítulo, y da el año, el nombre y las tablas."""
        respuestas = [pagina(RESULTADOS.format(anio=2026))] + [pagina(CAPITULO.format(tabla="80001"))] * len(
            constantes_empresas.CAPITULOS
        )
        with mock.patch.object(empresas, "descargar_url", side_effect=respuestas):
            edicion = empresas.edicion_publicada()
        self.assertEqual((edicion["anio"], edicion["nombre"]), (2026, "2025–1T2026"))
        self.assertEqual(edicion["tablas"]["sectores"], "80001")

    def test_una_edicion_anterior_detiene_la_descarga(self) -> None:
        """Una edición anterior a la guardada se detiene antes de descargar las tablas."""
        nueva = {"anio": 2024, "nombre": "2023–1T2024", "tablas": {}}
        with tempfile.TemporaryDirectory() as temporal:
            guardada = Path(temporal) / "procedencia.json"
            guardada.write_text(json.dumps({"edicion": {"anio": 2025, "nombre": "2024–1T2025"}}), encoding="utf-8")
            with (
                mock.patch.object(empresas, "edicion_publicada", return_value=nueva),
                mock.patch.object(empresas, "PROCEDENCIA", guardada),
                mock.patch.object(empresas, "descargar_url") as descargar,
                self.assertRaisesRegex(FormatoInesperado, "retrocede"),
            ):
                empresas.descargar(False)
        descargar.assert_not_called()


class PruebaLectura(unittest.TestCase):
    """El formato actual de Tempus y de Eurostat, y los códigos de actividad."""

    def test_tempus_sin_anio_y_la_pregunta_e1(self) -> None:
        """La tabla trae un solo dato por serie; solo pasa E.1 (una tecnología concreta, como E.1.C, no)."""
        e1 = "E.1 % de empresas que emplean tecnologías de Inteligencia Artificial (IA) (1)"
        e1c = "E.1.C % de empresas con tecnología IA que genera lenguaje escrito o hablado (2)"
        series = [serie("Total Empresas", e1, "Total", 21.14), serie("Total Empresas", e1c, "Total", 43.8)]
        filas = cifras_empresas.filas_ine("sectores", cifras_empresas.cifras_tempus(series))
        self.assertEqual([(fila["agrupacion"], fila["valor"]) for fila in filas], [("Total Empresas", 21.14)])

    def test_la_pregunta_de_eurostat_tambien_es_la_de_ia(self) -> None:
        """La pregunta F.2 de Eurostat sobre alguna tecnología de IA cuenta como la E.1 del INE."""
        self.assertTrue(
            cifras_empresas.es_la_pregunta_ia(
                "F.2 % de empresas que utilizan alguna tecnología de inteligencia artificial"
            )
        )

    def test_una_serie_de_tempus_con_dos_datos_no_se_lee(self) -> None:
        """La tabla de una edición trae un dato por serie: con dos, el formato ha cambiado."""
        with self.assertRaises(FormatoInesperado):
            cifras_empresas.cifras_tempus([{"Nombre": "x", "MetaData": [], "Data": [{"Valor": 1}, {"Valor": 2}]}])

    def test_metadatos_ambiguos_no_se_reducen_a_un_diccionario(self) -> None:
        """Una variable repetida o sin cadenas válidas no puede dar una firma semántica aparentemente igual."""
        original = serie("Total Empresas", "E.1 IA", "Total", 5)
        for valor in ("Total", "Otro tamaño", 7, ""):
            cambiada = copy.deepcopy(original)
            cambiada["MetaData"].append({"T3_Variable": "Tamaño de la empresa", "Nombre": valor})
            with self.subTest(valor=valor), self.assertRaises(FormatoInesperado):
                cifras_empresas.cifras_tempus([cambiada])

    def test_divisiones_de_los_codigos_de_eurostat(self) -> None:
        """Rangos, uniones, exclusiones y secciones; un grupo de 3 cifras (S951) no se puede leer."""
        existentes = DIVISIONES - DIVISIONES_SIN_NACE
        self.assertEqual(cifras_empresas.divisiones_eurostat("C22_C23", existentes), {22, 23})
        self.assertEqual(cifras_empresas.divisiones_eurostat("N77-N82_X_N79", existentes), {77, 78, 80, 81, 82})
        self.assertEqual(cifras_empresas.divisiones_eurostat("I", existentes), {55, 56})
        self.assertEqual(cifras_empresas.divisiones_eurostat("L_M", existentes), {68, 69, 70, 71, 72, 73, 74, 75})
        self.assertEqual(cifras_empresas.divisiones_eurostat("S951", existentes), frozenset())
        self.assertEqual(cifras_empresas.divisiones_eurostat("C10-S951_X_K", existentes), frozenset())

    def test_agrupaciones_del_ine(self) -> None:
        """Las exclusiones salen del nombre de la dimensión; el rango, del rótulo de cada agrupación."""
        excluidas = cifras_empresas.excluidas_por_el_ine("Agrupación de actividad (excepto CNAE 56, 64-66 y 95.1)")
        self.assertEqual(excluidas, {56, 64, 65, 66})
        servicios = cifras_empresas.divisiones_ine(
            "3. Total Servicios (CNAE 45-82, excluídas CNAE 56)", excluidas, DIVISIONES
        )
        self.assertNotIn(56, servicios)
        self.assertNotIn(65, servicios)
        self.assertEqual(
            cifras_empresas.divisiones_ine("1.3 Metalurgia ( CNAE 24-25)", excluidas, DIVISIONES), {24, 25}
        )
        self.assertEqual(
            cifras_empresas.divisiones_ine("4. Sector TIC (261-264, 268)", excluidas, DIVISIONES), frozenset()
        )

    def test_el_agregado_mas_detallado(self) -> None:
        """Cada división va al agregado más pequeño que la contiene."""
        agregados = {"G": {"divisiones": [45, 46, 47]}, "G46": {"divisiones": [46]}, "C": {"divisiones": [10, 11]}}
        self.assertEqual(cifras_empresas.mas_detallado(46, agregados), "G46")
        self.assertEqual(cifras_empresas.mas_detallado(47, agregados), "G")
        self.assertIsNone(cifras_empresas.mas_detallado(84, agregados))


class PruebaConjunto(EjemploEmpresas, unittest.TestCase):
    """El conjunto del ejemplo pequeño y sus controles con alarma."""

    def test_el_conjunto_se_reproduce(self) -> None:
        """Las cifras y la cobertura del ejemplo salen de sus filas sin promediar empresas por ocupación."""
        reproducido = cifras_empresas.conjunto(self.ine, self.eurostat, self.cataluna, self.edicion, self.existentes)
        self.assertEqual(reproducido["espana"], {"total": 21.14, "por_tamano": {}, "menos_de_10_personas": 5.0})
        self.assertEqual(
            reproducido["cataluna"],
            {"total": 24.0, "sectores": {"Industria": 11.0, "Construcción": 10.9, "Servicios": 12.0}},
        )
        self.assertEqual(reproducido["cobertura_de_los_grupos"], {"cataluna": {"cno3": {"571": 0.0, "960": 90.0}}})
        self.assertEqual(reproducido["encuesta"]["divisiones_que_mide"], ["10", "41", "45", "55", "56"])

    def test_la_encuesta_no_mide_los_cuidados(self) -> None:
        """Cuidadoras a domicilio: el 0 % en sectores que mide la encuesta; la 84 no figura en la tabla de paso."""
        cobertura = self.conjunto["cobertura_de_los_grupos"]["cataluna"]["cno3"]
        self.assertEqual(cobertura["571"], 0.0)
        self.assertNotIn("84", self.conjunto["paso"])

    def test_la_encuesta_mide_casi_toda_la_construccion(self) -> None:
        """Peones de la construcción: más del 85 % de sus ocupados está en sectores que la encuesta mide."""
        self.assertGreater(self.conjunto["cobertura_de_los_grupos"]["cataluna"]["cno3"]["960"], 85)

    def test_el_sector_56_solo_lo_mide_eurostat(self) -> None:
        """La hostelería (56) no la mide el INE ni Eurostat Cataluña; sí Eurostat, por la sección I."""
        self.assertEqual(self.conjunto["paso"]["56"], {"ine": None, "eurostat": "I", "cataluna": None})

    def test_ine_y_eurostat_que_no_cuadran_saltan(self) -> None:
        """Si Eurostat diera otra cifra para la construcción, el contraste falla."""
        agrupaciones = self.conjunto["agrupaciones_ine"]
        europa = cifras_empresas.agregados_eurostat(self.eurostat, self.existentes)
        controles = Controles()
        controles_empresas.comprobar_contraste(controles, agrupaciones, europa, self.eurostat)
        self.assertTrue(controles.admitido, controles.fallidos)
        cambiado = {**europa, "F": {**europa["F"], "pct": europa["F"]["pct"] + 3}}
        controles = Controles()
        controles_empresas.comprobar_contraste(controles, agrupaciones, cambiado, self.eurostat)
        self.assertEqual(len(controles.fallidos), 1)

    def test_sin_agregados_comparables_el_contraste_falla_con_su_motivo(self) -> None:
        """Si Eurostat publica el año pero ningún agregado tiene las divisiones del INE, el control falla y lo dice."""
        sin_pares = {
            codigo: {**agregado, "divisiones": [*agregado["divisiones"], 0]}
            for codigo, agregado in cifras_empresas.agregados_eurostat(self.eurostat, self.existentes).items()
        }
        controles = Controles()
        controles_empresas.comprobar_contraste(controles, self.conjunto["agrupaciones_ine"], sin_pares, self.eurostat)
        self.assertEqual(
            controles.fallidos,
            [
                "en los 0 agregados con las mismas divisiones, INE y Eurostat difieren como mucho "
                f"{numero_es(constantes_empresas.MAX_DIFERENCIA_INE_EUROSTAT, 1)} puntos"
            ],
        )

    def test_cataluna_por_seccion_con_las_cifras_de_referencia(self) -> None:
        """Cataluña, 2025: las cinco cifras de referencia a la décima, y el contraste con el INE pasa."""
        actividades = self.conjunto["cataluna_por_seccion"]["actividades"]
        for codigo, esperada in CIFRAS_DE_REFERENCIA_CATALUNA[2025].items():
            self.assertEqual(_a_la_decima(actividades[codigo]["por_anio"]["2025"]["pct"]), esperada, codigo)
        controles = Controles()
        sectores_ine = cifras_empresas.cifras_de_cataluna(self.ine, self.conjunto["agrupaciones_ine"])["sectores"]
        seccion = self.conjunto["cataluna_por_seccion"]
        controles_empresas.comprobar_cataluna(controles, seccion, self.cataluna, sectores_ine, 2025)
        self.assertTrue(controles.admitido, controles.fallidos)

    def test_una_cifra_de_cataluna_que_no_cuadra_salta(self) -> None:
        """Si la construcción no coincide con la medida del mismo año del INE, falla el contraste."""
        cambiadas = [
            {**fila, "valor": 12.0} if (fila["anio"], fila["nace"]) == (2025, "F") else fila for fila in self.cataluna
        ]
        seccion = cifras_empresas.cataluna_por_seccion(cambiadas, self.edicion["eurostat_cataluna"])
        sectores_ine = cifras_empresas.cifras_de_cataluna(self.ine, self.conjunto["agrupaciones_ine"])["sectores"]
        controles = Controles()
        controles_empresas.comprobar_cataluna(controles, seccion, cambiadas, sectores_ine, 2025)
        self.assertEqual(len(controles.fallidos), 1)

    def test_una_cifra_poco_fiable_no_va_como_firme(self) -> None:
        """«u» va aparte y sin cifra firme; «c» no tiene cifra; «e» se da con su marca a la vista."""
        self.assertEqual(
            cifras_empresas.cifra_marcada({"valor": 5.2, "marca": "u"}),
            {"pct": None, "pct_poco_fiable": 5.2, "marca": "u"},
        )
        self.assertEqual(cifras_empresas.cifra_marcada({"valor": None, "marca": "c"}), {"pct": None, "marca": "c"})
        self.assertEqual(cifras_empresas.cifra_marcada({"valor": 7.5, "marca": "e"}), {"pct": 7.5, "marca": "e"})
        self.assertEqual(cifras_empresas.cifra_marcada({"valor": 7.5, "marca": None}), {"pct": 7.5})

    def test_la_seccion_de_cataluna_lleva_la_leyenda_de_sus_marcas(self) -> None:
        """Una cifra «u» de Cataluña sale sin cifra firme y la sección explica la marca."""
        filas = [{"anio": 2025, "nace": "C10-S951_X_K", "etiqueta": "", "valor": 9.0, "marca": "u"}]
        seccion = cifras_empresas.cataluna_por_seccion(filas, {"actualizado": "2026-06-15", "consulta": "06/10/2026"})
        self.assertIsNone(seccion["actividades"]["C10-S951_X_K"]["por_anio"]["2025"]["pct"])
        self.assertEqual(seccion["marcas"], {"u": "poco fiable"})

    def test_a_la_decima_como_la_web_de_eurostat(self) -> None:
        """10,85 → 10,9 (el redondeo binario daría 10,8)."""
        self.assertEqual(_a_la_decima(10.85), 10.9)
        self.assertEqual(_a_la_decima(24.04), 24.0)

    def test_preparar_reproduce_los_preparados(self) -> None:
        """La preparación lee una tabla Tempus propia y conserva su cifra, edición y ausencia de Eurostat."""
        with tempfile.TemporaryDirectory() as temporal:
            raiz = Path(temporal)
            edicion = {"anio": 2025, "nombre": "2024–1T2025", "tablas": {"sectores": "1"}}
            entrada = raiz / "ine-eticce-2025-sectores.json"
            pregunta = "E.1 % de empresas que emplean tecnologías de Inteligencia Artificial"
            entrada.write_text(json.dumps([serie("Total Empresas", pregunta, "Total", 21.14)]), encoding="utf-8")
            salidas = {
                nombre: raiz / f"{nombre}.json" for nombre in ("INE", "EUROSTAT", "EUROSTAT_CATALUNA", "EDICION")
            }
            with (
                mock.patch.multiple(empresas, **salidas),
                mock.patch.object(empresas, "comprobar_originales"),
                mock.patch.object(
                    empresas,
                    "leer_json",
                    side_effect=lambda ruta: (
                        {"edicion": edicion, "archivos": []}
                        if ruta == empresas.PROCEDENCIA
                        else json.loads(ruta.read_text())
                    ),
                ),
                mock.patch.object(empresas, "original", return_value=entrada),
            ):
                empresas.preparar()
            filas = [json.loads(linea) for linea in salidas["INE"].read_text().splitlines()]
            self.assertEqual([(fila["agrupacion"], fila["valor"]) for fila in filas], [("Total Empresas", 21.14)])
            self.assertEqual(salidas["EUROSTAT"].read_text(), "")
            self.assertEqual(json.loads(salidas["EDICION"].read_text())["anio"], 2025)

    def test_validar_rechaza_filas_y_publicacion_desparejadas_sin_publicar(self) -> None:
        """El flujo público falla solo por disponibilidad, con huellas reales y toda E/S bajo temporal."""
        for territorio, campo, filas_presentes, publicacion_presente in (
            ("España", "eurostat", False, True),
            ("España", "eurostat", True, False),
            ("Cataluña", "eurostat_cataluna", False, True),
            ("Cataluña", "eurostat_cataluna", True, False),
            ("España", "eurostat", False, False),
            ("Cataluña", "eurostat_cataluna", False, False),
        ):
            with (
                self.subTest(territorio=territorio, filas=filas_presentes, publicacion=publicacion_presente),
                tempfile.TemporaryDirectory() as temporal,
            ):
                raiz = Path(temporal)
                with (
                    mock.patch.multiple(
                        entrada_salida,
                        ORIGINALES=raiz / "originales",
                        PREPARADOS=raiz / "preparados",
                        VALIDADOS=raiz / "validados",
                    ),
                    mock.patch.object(
                        entrada_salida,
                        "escribir_entero_creando_carpeta",
                        wraps=entrada_salida.escribir_entero_creando_carpeta,
                    ) as escribir,
                ):
                    rutas = entrada_salida.carpetas("empresas")
                    fuente = {
                        "ORIGINAL": rutas.original,
                        "PROCEDENCIA": rutas.original / "procedencia.json",
                        "INE": rutas.preparado / "ine.jsonl",
                        "EUROSTAT": rutas.preparado / "eurostat.jsonl",
                        "EUROSTAT_CATALUNA": rutas.preparado / "eurostat-cataluna.jsonl",
                        "EDICION": rutas.preparado / "edicion.json",
                    }
                    original = rutas.original / "ejemplo.json"
                    entrada_salida.guardar_json(original, {"ejemplo": "propio"})
                    entrada_salida.guardar_json(
                        fuente["PROCEDENCIA"],
                        {"archivos": [{"archivo": original.name, "sha256": entrada_salida.sha256(original)}]},
                    )
                    edicion = copy.deepcopy(self.edicion)
                    if not publicacion_presente:
                        edicion[campo] = None
                    entrada_salida.guardar_json(fuente["EDICION"], edicion)
                    entrada_salida.guardar_jsonl(fuente["INE"], self.ine)
                    entrada_salida.guardar_jsonl(
                        fuente["EUROSTAT"], [] if campo == "eurostat" and not filas_presentes else self.eurostat
                    )
                    entrada_salida.guardar_jsonl(
                        fuente["EUROSTAT_CATALUNA"],
                        [] if campo == "eurostat_cataluna" and not filas_presentes else self.cataluna,
                    )
                    # Sin la 56, INE cubre este universo: la pérdida de Eurostat no falla antes por paso.
                    with (
                        mock.patch.multiple(empresas, **fuente),
                        # La admisión de Sectores es una precondición sustituida, no el objeto de este ensayo.
                        mock.patch.object(empresas, "exigir_admitido"),
                        mock.patch.object(empresas, "divisiones_existentes", return_value=self.existentes - {56}),
                        redirect_stdout(io.StringIO()),
                        suppress(ValidacionFallida),
                    ):
                        empresas.validar()
                    informe = entrada_salida.leer_json(rutas.validacion)
                    self.assertTrue(escribir.call_args_list)
                    self.assertTrue(
                        all(
                            Path(llamada.args[0]).resolve().is_relative_to(raiz.resolve())
                            for llamada in escribir.call_args_list
                        )
                    )
                    self.assertEqual(informe["estado"], "Con errores")
                    disponibilidad = (
                        f"Eurostat {territorio}: las filas y su actualización tienen la misma disponibilidad"
                    )
                    self.assertEqual(
                        [control["control"] for control in informe["controles"] if control["resultado"] != "correcto"],
                        ([disponibilidad] if filas_presentes != publicacion_presente else [])
                        + ["Eurostat: España y Cataluña de la edición deben estar publicados para admitir empresas"],
                    )
                    self.assertFalse(entrada_salida.ruta_del_conjunto("empresas").exists())
                    self.assertTrue(original.exists(), "el original propio conserva su huella y no se sustituye")


class PruebaControlesSinHuecos(EjemploEmpresas, unittest.TestCase):
    """Los controles fallan con su motivo ante lo que antes pasaba sin comparar o se rompía sin decirlo."""

    def cataluna_con(self, filas: list[dict[str, object]], anios: list[int] | None = None) -> Controles:
        """Los controles de Cataluña con otras filas (y, si se dan, otros años en la sección).

        Args:
            filas: Las filas de Cataluña que se comprueban.
            anios: Los años de la sección; None deja los del conjunto.

        Returns:
            Los controles, con el resultado de cada uno.
        """
        seccion = copy.deepcopy(self.conjunto["cataluna_por_seccion"])
        if anios is not None:
            seccion["anios"] = anios
        sectores_ine = cifras_empresas.cifras_de_cataluna(self.ine, self.conjunto["agrupaciones_ine"])["sectores"]
        controles = Controles()
        controles_empresas.comprobar_cataluna(controles, seccion, filas, sectores_ine, 2025)
        return controles

    def test_seccion_sin_anios(self) -> None:
        """Una sección sin años es un control fallido, no un IndexError."""
        controles = self.cataluna_con(self.cataluna, [])
        self.assertIn("años seguidos (ninguno)", controles.fallidos[0])

    def test_ventana_sin_su_ultimo_anio(self) -> None:
        """Una ventana sin el año solicitado no se admite usando una cifra anterior."""
        referencia = min(CIFRAS_DE_REFERENCIA_CATALUNA)
        filas = [fila for fila in self.cataluna if fila["anio"] != referencia]
        controles = self.cataluna_con(filas, [referencia - 2, referencia - 1])
        self.assertTrue(any("años seguidos" in fallido for fallido in controles.fallidos))

    def test_cifra_repetida(self) -> None:
        """Dos cifras del mismo año y sector no se pisan en silencio."""
        controles = self.cataluna_con([*self.cataluna, self.cataluna[0]])
        self.assertTrue(any("cifras repetidas" in fallido for fallido in controles.fallidos))

    def test_tablas_del_ine(self) -> None:
        """Las tablas del ejemplo pasan; una pregunta E.1 distinta en una parte se rechaza."""
        controles = Controles()
        controles_empresas.comprobar_tablas(controles, self.ine, self.edicion)
        self.assertTrue(controles.admitido, controles.fallidos)
        parte = next(fila for fila in self.ine if fila["parte"] != "errores")
        controles = Controles()
        controles_empresas.comprobar_tablas(controles, [*self.ine, {**parte, "pregunta": "otra"}], self.edicion)
        self.assertEqual(len(controles.fallidos), 1)
        self.assertIn("la pregunta E.1 está, una sola vez", controles.fallidos[0])

    def test_tabla_de_paso(self) -> None:
        """La tabla de paso del ejemplo pasa; una división financiera de más se rechaza."""
        controles = Controles()
        controles_empresas.comprobar_paso(controles, self.conjunto, self.existentes)
        self.assertTrue(controles.admitido, controles.fallidos)
        con_una_de_mas = copy.deepcopy(self.conjunto)
        con_una_de_mas["paso"]["64"] = next(iter(con_una_de_mas["paso"].values()))
        controles = Controles()
        controles_empresas.comprobar_paso(controles, con_una_de_mas, self.existentes)
        self.assertEqual(
            controles.fallidos[0][: controles.fallidos[0].index(";")],
            "la tabla de paso lleva las 5 divisiones que mide la encuesta (10 a 82, sin la 64 a la 66) y ninguna otra",
        )

    def test_limites_del_porcentaje_se_conservan_sin_contrato_global(self) -> None:
        """La constante local conserva el 100 y los extremos 0/100; rechaza porcentajes -1/101."""
        self.assertEqual(constantes_empresas.PORCENTAJE_MAXIMO, 100)
        for valor, admitido in (
            (0, True),
            (100, True),
            (-1, False),
            (101, False),
            (False, False),
            (float("nan"), False),
            (float("inf"), False),
            ("3", False),
        ):
            filas = [{**fila, "valor": valor} if fila["parte"] != "errores" else fila for fila in self.ine]
            controles = Controles()
            controles_empresas.comprobar_tablas(controles, filas, self.edicion)
            self.assertEqual(controles.admitido, admitido)

    def test_error_de_referencia_finito_no_negativo_sin_cota_arbitraria(self) -> None:
        """El error conserva su unidad: admite 1000, rechaza negativos, booleanos y cifras no finitas."""
        for valor, admitido in ((1000, True), (-1, False), (True, False), (float("nan"), False), (None, False)):
            filas = [{**fila, "valor": valor} if fila["parte"] == "errores" else fila for fila in self.ine]
            controles = Controles()
            controles_empresas.comprobar_tablas(controles, filas, self.edicion)
            with self.subTest(valor=valor):
                self.assertEqual(controles.admitido, admitido)


class PruebaRegresionesDeEntrada(unittest.TestCase):
    """Las entradas incompletas o cambiantes fallan antes de publicar cifras o perder una edición."""

    def test_capitulos_elige_la_ultima_edicion_aunque_venga_despues(self) -> None:
        """El orden de publicación no puede seleccionar los capítulos de una edición anterior."""
        pagina_ordenada = RESULTADOS.format(anio=2024) + RESULTADOS.format(anio=2025).replace("128", "138")
        anio, capitulos = empresas.capitulos(pagina_ordenada)
        self.assertEqual(anio, 2025)
        self.assertTrue(all("capsel=138" in direccion for direccion in capitulos.values()))

    def test_capitulos_no_completa_la_edicion_nueva_con_partes_viejas(self) -> None:
        """Una edición incompleta se detiene antes de consultar los capítulos."""
        nueva_incompleta = RESULTADOS.format(anio=2025).split("<a href=")[1:3]
        texto = RESULTADOS.format(anio=2024) + "".join("<a href=" + enlace for enlace in nueva_incompleta)
        respuestas = [pagina(texto)]
        with (
            mock.patch.object(empresas, "descargar_url", side_effect=respuestas) as descargar,
            self.assertRaisesRegex(FormatoInesperado, "página de resultados"),
        ):
            empresas.edicion_publicada()
        self.assertEqual(descargar.call_count, 1)

    def test_enlaces_lee_comillas_simples_y_atributos_html(self) -> None:
        """El lector admite las formas válidas de atributos y el texto de etiquetas anidadas."""
        self.assertEqual(
            empresas.enlaces("<a class='x' HREF='/ruta?a=1&amp;b=2'><span>IA</span> &amp; TIC</a>"),
            [("/ruta?a=1&b=2", "IA & TIC")],
        )

    def test_eurostat_publicado_no_desaparece_por_respuesta_vacia(self) -> None:
        """Una tabla antes publicada no pierde su procedencia por una respuesta vacía."""
        archivo = {"archivo": "tabla.json", "url": "https://example.invalid"}
        with (
            mock.patch.object(empresas, "descargar_url", return_value=pagina('{"value": {}, "updated": "2026-06-15"}')),
            self.assertRaisesRegex(FormatoInesperado, "publicado"),
        ):
            empresas._descargar_eurostat(archivo, {"tabla.json": {"sha256": "abc"}}, False)

    def test_eurostat_publicado_no_desaparece_por_404(self) -> None:
        """Un error de disponibilidad no borra una publicación ya registrada."""
        archivo = {"archivo": "tabla.json", "url": "https://example.invalid"}
        error = HTTPError(archivo["url"], 404, "no existe", None, None)
        with (
            mock.patch.object(empresas, "descargar_url", side_effect=error),
            self.assertRaisesRegex(FormatoInesperado, "publicado"),
        ):
            empresas._descargar_eurostat(archivo, {"tabla.json": {"sha256": "abc"}}, False)

    def test_eurostat_rechaza_json_o_fecha_sin_contrato(self) -> None:
        """Un cuerpo inválido se detiene antes de conservar el original."""
        archivo = {"archivo": "tabla.json", "url": "https://example.invalid"}
        for respuesta in ("{", "[]", "{}", '{"value": {"0": 2}}', '{"value": {"0": 2}, "updated": "mal"}'):
            with (
                self.subTest(respuesta=respuesta),
                mock.patch.object(empresas, "descargar_url", return_value=pagina(respuesta)),
                mock.patch.object(empresas, "conservar_o_sustituir") as conservar,
            ):
                with self.assertRaisesRegex(FormatoInesperado, "Eurostat"):
                    empresas._descargar_eurostat(archivo, {}, False)
                conservar.assert_not_called()

    def test_ausencia_de_eurostat_no_cuenta_como_control_superado(self) -> None:
        """Las notas de ausencia no son comprobaciones de cifras."""
        controles = Controles()
        controles_empresas.comprobar_contraste(controles, {}, {}, [])
        controles_empresas.comprobar_cataluna(controles, None, [], {}, 2025)
        self.assertEqual(controles.lista, [])

    def test_cifra_confidencial_con_valor_no_se_publica(self) -> None:
        """La contradicción entre una marca confidencial y su valor detiene la composición."""
        with self.assertRaisesRegex(FormatoInesperado, "confidencial"):
            cifras_empresas.cifra_marcada({"valor": 7.5, "marca": "c"})

    def test_agregado_confidencial_no_entra_en_el_paso(self) -> None:
        """La tabla de paso tampoco puede incorporar una cifra confidencial."""
        with self.assertRaisesRegex(FormatoInesperado, "confidencial"):
            cifras_empresas.agregados_eurostat([{"nace": "F", "valor": 7.5, "marca": "c"}], {41})

    def test_disponibilidad_distingue_falta_de_publicacion_y_filas_perdidas(self) -> None:
        """Las filas y el registro de actualización deben aparecer o faltar a la vez."""
        for filas, actualizacion, admitido in (
            ([], None, True),
            ([], {"actualizado": "2026-06-15"}, False),
            ([{"valor": 1}], None, False),
            ([{"valor": 1}], {"actualizado": "2026-06-15"}, True),
        ):
            controles = Controles()
            controles_empresas.comprobar_disponibilidad(controles, filas, actualizacion, "España")
            self.assertEqual(controles.admitido, admitido)


class PruebaActualizacionCompatible(EjemploEmpresas, unittest.TestCase):
    """La edición avanza con la misma medida; las definiciones y los años no se negocian con un flag de bytes."""

    def descargar_edicion(self, *, cambiar_definicion: bool = False, anio: int = 2026) -> None:
        """Ejecuta descargar con originales propios, valores distintos y una edición descubierta simulada."""
        with tempfile.TemporaryDirectory() as temporal:
            raiz = Path(temporal)
            antigua = {
                "anio": 2025,
                "nombre": "2024–1T2025",
                "tablas": dict.fromkeys(constantes_empresas.CAPITULOS, "1"),
            }
            nueva = {
                "anio": anio,
                "nombre": f"{anio - 1}–1T{anio}",
                "tablas": dict.fromkeys(constantes_empresas.CAPITULOS, "2"),
            }
            pregunta = "E.1 % de empresas que emplean tecnologías de Inteligencia Artificial"
            anterior = [serie("Total Empresas", pregunta, "Total", 10)]
            posterior = copy.deepcopy(anterior)
            posterior[0]["Data"][0]["Valor"] = 11
            if cambiar_definicion:
                posterior[0]["MetaData"][2]["Nombre"] = "Empresas desde una persona"
            for archivo in empresas.archivos_del_ine(antigua):
                (raiz / archivo["archivo"]).write_text(json.dumps(anterior), encoding="utf-8")
            procedencia = raiz / "procedencia.json"
            procedencia.write_text(json.dumps({"edicion": antigua, "archivos": []}), encoding="utf-8")
            with (
                mock.patch.multiple(empresas, ORIGINAL=raiz, PROCEDENCIA=procedencia),
                mock.patch.object(empresas, "edicion_publicada", return_value=nueva),
                mock.patch.object(empresas, "descargar_url", return_value=pagina(json.dumps(posterior))),
                mock.patch.object(empresas, "_descargar_eurostat", return_value=(None, None)),
                mock.patch.object(calendario_ine, "descargar", return_value=[{"archivo": calendario_ine.ARCHIVO}]),
                redirect_stdout(io.StringIO()),
            ):
                empresas.descargar(True)
            self.assertEqual(json.loads(procedencia.read_text())["edicion"]["anio"], anio)

    def test_avance_compatible_automatico_sin_permiso_semantico(self) -> None:
        """La llamada automática acepta valores nuevos con el mismo contrato, pero nunca retrocede."""
        self.descargar_edicion()
        with self.assertRaisesRegex(FormatoInesperado, "retroced"):
            self.descargar_edicion(anio=2024)

    def test_flag_de_bytes_no_permite_cambiar_definicion(self) -> None:
        """Una base distinta se detiene aunque aceptar_cambio sea True, en edición nueva y en la vigente."""
        for anio in (2025, 2026):
            with self.subTest(anio=anio), self.assertRaisesRegex(FormatoInesperado, "definici[oó]n"):
                self.descargar_edicion(cambiar_definicion=True, anio=anio)

    def test_ventana_nueva_sin_cifras_clavadas_de_2025(self) -> None:
        """La ventana nueva válida contrasta su propio año y no necesita 2025."""
        filas = [{**fila, "anio": fila["anio"] + 3} for fila in self.cataluna]
        seccion = cifras_empresas.cataluna_por_seccion(filas, self.edicion["eurostat_cataluna"])
        sectores = cifras_empresas.cifras_de_cataluna(self.ine, self.conjunto["agrupaciones_ine"])["sectores"]
        controles = Controles()
        controles_empresas.comprobar_cataluna(controles, seccion, filas, sectores, 2028)
        self.assertTrue(controles.admitido, controles.fallidos)

    def test_revisar_cifra_oficial_no_la_clava_a_una_referencia(self) -> None:
        """Una cifra revisada fuera del contraste directo puede variar; la referencia histórica vive en pruebas."""
        filas = [{**fila, "valor": 25.1} if fila["nace"] == "C10-S951_X_K" else fila for fila in self.cataluna]
        seccion = cifras_empresas.cataluna_por_seccion(filas, self.edicion["eurostat_cataluna"])
        sectores = cifras_empresas.cifras_de_cataluna(self.ine, self.conjunto["agrupaciones_ine"])["sectores"]
        controles = Controles()
        controles_empresas.comprobar_cataluna(controles, seccion, filas, sectores, 2025)
        self.assertTrue(controles.admitido, controles.fallidos)

    def test_marcas_compuestas_y_rango_de_todas_las_cifras(self) -> None:
        """Las letras se interpretan juntas; las cifras poco fiables tampoco salen de 0–100."""
        self.assertEqual(
            cifras_empresas.cifra_marcada({"valor": 5, "marca": "bu"}),
            {"pct": None, "pct_poco_fiable": 5, "marca": "bu"},
        )
        for valor, marca in ((5, "bc"), (101, "u"), (float("nan"), None), (5, "x")):
            with self.subTest(valor=valor, marca=marca), self.assertRaises(FormatoInesperado):
                cifras_empresas.cifra_marcada({"valor": valor, "marca": marca})

    def test_lectura_eurostat_conserva_contrato_antes_de_perder_dimensiones(self) -> None:
        """El año solicitado y la unidad se verifican antes de crear filas nacionales sin esas claves."""
        dimensiones = {
            "freq": ("A", "Annual"),
            "size_emp": ("GE10", "10 persons employed or more"),
            "nace_r2": ("F", "Construction"),
            "indic_is": (
                "E_AI_TANY",
                "Enterprises using at least one of the AI technologies: AI_TTM, AI_TSR, AI_TNLG, AI_TIR, AI_TML, "
                "AI_TPA, AI_TAR, E_AI_TPVSG",
            ),
            "unit": ("PC_ENT", "Percentage of enterprises"),
            "geo": ("ES", "Spain"),
            "time": ("2026", "2026"),
        }
        tabla = {
            "class": "dataset",
            "id": list(dimensiones),
            "size": [1] * len(dimensiones),
            "value": {"0": 10},
            "dimension": {
                nombre: {"category": {"index": {codigo: 0}, "label": {codigo: etiqueta}}}
                for nombre, (codigo, etiqueta) in dimensiones.items()
            },
        }
        tabla["dimension"]["nace_r2"]["label"] = (
            "Statistical classification of economic activities in the European Community (NACE Rev. 2)"
        )
        self.assertEqual(cifras_empresas.filas_eurostat(tabla, 2026)[0]["valor"], 10)
        for dimension, codigo in (
            ("time", "2025"),
            ("unit", "NR_ENT"),
            ("geo", "FR"),
            ("size_emp", "TOTAL"),
            ("freq", "Q"),
            ("indic_is", "E_AI_TTM"),
        ):
            cambiada = copy.deepcopy(tabla)
            cambiada["dimension"][dimension]["category"]["index"] = {codigo: 0}
            with self.subTest(dimension=dimension), self.assertRaises(FormatoInesperado):
                cifras_empresas.filas_eurostat(cambiada, 2026)
        cambiada = copy.deepcopy(tabla)
        cambiada["dimension"]["nace_r2"]["label"] = "NACE Rev. 2.1"
        with self.assertRaisesRegex(FormatoInesperado, "clasificaci[oó]n"):
            cifras_empresas.filas_eurostat(cambiada, 2026)
        cambiada = copy.deepcopy(tabla)
        cambiada["dimension"]["indic_is"]["category"]["label"]["E_AI_TANY"] += "; another technology"
        with self.assertRaisesRegex(FormatoInesperado, "definici[oó]n"):
            cifras_empresas.filas_eurostat(cambiada, 2026)


class PruebaTransporteObservado(unittest.TestCase):
    """El transporte común vincula cada cuerpo antes del siguiente GET, sin HTTP externo."""

    def setUp(self) -> None:
        """Inyecta el turno virtual para que la frontera HTTP simulada nunca duerma realmente."""
        pausa_red = mock.patch.object(red, "PAUSAS", red.PausasPorDominio(lambda: 0.0, lambda _segundos: None))
        pausa_red.start()
        self.addCleanup(pausa_red.stop)

    def test_once_get_vinculados_y_seleccion_para_copia(self) -> None:
        """La sonda y las seis tablas viajan por el transporte real y se seleccionan con sus doce archivos."""
        indice = RESULTADOS.format(anio=2025)
        anio, direcciones = empresas.capitulos(indice)
        cuerpos = {empresas.RESULTADOS: indice.encode()}
        tablas = {}
        for numero, (parte, direccion) in enumerate(direcciones.items(), start=100):
            tablas[parte] = str(numero)
            cuerpos[direccion] = (f'<a href="/jaxi/Tabla.htm?tpx={numero}">{empresas.CAPITULOS[parte][1]}</a>').encode()
        edicion = {"anio": anio, "nombre": "2024–1T2025", "tablas": tablas}
        for numero, descriptor in enumerate(empresas.archivos_del_ine(edicion)):
            cuerpos[descriptor["url"]] = json.dumps([serie("Total Empresas", "E.1 IA", "Total", numero)]).encode()
        for descriptor in (empresas.archivo_de_eurostat(anio), empresas.archivo_de_eurostat_cataluna(anio)):
            cuerpos[descriptor["url"]] = b'{"value":{"0":10},"updated":"2026-10-17"}'
        cuerpos[calendario_ine.URL] = ayuda_calendario.CUERPO

        def abrir(peticion: Request, timeout: float) -> HTTPResponse:
            self.assertEqual(peticion.get_header("User-agent"), red.agente_de_usuario())
            cuerpo = cuerpos[peticion.full_url]
            tipo = ayuda_calendario.CABECERA if peticion.full_url == calendario_ine.URL else ""
            respuesta = respuesta_http(f"{tipo}Content-Length: {len(cuerpo)}\r\n".encode(), cuerpo)
            respuesta.url = peticion.full_url.replace("/js/", "/jsCache/", 1)
            return respuesta

        with tempfile.TemporaryDirectory() as temporal:
            raiz = Path(temporal)
            carpeta = raiz / "var/actualizacion/originales/empresas"
            recibo = raiz / "recibo.json"
            configuracion = json.dumps({"ruta": str(recibo), "fuente": "empresas", "intento": "prueba"})
            with (
                mock.patch.multiple(empresas, ORIGINAL=carpeta, PROCEDENCIA=carpeta / "procedencia.json"),
                mock.patch.dict(os.environ, {observacion.VARIABLE_RECEPCION: configuracion}),
                mock.patch.object(red, "abrir_peticion", side_effect=abrir) as transporte,
                redirect_stdout(io.StringIO()),
                observacion.contexto_descarga(),
            ):
                empresas.descargar(True)
            recepcion = observacion.leer_recepcion(recibo, "empresas", "prueba")
            self.assertEqual(transporte.call_count, len(cuerpos))
            self.assertTrue(cobertura_empresas.comprobada(raiz, recepcion))
            seleccion = generacion_operativa.originales_de_la_fuente(raiz, "empresas")
            self.assertEqual(len(seleccion), len(cuerpos) + 1)
            for relativa in seleccion:
                destino = raiz / "copia" / relativa
                destino.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(raiz / relativa, destino)
                self.assertEqual(destino.read_bytes(), (raiz / relativa).read_bytes())


if __name__ == "__main__":
    unittest.main()
