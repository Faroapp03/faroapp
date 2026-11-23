"""Lectura acotada y vínculo exacto de originales con los cuerpos HTTP observados en recibos v2."""

import hashlib
import json
import os
import re
import stat
from pathlib import Path
from typing import Any

from plataforma_datos.comun.nucleo import DATOS_RELATIVOS, MAX_DESCARGA_BYTES


def _exigir(condicion: bool) -> None:
    if not condicion:
        raise ValueError("Original remoto no verificable.")


def _pares(pares: list[tuple[str, Any]]) -> dict[str, Any]:
    resultado: dict[str, Any] = {}
    for clave, valor in pares:
        _exigir(clave not in resultado)
        resultado[clave] = valor
    return resultado


def _constante(_valor: str) -> None:
    raise ValueError("Número JSON no finito.")


def carpeta_originales(raiz: Path, fuente: str) -> Path:
    """Exige directorios reales desde la raíz operativa hasta la fuente, sin seguir enlaces.

    Returns:
        Carpeta de originales de la fuente bajo var/actualizacion.
    """
    _exigir(isinstance(fuente, str) and re.fullmatch(r"[a-z][a-z0-9_-]*", fuente) is not None)
    carpeta = Path(raiz)
    _exigir(stat.S_ISDIR(carpeta.lstat().st_mode))
    for parte in (*DATOS_RELATIVOS.parts, "originales", fuente):
        carpeta /= parte
        _exigir(stat.S_ISDIR(carpeta.lstat().st_mode))
    return carpeta


def leer_archivo(carpeta: Path, nombre: str, limite: int) -> bytes:
    """Lee un archivo regular de un solo enlace, no vacío y dentro de la cota del consumidor.

    Returns:
        Sus bytes completos, sin seguir symlinks ni aceptar rutas relativas a otra carpeta.
    """
    _exigir(
        isinstance(nombre, str)
        and bool(nombre)
        and nombre not in (".", "..")
        and "/" not in nombre
        and "\\" not in nombre
    )
    _exigir(type(limite) is int and 0 < limite <= MAX_DESCARGA_BYTES)
    descriptor = os.open(carpeta / nombre, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC)
    with os.fdopen(descriptor, "rb") as archivo:
        estado = os.fstat(archivo.fileno())
        _exigir(stat.S_ISREG(estado.st_mode) and estado.st_nlink == 1 and 0 < estado.st_size <= limite)
        contenido = archivo.read(limite + 1)
        _exigir(len(contenido) == estado.st_size)
    return contenido


def leer_procedencia(carpeta: Path, limite: int) -> dict:
    """Lee la procedencia sin claves duplicadas, constantes no finitas ni enlaces.

    Returns:
        El objeto JSON íntegro.
    """
    documento = json.loads(
        leer_archivo(carpeta, "procedencia.json", limite), object_pairs_hook=_pares, parse_constant=_constante
    )
    _exigir(type(documento) is dict)
    return documento


def por_nombre(registros: object) -> dict[str, dict]:
    """Indexa una lista de registros sin perder duplicados ni identidades inválidas.

    Returns:
        Cada registro por su nombre de archivo; el consumidor exige después el inventario exacto.
    """
    _exigir(type(registros) is list)
    _exigir(all(type(registro) is dict and isinstance(registro.get("archivo"), str) for registro in registros))
    resultado = {registro["archivo"]: registro for registro in registros}
    _exigir(len(resultado) == len(registros))
    return resultado


def original_equivalente(
    carpeta: Path, esperado: dict, registro: dict, peticion: dict, *, urls_finales: set[str] | None = None
) -> bytes:
    """Coteja el original vinculado por un transporte con política de equivalencia explícita.

    La identidad del método, URL y cuerpo de petición y el inventario completo los comprueba el consumidor.
    Solo un consumidor con esa política permite diferencias con la respuesta: el recibo v2 validado debe
    proceder del transporte observado, que vincula el original después de aplicar esa política.
    Esta lectura no deduce equivalencia de huellas distintas ni compara semánticamente los cuerpos.

    Returns:
        El cuerpo completo vinculado, para derivar el plan desde esos mismos bytes cuando haga falta.
    """
    url = esperado["url"]
    finales = {url} if urls_finales is None else urls_finales
    _exigir(registro["archivo"] == esperado["archivo"] and registro["url"] == url and registro["url_final"] in finales)
    _exigir(peticion["url_final_sha256"] == hashlib.sha256(registro["url_final"].encode()).hexdigest())
    contenido = leer_archivo(carpeta, esperado["archivo"], MAX_DESCARGA_BYTES)
    tamano, huella = len(contenido), hashlib.sha256(contenido).hexdigest()
    _exigir(all(type(valor) is int for valor in (registro["bytes"], peticion["bytes"], peticion["original_bytes"])))
    _exigir(tamano == registro["bytes"] == peticion["original_bytes"])
    _exigir(huella == registro["sha256"] == peticion["original_sha256"])
    _exigir(0 < peticion["bytes"] <= MAX_DESCARGA_BYTES)
    _exigir(
        isinstance(peticion["respuesta_sha256"], str)
        and re.fullmatch(r"[0-9a-f]{64}", peticion["respuesta_sha256"]) is not None
    )
    return contenido


def original_vinculado(
    carpeta: Path, esperado: dict, registro: dict, peticion: dict, *, urls_finales: set[str] | None = None
) -> bytes:
    """Exige además igualdad exacta entre la respuesta HTTP, el original y su procedencia.

    La identidad del recurso y el inventario completo corresponden al consumidor. Esta variante no
    admite equivalencias, aunque el transporte haya vinculado un original con bytes distintos.

    Returns:
        Cuerpo íntegro y exacto del recurso observado, sin modificar archivos ni fechas.
    """
    contenido = original_equivalente(carpeta, esperado, registro, peticion, urls_finales=urls_finales)
    _exigir(len(contenido) == peticion["bytes"] and registro["sha256"] == peticion["respuesta_sha256"])
    return contenido
