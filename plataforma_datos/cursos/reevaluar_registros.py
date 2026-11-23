"""Reproduce decisiones históricas con el evaluador vigente dentro de la candidata, después de los productores."""

import json
import sqlite3
from collections.abc import Iterator
from contextlib import closing
from functools import lru_cache
from http import HTTPStatus
from itertools import chain
from pathlib import Path

from plataforma_datos.comun.entrada_salida import guardar_json, sha256
from plataforma_datos.comun.huella_json import sha256_json
from plataforma_datos.comun.nucleo import FormatoInesperado
from plataforma_datos.cursos import admision_catalogo as admision
from plataforma_datos.cursos import almacen_catalogo as almacen
from plataforma_datos.cursos import (
    almacen_vigencia,
    catalogo,
    contenido_aprendizaje,
    politicas_vigencia,
    recibos_compartidos,
    vigencia,
)
from plataforma_datos.cursos import registro_vigencia as registro
from plataforma_datos.cursos import unidades_vigencia as unidades
from plataforma_datos.cursos.contrato_fichas import normalizar_datos_edicion
from plataforma_datos.cursos.fuentes.barcelonactiva import (
    cabeceras_actuales,
    contraste_ediciones,
    ficha_edicion,
    matricula_actual,
    negocio_actual,
    observaciones_actuales,
    robot_cibernarium,
)
from plataforma_datos.cursos.fuentes.barcelonactiva import control_actual as control_cibernarium
from plataforma_datos.cursos.fuentes.cibervoluntarios import control_actual as control_ciber
from plataforma_datos.cursos.fuentes.claude_academy import control_actual as control_academy

CONTROLES_SELECCION = {
    "barcelonactiva": ("cibernarium", control_cibernarium.validar),
    "cibervoluntarios": ("ciber", control_ciber.validar),
    "claude_academy": ("academy", control_academy.validar),
}

ULTIMAS_OBSOLETAS = """
    SELECT v.* FROM unidades_vigencia u
    JOIN evaluaciones_vigencia v ON v.id = (
        SELECT id FROM evaluaciones_vigencia a WHERE a.unidad_clave=u.clave ORDER BY a.corte_us DESC LIMIT 1
    )
    WHERE v.huella_evaluador<>? AND v.corte_us<? ORDER BY u.clave
"""


def _firmas_comparables(anterior: dict, actual: dict) -> bool:
    # Una firma histórica que aún no incluía, por ejemplo, la retirada del proveedor no acredita su tratamiento.
    campos = ("version_contrato_vigencia", "archivos")
    return (
        anterior["version"] == actual["version"]
        and anterior["version_contrato_vigencia"] == actual["version_contrato_vigencia"]
        and anterior["archivos"].keys() == actual["archivos"].keys()
        and anterior["sha256"] == sha256_json({k: anterior[k] for k in campos})
    )


def _edicion_publicada(cuerpo: bytes, cabecera: dict) -> tuple[dict, dict, str] | None:
    try:
        pagina = json.loads(cuerpo)["activities"]
        actividades = [(i, a) for i, a in enumerate(pagina) if a["activityId"] == cabecera["actividad_id"]]
        if len(actividades) != 1:
            return None
        posicion, actividad = actividades[0]
        ediciones = [
            (i, e) for i, e in enumerate(actividad["listEditions"]) if e["activityId"] == cabecera["edicion_id"]
        ]
    except (TypeError, KeyError, UnicodeDecodeError, json.JSONDecodeError):
        return None
    if len(ediciones) != 1:
        return None
    indice, edicion = ediciones[0]
    return actividad, edicion, f"/activities/{posicion}/listEditions/{indice}"


