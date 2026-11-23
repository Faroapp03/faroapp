"""Composición del paquete público de formación desde sus tres preparados admitidos, y de la correspondencia EURES.

La correspondencia EURES entre ESCO y CO-SISPE va también en su propio archivo, correspondencia-eures.json: la lee la
búsqueda de ocupaciones con el núcleo del paquete, así que un fallo de formacion.json, que solo lee el motor de cursos,
no la deja sin ella.
"""

import re
from datetime import date
from typing import Any

from plataforma_datos.comun.entrada_salida import leer_jsonl, procedencia, requerir
from plataforma_datos.comun.nucleo import ErrorFuente, FormatoInesperado, exigir
from plataforma_datos.cursos.fuentes.formacion.constantes import PATRON_CURSOS
from plataforma_datos.cursos.fuentes.formacion.constantes import PREPARADOS as PREPARADOS_FORMACION
from plataforma_datos.orquestacion.admision import exigir_admitido
from plataforma_datos.orquestacion.exportacion.comun import Paquete

# La cita que pide la correspondencia EURES; la llevan formacion.json y correspondencia-eures.json.
CITA_EURES = "© Unión Europea. Correspondencia EURES entre ESCO y CO-SISPE 2011."

# Solo los campos que utiliza el motor: los demás permanecen en el preparado.
CAMPOS_CURSO = (
    "id",
    "nombre",
    "especialidades",
    "modalidad",
    "municipio",
    "inicio",
    "fin",
    "horas",
    "estado",
    "centro",
    "enlace",
    "destinatarios",
)


def _fecha_es(iso: str) -> str:
    """Escribe una fecha ISO en el formato de las citas.

    Args:
        iso: La fecha AAAA-MM-DD (2026-09-27).

    Returns:
        DD/MM/AAAA (27/09/2026).

    Raises:
        FormatoInesperado: Si la fecha no es ISO o no existe en el calendario.
    """
    exigir(bool(re.fullmatch(r"\d{4}-\d{2}-\d{2}", iso)), f"formacion: fecha de cita no ISO: {iso}")
    try:
        fecha = date.fromisoformat(iso)
    except ValueError as error:
        raise FormatoInesperado(f"formacion: fecha de cita inexistente: {iso}") from error
    return f"{fecha.day:02d}/{fecha.month:02d}/{fecha.year:04d}"


def _fecha_cursos() -> str:
    """Busca la fecha de la copia más reciente de los cursos del SOC, según su procedencia.

    Returns:
        La fecha que lleva en el nombre la copia más reciente (PATRON_CURSOS).

    Raises:
        ErrorFuente: Si la procedencia de formación no registra ninguna copia de los cursos.
        FormatoInesperado: Si una copia registrada lleva una fecha inexistente.
    """
    archivos = [entrada["archivo"] for entrada in procedencia("formacion")["archivos"]]
    coincidencias = (re.fullmatch(PATRON_CURSOS, archivo) for archivo in archivos)
    fechas = [coincidencia.group(1) for coincidencia in coincidencias if coincidencia]
    exigir(bool(fechas), "formacion: ninguna copia de los cursos del SOC en su procedencia", ErrorFuente)
    for fecha in fechas:
        _fecha_es(fecha)
    return max(fechas)


def _citas_formacion() -> dict[str, str]:
    """Compone las citas obligatorias de las fuentes de formación.

    Returns:
        La cita del SEPE (con la fecha de su exportación), la del SOC y la de EURES.
    """
    return {
        "sepe": "Origen de los datos: SEPE, Catálogo de Especialidades Formativas (exportado el "
        f"{_fecha_es(procedencia('sepe')['descargado'])}).",
        "soc": "Generalitat de Catalunya. Servei Públic d'Ocupació de Catalunya: cursos y especialidades "
        "formativas (datos abiertos).",
        "eures": CITA_EURES,
    }


def _especialidades_por_ocupacion(eures: list[dict[str, Any]]) -> dict[str, list[list[str]]]:
    """Agrupa por ocupación ESCO sus especialidades CO-SISPE.

    Args:
        eures: Las relaciones de la correspondencia EURES.

    Returns:
        Por código ESCO de ocupación, sus especialidades como `[código, relación, etiqueta]`, en el orden de `eures`.
    """
    ocupaciones: dict[str, list[list[str]]] = {}
    for relacion in eures:
        ocupaciones.setdefault(relacion["esco"], []).append(
            [relacion["cosispe"], relacion["relacion"], relacion["etiqueta"]]
        )
    return ocupaciones


def _ficha_especialidad(especialidad: dict[str, Any]) -> dict[str, Any]:
    """Extrae lo que el motor usa de una especialidad del SEPE.

    Args:
        especialidad: La especialidad preparada.

    Returns:
        Nombre, nivel, horas, familia, modalidad, ocupaciones y ficha.
    """
    return {
        "nombre": especialidad["denominacion"],
        "nivel": especialidad["nivel"],
        "horas": especialidad["horas"],
        "familia": especialidad["familia"],
        "modalidad": especialidad["modalidad"],
        "ocupaciones": especialidad["ocupaciones"],
        "ficha": especialidad["ficha"],
    }


def paquete_correspondencia_eures() -> Paquete:
    """Compone la correspondencia EURES que lee la búsqueda de ocupaciones, aparte del paquete de formación.

    Es la misma que formacion.json lleva en `ocupaciones`: del mismo preparado, admitido con la misma validación, y en
    el mismo orden.

    Returns:
        La cita de EURES y, por código ESCO de ocupación, sus especialidades CO-SISPE, con el preparado como origen.
    """
    exigir_admitido("formacion")
    origen = requerir(PREPARADOS_FORMACION["eures"])
    datos = {"fuente": CITA_EURES, "ocupaciones": _especialidades_por_ocupacion(leer_jsonl(origen))}
    return Paquete(datos, [origen])


def paquete_formacion() -> Paquete:
    """Compone el paquete compacto de formación: lo justo para recomendar, sin el texto largo de las fuentes.

    Returns:
        Citas, fecha de los cursos, cobertura, especialidades por ocupación, fichas de especialidad y cursos, con los
        tres preparados como orígenes.
    """
    validacion = exigir_admitido("formacion")
    origenes = [requerir(PREPARADOS_FORMACION[clave]) for clave in ("eures", "especialidades", "cursos")]
    eures, especialidades, cursos = (leer_jsonl(ruta) for ruta in origenes)
    datos = {
        "fuentes": _citas_formacion(),
        "fecha_cursos": _fecha_cursos(),
        "cobertura": validacion["cobertura"],
        "ocupaciones": _especialidades_por_ocupacion(eures),
        # También las especialidades sin ocupaciones codificadas: sirven para sugerencias y formación transversal.
        "especialidades": {
            especialidad["codigo"]: _ficha_especialidad(especialidad) for especialidad in especialidades
        },
        "cursos": [{campo: curso[campo] for campo in CAMPOS_CURSO} for curso in cursos],
    }
    return Paquete(datos, origenes)
