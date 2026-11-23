"""Estimación con los microdatos de la TIC-H: porcentaje ponderado con su intervalo, por grupo y por ámbito.

Las personas del universo de la encuesta (16 a 74 años) se agrupan por ocupación a 2 y 1 cifras de la ISCO-08, por
bloque y por grupo publicado, en España y en Cataluña; cada grupo con muestra suficiente lleva su porcentaje de uso por
trabajo, su intervalo de Korn–Graubard y la regla de publicación del NCHS (proporcion_de_encuesta.py). También el
contraste con los errores de muestreo del INE en la variable que los tiene publicados (errores_del_ine.py).
"""

import math
import re
from collections.abc import Callable, Iterable, Mapping
from typing import Any

from plataforma_datos.comun.lugares import CODIGO_INE_DE_CATALUNA as CATALUNA
from plataforma_datos.comun.nucleo import FormatoInesperado, exigir
from plataforma_datos.ia_y_trabajo.fuentes.tich.constantes import (
    BLOQUES,
    EDAD_CONTRASTE,
    ESTRATO,
    GRUPOS_PUBLICADOS,
    MIN_MUESTRA,
    NO_SABE,
    SI,
    SI_CONTRASTE,
    TOTAL_NACIONAL,
    VARIABLE_CONTRASTE,
    VARIABLE_USO,
)
from plataforma_datos.ia_y_trabajo.fuentes.tich.proporcion_de_encuesta import intervalo_korn_graubard, regla_nchs


def proporcion_ponderada(filas: list[dict[str, str]], variable: str, si: Iterable[str] = (SI,)) -> tuple[float, float]:
    """Proporción ponderada (`FACTOR_P`) de filas con `variable` en `si` y su tamaño efectivo de Kish, (Σw)² / Σw².

    Returns:
        (proporción ponderada, tamaño efectivo de Kish).

    Raises:
        FormatoInesperado: Si no hay personas o un peso no es numérico, finito y positivo.
    """
    exigir(bool(filas), "TIC-H: no hay personas para estimar la proporción")
    try:
        pesos = [float(fila["FACTOR_P"]) for fila in filas]
    except ValueError as error:
        raise FormatoInesperado("TIC-H: FACTOR_P no es numérico") from error
    exigir(all(math.isfinite(peso) and peso > 0 for peso in pesos), "TIC-H: FACTOR_P debe ser finito y positivo")
    respuestas_afirmativas = tuple(si)
    suma = sum(pesos)
    proporcion = (
        sum(peso for peso, fila in zip(pesos, filas, strict=True) if fila[variable] in respuestas_afirmativas) / suma
    )
    return proporcion, suma * suma / sum(peso * peso for peso in pesos)


def estimar(filas: list[dict[str, str]], variable: str, grados: float) -> dict[str, Any]:
    """% ponderado de `variable` = sí, con su intervalo de Korn–Graubard, su muestra, su n de Kish y la regla NCHS.

    Returns:
        El porcentaje, su intervalo, su muestra, su n de Kish y la regla del NCHS.
    """
    proporcion, efectivo = proporcion_ponderada(filas, variable)
    intervalo = intervalo_korn_graubard(proporcion, len(filas), efectivo, grados)
    return {
        "pct": round(100 * proporcion, 1),
        "ic95": [round(100 * intervalo[0], 1), round(100 * intervalo[1], 1)],
        "muestra": len(filas),
        "muestra_efectiva": round(efectivo),
        "poblacion": round(sum(float(fila["FACTOR_P"]) for fila in filas)),
        "regla_nchs": regla_nchs(proporcion, len(filas), efectivo, intervalo, grados),
    }


def grados_del_diseno(filas: Iterable[dict[str, str]], secciones: int) -> int:
    """Grados de libertad del diseño: secciones censales en muestra menos estratos con muestra en el fichero.

    Returns:
        Los grados de libertad.
    """
    return secciones - len({(fila["CCAA"], fila[ESTRATO]) for fila in filas})


