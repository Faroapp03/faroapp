"""Recupera la base ESCO fijada en el código para las pruebas de un checkout limpio de GitHub."""

import hashlib
import io
import json
import os
import re
import shutil
import sys
import tempfile
import zipfile
from http import HTTPStatus
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlsplit

from plataforma_datos.comun.entrada_salida import sha256
from plataforma_datos.comun.nucleo import RAIZ, ErrorFuente
from plataforma_datos.comun.red import descargar_url
from plataforma_datos.orquestacion.codigo_candidato import promover_directorio

BASE = Path("var/actualizacion/validados/esco/biblioteca-esco.sqlite")
CAPTURA = "var/actualizacion/originales/esco/biblioteca-api.zip"
HUELLAS = Path("plataforma_datos/ocupaciones/fuentes/esco/captura.sha256")
ETIQUETA = "datos-verificacion"
MAX_ZIP = 128 * 1024**2
MAX_SQLITE = 512 * 1024**2
MAX_VALIDACION = 64 * 1024
MAX_METADATOS = 1024**2
CDN = {"release-assets.githubusercontent.com", "objects.githubusercontent.com", "github-releases.githubusercontent.com"}


def _exigir(condicion: bool) -> None:
    if not condicion:
        raise ValueError("La base ESCO de la entrega no pudo comprobarse.")


def _descargar_activo(url: str, token: str, tamano: int) -> bytes:
    cabeceras = {"Authorization": "Bearer " + token, "Accept": "application/octet-stream"}
    try:
        return descargar_url(url, cabeceras, maximo_bytes=tamano, seguir_redirecciones=False).datos
    except HTTPError as error:
        with error:
            if error.code not in (HTTPStatus.FOUND, HTTPStatus.SEE_OTHER, HTTPStatus.TEMPORARY_REDIRECT):
                raise
            destino = error.headers.get("Location", "")
            partes = urlsplit(destino)
            _exigir(partes.scheme == "https" and partes.netloc in CDN and bool(partes.path) and not partes.fragment)
    # GitHub entrega una dirección firmada para el contenido; el dominio de descargas recibe solo la identidad web.
    return descargar_url(destino, maximo_bytes=tamano, seguir_redirecciones=False).datos


def _paquete(repositorio: str, token: str, esperada: str) -> bytes:
    _exigir(re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repositorio) is not None)
    origen = "https://api.github.com/repos/" + repositorio + "/releases"
    respuesta = descargar_url(
        origen + "/tags/" + ETIQUETA,
        {"Authorization": "Bearer " + token, "Accept": "application/vnd.github+json"},
        maximo_bytes=MAX_METADATOS,
        seguir_redirecciones=False,
    )
    release = json.loads(respuesta.datos)
    _exigir(release["tag_name"] == ETIQUETA and release["draft"] is False)
    activos = [a for a in release["assets"] if a["name"] == f"esco-{esperada}.zip"]
    _exigir(len(activos) == 1)
    activo = activos[0]
    identificador, tamano = activo["id"], activo["size"]
    _exigir(type(identificador) is int and identificador > 0 and type(tamano) is int and 0 < tamano <= MAX_ZIP)
    cuerpo = _descargar_activo(f"{origen}/assets/{identificador}", token, tamano)
    _exigir(len(cuerpo) == tamano and activo["digest"] == "sha256:" + hashlib.sha256(cuerpo).hexdigest())
    return cuerpo


def _instalar(raiz: Path, paquete: bytes, esperada: str) -> None:
    destino = (raiz / BASE).parent
    destino.parent.mkdir(parents=True, exist_ok=True)
    fijadas = [linea.split(maxsplit=1) for linea in (raiz / HUELLAS).read_text().splitlines()]
    (captura,) = [huella for huella, ruta in fijadas if ruta == CAPTURA]
    _exigir(re.fullmatch(r"[0-9a-f]{64}", captura) is not None)
    with tempfile.TemporaryDirectory(dir=destino.parent) as nombre, zipfile.ZipFile(io.BytesIO(paquete)) as archivo:
        temporal = Path(nombre)
        limites = {BASE.name: MAX_SQLITE, "validacion.json": MAX_VALIDACION}
        _exigir(sorted(archivo.namelist()) == sorted(limites))
        for entrada, maximo in limites.items():
            info = archivo.getinfo(entrada)
            _exigir(0 < info.file_size <= maximo)
            with archivo.open(info) as contenido, (temporal / entrada).open("xb") as salida:
                shutil.copyfileobj(contenido, salida)
            _exigir((temporal / entrada).stat().st_size == info.file_size)
        validacion = json.loads((temporal / "validacion.json").read_bytes())
        _exigir(sha256(temporal / BASE.name) == esperada == validacion["sha256_sqlite"])
        _exigir(validacion["sha256_original"] == captura)
        promover_directorio(temporal, destino)


def main() -> int:
    """Instala la base propia del checkout a partir de los activos privados de la entrega.

    Returns:
        Cero tras cotejar los archivos con las huellas del checkout, uno si falta alguna garantía.
    """
    try:
        token = os.environ.pop("TOKEN_LECTURA", "")
        _exigir(bool(token) and os.environ["GITHUB_SERVER_URL"] == "https://github.com")
        esperada = json.loads((RAIZ / "datos/manifiesto.json").read_bytes())["esco.json"]["origenes"][BASE.as_posix()]
        _exigir(re.fullmatch(r"[0-9a-f]{64}", esperada) is not None)
        _instalar(RAIZ, _paquete(os.environ["GITHUB_REPOSITORY"], token, esperada), esperada)
    except (ErrorFuente, OSError, ValueError, TypeError, KeyError, zipfile.BadZipFile):
        print("No se pudo instalar la base ESCO verificada de la distribución privada.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
