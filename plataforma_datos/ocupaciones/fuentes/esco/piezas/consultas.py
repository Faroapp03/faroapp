"""Consultas locales a ESCO (var/actualizacion/validados/esco/biblioteca-esco.sqlite), sin red y sin IA.

La base la construye y la valida `ocupaciones/fuentes/esco/lector.py`, que la escribe; este módulo es la única vía de
lectura, siempre de solo lectura. La validación de ESCO usa estas mismas consultas para comprobar que la base responde
como se espera, y las demás fuentes y el exportador la leen con `base_validada`, que exige antes que sea la que se
validó. Las ocupaciones JSONL preparadas se leen con `ocupaciones_preparadas`, que exige la misma admisión y comprueba
la huella registrada.

Uso: python3 -m plataforma_datos.ocupaciones.fuentes.esco.piezas.consultas
     {buscar,competencias,ficha,ocupaciones-por-competencia} "consulta"
"""

import argparse
import json
import re
import sqlite3
import sys
from collections.abc import Iterator
from contextlib import AbstractContextManager, contextmanager
from pathlib import Path
from typing import Any

from plataforma_datos.comun.entrada_salida import Json, leer_jsonl, requerir, sha256
from plataforma_datos.comun.nucleo import ErrorFuente, ValidacionFallida, exigir
from plataforma_datos.ocupaciones.fuentes.esco.piezas.constantes_esco import BASE, PESOS_BM25
from plataforma_datos.orquestacion.admision import exigir_admitido
from plataforma_datos.orquestacion.ordenes import con_motivo

# Tablas de fichas de la base: cada una tiene su índice de texto completo `busqueda_<tabla>`.
TABLAS = ("ocupaciones", "competencias")
# Tope de palabras de una consulta: cada una añade una condición a la búsqueda de texto completo.
MAX_PALABRAS_CONSULTA = 20
PATRON_PALABRA = re.compile(r"[^\W_]+")
CONSULTAS = ("buscar", "competencias", "ficha", "ocupaciones-por-competencia")
ALCANCE = (
    "Coincidencias textuales por nombre, denominaciones alternativas y descripción; la persona debe confirmar "
    "pertinencia."
)


class ConsultaNoValida(ErrorFuente):
    """Una consulta que la base no puede responder: un tipo de ficha desconocido o una ficha ausente."""


# ---------------------------------------------------------------------------------------------------------------------
# Conexión
# ---------------------------------------------------------------------------------------------------------------------


@contextmanager
def conexion(ruta: Path | None = None) -> Iterator[sqlite3.Connection]:
    """Abre una conexión de solo lectura a la base ESCO.

    Args:
        ruta: Base que se abre, absoluta o relativa al directorio actual; `None` abre la del área operativa.

    Yields:
        La conexión, con filas accesibles por nombre de columna; se cierra al salir del bloque.
    """
    base = sqlite3.connect(requerir(ruta or BASE).resolve().as_uri() + "?mode=ro", uri=True)
    base.row_factory = sqlite3.Row
    try:
        yield base
    finally:
        base.close()


def base_validada() -> AbstractContextManager[sqlite3.Connection]:
    """Abre la base ESCO de solo lectura, solo si ESCO está admitida y la base es la que se validó.

    La huella se comprueba antes de abrir; quien escribe la base debe impedir su sustitución durante la lectura.

    Returns:
        El gestor de contexto de la conexión.

    Raises:
        ValidacionFallida: Si el informe de ESCO no registra la huella de la base o la base no es la validada.
    """
    validacion = exigir_admitido("esco")
    registrada = validacion.get("sha256_sqlite")
    exigir(registrada is not None, "esco: el informe de validación no registra la huella de la base", ValidacionFallida)
    validada = sha256(requerir(BASE)) == registrada
    exigir(validada, "esco: la base SQLite no es la validada", ValidacionFallida)
    return conexion()


def ocupaciones_preparadas(ruta: Path) -> list[dict[str, Any]]:
    """Lee las ocupaciones ESCO preparadas, solo si ESCO está admitida y son las que validó.

    Args:
        ruta: Archivo JSONL de las ocupaciones preparadas.

    Returns:
        Una ocupación por línea.

    Raises:
        ValidacionFallida: Si el informe de ESCO no registra la huella de ese archivo o el archivo no es el validado.
    """
    validacion = exigir_admitido("esco")
    registrada = (validacion.get("sha256_preparados") or {}).get(ruta.name)
    exigir(
        registrada is not None,
        f"esco: el informe de validación no registra la huella de {ruta.name}",
        ValidacionFallida,
    )
    validada = registrada == sha256(ruta)
    exigir(
        validada,
        "esco: ocupaciones.jsonl no es el validado; ejecutar "
        "python3 -m plataforma_datos.ocupaciones.fuentes.esco.lector validar",
        ValidacionFallida,
    )
    return leer_jsonl(ruta)


# ---------------------------------------------------------------------------------------------------------------------
# Consultas
# ---------------------------------------------------------------------------------------------------------------------


