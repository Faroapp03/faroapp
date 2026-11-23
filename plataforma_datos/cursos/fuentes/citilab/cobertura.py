"""Vincula las tres colecciones completas de Citilab con sus originales admitidos."""

import hashlib
from datetime import date
from pathlib import Path

from plataforma_datos.comun.entrada_salida import leer_json
from plataforma_datos.comun.nucleo import DATOS_RELATIVOS, MAX_DESCARGA_BYTES, ArchivoDescargable, ErrorFuente
from plataforma_datos.comun.observacion_remota import identidad_recurso
from plataforma_datos.cursos.fuentes.citilab.constantes import CONSULTAS, FUENTE
from plataforma_datos.cursos.fuentes.citilab.paginacion import archivos_de_la_copia

VERSION_CON_ORIGINALES = 2


def _original_coincide(carpeta: Path, archivo: ArchivoDescargable, registro: dict, peticion: object) -> bool:
    # `registro` sale de la procedencia en disco y `peticion`, del recibo: se leen sin suponer campos.
    if not isinstance(peticion, dict) or registro.get("url") != archivo["url"]:
        return False
    if registro.get("url_final") != archivo["url"]:
        return False
    if peticion.get("url_final_sha256") != hashlib.sha256(archivo["url"].encode()).hexdigest():
        return False
    ruta = carpeta / archivo["archivo"]
    if ruta.is_symlink() or not ruta.is_file() or ruta.stat().st_size > MAX_DESCARGA_BYTES:
        return False
    with ruta.open("rb") as entrada:
        datos = entrada.read(MAX_DESCARGA_BYTES + 1)
    return (
        0 < len(datos) <= MAX_DESCARGA_BYTES
        and len(datos) == registro.get("bytes") == peticion.get("bytes") == peticion.get("original_bytes")
        and hashlib.sha256(datos).hexdigest()
        == registro.get("sha256")
        == peticion.get("respuesta_sha256")
        == peticion.get("original_sha256")
    )


def _paginas_declaradas(procedencia: dict) -> dict[str, int]:
    """Las páginas que declaró la fuente para cada recurso; una copia sin totales es de una página por recurso.

    Returns:
        Las páginas por recurso.

    Raises:
        ValueError: Si los totales registrados no tienen la forma que escribe la descarga.
    """
    totales = procedencia.get("totales")
    if totales is None:
        return {}
    if not isinstance(totales, dict) or set(totales) != {recurso for recurso, _, _ in CONSULTAS}:
        raise ValueError("citilab: totales de paginación incompatibles")
    paginas = {}
    for recurso, declarado in totales.items():
        if not isinstance(declarado, dict) or type(declarado.get("paginas")) is not int or declarado["paginas"] < 0:
            raise ValueError("citilab: totales de paginación incompatibles")
        paginas[recurso] = declarado["paginas"]
    return paginas


def comprobada(raiz: Path, evidencia: dict) -> bool:
    """Comprueba los bytes conservados después de admitir el módulo y sus tres etapas.

    La recepción ya fue validada por el padre. La llamada de retorno de Citilab exige totales WordPress coherentes antes
    de observar cada cuerpo; aquí se exige que ese mismo cuerpo sea el original utilizado, sin equivalencias locales.
    No renueva fechas de procedencia ni interpreta fechas de cursos como disponibilidad.

    Returns:
        True solo con una consulta exacta por página declarada de los tres recursos y sus mismos originales en la copia
        admitida.
    """
    if evidencia.get("version") != VERSION_CON_ORIGINALES or evidencia.get("fuente") != FUENTE:
        return False
    peticiones = evidencia["peticiones"]
    por_recurso = {peticion["recurso_sha256"]: peticion for peticion in peticiones}
    carpeta = raiz / DATOS_RELATIVOS / "originales" / "citilab"
    try:
        procedencia = leer_json(carpeta / "procedencia.json")
        procedencia = procedencia if isinstance(procedencia, dict) else {}
        dia = procedencia.get("copia")
        registros = procedencia.get("archivos")
        if (
            not isinstance(dia, str)
            or date.fromisoformat(dia).isoformat() != dia
            or not isinstance(registros, list)
            or not all(
                isinstance(registro, dict) and isinstance(registro.get("archivo"), str) for registro in registros
            )
        ):
            return False
        esperados = archivos_de_la_copia(dia, _paginas_declaradas(procedencia))
        por_nombre = {registro["archivo"]: registro for registro in registros}
        if (
            len(registros) != len(esperados)
            or len(peticiones) != len(esperados)
            or len(por_recurso) != len(esperados)
            or set(por_nombre) != {archivo["archivo"] for archivo in esperados}
        ):
            return False
        return all(
            _original_coincide(
                carpeta, archivo, por_nombre[archivo["archivo"]], por_recurso.get(identidad_recurso(archivo["url"]))
            )
            for archivo in esperados
        )
    except (ErrorFuente, OSError, ValueError):
        return False