def _por(filas: Iterable[dict[str, str]], clave: Callable[[dict[str, str]], str]) -> dict[str, list[dict[str, str]]]:
    """Filas agrupadas por el valor que da `clave` (una función de la fila); sin valor, la fila no entra.

    Returns:
        {valor: filas}.
    """
    grupos: dict[str, list[dict[str, str]]] = {}
    for fila in filas:
        valor = clave(fila)
        if valor:
            grupos.setdefault(valor, []).append(fila)
    return dict(sorted(grupos.items()))


def _isco2(fila: dict[str, str]) -> str:
    """Grupo ISCO-08 de 2 cifras de una persona ocupada («NS/NR» no es un grupo).

    Returns:
        El grupo de 2 cifras.
    """
    return "" if fila["OCUPACION"] == NO_SABE else fila["OCUPACION"]


def _isco1(fila: dict[str, str]) -> str:
    """Gran grupo ISCO-08 (la primera cifra).

    Returns:
        El gran grupo.
    """
    return _isco2(fila)[:1]


def _bloque(fila: dict[str, str]) -> str:
    """Bloque de grupos ISCO-08 de 2 cifras al que pertenece una persona ocupada, si su grupo está en uno.

    Returns:
        El nombre del bloque, o un texto vacío si su grupo no está en ninguno.
    """
    return BLOQUES.get(_isco2(fila), "")


def poblacion_por_isco2(filas: Iterable[dict[str, str]]) -> dict[str, int]:
    """Personas ocupadas que representa cada grupo ISCO-08 de 2 cifras (suma de pesos), con muestra o sin ella.

    Returns:
        {grupo: personas ocupadas}.
    """
    return {
        grupo: round(sum(float(fila["FACTOR_P"]) for fila in del_grupo))
        for grupo, del_grupo in _por(filas, _isco2).items()
    }


def _grupos_publicados(filas: list[dict[str, str]]) -> dict[str, list[dict[str, str]]]:
    """Las personas de los tres grupos que publica el INE: manuales, no manuales y TIC.

    Returns:
        {grupo publicado: sus personas}.
    """
    return {
        grupo: [fila for fila in filas if fila[variable] == valor]
        for grupo, (variable, valor, _) in GRUPOS_PUBLICADOS.items()
    }


def _estimaciones(grupos: dict[str, list[dict[str, str]]], grados: float) -> dict[str, dict[str, Any]]:
    """Uso por trabajo de cada grupo, con su muestra; sin cifra si no llega a MIN_MUESTRA (se dice la muestra).

    Returns:
        {grupo: estimación o solo muestra}.
    """
    resultado = {}
    for codigo, filas in grupos.items():
        resultado[codigo] = (
            estimar(filas, VARIABLE_USO, grados) if len(filas) >= MIN_MUESTRA else {"muestra": len(filas)}
        )
    return resultado


def clases_por_isco2(filas: Iterable[dict[str, str]]) -> dict[str, dict[str, int]]:
    """Cómo clasifica el INE a las personas de cada grupo ISCO-08 de 2 cifras: manual o no manual (`OCUPACION1`).

    La necesita el motivo «no sabe cómo» del informe (del Idescat, tic_llars), que se publica solo para esas dos clases.
    La clase del grupo sale de este reparto (clases_de_ocupacion.py).

    Returns:
        {grupo: {clase: entrevistas}}, en orden de grupo y de clase.
    """
    nombres = {GRUPOS_PUBLICADOS[clase][1]: clase for clase in ("manual", "no_manual")}
    clases: dict[str, dict[str, int]] = {}
    for fila in filas:
        if _isco2(fila):
            del_grupo = clases.setdefault(_isco2(fila), {})
            clase = nombres[fila["OCUPACION1"]]
            del_grupo[clase] = del_grupo.get(clase, 0) + 1
    return {grupo: dict(sorted(reparto.items())) for grupo, reparto in sorted(clases.items())}


