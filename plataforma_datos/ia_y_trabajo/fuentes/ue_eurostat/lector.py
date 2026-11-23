"""La Unión Europea en conjunto (UE-27), de Eurostat: lo que la Parte II de «Datos globales» cuenta de Europa.

Empresas que usan IA (por tamaño, tecnología, uso, motivo y sector), personas que usan IA generativa (para qué, por
edad, por estudios y por qué no la usan), capacidades digitales (niveles y áreas), especialistas en TIC (cuántos, su
peso en el empleo y la parte de mujeres), empresas que los emplean, los buscan o no los encuentran, empresas que forman
en TIC y pymes con intensidad digital al menos básica. Solo el agregado `EU27_2020`: los indicadores, sus códigos y sus
nombres viven en `catalogo_ue.py`. Cada tabla se descarga filtrada a sus códigos; la etiqueta oficial de cada código
se guarda al preparar y la validación se detiene si cambia; cada cifra conserva su marca («e», estimada; «b», ruptura
de serie). Python estándar.

Uso: python3 -m plataforma_datos.ia_y_trabajo.fuentes.ue_eurostat.lector {descargar,preparar,validar,todo}
    [--aceptar-cambio]
"""

import datetime
import math
import sys
from typing import Any

from plataforma_datos.comun import vigencia
from plataforma_datos.comun.entrada_salida import (
    ahora_utc,
    carpetas,
    controles_de_huella,
    leer_json,
    leer_jsonl,
)
from plataforma_datos.comun.nucleo import ARCHIVO_DE_PROCEDENCIA, ArchivoDescargable, Controles
from plataforma_datos.derivados.fuentes.datos_globales.piezas.catalogo_ue import (
    INDICADORES_UE,
    RECUENTO_ESPECIALISTAS_TIC,
    IndicadorUe,
)
from plataforma_datos.derivados.fuentes.datos_globales.piezas.constantes_datos_globales import (
    EUROSTAT_DATOS,
    SIN_CIFRA,
    UE27,
    nota_de_la_marca,
)
from plataforma_datos.ia_y_trabajo.comun.tablas_eurostat import descargar_tablas, preparar_tablas
from plataforma_datos.mercado.fuentes.empresas.piezas.constantes_empresas import (
    LICENCIA_EUROSTAT,
)
from plataforma_datos.orquestacion.admision import cerrar_validacion
from plataforma_datos.orquestacion.ordenes import principal_fuente_con_descarga

FUENTE = "ue-eurostat"
ORIGINAL, PREPARADO, VALIDADO = carpetas(FUENTE)
PROCEDENCIA = ORIGINAL / ARCHIVO_DE_PROCEDENCIA
CIFRAS = PREPARADO / "cifras.jsonl"
TABLAS = PREPARADO / "tablas.json"
TODOS = (*INDICADORES_UE, RECUENTO_ESPECIALISTAS_TIC)
# Desde qué año se piden las tablas: la serie más larga que se guarda (capacidades digitales, 2021).
PRIMER_ANIO = 2021
# Las cifras que son porcentajes no pasan de este máximo (el recuento de especialistas TIC no es un porcentaje).
MAX_PORCENTAJE = 100
TABLAS_DE_LA_UE = tuple(dict.fromkeys(indicador.tabla for indicador in TODOS))


def _filtros(tabla: str) -> str:
    """Los códigos de una tabla que usa algún indicador, como filtros de la API (`&dimensión=código`).

    Returns:
        Los filtros, concatenados.
    """
    codigos: dict[str, list[str]] = {}
    for indicador in TODOS:
        if indicador.tabla == tabla:
            for dimension, codigo in indicador.codigos.items():
                codigos.setdefault(dimension, [])
                if codigo not in codigos[dimension]:
                    codigos[dimension].append(codigo)
    return "".join(f"&{dimension}={codigo}" for dimension, lista in codigos.items() for codigo in lista)


