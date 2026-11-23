"""Uso de la IA en Europa, de Eurostat: empresas que usan IA y personas que usan IA generativa, por país.

Las encuestas comunitarias (uso de las TIC en las empresas y en los hogares, y la EPA) hacen la misma pregunta en
todos los países europeos, así que sus cifras se comparan entre sí. Cada cifra se guarda desde 2023 (las empresas con
IA y la formación de adultos, desde 2021), la más reciente primero, para dibujar su evolución. Se guardan, de la
versión vigente de cada tabla:

- `isoc_eb_ai`: % de empresas de 10 o más personas que usan alguna tecnología de IA (`E_AI_TANY`), desde 2021 (2022
  no preguntó por la IA); la cifra de 2021 lleva la nota «definicion_anterior»: la encuesta preguntaba por menos
  tecnologías;
- `isoc_ai_iaiu`: % de personas de 16 a 74 años que usaron IA generativa en tres meses (`I_IUAI`) y para trabajar
  (`I_IUAIWP`), en total, por sexo y en las ocupaciones no manuales, manuales y TIC (solo hay 2025);
- `trng_lfse_04`: % de personas de 25 a 64 años en educación o formación en las 4 últimas semanas (EPA), en total
  y por sexo, desde 2021, en los países, la UE-27 y Cataluña (región NUTS 2 ES51);
- `lfsa_egai2d`: personas ocupadas por gran grupo ISCO-08 en Alemania, España, Francia e Italia, que no llega al
  paquete del motor: se guarda en el conjunto validado para el contraste del empleo de ILOSTAT
  (`mercado/fuentes/ilostat/lector.py`).

La etiqueta oficial de cada código se guarda al preparar y la validación se detiene si cambia: una definición que
cambia (como la entrada de la generación de imagen, vídeo o audio en `E_AI_TANY`) no se compara con la anterior sin
que una persona lo decida. Cada cifra conserva su marca. Python estándar.

Uso: python3 -m plataforma_datos.ia_y_trabajo.fuentes.mundo_eurostat.lector {descargar,preparar,validar,todo}
    [--aceptar-cambio]
"""

import datetime
import math
import sys
from collections import Counter
from typing import Any

from plataforma_datos.comun import vigencia
from plataforma_datos.comun.entrada_salida import (
    ahora_utc,
    carpetas,
    controles_de_huella,
    leer_json,
    leer_jsonl,
)
from plataforma_datos.comun.nucleo import (
    ARCHIVO_DE_PROCEDENCIA,
    ArchivoDescargable,
    Controles,
)
from plataforma_datos.derivados.fuentes.datos_globales.piezas.constantes_datos_globales import (
    CATALUNA,
    EUROSTAT_DATOS,
    NOTA_DEFINICION_ANTERIOR,
    NOTA_POCO_FIABLE,
    SIN_CIFRA,
    UE27,
    nota_de_la_marca,
)
from plataforma_datos.ia_y_trabajo.comun.tablas_eurostat import descargar_tablas, preparar_tablas
from plataforma_datos.mercado.fuentes.empresas.piezas.constantes_empresas import (
    LICENCIA_EUROSTAT,
    MAX_DIFERENCIA_INE_EUROSTAT,
)
from plataforma_datos.orquestacion.admision import cerrar_validacion, leer_validado
from plataforma_datos.orquestacion.ordenes import principal_fuente_con_descarga

FUENTE = "mundo-eurostat"
ORIGINAL, PREPARADO, VALIDADO = carpetas(FUENTE)
PROCEDENCIA = ORIGINAL / ARCHIVO_DE_PROCEDENCIA
# Lo que escribe preparar y lee validar: una cifra por fila y, por tabla, su fecha y las etiquetas de sus códigos.
CIFRAS = PREPARADO / "cifras.jsonl"
TABLAS = PREPARADO / "tablas.json"
# Miles de personas ocupadas por país → año → sexo → gran grupo ISCO-08.
type EmpleoPorGrupo = dict[str, dict[str, dict[str, dict[str, float]]]]
# El tope de una cifra en porcentaje (unidad PC_*): de 0 a 100.
PORCENTAJE_ENTERO = 100

