"""Catálogo de los indicadores de `datos-globales.json`: nombre, definición, fuente, licencia y comparabilidad.

Una sola fuente de verdad para lo que se dice de cada indicador. Las fuentes que los preparan
(`ia_y_trabajo/fuentes/mundo_eurostat/lector.py`, `mercado/fuentes/ilostat/lector.py`) y la que compone el archivo
(`derivados/fuentes/datos_globales/lector.py`) leen de aquí sus identificadores, sus tablas y sus licencias. Los nombres
y definiciones van en castellano y en catalán, escritos por Equipo Faro a partir de la definición oficial de cada código
(su etiqueta literal se guarda en la preparación y se vigila en la validación). Python estándar.
"""

from collections.abc import Mapping
from types import MappingProxyType
from typing import Final, NamedTuple

from plataforma_datos.comun.estadisticas import API_EUROSTAT, LICENCIA_EUROSTAT, LICENCIA_IDESCAT
from plataforma_datos.comun.nucleo import exigir

# ---------------------------------------------------------------------------------------------------------------------
# Forma del archivo (CONTRATO: versión 1)
# ---------------------------------------------------------------------------------------------------------------------

VERSION_DEL_CONTRATO: Final[str] = "1"
MEDIDO: Final[str] = "medido"
ESTIMADO: Final[str] = "estimado"
# Una cuenta ponderada de Faro sobre los microdatos de una encuesta oficial, con su intervalo: ni la mide una
# estadística oficial ni la estima un modelo. Va en el bloque `calculados`, nunca entre los indicadores.
CALCULADO: Final[str] = "calculado"
# Cómo se obtuvo el intervalo de confianza del 95 % de una cifra calculada: una clave cerrada que la web traduce.
_METODOS_DEL_INTERVALO: Final = {
    "replicas_bootstrap": "con los pesos replicados bootstrap de la encuesta: Σ (θ_r − θ)² / (R − 1)",
    "linealizacion_taylor": "linealización de Taylor del cociente con los estratos y conglomerados del diseño",
    "linealizacion_taylor_aproximada": "linealización de Taylor sin las unidades primarias de muestreo del diseño, que "
    "los microdatos públicos no traen: aproximado, infravalora el efecto del diseño",
}
METODOS_DEL_INTERVALO: Mapping[str, str] = MappingProxyType(_METODOS_DEL_INTERVALO)
# Por qué una cifra calculada solo tiene cotas (sin supuestos): una parte del empleo está en subgrupos de la
# clasificación del país sin correspondencia a 4 dígitos con ISCO-08 y las cotas no coinciden.
MOTIVO_SIN_CORRESPONDENCIA: Final[str] = "sin_correspondencia_4_digitos"
MOTIVOS_DE_LAS_COTAS: Final = (MOTIVO_SIN_CORRESPONDENCIA,)
COBERTURA_UE: Final[str] = "ue"
COBERTURA_MUNDO: Final[str] = "mundo"
# Solo Cataluña: indicadores de una fuente catalana sin equivalente en otros territorios; nunca se comparan.
COBERTURA_CATALUNA: Final[str] = "cataluna"
PAIS: Final[str] = "pais"
REGION: Final[str] = "region"
AGREGADO: Final[str] = "agregado"
UNIDAD_PORCENTAJE: Final[str] = "porcentaje"
UNIDAD_DEL_RECUENTO: Final[str] = "miles de personas"
# Las encuestas de opinión: lo que la gente opina, nunca una medida; no van entre los indicadores.
NATURALEZA_OPINION: Final[str] = "opinion"
CATALUNA: Final[str] = "ES51"
UE27: Final[str] = "EU27_2020"
NOTA_DEFINICION_ANTERIOR: Final[str] = "definicion_anterior"
NOTA_POCO_FIABLE: Final[str] = "poco_fiable"
# Lo que puede decir la nota de una cifra: una marca de su fuente, en una clave cerrada que la web traduce. Una cifra
# confidencial no llega (no tiene valor); una poco fiable llega con su nota y no se da como firme.
_NOTAS: Final = {
    "ruptura_de_serie": "la fuente marca una ruptura de serie («b» en Eurostat, «B» en ILOSTAT)",
    "provisional": "cifra provisional («p»)",
    "estimada": "la fuente la marca como estimada («e»)",
    "definicion_distinta": "la definición se aparta de la común en ese territorio («d»)",
    NOTA_POCO_FIABLE: "muestra pequeña: la fuente la marca como poco fiable («u» en Eurostat, «U» en ILOSTAT)",
    NOTA_DEFINICION_ANTERIOR: "medida con una definición anterior del indicador (las empresas con IA de 2021: la "
    "encuesta preguntaba por menos tecnologías de IA); no es del todo comparable con los años siguientes",
}
NOTAS: Mapping[str, str] = MappingProxyType(_NOTAS)
# Qué nota lleva una cifra calculada con varias: la poco fiable gana (no se da como firme); entre las demás, el orden
# alfabético, que no depende del orden en que lleguen.
PRIORIDAD_DE_NOTAS: Final = (NOTA_POCO_FIABLE, *sorted(set(NOTAS) - {NOTA_POCO_FIABLE}))
# De la marca de Eurostat (guía de difusión; MARCAS_EUROSTAT en constantes_empresas.py) y de ILOSTAT (`obs_status`) a
# la nota. Cada marca de Eurostat está en una de tres listas: con nota, sin cifra o sin nota. Una previsión («f») y una
# estimación de Eurostat («s») son estimadas; una cifra no significativa («n») no se da como firme. «c» (confidencial)
# y «z» (no aplicable) no llegan: no traen cifra. Una cifra revisada («r») es la definitiva: no lleva nota.
_NOTA_DE_LA_MARCA: Final = {
    "b": "ruptura_de_serie",
    "p": "provisional",
    "e": "estimada",
    "f": "estimada",
    "s": "estimada",
    "d": "definicion_distinta",
    "u": "poco_fiable",
    "n": "poco_fiable",
    "B": "ruptura_de_serie",
    "U": "poco_fiable",
}
NOTA_DE_LA_MARCA: Mapping[str, str] = MappingProxyType(_NOTA_DE_LA_MARCA)
SIN_CIFRA: Final = ("c", "z")
MARCAS_SIN_NOTA: Final = ("r",)

