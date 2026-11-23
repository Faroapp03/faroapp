"""Controles de la cadena de formación y su cobertura: lo que comprueba `cursos/fuentes/formacion/lector.py` al validar.

Cada control se escribe en `validacion.json` con su descripción; la cobertura de la cadena oficial (ocupación ESCO →
CO-SISPE → especialidad del SEPE → curso del SOC) es un dato informativo, con la misma regla que el motor. Python
estándar.
"""

import re
from collections import defaultdict
from datetime import date
from typing import Any, NamedTuple

from plataforma_datos.comun.nucleo import Controles
from plataforma_datos.comun.textos_y_cifras import numero_es
from plataforma_datos.cursos.fuentes.formacion.constantes import (
    DESTINATARIOS_POR_TIPO,
    ESPECIALIDADES_SEPE,
    ESPECIALIDADES_SEPE_CON_OCUPACIONES,
    ESPECIALIDADES_SOC,
    FICHA_CURSO,
    MIN_COMPETENCIAS_DIGCOMP,
    MIN_CURSOS_IDENTIFICADOS,
    MIN_OCUPACIONES_EURES,
    MIN_RESULTADOS_DIGCOMP,
    TIPOS_RESULTADO_DIGCOMP,
)


class Preparados(NamedTuple):
    """Conjuntos preparados de la cadena de formación, tal como se leen para validarlos."""

    eures: list[dict[str, Any]]
    especialidades: list[dict[str, Any]]
    soc: list[dict[str, Any]]
    cursos: list[dict[str, Any]]
    digcomp: dict[str, Any]


def es_fecha_real(fecha: object) -> bool:
    """Dice si `fecha` es una fecha ISO (AAAA-MM-DD) que existe en el calendario.

    Args:
        fecha: Valor que se comprueba.

    Returns:
        `True` si es un texto AAAA-MM-DD de un día que existe.
    """
    if not isinstance(fecha, str) or not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", fecha):
        return False
    try:
        date.fromisoformat(fecha)
    except ValueError:
        return False
    return True


def _especialidades_por_cosispe(especialidades: list[dict[str, Any]]) -> dict[str, set[str]]:
    """Indexa las especialidades del SEPE por las ocupaciones con las que se relacionan.

    Args:
        especialidades: Especialidades preparadas del SEPE.

    Returns:
        Códigos de especialidad por código de ocupación y, con la clave «grupo:», por su grupo CNO-11 de 4 cifras.
    """
    por_cosispe: defaultdict[str, set[str]] = defaultdict(set)
    for especialidad in especialidades:
        for ocupacion in especialidad["ocupaciones"]:
            por_cosispe[ocupacion].add(especialidad["codigo"])
            por_cosispe["grupo:" + ocupacion[:4]].add(especialidad["codigo"])
    return por_cosispe


def _tiene_especialidad(relaciones: set[tuple[str, str]], por_cosispe: dict[str, set[str]]) -> bool:
    """Dice si alguna relación EURES de una ocupación lleva a una especialidad, por código exacto o por grupo.

    Args:
        relaciones: Pares (código CO-SISPE, tipo de relación) de la ocupación.
        por_cosispe: Índice de `_especialidades_por_cosispe`.

    Returns:
        `True` si alguna relación llega a una especialidad; una relación «estrecha» no vale por grupo.
    """
    return any(
        por_cosispe.get(cosispe) or (relacion != "estrecha" and por_cosispe.get("grupo:" + cosispe[:4]))
        for cosispe, relacion in relaciones
    )


def _controles_eures_y_sepe(controles: Controles, esco: dict[str, str], preparados: Preparados) -> None:
    """Cobertura y códigos de EURES; especialidades del SEPE con y sin ocupaciones."""
    cubiertas = {relacion["esco"] for relacion in preparados.eures}
    controles.comprobar(
        len(cubiertas) >= MIN_OCUPACIONES_EURES,
        f"EURES cubre {len(cubiertas)} de {len(esco)} ocupaciones ESCO (se esperan al menos "
        f"{numero_es(MIN_OCUPACIONES_EURES)})",
    )
    controles.comprobar(
        all(re.fullmatch(r"[0-9]{4}|[0-9]{8}", relacion["cosispe"]) for relacion in preparados.eures),
        "los códigos de EURES son de la CNO-11: de 8 cifras (CO-SISPE) o de 4 (grupo)",
    )
    especialidades = preparados.especialidades
    controles.comprobar(
        len(especialidades) == ESPECIALIDADES_SEPE,
        f"el SEPE exporta {len(especialidades)} especialidades ({numero_es(ESPECIALIDADES_SEPE)} al descargar)",
    )
    con_codigo = sum(1 for especialidad in especialidades if especialidad["ocupaciones"])
    solo_texto = sum(
        1 for especialidad in especialidades if especialidad["ocupaciones_texto"] and not especialidad["ocupaciones"]
    )
    controles.comprobar(
        con_codigo + solo_texto == ESPECIALIDADES_SEPE_CON_OCUPACIONES,
        f"{con_codigo} especialidades del SEPE con ocupaciones codificadas y {solo_texto} solo con texto, sin código "
        f"({numero_es(ESPECIALIDADES_SEPE_CON_OCUPACIONES)} con ocupaciones al descargar)",
    )


def _son_horas_posibles(horas: object) -> bool:
    """Dice si las horas de un curso son un número entero positivo, o no constan.

    Args:
        horas: Campo «horas» del curso preparado.

    Returns:
        `True` si es `None`, vacío o un entero positivo escrito en cifras.
    """
    return horas in (None, "") or (isinstance(horas, str) and re.fullmatch(r"[1-9][0-9]*", horas) is not None)


