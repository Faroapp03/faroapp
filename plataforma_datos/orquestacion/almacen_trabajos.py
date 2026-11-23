"""Recibos privados inmutables y base operativa con CAS; ninguna referencia activa datos.

El recibo conserva sus bytes exactos para reenvíos. El catálogo repetido usa una pieza por contenido
y un sobre por trabajo; el corte original no se normaliza. El índice se escribe después del
contenido y antes de la referencia. Recuperar un índice no basta para enviar la llamada de retorno:
conservar_trabajo confirma también la CAS pendiente. Los directorios de trabajo y las credenciales
pertenecen al ejecutor privado.
"""

import hashlib
import json
import os
import re
import stat
import tempfile
from contextlib import suppress
from pathlib import Path
from typing import Any, Protocol

from plataforma_datos.orquestacion.almacen_artefactos import leer_descriptor_artefacto
from plataforma_datos.orquestacion.almacen_generaciones import AlmacenGeneraciones
from plataforma_datos.orquestacion.contrato_de_trabajos import (
    ERROR,
    MAX_ENTERO,
    AlmacenTrabajoInvalido,
    _bytes,
    _entero,
    _json,
    exigir,
    hexa,
    instante,
    objeto,
)
from plataforma_datos.orquestacion.generacion_operativa import (
    MAX_MANIFIESTO_BYTES,
    REVISION,
    SHA256,
    leer_manifiesto_generacion,
)
from plataforma_datos.orquestacion.instantanea_del_recibo import VEREDICTOS, validar_instantanea

VERSION_INDICE = 2
VERSION_INDICE_COMPACTO = 3
MAX_PIEZA_CATALOGO_BYTES = 4 * 1024 * 1024
MAX_SOBRE_RECIBO_BYTES = 132 * 1024
MAX_CONTROL_BYTES = 8192
VERSION_RECIBO_CATALOGO = 3
# Desde la v4 el recibo lista los módulos que conservan su versión anterior y admite validar un candidato en ámbar.
VERSION_RECIBO_CONSERVADOS = 4
VERSIONES_RECIBO = (1, 2, VERSION_RECIBO_CATALOGO, VERSION_RECIBO_CONSERVADOS)
MAX_RECIBO_BYTES = 132 * 1024 + 4 * 1024 * 1024
REFERENCIA = "referencias/mantenimiento.json"
UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}")
RUN = re.compile(r"[1-9][0-9]{0,15}")
ACCIONES_V1 = ("actualizar-datos", "reintentar-pendientes")
ACCIONES = (*ACCIONES_V1, "comprobar-programada", "comprobar-vencidas", "actualizar-cursos")
# Pueden terminar sin trabajo porque solo seleccionan lo vencido; «actualizar-cursos» fuerza siempre la lectura.
SIN_PENDIENTES = ("reintentar-pendientes", "comprobar-programada", "comprobar-vencidas")


class ConflictoReferencia(AlmacenTrabajoInvalido):
    """Otro valor confirmado impide avanzar esta referencia; nunca se revierte."""


class AlmacenTrabajos(AlmacenGeneraciones, Protocol):
    """Solo los controles cerrados permiten descubrir contenido sin conocer previamente su hash."""

    def leer_control(self, clave: str, bytes_maximos: int) -> tuple[bytes, str] | None:
        """Lee íntegro y acotado; None significa exclusivamente objeto inexistente, no fallo de transporte."""
        ...

    def guardar_control(self, clave: str, contenido: bytes, etag_esperado: str | None) -> bool:
        """PUT condicional: None crea con IfNoneMatch; ETag compara con IfMatch; False solo ante 412."""
        ...


def _generacion(valor: object) -> dict[str, Any]:
    o = objeto(valor, "revisionCodigo,sha256Manifiesto")
    hexa(o["revisionCodigo"], REVISION)
    hexa(o["sha256Manifiesto"], SHA256)
    return dict(o)


