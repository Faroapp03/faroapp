"""Las tablas que el INE y el Idescat publican por API: cómo se leen y en qué condiciones se reutilizan.

Dos formatos: JSON-stat 2.0, el de la API Taules del Idescat, y la respuesta de Tempus, el servicio de tablas del INE
(`servicios.ine.es/wstempus`), pedida con sus metadatos (`tip=AM`). Los dos lectores devuelven celdas planas, con el
código de cada dimensión y su valor, sin interpretar nada: qué significa cada código y qué cifras se aceptan lo deciden
las fuentes que los usan (`mercado/fuentes/ocupados/lector.py` y `mercado/fuentes/salarios/lector.py`). Aquí están
también, literales, la licencia y la forma de cita de cada organismo, que comparten todas sus fuentes. Python estándar.
"""

import itertools
import math
from collections.abc import Mapping
from types import MappingProxyType
from typing import Any, NamedTuple

from plataforma_datos.comun.nucleo import FormatoInesperado, exigir

# ---------------------------------------------------------------------------------------------------------------------
# Condiciones de reutilización
# ---------------------------------------------------------------------------------------------------------------------

SITIO_INE = "https://www.ine.es"
AVISO_LEGAL_INE = f"{SITIO_INE}/dyngs/AYU/index.htm?cid=125"
CITA_INE = "Elaboración propia con datos extraídos del sitio web del INE: www.ine.es"
# Aviso legal del INE, apartado «Reutilización de la información contenida en este sitio web», consultado el
# 06/10/2026: la licencia y las dos formas de cita, literales.
LICENCIA_TEXTO_INE = (
    "La licencia de uso general a aplicar a la información estadística de este sitio web, salvo que se indique lo "
    "contrario, es la Creative Commons Reconocimiento 4.0 (CC BY 4.0) que implica la autorización para la "
    "reutilización de la información en condiciones no restrictivas, siendo posible la copia, distribución y "
    "comunicación pública, así como la producción de obras derivadas, incluso con finalidad comercial citando la "
    "autoría."
)
LICENCIA_INE = (
    f"Creative Commons Reconocimiento 4.0 (CC BY 4.0), según el aviso legal del INE ({AVISO_LEGAL_INE}): citar la "
    f"fuente («{CITA_INE}»), mencionar la fecha de la última actualización y no sugerir que el INE participa, "
    "patrocina o apoya la reutilización."
)
# Síntesis conservada por clasificaciones y acreditación; distinta del literal y de la síntesis CC BY de arriba.
RESUMEN_LICENCIA_INE = (
    "Aviso legal del INE: reutilización permitida citando la fuente y sin desnaturalizar la información."
)

AVISO_LEGAL_IDESCAT = "https://www.idescat.cat/institut/web/?lang=es"
CONDICIONES_API_IDESCAT = "https://www.idescat.cat/dev/api/?lang=es"
CITA_IDESCAT = "Fuente: elaboración propia a partir de datos del Idescat"
# Aviso legal del Idescat («Con carácter general…») y condiciones de uso de sus API, consultados el 06/10/2026.
LICENCIA_TEXTO_IDESCAT = (
    "Con carácter general, el Idescat permite la reutilización de la información que difunde en su sitio web, siempre "
    "que se cite la fuente de procedencia, que no se altere ni se desnaturalice el contenido ni el sentido de la "
    "información y que se mencione la fecha de la última actualización de la información."
)
LICENCIA_IDESCAT = (
    f"Aviso legal del Idescat ({AVISO_LEGAL_IDESCAT}) y condiciones de uso de sus API ({CONDICIONES_API_IDESCAT}): "
    f"reutilización permitida citando la fuente («{CITA_IDESCAT}») con la fecha de la última actualización, "
    "enlazando con idescat.cat, sin modificar los datos al presentarlos y sin sugerir que el Idescat apoya el uso."
)

