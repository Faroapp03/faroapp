"""Transporte v1 de inventarios validados, con bloques por contenido y una referencia inmutable al índice.

Los límites, el orden por huella y los grupos por primer dígito forman el formato v1. El índice binario
solo contiene SHA-256 de bloques; rutas, longitudes, duplicados y fronteras proceden del manifiesto original.
"""

from __future__ import annotations

import hashlib
import os
import re
import stat
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any, BinaryIO, Protocol, runtime_checkable

if TYPE_CHECKING:
    from plataforma_datos.orquestacion.almacen_generaciones import AlmacenGeneraciones

DESDE_CONTENIDOS = 256
BYTES_BLOQUE = 32 * 1024 * 1024
BYTES_LECTURA = 256 * 1024
BYTES_SHA = hashlib.sha256().digest_size
ERROR = "Bloques del inventario no verificables."


def _exigir(condicion: bool) -> None:
    if not condicion:
        raise ValueError(ERROR)


@runtime_checkable
class IndicesInmutables(Protocol):
    """Capacidad del adaptador S3. Un transporte histórico de dos métodos conserva su formato original."""

    def leer_control(self, clave: str, bytes_maximos: int) -> tuple[bytes, str] | None:
        """Lee un control acotado. Solo un 404 confirmado devuelve None."""
        ...

    def guardar_control(self, clave: str, contenido: bytes, etag_esperado: str | None) -> bool:
        """La referencia del índice se crea con If-None-Match y se coteja en una lectura independiente."""
        ...


@dataclass
class Contenido:
    """Una identidad íntegra y sus rutas independientes en el inventario ya validado."""

    sha256: str
    tamano: int
    rutas: list[str]


def _contenidos(archivos: list[dict[str, Any]]) -> list[Contenido]:
    unicos: dict[str, Contenido] = {}
    for archivo in archivos:
        huella, tamano = archivo["sha256"], archivo["bytes"]
        if huella not in unicos:
            unicos[huella] = Contenido(huella, tamano, [])
        _exigir(unicos[huella].tamano == tamano)
        unicos[huella].rutas.append(archivo["ruta"])
    return list(unicos.values())


def _grupos(contenidos: list[Contenido]) -> list[list[Contenido]]:
    grupos: list[list[Contenido]] = []
    actual: list[Contenido] = []
    total = 0
    for contenido in sorted(contenidos, key=lambda c: c.sha256):
        if contenido.tamano >= BYTES_BLOQUE:
            continue
        if actual and (actual[0].sha256[0] != contenido.sha256[0] or total + contenido.tamano > BYTES_BLOQUE):
            grupos.append(actual)
            actual, total = [], 0
        actual.append(contenido)
        total += contenido.tamano
    if actual:
        grupos.append(actual)
    return grupos


def _copiar_miembro(entrada: BinaryIO, salida: BinaryIO, contenido: Contenido) -> None:
    huella = hashlib.sha256()
    restante = contenido.tamano
    while restante:
        trozo = entrada.read(min(BYTES_LECTURA, restante))
        _exigir(bool(trozo) and len(trozo) <= restante)
        salida.write(trozo)
        huella.update(trozo)
        restante -= len(trozo)
    _exigir(huella.hexdigest() == contenido.sha256)


def _copiar_origen(ruta: Path, salida: BinaryIO, contenido: Contenido) -> None:
    descriptor = os.open(ruta, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC | os.O_NONBLOCK)
    with os.fdopen(descriptor, "rb") as entrada:
        info = os.fstat(descriptor)
        _exigir(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_size == contenido.tamano)
        _copiar_miembro(entrada, salida, contenido)
        _exigir(not entrada.read(1))


def _hash(ruta: Path) -> str:
    with ruta.open("rb") as archivo:
        return hashlib.file_digest(archivo, "sha256").hexdigest()


def _destino(base: Path, relativa: str) -> Path:
    ruta = base / relativa
    ruta.parent.mkdir(parents=True, exist_ok=True)
    return ruta


def _clave_indice(marcador: str) -> str:
    return "agrupaciones/v1/" + marcador.removesuffix(".json") + ".sha256"


