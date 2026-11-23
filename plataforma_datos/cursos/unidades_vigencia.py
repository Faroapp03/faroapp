"""Identidad tipada de las unidades de vigencia (edición o recurso) y verificación de su esquema en el catálogo V10."""

import json
import re
import sqlite3
from dataclasses import dataclass
from typing import Literal

from plataforma_datos.cursos import almacen_vigencia as almacen
from plataforma_datos.cursos import catalogo
from plataforma_datos.cursos.almacen_vigencia import ErrorRegistroVigencia
from plataforma_datos.cursos.tipos_json import ObjetoJson

TipoUnidad = Literal["edicion", "recurso"]
PARTES_CLAVE = 2
TOKENS_SQL = re.compile(
    "'(?:''|[^'])*'|\"(?:\"\"|[^\"])*\"|`(?:``|[^`])*`|\\[[^\\]]*\\]|\\w+|<=|>=|<>|!=|==|\\|\\||[^\\s]"
)
TABLAS = (
    "observaciones_vigencia",
    "revisiones_observaciones_vigencia",
    "evaluaciones_vigencia",
    "cambios_decision_vigencia",
)
ESQUEMA = """
CREATE TABLE unidades_vigencia (
 clave TEXT PRIMARY KEY NOT NULL, tipo TEXT NOT NULL CHECK(tipo IN ('edicion','recurso')),
 entidad_id TEXT NOT NULL CHECK(length(entidad_id)>0),
 edicion_id TEXT REFERENCES ediciones(id), programa_id TEXT REFERENCES programas(id),
 UNIQUE(tipo,entidad_id), UNIQUE(clave,edicion_id),
 CHECK(clave=json_array(tipo,entidad_id)),
 CHECK((tipo='edicion' AND edicion_id=entidad_id AND edicion_id IS NOT NULL AND programa_id IS NULL)
 OR (tipo='recurso' AND programa_id=entidad_id AND programa_id IS NOT NULL AND edicion_id IS NULL)));
CREATE TABLE observaciones_vigencia (
 edicion_id TEXT REFERENCES ediciones(id), observacion_id TEXT NOT NULL,
 hasta_us INTEGER NOT NULL, registrado_utc TEXT NOT NULL, huella TEXT NOT NULL,
 contenido TEXT NOT NULL CHECK(json_valid(contenido)), huella_fisica TEXT NOT NULL,
 unidad_clave TEXT NOT NULL REFERENCES unidades_vigencia(clave),
 PRIMARY KEY(unidad_clave,observacion_id),
 CHECK((edicion_id IS NULL AND json_extract(unidad_clave,'$[0]')='recurso')
 OR (edicion_id IS NOT NULL AND unidad_clave=json_array('edicion',edicion_id))));
CREATE TABLE revisiones_observaciones_vigencia (
 id INTEGER PRIMARY KEY, edicion_id TEXT REFERENCES ediciones(id),
 base_id INTEGER REFERENCES revisiones_observaciones_vigencia(id),
 modo TEXT NOT NULL CHECK(modo IN ('anexar','orden')), ids TEXT NOT NULL CHECK(json_valid(ids)),
 total INTEGER NOT NULL, huella_ids TEXT NOT NULL, huella_revision TEXT NOT NULL,
 unidad_clave TEXT NOT NULL REFERENCES unidades_vigencia(clave), UNIQUE(unidad_clave,huella_ids),
 CHECK((edicion_id IS NULL AND json_extract(unidad_clave,'$[0]')='recurso')
 OR (edicion_id IS NOT NULL AND unidad_clave=json_array('edicion',edicion_id))));
CREATE TABLE evaluaciones_vigencia (
 id INTEGER PRIMARY KEY, edicion_id TEXT REFERENCES ediciones(id),
 corte_us INTEGER NOT NULL, registrado_utc TEXT NOT NULL,
 huella_edicion TEXT, huella_entradas TEXT NOT NULL, huella_evaluador TEXT NOT NULL,
 huella_resultado TEXT NOT NULL, huella_registro TEXT NOT NULL,
 contenido TEXT NOT NULL CHECK(json_valid(contenido)),
 revision_observaciones_id INTEGER REFERENCES revisiones_observaciones_vigencia(id), huella_fisica TEXT,
 unidad_clave TEXT NOT NULL REFERENCES unidades_vigencia(clave), huella_unidad TEXT NOT NULL,
 UNIQUE(unidad_clave,corte_us),
 CHECK((edicion_id IS NULL AND huella_edicion IS NULL AND json_extract(unidad_clave,'$[0]')='recurso')
 OR (edicion_id IS NOT NULL AND unidad_clave=json_array('edicion',edicion_id)
 AND huella_edicion IS NOT NULL AND huella_edicion=huella_unidad)));
CREATE TABLE cambios_decision_vigencia (
 id INTEGER PRIMARY KEY, edicion_id TEXT REFERENCES ediciones(id),
 anterior_id INTEGER REFERENCES evaluaciones_vigencia(id),
 evaluacion_id INTEGER NOT NULL UNIQUE REFERENCES evaluaciones_vigencia(id),
 unidad_clave TEXT NOT NULL REFERENCES unidades_vigencia(clave),
 CHECK((edicion_id IS NULL AND json_extract(unidad_clave,'$[0]')='recurso')
 OR (edicion_id IS NOT NULL AND unidad_clave=json_array('edicion',edicion_id))));
"""
INDICES = """
CREATE INDEX vigencia_edicion_corte ON evaluaciones_vigencia(edicion_id,corte_us DESC);
CREATE INDEX vigencia_unidad_corte ON evaluaciones_vigencia(unidad_clave,corte_us DESC);
"""