# La IA generativa por personas, con dos bases que nunca se mezclan: todas las personas de 16 a 74 años (`PC_IND`) o
# solo las que usaron internet en los tres meses anteriores (`PC_IND_IU3`), la base con que el Idescat publica la de
# Cataluña. La segunda lleva el sufijo «-usuarios-internet» en el identificador.
IA_GENERATIVA = {
    "personas-ia-generativa": ("I_IUAI", "IND_TOTAL"),
    "personas-ia-generativa-trabajo": ("I_IUAIWP", "IND_TOTAL"),
    "mujeres-ia-generativa": ("I_IUAI", "F_Y16_74"),
    "hombres-ia-generativa": ("I_IUAI", "M_Y16_74"),
    "mujeres-ia-generativa-trabajo": ("I_IUAIWP", "F_Y16_74"),
    "hombres-ia-generativa-trabajo": ("I_IUAIWP", "M_Y16_74"),
    "ia-generativa-trabajo-no-manual": ("I_IUAIWP", "ISCO0_5"),
    "ia-generativa-trabajo-manual": ("I_IUAIWP", "ISCO6_9"),
    "ia-generativa-trabajo-tic": ("I_IUAIWP", "ISCO_ICT"),
}
UNIDADES_DE_LA_IA_GENERATIVA = {"": "PC_IND", "-usuarios-internet": "PC_IND_IU3"}
# Cada indicador del catálogo (constantes_datos_globales.py) con la tabla y los códigos de la cifra que lo da.
CODIGOS_DE_CADA_INDICADOR = {
    "empresas-ia": (
        "isoc_eb_ai",
        {"indic_is": "E_AI_TANY", "unit": "PC_ENT", "size_emp": "GE10", "nace_r2": "C10-S951_X_K"},
    ),
    **{
        f"{indicador}{sufijo}": ("isoc_ai_iaiu", {"indic_is": indic_is, "ind_type": ind_type, "unit": unidad})
        for sufijo, unidad in UNIDADES_DE_LA_IA_GENERATIVA.items()
        for indicador, (indic_is, ind_type) in IA_GENERATIVA.items()
    },
    "formacion-adultos": ("trng_lfse_04", {"sex": "T", "age": "Y25-64", "unit": "PC"}),
    "formacion-adultos-mujeres": ("trng_lfse_04", {"sex": "F", "age": "Y25-64", "unit": "PC"}),
    "formacion-adultos-hombres": ("trng_lfse_04", {"sex": "M", "age": "Y25-64", "unit": "PC"}),
}
# Cada cifra se guarda desde este año, de la más reciente a la más antigua: la serie que dibuja la página.
PRIMER_ANIO_DE_LA_SERIE = 2023
# La formación de adultos no cambió de definición: su serie empieza antes (2021 lleva la ruptura «b» de la EPA).
PRIMER_ANIO_DE_LA_FORMACION = 2021
# Las empresas con IA, desde la primera encuesta que preguntó por la IA (2021; la de 2022, no). Hasta
# ULTIMO_ANIO_DE_LA_DEFINICION_ANTERIOR, `E_AI_TANY` contaba menos tecnologías de IA que hoy (la lista cambió con la
# encuesta de 2023): esas cifras llevan la nota «definicion_anterior», salvo que Eurostat ya les ponga una marca.
PRIMER_ANIO_DE_LAS_EMPRESAS = 2021
ULTIMO_ANIO_DE_LA_DEFINICION_ANTERIOR = 2021
PRIMER_ANIO_DE_LA_TABLA = {"isoc_eb_ai": PRIMER_ANIO_DE_LAS_EMPRESAS, "trng_lfse_04": PRIMER_ANIO_DE_LA_FORMACION}
EMPLEO = "lfsa_egai2d"
PAISES_DEL_CONTRASTE = ("DE", "ES", "FR", "IT")
GRUPOS_EUROSTAT = ("TOTAL", "OC1", "OC2", "OC3", "OC4", "OC5", "OC6", "OC7", "OC8", "OC9", "OC0")
ARCHIVOS: list[ArchivoDescargable] = [
    {
        "archivo": "eurostat-isoc_eb_ai.json",
        "nivel": "oficial",
        "titulo": "Eurostat, isoc_eb_ai: empresas de 10 o más personas que usan alguna tecnología de IA, por país",
        "url": f"{EUROSTAT_DATOS}/isoc_eb_ai?format=JSON&lang=EN&indic_is=E_AI_TANY&unit=PC_ENT&size_emp=GE10",
        "licencia": LICENCIA_EUROSTAT,
    },
    {
        "archivo": "eurostat-isoc_ai_iaiu.json",
        "nivel": "oficial",
        "titulo": "Eurostat, isoc_ai_iaiu: personas que usan IA generativa (total, por sexo y por ocupación), por "
        "país, en % de toda la población y de los usuarios de internet",
        "url": f"{EUROSTAT_DATOS}/isoc_ai_iaiu?format=JSON&lang=EN"
        + "".join(f"&unit={unidad}" for unidad in UNIDADES_DE_LA_IA_GENERATIVA.values())
        + "".join(f"&indic_is={codigo}" for codigo in dict.fromkeys(codigo for codigo, _ in IA_GENERATIVA.values()))
        + "".join(f"&ind_type={tipo}" for tipo in dict.fromkeys(tipo for _, tipo in IA_GENERATIVA.values())),
        "licencia": LICENCIA_EUROSTAT,
    },
    {
        "archivo": "eurostat-trng_lfse_04.json",
        "nivel": "oficial",
        "titulo": "Eurostat, trng_lfse_04: personas de 25 a 64 años en educación o formación en las 4 últimas semanas, "
        "por sexo, países y regiones NUTS 2, desde 2021",
        "url": f"{EUROSTAT_DATOS}/trng_lfse_04?format=JSON&lang=EN&age=Y25-64&unit=PC"
        f"&sinceTimePeriod={PRIMER_ANIO_DE_LA_FORMACION}",
        "licencia": LICENCIA_EUROSTAT,
    },
    {
        "archivo": "eurostat-lfsa_egai2d.json",
        "nivel": "oficial",
        "titulo": "Eurostat, lfsa_egai2d: personas ocupadas de 15 años o más por gran grupo ISCO-08 y sexo, "
        f"{', '.join(PAISES_DEL_CONTRASTE[:-1])} e {PAISES_DEL_CONTRASTE[-1]}, desde {PRIMER_ANIO_DE_LA_SERIE} "
        "(contraste del empleo de ILOSTAT)",
        "url": f"{EUROSTAT_DATOS}/lfsa_egai2d?format=JSON&lang=EN&unit=THS_PER&age=Y_GE15&sex=T&sex=F"
        + "".join(f"&geo={pais}" for pais in PAISES_DEL_CONTRASTE)
        + "".join(f"&isco08={grupo}" for grupo in GRUPOS_EUROSTAT)
        + f"&sinceTimePeriod={PRIMER_ANIO_DE_LA_SERIE}",
        "licencia": LICENCIA_EUROSTAT,
    },
]
TABLA_DEL_ARCHIVO = {
    archivo["archivo"]: archivo["archivo"].removeprefix("eurostat-").removesuffix(".json") for archivo in ARCHIVOS
}
# Etiquetas oficiales, literales, de los códigos que se usan (comprobadas el 11/10/2026). Si Eurostat cambia una, la
# definición puede haber cambiado: la validación se detiene hasta que una persona la revise y la cambie aquí.
ETIQUETAS = {
    "E_AI_TANY": "Enterprises using at least one of the AI technologies: AI_TTM, AI_TSR, AI_TNLG, AI_TIR, AI_TML, "
    "AI_TPA, AI_TAR, E_AI_TPVSG",
    "PC_ENT": "Percentage of enterprises",
    "GE10": "10 persons employed or more",
    "C10-S951_X_K": "All activities (except agriculture, forestry and fishing, and mining and quarrying), without "
    "financial sector",
    "I_IUAI": "Use of generative AI tools: in the last 3 months",
    "I_IUAIWP": "Use of generative AI tools: for professional (work) purposes",
    "PC_IND": "Percentage of individuals",
    "PC_IND_IU3": "Percentage of individuals who used internet in the last 3 months",
    "IND_TOTAL": "All individuals",
    "F_Y16_74": "Females, 16 to 74 years old",
    "M_Y16_74": "Males, 16 to 74 years old",
    "ISCO0_5": "Non-manual including the armed forces",
    "ISCO6_9": "Manual",
    "ISCO_ICT": "ICT professionals",
    "PC": "Percentage",
    "Y25-64": "From 25 to 64 years",
    "T": "Total",
    "F": "Females",
    "M": "Males",
}
# Cifras que el INE publica de la misma encuesta (TIC-H 2025, nota de prensa del 20/11/2025): el % de personas de 16 a
# 74 años que usaron IA generativa. Las del trabajo por ocupación están en el conjunto validado de `tich`.
INE_IA_GENERATIVA_2025 = 37.9
# El año de esa cifra: con él se busca la de Eurostat, no con la más reciente de la serie.
ANIO_DE_INE_IA_GENERATIVA = 2025
# Eurostat y el INE difunden la misma encuesta: a la décima, no difieren más de esto (redondeo).
MAX_DIFERENCIA_CON_EL_INE = 0.5
TERRITORIOS_DE_LA_COMPARACION = (UE27, "ES", "DE", "FR", "IT")
# Un país en Eurostat se escribe con dos letras; «EA» (la zona del euro) es la única agregación con dos.
LETRAS_DE_UN_PAIS = 2
ZONAS_DE_DOS_LETRAS = ("EA",)
# Los indicadores que Eurostat también da para Cataluña (región NUTS 2): tienen que estar.
DE_CATALUNA = ("formacion-adultos", "formacion-adultos-mujeres", "formacion-adultos-hombres")
# Francia no da la clase de ocupación (manual o no manual) en `isoc_ai_iaiu` 2025: la tabla trae esas celdas vacías,
# sin marca (comprobado el 11/10/2026). Son huecos permitidos: si Eurostat los completa, la cifra entra.
HUECOS_CONOCIDOS = {
    (f"ia-generativa-trabajo-{clase}{sufijo}", "FR")
    for clase in ("manual", "no-manual")
    for sufijo in UNIDADES_DE_LA_IA_GENERATIVA
}
# Cada clase del trabajo de la TIC-H del INE y su indicador de IA generativa de Eurostat (el contraste con el INE).
INDICADOR_DE_LA_CLASE = {
    "manual": "ia-generativa-trabajo-manual",
    "no_manual": "ia-generativa-trabajo-no-manual",
    "tic": "ia-generativa-trabajo-tic",
}
CITA = (
    "Eurostat, isoc_eb_ai (https://doi.org/10.2908/ISOC_EB_AI), isoc_ai_iaiu (https://doi.org/10.2908/ISOC_AI_IAIU), "
    "lfsa_egai2d (https://doi.org/10.2908/LFSA_EGAI2D) y trng_lfse_04 (https://doi.org/10.2908/TRNG_LFSE_04), "
    "versiones filtradas."
)


