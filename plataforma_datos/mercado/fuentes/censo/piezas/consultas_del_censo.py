"""Captura y conservación de consultas perturbadas del Censo 2021 del INE, con la petición de cada fuente."""

import tempfile
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from plataforma_datos.comun.entrada_salida import comprobar_originales, guardar_json
from plataforma_datos.comun.estadisticas import LICENCIA_INE
from plataforma_datos.comun.nucleo import ArchivoFaltante, Descarga, exigir
from plataforma_datos.comun.red import registro_descarga, registros_previos
from plataforma_datos.mercado.fuentes.censo.piezas.constantes_censo import NOTA_PERTURBACION


@dataclass(frozen=True)
class CopiasDelCenso:
    """Identidad de una fuente y rutas de sus copias perturbadas y de su registro."""

    fuente: str
    original: Path
    procedencia: Path


def comprobar_copias_registradas(fuente: str, procedencia: Path) -> None:
    """Comprueba la copia registrada sin consultar otra perturbación.

    Args:
        fuente: Nombre de la fuente.
        procedencia: Registro de sus copias.

    Raises:
        ArchivoFaltante: Si no hay copia registrada.
    """
    if not procedencia.exists():
        raise ArchivoFaltante(f"{fuente}: no hay copias registradas; {NOTA_PERTURBACION} Usa --aceptar-cambio.")
    for ruta in comprobar_originales(fuente):
        print(f"✓ {ruta.name} coincide con su huella registrada")
    print(f"{fuente}: {NOTA_PERTURBACION} Para hacer una copia nueva, --aceptar-cambio.")


def _consultas_con_nombres_unicos(consultas: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    """Comprueba nombres simples y únicos antes de capturar; consume el iterable una sola vez.

    Returns:
        Las mismas consultas, en su orden y sin transformar sus nombres.
    """
    pendientes = list(consultas)
    nombres: set[str] = set()
    for consulta in pendientes:
        nombre = consulta["archivo"]
        exigir(
            isinstance(nombre, str) and nombre not in ("", ".", "..") and Path(nombre).name == nombre,
            f"consulta del Censo: nombre de archivo no simple: {nombre!r}",
        )
        exigir(nombre not in nombres, f"consulta del Censo: archivo repetido: {nombre!r}")
        nombres.add(nombre)
    return pendientes


def registrar_consultas(
    consultas: Iterable[dict[str, Any]],
    original: Path,
    procedencia: Path,
    consultar: Callable[[dict[str, Any]], Descarga],
) -> list[dict[str, Any]]:
    """Guarda cada respuesta en orden con su registro POST; la fuente aporta su política de petición y rechazo.

    Los nombres de archivo deben ser simples y únicos: se comprueban todos antes de capturar.
    Las respuestas se escriben primero en una carpeta temporal junto a `original` y solo sustituyen las copias
    registradas cuando han respondido todas: si una consulta falla, las copias anteriores siguen enteras y cuadran con
    su procedencia.

    Args:
        consultas: Consultas en orden, cada una con su «archivo» y su «cuerpo».
        original: Carpeta de las copias perturbadas.
        procedencia: Registro de las copias, para conservar la fecha de las que no cambian.
        consultar: Petición de la fuente; lanza su error si la respuesta no se acepta.

    Returns:
        El registro de cada respuesta, en el orden de las consultas.
    """
    consultas = _consultas_con_nombres_unicos(consultas)
    previos = registros_previos(procedencia)
    registros: list[dict[str, Any]] = []
    with tempfile.TemporaryDirectory(dir=original.parent, prefix=f".{original.name}-") as temporal:
        nuevas = []
        for consulta in consultas:
            descarga = consultar(consulta)
            (Path(temporal) / consulta["archivo"]).write_bytes(descarga.datos)
            nuevas.append(consulta["archivo"])
            archivo = dict(consulta, licencia=LICENCIA_INE)
            registro = registro_descarga(archivo, descarga, descarga.datos, previos.get(consulta["archivo"]))
            registros.append(dict(registro, metodo="POST", cuerpo=consulta["cuerpo"]))
            print(consulta["archivo"], len(descarga.datos), "bytes")
        for nombre in nuevas:
            (Path(temporal) / nombre).replace(original / nombre)
    return registros


def descargar_consultas(
    copias: CopiasDelCenso,
    consultas: Iterable[dict[str, Any]],
    consultar: Callable[[dict[str, Any]], Descarga],
    metadatos: dict[str, Any],
    aceptar_cambio: bool = False,
) -> None:
    """Conserva las copias o captura otra perturbación y escribe su procedencia, manteniendo el orden de sus campos.

    Args:
        copias: Fuente y rutas de sus copias y su registro.
        consultas: Consultas en orden.
        consultar: Petición de la fuente.
        metadatos: Campos de la procedencia que preceden a la lista de archivos.
        aceptar_cambio: Si se captura otra perturbación en lugar de conservar la registrada.
    """
    if not aceptar_cambio:
        comprobar_copias_registradas(copias.fuente, copias.procedencia)
        return
    copias.original.mkdir(parents=True, exist_ok=True)
    registros = registrar_consultas(consultas, copias.original, copias.procedencia, consultar)
    guardar_json(copias.procedencia, {**metadatos, "archivos": registros})
