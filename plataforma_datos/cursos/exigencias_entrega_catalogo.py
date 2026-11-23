"""Exigencias comunes a todas las piezas de la entrega pública del catálogo.

Las comparten el contrato de la entrega y el de la clasificación: el error, la forma cerrada, los textos y las URL
se comprueban igual en cualquier bloque de una oferta.
"""

from plataforma_datos.cursos import catalogo
from plataforma_datos.cursos.tipos_json import ValorJson

MAX_TEXTO = 2_048
PRIMER_IMPRIMIBLE = 32
# Espacios que ninguna URL pública puede llevar: los que reconoce Python (`str.isspace`) más los que reconoce el
# lector web (`\s` de JavaScript). Solo la marca de orden de bytes es espacio en JavaScript y no en Python.
ESPACIO_SOLO_EN_JAVASCRIPT = "\ufeff"


class ErrorEntregaCatalogo(ValueError):
    """Entrada, admisión o proyección incompatible; no se publica parcialmente."""


def exigir(condicion: object, motivo: str) -> None:
    """Rechaza un incumplimiento sin sustituir los hechos.

    Raises:
        ErrorEntregaCatalogo: Si la condición no se cumple.
    """
    if not condicion:
        raise ErrorEntregaCatalogo(motivo)


def exigir_campos(valor: ValorJson, campos: tuple[str, ...], lugar: str) -> None:
    """Exige un objeto con exactamente esos campos: la entrega es cerrada y no admite campos de más."""
    exigir(isinstance(valor, dict) and set(valor) == set(campos), lugar + ": campos no admitidos")


def exigir_texto(valor: ValorJson) -> None:
    """Exige un texto no vacío, acotado y sin caracteres de control, como el lector web."""
    exigir(isinstance(valor, str) and 0 < len(valor) <= MAX_TEXTO, "Texto vacío o demasiado largo")
    exigir(not any(ord(c) < PRIMER_IMPRIMIBLE for c in valor), "Texto con caracteres de control")


def exigir_url(valor: ValorJson, lugar: str) -> None:
    """Exige a toda URL pública lo mismo que el lector web: texto acotado, sin espacios y pública http(s)."""
    exigir_texto(valor)
    exigir(ESPACIO_SOLO_EN_JAVASCRIPT not in valor, lugar + ": URL con espacios")
    catalogo.exigir_url_publica(valor, lugar)
