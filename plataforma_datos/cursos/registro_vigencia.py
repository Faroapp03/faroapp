"""Evaluaciones por unidad nativa: decisiones reproducibles, nunca publicación pública.

Cada unidad es una edición (contrato 1 del registro) o un recurso nativo sin edición fabricada (contrato 2), en el
catálogo V10. El único cálculo es evaluar_vigencia; la consulta no recalcula ni rejuvenece pruebas.
La decisión actual del registro se deriva del mayor corte de cada unidad.
"""

import hashlib
import json
import sqlite3
from copy import deepcopy
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from plataforma_datos.comun import huella_json
from plataforma_datos.cursos import almacen_vigencia as almacen
from plataforma_datos.cursos import catalogo, contrato_fichas, normalizar_destinatarios, oferta_continua, vigencia
from plataforma_datos.cursos import unidades_vigencia as unidades
from plataforma_datos.cursos.almacen_vigencia import ErrorRegistroVigencia
from plataforma_datos.cursos.almacen_vigencia import corte as _corte
from plataforma_datos.cursos.almacen_vigencia import huella as _huella
from plataforma_datos.cursos.almacen_vigencia import json_canonico as _json
from plataforma_datos.cursos.fuentes.barcelonactiva import cabeceras_actuales, matricula_actual
from plataforma_datos.cursos.tipos_json import ObjetoJson, ValorJson
from plataforma_datos.cursos.unidades_vigencia import TipoUnidad, UnidadEvaluable

VERSION_REGISTRO = 1
VERSION_REGISTRO_RECURSO = 2
# Versión del evaluador y de su contrato: 2 = el TTL solo fija la próxima revisión
# interna. El historial conserva la suya y se acredita por huella, sin reevaluarse.
VERSION_EVALUADOR = 2
VERSION_CONTRATO_VIGENCIA = 2
MAX_PAGINA = 100


@dataclass(frozen=True, kw_only=True)
class SolicitudEvaluacion:
    """Entradas explícitas del evaluador, con identidad exacta de una edición existente."""

    edicion_id: str
    oferta: ObjetoJson
    observaciones: list[ObjetoJson]
    politica: ObjetoJson
    ahora: str


@dataclass(frozen=True, kw_only=True)
class SolicitudEvaluacionUnidad:
    """Petición tipada: edición conserva contrato 1; recurso nativo usa contrato 2."""

    unidad: UnidadEvaluable
    oferta: ObjetoJson
    observaciones: list[ObjetoJson]
    politica: ObjetoJson
    ahora: str


def firma_evaluador() -> ObjetoJson:
    """Identifica artefactos de una revisión congelada, no un runtime modificado en caliente.

    Returns:
        Versión del contrato y SHA256 de vigencia, fichas/calendarios,
        normalización con su huella JSON y métodos de disponibilidad; sin rutas absolutas ni fechas inventadas.
    """
    archivos = {
        modulo.__name__.replace(".", "/") + ".py": hashlib.sha256(Path(modulo.__file__).read_bytes()).hexdigest()
        for modulo in (
            vigencia,
            contrato_fichas,
            normalizar_destinatarios,
            huella_json,
            oferta_continua,
            vigencia.retirada_proveedor,
            matricula_actual,
            cabeceras_actuales,
        )
    }
    artefacto = {"version_contrato_vigencia": VERSION_CONTRATO_VIGENCIA, "archivos": archivos}
    return {"version": VERSION_EVALUADOR, "sha256": _huella(artefacto), **artefacto}


def exigir_esquema_de_vigencia(conexion: sqlite3.Connection, *, verificar_revision: bool = True) -> None:
    """Exige un catálogo V10 con las tablas de vigencia y su integridad física.

    Raises:
        ErrorRegistroVigencia: Si el catálogo no es V10 o faltan tablas o integridad.
    """
    if conexion.execute("PRAGMA user_version").fetchone()[0] != catalogo.VERSION_SQLITE_CONTENIDOS:
        raise ErrorRegistroVigencia("El registro de vigencia exige un catálogo V10")
    for tabla in (
        "evaluaciones_vigencia",
        "cambios_decision_vigencia",
        "observaciones_vigencia",
        "revisiones_observaciones_vigencia",
    ):
        fila = conexion.execute("SELECT type FROM sqlite_master WHERE name=?", (tabla,)).fetchone()
        if fila is None or fila[0] != "table":
            raise ErrorRegistroVigencia("Catálogo sin tablas verificables de vigencia")
    columnas = {f["name"] for f in conexion.execute("PRAGMA table_info(evaluaciones_vigencia)")}
    if not {"revision_observaciones_id", "huella_fisica"} <= columnas:
        raise ErrorRegistroVigencia("Catálogo sin formato físico verificable")
    unidades.verificar(conexion)
    try:
        almacen.compartidos.verificar_esquema(conexion)
    except almacen.compartidos.ErrorContenido as error:
        raise ErrorRegistroVigencia(str(error)) from error
    _exigir_revision_local(conexion, completo=verificar_revision)


