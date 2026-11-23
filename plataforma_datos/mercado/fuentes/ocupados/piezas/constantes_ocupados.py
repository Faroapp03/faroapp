"""Procedencia, archivos y reglas declaradas de ocupados; las etapas viven en `mercado/fuentes/ocupados/lector.py`."""

from collections.abc import Mapping
from typing import Final

from plataforma_datos.comun.entrada_salida import carpetas
from plataforma_datos.comun.estadisticas import (
    API_IDESCAT,
    API_TEMPUS,
    CITA_IDESCAT,
    CITA_INE,
    FILTRO_CATALUNA_TEMPUS,
    LICENCIA_IDESCAT,
    LICENCIA_INE,
    PERTURBACION_CENSO_2021,
)
from plataforma_datos.comun.lugares import COMARCAS_DE_LA_ZONA as COMARCAS
from plataforma_datos.comun.nucleo import ARCHIVO_DE_PROCEDENCIA, ArchivoDescargable
from plataforma_datos.mercado.fuentes.ocupados.piezas.rotulos_ocupados import componer, de_los_anios
from plataforma_datos.ocupaciones.fuentes.clasificaciones.lector import CODIGO_NO_CONSTA as NO_CONSTA
from plataforma_datos.ocupaciones.fuentes.clasificaciones.lector import TOTAL_OCUPACIONES as TOTAL

FUENTE: Final[str] = "ocupados"
# Cota existente de la procedencia que coteja la cobertura remota; se comparte con quien la escribe.
MAX_PROCEDENCIA_BYTES: Final = 256 * 1024
IDESCAT_PARTES: Final = "idescat_partes"
ORIGINAL, PREPARADO, VALIDADO = carpetas(FUENTE)
PROCEDENCIA: Final = ORIGINAL / ARCHIVO_DE_PROCEDENCIA
# Lo que escribe preparar y lee validar: una fila por territorio, grupo y año.
CATALUNA_CNO3: Final = PREPARADO / "cataluna-cno3.jsonl"
TERRITORIOS_CNO2: Final = PREPARADO / "territorios-cno2.jsonl"
CONTROL_INE: Final = PREPARADO / "ine-cno2.jsonl"
CONTEXTO: Final = PREPARADO / "contexto.json"

# Cobertura histórica imprescindible, no un límite superior de la serie abierta.
ANIOS: Final = ("2021", "2022", "2023")
# El censo de 2021 es el decenal y el de 2022 en adelante, el anual, con otro método (el INE lo explica en la
# metodología del Censo anual): las cifras se comparan solo desde este año, y el paquete lleva solo los comparables.
PRIMER_ANIO_COMPARABLE: Final[str] = "2022"
# Por debajo de 100 personas el redondeo publicado (REDONDEO_IDESCAT) pesa demasiado en un porcentaje y una cifra tan
# pequeña puede acercarse a señalar a alguien: no pasa al paquete. Se deriva del redondeo de esta fuente; otras usan
# el mismo número con su propio motivo (la perturbación del INE en el censo, el ruido de los contratos).
MIN_PERSONAS: Final[int] = 100
# El Idescat redondea al azar cada cifra a un múltiplo de 3 (nota de la tabla 17977): una cifra se mueve como mucho 2
# personas. Tres cifras redondeadas por separado (hombres, mujeres y total) pueden descuadrar hasta 3 × 2.
REDONDEO_IDESCAT: Final[int] = 2
DESCUADRE_POR_SEXO: Final = 3 * REDONDEO_IDESCAT
# El Censo 2021 del INE ajusta cada cifra ±3 por confidencialidad: frente a él, el Idescat puede diferir 3 + 2.
CONTRASTE_CON_EL_CENSO_2021: Final = PERTURBACION_CENSO_2021 + REDONDEO_IDESCAT

