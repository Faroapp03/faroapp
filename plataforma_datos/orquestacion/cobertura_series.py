"""Vincula las consultas completas de las series abiertas con sus originales admitidos.

El padre valida la recepción del intento vigente y solo llama tras descargar, preparar, validar y admitir el
módulo. Las consultas descubren el calendario completo; aquí se comprueban todos sus recursos, sin atribuir a una
consulta la activación del paquete ni renovar las fechas históricas de procedencia. En ocupados el calendario
es abierto dentro de las tablas actuales; el alcance territorial son los municipios y controles del producto,
no el descubrimiento de municipios adicionales ni de sustituciones futuras de tablas oficiales.
"""

import hashlib
import json
import os
import stat
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any, BinaryIO

import plataforma_datos.ia_y_trabajo.fuentes.mundo_eurostat.lector as mundo_eurostat
import plataforma_datos.ia_y_trabajo.fuentes.ue_eurostat.lector as ue_eurostat
import plataforma_datos.mercado.fuentes.ilostat.lector as ilostat
import plataforma_datos.mercado.fuentes.ocupados.lector as ocupados
from plataforma_datos.comun.nucleo import DATOS_RELATIVOS, MAX_DESCARGA_BYTES, ArchivoDescargable, FormatoInesperado
from plataforma_datos.comun.observacion_remota import VERSION_VINCULADA, identidad_recurso
from plataforma_datos.mercado.fuentes.ocupados.piezas.constantes_ocupados import MAX_PROCEDENCIA_BYTES

SERIES = {
    "mundo_eurostat": mundo_eurostat,
    "ue_eurostat": ue_eurostat,
    "ilostat": ilostat,
    "ocupados": ocupados,
}
TROZO_BYTES = 1 << 20


def _exigir(condicion: bool) -> None:
    if not condicion:
        raise ValueError("Cobertura de la serie no verificable.")


def _pares(pares: list[tuple[str, Any]]) -> dict[str, Any]:
    resultado: dict[str, Any] = {}
    for clave, valor in pares:
        _exigir(clave not in resultado)
        resultado[clave] = valor
    return resultado


def _constante(_valor: str) -> None:
    raise ValueError("Número JSON no finito.")


def _carpeta(raiz: Path, fuente: str) -> Path:
    carpeta = Path(raiz)
    _exigir(stat.S_ISDIR(carpeta.lstat().st_mode))
    for parte in (*DATOS_RELATIVOS.parts, "originales", fuente):
        carpeta /= parte
        _exigir(stat.S_ISDIR(carpeta.lstat().st_mode))
    return carpeta


@contextmanager
def _abrir(carpeta: Path, nombre: str, limite: int) -> Iterator[BinaryIO]:
    descriptor = os.open(carpeta / nombre, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC)
    with os.fdopen(descriptor, "rb") as archivo:
        estado = os.fstat(archivo.fileno())
        _exigir(stat.S_ISREG(estado.st_mode) and estado.st_nlink == 1 and 0 < estado.st_size <= limite)
        yield archivo


def _procedencia(carpeta: Path) -> dict:
    with _abrir(carpeta, "procedencia.json", MAX_PROCEDENCIA_BYTES) as archivo:
        contenido = archivo.read(MAX_PROCEDENCIA_BYTES + 1)
        _exigir(len(contenido) <= MAX_PROCEDENCIA_BYTES)
    documento = json.loads(contenido.decode("utf-8"), object_pairs_hook=_pares, parse_constant=_constante)
    _exigir(type(documento) is dict)
    return documento


def _huella(carpeta: Path, nombre: str) -> tuple[str, int]:
    # ILOSTAT es grande: se coteja el cuerpo completo por bloques, sin otra copia en memoria.
    huella = hashlib.sha256()
    tamano = 0
    with _abrir(carpeta, nombre, MAX_DESCARGA_BYTES) as archivo:
        while trozo := archivo.read(min(TROZO_BYTES, MAX_DESCARGA_BYTES + 1 - tamano)):
            tamano += len(trozo)
            _exigir(tamano <= MAX_DESCARGA_BYTES)
            huella.update(trozo)
        _exigir(tamano == os.fstat(archivo.fileno()).st_size)
    return huella.hexdigest(), tamano


