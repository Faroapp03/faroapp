"""Relaciona cabeceras API con programas por ediciones nativas, nunca por título.

La identidad canónica permanece estable. Una cabecera distinta necesita testigos
del mismo padre y una relación uno a uno en el censo completo de esta consulta.
"""

import re

from plataforma_datos.cursos.contrato_entrega_catalogo import exigir
from plataforma_datos.cursos.fuentes.barcelonactiva import robot_cibernarium as robot

METODO = "cibernarium-cabecera-por-ediciones-1"
MAX_EDICIONES = 20000


def validar(dato: object) -> None:
    """Exige la forma cerrada de una relación sin resolver su autoridad."""
    exigir(
        isinstance(dato, dict)
        and set(dato) == {"version", "metodo", "programa_id", "actividad_id", "url_actual", "ediciones_testigo"},
        "Relación de identidad Cibernàrium incompatible",
    )
    exigir(
        type(dato["version"]) is int and dato["version"] == 1 and dato["metodo"] == METODO, "Método de identidad ajeno"
    )
    exigir(
        isinstance(dato["programa_id"], str)
        and re.fullmatch(r"cibernarium:[1-9][0-9]*", dato["programa_id"])
        and isinstance(dato["actividad_id"], str)
        and re.fullmatch(r"[1-9][0-9]*", dato["actividad_id"]),
        "IDs de relación incompatibles",
    )
    exigir(dato["url_actual"] == robot.url_ficha(dato["actividad_id"]), "URL de otra cabecera")
    testigos = dato["ediciones_testigo"]
    exigir(
        isinstance(testigos, list)
        and len(testigos) <= MAX_EDICIONES
        and all(isinstance(t, str) and re.fullmatch(r"cibernarium-edicion:[1-9][0-9]*", t) for t in testigos)
        and testigos == sorted(set(testigos)),
        "Testigos de identidad incompatibles",
    )
    exigir(dato["programa_id"] == "cibernarium:" + dato["actividad_id"] or bool(testigos), "Alias sin edición testigo")


def _ediciones(actividad: dict) -> set[str]:
    ids = ["cibernarium-edicion:" + robot.identificador(e.get("activityId")) for e in actividad["listEditions"]]
    exigir(len(ids) == len(set(ids)), "Edición repetida en una cabecera")
    return set(ids)


def resolver(actividades: list[dict], programas: dict, ediciones: dict, anteriores: list[dict]) -> tuple[dict, dict]:
    """Resuelve el censo entero antes de aplicar una sola actualización.

    Returns:
        Relaciones acreditadas y motivos de retención por cabecera actual.
    """
    relaciones, retenidas, por_padre, por_edicion, vistos = {}, {}, {}, {}, set()
    alias_previos = {r["actividad_id"] for r in anteriores if r["programa_id"] != "cibernarium:" + r["actividad_id"]}
    for actividad in actividades:
        cabecera = robot.identificador(actividad.get("activityId"))
        if cabecera in vistos:
            retenidas[cabecera] = "cabecera_repetida_en_censo"
            continue
        vistos.add(cabecera)
        ids_lista = [
            "cibernarium-edicion:" + robot.identificador(e.get("activityId")) for e in actividad["listEditions"]
        ]
        if len(ids_lista) != len(set(ids_lista)):
            retenidas[cabecera] = "edicion_repetida_en_cabecera"
            continue
        ids = set(ids_lista)
        for id in ids:
            por_edicion.setdefault(id, []).append(cabecera)
        relacion, motivo = _relacion(cabecera, ids, programas, ediciones, alias_previos)
        if motivo is not None:
            retenidas[cabecera] = motivo
            continue
        relaciones[cabecera] = relacion
        por_padre.setdefault(relacion["programa_id"], []).append(cabecera)
    for cabeceras in [*por_padre.values(), *por_edicion.values()]:
        if len(cabeceras) > 1:
            for cabecera in cabeceras:
                retenidas[cabecera] = "identidad_repartida_entre_cabeceras"
    return {k: v for k, v in relaciones.items() if k not in retenidas}, retenidas


def _relacion(
    cabecera: str, ids: set[str], programas: dict, ediciones: dict, alias_previos: set[str]
) -> tuple[dict | None, str | None]:
    testigos = sorted(ids & ediciones.keys())
    padres = {ediciones[id]["programa_id"] for id in testigos}
    directo = "cibernarium:" + cabecera
    if len(padres) > 1:
        return None, "ediciones_de_varios_programas"
    padre = next(iter(padres), directo)
    if directo in programas and padre != directo:
        return None, "cabecera_colisiona_con_identidad_canonica"
    if not testigos and cabecera in alias_previos:
        return None, "alias_anterior_sin_testigos_actuales"
    relacion = {
        "version": 1,
        "metodo": METODO,
        "programa_id": padre,
        "actividad_id": cabecera,
        "url_actual": robot.url_ficha(cabecera),
        "ediciones_testigo": testigos,
    }
    validar(relacion)
    return relacion, None


def comprobar(relacion: dict, actividad: dict, programas: dict, ediciones: dict) -> None:
    """Reextrae el vínculo de la misma cabecera y de sus padres nativos."""
    validar(relacion)
    exigir(relacion["actividad_id"] == actividad["activityId"], "Relación de otra cabecera")
    ids = _ediciones(actividad)
    padre = relacion["programa_id"]
    exigir(padre in programas, "Relación sin programa canónico")
    programa = programas[padre]
    exigir(
        programa["proveedor_id"] == "cibernarium"
        and padre == "cibernarium:" + programa["datos"].get("activity_id", "")
        and programa["url"] == robot.url_ficha(programa["datos"]["activity_id"]),
        "Relación sin identidad canónica propia",
    )
    exigir(
        all(
            id in ids and id in ediciones and ediciones[id]["programa_id"] == padre
            for id in relacion["ediciones_testigo"]
        )
        and all(ediciones[id]["programa_id"] == padre for id in ids & ediciones.keys()),
        "Testigo de otro programa o edición",
    )
