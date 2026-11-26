"""Claves, huellas y controles condicionales que admite el transporte S3 privado."""

import re

from plataforma_datos.orquestacion.configuracion_almacen_s3 import ERROR_INVALIDO, AlmacenS3Invalido
from plataforma_datos.orquestacion.formas_del_diario import CLAVE_RESUMEN, MAX_RESUMEN

MAX_OBJETO_BYTES = 4 * 1024**3
SHA256 = re.compile(r"[0-9a-f]{64}")
CLAVE = re.compile(r"(?:blobs/([0-9a-f]{64})|(?:generaciones|artefactos)/([0-9a-f]{64})\.json)")
MAX_CONTROL_BYTES = 8192
MAX_ETAG = 1024
REFERENCIA = "referencias/mantenimiento.json"
CLAVE_ENTRADA = re.compile(r"entradas/v1/([1-9][0-9]{0,15})/([1-9][0-9]{0,15})/[a-z][a-z0-9_-]{0,63}\.json")
CLAVE_ULTIMO_LOTE = re.compile(r"entradas/v1/bases/[0-9a-f]{64}/[0-9]{4}-[0-9]{2}-[0-9]{2}\.json")
CLAVE_CONTROL = re.compile(
    r"(?:referencias/mantenimiento\.json|agrupaciones/v1/(?:generaciones|artefactos|entradas)/[0-9a-f]{64}\.sha256|"
    rf"{CLAVE_ENTRADA.pattern}|"
    rf"{CLAVE_ULTIMO_LOTE.pattern}|"
    r"diarios/[1-9][0-9]{0,15}/[1-9][0-9]{0,15}/(?:ejecutar|reanudar|activar|recuperar|reconciliar)\.json|"
    rf"{CLAVE_RESUMEN.pattern}|"
    r"inventarios/cursos/v1/[0-9a-f]{64}\.json|evidencias/fundae/v1/[0-9a-f]{64}\.sha256|"
    r"(?:trabajos|desbloqueos)/"
    r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/"
    r"[1-9][0-9]{0,15}/[1-9][0-9]{0,15}\.json)"
)


def _exigir(condicion: bool) -> None:
    if not condicion:
        raise AlmacenS3Invalido(ERROR_INVALIDO)


def _limite(valor: int) -> None:
    _exigir(type(valor) is int and 0 <= valor <= MAX_OBJETO_BYTES)


def _clave(clave: str, sha256: str) -> None:
    _exigir(isinstance(sha256, str) and SHA256.fullmatch(sha256) is not None)
    coincidencia = CLAVE.fullmatch(clave) if isinstance(clave, str) else None
    _exigir(coincidencia is not None and sha256 in coincidencia.groups())


def _control(clave: str) -> int:
    _exigir(isinstance(clave, str) and CLAVE_CONTROL.fullmatch(clave) is not None)
    if clave.startswith(("trabajos/", "desbloqueos/")):
        _exigir(all(int(valor) <= 2**53 - 1 for valor in clave.removesuffix(".json").split("/")[2:]))
    entrada = CLAVE_ENTRADA.fullmatch(clave)
    if entrada is not None:
        _exigir(all(int(valor) <= 2**53 - 1 for valor in entrada.groups()))
    # Solo el resumen del diario supera el tope común de los controles.
    return MAX_RESUMEN if CLAVE_RESUMEN.fullmatch(clave) else MAX_CONTROL_BYTES


def _etag(valor: object) -> None:
    # Una entidad fuerte única: '*' y listas alterarían la semántica de IfMatch, aunque sean ASCII.
    _exigir(
        isinstance(valor, str) and len(valor) <= MAX_ETAG and re.fullmatch(r'"[\x21\x23-\x7e]*"', valor) is not None
    )
