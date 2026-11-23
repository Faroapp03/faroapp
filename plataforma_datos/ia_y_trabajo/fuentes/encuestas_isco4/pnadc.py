"""Brasil en la exposición calculada con microdatos: IBGE, PNAD Contínua trimestral, con sus pesos replicados.

Personas ocupadas (VD4002 = 1) por ocupación del trabajo principal (V4010, código de la COD a 4 dígitos), con el peso
calibrado V1028; las posiciones de cada variable salen del archivo de entrada oficial. La COD usa los códigos de
ISCO-08, pero el IBGE no publica una tabla de correspondencia y su estructura difiere en algunos subgrupos: identidad de
código solo en los subgrupos con el mismo conjunto de grupos primarios que ISCO-08 (estructura oficial de la COD); en
los demás, cotas sobre los grupos ISCO-08 del subgrupo. Los subgrupos 04 y 05 de la COD (militares de la policía y
bomberos militares) no existen en ISCO-08, que pone ese empleo en 5411 y 5412: se acotan sobre esos dos grupos. El
código 0000 (ocupaciones mal definidas) es ocupación no declarada. Error de muestreo con los 200 pesos replicados
bootstrap del IBGE (V1028001–V1028200), que recogen estratos, UPA y calibración (`encuestas_diseno`).

Python estándar. Lo usa `encuestas_isco4`.
"""

import io
import re
import zipfile
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

from plataforma_datos.comun.hojas import leer_xls
from plataforma_datos.comun.nucleo import ArchivoDescargable, FormatoInesperado, exigir, leer_del_zip
from plataforma_datos.ia_y_trabajo.fuentes.encuestas_isco4.constantes import CITA_IBGE as CITA_IBGE
from plataforma_datos.ia_y_trabajo.fuentes.encuestas_isco4.constantes import URL_IBGE
from plataforma_datos.ia_y_trabajo.fuentes.encuestas_isco4.diseno import (
    CIFRAS_DEL_GRUPO_PRIMARIO,
    Estructura,
    exposicion_por_replicas,
    subgrupos_comparables,
)

LICENCIA_IBGE = (
    "IBGE: archivos públicos de su servidor de descargas («Todos os arquivos aqui disponíveis são públicos», "
    "https://ftp.ibge.gov.br/); se cita al IBGE como fuente. La página de términos de uso de www.ibge.gov.br "
    "respondió 403 a la consulta (11/10/2026): su texto no se pudo leer."
)
IBGE_MICRODATOS = "ibge-pnadc-trimestral.zip"
IBGE_DICCIONARIO = "ibge-pnadc-diccionario.zip"
IBGE_COD = "ibge-estrutura-cod.xls"
# El trimestre que se toma (mmaaaa, como lo nombra el IBGE): el último publicado, el 14/08/2026. Un trimestre nuevo se
# toma a propósito cambiando estas dos constantes (y su huella, con --aceptar-cambio).
TRIMESTRE_PNADC = "022026"
PUBLICADO_PNADC = "2026-08-14"
ARCHIVOS_IBGE: list[ArchivoDescargable] = [
    {
        "archivo": IBGE_MICRODATOS,
        "nivel": "oficial",
        "titulo": f"IBGE, PNAD Contínua trimestral, microdatos públicos del trimestre {TRIMESTRE_PNADC[:2]}/"
        f"{TRIMESTRE_PNADC[2:]} (texto de ancho fijo en zip)",
        "url": f"{URL_IBGE}/{TRIMESTRE_PNADC[2:]}/PNADC_{TRIMESTRE_PNADC}.zip",
        "licencia": LICENCIA_IBGE,
    },
    {
        "archivo": IBGE_DICCIONARIO,
        "nivel": "oficial",
        "titulo": "IBGE, PNAD Contínua trimestral: diccionario y archivo de entrada con las posiciones de cada "
        "variable (31/10/2022, el vigente)",
        "url": f"{URL_IBGE}/Documentacao/Dicionario_e_input_20221031.zip",
        "licencia": LICENCIA_IBGE,
    },
    {
        "archivo": IBGE_COD,
        "nivel": "oficial",
        "titulo": "IBGE, Estrutura da Classificação de Ocupações para Pesquisas Domiciliares (COD)",
        "url": f"{URL_IBGE}/Documentacao/Estrutura_Ocupacao_COD.xls",
        "licencia": LICENCIA_IBGE,
    },
]
ENTRADA_PNADC = "input_PNADC_trimestral.txt"
# Lo que se lee de cada persona (posiciones del archivo de entrada oficial): periodo, peso calibrado, sexo, ocupación
# del trabajo principal (COD) y condición de ocupación.
# Posición, en la hoja de la estructura de la COD, de la columna del código de 4 dígitos.
COLUMNA_DEL_CODIGO = 3
# Columnas que usa cada fila de esa hoja (código y denominación); una fila más corta se salta.
COLUMNAS_DE_LA_COD = 5
VARIABLES_PNADC = ("Ano", "Trimestre", "V1028", "V2007", "V4010", "VD4002")
OCUPADA = "1"  # VD4002: 1 = persona ocupada en la semana de referencia; 2 = desocupada; en blanco, fuera de la fuerza
SIN_OCUPACION_COD = "0000"  # ocupaciones mal definidas, fuera de la estructura de la COD
REPLICAS = 200
PESOS_PNADC = ("V1028", *(f"V1028{replica:03d}" for replica in range(1, REPLICAS + 1)))
# Ocupados del trimestre publicados por el IBGE y su unidad de redondeo: el total ponderado de la base tiene que caer a
# media unidad. SIDRA, tabla 4093 (PNAD Contínua trimestral), variable 4090 «Pessoas de 14 anos ou mais de idade
# ocupadas na semana de referência», Brasil, sexo total, «2º trimestre 2026»: 103.057 mil pessoas
# (https://apisidra.ibge.gov.br/values/t/4093/n1/all/v/4090/p/202602/c2/6794/f/a). VD4002 es la misma población: 14
# años o más, semana de referencia.
OCUPADOS_PNADC = (103_057_000, 1000)
# Subgrupos de la COD sin equivalente en ISCO-08, con los grupos primarios donde ISCO-08 pone ese empleo.
PROPIOS_DE_LA_COD = {"04": ("5411", "5412"), "05": ("5411", "5412")}