# Aviso de copyright de Eurostat: el texto literal y su síntesis, compartidos por todas las fuentes de Eurostat.
LICENCIA_EUROSTAT_TEXTO = (
    "Reuse of statistical data, metadata, publications, and other dissemination tools published on this website for "
    "commercial or non-commercial purposes is authorised provided the source is acknowledged."
)
LICENCIA_EUROSTAT = (
    "Aviso de copyright de Eurostat (https://ec.europa.eu/eurostat/help/copyright-notice, consultado el 06/10/2026), "
    "que aplica la Decisión 2011/833/UE de la Comisión: reutilización autorizada, también comercial, citando la "
    "fuente; una versión filtrada se cita con el enlace del conjunto y la fecha de consulta."
)

# Las API de los dos organismos, sin clave. El Idescat no devuelve más de 20.000 datos por petición (error 416).
API_IDESCAT = "https://api.idescat.cat/taules/v2"
API_TEMPUS = "https://servicios.ine.es/wstempus/js/ES/DATOS_TABLA"
# API de difusión de Eurostat (JSON-stat): cada conjunto se pide como `{API_EUROSTAT}/<código>?<filtros>`.
API_EUROSTAT = "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data"
# Cataluña en Tempus: el valor 9005 de la variable 70 (comunidades autónomas), como filtro de una petición.
VARIABLE_COMUNIDADES_TEMPUS = 70
CATALUNA_TEMPUS = 9005
FILTRO_CATALUNA_TEMPUS = f"tv={VARIABLE_COMUNIDADES_TEMPUS}:{CATALUNA_TEMPUS}"
# Nombre de la variable de ocupación compartida por las tablas de Tempus.
VARIABLE_OCUPACIONES = "OCUPACIONES"
# El Censo 2021 del INE ajusta individualmente cada cifra hasta ±3 personas por confidencialidad.
PERTURBACION_CENSO_2021 = 3
# Tope de celdas de una tabla JSON-stat, que se multiplican al cruzar sus dimensiones («size», no el contenido): el
# Idescat no da más de 20.000 por petición y la mayor que lee Faro tiene 14.400. Cinco veces el límite del Idescat
# deja margen a las consultas filtradas de Eurostat y acota la memoria (una Celda por combinación); una tabla mayor no
# es la que se pidió.
MAX_CELDAS_JSONSTAT = 100_000


# ---------------------------------------------------------------------------------------------------------------------
# Tipos
# ---------------------------------------------------------------------------------------------------------------------


class Celda(NamedTuple):
    """Una cifra de una tabla JSON-stat: el código de cada dimensión, el valor y su estado («..» si no se publica).

    Las claves son de solo lectura: la celda es inmutable entera.
    """

    claves: Mapping[str, str]
    valor: float | None
    estado: str | None


class CeldaTempus(NamedTuple):
    """Una cifra de una tabla de Tempus: código y nombre de cada variable, año, valor y notas del INE.

    Los códigos y los nombres son de solo lectura: las celdas de una serie comparten los mismos sin riesgo.
    """

    codigos: Mapping[str, str]
    nombres: Mapping[str, str]
    anio: int
    valor: float | None
    notas: tuple[str, ...]


# ---------------------------------------------------------------------------------------------------------------------
# Piezas internas
# ---------------------------------------------------------------------------------------------------------------------


def _categorias(tabla: dict[str, Any], dimension: str) -> list[str]:
    """Lee los códigos de una dimensión JSON-stat en su orden.

    Args:
        tabla: Conjunto JSON-stat.
        dimension: Identificador de la dimensión.

    Returns:
        Los códigos en su orden, tanto si «index» es una lista como si da la posición de cada código.
    """
    indice = tabla["dimension"][dimension]["category"]["index"]
    if isinstance(indice, list):
        return indice
    posiciones = list(indice.values())
    exigir(
        all(isinstance(posicion, (int, float)) and not isinstance(posicion, bool) for posicion in posiciones)
        and sorted(posiciones) == list(range(len(indice))),
        f"JSON-stat: posiciones de categorías inválidas en {dimension}",
    )
    return sorted(indice, key=indice.get)


