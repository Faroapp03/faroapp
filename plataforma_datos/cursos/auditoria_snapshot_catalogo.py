"""Auditoría de preparación para un catálogo congelado, sin decidir disponibilidad."""

import json
import sqlite3
from contextlib import closing
from pathlib import Path

from plataforma_datos.cursos import catalogo, registro_vigencia
from plataforma_datos.cursos.tipos_json import ObjetoJson

TABLAS_ENTIDADES = ("proveedores", "programas", "ediciones", "variantes", "centros", "anuncios")
TABLAS_COBERTURA = (
    *TABLAS_ENTIDADES,
    "evidencias",
    "ejecuciones",
    "evaluaciones_vigencia",
    "cambios_decision_vigencia",
)
MAX_FILAS = 1_000_000
MAX_CELDA = 16 * 1024 * 1024
CABECERA_SQLITE = b"SQLite format 3\x00"
VERSION_CONGELADA = b"\x01\x01"


class ErrorAdmisionCatalogo(ValueError):
    """Instantánea, procedencia o informe incompatibles; no se sustituye una admisión previa."""


def exigir(condicion: object, mensaje: str) -> None:
    """Rechaza una condición incumplida sin sustituir entradas.

    Raises:
        ErrorAdmisionCatalogo: Si la condición no se cumple.
    """
    if not condicion:
        raise ErrorAdmisionCatalogo(mensaje)


def comprobar_cierre(base: Path) -> None:
    """Exige una instantánea cerrada, sin WAL ni diario pendiente.

    La producción debe cerrar/checkpointar su copia antes de congelarla. Esta
    función no recupera, migra o cambia el modo de una base ajena.
    """
    with base.open("rb") as archivo:
        cabecera = archivo.read(len(CABECERA_SQLITE) + len(VERSION_CONGELADA) + 2)
    exigir(cabecera.startswith(CABECERA_SQLITE), "La instantánea no tiene cabecera SQLite")
    exigir(cabecera[18:20] == VERSION_CONGELADA, "Snapshot no congelado: modo WAL")
    for sufijo in ("-wal", "-journal", "-shm"):
        lateral = base.with_name(base.name + sufijo)
        exigir(not lateral.is_symlink(), "Lateral SQLite enlazado")
        exigir(not lateral.exists(), "Snapshot con lateral SQLite: " + sufijo)


def _celda(celda: object) -> None:
    if isinstance(celda, str):
        exigir(len(celda.encode("utf-8")) <= MAX_CELDA, "Celda del catálogo excede su límite")


def _entidades(conexion: sqlite3.Connection) -> None:
    for tabla in TABLAS_ENTIDADES:
        for fila in conexion.execute("SELECT * FROM " + tabla):
            for valor in fila:
                _celda(valor)
            exigir(
                catalogo.huella(catalogo.contenido_anterior(fila)) == fila["huella"],
                "Cuerpo nativo alterado: " + tabla,
            )


def _versiones(conexion: sqlite3.Connection) -> None:
    for tabla in ("versiones", "versiones_oferta"):
        for fila in conexion.execute("SELECT antes,despues,huella_antes,huella_despues FROM " + tabla):
            for campo in ("antes", "despues"):
                cuerpo = fila[campo]
                _celda(cuerpo)
                huella = None if cuerpo is None else catalogo.huella(json.loads(cuerpo))
                exigir(huella == fila["huella_" + campo], "Versión histórica alterada: " + tabla)


def _evidencias(conexion: sqlite3.Connection) -> None:
    campos = ("url", "capturado_utc", "sha256", "archivo")
    for fila in conexion.execute("SELECT * FROM evidencias"):
        contenido = {campo: fila[campo] for campo in campos}
        exigir(catalogo.huella(contenido) == fila["clave"], "Referencia documental alterada")


def _indice(conexion: sqlite3.Connection) -> None:
    nativos = "SELECT id,titulo,datos FROM programas"
    indice = "SELECT id,titulo,datos FROM programas_fts"
    for izquierda, derecha in ((nativos, indice), (indice, nativos)):
        exigir(conexion.execute(izquierda + " EXCEPT " + derecha).fetchone() is None, "Índice FTS incoherente")
    exigir(
        conexion.execute("SELECT count(*) FROM programas").fetchone()[0]
        == conexion.execute("SELECT count(*) FROM programas_fts").fetchone()[0],
        "Índice FTS con filas duplicadas",
    )


def auditar(base: Path) -> ObjetoJson:
    """Audita integridad, referencias, FTS e historia V10 sin recalcular vigencia.

    Returns:
        Recuentos descriptivos; no acreditan oferta, licencia ni publicación.
    """
    comprobar_cierre(base)
    with closing(sqlite3.connect(base.resolve().as_uri() + "?mode=ro&immutable=1", uri=True)) as conexion:
        conexion.row_factory = sqlite3.Row
        exigir(
            conexion.execute("PRAGMA user_version").fetchone()[0] == catalogo.VERSION_SQLITE_CONTENIDOS,
            "La admisión cotidiana exige V10; migre explícitamente la copia histórica",
        )
        exigir([tuple(f) for f in conexion.execute("PRAGMA integrity_check")] == [("ok",)], "SQLite no íntegra")
        cobertura = {t: conexion.execute("SELECT count(*) FROM " + t).fetchone()[0] for t in TABLAS_COBERTURA}
        exigir(all(n <= MAX_FILAS for n in cobertura.values()), "Catálogo excede el límite de filas")
        _entidades(conexion)
        _versiones(conexion)
        _evidencias(conexion)
        _indice(conexion)
    registro_vigencia.auditar_unidades_vigencia(base)
    comprobar_cierre(base)
    return cobertura
