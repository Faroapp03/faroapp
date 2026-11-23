"""Cumple el cierre de una publicación que alguien pidió desde el panel.

El servidor anota la solicitud para el trabajo que despacha, y es esta ejecución, la de ese trabajo, la que la
cumple antes de cualquier otra cosa de su paso de activación. Observa lo que sirve cada Worker sin descargar ningún
artefacto y se lo manda al servidor, que solo cierra si la web sirve otra vez lo anterior; si no, deja la solicitud
usada con lo observado y la intención sigue en su fase. El servidor comprueba por sí mismo en GitHub que la ejecución
de la activación ha terminado.
"""

import tempfile
from pathlib import Path
from typing import Any

from plataforma_datos.orquestacion.abandono_activacion import observado
from plataforma_datos.orquestacion.adaptador_versiones import AdaptadorVersiones
from plataforma_datos.orquestacion.consumidor_activacion import Consumidor
from plataforma_datos.orquestacion.contrato_activacion import exigir
from plataforma_datos.orquestacion.lectura_activacion import leer_estado


def cierre_para_esta_ejecucion(actual: dict[str, Any] | None, referencia: dict[str, Any]) -> bool:
    """Indica si hay un cierre pedido, todavía sin usar, para el trabajo de esta ejecución.

    Returns:
        Verdadero si el cierre anotado nombra la reserva de esta ejecución.
    """
    cierre = actual.get("cierre") if actual is not None else None
    return (
        cierre is not None
        and cierre["estado"] == "solicitado"
        and cierre["trabajo"] == {k: referencia[k] for k in ("solicitudId", "revisionReserva")}
    )


def cumplir_cierre(consumidor: Consumidor) -> str | None:
    """Pide al servidor el cierre anotado para esta ejecución, con lo que sirve ahora cada Worker.

    Returns:
        `abandonada` si se cerró, `web-cambiada` si la web ya no servía lo anterior, `ya-no-vigente` si el servidor
        dice que ese cierre ya no es para esta ejecución (se volvió a pedir o la activación avanzó), o None si no
        había cierre.
    """
    previa = consumidor.estado["ultimaActivacion"]
    referencia = consumidor.referencia()
    if not cierre_para_esta_ejecucion(previa, referencia):
        return None
    configuracion = consumidor.configuracion
    with tempfile.TemporaryDirectory(prefix="cierre-", dir=configuracion.ejecucion.directorio_trabajo) as nombre:
        adaptador = AdaptadorVersiones(configuracion, Path(nombre))
        adaptador.artefacto = None
        visto = observado(adaptador, previa)
    registro = {**referencia, "revisionEsperada": consumidor.estado["revision"], "observado": visto}
    respuesta = consumidor.cliente.activacion("cerrar-solicitado", registro)
    if respuesta["estado"] == "conflicto":
        # El cierre ya no es para esta ejecución: sigue con su activación normal, con el estado del servidor.
        consumidor.estado = leer_estado(respuesta)
        return "ya-no-vigente"
    exigir(respuesta["estado"] == "aplicado")
    consumidor.estado = leer_estado(respuesta)
    actual = consumidor.estado["ultimaActivacion"]
    if actual is not None and actual["fase"] == "abandonada":
        exigir(actual["abandono"] == {"motivo": "a-mano", "observado": visto})
        return "abandonada"
    exigir(actual is not None and actual.get("cierre", {}).get("estado") == "web-cambiada")
    return "web-cambiada"
