"""Consulta de los cinco recursos ACTIC declarados; no acredita la vigencia de su selección normativa."""

from pathlib import Path

import plataforma_datos.cursos.fuentes.actic.lector as actic
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
# Destinos DOGC observados en los originales admitidos de estas tres disposiciones, no un permiso por dominio.
FINALES_DOGC = {
    actic.CONTENIDOS: "https://portaldogc.gencat.cat/utilsEADOP/PDF/9634/2142836.pdf",
    actic.NORMAS: "https://portaldogc.gencat.cat/utilsEADOP/PDF/9634/2142738.pdf",
    actic.MODIFICACION: "https://portaldogc.gencat.cat/utilsEADOP/PDF/9712/2162675.pdf",
}


def _exigir(condicion: bool) -> None:
    if not condicion:
        raise ValueError("Consulta de recursos ACTIC no verificable.")


def _comprobar(raiz: Path, evidencia: dict) -> None:
    _exigir(type(evidencia) is dict and type(evidencia.get("version")) is int)
    _exigir(evidencia["version"] == VERSION_VINCULADA and evidencia.get("fuente") == actic.FUENTE)
    carpeta = carpeta_originales(raiz, actic.FUENTE)
    procedencia = leer_procedencia(carpeta, MAX_PROCEDENCIA_BYTES)
    registros = por_nombre(procedencia["archivos"])
    _exigir(set(registros) == {archivo["archivo"] for archivo in actic.ARCHIVOS})
    peticiones = evidencia["peticiones"]
    _exigir(type(peticiones) is list and all(type(peticion) is dict for peticion in peticiones))
    por_recurso = {peticion["recurso_sha256"]: peticion for peticion in peticiones}
    _exigir(len(por_recurso) == len(peticiones) == len(actic.ARCHIVOS))
    _exigir(set(por_recurso) == {identidad_recurso(archivo["url"]) for archivo in actic.ARCHIVOS})
    for archivo in actic.ARCHIVOS:
        nombre, url = archivo["archivo"], archivo["url"]
        registro = registros[nombre]
        _exigir(("norma" in registro) == ("norma" in archivo) and registro.get("norma") == archivo.get("norma"))
        finales = {url}
        if nombre in FINALES_DOGC:
            finales.add(FINALES_DOGC[nombre])
        vincular = original_equivalente if nombre in (actic.PROCEDIMIENTO, actic.NIVELES_WEB) else original_vinculado
        vincular(
            carpeta,
            archivo,
            registro,
            por_recurso[identidad_recurso(url)],
            urls_finales=finales,
        )


def comprobada(raiz: Path, evidencia: dict) -> bool:
    """Acredita la consulta íntegra de las tres disposiciones fijas y las dos páginas declaradas.

    El llamador valida el recibo v2 del intento y exige preparación, validación y admisión del módulo.
    Los PDF requieren los bytes remotos exactos. Solo las páginas admiten el vínculo a la copia conservada
    por la equivalencia de texto de ACTIC, aplicada antes de emitir el recibo v2 del transporte.
    Los pasajes validan la transcripción seleccionada; ni su presencia ni esta consulta descubren normas
    sucesoras, comprueban todas las disposiciones aplicables o sustituyen la revisión editorial.

    Returns:
        True con los cinco recursos vinculados al mismo intento, sin alterar originales ni fechas.
    """
    try:
        _comprobar(raiz, evidencia)
    except (OSError, ValueError, TypeError, KeyError, RecursionError, FormatoInesperado):
        return False
    return True
