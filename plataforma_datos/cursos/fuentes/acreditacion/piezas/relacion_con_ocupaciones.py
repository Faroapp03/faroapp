"""Relación de cada ocupación ESCO y de cada grupo ISCO-08 con sus certificados (regla de relaciones.py)."""

from collections import defaultdict
from typing import Any, NamedTuple

import plataforma_datos.cursos.fuentes.acreditacion.relaciones as relaciones
from plataforma_datos.comun.entrada_salida import leer_jsonl
from plataforma_datos.cursos.fuentes.acreditacion.piezas.constantes import DESCARTADAS
from plataforma_datos.cursos.fuentes.formacion.lector import PREPARADOS as PREPARADOS_FORMACION
from plataforma_datos.ocupaciones.fuentes.esco.lector import PREPARADOS as PREPARADOS_ESCO
from plataforma_datos.ocupaciones.fuentes.esco.piezas.consultas import ocupaciones_preparadas
from plataforma_datos.orquestacion.admision import exigir_admitido, leer_validado

# Cifras del grupo ISCO-08 con que empieza el código ESCO de una ocupación.
CIFRAS_DEL_GRUPO_ISCO = 4


class Cadena(NamedTuple):
    """Lo que necesita la regla: EURES, los nombres de cada ocupación ESCO y la correspondencia ISCO-08 → CNO-11."""

    eures: dict[str, list[tuple[str, str, str]]]
    isco_a_cno11: dict[str, list[str]]
    ocupaciones: dict[str, str]  # código ESCO → grupo ISCO-08
    nombres: dict[str, list[str]]  # código ESCO → su título y sus nombres alternativos en ESCO
    genericas: frozenset[str]


def leer_cadena() -> Cadena:
    """EURES (formación), la correspondencia ISCO-08 → CNO-11 (clasificaciones) y las ocupaciones ESCO validadas.

    Returns:
        La cadena de datos leída.
    """
    exigir_admitido("formacion")
    eures: dict[str, list[tuple[str, str, str]]] = defaultdict(list)
    for fila in leer_jsonl(PREPARADOS_FORMACION["eures"]):
        eures[fila["esco"]].append((fila["cosispe"], fila["relacion"], fila["etiqueta"]))
    clasificaciones = leer_validado("clasificaciones")
    isco_a_cno11 = {isco: [par["cno11"] for par in pares] for isco, pares in clasificaciones["isco08_a_cno11"].items()}
    ocupaciones: dict[str, str] = {}
    nombres: dict[str, list[str]] = {}
    for fila in ocupaciones_preparadas(PREPARADOS_ESCO["ocupaciones"]):
        ocupaciones[fila["codigo_esco"]] = fila["codigo_esco"][:CIFRAS_DEL_GRUPO_ISCO]
        # ESCO separa con «/» las formas de género de un título («camarero/camarera»): cada forma es un nombre.
        nombres[fila["codigo_esco"]] = [*fila["titulo_es"].split("/"), *fila.get("nombres_alternativos_es", [])]
    con_eures = {
        esco: [*lista, *(etiqueta for _, _, etiqueta in eures.get(esco, []))] for esco, lista in nombres.items()
    }
    return Cadena(dict(eures), isco_a_cno11, ocupaciones, nombres, relaciones.que_no_distinguen(con_eures))


def de_la_ocupacion(esco: str, cadena: Cadena) -> relaciones.Ocupacion:
    """Los códigos, los grupos y las palabras de una ocupación ESCO.

    Returns:
        La ocupación con sus códigos, grupos y palabras.
    """
    del_isco = cadena.isco_a_cno11.get(cadena.ocupaciones[esco], [])
    return relaciones.ocupacion(cadena.eures.get(esco, []), del_isco, cadena.nombres[esco], cadena.genericas)


def relaciones_de(esco: str, cadena: Cadena, certificados: list[dict[str, Any]]) -> dict[str, str]:
    """Los certificados relacionados con una ocupación ESCO y cómo.

    Returns:
        Los certificados relacionados y el modo de relación de cada uno.
    """
    ocupacion = de_la_ocupacion(esco, cadena)
    encontradas = {
        certificado["codigo"]: relaciones.relacion(certificado, ocupacion, cadena.genericas)
        for certificado in certificados
    }
    return sin_descartadas(esco, {codigo: relacion for codigo, relacion in sorted(encontradas.items()) if relacion})


def sin_descartadas(clave: str, relacionados: dict[str, str]) -> dict[str, str]:
    """Los certificados relacionados con una ocupación ESCO o un grupo ISCO-08 sin los descartados a mano.

    Returns:
        Los certificados que quedan tras quitar los descartados.
    """
    descartados = {certificado for descartada, certificado in DESCARTADAS if descartada == clave}
    return {codigo: relacion for codigo, relacion in relacionados.items() if codigo not in descartados}


class Relaciones(NamedTuple):
    """Los certificados de cada ocupación ESCO y de cada grupo ISCO-08 sin ocupación ESCO."""

    ocupaciones: dict[str, dict[str, str]]
    grupos: dict[str, dict[str, str]]


def todas_las_relaciones(cadena: Cadena, certificados: list[dict[str, Any]]) -> Relaciones:
    """Las relaciones que propone la regla para todas las ocupaciones ESCO y, por mayoría, para los grupos ISCO-08.

    Returns:
        Las relaciones de ocupaciones y grupos.
    """
    por_ocupacion = {esco: relaciones_de(esco, cadena, certificados) for esco in sorted(cadena.ocupaciones)}
    return Relaciones(por_ocupacion, de_los_grupos(cadena, por_ocupacion))


def ocupaciones_por_grupo(cadena: Cadena) -> dict[str, list[str]]:
    """Las ocupaciones ESCO de cada grupo ISCO-08.

    Returns:
        Los códigos ESCO de cada grupo.
    """
    del_grupo: dict[str, list[str]] = defaultdict(list)
    for esco, isco in sorted(cadena.ocupaciones.items()):
        del_grupo[isco].append(esco)
    return dict(del_grupo)


def de_los_grupos(cadena: Cadena, por_ocupacion: dict[str, dict[str, str]]) -> dict[str, dict[str, str]]:
    """Los certificados de cada grupo ISCO-08, por mayoría de sus ocupaciones y sin los descartados a mano.

    Returns:
        Los certificados de cada grupo, con su modo de relación.
    """
    del_grupo = ocupaciones_por_grupo(cadena)
    return {
        isco: sin_descartadas(isco, relaciones.del_grupo(por_ocupacion, del_grupo.get(isco, [])))
        for isco in sorted(cadena.isco_a_cno11)
    }
