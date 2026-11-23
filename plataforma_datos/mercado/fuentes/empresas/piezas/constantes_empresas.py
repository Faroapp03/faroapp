"""Rutas, edición, licencias y reglas de actividad de ETICCE y Eurostat."""

import re
from collections.abc import Mapping
from http import HTTPStatus
from typing import Final

from plataforma_datos.comun.entrada_salida import carpetas
from plataforma_datos.comun.estadisticas import API_EUROSTAT

# La licencia de Eurostat vive en estadisticas.py; se reexporta para las fuentes que la leen de aquí.
from plataforma_datos.comun.estadisticas import LICENCIA_EUROSTAT as LICENCIA_EUROSTAT
from plataforma_datos.comun.estadisticas import LICENCIA_EUROSTAT_TEXTO as LICENCIA_EUROSTAT_TEXTO
from plataforma_datos.comun.estadisticas import SITIO_INE as INEBASE
from plataforma_datos.comun.nucleo import ARCHIVO_DE_PROCEDENCIA

FUENTE: Final[str] = "empresas"
ORIGINAL, PREPARADO, VALIDADO = carpetas(FUENTE)
PROCEDENCIA: Final = ORIGINAL / ARCHIVO_DE_PROCEDENCIA
# Lo que escribe preparar y lee validar: las cifras del INE y de Eurostat (España y Cataluña), una por fila, y la
# edición.
INE: Final = PREPARADO / "ine.jsonl"
EUROSTAT: Final = PREPARADO / "eurostat.jsonl"
EUROSTAT_CATALUNA: Final = PREPARADO / "eurostat-cataluna.jsonl"
EDICION: Final = PREPARADO / "edicion.json"

