"""Contenido y escritura de un paquete individual, con su entrada del manifiesto."""

from pathlib import Path
from typing import Any, Literal, NamedTuple

from plataforma_datos.comun.entrada_salida import guardar_json, guardar_json_compacto, relativa, sha256
from plataforma_datos.comun.nucleo import PAQUETE


class Paquete(NamedTuple):
    """Contenido público y archivos operativos de los que sale, en su orden de composición."""

    datos: Any
    origenes: list[Path]


def escribir(
    nombre: str,
    paquete: Paquete,
    carpeta: Path = PAQUETE,
    *,
    formato: Literal["compacto", "sangrado"],
) -> dict[str, Any]:
    """Escribe un archivo entero o nada y devuelve sus huellas sin escribir el manifiesto.

    Args:
        nombre: Nombre del archivo de salida.
        paquete: Contenido y orígenes cuya identidad se registra.
        carpeta: Carpeta de salida.
        formato: Selección explícita del JSON compacto o con sangrado.

    Returns:
        La entrada del manifiesto con las rutas operativas y las SHA de orígenes y salida.

    Raises:
        ValueError: Si el formato no es uno de los admitidos.
    """
    if formato not in ("compacto", "sangrado"):
        raise ValueError(f"Formato de paquete desconocido: {formato}")
    origenes = {relativa(ruta): sha256(ruta) for ruta in paquete.origenes}
    destino = carpeta / nombre
    guardar = guardar_json_compacto if formato == "compacto" else guardar_json
    guardar(destino, paquete.datos)
    return {"origenes": origenes, "sha256": sha256(destino)}
