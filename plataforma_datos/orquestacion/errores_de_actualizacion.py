"""Diagnóstico privado acotado de errores internos, sin mensajes, locales ni entorno."""

import json
import os
import traceback
import uuid
from collections import deque
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal, NotRequired, TypedDict

from plataforma_datos.orquestacion.piezas_de_la_actualizacion import CARPETA_DE_INFORMES

MAX_CAUSAS = 4
MAX_FRAMES = 16
MAX_NOMBRE = 80
MAX_TRAZA_BYTES = 64 * 1024
CARPETA = "errores-orquestador"


class FrameTraza(TypedDict):
    """Localización de código, sin ruta del equipo, texto de fuente o valores locales."""

    archivo: str
    linea: int
    funcion: str


class ErrorTecnico(TypedDict):
    """Tipo y posiciones de una excepción de la cadena causal acotada."""

    tipo: str
    frames: list[FrameTraza]


class FalloPersistencia(TypedDict):
    """Diagnóstico no guardado: el motor debe detenerse y conservar el área."""

    resultado: Literal["fallo"]
    tipo_error: str


class DocumentoError(TypedDict):
    """Incidencia propia de orquestación, sin atribuir una respuesta remota."""

    version: Literal[1]
    id: str
    instante_utc: str
    origen: Literal["orquestador"]
    modulo: str
    area_restaurada: bool
    errores: list[ErrorTecnico]
    persistencia: NotRequired[FalloPersistencia]


@dataclass(frozen=True, kw_only=True)
class Diagnostico:
    """Documento seguro y ruta opcional; ausencia de ruta significa persistencia fallida."""

    documento: DocumentoError
    ruta: Path | None


def _errores(error: BaseException) -> list[ErrorTecnico]:
    resultados, vistos = [], set()
    actual: BaseException | None = error
    while actual is not None and id(actual) not in vistos and len(resultados) < MAX_CAUSAS:
        vistos.add(id(actual))
        frames = deque(traceback.walk_tb(actual.__traceback__), maxlen=MAX_FRAMES)
        resultados.append(
            {
                "tipo": type(actual).__name__[:MAX_NOMBRE],
                "frames": [
                    {
                        "archivo": Path(frame.f_code.co_filename).name[:MAX_NOMBRE],
                        "linea": linea,
                        "funcion": frame.f_code.co_name[:MAX_NOMBRE],
                    }
                    for frame, linea in frames
                ],
            }
        )
        actual = actual.__cause__ or actual.__context__
    return resultados


def _guardar(ruta: Path, documento: DocumentoError) -> None:
    if any(p.is_symlink() for p in (ruta.absolute(), *ruta.absolute().parents)):
        raise OSError("Ruta de diagnóstico enlazada")
    ruta.parent.mkdir(parents=True, mode=0o700)
    contenido = json.dumps(documento, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode()
    if len(contenido) > MAX_TRAZA_BYTES:
        raise OSError("Traza interna excedida")
    descriptor = os.open(ruta, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "wb") as archivo:
        archivo.write(contenido)
        archivo.flush()
        os.fsync(archivo.fileno())


def registrar(raiz: Path, modulo: str, error: BaseException, *, area_restaurada: bool) -> Diagnostico:
    """Conserva tipos y frames de la cadena causal en un archivo exclusivo privado.

    No incluye str(error), líneas de código, locales, órdenes, URLs o entorno.
    Un fallo al guardar se devuelve explícito y obliga al motor a detenerse;
    el documento seguro aún puede incorporarse al informe del ciclo.

    Returns:
        Documento y ruta, o ruta=None si no se pudo persistir el diagnóstico.
    """
    documento: DocumentoError = {
        "version": 1,
        "id": str(uuid.uuid4()),
        "instante_utc": datetime.now(UTC).isoformat(),
        "origen": "orquestador",
        "modulo": modulo,
        "area_restaurada": area_restaurada,
        "errores": _errores(error),
    }
    ruta = raiz / CARPETA_DE_INFORMES / CARPETA / documento["id"] / "error.json"
    try:
        _guardar(ruta, documento)
    except OSError as fallo:
        documento["persistencia"] = {"resultado": "fallo", "tipo_error": type(fallo).__name__[:MAX_NOMBRE]}
        return Diagnostico(documento=documento, ruta=None)
    return Diagnostico(documento=documento, ruta=ruta)
