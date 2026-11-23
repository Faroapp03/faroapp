"""Consulta íntegra de los recursos seleccionados de derechos; no descubre normativa ni ediciones sucesoras."""

import hashlib
from datetime import date
from pathlib import Path

import plataforma_datos.derechos.fuentes.derechos.lector as derechos
from plataforma_datos.comun.nucleo import MAX_DESCARGA_BYTES, FormatoInesperado
from plataforma_datos.comun.observacion_remota import VERSION_VINCULADA, identidad_recurso
from plataforma_datos.orquestacion.cobertura_originales import (
    carpeta_originales,
    leer_archivo,
    leer_procedencia,
    original_equivalente,
    original_vinculado,
    por_nombre,
)

MAX_PROCEDENCIA_BYTES = 256 * 1024


def _exigir(condicion: bool) -> None:
    if not condicion:
        raise ValueError("Consulta de recursos de derechos no verificable.")


def _nombre_registrado(esperado: str, registrado: str, copia: str) -> str:
    """Admite el día histórico de cada original sin cambiar el recurso ni renovar su fecha.

    Returns:
        El nombre canónico comprobado, no posterior al día de la copia.
    """
    dia = derechos.dia_del_original(Path(registrado))
    _exigir(dia <= copia and registrado == esperado.replace(f"-{copia}.", f"-{dia}."))
    return registrado


def _extraccion(carpeta: Path, registros: dict, pdf: bytes, copia: str) -> None:
    """Vincula la única extracción local al PDF consultado, sin atribuirle otra petición HTTP."""
    _exigir(len(registros) == 1)
    registro = next(iter(registros.values()))
    _exigir(registro["nivel"] == "extracción")
    esperado = derechos.nombre_del_original(derechos.EXTRACCION, copia, "json")
    nombre = _nombre_registrado(esperado, registro["archivo"], copia)
    contenido = leer_archivo(carpeta, nombre, MAX_DESCARGA_BYTES)
    _exigir(type(registro["bytes"]) is int and registro["bytes"] == len(contenido))
    _exigir(registro["sha256"] == hashlib.sha256(contenido).hexdigest())
    _exigir(registro["sha256_de_origen"] == hashlib.sha256(pdf).hexdigest())
    origen = derechos.nombre_del_original(derechos.RECOMENDACIONES.archivo, copia, "pdf")
    _nombre_registrado(origen, registro["origen"], copia)


def _comprobar(raiz: Path, evidencia: dict) -> None:
    _exigir(type(evidencia) is dict and type(evidencia.get("version")) is int)
    _exigir(evidencia["version"] == VERSION_VINCULADA and evidencia["fuente"] == derechos.FUENTE)
    carpeta = carpeta_originales(raiz, derechos.FUENTE)
    procedencia = leer_procedencia(carpeta, MAX_PROCEDENCIA_BYTES)
    copia = procedencia["copia"]
    _exigir(isinstance(copia, str) and date.fromisoformat(copia).isoformat() == copia)
    registros = por_nombre(procedencia["archivos"])
    esperados = derechos.archivos_de_la_copia(copia)
    oficiales = {registro["url"]: registro for registro in registros.values() if registro["nivel"] == "oficial"}
    _exigir(set(oficiales) == {archivo["url"] for archivo in esperados})
    _exigir(len(registros) == len(esperados) + 1)
    peticiones = evidencia["peticiones"]
    _exigir(type(peticiones) is list and all(type(peticion) is dict for peticion in peticiones))
    por_recurso = {peticion["recurso_sha256"]: peticion for peticion in peticiones}
    _exigir(len(por_recurso) == len(peticiones) == len(esperados))
    _exigir(set(por_recurso) == {identidad_recurso(archivo["url"]) for archivo in esperados})
    pdf = b""
    for archivo in esperados:
        registro = oficiales[archivo["url"]]
        archivo["archivo"] = _nombre_registrado(archivo["archivo"], registro["archivo"], copia)
        leer_original = original_equivalente if archivo.get("equivalentes") is not None else original_vinculado
        contenido = leer_original(
            carpeta,
            archivo,
            registro,
            por_recurso[identidad_recurso(archivo["url"])],
        )
        if archivo["url"] == derechos.RECOMENDACIONES.url:
            pdf = contenido
    locales = {nombre: registro for nombre, registro in registros.items() if registro["nivel"] != "oficial"}
    _extraccion(carpeta, locales, pdf, copia)


def comprobada(raiz: Path, evidencia: dict) -> bool:
    """Comprueba los siete GET declarados, originales y extracción local del CRL.

    El llamador valida el recibo v2 del intento y exige descarga, preparación, validación y admisión.
    Solo los dos consolidados admiten la equivalencia editorial ya aplicada por el productor: mismos artículos
    citados y fecha de actualización. La selección de citas y de documentos sigue requiriendo revisión humana;
    esta consulta no acredita descubrimiento de sucesoras, vigencia general ni aplicabilidad a una persona.

    Returns:
        True con todos los recursos vinculados al intento y la extracción íntegra ligada a ese PDF.
    """
    try:
        _comprobar(raiz, evidencia)
    except (OSError, ValueError, TypeError, KeyError, RecursionError, FormatoInesperado):
        return False
    return True
