"""Generaciones privadas por contenido: blobs verificados primero y manifiesto inmutable al final.

El transporte autentica el almacén y verifica cada lectura. El manifiesto de confianza y su identidad
se conservan también cuando el transporte agrupa los archivos en bloques.
"""

import stat
import tempfile
from pathlib import Path
from typing import Any, Protocol

from plataforma_datos.comun.nucleo import ErrorFuente
from plataforma_datos.orquestacion.bloques_almacen import guardar_archivos, recuperar_archivos
from plataforma_datos.orquestacion.codigo_candidato import promover_directorio
from plataforma_datos.orquestacion.generacion_operativa import (
    MAX_MANIFIESTO_BYTES,
    REVISION,
    SHA256,
    leer_manifiesto_generacion,
    verificar_descarga_temporal,
    verificar_generacion,
)

ERROR_GENERICO = "Generación almacenada no verificable."


class AlmacenGeneracionesInvalido(ValueError):
    """No se ha confirmado una generación completa con las expectativas privadas indicadas."""


class AlmacenGeneracionesNoDisponible(AlmacenGeneracionesInvalido):
    """La recuperación se ha cortado por el almacén o el disco: no dice nada de la integridad y se puede repetir."""


class AlmacenGeneraciones(Protocol):
    """Transporte síncrono autenticado, sin sobrescritura y con lectura integral cotejada."""

    def guardar(self, clave: str, origen: Path, sha256: str, bytes: int) -> None:
        """Guarda condicionalmente y confirma tamaño exacto y hash por lectura remota completa."""
        ...

    def recuperar(self, clave: str, destino_nuevo: Path, sha256: str, bytes_maximos: int) -> None:
        """Recupera con cota y hash a un archivo exclusivo, sin publicar contenido parcial.

        Lanza FileNotFoundError solo si el almacén confirma que el objeto no existe.
        """
        ...


def _exigir(condicion: bool) -> None:
    if not condicion:
        raise AlmacenGeneracionesInvalido(ERROR_GENERICO)


def _referencia(revision: str, huella: str) -> None:
    _exigir(isinstance(revision, str) and REVISION.fullmatch(revision) is not None)
    _exigir(isinstance(huella, str) and SHA256.fullmatch(huella) is not None)


def _resumen(manifiesto: dict[str, Any], huella: str) -> dict[str, Any]:
    return {
        "version": 1,
        "revisionCodigo": manifiesto["revisionCodigo"],
        "sha256Manifiesto": huella,
        "archivos": len(manifiesto["archivos"]),
        "bytesTotales": manifiesto["bytesTotales"],
    }


def guardar_generacion(origen: Path, revision: str, sha256: str, almacen: AlmacenGeneraciones) -> dict[str, Any]:
    """Confirma una generación local completa antes de guardar su marcador remoto.

    Returns:
        El mismo resumen cerrado de la exportación, sin afirmar activación de datos.

    Raises:
        AlmacenGeneracionesInvalido: Si la generación o alguna transferencia no se verifica.
    """
    try:
        _referencia(revision, sha256)
        manifiesto = verificar_generacion(origen, revision, sha256)
        marcador = f"generaciones/{sha256}.json"
        guardar_archivos(origen / "contenido", manifiesto["archivos"], marcador, almacen)
        ruta = origen / "manifiesto.json"
        almacen.guardar(marcador, ruta, sha256, ruta.stat().st_size)
        return _resumen(manifiesto, sha256)
    except (ErrorFuente, OSError, ValueError, TypeError, KeyError, RecursionError):
        raise AlmacenGeneracionesInvalido(ERROR_GENERICO) from None


def _recuperar_objeto(almacen: AlmacenGeneraciones, clave: str, destino: Path, sha256: str, maximo: int) -> None:
    try:
        almacen.recuperar(clave, destino, sha256, maximo)
    except FileNotFoundError:
        # Un objeto que no existe deja la generación incompleta: no es un corte que se arregle repitiendo.
        raise AlmacenGeneracionesInvalido(ERROR_GENERICO) from None


def recuperar_generacion(
    destino_nuevo: Path, revision: str, sha256: str, almacen: AlmacenGeneraciones
) -> dict[str, Any]:
    """Valida el manifiesto antes de crear sus rutas y promueve solo una generación completa.

    Returns:
        Resumen cerrado del destino nuevo, verificado y apto para el aprovisionamiento posterior.

    Raises:
        AlmacenGeneracionesNoDisponible: Si el almacén o el disco no completan una lectura o escritura.
        AlmacenGeneracionesInvalido: Si falta un objeto o falla una expectativa o una comprobación de integridad.
    """
    try:
        _referencia(revision, sha256)
        _exigir(stat.S_ISDIR(destino_nuevo.parent.lstat().st_mode))
        _exigir(not destino_nuevo.exists() and not destino_nuevo.is_symlink())
        with tempfile.TemporaryDirectory(prefix=".recuperando-generacion-", dir=destino_nuevo.parent) as nombre:
            temporal = Path(nombre)
            marcador = f"generaciones/{sha256}.json"
            _recuperar_objeto(almacen, marcador, temporal / "manifiesto.json", sha256, MAX_MANIFIESTO_BYTES)
            manifiesto = leer_manifiesto_generacion(temporal, revision, sha256)
            contenido = temporal / "contenido"
            contenido.mkdir()
            recuperar_archivos(contenido, manifiesto["archivos"], marcador, almacen)
            verificar_descarga_temporal(temporal, revision, sha256)
            promover_directorio(temporal, destino_nuevo)
        return _resumen(manifiesto, sha256)
    except OSError:
        raise AlmacenGeneracionesNoDisponible(ERROR_GENERICO) from None
    except (ErrorFuente, ValueError, TypeError, KeyError, RecursionError):
        raise AlmacenGeneracionesInvalido(ERROR_GENERICO) from None
