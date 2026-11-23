"""Controles de las tablas, correspondencias de actividad y contraste de ETICCE y Eurostat."""

import math
from typing import Any

import plataforma_datos.mercado.fuentes.empresas.piezas.contrato_eticce as contrato_eticce
from plataforma_datos.comun.nucleo import Controles
from plataforma_datos.comun.textos_y_cifras import numero_es
from plataforma_datos.mercado.fuentes.empresas.piezas.cifras_empresas import agregados_eurostat, divisiones_existentes
from plataforma_datos.mercado.fuentes.empresas.piezas.constantes_empresas import (
    ANIOS_DE_CATALUNA,
    CAPITULOS,
    CATALUNA,
    DIVISIONES_FINANCIERAS,
    GRANDES_SECTORES,
    MAX_DIFERENCIA_INE_EUROSTAT,
    POCO_FIABLE,
    PORCENTAJE_MAXIMO,
    PRIMERA_DIVISION_MEDIDA,
    TOTAL_EMPRESAS,
    ULTIMA_DIVISION_MEDIDA,
)


def comprobar_tablas(controles: Controles, filas: list[dict[str, Any]], edicion: dict[str, Any]) -> None:
    """Cada parte trae la pregunta E.1 (una sola), Cataluña y los errores, con cifras entre 0 y 100."""
    pregunta = "D.1" if contrato_eticce.es_contrato_2026(edicion) else "E.1"
    preguntas = {parte: {fila["pregunta"] for fila in filas if fila["parte"] == parte} for parte in CAPITULOS}
    controles.comprobar(
        all(len(preguntas[parte]) == 1 for parte in CAPITULOS if parte != "errores") and bool(preguntas["errores"]),
        f"edición {edicion['nombre']}: la pregunta {pregunta} está, una sola vez, en las tablas del INE "
        f"({', '.join(edicion['tablas'].values())}) y hay errores de muestreo publicados",
    )
    cataluna = {
        fila["agrupacion"] for fila in filas if fila["parte"] == "comunidades" and fila["territorio"] == CATALUNA
    }
    controles.comprobar(
        {TOTAL_EMPRESAS, *GRANDES_SECTORES} <= cataluna,
        "Cataluña tiene el total y los tres grandes sectores (industria, construcción y servicios)",
    )
    valores = [fila["valor"] for fila in filas if fila["parte"] != "errores"]
    controles.comprobar(
        all(
            isinstance(valor, (int, float))
            and not isinstance(valor, bool)
            and math.isfinite(valor)
            and 0 <= valor <= PORCENTAJE_MAXIMO
            for valor in valores
        ),
        f"las {len(valores)} cifras del INE están entre 0 y 100",
    )
    errores = [fila["valor"] for fila in filas if fila["parte"] == "errores"]
    controles.comprobar(
        bool(errores)
        and all(
            isinstance(valor, (int, float)) and not isinstance(valor, bool) and math.isfinite(valor) and valor >= 0
            for valor in errores
        ),
        "los errores estándar de referencia del INE son cifras finitas no negativas",
    )


def comparables(
    agrupaciones: dict[str, dict[str, Any]], eurostat: dict[str, dict[str, Any]]
) -> list[tuple[str, str, float]]:
    """Pares (agrupación del INE, agregado de Eurostat, diferencia) que cubren exactamente las mismas divisiones.

    Returns:
        Una tupla (agrupación, agregado, diferencia en puntos) por agregado comparable.
    """
    return [
        (nombre, codigo, round(abs(datos["pct"] - europa["pct"]), 2))
        for nombre, datos in agrupaciones.items()
        for codigo, europa in eurostat.items()
        if datos["divisiones"] == europa["divisiones"]
    ]


def _fuera_de_margen(pares: list[tuple[str, str, float]]) -> list[tuple[str, str, float]]:
    """Los pares cuya diferencia pasa de MAX_DIFERENCIA_INE_EUROSTAT.

    Returns:
        Los pares fuera del margen, en su orden.
    """
    return [par for par in pares if par[2] > MAX_DIFERENCIA_INE_EUROSTAT]


