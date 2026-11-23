"""Aplica el canal operativo Cibernàrium a la candidata común, por edición.

No borra ausentes, modifica ocupaciones ni renueva hechos HTML por consultar API.
La última comprobación y el intento identificado incierto permanecen distintos.
Los originales y la entrada admitida son inmutables; la promoción es común.
"""

import hashlib
from dataclasses import dataclass
from pathlib import Path

from plataforma_datos.comun.entrada_salida import guardar_json
from plataforma_datos.comun.huella_json import sha256_json
from plataforma_datos.cursos import admision_catalogo as admision
from plataforma_datos.cursos import almacen_catalogo as almacen
from plataforma_datos.cursos import operacion_fuente as comun
from plataforma_datos.cursos import politicas_vigencia
from plataforma_datos.cursos import registro_vigencia as registro
from plataforma_datos.cursos.contrato_entrega_catalogo import exigir
from plataforma_datos.cursos.fuentes.barcelonactiva import (
    adquisicion,
    contraste_ediciones,
    control_actual,
    identidades_actuales,
    lectura_censo,
    matricula_actual,
    negocio_actual,
    observaciones_actuales,
)
from plataforma_datos.cursos.fuentes.barcelonactiva import robot_cibernarium as robot

CODIGO = (
    "actualizacion.py",
    "lectura_censo.py",
    "adquisicion.py",
    "cabeceras_actuales.py",
    "contraste_ediciones.py",
    "control_actual.py",
    "declaraciones_actuales.py",
    "ficha_edicion.py",
    "identidades_actuales.py",
    "idioma_ficha.py",
    "idiomas_edicion.py",
    "matricula_actual.py",
    "negocio_actual.py",
    "observaciones_actuales.py",
    "robot_cibernarium.py",
    "politica_vigencia_v3.json",
)


def _sha(ruta: Path) -> str:
    with ruta.open("rb") as archivo:
        return hashlib.file_digest(archivo, "sha256").hexdigest()


def firma(conjunto: dict) -> str:
    """Identifica código, pruebas y política; nunca renueva una captura.

    Returns:
        Firma estable para el replay común sin volver a insertar observaciones.
    """
    return sha256_json(
        {
            "conjunto": conjunto,
            "codigo": {n: _sha(Path(__file__).with_name(n)) for n in CODIGO},
            "evaluador": registro.firma_evaluador()["sha256"],
            "contratos": {k: c.documento() for k, c in negocio_actual.CONTRATOS.items()},
        }
    )


def _conservar(original: Path, cap: dict, destino: Path, inventario: dict) -> list[dict]:
    _, meta = adquisicion.pagina(original, cap)
    pruebas = []
    for campo in ("cuerpo", "recibo", "metadatos"):
        ref = cap.get(campo)
        if ref is None:
            continue
        ruta = next(
            (n for n, h in sorted(inventario.items()) if h == ref["sha256"] and n.startswith("evidencias/")),
            "evidencias/cibernarium/" + ref["sha256"] + (".body" if campo == "cuerpo" else ".json"),
        )
        almacen.copiar_evidencia(
            admision.ReferenciaArchivo(ruta=almacen.ruta_relativa(original, ref["archivo"]), sha256=ref["sha256"]),
            almacen.ruta_relativa(destino, ruta),
        )
        inventario[ruta] = ref["sha256"]
        pruebas.append(
            {
                "url": meta["url"],
                "capturado_utc": meta["fin_utc"],
                "sha256": ref["sha256"],
                "archivo": ruta.removeprefix("evidencias/"),
            }
        )
    return pruebas


def _reproducir(conjunto: dict, original: Path, programas: dict) -> None:
    exigir(
        conjunto.get("schema_version") == 1
        and conjunto.get("fuente_id") == "barcelonactiva"
        and conjunto.get("canal") == "cibernarium",
        "Conjunto Cibernàrium ajeno",
    )

    def quitar(cap: dict) -> dict:
        return {k: v for k, v in cap.items() if k != "lectura"}

    documento = {
        "schema_version": 1,
        "fuente_id": "barcelonactiva",
        "canal": "cibernarium",
        "capturas": [quitar(c) for c in [*conjunto["recepciones"], *conjunto.get("paginas_fallidas", [])]],
        "auxiliares": {k: quitar(c) for k, c in conjunto["auxiliares"].items()},
        "fichas": {k: quitar(c) for k, c in conjunto["fichas"].items()},
        "historial": [],
    }
    if contraste_ediciones.CAMPO in conjunto:
        documento[contraste_ediciones.CAMPO] = conjunto[contraste_ediciones.CAMPO]
    exigir(
        lectura_censo.reproduce(original, documento, list(programas.values()), conjunto),
        "Conjunto Cibernàrium no reproducido",
    )


