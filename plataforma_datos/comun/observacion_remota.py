"""Observaciones HTTP privadas de una descarga; no acreditan por sí solas el alcance de una fuente."""

import hashlib
import json
import os
import re
import stat
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from plataforma_datos.comun.nucleo import MAX_DESCARGA_BYTES, Descarga, FormatoInesperado

VARIABLE_RECEPCION = "FARO_RECEPCION_REMOTA"
MAX_RECEPCION_BYTES = 8 * 1024 * 1024
MAX_PETICIONES = 10_000
MAX_CONFIGURACION_BYTES = 8192
VERSION_VINCULADA = 2
ERROR = "Observación remota no verificable."
FUENTE = re.compile(r"[a-z][a-z0-9_]{0,63}")
INTENTO = re.compile(r"[A-Za-z0-9_-]{1,128}")
SHA256 = re.compile(r"[0-9a-f]{64}")
INSTANTE = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)")


@dataclass
class _Coleccion:
    fuente: str
    intento: str
    comienzo: str
    peticiones: list[dict[str, Any]] = field(default_factory=list)
    invalida: bool = False


_ACTUAL: ContextVar[_Coleccion | None] = ContextVar("observacion_remota", default=None)


def _exigir(condicion: bool) -> None:
    if not condicion:
        raise FormatoInesperado(ERROR)


def _objeto(valor: object, claves: str) -> dict[str, Any]:
    _exigir(type(valor) is dict and set(valor) == set(claves.split(",")))
    return valor


def _pares(pares: list[tuple[str, Any]]) -> dict[str, Any]:
    objeto: dict[str, Any] = {}
    for clave, valor in pares:
        _exigir(clave not in objeto)
        objeto[clave] = valor
    return objeto


def _constante(_valor: str) -> None:
    raise FormatoInesperado(ERROR)


def _json(contenido: bytes) -> object:
    try:
        return json.loads(contenido.decode("utf-8"), object_pairs_hook=_pares, parse_constant=_constante)
    except (ValueError, RecursionError):
        raise FormatoInesperado(ERROR) from None


def _instante(valor: object) -> datetime:
    _exigir(isinstance(valor, str) and INSTANTE.fullmatch(valor) is not None)
    try:
        return datetime.fromisoformat(valor.replace("Z", "+00:00"))
    except ValueError:
        raise FormatoInesperado(ERROR) from None


def _identidad(fuente: str, intento: str) -> None:
    _exigir(isinstance(fuente, str) and FUENTE.fullmatch(fuente) is not None)
    _exigir(isinstance(intento, str) and INTENTO.fullmatch(intento) is not None)


def _sha(contenido: bytes) -> str:
    return hashlib.sha256(contenido).hexdigest()


def identidad_recurso(url: str, metodo: str = "GET", cuerpo: bytes | None = None) -> str:
    """Identifica método, URL exacta y cuerpo sin persistirlos; None y cuerpo vacío son distintos.

    Returns:
        SHA-256 con campos prefijados por su longitud, sin ambigüedad de concatenación.

    Raises:
        FormatoInesperado: Si los componentes no tienen tipos o codificación admitidos.
    """
    _exigir(isinstance(url, str) and bool(url))
    _exigir(isinstance(metodo, str) and re.fullmatch(r"[A-Z]{1,16}", metodo) is not None)
    _exigir(cuerpo is None or type(cuerpo) is bytes)
    try:
        partes = (metodo.encode("ascii"), url.encode("utf-8"), b"\x00" if cuerpo is None else b"\x01" + cuerpo)
    except UnicodeError:
        raise FormatoInesperado(ERROR) from None
    huella = hashlib.sha256(b"faro-recurso-v1\x00")
    for parte in partes:
        huella.update(len(parte).to_bytes(8, "big"))
        huella.update(parte)
    return huella.hexdigest()


