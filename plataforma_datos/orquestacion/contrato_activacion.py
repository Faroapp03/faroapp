"""Errores de la activación y lectura estricta de los documentos que intercambia con el servidor y el adaptador.

Un documento que no tiene exactamente la forma esperada detiene la activación con el error genérico: ningún campo
de más, de menos o repetido se interpreta.
"""

import json
import re
from typing import Any

ERROR = "Activación no confirmada; consulta el estado privado antes de continuar."
HEX64 = re.compile(r"[0-9a-f]{64}")
HEX40 = re.compile(r"[0-9a-f]{40}")
ID_VERSION = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")


class ErrorActivacion(ValueError):
    """La evidencia o el permiso no permiten continuar la activación."""


class RechazoPrevioActivacion(ErrorActivacion):
    """Evidencia local concluyente, nunca una ausencia o una transferencia fallida."""

    codigo = "candidato_no_verificable"


class RechazoSinEfecto(ErrorActivacion):
    """El adaptador demuestra que una subida o un despliegue no llegó a hacerse.

    `rechazo-previo`: el adaptador rechazó antes de lanzar la orden que cambia Cloudflare. `rechazo-proveedor`:
    Cloudflare rechazó esa orden de forma explícita. Cualquier otra falta de respuesta sigue siendo incierta.
    """

    def __init__(self, motivo: str) -> None:
        super().__init__(f"Activación detenida sin efecto en Cloudflare ({motivo}); revisa el estado privado.")
        self.motivo = motivo


class CandidatoNoVerificable(RechazoPrevioActivacion):
    """El candidato conservado contradice las expectativas inmutables de la instantánea autorizada."""


class ServidoDistinto(RechazoPrevioActivacion):
    """Un reintento encontró la web cambiada desde el abandono: prepararlo desharía lo publicado entre medias."""

    codigo = "servido_distinto"


class ConfiguracionNoAdmitida(RechazoPrevioActivacion):
    """El adaptador rechazó la configuración durante una operación exclusivamente de lectura."""

    codigo = "despliegue_no_admitido"


def exigir(condicion: bool) -> None:
    """Detiene la activación si la condición no se cumple.

    Raises:
        ErrorActivacion: Si la condición es falsa.
    """
    if not condicion:
        raise ErrorActivacion(ERROR)


def objeto(valor: object, campos: str) -> dict[str, Any]:
    """Exige un objeto con exactamente los campos indicados, separados por comas.

    Returns:
        El mismo objeto, ya comprobado.
    """
    exigir(type(valor) is dict and set(valor) == set(campos.split(",")))
    return valor


def texto(valor: object, patron: re.Pattern[str]) -> None:
    """Exige una cadena que cumpla el patrón entero."""
    exigir(isinstance(valor, str) and patron.fullmatch(valor) is not None)


def _pares(pares: list[tuple[str, Any]]) -> dict[str, Any]:
    resultado = {}
    for clave, valor in pares:
        exigir(clave not in resultado)
        resultado[clave] = valor
    return resultado


def json_estricto(contenido: bytes | str) -> dict[str, Any]:
    """Lee un objeto JSON sin claves repetidas ni constantes fuera del estándar (NaN o Infinity).

    Returns:
        El objeto leído.

    Raises:
        ErrorActivacion: Si el documento lleva una constante fuera del estándar.
    """

    def constante(_valor: str) -> None:
        raise ErrorActivacion(ERROR)

    documento = json.loads(contenido, object_pairs_hook=_pares, parse_constant=constante)
    exigir(type(documento) is dict)
    return documento
