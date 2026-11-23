"""Temarios desde la recepción actual del control admitido, sin búsqueda histórica."""

import json
import sqlite3
from collections.abc import Iterable

from plataforma_datos.cursos import admision_catalogo as admision
from plataforma_datos.cursos import (
    aprendizaje_ciber,
    contenido_academy,
    contenido_ciber,
    indices_evidencias,
    registro_vigencia,
)
from plataforma_datos.cursos.contrato_entrega_catalogo import exigir
from plataforma_datos.cursos.fuentes.hp_life import actualizacion as hp
from plataforma_datos.cursos.fuentes.hp_life import lector
from plataforma_datos.cursos.fuentes.hp_life.recepciones import MAX_CUERPO, MAX_RECIBO, leer_recepcion


def referencias_de_evidencia_indexadas(solicitud: admision.SolicitudAdmision) -> dict[str, admision.ReferenciaArchivo]:
    """Reúne por SHA-256 las referencias verificadas de todos los índices de evidencias admitidos.

    Returns:
        Referencias de archivos por SHA-256.
    """
    referencias = {}
    for indice in solicitud.indices_evidencias.values():
        contenido = hp.leer_verificado(indice.archivo, indices_evidencias.MAX_INDICE)
        for prueba in indices_evidencias.leer_indice(contenido):
            referencias.setdefault(
                prueba.sha256, admision.ReferenciaArchivo(ruta=indice.raiz / prueba.archivo, sha256=prueba.sha256)
            )
    return referencias


def _hp_actuales(solicitud: admision.SolicitudAdmision, ids: Iterable[str]) -> dict[str, lector.FichaHpLife]:
    """Reextrae solo los IDs editoriales desde el lote actual de la admisión recibida.

    El llamador exige la admisión antes y después. Las referencias históricas no
    eligen la recepción. Un contenido distinto de la instantánea retiene la ficha.

    Returns:
        Fichas coherentes con la instantánea y la captura actual, nunca una alternativa histórica.
    """
    control = solicitud.procedencia.get("control-hp")
    if control is None:
        return {}
    dato = json.loads(hp.leer_verificado(control, indices_evidencias.MAX_INDICE))
    recepciones = dato["entradas"]["recepciones"]
    exigir(isinstance(recepciones, list), "Control HP sin recepciones actuales")
    por_id = {r["id"]: r for r in recepciones}
    exigir(len(por_id) == len(recepciones), "Control HP con identidad repetida")
    referencias = referencias_de_evidencia_indexadas(solicitud)
    salida = {}
    conexion = sqlite3.connect(solicitud.snapshot.ruta.resolve().as_uri() + "?mode=ro&immutable=1", uri=True)
    try:
        for identidad in ids:
            r = por_id.get(identidad)
            if r is None:
                continue
            cuerpo = referencias.get(r["cuerpo_sha256"])
            recibo = referencias.get(r["recibo_sha256"])
            exigir(cuerpo is not None and recibo is not None, "Recepción actual fuera de los índices admitidos")
            recepcion = leer_recepcion(hp.leer_verificado(cuerpo, MAX_CUERPO), hp.leer_verificado(recibo, MAX_RECIBO))
            ficha = lector.extraer_ficha(recepcion.cuerpo, recepcion.captura)
            exigir(ficha.id == identidad, "Recepción actual de otro programa")
            fila = conexion.execute("SELECT datos FROM programas WHERE id=?", (identidad,)).fetchone()
            exigir(fila is not None, "Recepción actual sin programa en la instantánea")
            datos = json.loads(fila[0])
            if (
                datos.get("cuerpo_html_publicado") == ficha.cuerpo_html
                and datos.get("descripcion_publicada") == ficha.descripcion
            ):
                salida[identidad] = ficha
    finally:
        conexion.close()
    return salida


def _ciber_actuales(solicitud: admision.SolicitudAdmision, ids: set[str], referencias: dict) -> dict:
    """Solicita solo las identidades editoriales Ciber de la selección admitida.

    Returns:
        Temarios del mismo material/observación actual que respalda sus hechos públicos.
    """
    candidatos = {id for id in ids if id.startswith("cibervoluntarios:material:") or id == "fundae:1:3462"}
    if not candidatos:
        return {}
    evaluaciones = {
        id: registro_vigencia.consultar_unidad(solicitud.snapshot.ruta, tipo="recurso", id=id)["evaluacion"]
        for id in candidatos
    }
    seleccion = contenido_ciber.seleccionados(solicitud, candidatos, referencias, evaluaciones)
    conexion = sqlite3.connect(solicitud.snapshot.ruta.as_uri() + "?mode=ro&immutable=1", uri=True)
    try:
        return {
            id: aprendizaje_ciber.construir(
                id,
                material,
                ctx,
                conexion.execute("SELECT url FROM programas WHERE id=?", (id,)).fetchone()[0],
            )
            for id, (material, ctx) in seleccion.items()
        }
    finally:
        conexion.close()


def contenidos_actuales(
    solicitud: admision.SolicitudAdmision, ids: Iterable[str]
) -> dict[str, lector.FichaHpLife | contenido_academy.TemarioAcademy | aprendizaje_ciber.TemarioCiber]:
    """Lee por fuente el temario actual seleccionado, nunca una captura histórica conveniente.

    Returns:
        Recursos enlazados a los mismos cuerpos y observaciones de la instantánea admitida.
    """
    identidades = set(ids)
    referencias = referencias_de_evidencia_indexadas(solicitud)
    return {
        **_hp_actuales(solicitud, identidades),
        **contenido_academy.actuales(solicitud, identidades, referencias),
        **_ciber_actuales(solicitud, identidades, referencias),
    }
