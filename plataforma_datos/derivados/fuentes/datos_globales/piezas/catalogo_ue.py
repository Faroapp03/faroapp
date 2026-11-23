"""Catálogo de los indicadores de la UE-27 de `datos-globales.json` (Parte II).

Cada indicador se define aquí una sola vez: su tabla y sus códigos de Eurostat (los lee
`ia_y_trabajo/fuentes/ue_eurostat/lector.py` para preparar y validar la cifra) y su nombre y definición en castellano y
en catalán (los lee `derivados/fuentes/datos_globales/lector.py` para el archivo).
Solo el agregado `EU27_2020`, cobertura «ue»: son cifras medidas de las encuestas europeas, la misma pregunta en
todos los países, pero aquí no se dan por país. Ningún indicador de aquí repite uno de `constantes_datos_globales.py`.
Cada base (sobre quién se calcula el porcentaje) va en la definición, porque cambia de un bloque a otro. Python
estándar.
"""

import re
from collections.abc import Mapping
from types import MappingProxyType
from typing import NamedTuple

from plataforma_datos.comun.nucleo import exigir
from plataforma_datos.derivados.fuentes.datos_globales.piezas.constantes_datos_globales import (
    COBERTURA_UE,
    MEDIDO,
    UNIDAD_DEL_RECUENTO,
    UNIDAD_PORCENTAJE,
)
from plataforma_datos.mercado.fuentes.empresas.piezas.constantes_empresas import LICENCIA_EUROSTAT

# Las actividades de las encuestas de empresas: todas, sin agricultura, minería ni sector financiero.
ACTIVIDADES = "C10-S951_X_K"
TODAS_LAS_EMPRESAS = MappingProxyType({"nace_r2": ACTIVIDADES, "size_emp": "GE10", "unit": "PC_ENT"})
# Primer año de la serie de `isoc_sk_dskl_i21` (capacidades digitales).
DESDE_CAPACIDADES_DIGITALES = 2021


class IndicadorUe(NamedTuple):
    """Un indicador de la UE-27: id, tabla, códigos de la cifra, nombre (es, ca), base, desde qué año es serie y unidad.

    Sin `desde`, solo la cifra más reciente; con él, cada año publicado desde ese, la más reciente primero. La unidad es
    UNIDAD_PORCENTAJE salvo en un recuento (UNIDAD_DEL_RECUENTO).
    """

    id: str
    tabla: str
    codigos: Mapping[str, str]
    nombre: tuple[str, str]
    base: str
    desde: int | None = None
    unidad: str = UNIDAD_PORCENTAJE


# Sobre quién se calcula cada porcentaje (castellano, catalán).
_BASES = {
    "empresas": (
        "empresas de 10 o más personas, sin agricultura, minería ni sector financiero",
        "empreses de 10 o més persones, sense agricultura, mineria ni sector financer",
    ),
    "empresas-10-49": (
        "empresas de 10 a 49 personas, sin agricultura, minería ni sector financiero",
        "empreses de 10 a 49 persones, sense agricultura, mineria ni sector financer",
    ),
    "empresas-50-249": (
        "empresas de 50 a 249 personas, sin agricultura, minería ni sector financiero",
        "empreses de 50 a 249 persones, sense agricultura, mineria ni sector financer",
    ),
    "empresas-250": (
        "empresas de 250 o más personas, sin agricultura, minería ni sector financiero",
        "empreses de 250 o més persones, sense agricultura, mineria ni sector financer",
    ),
    "pymes": (
        "pymes de 10 a 249 personas, sin agricultura, minería ni sector financiero",
        "pimes de 10 a 249 persones, sense agricultura, mineria ni sector financer",
    ),
    "empresas-j": (
        "empresas de 10 o más personas de información y comunicaciones (sección J de la NACE Rev. 2)",
        "empreses de 10 o més persones d'informació i comunicacions (secció J de la NACE Rev. 2)",
    ),
    "empresas-f": (
        "empresas de 10 o más personas de la construcción (sección F de la NACE Rev. 2)",
        "empreses de 10 o més persones de la construcció (secció F de la NACE Rev. 2)",
    ),
    "empresas-que-buscaron-tic": (
        "empresas de 10 o más personas que contrataron o intentaron contratar especialistas en TIC",
        "empreses de 10 o més persones que van contractar o van intentar contractar especialistes en TIC",
    ),
    "personas": (
        "todas las personas de 16 a 74 años (o del grupo indicado), usen o no internet",
        "totes les persones de 16 a 74 anys (o del grup indicat), facin servir internet o no",
    ),
    "personas-sin-ia-generativa": (
        "personas de 16 a 74 años que no usaron IA generativa en los tres meses anteriores",
        "persones de 16 a 74 anys que no van fer servir IA generativa en els tres mesos anteriors",
    ),
    "empleo": ("todas las personas ocupadas", "totes les persones ocupades"),
    "especialistas-tic": ("especialistas en TIC ocupados", "especialistes en TIC ocupats"),
}
BASES: Mapping[str, tuple[str, str]] = MappingProxyType(_BASES)