# Cataluña en cada fuente: el único valor de la dimensión territorial del Idescat; en Tempus del INE, el filtro
# FILTRO_CATALUNA_TEMPUS (estadisticas.py).
CATALUNA_IDESCAT: Final[str] = "TOTAL"
# Municipios del Baix Llobregat y del Barcelonès que publica la tabla 17977 (solo los de 10.000 habitantes o más),
# por su código del Idescat (el del INE y una cifra de control). Su comarca se comprueba con el nomenclátor del Idescat.
MUNICIPIOS: Final = (
    "080018",  # Abrera
    "080569",  # Castelldefels
    "080728",  # Corbera de Llobregat
    "080734",  # Cornellà de Llobregat
    "080765",  # Esparreguera
    "080771",  # Esplugues de Llobregat
    "080898",  # Gavà
    "081141",  # Martorell
    "081234",  # Molins de Rei
    "081477",  # Olesa de Montserrat
    "081574",  # Pallejà
    "081691",  # El Prat de Llobregat
    "081960",  # Sant Andreu de la Barca
    "082009",  # Sant Boi de Llobregat
    "082114",  # Sant Feliu de Llobregat
    "082172",  # Sant Joan Despí
    "082212",  # Sant Just Desvern
    "082634",  # Sant Vicenç dels Horts
    "082956",  # Vallirana
    "083015",  # Viladecans
    "080155",  # Badalona
    "080193",  # Barcelona
    "081017",  # L'Hospitalet de Llobregat
    "081944",  # Sant Adrià de Besòs
    "082457",  # Santa Coloma de Gramenet
)
# Códigos INE de las nueve ciudades de la tabla 69979 que están en esas comarcas: Castelldefels, Cornellà, El Prat,
# Sant Boi, Viladecans, Badalona, Barcelona, L'Hospitalet y Santa Coloma. Exigen cobertura aunque desaparezca una serie.
CIUDADES_INE: Final = ("08056", "08073", "08169", "08200", "08301", "08015", "08019", "08101", "08245")
# Identificadores internos de Tempus (valores de la variable 19, municipios) de esas mismas nueve ciudades.
CIUDADES_TEMPUS: Final = (5511, 5523, 5347, 5376, 5439, 5471, 563, 1796, 1929)
FILTRO_CIUDADES: Final = "&".join(f"tv=19:{valor}" for valor in CIUDADES_TEMPUS)
# Las dos comarcas en los títulos: «del Baix Llobregat (11) y del Barcelonès (13)».
DE_LAS_COMARCAS_CON_CODIGO: Final = " y ".join(f"del {nombre} ({codigo})" for codigo, nombre in COMARCAS.items())
DE_LAS_COMARCAS: Final = " y ".join(f"del {nombre}" for nombre in COMARCAS.values())