def _exigir_revision_local(conexion: sqlite3.Connection, *, completo: bool) -> None:
    from plataforma_datos.cursos.enriquecimiento_legado import verificar_esquema, verificar_estructura

    try:
        if completo:
            verificar_esquema(conexion)
        else:
            verificar_estructura(conexion)
    except catalogo.ErrorCatalogo as error:
        raise ErrorRegistroVigencia(str(error)) from error


def _preparar(solicitud: SolicitudEvaluacion) -> ObjetoJson:
    if (
        not isinstance(solicitud.edicion_id, str)
        or not solicitud.edicion_id.strip()
        or not isinstance(solicitud.oferta, dict)
        or solicitud.oferta.get("id") != solicitud.edicion_id
    ):
        raise ErrorRegistroVigencia("oferta.id debe ser exactamente la edición registrada; no se deducen equivalencias")
    return {"schema_version": VERSION_REGISTRO, "edicion_id": solicitud.edicion_id, **_calcular(solicitud)}


def _calcular(solicitud: SolicitudEvaluacion | SolicitudEvaluacionUnidad) -> ObjetoJson:
    entradas = deepcopy(
        {"oferta": solicitud.oferta, "observaciones": solicitud.observaciones, "politica": solicitud.politica}
    )
    firma = firma_evaluador()
    resultado = vigencia.evaluar_vigencia(**entradas, ahora=solicitud.ahora)
    if firma_evaluador()["sha256"] != firma["sha256"]:
        raise ErrorRegistroVigencia("El evaluador cambió durante el cálculo")
    return {
        "entradas": entradas,
        "evaluador": firma,
        "corte_utc": resultado["evaluado_el"],
        "resultado": resultado,
        "huella_entradas": _huella(entradas),
        "huella_resultado": _huella(resultado),
    }


def _ultima(conexion: sqlite3.Connection, edicion_id: str) -> sqlite3.Row | None:
    return conexion.execute(
        "SELECT * FROM evaluaciones_vigencia WHERE edicion_id=? ORDER BY corte_us DESC LIMIT 1", (edicion_id,)
    ).fetchone()


def contenido_verificado_de_evaluacion(conexion: sqlite3.Connection, fila: sqlite3.Row) -> ObjetoJson:
    """Reconstruye una evaluación guardada y verifica su unidad y sus huellas.

    Returns:
        El contenido verificado de la evaluación.
    """
    unidades.verificar_clave(conexion, fila["unidad_clave"])
    contenido = almacen.reconstruir(conexion, fila)
    return _verificar_logico(fila, contenido)


def _verificar_logico(fila: sqlite3.Row, contenido: ObjetoJson) -> ObjetoJson:
    if (
        _huella(contenido) != fila["huella_registro"]
        or _huella(contenido["entradas"]) != fila["huella_entradas"]
        or _huella(contenido["resultado"]) != fila["huella_resultado"]
        or not _identidad_logica(fila, contenido)
        or contenido["huella_entradas"] != fila["huella_entradas"]
        or contenido["huella_resultado"] != fila["huella_resultado"]
        or contenido["evaluador"]["sha256"] != fila["huella_evaluador"]
        or _corte(contenido["corte_utc"]) != fila["corte_us"]
    ):
        raise ErrorRegistroVigencia("Historia de vigencia alterada o incoherente")
    return contenido


def _identidad_logica(fila: sqlite3.Row, contenido: ObjetoJson) -> bool:
    comunes = {
        "schema_version",
        "entradas",
        "evaluador",
        "corte_utc",
        "resultado",
        "huella_entradas",
        "huella_resultado",
    }
    version = contenido.get("schema_version")
    propios = {"edicion_id", "huella_edicion"} if version == VERSION_REGISTRO else {"unidad"}
    if type(version) is not int or set(contenido) != comunes | propios:
        return False
    if version == VERSION_REGISTRO:
        coincide = (
            contenido["edicion_id"] == fila["edicion_id"] and contenido["huella_edicion"] == fila["huella_edicion"]
        )
        return coincide and fila["unidad_clave"] == unidades.clave("edicion", contenido["edicion_id"])
    if contenido.get("schema_version") != VERSION_REGISTRO_RECURSO:
        return False
    unidad = contenido.get("unidad")
    return (
        isinstance(unidad, dict)
        and set(unidad) == {"tipo", "id", "huella"}
        and unidad["tipo"] == "recurso"
        and fila["edicion_id"] is None
        and fila["huella_edicion"] is None
        and fila["unidad_clave"] == unidades.clave("recurso", unidad["id"])
        and fila["huella_unidad"] == unidad["huella"]
    )


def _unidad_logica(contenido: ObjetoJson) -> ObjetoJson:
    if contenido["schema_version"] == 1:
        return {"tipo": "edicion", "id": contenido["edicion_id"], "huella": contenido["huella_edicion"]}
    return contenido["unidad"]


