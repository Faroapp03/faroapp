"""Hechos actuales Cibernàrium de la selección admitida de cada edición.

No busca capturas históricas favorables ni traslada HTML/idioma de otra edición.
La API de matrícula y las declaraciones generales conservan cada una la fecha de su captura.
"""

import sqlite3
from contextlib import closing
from http import HTTPStatus
from pathlib import Path

from plataforma_datos.comun.huella_json import sha256_json
from plataforma_datos.comun.nucleo import FormatoInesperado
from plataforma_datos.cursos import admision_catalogo as admision
from plataforma_datos.cursos import almacen_catalogo as almacen
from plataforma_datos.cursos.contrato_entrega_catalogo import exigir
from plataforma_datos.cursos.contrato_fichas import calendarios_edicion
from plataforma_datos.cursos.fuentes.barcelonactiva import (
    adquisicion,
    control_actual,
    declaraciones_actuales,
    identidades_actuales,
    matricula_actual,
    negocio_actual,
    observaciones_actuales,
)
from plataforma_datos.cursos.fuentes.barcelonactiva import robot_cibernarium as robot


def _captura(fila: dict, referencias: dict, area: Path) -> dict:
    salida = {"id": None}
    for campo in ("cuerpo", "recibo", "metadatos"):
        sha = fila[campo + "_sha256"]
        if sha is None and campo == "cuerpo":
            salida[campo] = None
            continue
        ref = referencias.get(sha)
        exigir(
            ref is not None and ref.ruta.absolute().is_relative_to(area), "Prueba Cibernàrium fuera del índice admitido"
        )
        salida[campo] = {"archivo": ref.ruta.absolute().relative_to(area).as_posix(), "sha256": sha}
    salida["intento"] = salida["recibo"]
    return salida


def _temporal(dato: dict, corte: str) -> dict | None:
    # Cada hecho conserva la fecha de su propia captura: matrícula y declaraciones generales
    # no se renuevan entre sí y el tiempo transcurrido no los anula.
    e = dato["evidencia"]
    if robot.fecha_utc(e["capturado_utc"]) > robot.fecha_utc(corte):
        return None
    return {**dato, "vigencia": {"comprobado_el": e["capturado_utc"]}}


def _referencia(e: dict) -> dict:
    return {
        "url": e["url"],
        "sha256": e["sha256"],
        "fecha_referencia": e["capturado_utc"],
        "alcance": "entidad",
        "naturaleza_fecha": "recepcion_conservada",
        "naturaleza_documento": "no_acreditada",
    }


def _normas(area: Path, seleccion: dict | None, referencias: dict, intento: dict) -> dict:
    cap = _captura(seleccion if seleccion is not None else intento, referencias, area)
    cuerpo, meta = adquisicion.pagina(area, cap)
    if seleccion is None:
        condiciones = {"formacion": None, "inscripcion": None}
    else:
        return _normas_identificadas(cuerpo, meta, cap)
    return _condiciones_desconocidas(condiciones, meta, cap, "normas_sin_seleccion_identificada")


def _normas_identificadas(cuerpo: bytes | None, meta: dict, cap: dict) -> dict:
    exigir(
        cuerpo is not None
        and meta["http"] == HTTPStatus.OK
        and meta["completo"] is True
        and meta["url"] in (adquisicion.NORMAS, robot.ORIGEN + "/normes")
        and meta["url_final"] == adquisicion.NORMAS
        and isinstance(meta.get("content_type"), str)
        and meta["content_type"].split(";", 1)[0].strip().lower() == "text/html",
        "Normas seleccionadas sin respuesta identificada",
    )
    try:
        condiciones = declaraciones_actuales.extraer(cuerpo, meta)
    except (FormatoInesperado, UnicodeDecodeError):
        condiciones = {"formacion": None, "inscripcion": None}
    return _condiciones_desconocidas(condiciones, meta, cap, "declaracion_general_no_interpretable")


def _condiciones_desconocidas(condiciones: dict, meta: dict, cap: dict, motivo: str) -> dict:
    documento = {
        "url": meta["url"],
        "capturado_utc": meta["fin_utc"],
        "sha256": cap["cuerpo"]["sha256"] if cap.get("cuerpo") is not None else cap["recibo"]["sha256"],
        "localizador": None,
    }
    return {
        "formacion": condiciones.get("formacion")
        or {
            "valor": None,
            "alcance": "declaracion_general",
            "motivo": motivo,
            "evidencia": documento,
        },
        "inscripcion": condiciones.get("inscripcion")
        or {
            "registro_previo_para_inscribirse": None,
            "alcance": "declaracion_general",
            "motivo": motivo,
            "evidencia": documento,
        },
    }


