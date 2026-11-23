"""Extrae blobs de un commit Git local fijado, sin checkout, filtros, descargas ni estado privado.

El padre del destino pertenece exclusivamente al job. Se conservan los recursos estáticos versionados;
datos/ y var/ los aporta después la generación operativa. No instala dependencias ni ejecuta código extraído.
"""

import hashlib
import os
import re
import selectors
import shutil
import stat
import subprocess
import tempfile
import time
import unicodedata
from pathlib import Path
from typing import BinaryIO, NamedTuple

from plataforma_datos.orquestacion.actualizar import NO_SE_COPIA, es_secreto

MAX_ARCHIVOS = 20_000
MAX_ARBOL_BYTES = 8 * 1024**2
MAX_ARCHIVO_BYTES = 64 * 1024**2
MAX_TOTAL_BYTES = 512 * 1024**2
PLAZO_SEGUNDOS = 60
MAX_RUTA_BYTES = 4096
MAX_COMPONENTE_BYTES = 255
TAM_BLOQUE = 64 * 1024
MAX_CABECERA = 160
REVISION = re.compile(r"[0-9a-f]{40}")
ERROR = "Código candidato no verificable."
LOCALES = NO_SE_COPIA | {"venv", ".pytest_cache", ".mypy_cache", ".cache"}
LOCALES_NORMALIZADOS = {unicodedata.normalize("NFC", n).casefold(): n for n in LOCALES}
CREDENCIALES = {".npmrc", ".pypirc", ".netrc", ".git-credentials"}


class CodigoInvalido(ValueError):
    """El commit o el destino no cumplen el contrato de extracción local."""


class _Entrada(NamedTuple):
    ruta: str
    objeto: str
    tamano: int
    ejecutable: bool


def _exigir(condicion: bool) -> None:
    if not condicion:
        raise CodigoInvalido(ERROR)


def _directorio(ruta: Path) -> None:
    _exigir(stat.S_ISDIR(ruta.lstat().st_mode))


def _git(
    checkout: Path,
    argumentos: list[str],
    flujos: tuple[BinaryIO | int, BinaryIO],
    limite: int,
    plazo: float,
) -> None:
    entrada, salida = flujos
    entorno = {
        "PATH": os.defpath,
        "LC_ALL": "C",
        "GIT_CONFIG_NOSYSTEM": "1",
        "GIT_CONFIG_GLOBAL": os.devnull,
        "GIT_CONFIG_SYSTEM": os.devnull,
        "GIT_NO_REPLACE_OBJECTS": "1",
        "GIT_NO_LAZY_FETCH": "1",
        "GIT_OPTIONAL_LOCKS": "0",
        "GIT_TERMINAL_PROMPT": "0",
        "GIT_ATTR_NOSYSTEM": "1",
    }
    orden = [
        "git",
        "--no-replace-objects",
        "--no-lazy-fetch",
        "-c",
        f"core.hooksPath={os.devnull}",
        "-c",
        "core.fsmonitor=false",
        "-C",
        str(checkout),
        *argumentos,
    ]
    with subprocess.Popen(
        orden, env=entorno, stdin=entrada, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL
    ) as proceso:
        try:
            _exigir(proceso.stdout is not None)
            total = 0
            with selectors.DefaultSelector() as selector:
                selector.register(proceso.stdout, selectors.EVENT_READ)
                while True:
                    restante = plazo - time.monotonic()
                    _exigir(restante > 0 and bool(selector.select(restante)))
                    bloque = os.read(proceso.stdout.fileno(), TAM_BLOQUE)
                    if not bloque:
                        break
                    total += len(bloque)
                    _exigir(total <= limite)
                    salida.write(bloque)
            _exigir(proceso.wait(timeout=max(0, plazo - time.monotonic())) == 0)
        finally:
            if proceso.poll() is None:
                proceso.kill()
            proceso.wait()


def _consulta(checkout: Path, argumentos: list[str], limite: int, plazo: float) -> bytes:
    with tempfile.TemporaryFile() as salida:
        _git(checkout, argumentos, (subprocess.DEVNULL, salida), limite, plazo)
        salida.seek(0)
        return salida.read()


def _ruta(datos: bytes) -> str:
    try:
        nombre = datos.decode("utf-8")
    except UnicodeDecodeError as error:
        raise CodigoInvalido(ERROR) from error
    _exigir(bool(nombre) and len(datos) <= MAX_RUTA_BYTES and not re.search(r"[\\:\x00-\x1f\x7f]", nombre))
    partes = nombre.split("/")
    _exigir(all(p not in ("", ".", "..") and len(p.encode("utf-8")) <= MAX_COMPONENTE_BYTES for p in partes))
    _exigir(not any(es_secreto(p.casefold()) or p.casefold() in CREDENCIALES for p in partes))
    _exigir(all(LOCALES_NORMALIZADOS.get(unicodedata.normalize("NFC", p).casefold(), p) == p for p in partes))
    _exigir(partes[0].casefold() not in {"datos", "var", "registro"} or partes[0] == partes[0].casefold())
    prefijo = [p.casefold() for p in partes[:3]]
    _exigir(prefijo != ["config", "conexiones", "perfiles"] or partes[:3] == prefijo)
    return nombre


def _incluida(ruta: str) -> bool:
    partes = ruta.split("/")
    return (
        partes[0] not in {"datos", "var", "registro"}
        and not any(p in LOCALES for p in partes)
        and partes[:3] != ["config", "conexiones", "perfiles"]
    )


