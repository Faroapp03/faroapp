"""Códigos cerrados con que falla la composición del catálogo cuando su almacén no sirve.

`componer_catalogo` los pone al principio de su motivo; la orquestación los anota en el motivo del paquete y el panel
los expone como un valor de esta lista, sin texto libre ni rutas.
"""

import re

AUSENTE = "almacen-ausente"
ILEGIBLE = "almacen-ilegible"
VACIO = "almacen-vacio"
CODIGOS = (AUSENTE, ILEGIBLE, VACIO)
_CODIGO = re.compile(r"(?<![\w-])(" + "|".join(CODIGOS) + r")(?![\w-])")


def codigo_en(texto: str | None) -> str | None:
    """Busca un código de la lista en un motivo o en la salida de un paso.

    Returns:
        El último código que aparece, o None si no hay ninguno.
    """
    if texto is None:
        return None
    encontrados = _CODIGO.findall(texto)
    return encontrados[-1] if encontrados else None