def _empresas(id_: str, tabla: str, indic_is: str, nombre: tuple[str, str], **otros: str) -> IndicadorUe:
    """Define un indicador de empresas de 10 o más personas de todas las actividades, en % de empresas.

    Args:
        id_: El identificador del indicador.
        tabla: La tabla de Eurostat.
        indic_is: El código del indicador en la tabla.
        nombre: Su nombre en castellano y en catalán.
        **otros: Otros códigos de la consulta que sustituyen a los de TODAS_LAS_EMPRESAS.

    Returns:
        El indicador.
    """
    codigos = MappingProxyType({**TODAS_LAS_EMPRESAS, "indic_is": indic_is, **otros})
    return IndicadorUe(id_, tabla, codigos, nombre, "empresas")


def _personas(id_: str, tabla: str, indic_is: str, ind_type: str, nombre: tuple[str, str]) -> IndicadorUe:
    """Define un indicador de personas: porcentaje (`PC_IND`) sobre la base «personas» de BASES.

    Su serie se pide con `_replace(desde=…)`.

    Args:
        id_: El identificador del indicador.
        tabla: La tabla de Eurostat.
        indic_is: El código del indicador en la tabla.
        ind_type: El grupo de personas.
        nombre: Su nombre en castellano y en catalán.

    Returns:
        El indicador.
    """
    codigos = MappingProxyType({"indic_is": indic_is, "ind_type": ind_type, "unit": "PC_IND"})
    return IndicadorUe(id_, tabla, codigos, nombre, "personas")


TECNOLOGIAS = MappingProxyType(
    {
        "E_AI_TTM": ("análisis de texto escrito", "anàlisi de text escrit", "texto"),
        "E_AI_TPVSG": ("generación de imagen, vídeo o sonido", "generació d'imatge, vídeo o so", "imagen-video-sonido"),
        "E_AI_TNLG": (
            "generación de lenguaje escrito o hablado",
            "generació de llenguatge escrit o parlat",
            "lenguaje",
        ),
        "E_AI_TSR": ("reconocimiento de voz", "reconeixement de veu", "voz"),
        "E_AI_TPA": ("automatización de flujos de trabajo", "automatització de fluxos de treball", "automatizacion"),
        "E_AI_TML": (
            "aprendizaje automático para analizar datos",
            "aprenentatge automàtic per analitzar dades",
            "aprendizaje-automatico",
        ),
        "E_AI_TIR": ("reconocimiento de imágenes", "reconeixement d'imatges", "reconocimiento-imagenes"),
        "E_AI_TAR": (
            "robots autónomos o vehículos sin conductor",
            "robots autònoms o vehicles sense conductor",
            "robots",
        ),
    }
)
USOS = MappingProxyType(
    {
        "E_AI_PMS": ("marketing o ventas", "màrqueting o vendes", "marketing-ventas"),
        "E_AI_PBAM": ("administración y gestión", "administració i gestió", "administracion"),
        "E_AI_PFIN": ("contabilidad y finanzas", "comptabilitat i finances", "finanzas"),
        "E_AI_PPP": ("procesos de producción", "processos de producció", "produccion"),
        "E_AI_PITS": ("seguridad informática", "seguretat informàtica", "seguridad-informatica"),
        "E_AI_PRDI": ("I+D e innovación", "R+D i innovació", "id-innovacion"),
        "E_AI_PLOG": ("logística", "logística", "logistica"),
    }
)
MOTIVOS_DE_LAS_EMPRESAS = MappingProxyType(
    {
        "E_AI_EC": ("pensaron en usar IA y no la usan", "van pensar a fer servir IA i no la fan servir", "la-penso"),
        "E_AI_BLE": (
            "no la usan por falta de conocimientos",
            "no la fan servir per falta de coneixements",
            "conocimientos",
        ),
        "E_AI_BLEG": (
            "no la usan por dudas sobre sus consecuencias legales",
            "no la fan servir per dubtes sobre les conseqüències legals",
            "dudas-legales",
        ),
        "E_AI_BCDP": (
            "no la usan por la protección de datos y la privacidad",
            "no la fan servir per la protecció de dades i la privadesa",
            "proteccion-datos",
        ),
    }
)
PARA_QUE = MappingProxyType(
    {
        "I_IUAIPR": ("uso privado", "ús privat", "uso-privado"),
        "I_IUAIFE": ("educación formal", "educació formal", "educacion-formal"),
    }
)
SEXOS = MappingProxyType({"F_Y16_74": ("mujeres", "dones"), "M_Y16_74": ("hombres", "homes")})
EDADES = ("Y16_24", "Y25_34", "Y35_44", "Y45_54", "Y55_64", "Y65_74")
ESTUDIOS = MappingProxyType(
    {
        "I0_2": ("estudios bajos (CINE 0–2)", "estudis baixos (CINE 0–2)"),
        "I3_4": ("estudios medios (CINE 3–4)", "estudis mitjans (CINE 3–4)"),
        "I5_8": ("estudios superiores (CINE 5–8)", "estudis superiors (CINE 5–8)"),
    }
)
MOTIVOS_DE_LAS_PERSONAS = MappingProxyType(
    {
        "I_IUAIX_NUNN": ("no la necesitan", "no la necessiten", "no-la-necesita"),
        "I_IUAIX_NUUSE": ("no saben cómo usarla", "no saben com fer-la servir", "no-sabe-usarla"),
        "I_IUAIX_NUUNK": ("no sabían que existía", "no sabien que existia", "no-sabia-que-existia"),
        "I_IUAIX_NUSEC": (
            "les preocupa la privacidad o la seguridad",
            "els preocupa la privadesa o la seguretat",
            "privacidad-seguridad",
        ),
    }
)
NIVELES = MappingProxyType(
    {
        "I_DSK2_AB": ("nivel por encima del básico", "nivell per sobre del bàsic", "avanzadas"),
        "I_DSK2_B": ("nivel básico", "nivell bàsic", "solo-basicas"),
        "I_DSK2_LW": ("nivel bajo (4 de 5 áreas)", "nivell baix (4 de 5 àrees)", "bajas"),
        "I_DSK2_N": ("nivel reducido (3 de 5 áreas)", "nivell reduït (3 de 5 àrees)", "reducidas"),
        "I_DSK2_LM": ("nivel limitado (2 de 5 áreas)", "nivell limitat (2 de 5 àrees)", "limitadas"),
        "I_DSK2_X": ("ninguna", "cap", "ninguna"),
        "I_DSK2_NA": ("sin evaluar (no usaron internet)", "sense avaluar (no van fer servir internet)", "sin-evaluar"),
    }
)
AREAS = MappingProxyType(
    {
        "I_DSK2_CC_BAB": ("comunicación y colaboración", "comunicació i col·laboració", "comunicacion"),
        "I_DSK2_IL_BAB": ("información y datos", "informació i dades", "informacion"),
        "I_DSK2_PS_BAB": ("resolución de problemas", "resolució de problemes", "resolucion-problemas"),
        "I_DSK2_SF_BAB": ("seguridad", "seguretat", "seguridad"),
        "I_DSK2_DCC_BAB": ("creación de contenidos digitales", "creació de continguts digitals", "contenidos"),
    }
)
GRUPOS_DE_LAS_CAPACIDADES = MappingProxyType(
    {
        "F_Y16_74": ("mujeres", "dones", "mujeres"),
        "M_Y16_74": ("hombres", "homes", "hombres"),
        "Y16_24": ("16 a 24 años", "16 a 24 anys", "16-24"),
        "Y55_74": ("55 a 74 años", "55 a 74 anys", "55-74"),
        "ISCO0_5": ("ocupaciones no manuales", "ocupacions no manuals", "no-manual"),
        "ISCO6_9": ("ocupaciones manuales", "ocupacions manuals", "manual"),
    }
)
DIFICULTADES = MappingProxyType(
    {
        "E_ITSPDLA": ("faltan candidaturas", "falten candidatures", "faltan-candidaturas"),
        "E_ITSPDSAL": ("expectativas salariales altas", "expectatives salarials altes", "salarios"),
        "E_ITSPDLET": ("falta de formación TIC adecuada", "falta de formació TIC adequada", "formacion"),
        "E_ITSPDLWE": ("falta de experiencia laboral", "falta d'experiència laboral", "experiencia"),
    }
)
FORMACION_TIC = MappingProxyType(
    {
        "E_ITT2": ("a su personal", "al seu personal", ""),
        "E_ITSPT2": ("a sus especialistas en TIC", "als seus especialistes en TIC", "especialistas"),
        "E_ITUST2": ("al resto de su personal", "a la resta del seu personal", "resto-del-personal"),
    }
)


