"""Piezas comunes de las fuentes de Eurostat (`mundo_eurostat` y `ue_eurostat`): descarga, filas y etiquetas.

Las dos fuentes descargan tablas JSON-stat filtradas y las preparan igual: una fila por celda con su tabla, sus
códigos, su año, su valor y su marca, y, por tabla, su fecha de actualización y la etiqueta oficial de cada código.
Lo propio de cada una (qué tablas, qué indicadores, qué controles) sigue en su lector. Python estándar.
"""

import datetime
import re
from collections.abc import Iterable
from pathlib import Path
from typing import Any

from plataforma_datos.comun.entrada_salida import comprobar_originales, guardar_json, guardar_jsonl, leer_json, original
from plataforma_datos.comun.estadisticas import celdas_jsonstat, etiquetas_jsonstat
from plataforma_datos.comun.nucleo import ArchivoDescargable, FormatoInesperado, exigir
from plataforma_datos.comun.red import descargar_originales
from plataforma_datos.mercado.fuentes.empresas.piezas.constantes_empresas import (
    LICENCIA_EUROSTAT,
    LICENCIA_EUROSTAT_TEXTO,
)


def dia_de_actualizacion(instante: object, archivo: str = "Eurostat") -> str:
    """Lee el día (AAAA-MM-DD) de un instante ISO 8601, como lo escribe la fuente (sin pasarlo a otra zona horaria).

    Returns:
        El día en ISO 8601 (AAAA-MM-DD).

    Raises:
        FormatoInesperado: Si el original no trae una fecha ISO válida.
    """
    exigir(isinstance(instante, str), f"{archivo}: fecha de actualización inválida: {instante!r}")
    try:
        return datetime.datetime.fromisoformat(instante).date().isoformat()
    except ValueError as error:
        raise FormatoInesperado(f"{archivo}: fecha de actualización inválida: {instante!r}") from error


def filas_de_la_tabla(tabla: str, contenido: dict[str, Any]) -> list[dict[str, Any]]:
    """Pasa las celdas de una tabla JSON-stat de Eurostat a filas: tabla, códigos, año, valor y marca.

    Returns:
        Una fila por celda, en el orden de la tabla.
    """
    filas: list[dict[str, Any]] = []
    for celda in celdas_jsonstat(contenido):
        if celda.valor is None and celda.estado is None:
            continue
        exigir(celda.claves.get("freq", "A") == "A", f"{tabla}: frecuencia distinta de la anual")
        codigos = {clave: codigo for clave, codigo in celda.claves.items() if clave not in ("freq", "time")}
        periodo = celda.claves.get("time")
        exigir(
            isinstance(periodo, str) and re.fullmatch(r"[0-9]{4}", periodo) is not None and periodo != "0000",
            f"{tabla}: el periodo {periodo!r} no es un año",
        )
        filas.append(
            {"tabla": tabla, **codigos, "anio": int(celda.claves["time"]), "valor": celda.valor, "marca": celda.estado}
        )
    exigir(bool(filas), f"{tabla}: tabla sin filas con cifra o marca")
    return filas


def etiquetas_de_la_tabla(contenido: dict[str, Any]) -> dict[str, str]:
    """Reúne la etiqueta oficial de cada código de cada dimensión, salvo la frecuencia, los países y los años.

    Las etiquetas de todas las dimensiones se guardan por código: un código que dos dimensiones etiquetan distinto
    no se puede guardar así sin pisar una de ellas.

    Args:
        contenido: La tabla JSON-stat de Eurostat.

    Returns:
        Código → su etiqueta, por código.

    Raises:
        FormatoInesperado: Si dos dimensiones dan etiquetas distintas al mismo código.
    """
    etiquetas: dict[str, str] = {}
    for dimension in contenido["id"]:
        if dimension not in ("geo", "time", "freq"):
            for codigo, etiqueta in etiquetas_jsonstat(contenido, dimension).items():
                previa = etiquetas.setdefault(codigo, etiqueta)
                exigir(previa == etiqueta, f"el código {codigo} tiene dos etiquetas: «{previa}» y «{etiqueta}»")
    return dict(sorted(etiquetas.items()))


def descargar_tablas(
    procedencia: Path, archivos: list[ArchivoDescargable], fuente: str, cita: str, *, aceptar_cambio: bool
) -> None:
    """Descarga las tablas filtradas de una fuente y guarda su procedencia con la cita y la licencia de Eurostat.

    Args:
        procedencia: El archivo de procedencia de la fuente, en la carpeta de sus originales, donde se descargan.
        archivos: Las tablas que se descargan.
        fuente: El nombre de la fuente en la procedencia.
        cita: Su cita.
        aceptar_cambio: Si se acepta a propósito una versión nueva de Eurostat; si no, la descarga se detiene.
    """
    guardar_json(
        procedencia,
        {
            "fuente": fuente,
            "cita": cita,
            "licencia": LICENCIA_EUROSTAT,
            "licencia_texto": LICENCIA_EUROSTAT_TEXTO,
            "archivos": descargar_originales(archivos, procedencia.parent, aceptar_cambio),
        },
    )


def preparar_tablas(fuente: str, tablas_por_archivo: Iterable[tuple[str, str]], cifras: Path, tablas: Path) -> None:
    """Pasa cada tabla a filas y guarda, por tabla, su fecha de actualización y las etiquetas de sus códigos.

    Args:
        fuente: La fuente cuyos originales se leen.
        tablas_por_archivo: Cada original con la tabla de Eurostat que contiene, en el orden en que se guardan.
        cifras: El JSONL de las filas preparadas.
        tablas: El JSON de la fecha y las etiquetas de cada tabla.
    """
    comprobar_originales(fuente)
    filas: list[dict[str, Any]] = []
    por_tabla: dict[str, dict[str, Any]] = {}
    for nombre, tabla in tablas_por_archivo:
        contenido = leer_json(original(fuente, nombre))
        filas.extend(filas_de_la_tabla(tabla, contenido))
        por_tabla[tabla] = {
            "actualizado": dia_de_actualizacion(contenido.get("updated"), nombre),
            "etiquetas": etiquetas_de_la_tabla(contenido),
        }
    guardar_jsonl(cifras, filas)
    guardar_json(tablas, por_tabla)
    print(f"{len(filas)} cifras de {len(por_tabla)} tablas")