def _artefacto(valor: object) -> dict[str, Any]:
    o = objeto(valor, "revisionCodigo,huellaPaquete,sha256Artefacto")
    hexa(o["revisionCodigo"], REVISION)
    hexa(o["huellaPaquete"], re.compile(r"[0-9a-f]{16}"))
    hexa(o["sha256Artefacto"], SHA256)
    return dict(o)


def _tupla(valor: object) -> dict[str, Any]:
    o = objeto(valor, "solicitudId,revisionReserva,runId")
    hexa(o["solicitudId"], UUID)
    hexa(o["runId"], RUN)
    exigir(int(o["runId"]) <= MAX_ENTERO)
    _entero(o["revisionReserva"], 1)
    return dict(o)


def _clave(tupla: dict[str, Any]) -> str:
    return f"trabajos/{tupla['solicitudId']}/{tupla['revisionReserva']}/{tupla['runId']}.json"


def _resultado(o: dict[str, Any]) -> None:
    resultado = o["resultado"]
    exigir(resultado in ("validado", "sin-pendientes", "rechazado"))
    exigir(o["veredicto"] is None or o["veredicto"] in VEREDICTOS)
    if o["estado"] is not None:
        validar_instantanea(o["estado"])
        # El recibo conserva segundos: no atribuirle una precisión inferior que no contiene.
        exigir(o["estado"]["observadoEn"][:19] <= o["terminadoEn"][:19])
    if o["version"] >= VERSION_RECIBO_CONSERVADOS:
        _conservados(o)
    if resultado == "validado":
        # Un ámbar sin rojo, con el paquete en verde, publica lo actualizado; lo demás consta en «conservados».
        admitidos = ("verde", "ámbar") if o["version"] >= VERSION_RECIBO_CONSERVADOS else ("verde",)
        exigir(o["veredicto"] in admitidos and o["error"] is None)
        exigir(o["veredicto"] == "verde" or bool(o["conservados"]))
        hexa(o["huellaPaquete"], re.compile(r"[0-9a-f]{16}"))
        exigir(o["estado"] is not None)
        exigir(next(m for m in o["estado"]["modulos"] if m["id"] == "paquete")["veredicto"] == "verde")
        # Un módulo en rojo no puede quedar en un paquete publicado: ningún candidato con él es válido.
        exigir(all(m["veredicto"] != "rojo" for m in o["estado"]["modulos"]))
    elif resultado == "sin-pendientes":
        permitidas = ("reintentar-pendientes",) if o["version"] == 1 else SIN_PENDIENTES
        exigir(o["accion"] in permitidas and o["estado"] is not None)
        exigir(o["huellaPaquete"] is None and o["error"] is None and o["veredicto"] is None)
    else:
        _rechazo(o)


def conservados_del_estado(estado: dict[str, Any] | None) -> list[dict[str, Any]]:
    """Los módulos en ámbar de la instantánea, con la fecha de la versión que conservan.

    Returns:
        Una fila {id, fecha} por módulo en ámbar, en el orden del estado; vacía sin estado.
    """
    if estado is None:
        return []
    return [
        {"id": m["id"], "fecha": (m["ultimaVersionBuena"] or {}).get("fecha")}
        for m in estado["modulos"]
        if m["veredicto"] == "ámbar"
    ]


def _conservados(o: dict[str, Any]) -> None:
    exigir(type(o["conservados"]) is list and o["conservados"] == conservados_del_estado(o["estado"]))


def _rechazo(o: dict[str, Any]) -> None:
    exigir(o["huellaPaquete"] is None)
    if o["error"] == "actualizacion_no_admitida":
        exigir(o["estado"] is not None and o["veredicto"] is not None)
    else:
        exigir(o["error"] in ("actualizacion_no_completada", "candidato_no_verificable"))
        exigir(o["estado"] is None and o["veredicto"] is None)