# ---------------------------------------------------------------------------------------------------------------------
# Preparar: cada cifra en una fila, con su marca
# ---------------------------------------------------------------------------------------------------------------------


def descargar(aceptar_cambio: bool = False) -> None:
    """Descarga las cuatro tablas filtradas; una versión nueva de Eurostat se detiene hasta aceptarla a propósito."""
    fuente = "Eurostat · uso de la IA en empresas y personas, y empleo por ocupación"
    descargar_tablas(PROCEDENCIA, ARCHIVOS, fuente, CITA, aceptar_cambio=aceptar_cambio)


def preparar() -> None:
    """Pasa cada tabla a filas y guarda, por tabla, su fecha de actualización y las etiquetas de sus códigos."""
    preparar_tablas(FUENTE, TABLA_DEL_ARCHIVO.items(), CIFRAS, TABLAS)


# ---------------------------------------------------------------------------------------------------------------------
# Validar: definiciones, rangos, marcas, cobertura y contraste con el INE
# ---------------------------------------------------------------------------------------------------------------------


def _es_del_indicador(fila: dict[str, Any], indicador: str) -> bool:
    """Comprueba si una fila es la cifra de un indicador: su tabla y todos sus códigos.

    Returns:
        True si la tabla y cada código coinciden con los del indicador.
    """
    tabla, codigos = CODIGOS_DE_CADA_INDICADOR[indicador]
    return fila["tabla"] == tabla and all(fila.get(clave) == codigo for clave, codigo in codigos.items())