def _entradas(arbol: bytes) -> list[_Entrada]:
    _exigir(arbol.endswith(b"\0"))
    registros = arbol[:-1].split(b"\0")
    _exigir(len(registros) <= MAX_ARCHIVOS)
    entradas = []
    nombres = {}
    total = 0
    for registro in registros:
        cabecera, ruta = registro.split(b"\t", 1)
        modo, tipo, objeto, tamano = cabecera.split()
        _exigir(modo in (b"100644", b"100755") and tipo == b"blob" and REVISION.fullmatch(objeto.decode()) is not None)
        nombre = _ruta(ruta)
        partes = nombre.split("/")
        for indice in range(1, len(partes) + 1):
            prefijo = "/".join(partes[:indice])
            clave = unicodedata.normalize("NFC", prefijo).casefold()
            _exigir(clave not in nombres or nombres[clave] == prefijo)
            nombres[clave] = prefijo
        if _incluida(nombre):
            peso = int(tamano)
            _exigir(0 <= peso <= MAX_ARCHIVO_BYTES)
            total += peso
            _exigir(total <= MAX_TOTAL_BYTES)
            entradas.append(_Entrada(nombre, objeto.decode(), peso, modo == b"100755"))
    _exigir(bool(entradas) and len({e.ruta for e in entradas}) == len(entradas))
    return entradas


def _extraer(checkout: Path, destino: Path, entradas: list[_Entrada], plazo: float) -> None:
    with tempfile.TemporaryFile() as entrada, tempfile.TemporaryFile() as salida:
        entrada.write("".join(f"{e.objeto}\n" for e in entradas).encode("ascii"))
        entrada.seek(0)
        limite = sum(e.tamano + MAX_CABECERA for e in entradas)
        _git(checkout, ["cat-file", "--batch"], (entrada, salida), limite, plazo)
        salida.seek(0)
        for e in entradas:
            _exigir(time.monotonic() < plazo)
            _exigir(salida.readline(MAX_CABECERA) == f"{e.objeto} blob {e.tamano}\n".encode())
            contenido = salida.read(e.tamano)
            _exigir(len(contenido) == e.tamano and salida.read(1) == b"\n")
            huella = hashlib.sha1(f"blob {e.tamano}\0".encode() + contenido, usedforsecurity=False).hexdigest()
            _exigir(huella == e.objeto)
            archivo = destino / e.ruta
            archivo.parent.mkdir(parents=True, exist_ok=True)
            with archivo.open("xb") as manejador:
                manejador.write(contenido)
            archivo.chmod(0o755 if e.ejecutable else 0o644)
        _exigir(salida.read(1) == b"")


def _reserva_propia(ruta: Path, identidad: tuple[int, int]) -> bool:
    try:
        estado = ruta.lstat()
    except FileNotFoundError:
        return False
    return stat.S_ISDIR(estado.st_mode) and (estado.st_dev, estado.st_ino) == identidad


def promover_directorio(temporal: Path, destino: Path) -> None:
    """Promueve un árbol completo sobre una reserva propia, en el padre privado del job.

    El mkdir exclusivo evita reemplazar destinos creados por otro job. No es una defensa frente a quien
    tenga permiso para intercambiar entradas dentro del mismo padre privado durante la promoción.
    """
    _directorio(temporal)
    _directorio(destino.parent)
    _exigir(any(temporal.iterdir()))
    _exigir(not destino.exists() and not destino.is_symlink())
    _exigir(not destino.resolve().is_relative_to(temporal.resolve()))
    _exigir(not temporal.resolve().is_relative_to(destino.resolve()))
    destino.mkdir()
    estado = destino.lstat()
    identidad = (estado.st_dev, estado.st_ino)
    try:
        _exigir(_reserva_propia(destino, identidad) and not any(destino.iterdir()))
        temporal.rename(destino)
    finally:
        if destino.exists() and _reserva_propia(destino, identidad):
            destino.rmdir()


def exportar_codigo(checkout: Path, destino_nuevo: Path, revision: str) -> dict[str, int | str]:
    """Extrae el commit exacto a un destino nuevo y devuelve solo contadores y revisión.

    Returns:
        Resumen cerrado v1; nunca contiene rutas, diagnósticos Git ni contenido de blobs.

    Raises:
        CodigoInvalido: Si falla una entrada, límite, objeto Git o escritura; no publica un árbol parcial.
    """
    temporal = None
    try:
        _exigir(isinstance(revision, str) and REVISION.fullmatch(revision) is not None)
        _directorio(checkout)
        _directorio(destino_nuevo.parent)
        _exigir(not destino_nuevo.exists() and not destino_nuevo.is_symlink())
        _exigir(not destino_nuevo.resolve().is_relative_to(checkout.resolve()))
        plazo = time.monotonic() + PLAZO_SEGUNDOS
        raiz = _consulta(checkout, ["rev-parse", "--show-toplevel"], MAX_RUTA_BYTES, plazo)
        _exigir(Path(raiz.decode("utf-8").removesuffix("\n")).resolve() == checkout.resolve())
        commit = _consulta(checkout, ["rev-parse", "--verify", f"{revision}^{{commit}}"], MAX_CABECERA, plazo)
        _exigir(commit == f"{revision}\n".encode())
        entradas = _entradas(
            _consulta(checkout, ["ls-tree", "-r", "-z", "-l", "--full-tree", revision], MAX_ARBOL_BYTES, plazo)
        )
        temporal = Path(tempfile.mkdtemp(prefix=".codigo-", dir=destino_nuevo.parent))
        _extraer(checkout, temporal, entradas, plazo)
        promover_directorio(temporal, destino_nuevo)
        return {
            "version": 1,
            "revisionCodigo": revision,
            "archivos": len(entradas),
            "bytesTotales": sum(e.tamano for e in entradas),
        }
    except (OSError, ValueError, TypeError, subprocess.SubprocessError) as error:
        raise CodigoInvalido(ERROR) from error
    finally:
        if temporal is not None and temporal.exists():
            shutil.rmtree(temporal)
