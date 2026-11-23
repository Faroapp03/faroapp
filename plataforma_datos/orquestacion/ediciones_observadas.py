"""Ediciones nuevas que una fuente ha observado en su catálogo, para el panel: un hecho con fecha y huella.

Que el INE publique una edición que Faro aún no incorpora no es un fallo de la consulta, así que no pone ningún
módulo en rojo; el panel lo recibe como dato propio de la fila de la fuente. El campo solo viaja cuando hay una
observación, y entonces con una forma cerrada: estado, año, instante UTC de la primera observación y huella del
catálogo. Hoy solo la TIC-H registra observaciones. Si la edición nueva de la TIC-H se descargó y no pasó sus controles,
su estado es «detenida-por-controles», con el motivo de la lista cerrada y, si el enunciado cambió, las partes que
cambian: lo dice el informe de la validación admitida (candidata.py), que se lee con el mismo cuidado.

El año de la edición admitida tiene que ser el del conjunto validado: si no coinciden, la fila no da la edición nueva y
lleva su aviso («edicion-no-coincide»), porque no se sabe qué edición publica la instalación.

Una procedencia de la TIC-H que no se puede verificar no apaga el panel de todas las fuentes: su fila queda sin
`edicionNueva` y con un aviso propio (`avisoEdicion`: «edicion-no-verificable»). El mismo campo dice cuándo la última
consulta descartó una observación anterior mal formada («observacion-anterior-descartada», que sí acompaña a la
observación nueva) y cuándo TIC a les llars se validó sin contraste con el cálculo de Faro porque la TIC-H es de otra
edición. Los dos campos solo viajan cuando tienen valor.
"""

import json
import os
import re
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from plataforma_datos.comun.nucleo import (
    ADMITIDO,
    ARCHIVO_DE_PROCEDENCIA,
    ARCHIVO_DE_VALIDACION,
    DATOS_RELATIVOS,
    ErrorFuente,
    exigir,
)
from plataforma_datos.ia_y_trabajo.fuentes.tich import edicion as edicion_tich
from plataforma_datos.ia_y_trabajo.fuentes.tich.candidata import DETENIDA, MOTIVOS
from plataforma_datos.ia_y_trabajo.fuentes.tich.constantes import CATALOGO as CATALOGO_TICH
from plataforma_datos.ia_y_trabajo.fuentes.tich.constantes import FUENTE as TICH
from plataforma_datos.ia_y_trabajo.fuentes.tich.documentos_de_la_edicion import PARTES
from plataforma_datos.ia_y_trabajo.fuentes.tich.edicion_nueva import PENDIENTE, SHA256, observacion_de_la_procedencia
from plataforma_datos.orquestacion.cobertura_originales import carpeta_originales, leer_archivo, leer_procedencia
from plataforma_datos.orquestacion.contrato_comprobaciones_panel import instante_panel
from plataforma_datos.orquestacion.contrato_de_trabajos import exigir as exigir_recibo
from plataforma_datos.orquestacion.contrato_de_trabajos import hexa, instante, objeto

CLAVE_PANEL = "edicionNueva"
CLAVE_AVISO = "avisoEdicion"
# Cuántos grupos da la TIC-H en su gran grupo porque la EPA no los confirma (solo viaja si hay alguno).
CLAVE_GRUPOS = "gruposEnSuGranGrupo"
# Cuántos grupos no tienen clase manual o no manual en la edición de la TIC-H validada (solo viaja si hay alguno).
CLAVE_SIN_CLASE = "gruposSinClase"
CAMPOS_DE_GRUPOS = (CLAVE_GRUPOS, CLAVE_SIN_CLASE)
CAMPOS_PANEL = ("estado", "anio", "observadoEn", "huellaCatalogo")
ESTADOS_PANEL = ("publicada-sin-microdatos", "pendiente-de-incorporar", DETENIDA)
NO_VERIFICABLE = "edicion-no-verificable"
NO_COINCIDE = "edicion-no-coincide"
DESCARTADA = "observacion-anterior-descartada"
SIN_CONTRASTE = "sin-contraste-con-la-tich"
SIN_CONTRASTE_DEL_MOTIVO = "sin-contraste-del-motivo"
AVISOS_PANEL = (NO_VERIFICABLE, DESCARTADA, SIN_CONTRASTE, SIN_CONTRASTE_DEL_MOTIVO, NO_COINCIDE)
# Lo que declara el validado de TIC a les llars sobre su contraste con la TIC-H, y el aviso de su fila.
AVISO_POR_CONTRASTE = {"edicion-distinta": SIN_CONTRASTE, "motivo-sin-calculo": SIN_CONTRASTE_DEL_MOTIVO}
TIC_LLARS = "tic_llars"
MAX_PROCEDENCIA_BYTES = 256 * 1024
MAX_VALIDADO_BYTES = 1024 * 1024


