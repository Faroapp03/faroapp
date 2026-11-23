"""Revisión local del legado en el catálogo V10: sus tablas y su verificación.

El catálogo admitido conserva las revisiones de extracción que se aplicaron al montarlo desde el sistema anterior, con
cada antes/después y su justificación. Este módulo define esas tablas (parte del esquema que crea `crear_catalogo`) y
comprueba que siguen íntegras. No aplica revisiones nuevas ni modifica identidad, historia, recepción o admisión.
"""

import json
import re
import sqlite3
from functools import lru_cache

from plataforma_datos.comun.huella_json import sha256_json
from plataforma_datos.cursos import catalogo
from plataforma_datos.cursos.tipos_json import ObjetoJson, ValorJson

METODO = "normalizar-investigacion-legado-1"
MAX_REVISIONES_CACHE = 2
MAX_REVISION_CACHE_BYTES = 2 * 1024 * 1024
ESQUEMA = """
CREATE TABLE revisiones_legado (
 id INTEGER PRIMARY KEY,
 clave TEXT NOT NULL UNIQUE CHECK(length(clave)=64),
 aplicado_utc TEXT NOT NULL,
 contenido TEXT NOT NULL CHECK(json_valid(contenido)),
 huella_contenido TEXT NOT NULL CHECK(length(huella_contenido)=64));
"""
TABLAS = {"programa": "programas", "edicion": "ediciones"}
CAMPOS_MANIFIESTO = {
    "version",
    "metodo",
    "aplicado_utc",
    "bundle_sha256",
    "historia_sha256",
    "evidencia_hasta_id",
    "cambios",
}


def _exigir(condicion: object, mensaje: str) -> None:
    if not condicion:
        raise catalogo.ErrorCatalogo("Revisión local: " + mensaje)


def _objetos_nucleo() -> dict[str, tuple[str, str]]:
    objetos = {}
    for sentencia in catalogo.ESQUEMA.split(";"):
        sentencia = sentencia.strip()
        if not sentencia:
            continue
        cabecera = re.match(r"CREATE (?:UNIQUE )?(?:VIRTUAL )?(TABLE|INDEX) IF NOT EXISTS (\w+)", sentencia)
        _exigir(cabecera is not None, "DDL interno de núcleo no reconocido")
        objetos[cabecera[2]] = (cabecera[1].lower(), sentencia)
    return objetos


def _sql_normalizado(sql: str) -> str:
    return "".join(sql.split()).replace("IFNOTEXISTS", "").rstrip(";")


def _verificar_nucleo(conexion: sqlite3.Connection) -> None:
    """Exige cada objeto del núcleo del catálogo con su DDL exacto."""
    actuales = {
        fila["name"]: (fila["type"], fila["sql"])
        for fila in conexion.execute("SELECT name,type,sql FROM sqlite_master WHERE sql IS NOT NULL")
    }
    esperados = _objetos_nucleo()
    for nombre, (tipo, sql) in esperados.items():
        _exigir(nombre in actuales, "objeto de núcleo ausente: " + nombre)
        _exigir(
            actuales[nombre][0] == tipo and _sql_normalizado(actuales[nombre][1]) == _sql_normalizado(sql),
            "formato de núcleo incompatible: " + nombre,
        )


def verificar_estructura(conexion: sqlite3.Connection) -> None:
    """Comprueba la tabla obligatoria de revisiones del catálogo sin leer revisiones no solicitadas.

    Raises:
        catalogo.ErrorCatalogo: Si falta la tabla o cambia su formato verificable.
    """
    _verificar_nucleo(conexion)
    fila = conexion.execute("SELECT type,sql FROM sqlite_master WHERE name='revisiones_legado'").fetchone()
    _exigir(fila is not None and fila["type"] == "table", "tabla revisiones_legado ausente")
    esperado = " ".join(ESQUEMA.strip().rstrip(";").split())
    _exigir(" ".join(fila["sql"].split()) == esperado, "formato de revisiones_legado incompatible")


def _resumir_revision(contenido: bytes) -> tuple[str, str, str]:
    """Valida solo bytes autosuficientes; no consulta SQL ni comparte objetos mutables.

    Returns:
        Huellas canónicas del documento y manifiesto, y fecha declarada.
    """
    documento = json.loads(contenido)
    huella = sha256_json(documento)
    _exigir(
        isinstance(documento, dict) and set(documento) == {"manifiesto", "canales_ids", "sellos_sha256"},
        "diario inválido",
    )
    manifiesto = documento["manifiesto"]
    _validar_forma(manifiesto)
    return huella, sha256_json(manifiesto), manifiesto["aplicado_utc"]