def validar_recepcion(entrada: object, fuente: str, intento: str) -> dict[str, Any]:
    """Valida el contrato cerrado; cero peticiones es válido y no acredita comprobación remota.

    Returns:
        Documento independiente de la entrada, sin campos no admitidos.
    """
    _identidad(fuente, intento)
    o = _objeto(entrada, "version,fuente,intento,comienzo_utc,fin_utc,peticiones")
    _exigir(type(o["version"]) is int and o["version"] in (1, VERSION_VINCULADA))
    _exigir(o["fuente"] == fuente and o["intento"] == intento)
    comienzo, fin = _instante(o["comienzo_utc"]), _instante(o["fin_utc"])
    _exigir(comienzo <= fin and type(o["peticiones"]) is list and len(o["peticiones"]) <= MAX_PETICIONES)
    peticiones = []
    anterior = comienzo
    for entrada_peticion in o["peticiones"]:
        claves = "recurso_sha256,url_final_sha256,respuesta_sha256,bytes,completado_utc"
        if o["version"] == VERSION_VINCULADA:
            claves += ",original_sha256,original_bytes"
        p = _objeto(entrada_peticion, claves)
        for clave in ("recurso_sha256", "url_final_sha256", "respuesta_sha256"):
            _exigir(isinstance(p[clave], str) and SHA256.fullmatch(p[clave]) is not None)
        _exigir(type(p["bytes"]) is int and 0 <= p["bytes"] <= MAX_DESCARGA_BYTES)
        if o["version"] == VERSION_VINCULADA:
            _validar_original(p)
        completado = _instante(p["completado_utc"])
        _exigir(anterior <= completado <= fin)
        anterior = completado
        peticiones.append(dict(p))
    return {**o, "peticiones": peticiones}


def _validar_original(peticion: dict[str, Any]) -> None:
    """La vinculación es completa o ausente; nunca se infiere de una recepción anterior."""
    huella, tamano = peticion["original_sha256"], peticion["original_bytes"]
    if huella is None:
        _exigir(tamano is None)
        return
    _exigir(isinstance(huella, str) and SHA256.fullmatch(huella) is not None)
    _exigir(type(tamano) is int and 0 <= tamano <= MAX_DESCARGA_BYTES)


def leer_recepcion(ruta: Path, fuente: str, intento: str) -> dict[str, Any] | None:
    """Lee una recepción nueva y acotada sin seguir enlaces.

    Returns:
        Documento validado, o None únicamente si la ruta no existe.

    Raises:
        FormatoInesperado: Si el archivo existente o su documento no cumple el contrato.
    """
    _identidad(fuente, intento)
    ruta = Path(ruta)
    try:
        previo = ruta.lstat()
    except FileNotFoundError:
        return None
    except OSError:
        raise FormatoInesperado(ERROR) from None
    _exigir(stat.S_ISREG(previo.st_mode) and previo.st_nlink == 1 and 0 < previo.st_size <= MAX_RECEPCION_BYTES)
    try:
        descriptor = os.open(ruta, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC)
        with os.fdopen(descriptor, "rb") as archivo:
            estado = os.fstat(archivo.fileno())
            _exigir(estado.st_dev == previo.st_dev and estado.st_ino == previo.st_ino and estado.st_nlink == 1)
            contenido = archivo.read(MAX_RECEPCION_BYTES + 1)
    except OSError:
        raise FormatoInesperado(ERROR) from None
    _exigir(len(contenido) == previo.st_size)
    return validar_recepcion(_json(contenido), fuente, intento)


def observar(url: str, metodo: str, cuerpo_peticion: bytes | None, url_final: str, datos: bytes) -> None:
    """Registra solo una lectura HTTP completada dentro de la descarga que se está observando.

    Sin contexto no valida argumentos ni modifica la conducta del transporte común.

    Raises:
        FormatoInesperado: Si una observación activa excede las cotas o sus argumentos no son válidos.
    """
    coleccion = _ACTUAL.get()
    if coleccion is None:
        return
    try:
        _exigir(
            len(coleccion.peticiones) < MAX_PETICIONES and type(datos) is bytes and len(datos) <= MAX_DESCARGA_BYTES
        )
        _exigir(isinstance(url_final, str) and bool(url_final))
        peticion = {
            "recurso_sha256": identidad_recurso(url, metodo, cuerpo_peticion),
            "url_final_sha256": _sha(url_final.encode("utf-8")),
            "respuesta_sha256": _sha(datos),
            "bytes": len(datos),
            "completado_utc": datetime.now(UTC).isoformat(),
            "original_sha256": None,
            "original_bytes": None,
        }
    except (FormatoInesperado, UnicodeError):
        coleccion.invalida = True
        raise FormatoInesperado(ERROR) from None
    coleccion.peticiones.append(peticion)


