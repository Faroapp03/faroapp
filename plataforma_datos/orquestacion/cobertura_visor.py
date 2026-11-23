"""Vincula las consultas del visor con sus originales admitidos, sin rejuvenecer el Censo 2021 local."""

import hashlib
from datetime import date
from pathlib import Path

import plataforma_datos.mercado.fuentes.cataluna.lector as cataluna
import plataforma_datos.mercado.fuentes.observatori.lector as observatori
from plataforma_datos.comun.nucleo import MAX_DESCARGA_BYTES, FormatoInesperado
from plataforma_datos.comun.observacion_remota import VERSION_VINCULADA, identidad_recurso
from plataforma_datos.mercado.fuentes.cataluna.piezas.captura_cataluna import CENSOS_FIJOS
from plataforma_datos.mercado.fuentes.cataluna.piezas.constantes_cataluna import PATRON_OBSERVATORI
from plataforma_datos.orquestacion.cobertura_originales import (
    carpeta_originales,
    leer_archivo,
    leer_procedencia,
    original_vinculado,
    por_nombre,
)

MAX_PROCEDENCIA_BYTES = 256 * 1024


def _exigir(condicion: bool) -> None:
    if not condicion:
        raise ValueError("Cobertura del visor no verificable.")


def _periodo(registros: dict[str, dict]) -> str:
    periodos = [coincidencia.group(1) for nombre in registros if (coincidencia := PATRON_OBSERVATORI.fullmatch(nombre))]
    _exigir(len(periodos) == 1)
    periodo = periodos[0]
    date.fromisoformat(f"{periodo}-01")
    return periodo


def _referencias_locales(carpeta: Path, registros: dict[str, dict]) -> None:
    for nombre in CENSOS_FIJOS:
        registro = registros[nombre]
        contenido = leer_archivo(carpeta, nombre, MAX_DESCARGA_BYTES)
        tamano = registro.get("bytes", registro.get("tamano_bytes"))
        _exigir(type(tamano) is int and tamano == len(contenido))
        _exigir(hashlib.sha256(contenido).hexdigest() == registro["sha256"])


def _comprobar(raiz: Path, evidencia: dict) -> None:
    _exigir(type(evidencia) is dict and type(evidencia.get("version")) is int)
    _exigir(evidencia["version"] == VERSION_VINCULADA and evidencia["fuente"] in ("cataluna", "observatori"))
    carpeta_cataluna = carpeta_originales(raiz, "cataluna")
    registros_cataluna = por_nombre(leer_procedencia(carpeta_cataluna, MAX_PROCEDENCIA_BYTES)["archivos"])
    periodo = _periodo(registros_cataluna)
    esperados_cataluna = cataluna.archivos(periodo)
    _exigir(set(registros_cataluna) == {a["archivo"] for a in esperados_cataluna} | set(CENSOS_FIJOS))
    _referencias_locales(carpeta_cataluna, registros_cataluna)
    if evidencia["fuente"] == "cataluna":
        carpeta, registros, esperados = carpeta_cataluna, registros_cataluna, esperados_cataluna
    else:
        carpeta = carpeta_originales(raiz, "observatori")
        registros = por_nombre(leer_procedencia(carpeta, MAX_PROCEDENCIA_BYTES)["archivos"])
        esperados = observatori.archivos(periodo)
        _exigir(set(registros) == {a["archivo"] for a in esperados})
    peticiones = evidencia["peticiones"]
    _exigir(type(peticiones) is list and all(type(p) is dict for p in peticiones))
    por_recurso = {p["recurso_sha256"]: p for p in peticiones}
    _exigir(len(por_recurso) == len(peticiones) == len(esperados))
    _exigir(set(por_recurso) == {identidad_recurso(a["url"]) for a in esperados})
    for esperado in esperados:
        original_vinculado(
            carpeta, esperado, registros[esperado["archivo"]], por_recurso[identidad_recurso(esperado["url"])]
        )


def comprobada(raiz: Path, evidencia: dict) -> bool:
    """Confirma todos los recursos del visor solo después de preparar, validar y admitir el módulo.

    Cataluña conserva cuatro originales históricos del censo: se comprueba su integridad local, sin
    atribuirles una consulta remota. Observatori debe corresponder al corte admitido de Cataluña.
    La recepción v2 llega validada por el padre para este intento; no acredita activación del paquete.

    Returns:
        True si cada consulta prevista está vinculada íntegramente al original utilizado.
    """
    try:
        _comprobar(raiz, evidencia)
    except (OSError, ValueError, TypeError, KeyError, RecursionError, FormatoInesperado):
        return False
    return True
