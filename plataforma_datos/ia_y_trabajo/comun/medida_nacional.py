"""Piezas comunes de las medidas nacionales de uso de la IA que van cada una en su propio módulo de actualización.

Un país con estadística oficial propia de uso de la IA por las empresas o por las personas, fuera de la encuesta
europea, puede ser una fuente aparte (`ia-nacional-<iso3>`): si su descarga o su validación fallan, los demás países y
módulos siguen con lo suyo. Su conjunto validado tiene la forma del de `ia_y_trabajo/fuentes/ia_nacional/lector.py`
(`{consultado, paises: {iso3: cifra}}`) y su indicador, la del contrato: «medido», `comparable: false`, cobertura
«mundo» y la definición, la fuente y la licencia de ese país. El id dice de quién es la medida:
`empresas-ia-nacional-<iso3>` o, para las personas, `personas-ia-nacional-<iso3>`. Aquí viven la descarga con su
procedencia y los controles comunes de la validación. Python estándar.
"""

import re
from collections.abc import Callable
from datetime import datetime
from typing import Any

from plataforma_datos.comun.entrada_salida import ahora_utc, carpetas, controles_de_huella, guardar_json, leer_json
from plataforma_datos.comun.nucleo import (
    ARCHIVO_DE_PROCEDENCIA,
    ArchivoDescargable,
    Controles,
    FormatoInesperado,
    exigir,
)
from plataforma_datos.comun.red import descargar_originales
from plataforma_datos.orquestacion.admision import cerrar_validacion

PREFIJO_DEL_INDICADOR = "empresas-ia-nacional-"
PREFIJO_DE_PERSONAS = "personas-ia-nacional-"
LENGUAS = ("es", "ca")
# El mayor porcentaje posible: toda cifra de un indicador en porcentaje queda entre 0 y este valor, sin tocarlos.
PORCENTAJE_MAXIMO = 100
# La frase con que cada definición nacional dice que no se compara: la misma que llevan las de
# `ia_y_trabajo/fuentes/ia_nacional/lector.py`.
NO_SE_COMPARA = {"es": "no se compara con Europa ni con otros países", "ca": "no es compara amb Europa ni amb altres"}


def indicador_nacional(iso3: str, prefijo: str = PREFIJO_DEL_INDICADOR, **campos: object) -> dict[str, object]:
    """Un indicador nacional del contrato: su id por país, porcentaje, medido, no comparable y de cobertura «mundo».

    Returns:
        El indicador, con su id, su nombre y sus campos de medida.
    """
    return {
        "id": f"{prefijo}{iso3.lower()}",
        "nombre": campos["nombre"],
        "definicion": campos["definicion"],
        "unidad": "porcentaje",
        "naturaleza": "medido",
        "fuente": campos["fuente"],
        "tabla": campos["tabla"],
        "licencia": campos["licencia"],
        "url": campos["url"],
        "comparable": False,
        "cobertura": "mundo",
    }


def descargar_medida(
    fuente: str, cabecera: dict[str, str], archivos: list[ArchivoDescargable], aceptar_cambio: bool
) -> None:
    """Descarga los originales de una medida y escribe su procedencia: fuente, cita, licencia y cada archivo."""
    original = carpetas(fuente).original
    entradas = descargar_originales(archivos, original, aceptar_cambio)
    guardar_json(original / ARCHIVO_DE_PROCEDENCIA, {**cabecera, "archivos": entradas})


def controles_del_indicador(
    controles: Controles, iso3: str, indicador: dict[str, Any], licencia: str, frases: dict[str, tuple[str, ...]]
) -> None:
    """Que el indicador sea el de su país, medido y no comparable, con la licencia registrada y su definición entera.

    `frases` son, por lengua, lo que la definición tiene que decir (p. ej., que la cifra es un mínimo).
    """
    ids = {f"{prefijo}{iso3.lower()}" for prefijo in (PREFIJO_DEL_INDICADOR, PREFIJO_DE_PERSONAS)}
    controles.comprobar(indicador["id"] in ids, f"{iso3}: id del indicador")
    controles.comprobar(
        (indicador["naturaleza"], indicador["comparable"], indicador["cobertura"]) == ("medido", False, "mundo"),
        f"{iso3}: medido, no comparable y de cobertura «mundo»",
    )
    controles.comprobar(indicador["licencia"] == licencia, f"{iso3}: la licencia del indicador es la de la procedencia")
    for lengua in LENGUAS:
        definicion = indicador["definicion"][lengua]
        faltan = [frase for frase in (*frases[lengua], NO_SE_COMPARA[lengua]) if frase not in definicion]
        detalle = f"; falta {faltan}" if faltan else ""
        controles.comprobar(not faltan, f"{iso3}: la definición ({lengua}) dice lo que debe{detalle}")