def comprobar_contraste(
    controles: Controles,
    agrupaciones: dict[str, dict[str, Any]],
    eurostat: dict[str, dict[str, Any]],
    filas_europa: list[dict[str, Any]],
) -> None:
    """INE y Eurostat dan la misma cifra en los agregados comparables; las cifras poco fiables no se usan."""
    if not filas_europa:
        return
    pares = comparables(agrupaciones, eurostat)
    fuera = _fuera_de_margen(pares)
    controles.comprobar(
        len(pares) >= len(GRANDES_SECTORES) and not fuera,
        f"en los {len(pares)} agregados con las mismas divisiones, INE y Eurostat difieren como mucho "
        f"{numero_es(MAX_DIFERENCIA_INE_EUROSTAT, 1)} puntos"
        + (f" (máximo: {numero_es(max(par[2] for par in pares), 2)})" if pares else "")
        + (f"; fuera: {fuera}" if fuera else ""),
    )
    marcadas = sum(POCO_FIABLE in (fila["marca"] or "") for fila in filas_europa)
    controles.comprobar(
        not any(fila["nace"] in eurostat for fila in filas_europa if POCO_FIABLE in (fila["marca"] or "")),
        f"no se usa ninguna de las {marcadas} cifras que Eurostat marca como poco fiables («u»)",
    )


def divisiones_esperadas(existentes: set[int]) -> set[int]:
    """Lo que mide la encuesta: las divisiones de la 10 a la 82 sin las actividades financieras (64 a 66).

    Returns:
        Los códigos NACE de dos cifras de las divisiones medidas.
    """
    return {
        division
        for division in existentes
        if PRIMERA_DIVISION_MEDIDA <= division <= ULTIMA_DIVISION_MEDIDA and division not in DIVISIONES_FINANCIERAS
    }


def comprobar_paso(controles: Controles, datos: dict[str, Any], existentes: set[int]) -> None:
    """La tabla de paso cubre justo lo que mide la encuesta, con nombre para cada agregado y cobertura coherente."""
    medidas = {int(division) for division in datos["paso"]}
    esperadas = divisiones_esperadas(existentes)
    descripcion = (
        f"la tabla de paso CNAE-2009 conserva {len(esperadas)} divisiones para el contexto de INE o Eurostat; "
        "no representa el ámbito CNAE-2025 del INE"
        if datos["encuesta"].get("clasificacion") == "CNAE-2025"
        else f"la tabla de paso lleva las {len(esperadas)} divisiones que mide la encuesta "
        f"({PRIMERA_DIVISION_MEDIDA} a "
        f"{ULTIMA_DIVISION_MEDIDA}, sin la {min(DIVISIONES_FINANCIERAS)} a la {max(DIVISIONES_FINANCIERAS)}) y "
        "ninguna otra"
    )
    controles.comprobar(
        medidas == esperadas,
        descripcion
        + (
            f"; sobran {sorted(medidas - esperadas)}, faltan {sorted(esperadas - medidas)}"
            if medidas != esperadas
            else ""
        ),
    )
    sin_nombre = [codigo for codigo, agregado in datos["eurostat"]["agregados"].items() if not agregado["nombre"]]
    controles.comprobar(
        not sin_nombre,
        "cada agregado de Eurostat de la tabla de paso tiene su nombre en castellano"
        + (f"; faltan: {sin_nombre}" if sin_nombre else ""),
    )
    porcentajes = [
        pct
        for territorio in datos["cobertura_de_los_grupos"].values()
        for nivel in territorio.values()
        for pct in nivel.values()
    ]
    controles.comprobar(
        bool(porcentajes) and all(0 <= pct <= PORCENTAJE_MAXIMO for pct in porcentajes),
        f"la parte de cada grupo en sectores que mide la encuesta está entre 0 y 100 ({len(porcentajes)} grupos)",
    )


