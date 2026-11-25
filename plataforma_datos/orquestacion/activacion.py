"""Activa el artefacto conservado de una reserva; las fases durables preceden a cada efecto.

Publica en una sola intención los dos Workers que lleva el artefacto: primero el de Cursos, que lleva dentro el
paquete de la formación, y después el principal. Así la activación termina con los dos en el mismo paquete o queda en
una fase explícita. No ejecuta el motor ni modifica la referencia operativa. Un comienzo ambiguo solo se reconcilia
mediante observaciones; ninguna repetición devuelve permiso para subir o desplegar otra vez.
"""

import hashlib
import tempfile
from pathlib import Path
from typing import Any

from plataforma_datos.orquestacion.abandono_activacion import abandonar_si_sirve_lo_anterior, observado
from plataforma_datos.orquestacion.adaptador_versiones import (
    AdaptadorVersiones,
    ConfiguracionActivacion,
    desplegado,
    version_unica,
)
from plataforma_datos.orquestacion.almacen_artefactos import recuperar_artefacto
from plataforma_datos.orquestacion.almacen_trabajos import (
    MAX_CONTROL_BYTES,
    VERSION_INDICE,
    VERSION_INDICE_COMPACTO,
    AlmacenTrabajos,
    recuperar_trabajo,
)
from plataforma_datos.orquestacion.cierre_activacion import cumplir_cierre
from plataforma_datos.orquestacion.cliente_mantenimiento import ClienteMantenimientoGitHub
from plataforma_datos.orquestacion.consumidor_activacion import Consumidor
from plataforma_datos.orquestacion.contrato_activacion import (
    ERROR,
    CandidatoNoVerificable,
    ErrorActivacion,
    RechazoPrevioActivacion,
    RechazoSinEfecto,
    ServidoDistinto,
    exigir,
    json_estricto,
)
from plataforma_datos.orquestacion.lectura_activacion import (
    CURSOS,
    INCIERTAS,
    PRINCIPAL,
    TERMINALES,
    Servicio,
    anterior,
    dos_servicios,
    leer_estado,
    servicios,
    sirve_lo_anterior,
)
from plataforma_datos.orquestacion.reintento_activacion import (
    SIN_ARTEFACTO,
    es_reintento_de,
    reintento_de,
    reintento_previsto,
    trabajo_abandonado,
)
from plataforma_datos.orquestacion.variante_del_artefacto import descriptor_de_la_variante


def _candidato(condicion: bool) -> None:
    if not condicion:
        raise CandidatoNoVerificable(ERROR)


def _resolver(consumidor: Consumidor, almacen: AlmacenTrabajos, destino: Path) -> dict[str, Any]:
    actual, ejecucion = consumidor.actual, consumidor.configuracion.ejecucion
    trabajo = actual["trabajo"]
    existente = consumidor.trabajo_conservado
    exigir(existente is not None)
    indice, recibo = existente
    _candidato(indice["version"] in (VERSION_INDICE, VERSION_INDICE_COMPACTO))
    _candidato(indice["revisionCodigo"] == trabajo["confianza"]["sha"])
    _candidato(indice["accion"] == trabajo["accion"] and indice["runAttempt"] == "1")
    _candidato(hashlib.sha256(recibo).hexdigest() == trabajo["huellaRecibo"])
    contenido = json_estricto(recibo)
    _candidato(contenido["resultado"] == "validado" and trabajo["resultado"]["resultado"] == "validado")
    _candidato(contenido["huellaPaquete"] == trabajo["resultado"]["huellaPaquete"])
    clave = f"trabajos/{trabajo['solicitudId']}/{trabajo['revisionReserva']}/{trabajo['runId']}.json"
    lectura = almacen.leer_control(clave, MAX_CONTROL_BYTES)
    exigir(lectura is not None)
    _candidato(json_estricto(lectura[0]) == indice)
    artefacto = indice["artefacto"]
    _candidato(type(artefacto) is dict and indice["generacion"] is not None)
    # Antes de descargar el artefacto y de cualquier lectura o efecto en Cloudflare con él.
    descriptor = descriptor_de_la_variante(artefacto, ejecucion.variante_cloudflare, almacen)
    recuperar_artefacto(
        destino, artefacto["revisionCodigo"], artefacto["huellaPaquete"], artefacto["sha256Artefacto"], almacen
    )
    return {
        "sha256Indice": hashlib.sha256(lectura[0]).hexdigest(),
        "sha256ManifiestoWeb": descriptor["sha256ManifiestoDispositivo"],
        "generacion": indice["generacion"],
        "artefacto": artefacto,
    }


