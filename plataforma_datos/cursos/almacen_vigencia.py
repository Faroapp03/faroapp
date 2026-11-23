"""Formato físico 3 de la vigencia del catálogo V10: observaciones únicas y revisiones ordenadas sin recursión.

Cada fila se acota por su unidad (`unidad_clave`, la clave tipada de una edición o un recurso). Los parámetros
`edicion_id` conservan ese nombre, pero reciben la clave de la unidad; la columna SQL `edicion_id` es solo la
proyección de las unidades de edición. El contenido estable se guarda compartido con `contenidos_vigencia`.
"""

import hashlib
import json
import sqlite3
from datetime import UTC, datetime

from plataforma_datos.cursos import contenidos_vigencia as compartidos
from plataforma_datos.cursos.tipos_json import ObjetoJson, ValorJson

FORMATO_UNIDADES = 3


class ErrorRegistroVigencia(ValueError):
    """Evaluación, cronología o historia que no pueden admitirse en el registro."""


def json_canonico(valor: ValorJson) -> str:
    """Serializa exactamente el contrato lógico 1 previo.

    Returns:
        JSON UTF-8 portable, ordenado y sin NaN.
    """
    return json.dumps(valor, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def huella(valor: ValorJson) -> str:
    """Calcula el mismo SHA256 lógico usado en v6.

    Returns:
        Huella hexadecimal del JSON canónico.
    """
    return hashlib.sha256(json_canonico(valor).encode()).hexdigest()


def corte(fecha: str) -> int:
    """Ordena UTC en microsegundos, sin redondear a segundos ni usar ingestión.

    Returns:
        Microsegundos enteros desde el origen Unix.
    """
    instante = datetime.fromisoformat(fecha.replace("Z", "+00:00"))
    delta = instante - datetime(1970, 1, 1, tzinfo=UTC)
    return ((delta.days * 86400 + delta.seconds) * 1_000_000) + delta.microseconds


def _hasta(observacion: ObjetoJson) -> int:
    fechas = [observacion["intentado_el"], observacion["terminado_el"]]
    fechas.extend(e["capturado_utc"] for e in observacion["evidencias"])
    return max(corte(f) for f in fechas)


def _leer_compartido(conexion: sqlite3.Connection, dato: ObjetoJson, cache: dict | None) -> ObjetoJson:
    if "formato_contenido" not in dato:
        raise ErrorRegistroVigencia("V10 exige referencias de contenido compartido")
    try:
        resultado = compartidos.decodificar(conexion, dato, cache=cache)
    except compartidos.ErrorContenido as error:
        raise ErrorRegistroVigencia(str(error)) from error
    if not isinstance(resultado, dict):
        raise ErrorRegistroVigencia("Registro compartido no es objeto")
    return resultado


def _guardar_compartido(conexion: sqlite3.Connection, dato: ObjetoJson, identidades: set[str]) -> ObjetoJson:
    return compartidos.codificar(
        conexion, dato, identidades=identidades, variables=frozenset({("revision_observaciones",)})
    )


def conservar_compacto(conexion: sqlite3.Connection, contenido: ObjetoJson, revision_id: int) -> ObjetoJson:
    """Comparte contenido estable; mantiene el mismo objeto lógico y su sello.

    Returns:
        Representación física del registro sin duplicar cuerpos o metadatos estables.
    """
    identidades = {o["id"] for o in contenido["entradas"]["observaciones"]}
    identidades.update(contenido[c] for c in ("huella_entradas", "huella_resultado"))
    return _guardar_compartido(conexion, compactar(contenido, revision_id), identidades)


def leer_observacion_verificada(
    fila: sqlite3.Row, conexion: sqlite3.Connection, cache: dict | None = None
) -> ObjetoJson:
    """Reconstruye una observación conservada y exige que sus huellas, su identidad y su final coincidan con la fila.

    Returns:
        El contenido de la observación.

    Raises:
        ErrorRegistroVigencia: Si la fila o su contenido no coinciden con sus huellas.
    """
    contenido = _leer_compartido(conexion, json.loads(fila["contenido"]), cache)
    if (
        sello_fisico(fila) != fila["huella_fisica"]
        or huella(contenido) != fila["huella"]
        or contenido["id"] != fila["observacion_id"]
        or _hasta(contenido) != fila["hasta_us"]
    ):
        raise ErrorRegistroVigencia("Observación inmutable alterada")
    return contenido


def proyeccion_sql_de_identidad(conexion: sqlite3.Connection, identidad: str) -> ObjetoJson:
    """Traduce la clave de una unidad a las columnas de identidad con que se guardan sus filas de vigencia.

    Returns:
        La edición (o `None` si la unidad no es una edición) y la clave de la unidad.
    """
    tipo, id = json.loads(identidad)
    return {"edicion_id": id if tipo == "edicion" else None, "unidad_clave": identidad}


def insertar_fila_vigencia(conexion: sqlite3.Connection, tabla: str, fila: ObjetoJson) -> sqlite3.Cursor:
    """Inserta en la tabla una fila ya preparada, columna a columna, dentro de la conexión recibida.

    Returns:
        El cursor de la inserción.
    """
    return conexion.execute(
        "INSERT INTO " + tabla + "(" + ",".join(fila) + ") VALUES(" + ",".join("?" for _ in fila) + ")",
        tuple(fila.values()),
    )


def _sello_revision(fila: sqlite3.Row | ObjetoJson) -> str:
    campos = ("edicion_id", "base_id", "modo", "ids", "total", "huella_ids", "unidad_clave")
    return huella({k: fila[k] for k in campos})


def _revisiones(conexion: sqlite3.Connection, edicion_id: str) -> dict[int, sqlite3.Row]:
    filas = {
        f["id"]: f
        for f in conexion.execute("SELECT * FROM revisiones_observaciones_vigencia WHERE unidad_clave=?", (edicion_id,))
    }
    conocidas = {
        f[0]
        for f in conexion.execute(
            "SELECT observacion_id FROM observaciones_vigencia WHERE unidad_clave=?", (edicion_id,)
        )
    }
    for fila in filas.values():
        ids = json.loads(fila["ids"])
        if (
            fila["huella_revision"] != _sello_revision(fila)
            or not isinstance(ids, list)
            or any(not isinstance(i, str) for i in ids)
            or len(ids) != len(set(ids))
            or not set(ids) <= conocidas
            or fila["base_id"] is not None
            and (fila["base_id"] not in filas or fila["base_id"] >= fila["id"])
            or fila["modo"] not in ("anexar", "orden")
            or fila["modo"] == "orden"
            and fila["base_id"] is not None
        ):
            raise ErrorRegistroVigencia("Revisión de observaciones alterada o cíclica")
    return filas


def ids_revision(conexion: sqlite3.Connection, revision_id: int, edicion_id: str) -> list[str]:
    """Reconstruye una revisión iterativamente sin heredar adquisiciones posteriores.

    Returns:
        IDs en el orden exacto admitido.

    Raises:
        ErrorRegistroVigencia: Falta una referencia, hay ciclo o difieren lista/huella.
    """
    filas = _revisiones(conexion, edicion_id)
    visitadas = set()
    cadena = []
    actual = revision_id
    while actual is not None:
        if actual in visitadas or actual not in filas:
            raise ErrorRegistroVigencia("Referencia de revisión ausente o cíclica")
        visitadas.add(actual)
        fila = filas[actual]
        cadena.append(fila)
        actual = fila["base_id"]
    ids = []
    for fila in reversed(cadena):
        ids.extend(json.loads(fila["ids"]))
    final = filas[revision_id]
    if len(ids) != final["total"] or len(ids) != len(set(ids)) or huella(ids) != final["huella_ids"]:
        raise ErrorRegistroVigencia("Lista reconstruida de observaciones incoherente")
    return ids


def sello_fisico(fila: sqlite3.Row | ObjetoJson) -> str:
    """Vincula el cuerpo compacto con identidad y metadatos SQL de su evaluación.

    Returns:
        SHA256 físico, distinto del sello lógico conservado.
    """
    return huella({k: v for k, v in dict(fila).items() if k != "huella_fisica"})


def contenido_fisico(fila: sqlite3.Row, conexion: sqlite3.Connection, cache: dict | None = None) -> ObjetoJson:
    """Comprueba un registro compacto sin expandir sus observaciones.

    Returns:
        Envoltorio físico íntegro del formato 3 (`FORMATO_UNIDADES`).

    Raises:
        ErrorRegistroVigencia: El contenido o referencia compacta fueron alterados.
    """
    compacto = _leer_compartido(conexion, json.loads(fila["contenido"]), cache)
    if (
        sello_fisico(fila) != fila["huella_fisica"]
        or compacto["formato_registro"] != FORMATO_UNIDADES
        or compacto["revision_observaciones"] != fila["revision_observaciones_id"]
    ):
        raise ErrorRegistroVigencia("Historia física de vigencia alterada")
    return compacto


def comprobar_continuidad(
    conexion: sqlite3.Connection, edicion_id: str, observaciones: list[ObjetoJson], ahora: str
) -> None:
    """Verifica una vez cada cuerpo único y cada sello físico de la edición.

    Raises:
        ErrorRegistroVigencia: Un ID cambia, falta continuidad o se alteró el historial.
    """
    recibidas = {o["id"]: huella(o) for o in observaciones}
    instante = corte(ahora)
    for fila in conexion.execute("SELECT * FROM observaciones_vigencia WHERE unidad_clave=?", (edicion_id,)):
        leer_observacion_verificada(fila, conexion)
        identidad = fila["observacion_id"]
        if identidad in recibidas and recibidas[identidad] != fila["huella"]:
            raise ErrorRegistroVigencia("ID de observación en conflicto con la historia admitida")
        if fila["hasta_us"] <= instante and identidad not in recibidas:
            raise ErrorRegistroVigencia("Falta continuidad del conjunto de observaciones para ese corte")
    revisiones = _revisiones(conexion, edicion_id)
    for fila in conexion.execute("SELECT * FROM evaluaciones_vigencia WHERE unidad_clave=?", (edicion_id,)):
        contenido_fisico(fila, conexion)
        if fila["revision_observaciones_id"] not in revisiones:
            raise ErrorRegistroVigencia("Evaluación con revisión de otra edición o ausente")


def guardar_observaciones(
    conexion: sqlite3.Connection, edicion_id: str, observaciones: list[ObjetoJson], registrado_utc: str
) -> None:
    """Admite cuerpos por edición+ID, conservando su primera admisión y recepción propias.

    Raises:
        ErrorRegistroVigencia: Un ID admitido pretende representar otra adquisición.
    """
    existentes = {
        f["observacion_id"]: f["huella"]
        for f in conexion.execute(
            "SELECT observacion_id,huella FROM observaciones_vigencia WHERE unidad_clave=?", (edicion_id,)
        )
    }
    for observacion in observaciones:
        identidad, firma = observacion["id"], huella(observacion)
        if identidad in existentes:
            if existentes[identidad] != firma:
                raise ErrorRegistroVigencia("ID de observación en conflicto con la historia admitida")
            continue
        fila = {
            **proyeccion_sql_de_identidad(conexion, edicion_id),
            "observacion_id": identidad,
            "hasta_us": _hasta(observacion),
            "registrado_utc": registrado_utc,
            "huella": firma,
            "contenido": json_canonico(_guardar_compartido(conexion, observacion, {observacion["id"]})),
        }
        insertar_fila_vigencia(conexion, "observaciones_vigencia", {**fila, "huella_fisica": sello_fisico(fila)})


def guardar_revision(conexion: sqlite3.Connection, edicion_id: str, ids: list[str], base_id: int | None) -> int:
    """Reutiliza lista idéntica o guarda solo el delta de un prefijo exacto.

    Reordenaciones/selecciones históricas se guardan explícitamente como IDs; no
    se promete crecimiento lineal universal ante permutaciones arbitrarias.

    Returns:
        Identidad local de la revisión, sin atribuir comprobación remota.

    Raises:
        ErrorRegistroVigencia: La revisión conservada no reproduce los IDs solicitados.
    """
    firma = huella(ids)
    existente = conexion.execute(
        "SELECT id FROM revisiones_observaciones_vigencia WHERE unidad_clave=? AND huella_ids=?",
        (edicion_id, firma),
    ).fetchone()
    if existente is not None:
        if ids_revision(conexion, existente["id"], edicion_id) != ids:
            raise ErrorRegistroVigencia("Revisión en conflicto")
        return existente["id"]
    prefijo = [] if base_id is None else ids_revision(conexion, base_id, edicion_id)
    anexar = ids[: len(prefijo)] == prefijo
    fila = {
        **proyeccion_sql_de_identidad(conexion, edicion_id),
        "base_id": base_id if anexar else None,
        "modo": "anexar" if anexar else "orden",
        "ids": json_canonico(ids[len(prefijo) :] if anexar else ids),
        "total": len(ids),
        "huella_ids": firma,
    }
    cursor = insertar_fila_vigencia(
        conexion, "revisiones_observaciones_vigencia", {**fila, "huella_revision": _sello_revision(fila)}
    )
    return cursor.lastrowid


def compactar(contenido: ObjetoJson, revision_id: int) -> ObjetoJson:
    """Sustituye solo la lista de cuerpos por referencia física; conserva sello lógico.

    Returns:
        Registro físico que no duplica observaciones acumuladas.
    """
    registro = {**contenido, "entradas": {k: v for k, v in contenido["entradas"].items() if k != "observaciones"}}
    return {
        "formato_registro": FORMATO_UNIDADES,
        "revision_observaciones": revision_id,
        "registro": registro,
    }


def sellar_evaluacion(conexion: sqlite3.Connection, identificador: int) -> None:
    """Sella el registro compacto ya escrito, sin insertar copias transitorias de observaciones."""
    fila = conexion.execute("SELECT * FROM evaluaciones_vigencia WHERE id=?", (identificador,)).fetchone()
    conexion.execute("UPDATE evaluaciones_vigencia SET huella_fisica=? WHERE id=?", (sello_fisico(fila), identificador))


def reconstruir(conexion: sqlite3.Connection, fila: sqlite3.Row) -> ObjetoJson:
    """Reúne el contenido lógico original sin unir observaciones ajenas a su revisión.

    Returns:
        Mismo objeto y orden lógico de la evaluación original.

    Raises:
        ErrorRegistroVigencia: Referencia de observación ausente o cuerpo alterado.
    """
    cache = {}
    compacto = contenido_fisico(fila, conexion, cache)
    ids = ids_revision(
        conexion,
        fila["revision_observaciones_id"],
        fila["unidad_clave"],
    )
    observaciones = {
        f["observacion_id"]: leer_observacion_verificada(f, conexion, cache)
        for f in conexion.execute(
            "SELECT * FROM observaciones_vigencia WHERE unidad_clave=?",
            (fila["unidad_clave"],),
        )
    }
    if not set(ids) <= observaciones.keys():
        raise ErrorRegistroVigencia("Referencia de observación ausente")
    contenido = compacto["registro"]
    contenido["entradas"]["observaciones"] = [observaciones[i] for i in ids]
    return contenido