def _registrar(base: Path, oferta: dict, nuevas: list[dict], corte: str) -> dict:
    historial = registro.observaciones_hasta(base, tipo="edicion", id=oferta["id"], corte=corte)
    registradas = {o["id"]: o for o in historial}
    for obs in nuevas:
        exigir(registradas.get(obs["id"], obs) == obs, "Observación Cibernàrium repetida con otros hechos")
    pendientes = [o for o in nuevas if o["id"] not in registradas]
    return registro.registrar_evaluacion(
        base,
        registro.SolicitudEvaluacion(
            edicion_id=oferta["id"],
            oferta=oferta,
            observaciones=[*historial, *pendientes],
            politica=politicas_vigencia.leer_politica("barcelonactiva", matricula_actual.VERSION_POLITICA),
            ahora=corte,
        ),
    )


def _oferta_conocida(base: Path, edicion: dict) -> dict:
    """Recupera la oferta ya evaluada de la edición o la forma desde su actividad nativa.

    Returns:
        Oferta de la edición, con la URL de su ficha pública.
    """
    previa = registro.consultar_edicion(base, edicion["id"]).get("evaluacion")
    if previa is not None:
        return previa["entradas"]["oferta"]
    actividad = robot.identificador(edicion["programa_id"].removeprefix("cibernarium:"))
    return {"id": edicion["id"], "fuente_id": matricula_actual.FUENTE, "url": robot.url_ficha(actividad)}


def _registrar_fallos(original: Path, base: Path, ausentes: list[dict], conjunto: dict, corte: str) -> list[dict]:
    """Registra el intento de cada página caída como fallo de consulta de las ediciones sin noticia.

    Cada edición conserva su última comprobación; el fallo no la retira ni la renueva.

    Returns:
        Resultados de las ediciones avisadas.
    """
    fallidas = conjunto.get("paginas_fallidas", [])
    resultados = []
    for edicion in ausentes if fallidas else []:
        id = edicion["id"]
        oferta = _oferta_conocida(base, edicion)
        observaciones = [
            observaciones_actuales.construir_fallo(
                comun.leer_recibo(original, cap), cap["intento"]["sha256"], oferta=oferta
            )
            for cap in fallidas
        ]
        evaluacion = _registrar(base, oferta, observaciones, corte)
        resultados.append(
            {
                "id": id,
                "pendiente": None,
                "diagnostico": "edicion_sin_noticia_por_pagina_fallida",
                "evaluacion": {k: evaluacion[k] for k in ("evaluacion_id", "repetida", "actual")},
            }
        )
    return resultados


def _diagnostico(actividad: dict, edicion: dict, obs: dict) -> str | None:
    nativa, motivo = observaciones_actuales._edicion_interpretable(actividad["activityId"], actividad, edicion)
    if motivo is not None:
        return motivo
    if nativa["datos"]["estado_inscripcion"] == "cerrada" and obs["detalle"]["datos_edicion"] is None:
        return "inscripcion_cerrada_en_recepcion_historica"
    if not all(k in edicion for k in matricula_actual.REGISTRO):
        return "estado_matricula_incompleto"
    if matricula_actual.CAMPO in obs["detalle"] and not matricula_actual.acreditada(obs["detalle"]):
        return "estado_matricula_no_corroborado"
    return None


def _lectura_previa_de_cierre(base: Path, id: str, corte: str, cierre: dict) -> dict:
    """Conserva la interpretación sellada de un recibo ya procesado.

    Returns:
        Observación previa de ese mismo recibo o cierre acreditado por una captura nueva.
    """
    for previa in registro.observaciones_hasta(base, tipo="edicion", id=id, corte=corte):
        if (
            previa["detalle"].get("datos_edicion") is None
            and observaciones_actuales.id_lectura_cierre(previa["id"]) == cierre["id"]
        ):
            return previa
    return cierre


