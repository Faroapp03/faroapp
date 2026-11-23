"""Lectura estricta del estado de activación que devuelve el servidor, en sus dos formas.

Una activación de dos servicios lleva los campos de Cursos (`versionIdCursos` y `deploymentIdCursos`) y publica
primero el Worker de Cursos y después el principal. Una activación de un servicio no los lleva y publica solo el
principal: se lee, se termina y se recupera por su propio camino.
"""

import re
from dataclasses import dataclass
from typing import Any

from plataforma_datos.orquestacion.contrato_activacion import HEX40, HEX64, ID_VERSION, exigir, objeto, texto


@dataclass(frozen=True)
class Servicio:
    """Fases, campos y operaciones de un Worker dentro de la misma intención."""

    nombre: str
    subiendo: str
    subida: str
    promoviendo: str
    confirmado: str
    version: str
    deployment: str


PRINCIPAL = Servicio("principal", "subiendo", "subida", "promoviendo", "confirmada", "versionId", "deploymentId")
CURSOS = Servicio(
    "cursos",
    "subiendo-cursos",
    "cursos-subida",
    "promoviendo-cursos",
    "cursos-confirmado",
    "versionIdCursos",
    "deploymentIdCursos",
)
FASES_CURSOS = (CURSOS.subiendo, CURSOS.subida, CURSOS.promoviendo, CURSOS.confirmado)
FASES = (
    "reservada",
    "preparada",
    *FASES_CURSOS,
    "subiendo",
    "subida",
    "promoviendo",
    "confirmada",
    "rechazada",
    "abandonada",
)
TERMINALES = ("confirmada", "rechazada", "abandonada")
MOTIVOS_ABANDONO = ("a-mano", "rechazo-previo", "rechazo-proveedor")
MOTIVOS_DETENIDA = ("rechazo-previo", "rechazo-proveedor")
# Fases cuyo efecto pudo llegar a hacerse sin acuse: solo se cierran observando, nunca repitiendo.
INCIERTAS = (CURSOS.subiendo, CURSOS.promoviendo, PRINCIPAL.subiendo, PRINCIPAL.promoviendo)
_TRAS_CURSOS_SUBIDO = (*FASES_CURSOS[1:], "subiendo", "subida", "promoviendo", "confirmada")
_TRAS_CURSOS_CONFIRMADO = (CURSOS.confirmado, "subiendo", "subida", "promoviendo", "confirmada")


def dos_servicios(actual: dict[str, Any]) -> bool:
    """Indica si la activación publica también el Worker de Cursos.

    Returns:
        Verdadero en la forma de dos servicios.
    """
    return CURSOS.version in actual


def servicios(actual: dict[str, Any]) -> tuple[Servicio, ...]:
    """Devuelve los Workers de la activación en el orden en que se publican.

    Returns:
        Cursos y el principal, o solo el principal en la forma de un servicio.
    """
    return (CURSOS, PRINCIPAL) if dos_servicios(actual) else (PRINCIPAL,)


def anterior(evidencia: dict[str, Any], servicio: Servicio, dos: bool) -> dict[str, Any]:
    """Despliegue que servía cada Worker antes de la activación.

    Returns:
        Par `versionId` y `deploymentId` del servicio.
    """
    return evidencia["anterior"][servicio.nombre] if dos else evidencia["anterior"]


def _par(valor: object) -> None:
    par = objeto(valor, "versionId,deploymentId")
    for campo in ("versionId", "deploymentId"):
        texto(par[campo], ID_VERSION)


def _evidencia(valor: object, dos: bool) -> None:
    o = objeto(valor, "sha256Indice,sha256ManifiestoWeb,generacion,artefacto,anterior")
    for campo in ("sha256Indice", "sha256ManifiestoWeb"):
        texto(o[campo], HEX64)
    generacion = objeto(o["generacion"], "revisionCodigo,sha256Manifiesto")
    texto(generacion["revisionCodigo"], HEX40)
    texto(generacion["sha256Manifiesto"], HEX64)
    artefacto = objeto(o["artefacto"], "revisionCodigo,huellaPaquete,sha256Artefacto")
    texto(artefacto["revisionCodigo"], HEX40)
    texto(artefacto["sha256Artefacto"], HEX64)
    texto(artefacto["huellaPaquete"], re.compile(r"[0-9a-f]{16}"))
    if dos:
        previos = objeto(o["anterior"], "principal,cursos")
        _par(previos["principal"])
        _par(previos["cursos"])
    else:
        _par(o["anterior"])