def clave(tipo: TipoUnidad, id: str) -> str:
    """Devuelve identidad inyectiva sin transformar el ID nativo.

    Returns:
        JSON canónico del par tipo e identidad.

    Raises:
        ErrorRegistroVigencia: Si el tipo o la identidad no son válidos.
    """
    if tipo not in ("edicion", "recurso") or not isinstance(id, str) or not id.strip():
        raise ErrorRegistroVigencia("Tipo o ID de unidad inválidos")
    return almacen.json_canonico([tipo, id])


@dataclass(frozen=True, kw_only=True)
class UnidadEvaluable:
    """Identidad nativa y huella de contenido esperada, nunca una convocatoria fabricada."""

    tipo: TipoUnidad
    id: str
    huella: str

    def __post_init__(self) -> None:
        clave(self.tipo, self.id)
        if not isinstance(self.huella, str) or re.fullmatch(r"[0-9a-f]{64}", self.huella) is None:
            raise ErrorRegistroVigencia("Huella de unidad inválida")


def identificar(conexion: sqlite3.Connection, tipo: TipoUnidad, id: str) -> ObjetoJson | None:
    """Lee la unidad real, sin crear recursos o derivar una identidad por prefijos.

    Returns:
        Identidad y huella actuales, o ausencia explícita.

    Raises:
        ErrorRegistroVigencia: Si el contenido no coincide con su huella almacenada.
    """
    clave(tipo, id)
    tabla = "ediciones" if tipo == "edicion" else "programas"
    fila = conexion.execute("SELECT * FROM " + tabla + " WHERE id=?", (id,)).fetchone()
    vinculada = conexion.execute("SELECT 1 FROM unidades_vigencia WHERE clave=?", (clave(tipo, id),)).fetchone()
    if vinculada is not None:
        verificar_clave(conexion, clave(tipo, id))
    if fila is None:
        return None
    _verificar_contenido_nativo(fila)
    return {"tipo": tipo, "id": id, "huella": fila["huella"]}


