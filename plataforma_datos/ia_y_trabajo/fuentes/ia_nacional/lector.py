"""Uso de la IA por las empresas según estadísticas oficiales nacionales fuera de la UE, cada una con su definición.

Fuera de la UE no hay una encuesta común: cada oficina estadística pregunta otra cosa (plazo, universo, qué cuenta como
IA). Por eso cada país va con su propio indicador (`empresas-ia-nacional-<iso3>`), «medido», `comparable: false` y su
definición literal: el contrato pone la definición, la fuente y la licencia en el indicador, y la `nota` de un valor
es un vocabulario cerrado que no puede llevar una definición distinta por país. Hoy:

- Australia: Australian Bureau of Statistics, Characteristics of Australian Business 2024–25, libro BCSDC06, tabla 2
  («Selected ICTs used by the business»), columna «Artificial intelligence (AI)», fila «Total», año que acaba el 30 de
  junio de 2025.
- Canadá: Statistics Canada, Canadian Survey on Business Conditions, tabla 33-10-1167-01 (2.º trimestre de 2026):
  usó IA para producir bienes o prestar servicios en los 12 meses anteriores, «Yes», Canadá, todas las industrias.
- EE. UU.: U.S. Census Bureau, Business Trends and Outlook Survey (BTOS), estimación nacional quincenal, pregunta 7
  («In the last two weeks, did this business use Artificial Intelligence (AI) in any of its business functions?»),
  respuesta «Yes», el último período publicado, con sus fechas de referencia. Es una serie nueva: antes la pregunta
  era usar IA para producir bienes o servicios; desde el período del 03/11 al 16/11/2025 (202524), el primero de la
  pregunta nueva, es «in any of its business functions». Solo se lee la pregunta nueva y un período anterior a ese
  detiene la validación: las dos series no se encadenan.

Noruega no entra aquí: su cifra (SSB, tabla 13265) es la misma encuesta TIC europea que ya publica Eurostat en
`empresas-ia`, y dos cifras de la misma medida serían dos verdades. Python estándar.

Uso: python3 -m plataforma_datos.ia_y_trabajo.fuentes.ia_nacional.lector {descargar,preparar,validar,todo}
    [--aceptar-cambio]
"""

import csv
import io
import math
import re
import sys
import zipfile
from datetime import date, timedelta
from pathlib import Path
from typing import Any

from plataforma_datos.comun.entrada_salida import (
    ahora_utc,
    carpetas,
    comprobar_originales,
    controles_de_huella,
    guardar_json,
    leer_json,
    original,
)
from plataforma_datos.comun.hojas import filas_xlsx
from plataforma_datos.comun.nucleo import ARCHIVO_DE_PROCEDENCIA, Controles, FormatoInesperado, exigir, leer_del_zip
from plataforma_datos.comun.red import descargar_originales
from plataforma_datos.ia_y_trabajo.comun.medida_nacional import (
    PORCENTAJE_MAXIMO,
    controles_del_indicador,
    dia_de_consulta,
)
from plataforma_datos.orquestacion.admision import cerrar_validacion
from plataforma_datos.orquestacion.ordenes import principal_fuente_con_descarga

FUENTE = "ia-nacional"
ORIGINAL, PREPARADO, VALIDADO = carpetas(FUENTE)
PROCEDENCIA = ORIGINAL / ARCHIVO_DE_PROCEDENCIA
CIFRAS = PREPARADO / "cifras.json"