def _ultima_ambito(conexion: sqlite3.Connection, identidad: str) -> sqlite3.Row | None:
    return conexion.execute(
        "SELECT * FROM evaluaciones_vigencia WHERE unidad_clave=? ORDER BY corte_us DESC LIMIT 1",
        (identidad,),
    ).fetchone()


def _decision(contenido: ObjetoJson) -> ValorJson:
    resultado = contenido["resultado"]
    return {k: resultado[k] for k in ("estado", "motivos", "alcance")}


def registrar_evaluacion(base: str | Path, solicitud: SolicitudEvaluacion) -> ObjetoJson:
    """Calcula y admite una evaluación de edición, sin publicar ni programar reintentos.

    Un corte repetido exige registro idéntico. Los cortes anteriores se conservan
    como evaluaciones históricas sin sustituir la decisión actual. Solo una
    transición aplicada añade diario de decisión, jamás de ocultación pública.

    El conjunto explícito debe conservar las observaciones ya admitidas para ese
    corte. No se sustituyen ni se unen capturas a escondidas. La evaluación y la
    comprobación de continuidad comparten la transacción de escritura.

    Returns:
        Identidad admitida, idempotencia y si el corte es el actual del registro.

    Raises:
        ErrorRegistroVigencia: Identidad, continuidad, integridad o corte en conflicto.
    """
    vigencia.validar_entrada(solicitud.oferta, solicitud.observaciones, solicitud.politica, ahora=solicitud.ahora)
    with catalogo.transaccion(base, permitir_crear=False) as conexion:
        exigir_esquema_de_vigencia(conexion)
        edicion = conexion.execute("SELECT huella FROM ediciones WHERE id=?", (solicitud.edicion_id,)).fetchone()
        if edicion is None:
            raise ErrorRegistroVigencia("Edición inexistente; no se crea desde una evaluación")
        unidades.asegurar(conexion, "edicion", solicitud.edicion_id)
        _validar_continuidad(conexion, solicitud)
        contenido = _preparar(solicitud)
        contenido["huella_edicion"] = edicion["huella"]
        return _registrar(conexion, contenido)


def _validar_continuidad(conexion: sqlite3.Connection, solicitud: SolicitudEvaluacion) -> None:
    identidad = unidades.clave("edicion", solicitud.edicion_id)
    almacen.comprobar_continuidad(conexion, identidad, solicitud.observaciones, solicitud.ahora)


def _registrar(conexion: sqlite3.Connection, contenido: ObjetoJson) -> ObjetoJson:
    unidad, corte = _unidad_logica(contenido), _corte(contenido["corte_utc"])
    identidad = unidades.clave(unidad["tipo"], unidad["id"])
    previa = _ultima_ambito(conexion, identidad)
    if previa is not None:
        contenido_verificado_de_evaluacion(conexion, previa)
    repetida = conexion.execute(
        "SELECT * FROM evaluaciones_vigencia WHERE unidad_clave=? AND corte_us=?",
        (identidad, corte),
    ).fetchone()
    if repetida is not None:
        contenido_verificado_de_evaluacion(conexion, repetida)
        if repetida["huella_registro"] != _huella(contenido):
            raise ErrorRegistroVigencia("Evaluación del mismo corte en conflicto; se conserva toda la historia")
        return {"evaluacion_id": repetida["id"], "repetida": True, "actual": previa["id"] == repetida["id"]}
    return _guardar_evaluacion(conexion, contenido, previa, identidad)


def _guardar_evaluacion(
    conexion: sqlite3.Connection, contenido: ObjetoJson, previa: sqlite3.Row | None, identidad: str
) -> ObjetoJson:
    unidad = _unidad_logica(contenido)
    registrado_utc = datetime.now(UTC).isoformat()
    observaciones = contenido["entradas"]["observaciones"]
    almacen.guardar_observaciones(conexion, identidad, observaciones, registrado_utc)
    revision = almacen.guardar_revision(
        conexion,
        identidad,
        [o["id"] for o in observaciones],
        None if previa is None else previa["revision_observaciones_id"],
    )
    fila = {
        **almacen.proyeccion_sql_de_identidad(conexion, identidad),
        "corte_us": _corte(contenido["corte_utc"]),
        "registrado_utc": registrado_utc,
        "huella_edicion": unidad["huella"] if unidad["tipo"] == "edicion" else None,
        "huella_entradas": contenido["huella_entradas"],
        "huella_evaluador": contenido["evaluador"]["sha256"],
        "huella_resultado": contenido["huella_resultado"],
        "huella_registro": _huella(contenido),
        "contenido": _json(almacen.conservar_compacto(conexion, contenido, revision)),
        "revision_observaciones_id": revision,
    }
    fila["huella_unidad"] = unidad["huella"]
    identificador = almacen.insertar_fila_vigencia(conexion, "evaluaciones_vigencia", fila).lastrowid
    almacen.sellar_evaluacion(conexion, identificador)
    actual = previa is None or fila["corte_us"] > previa["corte_us"]
    if actual and (
        previa is None or _decision(contenido) != _decision(contenido_verificado_de_evaluacion(conexion, previa))
    ):
        almacen.insertar_fila_vigencia(
            conexion,
            "cambios_decision_vigencia",
            {
                **almacen.proyeccion_sql_de_identidad(conexion, identidad),
                "anterior_id": None if previa is None else previa["id"],
                "evaluacion_id": identificador,
            },
        )
    return {"evaluacion_id": identificador, "repetida": False, "actual": actual}