def _anio_admitido(raiz: Path) -> str:
    """El año de la edición de la TIC-H que publica esta instalación, de su estado de la edición, leído acotado.

    Returns:
        El año; sin estado, el de la primera edición.

    Raises:
        FormatoInesperado: Si el estado no tiene su forma.
        ValueError: Si el estado no se puede leer sin enlaces o no es JSON.
    """
    carpeta = raiz / DATOS_RELATIVOS / "validados" / TICH
    if not os.path.lexists(carpeta / edicion_tich.ESTADO.name):
        return edicion_tich.primera()["anio"]
    return edicion_tich.valida(json.loads(leer_archivo(carpeta, edicion_tich.ESTADO.name, MAX_VALIDADO_BYTES)))["anio"]


def _motivo_y_partes(motivo: object, partes: object) -> bool:
    """Si el motivo es de la lista y las partes, en el orden de `PARTES`, van solo con «enunciado-distinto».

    Returns:
        True si tienen esa forma.
    """
    return (
        motivo in MOTIVOS
        and type(partes) is list
        and partes == [parte for parte in PARTES if parte in partes]
        and bool(partes) == (motivo == "enunciado-distinto")
    )


def detencion_valida(detenida: dict[str, Any], anio: str) -> dict[str, Any]:
    """Exige la forma de la detención de la edición nueva: motivo de la lista y, con «enunciado-distinto», sus partes.

    Returns:
        `{"motivo"}` y, si las hay, `{"partes"}`, en el orden de `PARTES`.

    Raises:
        FormatoInesperado: Si no es de ese año o no tiene esa forma.
    """
    exigir(
        detenida.get("estado") == DETENIDA
        and detenida.get("anio") == anio
        and _motivo_y_partes(detenida.get("motivo"), detenida.get("partes", [])),
        f"{TICH}: la detención de la edición nueva no tiene la forma esperada",
    )
    partes = detenida.get("partes", [])
    return {"motivo": detenida["motivo"], **({"partes": list(partes)} if partes else {})}


def _detencion(raiz: Path, anio: str) -> dict[str, Any]:
    """La detención de la edición nueva que registra la última validación admitida de la TIC-H, si es de ese año.

    Returns:
        `{"motivo", "partes"?}`, o nada si no hay validación admitida o no registra la detención de ese año.

    Raises:
        FormatoInesperado: Si la registra mal formada.
        ValueError: Si la validación no se puede leer sin enlaces o no es JSON.
    """
    carpeta = raiz / DATOS_RELATIVOS / "validados" / TICH
    if not os.path.lexists(carpeta / ARCHIVO_DE_VALIDACION):
        return {}
    informe = json.loads(leer_archivo(carpeta, ARCHIVO_DE_VALIDACION, MAX_VALIDADO_BYTES))
    if type(informe) is not dict or not str(informe.get("estado", "")).startswith(ADMITIDO):
        return {}
    detenida = informe.get("candidata_detenida")
    if type(detenida) is not dict or detenida.get("anio") != anio:
        return {}
    return detencion_valida(detenida, anio)


