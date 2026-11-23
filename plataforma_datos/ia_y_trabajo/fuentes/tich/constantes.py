"""Procedencia, archivos y reglas declaradas de la TIC-H del INE para el cálculo de uso de IA por ocupación.

Los nombres de variables y rótulos son los publicados por el INE. Las magnitudes fijan la muestra mínima y las alarmas
que contrastan la entrevista con las tablas oficiales y la EPA; las etapas de lectura y cálculo viven en
`ia_y_trabajo/fuentes/tich/lector.py`.
"""

from collections.abc import Mapping
from typing import Final, NamedTuple

from plataforma_datos.comun.entrada_salida import carpetas
from plataforma_datos.comun.estadisticas import API_EUROSTAT as EUROSTAT
from plataforma_datos.comun.estadisticas import CITA_INE, LICENCIA_EUROSTAT, LICENCIA_INE
from plataforma_datos.comun.nucleo import ARCHIVO_DE_PROCEDENCIA, ArchivoDescargable

FUENTE: Final[str] = "tich"
ORIGINAL, PREPARADO, VALIDADO = carpetas(FUENTE)
PROCEDENCIA: Final = ORIGINAL / ARCHIVO_DE_PROCEDENCIA
RESULTADOS: Final[str] = (
    "https://www.ine.es/dyngs/INEbase/es/operacion.htm?c=Estadistica_C&cid=1254736176741&menu=resultados&idp=1254735976608"
)
CATALOGO: Final[str] = "ine-tich-resultados.html"
# Lo que escribe preparar y lee validar.
ESTIMACIONES: Final = PREPARADO / "uso-ia-por-ocupacion.json"
PUBLICADAS: Final = PREPARADO / "cifras-publicadas.json"

EPA_DATASET: Final[str] = "LFSA_EGAI2D"
# Dentro del ZIP de microdatos, otro ZIP con el fichero del cuestionario: los datos en CSV y su diseño de registro.
FICHERO_CUESTIONARIO: Final[str] = "FicheroCuestionario.zip"
CODIFICACION_MICRODATOS: Final[str] = "latin-1"
# Lo más que se descomprime de un archivo dentro de los ZIP: el mayor que se lee, el fichero del
# cuestionario, pesa 7,9 MB.
MAX_MIEMBRO_BYTES: Final = 64 * 1024 * 1024
CSV_INE: Final[str] = "https://www.ine.es/jaxi/files/tpx/es/csv_bdsc"
# La primera edición con la pregunta de IA generativa, con sus tablas: la admitida mientras no se valide otra
# (edicion.py). Cada edición trae números de tabla nuevos, que se localizan por su título (navegacion.py).
PRIMERA_EDICION: Final[str] = "2025"
TABLAS_DE_LA_PRIMERA: Final[Mapping[str, str]] = {"uso": "76444", "errores": "76849"}
# Fechas de las ediciones que las tienen anotadas: resultados de 2025 publicados el 20/11/2025 (nota de prensa
# TICH2025) y su fichero de microdatos del 10/06/2026 (cabecera Last-Modified del servidor del INE).
FECHAS_DE_LA_EDICION: Final[Mapping[str, tuple[str, str]]] = {"2025": ("20/11/2025", "10/06/2026")}
CONDICIONES_MICRODATOS: Final[str] = (
    "El INE no se responsabiliza de los resultados que los receptores de los datos obtengan a partir de estos "
    "ficheros basados en sus propios cálculos. Además, los receptores se comprometen a citar, en cualquier "
    "publicación obtenida a partir de ellos, al INE como fuente del dato primario (fuente: INE, www.ine.es), así como "
    "a que el grado de exactitud o fiabilidad de la información derivada por elaboración propia de los autores es de "
    "la exclusiva responsabilidad de estos."
)


class NombresDelAnio(NamedTuple):
    """Los originales de una edición y los ficheros que se leen dentro de sus microdatos."""

    microdatos: str
    uso: str
    errores: str
    epa: str
    datos: str
    diseno: str
    metodologia: str
    cuestionario: str


def nombres_del_anio(anio: str, tablas: Mapping[str, str], epa_anio: str) -> NombresDelAnio:
    """Los nombres de los originales de una edición, con sus tablas y el año de la EPA con que se contrasta.

    Returns:
        Los nombres.
    """
    return NombresDelAnio(
        microdatos=f"tich-{anio}-microdatos.zip",
        uso=f"ine-{tablas['uso']}.csv",
        errores=f"ine-{tablas['errores']}.csv",
        epa=f"eurostat-{EPA_DATASET.lower()}-ES-{epa_anio}.json",
        datos=f"CSV/TICHcuestionario_{anio}.tab",
        diseno=f"dr_TICHcuestionario_{anio}.json",
        metodologia=f"ine-tich-{anio}-metodologia.pdf",
        cuestionario=f"ine-tich-{anio}-cuestionario.pdf",
    )