# Cada código de Eurostat como parte de un identificador, legible: el tercer elemento de cada código en su tabla, que
# así se define una sola vez junto a sus nombres.
_CLAVES = {
    codigo: clave
    for tabla in (
        TECNOLOGIAS,
        USOS,
        MOTIVOS_DE_LAS_EMPRESAS,
        PARA_QUE,
        MOTIVOS_DE_LAS_PERSONAS,
        NIVELES,
        AREAS,
        GRUPOS_DE_LAS_CAPACIDADES,
        DIFICULTADES,
        FORMACION_TIC,
    )
    for codigo, (_es, _ca, clave) in tabla.items()
}
CLAVES: Mapping[str, str] = MappingProxyType(_CLAVES)


def _tramo(codigo: str) -> tuple[str, str]:
    """Separa el principio y el fin de un tramo de Eurostat: «Y25_34» → («25», «34»); «I0_2» → («0», «2»).

    Args:
        codigo: El tramo: una letra, la cifra inicial, «_» y la cifra final.

    Returns:
        El principio y el fin del tramo, como texto.

    Raises:
        FormatoInesperado: Si el código no tiene esa forma.
    """
    tramo = re.fullmatch(r"[A-Z](\d+)_(\d+)", codigo)
    exigir(tramo is not None, f"catálogo de la UE: el tramo «{codigo}» no tiene la forma letra, cifras, «_», cifras")
    return tramo.group(1), tramo.group(2)


def _edad(codigo: str) -> tuple[str, str]:
    """Escribe un tramo de edad de Eurostat en castellano y en catalán.

    Args:
        codigo: El tramo («Y25_34»).

    Returns:
        «25 a 34 años» y «25 a 34 anys».
    """
    desde, hasta = _tramo(codigo)
    return f"{desde} a {hasta} años", f"{desde} a {hasta} anys"


