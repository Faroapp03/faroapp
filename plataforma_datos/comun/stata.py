"""Lectura de archivos de datos de Stata (.dta, versiones 118 y 119) con Python estándar, en un solo recorrido.

Formato publicado por StataCorp («dta file format», `help dta`): cabecera con etiquetas, un mapa de posiciones, los
tipos y nombres de las variables y, después, los registros de ancho fijo, uno por observación. Solo se leen las
columnas pedidas; el flujo se recorre hacia delante, así que vale el de un miembro de un zip sin descomprimirlo en
disco. Los valores ausentes de Stata («.», «.a»… «.z») se devuelven como None. Las cadenas largas (strL) no se leen.
"""

import struct
from collections.abc import Iterator
from io import DEFAULT_BUFFER_SIZE
from typing import BinaryIO

from plataforma_datos.comun.nucleo import FormatoInesperado, exigir

VERSIONES = (118, 119)
# La versión 118 guarda el número de variables en 2 bytes; la 119, en 4.
VERSION_CON_K_CORTO = 118
ANCHO_K_CORTO = 2
ANCHO_K_LARGO = 4
# El mayor tipo que es una cadena corta (de ese ancho en bytes).
CADENA_CORTA_MAXIMA = 2045
# Tipo de Stata → (formato de struct, bytes, menor valor que ya es «ausente»). 1–2045 son cadenas de ese ancho.
NUMERICOS = {
    65530: ("b", 1, 101),
    65529: ("h", 2, 32741),
    65528: ("i", 4, 2147483621),
    65527: ("f", 4, 1.7014118346046923e38),
    65526: ("d", 8, 8.98846567431158e307),
}
CADENA_LARGA = 32768
ANCHO_NOMBRE = 129  # 128 bytes UTF-8 y el nulo final


def _leer(flujo: BinaryIO, cuantos: int) -> bytes:
    datos = flujo.read(cuantos)
    exigir(len(datos) == cuantos, "Stata: el archivo se acaba antes de lo que dice su cabecera")
    return datos


def _etiqueta(flujo: BinaryIO, nombre: str) -> None:
    abierta = f"<{nombre}>".encode()
    exigir(_leer(flujo, len(abierta)) == abierta, f"Stata: se esperaba la etiqueta {nombre}")


def _saltar_hasta(flujo: BinaryIO, leidos: int, destino: int) -> int:
    exigir(destino >= leidos, "Stata: el mapa del archivo apunta hacia atrás")
    while leidos < destino:
        cuantos = min(DEFAULT_BUFFER_SIZE, destino - leidos)
        _leer(flujo, cuantos)
        leidos += cuantos
    return destino


def _texto(datos: bytes, campo: str) -> str:
    """Lee un texto corto de Stata hasta el nulo final, sin sustituir bytes ilegibles.

    Returns:
        El texto UTF-8.

    Raises:
        FormatoInesperado: Si el texto no es UTF-8, con su campo y la causa original.
    """
    try:
        return datos.split(b"\0", 1)[0].decode("utf-8")
    except UnicodeDecodeError as error:
        raise FormatoInesperado(f"Stata: {campo} no es texto UTF-8") from error


def _cabecera_fija(flujo: BinaryIO) -> tuple[str, int, int]:
    """La cabecera: orden de bytes («<» o «>»), número de variables y de observaciones.

    Returns:
        El orden de bytes, el número de variables y el número de observaciones.

    Raises:
        FormatoInesperado: Si la versión no se puede interpretar como número.
    """
    _etiqueta(flujo, "stata_dta")
    _etiqueta(flujo, "header")
    _etiqueta(flujo, "release")
    try:
        version = int(_leer(flujo, 3))
    except ValueError as error:
        raise FormatoInesperado("Stata: versión ilegible") from error
    exigir(version in VERSIONES, f"Stata: versión {version} no admitida (solo {VERSIONES})")
    _etiqueta(flujo, "/release")
    _etiqueta(flujo, "byteorder")
    orden = {b"LSF": "<", b"MSF": ">"}.get(_leer(flujo, 3))
    exigir(orden is not None, "Stata: orden de bytes desconocido")
    _etiqueta(flujo, "/byteorder")
    _etiqueta(flujo, "K")
    ancho_k = ANCHO_K_CORTO if version == VERSION_CON_K_CORTO else ANCHO_K_LARGO
    (num_vars,) = struct.unpack(f"{orden}{'H' if ancho_k == ANCHO_K_CORTO else 'I'}", _leer(flujo, ancho_k))
    _etiqueta(flujo, "/K")
    _etiqueta(flujo, "N")
    (num_obs,) = struct.unpack(f"{orden}Q", _leer(flujo, 8))
    _etiqueta(flujo, "/N")
    _etiqueta(flujo, "label")
    (largo,) = struct.unpack(f"{orden}H", _leer(flujo, 2))
    _leer(flujo, largo)
    _etiqueta(flujo, "/label")
    _etiqueta(flujo, "timestamp")
    (largo,) = struct.unpack(f"{orden}B", _leer(flujo, 1))
    _leer(flujo, largo)
    _etiqueta(flujo, "/timestamp")
    _etiqueta(flujo, "/header")
    return orden, num_vars, num_obs