def _controles_cursos(controles: Controles, cursos: list[dict[str, Any]]) -> None:
    """Campos de cada curso que el informe da por buenos: fechas reales y en orden, horas, identidad y destinatarios."""
    controles.comprobar(
        all(curso[campo] is None or es_fecha_real(curso[campo]) for curso in cursos for campo in ("inicio", "fin")),
        "fechas de inicio y de fin en formato ISO y existentes en el calendario",
    )
    # Solo se comparan fechas reales: registrar el control anterior no detiene la validación.
    controles.comprobar(
        all(
            not (curso["inicio"] and curso["fin"])
            or (es_fecha_real(curso["inicio"]) and es_fecha_real(curso["fin"]) and curso["inicio"] <= curso["fin"])
            for curso in cursos
        ),
        "ningún curso termina antes de empezar",
    )
    controles.comprobar(
        all(_son_horas_posibles(curso["horas"]) for curso in cursos),
        "las horas de cada curso son un número entero positivo, o no constan",
    )
    # El plan de aprendizaje identifica cada curso por su identificador: uno repetido dejaría el plan sin abrir.
    controles.comprobar(
        len({curso["id"] for curso in cursos}) == len(cursos),
        "cada curso tiene un identificador propio",
    )
    conocidos = set(DESTINATARIOS_POR_TIPO.values())
    controles.comprobar(
        all(curso.get("destinatarios") in (None, *conocidos) for curso in cursos),
        "cada curso dice a quién se dirige con un valor conocido, o no lo dice",
    )


def _controles_soc(controles: Controles, preparados: Preparados) -> None:
    """Especialidades y cursos del SOC: cantidad, enlaces, campos de cada curso y especialidad reconocida."""
    soc, cursos = preparados.soc, preparados.cursos
    controles.comprobar(
        len(soc) == ESPECIALIDADES_SOC,
        f"{len(soc)} especialidades del SOC ({numero_es(ESPECIALIDADES_SOC)} al descargar)",
    )
    controles.comprobar(
        all(curso["enlace"].startswith(FICHA_CURSO) for curso in cursos),
        "cada curso tiene su enlace público al buscador del SOC",
    )
    _controles_cursos(controles, cursos)
    identificados = sum(1 for curso in cursos if curso["especialidades"])
    controles.comprobar(
        bool(cursos) and identificados / len(cursos) >= MIN_CURSOS_IDENTIFICADOS,
        f"{identificados} de {len(cursos)} cursos con su especialidad identificada por el nombre",
    )


def _controles_digcomp(controles: Controles, marco: dict[str, Any]) -> None:
    """DigComp 3.0: cobertura, relaciones existentes y tipos de sus resultados de aprendizaje."""
    controles.comprobar(
        len(marco["competencias"]) >= MIN_COMPETENCIAS_DIGCOMP,
        f"DigComp 3.0: {len(marco['competencias'])} competencias",
    )
    controles.comprobar(
        len(marco["resultados"]) >= MIN_RESULTADOS_DIGCOMP,
        f"DigComp 3.0: {len(marco['resultados'])} resultados de aprendizaje",
    )
    identificadores = {competencia["id"] for competencia in marco["competencias"] if competencia.get("id") is not None}
    controles.comprobar(
        all(resultado.get("competencia") in identificadores for resultado in marco["resultados"]),
        "DigComp 3.0: cada resultado enlaza con una competencia del marco",
    )
    controles.comprobar(
        all(resultado.get("tipo") in TIPOS_RESULTADO_DIGCOMP for resultado in marco["resultados"]),
        "DigComp 3.0: cada resultado conserva su tipo de conocimiento, capacidad o actitud",
    )


def controles(esco: dict[str, str], preparados: Preparados) -> Controles:
    """Reúne los controles de toda la cadena de formación, en el orden de `validacion.json`.

    Args:
        esco: URI de cada ocupación ESCO validada, por su código.
        preparados: Conjuntos preparados de la cadena.

    Returns:
        Los controles con su resultado.
    """
    controles = Controles()
    _controles_eures_y_sepe(controles, esco, preparados)
    _controles_soc(controles, preparados)
    _controles_digcomp(controles, preparados.digcomp)
    return controles


def cobertura(
    esco: dict[str, str],
    eures: list[dict[str, Any]],
    especialidades: list[dict[str, Any]],
    cursos: list[dict[str, Any]],
) -> dict[str, int]:
    """Mide la cobertura de la cadena oficial (dato informativo, no un fallo), con la misma regla que el motor.

    Una ocupación tiene especialidad por código exacto, o por grupo CNO-11 de 4 cifras salvo desde una relación
    «estrecha» (variante más específica).

    Args:
        esco: URI de cada ocupación ESCO validada, por su código.
        eures: Relaciones EURES preparadas.
        especialidades: Especialidades preparadas del SEPE.
        cursos: Cursos preparados del SOC.

    Returns:
        Ocupaciones con especialidad del SEPE, ocupaciones ESCO, cursos con relación oficial y cursos.
    """
    sepe = {especialidad["codigo"]: especialidad for especialidad in especialidades}
    por_cosispe = _especialidades_por_cosispe(especialidades)
    por_esco: defaultdict[str, set[tuple[str, str]]] = defaultdict(set)
    for relacion in eures:
        por_esco[relacion["esco"]].add((relacion["cosispe"], relacion["relacion"]))
    return {
        "ocupaciones_con_especialidad_sepe": sum(
            1 for codigo in esco if _tiene_especialidad(por_esco.get(codigo, set()), por_cosispe)
        ),
        "ocupaciones_esco": len(esco),
        "cursos_con_relacion_oficial": sum(
            1 for curso in cursos if any(sepe.get(codigo, {}).get("ocupaciones") for codigo in curso["especialidades"])
        ),
        "cursos": len(cursos),
    }