LICENCIA_CENSUS = (
    "Obra del Gobierno federal de EE. UU.: dominio público (17 U.S.C. § 105). Se cita al U.S. Census Bureau."
)
BTOS = "census-btos-national.xlsx"
URL_BTOS = "https://www.census.gov/hfp/btos/downloads/National.xlsx"
LICENCIA_STATCAN = (
    "Statistics Canada Open Licence (https://www.statcan.gc.ca/en/terms-conditions/open-licence), citando a "
    "Statistics Canada."
)
LICENCIA_ABS = (
    "© Commonwealth of Australia: Creative Commons Attribution 4.0 International "
    "(https://www.abs.gov.au/website-privacy-copyright-and-disclaimer), citando a la ABS."
)
BCS = "abs-bcsdc06-2024-25.xlsx"
URL_BCS = (
    "https://www.abs.gov.au/statistics/industry/technology-and-innovation/characteristics-australian-business/"
    "2024-25/BCSDC06_2024%E2%80%9325.xlsx"
)
HOJA_BCS = 3
TITULO_BCS = "Table 2: Selected ICTs used by the business"
COLUMNA_IA_BCS = "Artificial intelligence (AI)"
# Marca de la ABS: error relativo del 10 % al 25 %, «úsese con cautela».
MARCA_CAUTELA_ABS = "^"
CSBC = "statcan-33101167-eng.zip"
URL_CSBC = "https://www150.statcan.gc.ca/n1/tbl/csv/33101167-eng.zip"
TABLA_CSBC = "33101167.csv"
ARCHIVOS = [
    {
        "archivo": BCS,
        "nivel": "oficial",
        "titulo": "Australian Bureau of Statistics, Characteristics of Australian Business 2024–25, libro BCSDC06 "
        "(uso de tecnologías de la información y la comunicación)",
        "url": URL_BCS,
        "licencia": LICENCIA_ABS,
    },
    {
        "archivo": CSBC,
        "nivel": "oficial",
        "titulo": "Statistics Canada, tabla 33-10-1167-01: uso de IA para producir bienes o prestar servicios en los "
        "últimos 12 meses, 2.º trimestre de 2026 (CSV)",
        "url": URL_CSBC,
        "licencia": LICENCIA_STATCAN,
    },
    {
        "archivo": BTOS,
        "nivel": "oficial",
        "titulo": "U.S. Census Bureau, Business Trends and Outlook Survey: estimaciones nacionales por período",
        "url": URL_BTOS,
        "licencia": LICENCIA_CENSUS,
    },
]
# La pregunta y la respuesta, literales: si el Census cambia el texto, la cifra mide otra cosa y la validación para.
PREGUNTA_BTOS = (
    "In the last two weeks, did this business use Artificial Intelligence (AI) in any of its business functions? "
    "(Examples of AI: machine learning, natural language processing, virtual agents, voice recognition, etc.)"
)
RESPUESTA_BTOS = "Yes"
# El primer período de la pregunta nueva («any of its business functions»): uno anterior sería la serie antigua.
PRIMER_PERIODO_BTOS = "202524"
DIMENSION_CSBC = (
    "Use of artificial intelligence (AI) by businesses or organizations in producing goods or delivering services over "
    "the last 12 months"
)
RESPUESTA_CSBC = "Yes, business used AI for producing goods or delivering services over the last 12 months"
TODAS_LAS_INDUSTRIAS = "North American Industry Classification System (NAICS), all industries"
HOJA_ESTIMACIONES, HOJA_FECHAS = 1, 5
# Los indicadores del contrato, uno por país, con su definición propia (los lee `datos_globales`).
INDICADORES_NACIONALES: dict[str, dict[str, object]] = {
    "AUS": {
        "id": "empresas-ia-nacional-aus",
        "nombre": {
            "es": "Empresas que usan IA (Australia, medida nacional)",
            "ca": "Empreses que fan servir IA (Austràlia, mesura nacional)",
        },
        "definicion": {
            "es": "Porcentaje de empresas de Australia que marcaron la inteligencia artificial entre las tecnologías "
            "de la información que usaron en el año que acabó el 30 de junio de 2025 (Characteristics of Australian "
            "Business 2024–25, Australian Bureau of Statistics; todas las empresas de la encuesta, desde 0–4 "
            "personas). No mide con qué intensidad. Es otra pregunta y otro universo que los de la encuesta europea: "
            "no se compara con Europa ni con otros países.",
            "ca": "Percentatge d'empreses d'Austràlia que van marcar la intel·ligència artificial entre les "
            "tecnologies de la informació que van fer servir l'any que va acabar el 30 de juny de 2025 "
            "(Characteristics of Australian Business 2024–25, Australian Bureau of Statistics; totes les empreses de "
            "l'enquesta, des de 0–4 persones). No mesura amb quina intensitat. És una altra pregunta i un altre "
            "univers que els de l'enquesta europea: no es compara amb Europa ni amb altres països.",
        },
        "unidad": "porcentaje",
        "naturaleza": "medido",
        "fuente": "Australian Bureau of Statistics, Characteristics of Australian Business",
        "tabla": "BCSDC06 2024–25 · Table 2 · «Artificial intelligence (AI)» · Total",
        "licencia": LICENCIA_ABS,
        "url": URL_BCS,
        "comparable": False,
        "cobertura": "mundo",
    },
    "CAN": {
        "id": "empresas-ia-nacional-can",
        "nombre": {
            "es": "Empresas que usan IA (Canadá, medida nacional)",
            "ca": "Empreses que fan servir IA (Canadà, mesura nacional)",
        },
        "definicion": {
            "es": "Porcentaje de empresas y organizaciones de Canadá que usaron inteligencia artificial para producir "
            "bienes o prestar servicios en los 12 meses anteriores a la encuesta (Canadian Survey on Business "
            "Conditions de Statistics Canada, 2.º trimestre de 2026, recogida del 1 de abril al 6 de mayo; todas las "
            "industrias). Es otra pregunta y otro universo que los de la encuesta europea: no se compara con Europa ni "
            "con otros países.",
            "ca": "Percentatge d'empreses i organitzacions del Canadà que van fer servir intel·ligència artificial per "
            "produir béns o prestar serveis en els 12 mesos anteriors a l'enquesta (Canadian Survey on Business "
            "Conditions de Statistics Canada, 2n trimestre de 2026, recollida de l'1 d'abril al 6 de maig; totes les "
            "indústries). És una altra pregunta i un altre univers que els de l'enquesta europea: no es compara amb "
            "Europa ni amb altres països.",
        },
        "unidad": "porcentaje",
        "naturaleza": "medido",
        "fuente": "Statistics Canada, Canadian Survey on Business Conditions",
        "tabla": "33-10-1167-01 · Canadá · todas las industrias · «Yes»",
        "licencia": LICENCIA_STATCAN,
        "url": URL_CSBC,
        "comparable": False,
        "cobertura": "mundo",
    },
    "USA": {
        "id": "empresas-ia-nacional-usa",
        "nombre": {
            "es": "Empresas que usan IA (EE. UU., medida nacional)",
            "ca": "Empreses que fan servir IA (EUA, mesura nacional)",
        },
        "definicion": {
            "es": "Porcentaje de empresas con personas asalariadas de EE. UU. que, en las dos semanas anteriores a la "
            "encuesta, usaron inteligencia artificial en alguna función del negocio (aprendizaje automático, "
            "procesamiento del lenguaje natural, agentes virtuales, reconocimiento de voz…). Encuesta quincenal del "
            "U.S. Census Bureau (BTOS, pregunta 7), último período publicado. Serie nueva desde noviembre de 2025, "
            "cuando la pregunta pasó de usar IA para producir bienes o servicios a usarla en alguna función del "
            "negocio: no se encadena con las cifras anteriores. Es otra pregunta y otro universo que los de la "
            "encuesta europea: no se compara con Europa ni con otros países.",
            "ca": "Percentatge d'empreses amb persones assalariades dels EUA que, en les dues setmanes anteriors a "
            "l'enquesta, van fer servir intel·ligència artificial en alguna funció del negoci (aprenentatge automàtic, "
            "processament del llenguatge natural, agents virtuals, reconeixement de veu…). Enquesta quinzenal del "
            "U.S. Census Bureau (BTOS, pregunta 7), darrer període publicat. Sèrie nova des del novembre del 2025, "
            "quan la pregunta va passar de fer servir IA per produir béns o serveis a fer-la servir en alguna funció "
            "del negoci: no s'encadena amb les xifres anteriors. És una altra pregunta i un altre univers que els de "
            "l'enquesta europea: no es compara amb Europa ni amb altres països.",
        },
        "unidad": "porcentaje",
        "naturaleza": "medido",
        "fuente": "U.S. Census Bureau, Business Trends and Outlook Survey (BTOS)",
        "tabla": "National.xlsx · Response Estimates · pregunta 7, «Yes»",
        "licencia": LICENCIA_CENSUS,
        "url": URL_BTOS,
        "comparable": False,
        "cobertura": "mundo",
    },
}
# Lo que la definición de EE. UU. tiene que decir, por lengua: que es una serie nueva y no se encadena.
FRASES_USA = {
    "es": ("Serie nueva desde noviembre de 2025", "no se encadena con las cifras anteriores"),
    "ca": ("Sèrie nova des del novembre del 2025", "no s'encadena amb les xifres anteriors"),
}
# Excel cuenta los días desde el 30/12/1899.
ORIGEN_EXCEL = date(1899, 12, 30)
# Inicio y fin del período publicado.
FECHAS_DE_REFERENCIA = 2