def _cabecera(flujo: BinaryIO, variables: tuple[str, ...]) -> tuple[str, int, dict[str, tuple[int, int, int]], int]:
    """Lee hasta el principio de los registros: orden de bytes, observaciones, columnas pedidas y ancho del registro.

    Returns:
        El orden de bytes, las observaciones, las columnas pedidas y el ancho del registro, en bytes.
    """
    orden, num_vars, num_obs = _cabecera_fija(flujo)
    _etiqueta(flujo, "map")
    mapa = struct.unpack(f"{orden}14Q", _leer(flujo, 14 * 8))
    _etiqueta(flujo, "/map")
    leidos = mapa[1] + len(b"<map></map>") + 14 * 8
    leidos = _saltar_hasta(flujo, leidos, mapa[2])
    _etiqueta(flujo, "variable_types")
    tipos = struct.unpack(f"{orden}{num_vars}H", _leer(flujo, 2 * num_vars))
    _etiqueta(flujo, "/variable_types")
    leidos = mapa[2] + len(b"<variable_types></variable_types>") + 2 * num_vars
    leidos = _saltar_hasta(flujo, leidos, mapa[3])
    _etiqueta(flujo, "varnames")
    crudos = _leer(flujo, ANCHO_NOMBRE * num_vars)
    nombres = [_texto(crudos[i * ANCHO_NOMBRE : (i + 1) * ANCHO_NOMBRE], "nombre de variable") for i in range(num_vars)]
    exigir(len(set(nombres)) == len(nombres), "Stata: hay nombres de variable repetidos")
    _etiqueta(flujo, "/varnames")
    leidos = mapa[3] + len(b"<varnames></varnames>") + ANCHO_NOMBRE * num_vars
    faltan = [nombre for nombre in variables if nombre not in nombres]
    exigir(not faltan, f"Stata: el archivo no tiene las variables {faltan}")
    columnas: dict[str, tuple[int, int, int]] = {}
    posicion = 0
    for nombre, tipo in zip(nombres, tipos, strict=True):
        exigir(
            tipo in NUMERICOS or 1 <= tipo <= CADENA_CORTA_MAXIMA or tipo == CADENA_LARGA,
            f"Stata: tipo {tipo} desconocido",
        )
        ancho = NUMERICOS[tipo][1] if tipo in NUMERICOS else (8 if tipo == CADENA_LARGA else tipo)
        if nombre in variables:
            exigir(tipo != CADENA_LARGA, f"Stata: {nombre} es una cadena larga (strL), que no se lee")
            columnas[nombre] = (posicion, ancho, tipo)
        posicion += ancho
    _saltar_hasta(flujo, leidos, mapa[9])
    _etiqueta(flujo, "data")
    return orden, num_obs, columnas, posicion


def leer_dta(flujo: BinaryIO, variables: tuple[str, ...]) -> Iterator[dict[str, float | str | None]]:
    """Devuelve, por observación, las `variables` pedidas (números o cadenas; None si el valor es ausente).

    Yields:
        Un diccionario por observación, con las variables pedidas.
    """
    orden, num_obs, columnas, ancho_registro = _cabecera(flujo, variables)
    lectores = {
        nombre: (slice(inicio, inicio + ancho), struct.Struct(f"{orden}{NUMERICOS[tipo][0]}"), NUMERICOS[tipo][2])
        for nombre, (inicio, ancho, tipo) in columnas.items()
        if tipo in NUMERICOS
    }
    cadenas = {
        nombre: slice(inicio, inicio + ancho)
        for nombre, (inicio, ancho, tipo) in columnas.items()
        if tipo <= CADENA_CORTA_MAXIMA
    }
    for _ in range(num_obs):
        registro = _leer(flujo, ancho_registro)
        fila: dict[str, float | str | None] = {}
        for nombre, (tramo, formato, ausente) in lectores.items():
            (valor,) = formato.unpack(registro[tramo])
            fila[nombre] = None if valor >= ausente else valor
        for nombre, tramo in cadenas.items():
            fila[nombre] = _texto(registro[tramo], nombre)
        yield fila
    exigir(_leer(flujo, len(b"</data>")) == b"</data>", "Stata: los registros no cierran donde dice la cabecera")
