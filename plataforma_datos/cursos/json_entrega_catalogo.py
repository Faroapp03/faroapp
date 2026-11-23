"""Lectura acotada y escritura canónica del JSON de la entrega de Cursos."""

import json
from pathlib import Path

from plataforma_datos.cursos import contrato_entrega_catalogo as contrato
from plataforma_datos.cursos.contrato_entrega_catalogo import exigir
from plataforma_datos.cursos.tipos_json import ObjetoJson, ValorJson


def bytes_json(dato: ValorJson) -> bytes:
    """Serializa JSON canónico para que la entrega y la publicación compartan bytes.

    Returns:
        Los bytes UTF-8 con salto de línea final.
    """
    return (
        json.dumps(dato, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False) + "\n"
    ).encode()


def _pares_unicos(pares: list[tuple[str, ValorJson]]) -> ObjetoJson:
    salida = {}
    for clave, valor in pares:
        exigir(clave not in salida, "Clave JSON repetida")
        salida[clave] = valor
    return salida


def json_controlado(cuerpo: bytes) -> ValorJson:
    """Lee JSON sin claves repetidas ni números no finitos.

    Returns:
        El valor JSON leído.
    """

    def no_finito(valor: str) -> None:
        raise contrato.ErrorEntregaCatalogo("Número JSON no finito: " + valor)

    return json.loads(cuerpo, object_pairs_hook=_pares_unicos, parse_constant=no_finito)


def leer_bytes(ruta: Path, limite: int) -> bytes:
    """Lee un archivo sin seguir enlaces y con un límite que también se exige después de la lectura.

    Returns:
        Los bytes completos admitidos.
    """
    exigir(not ruta.is_symlink() and ruta.stat().st_size <= limite, "Archivo enlazado o límite excedido")
    with ruta.open("rb") as archivo:
        cuerpo = archivo.read(limite + 1)
    exigir(len(cuerpo) <= limite, "Archivo creció sobre su límite")
    return cuerpo


def leer_json_de_entrega(ruta: Path, limite: int) -> ValorJson:
    """Lee un JSON con tope de bytes, sin claves repetidas ni números no finitos.

    Returns:
        El valor JSON leído.
    """
    return json_controlado(leer_bytes(ruta, limite))