def posiciones_sas(texto: str) -> dict[str, tuple[int, int]]:
    """Posición (desde 1) y ancho de cada variable, del archivo de entrada oficial (líneas «@0001 Ano $4.»).

    Returns:
        Por variable, la tupla (posición desde 1, ancho en caracteres).
    """
    posiciones: dict[str, tuple[int, int]] = {}
    for inicio, nombre, ancho in re.findall(r"^@(\d+)\s+(\w+)\s+\$?(\d+)\.", texto, re.MULTILINE):
        exigir(nombre not in posiciones, f"IBGE: {nombre} aparece repetida en el archivo de entrada")
        posicion, longitud = int(inicio), int(ancho)
        exigir(posicion > 0 and longitud > 0, f"IBGE: {nombre} necesita posición y ancho positivos")
        posiciones[nombre] = (posicion, longitud)
    faltan = [variable for variable in VARIABLES_PNADC if variable not in posiciones]
    exigir(not faltan, f"IBGE: el archivo de entrada no da la posición de {faltan}")
    return posiciones


def estructura_cod(libro: dict[str, list[list[object]]]) -> dict[str, str]:
    """Los grupos de base (4 dígitos) de la estructura oficial de la COD, con su denominación.

    Returns:
        Por código de 4 dígitos, su denominación.
    """
    exigir(len(libro) == 1, "IBGE: la estructura de la COD tiene que tener una sola hoja")
    filas = next(iter(libro.values()))
    exigir(
        any("Classificação de Ocupações" in str(celda) for fila in filas[:3] for celda in fila),
        "IBGE: no es la estructura de la COD",
    )
    grupos: dict[str, str] = {}
    for fila in filas:
        if len(fila) < COLUMNAS_DE_LA_COD or fila[COLUMNA_DEL_CODIGO] in ("", None):
            continue
        celda = fila[COLUMNA_DEL_CODIGO]
        if isinstance(celda, float):
            exigir(celda.is_integer(), f"IBGE: la COD contiene un código no entero: {celda!r}")
        codigo = f"{int(celda):04d}" if isinstance(celda, float) else str(celda).strip()
        if not (len(codigo) == CIFRAS_DEL_GRUPO_PRIMARIO and codigo.isdigit()):
            continue
        exigir(codigo not in grupos, f"IBGE: el grupo {codigo} aparece dos veces en la COD")
        grupos[codigo] = str(fila[4]).strip()
    exigir(grupos, "IBGE: la estructura de la COD está vacía")
    return grupos


