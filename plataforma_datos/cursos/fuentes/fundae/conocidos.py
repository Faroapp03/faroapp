"""Entidades FUNDAE de la única SQLite admitida; las altas las da el censo de Digitalízate (censo_digitalizate.py).

Un almacén recién sembrado no tiene ninguna: el censo completo es el que las incorpora.

El catálogo 1 publica recursos y el 3 especialidades/modalidades/anuncios.
La consulta no incluye otras fuentes ni convierte un anuncio en una edición.
Las ediciones que publica lector.py no salen de aquí: salen de las fichas que descubre el índice (ediciones.py).
"""

import json
import sqlite3
from contextlib import closing

from plataforma_datos.comun.huella_json import sha256_json
from plataforma_datos.cursos import admision_catalogo as admision
from plataforma_datos.cursos import almacen_catalogo as almacen
from plataforma_datos.cursos.contrato_entrega_catalogo import exigir

PUBLICADORES = ("fundae:publicador:catalogo:1", "fundae:publicador:catalogo:3")


def _fila(fila: sqlite3.Row) -> dict:
    columnas = fila.keys()
    salida = {k: fila[k] for k in columnas if k != "huella"}
    salida["datos"] = json.loads(salida["datos"])
    exigir(sha256_json(salida) == fila["huella"], "Entidad FUNDAE con negocio y huella distintos")
    return salida


def leer(entrada: almacen.EntradaCatalogo) -> dict:
    """Lee programas, variantes y anuncios de una instantánea previamente admitida.

    Returns:
        Colecciones distintas, ordenadas por identidad nativa. No contiene una
        nueva declaración de disponibilidad, un catálogo vacío supuesto o reloj.
    """
    solicitud = entrada.admision
    admision.exigir_snapshot_admitido(solicitud, sha256_validacion=entrada.sha256_admision)
    uri = solicitud.snapshot.ruta.resolve().as_uri() + "?mode=ro&immutable=1"
    with closing(sqlite3.connect(uri, uri=True)) as conexion:
        conexion.row_factory = sqlite3.Row
        programas = [
            _fila(f)
            for f in conexion.execute("SELECT * FROM programas WHERE proveedor_id IN (?,?) ORDER BY id", PUBLICADORES)
        ]
        variantes = [
            _fila(f)
            for f in conexion.execute(
                "SELECT v.* FROM variantes v JOIN programas p ON p.id=v.programa_id "
                "WHERE p.proveedor_id=? ORDER BY v.id",
                (PUBLICADORES[1],),
            )
        ]
        anuncios = [
            _fila(f)
            for f in conexion.execute(
                "SELECT a.* FROM anuncios a JOIN variantes v ON v.id=a.variante_id "
                "JOIN programas p ON p.id=v.programa_id WHERE p.proveedor_id=? ORDER BY a.id",
                (PUBLICADORES[1],),
            )
        ]
    return {
        "schema_version": 1,
        "fuente_id": "fundae",
        "programas": programas,
        "variantes": variantes,
        "anuncios": anuncios,
    }