# ---------------------------------------------------------------------------------------------------------------------
# Fuentes: licencia, cita y dirección
# ---------------------------------------------------------------------------------------------------------------------

# La API de Eurostat de la que se piden los indicadores (definida en estadisticas.py).
EUROSTAT_DATOS: Final = API_EUROSTAT
LICENCIA_ILOSTAT: Final[str] = (
    "Política de acceso abierto de la OIT (https://www.ilo.org/es/derechos-y-autorizaciones; su captura es un original "
    "de la fuente `oit`): desde el 3/5/2023, los materiales publicados o puestos a disposición por la OIT, bases de "
    "datos incluidas, se reutilizan con la licencia CC BY 4.0, citando a la OIT e indicando los cambios. Faro no "
    "traduce sus cifras: calcula porcentajes sobre ellas y lo dice."
)
ILOSTAT_DATASET: Final[str] = "EMP_TEMP_SEX_OCU_NB_A"
CITA_ILOSTAT: Final[str] = (
    f"Organización Internacional del Trabajo, ILOSTAT, indicador {ILOSTAT_DATASET} (empleo por sexo y ocupación, "
    "anual), solo encuestas de fuerza de trabajo; porcentajes calculados por Faro."
)
URL_ILOSTAT: Final[str] = f"https://rplumber.ilo.org/data/indicator/?id={ILOSTAT_DATASET}"

# ---------------------------------------------------------------------------------------------------------------------
# Indicadores
# ---------------------------------------------------------------------------------------------------------------------

# Los grandes grupos de la ISCO-08 por los que ILOSTAT da el empleo. Sus nombres oficiales salen de las fuentes que ya
# los validan: la CIUO-08 en español (`clasificaciones`) y la CIUO-2008 (ca) del Idescat (`idescat`).
GRANDES_GRUPOS: Final = ("1", "2", "3", "4", "5", "6", "7", "8", "9", "0")


def _texto(es: str, ca: str) -> dict[str, str]:
    """Un texto en castellano y en catalán, como lo pide el contrato.

    Returns:
        El texto por idioma, `{"es": …, "ca": …}`.
    """
    return {"es": es, "ca": ca}


def _eurostat(tabla: str) -> dict[str, str]:
    """La fuente, la tabla, la licencia y la dirección de un indicador de Eurostat (DOI del conjunto).

    Returns:
        La fuente, la tabla, la licencia y el DOI del conjunto.
    """
    return {
        "fuente": "Eurostat",
        "tabla": tabla,
        "licencia": LICENCIA_EUROSTAT,
        "url": f"https://doi.org/10.2908/{tabla.upper()}",
    }