RESULTADOS: Final[str] = (
    f"{INEBASE}/dyngs/INEbase/es/operacion.htm?c=Estadistica_C&cid=1254736176743&menu=resultados&idp=1254735576692"
)
EUROSTAT_API: Final[str] = f"{API_EUROSTAT}/isoc_eb_ain2"
EUROSTAT_FILTRO: Final[str] = "format=JSON&lang=EN&geo=ES&indic_is=E_AI_TANY&unit=PC_ENT&size_emp=GE10"
EUROSTAT_DOI: Final[str] = "https://doi.org/10.2908/ISOC_EB_AIN2"
# La misma encuesta por región, con menos detalle de actividad (secciones): Cataluña, los tres últimos años.
EUROSTAT_CATALUNA_API: Final[str] = f"{API_EUROSTAT}/isoc_r_eb_ain2"
EUROSTAT_CATALUNA_FILTRO: Final[str] = "format=JSON&lang=EN&geo=ES51&indic_is=E_AI_TANY&unit=PC_ENT&size_emp=GE10"
EUROSTAT_CATALUNA_DOI: Final[str] = "https://doi.org/10.2908/ISOC_R_EB_AIN2"
ANIOS_DE_CATALUNA: Final[int] = 3
# Contrato semántico de las dos tablas. Un código estable no garantiza que su definición siga siendo la misma.
ETIQUETAS_EUROSTAT: Final[Mapping[str, tuple[str, str]]] = {
    "size_emp": ("GE10", "10 persons employed or more"),
    "indic_is": (
        "E_AI_TANY",
        "Enterprises using at least one of the AI technologies: AI_TTM, AI_TSR, AI_TNLG, AI_TIR, AI_TML, "
        "AI_TPA, AI_TAR, E_AI_TPVSG",
    ),
    "unit": ("PC_ENT", "Percentage of enterprises"),
}
CLASIFICACION_EUROSTAT: Final[str] = (
    "Statistical classification of economic activities in the European Community (NACE Rev. 2)"
)
# Los capítulos de la página de resultados con la tabla de IA de cada parte, por su título (el año es el de la
# edición: «primer trimestre de 2025» es la edición 2024–1T2025) y el título de la tabla dentro del capítulo.
CAPITULOS: Final[Mapping[str, tuple[str, str]]] = {
    "sectores": (
        r"Las TIC en las empresas \((?:\d{4} o )?primer trimestre de (\d{4})\) por agrupación de actividad",
        "Inteligencia artificial",
    ),
    "menos_de_10": (
        r"Las TIC en las empresas \((?:\d{4} o )?primer trimestre de (\d{4})\)$",
        "Inteligencia artificial",
    ),
    "comunidades": (
        r"Las TIC en las empresas con 10 o más empleados \((?:\d{4} o )?primer trimestre de (\d{4})\) "
        r"por sectores de actividad",
        "Inteligencia artificial",
    ),
    "errores": (r"Errores de muestreo", "Error estándar de variable Inteligencia Artificial"),
}
# La pregunta E.1 por su enunciado (no por su número, que puede cambiar de una edición a otra).
PREGUNTA_IA: Final = re.compile(
    r"% de empresas que (emplean|utilizan) (alguna )?tecnolog[ií]as? de inteligencia artificial", re.I
)
TOTAL: Final[str] = "Total"
CATALUNA: Final[str] = "Cataluña"
GRANDES_SECTORES: Final = ("Industria", "Construcción", "Servicios")
# Eurostat marca «u» las cifras poco fiables; pct_poco_fiable las identifica para sus consumidores.
POCO_FIABLE: Final[str] = "u"
# Las marcas («flags») con que Eurostat difunde una cifra, según su guía de difusión.
MARCAS_EUROSTAT: Final[Mapping[str, str]] = {
    "b": "ruptura de serie",
    "c": "confidencial",
    "d": "definición distinta",
    "e": "estimada",
    "f": "previsión",
    "n": "no significativa",
    "p": "provisional",
    "r": "revisada",
    "s": "estimación de Eurostat",
    "u": "poco fiable",
    "z": "no aplicable",
}
# INE y Eurostat publican la misma encuesta: en los agregados con las mismas divisiones, las dos cifras no difieren más
# de este margen, en puntos porcentuales (las diferencias de unas décimas son de ponderación).
MAX_DIFERENCIA_INE_EUROSTAT: Final[float] = 1.0
# Límite de los porcentajes de empresas y de la cobertura de personas, en la misma escala 0–100.
PORCENTAJE_MAXIMO: Final[int] = 100
# Las respuestas con que Eurostat dice que aún no publica un año: la petición no tiene datos o no existe.
SIN_PUBLICAR_EN_EUROSTAT: Final = (HTTPStatus.BAD_REQUEST, HTTPStatus.NOT_FOUND)
# Secciones de la CNAE-09 (NACE Rev. 2) con sus divisiones, para leer los códigos de Eurostat.
SECCIONES: Final[Mapping[str, tuple[int, int]]] = {
    "B": (5, 9),
    "C": (10, 33),
    "D": (35, 35),
    "E": (36, 39),
    "F": (41, 43),
    "G": (45, 47),
    "H": (49, 53),
    "I": (55, 56),
    "J": (58, 63),
    "K": (64, 66),
    "L": (68, 68),
    "M": (69, 75),
    "N": (77, 82),
    "S": (94, 96),
}
# Lo que mide la encuesta del INE: las divisiones CNAE-09 de la primera de la sección C (10) a la última de la N (82),
# sin las actividades financieras, que son la sección K (64 a 66).
PRIMERA_DIVISION_MEDIDA: Final = SECCIONES["C"][0]
ULTIMA_DIVISION_MEDIDA: Final = SECCIONES["N"][1]
DIVISIONES_FINANCIERAS: Final = tuple(range(SECCIONES["K"][0], SECCIONES["K"][1] + 1))
# Los nombres en castellano (CNAE-09) de los agregados de Eurostat que usa la tabla de paso.
NOMBRES_EUROSTAT: Final[Mapping[str, str]] = {
    "C10-S951_X_K": "Todas las actividades medidas (sin el sector financiero)",
    "C-F": "Industria y construcción",
    "C-E": "Industria (manufacturera, energía, agua y residuos)",
    "C": "Industria manufacturera",
    "C10-C12": "Industria de la alimentación, bebidas y tabaco",
    "C13-C15": "Industria textil, confección, cuero y calzado",
    "C16-C18": "Madera, papel y artes gráficas",
    "C19": "Coquerías y refino de petróleo",
    "C19-C23": "Refino, química, farmacia, caucho, plásticos y minerales no metálicos",
    "C20": "Industria química",
    "C21": "Fabricación de productos farmacéuticos",
    "C22_C23": "Caucho, plásticos y otros productos minerales no metálicos",
    "C24_C25": "Metalurgia y fabricación de productos metálicos",
    "C26-C33": "Productos informáticos y electrónicos, maquinaria, vehículos, muebles y otras manufacturas",
    "C27": "Fabricación de material y equipo eléctrico",
    "C28": "Fabricación de maquinaria y equipo",
    "C29_C30": "Fabricación de vehículos de motor y otro material de transporte",
    "C31-C33": "Muebles, otras manufacturas y reparación e instalación de maquinaria",
    "D_E": "Energía, agua, saneamiento y residuos",
    "E": "Agua, saneamiento, gestión de residuos y descontaminación",
    "F": "Construcción",
    "G": "Comercio al por mayor y al por menor; reparación de vehículos de motor",
    "G45": "Venta y reparación de vehículos de motor",
    "G45-S951_X_K": "Servicios (sin el sector financiero)",
    "G46": "Comercio al por mayor",
    "G47": "Comercio al por menor",
    "H": "Transporte y almacenamiento",
    "I": "Hostelería (alojamiento y restauración)",
    "I55": "Servicios de alojamiento",
    "J": "Información y comunicaciones",
    "J62_J63": "Programación, consultoría informática y servicios de información",
    "L": "Actividades inmobiliarias",
    "L68": "Actividades inmobiliarias",
    "L_M": "Actividades inmobiliarias, profesionales, científicas y técnicas",
    "M": "Actividades profesionales, científicas y técnicas",
    "M69-M71": "Jurídicas, contables, consultoría de gestión, arquitectura e ingeniería",
    "M73-M75": "Publicidad, estudios de mercado y otras actividades profesionales",
    "N": "Actividades administrativas y servicios auxiliares",
    "N77-N82_X_N79": "Actividades administrativas y servicios auxiliares (sin agencias de viajes)",
    "N79": "Agencias de viajes y operadores turísticos",
}