def _vacio(edicion_id: str) -> ObjetoJson:
    return {
        "edicion_id": edicion_id,
        "estado_registro": "no_disponible",
        "motivo": "catalogo_ausente",
        "evaluacion": None,
        "evaluacion_id": None,
        "huella_registro": None,
        "visibilidad_publica": "sin_confirmacion",
        "publicacion_confirmada": None,
        "proximo_reintento": None,
    }


def _motivo_actual(contenido: ObjetoJson, huella_edicion: str, huella_evaluador: str) -> str:
    if _unidad_logica(contenido)["huella"] != huella_edicion:
        return "edicion_modificada_requiere_evaluacion"
    if contenido["evaluador"]["sha256"] != huella_evaluador:
        return "evaluador_modificado_requiere_evaluacion"
    return "corte_conservado"


def _consultar(conexion: sqlite3.Connection, edicion_id: str, huella_evaluador: str) -> ObjetoJson:
    vacio = _vacio(edicion_id)
    exigir_esquema_de_vigencia(conexion)
    edicion = unidades.identificar(conexion, "edicion", edicion_id)
    if edicion is None:
        return {**vacio, "motivo": "edicion_no_identificada"}
    return _estado_evaluacion(conexion, edicion_id, edicion["huella"], _ultima(conexion, edicion_id), huella_evaluador)


def _estado_evaluacion(
    conexion: sqlite3.Connection,
    edicion_id: str,
    huella_edicion: str,
    ultima: sqlite3.Row | None,
    huella_evaluador: str,
) -> ObjetoJson:
    return _estado_actual(conexion, ultima, huella_evaluador, _vacio(edicion_id), huella_edicion)


def _estado_actual(
    conexion: sqlite3.Connection, ultima: sqlite3.Row | None, huella_evaluador: str, vacio: ObjetoJson, huella: str
) -> ObjetoJson:
    if ultima is None:
        return {**vacio, "estado_registro": "no_evaluado", "motivo": "sin_evaluacion"}
    contenido = contenido_verificado_de_evaluacion(conexion, ultima)
    motivo = _motivo_actual(contenido, huella, huella_evaluador)
    if contenido["schema_version"] == VERSION_REGISTRO_RECURSO and motivo == "edicion_modificada_requiere_evaluacion":
        motivo = "recurso_modificado_requiere_evaluacion"
    return {
        **vacio,
        "estado_registro": "evaluado" if motivo == "corte_conservado" else "no_evaluado",
        "motivo": motivo,
        "evaluacion": contenido,
        "evaluacion_id": ultima["id"],
        "huella_registro": ultima["huella_registro"],
        "registrado_utc": ultima["registrado_utc"],
    }


def consultar_edicion(base: str | Path, edicion_id: str) -> ObjetoJson:
    """Lee el último corte sin recalcular, rejuvenecer o afirmar publicación pública.

    La respuesta describe ese corte, no asegura disponibilidad a la hora de leer.
    Edición, evaluación y huellas se leen en una misma instantánea SQLite.

    Returns:
        Estado explícito no_disponible/no_evaluado/evaluado, o evaluación histórica
        pendiente de recalcular si cambió la edición o el evaluador cargado.
    """
    if not Path(base).exists():
        return _vacio(edicion_id)
    conexion = catalogo.abrir_lectura(base)
    try:
        conexion.execute("BEGIN")
        return _consultar(conexion, edicion_id, firma_evaluador()["sha256"])
    finally:
        conexion.close()


def _proyeccion_coherente(fila: sqlite3.Row) -> bool:
    """Repite al leer el CHECK que liga `edicion_id` a `unidad_clave`, que `PRAGMA ignore_check_constraints` salta.

    Returns:
        True si la edición proyectada es la de la unidad, o falta en una unidad de recurso.
    """
    if fila["edicion_id"] is None:
        return json.loads(fila["unidad_clave"])[0] == "recurso"
    return fila["unidad_clave"] == unidades.clave("edicion", fila["edicion_id"])