# La metodología de la Enquesta TIC a les llars 2025 del Idescat, que define su ocupación principal.
_METODOLOGIA_TIC_LLARS: Final[str] = "https://www.idescat.cat/pub/?id=ticll25&m=m"
# Los indicadores de IA generativa que el Idescat da para Cataluña en la base de los usuarios de internet, con su
# tabla. Por ocupación, su metodología define «treballador manual» como los grandes grupos 6 a 9 de la CNO-94 y «no
# manual» como los grupos 0 y 1 a 5: la misma división que ISCO6_9 e ISCO0_5 de Eurostat, así que son las cifras de
# Cataluña de esos indicadores. Su «treballador TIC» no (INDICADORES_DE_CATALUNA).
_CON_CATALUNA_DEL_IDESCAT: Final = {
    "personas-ia-generativa": "ticll25, taula 3.4.1",
    "personas-ia-generativa-trabajo": "ticll25, taula 3.4.1",
    "mujeres-ia-generativa": "ticll25, taula 3.4.1",
    "hombres-ia-generativa": "ticll25, taula 3.4.1",
    "mujeres-ia-generativa-trabajo": "ticll25, taula 3.4.1",
    "hombres-ia-generativa-trabajo": "ticll25, taula 3.4.1",
    "ia-generativa-trabajo-no-manual": "ticll25, taula 3.4.1, per ocupació",
    "ia-generativa-trabajo-manual": "ticll25, taula 3.4.1, per ocupació",
}
CON_CATALUNA_DEL_IDESCAT: Mapping[str, str] = MappingProxyType(_CON_CATALUNA_DEL_IDESCAT)
# Cómo clasifica el Idescat la ocupación de los indicadores por clase de ocupación, citando su metodología.
_CLASE_DEL_IDESCAT: Final = {
    "ia-generativa-trabajo-no-manual": (
        "En Cataluña, «treballador no manual» del Idescat: grandes grupos 0 y 1 a 5 de la CNO-94, la misma división "
        f"según la metodología de su encuesta ({_METODOLOGIA_TIC_LLARS}).",
        "A Catalunya, «treballador no manual» de l'Idescat: grans grups 0 i 1 a 5 de la CNO-94, la mateixa divisió "
        f"segons la metodologia de la seva enquesta ({_METODOLOGIA_TIC_LLARS}).",
    ),
    "ia-generativa-trabajo-manual": (
        f"En Cataluña, «treballador manual» del Idescat: grandes grupos 6 a 9 de la CNO-94, la misma división según la "
        f"metodología de su encuesta ({_METODOLOGIA_TIC_LLARS}).",
        f"A Catalunya, «treballador manual» de l'Idescat: grans grups 6 a 9 de la CNO-94, la mateixa divisió segons la "
        f"metodologia de la seva enquesta ({_METODOLOGIA_TIC_LLARS}).",
    ),
}


def _de_la_ia_generativa(id_: str, nombre: tuple[str, str], definicion: tuple[str, str]) -> dict[str, object]:
    """Un indicador de `isoc_ai_iaiu`: personas de 16 a 74 años, Europa, misma encuesta en todos los países.

    Returns:
        El indicador con su nombre, definición, unidad, fuente y cobertura.
    """
    return {
        "id": id_,
        "nombre": _texto(*nombre),
        "definicion": _texto(*definicion),
        "unidad": UNIDAD_PORCENTAJE,
        "naturaleza": MEDIDO,
        **_eurostat("isoc_ai_iaiu"),
        "comparable": True,
        "cobertura": COBERTURA_UE,
    }


def _de_la_ia_generativa_en_internautas(
    id_: str, nombre: tuple[str, str], definicion: tuple[str, str]
) -> dict[str, object]:
    """El mismo indicador con base en quienes usaron internet en los tres meses anteriores (`PC_IND_IU3`).

    Es la base de las tablas del Idescat: su identificador lleva «-usuarios-internet» y las dos bases no se mezclan
    nunca. En esa base, Cataluña sale del Idescat (su tabulación de la TIC-H del INE, la misma encuesta).

    Returns:
        El indicador en la base de usuarios de internet, con la tabla de Cataluña del Idescat si la tiene.
    """
    tabla_de_cataluna = CON_CATALUNA_DEL_IDESCAT.get(id_)
    definicion_es = f"{definicion[0]} Base: personas que usaron internet en los tres meses anteriores."
    definicion_ca = f"{definicion[1]} Base: persones que van fer servir internet en els tres mesos anteriors."
    if id_ in _CLASE_DEL_IDESCAT:
        definicion_es += f" {_CLASE_DEL_IDESCAT[id_][0]}"
        definicion_ca += f" {_CLASE_DEL_IDESCAT[id_][1]}"
    return {
        **_de_la_ia_generativa(id_, nombre, definicion),
        "id": f"{id_}-usuarios-internet",
        "nombre": _texto(f"{nombre[0]} (usuarios de internet)", f"{nombre[1]} (usuaris d'internet)"),
        "definicion": _texto(definicion_es, definicion_ca),
        "fuente": "Eurostat; Cataluña: Idescat, a partir de la TIC-H del INE" if tabla_de_cataluna else "Eurostat",
        "tabla": "isoc_ai_iaiu (PC_IND_IU3)" + (f"; Cataluña: {tabla_de_cataluna}" if tabla_de_cataluna else ""),
    }


def _definicion_de_ia(quien_es: str, de_quien_ca: str, *, trabajo: bool) -> tuple[str, str]:
    """Define la misma pregunta por sexo y finalidad, conservando las dos redacciones del catálogo.

    Args:
        quien_es: El grupo de personas en castellano.
        de_quien_ca: El grupo con la preposición catalana completa, incluida la elisión («d'homes»).
        trabajo: Si la pregunta se limita al uso por motivos profesionales.

    Returns:
        La definición en castellano y en catalán, sin cambiar población, periodo ni finalidad.
    """
    finalidad_es = " por motivos de trabajo" if trabajo else ""
    finalidad_ca = " per motius de feina" if trabajo else ""
    return (
        f"Porcentaje de {quien_es} de 16 a 74 años que usaron alguna herramienta de IA generativa{finalidad_es} "
        "en los tres meses anteriores a la encuesta.",
        f"Percentatge {de_quien_ca} de 16 a 74 anys que van fer servir alguna eina d'IA generativa{finalidad_ca} "
        "en els tres mesos anteriors a l'enquesta.",
    )