def _reproduce_matricula(obs: dict, oferta: dict, cuerpo: bytes) -> bool:
    detalle = obs["detalle"]
    cabecera = detalle.get(cabeceras_actuales.CAMPO)
    if not cabecera or not obs["id"].startswith("cibernarium-observacion-api-1:"):
        return False
    publicadas = _edicion_publicada(cuerpo, cabecera)
    if publicadas is None:
        return False
    actividad, edicion, base = publicadas
    localizadores = [e["localizador"]["valor"] for e in obs["evidencias"] if e["alcance"] == "identidad"]
    if localizadores != [base.split("/listEditions/")[0] + "/activityId", base + "/activityId"]:
        return False
    nativa, motivo = observaciones_actuales._edicion_interpretable(cabecera["actividad_id"], actividad, edicion)
    if motivo is not None or (
        nativa["datos"]["estado_inscripcion"] == "disponible-publicamente"
        and not all(k in edicion for k in matricula_actual.REGISTRO)
    ):
        return detalle["datos_edicion"] is None
    calendarios = [e for e in obs["evidencias"] if e["alcance"] == "calendario"]
    campo = "/sessionsOnline" if nativa["datos"]["ventana_acceso"] is not None else "/listSessions"
    if len(calendarios) != 1 or calendarios[0]["localizador"]["valor"] != base + campo:
        return False
    propia = cabeceras_actuales.oferta_propia(obs, oferta)
    datos = observaciones_actuales._datos_con_calendario(nativa, propia, calendarios[0])
    datos["publicacion_original"]["gestion_matricula"] = {k: edicion.get(k) for k in matricula_actual.REGISTRO}
    return datos == detalle["datos_edicion"]


def _vinculo_programa(programa: dict, oferta: dict, observaciones: list[dict]) -> bool:
    # Una misma edición puede cambiar de cabecera API sin cambiar de programa nativo.
    cabecera = programa["datos"]["activity_id"]
    if programa["id"] != "cibernarium:" + cabecera or programa["url"] != robot_cibernarium.url_ficha(cabecera):
        return False
    apis = [
        o for o in cabeceras_actuales.identificadas(observaciones, oferta) if cabeceras_actuales.CAMPO in o["detalle"]
    ]
    if not apis:
        return programa["url"] == oferta["url"]
    ultimas, _ = vigencia._ultimo(apis)
    return {cabeceras_actuales.oferta_propia(o, oferta)["url"] for o in ultimas} == {oferta["url"]}


def _reproduce_ficha(db: sqlite3.Connection, obs: dict, oferta: dict, cuerpo: bytes, historial: list[dict]) -> bool:
    fila = db.execute("SELECT * FROM ediciones WHERE id=?", (oferta["id"],)).fetchone()
    if fila is None:
        return False
    edicion = negocio_actual.fila_nativa_verificada(fila)
    programa = negocio_actual.fila_nativa_verificada(
        db.execute("SELECT * FROM programas WHERE id=?", (edicion["programa_id"],)).fetchone()
    )
    id = edicion["datos"]["activity_id"]
    if programa["proveedor_id"] != "cibernarium" or edicion["id"] != "cibernarium-edicion:" + id:
        return False
    url = ficha_edicion.url(id)
    detalle = obs["detalle"]
    if not (detalle["url_final"] == obs["url_consultada"] == url and _vinculo_programa(programa, oferta, historial)):
        return False
    try:
        lectura = ficha_edicion.contrastar(cuerpo, id=id, titulo=programa["titulo"], edicion=edicion)
    except (UnicodeDecodeError, FormatoInesperado):
        return False
    if not lectura.identificada:
        return False
    datos = None
    selectores = [("identidad", "meta[property='og:url']"), ("diagnostico", lectura.selector)]
    if lectura.estado in ("cerrada", "sin-plazas", "boton-de-inscripcion"):
        datos = normalizar_datos_edicion({})
        datos["estado_inscripcion"] = (
            "disponible-publicamente" if lectura.estado == "boton-de-inscripcion" else lectura.estado
        )
        selectores.append(("disponibilidad", lectura.selector))
    return (
        detalle["identidad_observada"] == edicion["id"]
        and detalle["datos_edicion"] == datos
        and detalle["acceso_abierto"] is None
        and detalle["codigo_http"] == HTTPStatus.OK
        and detalle["tipo_destino"] == "ficha"
        and all(
            e["localizador"]["tipo"] == "selector" and e["url"] == url and e["capturado_utc"] == obs["terminado_el"]
            for e in obs["evidencias"]
        )
        and [(e["alcance"], e["localizador"]["valor"]) for e in obs["evidencias"]] == selectores
    )