def _fecha_excel(serie: str, campo: str) -> str:
    """Una fecha de Excel (número de días) en ISO 8601.

    Returns:
        La fecha, en ISO 8601 (AAAA-MM-DD).

    Raises:
        FormatoInesperado: Si la fecha Excel no se puede convertir, con su campo de origen.
    """
    try:
        return (ORIGEN_EXCEL + timedelta(days=int(float(serie)))).isoformat()
    except (TypeError, ValueError, OverflowError) as error:
        raise FormatoInesperado(f"{campo}: fecha Excel inválida {serie!r}") from error


def _numero(texto: str, campo: str) -> float:
    """Un número finito del campo seleccionado, sin sustituir marcas o ausencias.

    Returns:
        El número del campo.

    Raises:
        FormatoInesperado: Si el campo no contiene un número finito.
    """
    try:
        valor = float(texto)
    except (TypeError, ValueError) as error:
        raise FormatoInesperado(f"{campo}: cifra inválida {texto!r}") from error
    exigir(math.isfinite(valor), f"{campo}: cifra no finita {texto!r}")
    return valor


def cifra_del_btos(estimaciones: list[dict[str, str]], fechas: list[dict[str, str]]) -> dict[str, Any]:
    """La estimación del último período publicado para «Yes» en la pregunta del uso de IA, con su referencia.

    Returns:
        La cifra (porcentaje), su año, el período, las fechas de referencia (inicio y fin,
        ISO 8601) y la pregunta y la respuesta literales.
    """
    exigir(bool(estimaciones), "BTOS: hoja de estimaciones vacía")
    cabecera = estimaciones[0]
    periodos = {columna: valor for columna, valor in cabecera.items() if columna not in ("A", "B", "C", "D")}
    exigir(periodos, "BTOS: sin columnas de período")
    exigir(
        all(isinstance(valor, str) and re.fullmatch(r"[0-9]{6}", valor) for valor in periodos.values()),
        "BTOS: períodos distintos de seis dígitos ASCII",
    )
    exigir(len(set(periodos.values())) == len(periodos), "BTOS: períodos repetidos")
    columna = max(periodos, key=lambda col: periodos[col])
    filas = [fila for fila in estimaciones[1:] if fila.get("B") == PREGUNTA_BTOS and fila.get("D") == RESPUESTA_BTOS]
    exigir(len(filas) == 1, f"BTOS: la pregunta del uso de IA con «Yes» aparece {len(filas)} veces")
    texto = filas[0].get(columna, "")
    exigir(isinstance(texto, str) and texto.endswith("%"), f"BTOS: columna {columna}: cifra inesperada {texto!r}")
    periodo = periodos[columna]
    exigir(periodo >= PRIMER_PERIODO_BTOS, f"BTOS: el período {periodo} es anterior a la serie nueva")
    referencia = [fila for fila in fechas[1:] if fila.get("D") == periodo]
    exigir(len(referencia) == 1, f"BTOS: sin fechas de referencia del período {periodo}")
    inicio = _fecha_excel(referencia[0].get("G"), f"BTOS: {BTOS}, referencia G")
    fin = _fecha_excel(referencia[0].get("H"), f"BTOS: {BTOS}, referencia H")
    exigir(inicio <= fin, f"BTOS: {BTOS}, referencia: inicio posterior al final")
    return {
        "valor": _numero(texto.removesuffix("%"), f"BTOS: {BTOS}, columna {columna}"),
        "anio": int(fin[:4]),
        "periodo": periodo,
        "referencia": [inicio, fin],
        "pregunta": PREGUNTA_BTOS,
        "respuesta": RESPUESTA_BTOS,
    }