# Los indicadores de IA generativa por personas: identificador, nombre y definición (castellano y catalán).
IA_GENERATIVA: tuple[tuple[str, tuple[str, str], tuple[str, str]], ...] = (
    (
        "personas-ia-generativa",
        ("Personas que usan IA generativa", "Persones que fan servir IA generativa"),
        _definicion_de_ia("personas", "de persones", trabajo=False),
    ),
    (
        "personas-ia-generativa-trabajo",
        ("Personas que usan IA generativa para trabajar", "Persones que fan servir IA generativa per treballar"),
        _definicion_de_ia("personas", "de persones", trabajo=True),
    ),
    (
        "mujeres-ia-generativa",
        ("Mujeres que usan IA generativa", "Dones que fan servir IA generativa"),
        _definicion_de_ia("mujeres", "de dones", trabajo=False),
    ),
    (
        "hombres-ia-generativa",
        ("Hombres que usan IA generativa", "Homes que fan servir IA generativa"),
        _definicion_de_ia("hombres", "d'homes", trabajo=False),
    ),
    (
        "mujeres-ia-generativa-trabajo",
        ("Mujeres que usan IA generativa para trabajar", "Dones que fan servir IA generativa per treballar"),
        _definicion_de_ia("mujeres", "de dones", trabajo=True),
    ),
    (
        "hombres-ia-generativa-trabajo",
        ("Hombres que usan IA generativa para trabajar", "Homes que fan servir IA generativa per treballar"),
        _definicion_de_ia("hombres", "d'homes", trabajo=True),
    ),
    (
        "ia-generativa-trabajo-no-manual",
        (
            "IA generativa para trabajar en ocupaciones no manuales",
            "IA generativa per treballar en ocupacions no manuals",
        ),
        (
            "Porcentaje de personas ocupadas en ocupaciones no manuales (grandes grupos 0 a 5 de la ISCO-08) que "
            "usaron IA generativa por motivos de trabajo en los tres meses anteriores a la encuesta.",
            "Percentatge de persones ocupades en ocupacions no manuals (grans grups 0 a 5 de la ISCO-08) que van fer "
            "servir IA generativa per motius de feina en els tres mesos anteriors a l'enquesta.",
        ),
    ),
    (
        "ia-generativa-trabajo-manual",
        ("IA generativa para trabajar en ocupaciones manuales", "IA generativa per treballar en ocupacions manuals"),
        (
            "Porcentaje de personas ocupadas en ocupaciones manuales (grandes grupos 6 a 9 de la ISCO-08) que usaron "
            "IA generativa por motivos de trabajo en los tres meses anteriores a la encuesta.",
            "Percentatge de persones ocupades en ocupacions manuals (grans grups 6 a 9 de la ISCO-08) que van fer "
            "servir IA generativa per motius de feina en els tres mesos anteriors a l'enquesta.",
        ),
    ),
    (
        "ia-generativa-trabajo-tic",
        ("IA generativa para trabajar entre profesionales TIC", "IA generativa per treballar entre professionals TIC"),
        (
            "Porcentaje de profesionales de las tecnologías de la información y la comunicación que usaron IA "
            "generativa por motivos de trabajo en los tres meses anteriores a la encuesta.",
            "Percentatge de professionals de les tecnologies de la informació i la comunicació que van fer servir IA "
            "generativa per motius de feina en els tres mesos anteriors a l'enquesta.",
        ),
    ),
)
# Los indicadores conservan diccionarios JSON para composición y serialización; los lectores no deben mutarlos.
INDICADORES_EUROSTAT: Final[tuple[Mapping[str, object], ...]] = (
    {
        "id": "empresas-ia",
        "nombre": _texto("Empresas que usan IA", "Empreses que fan servir IA"),
        "definicion": _texto(
            "Porcentaje de empresas de 10 o más personas que usan al menos una de las ocho tecnologías de inteligencia "
            "artificial de la encuesta europea (análisis de texto, voz, generación de lenguaje o código, imagen, "
            "aprendizaje automático, automatización de procesos, robots autónomos o generación de imagen, vídeo o "
            "audio). Sin agricultura, minería ni sector financiero. La cifra de 2021 se midió con una lista más corta "
            "de tecnologías y no es del todo comparable con las siguientes.",
            "Percentatge d'empreses de 10 o més persones que fan servir almenys una de les vuit tecnologies "
            "d'intel·ligència artificial de l'enquesta europea (anàlisi de text, veu, generació de llenguatge o codi, "
            "imatge, aprenentatge automàtic, automatització de processos, robots autònoms o generació d'imatge, vídeo "
            "o àudio). Sense agricultura, mineria ni sector financer. La xifra de 2021 es va mesurar amb una llista "
            "més curta de tecnologies i no és del tot comparable amb les següents.",
        ),
        "unidad": UNIDAD_PORCENTAJE,
        "naturaleza": MEDIDO,
        **_eurostat("isoc_eb_ai"),
        "comparable": True,
        "cobertura": COBERTURA_UE,
    },
    *(_de_la_ia_generativa(*espec) for espec in IA_GENERATIVA),
    *(_de_la_ia_generativa_en_internautas(*espec) for espec in IA_GENERATIVA),
    *(
        {
            "id": f"formacion-adultos{sufijo}",
            "nombre": _texto(f"{quien_es} de 25 a 64 años en formación", f"{quien_ca} de 25 a 64 anys en formació"),
            "definicion": _texto(
                f"Porcentaje de {quien_es.lower()} de 25 a 64 años que siguieron alguna actividad de educación o "
                "formación (reglada o no) en las cuatro semanas anteriores a la encuesta de población activa.",
                f"Percentatge {de_quien_ca} de 25 a 64 anys que van seguir alguna activitat d'educació o "
                "formació (reglada o no) en les quatre setmanes anteriors a l'enquesta de població activa.",
            ),
            "unidad": UNIDAD_PORCENTAJE,
            "naturaleza": MEDIDO,
            **_eurostat("trng_lfse_04"),
            "comparable": True,
            "cobertura": COBERTURA_UE,
        }
        # El catalán elide «de» ante vocal o hache: «d'homes»; cada forma se escribe entera.
        for sufijo, quien_es, quien_ca, de_quien_ca in (
            ("", "Personas", "Persones", "de persones"),
            ("-mujeres", "Mujeres", "Dones", "de dones"),
            ("-hombres", "Hombres", "Homes", "d'homes"),
        )
    ),
)