def _ia_generativa_para(codigo: str, tipo: str, quien: tuple[str, str]) -> IndicadorUe:
    """El indicador de las personas que usan IA generativa para un fin (PARA_QUE), de todas o de un sexo.

    Args:
        codigo: El código de Eurostat del fin («I_IUAIPR»).
        tipo: El grupo de personas de Eurostat: «IND_TOTAL» o el de un sexo.
        quien: El nombre del grupo en castellano y en catalán; vacío para todas las personas.

    Returns:
        El indicador, con un id como `ia-generativa-uso-privado` o `ia-generativa-uso-privado-mujeres`.
    """
    es, ca, _identificador = PARA_QUE[codigo]
    quien_es, quien_ca = quien
    return _personas(
        "-".join(filter(None, ("ia-generativa", CLAVES[codigo], quien_es))),
        "isoc_ai_iaiu",
        codigo,
        tipo,
        (
            f"{quien_es.capitalize() or 'Personas'} que usan IA generativa para {es}",
            f"{quien_ca.capitalize() or 'Persones'} que fan servir IA generativa per a {ca}",
        ),
    )


INDICADORES_UE: tuple[IndicadorUe, ...] = (
    # Empresas que usan IA: por tamaño, tecnología, uso y motivo para no usarla; por sector; y la meta combinada.
    *(
        IndicadorUe(
            f"empresas-ia-{tamano}",
            "isoc_eb_ai",
            MappingProxyType({**TODAS_LAS_EMPRESAS, "indic_is": "E_AI_TANY", "size_emp": codigo}),
            (f"Empresas que usan IA, de {texto[0]}", f"Empreses que fan servir IA, de {texto[1]}"),
            f"empresas-{tamano.removesuffix('-o-mas')}",
        )
        for tamano, codigo, texto in (
            ("10-49", "10-49", ("10 a 49 personas", "10 a 49 persones")),
            ("50-249", "50-249", ("50 a 249 personas", "50 a 249 persones")),
            ("250-o-mas", "GE250", ("250 o más personas", "250 o més persones")),
        )
    ),
    *(
        _empresas(
            f"empresas-ia-{CLAVES[codigo]}", "isoc_eb_ai", codigo, (f"Empresas con IA: {es}", f"Empreses amb IA: {ca}")
        )
        for codigo, (es, ca, _identificador) in TECNOLOGIAS.items()
    ),
    *(
        _empresas(
            f"empresas-ia-uso-{CLAVES[codigo]}",
            "isoc_eb_ai",
            codigo,
            (f"Empresas con IA para {es}", f"Empreses amb IA per a {ca}"),
        )
        for codigo, (es, ca, _identificador) in USOS.items()
    ),
    *(
        _empresas(
            f"empresas-ia-motivo-{CLAVES[codigo]}", "isoc_eb_ai", codigo, (f"Empresas que {es}", f"Empreses que {ca}")
        )
        for codigo, (es, ca, _identificador) in MOTIVOS_DE_LAS_EMPRESAS.items()
    ),
    _empresas(
        "empresas-nube-datos-ia",
        "isoc_eb_ai",
        "E_AI_CC1SI_DA_ANY",
        (
            "Empresas con IA, nube sofisticada o intermedia, o análisis de datos",
            "Empreses amb IA, núvol sofisticat o intermedi, o anàlisi de dades",
        ),
    ),
    *(
        IndicadorUe(
            f"empresas-ia-seccion-{seccion.lower()}",
            "isoc_eb_ain2",
            MappingProxyType({"indic_is": "E_AI_TANY", "nace_r2": seccion, "size_emp": "GE10", "unit": "PC_ENT"}),
            nombre,
            f"empresas-{seccion.lower()}",
        )
        for seccion, nombre in (
            ("J", ("Empresas con IA: información y comunicaciones", "Empreses amb IA: informació i comunicacions")),
            ("F", ("Empresas con IA: construcción", "Empreses amb IA: construcció")),
        )
    ),
    # Personas que usan IA generativa: para qué, por edad, por estudios y por qué no la usan.
    *(
        _ia_generativa_para(codigo, tipo, quien)
        for codigo in PARA_QUE
        for tipo, quien in (("IND_TOTAL", ("", "")), *SEXOS.items())
    ),
    *(
        _personas(
            "ia-generativa-{}-{}".format(*_tramo(codigo)),
            "isoc_ai_iaiu",
            "I_IUAI",
            codigo,
            (f"IA generativa, de {_edad(codigo)[0]}", f"IA generativa, de {_edad(codigo)[1]}"),
        )
        for codigo in EDADES
    ),
    _personas(
        "ia-generativa-trabajo-ocupados",
        "isoc_ai_iaiu",
        "I_IUAIWP",
        "SAL_SELF_FAM",
        ("IA generativa para trabajar, personas ocupadas", "IA generativa per treballar, persones ocupades"),
    ),
    *(
        _personas(
            "ia-generativa-trabajo-estudios-{}-{}".format(*_tramo(codigo)),
            "isoc_ai_iaiu",
            "I_IUAIWP",
            codigo,
            (f"IA generativa para trabajar, {es}", f"IA generativa per treballar, {ca}"),
        )
        for codigo, (es, ca) in ESTUDIOS.items()
    ),
    *(
        IndicadorUe(
            f"ia-generativa-no-la-usa-{CLAVES[codigo]}",
            "isoc_ai_iaiuxr",
            MappingProxyType({"indic_is": codigo, "ind_type": "IND_TOTAL", "unit": "PC_IND_IUAIX"}),
            (f"No usan IA generativa porque {es}", f"No fan servir IA generativa perquè {ca}"),
            "personas-sin-ia-generativa",
        )
        for codigo, (es, ca, _identificador) in MOTIVOS_DE_LAS_PERSONAS.items()
    ),
    # Capacidades digitales: al menos básicas (serie), cada nivel, cada área y por grupo.
    _personas(
        "capacidades-digitales-basicas",
        "isoc_sk_dskl_i21",
        "I_DSK2_BAB",
        "IND_TOTAL",
        ("Capacidades digitales al menos básicas", "Capacitats digitals almenys bàsiques"),
    )._replace(desde=DESDE_CAPACIDADES_DIGITALES),
    *(
        _personas(
            f"capacidades-digitales-{CLAVES[codigo]}",
            "isoc_sk_dskl_i21",
            codigo,
            "IND_TOTAL",
            (f"Capacidades digitales: {es}", f"Capacitats digitals: {ca}"),
        )._replace(desde=DESDE_CAPACIDADES_DIGITALES if codigo == "I_DSK2_AB" else None)
        for codigo, (es, ca, _identificador) in NIVELES.items()
    ),
    *(
        _personas(
            f"capacidades-digitales-area-{CLAVES[codigo]}",
            "isoc_sk_dskl_i21",
            codigo,
            "IND_TOTAL",
            (f"Capacidades al menos básicas en {es}", f"Capacitats almenys bàsiques en {ca}"),
        )
        for codigo, (es, ca, _identificador) in AREAS.items()
    ),
    *(
        _personas(
            f"capacidades-digitales-basicas-{CLAVES[tipo]}",
            "isoc_sk_dskl_i21",
            "I_DSK2_BAB",
            tipo,
            (f"Capacidades digitales al menos básicas: {es}", f"Capacitats digitals almenys bàsiques: {ca}"),
        )
        for tipo, (es, ca, _identificador) in GRUPOS_DE_LAS_CAPACIDADES.items()
    ),
    # Especialistas en TIC: su peso en el empleo y la parte de mujeres; las empresas que los emplean, los buscan, no
    # los encuentran y por qué; y las que forman a su personal en TIC.
    IndicadorUe(
        "especialistas-tic-empleo",
        "isoc_sks_itspt",
        MappingProxyType({"unit": "PC_EMP"}),
        ("Especialistas en TIC en el empleo", "Especialistes en TIC en l'ocupació"),
        "empleo",
    ),
    IndicadorUe(
        "especialistas-tic-mujeres",
        "isoc_sks_itsps",
        MappingProxyType({"unit": "PC", "sex": "F"}),
        ("Mujeres entre los especialistas en TIC", "Dones entre els especialistes en TIC"),
        "especialistas-tic",
    ),
    _empresas(
        "empresas-especialistas-tic",
        "isoc_ske_itspen2",
        "E_ITSP2",
        ("Empresas con especialistas en TIC", "Empreses amb especialistes en TIC"),
    ),
    _empresas(
        "empresas-buscan-especialistas-tic",
        "isoc_ske_itrcrn2",
        "E_ITSPRCR2",
        (
            "Empresas que contrataron o intentaron contratar especialistas en TIC",
            "Empreses que van contractar o van intentar contractar especialistes en TIC",
        ),
    ),
    _empresas(
        "empresas-vacantes-tic-dificiles",
        "isoc_ske_itrcrn2",
        "E_ITSPVAC2",
        (
            "Empresas con vacantes de especialistas en TIC difíciles de cubrir",
            "Empreses amb vacants d'especialistes en TIC difícils de cobrir",
        ),
    ),
    IndicadorUe(
        "vacantes-tic-dificiles-entre-las-que-buscaron",
        "isoc_ske_itrcrn2",
        MappingProxyType({**TODAS_LAS_EMPRESAS, "indic_is": "E_ITSPVAC2", "unit": "PC_ENT_ITSPRCR2"}),
        (
            "Vacantes de especialistas en TIC difíciles de cubrir, entre las empresas que buscaron",
            "Vacants d'especialistes en TIC difícils de cobrir, entre les empreses que en van buscar",
        ),
        "empresas-que-buscaron-tic",
        desde=2022,
    ),
    *(
        IndicadorUe(
            f"especialistas-tic-dificultad-{CLAVES[codigo]}",
            "isoc_ske_itrcrn2",
            MappingProxyType({**TODAS_LAS_EMPRESAS, "indic_is": codigo, "unit": "PC_ENT_ITSPRCR2"}),
            (
                f"Dificultad para contratar especialistas en TIC: {es}",
                f"Dificultat per contractar especialistes en TIC: {ca}",
            ),
            "empresas-que-buscaron-tic",
        )
        for codigo, (es, ca, _identificador) in DIFICULTADES.items()
    ),
    *(
        _empresas(
            "-".join(filter(None, ("empresas-formacion-tic", CLAVES[codigo]))),
            "isoc_ske_ittn2",
            codigo,
            (f"Empresas que dan formación en TIC {es}", f"Empreses que donen formació en TIC {ca}"),
        )
        for codigo, (es, ca, _identificador) in FORMACION_TIC.items()
    ),
    # Pymes con intensidad digital al menos básica: dos versiones del índice que no se comparan entre sí.
    *(
        IndicadorUe(
            f"pymes-intensidad-digital-basica-v{version}",
            "isoc_e_dii",
            MappingProxyType(
                {"indic_is": f"E_DI{version}_GELO", "size_emp": "10-249", "nace_r2": ACTIVIDADES, "unit": "PC_ENT"}
            ),
            (
                f"Pymes con intensidad digital al menos básica (índice, versión {version})",
                f"Pimes amb intensitat digital almenys bàsica (índex, versió {version})",
            ),
            "pymes",
        )
        for version in ("3", "4")
    ),
)
# Lo que no es un porcentaje: el número de especialistas en TIC ocupados (miles de personas), para la meta 1.b.
RECUENTO_ESPECIALISTAS_TIC = IndicadorUe(
    "especialistas-tic",
    "isoc_sks_itspt",
    MappingProxyType({"unit": "THS_PER"}),
    ("Especialistas en TIC ocupados", "Especialistes en TIC ocupats"),
    "empleo",
    unidad=UNIDAD_DEL_RECUENTO,
)