def cifra_de_la_bcs(filas: list[dict[str, str]]) -> dict[str, Any]:
    """La cifra de Australia: tabla 2, columna de la IA, fila «Total», con la marca de cautela si la lleva.

    Returns:
        La cifra (porcentaje redondeado a un decimal), el año y la nota («poco_fiable» si lleva la marca
        de cautela, si no None).
    """
    titulos = [fila for fila in filas[:3] if fila.get("A", "").startswith(TITULO_BCS)]
    exigir(len(titulos) == 1, "ABS: se espera un solo título de la tabla 2")
    columnas = [col for fila in filas for col, celda in fila.items() if celda.strip() == COLUMNA_IA_BCS]
    exigir(len(columnas) == 1, "ABS: se espera una sola columna de la IA")
    columna = columnas[0]
    totales = [fila for fila in filas if fila.get("A", "").strip() == "Total"]
    exigir(len(totales) == 1, f"ABS: la fila «Total» aparece {len(totales)} veces")
    texto = totales[0].get(columna, "").strip()
    cautela = texto.startswith(MARCA_CAUTELA_ABS)
    cifra = texto.removeprefix(MARCA_CAUTELA_ABS)
    exigir(cifra.isascii() and cifra.replace(".", "", 1).isdigit(), f"ABS: cifra inesperada {texto!r}")
    return {"valor": round(float(cifra), 1), "anio": 2025, "nota": "poco_fiable" if cautela else None}


