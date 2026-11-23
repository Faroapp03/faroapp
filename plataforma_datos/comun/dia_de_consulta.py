"""El día de una consulta en la hora de Cataluña, a partir del instante de la captura, para citarlo.

Las procedencias guardan el instante de cada descarga en UTC (`descargado_utc`). La cita dice el día civil en
Cataluña, con su cambio de hora de verano: una captura del 15/11 a las 00:40 en Barcelona es del 15/11, aunque en UTC
aún fuera el 14. Las capturas hechas a mano anotan solo el día (AAAA-MM-DD): es un día civil ya escrito y se toma tal
cual. Se escribe como el resto de citas del sitio (DD/MM/AAAA). Python estándar.
"""

import re
from datetime import date, datetime
from zoneinfo import ZoneInfo

from plataforma_datos.comun.nucleo import FormatoInesperado, exigir

ZONA_DE_CATALUNA = ZoneInfo("Europe/Madrid")
DIA_ANOTADO = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}")


def dia_en_cataluna(instante: str) -> date:
    """El día civil en Cataluña de un instante ISO 8601 con zona horaria, o el día ya anotado (AAAA-MM-DD) tal cual.

    Returns:
        El día.

    Raises:
        FormatoInesperado: Si el instante no es ISO 8601 o no lleva zona horaria, o si el día anotado no existe.
    """
    if isinstance(instante, str) and DIA_ANOTADO.fullmatch(instante):
        try:
            return date.fromisoformat(instante)
        except ValueError as error:
            raise FormatoInesperado(f"día de consulta inválido: {instante!r}") from error
    try:
        momento = datetime.fromisoformat(instante)
    except (TypeError, ValueError) as error:
        raise FormatoInesperado(f"instante de consulta inválido: {instante!r}") from error
    exigir(momento.utcoffset() is not None, f"instante de consulta sin zona horaria: {instante!r}")
    return momento.astimezone(ZONA_DE_CATALUNA).date()


def dia_de_consulta(instante: str) -> str:
    """El día de la consulta en Cataluña, escrito como en las citas (DD/MM/AAAA).

    Returns:
        El día escrito.
    """
    return dia_en_cataluna(instante).strftime("%d/%m/%Y")


def dia_iso_en_cataluna(instante: str) -> str:
    """El día civil en Cataluña de un instante, en ISO 8601 (AAAA-MM-DD), para los campos de fecha de los conjuntos.

    Returns:
        El día en ISO.
    """
    return dia_en_cataluna(instante).isoformat()