def serie_del_territorio(filas: list[dict[str, Any]], indicador: str, geo: str) -> list[dict[str, Any]]:
    """Reúne las cifras con valor de un indicador en un territorio desde el primer año de su serie.

    Cada una con su año y su nota; una confidencial o no aplicable no tiene cifra y no entra.

    Returns:
        Las cifras con su año y su nota, la más reciente primero.
    """
    tabla = CODIGOS_DE_CADA_INDICADOR[indicador][0]
    desde = PRIMER_ANIO_DE_LA_TABLA.get(tabla, PRIMER_ANIO_DE_LA_SERIE)
    con_valor = [
        fila
        for fila in filas
        if fila["geo"] == geo
        and _es_del_indicador(fila, indicador)
        and fila["valor"] is not None
        and not any(letra in (fila["marca"] or "") for letra in SIN_CIFRA)
        and fila["anio"] >= desde
    ]
    return [
        {"valor": fila["valor"], "anio": fila["anio"], "nota": nota_de_la_cifra(fila)}
        for fila in sorted(con_valor, key=lambda fila: fila["anio"], reverse=True)
    ]


def nota_de_la_cifra(fila: dict[str, Any]) -> str | None:
    """Escoge la nota de una cifra: la marca de Eurostat o, si no tiene, la definición anterior de las empresas con IA.

    Returns:
        La nota, o None si la cifra no lleva ninguna.
    """
    nota = nota_de_la_marca(fila["marca"])
    if nota is None and fila["tabla"] == "isoc_eb_ai" and fila["anio"] <= ULTIMO_ANIO_DE_LA_DEFINICION_ANTERIOR:
        return NOTA_DEFINICION_ANTERIOR
    return nota