def _de_ilostat(id_: str, nombre: tuple[str, str], definicion: tuple[str, str]) -> dict[str, object]:
    """Un indicador de ILOSTAT: armonizado por la OIT en ISCO-08 desde las encuestas nacionales, todo el mundo.

    Returns:
        El indicador con su nombre, definición, unidad, fuente y cobertura mundial.
    """
    return {
        "id": id_,
        "nombre": _texto(*nombre),
        "definicion": _texto(*definicion),
        "unidad": UNIDAD_PORCENTAJE,
        "naturaleza": MEDIDO,
        "fuente": "OIT (ILOSTAT)",
        "tabla": ILOSTAT_DATASET,
        "licencia": LICENCIA_ILOSTAT,
        "url": URL_ILOSTAT,
        "comparable": True,
        "cobertura": COBERTURA_MUNDO,
    }


def indicador_de_empleo(grupo: str, nombre_es: str, nombre_ca: str) -> dict[str, object]:
    """El peso de un gran grupo ISCO-08 en el empleo total de un territorio, con el nombre oficial del grupo.

    Returns:
        El indicador del peso del grupo en el empleo.
    """
    return _de_ilostat(
        f"empleo-isco-{grupo}",
        (f"Empleo en el gran grupo {grupo}: {nombre_es}", f"Ocupació al gran grup {grupo}: {nombre_ca}"),
        (
            f"Porcentaje de las personas ocupadas que trabajan en el gran grupo {grupo} de la ISCO-08, según la "
            "encuesta de fuerza de trabajo del país, el último año que publica ILOSTAT.",
            f"Percentatge de les persones ocupades que treballen al gran grup {grupo} de la ISCO-08, segons "
            "l'enquesta de població activa del país, l'últim any que publica ILOSTAT.",
        ),
    )


def indicador_de_mujeres(grupo: str, nombre_es: str, nombre_ca: str) -> dict[str, object]:
    """La parte de mujeres entre las personas ocupadas de un gran grupo ISCO-08, con el nombre oficial del grupo.

    Returns:
        El indicador de la parte de mujeres en el grupo.
    """
    return _de_ilostat(
        f"mujeres-isco-{grupo}",
        (f"Mujeres en el gran grupo {grupo}: {nombre_es}", f"Dones al gran grup {grupo}: {nombre_ca}"),
        (
            f"Porcentaje de mujeres entre las personas ocupadas del gran grupo {grupo} de la ISCO-08, según la "
            "encuesta de fuerza de trabajo del país, el último año que publica ILOSTAT.",
            f"Percentatge de dones entre les persones ocupades del gran grup {grupo} de la ISCO-08, segons "
            "l'enquesta de població activa del país, l'últim any que publica ILOSTAT.",
        ),
    )