def archivos_del_anio(anio: str, tablas: Mapping[str, str], epa_anio: str) -> list[ArchivoDescargable]:
    """Los cuatro originales de una edición con su dirección oficial: microdatos, tablas y EPA.

    Returns:
        Los archivos descargables, en el orden en que se descargan.
    """
    nombres = nombres_del_anio(anio, tablas, epa_anio)
    return [
        {
            "archivo": nombres.microdatos,
            "nivel": "oficial",
            "titulo": f"INE, TIC-H {anio}: microdatos (fichero del cuestionario y de miembros)",
            "url": f"https://www.ine.es/ftp/microdatos/tich/datos_{anio}.zip",
            "licencia": LICENCIA_INE,
        },
        {
            "archivo": nombres.uso,
            "nivel": "oficial",
            "titulo": f"INE, TIC-H {anio}, tabla {tablas['uso']}: uso de IA generativa por características "
            "socioeconómicas",
            "url": f"{CSV_INE}/{tablas['uso']}.csv",
            "licencia": LICENCIA_INE,
        },
        {
            "archivo": nombres.errores,
            "nivel": "oficial",
            "titulo": f"INE, TIC-H {anio}, tabla {tablas['errores']}: errores estándar relativos de la utilización "
            "de TIC y del teletrabajo de las personas de 16 a 74 años, por comunidad autónoma; contraste del "
            "intervalo, no se publica",
            "url": f"{CSV_INE}/{tablas['errores']}.csv",
            "licencia": LICENCIA_INE,
        },
        {
            "archivo": nombres.epa,
            "nivel": "oficial",
            "titulo": f"Eurostat, EPA {epa_anio} (lfsa_egai2d): personas ocupadas de 15 a 74 años en España por "
            "grupo ISCO-08 de 2 cifras, en miles; control del paso desde la CNO-11, no se publica",
            "url": f"{EUROSTAT}/{EPA_DATASET.lower()}?format=JSON&lang=EN&geo=ES&time={epa_anio}&age=Y15-74&sex=T"
            "&unit=THS_PER",
            "licencia": LICENCIA_EUROSTAT,
        },
    ]


def documentos_del_anio(anio: str, documentos: Mapping[str, str]) -> list[ArchivoDescargable]:
    """La metodología y el cuestionario de una edición, con la dirección que se localizó al navegar (navegacion.py).

    Returns:
        Los dos archivos descargables, metodología y cuestionario.
    """
    nombres = nombres_del_anio(anio, TABLAS_DE_LA_PRIMERA, anio)
    return [
        {
            "archivo": nombres.metodologia,
            "nivel": "oficial",
            "titulo": f"INE, TIC-H {anio}: metodología (secciones censales en muestra)",
            "url": documentos["metodologia"],
            "licencia": LICENCIA_INE,
        },
        {
            "archivo": nombres.cuestionario,
            "nivel": "oficial",
            "titulo": f"INE, TIC-H {anio}: cuestionario (enunciado de las preguntas de IA generativa)",
            "url": documentos["cuestionario"],
            "licencia": LICENCIA_INE,
        },
    ]


def nombre_fuente(anio: str, tablas: Mapping[str, str]) -> str:
    """El nombre de la fuente con su edición.

    Returns:
        El nombre.
    """
    return f"INE · TIC-H {anio}: uso de IA generativa por ocupación (microdatos y tabla {tablas['uso']})"


def cita(anio: str, tablas: Mapping[str, str]) -> str:
    """La cita de una edición, con sus fechas si están anotadas.

    Returns:
        La cita.
    """
    fechas = FECHAS_DE_LA_EDICION.get(anio)
    microdatos = f" (fichero del {fechas[1]})" if fechas else ""
    resultados = f" (resultados publicados el {fechas[0]})" if fechas else ""
    return (
        f"{CITA_INE}. Encuesta sobre Equipamiento y Uso de Tecnologías de Información y Comunicación en los Hogares "
        f"(TIC-H) {anio}: cálculo propio con sus microdatos{microdatos} y tabla {tablas['uso']}{resultados}. Fuente "
        "del dato primario: INE, www.ine.es."
    )


# Los originales de la primera edición: el contrato con que se compara la cobertura de los descriptores.
ARCHIVOS: Final[list[ArchivoDescargable]] = archivos_del_anio(PRIMERA_EDICION, TABLAS_DE_LA_PRIMERA, PRIMERA_EDICION)

