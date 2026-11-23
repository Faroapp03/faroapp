"""Vincula la consulta del corpus declarado de acreditación con sus originales conservados.

El llamador exige recepción fresca, las tres etapas correctas y módulo admitido. Esta cobertura solo confirma
los recursos de la descarga: índice histórico, decretos seleccionados, PDF necesarios, normas complementarias
y correspondencia INE. La copia SOC sigue siendo local; las páginas manuales, la revisión editorial y la búsqueda
de normas sucesoras conservan su revisión obligatoria. No se acredita vigencia normativa general ni activación.
"""

import hashlib
import json
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from plataforma_datos.comun import boe
from plataforma_datos.comun.nucleo import MAX_DESCARGA_BYTES, ErrorFuente
from plataforma_datos.comun.observacion_remota import VERSION_VINCULADA, identidad_recurso, validar_recepcion
from plataforma_datos.cursos.fuentes.acreditacion.piezas.constantes import BOE, Pagina
from plataforma_datos.cursos.fuentes.acreditacion.piezas.descarga import (
    certificados_del_soc,
    complementarias,
    leer_consolidado,
    numero_del_archivo,
    pagina_del_indice,
    paginas_consolidadas,
    paginas_pdf,
)
from plataforma_datos.orquestacion.cobertura_originales import (
    carpeta_originales,
    leer_archivo,
    leer_procedencia,
    original_vinculado,
    por_nombre,
)

MAX_PROCEDENCIA_BYTES = 256 * 1024
ARCHIVO_SOC = "soc-especialidades.json"


def _exigir(condicion: bool) -> None:
    if not condicion:
        raise ValueError("Recursos de acreditación no verificables.")


def _pares(pares: list[tuple[str, Any]]) -> dict[str, Any]:
    resultado = {}
    for clave, valor in pares:
        _exigir(clave not in resultado)
        resultado[clave] = valor
    return resultado


def _constante(_valor: str) -> None:
    raise ValueError("Número JSON no finito.")


def _certificados_locales(raiz: Path) -> dict[str, dict[str, Any]]:
    carpeta = carpeta_originales(raiz, "formacion")
    registros = por_nombre(leer_procedencia(carpeta, MAX_PROCEDENCIA_BYTES)["archivos"])
    registro = registros[ARCHIVO_SOC]
    contenido = leer_archivo(carpeta, ARCHIVO_SOC, MAX_DESCARGA_BYTES)
    tamano = registro.get("bytes", registro.get("tamano_bytes"))
    _exigir(type(tamano) is int and tamano == len(contenido))
    _exigir(hashlib.sha256(contenido).hexdigest() == registro["sha256"])
    filas = json.loads(contenido.decode("utf-8"), object_pairs_hook=_pares, parse_constant=_constante)
    _exigir(type(filas) is list and bool(filas) and all(type(fila) is dict for fila in filas))
    certificados = certificados_del_soc(filas)
    _exigir(bool(certificados))
    return certificados


def _finales(url: str) -> set[str]:
    # Los decretos antiguos conservados redirigen act.php a doc.php, con el mismo identificador BOE.
    finales = {url}
    if url.startswith(f"{BOE}/buscar/act.php?id="):
        finales.add(url.replace("/buscar/act.php?id=", "/buscar/doc.php?id=", 1))
    return finales


def _robots(procedencia: dict, peticiones: dict[str, dict], hosts: set[str]) -> set[str]:
    registros = procedencia["robots"]
    _exigir(type(registros) is dict and set(registros) == hosts)
    recursos = set()
    for host in hosts:
        url = f"https://{host}/robots.txt"
        recurso = identidad_recurso(url)
        registro, peticion = registros[host], peticiones[recurso]
        _exigir(type(registro) is dict and registro["url"] == url)
        _exigir(peticion["url_final_sha256"] == hashlib.sha256(url.encode()).hexdigest())
        _exigir(peticion["respuesta_sha256"] == registro["sha256"])
        # robots.txt se observa en HTTP y solo se conserva su huella, nunca un original ficticio.
        _exigir(peticion["original_sha256"] is None and peticion["original_bytes"] is None)
        recursos.add(recurso)
    return recursos


def _comprobar(raiz: Path, evidencia: dict) -> None:
    _exigir(type(evidencia) is dict and type(evidencia.get("version")) is int)
    _exigir(evidencia["version"] == VERSION_VINCULADA)
    evidencia = validar_recepcion(evidencia, "acreditacion", evidencia["intento"])
    carpeta = carpeta_originales(raiz, "acreditacion")
    procedencia = leer_procedencia(carpeta, MAX_PROCEDENCIA_BYTES)
    registros = por_nombre(procedencia["archivos"])
    peticiones = {p["recurso_sha256"]: p for p in evidencia["peticiones"]}
    _exigir(len(peticiones) == len(evidencia["peticiones"]))
    consultadas: dict[str, str] = {}

    def leer(pagina: Pagina) -> bytes:
        _exigir(pagina.archivo not in consultadas and pagina.url not in consultadas.values())
        consultadas[pagina.archivo] = pagina.url
        return original_vinculado(
            carpeta,
            {"archivo": pagina.archivo, "url": pagina.url},
            registros[pagina.archivo],
            peticiones[identidad_recurso(pagina.url)],
            urls_finales=_finales(pagina.url),
        )

    certificados = _certificados_locales(raiz)
    indice = boe.referencias_anteriores(leer(pagina_del_indice()))
    codigos = {
        numero_del_archivo(pagina.archivo): leer_consolidado(leer(pagina))
        for pagina in paginas_consolidadas(indice, certificados)
    }
    for pagina in [*paginas_pdf(codigos, certificados), *complementarias()]:
        leer(pagina)
    _exigir(set(registros) == set(consultadas))
    hosts = {urlsplit(url).netloc for url in consultadas.values()}
    robots = _robots(procedencia, peticiones, hosts)
    _exigir(set(peticiones) == {identidad_recurso(url) for url in consultadas.values()} | robots)


def comprobada(raiz: Path, evidencia: dict) -> bool:
    """Confirma todos los recursos remotos declarados, sin promover SOC ni revisiones manuales a consulta remota.

    Returns:
        True solo si el inventario derivado y sus bytes coinciden exactamente con el recibo v2 y la procedencia.
    """
    try:
        _comprobar(raiz, evidencia)
    except (OSError, ValueError, TypeError, KeyError, RecursionError, ErrorFuente):
        return False
    return True