def cifra_de_la_csbc(filas: list[dict[str, str]]) -> dict[str, Any]:
    """La cifra de Canadá, todas las industrias, «Yes»: una sola fila, en porcentaje.

    Returns:
        La cifra (porcentaje), el año de referencia y el código de calidad de StatCan.
    """
    elegidas = [
        fila
        for fila in filas
        if fila.get("GEO") == "Canada"
        and fila.get("Business characteristics") == TODAS_LAS_INDUSTRIAS
        and fila.get(DIMENSION_CSBC) == RESPUESTA_CSBC
    ]
    exigir(len(elegidas) == 1, f"StatCan {TABLA_CSBC}: la fila de Canadá aparece {len(elegidas)} veces")
    fila = elegidas[0]
    for campo in ("UOM", "VALUE", "REF_DATE", "STATUS"):
        exigir(isinstance(fila.get(campo), str) and bool(fila[campo]), f"StatCan {TABLA_CSBC}: falta {campo}")
    exigir(fila["UOM"] == "Percent", f"StatCan {TABLA_CSBC}: UOM distinta de Percent")
    exigir(re.fullmatch(r"[0-9]{4}", fila["REF_DATE"]) is not None, f"StatCan {TABLA_CSBC}: REF_DATE inesperada")
    return {
        "valor": _numero(fila["VALUE"], f"StatCan {TABLA_CSBC}: VALUE"),
        "anio": int(fila["REF_DATE"]),
        "calidad": fila["STATUS"],
    }


def filas_de_statcan(ruta: Path) -> list[dict[str, str]]:
    """Las filas del CSV de una tabla de StatCan, dentro de su ZIP.

    Returns:
        Una fila por registro del CSV, con los textos de cada columna.
    """
    with zipfile.ZipFile(ruta) as libro:
        texto = leer_del_zip(libro, TABLA_CSBC).decode("utf-8-sig")
    return list(csv.DictReader(io.StringIO(texto)))


def descargar(aceptar_cambio: bool = False) -> None:
    """Descarga las estimaciones nacionales; una edición nueva se acepta a propósito (--aceptar-cambio)."""
    guardar_json(
        PROCEDENCIA,
        {
            "fuente": "U.S. Census Bureau (BTOS), Statistics Canada (CSBC) y Australian Bureau of Statistics (BCS)",
            "cita": "U.S. Census Bureau, Business Trends and Outlook Survey, National.xlsx; Statistics Canada, tabla "
            "33-10-1167-01; Australian Bureau of Statistics, Characteristics of Australian Business 2024–25, BCSDC06.",
            "licencia": f"EE. UU.: {LICENCIA_CENSUS} Canadá: {LICENCIA_STATCAN} Australia: {LICENCIA_ABS}",
            "archivos": descargar_originales(ARCHIVOS, ORIGINAL, aceptar_cambio),
        },
    )


