"""Prepara las ruedas fijadas del mantenimiento antes de proporcionar credenciales al supervisor.

La única red es una descarga HTTPS acotada con la identidad de navegador genérico configurada. El venv usa su ubicación
definitiva y pip instala exclusivamente archivos locales verificados: no resuelve, construye ni consulta índices.
"""

import argparse
import hashlib
import json
import os
import platform
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import time
from http import HTTPStatus
from http.client import HTTPException, HTTPResponse
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit
from urllib.request import HTTPErrorProcessor, HTTPSHandler, OpenerDirector, ProxyHandler, Request, build_opener

from plataforma_datos.comun.confianza_tls import CERTIFI_VERSION, PIP_VERSION, contexto_tls_bootstrap
from plataforma_datos.comun.entorno_python import comprobar_python, comprobar_sqlite
from plataforma_datos.comun.nucleo import FormatoInesperado
from plataforma_datos.comun.perfil_web import cabeceras_identidad
from plataforma_datos.comun.red import turno_por_dominio
from plataforma_datos.orquestacion.procesos import bibliotecas_de_python, ejecutar_con_plazo

LOCK = "config/dependencias-python.lock.json"
MAX_LOCK_BYTES = 256 * 1024
MAX_REQUISITOS_BYTES = 64 * 1024
MAX_ARCHIVO_BYTES = 64 * 1024 * 1024
MAX_TOTAL_BYTES = 128 * 1024 * 1024
BLOQUE_BYTES = 64 * 1024
SOCKET_S = 30
PLAZO_DESCARGA_S = 120
PLAZO_ORDEN_S = 300
PYTHON = "3.12"
ERROR = "No se han preparado las dependencias de mantenimiento."
HUELLA = re.compile(r"[0-9a-f]{64}")
NOMBRE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}")
VERSION = re.compile(r"[0-9][A-Za-z0-9.!+_]{0,63}")
ARCHIVO = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,239}\.whl")
PLATAFORMAS = {("Linux", "x86_64"): "linux-x86_64", ("Darwin", "arm64"): "darwin-arm64"}


class DependenciasInvalidas(ValueError):
    """Lock, descarga o instalación no verificable; ningún entorno parcial se acredita como preparado."""


def _exigir(condicion: bool) -> None:
    if not condicion:
        raise DependenciasInvalidas(ERROR)


def _pares(pares: list[tuple[str, Any]]) -> dict[str, Any]:
    resultado: dict[str, Any] = {}
    for clave, valor in pares:
        _exigir(clave not in resultado)
        resultado[clave] = valor
    return resultado


def _objeto(valor: object, claves: str) -> dict[str, Any]:
    _exigir(type(valor) is dict and set(valor) == set(claves.split(",")))
    return valor


def _constante(_valor: str) -> None:
    raise DependenciasInvalidas(ERROR)


def _leer(ruta: Path, cota: int) -> bytes:
    descriptor = os.open(ruta, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC)
    with os.fdopen(descriptor, "rb") as archivo:
        estado = os.fstat(archivo.fileno())
        _exigir(stat.S_ISREG(estado.st_mode) and estado.st_nlink == 1 and estado.st_size <= cota)
        contenido = archivo.read(cota + 1)
    _exigir(0 < len(contenido) <= cota)
    return contenido


def _nombre(nombre: str) -> str:
    return re.sub(r"[-_.]+", "-", nombre).lower()


def _rueda(entrada: object) -> dict[str, Any]:
    rueda = _objeto(entrada, "nombre,version,archivo,url,sha256,bytes")
    for campo, patron in (("nombre", NOMBRE), ("version", VERSION), ("archivo", ARCHIVO), ("sha256", HUELLA)):
        _exigir(isinstance(rueda[campo], str) and patron.fullmatch(rueda[campo]) is not None)
    _exigir(type(rueda["bytes"]) is int and 0 < rueda["bytes"] <= MAX_ARCHIVO_BYTES)
    partes = rueda["archivo"][:-4].split("-")
    _exigir(len(partes) in (5, 6) and _nombre(partes[0]) == _nombre(rueda["nombre"]) and partes[1] == rueda["version"])
    _exigir(isinstance(rueda["url"], str))
    _exigir(re.fullmatch(r"[\x21-\x7e]+", rueda["url"]) is not None)
    url = urlsplit(rueda["url"])
    _exigir(url.scheme == "https" and url.netloc == "files.pythonhosted.org" and not url.query and not url.fragment)
    _exigir(url.path.startswith("/packages/") and url.path.rsplit("/", 1)[-1] == rueda["archivo"])
    _exigir(url.geturl() == rueda["url"])
    _exigir(not any(p in ("", ".", "..") for p in url.path[1:].split("/")) and "%" not in url.path)
    return rueda


