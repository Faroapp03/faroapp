"""Reintento de una intención abandonada por `rechazo-previo` en la ejecución siguiente del mantenimiento.

Cuando esa ejecución termina sin pendientes y la última activación es una abandonada por un rechazo que demostró
que no se hizo nada, la vuelve a intentar una vez, con su propia reserva, sobre el mismo trabajo y el mismo artefacto
conservado. Nunca reintenta una cerrada a mano ni una rechazada por el alojamiento, ni un reintento. El servidor
vuelve a comprobarlo todo; aquí solo se decide si pedirlo y se recupera lo conservado.
"""

from typing import Any

from plataforma_datos.orquestacion.almacen_artefactos import AlmacenArtefactosInvalido
from plataforma_datos.orquestacion.almacen_trabajos import AlmacenTrabajos, recuperar_trabajo

SIN_ARTEFACTO = "sin-artefacto"
"""El trabajo abandonado o su artefacto ya no se conservan completos: no se reintenta."""


def reintento_previsto(actual: dict[str, Any] | None) -> bool:
    """Indica si la última activación es una abandonada que la ejecución siguiente puede reintentar.

    Returns:
        Verdadero solo para una abandonada por `rechazo-previo`, que no es ya un reintento y sabe su revisión.
    """
    return (
        actual is not None
        and actual["fase"] == "abandonada"
        and actual["abandono"]["motivo"] == "rechazo-previo"
        and "reintento" not in actual
        and "revisionTrabajos" in actual
    )


def es_reintento_de(actual: dict[str, Any] | None, referencia: dict[str, Any]) -> bool:
    """Indica si la última activación es el reintento que pidió esta misma ejecución.

    Returns:
        Verdadero si la ejecución que reintenta es la de la referencia.
    """
    return (
        actual is not None and "reintento" in actual and all(actual["reintento"][k] == v for k, v in referencia.items())
    )


def reintento_de(trabajo: dict[str, Any]) -> dict[str, Any]:
    """Nombra el trabajo abandonado exacto que se pide reintentar.

    Returns:
        Tupla y huella del recibo, que el servidor coteja con la abandonada.
    """
    return {k: trabajo[k] for k in ("solicitudId", "revisionReserva", "runId", "huellaRecibo")}


def trabajo_abandonado(trabajo: dict[str, Any], almacen: AlmacenTrabajos) -> tuple[dict[str, Any], bytes] | None:
    """Recupera el índice y el recibo conservados del trabajo abandonado, con su artefacto comprobado.

    Returns:
        Índice y recibo exactos, o None si el trabajo o su artefacto ya no se conservan completos.
    """
    try:
        return recuperar_trabajo(trabajo["solicitudId"], trabajo["revisionReserva"], trabajo["runId"], almacen)
    except AlmacenArtefactosInvalido:
        return None
