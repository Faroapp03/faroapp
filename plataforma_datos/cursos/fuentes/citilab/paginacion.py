"""Paginación de la API WordPress de Citilab: cada página se pide, se comprueba y se conserva tal como llega.

Cada página debe traer los elementos que le tocan según los totales que declara (x-wp-total, x-wp-totalpages), los
totales no cambian entre páginas de un recurso y una colección no pasa de MAX_PAGINAS. La copia junta las páginas de
cada recurso y cuadra la suma con el total registrado.
"""

import json
import re
import time
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from plataforma_datos.comun.entrada_salida import leer_json, ultimo_original
from plataforma_datos.comun.nucleo import ArchivoDescargable, exigir
from plataforma_datos.comun.red import descargar_originales
from plataforma_datos.cursos.fuentes.citilab.constantes import (
    API,
    CONSULTAS,
    FUENTE,
    LICENCIA,
    MAX_PAGINAS,
    PAGINA_DE_COMPROBACION,
    PAUSA_ENTRE_PETICIONES_S,
    POR_PAGINA,
)


def _nombre_de_pagina(recurso: str, dia: str, numero: int) -> str:
    """El nombre del original de una página; la primera conserva el de una copia de una sola página.

    Returns:
        El nombre del archivo.
    """
    return f"{recurso}-{dia}.json" if numero == 1 else f"{recurso}-{dia}-pagina-{numero}.json"


def _archivo_de_pagina(recurso: str, campos: str, titulo: str, dia: str, numero: int) -> ArchivoDescargable:
    """El original de una página de un recurso; la primera conserva la dirección de una sola página.

    Returns:
        El archivo descargable, con su nombre, su dirección y su licencia.
    """
    consulta = "" if numero == 1 else f"&page={numero}"
    return {
        "archivo": _nombre_de_pagina(recurso, dia, numero),
        "nivel": "oficial",
        "titulo": titulo,
        "url": f"{API}/{recurso}?per_page={POR_PAGINA}&_fields={campos}{consulta}",
        "licencia": LICENCIA,
    }


def archivos_de_la_copia(dia: str, paginas: Mapping[str, int] | None = None) -> list[ArchivoDescargable]:
    """Los originales de una copia: cada página de las fichas y de los dos vocabularios, con su dirección en la API.

    Args:
        dia: El día de la copia.
        paginas: Páginas declaradas por recurso; sin ellas, una por recurso.

    Returns:
        Los archivos descargables, por recurso y página.
    """
    return [
        _archivo_de_pagina(recurso, campos, titulo, dia, numero)
        for recurso, campos, titulo in CONSULTAS
        for numero in range(1, max(1, (paginas or {}).get(recurso, 1)) + 1)
    ]


def _total_declarado(cabeceras: Mapping[str, str], nombre: str) -> int:
    """Un total WordPress declarado una sola vez como entero decimal estricto.

    Returns:
        El total.
    """
    valores = [valor for clave, valor in cabeceras.items() if clave.lower() == nombre]
    exigir(
        len(valores) == 1
        and isinstance(valores[0], str)
        and re.fullmatch(r"0|[1-9][0-9]{0,8}", valores[0]) is not None,
        f"citilab: {nombre} ausente, repetido o no es un entero decimal estricto",
    )
    return int(valores[0])


def es_pagina_html(datos: bytes, cabeceras: Mapping[str, str]) -> bool:
    """Reconoce una página HTML en lugar de la colección: por su tipo de contenido o porque empieza por una etiqueta.

    Returns:
        Verdadero si la respuesta es una página y no datos JSON.
    """
    tipos = [valor for clave, valor in cabeceras.items() if clave.lower() == "content-type"]
    declarada = any(tipo.split(";")[0].strip().lower() in ("text/html", "application/xhtml+xml") for tipo in tipos)
    return declarada or datos.lstrip()[:1] == b"<"


def totales_de_pagina(datos: bytes, cabeceras: Mapping[str, str], numero: int) -> tuple[int, int]:
    """Exige que una página traiga justo los elementos que le tocan según los totales que declara.

    Los totales se usan durante la descarga y para contar la copia; no se deduce de ellos disponibilidad de cursos.

    Returns:
        El total de elementos y el de páginas que declara la colección.
    """
    exigir(not es_pagina_html(datos, cabeceras), f"citilab: {PAGINA_DE_COMPROBACION}")
    try:
        coleccion = json.loads(datos.decode("utf-8"))
    except (ValueError, RecursionError):
        exigir(False, "citilab: la colección no es JSON UTF-8 válido")
    exigir(isinstance(coleccion, list), "citilab: la colección no es una lista")
    total, paginas = _total_declarado(cabeceras, "x-wp-total"), _total_declarado(cabeceras, "x-wp-totalpages")
    esperados = min(POR_PAGINA, max(0, total - (numero - 1) * POR_PAGINA))
    exigir(
        paginas <= MAX_PAGINAS,
        f"citilab: la colección declara {paginas} páginas y el máximo admitido es {MAX_PAGINAS}; revisa la consulta",
    )
    exigir(
        paginas == -(-total // POR_PAGINA) and numero <= max(1, paginas) and len(coleccion) == esperados,
        "citilab: cuerpo y totales de paginación no concuerdan",
    )
    return total, paginas


def descargar_recurso(
    carpeta: Path, consulta: tuple[str, str, str], dia: str, aceptar_cambio: bool
) -> tuple[list[dict[str, Any]], dict[str, int]]:
    """Descarga todas las páginas de un recurso, con la misma pausa entre peticiones, exigiendo totales estables.

    Returns:
        Las entradas de procedencia, una por página, y los totales declarados («total» y «paginas»).
    """
    recurso, campos, titulo = consulta
    vistos: list[tuple[int, int]] = []
    registros: list[dict[str, Any]] = []
    numero, paginas = 1, 1
    while numero <= paginas:

        def comprobar(datos: bytes, cabeceras: Mapping[str, str], numero: int = numero) -> None:
            vistos.append(totales_de_pagina(datos, cabeceras, numero))

        archivo = _archivo_de_pagina(recurso, campos, titulo, dia, numero)
        registros += descargar_originales([archivo], carpeta, aceptar_cambio, comprobar=comprobar)
        time.sleep(PAUSA_ENTRE_PETICIONES_S)
        exigir(len(set(vistos)) == 1, f"citilab: los totales de «{recurso}» cambian entre páginas")
        paginas = max(1, vistos[0][1])
        numero += 1
    total, declaradas = vistos[0]
    return registros, {"total": total, "paginas": declaradas}


def leer_coleccion(registrada: dict[str, Any], recurso: str) -> list[Any]:
    """Junta las páginas registradas de un recurso, comprobadas con su huella, y las cuadra con sus totales.

    Una copia sin totales registrados es de una sola página por recurso.

    Returns:
        Los elementos de todas las páginas, en su orden.
    """
    dia = registrada["copia"]
    declarado = registrada.get("totales", {}).get(recurso)
    paginas = max(1, declarado["paginas"]) if declarado else 1
    elementos: list[Any] = []
    for numero in range(1, paginas + 1):
        pagina = leer_json(ultimo_original(FUENTE, re.escape(_nombre_de_pagina(recurso, dia, numero))))
        exigir(isinstance(pagina, list), f"{FUENTE}: «{recurso}» no es una lista")
        elementos += pagina
    if declarado is not None:
        exigir(
            len(elementos) == declarado["total"],
            f"{FUENTE}: «{recurso}» tiene {len(elementos)} elementos y la fuente declaró {declarado['total']}",
        )
    return elementos
