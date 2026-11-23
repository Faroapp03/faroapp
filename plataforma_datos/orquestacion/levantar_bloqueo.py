"""Levanta el bloqueo operativo de la referencia de mantenimiento solo hacia una base operativa verificada.

Un rechazo deja la base operativa como estaba y sin bloqueo; una referencia con `bloqueoOperativo` activo la dejó un
trabajo anterior. El ejecutor operativo hace esta misma verificación al empezar un ciclo (bloqueo_al_empezar), y esta
orden la deja a mano de una persona. Lo levanta únicamente si la referencia bloquea el trabajo indicado y su
`baseOperativa` se recupera y verifica entera. La referencia nueva es la anterior con el bloqueo apagado: no mueve
bases, revisión ni trabajo, no toca recibos ni índices y no activa datos. Antes de moverla deja un acta inmutable por
trabajo bloqueado; si se corta entre las dos escrituras, repetirla reutiliza el acta y termina el levantamiento.
"""

import argparse
import hashlib
import os
import re
import sys
import tempfile
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal

from plataforma_datos.orquestacion.almacen_generaciones import (
    AlmacenGeneracionesInvalido,
    AlmacenGeneracionesNoDisponible,
    recuperar_generacion,
)
from plataforma_datos.orquestacion.almacen_s3 import AlmacenS3
from plataforma_datos.orquestacion.almacen_trabajos import (
    MAX_CONTROL_BYTES,
    MAX_ENTERO,
    REFERENCIA,
    RUN,
    UUID,
    AlmacenTrabajos,
    ConflictoReferencia,
    escribir_confirmado,
    leer_referencia_exacta,
)
from plataforma_datos.orquestacion.contrato_de_trabajos import _bytes, _json, instante, objeto
from plataforma_datos.orquestacion.transferir_generacion import configuracion_privada

Resultado = Literal["levantado", "sin-bloqueo", "no-verificable", "conflicto"]
# 1 queda para el fallo sin resultado y 2 para los argumentos no admitidos, como en el resto de órdenes.
CODIGOS: dict[Resultado, int] = {"levantado": 0, "sin-bloqueo": 3, "no-verificable": 4, "conflicto": 5}
CODIGO_FALLO = 1
MENSAJES: dict[Resultado, str] = {
    "levantado": "Bloqueo levantado: la base operativa se ha verificado entera y el acta queda guardada.",
    "sin-bloqueo": "Sin bloqueo: la referencia no está bloqueada y no se ha escrito nada.",
    "no-verificable": (
        "Bloqueo mantenido: la base operativa no verifica entera; no se ha escrito nada. Restaura una base íntegra."
    ),
    "conflicto": (
        "Bloqueo mantenido: la referencia ha cambiado o bloquea otro trabajo; vuelve a leerla antes de repetir."
    ),
}
ERROR_GENERICO = "Desbloqueo no confirmado: revisa la configuración privada, la referencia y el almacén."
ERROR_ALMACEN = "Desbloqueo no confirmado: el almacén no ha respondido o la descarga no ha terminado. Repite la orden."
VERSION_ACTA = 1
CAMPOS_ACTA = "version,instante,trabajo,sha256ReferenciaAnterior,sha256ReferenciaNueva,generacion,transicion"
TRANSICION = "levantar-bloqueo"


class EscrituraNoConfirmada(OSError):
    """El almacén no confirmó una escritura y la referencia sigue como se leyó."""


def _clave_acta(trabajo: dict[str, Any]) -> str:
    # Una sola acta por trabajo bloqueado: ese mismo trabajo no puede volver a bloquear la referencia.
    return f"desbloqueos/{trabajo['solicitudId']}/{trabajo['revisionReserva']}/{trabajo['runId']}.json"


def _instante_utc() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _base_verificada(base: dict[str, Any], almacen: AlmacenTrabajos) -> bool:
    # La misma recuperación íntegra que exige el ejecutor antes de aprovisionar un candidato sobre la base.
    with tempfile.TemporaryDirectory(prefix=".levantar-bloqueo-") as nombre:
        try:
            recuperar_generacion(Path(nombre) / "generacion", base["revisionCodigo"], base["sha256Manifiesto"], almacen)
        except AlmacenGeneracionesNoDisponible:
            raise
        except AlmacenGeneracionesInvalido:
            return False
    return True


def _acta(anterior: dict[str, Any], contenido: bytes, nueva: bytes) -> dict[str, Any]:
    # Registra la transición pedida, no su resultado: se escribe antes que la referencia.
    return {
        "version": VERSION_ACTA,
        "instante": _instante_utc(),
        "trabajo": anterior["trabajo"],
        "sha256ReferenciaAnterior": hashlib.sha256(contenido).hexdigest(),
        "sha256ReferenciaNueva": hashlib.sha256(nueva).hexdigest(),
        "generacion": anterior["baseOperativa"],
        "transicion": TRANSICION,
    }