def _edicion_nueva(raiz: Path, ahora: datetime) -> dict[str, Any]:
    """La edición nueva de la TIC-H en la forma del panel y, si la última consulta descartó la anterior, su aviso.

    Returns:
        `{}`, o `edicionNueva` (estado, año, instante AAAA-MM-DDTHH:MM:SSZ y huella del catálogo) y, si hubo
        descarte, `avisoEdicion`.

    Raises:
        FormatoInesperado: Si la observación no tiene su forma, no casa con la procedencia o es posterior a `ahora`.
        ValueError: Si la procedencia no se puede leer sin enlaces ni duplicados.
    """
    procedencia = raiz / DATOS_RELATIVOS / "originales" / TICH / ARCHIVO_DE_PROCEDENCIA
    if not os.path.lexists(procedencia):
        return {}
    documento = leer_procedencia(carpeta_originales(raiz, TICH), MAX_PROCEDENCIA_BYTES)
    nueva = observacion_de_la_procedencia(documento, _anio_admitido(raiz))
    if nueva is None:
        return {}
    # La huella del panel es la del catálogo de la última consulta; el dato publicado guarda la de la primera.
    catalogo = next(fila for fila in documento["descubrimiento"] if fila.get("archivo") == CATALOGO_TICH)
    observado = datetime.fromisoformat(nueva["observado_utc"]).astimezone(UTC).replace(microsecond=0)
    exigir(observado <= ahora, f"{TICH}: la edición nueva se observó después de la instantánea")
    detenida = _detencion(raiz, nueva["anio"]) if nueva["estado"] == PENDIENTE else {}
    campos: dict[str, Any] = {
        CLAVE_PANEL: {
            "estado": DETENIDA if detenida else nueva["estado"],
            "anio": nueva["anio"],
            "observadoEn": observado.isoformat().replace("+00:00", "Z"),
            "huellaCatalogo": catalogo["sha256"],
            **detenida,
        }
    }
    return {**campos, CLAVE_AVISO: DESCARTADA} if "edicion_nueva_descartada" in documento else campos


def _validado(raiz: Path, fuente: str) -> dict[str, Any] | None:
    """El conjunto validado de una fuente, leído sin enlaces y acotado.

    Un validado que no se puede leer no apaga el panel: la fila sigue sin estos avisos, y su estado lo dicen su módulo
    y su última validación.

    Returns:
        El conjunto, o None si no existe o no se puede leer.
    """
    carpeta = raiz / DATOS_RELATIVOS / "validados" / fuente
    if not os.path.lexists(carpeta / f"{fuente}.json"):
        return None
    try:
        conjunto = json.loads(leer_archivo(carpeta, f"{fuente}.json", MAX_VALIDADO_BYTES))
    except (OSError, ValueError):
        return None
    return conjunto if isinstance(conjunto, dict) else None


def _aviso_de_tic_llars(raiz: Path) -> str | None:
    """Lee lo que declara el validado de TIC a les llars sobre su contraste con la TIC-H.

    Returns:
        El aviso si se validó sin contraste (otra edición de la TIC-H, o sin el cálculo del motivo), o None.
    """
    conjunto = _validado(raiz, TIC_LLARS)
    return None if conjunto is None else AVISO_POR_CONTRASTE.get(conjunto.get("contraste_con_la_tich"))


def _grupos_en_su_gran_grupo(raiz: Path) -> dict[str, int]:
    """Cuántos grupos da la TIC-H validada en su gran grupo porque la EPA no los confirma, y cuántos no tienen clase.

    Returns:
        `{"gruposEnSuGranGrupo": número}` y `{"gruposSinClase": número}`, cada uno solo si hay alguno.
    """
    validado = _validado(raiz, TICH) or {}
    bajados, sin_clase = validado.get("grupos_en_su_gran_grupo"), validado.get("grupos_sin_clase")
    return {
        **({CLAVE_GRUPOS: len(bajados)} if isinstance(bajados, dict) and bajados else {}),
        **({CLAVE_SIN_CLASE: len(sin_clase)} if isinstance(sin_clase, list) and sin_clase else {}),
    }