def comprobar_referencia_de_cambio(fila: sqlite3.Row, evaluaciones: dict[int, sqlite3.Row]) -> None:
    """Exige que un cambio del diario enlace evaluaciones de su misma unidad, en orden y con proyección coherente.

    Raises:
        ErrorRegistroVigencia: Si falta la evaluación, cambia la unidad o la edición proyectada, o retrocede el corte.
    """
    actual = evaluaciones.get(fila["evaluacion_id"])
    anterior = evaluaciones.get(fila["anterior_id"])
    enlazadas = [actual] if anterior is None else [actual, anterior]
    if (
        actual is None
        or not all(_proyeccion_coherente(f) for f in [fila, *enlazadas])
        or actual["unidad_clave"] != fila["unidad_clave"]
        or fila["anterior_id"] is not None
        and (
            anterior is None
            or anterior["unidad_clave"] != fila["unidad_clave"]
            or anterior["corte_us"] >= actual["corte_us"]
        )
    ):
        raise ErrorRegistroVigencia("Diario con referencias de edición o cronología incoherentes")


def _cambio(conexion: sqlite3.Connection, fila: sqlite3.Row) -> ObjetoJson:
    consulta = "SELECT * FROM evaluaciones_vigencia WHERE id=?"
    actual = conexion.execute(consulta, (fila["evaluacion_id"],)).fetchone()
    anterior = None if fila["anterior_id"] is None else conexion.execute(consulta, (fila["anterior_id"],)).fetchone()
    comprobar_referencia_de_cambio(fila, {e["id"]: e for e in (actual, anterior) if e is not None})
    return {
        "id": fila["id"],
        "anterior": None if anterior is None else contenido_verificado_de_evaluacion(conexion, anterior),
        "evaluacion": contenido_verificado_de_evaluacion(conexion, actual),
        "alcance": "decision_no_publicacion",
    }


def historial_decisiones(
    base: str | Path, edicion_id: str, *, limite: int = 50, antes_de: int | None = None
) -> ObjetoJson:
    """Consulta una página de cambios de decisión, no una lista de cursos retirados.

    Returns:
        Cambios con evaluaciones íntegras y cursor, o no_disponible sin inventar
        cero ocultaciones. Los IDs de publicación no existen en este segmento.

    Raises:
        ErrorRegistroVigencia: La paginación o las referencias del diario son inválidas.
    """
    if (
        type(limite) is not int
        or not 1 <= limite <= MAX_PAGINA
        or antes_de is not None
        and (type(antes_de) is not int or antes_de <= 0)
    ):
        raise ErrorRegistroVigencia("Paginación inválida")
    no_disponible = {
        "estado_registro": "no_disponible",
        "motivo": "catalogo_ausente",
        "cambios": None,
        "siguiente": None,
    }
    if not Path(base).exists():
        return no_disponible
    conexion = catalogo.abrir_lectura(base)
    try:
        conexion.execute("BEGIN")
        estado = _consultar(conexion, edicion_id, firma_evaluador()["sha256"])
        if estado["estado_registro"] == "no_disponible":
            return {**no_disponible, "motivo": estado["motivo"]}
        filas = conexion.execute(
            "SELECT * FROM cambios_decision_vigencia WHERE edicion_id=? AND (? IS NULL OR id<?) "
            "ORDER BY id DESC LIMIT ?",
            (edicion_id, antes_de, antes_de, limite + 1),
        ).fetchall()
        return {
            "estado_registro": estado["estado_registro"],
            "cambios": [_cambio(conexion, fila) for fila in filas[:limite]],
            "siguiente": filas[limite - 1]["id"] if len(filas) > limite else None,
        }
    finally:
        conexion.close()


def listar_ediciones(
    base: str | Path, *, limite: int = 50, despues_de: str | None = None, revision_esperada: str | None = None
) -> ObjetoJson:
    """Devuelve cobertura y página por edición; continuar exige la misma revisión.

    Cobertura y revisión usan columnas/huellas, sin leer todas las observaciones.
    Solo los registros devueltos se leen íntegros y verifican su contenido. Si
    cambia la colección o el evaluador entre páginas, se exige reiniciar.

    Returns:
        Cobertura, ediciones, revisión y cursor, o None explícito sin registro.

    Raises:
        ErrorRegistroVigencia: Paginación inválida o revisión que exige reiniciar.
    """
    _validar_pagina(limite, despues_de, revision_esperada)
    vacio = {
        "estado_registro": "no_disponible",
        "motivo": "catalogo_ausente",
        "cobertura": None,
        "ediciones": None,
        "siguiente": None,
        "revision": None,
    }
    if not Path(base).exists():
        return vacio
    conexion = catalogo.abrir_lectura(base)
    try:
        conexion.execute("BEGIN")
        exigir_esquema_de_vigencia(conexion)
        return _listar(conexion, limite, despues_de, revision_esperada)
    finally:
        conexion.close()


def _validar_pagina(limite: int, cursor: str | None, revision: str | None) -> None:
    if (
        type(limite) is not int
        or not 1 <= limite <= MAX_PAGINA
        or cursor is not None
        and (not isinstance(cursor, str) or not cursor.strip() or revision is None)
        or revision is not None
        and (not isinstance(revision, str) or not revision.strip())
    ):
        raise ErrorRegistroVigencia("Paginación inválida: continuar requiere la revisión recibida")


