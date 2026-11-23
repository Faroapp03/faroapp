"""Rutas, reglas, campos, citas y metodología de los ficheros del Observatori vigentes."""

from collections.abc import Mapping
from typing import Final

from plataforma_datos.comun.entrada_salida import carpetas
from plataforma_datos.comun.nucleo import ARCHIVO_DE_PROCEDENCIA
from plataforma_datos.mercado.fuentes.cataluna.piezas.constantes_cataluna import MIN_OCUPACIONES_OBSERVATORI

FUENTE: Final[str] = "observatori"
ORIGINAL, PREPARADO, VALIDADO = carpetas(FUENTE)
PROCEDENCIA: Final = ORIGINAL / ARCHIVO_DE_PROCEDENCIA
# Lo que escribe preparar y lee validar.
CATALUNA_CNO4: Final = PREPARADO / "cataluna-cno4.jsonl"
COMARCAS_CNO4: Final = PREPARADO / "comarcas-cno4.jsonl"
SUMAS_COMARCALES: Final = PREPARADO / "sumas-comarcales.jsonl"
SERIES_CNO4: Final = PREPARADO / "series-cno4.jsonl"
PROVINCIAS_CNO4: Final = PREPARADO / "provincias-cno4.jsonl"
CATALUNA: Final = PREPARADO / "cataluna.json"
METODOLOGIA: Final = PREPARADO / "metodologia.json"
# Lo que preparar lee además de los originales: la provincia de cada comarca (tabla del Idescat, versionada a mano).
TABLA_DE_PROVINCIAS: Final = PREPARADO / "comarca-provincia.json"

# Ventanas esperadas del visor: 13 meses para la serie y 49 para comparar medias móviles interanuales.
MESES_MENSUALES: Final[int] = 13
MESES_DE_VARIACION: Final[int] = 49
VISOR: Final[str] = "https://treballperocupacions.observatoritreball.gencat.cat/treballperocupacions"
PAGINA: Final[str] = "https://observatoritreball.gencat.cat/ca/ambits_tematics/treball/Treball-per-ocupacions/"
FICHEROS: Final[Mapping[str, str]] = {
    "C_P8_IND_COMARQUES": "indicadores por ocupación (CNO-11, 4 cifras) y comarca, 12 meses",
    "C_P5_EVOL_1": (
        f"contratos, personas contratadas y demandantes no ocupados por ocupación, últimos {MESES_MENSUALES} meses"
    ),
    "C_P5_EVOL_2": (
        f"variación interanual de la media móvil de 12 meses de los contratos por ocupación, {MESES_DE_VARIACION} meses"
    ),
    "C_P5_EVOL_3": (
        f"variación interanual de la media móvil de 12 meses de los demandantes no ocupados, {MESES_DE_VARIACION} meses"
    ),
    "C_P2_MES_TOT_CAT": "indicadores del total de Cataluña, 12 meses",
}
TEXTOS_DEL_VISOR: Final[str] = "observatori-visor-textos-cat.json"
# Comarca que lleva el paquete: Baix Llobregat, la de Cornellà, con código de dos cifras del Observatori.
COMARCA_DEL_PAQUETE: Final[str] = "11"
# El Observatori publica unas 480 ocupaciones con indicadores, 502 en las series y 43 comarcas.
# Cobertura mínima de la misma clasificación CNO-11 del visor; cada lector controla su propia captura.
MIN_OCUPACIONES: Final = MIN_OCUPACIONES_OBSERVATORI
COMARCAS_DE_CATALUNA: Final[int] = 43
PROVINCIAS: Final = ("Barcelona", "Girona", "Lleida", "Tarragona")

# Base mínima de cada medida, en personas o contratos según el indicador.
# MIN_SERIE cuenta contratos o demandantes al año.
# Con 1.000 contratos al año, el ruido de una variación interanual es de unos
# 4,5 puntos (√2/√1.000): una serie más pequeña dibujaría ruido.
MIN_BASE: Final[int] = 100
MIN_SERIE: Final[int] = 1000
# Tolerancias de los controles: redondeo de las medias y de las razones que publica el Observatori.
MARGEN_SUMA: Final[float] = 0.5
MARGEN_RAZON: Final[float] = 0.01
# Los preparados guardan las fracciones con 6 decimales: mucha más precisión de la que se enseña (un decimal de %).
DECIMALES_PREPARADO: Final[int] = 6