def preparar() -> None:
    """Deja la cifra de cada país con su año, su período y su pregunta literal."""
    comprobar_originales(FUENTE)
    ruta = original(FUENTE, BTOS)
    usa = cifra_del_btos(filas_xlsx(ruta, HOJA_ESTIMACIONES), filas_xlsx(ruta, HOJA_FECHAS))
    can = cifra_de_la_csbc(filas_de_statcan(original(FUENTE, CSBC)))
    aus = cifra_de_la_bcs(filas_xlsx(original(FUENTE, BCS), HOJA_BCS))
    guardar_json(CIFRAS, {"paises": {"AUS": aus, "CAN": can, "USA": usa}})
    print(f"Australia: {aus['valor']} % (2024–25, nota {aus['nota']})")
    print(f"Canadá: {can['valor']} % ({can['anio']}, calidad {can['calidad']})")
    print(f"EE. UU.: {usa['valor']} % ({usa['periodo']}, {usa['referencia'][0]}–{usa['referencia'][1]})")


def _comprobar_preparado(preparado: object) -> None:
    """La forma de los campos que consume validar, con ubicación en cifras.json.

    Raises:
        FormatoInesperado: Si una fecha de referencia no existe.
    """
    exigir(
        isinstance(preparado, dict) and isinstance(preparado.get("paises"), dict),
        f"{CIFRAS}: paises debe ser un objeto",
    )
    paises = preparado["paises"]
    exigir(sorted(paises) == sorted(INDICADORES_NACIONALES), f"{CIFRAS}: se esperan AUS, CAN y USA")
    for pais, cifra in paises.items():
        campo = f"{CIFRAS}: paises.{pais}"
        exigir(isinstance(cifra, dict), f"{campo} debe ser un objeto")
        exigir(isinstance(cifra.get("valor"), int | float), f"{campo}.valor debe ser numérico")
        exigir(type(cifra.get("anio")) is int, f"{campo}.anio debe ser un entero")
    usa, can = paises["USA"], paises["CAN"]
    exigir(isinstance(usa.get("pregunta"), str), f"{CIFRAS}: paises.USA.pregunta debe ser texto")
    exigir(usa.get("respuesta") == RESPUESTA_BTOS, f"{CIFRAS}: paises.USA.respuesta debe ser {RESPUESTA_BTOS}")
    exigir(isinstance(can.get("calidad"), str), f"{CIFRAS}: paises.CAN.calidad debe ser texto")
    exigir(
        isinstance(usa.get("periodo"), str) and re.fullmatch(r"[0-9]{6}", usa["periodo"]) is not None,
        f"{CIFRAS}: paises.USA.periodo debe tener seis dígitos ASCII",
    )
    referencia = usa.get("referencia")
    exigir(
        isinstance(referencia, list) and len(referencia) == FECHAS_DE_REFERENCIA,
        f"{CIFRAS}: paises.USA.referencia debe tener dos fechas",
    )
    for indice, fecha in enumerate(referencia):
        campo = f"{CIFRAS}: paises.USA.referencia[{indice}]"
        exigir(
            isinstance(fecha, str) and re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", fecha) is not None,
            f"{campo} debe ser una fecha ISO",
        )
        try:
            date.fromisoformat(fecha)
        except ValueError as error:
            raise FormatoInesperado(f"{campo}: fecha imposible {fecha!r}") from error


def _consulta(procedencia: object) -> str:
    """Comprueba los tres originales declarados y la fecha civil del primero.

    Returns:
        El día de consulta, conservando el orden declarado y la semántica histórica.
    """
    exigir(isinstance(procedencia, dict), f"{PROCEDENCIA}: se espera un objeto")
    archivos = procedencia.get("archivos")
    exigir(isinstance(archivos, list) and bool(archivos), f"{PROCEDENCIA}: archivos debe ser una lista no vacía")
    nombres, dias = [], []
    esperadas = {entrada["archivo"]: entrada["licencia"] for entrada in ARCHIVOS}
    for posicion, archivo in enumerate(archivos):
        campo = f"{PROCEDENCIA}: archivos[{posicion}]"
        exigir(isinstance(archivo, dict), f"{campo} debe ser un objeto")
        for clave in ("archivo", "sha256", "licencia"):
            exigir(isinstance(archivo.get(clave), str), f"{campo}.{clave} debe ser texto")
        nombre = archivo["archivo"]
        exigir(nombre in esperadas, f"{campo}.archivo inesperado {nombre!r}")
        exigir(archivo["licencia"] == esperadas[nombre], f"{campo}.licencia no corresponde a {nombre}")
        nombres.append(nombre)
        dias.append(dia_de_consulta(archivo.get("descargado_utc"), f"{campo}.descargado_utc"))
    exigir(sorted(nombres) == sorted(esperadas), f"{PROCEDENCIA}: se esperan los tres originales, sin repetición")
    return dias[0]