def _confirmar_cursos(consumidor: Consumidor, adaptador: AdaptadorVersiones) -> None:
    observado = desplegado(adaptador, CURSOS)
    exigir(observado["versionId"] == consumidor.actual[CURSOS.version])
    consumidor.transicion(
        "paso",
        {
            "tipo": CURSOS.confirmado,
            CURSOS.version: observado["versionId"],
            CURSOS.deployment: observado["deploymentId"],
        },
    )


def _confirmar(consumidor: Consumidor, adaptador: AdaptadorVersiones) -> None:
    actual = consumidor.actual
    if dos_servicios(actual):
        # La misma versión de Cursos es el mismo paquete; el despliegue puede ser otro si se volvió a desplegar a mano.
        exigir(desplegado(adaptador, CURSOS)["versionId"] == actual[CURSOS.version])
    observado = adaptador.operar("estado", servicio=PRINCIPAL.nombre)
    exigir(version_unica(observado) == actual["versionId"])
    exigir(consumidor.cliente.observar_construccion() == actual["versionId"])
    web_sha = actual["evidencia"]["sha256ManifiestoWeb"]
    consumidor.cliente.comprobar_manifiesto_web(
        consumidor.configuracion.origen_publico, web_sha, version_id=actual["versionId"]
    )
    consumidor.transicion(
        "paso",
        {
            "tipo": "confirmada",
            "deploymentId": observado["deploymentId"],
            "versionId": actual["versionId"],
            "sha256ManifiestoWeb": web_sha,
        },
    )


def _reconciliar(consumidor: Consumidor, adaptador: AdaptadorVersiones) -> None:
    """Cierra una fase incierta solo con lo que se observa en el Worker de esa fase; nunca repite su efecto."""
    actual = consumidor.actual
    servicio = next((s for s in servicios(actual) if actual["fase"] in (s.subiendo, s.promoviendo)), None)
    if servicio is None:
        return
    if actual["fase"] == servicio.subiendo:
        versiones = adaptador.operar("versiones", servicio=servicio.nombre)
        sha256 = actual["evidencia"]["artefacto"]["sha256Artefacto"]
        coincidencias = [
            v
            for v in versiones["versiones"]
            if v["tag"] == consumidor.configuracion.ejecucion.solicitud_id and v["message"] == sha256
        ]
        exigir(len(coincidencias) == 1)
        consumidor.transicion("paso", {"tipo": servicio.subida, servicio.version: coincidencias[0]["versionId"]})
    elif servicio is CURSOS:
        _confirmar_cursos(consumidor, adaptador)
    else:
        _confirmar(consumidor, adaptador)


def activar_trabajo(
    configuracion: ConfiguracionActivacion,
    cliente: ClienteMantenimientoGitHub,
    almacen: AlmacenTrabajos,
    *,
    reconciliar: bool = False,
    recuperar: bool = False,
) -> dict[str, Any]:
    """Consume el artefacto exacto con permiso CAS; recuperar cerca intentos anteriores.

    Reconciliar solo observa. Recuperar observa fases inciertas antes de continuar las seguras;
    nunca ejecuta el motor, crea una activación ausente ni repite un efecto incierto.

    Returns:
        Resumen privado confirmado; una fase pendiente nunca se presenta como publicación.

    Raises:
        RechazoPrevioActivacion: Invalidez demostrada, conservada como rechazo solo antes de efectos.
    """
    exigir(not (recuperar and reconciliar))
    modo = "recuperar" if recuperar else "reconciliar" if reconciliar else "activar"
    return _consumir(configuracion, cliente, almacen, modo)