def _metadatos(conexion: sqlite3.Connection) -> list[sqlite3.Row]:
    return conexion.execute(
        "SELECT e.id,e.huella,v.id AS evaluacion_id,v.huella_edicion,v.huella_evaluador,v.huella_registro,v.corte_us "
        "FROM ediciones e LEFT JOIN evaluaciones_vigencia v ON v.id=(SELECT id FROM evaluaciones_vigencia "
        "WHERE edicion_id=e.id ORDER BY corte_us DESC LIMIT 1) ORDER BY e.id"
    ).fetchall()


def _cobertura(
    filas: list[sqlite3.Row], huella: str, *, campo_huella: str = "huella_edicion", total: str = "total_ediciones"
) -> ObjetoJson:
    cobertura = {
        total: len(filas),
        "evaluadas_mismo_contrato": 0,
        "sin_evaluacion": 0,
        "historicas_requieren_evaluacion": 0,
    }
    for fila in filas:
        if fila["evaluacion_id"] is None:
            clave = "sin_evaluacion"
        elif fila[campo_huella] == fila["huella"] and fila["huella_evaluador"] == huella:
            clave = "evaluadas_mismo_contrato"
        else:
            clave = "historicas_requieren_evaluacion"
        cobertura[clave] += 1
    return cobertura


def _listar(conexion: sqlite3.Connection, limite: int, cursor: str | None, revision_esperada: str | None) -> ObjetoJson:
    filas = _metadatos(conexion)
    huella = firma_evaluador()["sha256"]
    revision = _huella({"evaluador": huella, "ediciones": [dict(fila) for fila in filas]})
    if revision_esperada is not None and revision_esperada != revision:
        raise ErrorRegistroVigencia("La colección cambió; reiniciar la paginación con su nueva revisión")
    pagina = [fila for fila in filas if cursor is None or fila["id"] > cursor][: limite + 1]
    unidades.verificar_pagina(conexion, "edicion", [fila["id"] for fila in pagina[:limite]])
    ids = [fila["evaluacion_id"] for fila in pagina[:limite] if fila["evaluacion_id"] is not None]
    contenidos = _evaluaciones_pagina(conexion, ids)
    return {
        "estado_registro": "disponible",
        "revision": revision,
        "cobertura": _cobertura(filas, huella),
        "ediciones": [
            _estado_evaluacion(conexion, f["id"], f["huella"], contenidos.get(f["evaluacion_id"]), huella)
            for f in pagina[:limite]
        ],
        "siguiente": pagina[limite - 1]["id"] if len(pagina) > limite else None,
    }


def _evaluaciones_pagina(conexion: sqlite3.Connection, ids: list[int]) -> dict[int, sqlite3.Row]:
    if not ids:
        return {}
    return {
        fila["id"]: fila
        for fila in conexion.execute(
            "SELECT * FROM evaluaciones_vigencia WHERE id IN (" + ",".join("?" for _ in ids) + ")", ids
        )
    }


def observaciones_hasta(base: str | Path, *, tipo: TipoUnidad, id: str, corte: str) -> list[ObjetoJson]:
    """Lee cuerpos únicos causales de una unidad, incluidas incorporaciones tardías.

    No expande evaluaciones históricas ni busca otras unidades. El orden de ingreso
    solo conserva la continuidad; la autoridad temporal sigue en el evaluador.
    Ausencia de observaciones no acredita disponibilidad ni existencia de la unidad.

    Returns:
        Observaciones selladas cuyo intervalo completo no supera el corte declarado.
    """
    clave, hasta = unidades.clave(tipo, id), almacen.corte(corte)
    conexion = catalogo.abrir_lectura(base)
    try:
        conexion.execute("BEGIN")
        exigir_esquema_de_vigencia(conexion, verificar_revision=False)
        cache = {}
        return [
            almacen.leer_observacion_verificada(fila, conexion, cache)
            for fila in conexion.execute(
                "SELECT * FROM observaciones_vigencia WHERE unidad_clave=? AND hasta_us<=? "
                "ORDER BY registrado_utc,observacion_id",
                (clave, hasta),
            )
        ]
    finally:
        conexion.close()


def registrar_unidad(base: str | Path, solicitud: SolicitudEvaluacionUnidad) -> ObjetoJson:
    """Admite una evaluación del recurso o edición nativos en el único registro.

    La huella esperada se coteja bajo el mismo cerrojo que protege continuidad y
    escritura. No inventa una edición, política, captura o publicación.

    Returns:
        Identidad local de evaluación, repetición y actualidad del corte.

    Raises:
        ErrorRegistroVigencia: Unidad ausente, obsoleta, ajena o con historia incompatible.
    """
    vigencia.validar_entrada(solicitud.oferta, solicitud.observaciones, solicitud.politica, ahora=solicitud.ahora)
    if not isinstance(solicitud.unidad, UnidadEvaluable) or solicitud.oferta["id"] != solicitud.unidad.id:
        raise ErrorRegistroVigencia("oferta.id debe coincidir exactamente con la unidad nativa")
    with catalogo.transaccion(base, permitir_crear=False) as conexion:
        exigir_esquema_de_vigencia(conexion)
        unidad = unidades.identificar(conexion, solicitud.unidad.tipo, solicitud.unidad.id)
        if unidad is None or unidad["huella"] != solicitud.unidad.huella:
            raise ErrorRegistroVigencia("Unidad nativa inexistente o huella obsoleta")
        _contrastar_url_recurso(conexion, solicitud)
        identidad = unidades.asegurar(conexion, solicitud.unidad.tipo, solicitud.unidad.id)
        almacen.comprobar_continuidad(conexion, identidad, solicitud.observaciones, solicitud.ahora)
        contenido = _preparar_unidad(solicitud)
        return _registrar(conexion, contenido)


