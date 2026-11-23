"""Lectura acotada del inventario sellado; la admisión común verifica los archivos."""

import json
import re
from dataclasses import dataclass
from pathlib import PurePosixPath, PureWindowsPath

from plataforma_datos.cursos.auditoria_snapshot_catalogo import ErrorAdmisionCatalogo, exigir
from plataforma_datos.cursos.tipos_json import ObjetoJson, ValorJson

MAX_INDICE = 16 * 1024 * 1024
MAX_ARCHIVOS = 100_000
VERSION = 1


@dataclass(frozen=True, kw_only=True)
class PruebaIndexada:
    """Ruta relativa canónica y SHA esperado, nunca derivado del archivo actual."""

    archivo: str
    sha256: str


def _objeto(pares: list[tuple[str, ValorJson]]) -> ObjetoJson:
    resultado = {}
    for clave, valor in pares:
        exigir(clave not in resultado, "Clave repetida en índice de evidencias")
        resultado[clave] = valor
    return resultado


def _no_finito(valor: str) -> None:
    raise ValueError("Número JSON no finito: " + valor)


def validar_prueba_indexada(valor: ValorJson) -> PruebaIndexada:
    """Valida una entrada del índice: ruta relativa segura y SHA-256 bien formado.

    Returns:
        La prueba validada.
    """
    exigir(isinstance(valor, dict) and set(valor) == {"archivo", "sha256"}, "Entrada de índice incompatible")
    nombre, sha = valor["archivo"], valor["sha256"]
    exigir(isinstance(nombre, str) and nombre and "\\" not in nombre, "Ruta de índice no válida")
    exigir(re.search(r"[\x00-\x1f\x7f]", nombre) is None, "Ruta de índice con caracteres de control")
    ruta = PurePosixPath(nombre)
    exigir(
        not ruta.is_absolute()
        and not PureWindowsPath(nombre).drive
        and ".." not in ruta.parts
        and ruta.as_posix() == nombre
        and nombre != ".",
        "Ruta de índice no relativa o no canónica",
    )
    exigir(isinstance(sha, str) and re.fullmatch("[0-9a-f]{64}", sha) is not None, "SHA de índice no válido")
    return PruebaIndexada(archivo=nombre, sha256=sha)


def leer_indice(contenido: bytes) -> tuple[PruebaIndexada, ...]:
    """Lee el único campo de referencias; ningún metadato adicional autoriza archivos.

    Returns:
        Inventario sin rutas ni claves duplicadas y con SHA explícitos.

    Raises:
        ErrorAdmisionCatalogo: Si el JSON o el inventario no cumplen el contrato acotado.
    """
    exigir(len(contenido) <= MAX_INDICE, "Índice de evidencias excedido")
    try:
        dato = json.loads(contenido, object_pairs_hook=_objeto, parse_constant=_no_finito)
    except (ValueError, RecursionError) as error:
        raise ErrorAdmisionCatalogo("JSON de índice no válido") from error
    exigir(
        isinstance(dato, dict) and type(dato.get("schema_version")) is int and dato["schema_version"] == VERSION,
        "Versión de índice incompatible",
    )
    filas = dato.get("archivos_conservados")
    exigir(isinstance(filas, list) and 0 < len(filas) <= MAX_ARCHIVOS, "Inventario vacío o excesivo")
    pruebas = tuple(validar_prueba_indexada(fila) for fila in filas)
    exigir(len({p.archivo for p in pruebas}) == len(pruebas), "Ruta repetida en índice de evidencias")
    return pruebas