def definicion(indicador: IndicadorUe) -> dict[str, str]:
    """Redacta la definición de un indicador en castellano y en catalán.

    Args:
        indicador: El indicador.

    Returns:
        «es» y «ca»: el nombre, la base del porcentaje y el código de Eurostat.
    """
    codigos = ", ".join(f"{clave}={valor}" for clave, valor in indicador.codigos.items())
    if indicador.unidad == UNIDAD_DEL_RECUENTO:
        return {
            "es": f"Miles de especialistas en TIC ocupados en la UE-27. Eurostat, {indicador.tabla} ({codigos}).",
            "ca": f"Milers de especialistes en TIC ocupats a la UE-27. Eurostat, {indicador.tabla} ({codigos}).",
        }
    base_es, base_ca = BASES[indicador.base]
    return {
        "es": f"{indicador.nombre[0]}. Porcentaje sobre {base_es}, UE-27. Eurostat, {indicador.tabla} ({codigos}).",
        "ca": f"{indicador.nombre[1]}. Percentatge sobre {base_ca}, UE-27. Eurostat, {indicador.tabla} ({codigos}).",
    }


def para_el_contrato(indicador: IndicadorUe, unidad: str | None = None) -> dict[str, object]:
    """El indicador con los campos del contrato, en su orden: medido, de Eurostat, cobertura «ue».

    Es la misma encuesta en todos los países europeos (comparable), aunque el archivo solo da la UE-27.

    Args:
        indicador: El indicador.
        unidad: La unidad de su valor; si se indica, debe coincidir con la del indicador.

    Returns:
        Los campos del contrato del indicador.
    """
    exigir(
        unidad is None or unidad == indicador.unidad,
        f"{indicador.id}: la unidad «{unidad}» contradice la del indicador («{indicador.unidad}»)",
    )
    return {
        "id": indicador.id,
        "nombre": {"es": indicador.nombre[0], "ca": indicador.nombre[1]},
        "definicion": definicion(indicador),
        "unidad": indicador.unidad,
        "naturaleza": MEDIDO,
        "fuente": "Eurostat",
        "tabla": indicador.tabla,
        "licencia": LICENCIA_EUROSTAT,
        "url": f"https://doi.org/10.2908/{indicador.tabla.upper()}",
        "comparable": True,
        "cobertura": COBERTURA_UE,
    }