NOMBRE_FUENTE: Final[str] = (
    "INE · ETICCE y Eurostat · isoc_eb_ain2 e isoc_r_eb_ain2: uso de la inteligencia artificial en las empresas"
)

# Rótulos literales de las variables de Tempus y textos del conjunto exportado; el lector no los traduce.
VARIABLES_PRINCIPALES: Final[str] = "Principales variables"
PREGUNTA_TEMPUS: Final[str] = "Pregunta"
AGRUPACION_ACTIVIDAD: Final[str] = "Agrupación de actividad"
ESTRATOS_TEMPUS: Final[str] = "Estratos"
TAMANO_EMPRESA: Final[str] = "Tamaño de la empresa"
TERRITORIOS_TEMPUS: Final[str] = "Comunidades y ciudades autónomas"
TOTAL_NACIONAL: Final[str] = "Total nacional"
TOTAL_EMPRESAS: Final[str] = "Total Empresas"
TERRITORIO_REGIONAL: Final[str] = "Cataluña (región NUTS 2 ES51)"
MEDIDA_REGIONAL: Final[str] = (
    "% de empresas de 10 o más personas que usan al menos una tecnología de inteligencia artificial"
)
NOTA_REGIONAL: Final[str] = (
    "Cifras de Eurostat sin redondear. Una cifra marcada como poco fiable («u») no va en «pct»: va en "
    "«pct_poco_fiable», con su marca, y no se da como firme; una confidencial no tiene cifra. Describe las "
    "empresas de un sector en Cataluña, no a la persona ni a su empresa. Las secciones no cubren la "
    "Administración, la educación, la sanidad, los servicios sociales ni el sector financiero."
)
MEDIDA_ENCUESTA: Final[str] = "% de empresas con Internet que usan al menos una tecnología de IA (pregunta E.1)"
POBLACION_ENCUESTA: Final[str] = (
    "empresas de 10 o más personas empleadas con Internet; ámbito CNAE-2009 de la ETICCE, "
    "sin restauración (56), finanzas (64–66) ni reparación de ordenadores y comunicaciones (95.1)"
)
PERIODO_ENCUESTA: Final[str] = "uso de la IA en el primer trimestre del año de la edición"
ERROR_ENCUESTA: Final[str] = (
    "El error estándar publicado corresponde a E.1.A, análisis del lenguaje escrito, sobre empresas usuarias "
    "de IA. Se conserva como referencia; no es un error ni una cota del indicador E.1 "
    "y no se utiliza para su intervalo."
)