def _contrastar_url_recurso(conexion: sqlite3.Connection, solicitud: SolicitudEvaluacionUnidad) -> None:
    if solicitud.unidad.tipo == "recurso":
        fila = conexion.execute("SELECT url FROM programas WHERE id=?", (solicitud.unidad.id,)).fetchone()
        if fila["url"] != solicitud.oferta["url"]:
            raise ErrorRegistroVigencia("URL de oferta distinta de la unidad nativa registrada")


def _preparar_unidad(solicitud: SolicitudEvaluacionUnidad) -> ObjetoJson:
    if solicitud.unidad.tipo == "edicion":
        contenido = _preparar(
            SolicitudEvaluacion(
                edicion_id=solicitud.unidad.id,
                oferta=solicitud.oferta,
                observaciones=solicitud.observaciones,
                politica=solicitud.politica,
                ahora=solicitud.ahora,
            )
        )
        return {**contenido, "huella_edicion": solicitud.unidad.huella}
    return {
        "schema_version": VERSION_REGISTRO_RECURSO,
        "unidad": {"tipo": "recurso", "id": solicitud.unidad.id, "huella": solicitud.unidad.huella},
        **_calcular(solicitud),
    }


def _vacio_unidad(tipo: TipoUnidad, id: str, huella: str | None = None) -> ObjetoJson:
    return {
        "unidad": {"tipo": tipo, "id": id, "huella": huella},
        "estado_registro": "no_disponible",
        "motivo": "catalogo_ausente",
        "evaluacion": None,
        "evaluacion_id": None,
        "huella_registro": None,
        "visibilidad_publica": "sin_confirmacion",
        "publicacion_confirmada": None,
        "proximo_reintento": None,
    }


def _consultar_unidad(conexion: sqlite3.Connection, tipo: TipoUnidad, id: str) -> ObjetoJson:
    vacio = _vacio_unidad(tipo, id)
    exigir_esquema_de_vigencia(conexion)
    unidad = unidades.identificar(conexion, tipo, id)
    if unidad is None:
        return {**vacio, "motivo": "unidad_no_identificada"}
    estado = _estado_actual(
        conexion,
        _ultima_ambito(conexion, unidades.clave(tipo, id)),
        firma_evaluador()["sha256"],
        _vacio_unidad(tipo, id, unidad["huella"]),
        unidad["huella"],
    )

    if tipo == "recurso" and unidades.tiene_ediciones(conexion, id):
        return {
            **estado,
            "estado_registro": "no_evaluado",
            "motivo": "programa_con_ediciones_requiere_evaluacion_por_edicion",
        }
    return estado


def consultar_unidad(base: str | Path, *, tipo: TipoUnidad, id: str) -> ObjetoJson:
    """Lee una unidad tipada sin recalcular ni confirmar su publicación.

    Returns:
        Tipo e identidad explícitos, y evaluación contrato 1 de edición o contrato 2 de recurso.
    """
    unidades.clave(tipo, id)
    if not Path(base).exists():
        return _vacio_unidad(tipo, id)
    conexion = catalogo.abrir_lectura(base)
    try:
        conexion.execute("BEGIN")
        return _consultar_unidad(conexion, tipo, id)
    finally:
        conexion.close()


def historial_unidad(
    base: str | Path, *, tipo: TipoUnidad, id: str, limite: int = 50, antes_de: int | None = None
) -> ObjetoJson:
    """Lee decisiones exclusivamente de la unidad tipada, nunca publicaciones.

    Returns:
        Página de transiciones y su cursor local, o indisponibilidad explícita.

    Raises:
        ErrorRegistroVigencia: Parámetros de paginación o relaciones inválidos.
    """
    identidad = unidades.clave(tipo, id)
    if (
        type(limite) is not int
        or not 1 <= limite <= MAX_PAGINA
        or (antes_de is not None and (type(antes_de) is not int or antes_de <= 0))
    ):
        raise ErrorRegistroVigencia("Paginación inválida")
    vacio = {"estado_registro": "no_disponible", "motivo": "catalogo_ausente", "cambios": None, "siguiente": None}
    if not Path(base).exists():
        return vacio
    conexion = catalogo.abrir_lectura(base)
    try:
        conexion.execute("BEGIN")
        estado = _consultar_unidad(conexion, tipo, id)
        if estado["estado_registro"] == "no_disponible":
            return {**vacio, "motivo": estado["motivo"]}
        filas = conexion.execute(
            "SELECT * FROM cambios_decision_vigencia WHERE unidad_clave=? AND (? IS NULL OR id<?) "
            "ORDER BY id DESC LIMIT ?",
            (identidad, antes_de, antes_de, limite + 1),
        ).fetchall()
        return {
            "estado_registro": estado["estado_registro"],
            "cambios": [_cambio(conexion, f) for f in filas[:limite]],
            "siguiente": filas[limite - 1]["id"] if len(filas) > limite else None,
        }
    finally:
        conexion.close()