class _Soportes:
    def __init__(self, referencias: dict[str, admision.ReferenciaArchivo]) -> None:
        self.referencias = referencias
        self.verificados: set[str] = set()
        self.cuerpo = lru_cache(maxsize=1)(self._leer)

    def _leer(self, huella: str) -> bytes:
        ref = self.referencias[huella]
        return almacen.leer_evidencia(ref.ruta, huella, "Cuerpo alterado durante la reproducción de la evaluación")

    def fallo_transitorio(self, obs: dict, oferta: dict) -> bool:
        if (
            not obs["id"].startswith(contraste_ediciones.PREFIJO)
            or obs["detalle"].get("motivo") != "ficha_individual_sin_respuesta_valida"
            or len(obs["evidencias"]) != 1
            or obs["url_consultada"] != ficha_edicion.url(oferta["id"].removeprefix("cibernarium-edicion:"))
        ):
            return False
        sha = obs["evidencias"][0]["sha256"]
        if sha not in self.referencias:
            return False
        cuerpo = self.cuerpo(sha)
        dato = recibos_compartidos.leer_json(cuerpo)
        if "formato_recibo" in dato:
            metadatos = dato.get("metadatos_sha256")
            if metadatos not in self.referencias:
                return False
            dato = recibos_compartidos.leer_json(recibos_compartidos.reconstruir(cuerpo, self.cuerpo(metadatos)))
        codigo = dato.get("http")
        return (
            dato.get("url") == obs["url_consultada"]
            and dato.get("inicio_utc") == obs["intentado_el"]
            and dato.get("fin_utc") == obs["terminado_el"]
            and (
                bool(dato.get("error"))
                and dato.get("completo") is False
                or codigo in (HTTPStatus.REQUEST_TIMEOUT, HTTPStatus.TOO_MANY_REQUESTS)
                or isinstance(codigo, int)
                and HTTPStatus.INTERNAL_SERVER_ERROR <= codigo <= vigencia.ULTIMO_CODIGO_HTTP
            )
        )

    def reproducibles(self, observaciones: list[dict], oferta: dict, db: sqlite3.Connection) -> bool:
        for o in observaciones:
            huellas = {e["sha256"] for e in o["evidencias"]}
            if not huellas or not huellas <= self.referencias.keys():
                return False
            for huella in huellas - self.verificados:
                self.cuerpo(huella)
                self.verificados.add(huella)
            if oferta["fuente_id"] != matricula_actual.FUENTE or o["tipo"] != "ficha" or o["resultado"] != "correcta":
                continue
            if len(huellas) != 1:
                return False
            cuerpo = self.cuerpo(next(iter(huellas)))
            if o["id"].startswith(contraste_ediciones.PREFIJO):
                if not _reproduce_ficha(db, o, oferta, cuerpo, observaciones):
                    return False
            elif not _reproduce_matricula(o, oferta, cuerpo):
                return False
        return True


def _selecciones(origen: admision.SolicitudAdmision, referencias: dict) -> dict:
    seleccionadas = {}
    for fuente, (nombre, validar) in CONTROLES_SELECCION.items():
        control_ref = origen.procedencia.get("control-" + nombre)
        recibo_ref = origen.procedencia.get("recibo-" + nombre)
        if control_ref is None or recibo_ref is None:
            continue
        control = almacen.leer_documento_indexado(control_ref, referencias)
        recibo = almacen.leer_documento_indexado(recibo_ref, referencias)
        validar(control)
        # El control conserva también selecciones antiguas. Solo el recibo del último ciclo identifica
        # las evaluaciones que su productor pudo sostener entonces (incluido un fallo técnico registrado).
        evaluadas = {r["id"]: r for r in recibo["resultados"] if r.get("evaluacion") and r["evaluacion"]["actual"]}
        seleccionadas[fuente] = {
            fila["id"]: fila["observacion_id"] for fila in control["recepciones"] if fila["id"] in evaluadas
        }
        seleccionadas[fuente].update(
            {id: r["observacion_id"] for id, r in evaluadas.items() if r.get("observacion_id")}
        )
    return seleccionadas