def _comprobar_filas_cataluna(controles: Controles, filas: list[dict[str, Any]], anios: list[int]) -> None:
    """Ninguna cifra se pisa y las filas pertenecen a los mismos años que su sección."""
    leidas = {(fila["anio"], fila["nace"]) for fila in filas}
    controles.comprobar(
        {fila["anio"] for fila in filas} == set(anios) and len(leidas) == len(filas),
        "Cataluña por sección: las filas conservan sus años y no hay cifras repetidas para un mismo año y sector"
        + ("" if len(leidas) == len(filas) else "; hay cifras repetidas para un mismo año y sector"),
    )


def _comprobar_cifras_de_cataluna(controles: Controles, seccion: dict[str, Any]) -> None:
    """Las cifras de Cataluña están entre 0 y 100 y ninguna poco fiable va como firme."""
    cifras = [cifra for actividad in seccion["actividades"].values() for cifra in actividad["por_anio"].values()]
    firmes_marcadas = [cifra for cifra in cifras if cifra.get("marca") == POCO_FIABLE and cifra["pct"] is not None]
    controles.comprobar(
        not firmes_marcadas and all(cifra["pct"] is None or 0 <= cifra["pct"] <= PORCENTAJE_MAXIMO for cifra in cifras),
        f"las {len(cifras)} cifras de Cataluña están entre 0 y 100 y ninguna poco fiable («u») va como firme "
        f"({sum(cifra.get('marca') == POCO_FIABLE for cifra in cifras)} marcadas así)",
    )


def comprobar_serie_cataluna(
    controles: Controles, seccion: dict[str, Any], filas: list[dict[str, Any]], anio: int
) -> None:
    """Comprueba la ventana regional según su periodo propio, sin comparar con otro universo."""
    anios, total = seccion["anios"], seccion["actividades"].get("C10-S951_X_K", {}).get("por_anio", {})
    controles.comprobar(
        anios == list(range(anio - ANIOS_DE_CATALUNA + 1, anio + 1)) and all(str(a) in total for a in anios),
        f"Cataluña por sección: {len(seccion['actividades'])} agregados, años seguidos "
        + (f"{anios[0]}–{anios[-1]}" if anios else "(ninguno)")
        + ", con el total de cada año",
    )
    _comprobar_filas_cataluna(controles, filas, anios)
    _comprobar_cifras_de_cataluna(controles, seccion)


def comprobar_cataluna(
    controles: Controles,
    seccion: dict[str, Any] | None,
    filas: list[dict[str, Any]],
    sectores_ine: dict[str, dict[str, Any]],
    anio: int,
) -> None:
    """Cataluña por sección: años seguidos con su total, cifras de referencia, marcas respetadas y contraste con el INE.

    El contraste sigue la regla de España: solo los sectores con las mismas divisiones. Los totales no se comparan: el
    del INE deja fuera la restauración (56) y la reparación de ordenadores (95.1), y el de Eurostat no.
    """
    if seccion is None:
        return
    comprobar_serie_cataluna(controles, seccion, filas, anio)
    del_anio = [fila for fila in filas if fila["anio"] == anio]
    pares = comparables(sectores_ine, agregados_eurostat(del_anio, divisiones_existentes()))
    fuera = _fuera_de_margen(pares)
    controles.comprobar(
        bool(pares) and not fuera,
        f"en Cataluña, en los {len(pares)} sectores con las mismas divisiones, INE y Eurostat difieren como mucho "
        f"{numero_es(MAX_DIFERENCIA_INE_EUROSTAT, 1)} puntos"
        + (f" (máximo: {numero_es(max(par[2] for par in pares), 2)})" if pares else "")
        + (f"; fuera: {fuera}" if fuera else ""),
    )


def comprobar_disponibilidad(
    controles: Controles, filas: list[dict[str, Any]], actualizacion: dict[str, Any] | None, territorio: str
) -> None:
    """Las filas de Eurostat y su registro de publicación están presentes o ausentes a la vez."""
    controles.comprobar(
        bool(filas) == bool(actualizacion),
        f"Eurostat {territorio}: las filas y su actualización tienen la misma disponibilidad",
    )