ARCHIVOS: list[ArchivoDescargable] = [
    {
        "archivo": f"eurostat-{tabla}.json",
        "nivel": "oficial",
        "titulo": f"Eurostat, {tabla}: UE-27 (EU27_2020), los códigos que usa la Parte II de «Datos globales», desde "
        f"{PRIMER_ANIO}",
        "url": f"{EUROSTAT_DATOS}/{tabla}?format=JSON&lang=EN&geo={UE27}{_filtros(tabla)}"
        f"&sinceTimePeriod={PRIMER_ANIO}",
        "licencia": LICENCIA_EUROSTAT,
    }
    for tabla in TABLAS_DE_LA_UE
]
CITA = (
    "Eurostat, "
    + ", ".join(f"{tabla} (https://doi.org/10.2908/{tabla.upper()})" for tabla in TABLAS_DE_LA_UE)
    + "; UE-27, versiones filtradas."
)
# Etiquetas oficiales, literales, de los códigos que se usan (comprobadas el 11/10/2026). Si Eurostat cambia una, la
# definición puede haber cambiado: la validación se detiene hasta que una persona la revise y la cambie aquí.
ETIQUETAS = {
    "10-249": "From 10 to 249 persons employed",
    "10-49": "From 10 to 49 persons employed",
    "50-249": "From 50 to 249 persons employed",
    "C10-S951_X_K": "All activities (except agriculture, forestry and fishing, and mining and quarrying), without "
    "financial sector",
    "E_AI_BCDP": "Enterprises do not use AI technologies, because of concerns regarding violation of data protection "
    "and privacy",
    "E_AI_BLE": "Enterprises do not use AI technologies, because of a lack of relevant expertise",
    "E_AI_BLEG": "Enterprises do not use AI technologies, because of a lack of clarity about the legal consequences",
    "E_AI_CC1SI_DA_ANY": "Enterprises use AI technologies or buy sophisticated or intermediate cloud computing "
    "services or perform data analytics",
    "E_AI_EC": "Enterprises that ever considered to use one of the AI technologies: AI_TTM, AI_TSR, AI_TNLG, AI_TIR, "
    "AI_TML, AI_TPA, AI_TAR, E_AI_TPVSG",
    "E_AI_PBAM": "Enterprises using AI technologies for organisation of business administration processes or "
    "management",
    "E_AI_PFIN": "Enterprises using AI technologies for accounting, controlling or finance management",
    "E_AI_PITS": "Enterprises using AI technologies for ICT security",
    "E_AI_PLOG": "Enterprises using AI technologies for logistics",
    "E_AI_PMS": "Enterprises using AI technologies for marketing or sales",
    "E_AI_PPP": "Enterprises using AI technologies for production processes",
    "E_AI_PRDI": "Enterprises using AI technologies for research and development (R&D) or innovation activity",
    "E_AI_TANY": "Enterprises using at least one of the AI technologies: AI_TTM, AI_TSR, AI_TNLG, AI_TIR, AI_TML, "
    "AI_TPA, AI_TAR, E_AI_TPVSG",
    "E_AI_TAR": "Enterprises using AI technologies enabling physical movement of machines via autonomous decisions "
    "based on observation of surroundings (autonomous robots, self-driving vehicles, autonomous drones)",
    "E_AI_TIR": "Enterprises using AI technologies identifying objects or persons based on images (image recognition, "
    "image processing)",
    "E_AI_TML": "Enterprises using machine learning (e.g. deep learning) for data analysis",
    "E_AI_TNLG": "Enterprises using AI technologies generating written or spoken language or programming codes "
    "(natural language generation, speech synthesis)",
    "E_AI_TPA": "Enterprises using AI technologies automating different workflows or assisting in decision making (AI "
    "based software robotic process automation)",
    "E_AI_TPVSG": "Enterprises using AI technologies generating pictures, videos, sound/audio",
    "E_AI_TSR": "Enterprises using AI technologies converting spoken language into machine-readable format (speech "
    "recognition)",
    "E_AI_TTM": "Enterprises using AI technologies performing analysis of written language (text mining)",
    "E_DI3_GELO": "Enterprises with at least basic level of digital intensity (DII Version 3)",
    "E_DI4_GELO": "Enterprises with at least basic level of digital intensity (DII Version 4)",
    "E_ITSP2": "Enterprise employed ICT/IT specialists (reduced comparability with 2007)",
    "E_ITSPDLA": "Difficulty to recruit ICT specialists: Lack of applications",
    "E_ITSPDLET": "Difficulty to recruit ICT specialists: Applicants' lack of relevant ICT qualifications from "
    "education and/or training",
    "E_ITSPDLWE": "Difficulty to recruit ICT specialists: Applicants' lack of relevant work experience",
    "E_ITSPDSAL": "Difficulty to recruit ICT specialists: Applicants' salary expectations too high",
    "E_ITSPRCR2": "Enterprise recruited/tried to recruit personnel for jobs requiring ICT specialist skills (reduced "
    "comparability with 2007)",
    "E_ITSPT2": "Enterprise provided training to ICT/IT specialists to develop their ICT skills",
    "E_ITSPVAC2": "Enterprise had hard-to-fill vacancies for jobs requiring ICT specialist skills (reduced "
    "comparability with 2007)",
    "E_ITT2": "Enterprise provided training to their personnel to develop their ICT skills",
    "E_ITUST2": "Enterprise provided training to other persons employed to develop their ICT skills",
    "F": "Females",
    "F_Y16_74": "Females, 16 to 74 years old",
    "GE10": "10 persons employed or more",
    "GE250": "250 persons employed or more",
    "I0_2": "Individuals with no or low formal education",
    "I3_4": "Individuals with medium formal education",
    "I5_8": "Individuals with high formal education",
    "IND_TOTAL": "All individuals",
    "ISCO0_5": "Non-manual including the armed forces",
    "ISCO6_9": "Manual",
    "I_DSK2_AB": "Individuals with above basic overall digital skills (all five component indicators are at above "
    "basic level)",
    "I_DSK2_B": "Individuals with basic overall digital skills (all five component indicators are at basic or above "
    "basic level, without being all above basic)",
    "I_DSK2_BAB": "Individuals with basic or above basic overall digital skills (all five component indicators are at "
    "basic or above basic level)",
    "I_DSK2_CC_BAB": "Individuals with basic or above basic communication and collaboration skills",
    "I_DSK2_DCC_BAB": "Individuals with basic or above basic digital content creation skills",
    "I_DSK2_IL_BAB": "Individuals with basic or above basic information and data literacy skills",
    "I_DSK2_LM": "Individuals with limited overall digital skills (two out of five component indicators are at basic "
    "or above basic level)",
    "I_DSK2_LW": "Individuals with low overall digital skills (four out of five component indicators are at basic or "
    "above basic level)",
    "I_DSK2_N": "Individuals with narrow overall digital skills (three out of five component indicators are at basic "
    "or above basic level)",
    "I_DSK2_NA": "Digital skills could not be assessed because the individual has not used the internet in the last 3 "
    "months",
    "I_DSK2_PS_BAB": "Individuals with basic or above basic problem solving skills",
    "I_DSK2_SF_BAB": "Individuals with basic or above basic safety skills",
    "I_DSK2_X": "Individuals with no overall digital skills",
    "I_IUAI": "Use of generative AI tools: in the last 3 months",
    "I_IUAIFE": "Use of generative AI tools: for formal education",
    "I_IUAIPR": "Use of generative AI tools: for private purposes",
    "I_IUAIWP": "Use of generative AI tools: for professional (work) purposes",
    "I_IUAIX_NUNN": "Reason for not using generative AI tools: No need",
    "I_IUAIX_NUSEC": "Reason for not using generative AI tools: Concerns about privacy, security, or safety",
    "I_IUAIX_NUUNK": "Reason for not using generative AI tools: Did not know they existed",
    "I_IUAIX_NUUSE": "Reason for not using generative AI tools: Did not know how to use",
    "J": "Information and communication",
    "M_Y16_74": "Males, 16 to 74 years old",
    "PC": "Percentage",
    "PC_EMP": "Percentage of total employment",
    "PC_ENT": "Percentage of enterprises",
    "PC_ENT_ITSPRCR2": "Percentage of enterprises which recruited / tried to recruit personnel for jobs requiring ICT "
    "specialist skills (reduced comparability with 2007)",
    "PC_IND": "Percentage of individuals",
    "PC_IND_IUAIX": "Percentage of individuals who have not used any generative AI tools in the last 3 months",
    "SAL_SELF_FAM": "Employees, self-employed, family workers",
    "THS_PER": "Thousand persons",
    "Y16_24": "Individuals, 16 to 24 years old",
    "Y25_34": "Individuals, 25 to 34 years old",
    "Y35_44": "Individuals, 35 to 44 years old",
    "Y45_54": "Individuals, 45 to 54 years old",
    "Y55_64": "Individuals, 55 to 64 years old",
    "Y55_74": "Individuals, 55 to 74 years old",
    "Y65_74": "Individuals, 65 to 74 years old",
}
# Los códigos que Eurostat usa en dos dimensiones con significado distinto: en la dimensión dicha, su etiqueta es esta
# y no la de ETIQUETAS (F es «Females» en el sexo y la sección F de la CNAE en la actividad).
ETIQUETAS_DE_DIMENSION = {("nace_r2", "F"): "Construction"}


