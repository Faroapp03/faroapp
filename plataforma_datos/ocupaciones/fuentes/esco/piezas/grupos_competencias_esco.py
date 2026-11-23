"""Los grupos de la jerarquía oficial de ESCO a que pertenece cada competencia o conocimiento del paquete.

ESCO ordena sus competencias en una jerarquía: «gestionar nóminas» cuelga del grupo S4.3.2 «gestionar y administrar
recursos humanos»; los conocimientos, de los campos de la CINE-F («0411 contabilidad e impuestos»). Una competencia
puede colgar de otra más amplia («superiores»), y entonces hereda sus grupos. El buscador de ocupaciones usa estos
grupos para reconocer las ocupaciones de un área sin puesto («recursos humanos» → nóminas, selección, formación):
motores/ocupaciones/src/busqueda/area.ts.

Lee la base ESCO validada (`base_validada`, la misma de la que sale datos/esco.json) y escribe
motores/ocupaciones/src/busqueda/grupos-de-competencias.json: los títulos de los grupos y, para cada competencia de
datos/esco.json en su orden, sus grupos separados por «|». El buscador empareja cada competencia con sus grupos por
la posición, así que solo se escribe si el paquete tiene exactamente las competencias de la base, en el orden de la
exportación; si no, hay que exportar antes el paquete. Con «--comprobar» no escribe nada: dice si el archivo actual
sigue correspondiendo a la base y al paquete. Fuente: © Unión Europea, ESCO v1.2.1.

Uso: python3 -m plataforma_datos.ocupaciones.fuentes.esco.piezas.grupos_competencias_esco [--comprobar]
"""

import argparse
import json
import sqlite3
import sys
from pathlib import Path
from typing import Any

from plataforma_datos.comun.entrada_salida import Json, leer_json, relativa, temporal_hermano
from plataforma_datos.comun.nucleo import RAIZ, FormatoInesperado, ValidacionFallida, exigir
from plataforma_datos.ocupaciones.fuentes.esco.piezas.consultas import base_validada

PAQUETE = RAIZ / "datos/esco.json"
SALIDA = RAIZ / "motores/ocupaciones/src/busqueda/grupos-de-competencias.json"
SEPARADOR = "|"
FUENTE = "© Unión Europea, ESCO v1.2.1: jerarquía de competencias y conocimientos (grupos superiores)."


def _registros(conexion: sqlite3.Connection) -> dict[str, dict]:
    """El registro de cada competencia de la biblioteca, por su URI, en el orden de la exportación del paquete.

    Returns:
        URI → registro (JSON de la API de ESCO tal como se descargó), ordenado por URI.
    """
    consulta = "SELECT uri, registro_json FROM competencias ORDER BY uri"
    return {uri: json.loads(registro) for uri, registro in conexion.execute(consulta)}


def _grupos_de(uri: str, registros: dict[str, dict], vistos: frozenset[str] = frozenset()) -> set[str]:
    """Los grupos de una competencia: los suyos y, por herencia, los de las competencias de que cuelga.

    Returns:
        Los códigos de los grupos.
    """
    registro = registros.get(uri)
    if registro is None or uri in vistos:
        return set()
    grupos = {grupo["code"] for grupo in registro.get("grupos_superiores") or [] if grupo.get("code")}
    for superior in registro.get("superiores") or []:
        grupos |= _grupos_de(superior, registros, vistos | {uri})
    return grupos


def _uris_del_paquete(paquete: Json) -> list[str]:
    """Las URI de las competencias del paquete, en su orden.

    Returns:
        La URI de cada competencia.

    Raises:
        ValidacionFallida: Si el paquete no tiene una lista de competencias que empiecen por su URI.
    """
    competencias = paquete.get("competencias") if isinstance(paquete, dict) else None
    exigir(
        isinstance(competencias, list)
        and all(isinstance(fila, list) and fila and isinstance(fila[0], str) for fila in competencias),
        f"{relativa(PAQUETE)} necesita una lista de competencias [uri, título, tipo]",
        ValidacionFallida,
    )
    return [fila[0] for fila in competencias]


