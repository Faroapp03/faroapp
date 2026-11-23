"""Selección física de originales enteros o troceados con procedencia lógica intacta.

Las guardas de rutas y archivos pertenecen al exportador que las suministra;
este módulo solo conoce el formato oficial de conservación de los cuerpos.
"""

import hashlib
from collections.abc import Callable
from pathlib import Path

from plataforma_datos.comun.entrada_salida import comprobar_huella
from plataforma_datos.cursos import trozos_catalogo as trozos


def seleccionar(
    raiz: Path,
    relativa: str,
    huella: str,
    camino: Callable[[Path, str], Path],
    propio: Callable[[Path], None],
) -> set[str]:
    """Valida el cuerpo lógico y devuelve descriptor y trozos únicos sin expandirlo.

    La generación sigue identificando bytes físicos. El SHA lógico se verifica
    incrementalmente con el lector oficial: nunca se materializa el cuerpo entero.

    Returns:
        Las rutas físicas canónicas y verificadas que requiere este original.
    """
    ruta = camino(raiz, relativa)
    propio(ruta)
    manifiesto = trozos.manifiesto_de(ruta, huella, limite=trozos.MAX_CUERPO)
    archivos = {relativa}
    if manifiesto is None:
        comprobar_huella(ruta, huella)
        return archivos
    cuerpo_sha = hashlib.sha256()
    total = 0
    for sha, tamano in manifiesto.trozos:
        trozo = trozos.ruta_trozo(ruta, sha)
        relativa_trozo = trozo.relative_to(raiz).as_posix()
        propio(camino(raiz, relativa_trozo))
        contenido = trozos.leer(trozo, sha, limite=trozos.MAX_TROZO)
        trozos.exigir(len(contenido) == tamano, "Trozo con otro tamaño")
        cuerpo_sha.update(contenido)
        total += len(contenido)
        archivos.add(relativa_trozo)
    trozos.exigir(total == manifiesto.bytes and cuerpo_sha.hexdigest() == huella, "Cuerpo reconstruido alterado")
    return archivos