def _recibo(contenido: bytes) -> dict[str, Any]:
    documento = _json(contenido, MAX_RECIBO_BYTES)
    campos = "version,solicitudId,revisionReserva,accion,resultado,veredicto,terminadoEn,estado,huellaPaquete,error"
    version = documento.get("version") if isinstance(documento, dict) else None
    con_catalogo = type(version) is int and version >= VERSION_RECIBO_CATALOGO
    con_conservados = type(version) is int and version >= VERSION_RECIBO_CONSERVADOS
    o = objeto(documento, campos + (",catalogo" if con_catalogo else "") + (",conservados" if con_conservados else ""))
    exigir(type(o["version"]) is int and o["version"] in VERSIONES_RECIBO)
    hexa(o["solicitudId"], UUID)
    _entero(o["revisionReserva"], 1)
    exigir(o["accion"] in (ACCIONES_V1 if o["version"] == 1 else ACCIONES))
    instante(o["terminadoEn"])
    _resultado(o)
    if o["version"] >= VERSION_RECIBO_CATALOGO and o["catalogo"] is not None:
        from plataforma_datos.cursos.panel_catalogo import validar

        exigir(o["estado"] is not None)
        try:
            validar(o["catalogo"])
        except ValueError:
            raise AlmacenTrabajoInvalido(ERROR) from None
        fechas = [o["catalogo"]["corteRegistro"], o["catalogo"]["corteProyeccion"]]
        fechas.extend(r["fecha"] for r in o["catalogo"]["referencias"])
        fechas.extend(
            f[c]
            for f in o["catalogo"]["unidades"]
            for c in ("comprobadoEl", "evaluadoEl", "ultimoIntentoEl", "ultimoFinEl")
        )
        from plataforma_datos.cursos.vigencia import instante_utc

        limite = instante_utc(o["terminadoEn"], "cierre de recibo").replace(microsecond=999999)
        exigir(all(f is None or instante_utc(f, "fecha privada") <= limite for f in fechas))
    return o


def _referencia(valor: object) -> dict[str, Any]:
    o = objeto(valor, "version,revisionReserva,trabajo,baseOperativa,ultimaValidada,bloqueoOperativo")
    exigir(type(o["version"]) is int and o["version"] == 1 and type(o["bloqueoOperativo"]) is bool)
    _entero(o["revisionReserva"])
    _generacion(o["baseOperativa"])
    _generacion(o["ultimaValidada"])
    if o["trabajo"] is None:
        exigir(o["revisionReserva"] == 0 and not o["bloqueoOperativo"])
        exigir(o["baseOperativa"] == o["ultimaValidada"])
    else:
        exigir(_tupla(o["trabajo"])["revisionReserva"] == o["revisionReserva"])
    return _json(_bytes(o), MAX_CONTROL_BYTES)


def _vinculo_blob(valor: object, limite: int) -> dict[str, Any]:
    r = objeto(valor, "sha256,bytes")
    hexa(r["sha256"], SHA256)
    _entero(r["bytes"], 1)
    exigir(r["bytes"] <= limite)
    return r


def _vinculo_contenido(contenido: bytes) -> dict[str, Any]:
    return {"sha256": hashlib.sha256(contenido).hexdigest(), "bytes": len(contenido)}


