"""Por qué no terminó la ejecución, dicho al servidor con una causa y un paso de listas cerradas.

Cuando el motor no deja un recibo válido, o lo deja rechazado porque se le acabó el tiempo, el servidor no sabría por
qué: solo vería, al final, que el job acabó sin recibo o con un rechazo. El supervisor le envía entonces un cierre sin
recibo por la misma ruta autenticada que el recibo, con la causa y el paso que ya anota el diario y nada más: ni
mensajes, ni rutas, ni identificadores del ciclo. El panel lo enseña en palabras. Si el envío falla, queda anotado en
el diario y el supervisor termina igual que sin él: es un aviso, no cambia el resultado.
"""

import json
import re
import subprocess
from pathlib import Path
from typing import Protocol

from plataforma_datos.orquestacion import diario_mantenimiento as diario
from plataforma_datos.orquestacion import pasos_del_ciclo
from plataforma_datos.orquestacion.actualizar import CODIGO_TIEMPO_AGOTADO
from plataforma_datos.orquestacion.causas_del_ciclo import causas_del_paquete
from plataforma_datos.orquestacion.cliente_mantenimiento import ClienteMantenimientoGitHub, ErrorMantenimiento
from plataforma_datos.orquestacion.detalle_del_error import origen
from plataforma_datos.orquestacion.fin_del_motor import CAUSA_SIN_RECIBO, MotorSinRecibo
from plataforma_datos.orquestacion.hora_limite_del_motor import CAUSA as CAUSA_SIN_TIEMPO
from plataforma_datos.orquestacion.hora_limite_del_motor import leer_parada

PLAZO_AGOTADO = "plazo-agotado"
# Las causas que el supervisor puede decir; `sin-resultado` la deduce solo el servidor, de la evidencia de GitHub.
CAUSAS = (PLAZO_AGOTADO, CAUSA_SIN_TIEMPO, "motor-terminado-por-senal", CAUSA_SIN_RECIBO)
PASO = re.compile(r"[a-z0-9][a-z0-9_-]{0,63}")
# El paso del supervisor en el que corre el motor: lo que se dice cuando el ciclo no dejó en qué paso iba.
PASO_DEL_MOTOR = "motor"
FASE = "cierre-sin-recibo"
NO_CONFIRMADO = "no-confirmado"


class Reserva(Protocol):
    """La reserva a la que responde el cierre: la de la configuración del ejecutor."""

    solicitud_id: str
    revision_reserva: int
    accion: str


def _paso_en_curso(candidato: Path) -> str:
    """El paso que no terminó: el que no empezó por la hora límite o el último que quedó sin fin.

    Returns:
        Un nombre del diario; `PASO_DEL_MOTOR` si el ciclo no dejó registros legibles que lo digan.
    """
    try:
        parada = leer_parada(candidato)
        if parada is not None:
            return str(parada["paso"])
        sin_fin = [registro for registro in pasos_del_ciclo.leer(candidato) if registro["fin"] is None]
    except (OSError, ValueError):
        # Registros ilegibles: el diario ya los anota como problema; aquí solo falta saber el paso.
        return PASO_DEL_MOTOR
    return str(sin_fin[-1]["paso"]) if sin_fin else PASO_DEL_MOTOR


def fallo_sin_recibo(error: BaseException, candidato: Path) -> dict[str, str]:
    """Explica por qué el motor no dejó un recibo válido.

    Returns:
        La causa (plazo agotado, señal o fin sin recibo) y el paso en que iba.
    """
    if isinstance(origen(error), subprocess.TimeoutExpired):
        causa = PLAZO_AGOTADO
    elif isinstance(error, MotorSinRecibo):
        causa = error.causa
    else:
        # Dejó algo que no es un recibo válido: para la persona, terminó sin resultado.
        causa = CAUSA_SIN_RECIBO
    return {"causa": causa, "paso": _paso_en_curso(candidato)}


def fallo_del_rechazo(candidato: Path) -> dict[str, str] | None:
    """Explica un recibo rechazado solo si lo rechazó el tiempo: sin tiempo para empezar o con un paso cortado.

    Returns:
        La causa y el paso, o None si el rechazo tiene otro motivo o no se puede leer.
    """
    try:
        parada = leer_parada(candidato)
        if parada is not None:
            return {"causa": CAUSA_SIN_TIEMPO, "paso": str(parada["paso"])}
        causas = causas_del_paquete(candidato)
    except (OSError, ValueError, KeyError, TypeError):
        # `causas_del_ciclo.registrar_paquete` ya anota un estado ilegible; sin causa cierta no se envía nada.
        return None
    if causas is not None and causas["codigo"] == CODIGO_TIEMPO_AGOTADO and causas["paso"]:
        return {"causa": PLAZO_AGOTADO, "paso": causas["paso"]}
    return None


def cuerpo_del_cierre(solicitud_id: str, revision_reserva: int, accion: str, fallo: dict[str, str]) -> bytes:
    """Compone el cierre sin recibo con su forma cerrada.

    Returns:
        Los bytes JSON del cierre.

    Raises:
        ValueError: Si la causa o el paso no son de sus listas.
    """
    if fallo["causa"] not in CAUSAS or PASO.fullmatch(fallo["paso"]) is None:
        raise ValueError("Cierre sin recibo fuera de su forma")
    cierre = {
        "solicitudId": solicitud_id,
        "revisionReserva": revision_reserva,
        "accion": accion,
        "ultimoFallo": {"causa": fallo["causa"], "paso": fallo["paso"]},
    }
    return json.dumps(cierre, separators=(",", ":")).encode()


def cerrar(cliente: ClienteMantenimientoGitHub, reserva: Reserva, fallo: dict[str, str] | None) -> None:
    """Envía el cierre de esta reserva; sin causa cierta no envía nada."""
    if fallo is not None:
        enviar(cliente, cuerpo_del_cierre(reserva.solicitud_id, reserva.revision_reserva, reserva.accion, fallo))


def enviar(cliente: ClienteMantenimientoGitHub, cuerpo: bytes) -> None:
    """Envía el cierre; un envío fallido queda en el diario y no detiene al supervisor.

    No se anota como «error»: el diagnóstico del diario (`salud_mantenimiento`) toma el primer error como la fase que
    falló, y esa sigue siendo la del motor, no la de este aviso.
    """
    diario.anotar(FASE, "inicio")
    try:
        confirmacion = cliente.enviar_resultado(cuerpo)
    except ErrorMantenimiento:
        # El servidor cerrará el trabajo por la evidencia de GitHub, sin causa propia.
        diario.anotar(FASE, NO_CONFIRMADO)
        return
    diario.anotar(FASE, "confirmado", confirmacion=confirmacion)