def _de_cataluna_del_idescat(
    id_: str, nombre: tuple[str, str], definicion: tuple[str, str], tabla: str, url: str
) -> dict[str, object]:
    """Un indicador del Idescat que solo existe para Cataluña: medido, en %, y nunca se compara.

    Returns:
        El indicador, solo de Cataluña y no comparable.
    """
    return {
        "id": id_,
        "nombre": _texto(*nombre),
        "definicion": _texto(*definicion),
        "unidad": UNIDAD_PORCENTAJE,
        "naturaleza": MEDIDO,
        "fuente": "Idescat",
        "tabla": tabla,
        "licencia": LICENCIA_IDESCAT,
        "url": url,
        "comparable": False,
        "cobertura": COBERTURA_CATALUNA,
    }


def _del_clima_empresarial(
    id_: str, tabla: str, nombre: tuple[str, str], definicion: tuple[str, str]
) -> dict[str, object]:
    """Un indicador del módulo de actualidad de la Enquesta de clima empresarial (Idescat): solo Cataluña.

    Returns:
        El indicador del módulo de actualidad, solo de Cataluña.
    """
    return _de_cataluna_del_idescat(
        id_=id_,
        nombre=nombre,
        definicion=definicion,
        tabla=f"Enquesta de clima empresarial, mòdul d'actualitat, taula {tabla}",
        url=f"https://www.idescat.cat/pub/?id=clem&n={tabla}",
    )


_TABLA_IA_CLIMA: Final[str] = "18149"
_TRIMESTRE_IA_ES: Final[str] = "2.º trimestre de 2024"
_TRIMESTRE_IA_CA: Final[str] = "2n trimestre del 2024"


def _quien_usa_la_ia(id_: str, quien: tuple[str, str]) -> dict[str, object]:
    """Los establecimientos de Cataluña en que usa la IA un tipo de trabajador (2.º trimestre de 2024).

    Returns:
        El indicador de los establecimientos en que usa la IA ese tipo de trabajador.
    """
    return _del_clima_empresarial(
        id_=id_,
        tabla="18162",
        nombre=(f"Establecimientos donde usan IA {quien[0]}", f"Establiments on fan servir IA {quien[1]}"),
        definicion=(
            "Porcentaje de los establecimientos de Cataluña en que usan tecnologías de inteligencia artificial "
            f"{quien[0]} ({_TRIMESTRE_IA_ES}).",
            "Percentatge dels establiments de Catalunya en què fan servir tecnologies d'intel·ligència artificial "
            f"{quien[1]} ({_TRIMESTRE_IA_CA}).",
        ),
    )


def _por_ocupacion_del_idescat(
    id_: str, tabla: str, nombre: tuple[str, str], definicion: tuple[str, str]
) -> dict[str, object]:
    """Un indicador de la TIC a les llars por ocupación principal que solo existe para Cataluña; la definición lo dice.

    Su `definicion` ya lleva cómo clasifica el Idescat esa ocupación (_CLASE_SOLO_DE_CATALUNA).

    Returns:
        El indicador por ocupación principal, solo de Cataluña.
    """
    return _de_cataluna_del_idescat(
        id_=id_,
        nombre=nombre,
        definicion=definicion,
        tabla=f"Enquesta sobre equipament i ús de TIC a les llars 2025 (ticll25), taula {tabla}, per ocupació",
        url=f"https://www.idescat.cat/pub/?id=ticll25&n={tabla}",
    )


def _trabajo_por_ocupacion(id_: str, quien: tuple[str, str], clase: tuple[str, str]) -> dict[str, object]:
    """El uso de la IA generativa para trabajar entre las personas de una ocupación (clasificación del Idescat).

    Returns:
        El indicador de uso de la IA generativa para trabajar en esa ocupación.
    """
    return _por_ocupacion_del_idescat(
        id_=id_,
        tabla="3.4.1",
        nombre=(f"IA generativa para trabajar: {quien[0]}", f"IA generativa per treballar: {quien[1]}"),
        definicion=(
            f"Porcentaje de {quien[0]} de 16 a 74 años que usaron internet y usaron IA generativa por motivos de "
            f"trabajo en los tres meses anteriores (Cataluña, 2025). {clase[0]}",
            f"Percentatge de {quien[1]} de 16 a 74 anys que van fer servir internet i van fer servir IA generativa "
            f"per motius de feina en els tres mesos anteriors (Catalunya, 2025). {clase[1]}",
        ),
    )


def _no_sabe_por_ocupacion(id_: str, quien: tuple[str, str], clase: tuple[str, str]) -> dict[str, object]:
    """Quienes no usan la IA generativa porque no saben cómo, entre las personas de una ocupación (Idescat).

    Returns:
        El indicador de quienes no la usan porque no saben cómo, en esa ocupación.
    """
    return _por_ocupacion_del_idescat(
        id_=id_,
        tabla="3.4.2",
        nombre=(f"No la usan porque no saben cómo: {quien[0]}", f"No la fan servir perquè no en saben: {quien[1]}"),
        definicion=(
            f"Porcentaje de {quien[0]} de 16 a 74 años que usaron internet y no usaron IA generativa en los tres "
            f"meses anteriores que dan como motivo que no saben cómo usarla (Cataluña, 2025). {clase[0]}",
            f"Percentatge de {quien[1]} de 16 a 74 anys que van fer servir internet i no van fer servir IA "
            "generativa en els tres mesos anteriors que donen com a motiu que no saben com fer-la servir "
            f"(Catalunya, 2025). {clase[1]}",
        ),
    )


