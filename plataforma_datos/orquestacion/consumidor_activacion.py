"""Consumidor de la autoridad de activación: conserva el estado confirmado y aplica cada transición con CAS.

Solo sustituye el estado por una respuesta confirmada del servidor y comprueba que la activación devuelta es la que
manda esta ejecución: la de su trabajo o, en un reintento, la que reintenta.
"""

from typing import Any

from plataforma_datos.orquestacion import diario_mantenimiento as diario
from plataforma_datos.orquestacion.adaptador_versiones import ConfiguracionActivacion
from plataforma_datos.orquestacion.cliente_mantenimiento import ClienteMantenimientoGitHub
from plataforma_datos.orquestacion.contrato_activacion import exigir
from plataforma_datos.orquestacion.lectura_activacion import CURSOS, PRINCIPAL, leer_estado


class Consumidor:
    """Conserva el estado confirmado y exige permiso aplicado antes de cada mutación externa."""

    def __init__(self, configuracion: ConfiguracionActivacion, cliente: ClienteMantenimientoGitHub) -> None:
        self.configuracion = configuracion
        self.cliente = cliente
        operacion = "leer-recuperacion" if configuracion.ejecucion.recuperacion_activacion else "leer"
        self.estado = leer_estado(cliente.activacion(operacion))
        self.trabajo_conservado: tuple[dict[str, Any], bytes] | None = None

    @property
    def actual(self) -> dict[str, Any]:
        """La activación vigente, que tiene que ser la que manda esta ejecución.

        Returns:
            La última activación confirmada por el servidor.
        """
        actual = self.estado["ultimaActivacion"]
        exigir(actual is not None)
        trabajo, ejecucion = actual["trabajo"], self.configuracion.ejecucion
        # En un reintento manda la ejecución que reintenta; el trabajo es el abandonado, de otra acción y commit.
        autoridad = actual.get("reintento", trabajo)
        exigir(all(autoridad[k] == v for k, v in self.referencia().items()))
        exigir(trabajo["runAttempt"] == "1" and ("reintento" in actual or trabajo["accion"] == ejecucion.accion))
        exigir(autoridad["confianza"]["sha"] == ejecucion.revision_codigo)
        return actual

    def referencia(self) -> dict[str, Any]:
        """Devuelve la selección fija del candidato original, también durante su recuperación.

        Returns:
            Tupla privada de la construcción ya confirmada.
        """
        ejecucion = self.configuracion.ejecucion
        return {
            "solicitudId": ejecucion.solicitud_id,
            "revisionReserva": ejecucion.revision_reserva,
            "runId": ejecucion.run_id,
        }

    def _operacion(self, operacion: str, revision: int, previa: dict | None) -> tuple[str, int]:
        # El reintento lo admite el servidor desde cualquier intento de la ejecución que reintenta.
        if not self.configuracion.ejecucion.recuperacion_activacion or operacion == "reintentar":
            return operacion, revision
        exigir(operacion in ("recuperar", "paso"))
        relevo = previa.get("recuperacion") if previa is not None else None
        vigente = relevo is not None and relevo["intento"] == self.configuracion.ejecucion.run_attempt
        if operacion == "recuperar" and vigente:
            revision = relevo["revisionBase"]
        if operacion == "paso":
            exigir(vigente)
            operacion = "paso-recuperacion"
        return operacion, revision

    def transicion(
        self, operacion: str, paso: dict[str, Any] | None = None, reintento: dict[str, Any] | None = None
    ) -> str:
        """Aplica CAS y sustituye el estado únicamente por una respuesta confirmada.

        Returns:
            aplicado o repetido; conflictos cierran la ejecución.
        """
        previa = self.estado["ultimaActivacion"]
        autoridad = previa.get("reintento", previa["trabajo"]) if previa is not None else None
        misma = autoridad is not None and all(autoridad[k] == v for k, v in self.referencia().items())
        revision = previa["revisionBase"] if operacion == "reservar" and misma else self.estado["revision"]
        operacion, revision = self._operacion(operacion, revision, previa)
        recuperacion = self.configuracion.ejecucion.recuperacion_activacion
        solicitud = {**self.referencia(), "revisionEsperada": revision}
        if paso is not None:
            solicitud["paso"] = paso
        if reintento is not None:
            solicitud["reintentoDe"] = reintento
        respuesta = self.cliente.activacion(operacion, solicitud)
        exigir(respuesta["estado"] in ("aplicado", "repetido"))
        self.estado = leer_estado(respuesta)
        actual = self.actual
        if recuperacion and operacion != "reintentar":
            exigir(actual.get("recuperacion", {}).get("intento") == self.configuracion.ejecucion.run_attempt)
        if misma:
            exigir(actual["trabajo"] == previa["trabajo"])
            if previa["evidencia"] is not None:
                exigir(actual["evidencia"] == previa["evidencia"])
        if paso is not None:
            fase = {"preparar": "preparada", "rechazar": "rechazada", "abandonar": "abandonada"}.get(
                paso["tipo"], paso["tipo"]
            )
            # Anotar un rechazo no cambia de fase; cualquier otro paso borra la anotación.
            if paso["tipo"] == "anotar-rechazo":
                fase = previa["fase"]
                exigir(actual.get("detenida") == {"motivo": paso["motivo"], "observado": paso["observado"]})
            else:
                exigir("detenida" not in actual)
            exigir(actual["fase"] == fase)
            for campo in ("evidencia", PRINCIPAL.version, PRINCIPAL.deployment, CURSOS.version, CURSOS.deployment):
                if campo in paso:
                    exigir(actual[campo] == paso[campo])
        diario.anotar("activacion", respuesta["estado"], operacion=operacion, faseServicio=actual["fase"])
        return respuesta["estado"]
