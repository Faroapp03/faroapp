"""Cierra sin publicar una intención de activación cuyos Workers vuelven a servir lo que servían antes.

Solo con evidencia observada en ese momento: cada Worker de la intención sirve una única versión al 100 % y es la de
`anterior`. Una versión subida y nunca desplegada no lo impide. Si algún Worker sirve otra cosa, la intención no cambia.
"""

from typing import Any, Protocol

from plataforma_datos.orquestacion.adaptador_versiones import AdaptadorVersiones, desplegado
from plataforma_datos.orquestacion.lectura_activacion import PRINCIPAL, dos_servicios, servicios, sirve_lo_anterior


class Transiciones(Protocol):
    """Lo que el abandono necesita del consumidor: el estado vigente y las transiciones con revisión."""

    @property
    def actual(self) -> dict[str, Any]:
        """Activación vigente, ya comprobada."""

    def transicion(self, operacion: str, paso: dict[str, Any] | None = None) -> str:
        """Aplica una transición con revisión esperada."""


def observado(adaptador: AdaptadorVersiones, actual: dict[str, Any]) -> dict[str, Any]:
    """Lo que sirve ahora cada Worker de la intención, con la forma de su evidencia.

    Returns:
        Versión y despliegue del principal y, en dos servicios, también de Cursos.
    """
    vistos = {servicio.nombre: desplegado(adaptador, servicio) for servicio in servicios(actual)}
    return vistos if dos_servicios(actual) else vistos[PRINCIPAL.nombre]


def abandonar_si_sirve_lo_anterior(
    consumidor: Transiciones, motivo: str, visto: dict[str, Any]
) -> dict[str, Any] | None:
    """Abandona con el motivo indicado si cada Worker sirve, según lo observado, su versión anterior.

    Returns:
        None si la intención quedó abandonada; si lo servido no es lo anterior, lo observado, sin cambiar nada.
    """
    actual = consumidor.actual
    if actual["evidencia"] is not None and not sirve_lo_anterior(
        actual["evidencia"]["anterior"], visto, dos_servicios(actual)
    ):
        return visto
    consumidor.transicion("paso", {"tipo": "abandonar", "motivo": motivo, "observado": visto})
    return None
