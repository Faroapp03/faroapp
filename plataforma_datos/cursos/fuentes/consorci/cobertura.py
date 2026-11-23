"""Cobertura de los cuatro conjuntos de Consorci, vinculada a los originales admitidos.

El llamador conserva el cerrojo, valida la identidad fresca del intento y exige módulo admitido y las tres etapas
correctas. Esta comprobación no descarga, no escribe ni acredita activación. La API actual no pagina: exige una
respuesta por conjunto por debajo del límite y el recuento completo declarado por sus metadatos.
"""

import hashlib
import json
import os
import stat
from datetime import date
from pathlib import Path
from typing import Any

from plataforma_datos.comun.entrada_salida import Json
from plataforma_datos.comun.nucleo import DATOS_RELATIVOS, MAX_DESCARGA_BYTES, FormatoInesperado
from plataforma_datos.comun.observacion_remota import identidad_recurso, validar_recepcion
from plataforma_datos.comun.socrata import LIMITE_FILAS, archivos_de_la_copia, metadatos
from plataforma_datos.cursos.fuentes.consorci.constantes import CONJUNTOS, OFERTA, ORIGEN_CONSORCI

MAX_INFORME_BYTES = 256 * 1024
VERSION_VINCULADA = 2


def _exigir(condicion: bool) -> None:
    if not condicion:
        raise ValueError("Cobertura de Consorci no verificable.")


def _pares(pares: list[tuple[str, Any]]) -> dict[str, Any]:
    resultado: dict[str, Any] = {}
    for clave, valor in pares:
        _exigir(clave not in resultado)
        resultado[clave] = valor
    return resultado


def _constante(_valor: str) -> None:
    raise ValueError("Número JSON no finito.")


def _json(contenido: bytes) -> Json:
    return json.loads(contenido.decode("utf-8"), object_pairs_hook=_pares, parse_constant=_constante)


def _leer(raiz: Path, relativa: Path, limite: int) -> bytes:
    ruta = Path(raiz)
    _exigir(stat.S_ISDIR(ruta.lstat().st_mode))
    for parte in relativa.parts[:-1]:
        ruta /= parte
        _exigir(stat.S_ISDIR(ruta.lstat().st_mode))
    ruta /= relativa.name
    descriptor = os.open(ruta, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, "rb") as archivo:
        estado = os.fstat(archivo.fileno())
        _exigir(stat.S_ISREG(estado.st_mode) and estado.st_nlink == 1 and 0 < estado.st_size <= limite)
        contenido = archivo.read(limite + 1)
    _exigir(len(contenido) == estado.st_size and len(contenido) <= limite)
    return contenido


def _originales(raiz: Path, evidencia: dict, procedencia: dict, fecha: str) -> dict[str, Any]:
    esperados = archivos_de_la_copia(CONJUNTOS, fecha)
    entradas = procedencia["archivos"]
    _exigir(type(entradas) is list and len(entradas) == len(esperados))
    _exigir(all(type(entrada) is dict and isinstance(entrada.get("archivo"), str) for entrada in entradas))
    por_nombre = {entrada["archivo"]: entrada for entrada in entradas}
    _exigir(len(por_nombre) == len(esperados) and set(por_nombre) == {a["archivo"] for a in esperados})
    peticiones = evidencia["peticiones"]
    _exigir(len(peticiones) == len(esperados))
    por_recurso = {peticion["recurso_sha256"]: peticion for peticion in peticiones}
    _exigir(len(por_recurso) == len(esperados))
    originales = {}
    for esperado in esperados:
        nombre, url = esperado["archivo"], esperado["url"]
        entrada = por_nombre[nombre]
        peticion = por_recurso[identidad_recurso(url)]
        _exigir(entrada["url"] == entrada["url_final"] == url)
        _exigir(peticion["url_final_sha256"] == hashlib.sha256(url.encode()).hexdigest())
        contenido = _leer(raiz, DATOS_RELATIVOS / "originales/consorci" / nombre, MAX_DESCARGA_BYTES)
        huella = hashlib.sha256(contenido).hexdigest()
        _exigir(type(entrada["bytes"]) is int and entrada["bytes"] == len(contenido))
        _exigir(entrada["sha256"] == huella == peticion["original_sha256"])
        _exigir(type(peticion["original_bytes"]) is int and peticion["original_bytes"] == len(contenido))
        if not nombre.endswith("-metadatos.json"):
            # Solo los metadatos tienen equivalencia Socrata; las filas siempre deben ser los bytes remotos.
            _exigir(peticion["respuesta_sha256"] == huella and peticion["bytes"] == len(contenido))
        originales[nombre] = _json(contenido)
    return originales