def _consumir(
    configuracion: ConfiguracionActivacion, cliente: ClienteMantenimientoGitHub, almacen: AlmacenTrabajos, modo: str
) -> dict[str, Any]:
    ejecucion = configuracion.ejecucion
    recuperar, reconciliar = modo == "recuperar", modo == "reconciliar"
    exigir(recuperar == ejecucion.recuperacion_activacion)
    existente = recuperar_trabajo(ejecucion.solicitud_id, ejecucion.revision_reserva, ejecucion.run_id, almacen)
    exigir(existente is not None)
    indice, recibo = existente
    exigir(indice["revisionCodigo"] == ejecucion.revision_codigo and indice["accion"] == ejecucion.accion)
    resultado = json_estricto(recibo)["resultado"]
    consumidor = Consumidor(configuracion, cliente)
    # Antes de nada, el cierre que alguien pidió desde el panel para esta ejecución, si lo hay; el resumen lo dice.
    cierre = cumplir_cierre(consumidor) if modo == "activar" else None
    detalle = {} if cierre is None else {"cierre": cierre}
    if resultado == "sin-pendientes":
        return {**_reintentar(consumidor, almacen, modo), **detalle}
    if resultado != "validado":
        exigir(not recuperar)
        return _omitida(configuracion, resultado, **detalle)
    consumidor.trabajo_conservado = existente
    if not reconciliar and not recuperar:
        consumidor.transicion("reservar")
    return {**_publicar_conservado(consumidor, almacen, modo), **detalle}


def _omitida(configuracion: ConfiguracionActivacion, resultado: str, **detalle: str) -> dict[str, Any]:
    ejecucion = configuracion.ejecucion
    return {
        "version": 1,
        "fase": "omitida",
        "resultado": resultado,
        "solicitudId": ejecucion.solicitud_id,
        "revisionReserva": ejecucion.revision_reserva,
        "runId": ejecucion.run_id,
        **detalle,
    }


def _reintentar(consumidor: Consumidor, almacen: AlmacenTrabajos, modo: str) -> dict[str, Any]:
    """Sin pendientes: reintenta una vez la abandonada por `rechazo-previo`, o continúa el reintento propio.

    Un relevo o una reconciliación solo continúan el reintento que pidió esta ejecución; nunca crean otro.

    Returns:
        Resumen de la publicación reintentada, o la omisión con el motivo si no hay nada que reintentar.
    """
    configuracion = consumidor.configuracion
    previa = consumidor.estado["ultimaActivacion"]
    propio = es_reintento_de(previa, consumidor.referencia())
    # Un relevo puede pedir el reintento que su primer intento no llegó a pedir; una reconciliación, nunca.
    if not propio and (modo == "reconciliar" or not reintento_previsto(previa)):
        exigir(modo != "recuperar")
        return _omitida(configuracion, "sin-pendientes")
    existente = trabajo_abandonado(previa["trabajo"], almacen)
    if existente is None and not propio:
        # Sin el trabajo o su artefacto no hay nada exacto que publicar: no se reintenta, se anota y se dice.
        _descartar(consumidor, previa)
        return _omitida(configuracion, "sin-pendientes", reintento=SIN_ARTEFACTO)
    consumidor.trabajo_conservado = existente
    if not propio:
        consumidor.transicion("reintentar", reintento=reintento_de(previa["trabajo"]))
        exigir(consumidor.actual["trabajo"] == previa["trabajo"] and consumidor.actual["fase"] == "reservada")
    return _publicar_conservado(consumidor, almacen, modo)


def _descartar(consumidor: Consumidor, previa: dict[str, Any]) -> None:
    """Anota en la abandonada que su reintento no se pudo hacer, para que el panel no lo siga prometiendo."""
    solicitud = {
        **consumidor.referencia(),
        "revisionEsperada": consumidor.estado["revision"],
        "reintentoDe": reintento_de(previa["trabajo"]),
        "descartado": SIN_ARTEFACTO,
    }
    respuesta = consumidor.cliente.activacion("reintentar", solicitud)
    exigir(respuesta["estado"] == "aplicado")
    actual = leer_estado(respuesta)["ultimaActivacion"]
    exigir(actual is not None and actual.get("reintentoDescartado") == SIN_ARTEFACTO)