def _metadatos_unidades(conexion: sqlite3.Connection, tipo: TipoUnidad) -> list[sqlite3.Row]:
    tabla = "ediciones" if tipo == "edicion" else "programas"
    dominio = " WHERE u.id NOT IN (SELECT programa_id FROM ediciones)" if tipo == "recurso" else ""
    return conexion.execute(
        "SELECT u.id,u.huella,v.id AS evaluacion_id,v.huella_unidad,v.huella_evaluador,v.huella_registro,v.corte_us "
        "FROM " + tabla + " u LEFT JOIN evaluaciones_vigencia v ON v.id=(SELECT id FROM evaluaciones_vigencia "
        "WHERE unidad_clave=json_array(?,u.id) ORDER BY corte_us DESC LIMIT 1)" + dominio + " ORDER BY u.id",
        (tipo,),
    ).fetchall()


def listar_unidades(
    base: str | Path,
    *,
    tipo: TipoUnidad,
    limite: int = 50,
    despues_de: str | None = None,
    revision_esperada: str | None = None,
) -> ObjetoJson:
    """Pagina un dominio tipado completo sin mezclar ediciones y recursos.

    Returns:
        Cobertura, revisión y unidades con sus contratos lógicos respectivos.

    Raises:
        ErrorRegistroVigencia: Identidad o paginación inválidas, o colección cambiada.
    """
    unidades.clave(tipo, "validacion-de-tipo")
    _validar_pagina(limite, despues_de, revision_esperada)
    vacio = {
        "estado_registro": "no_disponible",
        "motivo": "catalogo_ausente",
        "tipo": tipo,
        "cobertura": None,
        "unidades": None,
        "siguiente": None,
        "revision": None,
    }
    if not Path(base).exists():
        return vacio
    conexion = catalogo.abrir_lectura(base)
    try:
        conexion.execute("BEGIN")
        exigir_esquema_de_vigencia(conexion)
        return _listar_unidades(conexion, tipo, (limite, despues_de, revision_esperada))
    finally:
        conexion.close()


def _listar_unidades(
    conexion: sqlite3.Connection, tipo: TipoUnidad, pagina: tuple[int, str | None, str | None]
) -> ObjetoJson:
    limite, cursor, esperada = pagina
    filas, firma = _metadatos_unidades(conexion, tipo), firma_evaluador()["sha256"]
    revision = _huella({"tipo": tipo, "evaluador": firma, "unidades": [dict(f) for f in filas]})
    if esperada is not None and esperada != revision:
        raise ErrorRegistroVigencia("La colección cambió; reiniciar la paginación con su nueva revisión")
    seleccion = [f for f in filas if cursor is None or f["id"] > cursor][: limite + 1]
    unidades.verificar_pagina(conexion, tipo, [fila["id"] for fila in seleccion[:limite]])
    estados = []
    ids = [f["evaluacion_id"] for f in seleccion[:limite] if f["evaluacion_id"] is not None]
    evaluaciones = _evaluaciones_pagina(conexion, ids)
    for fila in seleccion[:limite]:
        ultima = evaluaciones.get(fila["evaluacion_id"])
        estados.append(
            _estado_actual(conexion, ultima, firma, _vacio_unidad(tipo, fila["id"], fila["huella"]), fila["huella"])
        )
    return {
        "estado_registro": "disponible",
        "tipo": tipo,
        "revision": revision,
        "cobertura": _cobertura(filas, firma, campo_huella="huella_unidad", total="total_unidades"),
        "unidades": estados,
        "siguiente": seleccion[limite - 1]["id"] if len(seleccion) > limite else None,
    }


def auditar_unidades_vigencia(base: str | Path) -> None:
    """Verifica exhaustivamente la vigencia del catálogo V10 para la admisión, sin recalcular.

    Esta operación explícita recorre relaciones y todos los contenidos históricos;
    las consultas normales verifican esquema y registros efectivamente leídos.

    Raises:
        ErrorRegistroVigencia: Si no es V10 o su historia no es íntegra.
    """
    conexion = catalogo.abrir_lectura(base)
    try:
        conexion.execute("BEGIN")
        unidades.verificar(conexion, completo=True)
        unidades.verificar_historia_de_vigencia(conexion)
    finally:
        conexion.close()