def _lock(checkout: Path) -> tuple[list[dict[str, Any]], str, str]:
    contenido = _leer(checkout / LOCK, MAX_LOCK_BYTES)
    documento = _objeto(
        json.loads(contenido.decode("utf-8"), object_pairs_hook=_pares, parse_constant=_constante),
        "version,python,requisitos,comunes,plataformas",
    )
    _exigir(type(documento["version"]) is int and documento["version"] == 1 and documento["python"] == PYTHON)
    _exigir(comprobar_python() == PYTHON)
    comprobar_sqlite()
    requisitos = _objeto(documento["requisitos"], "requirements.txt,requirements-dev.txt")
    for archivo, huella in requisitos.items():
        _exigir(isinstance(huella, str) and HUELLA.fullmatch(huella) is not None)
        _exigir(hashlib.sha256(_leer(checkout / archivo, MAX_REQUISITOS_BYTES)).hexdigest() == huella)
    plataformas = _objeto(documento["plataformas"], "linux-x86_64,darwin-arm64")
    seleccion = PLATAFORMAS.get((platform.system(), platform.machine()))
    _exigir(seleccion is not None and type(documento["comunes"]) is list)
    _exigir(all(type(ruedas) is list for ruedas in plataformas.values()))
    ruedas = [_rueda(entrada) for entrada in documento["comunes"] + plataformas[seleccion]]
    _exigir(bool(ruedas) and sum(r["bytes"] for r in ruedas) <= MAX_TOTAL_BYTES)
    for campo in ("nombre", "archivo"):
        valores = [_nombre(r[campo]) for r in ruedas]
        _exigir(len(set(valores)) == len(valores))
    for nombre, version in (("pip", PIP_VERSION), ("certifi", CERTIFI_VERSION)):
        _exigir(any(_nombre(r["nombre"]) == nombre and r["version"] == version for r in ruedas))
    return ruedas, seleccion, hashlib.sha256(contenido).hexdigest()


class _SinReenvio(HTTPErrorProcessor):
    """Devuelve todo estado HTTP al llamador sin activar redirecciones ni autenticación automática."""

    def http_response(self, _solicitud: Request, respuesta: HTTPResponse) -> HTTPResponse:
        return respuesta

    https_response = http_response


def _descargar(rueda: dict[str, Any], destino: Path, http: OpenerDirector) -> None:
    plazo = time.monotonic() + PLAZO_DESCARGA_S
    solicitud = Request(rueda["url"], headers={**cabeceras_identidad(), "Accept-Encoding": "identity"})
    with turno_por_dominio(rueda["url"]):
        _exigir(time.monotonic() < plazo)
        with http.open(solicitud, timeout=SOCKET_S) as respuesta, destino.open("xb") as archivo:
            _exigir(
                respuesta.status == HTTPStatus.OK
                and respuesta.headers.get("Content-Encoding", "identity") == "identity"
            )
            longitud = respuesta.headers.get("Content-Length")
            _exigir(longitud is None or longitud == str(rueda["bytes"]))
            huella, total = hashlib.sha256(), 0
            while True:
                _exigir(time.monotonic() < plazo)
                bloque = respuesta.read1(min(BLOQUE_BYTES, rueda["bytes"] - total + 1))
                _exigir(time.monotonic() < plazo)
                if not bloque:
                    break
                total += len(bloque)
                _exigir(total <= rueda["bytes"])
                archivo.write(bloque)
                huella.update(bloque)
            _exigir(total == rueda["bytes"] and huella.hexdigest() == rueda["sha256"])


def _orden(orden: list[str], checkout: Path, entorno: dict[str, str]) -> None:
    resultado = ejecutar_con_plazo(orden, checkout, PLAZO_ORDEN_S, entorno)
    _exigir(resultado.returncode == 0)


def _retirar_propio(destino: Path, identidad: tuple[int, int]) -> None:
    try:
        estado = destino.lstat()
    except FileNotFoundError:
        return
    if stat.S_ISDIR(estado.st_mode) and (estado.st_dev, estado.st_ino) == identidad:
        shutil.rmtree(destino)