def _publicar_conservado(consumidor: Consumidor, almacen: AlmacenTrabajos, modo: str) -> dict[str, Any]:
    configuracion = consumidor.configuracion
    recuperar, reconciliar = modo == "recuperar", modo == "reconciliar"
    raiz = configuracion.ejecucion.directorio_trabajo
    with tempfile.TemporaryDirectory(prefix="activacion-", dir=raiz) as nombre:
        directorio = Path(nombre)
        adaptador = AdaptadorVersiones(configuracion, directorio)
        if reconciliar:
            if consumidor.actual["fase"] in INCIERTAS:
                destino = directorio / "artefacto"
                evidencia = _resolver(consumidor, almacen, destino)
                exigir(all(consumidor.actual["evidencia"][k] == v for k, v in evidencia.items()))
                adaptador.artefacto = {"ruta": str(destino), **evidencia["artefacto"]}
                _reconciliar(consumidor, adaptador)
        else:
            try:
                if recuperar:
                    _recuperar_activacion(consumidor, adaptador, almacen, directorio / "artefacto")
                else:
                    _activar(consumidor, adaptador, almacen, directorio / "artefacto")
            except RechazoPrevioActivacion as error:
                _rechazar_sin_efectos(consumidor, error)
                raise
    actual = consumidor.actual
    return {
        "version": 1,
        "fase": actual["fase"],
        **consumidor.referencia(),
        "versionId": actual["versionId"],
        "deploymentId": actual["deploymentId"],
    }


def _rechazar_sin_efectos(consumidor: Consumidor, error: RechazoPrevioActivacion) -> None:
    """Cierra como rechazada una intención que aún no lanzó ningún efecto; con efectos, la deja en su fase.

    Al recuperar, el rechazo se registra con el relevo de este intento, igual que cualquier otro paso.
    """
    actual, ejecucion = consumidor.actual, consumidor.configuracion.ejecucion
    if actual["fase"] not in ("reservada", "preparada"):
        return
    if ejecucion.recuperacion_activacion and actual.get("recuperacion", {}).get("intento") != ejecucion.run_attempt:
        consumidor.transicion("recuperar")
    consumidor.transicion("paso", {"tipo": "rechazar", "error": error.codigo})


def _recuperar_activacion(
    consumidor: Consumidor, adaptador: AdaptadorVersiones, almacen: AlmacenTrabajos, destino: Path
) -> None:
    evidencia = _resolver(consumidor, almacen, destino)
    actual = consumidor.actual
    if actual["evidencia"] is not None:
        _candidato(all(actual["evidencia"][k] == v for k, v in evidencia.items()))
    adaptador.artefacto = {"ruta": str(destino), **evidencia["artefacto"]}
    if actual["fase"] == "preparada":
        # Sin efectos todavía: cada Worker debe seguir sirviendo lo que servía al preparar; si no, escribió otro.
        for servicio in servicios(actual):
            exigir(desplegado(adaptador, servicio) == anterior(actual["evidencia"], servicio, dos_servicios(actual)))
    consumidor.transicion("recuperar")
    if consumidor.actual["fase"] in INCIERTAS:
        _reconciliar(consumidor, adaptador)
    _activar(consumidor, adaptador, almacen, destino, evidencia_verificada=evidencia)


def _preparar(consumidor: Consumidor, adaptador: AdaptadorVersiones, evidencia: dict[str, Any]) -> None:
    actual = consumidor.actual
    previos = {servicio.nombre: desplegado(adaptador, servicio) for servicio in servicios(actual)}
    evidencia["anterior"] = previos if dos_servicios(actual) else previos[PRINCIPAL.nombre]
    # Un reintento solo sigue si la web sirve lo mismo que al abandonar: no deshace lo publicado entre medias.
    if "reintento" in actual and not sirve_lo_anterior(
        actual["reintento"]["observado"], evidencia["anterior"], dos_servicios(actual)
    ):
        raise ServidoDistinto(ERROR)
    consumidor.transicion("paso", {"tipo": "preparar", "evidencia": evidencia})


