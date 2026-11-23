"""Altas de HP LIFE: un curso que el índice acredita y el catálogo aún no conoce entra con su ficha y su página.

La alta necesita las dos evidencias: la página del índice donde se ve el curso y su ficha íntegra, con la misma
identidad. Sin una de ellas el curso no entra; la ficha conservada espera a una consulta que las traiga juntas.
"""

import sqlite3
from collections.abc import Callable, Sequence
from copy import deepcopy
from dataclasses import dataclass
from http import HTTPStatus

from plataforma_datos.cursos.admision_catalogo import ReferenciaArchivo
from plataforma_datos.cursos.fuentes.hp_life import indice, lector
from plataforma_datos.cursos.fuentes.hp_life.lotes_actualizacion import PlanRecurso
from plataforma_datos.cursos.fuentes.hp_life.recepciones import RecepcionHpLife, leer_recepcion
from plataforma_datos.cursos.tipos_json import ObjetoJson

VERSION_LOTE = 1
# Canal de origen de una alta: histórico, sin atribución de campos hasta que su ficha se ancle en un ciclo posterior.
CANAL_ALTA = "hp-life-alta-por-indice"


@dataclass(frozen=True, kw_only=True)
class PaginaIndiceEnDisco:
    """Página del índice conservada con su recibo; solo acredita los cursos que ella misma lista."""

    pagina: int
    cuerpo: ReferenciaArchivo
    recibo: ReferenciaArchivo


def paginas_leidas(
    paginas: Sequence[PaginaIndiceEnDisco], leer: Callable[[ReferenciaArchivo], bytes]
) -> list[tuple[int, RecepcionHpLife, indice.PaginaIndice]]:
    """Lee las páginas del índice conservadas, por orden de número; una que no se puede leer no acredita nada.

    Returns:
        Número, recepción y lectura de cada página legible.
    """
    resultado = []
    for pagina in sorted(paginas, key=lambda p: p.pagina):
        try:
            recepcion = leer_recepcion(leer(pagina.cuerpo), leer(pagina.recibo))
            resultado.append((pagina.pagina, recepcion, indice.extraer_indice(recepcion.cuerpo, recepcion.captura)))
        except lector.ErrorFichaHpLife:
            continue
    return resultado


def acreditaciones(
    paginas: Sequence[PaginaIndiceEnDisco], leer: Callable[[ReferenciaArchivo], bytes]
) -> dict[str, RecepcionHpLife]:
    """Para cada curso visto en el índice, la recepción de la página donde se ve.

    Returns:
        Identidad del curso y recepción de su página.
    """
    resultado: dict[str, RecepcionHpLife] = {}
    for _numero, recepcion, leida in paginas_leidas(paginas, leer):
        for curso in leida.cursos:
            resultado.setdefault(curso.identidad, recepcion)
    return resultado


def conocido(conexion: sqlite3.Connection, id: str) -> bool:
    """Indica si el catálogo ya tiene la unidad.

    Returns:
        True si existe como programa.
    """
    return conexion.execute("SELECT 1 FROM programas WHERE id=?", (id,)).fetchone() is not None


def planificar_alta(
    recepcion: RecepcionHpLife, observacion: ObjetoJson, acreditacion: RecepcionHpLife | None
) -> PlanRecurso | None:
    """Construye el programa de una alta desde su ficha, si hay ficha íntegra y página del índice que la acredite.

    Returns:
        Plan con el lote de la alta, o None si falta alguna de las dos evidencias o no se contrastan.
    """
    cap = recepcion.captura
    if (
        acreditacion is None
        or cap.http != HTTPStatus.OK
        or cap.completo is not True
        or observacion["detalle"].get("tipo_destino") != "ficha"
    ):
        return None
    try:
        ficha = lector.extraer_ficha(recepcion.cuerpo, cap)
    except lector.ErrorFichaHpLife:
        return None
    url = f"https://{indice.HOST}/{ficha.idioma}/course/{ficha.id_fuente}"
    if ficha.idioma not in indice.IDIOMAS_ALTA or cap.url_solicitada != url:
        return None
    programa = {
        "id": ficha.id,
        "proveedor_id": "hp-life",
        "titulo": ficha.titulo,
        "url": url,
        "tipo_unidad": "curso",
        "datos": {
            "identidad_fuente": {"id": ficha.id_fuente, "idioma": ficha.idioma, "codigo": ficha.codigo},
            "cuerpo_html_publicado": ficha.cuerpo_html,
            "descripcion_publicada": ficha.descripcion,
            "idiomas_publicados": [ficha.idioma],
            "estado_fuente_literal": ficha.estado,
        },
    }
    lote = {
        "schema_version": VERSION_LOTE,
        "observado_utc": cap.recibido_utc,
        "fuente_lote": "hp_life:recurso:1",
        "proveedores": [],
        "programas": [{**deepcopy(programa), "etiquetas": [], "evidencias": []}],
        "ediciones": [],
    }
    return PlanRecurso(programa=programa, lote=lote, canales=(), recepcion=recepcion, acreditacion=acreditacion)
