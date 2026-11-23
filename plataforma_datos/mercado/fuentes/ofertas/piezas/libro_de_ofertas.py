"""Lectura de un Excel mensual de ofertas del Observatori del Treball y elección de los libros por su fecha.

Cada libro se llama `Ofertes_AAAAMM.xlsx` y trae el acumulado de enero a ese mes. Se leen tres hojas: «2 OCUPACIONS_ANY»
(las 50 ocupaciones CCO-2011 de cuatro cifras más ofertadas), «2 GRUPS_OCUPACIÓ» (subgrupos de dos cifras y grandes
grupos, columna G) y «2 CARACTERÍSTIQUES» (total y grandes grupos), que tienen que cuadrar entre sí.
"""

import re
from pathlib import Path
from typing import Any

from plataforma_datos.comun.hojas import filas_xlsx_por_nombre
from plataforma_datos.comun.nucleo import exigir

PATRON_DEL_LIBRO = re.compile(r"Ofertes_(\d{4})(\d{2})\.xlsx")
MESES = (
    "enero",
    "febrero",
    "marzo",
    "abril",
    "mayo",
    "junio",
    "julio",
    "agosto",
    "septiembre",
    "octubre",
    "noviembre",
    "diciembre",
)
MESES_CATALAN = (
    "gener",
    "febrer",
    "març",
    "abril",
    "maig",
    "juny",
    "juliol",
    "agost",
    "setembre",
    "octubre",
    "novembre",
    "desembre",
)
HOJA_OCUPACIONES = "2 OCUPACIONS_ANY"
HOJA_GRUPOS = "2 GRUPS_OCUPACIÓ"
HOJA_CARACTERISTICAS = "2 CARACTERÍSTIQUES"
INICIO_GRANDES_GRUPOS = "GRAN GRUP D'OCUPACIÓ (CCO-2011)"
OCUPACIONES_PUBLICADAS = 50
GRANDES_GRUPOS_CNO = 10


def nombre_del_libro(anio: int, mes: int) -> str:
    """El nombre del libro de un mes (mes de 1 a 12).

    Returns:
        «Ofertes_AAAAMM.xlsx».
    """
    return f"Ofertes_{anio}{mes:02d}.xlsx"


def fecha_del_libro(nombre: str) -> tuple[int, int] | None:
    """El año y el mes (1 a 12) de un libro por su nombre, o None si no es un libro de ofertas.

    Returns:
        (año, mes) o None.
    """
    coincide = PATRON_DEL_LIBRO.fullmatch(nombre)
    if coincide is None or not 1 <= int(coincide[2]) <= len(MESES):
        return None
    return int(coincide[1]), int(coincide[2])


def elegir_libros(nombres: list[str]) -> tuple[str, str]:
    """El libro del mes más reciente y el del mismo mes del año anterior, elegidos por su fecha.

    Returns:
        (libro vigente, libro del año anterior).

    Raises:
        FormatoInesperado: Si no hay ningún libro o falta el del mismo mes del año anterior.
    """
    fechas = {fecha: nombre for nombre in nombres if (fecha := fecha_del_libro(nombre)) is not None}
    exigir(bool(fechas), "Ofertas: no hay ningún libro mensual")
    anio, mes = max(fechas)
    anterior = fechas.get((anio - 1, mes))
    exigir(
        anterior is not None,
        f"Ofertas: falta el libro de {MESES[mes - 1]} de {anio - 1} para comparar con {MESES[mes - 1]} de {anio}",
    )
    return fechas[(anio, mes)], anterior


def _entero(valor: str | None, donde: str) -> int:
    texto = (valor or "").strip()
    exigir(re.fullmatch(r"\d+(\.0+)?", texto) is not None, f"Ofertas: cifra inesperada {valor!r} en {donde}")
    return int(float(texto))


def _mes_de_la_hoja(ocupaciones: list[dict[str, str]], nombre: str) -> tuple[int, int]:
    meses = [
        coincide
        for fila in ocupaciones
        if (coincide := re.fullmatch(rf"({'|'.join(MESES_CATALAN)}) de (\d{{4}})", (fila.get("A") or "").strip()))
    ]
    exigir(len(meses) == 1, f"{nombre}: no se encuentra el mes de la hoja {HOJA_OCUPACIONES}")
    return MESES_CATALAN.index(meses[0][1]), int(meses[0][2])