def es_territorio_del_archivo(geo: str) -> bool:
    """Comprueba si un código de Eurostat es de un país, de la UE-27 o de Cataluña; las demás regiones no entran.

    Returns:
        True si el territorio entra en el archivo.
    """
    return geo in (UE27, CATALUNA) or (len(geo) == LETRAS_DE_UN_PAIS and geo not in ZONAS_DE_DOS_LETRAS)


def cifras_por_indicador(filas: list[dict[str, Any]]) -> dict[str, dict[str, list[dict[str, Any]]]]:
    """Agrupa por indicador y código de territorio de Eurostat su serie desde el primer año de su tabla.

    Las filas se agrupan una vez por territorio: cada serie recorre solo las del suyo.

    Returns:
        Indicador → territorio → su serie, la cifra más reciente primero.
    """
    por_territorio: dict[str, list[dict[str, Any]]] = {}
    for fila in filas:
        if fila["tabla"] != EMPLEO and es_territorio_del_archivo(fila["geo"]):
            por_territorio.setdefault(fila["geo"], []).append(fila)
    territorios = sorted(por_territorio)
    resultado: dict[str, dict[str, list[dict[str, Any]]]] = {}
    for indicador in CODIGOS_DE_CADA_INDICADOR:
        series = {geo: serie_del_territorio(por_territorio[geo], indicador, geo) for geo in territorios}
        resultado[indicador] = {geo: serie for geo, serie in series.items() if serie}
    return resultado


