"""Hechos Ciber desde la selección admitida actual, sin copiar cuerpos o investigar."""

import json
import sqlite3
from contextlib import closing
from pathlib import Path

from plataforma_datos.comun.huella_json import sha256_json
from plataforma_datos.cursos import admision_catalogo as admision
from plataforma_datos.cursos import almacen_catalogo as almacen
from plataforma_datos.cursos.contrato_entrega_catalogo import exigir
from plataforma_datos.cursos.fuentes.cibervoluntarios import actualizacion as ciber
from plataforma_datos.cursos.fuentes.cibervoluntarios import control_actual, nivel_actividad
from plataforma_datos.cursos.fuentes.cibervoluntarios import observaciones_vigencia as puente
from plataforma_datos.cursos.fuentes.hp_life.recepciones import fecha_utc


def _captura(fila: dict, referencias: dict, area: Path) -> dict:
    """Resuelve solo SHA admitidos de la casa cerrada de la instantánea.

    Returns:
        Referencias relativas para reutilizar el mismo lector de adquisición.
    """
    salida = {}
    for campo in ("cuerpo", "recibo", "metadatos"):
        sha = fila[campo + "_sha256"]
        ref = referencias.get(sha)
        exigir(
            ref is not None and ref.ruta.absolute().is_relative_to(area),
            "Prueba Ciber fuera de la instantánea admitida",
        )
        salida[campo] = {"archivo": ref.ruta.absolute().relative_to(area).as_posix(), "sha256": sha}
    return salida


def _proyectar(condiciones: dict, corte: str) -> dict:
    salida = {"referencias": []}
    for campo, dato in condiciones.items():
        evidencia = dato["evidencia"]
        # La condición conserva la fecha de su captura; el tiempo no la anula.
        if fecha_utc(evidencia["capturado_utc"]) > fecha_utc(corte):
            continue
        salida[campo] = {**dato, "vigencia": {"comprobado_el": evidencia["capturado_utc"]}}
        salida["referencias"].append(
            {
                "url": evidencia["url"],
                "sha256": evidencia["sha256"],
                "fecha_referencia": evidencia["capturado_utc"],
                "alcance": "entidad",
                "naturaleza_fecha": "recepcion_conservada",
                "naturaleza_documento": "no_acreditada",
            }
        )
    return salida


def seleccionados(  # noqa: PLR0915 - Un único recorrido acotado comparte las páginas y apoyos admitidos.
    solicitud: admision.SolicitudAdmision, ids: set[str], referencias: dict, evaluaciones: dict
) -> dict:
    """Reextrae contexto e identidad y exige la observación actual exacta.

    El paginador común ya entregó las evaluaciones actuales: no vuelve a expandir
    el historial por cada material. Cada página y grupo de apoyos se lee una vez.

    Returns:
        Material/contexto exactos; una selección histórica no se elige por conveniencia.
    """
    ref = solicitud.procedencia.get("control-ciber")
    if ref is None:
        return {}
    control = almacen.leer_documento_indexado(ref, referencias)
    control_actual.validar(control)
    area = solicitud.snapshot.ruta.parent.absolute()
    paginas, auxiliares, salida = {}, {}, {}
    with closing(sqlite3.connect(solicitud.snapshot.ruta.as_uri() + "?mode=ro&immutable=1", uri=True)) as conexion:
        conexion.row_factory = sqlite3.Row
        for fila in control["recepciones"]:
            identidad = fila["id"]
            if identidad not in ids:
                continue
            evaluacion = evaluaciones.get(identidad)
            observadas = evaluacion["entradas"]["observaciones"] if evaluacion is not None else []
            observacion = next((o for o in observadas if o["id"] == fila["observacion_id"]), None)
            if observacion is None:
                continue
            contexto = control["contextos"][fila["contexto_sha256"]]
            captura = _captura(contexto, referencias, area)
            clave = sha256_json(captura)
            if clave not in paginas:
                paginas[clave] = ciber.leer_materiales_del_intento(area, {"recepciones": [captura]})
            materiales, seleccionados = paginas[clave]
            clave_aux = sha256_json(contexto["auxiliares"])
            if clave_aux not in auxiliares:
                caps = {k: _captura(v, referencias, area) for k, v in contexto["auxiliares"].items()}
                auxiliares[clave_aux] = puente.contexto(area, caps)
            ctx = auxiliares[clave_aux]
            nativo = conexion.execute("SELECT * FROM programas WHERE id=?", (identidad,)).fetchone()
            exigir(nativo is not None, "Control Ciber sin programa nativo")
            programa = {k: nativo[k] for k in ("id", "proveedor_id", "titulo", "url", "tipo_unidad")}
            programa["datos"] = json.loads(nativo["datos"])
            seleccionado = ciber.seleccionar_material_del_programa(programa, materiales, seleccionados, ctx)
            if isinstance(seleccionado, str):
                continue
            material, _ = seleccionado
            exigir(material.id == fila["material_id"], "Control Ciber de otro material")
            alias = identidad == "fundae:1:3462"
            if not alias and (
                programa["datos"].get("material_publicado") != material.material_publicado
                or programa["datos"].get("actividad_publicada") != material.actividad_publicada
            ):
                continue
            ctx_unidad, _ = ciber.contexto_de_unidad(ctx, programa, material)
            reproducida = puente.construir(material, programa=programa, ctx=ctx_unidad)
            if reproducida != observacion:
                continue
            salida[identidad] = (material, ctx)
    return salida


def actuales(
    solicitud: admision.SolicitudAdmision, ids: set[str], referencias: dict, evaluaciones: dict, corte: str
) -> dict:
    """Proyecta los hechos desde la misma selección que usa el aprendizaje.

    Returns:
        Valores, apoyos y fecha propia de cada captura; no altera disponibilidad o captura.
    """
    salida = {}
    for id, (material, ctx) in seleccionados(solicitud, ids, referencias, evaluaciones).items():
        datos = _proyectar(puente.condiciones(material, ctx), corte)
        nivel = nivel_actividad.extraer(material)
        if nivel and fecha_utc(nivel["capturado_utc"]) <= fecha_utc(corte):
            datos["nivel_actividad"] = nivel
            datos["referencias"].append(
                {
                    "url": nivel["url"],
                    "sha256": nivel["sha256"],
                    "fecha_referencia": nivel["capturado_utc"],
                    "alcance": "entidad",
                    "naturaleza_fecha": "recepcion_conservada",
                    "naturaleza_documento": "no_acreditada",
                }
            )
        salida[id] = datos
    return salida