def observar_original(url: str, descarga: Descarga, original: bytes) -> None:
    """Vincula la última respuesta GET con los bytes que la política de conservación acaba de admitir.

    Se llama después de conservar_o_sustituir: una equivalencia puede conservar bytes distintos del HTTP.
    No acredita todavía la preparación, validación ni admisión del módulo. Sin contexto no hace trabajo.

    Raises:
        FormatoInesperado: Si falta la recepción exacta, ya estaba vinculada o los bytes exceden su cota.
    """
    coleccion = _ACTUAL.get()
    if coleccion is None:
        return
    try:
        _exigir(bool(coleccion.peticiones) and type(original) is bytes and len(original) <= MAX_DESCARGA_BYTES)
        peticion = coleccion.peticiones[-1]
        _exigir(
            peticion["original_sha256"] is None
            and peticion["recurso_sha256"] == identidad_recurso(url)
            and peticion["url_final_sha256"] == _sha(descarga.url_final.encode("utf-8"))
            and peticion["respuesta_sha256"] == _sha(descarga.datos)
            and peticion["bytes"] == len(descarga.datos)
        )
        peticion["original_sha256"] = _sha(original)
        peticion["original_bytes"] = len(original)
    except (FormatoInesperado, UnicodeError):
        coleccion.invalida = True
        raise FormatoInesperado(ERROR) from None


def _configuracion(contenido: str) -> dict[str, str]:
    try:
        datos = contenido.encode("utf-8")
    except UnicodeError:
        raise FormatoInesperado(ERROR) from None
    _exigir(len(datos) <= MAX_CONFIGURACION_BYTES)
    o = _objeto(_json(datos), "ruta,fuente,intento")
    _identidad(o["fuente"], o["intento"])
    _exigir(
        isinstance(o["ruta"], str) and bool(o["ruta"]) and Path(o["ruta"]).is_absolute() and "\x00" not in o["ruta"]
    )
    try:
        o["ruta"].encode("utf-8")
    except UnicodeError:
        raise FormatoInesperado(ERROR) from None
    return o


def _guardar(ruta: Path, documento: dict[str, Any]) -> None:
    contenido = json.dumps(documento, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")
    _exigir(len(contenido) <= MAX_RECEPCION_BYTES)
    try:
        descriptor = os.open(ruta, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
    except OSError:
        raise FormatoInesperado(ERROR) from None
    propio = os.fstat(descriptor)
    try:
        with os.fdopen(descriptor, "wb") as archivo:
            archivo.write(contenido)
            archivo.flush()
            os.fsync(archivo.fileno())
    except OSError:
        actual = ruta.lstat()
        if actual.st_dev == propio.st_dev and actual.st_ino == propio.st_ino:
            ruta.unlink()
        raise FormatoInesperado(ERROR) from None


@contextmanager
def contexto_descarga() -> Iterator[None]:
    """Consume la recepción interna y emite solo al completar la llamada de retorno de descarga.

    Raises:
        FormatoInesperado: Si la configuración o la observación no es verificable, o se anidan contextos activos.
    """
    contenido = os.environ.pop(VARIABLE_RECEPCION, None)
    anterior = _ACTUAL.get()
    if anterior is not None:
        anterior.invalida = True
        raise FormatoInesperado(ERROR)
    if contenido is None:
        yield
        return
    configuracion = _configuracion(contenido)
    coleccion = _Coleccion(configuracion["fuente"], configuracion["intento"], datetime.now(UTC).isoformat())
    token = _ACTUAL.set(coleccion)
    try:
        yield
        _exigir(not coleccion.invalida)
        documento = validar_recepcion(
            {
                "version": VERSION_VINCULADA,
                "fuente": coleccion.fuente,
                "intento": coleccion.intento,
                "comienzo_utc": coleccion.comienzo,
                "fin_utc": datetime.now(UTC).isoformat(),
                "peticiones": coleccion.peticiones,
            },
            coleccion.fuente,
            coleccion.intento,
        )
        _guardar(Path(configuracion["ruta"]), documento)
    finally:
        _ACTUAL.reset(token)