def empleo_por_grupo(filas: list[dict[str, Any]]) -> EmpleoPorGrupo:
    """Reúne las personas ocupadas (miles) por país, año, sexo y gran grupo («1»…«9», «0» y «TOTAL»).

    Solo las cifras firmes: sin las que no tienen valor, las poco fiables («u») ni las confidenciales o no aplicables.

    Returns:
        País → año → sexo → gran grupo → miles de personas ocupadas.
    """
    empleo: EmpleoPorGrupo = {}
    for fila in filas:
        if (
            fila["tabla"] == EMPLEO
            and fila["valor"] is not None
            and not any(letra in (fila["marca"] or "") for letra in SIN_CIFRA)
            and nota_de_la_marca(fila["marca"]) != NOTA_POCO_FIABLE
        ):
            grupo = fila["isco08"].removeprefix("OC")
            por_sexo = empleo.setdefault(fila["geo"], {}).setdefault(str(fila["anio"]), {})
            por_sexo.setdefault(fila["sex"], {})[grupo] = fila["valor"]
    return empleo


def _controles_del_empleo(controles: Controles, filas: list[dict[str, Any]]) -> None:
    """Protege la base y la cobertura mínima que consume el contraste de ILOSTAT."""
    empleo = [fila for fila in filas if fila["tabla"] == EMPLEO]
    controles.comprobar(
        all(
            fila.get("unit") == "THS_PER"
            and fila.get("age") == "Y_GE15"
            and fila.get("sex") in ("T", "F")
            and fila.get("isco08") in GRUPOS_EUROSTAT
            for fila in empleo
        ),
        "el empleo mantiene unidad, edad, sexo y grandes grupos ISCO-08",
    )
    repetidos = [
        clave
        for clave, numero in Counter(
            (fila["geo"], fila["anio"], fila["sex"], fila["isco08"]) for fila in empleo
        ).items()
        if numero > 1
    ]
    controles.comprobar(
        not repetidos,
        "una sola cifra de empleo por territorio, año, sexo y grupo"
        + (f"; repetidas: {repetidos}" if repetidos else ""),
    )
    controles.comprobar(
        all(math.isfinite(fila["valor"]) and fila["valor"] >= 0 for fila in empleo if fila["valor"] is not None),
        "cada recuento de empleo es finito y no negativo",
    )
    por_pais = empleo_por_grupo(empleo)
    faltan = [
        pais
        for pais in PAISES_DEL_CONTRASTE
        if not any(por_sexo.get("T", {}).get("TOTAL", 0) > 0 for por_sexo in por_pais.get(pais, {}).values())
    ]
    controles.comprobar(
        not faltan,
        "el empleo conserva un total de sexo T utilizable en cada país del contraste"
        + (f"; sin total: {faltan}" if faltan else ""),
    )