def _nativos(db: sqlite3.Connection, fila: dict, identidad: dict, actividad: dict) -> tuple[dict, dict]:
    edicion = db.execute("SELECT * FROM ediciones WHERE id=?", (fila["id"],)).fetchone()
    exigir(edicion is not None, "Control Cibernàrium sin edición nativa")
    edicion = negocio_actual.fila_nativa_verificada(edicion)
    programa = db.execute("SELECT * FROM programas WHERE id=?", (edicion["programa_id"],)).fetchone()
    exigir(programa is not None, "Edición Cibernàrium sin programa nativo")
    programa = negocio_actual.fila_nativa_verificada(programa)
    testigos = {}
    for e in actividad["listEditions"]:
        nativa = db.execute(
            "SELECT * FROM ediciones WHERE id=?", ("cibernarium-edicion:" + e["activityId"],)
        ).fetchone()
        if nativa is not None:
            testigos[nativa["id"]] = negocio_actual.fila_nativa_verificada(nativa)
    identidades_actuales.comprobar(identidad, actividad, {programa["id"]: programa}, testigos)
    exigir(
        programa["proveedor_id"] == "cibernarium"
        and programa["id"] == identidad["programa_id"]
        and edicion["datos"].get("activity_id") == fila["edicion_id"],
        "Control Cibernàrium de otro proveedor/actividad",
    )
    return programa, edicion


def _propia(
    area: Path, fila: dict, contexto: dict, referencias: dict, evaluacion: dict
) -> tuple[dict, dict, dict] | None:
    observacion = next((o for o in evaluacion["entradas"]["observaciones"] if o["id"] == fila["observacion_id"]), None)
    if observacion is None:
        return None
    captura = _captura(contexto["api"], referencias, area)
    oferta, reproducida = observaciones_actuales.construir(
        area, captura, actividad_id=fila["actividad_id"], edicion_id=fila["edicion_id"]
    )
    if reproducida != observacion or reproducida["detalle"]["datos_edicion"] is None:
        return None
    exigir(evaluacion["entradas"]["oferta"] == oferta, "Selección Cibernàrium con otra oferta de evaluación")
    actividades, _ = adquisicion.actividades(area, captura)
    actividad = next(a for a in actividades if a["activityId"] == fila["actividad_id"])
    edicion = next(e for e in actividad["listEditions"] if e["activityId"] == fila["edicion_id"])
    return reproducida, actividad, edicion


def _hechos(observacion: dict, corte: str, sesiones: list[dict]) -> dict:
    datos = observacion["detalle"]["datos_edicion"]
    pruebas = observacion["evidencias"]
    soporte = next(e for e in pruebas if e["alcance"] == "calendario")
    salida = {"referencias": [], "calendarios_propios": []}
    evidencia = {k: v for k, v in soporte.items() if k != "alcance"}
    for campo in ("modalidad", "sincronia"):
        if datos[campo] is not None:
            salida[campo] = _temporal({"valor": datos[campo], "alcance": "edicion", "evidencia": evidencia}, corte)
    for calendario in calendarios_edicion(datos):
        vinculo = calendario["vinculo_edicion"]
        if calendario["alcance"] != "edicion" or vinculo is None:
            continue
        exigir(vinculo["edicion"]["id"] == observacion["detalle"]["identidad_observada"], "Calendario de otra edición")
        valor = calendario["periodo"]
        if valor["tipo"] == "periodo-formativo" and evidencia["localizador"]["valor"].endswith("/listSessions"):
            if not sesiones:
                continue
            valor = {"tipo": "sesiones", "sesiones": [{k: sesion[k] for k in ("inicio", "fin")} for sesion in sesiones]}
        dato = _temporal(
            {
                "campo": calendario["campo"],
                "valor": valor,
                "alcance": "edicion",
                "vinculo_edicion": vinculo,
                "evidencia": evidencia,
            },
            corte,
        )
        if dato is not None:
            salida["calendarios_propios"].append(dato)
    if matricula_actual.CAMPO in observacion["detalle"] and matricula_actual.acreditada(observacion["detalle"]):
        metodo = observacion["detalle"][matricula_actual.CAMPO]
        prueba = pruebas[metodo["apoyos"]["registrationCode"]]
        salida["matricula_actual"] = _temporal(
            {
                "metodo": matricula_actual.METODO,
                "alcance": "edicion",
                "evidencia": {k: v for k, v in prueba.items() if k != "alcance"},
            },
            corte,
        )
    salida["referencias"].append(_referencia(evidencia))
    return {k: v for k, v in salida.items() if v is not None}