@lru_cache(maxsize=MAX_REVISIONES_CACHE)
def _resumen_revision_acotado(contenido: bytes) -> tuple[str, str, str]:
    """Memoriza un resultado inmutable por los bytes completos, nunca por ruta o fecha.

    Returns:
        Resultado puro validado; la entrada pública interna limita también sus bytes.
    """
    return _resumir_revision(contenido)


def _huellas_revision(contenido: str) -> tuple[str, str, str]:
    """Limita las claves retenidas a 4 MiB; documentos mayores se verifican sin caché.

    Returns:
        Metadatos puros; SQL, sellos y objetos decodificados se verifican en cada acceso.
    """
    raw = contenido.encode("utf-8")
    if len(raw) <= MAX_REVISION_CACHE_BYTES:
        return _resumen_revision_acotado(raw)
    return _resumir_revision(raw)


def verificar_esquema(conexion: sqlite3.Connection) -> None:
    """Verifica formato e integridad de las revisiones locales presentes en el catálogo.

    Raises:
        catalogo.ErrorCatalogo: Si la tabla o una revisión no son verificables.
    """
    verificar_estructura(conexion)
    for revision in conexion.execute("SELECT * FROM revisiones_legado ORDER BY id"):
        contenido = json.loads(revision["contenido"])
        huella, clave, aplicado = _huellas_revision(revision["contenido"])
        _exigir(huella == revision["huella_contenido"], "diario de revisión alterado")
        _exigir(clave == revision["clave"], "identidad de revisión alterada")
        _exigir(aplicado == revision["aplicado_utc"], "fecha local alterada")
        _exigir(isinstance(contenido["canales_ids"], list), "sellos locales inválidos")
        sellos = _sellos_actuales(conexion, contenido["canales_ids"])
        for canal_id in contenido["canales_ids"]:
            _exigir(type(canal_id) is int, "identidad de sello inválida")
            _exigir(
                isinstance(contenido["sellos_sha256"], dict)
                and str(canal_id) in contenido["sellos_sha256"]
                and contenido["sellos_sha256"][str(canal_id)] == sellos.get(str(canal_id)),
                "sello o prueba local alterados",
            )


def _sellos_actuales(conexion: sqlite3.Connection, ids: list[int]) -> ObjetoJson:
    _exigir(all(type(identidad) is int for identidad in ids), "identidad de sello inválida")
    if not ids:
        return {}
    marcas = ",".join("?" for _ in ids)
    canales = {
        fila["id"]: dict(fila)
        for fila in conexion.execute("SELECT * FROM canales_temporales WHERE id IN (" + marcas + ")", ids)
    }
    enlaces = conexion.execute(
        "SELECT canal_id,evidencia_id FROM pruebas_temporales WHERE canal_id IN ("
        + marcas
        + ") ORDER BY canal_id,evidencia_id",
        ids,
    ).fetchall()
    evidencia_ids = sorted({fila["evidencia_id"] for fila in enlaces})
    marcas_evidencia = ",".join("?" for _ in evidencia_ids)
    evidencias = {
        fila["id"]: {k: fila[k] for k in ("url", "capturado_utc", "sha256", "archivo")}
        for fila in conexion.execute("SELECT * FROM evidencias WHERE id IN (" + marcas_evidencia + ")", evidencia_ids)
    }
    pruebas: dict[int, list[ValorJson]] = {identidad: [] for identidad in ids}
    for enlace in enlaces:
        _exigir(enlace["evidencia_id"] in evidencias, "prueba local ausente")
        pruebas[enlace["canal_id"]].append(evidencias[enlace["evidencia_id"]])
    for canal in canales.values():
        _exigir(canal["ejecucion_id"] is None and canal["instantanea_id"] is None, "sello local atribuido a captura")
    return {
        str(identidad): sha256_json({"canal": canal, "evidencias": pruebas[identidad]})
        for identidad, canal in canales.items()
    }


def _validar_forma(manifiesto: ValorJson) -> None:
    _exigir(isinstance(manifiesto, dict) and set(manifiesto) == CAMPOS_MANIFIESTO, "manifiesto inválido")
    _exigir(type(manifiesto["version"]) is int and manifiesto["version"] == 1, "versión de revisión inválida")
    _exigir(isinstance(manifiesto["metodo"], dict) and manifiesto["metodo"].get("id") == METODO, "método inválido")
    _exigir(isinstance(manifiesto["cambios"], list) and manifiesto["cambios"], "revisión sin inventario")
    catalogo.fecha_utc(manifiesto["aplicado_utc"], "fecha de revisión")
    _exigir(
        type(manifiesto["evidencia_hasta_id"]) is int and manifiesto["evidencia_hasta_id"] >= 0,
        "límite de evidencia inválido",
    )
