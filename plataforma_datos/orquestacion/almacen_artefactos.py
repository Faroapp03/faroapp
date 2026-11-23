"""Conserva artefactos privados por contenido, sin activar ni modificar trabajos o referencias.

La política del descriptor y la comprobación integral pertenecen al lector TypeScript del checkout
confiable. El transporte existente confirma cada objeto; el descriptor inmutable se guarda al final.
"""

import json
import os
import re
import shutil
import stat
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from plataforma_datos.comun.nucleo import RAIZ
from plataforma_datos.orquestacion.almacen_generaciones import AlmacenGeneraciones
from plataforma_datos.orquestacion.bloques_almacen import guardar_archivos, recuperar_archivos
from plataforma_datos.orquestacion.codigo_candidato import promover_directorio
from plataforma_datos.orquestacion.generacion_operativa import REVISION, SHA256
from plataforma_datos.orquestacion.procesos import ejecutar_con_plazo

MAX_DESCRIPTOR_BYTES = 8 * 1024 * 1024
MAX_SALIDA_DESCRIPTOR = MAX_DESCRIPTOR_BYTES + 4096
MAX_RESUMEN_BYTES = 4096
PLAZO_COMPROBACION_S = 30
CLI = RAIZ / "herramientas/cloudflare/artefacto.ts"
ERROR_GENERICO = "Artefacto almacenado no verificable."


class AlmacenArtefactosInvalido(ValueError):
    """No se ha confirmado un artefacto completo con las expectativas privadas indicadas."""


def _exigir(condicion: bool) -> None:
    if not condicion:
        raise AlmacenArtefactosInvalido(ERROR_GENERICO)


def _referencias(revision: str, paquete: str, sha256: str) -> None:
    _exigir(isinstance(revision, str) and REVISION.fullmatch(revision) is not None)
    _exigir(isinstance(paquete, str) and re.fullmatch(r"[0-9a-f]{16}", paquete) is not None)
    _exigir(isinstance(sha256, str) and SHA256.fullmatch(sha256) is not None)


def _comprobar(accion: str, origen: Path, sha256: str) -> dict[str, Any]:
    nodo = shutil.which("node")
    _exigir(nodo is not None)
    with tempfile.TemporaryDirectory(prefix=".comprobar-artefacto-") as nombre:
        temporal = Path(nombre)
        hogar, tmp = temporal / "hogar", temporal / "tmp"
        hogar.mkdir()
        tmp.mkdir()
        entorno = {"PATH": os.defpath, "HOME": str(hogar), "TMPDIR": str(tmp)}
        respuesta = ejecutar_con_plazo(
            [nodo, str(CLI), accion, str(origen), "--sha256", sha256], RAIZ, PLAZO_COMPROBACION_S, entorno
        )
    limite = MAX_SALIDA_DESCRIPTOR if accion == "descriptor" else MAX_RESUMEN_BYTES
    _exigir(respuesta.returncode == 0 and len(respuesta.stdout.encode("utf-8")) <= limite)
    documento = json.loads(respuesta.stdout)
    _exigir(type(documento) is dict)
    return documento


def _expectativas(documento: dict[str, Any], revision: str, paquete: str) -> None:
    _exigir(documento["revisionCodigo"] == revision and documento["huellaPaquete"] == paquete)


def leer_descriptor_artefacto(
    revision: str, huella_paquete: str, sha256: str, almacen: AlmacenGeneraciones
) -> dict[str, Any]:
    """Lee el marcador por su SHA externo y valida metadatos sin descargar el contenido.

    Returns:
        Descriptor validado por la misma CLI TypeScript; no acredita una recuperación completa.

    Raises:
        AlmacenArtefactosInvalido: Si el marcador o sus expectativas no pueden comprobarse.
    """
    try:
        _referencias(revision, huella_paquete, sha256)
        with tempfile.TemporaryDirectory(prefix=".descriptor-artefacto-") as nombre:
            ruta = Path(nombre) / "artefacto.json"
            almacen.recuperar(f"artefactos/{sha256}.json", ruta, sha256, MAX_DESCRIPTOR_BYTES)
            descriptor = _comprobar("descriptor", ruta, sha256)
        _expectativas(descriptor, revision, huella_paquete)
        return descriptor
    except (OSError, ValueError, RecursionError, subprocess.SubprocessError):
        raise AlmacenArtefactosInvalido(ERROR_GENERICO) from None