def campos_del_panel(raiz: Path, fuente: str, ahora: datetime) -> dict[str, Any]:
    """Los campos de edición de la fila de una fuente: ninguno, la edición nueva observada o su aviso.

    Args:
        raiz: La instalación cuyos datos operativos se leen.
        fuente: El id de la fuente.
        ahora: El instante de la instantánea; una observación posterior no es verificable.

    Returns:
        `{}`, `{"edicionNueva": …}` o `{"avisoEdicion": código}` y, en la TIC-H, además `{"gruposEnSuGranGrupo":
        número}` si su validado da algún grupo en su gran grupo.
    """
    if fuente == TIC_LLARS:
        aviso = _aviso_de_tic_llars(raiz)
        return {} if aviso is None else {CLAVE_AVISO: aviso}
    if fuente != TICH:
        return {}
    try:
        validado = _validado(raiz, TICH)
        no_coincide = validado is not None and validado.get("anio") != _anio_admitido(raiz)
        campos = {CLAVE_AVISO: NO_COINCIDE} if no_coincide else _edicion_nueva(raiz, ahora)
    except (ErrorFuente, ValueError):
        # Una procedencia que no se puede verificar deja la fila sin la edición nueva y con su aviso.
        campos = {CLAVE_AVISO: NO_VERIFICABLE}
    return {**campos, **_grupos_en_su_gran_grupo(raiz)}


def clave_en_la_fila(campo: str, registro: object) -> str:
    """Las claves de edición que añade a una fila de fuente de un recibo, si las trae.

    Returns:
        «,edicionNueva», «,avisoEdicion» o nada; las filas de módulos nunca las llevan.
    """
    if campo != "fuentes" or type(registro) is not dict:
        return ""
    return "".join(f",{clave}" for clave in (CLAVE_PANEL, CLAVE_AVISO, *CAMPOS_DE_GRUPOS) if clave in registro)


def comprobar_en_el_recibo(fila: dict[str, Any], observado: str) -> None:
    """Exige, si los trae, la edición nueva o el aviso de una fila de fuente de un recibo conservado.

    Solo una fuente por ediciones los lleva; la edición nueva, con su forma cerrada y no después de la instantánea, y
    el aviso, con un código de la lista. Juntos, solo el aviso del descarte de una observación anterior.

    Raises:
        AlmacenTrabajoInvalido: Si no tienen esa forma.
    """
    for clave in CAMPOS_DE_GRUPOS:
        if clave in fila:
            exigir_recibo(fila["politica"] == "edición" and type(fila[clave]) is int and fila[clave] > 0)
    if CLAVE_AVISO in fila:
        exigir_recibo(fila["politica"] == "edición" and fila[CLAVE_AVISO] in AVISOS_PANEL)
        exigir_recibo((CLAVE_PANEL in fila) == (fila[CLAVE_AVISO] == DESCARTADA))
    if CLAVE_PANEL not in fila:
        return
    detenida = type(fila[CLAVE_PANEL]) is dict and fila[CLAVE_PANEL].get("estado") == DETENIDA
    con_partes = detenida and "partes" in fila[CLAVE_PANEL]
    claves = (*CAMPOS_PANEL, *(("motivo",) if detenida else ()), *(("partes",) if con_partes else ()))
    nueva = objeto(fila[CLAVE_PANEL], ",".join(claves))
    exigir_recibo(fila["politica"] == "edición" and nueva["estado"] in ESTADOS_PANEL)
    if detenida:
        exigir_recibo(_motivo_y_partes(nueva["motivo"], nueva.get("partes", [])))
    exigir_recibo(isinstance(nueva["anio"], str) and re.fullmatch(r"[0-9]{4}", nueva["anio"]) is not None)
    instante(nueva["observadoEn"])
    exigir_recibo(instante_panel(nueva["observadoEn"]) <= instante_panel(observado))
    hexa(nueva["huellaCatalogo"], SHA256)