def calcular(conexion: sqlite3.Connection, paquete: Json) -> dict[str, Any]:
    """Compone los grupos de cada competencia del paquete, solo si el paquete está alineado con la base.

    Args:
        conexion: La base ESCO validada.
        paquete: El contenido de datos/esco.json.

    Returns:
        La fuente, los títulos de los grupos por código y los grupos de cada competencia en el orden del paquete.

    Raises:
        ValidacionFallida: Si el paquete no tiene las competencias de la base en su orden o un código de grupo lleva
            el separador.
    """
    registros = _registros(conexion)
    uris = _uris_del_paquete(paquete)
    exigir(
        uris == list(registros),
        f"{relativa(PAQUETE)} no tiene las competencias de la base validada en su orden "
        f"({len(uris)} en el paquete, {len(registros)} en la base): exporta antes el paquete ESCO",
        ValidacionFallida,
    )
    titulos = {
        grupo["code"]: grupo["title"]
        for registro in registros.values()
        for grupo in registro.get("grupos_superiores") or []
        if grupo.get("code") and grupo.get("title")
    }
    grupos_por_competencia = [sorted(_grupos_de(uri, registros)) for uri in uris]
    con_separador = sorted({codigo for grupos in grupos_por_competencia for codigo in grupos if SEPARADOR in codigo})
    exigir(
        not con_separador,
        f"esco: los códigos de grupo {con_separador} llevan el separador «{SEPARADOR}»",
        ValidacionFallida,
    )
    return {
        "fuente": FUENTE,
        "grupos": dict(sorted(titulos.items())),
        "competencias": [SEPARADOR.join(grupos) for grupos in grupos_por_competencia],
    }


def _escribir(salida: dict[str, Any]) -> None:
    """Escribe la salida entera o nada: en un temporal de la misma carpeta que después la sustituye."""
    texto = json.dumps(salida, ensure_ascii=False, separators=(",", ":"), allow_nan=False) + "\n"
    temporal = temporal_hermano(SALIDA.parent, prefijo=f".{SALIDA.name}.")
    ruta = Path(temporal.name)
    try:
        with temporal:
            temporal.write(texto.encode("utf-8"))
        ruta.replace(SALIDA)
    finally:
        ruta.unlink(missing_ok=True)


def _vigente(salida: dict[str, Any]) -> bool:
    """Si el archivo escrito tiene el mismo contenido que la salida calculada, sea cual sea su formato.

    Returns:
        `True` si existe y su JSON coincide con la salida; un archivo que no es JSON válido no está vigente.
    """
    try:
        return SALIDA.is_file() and leer_json(SALIDA) == salida
    except FormatoInesperado:
        return False


def principal(argumentos: list[str] | None = None) -> int:
    """Escribe motores/ocupaciones/src/busqueda/grupos-de-competencias.json o, con «--comprobar», su vigencia.

    Returns:
        0 si escribe o si el archivo está vigente; 1 si «--comprobar» lo encuentra ausente o desfasado.
    """
    analizador = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    analizador.add_argument("--comprobar", action="store_true", help="solo comprueba que el archivo está vigente")
    opciones = analizador.parse_args(argumentos)
    paquete = leer_json(PAQUETE)
    with base_validada() as conexion:
        salida = calcular(conexion, paquete)
    if opciones.comprobar:
        vigente = _vigente(salida)
        estado = "vigente" if vigente else "ausente o desfasado: vuelve a ejecutar la herramienta sin --comprobar"
        print(f"{relativa(SALIDA)}: {estado}")
        return 0 if vigente else 1
    _escribir(salida)
    competencias, grupos = salida["competencias"], salida["grupos"]
    con_grupo = sum(1 for suyos in competencias if suyos)
    print(f"{con_grupo} de {len(competencias)} competencias con grupo; {len(grupos)} grupos → {relativa(SALIDA)}")
    return 0


if __name__ == "__main__":
    sys.exit(principal())