def descargar(aceptar_cambio: bool = False) -> None:
    """Descarga cada tabla filtrada; una versión nueva de Eurostat se detiene hasta aceptarla a propósito."""
    fuente = "Eurostat · la Unión Europea (UE-27): IA, capacidades digitales y especialistas en TIC"
    descargar_tablas(PROCEDENCIA, ARCHIVOS, fuente, CITA, aceptar_cambio=aceptar_cambio)


def preparar() -> None:
    """Pasa cada tabla a filas y guarda, por tabla, su fecha de actualización y las etiquetas de sus códigos."""
    preparar_tablas(FUENTE, ((f"eurostat-{tabla}.json", tabla) for tabla in TABLAS_DE_LA_UE), CIFRAS, TABLAS)


def _con_valor(filas: list[dict[str, Any]], indicador: IndicadorUe) -> list[dict[str, Any]]:
    """Las filas con cifra de un indicador en la UE-27 (su tabla y sus códigos), sin confidenciales ni no aplicables.

    Returns:
        Las filas con cifra.
    """
    return [
        fila
        for fila in filas
        if fila["tabla"] == indicador.tabla
        and fila["geo"] == UE27
        and all(fila.get(clave) == codigo for clave, codigo in indicador.codigos.items())
        and fila["valor"] is not None
        and not any(letra in (fila["marca"] or "") for letra in SIN_CIFRA)
    ]


