"""Descarga de originales con las guardas comunes y un contrato estrecho por fuente.

Sobre `red.descargar_url` (identidad genérica, turno y pausa por dominio, plazo y tope de bytes), cada fuente declara
el tipo de contenido que acepta, el tamaño máximo de cada archivo y el control de su cuerpo. Una respuesta que no es un
200, que acaba en otro origen tras una redirección o que no trae el tipo declarado se rechaza antes de leer el cuerpo:
el original anterior y su procedencia quedan como estaban.
"""

from collections.abc import Callable, Mapping
from pathlib import Path
from typing import Any, NamedTuple
from urllib.parse import urlsplit

from plataforma_datos.comun.nucleo import (
    ARCHIVO_DE_PROCEDENCIA,
    ArchivoDescargable,
    EntradaDeDescarga,
    ReglaDeCambio,
    exigir,
)
from plataforma_datos.comun.observacion_remota import observar_original
from plataforma_datos.comun.red import conservar_o_sustituir, descargar_url, registro_descarga, registros_previos

ESTADO_CORRECTO = 200


class Contrato(NamedTuple):
    """Lo que una fuente acepta de cada respuesta: tipos de contenido, tamaño máximo y control del cuerpo."""

    tipos: tuple[str, ...]
    maximo_bytes: int
    cuerpo: Callable[[bytes], None]


def _origen(url: str) -> tuple[str, str]:
    partes = urlsplit(url)
    return partes.scheme, (partes.hostname or "").lower()


def control_de_cabeceras(url: str, contrato: Contrato) -> Callable[[int, str, Mapping[str, str]], None]:
    """El control de estado, destino y tipo de contenido de una respuesta, antes de leer su cuerpo.

    Returns:
        La función que `descargar_url` llama con el estado, la dirección final y las cabeceras.
    """

    def comprobar(estado: int, final: str, cabeceras: Mapping[str, str]) -> None:
        exigir(estado == ESTADO_CORRECTO, f"{url}: respuesta {estado}, se esperaba {ESTADO_CORRECTO}")
        exigir(_origen(final) == _origen(url), f"{url}: la respuesta llega de otro origen ({final})")
        tipo = (cabeceras.get("Content-Type") or "").split(";")[0].strip().lower()
        exigir(tipo in contrato.tipos, f"{url}: tipo de contenido «{tipo}», se esperaba {contrato.tipos}")

    return comprobar


def _con_fecha_de_captura(previo: dict[str, Any] | None) -> dict[str, Any] | None:
    """La entrada anterior con su fecha de captura en `descargado_utc`, también la de una captura hecha a mano.

    Las capturas a mano anotan el día en `descargado`; si la descarga trae los mismos bytes, esa sigue siendo la fecha
    real de la captura.

    Returns:
        La entrada, o None si no había.
    """
    if previo is None or "descargado_utc" in previo:
        return previo
    return {**previo, "descargado_utc": previo["descargado"]}


def descargar_acotados(
    archivos: list[ArchivoDescargable], carpeta: Path, aceptar_cambio: bool, contrato: Contrato
) -> list[EntradaDeDescarga]:
    """Descarga cada original con el contrato de la fuente y devuelve sus entradas de procedencia.

    Un original que ya no coincide con su procedencia solo se sustituye con `aceptar_cambio`, como en
    `red.descargar_originales`. El cuerpo se controla antes de escribirlo: un cuerpo mal formado no pisa el anterior.

    Returns:
        Las entradas de procedencia, una por archivo y en el orden de `archivos`.

    Raises:
        FormatoInesperado: Si una respuesta no cumple el contrato.
    """
    previos = registros_previos(carpeta / ARCHIVO_DE_PROCEDENCIA)
    registros = []
    for archivo in archivos:
        previo = _con_fecha_de_captura(previos.get(archivo["archivo"]))
        descarga = descargar_url(
            archivo["url"],
            maximo_bytes=contrato.maximo_bytes,
            comprobar_cabeceras=control_de_cabeceras(archivo["url"], contrato),
            comprobar=lambda datos, _cabeceras: contrato.cuerpo(datos),
        )
        exigir(bool(descarga.datos), f"{archivo['url']}: respuesta vacía")
        regla = ReglaDeCambio(None, previo["sha256"] if previo else None, aceptar_cambio)
        datos = conservar_o_sustituir(carpeta / archivo["archivo"], descarga, regla)
        observar_original(archivo["url"], descarga, datos)
        registros.append(registro_descarga(archivo, descarga, datos, previo))
    return registros