class MetaDigital(NamedTuple):
    """Una meta de la Década Digital: nombre (es, ca), apartado y texto literal del artículo 4, valor y unidad.

    Con su id, el indicador que la mide y su nota.
    """

    id: str
    nombre: tuple[str, str]
    articulo: str
    texto: str
    valor: float
    unidad: str
    indicador: str
    nota: tuple[str, str] | None = None


NORMA_DE_LAS_METAS = (
    "Decisión (UE) 2022/2481, por la que se establece el programa estratégico de la Década Digital para 2030"
)
ANIO_DE_LAS_METAS = 2030
# Cada meta que mide un indicador de este archivo, con su texto literal, puntuación incluida (versión española del
# Diario Oficial, L 323, 19/12/2022); `ia_y_trabajo/fuentes/decada_digital/lector.py` comprueba el artículo 4 del
# texto original, sin acreditar la ausencia de modificaciones posteriores.
METAS: tuple[MetaDigital, ...] = (
    MetaDigital(
        "meta-capacidades-digitales",
        ("Capacidades digitales al menos básicas", "Capacitats digitals almenys bàsiques"),
        "artículo 4, apartado 1, punto 1, letra a)",
        "un mínimo del 80 % de las personas de entre 16 y 74 años tenga al menos, capacidades digitales básicas",
        80,
        UNIDAD_PORCENTAJE,
        "capacidades-digitales-basicas",
    ),
    MetaDigital(
        "meta-especialistas-tic",
        ("Especialistas en TIC empleados", "Especialistes en TIC ocupats"),
        "artículo 4, apartado 1, punto 1, letra b)",
        "un mínimo de veinte millones de especialistas en TIC estén empleados en la Unión, al tiempo que se facilita "
        "el acceso de las mujeres a este ámbito y se aumenta el número de titulados en TIC",
        20_000,  # veinte millones, en miles de personas (UNIDAD_DEL_RECUENTO)
        UNIDAD_DEL_RECUENTO,
        RECUENTO_ESPECIALISTAS_TIC.id,
    ),
    MetaDigital(
        "meta-empresas-nube-datos-ia",
        ("Empresas con nube, macrodatos o IA", "Empreses amb núvol, macrodades o IA"),
        "artículo 4, apartado 1, punto 3, letra a)",
        "al menos el 75 % de las empresas de la Unión hayan adoptado uno o varios de los siguientes elementos, en "
        "consonancia con sus operaciones comerciales: i) servicios de computación en nube, ii) macrodatos, iii) "
        "inteligencia artificial",
        75,
        UNIDAD_PORCENTAJE,
        "empresas-nube-datos-ia",
        (
            "La norma dice «macrodatos»; la encuesta de Eurostat pregunta por análisis de datos (E_AI_CC1SI_DA_ANY).",
            "La norma diu «macrodades»; l'enquesta d'Eurostat pregunta per anàlisi de dades (E_AI_CC1SI_DA_ANY).",
        ),
    ),
    MetaDigital(
        "meta-pymes-intensidad-digital",
        ("Pymes con intensidad digital al menos básica", "Pimes amb intensitat digital almenys bàsica"),
        "artículo 4, apartado 1, punto 3, letra b)",
        "más del 90 % de las pymes de la Unión hayan alcanzado al menos un nivel básico de intensidad digital",
        90,
        UNIDAD_PORCENTAJE,
        "pymes-intensidad-digital-basica-v3",
        (
            "Se mide con la versión 3 del índice (años impares); la versión 4 (años pares) no se compara con ella.",
            "Es mesura amb la versió 3 de l'índex (anys senars); la versió 4 (anys parells) no s'hi compara.",
        ),
    ),
)