def serie(filas: list[dict[str, Any]], indicador: IndicadorUe) -> list[dict[str, Any]]:
    """Las cifras con valor de un indicador en la UE-27, la más reciente primero, con su nota.

    Sin `desde`, solo la más reciente. Una confidencial o no aplicable no tiene cifra y no entra.

    Returns:
        Las cifras, la más reciente primero.
    """
    con_valor = sorted(_con_valor(filas, indicador), key=lambda fila: fila["anio"], reverse=True)
    if indicador.desde is None:
        con_valor = con_valor[:1]
    return [
        {"valor": fila["valor"], "anio": fila["anio"], "nota": nota_de_la_marca(fila["marca"])}
        for fila in con_valor
        if indicador.desde is None or fila["anio"] >= indicador.desde
    ]


def etiqueta_esperada(dimension: str, codigo: str) -> str | None:
    """Da la etiqueta oficial vigilada de un código en una dimensión.

    Args:
        dimension: La dimensión de la tabla (`sex`, `nace_r2`…).
        codigo: El código.

    Returns:
        La de ETIQUETAS_DE_DIMENSION si el código cambia de significado en esa dimensión; si no, la de ETIQUETAS, o
        None si no se vigila.
    """
    return ETIQUETAS_DE_DIMENSION.get((dimension, codigo), ETIQUETAS.get(codigo))


