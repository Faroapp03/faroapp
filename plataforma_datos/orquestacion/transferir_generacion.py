"""Transfiere generaciones completas mediante configuración y credenciales privadas del ejecutor.

No consulta perfiles AWS ambientales, cambia la generación base ni activa datos. Las expectativas
de revisión y huella se proporcionan por separado del contenido que se transfiere.
"""

import argparse
import json
import os
import sys
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from plataforma_datos.comun.entrada_salida import json_compacto
from plataforma_datos.orquestacion.almacen_generaciones import guardar_generacion, recuperar_generacion
from plataforma_datos.orquestacion.almacen_s3 import AlmacenS3
from plataforma_datos.orquestacion.configuracion_almacen_s3 import ConfiguracionAlmacenS3
from plataforma_datos.orquestacion.generacion_operativa import REVISION, SHA256

ERROR_GENERICO = "Transferencia no completada: comprueba la configuración privada, la referencia y el almacén."
MAX_CONFIG_BYTES = 16 * 1024
CAMPOS_CONFIG = {"version", "endpoint", "bucket", "prefijo", "region"}


def _pares(pares: list[tuple[str, Any]]) -> dict[str, Any]:
    resultado = {}
    for clave, valor in pares:
        if clave in resultado:
            raise ValueError(ERROR_GENERICO)
        resultado[clave] = valor
    return resultado


def configuracion_privada(entorno: Mapping[str, str]) -> ConfiguracionAlmacenS3:
    """Lee solo las tres variables explícitas de Faro, sin valores implícitos de otro proveedor.

    Returns:
        Configuración validada; los secretos no forman parte del JSON ni de su representación.

    Raises:
        ValueError: Si falta algún campo, hay claves desconocidas o el esquema no es válido.
    """
    texto = entorno.get("FARO_ALMACEN_S3", "")
    if len(texto.encode("utf-8")) > MAX_CONFIG_BYTES:
        raise ValueError(ERROR_GENERICO)
    documento = json.loads(texto, object_pairs_hook=_pares)
    if (
        not isinstance(documento, dict)
        or set(documento) != CAMPOS_CONFIG
        or type(documento["version"]) is not int
        or documento["version"] != 1
        or not all(isinstance(documento[campo], str) for campo in CAMPOS_CONFIG - {"version"})
    ):
        raise ValueError(ERROR_GENERICO)
    return ConfiguracionAlmacenS3(
        endpoint=documento["endpoint"],
        bucket=documento["bucket"],
        prefijo=documento["prefijo"],
        region=documento["region"],
        access_key_id=entorno.get("FARO_ALMACEN_ACCESS_KEY_ID", ""),
        secret_access_key=entorno.get("FARO_ALMACEN_SECRET_ACCESS_KEY", ""),
    )


def _comprobar_referencia(revision: str, huella: str) -> None:
    if REVISION.fullmatch(revision) is None or SHA256.fullmatch(huella) is None:
        raise ValueError(ERROR_GENERICO)


def main(argv: list[str] | None = None) -> int:
    """CLI privada: guardar desde una generación o recuperar hacia un directorio nuevo.

    Returns:
        Cero con el resumen verificado; uno ante error, sin secretos ni resumen de éxito.
    """
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("accion", choices=("guardar", "recuperar"))
    parser.add_argument("directorio", type=Path)
    parser.add_argument("--revision-generacion", required=True)
    parser.add_argument("--sha256-manifiesto", required=True)
    argumentos = parser.parse_args(argv)
    try:
        _comprobar_referencia(argumentos.revision_generacion, argumentos.sha256_manifiesto)
        configuracion = configuracion_privada(os.environ)
        operacion = guardar_generacion if argumentos.accion == "guardar" else recuperar_generacion
        with AlmacenS3(configuracion) as almacen:
            resumen = operacion(
                argumentos.directorio, argumentos.revision_generacion, argumentos.sha256_manifiesto, almacen
            )
    except (OSError, ValueError, RecursionError):
        print(ERROR_GENERICO, file=sys.stderr)
        return 1
    print(json_compacto(resumen))
    return 0


if __name__ == "__main__":
    sys.exit(main())