def _misma_acta(leida: bytes, acta: dict[str, Any]) -> bool:
    existente = objeto(_json(leida, MAX_CONTROL_BYTES), CAMPOS_ACTA)
    instante(existente["instante"])
    # Se comparan bytes canónicos y no diccionarios: en Python, True y 1 serían iguales.
    return _bytes({**existente, "instante": acta["instante"]}) == _bytes(acta)


def _tras_escritura_sin_confirmar(contenido: bytes, almacen: AlmacenTrabajos) -> Resultado:
    """Explica una escritura no confirmada por la referencia que hay ahora, sin volver a escribir.

    Returns:
        «sin-bloqueo» si otra ejecución ya lo ha levantado, o «conflicto» si la referencia es otra.

    Raises:
        EscrituraNoConfirmada: Si la referencia sigue siendo la leída: fue un corte y repetir la orden lo completa.
    """
    actual, _etag, bytes_actuales = leer_referencia_exacta(almacen)
    if not actual["bloqueoOperativo"]:
        return "sin-bloqueo"
    if bytes_actuales == contenido:
        raise EscrituraNoConfirmada(ERROR_ALMACEN)
    return "conflicto"


def _escribir(anterior: dict[str, Any], etag: str, contenido: bytes, almacen: AlmacenTrabajos) -> Resultado:
    """Crea el acta, o reutiliza la de un levantamiento cortado, y después escribe la referencia con If-Match.

    Returns:
        «levantado», «conflicto» si ya hay otra acta para ese trabajo, o lo que explique una escritura sin confirmar.
    """
    nueva = _bytes({**anterior, "bloqueoOperativo": False})
    acta = _acta(anterior, contenido, nueva)
    clave = _clave_acta(acta["trabajo"])
    leida = almacen.leer_control(clave, MAX_CONTROL_BYTES)
    if leida is not None and not _misma_acta(leida[0], acta):
        return "conflicto"
    try:
        if leida is None:
            escribir_confirmado(clave, _bytes(acta), None, almacen)
        escribir_confirmado(REFERENCIA, nueva, etag, almacen)
    except ConflictoReferencia:
        return _tras_escritura_sin_confirmar(contenido, almacen)
    return "levantado"


def levantar_bloqueo(trabajo: dict[str, Any], almacen: AlmacenTrabajos) -> Resultado:
    """Levanta el bloqueo del trabajo indicado tras verificar su base; nunca reintenta una CAS perdida.

    Returns:
        «levantado», «sin-bloqueo» (nada escrito), «no-verificable» (nada escrito) o «conflicto».

    Raises:
        AlmacenTrabajoInvalido: Si la referencia falta o no cumple el contrato.
        AlmacenGeneracionesNoDisponible: Si la descarga de la base se corta; no se ha escrito nada.
        OSError: Si el almacén no responde o no confirma una escritura; repetir la orden la completa.
    """
    anterior, etag, contenido = leer_referencia_exacta(almacen)
    if not anterior["bloqueoOperativo"]:
        return "sin-bloqueo"
    if anterior["trabajo"] != trabajo:
        return "conflicto"
    if not _base_verificada(anterior["baseOperativa"], almacen):
        return "no-verificable"
    # La verificación descarga la generación entera: si mientras tanto cambió la referencia, no se escribe nada.
    actual, etag_actual, bytes_actuales = leer_referencia_exacta(almacen)
    if (etag_actual, bytes_actuales) != (etag, contenido):
        return "conflicto" if actual["bloqueoOperativo"] else "sin-bloqueo"
    return _escribir(anterior, etag, contenido, almacen)


def _identificador(patron: re.Pattern[str]) -> Callable[[str], str]:
    def leer(texto: str) -> str:
        if patron.fullmatch(texto) is None or (patron is RUN and int(texto) > MAX_ENTERO):
            raise argparse.ArgumentTypeError("valor no admitido")
        return texto

    return leer


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--solicitud-id", required=True, type=_identificador(UUID))
    parser.add_argument("--revision-reserva", required=True, type=_identificador(RUN))
    parser.add_argument("--run-id", required=True, type=_identificador(RUN))
    return parser


def main(argv: list[str] | None = None) -> int:
    """Orden privada: una línea con el resultado y un código de salida propio para cada uno.

    Returns:
        0 levantado, 3 sin bloqueo, 4 no verificable, 5 conflicto y 1 sin resultado (también sin almacén).
    """
    argumentos = _parser().parse_args(argv)
    trabajo = {
        "solicitudId": argumentos.solicitud_id,
        "revisionReserva": int(argumentos.revision_reserva),
        "runId": argumentos.run_id,
    }
    try:
        with AlmacenS3(configuracion_privada(os.environ)) as almacen:
            resultado = levantar_bloqueo(trabajo, almacen)
    except (OSError, AlmacenGeneracionesNoDisponible):
        print(ERROR_ALMACEN, file=sys.stderr)
        return CODIGO_FALLO
    except (ValueError, RecursionError):
        print(ERROR_GENERICO, file=sys.stderr)
        return CODIGO_FALLO
    print(MENSAJES[resultado])
    return CODIGOS[resultado]


if __name__ == "__main__":
    sys.exit(main())