def validar() -> None:
    """Comprueba la huella, la pregunta literal y el rango de cada cifra."""
    preparado, procedencia = leer_json(CIFRAS), leer_json(PROCEDENCIA)
    _comprobar_preparado(preparado)
    consultado = _consulta(procedencia)
    controles = Controles()
    controles_de_huella(controles, ORIGINAL, procedencia)
    usa = preparado["paises"]["USA"]
    controles.comprobar(usa["pregunta"] == PREGUNTA_BTOS, "EE. UU.: la pregunta del BTOS es la fijada, literal")
    controles.comprobar(
        not isinstance(usa["valor"], bool) and 0 < usa["valor"] < PORCENTAJE_MAXIMO,
        f"EE. UU.: {usa['valor']} % entre 0 y 100",
    )
    controles.comprobar(
        usa["referencia"][0] <= usa["referencia"][1] and usa["anio"] == int(usa["referencia"][1][:4]),
        "EE. UU.: el año es el del final del período de referencia",
    )
    controles.comprobar(
        usa["periodo"] >= PRIMER_PERIODO_BTOS,
        f"EE. UU.: el período {usa['periodo']} es de la serie nueva (desde {PRIMER_PERIODO_BTOS})",
    )
    controles_del_indicador(controles, "USA", INDICADORES_NACIONALES["USA"], LICENCIA_CENSUS, FRASES_USA)
    can = preparado["paises"]["CAN"]
    controles.comprobar(
        not isinstance(can["valor"], bool) and 0 < can["valor"] < PORCENTAJE_MAXIMO,
        f"Canadá: {can['valor']} % entre 0 y 100",
    )
    # Calidad de StatCan: A excelente … E úsese con cautela, F no publicable.
    controles.comprobar(can["calidad"] in ("A", "B", "C"), f"Canadá: calidad {can['calidad']} (A, B o C)")
    aus = preparado["paises"]["AUS"]
    controles.comprobar(
        not isinstance(aus["valor"], bool) and 0 < aus["valor"] < PORCENTAJE_MAXIMO,
        f"Australia: {aus['valor']} % entre 0 y 100",
    )
    conjunto = {"consultado": consultado, "paises": preparado["paises"]}
    informe = {
        "estado": controles.estado,
        "comprobado_utc": ahora_utc(),
        "cobertura": {"paises": sorted(preparado["paises"])},
        "pendientes": {
            "NOR": "No se añade: SSB (tabla 13265) es la encuesta TIC europea que Eurostat ya publica en empresas-ia.",
            "ISL, GBR, BRA, CHE, ISR": "Cada uno en su propio módulo (ia-nacional-<iso3>).",
            "KOR": "Empresas: la cifra oficial es «desarrollar o usar» en empresas de 50 o más; no se añade. Personas: "
            "en su propio módulo (ia-nacional-kor).",
            "MEX": "INEGI agrupa la IA con la impresión 3D y la robótica: no se puede aislar.",
            "TUR": "Sin verificar en la fuente oficial (solo prensa o búsqueda).",
        },
        "limites": "Cada país mide otra cosa (plazo, universo, qué cuenta como IA): ninguna cifra se compara con otra "
        "ni con Eurostat.",
        "controles": controles.lista,
    }
    cerrar_validacion(FUENTE, informe, controles, lambda: conjunto)


def main(argv: list[str] | None = None) -> int:
    """Interfaz de línea de órdenes: descargar, preparar, validar o todo.

    Returns:
        El código de salida del proceso (0 si todo fue bien).
    """
    return principal_fuente_con_descarga(
        __doc__,
        descargar=descargar,
        preparacion_y_validacion={"preparar": preparar, "validar": validar},
        argumentos=argv,
    )


if __name__ == "__main__":
    sys.exit(main())