def _original(carpeta: Path, esperado: ArchivoDescargable, registro: dict, peticion: dict) -> None:
    url = esperado["url"]
    _exigir(registro["url"] == registro["url_final"] == url)
    _exigir(peticion["url_final_sha256"] == hashlib.sha256(url.encode()).hexdigest())
    huella, tamano = _huella(carpeta, esperado["archivo"])
    _exigir(type(registro["bytes"]) is int and registro["bytes"] == tamano)
    # Estas fuentes no admiten equivalencias: el original utilizado debe ser todo el cuerpo HTTP observado.
    _exigir(tamano == peticion["bytes"] == peticion["original_bytes"])
    _exigir(huella == registro["sha256"] == peticion["respuesta_sha256"] == peticion["original_sha256"])


def _esperados_ocupados(
    carpeta: Path, procedencia: dict, por_nombre: dict, por_recurso: dict
) -> list[ArchivoDescargable]:
    # Solo la captura por metadatos y partes (idescat_partes = 1) acredita cobertura; la captura histórica de
    # originales completos, que el lector de ocupados sigue leyendo, no se admite como consulta remota.
    _exigir(type(procedencia.get("idescat_partes")) is int and procedencia["idescat_partes"] == 1)
    for esperado in ocupados.METADATOS_IDESCAT:
        _original(carpeta, esperado, por_nombre[esperado["archivo"]], por_recurso[identidad_recurso(esperado["url"])])
    metadatos = {}
    for esperado in ocupados.METADATOS_IDESCAT:
        nombre = esperado["archivo"]
        with _abrir(carpeta, nombre, MAX_DESCARGA_BYTES) as archivo:
            contenido = archivo.read(MAX_DESCARGA_BYTES + 1)
            _exigir(len(contenido) <= MAX_DESCARGA_BYTES)
        # El plan usa los mismos bytes cotejados, también si el archivo cambió entre ambas aperturas.
        _exigir(len(contenido) == por_nombre[nombre]["bytes"])
        _exigir(hashlib.sha256(contenido).hexdigest() == por_nombre[nombre]["sha256"])
        metadatos[nombre] = json.loads(contenido.decode("utf-8"), object_pairs_hook=_pares, parse_constant=_constante)
    return [*ocupados.METADATOS_IDESCAT, *ocupados.planificar_partes(metadatos), *ocupados.ARCHIVOS_AUXILIARES]


def _comprobar(raiz: Path, evidencia: dict) -> None:
    _exigir(type(evidencia) is dict and evidencia.get("version") == VERSION_VINCULADA)
    modulo = SERIES[evidencia["fuente"]]
    esperados = modulo.ARCHIVOS
    carpeta = _carpeta(raiz, modulo.FUENTE)
    procedencia = _procedencia(carpeta)
    registros = procedencia["archivos"]
    _exigir(type(registros) is list)
    _exigir(all(type(registro) is dict and isinstance(registro.get("archivo"), str) for registro in registros))
    por_nombre = {registro["archivo"]: registro for registro in registros}
    _exigir(len(por_nombre) == len(registros))
    peticiones = evidencia["peticiones"]
    _exigir(type(peticiones) is list)
    por_recurso = {peticion["recurso_sha256"]: peticion for peticion in peticiones}
    _exigir(len(por_recurso) == len(peticiones))
    if modulo is ocupados:
        esperados = _esperados_ocupados(carpeta, procedencia, por_nombre, por_recurso)
    _exigir(len(registros) == len(peticiones) == len(esperados))
    _exigir(set(por_nombre) == {a["archivo"] for a in esperados})
    _exigir(set(por_recurso) == {identidad_recurso(a["url"]) for a in esperados})
    for esperado in esperados:
        _original(carpeta, esperado, por_nombre[esperado["archivo"]], por_recurso[identidad_recurso(esperado["url"])])


def comprobada(raiz: Path, evidencia: dict) -> bool:
    """Exige los recursos oficiales exactos de la serie y sus mismos bytes en los originales admitidos.

    La recepción v2 debe llegar validada por el padre para el intento vigente. Los metadatos de ocupados se leen
    después de vincularlos para recalcular sus partes; no se repiten los controles estadísticos ni la admisión del
    módulo. Un recibo v1 nunca acredita este vínculo.

    Returns:
        True solo si no falta ni sobra ninguna consulta y cada cuerpo completo coincide con el original utilizado.
    """
    try:
        _comprobar(raiz, evidencia)
    except (OSError, ValueError, TypeError, KeyError, RecursionError, FormatoInesperado):
        return False
    return True