def _comprobar(raiz: Path, evidencia: dict) -> None:
    _exigir(type(evidencia) is dict and evidencia.get("version") == VERSION_VINCULADA)
    evidencia = validar_recepcion(evidencia, "consorci", evidencia["intento"])
    procedencia = _json(_leer(raiz, DATOS_RELATIVOS / "originales/consorci/procedencia.json", MAX_INFORME_BYTES))
    _exigir(type(procedencia) is dict and isinstance(procedencia.get("copia"), str))
    fecha = procedencia["copia"]
    _exigir(date.fromisoformat(fecha).isoformat() == fecha)
    originales = _originales(raiz, evidencia, procedencia, fecha)
    resumen = _json(_leer(raiz, DATOS_RELATIVOS / "preparados/consorci/resumen.json", MAX_INFORME_BYTES))
    informe = _json(_leer(raiz, DATOS_RELATIVOS / "validados/consorci/validacion.json", MAX_INFORME_BYTES))
    _exigir(type(resumen) is dict and resumen.get("copia") == fecha)
    _exigir(type(informe) is dict and informe.get("copia") == fecha and informe.get("estado") == "Admitido")
    controles = informe.get("controles")
    _exigir(type(controles) is list and bool(controles))
    _exigir(all(type(c) is dict and c.get("resultado") == "correcto" for c in controles))
    conjuntos = resumen["conjuntos"]
    _exigir(type(conjuntos) is dict and set(conjuntos) == {c.identificador for c in CONJUNTOS})
    for conjunto in CONJUNTOS:
        identificador = conjunto.identificador
        filas = originales[f"{identificador}-{fecha}.json"]
        contenido = originales[f"{identificador}-{fecha}-metadatos.json"]
        _exigir(type(filas) is list and all(type(fila) is dict for fila in filas))
        datos = metadatos(contenido, identificador)
        campos = [columna["fieldName"] for columna in contenido["columns"]]
        _exigir(len(set(campos)) == len(campos))
        for columna in contenido["columns"]:
            if columna["fieldName"] == "origen":
                origenes = [valor["item"] for valor in columna["cachedContents"]["top"]]
                _exigir(len(set(origenes)) == len(origenes))
        declaradas = datos["filas_segun_metadatos"]
        if conjunto == OFERTA:
            declaradas = datos["filas_por_origen"].get(ORIGEN_CONSORCI)
            _exigir(all(fila.get("origen") == ORIGEN_CONSORCI for fila in filas))
        _exigir(type(declaradas) is int and len(filas) == declaradas and len(filas) < LIMITE_FILAS)
        preparado = conjuntos[identificador]
        _exigir(type(preparado) is dict and type(preparado.get("filas")) is int)
        _exigir(preparado["filas"] == len(filas) and all(preparado.get(k) == v for k, v in datos.items()))


def comprobada(raiz: Path, evidencia: dict) -> bool:
    """Comprueba los ocho recursos oficiales y su copia admitida; cualquier evidencia incompleta devuelve False.

    Recepciones v1 no prueban el vínculo con originales conservados y no se promueven. Las diferencias entre
    respuesta y original solo se admiten para metadatos vinculados por la equivalencia Socrata del transporte.

    Returns:
        Si todos los recursos usados están vinculados y sus recuentos acreditan la consulta completa.
    """
    try:
        _comprobar(raiz, evidencia)
    except (OSError, ValueError, TypeError, KeyError, RecursionError, FormatoInesperado):
        return False
    return True
