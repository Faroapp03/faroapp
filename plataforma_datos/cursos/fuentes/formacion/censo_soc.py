"""Censo de la oferta del SOC: una caída grande frente a la copia anterior queda pendiente de una persona.

El SOC no publica un recuento propio con que contrastar su lista. Una oferta que pierde más de PERDIDA_MAXIMA de los
cursos distintos («curs») de la última copia no se admite como censo completo: se guarda junto a los originales, fuera
de la procedencia, con sus cifras, y la copia anterior sigue vigente. `confirmar_censo` la admite tras revisarla.
"""

import hashlib
import re
from typing import Any

from plataforma_datos.comun.entrada_salida import carpetas, entradas_procedencia, guardar_json, original
from plataforma_datos.comun.nucleo import Descarga, OriginalCambiado, ReglaDeCambio, exigir
from plataforma_datos.comun.red import conservar_o_sustituir
from plataforma_datos.cursos.fuentes.formacion.constantes import FUENTE, PATRON_CURSOS
from plataforma_datos.cursos.fuentes.formacion.json_soc import leer_json_latin1
from plataforma_datos.orquestacion.piezas_de_la_actualizacion import PERDIDA_MAXIMA

# Oferta descargada que no se admite como censo completo hasta que una persona la confirme, y sus cifras. Viven junto a
# los originales, fuera de la procedencia: no forman parte de la copia vigente.
OFERTA_PENDIENTE = "soc-cursos-pendiente.json"
CIFRAS_PENDIENTE = "soc-cursos-pendiente-de-confirmacion.json"


class CensoPendienteDeConfirmacion(OriginalCambiado):
    """La oferta descargada pierde demasiados cursos frente a la copia anterior para admitirla sin una persona."""


def ultima_copia_soc(registrada: dict[str, Any]) -> dict[str, Any]:
    """La entrada de procedencia de la copia de la oferta más reciente.

    Returns:
        Su entrada, con nombre y huella.
    """
    copias = [e for e in entradas_procedencia(registrada) if re.fullmatch(PATRON_CURSOS, e["archivo"])]
    exigir(bool(copias), "SOC: copia previa ausente")
    return max(copias, key=lambda e: e["archivo"])


def cursos_de_la_copia(datos: bytes) -> int:
    """Cuenta los cursos distintos de una copia conservada, con la misma identidad («curs») que la descarga.

    Returns:
        El número de cursos distintos.
    """
    return len({fila["curs"] for fila in leer_json_latin1(datos)})


def perdida_excesiva(nuevos: int, anteriores: int) -> bool:
    """Si la oferta nueva pierde más de PERDIDA_MAXIMA de los cursos de la copia anterior.

    Returns:
        True si la caída supera el criterio de pérdida de la actualización.
    """
    return nuevos < (1 - PERDIDA_MAXIMA) * anteriores


def dejar_pendiente(descarga: Descarga, cifras: dict[str, Any]) -> None:
    """Guarda la oferta y sus cifras junto a los originales, sin tocar la copia vigente ni su procedencia."""
    carpeta = carpetas(FUENTE).original
    conservar_o_sustituir(carpeta / OFERTA_PENDIENTE, descarga, ReglaDeCambio(aceptar_cambio=True))
    guardar_json(carpeta / CIFRAS_PENDIENTE, cifras)


def retirar_pendiente() -> None:
    """Retira una oferta pendiente que otra admitida después ya sustituye."""
    carpeta = carpetas(FUENTE).original
    for nombre in (CIFRAS_PENDIENTE, OFERTA_PENDIENTE):
        (carpeta / nombre).unlink(missing_ok=True)


def exigir_censo_completo(descarga: Descarga, cursos: int, registrada: dict[str, Any], instante: str) -> None:
    """Admite la oferta como censo completo salvo una caída grande frente a la copia anterior.

    El SOC no publica un recuento propio con que contrastar la lista: la única evidencia independiente es la copia
    anterior, con el mismo criterio de pérdida que la comparación de la actualización.

    Raises:
        CensoPendienteDeConfirmacion: Si la caída supera ese criterio; la oferta queda pendiente con sus cifras.
    """
    ultima = ultima_copia_soc(registrada)
    anteriores = cursos_de_la_copia(original(FUENTE, ultima["archivo"]).read_bytes())
    if not perdida_excesiva(cursos, anteriores):
        return
    cifras = {
        "archivo": OFERTA_PENDIENTE,
        "sha256": hashlib.sha256(descarga.datos).hexdigest(),
        "bytes": len(descarga.datos),
        "comprobado_remoto_utc": instante,
        "cursos": cursos,
        "copia_anterior": ultima["archivo"],
        "cursos_copia_anterior": anteriores,
        "perdida_maxima": PERDIDA_MAXIMA,
    }
    dejar_pendiente(descarga, cifras)
    raise CensoPendienteDeConfirmacion(
        f"SOC: la oferta descargada tiene {cursos} cursos y la copia {ultima['archivo']} tenía {anteriores}; pierde "
        f"más del {PERDIDA_MAXIMA * 100:.0f} %, queda pendiente de confirmación y se conserva la copia anterior"
    )
