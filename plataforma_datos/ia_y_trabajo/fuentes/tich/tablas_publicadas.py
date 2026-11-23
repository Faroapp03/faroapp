"""Las tablas del INE con que se contrasta el cálculo: CSV UTF-8 con BOM, separado por punto y coma.

La tabla de errores de muestreo cambia de forma según el año, y se reconoce por su cabecera:

- con cuatro columnas («Total Nacional», «Comunidades y Ciudades Autónomas», «Principales usos de TIC», «Total»; tabla
  76849 de 2025), las comunidades llevan su código («09 Cataluña») y el total nacional va con la comunidad vacía;
- con tres columnas («Comunidades y Ciudades Autónomas», «Principales usos de TIC», «Total»; tabla 82907 de 2026),
  «Total nacional» es una fila más y las comunidades van sin código («Cataluña»), que se busca por su nombre.

Una tercera forma detiene la lectura con su motivo. La tabla de uso por características socioeconómicas mantiene su
forma (población de referencia, característica, categoría y total).
"""

import csv
import io
import re

from plataforma_datos.comun.nucleo import FormatoInesperado, exigir
from plataforma_datos.comun.textos_y_cifras import numero_con_coma
from plataforma_datos.ia_y_trabajo.fuentes.tich.constantes import TOTAL_NACIONAL

# Celdas sin cifra publicada en las tablas del INE: vacías o con la marca «..».
SIN_CIFRA = ("", "..")
CABECERA_USO = (
    "Población de referencia",
    "Características socioeconómicas",
    "Inteligencia Artificial Generativa",
    "Total",
)
CON_CODIGO = ("Total Nacional", "Comunidades y Ciudades Autónomas", "Principales usos de TIC", "Total")
SIN_CODIGO = ("Comunidades y Ciudades Autónomas", "Principales usos de TIC", "Total")
# Nombres oficiales de las comunidades y ciudades autónomas del INE, por código; se comparan sin mayúsculas ni
# espacios, porque el INE escribe «Castilla - La Mancha» un año y «Castilla-La Mancha» otro.
COMUNIDADES = {
    "01": "Andalucía",
    "02": "Aragón",
    "03": "Asturias, Principado de",
    "04": "Balears, Illes",
    "05": "Canarias",
    "06": "Cantabria",
    "07": "Castilla y León",
    "08": "Castilla - La Mancha",
    "09": "Cataluña",
    "10": "Comunitat Valenciana",
    "11": "Extremadura",
    "12": "Galicia",
    "13": "Madrid, Comunidad de",
    "14": "Murcia, Región de",
    "15": "Navarra, Comunidad Foral de",
    "16": "País Vasco",
    "17": "Rioja, La",
}


def _clave(nombre: str) -> str:
    return re.sub(r"\s+", "", nombre).casefold()


CODIGO_POR_NOMBRE = {_clave(nombre): codigo for codigo, nombre in COMUNIDADES.items()}


def filas_del_csv(texto: str, nombre: str) -> tuple[tuple[str, ...], list[list[str]]]:
    """La cabecera y las filas de un CSV del INE, cada fila con tantas columnas como la cabecera.

    Returns:
        La cabecera y las filas.

    Raises:
        FormatoInesperado: Si falta la cabecera o alguna fila tiene otro número de columnas.
    """
    filas = list(csv.reader(io.StringIO(texto.removeprefix("﻿")), delimiter=";"))
    exigir(bool(filas), f"{nombre}: tabla sin cabecera")
    cabecera = tuple(filas[0])
    for numero, fila in enumerate(filas[1:], start=2):
        exigir(len(fila) == len(cabecera), f"{nombre}: la fila {numero} no tiene las {len(cabecera)} columnas")
    return cabecera, filas[1:]


def numero_publicado(valor: str, nombre: str, fila: list[str]) -> float:
    """Una cifra del INE, con la conversión de coma decimal del lector común.

    Returns:
        La cifra.

    Raises:
        FormatoInesperado: Si no es numérica, con la tabla y los rótulos de su fila.
    """
    try:
        return numero_con_coma(valor)
    except ValueError as error:
        raise FormatoInesperado(f"{nombre}: cifra no numérica {valor!r} en {fila[:-1]}") from error


def errores_publicados(texto: str, nombre: str, fila_de_contraste: str) -> dict[str, float]:
    """El error estándar relativo (%) de una fila en España («Total Nacional») y en cada comunidad, por su código.

    Ceuta y Melilla van juntas en la tabla y separadas en los microdatos: no se contrastan.

    Returns:
        {«Total Nacional» o código de comunidad: error estándar relativo en %}.

    Raises:
        FormatoInesperado: Si la cabecera no es ninguna de las dos formas conocidas, o falta el total nacional.
    """
    cabecera, filas = filas_del_csv(texto, nombre)
    errores: dict[str, float] = {}
    if cabecera == CON_CODIGO:
        for fila in filas:
            if fila[0] == TOTAL_NACIONAL and fila[2] == fila_de_contraste and fila[3]:
                ambito = fila[1][:2] if fila[1] else TOTAL_NACIONAL
                errores[ambito] = numero_publicado(fila[3], nombre, fila)
    elif cabecera == SIN_CODIGO:
        for fila in filas:
            ambito = (
                TOTAL_NACIONAL if _clave(fila[0]) == _clave(TOTAL_NACIONAL) else CODIGO_POR_NOMBRE.get(_clave(fila[0]))
            )
            if ambito is not None and fila[1] == fila_de_contraste and fila[2]:
                errores[ambito] = numero_publicado(fila[2], nombre, fila)
    else:
        exigir(False, f"{nombre}: cabecera de la tabla de errores desconocida: {list(cabecera)}")
    exigir(TOTAL_NACIONAL in errores, f"{nombre}: falta «{fila_de_contraste}» en el total nacional")
    return errores


def uso_publicado(texto: str, nombre: str) -> dict[tuple[str, str, str], float | None]:
    """Cada cifra de la tabla de uso por características socioeconómicas, por población, característica y categoría.

    El INE marca con «..» (o deja vacía) una cifra que no publica, por ejemplo la de un grupo muy pequeño: esa celda
    no tiene cifra (None), y es quien la necesita quien se detiene si le falta. Cualquier otro texto no numérico es una
    tabla que no se entiende.

    Returns:
        {(población de referencia, característica, categoría): cifra, o None si el INE no la publica}.

    Raises:
        FormatoInesperado: Si la cabecera no es la de la tabla de uso, una fila se repite o una cifra no se entiende.
    """
    cabecera, filas = filas_del_csv(texto, nombre)
    exigir(cabecera == CABECERA_USO, f"{nombre}: cabecera de la tabla de uso desconocida: {list(cabecera)}")
    cifras: dict[tuple[str, str, str], float | None] = {}
    for fila in filas:
        clave = (fila[0], fila[1], fila[2])
        exigir(clave not in cifras, f"{nombre}: fila repetida {list(clave)}")
        cifras[clave] = None if fila[3] in SIN_CIFRA else numero_publicado(fila[3], nombre, fila)
    return cifras
