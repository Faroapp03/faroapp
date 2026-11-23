"""Metadatos, límites y tablas de la fuente censo, definidos junto a su motivo y usados por su cadena."""

from types import MappingProxyType

from plataforma_datos.comun.entrada_salida import carpetas
from plataforma_datos.comun.estadisticas import CITA_INE
from plataforma_datos.comun.estadisticas import PERTURBACION_CENSO_2021 as PERTURBACION
from plataforma_datos.comun.nucleo import ARCHIVO_DE_PROCEDENCIA
from plataforma_datos.mercado.fuentes.ocupados.piezas.constantes_ocupados import REDONDEO_IDESCAT

FUENTE = "censo"
ORIGINAL, PREPARADO, _ = carpetas(FUENTE)
PROCEDENCIA = ORIGINAL / ARCHIVO_DE_PROCEDENCIA
# Lo que escribe preparar y lee validar.
MUNICIPIOS = PREPARADO / "municipios.jsonl"
PERFILES = PREPARADO / "perfiles.jsonl"

API = "https://www.ine.es/Censo2021/api"
DOCUMENTACION = "https://www.ine.es/dyngs/DAB/index.htm?cid=1769"
HOMBRE_CENSO = "Hombre"
MUJER_CENSO = "Mujer"
SEXOS_DE_LA_API = MappingProxyType({HOMBRE_CENSO: "hombres", MUJER_CENSO: "mujeres"})
# La API recibe y entrega JSON, tanto en las consultas de personas como en las de sectores.
CABECERAS_DE_LA_API = {"Accept": "application/json", "Content-Type": "application/json"}
TABLA = "viv.ppal"
METRICA = "SPERSONAS"
FECHA_DE_REFERENCIA = "1 de enero de 2021"
# Cornellà de Llobregat y los municipios que lo rodean, más Barcelona, por su código INE (como los nombra la API).
ENTORNO = ("08073", "08101", "08077", "08217", "08200", "08169", "08019")
CATALUNA = "Cataluña"

# Celdas municipales de 100 personas y perfiles de 1.000: la perturbación individual no supera ±3.
MIN_PERSONAS = 100
MIN_PERSONAS_PERFIL = 1_000
# El Idescat redondea al azar a múltiplos de 3: frente a él, una cifra de la API puede diferir 3 + 2.
CONTRASTE_CON_EL_IDESCAT = PERTURBACION + REDONDEO_IDESCAT
# Los porcentajes de un perfil, redondeados a un decimal, suman 100 con este margen en puntos porcentuales.
MARGEN_SUMA_PORCENTAJES = 0.5

# Agrupaciones de las categorías de la API. Cualquier categoría que no esté aquí detiene la preparación.
ESTUDIOS = {
    "Analfabetos": "hasta_secundaria_obligatoria",
    "Estudios primarios incompletos": "hasta_secundaria_obligatoria",
    "Educación primaria": "hasta_secundaria_obligatoria",
    "Primera etapa de educación secundaria y similar": "hasta_secundaria_obligatoria",
    "Segunda etapa de educación secundaria con orientación general": "bachillerato",
    "Segunda etapa de educación secundaria con orientación profesional": "fp_grado_medio",
    "Educación postsecundaria no superior": "postsecundaria_no_superior",
    "Enseñanzas de formación profesional, artes plásticas y diseño y deportivas de grado superior y equivalentes, "
    "títulos propios universitarios que precisan del título de bachiller, de duración igual o superior a 2 años": (
        "fp_grado_superior"
    ),
    "Grados universitarios de 240 créditos ECTS, diplomados universitarios, títulos propios universitarios de experto "
    "o especialista, y similares": "universitarios",
    "Grados universitarios de más de 240 créditos ECTS, licenciados": "universitarios",
    "Másteres, especialidades en Ciencias de la Salud por el sistema de residencia y similares": "universitarios",
    "Doctorado universitario": "universitarios",
}
SITUACION = {
    "Trabajador por cuenta ajena fijo o indefinido": "indefinido",
    "Trabajador por cuenta ajena temporal": "temporal",
    "Trabajador por cuenta propia que emplea personal": "cuenta_propia",
    "Trabajador por cuenta propia que no emplea personal": "cuenta_propia",
    "Otra situación": "otra",
}
NACIONALIDAD = {"Española": "espanola", "Extranjera": "extranjera"}
PERFIL = {
    "ID_ESREAL_CNEDA": ("estudios", ESTUDIOS),
    "ID_SITU": ("situacion", SITUACION),
    "ID_NACIONALIDAD_N1": ("nacionalidad", NACIONALIDAD),
}
# En cada perfil preparado, junto a las personas de cada categoría, cuántas cifras de la API se sumaron: de ese número
# depende la perturbación admitida. No es una categoría de personas: va aparte de las categorías y no entra en ninguna
# suma ni porcentaje.
CIFRAS_SUMADAS = "cifras_sumadas"
# La respuesta de la API, analizada como JSON: un objeto cuyo «data» es una lista no vacía de filas (objetos).
DATOS_DE_LA_RESPUESTA = "data"
OCUPACION = {"3": "ID_OCU171", "2": "ID_OCU63"}
LUGAR = {"residencia": "ID_RESIDENCIA_N3", "trabajo": "ID_LUGAR_TRAB_N3"}
# Cada original: el archivo donde se guarda, la consulta POST que lo obtiene y su título.
CONSULTAS = [
    {
        "archivo": archivo,
        "nivel": "oficial",
        "titulo": titulo,
        "url": API,
        "cuerpo": {"idioma": "ES", "metrica": [METRICA], "tabla": TABLA, "variables": variables},
    }
    for archivo, variables, titulo in (
        *(
            (
                f"ine-censo2021-{lugar}-ocu{nivel}-sexo.json",
                [variable, OCUPACION[nivel], "ID_SEXO"],
                f"INE, Censo 2021: ocupados por municipio de {lugar}, CNO-11 a {nivel} cifras y sexo",
            )
            for lugar, variable in LUGAR.items()
            for nivel in OCUPACION
        ),
        *(
            (
                f"ine-censo2021-cataluna-ocu{nivel}-{nombre}.json",
                ["ID_RESIDENCIA_N1", OCUPACION[nivel], variable],
                f"INE, Censo 2021: ocupados por comunidad autónoma, CNO-11 a {nivel} cifras y {nombre}",
            )
            for variable, (nombre, _) in PERFIL.items()
            for nivel in OCUPACION
        ),
    )
]
NOMBRE_FUENTE = "INE · Censo de Población 2021 (API): ocupados por municipio y perfil del grupo de ocupación"
CITA = (
    f"{CITA_INE} (Censos de Población y Viviendas 2021, API del Sistema de Difusión de los Censos 2021, tabla "
    f"«{TABLA}», personas ocupadas de 16 y más años; fecha de referencia: {FECHA_DE_REFERENCIA})."
)
NOTA_PERTURBACION = (
    "La API ajusta cada cifra ±3 por confidencialidad y el ajuste cambia en cada consulta: una copia nueva nunca "
    "coincide con la huella de la anterior. Solo se reproduce con la copia archivada."
)