def _ocupaciones(ocupaciones: list[dict[str, str]], nombre: str) -> dict[str, list[int]]:
    cno4: dict[str, list[int]] = {}
    for fila in ocupaciones:
        codigo = (fila.get("A") or "").strip()
        if re.fullmatch(r"\d{4}", codigo):
            exigir(codigo not in cno4, f"{nombre}: ocupación repetida {codigo}")
            cno4[codigo] = [_entero(fila.get("C"), f"{HOJA_OCUPACIONES} {codigo}"), len(cno4) + 1]
    exigir(len(cno4) == OCUPACIONES_PUBLICADAS, f"{nombre}: se esperaban {OCUPACIONES_PUBLICADAS} ocupaciones")
    return cno4


def _grupos(filas: list[dict[str, str]], nombre: str) -> tuple[int, dict[str, int], dict[str, int], dict[str, str]]:
    cno2: dict[str, int] = {}
    cno1: dict[str, int] = {}
    nombres_cno1: dict[str, str] = {}
    total = None
    for fila in filas:
        etiqueta = (fila.get("A") or "").strip()
        if etiqueta == "Total":
            total = _entero(fila.get("G"), f"{HOJA_GRUPOS} Total")
        elif coincide := re.fullmatch(r"(\d\d) .+", etiqueta):
            cno2[coincide[1]] = _entero(fila.get("G"), f"{HOJA_GRUPOS} {etiqueta}")
        elif coincide := re.fullmatch(r"(\d) (.+)", etiqueta):
            cno1[coincide[1]] = _entero(fila.get("G"), f"{HOJA_GRUPOS} {etiqueta}")
            nombres_cno1[coincide[2].strip()] = coincide[1]
    exigir(
        total is not None and len(cno1) == GRANDES_GRUPOS_CNO,
        f"{nombre}: faltan el total o grandes grupos en {HOJA_GRUPOS}",
    )
    return total, cno2, cno1, nombres_cno1


def _cuadra_con_caracteristicas(
    caracteristicas: list[dict[str, str]], total: int, cno1: dict[str, int], nombres_cno1: dict[str, str], nombre: str
) -> None:
    """Los grandes grupos y el total de «2 CARACTERÍSTIQUES» deben ser los mismos que los de «2 GRUPS_OCUPACIÓ»."""
    etiquetas = [(fila.get("A") or "").strip() for fila in caracteristicas]
    exigir(INICIO_GRANDES_GRUPOS in etiquetas, f"{nombre}: falta el bloque de grandes grupos")
    inicio = etiquetas.index(INICIO_GRANDES_GRUPOS) + 1
    bloque = {
        etiquetas[i]: _entero(caracteristicas[i].get("G"), f"{HOJA_CARACTERISTICAS} {etiquetas[i]}")
        for i in range(inicio, inicio + GRANDES_GRUPOS_CNO)
    }
    exigir(
        {nombres_cno1.get(grupo): valor for grupo, valor in bloque.items()} == cno1,
        f"{nombre}: los grandes grupos de {HOJA_CARACTERISTICAS} y {HOJA_GRUPOS} no coinciden",
    )
    totales = [
        _entero(fila.get("G"), "Total")
        for fila, etiqueta in zip(caracteristicas, etiquetas, strict=True)
        if etiqueta == "Total"
    ]
    exigir(totales == [total], f"{nombre}: el total de {HOJA_CARACTERISTICAS} y {HOJA_GRUPOS} no coincide")


def ofertas_de_un_libro(ruta: Path) -> dict[str, Any]:
    """Lee de un Excel de ofertas el periodo, el total y los puestos por ocupación, subgrupo y gran grupo (acumulado).

    Returns:
        «periodo», «anio», «mes» (1 a 12), «total», «cno4» (código → [puestos, puesto en la lista]), «cno2» y «cno1»
        (código → puestos).

    Raises:
        FormatoInesperado: Si faltan hojas, filas o las cifras de dos hojas no coinciden.
    """
    hojas = filas_xlsx_por_nombre(ruta, (HOJA_OCUPACIONES, HOJA_GRUPOS, HOJA_CARACTERISTICAS))
    indice, anio = _mes_de_la_hoja(hojas[HOJA_OCUPACIONES], ruta.name)
    mes = indice + 1
    exigir(fecha_del_libro(ruta.name) in (None, (anio, mes)), f"{ruta.name}: el libro dice {mes}/{anio}")
    total, cno2, cno1, nombres_cno1 = _grupos(hojas[HOJA_GRUPOS], ruta.name)
    _cuadra_con_caracteristicas(hojas[HOJA_CARACTERISTICAS], total, cno1, nombres_cno1, ruta.name)
    return {
        "periodo": f"enero-{MESES[indice]} de {anio}" if indice else f"enero de {anio}",
        "anio": anio,
        "mes": mes,
        "total": total,
        "cno4": _ocupaciones(hojas[HOJA_OCUPACIONES], ruta.name),
        "cno2": cno2,
        "cno1": cno1,
    }