def dia_de_consulta(fecha: object, campo: str) -> str:
    """Día civil de una marca UTC completa, sin truncar fechas u horas inválidas.

    Returns:
        El día de la marca válida, sin cambiar su zona ni su contenido.

    Raises:
        FormatoInesperado: Si la marca no es una fecha y hora UTC completas o no existe en el calendario.
    """
    patron = r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,6})?(?:Z|\+00:00)"
    exigir(isinstance(fecha, str) and re.fullmatch(patron, fecha) is not None, f"{campo}: se espera fecha y hora UTC")
    try:
        return datetime.fromisoformat(fecha).date().isoformat()
    except ValueError as error:
        raise FormatoInesperado(f"{campo}: fecha u hora imposible {fecha!r}") from error


def validar_medida(
    fuente: str,
    iso3: str,
    anios: range,
    propios: Callable[[Controles, dict[str, Any], dict[str, Any]], None],
    limites: str,
) -> None:
    """Valida una medida nacional: huella, licencia, cifra entre 0 y 100, año y los controles propios del país.

    `propios(controles, cifra, procedencia)` añade los de la fuente (texto literal, definición, período…).
    """
    original, preparado = carpetas(fuente).original, carpetas(fuente).preparado
    cifras, procedencia = leer_json(preparado / "cifras.json"), leer_json(original / ARCHIVO_DE_PROCEDENCIA)
    ruta_cifras, ruta_procedencia = preparado / "cifras.json", original / ARCHIVO_DE_PROCEDENCIA
    exigir(
        isinstance(cifras, dict) and isinstance(cifras.get("paises"), dict),
        f"{ruta_cifras}: paises debe ser un objeto JSON",
    )
    exigir(isinstance(cifras["paises"].get(iso3, {}), dict), f"{ruta_cifras}: paises.{iso3} debe ser un objeto JSON")
    exigir(isinstance(procedencia, dict), f"{ruta_procedencia}: se espera un objeto JSON")
    exigir(isinstance(procedencia.get("licencia"), str), f"{ruta_procedencia}: licencia debe ser texto")
    archivos = procedencia.get("archivos")
    exigir(isinstance(archivos, list) and bool(archivos), f"{ruta_procedencia}: archivos debe ser una lista no vacía")
    dias = []
    for posicion, archivo in enumerate(archivos):
        campo = f"{ruta_procedencia}: archivos[{posicion}]"
        exigir(isinstance(archivo, dict), f"{campo} debe ser un objeto JSON")
        for clave in ("archivo", "sha256", "licencia"):
            exigir(isinstance(archivo.get(clave), str), f"{campo}.{clave} debe ser texto")
        dias.append(dia_de_consulta(archivo.get("descargado_utc"), f"{campo}.descargado_utc"))
    controles = Controles()
    controles_de_huella(controles, original, procedencia)
    controles.comprobar(
        all(archivo["licencia"] == procedencia["licencia"] for archivo in procedencia["archivos"]),
        f"{iso3}: cada original lleva la licencia de la fuente",
    )
    controles.comprobar(sorted(cifras["paises"]) == [iso3], f"{iso3}: una sola cifra, la del país")
    cifra = cifras["paises"].get(iso3, {})
    valor, anio = cifra.get("valor"), cifra.get("anio")
    controles.comprobar(
        isinstance(valor, float | int) and not isinstance(valor, bool) and 0 < valor < PORCENTAJE_MAXIMO,
        f"{iso3}: {valor} % entre 0 y 100",
    )
    controles.comprobar(
        isinstance(anio, int) and anio in anios, f"{iso3}: año {anio} en {anios.start}–{anios.stop - 1}"
    )
    propios(controles, cifra, procedencia)
    conjunto = {"consultado": dias[0], "paises": cifras["paises"]}
    informe = {
        "estado": controles.estado,
        "comprobado_utc": ahora_utc(),
        "cobertura": {"paises": [iso3]},
        "limites": limites,
        "controles": controles.lista,
    }
    cerrar_validacion(fuente, informe, controles, lambda: conjunto)