_MANUALES: Final = ("trabajadores manuales", "treballadors manuals")
_NO_MANUALES: Final = ("trabajadores no manuales", "treballadors no manuals")
_TIC: Final = ("trabajadores TIC", "treballadors TIC")
# Cómo clasifica el Idescat la ocupación de lo que solo existe para Cataluña, según la metodología de su encuesta.
# Manual y no manual son la división de Eurostat (_CLASE_DEL_IDESCAT), pero Eurostat no está en este archivo con el
# motivo «no sabe cómo»; «treballador TIC» es una lista propia del Idescat, que no es la de Eurostat.
_CLASE_SOLO_DE_CATALUNA: Final = {
    "manual": (
        f"«Treballador manual» del Idescat: grandes grupos 6 a 9 de la CNO-94 ({_METODOLOGIA_TIC_LLARS}), la división "
        "de Eurostat (ISCO 6 a 9); el archivo no trae este motivo de Eurostat.",
        f"«Treballador manual» de l'Idescat: grans grups 6 a 9 de la CNO-94 ({_METODOLOGIA_TIC_LLARS}), la divisió "
        "d'Eurostat (ISCO 6 a 9); el fitxer no porta aquest motiu d'Eurostat.",
    ),
    "no_manual": (
        f"«Treballador no manual» del Idescat: grandes grupos 0 y 1 a 5 de la CNO-94 ({_METODOLOGIA_TIC_LLARS}), la "
        "división de Eurostat (ISCO 0 a 5); el archivo no trae este motivo de Eurostat.",
        f"«Treballador no manual» de l'Idescat: grans grups 0 i 1 a 5 de la CNO-94 ({_METODOLOGIA_TIC_LLARS}), la "
        "divisió d'Eurostat (ISCO 0 a 5); el fitxer no porta aquest motiu d'Eurostat.",
    ),
    "tic": (
        "«Treballador TIC» del Idescat: los trabajadores no manuales de una lista propia de grupos primarios de la "
        f"CNO-94 ({_METODOLOGIA_TIC_LLARS}), que no es la de los profesionales TIC de Eurostat: no se compara.",
        "«Treballador TIC» de l'Idescat: els treballadors no manuals d'una llista pròpia de grups primaris de la "
        f"CNO-94 ({_METODOLOGIA_TIC_LLARS}), que no és la dels professionals TIC d'Eurostat: no es compara.",
    ),
}
INDICADORES_DE_CATALUNA: Final[tuple[Mapping[str, object], ...]] = (
    _trabajo_por_ocupacion("ia-generativa-trabajo-trabajador-tic", _TIC, _CLASE_SOLO_DE_CATALUNA["tic"]),
    _no_sabe_por_ocupacion(
        "ia-generativa-no-sabe-usarla-trabajador-manual", _MANUALES, _CLASE_SOLO_DE_CATALUNA["manual"]
    ),
    _no_sabe_por_ocupacion(
        "ia-generativa-no-sabe-usarla-trabajador-no-manual", _NO_MANUALES, _CLASE_SOLO_DE_CATALUNA["no_manual"]
    ),
    _de_cataluna_del_idescat(
        id_="ia-generativa-no-sabe-usarla",
        nombre=("Personas que no la usan porque no saben cómo", "Persones que no la fan servir perquè no en saben"),
        definicion=(
            "Porcentaje de las personas de 16 a 74 años que usaron internet y no usaron IA generativa en los tres "
            "meses anteriores que dan como motivo que no saben cómo usarla (2025).",
            "Percentatge de les persones de 16 a 74 anys que van fer servir internet i no van fer servir IA "
            "generativa en els tres mesos anteriors que donen com a motiu que no saben com fer-la servir (2025).",
        ),
        tabla="Enquesta sobre equipament i ús de TIC a les llars 2025 (ticll25), taula 3.4.2",
        url="https://www.idescat.cat/pub/?id=ticll25&n=3.4.2",
    ),
    _del_clima_empresarial(
        id_="establecimientos-ia",
        tabla=_TABLA_IA_CLIMA,
        nombre=("Establecimientos que usan IA", "Establiments que fan servir IA"),
        definicion=(
            "Porcentaje de los establecimientos de Cataluña que usan alguna tecnología de inteligencia artificial "
            f"({_TRIMESTRE_IA_ES}).",
            "Percentatge dels establiments de Catalunya que fan servir alguna tecnologia d'intel·ligència artificial "
            f"({_TRIMESTRE_IA_CA}).",
        ),
    ),
    _del_clima_empresarial(
        id_="establecimientos-ia-generativa",
        tabla=_TABLA_IA_CLIMA,
        nombre=("Establecimientos que usan IA generativa", "Establiments que fan servir IA generativa"),
        definicion=(
            "Porcentaje de los establecimientos de Cataluña que usan tecnologías de IA generativa, como ChatGPT "
            f"({_TRIMESTRE_IA_ES}).",
            "Percentatge dels establiments de Catalunya que fan servir tecnologies d'IA generativa, com ara ChatGPT "
            f"({_TRIMESTRE_IA_CA}).",
        ),
    ),
    _quien_usa_la_ia(
        "establecimientos-ia-personal-cualificado",
        (
            "las personas trabajadoras cualificadas o muy cualificadas",
            "les persones treballadores qualificades o molt qualificades",
        ),
    ),
    _quien_usa_la_ia(
        "establecimientos-ia-directivos",
        ("las personas directivas, gerentes o gestoras", "les persones directives, gerents o gestores"),
    ),
    _quien_usa_la_ia(
        "establecimientos-ia-personal-poco-cualificado",
        (
            "las personas trabajadoras no cualificadas o poco cualificadas",
            "les persones treballadores no qualificades o poc qualificades",
        ),
    ),
    _del_clima_empresarial(
        id_="establecimientos-competencias-digitales",
        tabla="22205",
        nombre=(
            "Establecimientos que valoran mucho las competencias digitales al contratar",
            "Establiments que valoren molt les competències digitals en contractar",
        ),
        definicion=(
            "Porcentaje de los establecimientos de Cataluña que dan «mucha» importancia a las competencias "
            "tecnológicas y digitales (ofimática, sistemas TIC, programación, ciberseguridad, inteligencia artificial, "
            "etc.) al contratar personal (4.º trimestre de 2025).",
            "Percentatge dels establiments de Catalunya que donen «molta» importància a les competències tecnològiques "
            "i digitals (ofimàtica, sistemes TIC, programació, ciberseguretat, intel·ligència artificial, etc.) en "
            "contractar personal (4t trimestre del 2025).",
        ),
    ),
)