# Indicadores del visor que se guardan, con su nombre en castellano.
CAMPOS: Final[Mapping[str, str]] = {
    "contratos": "eo_cont_sum_12m",
    "personas_contratadas": "eo_per_cont_com_anual",
    "variacion_personas_contratadas": "eo_per_cont_var_anual",
    "contratos_por_persona": "eo_rot_cont",
    "fraccion_indefinidos": "eo_perc_indef_tot_cont",
    "fraccion_parcial": "eo_perc_parc_tot_cont",
    "fraccion_temporales_hasta_7_dias": "eo_perc_7_cont_temp",
    "duracion_media_temporales_dias": "eo_dur_mitj_cont_temp",
    "demandantes_no_ocupados_media": "eo_dno_mitj",
    "demandantes_no_ocupados_12m": "eo_per_dno_12m_comanual",
    "variacion_demandantes_no_ocupados_12m": "eo_per_dno_var_anual",
    "fraccion_demandantes_larga_duracion_12m": "eo_perc_per_dno_mld",
    "contratadas_por_demandante": "eo_rat_per_cont_dno",
}
# Lo que suma de comarca en comarca (cada contrato y cada demandante tiene una sola comarca); las personas no: una
# persona contratada en dos comarcas cuenta en las dos.
ADITIVOS: Final = ("contratos", "demandantes_no_ocupados_media")

# La metodología del visor: cada definición en que se apoya Faro, por la frase literal que la dice. Si el Observatori
# la cambia, la validación lo avisa.
DEFINICIONES: Final[Mapping[str, str]] = {
    "personas_contratadas": "nombre de persones distintes que han signat algun contracte durant el període",
    "contratos_por_persona": "quocient entre el nombre de contractes registrats durant el període i el nombre de "
    "persones distintes contractades",
    "ocupacion_del_contrato": "El contracte inclou l’ocupació en què la persona treballadora desenvolupa la seva feina",
    "fraccion_parcial": "pes dels contractes a jornada parcial sobre la contractació total",
    "duracion_media_temporales_dias": "mitjana de la durada dels contractes de durada determinada, en dies",
    "seis_ocupaciones": "Cada demandant d’ocupació declara un mínim d’una i un màxim de sis ocupacions en les quals "
    "demanda treballar",
    "una_vez_en_cada_ocupacion": "La demanda d’una persona es comptabilitza una vegada en cadascuna de les ocupacions",
    "demandantes_no_ocupados_12m": "persones distintes que han estat trobades en situació de DONO en algun dels dotze "
    "mesos de l’any",
    "dono": "aproximar la definició d’atur mesurat amb la metodologia de l’Enquesta de població activa",
}
# Ruta de claves desde la raíz del fichero de textos del visor hasta el contenido metodológico.
CLAVE_DE_LA_METODOLOGIA: Final = ("metodologia_i_taules_de_detall", "metodologia")
# El contrato indefinido se mide de dos formas, con dos periodos: cada una con su rótulo (el del censo, de enero de
# 2021, es anterior a la reforma laboral de 2022, que cambió la contratación temporal).
ROTULO_CENSO: Final[Mapping[str, str]] = {
    "es": "enero de 2021, antes de la reforma laboral",
    "ca": "gener de 2021, abans de la reforma laboral",
}

# Rige el aviso del propio visor, más específico que el general de la Generalitat: lo lleva el pie de cada página
# («Avís legal») y viaja en el fichero de textos que se guarda con su huella. Los ficheros de datos no declaran ninguna
# licencia propia. Si un documento concreto del Observatori (un informe en PDF) declara otra, rige ese documento.
LICENCIA_TEXTO: Final[str] = (
    "Avís legal: D'acord amb l'article 17.1 de la Llei 19/2014, la ©Generalitat de Catalunya permet la reutilització "
    "dels continguts i de les dades sempre que se'n citi la font i la data d'actualització i que no es desnaturalitzi "
    "la informació (article 8 de la Llei 37/2007) i també que no es contradigui amb una llicència específica."
)
LICENCIA: Final[str] = (
    "Aviso legal del propio visor «Treball per ocupacions» (pie de la página, texto global.pie.texto de "
    "assets/i18n/cat.json; consultado el 07/10/2026): reutilización de los contenidos y los datos citando la fuente y "
    "la fecha de actualización, sin desnaturalizar la información (art. 17.1 de la Ley 19/2014 y art. 8 de la Ley "
    "37/2007); los ficheros de datos no declaran licencia específica. Es el régimen de la Llicència oberta d'ús "
    "d'informació – Catalunya del aviso legal de la Generalitat (https://tramits.gencat.cat/ca/ajuda/avis_legal/)."
)
NOMBRE_FUENTE: Final[str] = (
    "Observatori del Treball i Model Productiu · Treball per ocupacions: comarcas, series y demanda"
)
NOTA_RUTA: Final[str] = (
    "Ficheros que carga el visor «Treball per ocupacions»; no es una API documentada y la ruta puede cambiar. El "
    "subdominio del visor no publica robots.txt (404 el 06/10/2026); el portal del Observatori, que sí lo publica y "
    "prohíbe la lectura automática, no se consulta."
)
CALENDARIO: Final[str] = (
    "El Observatori no publica calendario de publicación. Faro consulta su visor cada semana e incorpora el periodo "
    "nuevo cuando lo ve publicado."
)