def selecciones_verificadas(
    solicitud: admision.SolicitudAdmision, ids_ediciones: set[str], referencias: dict, evaluaciones: dict, corte: str
) -> dict:
    """Reextrae la actividad y edición de la selección ligada a la evaluación admitida.

    Returns:
        Selecciones por edición; no acredita una clasificación de materia.
    """
    ref = solicitud.procedencia.get("control-cibernarium")
    if ref is None:
        return {}
    control = almacen.leer_documento_indexado(ref, referencias)
    control_actual.validar(control)
    area = solicitud.snapshot.ruta.parent.absolute()
    salida = {}
    with closing(sqlite3.connect(solicitud.snapshot.ruta.resolve().as_uri() + "?mode=ro&immutable=1", uri=True)) as db:
        db.row_factory = sqlite3.Row
        for fila in control["recepciones"]:
            id = fila["id"]
            if id not in ids_ediciones or evaluaciones.get(id) is None:
                continue
            contexto = control["contextos"][fila["contexto_sha256"]]
            propia = _propia(area, fila, contexto, referencias, evaluaciones[id])
            if propia is None:
                continue
            obs, actividad, edicion = propia
            if any(robot.fecha_utc(e["capturado_utc"]) > robot.fecha_utc(corte) for e in obs["evidencias"]):
                continue
            identidad = contexto["identidad"]
            programa, nativa = _nativos(db, fila, identidad, actividad)
            if (
                negocio_actual.proyectar(programa, actividad, None, identidad) != programa
                or negocio_actual.proyectar(nativa, actividad, edicion, identidad) != nativa
            ):
                continue
            salida[id] = {
                "observacion": obs,
                "actividad": actividad,
                "edicion": edicion,
                "identidad": identidad,
                "nativa": nativa,
                "contexto": contexto,
            }
    return salida


def actuales(
    solicitud: admision.SolicitudAdmision, ids_ediciones: set[str], referencias: dict, evaluaciones: dict, corte: str
) -> dict:
    """Proyecta hechos actuales desde la selección verificada de cada edición.

    Returns:
        Hechos por edición con sus fechas de comprobación propias.
    """
    area = solicitud.snapshot.ruta.parent.absolute()
    salida, normas = {}, {}
    for id, seleccion in selecciones_verificadas(solicitud, ids_ediciones, referencias, evaluaciones, corte).items():
        obs = seleccion["observacion"]
        identidad = seleccion["identidad"]
        contexto = seleccion["contexto"]
        nativa = seleccion["nativa"]
        extra = {"edicion_id": id, **_hechos(obs, corte, nativa["datos"]["sesiones"])}
        prueba = next(e for e in obs["evidencias"] if e["alcance"] == "identidad")
        extra["identidad_actual"] = _temporal(
            {
                **identidad,
                "alcance": "edicion",
                "evidencia": {k: v for k, v in prueba.items() if k != "alcance"},
            },
            corte,
        )
        if contexto.get("ficha") is not None:
            cap = _captura(contexto["ficha"], referencias, area)
            actividad_id = identidad["programa_id"].removeprefix("cibernarium:")
            cap["id"] = "cibernarium:" + actividad_id
            cuerpo, meta = adquisicion.pagina(area, cap)
            lectura = adquisicion._lectura_html(area, cap, actividad_id)
            if (
                cuerpo is not None
                and lectura["identificada"]
                and robot.fecha_utc(meta["fin_utc"]) <= robot.fecha_utc(corte)
            ):
                extra["referencias"].append(
                    _referencia(
                        {"url": meta["url"], "sha256": cap["cuerpo"]["sha256"], "capturado_utc": meta["fin_utc"]}
                    )
                )
        clave = sha256_json([contexto["normas"], contexto["normas_intento"]])
        if clave not in normas:
            normas[clave] = _normas(area, contexto["normas"], referencias, contexto["normas_intento"])
        for campo, dato in normas[clave].items():
            hecho = _temporal(dato, corte)
            if hecho is not None:
                extra[campo] = hecho
                extra["referencias"].append(_referencia(dato["evidencia"]))
        salida[id] = extra
    return salida
