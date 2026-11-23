"""Ocupaciones y competencias del paquete ESCO desde su biblioteca SQLite admitida."""

import json
import sqlite3
from typing import Any

from plataforma_datos.comun.nucleo import ErrorFuente, exigir
from plataforma_datos.ocupaciones.fuentes.esco.piezas.constantes_esco import VERSION as VERSION_ESCO
from plataforma_datos.ocupaciones.fuentes.esco.piezas.consultas import BASE as BASE_ESCO
from plataforma_datos.ocupaciones.fuentes.esco.piezas.consultas import base_validada
from plataforma_datos.orquestacion.exportacion.comun import Paquete

CIFRAS_DEL_GRUPO_CIUO = 4  # el grupo primario de la CIUO-08 son las cuatro primeras cifras del código ESCO


def _competencias_esco(base: sqlite3.Connection) -> tuple[list[list[str]], dict[str, int]]:
    """Lee las competencias de la base ESCO y la posición de cada una.

    Las ocupaciones citan sus competencias por esa posición, que ocupa mucho menos que la URI.

    Args:
        base: La base ESCO validada.

    Returns:
        Las competencias como `[uri, título, tipo]`, ordenadas por URI, y la posición de cada URI en esa lista.
    """
    competencias: list[list[str]] = []
    posicion: dict[str, int] = {}
    for uri, titulo, tipo in base.execute("SELECT uri,titulo_es,tipo FROM competencias ORDER BY uri"):
        posicion[uri] = len(competencias)
        competencias.append([uri, titulo, tipo])
    return competencias, posicion


def _ocupaciones_esco(base: sqlite3.Connection) -> dict[str, dict[str, Any]]:
    """Lee las ocupaciones de la base ESCO, todavía sin sus competencias.

    Args:
        base: La base ESCO validada.

    Returns:
        Cada ocupación por su código ESCO: URI, título, grupo CIUO-08, nombres alternativos y descripción.

    Raises:
        ErrorFuente: Si los nombres alternativos no son JSON con una lista de textos.
    """
    ocupaciones = {}
    consulta = "SELECT uri,codigo_esco,titulo_es,descripcion_es,alternativos_json FROM ocupaciones"
    for uri, codigo_esco, titulo, descripcion, alternativos in base.execute(consulta):
        try:
            nombres = json.loads(alternativos or "[]")
        except json.JSONDecodeError as error:
            raise ErrorFuente(f"esco: la ocupación {uri} tiene alternativos JSON ilegibles") from error
        exigir(
            isinstance(nombres, list) and all(isinstance(nombre, str) for nombre in nombres),
            f"esco: la ocupación {uri} necesita alternativos como lista de textos",
            ErrorFuente,
        )
        # Nombres alternativos y descripción: los usa el buscador de ocupaciones (sin IA).
        ocupaciones[codigo_esco] = {
            "uri": uri,
            "titulo": titulo,
            "isco08": codigo_esco[:CIFRAS_DEL_GRUPO_CIUO],
            "alternativos": nombres,
            "descripcion": descripcion or "",
            "competencias": [],
        }
    return ocupaciones


def _anadir_competencias(
    base: sqlite3.Connection, ocupaciones: dict[str, dict[str, Any]], posicion: dict[str, int]
) -> None:
    """Añade a cada ocupación sus competencias como `[posición, "e" (esencial) u "o" (opcional)]`.

    Args:
        base: La base ESCO validada.
        ocupaciones: Las ocupaciones por código ESCO (`_ocupaciones_esco`); se completan aquí.
        posicion: La posición de cada competencia (`_competencias_esco`).

    Raises:
        ErrorFuente: Si una relación cita una ocupación o una competencia que no está en la base, con sus URI.
    """
    codigo_por_uri = {ocupacion["uri"]: codigo_esco for codigo_esco, ocupacion in ocupaciones.items()}
    consulta = "SELECT ocupacion_uri,competencia_uri,tipo FROM relaciones ORDER BY ocupacion_uri,tipo,competencia_uri"
    for ocupacion_uri, competencia_uri, tipo in base.execute(consulta):
        exigir(
            ocupacion_uri in codigo_por_uri and competencia_uri in posicion,
            f"esco: la relación {ocupacion_uri} → {competencia_uri} cita una ocupación o competencia que no está en "
            "la base",
            ErrorFuente,
        )
        clase = "e" if tipo == "esencial" else "o"
        ocupaciones[codigo_por_uri[ocupacion_uri]]["competencias"].append([posicion[competencia_uri], clase])


def paquete_esco() -> Paquete:
    """Compone las ocupaciones ESCO con nombres alternativos, descripción y competencias.

    Returns:
        La fuente, la lista de competencias y las ocupaciones (cada competencia, por su índice en esa lista).

    Raises:
        ErrorFuente: Si una relación cita algo ausente o los nombres alternativos no son válidos.
    """
    with base_validada() as base:
        competencias, posicion = _competencias_esco(base)
        ocupaciones = _ocupaciones_esco(base)
        _anadir_competencias(base, ocupaciones, posicion)
    datos = {
        "fuente": f"Comisión Europea, ESCO {VERSION_ESCO}",
        "competencias": competencias,
        "ocupaciones": ocupaciones,
    }
    return Paquete(datos, [BASE_ESCO])