def _controles(controles: Controles, filas: list[dict[str, Any]], tablas: dict[str, Any]) -> dict[str, Any]:
    """Registra los controles de la fuente.

    Returns:
        Las cifras por indicador, todas: los controles no las filtran.
    """
    # Un código puede aparecer en varias tablas: ninguna etiqueta posterior debe ocultar otra que cambió.
    etiquetas: dict[str, set[str]] = {}
    for tabla in tablas.values():
        for codigo, texto in tabla["etiquetas"].items():
            etiquetas.setdefault(codigo, set()).add(texto)
    cambiadas = {
        codigo: sorted(etiquetas.get(codigo, set()))
        for codigo, texto in ETIQUETAS.items()
        if etiquetas.get(codigo) != {texto}
    }
    controles.comprobar(
        not cambiadas,
        "la etiqueta oficial de cada código usado no ha cambiado" + (f": {cambiadas}" if cambiadas else ""),
    )
    porcentajes = [fila["valor"] for fila in filas if fila["tabla"] != EMPLEO and fila["valor"] is not None]
    controles.comprobar(
        all(0 <= valor <= PORCENTAJE_ENTERO for valor in porcentajes),
        f"todos los porcentajes están entre 0 y {PORCENTAJE_ENTERO}",
    )
    cifras = cifras_por_indicador(filas)
    huecos = {
        (indicador, geo)
        for indicador, por_geo in cifras.items()
        for geo in TERRITORIOS_DE_LA_COMPARACION
        if geo not in por_geo
    } | {(indicador, CATALUNA) for indicador in DE_CATALUNA if CATALUNA not in cifras[indicador]}
    controles.comprobar(
        huecos <= HUECOS_CONOCIDOS,
        "cada indicador tiene cifra en la UE-27, España, Alemania, Francia e Italia, salvo los huecos conocidos de "
        f"Eurostat {sorted(HUECOS_CONOCIDOS)}"
        + (f"; huecos de hoy: {sorted(huecos)}" if not huecos <= HUECOS_CONOCIDOS else ""),
    )
    repetidos = sorted(
        (indicador, geo, anio)
        for indicador in CODIGOS_DE_CADA_INDICADOR
        for (geo, anio), numero in Counter(
            (fila["geo"], fila["anio"]) for fila in filas if _es_del_indicador(fila, indicador)
        ).items()
        if numero > 1
    )
    controles.comprobar(
        not repetidos,
        "una sola cifra por indicador, territorio y año" + (f"; repetidas: {repetidos}" if repetidos else ""),
    )
    _controles_del_empleo(controles, filas)
    controles.comprobar(
        all(fila["anio"] <= datetime.datetime.now(datetime.UTC).year for fila in filas),
        "ninguna tabla contiene un año futuro",
    )
    return cifras


def _cifra_de_espana(cifras: dict[str, Any], indicador: str, anio: int) -> float | None:
    """Busca la cifra de España de un indicador en un año concreto.

    Returns:
        La cifra, o None si la serie no la trae.
    """
    return next((cifra["valor"] for cifra in cifras[indicador].get("ES", []) if cifra["anio"] == anio), None)


def _aun_sin_publicar(
    controles: Controles, cifras: dict[str, Any], indicadores: list[str], anio: int, que: str
) -> bool:
    """Registra el contraste como pendiente si Eurostat aún no ha publicado el año del INE en esos indicadores.

    Solo cuenta como «aún sin publicar» que la serie de España no llegue a ese año: si trae ese año o uno posterior,
    el contraste se hace y una cifra que falte en un año publicado lo hace fallar.

    Returns:
        True si el contraste queda pendiente.
    """
    ultimo = max(
        (cifra["anio"] for indicador in indicadores for cifra in cifras[indicador].get("ES", [])), default=None
    )
    if ultimo is None or ultimo >= anio:
        return False
    controles.comprobar(
        ultimo < anio,
        f"{que}, {anio}: Eurostat aún no publica {anio} (su último año es {ultimo}); "
        "el contraste con el INE queda pendiente de esa publicación",
    )
    return True