def _recuperacion(actual: dict[str, Any], revision: int) -> None:
    recuperacion = objeto(actual["recuperacion"], "version,intento,revisionBase,anterior")
    exigir(type(recuperacion["version"]) is int and recuperacion["version"] == 1)
    texto(recuperacion["intento"], re.compile(r"[1-9][0-9]*"))
    exigir(1 < int(recuperacion["intento"]) <= 2**53 - 1)
    exigir(type(recuperacion["revisionBase"]) is int and 0 <= recuperacion["revisionBase"] < revision)
    previo = objeto(
        recuperacion["anterior"],
        "estado,runId,runAttempt,repositorioId,propietarioId,sha,workflowPath,evento,conclusion",
    )
    exigir(previo["estado"] == "completed" and previo["evento"] == "workflow_dispatch")
    exigir(previo["runAttempt"] == str(int(recuperacion["intento"]) - 1))


def _trabajo(actual: dict[str, Any]) -> None:
    trabajo = actual["trabajo"]
    exigir(type(trabajo) is dict)
    exigir(
        {
            "solicitudId",
            "revisionReserva",
            "runId",
            "runAttempt",
            "accion",
            "confianza",
            "huellaRecibo",
            "resultado",
        }.issubset(trabajo)
    )
    exigir(type(trabajo["confianza"]) is dict and "sha" in trabajo["confianza"])
    exigir(type(trabajo["resultado"]) is dict and {"resultado", "huellaPaquete"}.issubset(trabajo["resultado"]))
    texto(trabajo["huellaRecibo"], HEX64)
    if "recuperacion" in actual:
        # El relevo es de la ejecución que manda en la activación: en un reintento, la que reintenta.
        autoridad = actual.get("reintento", trabajo)
        previo = actual["recuperacion"]["anterior"]
        exigir(previo["runId"] == autoridad["runId"] and previo["sha"] == autoridad["confianza"]["sha"])


def _identificadores(actual: dict[str, Any], dos: bool) -> None:
    fase = actual["fase"]
    campos = ("versionId", "deploymentId", *((CURSOS.version, CURSOS.deployment) if dos else ()))
    for campo in campos:
        if actual[campo] is not None:
            texto(actual[campo], ID_VERSION)
    if fase == "abandonada":
        # Conserva lo que se llegó a anotar, salvo un despliegue del principal, que solo existe confirmado.
        exigir(actual["deploymentId"] is None)
        exigir(not dos or actual[CURSOS.deployment] is None or actual[CURSOS.version] is not None)
        return
    exigir((actual["versionId"] is not None) == (fase in ("subida", "promoviendo", "confirmada")))
    exigir((actual["deploymentId"] is not None) == (fase == "confirmada"))
    if dos:
        exigir((actual[CURSOS.version] is not None) == (fase in _TRAS_CURSOS_SUBIDO))
        exigir((actual[CURSOS.deployment] is not None) == (fase in _TRAS_CURSOS_CONFIRMADO))
    else:
        exigir(fase not in FASES_CURSOS)


def sirve_lo_anterior(anterior_: dict[str, Any], observado: dict[str, Any], dos: bool) -> bool:
    """Cada Worker sirve la versión de antes de la intención; el despliegue puede ser otro tras volver atrás.

    Returns:
        Verdadero si cada Worker de la forma sirve su versión anterior.
    """
    nombres = (PRINCIPAL.nombre, CURSOS.nombre) if dos else (None,)
    return all(
        (observado[n] if n else observado)["versionId"] == (anterior_[n] if n else anterior_)["versionId"]
        for n in nombres
    )


def _observado(valor: object, dos: bool) -> None:
    if dos:
        previos = objeto(valor, "principal,cursos")
        _par(previos["principal"])
        _par(previos["cursos"])
    else:
        _par(valor)


def _abandono(actual: dict[str, Any], dos: bool) -> None:
    exigir(("abandono" in actual) == (actual["fase"] == "abandonada"))
    if "abandono" in actual:
        abandono = objeto(actual["abandono"], "motivo,observado")
        exigir(abandono["motivo"] in MOTIVOS_ABANDONO)
        _observado(abandono["observado"], dos)


