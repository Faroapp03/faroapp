"""Levanta al empezar un ciclo el bloqueo operativo de la referencia, con la misma verificación y acta que la orden.

Un rechazo deja la base operativa como estaba y no bloquea la referencia. Si un ciclo la encuentra bloqueada, por un
trabajo que la dejó así, no espera a una persona: hace lo mismo que `levantar_bloqueo` (recupera y verifica entera la
base operativa, deja el acta en `desbloqueos/` y apaga el bloqueo) y sigue. Si la base no verifica o la referencia
cambia mientras tanto, el ciclo no arranca y el diario dice cuál de las dos cosas lo impide.
"""

from typing import Any

from plataforma_datos.orquestacion import diario_mantenimiento as diario
from plataforma_datos.orquestacion.almacen_trabajos import AlmacenTrabajos, leer_referencia
from plataforma_datos.orquestacion.levantar_bloqueo import levantar_bloqueo

FASE = "levantar-bloqueo"
# Lo que impide levantarlo, con la causa cerrada que anota el diario.
CAUSAS_DEL_BLOQUEO = {"no-verificable": "base-no-verificable", "conflicto": "referencia-en-conflicto"}


class BloqueoMantenido(ValueError):
    """La referencia sigue bloqueada: su base no verifica entera o la referencia ha cambiado durante la verificación."""


def levantar_al_empezar(referencia: dict[str, Any], almacen: AlmacenTrabajos) -> dict[str, Any]:
    """Devuelve la referencia sin bloqueo con la que puede arrancar el ciclo.

    Returns:
        La misma referencia si no estaba bloqueada; si lo estaba, la que queda tras levantarlo, leída de nuevo.

    Raises:
        BloqueoMantenido: Si la base no verifica o la referencia ha cambiado; no se ha escrito nada en la referencia.
        AlmacenGeneracionesNoDisponible: Si la descarga de la base se corta; el ciclo siguiente lo vuelve a intentar.
    """
    if not referencia["bloqueoOperativo"]:
        return referencia
    diario.anotar(FASE, "inicio")
    resultado = levantar_bloqueo(referencia["trabajo"], almacen)
    if resultado in CAUSAS_DEL_BLOQUEO:
        diario.anotar(FASE, "error", causa=CAUSAS_DEL_BLOQUEO[resultado])
        raise BloqueoMantenido(f"Bloqueo mantenido: {CAUSAS_DEL_BLOQUEO[resultado]}")
    # «sin-bloqueo» dice que otra ejecución lo levantó mientras tanto: el resultado para este ciclo es el mismo.
    diario.anotar(FASE, "confirmado")
    return leer_referencia(almacen)