def _contraste_con_el_ine(controles: Controles, cifras: dict[str, Any]) -> None:
    """España: Eurostat frente a lo que publica el INE de las mismas encuestas, cada una con el año de la del INE.

    El año es el de la cifra del INE (INE_IA_GENERATIVA_2025) o el que declara su conjunto validado: la TIC-H de `tich`
    («anio») y la ETICCE de `empresas` (el periodo de su vigencia). Si la serie de Eurostat aún no llega a ese año, el
    contraste queda pendiente de su publicación; si llega y no tiene la cifra o no cuadra, el control falla.
    """
    anio = ANIO_DE_INE_IA_GENERATIVA
    que = "IA generativa en España"
    if not _aun_sin_publicar(controles, cifras, ["personas-ia-generativa"], anio, que):
        total = _cifra_de_espana(cifras, "personas-ia-generativa", anio)
        controles.comprobar(
            total is not None and abs(total - INE_IA_GENERATIVA_2025) <= MAX_DIFERENCIA_CON_EL_INE,
            f"{que}, {anio}: Eurostat {total} frente al INE {INE_IA_GENERATIVA_2025} (±{MAX_DIFERENCIA_CON_EL_INE})",
        )
    tich = leer_validado("tich")
    anio = int(tich["anio"])
    que = "IA generativa para trabajar en España (manual, no manual y TIC)"
    if not _aun_sin_publicar(controles, cifras, list(INDICADOR_DE_LA_CLASE.values()), anio, que):
        diferencias = {
            clase: (_cifra_de_espana(cifras, indicador, anio), tich["espana_grupos"][clase]["pct"])
            for clase, indicador in INDICADOR_DE_LA_CLASE.items()
        }
        lejos = {
            clase: par
            for clase, par in diferencias.items()
            if par[0] is None or abs(par[0] - par[1]) > MAX_DIFERENCIA_CON_EL_INE
        }
        controles.comprobar(
            not lejos,
            f"{que}, {anio}: Eurostat frente a la TIC-H del INE" + (f"; no cuadran {lejos}" if lejos else ""),
        )
    empresas = leer_validado("empresas")
    anio = int(empresas["vigencia"]["periodo"].partition("-")[0])
    que = "empresas con IA en España"
    if not _aun_sin_publicar(controles, cifras, ["empresas-ia"], anio, que):
        europa = _cifra_de_espana(cifras, "empresas-ia", anio)
        controles.comprobar(
            europa is not None and abs(europa - empresas["espana"]["total"]) <= MAX_DIFERENCIA_INE_EUROSTAT,
            f"{que}, {anio}: Eurostat {europa} frente a la ETICCE del INE "
            f"{empresas['espana']['total']} (±{MAX_DIFERENCIA_INE_EUROSTAT})",
        )


def validar() -> None:
    """Comprueba las definiciones, los rangos, la cobertura y el contraste con el INE, y guarda el conjunto."""
    filas, tablas, procedencia = leer_jsonl(CIFRAS), leer_json(TABLAS), leer_json(PROCEDENCIA)
    controles = Controles()
    controles_de_huella(controles, ORIGINAL, procedencia)
    cifras = _controles(controles, filas, tablas)
    _contraste_con_el_ine(controles, cifras)
    consultado, vigencias = vigencia.de_eurostat(filas, tablas, procedencia)
    vigencia.comprobar(controles, vigencias)
    conjunto = {
        "cita": CITA,
        "licencia": LICENCIA_EUROSTAT,
        "consultado": max(consultado.values()),
        "vigencia": vigencias,
        "cifras": cifras,
        "empleo_por_grupo": empleo_por_grupo(filas),
    }
    informe = {
        "estado": controles.estado,
        "comprobado_utc": ahora_utc(),
        "cobertura": {indicador: len(por_geo) for indicador, por_geo in cifras.items()},
        "limites": "Misma encuesta en todos los países europeos; sin regiones en la IA generativa. Cataluña "
        f"({CATALUNA}) solo en la formación de adultos de esta fuente y en las empresas, de `empresas`. Una cifra "
        "marcada como poco fiable viaja con su nota y no se da como firme; una confidencial no tiene cifra. EE. UU. no "
        "hace esta encuesta.",
        "controles": controles.lista,
    }
    cerrar_validacion(FUENTE, informe, controles, lambda: conjunto)


def main(argv: list[str] | None = None) -> int:
    """Ejecuta la interfaz de línea de órdenes: descargar, preparar, validar o todo.

    Returns:
        El código de salida de la orden.
    """
    return principal_fuente_con_descarga(
        __doc__,
        descargar=descargar,
        preparacion_y_validacion={"preparar": preparar, "validar": validar},
        argumentos=argv,
    )


if __name__ == "__main__":
    sys.exit(main())