def asegurar(conexion: sqlite3.Connection, tipo: TipoUnidad, id: str) -> str:
    """Vincula una identidad existente dentro de la transacción de admisión.

    Returns:
        Clave canónica de la unidad ya vinculada.

    Raises:
        ErrorRegistroVigencia: Si la unidad nativa no existe o fue alterada.
    """
    if identificar(conexion, tipo, id) is None:
        raise ErrorRegistroVigencia("Unidad nativa inexistente; no se crea desde una evaluación")
    if tipo == "recurso" and tiene_ediciones(conexion, id):
        raise ErrorRegistroVigencia(f"El programa {id} tiene ediciones: requiere evaluación por edición")
    identidad = clave(tipo, id)
    conexion.execute(
        "INSERT INTO unidades_vigencia(clave,tipo,entidad_id,edicion_id,programa_id) VALUES(?,?,?,?,?) "
        "ON CONFLICT(clave) DO NOTHING",
        (identidad, tipo, id, id if tipo == "edicion" else None, id if tipo == "recurso" else None),
    )
    return identidad


def tiene_ediciones(conexion: sqlite3.Connection, programa_id: str) -> bool:
    """Identifica el dominio conocido, no el cierre ni el acceso independiente del programa.

    Returns:
        True si existe al menos una edición del programa, cualquiera que sea su estado.
    """
    return (
        conexion.execute("SELECT 1 FROM ediciones WHERE programa_id=? LIMIT 1", (programa_id,)).fetchone() is not None
    )


def _verificar_contenido_nativo(fila: sqlite3.Row) -> None:
    columnas = fila.keys()  # sqlite3.Row comprueba valores, no nombres, en su operador «in».
    tipo = "edicion" if "programa_id" in columnas else "programa"
    diagnostico = f"Contenido de unidad alterado ({tipo}:{fila['id']})"
    try:
        contenido = catalogo.contenido_anterior(fila)
    except json.JSONDecodeError as error:
        raise ErrorRegistroVigencia(diagnostico) from error
    if catalogo.huella(contenido) != fila["huella"]:
        raise ErrorRegistroVigencia(diagnostico)


def verificar_pagina(conexion: sqlite3.Connection, tipo: TipoUnidad, ids: list[str]) -> None:
    """Contrasta cuerpos nativos de la página seleccionada con una consulta acotada.

    Raises:
        ErrorRegistroVigencia: Si falta una unidad seleccionada o su contenido fue alterado.
    """
    clave(tipo, "validacion-de-tipo")
    if not ids:
        return
    tabla = "ediciones" if tipo == "edicion" else "programas"
    filas = conexion.execute("SELECT * FROM " + tabla + " WHERE id IN (" + ",".join("?" for _ in ids) + ")", ids)
    encontrados = set()
    for fila in filas:
        _verificar_contenido_nativo(fila)
        encontrados.add(fila["id"])
    if encontrados != set(ids):
        raise ErrorRegistroVigencia("Unidad seleccionada inexistente en la instantánea")


def _normalizado(sql: str) -> tuple[str, ...]:
    return tuple(TOKENS_SQL.findall(sql.strip().rstrip(";")))


def verificar(conexion: sqlite3.Connection, *, completo: bool = False) -> None:
    """Exige DDL conocido e identidades coherentes antes de leer o escribir la vigencia.

    Raises:
        ErrorRegistroVigencia: Si falta una relación, el esquema cambió o una clave no es canónica.
    """
    for sentencia in (ESQUEMA + INDICES).split(";"):
        if not sentencia.strip():
            continue
        nombre = re.search(r"CREATE (?:TABLE|INDEX) (\w+)", sentencia)[1]
        fila = conexion.execute("SELECT sql FROM sqlite_master WHERE name=?", (nombre,)).fetchone()
        if fila is None or _normalizado(fila[0]) != _normalizado(sentencia):
            raise ErrorRegistroVigencia("Esquema de vigencia incompatible: " + nombre)
    if completo:
        _verificar_todas(conexion)
    for tabla in (*TABLAS, "unidades_vigencia"):
        if conexion.execute("SELECT 1 FROM sqlite_master WHERE type='trigger' AND tbl_name=?", (tabla,)).fetchone():
            raise ErrorRegistroVigencia("Trigger de vigencia no declarado")