def _respaldo_actual(
    anterior: dict, observaciones: list[dict], resultado: dict, selecciones: dict, soportes: _Soportes
) -> bool:
    oferta = anterior["entradas"]["oferta"]
    if resultado["estado"] != "disponible-publicamente" or oferta["fuente_id"] not in CONTROLES_SELECCION:
        return True
    # Solo una observación identificada que el productor aún selecciona puede volver a ofrecer esa unidad.
    # Un censo incompleto o una excepción de enlace ya resueltos por el productor conservan su decisión.
    elegida = selecciones.get(oferta["fuente_id"], {}).get(oferta["id"])
    consulta = next((o for o in observaciones if o["id"] == elegida), None)
    if consulta is not None and consulta["resultado"] == "fallo" and oferta["fuente_id"] == matricula_actual.FUENTE:
        previo = anterior["resultado"]
        return (
            previo["estado"] == "disponible-publicamente"
            and previo["comprobado_el"] == resultado["comprobado_el"]
            and previo["cierra_el"] is not None
            and resultado["cierra_el"] is not None
            and vigencia.instante_utc(resultado["cierra_el"], "fin")
            <= vigencia.instante_utc(previo["cierra_el"], "fin previo")
            and soportes.fallo_transitorio(consulta, oferta)
        )
    return any(
        o["id"] == elegida
        and vigencia.ficha_identificada_de_oferta(o, oferta)
        and vigencia.fecha_de_comprobacion(o) == vigencia.instante_utc(resultado["comprobado_el"], "comprobación")
        for o in observaciones
    )


def solicitudes(
    base: Path, referencias: dict, corte: str, *, selecciones: dict | None = None
) -> Iterator[registro.SolicitudEvaluacionUnidad]:
    """Reconstruye la decisión anterior en su propio corte antes de usar la historia sellada en el corte nuevo.

    Yields:
        Solicitudes nativas por unidad que conservan capturas, negocio y política de origen.
    """
    firma = registro.firma_evaluador()
    incompatibles = set()
    soportes = _Soportes(referencias)
    with closing(catalogo.abrir_lectura(base)) as conexion:
        conexion.execute("BEGIN")
        for fila in conexion.execute(ULTIMAS_OBSOLETAS, (firma["sha256"], almacen_vigencia.corte(corte))):
            if fila["huella_evaluador"] in incompatibles:
                continue
            anterior = registro.contenido_verificado_de_evaluacion(conexion, fila)
            if not _firmas_comparables(anterior["evaluador"], firma):
                incompatibles.add(fila["huella_evaluador"])
                continue
            tipo, ident = json.loads(fila["unidad_clave"])
            unidad = unidades.identificar(conexion, tipo, ident)
            if (
                unidad["huella"] != fila["huella_unidad"]
                or tipo == "recurso"
                and unidades.tiene_ediciones(conexion, ident)
            ):
                continue
            entradas = anterior["entradas"]
            politica = entradas["politica"]
            try:
                if politica != politicas_vigencia.leer_politica(politica["fuente_id"], politica["version"]):
                    continue
                if vigencia.evaluar_vigencia(**entradas, ahora=anterior["corte_utc"]) != anterior["resultado"]:
                    continue
            except vigencia.ErrorVigencia:
                continue
            observaciones = registro.observaciones_hasta(base, tipo=tipo, id=ident, corte=corte)
            try:
                recalculado = vigencia.evaluar_vigencia(entradas["oferta"], observaciones, politica, ahora=corte)
            except vigencia.ErrorVigencia:
                continue
            if _respaldo_actual(
                anterior, observaciones, recalculado, selecciones or {}, soportes
            ) and soportes.reproducibles(observaciones, entradas["oferta"], conexion):
                yield registro.SolicitudEvaluacionUnidad(
                    unidad=registro.UnidadEvaluable(**unidad),
                    oferta=entradas["oferta"],
                    politica=politica,
                    observaciones=observaciones,
                    ahora=corte,
                )


def aplicar_si_cambia(base: Path, destino: Path, corte: str) -> Path:
    """Añade las decisiones reproducibles a una copia admitida y conserva el origen ante cualquier fallo.

    Returns:
        La nueva casa admitida o la inicial si no hay registros que recalcular.
    """
    origen = almacen.solicitud(base)
    referencias = contenido_aprendizaje.referencias_de_evidencia_indexadas(origen)
    selecciones = _selecciones(origen, referencias)
    with closing(solicitudes(origen.snapshot.ruta, referencias, corte, selecciones=selecciones)) as peticiones:
        primera = next(peticiones, None)
        if primera is None:
            return base
        entrada = almacen.EntradaCatalogo(admision=origen, sha256_admision=sha256(origen.validacion_destino))
        control = almacen.conservar(entrada, destino=destino)
        sqlite = destino / "catalogo.sqlite3"
        for peticion in chain((primera,), peticiones):
            registro.registrar_unidad(sqlite, peticion)
    control["snapshot_sha256"] = sha256(sqlite)
    guardar_json(destino / almacen.CONTROL, control)
    admision.admitir_snapshot(almacen.solicitud(destino))
    return destino
