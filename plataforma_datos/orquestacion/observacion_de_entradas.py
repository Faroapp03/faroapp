"""Recupera observaciones históricas de entradas acreditadas, con el cerrojo del motor."""

from copy import deepcopy
from pathlib import Path
from typing import Any

from plataforma_datos.orquestacion.comprobaciones_remotas import (
    RESULTADOS_EXITOSOS,
    VERSION_REGISTRO,
    _exigir,
    _guardar,
    _instante,
    _objeto,
    _seguir_remoto,
    _utc,
    _validar_fuente,
    leer_registro,
)


def validar_observacion_de_lote(fuente: str, valor: object, observado_en: str) -> dict[str, Any]:
    """Contrasta la fila remota histórica y el instante de recepción sellado por el lote.

    Returns:
        Fila original del registro sin cambiar sus tiempos, ciclo ni cobertura.
    """
    fila = _objeto(
        valor, "ciclo,conjuntos,inicio_utc,fin_utc,resultado,evidencia,comprobados,remoto,ultimo_intento_remoto_utc"
    )
    _validar_fuente(fuente, fila, _instante(fila["fin_utc"]))
    evidencia = fila["evidencia"]
    _exigir(fila["remoto"] and fila["resultado"] in RESULTADOS_EXITOSOS and evidencia is not None)
    _exigir(evidencia["peticiones"] > 0)
    _exigir(_utc(_instante(evidencia["fin_utc"]).replace(microsecond=0)) == observado_en)
    return fila


def recuperar_observacion_remota(raiz: Path, fuente: str, fila: dict[str, Any], observado_en: str) -> None:
    """Incorpora una recepción sellada a una ronda abierta, conservando su ciclo histórico y la vigencia real."""
    validar_observacion_de_lote(fuente, fila, observado_en)
    registro = leer_registro(raiz)
    ciclo = registro["ultimo_ciclo"]
    _exigir(registro["version"] == VERSION_REGISTRO and ciclo is not None and ciclo["resultado"] == "en-curso")
    _exigir(fila["ciclo"] != ciclo["id"] and _instante(fila["fin_utc"]) <= _instante(ciclo["inicio_utc"]))
    vigente = registro["fuentes"].get(fuente)
    ultima = vigente["ultimo_intento_remoto_utc"] if vigente is not None else None
    if ultima is not None and _instante(ultima) >= _instante(fila["inicio_utc"]):
        return
    if vigente is not None and _instante(vigente["inicio_utc"]) >= _instante(fila["fin_utc"]):
        _exigir(not vigente["remoto"])
        vigente["ultimo_intento_remoto_utc"] = fila["inicio_utc"]
    else:
        registro["fuentes"][fuente] = deepcopy(fila)
    for identificador in fila["comprobados"]:
        registro["conjuntos"][identificador] = {
            "fuente": fuente,
            "ciclo": fila["ciclo"],
            "comprobado_utc": fila["fin_utc"],
            "sha256_evidencia": fila["evidencia"]["sha256"],
        }
    _seguir_remoto(registro, fuente, fila)
    _guardar(raiz, registro)