TABLA_17980: Final[str] = "idescat-17980-cataluna.json"
TABLA_17977: Final[Mapping[str, str]] = {
    "cataluna": "idescat-17977-cataluna.json",
    "comarca": "idescat-17977-comarcas.json",
    "municipio": "idescat-17977-municipios.json",
}
NOMENCLATOR: Final[str] = "idescat-comarcas-municipios.json"
TABLA_69959: Final[str] = "ine-69959-cataluna.json"
TABLA_69979: Final[str] = "ine-69979-ciudades.json"
CENSO: Final[str] = f"{API_IDESCAT}/censph"
# Los originales con el periodo como hueco `{periodo}` en su título (rotulos_ocupados); ARCHIVOS los da compuestos.
PLANTILLAS_DE_ARCHIVOS: Final[list[ArchivoDescargable]] = [
    {
        "archivo": TABLA_17980,
        "nivel": "oficial",
        "titulo": "Idescat, tabla 17980: población ocupada por subgrupos de ocupación (CNO-11, 3 cifras) y sexo. "
        "Cataluña, {periodo}",
        "url": f"{CENSO}/17980/21518/cat/data?lang=es",
        "licencia": LICENCIA_IDESCAT,
    },
    {
        "archivo": TABLA_17977["cataluna"],
        "nivel": "oficial",
        "titulo": "Idescat, tabla 17977: población ocupada por subgrupos principales de ocupación (CNO-11, 2 cifras) "
        "y sexo. Cataluña, {periodo}",
        "url": f"{CENSO}/17977/21517/cat/data?lang=es",
        "licencia": LICENCIA_IDESCAT,
    },
    {
        "archivo": TABLA_17977["comarca"],
        "nivel": "oficial",
        "titulo": f"Idescat, tabla 17977, comarcas {DE_LAS_COMARCAS_CON_CODIGO}, {{periodo}}",
        "url": f"{CENSO}/17977/21517/com/data?lang=es&COM={','.join(COMARCAS)}",
        "licencia": LICENCIA_IDESCAT,
    },
    {
        "archivo": TABLA_17977["municipio"],
        "nivel": "oficial",
        "titulo": f"Idescat, tabla 17977, municipios de 10.000 habitantes o más {DE_LAS_COMARCAS}, {{periodo}}",
        "url": f"{CENSO}/17977/21517/mun/data?lang=es&MUN={','.join(MUNICIPIOS)}",
        "licencia": LICENCIA_IDESCAT,
    },
    {
        "archivo": NOMENCLATOR,
        "nivel": "oficial",
        "titulo": "Idescat, El municipi en xifres: comarcas y sus municipios",
        "url": "https://api.idescat.cat/emex/v1/nodes.json?lang=es&tipus=com,mun",
        "licencia": LICENCIA_IDESCAT,
    },
    {
        "archivo": TABLA_69959,
        "nivel": "oficial",
        "titulo": "INE, tabla 69959: ocupados por comunidad autónoma, sexo y ocupación (CNO-11, 2 cifras). Cataluña, "
        "Censo anual {periodo}",
        "url": f"{API_TEMPUS}/69959?{FILTRO_CATALUNA_TEMPUS}&tip=AM",
        "licencia": LICENCIA_INE,
    },
    {
        "archivo": TABLA_69979,
        "nivel": "oficial",
        "titulo": "INE, tabla 69979: ocupados por capitales de provincia y principales ciudades, sexo y ocupación "
        f"(CNO-11, 2 cifras). Nueve ciudades {DE_LAS_COMARCAS}, Censo anual {{periodo}}",
        "url": f"{API_TEMPUS}/69979?{FILTRO_CIUDADES}&tip=AM",
        "licencia": LICENCIA_INE,
    },
]
PLANTILLA_DEL_TITULO: Final[Mapping[str, str]] = {
    archivo["archivo"]: archivo["titulo"] for archivo in PLANTILLAS_DE_ARCHIVOS if "{periodo}" in archivo["titulo"]
}
# Los años de la captura histórica completa, con los que se componen sus títulos.
ANIOS_HISTORICOS: Final[tuple[str, ...]] = ("2021", "2022", "2023")
ARCHIVOS: Final[list[ArchivoDescargable]] = [
    {**archivo, "titulo": de_los_anios(PLANTILLA_DEL_TITULO[archivo["archivo"]], ANIOS_HISTORICOS)}
    if archivo["archivo"] in PLANTILLA_DEL_TITULO
    else archivo
    for archivo in PLANTILLAS_DE_ARCHIVOS
]
# ARCHIVOS conserva el contrato de las capturas históricas completas. Las descargas nuevas descubren primero
# las categorías en las mismas cuatro tablas, sin /data ni filtro YEAR; cada parte conserva su propio cuerpo HTTP.
METADATOS_IDESCAT: Final[tuple[ArchivoDescargable, ...]] = tuple(
    {
        **archivo,
        "archivo": f"metadatos-{archivo['archivo']}",
        "titulo": componer(PLANTILLA_DEL_TITULO[archivo["archivo"]], periodo="calendario completo, metadatos"),
        "url": archivo["url"].replace("/data?", "?"),
    }
    for archivo in ARCHIVOS[:4]
)
ARCHIVOS_AUXILIARES: Final[tuple[ArchivoDescargable, ...]] = tuple(ARCHIVOS[4:])
PLANTILLA_NOMBRE_FUENTE: Final[str] = "Idescat e INE · personas ocupadas por ocupación (Censo anual {periodo})"
NOMBRE_FUENTE: Final[str] = de_los_anios(PLANTILLA_NOMBRE_FUENTE, ANIOS_HISTORICOS)
LICENCIA: Final[str] = f"Idescat: {LICENCIA_IDESCAT} INE: {LICENCIA_INE}"
PLANTILLA_CITA: Final[str] = (
    f"{CITA_IDESCAT} (Población ocupada por subgrupos de ocupación y sexo, tablas 17980 y 17977; 2021: censo de "
    "población y viviendas del INE; {periodo_anual}: censo de población anual del INE). Control: "
    f"{CITA_INE} (Censo anual de población, tablas 69959 y 69979)."
)
CITA: Final[str] = de_los_anios(PLANTILLA_CITA, ANIOS_HISTORICOS)

# Cómo nombra cada organismo el sexo y los códigos que no son un grupo de la CNO-11.
SEXO_IDESCAT: Final[Mapping[str, str]] = {"M": "hombres", "F": "mujeres", "TOTAL": "total"}
SEXO_INE: Final[Mapping[str, str]] = {"1": "hombres", "6": "mujeres", "Total": "total"}
ESPECIALES: Final[Mapping[str, str]] = {"TOTAL": TOTAL, "_U": NO_CONSTA, "Total": TOTAL, "No consta": NO_CONSTA}
# El orden del paquete es el de las categorías de la tabla del Idescat: hombres, mujeres y total.
SEXOS: Final = tuple(SEXO_IDESCAT.values())
NO_PUBLICADO: Final[str] = ".."
# Grupos que el Idescat no publica a 3 cifras, como el Censo 2021 del INE: protección y seguridad (591–599), que tiene
# su cifra a 2 cifras (59), y las fuerzas armadas (001 y 002), que el Idescat no publica a ningún nivel.
SIN_CIFRA_A_3: Final = {"001", "002", "591", "592", "593", "594", "599"}
SUBGRUPO_CON_CIFRA_A_2: Final[str] = "59"
DIMENSION_OCUPACION: Final[str] = "OCC_2011"
