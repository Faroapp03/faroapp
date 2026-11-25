"""La generación que el ciclo conservaría, exportada como lo hace el supervisor pero a una carpeta local del ensayo.

Tras el recibo del candidato, el supervisor exporta la generación del intento
(`ejecutor_operativo._conservar_generacion` → `generacion_operativa.exportar_generacion`) y, si la exportación no
supera alguna de sus comprobaciones, anota cuál y su causa con las listas cerradas de `causas_del_ciclo`. El ensayo
hace lo mismo y en el mismo caso (siempre, salvo «sin-pendientes»), pero a una carpeta de su salida: nunca guarda
nada en el almacén.

El resultado dice además qué haría el supervisor: con el recibo rechazado, la base operativa sigue como estaba; con el
recibo validado y la generación no conservada, el supervisor se detiene, porque no puede conservar lo que validó.
"""

from pathlib import Path
from typing import Any

from plataforma_datos.comun.nucleo import ErrorFuente
from plataforma_datos.orquestacion.causas_del_ciclo import causa_de_la_generacion
from plataforma_datos.orquestacion.generacion_operativa import exportar_generacion

SIN_PENDIENTES = "sin-pendientes"
CONSERVADA = "conservada"
NO_CONSERVADA = "no-conservada"
SUPERVISOR_CONSERVA = "conserva la generación del intento"
SUPERVISOR_RECHAZA = "rechaza el intento y deja la base operativa como estaba"
SUPERVISOR_SE_DETIENE = "se detiene: el recibo validó un intento cuya generación no se puede conservar"


def supervisor_se_detiene(resultado: str, generacion: dict[str, Any] | None) -> bool:
    """Si el supervisor se detendría: el recibo validó un intento cuya generación no se puede conservar.

    Returns:
        Verdadero con el recibo validado y la generación no conservada.
    """
    return resultado == "validado" and generacion is not None and generacion["estado"] == NO_CONSERVADA


def exportar_en_local(candidato: Path, destino: Path, revision: str, resultado: str) -> dict[str, Any]:
    """Exporta la generación del candidato a `destino` con las mismas comprobaciones que el supervisor.

    Args:
        candidato: El candidato, después de su recibo.
        destino: Carpeta nueva de la salida del ensayo.
        revision: La revisión del código del candidato.
        resultado: El resultado del recibo del candidato.

    Returns:
        «estado» (conservada, no-conservada o sin-pendientes), lo que haría el supervisor y, según el caso, la huella
        del manifiesto o la clase, la comprobación y la causa cerradas del fallo.
    """
    if resultado == SIN_PENDIENTES:
        return {"estado": SIN_PENDIENTES, "supervisor": "conserva la base operativa: no hubo nada que actualizar"}
    try:
        resumen = exportar_generacion(candidato, destino, revision)
    # Los mismos errores que recoge el supervisor: lo demás es un fallo del ensayo y sale tal cual.
    except (ErrorFuente, OSError, ValueError) as error:
        supervisor = SUPERVISOR_RECHAZA if resultado == "rechazado" else SUPERVISOR_SE_DETIENE
        return {"estado": NO_CONSERVADA, **causa_de_la_generacion(error), "supervisor": supervisor}
    return {"estado": CONSERVADA, "sha256Manifiesto": resumen["sha256Manifiesto"], "supervisor": SUPERVISOR_CONSERVA}