def del_universo(filas: list[dict[str, str]]) -> list[dict[str, str]]:
    """Las personas del universo de la encuesta y de sus tablas: de 16 a 74 años (EDAD_CONTRASTE).

    Returns:
        Las filas de ese universo; todas las estimaciones por grupo se calculan con ellas.

    Raises:
        FormatoInesperado: Si una persona no tiene edad o su edad no es un número entero.
    """
    exigir(
        all(re.fullmatch(r"[0-9]+", fila["EDAD"]) for fila in filas),
        "TIC-H: en los microdatos hay personas sin edad o con una edad que no es un número entero",
    )
    return [fila for fila in filas if EDAD_CONTRASTE[0] <= int(fila["EDAD"]) <= EDAD_CONTRASTE[1]]


def calcular(filas: list[dict[str, str]], secciones: Mapping[str, int]) -> dict[str, Any]:
    """Todas las estimaciones: España por grupo de 2 y 1 cifras y por grupo publicado; Cataluña, lo que da.

    Args:
        filas: Las personas del universo.
        secciones: Las secciones censales en muestra de España y de Cataluña, de la metodología de la edición.

    Returns:
        Las estimaciones por ámbito y grupo.
    """
    ocupadas = [fila for fila in filas if fila["OCUPACION"]]
    de_cataluna = [fila for fila in ocupadas if fila["CCAA"] == CATALUNA]
    espana = grados_del_diseno(filas, secciones["espana"])
    cataluna = grados_del_diseno((fila for fila in filas if fila["CCAA"] == CATALUNA), secciones["cataluna"])
    return {
        "espana_isco2": _estimaciones(_por(ocupadas, _isco2), espana),
        "espana_isco1": _estimaciones(_por(ocupadas, _isco1), espana),
        "espana_bloques": _estimaciones(_por(ocupadas, _bloque), espana),
        "espana_grupos": _estimaciones(_grupos_publicados(ocupadas), espana),
        "cataluna_isco1": _estimaciones(_por(de_cataluna, _isco1), cataluna),
        "cataluna_grupos": _estimaciones(_grupos_publicados(de_cataluna), cataluna),
    }


def _con_kish(filas: list[dict[str, str]], es_si: Callable[[dict[str, str]], bool]) -> tuple[float, float]:
    """Proporción ponderada de las filas con `es_si` y su error típico de Kish, √(p(1 − p) / n_ef), en tanto por 1.

    Returns:
        (proporción ponderada, error típico de Kish), en tanto por 1.
    """
    marcadas = [{**fila, "_si": SI if es_si(fila) else ""} for fila in filas]
    proporcion, efectivo = proporcion_ponderada(marcadas, "_si")
    return proporcion, math.sqrt(proporcion * (1 - proporcion) / efectivo)


def contraste_por_comunidad(filas: list[dict[str, str]]) -> dict[str, dict[str, float]]:
    """La variable de contraste en España y en cada comunidad, con el error típico de Kish, en dos lecturas.

    La tabla 76849 no dice sobre qué base da su error relativo; se calculan las dos que caben: el coeficiente de
    variación (%) del porcentaje sobre las personas ocupadas y el error típico, en puntos, del porcentaje sobre toda la
    población de 16 a 74 años.

    Returns:
        {ámbito: proporción y error típico en cada lectura}.
    """
    personas = [fila for fila in filas if fila["EDAD"] and EDAD_CONTRASTE[0] <= int(fila["EDAD"]) <= EDAD_CONTRASTE[1]]
    areas = {TOTAL_NACIONAL: personas, **_por(personas, lambda fila: fila["CCAA"])}
    resultado = {}
    for area, del_area in areas.items():
        ocupadas = [fila for fila in del_area if fila["OCUPACION"] and fila[VARIABLE_CONTRASTE]]
        de_ocupadas, error = _con_kish(ocupadas, lambda fila: fila[VARIABLE_CONTRASTE] in SI_CONTRASTE)
        de_todas, error_de_todas = _con_kish(
            del_area, lambda fila: bool(fila["OCUPACION"]) and fila[VARIABLE_CONTRASTE] in SI_CONTRASTE
        )
        resultado[area] = {
            "pct_de_ocupadas": round(100 * de_ocupadas, 1),
            "cv_kish_pct": round(100 * error / de_ocupadas, 2),
            "pct_de_16_a_74": round(100 * de_todas, 1),
            "error_kish_puntos": round(100 * error_de_todas, 2),
        }
    return resultado
