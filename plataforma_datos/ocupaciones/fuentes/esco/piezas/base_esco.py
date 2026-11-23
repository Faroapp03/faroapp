"""Construcción SQLite de la biblioteca ESCO, con fichas, búsqueda de texto completo y procedencia."""

import sqlite3
from contextlib import closing
from pathlib import Path
from typing import Any

from plataforma_datos.comun.entrada_salida import json_compacto
from plataforma_datos.comun.nucleo import ValidacionFallida, exigir
from plataforma_datos.ocupaciones.fuentes.esco.piezas.constantes_esco import ESQUEMA, IDIOMA


def _insertar_fichas(base: sqlite3.Connection, tabla: str, filas: list[dict[str, Any]]) -> None:
    """Inserta las fichas de una tabla y su índice de texto completo (nombre, alternativos y descripción)."""
    for fila in filas:
        # La tercera columna distingue cada tabla: el código ESCO de una ocupación o el tipo de una competencia.
        columna = "codigo_esco" if tabla == "ocupaciones" else "tipo"
        tercera = fila[columna]
        alternativos = fila["nombres_alternativos_es"]
        base.execute(
            f"INSERT INTO {tabla} (uri,titulo_es,{columna},descripcion_es,alternativos_json,registro_json) "
            "VALUES (?,?,?,?,?,?)",
            (
                fila["uri"],
                fila["titulo_es"],
                tercera,
                fila["descripcion_es"],
                json_compacto(alternativos),
                json_compacto(fila),
            ),
        )
        base.execute(
            f"INSERT INTO busqueda_{tabla} (uri,titulo_es,alternativos,descripcion_es) VALUES (?,?,?,?)",
            (fila["uri"], fila["titulo_es"], "\n".join(alternativos), fila["descripcion_es"]),
        )


def _procedencia_base(meta: dict[str, Any]) -> dict[str, str]:
    """Procedencia que se guarda dentro de la propia base, para que viaje con ella.

    Returns:
        Fuente, versión, huella, idioma y alcance de la captura, como textos.
    """
    return {
        "fuente": meta["fuente"],
        "version_solicitada": meta["version_solicitada"],
        "sha256_original": meta["sha256"],
        "idioma_preparado": IDIOMA,
        "alcance": "Recuperación textual, fichas y relaciones ESCO; no es un análisis del impacto de la IA.",
    }


def base_integra(base: sqlite3.Connection) -> bool:
    """Si la base supera la comprobación de integridad de SQLite y no tiene claves foráneas rotas.

    Args:
        base: Conexión a la biblioteca ESCO.

    Returns:
        `True` si `PRAGMA integrity_check` da «ok» y `PRAGMA foreign_key_check` no devuelve filas.
    """
    return (
        base.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        and not base.execute("PRAGMA foreign_key_check").fetchall()
    )


def construir_base(ruta: Path, meta: dict[str, Any], datos: dict[str, list[dict[str, Any]]]) -> None:
    """Crea la base SQLite con fichas, relaciones, índices de texto completo y procedencia.

    Args:
        ruta: Ruta donde se crea la base.
        meta: Metadatos de la captura comprobada.
        datos: Fichas y relaciones preparadas de la captura.

    Raises:
        ValidacionFallida: Si la base creada no supera el control de integridad.
    """
    with closing(sqlite3.connect(ruta)) as base:
        base.executescript(ESQUEMA)
        for tabla in ("ocupaciones", "competencias"):
            _insertar_fichas(base, tabla, datos[tabla])
        base.executemany(
            "INSERT INTO relaciones (ocupacion_uri,competencia_uri,tipo,registro_json) VALUES (?,?,?,?)",
            (
                (relacion["ocupacion_uri"], relacion["competencia_uri"], relacion["tipo"], json_compacto(relacion))
                for relacion in datos["relaciones"]
            ),
        )
        base.executemany("INSERT INTO procedencia (clave,valor) VALUES (?,?)", _procedencia_base(meta).items())
        base.commit()
        integra = base_integra(base)
    exigir(integra, "base SQLite inconsistente", ValidacionFallida)