def _bytes_ordenados(valor: dict) -> bytes:
    # El orden de todas las claves forma parte de los bytes autenticados del recibo.
    return json.dumps(valor, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode()


def _leer_sobre(contenido: bytes) -> dict[str, Any]:
    o = objeto(_json(contenido, MAX_SOBRE_RECIBO_BYTES), "version,recibo,catalogo,corteProyeccion,revision")
    exigir(type(o["version"]) is int and o["version"] == 1)
    _vinculo_blob(o["catalogo"], MAX_PIEZA_CATALOGO_BYTES)
    exigir(
        type(o["recibo"]) is dict
        and type(o["recibo"].get("version")) is int
        and o["recibo"]["version"] in (VERSION_RECIBO_CATALOGO, VERSION_RECIBO_CONSERVADOS)
    )
    exigir(o["recibo"].get("catalogo", False) is None)
    hexa(o["revision"], SHA256)
    from plataforma_datos.cursos.vigencia import instante_utc

    instante_utc(o["corteProyeccion"], "corte original conservado")
    return o


def _reconstruir_recibo(sobre: dict, pieza: bytes) -> bytes:
    catalogo = _json(pieza, MAX_PIEZA_CATALOGO_BYTES)
    exigir("corteProyeccion" in catalogo and catalogo["corteProyeccion"] is None)
    exigir("revision" in catalogo and catalogo["revision"] is None)
    catalogo["corteProyeccion"] = sobre["corteProyeccion"]
    catalogo["revision"] = sobre["revision"]
    recibo = dict(sobre["recibo"])
    recibo["catalogo"] = catalogo
    contenido = _bytes_ordenados(recibo)
    exigir(len(contenido) <= MAX_RECIBO_BYTES)
    return contenido


def _factorizar_recibo(contenido: bytes, recibo: dict) -> tuple[bytes, bytes] | None:
    if recibo["version"] < VERSION_RECIBO_CATALOGO or recibo["catalogo"] is None:
        return None
    catalogo = dict(recibo["catalogo"])
    corte, revision = catalogo["corteProyeccion"], catalogo["revision"]
    catalogo.update(corteProyeccion=None, revision=None)
    pieza = _bytes_ordenados(catalogo)
    sobre = {
        "version": 1,
        "recibo": {**recibo, "catalogo": None},
        "catalogo": _vinculo_contenido(pieza),
        "corteProyeccion": corte,
        "revision": revision,
    }
    compacto = _bytes_ordenados(sobre)
    if len(compacto) > MAX_SOBRE_RECIBO_BYTES or _reconstruir_recibo(sobre, pieza) != contenido:
        # Espacios, escapes u otro formato legítimo: conservar los bytes literales existentes.
        return None
    exigir(len(pieza) <= MAX_PIEZA_CATALOGO_BYTES)
    return pieza, compacto


def _guardar_blob(contenido: bytes, almacen: AlmacenTrabajos) -> None:
    vinculo = _vinculo_contenido(contenido)
    with tempfile.TemporaryDirectory(prefix=".conservando-recibo-") as nombre:
        ruta = Path(nombre) / "blob"
        ruta.write_bytes(contenido)
        almacen.guardar(f"blobs/{vinculo['sha256']}", ruta, vinculo["sha256"], vinculo["bytes"])


def _leer_blob(vinculo: dict, limite: int, almacen: AlmacenTrabajos) -> bytes:
    r = _vinculo_blob(vinculo, limite)
    with tempfile.TemporaryDirectory(prefix=".recibo-trabajo-") as nombre:
        ruta = Path(nombre) / "blob"
        almacen.recuperar(f"blobs/{r['sha256']}", ruta, r["sha256"], r["bytes"])
        with os.fdopen(os.open(ruta, os.O_RDONLY | os.O_NOFOLLOW), "rb") as archivo:
            estado = os.fstat(archivo.fileno())
            exigir(stat.S_ISREG(estado.st_mode) and estado.st_nlink == 1 and estado.st_size == r["bytes"])
            contenido = archivo.read(r["bytes"] + 1)
    exigir(_vinculo_contenido(contenido) == r)
    return contenido


def _descriptor(valor: object) -> dict[str, Any]:
    exigir(
        type(valor) is dict
        and type(valor.get("version")) is int
        and valor["version"] in (1, VERSION_INDICE, VERSION_INDICE_COMPACTO)
    )
    claves = (
        "version,solicitudId,revisionReserva,runId,runAttempt,accion,revisionCodigo,"
        "base,ultimaValidadaAnterior,recibo,generacion"
    )
    o = objeto(valor, claves + (",artefacto" if valor["version"] >= VERSION_INDICE else ""))
    exigir(o["runAttempt"] == "1")
    _tupla({k: o[k] for k in ("solicitudId", "revisionReserva", "runId")})
    exigir(o["accion"] in (ACCIONES_V1 if o["version"] == 1 else ACCIONES))
    hexa(o["revisionCodigo"], REVISION)
    _generacion(o["base"])
    _generacion(o["ultimaValidadaAnterior"])
    r = objeto(o["recibo"], "sha256,bytes,composicion" if o["version"] == VERSION_INDICE_COMPACTO else "sha256,bytes")
    hexa(r["sha256"], SHA256)
    _entero(r["bytes"], 1)
    exigir(r["bytes"] <= MAX_RECIBO_BYTES)
    if o["version"] == VERSION_INDICE_COMPACTO:
        _vinculo_blob(r["composicion"], MAX_SOBRE_RECIBO_BYTES)
    if o["generacion"] is not None:
        _generacion(o["generacion"])
    if o["version"] >= VERSION_INDICE and o["artefacto"] is not None:
        _artefacto(o["artefacto"])
    return o


def leer_referencia_exacta(almacen: AlmacenTrabajos) -> tuple[dict[str, Any], str, bytes]:
    """Lee la referencia con lo necesario para una CAS: su ETag y sus bytes exactos.

    Returns:
        Documento validado, ETag opaco de esta lectura y bytes leídos.
    """
    leido = almacen.leer_control(REFERENCIA, MAX_CONTROL_BYTES)
    exigir(leido is not None)
    contenido, etag = leido
    return _referencia(_json(contenido, MAX_CONTROL_BYTES)), etag, contenido


def leer_referencia(almacen: AlmacenTrabajos) -> dict[str, Any]:
    """Lee sin reinicializar ni omitir el bloqueo operativo.

    Returns:
        Copia completa del documento privado validado.
    """
    return leer_referencia_exacta(almacen)[0]


def _manifestado(generacion: dict[str, Any], almacen: AlmacenTrabajos) -> dict[str, Any]:
    with tempfile.TemporaryDirectory(prefix=".manifiesto-trabajo-") as nombre:
        temporal = Path(nombre)
        huella = generacion["sha256Manifiesto"]
        almacen.recuperar(f"generaciones/{huella}.json", temporal / "manifiesto.json", huella, MAX_MANIFIESTO_BYTES)
        return leer_manifiesto_generacion(temporal, generacion["revisionCodigo"], huella)


def _conservacion(descriptor: dict[str, Any], recibo: dict[str, Any], almacen: AlmacenTrabajos) -> None:
    generacion = descriptor["generacion"]
    validado = recibo["resultado"] == "validado"
    exigir(not validado or generacion is not None)
    if recibo["resultado"] == "sin-pendientes":
        exigir(generacion == descriptor["base"])
    elif generacion is not None:
        exigir(generacion["revisionCodigo"] == descriptor["revisionCodigo"])
    artefacto = descriptor.get("artefacto")
    if descriptor["version"] >= VERSION_INDICE:
        exigir((artefacto is not None) == validado)
    manifiesto = _manifestado(generacion, almacen) if generacion is not None else None
    if artefacto is not None:
        exigir(artefacto["revisionCodigo"] == descriptor["revisionCodigo"])
        exigir(artefacto["huellaPaquete"] == recibo["huellaPaquete"])
        contenido = leer_descriptor_artefacto(
            artefacto["revisionCodigo"], artefacto["huellaPaquete"], artefacto["sha256Artefacto"], almacen
        )
        exigir(manifiesto["manifiestoPaqueteSha256"] == contenido["sha256ManifiestoPaquete"])


def escribir_confirmado(clave: str, contenido: bytes, etag: str | None, almacen: AlmacenTrabajos) -> None:
    """Escribe un control condicionalmente: crea si `etag` es None y, si no, exige ese ETag (If-Match).

    Una respuesta perdida no implica fallo de la escritura; solo la lectura exacta posterior la confirma.

    Raises:
        ConflictoReferencia: Si después de escribir la clave no contiene exactamente esos bytes.
    """
    with suppress(OSError):
        almacen.guardar_control(clave, contenido, etag)
    lectura = almacen.leer_control(clave, MAX_CONTROL_BYTES)
    if lectura is None or lectura[0] != contenido:
        raise ConflictoReferencia(ERROR)


def inicializar_referencia(base: dict[str, Any], almacen: AlmacenTrabajos) -> dict[str, Any]:
    """Bootstrap explícito de una base autorizada; no reemplaza ninguna referencia, ni siquiera inválida.

    Returns:
        Referencia inicial confirmada mediante lectura exacta.
    """
    base = _generacion(base)
    _manifestado(base, almacen)
    documento = {
        "version": 1,
        "revisionReserva": 0,
        "trabajo": None,
        "baseOperativa": base,
        "ultimaValidada": base,
        "bloqueoOperativo": False,
    }
    escribir_confirmado(REFERENCIA, _bytes(documento), None, almacen)
    return documento


def recuperar_trabajo(
    solicitud_id: str, revision_reserva: int, run_id: str, almacen: AlmacenTrabajos
) -> tuple[dict[str, Any], bytes] | None:
    """Obtiene índice/recibo exactos sin motor; después conservar_trabajo debe confirmar la referencia CAS.

    Returns:
        Descriptor y bytes exactos, o None exclusivamente si no existe el índice.
    """
    tupla = _tupla({"solicitudId": solicitud_id, "revisionReserva": revision_reserva, "runId": run_id})
    lectura = almacen.leer_control(_clave(tupla), MAX_CONTROL_BYTES)
    if lectura is None:
        return None
    descriptor = _descriptor(_json(lectura[0], MAX_CONTROL_BYTES))
    exigir(all(descriptor[k] == v for k, v in tupla.items()))
    r = descriptor["recibo"]
    if descriptor["version"] == VERSION_INDICE_COMPACTO:
        sobre = _leer_blob(r["composicion"], MAX_SOBRE_RECIBO_BYTES, almacen)
        datos = _leer_sobre(sobre)
        pieza = _leer_blob(datos["catalogo"], MAX_PIEZA_CATALOGO_BYTES, almacen)
        contenido = _reconstruir_recibo(datos, pieza)
    else:
        contenido = _leer_blob(r, MAX_RECIBO_BYTES, almacen)
    exigir(len(contenido) == r["bytes"] and hashlib.sha256(contenido).hexdigest() == r["sha256"])
    recibo = _recibo(contenido)
    exigir(all(recibo[k] == descriptor[k] for k in ("solicitudId", "revisionReserva", "accion")))
    if descriptor["version"] >= VERSION_INDICE:
        _conservacion(descriptor, recibo, almacen)
    return descriptor, contenido


def _nueva_referencia(descriptor: dict[str, Any], recibo: dict[str, Any]) -> dict[str, Any]:
    generacion = descriptor["generacion"]
    return {
        "version": 1,
        "revisionReserva": descriptor["revisionReserva"],
        "trabajo": {k: descriptor[k] for k in ("solicitudId", "revisionReserva", "runId")},
        "baseOperativa": generacion or descriptor["base"],
        "ultimaValidada": generacion if recibo["resultado"] == "validado" else descriptor["ultimaValidadaAnterior"],
        # Un rechazo sin generación conservada deja la base operativa como estaba, que sigue verificada: no bloquea.
        "bloqueoOperativo": False,
    }


def _avanzar(
    descriptor: dict[str, Any],
    recibo: dict[str, Any],
    esperada: dict[str, Any],
    repetido: bool,
    almacen: AlmacenTrabajos,
) -> None:
    actual, etag, _contenido = leer_referencia_exacta(almacen)
    tupla = {k: descriptor[k] for k in ("solicitudId", "revisionReserva", "runId")}
    if actual["revisionReserva"] > descriptor["revisionReserva"]:
        raise ConflictoReferencia(ERROR)
    if actual["trabajo"] == tupla:
        confirmada, generacion_ausente = _nueva_referencia(descriptor, recibo), descriptor["generacion"] is None
        # Al repetir vale también la referencia que bloqueó un rechazo sin generación: no se escribe nada.
        bloqueada = {**confirmada, "bloqueoOperativo": recibo["resultado"] == "rechazado" and generacion_ausente}
        exigir(repetido and actual in (confirmada, bloqueada))
        return
    if actual != esperada or actual["revisionReserva"] >= descriptor["revisionReserva"]:
        raise ConflictoReferencia(ERROR)
    exigir(not actual["bloqueoOperativo"] and actual["baseOperativa"] == descriptor["base"])
    exigir(actual["ultimaValidada"] == descriptor["ultimaValidadaAnterior"])
    nueva = _nueva_referencia(descriptor, recibo)
    escribir_confirmado(REFERENCIA, _bytes(nueva), etag, almacen)


def conservar_trabajo(  # noqa: PLR0913 - Expectativas explícitas del recibo, código, base y generación; almacén keyword-only.
    recibo: bytes,
    run_id: str,
    revision_codigo: str,
    base_esperada: dict[str, Any],
    generacion: dict[str, Any] | None,
    *,
    artefacto: dict[str, Any] | None = None,
    almacen: AlmacenTrabajos,
) -> dict[str, Any]:
    """Confirma contenido→índice→CAS antes de la llamada de retorno; repetir no ejecuta motor ni revierte bases.

    Returns:
        Descriptor inmutable; no afirma activación de datos.
    """
    resultado = _recibo(recibo)
    previa = _referencia(base_esperada)
    hexa(revision_codigo, REVISION)
    tupla = _tupla(
        {"solicitudId": resultado["solicitudId"], "revisionReserva": resultado["revisionReserva"], "runId": run_id}
    )
    existente = recuperar_trabajo(tupla["solicitudId"], tupla["revisionReserva"], run_id, almacen)
    if generacion is not None:
        generacion = _generacion(generacion)
    if artefacto is not None:
        artefacto = _artefacto(artefacto)
    compacto = _factorizar_recibo(recibo, resultado)
    version = existente[0]["version"] if existente else (VERSION_INDICE_COMPACTO if compacto else VERSION_INDICE)
    if version != VERSION_INDICE_COMPACTO:
        compacto = None
    exigir(version != VERSION_INDICE_COMPACTO or compacto is not None)
    exigir(version != 1 or artefacto is None)
    huella = hashlib.sha256(recibo).hexdigest()
    descriptor = {
        "version": version,
        **tupla,
        "runAttempt": "1",
        "accion": resultado["accion"],
        "revisionCodigo": revision_codigo,
        "base": existente[0]["base"] if existente else previa["baseOperativa"],
        "ultimaValidadaAnterior": existente[0]["ultimaValidadaAnterior"] if existente else previa["ultimaValidada"],
        "recibo": {"sha256": huella, "bytes": len(recibo)},
        "generacion": generacion,
    }
    if compacto is not None:
        descriptor["recibo"]["composicion"] = _vinculo_contenido(compacto[1])
    if version >= VERSION_INDICE:
        descriptor["artefacto"] = artefacto
    if existente:
        exigir(existente == (descriptor, recibo))
        if version == 1:
            _conservacion(descriptor, resultado, almacen)
    else:
        exigir(not previa["bloqueoOperativo"] and previa["revisionReserva"] < tupla["revisionReserva"])
        _conservacion(descriptor, resultado, almacen)
        for contenido in compacto if compacto is not None else (recibo,):
            _guardar_blob(contenido, almacen)
        escribir_confirmado(_clave(tupla), _bytes(descriptor), None, almacen)
    _avanzar(descriptor, resultado, previa, existente is not None, almacen)
    return descriptor