def _controles(controles: Controles, filas: list[dict[str, Any]], tablas: dict[str, Any]) -> dict[str, Any]:
    """Registra definiciones, rangos, cobertura y unicidad de las series.

    Args:
        controles: Donde se registran.
        filas: Las cifras preparadas de todas las tablas.
        tablas: Por tabla, su información y las etiquetas oficiales de sus códigos.

    Returns:
        {indicador: su serie}.
    """
    # La etiqueta de cada código en cada tabla que lo usa: un mismo código puede ser de dimensiones distintas en
    # tablas distintas (ETIQUETAS_DE_DIMENSION), así que no se funden las etiquetas de todas las tablas.
    cambiadas = {
        f"{indicador.tabla}:{codigo}": tablas.get(indicador.tabla, {}).get("etiquetas", {}).get(codigo)
        for indicador in TODOS
        for dimension, codigo in indicador.codigos.items()
        if tablas.get(indicador.tabla, {}).get("etiquetas", {}).get(codigo) != etiqueta_esperada(dimension, codigo)
    }
    controles.comprobar(
        not cambiadas,
        "la etiqueta oficial de cada código usado no ha cambiado" + (f": {cambiadas}" if cambiadas else ""),
    )
    usados = {codigo for indicador in TODOS for codigo in indicador.codigos.values()}
    controles.comprobar(usados == set(ETIQUETAS), "cada código usado tiene su etiqueta vigilada")
    repetidos = sorted(
        indicador.id
        for indicador in TODOS
        if len(anios := [fila["anio"] for fila in _con_valor(filas, indicador)]) != len(set(anios))
    )
    controles.comprobar(
        not repetidos,
        "una sola cifra por indicador y año (los códigos fijados la identifican)"
        + (f"; con varias: {repetidos}" if repetidos else ""),
    )
    series = {indicador.id: serie(filas, indicador) for indicador in TODOS}
    vacios = sorted(id_ for id_, cifras in series.items() if not cifras)
    controles.comprobar(
        not vacios, "cada indicador tiene cifra en la UE-27" + (f"; sin cifra: {vacios}" if vacios else "")
    )
    indicador_por_id = {indicador.id: indicador for indicador in TODOS}
    fuera = sorted(
        id_
        for id_, cifras in series.items()
        if id_ != RECUENTO_ESPECIALISTAS_TIC.id
        and not all(0 <= fila["valor"] <= MAX_PORCENTAJE for fila in _con_valor(filas, indicador_por_id[id_]))
    )
    controles.comprobar(
        not fuera, f"cada porcentaje está entre 0 y {MAX_PORCENTAJE}" + (f"; fuera: {fuera}" if fuera else "")
    )
    recuentos = _con_valor(filas, RECUENTO_ESPECIALISTAS_TIC)
    controles.comprobar(
        all(math.isfinite(fila["valor"]) and fila["valor"] >= 0 for fila in recuentos),
        "cada recuento de especialistas TIC es finito y no negativo",
    )
    controles.comprobar(
        all(fila["anio"] <= datetime.datetime.now(datetime.UTC).year for fila in filas),
        "ninguna tabla contiene un año futuro",
    )
    return series


def validar() -> None:
    """Comprueba definiciones, rangos, cobertura y unicidad, y guarda el conjunto."""
    filas, tablas, procedencia = leer_jsonl(CIFRAS), leer_json(TABLAS), leer_json(PROCEDENCIA)
    controles = Controles()
    controles_de_huella(controles, ORIGINAL, procedencia)
    series = _controles(controles, filas, tablas)
    consultado, vigencias = vigencia.de_eurostat(filas, tablas, procedencia)
    vigencia.comprobar(controles, vigencias)
    conjunto = {
        "cita": CITA,
        "licencia": LICENCIA_EUROSTAT,
        "consultado": max(consultado.values()),
        "vigencia": vigencias,
        "cifras": {id_: cifras for id_, cifras in series.items() if id_ != RECUENTO_ESPECIALISTAS_TIC.id},
        "recuentos": {RECUENTO_ESPECIALISTAS_TIC.id: series[RECUENTO_ESPECIALISTAS_TIC.id]},
    }
    informe = {
        "estado": controles.estado,
        "comprobado_utc": ahora_utc(),
        "cobertura": {"indicadores": len(series), "tablas": len(tablas)},
        "limites": "Solo la UE-27 en conjunto, de las encuestas europeas (medido). Cada porcentaje tiene su base en "
        "la definición de su indicador (catalogo_ue.py); no se recalcula ninguna base. Las cifras marcadas «e» "
        "(estimadas por Eurostat) viajan con su nota.",
        "controles": controles.lista,
    }
    cerrar_validacion(FUENTE, informe, controles, lambda: conjunto)


def main(argv: list[str] | None = None) -> int:
    """Ejecuta las etapas de los indicadores de Eurostat por línea de órdenes: descargar, preparar, validar o todo.

    Args:
        argv: Los argumentos; None toma los de la línea de órdenes.

    Returns:
        El código de salida del proceso.
    """
    return principal_fuente_con_descarga(
        __doc__,
        descargar=descargar,
        preparacion_y_validacion={"preparar": preparar, "validar": validar},
        argumentos=argv,
    )


if __name__ == "__main__":
    sys.exit(main())