# Número mínimo de entrevistas sin ponderar en cada grupo cuyo porcentaje se calcula.
MIN_MUESTRA: Final[int] = 100
# Grados de libertad del diseño para el intervalo de Korn–Graubard: secciones censales en muestra (unidades primarias)
# menos estratos. Las secciones salen del estado de la edición admitida (edicion.py), que las leyó de su metodología al
# admitirla, o de la metodología de la candidata (documentos_de_la_edicion.py); el fichero público no identifica la
# sección, pero sí el estrato (`HABITAT_ESTRATO`, el tamaño del municipio dentro de cada comunidad), y los estratos se
# cuentan en él. Una cifra de un subgrupo usa los grados del diseño de su territorio,
# como hacen por omisión Stata y SUDAAN con los dominios.
# Códigos del diseño de registro del INE (dr_TICHcuestionario_2025.json): no sabe, fuerzas armadas, sí y no.
NO_SABE: Final[str] = "99"
FUERZAS_ARMADAS: Final[str] = "0"
SI: Final[str] = "1"
NO: Final[str] = "6"
VARIABLE_USO: Final[str] = "IAG_TRAB"
ESTRATO: Final[str] = "HABITAT_ESTRATO"
# Contraste con los errores de muestreo que publica el INE (tabla 76849, método jackknife con las secciones): el INE no
# los publica para el uso de la IA ni por ocupación, así que se contrasta la variable de personas ocupadas que sí tiene,
# la posibilidad de teletrabajar (`TELETRAB` 1 o 2), en España y en cada comunidad.
VARIABLE_CONTRASTE: Final[str] = "TELETRAB"
SI_CONTRASTE: Final = ("1", "2")
FILA_CONTRASTE: Final[str] = "Personas ocupadas que tienen la posibilidad de teletrabajar parcial o totalmente"
TOTAL_NACIONAL: Final[str] = "Total Nacional"
# El universo de la encuesta y de sus tablas: personas de 16 a 74 años. Todas las estimaciones por grupo se calculan
# en él; con él, la población de cada grupo publicado coincide con la de la tabla del INE.
EDAD_CONTRASTE: Final = (16, 74)
# Uso de alguna herramienta de IA generativa y, entre quienes no la usaron, el motivo «No sabía cómo utilizarlas»: la
# base de la tabla 3.4.2 del Idescat (motivos_no_uso.py).
VARIABLE_IA: Final[str] = "IAG"
VARIABLE_NO_SABE: Final[str] = "IAG_NO3"
VARIABLES: Final = (
    "CCAA",
    ESTRATO,
    "EDAD",
    "OCUPACION",
    "OCUPACION1",
    "OCUPACION2",
    VARIABLE_USO,
    VARIABLE_CONTRASTE,
    VARIABLE_IA,
    "FACTOR_P",
)
# Variables que se leen si están: sin `IAG_NO3` no hay cálculo del motivo y `tic_llars` queda sin contraste.
VARIABLES_OPCIONALES: Final = (VARIABLE_NO_SABE,)
# Grupos que publica el INE (tabla 76444) y la variable del microdato que los define.
GRUPOS_PUBLICADOS: Final[Mapping[str, tuple[str, str, str]]] = {
    "manual": ("OCUPACION1", SI, "Ocupación principal: Manual"),
    "no_manual": ("OCUPACION1", NO, "Ocupación principal: No Manual"),
    "tic": ("OCUPACION2", SI, "Ocupación principal: Trabajadores TIC"),
}
POBLACION_PUBLICADA: Final[str] = "Total Personas"
USO_POR_TRABAJO: Final[str] = "Uso de herramienta de IA generativa: por motivos profesionales (trabajo)"
TOTAL_DEL_GRUPO: Final[str] = "Total"
# El INE publica porcentajes con un decimal: el cálculo los reproduce al decimal.
MARGEN_PORCENTAJE: Final[float] = 0.05
# En el universo de 16 a 74 años, la población de cada grupo publicado es la de la tabla: suma de factores redondeada a
# la persona, con una persona de margen por el redondeo.
MARGEN_POBLACION_PERSONAS: Final[int] = 1
# La EPA codifica en la CNO-11, y su reparto en la ISCO-08 es el que da la correspondencia oficial, el camino de Faro;
# la TIC-H anota la ISCO-08 a 2 cifras en la entrevista. Contraste de la cuota de cada grupo dentro de su gran grupo,
# TIC-H frente a la EPA (Eurostat lfsa_egai2d, 2025): fuera de la mitad al doble, el grupo describe a otra gente que la
# que llega por la correspondencia, y el paso usa algo más amplio:
# - gran grupo 1, entero: la entrevista anota como directores generales (11, ×5,9) a empresarios con asalariados
#   que la correspondencia deja en el 14 (×0,49) o entre los propietarios del gran grupo 5;
# - gran grupo 4, entero: «administrativo» va a oficinistas (41, ×3,1), y la correspondencia lleva el CNO 4500 al 42
#   (×0,30) y los CNO 41xx al 43 (×0,28);
# - 25 y 35, en un bloque: «programador» va al 25 (×1,7), y la correspondencia lleva el CNO 3820 al 35 (×0,33); el
#   bloque cuadra (×1,05 en el total de ocupados).
GRANDES_GRUPOS_ENTEROS: Final = ("1", "4")
BLOQUES: Final[Mapping[str, str]] = {"25": "25+35", "35": "25+35"}
# La regla, con su alarma: un grupo que se da a 2 cifras, y cada bloque en el total de ocupados, tienen en la TIC-H
# entre la mitad y el doble de la cuota que tienen en la EPA.
RAZON_MAXIMA_DE_CUOTA: Final[float] = 2.0