class EncuestaUe(NamedTuple):
    """Una pregunta de opinión del Eurobarómetro: su id en el archivo, su nombre y su definición (es, ca)."""

    id: str
    nombre: tuple[str, str]
    definicion: tuple[str, str]


# Encuestas de opinión: lo que la gente opina, nunca una medida de la exposición ni del uso. Van en el bloque
# `encuestas` del archivo, con `naturaleza: "opinion"`, cada pregunta con su propio id.
_ENCUESTAS: dict[str, EncuestaUe] = {
    "QB5": EncuestaUe(
        "opinion-ia-en-el-trabajo-positiva",
        ("Ven positivo el uso de robots e IA en el trabajo", "Veuen positiu l'ús de robots i IA a la feina"),
        (
            "Porcentaje de personas de 15 años o más que perciben de forma muy o bastante positiva el uso de robots e "
            "inteligencia artificial en el lugar de trabajo. Opinión, no una medida.",
            "Percentatge de persones de 15 anys o més que perceben de manera molt o força positiva l'ús de robots i "
            "intel·ligència artificial al lloc de treball. Opinió, no una mesura.",
        ),
    ),
    "QB6_1": EncuestaUe(
        "opinion-ia-destruira-mas-empleo",
        (
            "Creen que la IA hará desaparecer más empleos de los que creará",
            "Creuen que la IA farà desaparèixer més feines de les que crearà",
        ),
        (
            "Porcentaje de personas de 15 años o más muy o bastante de acuerdo en que, por el uso de robots e "
            "inteligencia artificial, desaparecerán más empleos de los que se crearán. Opinión, no una medida.",
            "Percentatge de persones de 15 anys o més molt o força d'acord que, per l'ús de robots i intel·ligència "
            "artificial, desapareixeran més feines de les que se'n crearan. Opinió, no una mesura.",
        ),
    ),
    "QB6_2": EncuestaUe(
        "opinion-ia-buena-para-la-sociedad",
        (
            "Creen que los robots y la IA son buenos para la sociedad",
            "Creuen que els robots i la IA són bons per a la societat",
        ),
        (
            "Porcentaje de personas de 15 años o más muy o bastante de acuerdo en que los robots y la inteligencia "
            "artificial son buenos para la sociedad, porque ayudan a la gente a hacer su trabajo o las tareas de casa. "
            "Opinión, no una medida.",
            "Percentatge de persones de 15 anys o més molt o força d'acord que els robots i la intel·ligència "
            "artificial són bons per a la societat, perquè ajuden la gent a fer la feina o les tasques de casa. "
            "Opinió, no una mesura.",
        ),
    ),
    "QB6_3": EncuestaUe(
        "opinion-ia-gestionar-con-cuidado",
        (
            "Creen que los robots y la IA hay que gestionarlos con cuidado",
            "Creuen que els robots i la IA s'han de gestionar amb cura",
        ),
        (
            "Porcentaje de personas de 15 años o más muy o bastante de acuerdo en que los robots y la inteligencia "
            "artificial son tecnologías que hay que gestionar con cuidado. Opinión, no una medida.",
            "Percentatge de persones de 15 anys o més molt o força d'acord que els robots i la intel·ligència "
            "artificial són tecnologies que cal gestionar amb cura. Opinió, no una mesura.",
        ),
    ),
    "QB11_1": EncuestaUe(
        "opinion-regla-ia-proteger-intimidad",
        (
            "Ven importante proteger la intimidad de los trabajadores",
            "Veuen important protegir la intimitat dels treballadors",
        ),
        (
            "Porcentaje de personas de 15 años o más que ven muy o bastante importante proteger la intimidad de los "
            "trabajadores para afrontar los riesgos y aprovechar las ventajas de las tecnologías digitales, incluida "
            "la inteligencia artificial, en el trabajo. Opinión, no una medida.",
            "Percentatge de persones de 15 anys o més que veuen molt o força important protegir la intimitat dels "
            "treballadors per afrontar els riscos i aprofitar els avantatges de les tecnologies digitals, inclosa la "
            "intel·ligència artificial, a la feina. Opinió, no una mesura.",
        ),
    ),
    "QB11_2": EncuestaUe(
        "opinion-regla-ia-prohibir-decisiones-automaticas",
        (
            "Ven importante prohibir las decisiones totalmente automatizadas",
            "Veuen important prohibir les decisions totalment automatitzades",
        ),
        (
            "Porcentaje de personas de 15 años o más que ven muy o bastante importante prohibir los procesos de "
            "decisión totalmente automatizados para afrontar los riesgos y aprovechar las ventajas de las tecnologías "
            "digitales, incluida la inteligencia artificial, en el trabajo. Opinión, no una medida.",
            "Percentatge de persones de 15 anys o més que veuen molt o força important prohibir els processos de "
            "decisió totalment automatitzats per afrontar els riscos i aprofitar els avantatges de les tecnologies "
            "digitals, inclosa la intel·ligència artificial, a la feina. Opinió, no una mesura.",
        ),
    ),
    "QB11_3": EncuestaUe(
        "opinion-regla-ia-limitar-vigilancia",
        (
            "Ven importante limitar la vigilancia automatizada de los trabajadores",
            "Veuen important limitar la vigilància automatitzada dels treballadors",
        ),
        (
            "Porcentaje de personas de 15 años o más que ven muy o bastante importante limitar la vigilancia "
            "automatizada de los trabajadores para afrontar los riesgos y aprovechar las ventajas de las tecnologías "
            "digitales, incluida la inteligencia artificial, en el trabajo. Opinión, no una medida.",
            "Percentatge de persones de 15 anys o més que veuen molt o força important limitar la vigilància "
            "automatitzada dels treballadors per afrontar els riscos i aprofitar els avantatges de les tecnologies "
            "digitals, inclosa la intel·ligència artificial, a la feina. Opinió, no una mesura.",
        ),
    ),
    "QB11_4": EncuestaUe(
        "opinion-regla-ia-transparencia-personal",
        (
            "Ven importante más transparencia en las decisiones de personal",
            "Veuen important més transparència en les decisions de personal",
        ),
        (
            "Porcentaje de personas de 15 años o más que ven muy o bastante importante exigir más transparencia en el "
            "uso de tecnologías digitales para tomar decisiones de recursos humanos para afrontar los riesgos y "
            "aprovechar las ventajas de las tecnologías digitales, incluida la inteligencia artificial, en el trabajo. "
            "Opinión, no una medida.",
            "Percentatge de persones de 15 anys o més que veuen molt o força important exigir més transparència en "
            "l'ús de tecnologies digitals per prendre decisions de recursos humans per afrontar els riscos i aprofitar "
            "els avantatges de les tecnologies digitals, inclosa la intel·ligència artificial, a la feina. Opinió, no "
            "una mesura.",
        ),
    ),
    "QB11_5": EncuestaUe(
        "opinion-regla-ia-implicar-trabajadores",
        (
            "Ven importante implicar a los trabajadores en las nuevas tecnologías",
            "Veuen important implicar els treballadors en les noves tecnologies",
        ),
        (
            "Porcentaje de personas de 15 años o más que ven muy o bastante importante implicar a los trabajadores y a "
            "sus representantes en el diseño y la adopción de nuevas tecnologías para afrontar los riesgos y "
            "aprovechar las ventajas de las tecnologías digitales, incluida la inteligencia artificial, en el trabajo. "
            "Opinión, no una medida.",
            "Percentatge de persones de 15 anys o més que veuen molt o força important implicar els treballadors i els "
            "seus representants en el disseny i l'adopció de noves tecnologies per afrontar els riscos i aprofitar els "
            "avantatges de les tecnologies digitals, inclosa la intel·ligència artificial, a la feina. Opinió, no una "
            "mesura.",
        ),
    ),
    "QB3": EncuestaUe(
        "opinion-empleador-da-herramientas-ia",
        (
            "Dicen que su empleador les da herramientas o formación para la IA",
            "Diuen que l'ocupador els dona eines o formació per a la IA",
        ),
        (
            "Porcentaje de personas que trabajan para un empleador o un jefe muy o bastante de acuerdo en que su "
            "empleador les da las herramientas o la formación necesarias para trabajar bien con las tecnologías "
            "digitales más recientes, incluida la inteligencia artificial. Solo quienes trabajan para un empleador. "
            "Opinión, no una medida.",
            "Percentatge de persones que treballen per a un ocupador o un cap molt o força d'acord que l'ocupador els "
            "dona les eines o la formació necessàries per treballar bé amb les tecnologies digitals més recents, "
            "inclosa la intel·ligència artificial. Només qui treballa per a un ocupador. Opinió, no una mesura.",
        ),
    ),
}
ENCUESTAS: Mapping[str, EncuestaUe] = MappingProxyType(_ENCUESTAS)