def guardar_artefacto(
    origen: Path, revision: str, huella_paquete: str, sha256: str, almacen: AlmacenGeneraciones
) -> dict[str, Any]:
    """Verifica el contenido completo antes del primer PUT y publica el descriptor después de los blobs.

    El origen y sus padres deben ser privados y estables durante toda la operación. La revisión es
    una expectativa del ejecutor; este componente no comprueba Git ni acredita una firma digital.

    Returns:
        El resumen cerrado del verificador TypeScript, solo tras conservación confirmada.

    Raises:
        AlmacenArtefactosInvalido: Si una expectativa, lectura o transferencia no puede verificarse.
    """
    try:
        _referencias(revision, huella_paquete, sha256)
        _exigir(isinstance(origen, Path))
        origen = Path(os.path.abspath(origen))  # noqa: PTH100 - Absolutizar sin seguir enlaces; TS los rechaza.
        resumen = _comprobar("comprobar", origen, sha256)
        _expectativas(resumen, revision, huella_paquete)
        _exigir(resumen["sha256Artefacto"] == sha256)
        ruta = origen / "artefacto.json"
        descriptor = _comprobar("descriptor", ruta, sha256)
        _expectativas(descriptor, revision, huella_paquete)
        marcador = f"artefactos/{sha256}.json"
        guardar_archivos(origen, descriptor["archivos"], marcador, almacen)
        almacen.guardar(marcador, ruta, sha256, ruta.stat().st_size)
        return resumen
    except (OSError, ValueError, RecursionError, subprocess.SubprocessError):
        raise AlmacenArtefactosInvalido(ERROR_GENERICO) from None


def recuperar_artefacto(
    destino_nuevo: Path, revision: str, huella_paquete: str, sha256: str, almacen: AlmacenGeneraciones
) -> dict[str, Any]:
    """Valida rutas mediante la CLI antes de crear contenido y promueve exclusivamente el artefacto completo.

    Returns:
        Resumen confirmado del destino nuevo, sin afirmar activación.

    Raises:
        AlmacenArtefactosInvalido: Si falla una expectativa, transferencia o comprobación local.
    """
    try:
        _referencias(revision, huella_paquete, sha256)
        _exigir(isinstance(destino_nuevo, Path))
        destino_nuevo = Path(os.path.abspath(destino_nuevo))  # noqa: PTH100 - No seguir enlaces del destino.
        _exigir(stat.S_ISDIR(destino_nuevo.parent.lstat().st_mode))
        _exigir(not destino_nuevo.exists() and not destino_nuevo.is_symlink())
        with tempfile.TemporaryDirectory(prefix=".recuperando-artefacto-", dir=destino_nuevo.parent) as nombre:
            temporal = Path(nombre)
            ruta = temporal / "artefacto.json"
            marcador = f"artefactos/{sha256}.json"
            almacen.recuperar(marcador, ruta, sha256, MAX_DESCRIPTOR_BYTES)
            descriptor = _comprobar("descriptor", ruta, sha256)
            _expectativas(descriptor, revision, huella_paquete)
            recuperar_archivos(temporal, descriptor["archivos"], marcador, almacen)
            resumen = _comprobar("comprobar", temporal, sha256)
            _expectativas(resumen, revision, huella_paquete)
            _exigir(resumen["sha256Artefacto"] == sha256)
            promover_directorio(temporal, destino_nuevo)
        return resumen
    except (OSError, ValueError, RecursionError, subprocess.SubprocessError):
        raise AlmacenArtefactosInvalido(ERROR_GENERICO) from None