def guardar_archivos(base: Path, archivos: list[dict[str, Any]], marcador: str, almacen: AlmacenGeneraciones) -> None:
    """Conserva los bloques y el índice antes de que el llamador publique el marcador original."""
    contenidos = _contenidos(archivos)
    if len(contenidos) < DESDE_CONTENIDOS or not isinstance(almacen, IndicesInmutables):
        for c in contenidos:
            almacen.guardar(f"blobs/{c.sha256}", base / c.rutas[0], c.sha256, c.tamano)
        return
    for c in contenidos:
        if c.tamano >= BYTES_BLOQUE:
            almacen.guardar(f"blobs/{c.sha256}", base / c.rutas[0], c.sha256, c.tamano)
    with tempfile.TemporaryDirectory(prefix=".bloques-almacen-") as nombre:
        bloque, indice = Path(nombre) / "bloque", Path(nombre) / "indice"
        with indice.open("xb") as indices:
            for grupo in _grupos(contenidos):
                with bloque.open("xb") as salida:
                    for c in grupo:
                        _copiar_origen(base / c.rutas[0], salida, c)
                huella = _hash(bloque)
                almacen.guardar(f"blobs/{huella}", bloque, huella, bloque.stat().st_size)
                indices.write(bytes.fromhex(huella))
                bloque.unlink()
        huella = _hash(indice)
        almacen.guardar(f"blobs/{huella}", indice, huella, indice.stat().st_size)
    clave = _clave_indice(marcador)
    esperado = huella.encode("ascii")
    almacen.guardar_control(clave, esperado, None)
    lectura = almacen.leer_control(clave, len(esperado))
    _exigir(lectura is not None and lectura[0] == esperado)


def _recuperar_blob(almacen: AlmacenGeneraciones, ruta: Path, huella: str, maximo: int) -> None:
    try:
        almacen.recuperar(f"blobs/{huella}", ruta, huella, maximo)
    except FileNotFoundError as error:
        raise ValueError(ERROR) from error


def _duplicados(base: Path, c: Contenido) -> None:
    for copia in c.rutas[1:]:
        with _destino(base, copia).open("xb") as salida:
            _copiar_origen(base / c.rutas[0], salida, c)


def _recuperar_legado(base: Path, contenidos: list[Contenido], almacen: AlmacenGeneraciones) -> None:
    for c in contenidos:
        _recuperar_blob(almacen, _destino(base, c.rutas[0]), c.sha256, c.tamano)
        _duplicados(base, c)


def _extraer(bloque: Path, grupo: list[Contenido], base: Path, huella: str) -> None:
    _exigir(bloque.stat().st_size == sum(c.tamano for c in grupo) and _hash(bloque) == huella)
    with bloque.open("rb") as entrada:
        for c in grupo:
            with _destino(base, c.rutas[0]).open("xb") as salida:
                _copiar_miembro(entrada, salida, c)
        _exigir(not entrada.read(1))


def _leer_indice(origen: Path, texto: bytes, grupos: int, almacen: AlmacenGeneraciones) -> bytes:
    _exigir(re.fullmatch(rb"[0-9a-f]{64}", texto) is not None)
    huella = texto.decode("ascii")
    tamano = grupos * BYTES_SHA
    _recuperar_blob(almacen, origen, huella, tamano)
    _exigir(origen.stat().st_size == tamano and _hash(origen) == huella)
    return origen.read_bytes()


def recuperar_archivos(base: Path, archivos: list[dict[str, Any]], marcador: str, almacen: AlmacenGeneraciones) -> None:
    """Recupera usando solo rutas del inventario validado; únicamente un control ausente permite recurrir al legado."""
    contenidos = _contenidos(archivos)
    if len(contenidos) < DESDE_CONTENIDOS or not isinstance(almacen, IndicesInmutables):
        _recuperar_legado(base, contenidos, almacen)
        return
    lectura = almacen.leer_control(_clave_indice(marcador), BYTES_SHA * 2)
    if lectura is None:
        _recuperar_legado(base, contenidos, almacen)
        return
    grupos = _grupos(contenidos)
    with tempfile.TemporaryDirectory(prefix=".bloques-almacen-", dir=base.parent) as nombre:
        temporal = Path(nombre)
        indice = _leer_indice(temporal / "indice", lectura[0], len(grupos), almacen)
        for i, grupo in enumerate(grupos):
            huella = indice[i * BYTES_SHA : (i + 1) * BYTES_SHA].hex()
            bloque = temporal / "bloque"
            _recuperar_blob(almacen, bloque, huella, sum(c.tamano for c in grupo))
            _extraer(bloque, grupo, base, huella)
            bloque.unlink()
    for c in contenidos:
        origen = _destino(base, c.rutas[0])
        if c.tamano >= BYTES_BLOQUE:
            _recuperar_blob(almacen, origen, c.sha256, c.tamano)
        _duplicados(base, c)