def _reintento(actual: dict[str, Any], dos: bool) -> None:
    # La revisión de trabajos al reservar y, en un reintento, la ejecución que lo pide, del mismo origen.
    if "revisionTrabajos" in actual:
        exigir(type(actual["revisionTrabajos"]) is int and actual["revisionTrabajos"] >= 0)
    if "reintento" in actual:
        reintento = objeto(actual["reintento"], "solicitudId,revisionReserva,runId,confianza,abandonadaEn,observado")
        _observado(reintento["observado"], dos)
        texto(reintento["runId"], re.compile(r"[1-9][0-9]*"))
        exigir(type(reintento["revisionReserva"]) is int and reintento["revisionReserva"] > 0)
        exigir(type(reintento["abandonadaEn"]) is int and reintento["abandonadaEn"] <= actual["creadoEn"])
        propia, original = reintento["confianza"], actual["trabajo"]["confianza"]
        exigir(type(propia) is dict and type(original) is dict)
        exigir(all(propia.get(k) == original.get(k) for k in ("repositorioId", "propietarioId", "ref", "workflowRef")))
    if "reintentoDescartado" in actual:
        # Solo en una abandonada por `rechazo-previo` que no es un reintento: su reintento ya no se hará.
        exigir(actual["reintentoDescartado"] == "sin-artefacto" and "reintento" not in actual)
        exigir(actual["fase"] == "abandonada" and actual["abandono"]["motivo"] == "rechazo-previo")


def _cierre(actual: dict[str, Any], dos: bool) -> None:
    # El cierre pedido desde el panel, solo mientras la intención no ha terminado; usado, con lo observado.
    if "cierre" not in actual:
        return
    cierre = objeto(actual["cierre"], "trabajo,revisionActivacion,caducaEn,estado,observado")
    exigir(actual["fase"] not in TERMINALES and cierre["estado"] in ("solicitado", "web-cambiada"))
    objeto(cierre["trabajo"], "solicitudId,revisionReserva")
    exigir(type(cierre["revisionActivacion"]) is int and type(cierre["caducaEn"]) is int)
    exigir((cierre["observado"] is None) == (cierre["estado"] == "solicitado"))
    if cierre["observado"] is not None:
        _observado(cierre["observado"], dos)


def leer_estado(respuesta: dict[str, Any]) -> dict[str, Any]:
    """Comprueba el estado de activación de una respuesta del servidor.

    Returns:
        El estado, ya comprobado.
    """
    estado = objeto(respuesta["activacion"], "version,revision,ultimaActivacion")
    exigir(type(estado["version"]) is int and estado["version"] == 1)
    exigir(type(estado["revision"]) is int and 0 <= estado["revision"] <= 2**53 - 1)
    actual = estado["ultimaActivacion"]
    if actual is None:
        return estado
    exigir(type(actual) is dict)
    dos = dos_servicios(actual)
    campos = "revisionBase,trabajo,fase,creadoEn,actualizadoEn,evidencia,versionId,deploymentId,error"
    campos += f",{CURSOS.version},{CURSOS.deployment}" if dos else ""
    campos += ",abandono" if "abandono" in actual else ""
    campos += ",detenida" if "detenida" in actual else ""
    campos += "".join(
        f",{c}" for c in ("reintento", "revisionTrabajos", "reintentoDescartado", "cierre") if c in actual
    )
    objeto(actual, campos + (",recuperacion" if "recuperacion" in actual else ""))
    _reintento(actual, dos)
    _cierre(actual, dos)
    if "recuperacion" in actual:
        _recuperacion(actual, estado["revision"])
    exigir(actual["fase"] in FASES)
    _trabajo(actual)
    if actual["evidencia"] is not None:
        _evidencia(actual["evidencia"], dos)
    exigir(actual["fase"] in ("reservada", "rechazada", "abandonada") or actual["evidencia"] is not None)
    _identificadores(actual, dos)
    _abandono(actual, dos)
    if "detenida" in actual:
        # Solo en una fase con efecto en curso: el rechazo sin efecto que la detuvo.
        exigir(actual["fase"] in INCIERTAS)
        detenida = objeto(actual["detenida"], "motivo,observado")
        exigir(detenida["motivo"] in MOTIVOS_DETENIDA)
        # Sin observación cuando no se pudo comprobar qué sirve cada Worker.
        if detenida["observado"] is not None:
            _observado(detenida["observado"], dos)
    return estado
