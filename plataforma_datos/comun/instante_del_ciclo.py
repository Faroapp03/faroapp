"""El instante único de un ciclo cuando se fija desde fuera, para que todas sus piezas lean el mismo reloj.

El ensayo con datos grabados (`orquestacion.ensayo_grabado`) lo fija en FARO_INSTANTE: así dos ensayos sobre la misma
base dan las mismas huellas, porque el corte del catálogo de Cursos no depende del momento en que se compuso. El ciclo
de producción no lo fija, y cada pieza toma la hora real. Python estándar.
"""

import os
import re
from collections.abc import Mapping
from datetime import UTC, datetime

VARIABLE = "FARO_INSTANTE"
# Un instante UTC al segundo, el mismo formato que los recibos.
FORMATO = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z")


def fijado(entorno: Mapping[str, str] = os.environ) -> str | None:
    """El instante fijado para este ciclo, si lo hay.

    Args:
        entorno: Las variables del proceso.

    Returns:
        El instante, con el formato AAAA-MM-DDTHH:MM:SSZ, o None si el ciclo usa la hora real.

    Raises:
        ValueError: Si la variable existe pero no es un instante UTC válido: un reloj mal fijado no se ignora.
    """
    valor = entorno.get(VARIABLE)
    if valor is None:
        return None
    if not FORMATO.fullmatch(valor):
        raise ValueError(f"{VARIABLE} debe ser un instante UTC AAAA-MM-DDTHH:MM:SSZ")
    datetime.fromisoformat(valor.replace("Z", "+00:00")).astimezone(UTC)
    return valor


def ahora(entorno: Mapping[str, str] = os.environ) -> datetime:
    """El instante con que el ciclo anota lo que hace: el fijado, si lo hay, o la hora real.

    Con el instante fijado, el comienzo del intento, el seguimiento de las comprobaciones y el estado del panel leen
    el mismo reloj que el corte del catálogo, así que nada de lo anotado queda después del instante del panel.

    Args:
        entorno: Las variables del proceso.

    Returns:
        Un instante UTC con zona.

    Raises:
        ValueError: Si el instante fijado no es un instante UTC válido.
    """
    valor = fijado(entorno)
    return datetime.now(UTC) if valor is None else datetime.fromisoformat(valor.replace("Z", "+00:00"))