def _aplicar_edicion(original: Path, fila: dict, actividad: dict, edicion: dict, estado: dict) -> dict:
    base = estado["base"]
    id = "cibernarium-edicion:" + robot.identificador(edicion.get("activityId"))
    oferta, obs = observaciones_actuales.construir(
        original, fila, actividad_id=actividad["activityId"], edicion_id=edicion["activityId"]
    )
    actual = estado["ediciones"].get(id)
    if actual is not None and (obs["detalle"]["datos_edicion"] or {}).get("estado_inscripcion") == "cerrada":
        obs = _lectura_previa_de_cierre(base, id, estado["corte"], obs)
    motivo = None
    if obs["detalle"]["datos_edicion"] is not None:
        if actual is None:
            actual = robot.normalizar_edicion(estado["identidad"]["programa_id"], actividad, edicion)
            actual = {k: v for k, v in actual.items() if k != "evidencias"}
            negocio_actual.alta(base, actual, "edicion", estado["pruebas"], estado["raiz"])
            estado["ediciones"][id] = actual
        else:
            motivo = negocio_actual.cargar(
                base,
                actual,
                negocio_actual.PublicacionApi(
                    actividad=actividad, edicion=edicion, pruebas=estado["pruebas"], identidad=estado["identidad"]
                ),
                estado["raiz"],
            )
    if actual is None:
        return {"id": id, "pendiente": "edicion_nueva_sin_contenido_contrastable", "evaluacion": None}
    evaluacion = _registrar(base, oferta, [obs], estado["corte"])
    diagnostico = _diagnostico(actividad, edicion, obs)
    if evaluacion["actual"]:
        estado["filas"].append(
            {
                "id": id,
                "actividad_id": actividad["activityId"],
                "edicion_id": edicion["activityId"],
                "observacion_id": obs["id"],
                "contexto_sha256": estado["contexto_sha256"],
                "diagnostico": diagnostico,
            }
        )
    ultima = registro.consultar_edicion(base, id)["evaluacion"]["resultado"]
    return {
        "id": id,
        "pendiente": motivo,
        "diagnostico": diagnostico,
        "ultima_comprobacion_valida_el": ultima["trazabilidad"]["ficha"]["ultima_positiva_el"],
        "cierra_el": ultima["cierra_el"],
        "evaluacion": {k: evaluacion[k] for k in ("evaluacion_id", "repetida", "actual")},
    }


def _contrastar_fichas(  # noqa: PLR0913 - Cada conjunto se aplica a su candidata y a su reloj de evaluación.
    conjunto: dict, original: Path, destino: Path, *, programas: dict, ediciones: dict, inventario: dict, corte: str
) -> list[dict]:
    resultados = []
    for nativo, cap in conjunto.get(contraste_ediciones.CAMPO, {}).items():
        id = "cibernarium-edicion:" + nativo
        exigir(id in ediciones, "Contraste individual sin edición ausente identificada")
        edicion = ediciones[id]
        _conservar(original, cap, destino, inventario)
        diagnostico, obs = contraste_ediciones.observar(
            original, cap, programas[edicion["programa_id"]]["titulo"], edicion
        )
        base = destino / "catalogo.sqlite3"
        evaluacion = _registrar(base, _oferta_conocida(base, edicion), [obs], corte)
        resultados.append(
            {
                "id": id,
                "pendiente": None,
                "observacion_id": obs["id"],
                "diagnostico": diagnostico,
                "evaluacion": {k: evaluacion[k] for k in ("evaluacion_id", "repetida", "actual")},
            }
        )
    return resultados