def ocupados_pnadc(
    lineas: Iterator[str], posiciones: dict[str, tuple[int, int]], periodo: set[tuple[str, str]]
) -> Iterator[tuple[str | None, list[float]]]:
    """Cada persona ocupada: su código de la COD (None si es 0000 o vacío) y sus 201 pesos (V1028 y las réplicas).

    Anota en `periodo` cada (año, trimestre) visto, para rechazar un archivo con más de un trimestre.

    Yields:
        Por persona ocupada, su código (o `None`) y sus 201 pesos.

    Raises:
        FormatoInesperado: Si una línea está truncada o un peso no se puede leer.
    """
    faltan = [nombre for nombre in (*VARIABLES_PNADC, *PESOS_PNADC[1:]) if nombre not in posiciones]
    exigir(not faltan, f"IBGE: el archivo de entrada no da la posición de {faltan[:3]}")
    campo = {
        nombre: slice(posiciones[nombre][0] - 1, posiciones[nombre][0] - 1 + posiciones[nombre][1])
        for nombre in (*VARIABLES_PNADC, *PESOS_PNADC)
    }
    pesos = [(nombre, campo[nombre]) for nombre in PESOS_PNADC]
    ancho_requerido = max(tramo.stop for tramo in campo.values())
    for numero, linea in enumerate(lineas, 1):
        exigir(len(linea.rstrip("\r\n")) >= ancho_requerido, f"IBGE: línea {numero} más corta que sus campos")
        periodo.add((linea[campo["Ano"]], linea[campo["Trimestre"]]))
        if linea[campo["VD4002"]] != OCUPADA:
            continue
        codigo = linea[campo["V4010"]].strip()
        valores = []
        for nombre, sitio in pesos:
            try:
                valores.append(float(linea[sitio]))
            except ValueError as error:
                raise FormatoInesperado(f"IBGE: línea {numero}, peso {nombre} ilegible") from error
        yield (codigo if codigo and codigo != SIN_OCUPACION_COD else None), valores


def leer_pnadc(estructura: Estructura, ruta: Callable[[str], Path]) -> tuple[dict[str, Any], set[str], tuple[int, int]]:
    """Lee el trimestre sin descomprimirlo en disco: las cifras, los códigos hallados y el (año, trimestre).

    Returns:
        Las cifras de Brasil, los códigos hallados y el par (año, trimestre).
    """
    with zipfile.ZipFile(ruta(IBGE_DICCIONARIO)) as diccionario:
        posiciones = posiciones_sas(leer_del_zip(diccionario, ENTRADA_PNADC).decode("latin-1"))
    codigos: set[str] = set()
    periodo: set[tuple[str, str]] = set()
    with zipfile.ZipFile(ruta(IBGE_MICRODATOS)) as microdatos:
        nombres = [nombre for nombre in microdatos.namelist() if nombre.lower().endswith(".txt")]
        exigir(len(nombres) == 1, f"IBGE: se esperaba un solo .txt en los microdatos y hay {nombres}")
        with microdatos.open(nombres[0]) as binario:
            texto = io.TextIOWrapper(binario, encoding="latin-1", newline="")

            def con_registro() -> Iterator[tuple[str | None, list[float]]]:
                for codigo, pesos in ocupados_pnadc(texto, posiciones, periodo):
                    codigos.update([codigo] if codigo else [])
                    yield codigo, pesos

            cifras = exposicion_por_replicas(con_registro(), estructura)
    exigir(len(periodo) == 1, f"IBGE: se esperaba un solo trimestre y hay {sorted(periodo)[:5]}")
    anio, trimestre = next(iter(periodo))
    exigir(f"{trimestre:0>2}{anio}" == TRIMESTRE_PNADC, f"IBGE: el archivo es {trimestre}/{anio}, no {TRIMESTRE_PNADC}")
    return cifras, codigos, (int(anio), int(trimestre))


def pais_brasil(grad: dict[str, str | None], isco4: set[str], ruta: Callable[[str], Path]) -> dict[str, Any]:
    """Las cifras de Brasil con su descripción, como las de los demás países de `calculada.json`.

    Returns:
        Las cifras de Brasil con su descripción, en la forma de `calculada.json`.
    """
    cod = set(estructura_cod(leer_xls(ruta(IBGE_COD))))
    comparables = subgrupos_comparables(cod, isco4)
    cifras, codigos, (anio, trimestre) = leer_pnadc(Estructura(grad, isco4, comparables, cod, PROPIOS_DE_LA_COD), ruta)
    return {
        "anio": anio,
        "trimestre": trimestre,
        "fuente": f"IBGE, PNAD Contínua trimestral, {trimestre}.º trimestre de {anio} (publicado el {PUBLICADO_PNADC})",
        "clasificacion": "`V4010`, COD (Classificação de Ocupações para Pesquisas Domiciliares) a 4 dígitos",
        "correspondencia": "identidad de código en los subgrupos con los mismos grupos primarios que ISCO-08 en la "
        "estructura oficial de la COD; en los demás, cotas sobre los grupos ISCO-08 del subgrupo; 04 y 05 (militares "
        "de la policía y bomberos militares), cotas sobre 5411 y 5412",
        "poblacion": "personas ocupadas (`VD4002` = 1), peso calibrado `V1028` (media del trimestre)",
        "error_de_muestreo": f"{REPLICAS} pesos replicados bootstrap del IBGE (V1028001–V1028{REPLICAS}): "
        "Σ (θ_r − θ)² / (R − 1)",
        "ocupados_publicados": OCUPADOS_PNADC,
        "subgrupos_no_comparables": sorted(subgrupo for subgrupo, si in comparables.items() if not si),
        "codigos_fuera_de_la_estructura": sorted(codigos - cod),
        **cifras,
    }