def buscar(consulta: str, tipo: str = "ocupaciones", limite: int = 10) -> list[dict[str, Any]]:
    """Fichas cuyo nombre, denominación alternativa o descripción contienen todas las palabras de la consulta.

    Cada palabra se busca como prefijo entre comillas, así que la consulta nunca se interpreta como sintaxis FTS5.
    Primero va la ficha cuyo nombre coincide exactamente; después, por relevancia (BM25, con más peso para el nombre
    y los nombres alternativos que para la descripción).

    Returns:
        Hasta `limite` fichas, la del nombre exacto primero y después por relevancia; vacía si la consulta no tiene
        palabras.
    """
    exigir(tipo in TABLAS, "tipo de búsqueda inválido", ConsultaNoValida)
    palabras = PATRON_PALABRA.findall(consulta)
    if not palabras:
        return []
    expresion = " AND ".join(f'"{palabra}"*' for palabra in palabras[:MAX_PALABRAS_CONSULTA])
    fts = f"busqueda_{tipo}"
    pesos = ",".join(map(str, PESOS_BM25))
    sql = (
        f"SELECT t.registro_json FROM {fts} JOIN {tipo} t ON t.uri={fts}.uri WHERE {fts} MATCH ? "
        f"ORDER BY CASE WHEN lower(t.titulo_es)=lower(?) THEN 0 ELSE 1 END,bm25({fts},{pesos}),t.titulo_es LIMIT ?"
    )
    with conexion() as base:
        filas = base.execute(sql, (expresion, consulta.strip(), limite)).fetchall()
    return [json.loads(fila[0]) for fila in filas]


def ficha(identificador: str) -> dict[str, Any]:
    """Ficha de una ocupación (por código ESCO o URI) con sus competencias relacionadas.

    Args:
        identificador: Código ESCO o URI de la ocupación.

    Returns:
        La ficha con sus competencias relacionadas.

    Raises:
        ConsultaNoValida: Si no hay ninguna ocupación con ese código o esa URI.
    """
    with conexion() as base:
        encontrada = base.execute(
            "SELECT registro_json FROM ocupaciones WHERE uri=? OR codigo_esco=?", (identificador, identificador)
        ).fetchone()
        motivo = "ocupación no encontrada: usa un código ESCO o una URI devuelta por buscar"
        exigir(encontrada is not None, motivo, ConsultaNoValida)
        resultado = json.loads(encontrada[0])
        relacionadas = base.execute(
            "SELECT c.registro_json,r.registro_json AS relacion FROM relaciones r JOIN competencias c "
            "ON c.uri=r.competencia_uri WHERE r.ocupacion_uri=? ORDER BY r.tipo,c.titulo_es",
            (resultado["uri"],),
        )
        resultado["competencias_relacionadas"] = [
            {"competencia": json.loads(competencia), "relacion": json.loads(relacion)}
            for competencia, relacion in relacionadas
        ]
    return resultado


def ocupaciones_por_competencia(uri: str) -> list[dict[str, Any]]:
    """Ocupaciones relacionadas con una competencia, con el tipo de relación.

    Returns:
        Cada ocupación relacionada con el tipo de relación.
    """
    with conexion() as base:
        filas = base.execute(
            "SELECT o.registro_json,r.registro_json FROM relaciones r JOIN ocupaciones o ON o.uri=r.ocupacion_uri "
            "WHERE r.competencia_uri=? ORDER BY r.tipo,o.titulo_es",
            (uri,),
        ).fetchall()
    return [{"ocupacion": json.loads(ocupacion), "relacion": json.loads(relacion)} for ocupacion, relacion in filas]


def consultar(accion: str, consulta: str) -> Json:
    """Ejecuta una consulta de la línea de órdenes.

    Args:
        accion: Una de CONSULTAS.
        consulta: Texto, código ESCO o URI de la consulta.

    Returns:
        El resultado, listo para mostrarse como JSON.
    """
    if accion == "ficha":
        return ficha(consulta)
    if accion == "ocupaciones-por-competencia":
        return ocupaciones_por_competencia(consulta)
    tipo = "competencias" if accion == "competencias" else "ocupaciones"
    return {"consulta": consulta, "alcance": ALCANCE, "resultados": buscar(consulta, tipo)}


# ---------------------------------------------------------------------------------------------------------------------
# Punto de entrada
# ---------------------------------------------------------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    """Interfaz de línea de órdenes de las consultas locales; devuelve 1 y el motivo si algo falla.

    Returns:
        0 si la consulta se responde; 1 si algo falla, con el motivo en la salida de errores.
    """
    analizador = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    analizador.add_argument("accion", choices=CONSULTAS, help="consulta que se ejecuta")
    analizador.add_argument("consulta", help="texto, código ESCO o URI")
    opciones = analizador.parse_args(argv)

    def mostrar() -> None:
        """El resultado de la consulta, como JSON legible."""
        print(json.dumps(consultar(opciones.accion, opciones.consulta), ensure_ascii=False, indent=2))

    return con_motivo(mostrar)


if __name__ == "__main__":
    sys.exit(main())
