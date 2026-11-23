"""Contrato de las tres tablas de contratación de Cataluña que publica el visor."""

import json
import re
from math import isfinite
from typing import Any

from plataforma_datos.comun.nucleo import FormatoInesperado, exigir
from plataforma_datos.mercado.fuentes.cataluna.piezas.constantes_cataluna import (
    MESES,
    TABLA_CONTRATACION,
    TABLA_MUJERES,
    TABLA_TOTALES,
)

CENSOS_FIJOS = tuple(
    f"ine-censo2021-ocu{nivel}-{variable}.json" for nivel in ("2", "3") for variable in ("sexo", "edad")
)
TABLAS = (TABLA_TOTALES, TABLA_CONTRATACION, TABLA_MUJERES)
CIFRAS_TOTALES = ("eo_cont_sum_12m", "eo_per_cont_com_anual")
CIFRAS_CONTRATACION = (*CIFRAS_TOTALES, "eo_per_cont_var_anual", "eo_perc_indef_tot_cont", "eo_dno_mitj")
SEXOS = {"01": "Home", "02": "Dona"}


def _objeto(pares: list[tuple[str, Any]]) -> dict[str, Any]:
    """Lee un objeto JSON sin sobrescribir una columna repetida.

    Returns:
        Las columnas originales, si cada nombre solo aparece una vez.
    """
    objeto = {}
    for clave, valor in pares:
        exigir(clave not in objeto, f"visor: columna JSON duplicada {clave}")
        objeto[clave] = valor
    return objeto


def contenido_visor(datos: bytes, tabla: str) -> object:
    """Lee JSON del visor sin sobrescribir columnas duplicadas.

    Returns:
        El contenido original, pendiente del contrato específico de cada tabla.

    Raises:
        FormatoInesperado: Si el cuerpo no es JSON o repite una columna.
    """
    try:
        return json.loads(datos, object_pairs_hook=_objeto)
    except (ValueError, UnicodeError) as error:
        raise FormatoInesperado(f"{tabla}: respuesta no JSON") from error


def mes_valido(valor: object) -> bool:
    """Si un mes entero del visor corresponde a un año y un mes reales.

    Returns:
        True para AAAAMM, desde enero del año 1000 hasta diciembre de 9999.
    """
    return type(valor) is int and re.fullmatch(r"[1-9][0-9]{3}(?:0[1-9]|1[0-2])", str(valor)) is not None


def _cifra(valor: object) -> bool:
    """Si la cifra es finita o no publicada, sin admitir booleanos.

    Returns:
        True para números finitos y None.
    """
    if valor is None:
        return True
    if type(valor) not in (int, float):
        return False
    try:
        return isfinite(valor)
    except OverflowError:
        return False


def _columnas(fila: dict[str, Any], tabla: str) -> tuple[str, ...]:
    """Comprueba identificadores de ocupación y sexo y determina las cifras leídas.

    Returns:
        Los nombres de las columnas numéricas de la tabla.
    """
    if tabla == TABLA_TOTALES:
        return CIFRAS_TOTALES
    codigo = fila.get("c_grup_primari")
    exigir(isinstance(codigo, str) and re.fullmatch(r"[0-9]{4}", codigo) is not None, f"{tabla}: código inválido")
    exigir(isinstance(fila.get("d_grup_primari_cno11"), str), f"{tabla}: falta el nombre de la ocupación")
    if tabla == TABLA_CONTRATACION:
        return CIFRAS_CONTRATACION
    sexo = fila.get("c_sexe")
    exigir(isinstance(sexo, str) and sexo in SEXOS and SEXOS[sexo] == fila.get("d_sexe"), f"{tabla}: sexo inválido")
    return ("eo_perc_cont_ocup_sexe",)


def filas_capturadas(datos: bytes, tabla: str) -> list[dict[str, Any]]:
    """Valida la forma, las cifras y las claves de una tabla antes de conservarla.

    Returns:
        Filas de un único mes real, sin claves duplicadas.

    Raises:
        FormatoInesperado: Si faltan filas o columnas, hay cifras inválidas o se mezcla el periodo.
    """
    contenido = contenido_visor(datos, tabla)
    filas = contenido.get("items") if isinstance(contenido, dict) else None
    exigir(tabla in TABLAS and isinstance(filas, list) and bool(filas), f"{tabla}: faltan items")
    claves, meses = set(), set()
    for fila in filas:
        exigir(isinstance(fila, dict), f"{tabla}: fila que no es un objeto")
        mes = fila.get("c_mes")
        exigir(mes_valido(mes), f"{tabla}: c_mes inválido")
        meses.add(mes)
        anio, numero = divmod(mes, 100)
        exigir(
            fila.get("d_periode") == f"{tuple(MESES)[numero - 1]} de {anio}",
            f"{tabla}: d_periode no coincide con c_mes",
        )
        cifras = _columnas(fila, tabla)
        exigir(all(campo in fila and _cifra(fila[campo]) for campo in cifras), f"{tabla}: cifras ausentes o inválidas")
        exigir(
            all(fila[campo] is None or fila[campo] >= 0 for campo in cifras if "var_anual" not in campo),
            f"{tabla}: cifra negativa",
        )
        clave = (
            (None, None)
            if tabla == TABLA_TOTALES
            else (fila["c_grup_primari"], fila["c_sexe"] if tabla == TABLA_MUJERES else None)
        )
        exigir(clave not in claves, f"{tabla}: clave duplicada {clave}")
        claves.add(clave)
    exigir(len(meses) == 1, f"{tabla}: mezcla de meses")
    if tabla == TABLA_TOTALES:
        exigir(len(filas) == 1, f"{tabla}: debe traer un solo total")
    if tabla == TABLA_MUJERES:
        codigos = {codigo for codigo, _ in claves}
        exigir(
            claves == {(codigo, sexo) for codigo in codigos for sexo in SEXOS}, f"{tabla}: faltan sexos por ocupación"
        )
        exigir(
            all(fila["eo_perc_cont_ocup_sexe"] is None or fila["eo_perc_cont_ocup_sexe"] <= 1 for fila in filas),
            f"{tabla}: fracción fuera de rango",
        )
    return filas