def _instalar_ruedas(requisitos: Path, checkout: Path, entorno: dict[str, str], ruedas: list[dict[str, Any]]) -> None:
    requisitos.write_text(
        "".join(f"{(requisitos.parent / r['archivo']).as_uri()} --hash=sha256:{r['sha256']}\n" for r in ruedas),
        encoding="utf-8",
    )
    _orden(
        [
            str(checkout / ".venv/bin/python"),
            "-I",
            "-m",
            "pip",
            "--isolated",
            "--disable-pip-version-check",
            "install",
            "--no-index",
            "--no-deps",
            "--require-hashes",
            "--only-binary=:all:",
            "--no-cache-dir",
            "-r",
            str(requisitos),
        ],
        checkout,
        entorno,
    )


def _instalar(checkout: Path, temporal: Path, ruedas: list[dict[str, Any]]) -> None:
    destino = checkout / ".venv"
    destino.mkdir(mode=0o700)
    estado = destino.lstat()
    identidad = (estado.st_dev, estado.st_ino)
    terminado = False
    try:
        hogar, tmp = temporal / "hogar", temporal / "tmp"
        hogar.mkdir()
        tmp.mkdir()
        entorno = {"PATH": os.defpath, "HOME": str(hogar), "TMPDIR": str(tmp), "PIP_CONFIG_FILE": os.devnull}
        entorno.update(bibliotecas_de_python())
        _orden([sys.executable, "-I", "-m", "venv", str(destino)], checkout, entorno)
        python = str(destino / "bin/python")
        _orden([python, "-I", "-B", str(checkout / "plataforma_datos/comun/entorno_python.py")], checkout, entorno)
        pip = [r for r in ruedas if _nombre(r["nombre"]) == "pip"]
        _instalar_ruedas(temporal / "pip.txt", checkout, entorno, pip)
        _instalar_ruedas(temporal / "ruedas.txt", checkout, entorno, ruedas)
        _orden([python, "-I", "-m", "pip", "--isolated", "--disable-pip-version-check", "check"], checkout, entorno)
        _orden([python, "-I", str(checkout / "plataforma_datos/comun/confianza_tls.py")], checkout, entorno)
        terminado = True
    finally:
        if not terminado:
            _retirar_propio(destino, identidad)


def preparar_dependencias(checkout: Path) -> dict[str, Any]:
    """Verifica ruedas e instala exclusivamente en un venv nuevo del checkout confiable.

    La carpeta privada no debe tener otros escritores durante la preparación. Los límites de descarga
    se comprueban entre lecturas; DNS o una lectura ya iniciada pueden añadir margen del sistema/socket.
    El workflow impone además su plazo global. La configuración y los secretos se entregan después.

    Returns:
        Resumen cerrado solo tras instalación y pip check satisfactorios.

    Raises:
        DependenciasInvalidas: Si lock, descarga o instalación no pueden acreditarse.
    """
    try:
        _exigir(isinstance(checkout, Path) and stat.S_ISDIR(checkout.lstat().st_mode))
        checkout = checkout.resolve(strict=True)
        _exigir(not (checkout / ".venv").exists() and not (checkout / ".venv").is_symlink())
        ruedas, seleccion, sha_lock = _lock(checkout)
        with tempfile.TemporaryDirectory(prefix=".dependencias-", dir=checkout) as nombre:
            temporal = Path(nombre)
            http = build_opener(ProxyHandler({}), _SinReenvio(), HTTPSHandler(context=contexto_tls_bootstrap()))
            for rueda in ruedas:
                _descargar(rueda, temporal / rueda["archivo"], http)
            _instalar(checkout, temporal, ruedas)
        return {
            "version": 1,
            "plataforma": seleccion,
            "python": PYTHON,
            "paquetes": len(ruedas),
            "sha256Lock": sha_lock,
        }
    except (HTTPException, OSError, ValueError, FormatoInesperado, RecursionError, subprocess.SubprocessError):
        raise DependenciasInvalidas(ERROR) from None


def main(argv: list[str] | None = None) -> int:
    """Prepara dependencias sin imprimir órdenes, respuestas ni configuración ambiental.

    Returns:
        Cero con resumen confirmado; uno ante fallo de preparación.
    """
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("checkout", type=Path)
    argumentos = parser.parse_args(argv)
    try:
        resultado = preparar_dependencias(argumentos.checkout)
    except DependenciasInvalidas:
        print(ERROR, file=sys.stderr)
        return 1
    print(json.dumps(resultado, ensure_ascii=False, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    sys.exit(main())