# Opinión de Cataluña (CEO, Panel Ciutadà 2025, pregunta 26;
# plataforma_datos/ia_y_trabajo/fuentes/ceo_panel/lector.py): va en el bloque
# `encuestas`, solo de Cataluña y sin comparar, con un id distinto de los del Eurobarómetro (catalogo_ue.ENCUESTAS).
class Encuesta(NamedTuple):
    """Identificador y textos bilingües de una encuesta; conserva el contrato de tupla del consumidor."""

    id: str
    nombre: tuple[str, str]
    definicion: tuple[str, str]


ENCUESTA_DEL_CEO: Final = Encuesta(
    "opinion-ia-sustituira-personas-cataluna",
    (
        "Creen probable que las máquinas o la IA sustituyan a las personas en la mayoría de los trabajos",
        "Creuen probable que les màquines o la IA substitueixin les persones en la majoria de les feines",
    ),
    (
        "Porcentaje de personas de 16 años o más residentes en Cataluña que respondieron en línea y puntúan con un 7 "
        "o más, de 0 a 10, la probabilidad de que las personas sean superadas o sustituidas por máquinas, programas "
        "informáticos o la inteligencia artificial en la mayoría de los trabajos. Opinión, no una medida.",
        "Percentatge de persones de 16 anys o més residents a Catalunya que van respondre en línia i puntuen amb un 7 "
        "o més, de 0 a 10, la probabilitat que les persones siguin superades o substituïdes per màquines, programes "
        "informàtics o la intel·ligència artificial en la majoria de les feines. Opinió, no una mesura.",
    ),
)
CAMPOS_DEL_INDICADOR: Final = (
    "id",
    "nombre",
    "definicion",
    "unidad",
    "naturaleza",
    "fuente",
    "tabla",
    "licencia",
    "url",
    "comparable",
    "cobertura",
)


def nota_de_la_marca(marca: str | None) -> str | None:
    """Da la nota de una cifra según su marca, también si la marca combina varias letras («bu», «be»).

    Args:
        marca: Marca de la cifra tal como la publica Eurostat o ILOSTAT, o `None` si no tiene.

    Returns:
        La nota de mayor prioridad (PRIORIDAD_DE_NOTAS) entre las de sus letras, o `None` si ninguna lleva nota.

    Raises:
        FormatoInesperado: Si una letra no está en NOTA_DE_LA_MARCA ni en MARCAS_SIN_NOTA: la cifra no se da como
            firme sin saber qué dice su marca.
    """
    notas = set()
    for letra in marca or "":
        exigir(
            letra in NOTA_DE_LA_MARCA or letra in MARCAS_SIN_NOTA,
            f"datos globales: la marca «{letra}» (de «{marca}») no tiene nota declarada",
        )
        if letra in NOTA_DE_LA_MARCA:
            notas.add(NOTA_DE_LA_MARCA[letra])
    return next((nota for nota in PRIORIDAD_DE_NOTAS if nota in notas), None)