def aplicar(entrada: almacen.EntradaCatalogo, *, conjunto: dict, original: Path, destino: Path, corte: str) -> dict:  # noqa: PLR0915
    """Aplica pruebas reproducidas a una candidata nueva, nunca al origen.

    Returns:
        Control admitido; ausencias y retenciones conservan motivo privado por edición.
    """
    programas, ediciones = negocio_actual.leer(entrada.admision.snapshot.ruta)
    _reproducir(conjunto, original, programas)
    control = almacen.conservar(entrada, destino=destino)
    inventario = {p["archivo"]: p["sha256"] for p in control["archivos_conservados"]}
    for cap in [*conjunto["auxiliares"].values(), *conjunto["fichas"].values(), *conjunto.get("paginas_fallidas", [])]:
        _conservar(original, cap, destino, inventario)
    anterior = control_actual.leer_anterior(destino, control, inventario)
    previas = {f["id"]: anterior["contextos"][f["contexto_sha256"]] for f in anterior["recepciones"]}
    actividades = [a for cap in conjunto["recepciones"] for a in adquisicion.actividades(original, cap)[0]]
    relaciones, retenidas = identidades_actuales.resolver(
        actividades, programas, ediciones, [ctx["identidad"] for ctx in anterior["contextos"].values()]
    )
    filas, resultados, contextos, vistas = [], [], {}, set()
    for cap in conjunto["recepciones"]:
        pruebas = _conservar(original, cap, destino, inventario)
        for actividad in adquisicion.actividades(original, cap)[0]:
            cabecera = actividad["activityId"]
            vistas.update("cibernarium-edicion:" + e["activityId"] for e in actividad["listEditions"])
            if cabecera in retenidas:
                resultados.append({"id": "cabecera:" + cabecera, "pendiente": retenidas[cabecera], "evaluacion": None})
                continue
            identidad = relaciones[cabecera]
            id = identidad["programa_id"]
            canonico = programas.get(id) or negocio_actual.programa(actividad)
            identidades_actuales.comprobar(identidad, actividad, {**programas, id: canonico}, ediciones)
            if id not in programas:
                negocio_actual.alta(destino / "catalogo.sqlite3", canonico, "programa", pruebas, destino / "evidencias")
                programas[id] = canonico
            else:
                motivo = negocio_actual.cargar(
                    destino / "catalogo.sqlite3",
                    programas[id],
                    negocio_actual.PublicacionApi(
                        actividad=actividad, edicion=None, pruebas=pruebas, identidad=identidad
                    ),
                    destino / "evidencias",
                )
                if motivo is not None:
                    resultados.append({"id": id, "pendiente": motivo, "evaluacion": None})
                    continue
            estado = {
                "identidad": identidad,
                "base": destino / "catalogo.sqlite3",
                "ediciones": ediciones,
                "pruebas": pruebas,
                "raiz": destino / "evidencias",
                "corte": corte,
                "filas": filas,
            }
            for edicion in actividad["listEditions"]:
                id_edicion = "cibernarium-edicion:" + edicion["activityId"]
                ctx = control_actual.contexto(cap, conjunto["auxiliares"]["normas"], previas.get(id_edicion))
                ctx["identidad"] = identidad
                ficha_id = identidad["programa_id"].removeprefix("cibernarium:")
                ficha = conjunto["fichas"].get(ficha_id)
                if ficha is not None and ficha["lectura"]["identificada"]:
                    ctx["ficha"] = control_actual.referencia(ficha)
                else:
                    anterior_ficha = previas.get(id_edicion) or {}
                    if anterior_ficha.get("identidad", {}).get("programa_id") == identidad[
                        "programa_id"
                    ] and anterior_ficha.get("ficha"):
                        ctx["ficha"] = anterior_ficha["ficha"]
                sha = sha256_json(ctx)
                contextos[sha], estado["contexto_sha256"] = ctx, sha
                vistas.add(id_edicion)
                resultados.append(_aplicar_edicion(original, cap, actividad, edicion, estado))
    ausentes = sorted(set(ediciones) - vistas)
    usados = {f["contexto_sha256"] for f in filas}
    control_actual.guardar_seleccion(
        destino, control, inventario, filas, {k: v for k, v in contextos.items() if k in usados}
    )
    # Las ediciones sin noticia por una página caída reciben el aviso del intento, nunca una baja.
    return _cerrar(
        entrada,
        destino,
        conjunto,
        corte,
        _Cierre(
            control,
            inventario,
            [
                *resultados,
                *_contrastar_fichas(
                    conjunto,
                    original,
                    destino,
                    programas=programas,
                    ediciones=ediciones,
                    inventario=inventario,
                    corte=corte,
                ),
                *_registrar_fallos(
                    original, destino / "catalogo.sqlite3", [ediciones[i] for i in ausentes], conjunto, corte
                ),
            ],
            ausentes,
        ),
    )


@dataclass(frozen=True)
class _Cierre:
    control: dict
    inventario: dict
    resultados: list[dict]
    ausentes: list[str]


def _cerrar(entrada: almacen.EntradaCatalogo, destino: Path, conjunto: dict, corte: str, estado: _Cierre) -> dict:
    control, inventario, resultados, ausentes = estado.control, estado.inventario, estado.resultados, estado.ausentes
    codigo = {}
    for nombre in CODIGO:
        ruta = Path(__file__).with_name(nombre)
        sha = _sha(ruta)
        relativa = "evidencias/codigo/" + sha + ".ref"
        almacen.copiar_evidencia(admision.ReferenciaArchivo(ruta=ruta, sha256=sha), destino / relativa)
        inventario[relativa], codigo[nombre] = sha, sha
    recibo = {
        "schema_version": 1,
        "fuente_id": "barcelonactiva",
        "canal": "cibernarium",
        "firma": firma(conjunto),
        "snapshot_entrada_sha256": entrada.admision.snapshot.sha256,
        "snapshot_salida_sha256": _sha(destino / "catalogo.sqlite3"),
        "corte_evaluacion_utc": corte,
        "codigo": codigo,
        "resultados": resultados,
        "ausentes_sin_interpretar_baja": ausentes,
    }
    control["procedencia"]["recibo-cibernarium"] = almacen.archivar_documento(
        comun.json_bytes(recibo),
        destino,
        inventario,
        campos_evento=frozenset(
            {
                "firma",
                "snapshot_entrada_sha256",
                "snapshot_salida_sha256",
                "corte_evaluacion_utc",
                "resultados",
                "ausentes_sin_interpretar_baja",
            }
        ),
    )
    control["snapshot_sha256"] = recibo["snapshot_salida_sha256"]
    control["archivos_conservados"] = [{"archivo": n, "sha256": h} for n, h in sorted(inventario.items())]
    if resultados and all(r.get("pendiente") in (None, "edicion_nueva_sin_contenido_contrastable") for r in resultados):
        control["aplicados_por_fuente"]["barcelonactiva"] = recibo["firma"]
    guardar_json(destino / almacen.CONTROL, control)
    admision.admitir_snapshot(almacen.solicitud(destino))
    return control