def _posicional(contenedor: object, posicion: int) -> object:
    """Lee el elemento `posicion` de un `value` o `status` JSON-stat.

    Args:
        contenedor: Lista, diccionario por posición o un solo valor para todas las celdas.
        posicion: Posición de la celda en el orden de las dimensiones.

    Returns:
        El elemento de esa posición, o `None` si la lista o el diccionario no lo traen.
    """
    if isinstance(contenedor, list):
        return contenedor[posicion] if posicion < len(contenedor) else None
    if isinstance(contenedor, dict):
        return contenedor.get(str(posicion))
    return contenedor


def _codigo_tempus(metadato: dict[str, Any]) -> str:
    """Da el código de un valor de Tempus.

    Args:
        metadato: Metadato del valor en la serie.

    Returns:
        Su «Codigo»; los totales y algunas agrupaciones no lo tienen y se nombran por su «Nombre».
    """
    return metadato.get("Codigo") or metadato["Nombre"]


# ---------------------------------------------------------------------------------------------------------------------
# Lectores
# ---------------------------------------------------------------------------------------------------------------------


def celdas_jsonstat(tabla: dict[str, Any]) -> list[Celda]:
    """Lee todas las celdas de un conjunto JSON-stat 2.0, en el orden de sus dimensiones.

    Args:
        tabla: Conjunto JSON-stat 2.0.

    Returns:
        Una celda por combinación de categorías; la última dimensión varía más deprisa.

    Raises:
        FormatoInesperado: Si no es un conjunto de datos, su tamaño no cuadra con las categorías o pasa de
            MAX_CELDAS_JSONSTAT celdas.
    """
    exigir(tabla.get("class") == "dataset", f"JSON-stat: se esperaba un conjunto de datos y llega {tabla.get('class')}")
    dimensiones = tabla["id"]
    categorias = [_categorias(tabla, dimension) for dimension in dimensiones]
    exigir(
        [len(codigos) for codigos in categorias] == tabla["size"], "JSON-stat: el tamaño no cuadra con las categorías"
    )
    total = math.prod(tabla["size"])
    exigir(total <= MAX_CELDAS_JSONSTAT, f"JSON-stat: {total} celdas, más que el tope de {MAX_CELDAS_JSONSTAT}")
    estados = tabla.get("status")
    return [
        Celda(
            MappingProxyType(dict(zip(dimensiones, combinacion, strict=True))),
            _posicional(tabla["value"], posicion),
            _posicional(estados, posicion),
        )
        for posicion, combinacion in enumerate(itertools.product(*categorias))
    ]


def etiquetas_jsonstat(tabla: dict[str, Any], dimension: str) -> dict[str, str]:
    """Lee el nombre de cada código de una dimensión JSON-stat, tal como lo publica el organismo.

    Args:
        tabla: Conjunto JSON-stat.
        dimension: Identificador de la dimensión.

    Returns:
        El nombre de cada código; el propio código si no trae nombre.
    """
    categoria = tabla["dimension"][dimension]["category"]
    return {codigo: categoria.get("label", {}).get(codigo, codigo) for codigo in _categorias(tabla, dimension)}


def celdas_tempus(series: list[dict[str, Any]]) -> list[CeldaTempus]:
    """Lee todas las cifras de una respuesta de Tempus con metadatos.

    Args:
        series: Respuesta de Tempus pedida con `tip=AM`.

    Returns:
        Una celda por serie y año.

    Raises:
        FormatoInesperado: Si la respuesta no es una lista de series o una serie no trae sus metadatos.
    """
    exigir(isinstance(series, list), "Tempus: se esperaba una lista de series", FormatoInesperado)
    celdas: list[CeldaTempus] = []
    for serie in series:
        exigir("MetaData" in serie, f"Tempus: la serie {serie.get('COD')} no trae metadatos (falta tip=AM)")
        codigos = MappingProxyType(
            {metadato["T3_Variable"]: _codigo_tempus(metadato) for metadato in serie["MetaData"]}
        )
        nombres = MappingProxyType({metadato["T3_Variable"]: metadato["Nombre"] for metadato in serie["MetaData"]})
        for dato in serie["Data"]:
            notas = tuple(nota["texto"] for nota in dato.get("Notas") or [])
            celdas.append(CeldaTempus(codigos, nombres, dato["Anyo"], dato["Valor"], notas))
    return celdas