def _publicar(consumidor: Consumidor, adaptador: AdaptadorVersiones, servicio: Servicio, inicio: str) -> None:
    """Sube y despliega un Worker; cada efecto va precedido de su fase aplicada y seguido de su evidencia."""
    if consumidor.actual["fase"] == inicio:
        exigir(consumidor.transicion("paso", {"tipo": servicio.subiendo}) == "aplicado")
        try:
            subida = adaptador.operar("subir", servicio=servicio.nombre)
        except RechazoSinEfecto as rechazo:
            _cerrar_sin_efecto(consumidor, adaptador, rechazo)
            return
        consumidor.transicion("paso", {"tipo": servicio.subida, servicio.version: subida["versionId"]})
    actual = consumidor.actual
    if actual["fase"] != servicio.subida:
        return
    # Desplegada ya a mano (por ejemplo, con su migración pendiente): se confirma por lo observado, sin desplegar.
    ya_servida = _sirve_sola(adaptador.operar("estado", servicio=servicio.nombre), actual[servicio.version])
    exigir(consumidor.transicion("paso", {"tipo": servicio.promoviendo}) == "aplicado")
    if not ya_servida and not _desplegar(consumidor, adaptador, servicio, actual):
        return
    (_confirmar_cursos if servicio is CURSOS else _confirmar)(consumidor, adaptador)


def _sirve_sola(estado: dict[str, Any], version: str) -> bool:
    versiones = estado["versiones"]
    return len(versiones) == 1 and versiones[0] == {"versionId": version, "porcentaje": 100}


def _desplegar(
    consumidor: Consumidor, adaptador: AdaptadorVersiones, servicio: Servicio, actual: dict[str, Any]
) -> bool:
    """Despliega la versión de la intención; un rechazo sin efecto la cierra o la detiene.

    Returns:
        Verdadero si el despliegue se lanzó y hay que confirmarlo por observación.
    """
    previo = anterior(actual["evidencia"], servicio, dos_servicios(actual))
    try:
        adaptador.operar(
            "desplegar",
            servicio=servicio.nombre,
            versionId=actual[servicio.version],
            anteriorDeploymentId=previo["deploymentId"],
        )
    except RechazoSinEfecto as rechazo:
        _cerrar_sin_efecto(consumidor, adaptador, rechazo)
        return False
    return True


def _cerrar_sin_efecto(consumidor: Consumidor, adaptador: AdaptadorVersiones, rechazo: RechazoSinEfecto) -> None:
    """El efecto en curso no se hizo: se abandona sola si lo servido es lo anterior; si no, queda en su fase.

    Raises:
        RechazoSinEfecto: Lo servido no es lo anterior (por ejemplo, Cursos ya publicado); su motivo lo explica.
    """
    try:
        visto = observado(adaptador, consumidor.actual)
    except ErrorActivacion:
        # No se pudo comprobar qué sirve cada Worker (despliegue repartido o pareja rota): se anota sin observación.
        consumidor.transicion("paso", {"tipo": "anotar-rechazo", "motivo": rechazo.motivo, "observado": None})
        raise rechazo from None
    visto = abandonar_si_sirve_lo_anterior(consumidor, rechazo.motivo, visto)
    if visto is not None:
        # Queda en su fase con el motivo y lo observado anotados: el panel dice que está detenida y qué se sirve.
        consumidor.transicion("paso", {"tipo": "anotar-rechazo", "motivo": rechazo.motivo, "observado": visto})
        raise rechazo


def _activar(
    consumidor: Consumidor,
    adaptador: AdaptadorVersiones,
    almacen: AlmacenTrabajos,
    destino: Path,
    *,
    evidencia_verificada: dict[str, Any] | None = None,
) -> None:
    fase = consumidor.actual["fase"]
    if fase in INCIERTAS:
        raise ErrorActivacion(ERROR)
    if fase in TERMINALES:
        return
    evidencia = evidencia_verificada if evidencia_verificada is not None else _resolver(consumidor, almacen, destino)
    adaptador.artefacto = {"ruta": str(destino), **evidencia["artefacto"]}
    if fase == "reservada":
        _preparar(consumidor, adaptador, evidencia)
    else:
        # Antes del primer efecto, una evidencia distinta demuestra otro candidato; después, solo detiene.
        coincide = all(consumidor.actual["evidencia"][k] == v for k, v in evidencia.items())
        (_candidato if fase == "preparada" else exigir)(coincide)
    inicio = "preparada"
    for servicio in servicios(consumidor.actual):
        _publicar(consumidor, adaptador, servicio, inicio)
        if consumidor.actual["fase"] == "abandonada":
            return
        inicio = servicio.confirmado
