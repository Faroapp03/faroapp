"""Revalida el catálogo de Cursos instalado cuando cambia el código que lo admite.

La admisión lleva la huella del código que la auditó (`codigo_sha256`) y su lectura la exige, para que un código
nuevo no acepte por herencia lo que admitió el anterior. Sin este paso, cambiar ese código dejaría a las fuentes de
cursos sin poder leer el catálogo y la actualización no llegaría a componer uno nuevo. Aquí se repite la auditoría
completa con el código vigente; solo se reescribe el informe de admisión: la instantánea y sus evidencias no cambian.
Si la auditoría no pasa, el catálogo sigue sin admitir y las fuentes fallan con su motivo.

Uso: python -m plataforma_datos.cursos.revalidar_catalogo
"""

import hashlib
import json
import sys
from pathlib import Path

from plataforma_datos.comun.nucleo import ErrorFuente
from plataforma_datos.cursos import admision_catalogo as admision
from plataforma_datos.cursos import almacen_catalogo as almacen
from plataforma_datos.cursos.auditoria_snapshot_catalogo import ErrorAdmisionCatalogo
from plataforma_datos.orquestacion.ordenes import con_motivo


def _sha(ruta: Path) -> str:
    with ruta.open("rb") as archivo:
        return hashlib.file_digest(archivo, "sha256").hexdigest()


def _codigo_registrado(informe: Path) -> object:
    """La firma de código que registra el informe de admisión instalado.

    Returns:
        El valor de `codigo_sha256` del informe, o None si no lo tiene.

    Raises:
        ErrorFuente: Si el informe no es un objeto JSON en UTF-8.
    """
    try:
        registrado = json.loads(informe.read_bytes().decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        registrado = error
    if not isinstance(registrado, dict):
        raise ErrorFuente(
            f"El catálogo de Cursos no se puede revalidar: {informe} no es un objeto JSON en UTF-8. No se ha cambiado "
            "ningún archivo; recupera el catálogo admitido desde una generación comprobada."
        )
    return registrado.get("codigo_sha256")


def revalidar(raiz: Path = admision.RAIZ) -> str:
    """Repite la admisión del catálogo instalado si la hizo otro código.

    Returns:
        Qué se hizo: nada que revalidar, al día o revalidado.

    Raises:
        ErrorAdmisionCatalogo: Si el catálogo no supera la auditoría con el código vigente; no se ha escrito nada.
        ErrorFuente: Si el informe instalado no es un objeto JSON, o si algo falla después de reescribirlo.
    """
    area = raiz / almacen.RUTA
    informe = area / "validacion.json"
    if not informe.is_file():
        return "Catálogo de Cursos sin admisión instalada: nada que revalidar."
    if _codigo_registrado(informe) == admision.firma_codigo():
        return "Catálogo de Cursos admitido con el código vigente."
    solicitud = almacen.solicitud(area)
    antes = _sha(solicitud.snapshot.ruta)
    admision.admitir_snapshot(solicitud)
    reescrito = f"El informe de admisión {solicitud.validacion_destino} ya se reescribió"
    repetir = "repite la orden sin otros procesos que cambien el código o el catálogo."
    try:
        admision.exigir_snapshot_admitido(solicitud, sha256_validacion=_sha(solicitud.validacion_destino))
    except ErrorAdmisionCatalogo as error:
        raise ErrorFuente(
            f"El catálogo de Cursos no se ha revalidado: {error}. {reescrito} y su lectura lo sigue rechazando: el "
            f"catálogo sigue sin admitir; {repetir}"
        ) from error
    if _sha(solicitud.snapshot.ruta) != antes:
        raise ErrorFuente(
            f"El catálogo de Cursos no se ha revalidado: su instantánea cambió durante la revalidación. {reescrito} "
            f"para la instantánea que se auditó, que no es la que había al empezar; {repetir}"
        )
    return "Catálogo de Cursos revalidado con el código vigente: auditoría completa repetida, instantánea sin cambios."


def _informar() -> None:
    """Escribe lo hecho; una auditoría que no pasa se explica como error de la cadena, con su motivo.

    Raises:
        ErrorFuente: Si el catálogo no supera la auditoría con el código vigente, sin haber escrito nada.
    """
    try:
        resultado = revalidar()
    except ErrorAdmisionCatalogo as error:
        raise ErrorFuente(f"El catálogo de Cursos no supera la auditoría con el código vigente: {error}") from error
    print(resultado, flush=True)


def main() -> int:
    """Ejecuta la revalidación e informa de lo hecho; si falla, escribe «Error: <motivo>» sin traza.

    Returns:
        El código de salida de la orden: 0 si va bien y 1 si falla.
    """
    return con_motivo(_informar)


if __name__ == "__main__":
    sys.exit(main())
