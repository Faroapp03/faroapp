"""Consulta íntegra de referencias identificadas; no acredita que sean el estándar vigente."""

import json
from pathlib import Path

import plataforma_datos.comun.fuentes.idescat.lector as idescat
import plataforma_datos.comun.fuentes.territorios.lector as territorios
import plataforma_datos.ia_y_trabajo.fuentes.decada_digital.lector as decada_digital
import plataforma_datos.ocupaciones.fuentes.clasificaciones.lector as clasificaciones
import plataforma_datos.ocupaciones.fuentes.oit.piezas.constantes_oit as constantes_oit
from plataforma_datos.comun.nucleo import FormatoInesperado
from plataforma_datos.comun.observacion_remota import VERSION_VINCULADA, identidad_recurso
from plataforma_datos.orquestacion.cobertura_originales import (
    carpeta_originales,
    leer_procedencia,
    original_equivalente,
    original_vinculado,
    por_nombre,
)

MAX_PROCEDENCIA_BYTES = 256 * 1024
CONTRATOS = {
    "clasificaciones": (clasificaciones.FUENTE, clasificaciones.ARCHIVOS),
    "idescat": (idescat.FUENTE, idescat.ARCHIVOS),
    "territorios": (territorios.FUENTE, territorios.ARCHIVOS),
    "decada_digital": (decada_digital.FUENTE, decada_digital.ARCHIVOS),
    "oit": (constantes_oit.FUENTE, constantes_oit.ARCHIVOS),
}
# Las procedencias conservadas de ambas estructuras registran la redirección oficial a webapps.ilo.org.
URL_CIUO_ES = next(
    archivo["url"] for archivo in clasificaciones.ARCHIVOS if archivo["archivo"] == clasificaciones.CIUO_ES
)
URL_ISCO_EN = next(
    archivo["url"] for archivo in constantes_oit.ARCHIVOS if archivo["archivo"] == constantes_oit.ESTRUCTURA
)
URLS_FINALES = {url: {url, url.replace("www.ilo.org", "webapps.ilo.org", 1)} for url in (URL_CIUO_ES, URL_ISCO_EN)}


def _exigir(condicion: bool) -> None:
    if not condicion:
        raise ValueError("Consulta de referencia no verificable.")


def _comprobar(raiz: Path, evidencia: dict) -> None:
    _exigir(type(evidencia) is dict and type(evidencia.get("version")) is int)
    _exigir(evidencia["version"] == VERSION_VINCULADA)
    nombre, archivos = CONTRATOS[evidencia["fuente"]]
    carpeta = carpeta_originales(raiz, nombre)
    procedencia = leer_procedencia(carpeta, MAX_PROCEDENCIA_BYTES)
    registros = por_nombre(procedencia["archivos"])
    _exigir(set(registros) == {archivo["archivo"] for archivo in archivos})
    peticiones = evidencia["peticiones"]
    _exigir(type(peticiones) is list and all(type(peticion) is dict for peticion in peticiones))
    por_recurso = {peticion["recurso_sha256"]: peticion for peticion in peticiones}
    _exigir(len(por_recurso) == len(peticiones) == len(archivos))
    _exigir(set(por_recurso) == {identidad_recurso(archivo["url"]) for archivo in archivos})
    for archivo in archivos:
        url = archivo["url"]
        # Solo WP140 admite la equivalencia documentaria comprobada por su transporte.
        # Conservar la primera captura de POLITICA no demuestra equivalencia con su respuesta actual.
        lector = (
            original_equivalente
            if evidencia["fuente"] == "oit" and archivo["archivo"] == constantes_oit.DOCUMENTO
            else original_vinculado
        )
        contenido = lector(
            carpeta,
            archivo,
            registros[archivo["archivo"]],
            por_recurso[identidad_recurso(url)],
            urls_finales=URLS_FINALES.get(url),
        )
        if evidencia["fuente"] == "territorios" and archivo["archivo"] == territorios.CODIGOS:
            territorios.comprobar_versiones(json.loads(contenido), procedencia)


def comprobada(raiz: Path, evidencia: dict) -> bool:
    """Acredita todos los recursos de la referencia conocida, vinculados al mismo intento.

    El llamador valida el recibo v2 y exige preparación, validación y admisión del módulo.
    No hay descubrimiento de sucesoras: la revisión de edición permanece necesaria aunque
    estos recursos estén íntegros. Ni una copia local ni una consulta parcial renuevan la fecha.

    Returns:
        True con inventario exacto y originales vinculados; solo WP140 admite equivalencia documentaria.
    """
    try:
        _comprobar(raiz, evidencia)
    except (OSError, ValueError, TypeError, KeyError, RecursionError, FormatoInesperado):
        return False
    return True