def verificar_clave(conexion: sqlite3.Connection, identidad: str) -> None:
    """Contrasta solo la identidad consultada y su destino nativo real.

    Raises:
        ErrorRegistroVigencia: Si la clave, relación o FK consultada no son verificables.
    """
    try:
        par = json.loads(identidad)
    except (ValueError, TypeError) as error:
        raise ErrorRegistroVigencia("Clave de unidad ilegible") from error
    if not isinstance(par, list) or len(par) != PARTES_CLAVE or clave(*par) != identidad:
        raise ErrorRegistroVigencia("Clave de unidad no canónica")
    tipo, id = par
    fila = conexion.execute("SELECT * FROM unidades_vigencia WHERE clave=?", (identidad,)).fetchone()
    esperada = (identidad, tipo, id, id if tipo == "edicion" else None, id if tipo == "recurso" else None)
    if fila is None or tuple(fila) != esperada:
        raise ErrorRegistroVigencia("Identidad tipada o FK alteradas")
    tabla = "ediciones" if tipo == "edicion" else "programas"
    if conexion.execute("SELECT 1 FROM " + tabla + " WHERE id=?", (id,)).fetchone() is None:
        raise ErrorRegistroVigencia("Destino nativo de unidad inexistente")


def _verificar_todas(conexion: sqlite3.Connection) -> None:
    if conexion.execute("PRAGMA foreign_key_check").fetchone() is not None:
        raise ErrorRegistroVigencia("Relación de unidad o historia inexistente")
    for fila in conexion.execute("SELECT clave FROM unidades_vigencia"):
        verificar_clave(conexion, fila[0])
    _verificar_compatibilidad(conexion)
    for tabla in ("ediciones", "programas"):
        for fila in conexion.execute("SELECT * FROM " + tabla):
            _verificar_contenido_nativo(fila)


def _verificar_compatibilidad(conexion: sqlite3.Connection) -> None:
    condicion = "((edicion_id IS NOT NULL AND unidad_clave=json_array('edicion',edicion_id)) OR "
    condicion += "(edicion_id IS NULL AND json_extract(unidad_clave,'$[0]')='recurso'))"
    for tabla in TABLAS:
        criterio = condicion
        if tabla == "evaluaciones_vigencia":
            criterio += " AND ((edicion_id IS NULL AND huella_edicion IS NULL) OR "
            criterio += "(edicion_id IS NOT NULL AND huella_edicion IS NOT NULL AND huella_edicion=huella_unidad))"
        fila = conexion.execute("SELECT 1 FROM " + tabla + " WHERE COALESCE((" + criterio + "),0)=0 LIMIT 1").fetchone()
        if fila is not None:
            raise ErrorRegistroVigencia("Proyección de edición incompatible con la unidad canónica")


def verificar_historia_de_vigencia(conexion: sqlite3.Connection) -> dict[int, str]:
    """Revalida todas las observaciones, revisiones, cambios y evaluaciones de vigencia de un catálogo.

    Returns:
        La clave de unidad de cada evaluación, por identificador.
    """
    from plataforma_datos.cursos import registro_vigencia as registro

    registro.exigir_esquema_de_vigencia(conexion)
    for fila in conexion.execute("SELECT * FROM observaciones_vigencia"):
        almacen.leer_observacion_verificada(fila, conexion)
    for fila in conexion.execute("SELECT * FROM revisiones_observaciones_vigencia"):
        almacen.ids_revision(conexion, fila["id"], fila["unidad_clave"])
    filas = {f["id"]: f for f in conexion.execute("SELECT * FROM evaluaciones_vigencia")}
    for fila in conexion.execute("SELECT * FROM cambios_decision_vigencia"):
        registro.comprobar_referencia_de_cambio(fila, filas)
    for fila in filas.values():
        registro.contenido_verificado_de_evaluacion(conexion, fila)
    return {id: fila["huella_registro"] for id, fila in filas.items()}
