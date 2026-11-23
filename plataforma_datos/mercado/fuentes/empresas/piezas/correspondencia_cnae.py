"""Inclusión de divisiones CNAE-2009 en agrupaciones ETICCE de CNAE-2025.

La correspondencia oficial relaciona contenido, no empresas ni porcentajes. Una división de dos cifras solo cabe
completa en una agrupación si todos los destinos de todas sus clases de cuatro cifras están dentro. Si un contenido
sale fuera, se conserva como parcial y no se asigna la división. No se utilizan pesos ni se supone identidad por
compartir código. El recurso fija los grupos y la procedencia de la edición 2025–1T2026: otra edición se revisa.

El porcentaje y el error de referencia se conservan tal como vienen en las filas. El error corresponde a D.1.A y no
se transforma en un error de D.1. La inclusión permite un contexto de grupo más amplio; no establece equivalencia
estadística entre clasificaciones ni reconstruye tasas históricas. Total Empresas y Sector TIC permanecen identificados
para que el consumidor distinga los totales y los grupos transversales del contexto sectorial.
"""

from typing import Any

from plataforma_datos.comun.nucleo import RAIZ, exigir
from plataforma_datos.mercado.fuentes.empresas.piezas.contrato_eticce import cargar_recurso

_CONTRATO = RAIZ / "plataforma_datos" / "mercado" / "fuentes" / "empresas" / "contratos" / "empresas-cnae2025.json"
_PREGUNTA = "D.1 % de empresas que emplean tecnologías de Inteligencia Artificial (IA) (1)"


def _filas_por_agrupacion(filas: list[dict[str, Any]], nombres: set[str]) -> dict[str, dict[str, Any]]:
    """Las filas de D.1 del tamaño total, con un único valor por grupo previsto.

    Returns:
        Filas identificadas por el literal completo de su agrupación.
    """
    seleccionadas = [fila for fila in filas if fila["parte"] == "sectores" and fila["tamano"] == "Total"]
    encontradas = {fila["agrupacion"]: fila for fila in seleccionadas}
    exigir(
        set(encontradas) == nombres and len(encontradas) == len(seleccionadas),
        "empresas: las agrupaciones CNAE-2025 no coinciden con el contrato revisado",
    )
    exigir(
        all(fila["pregunta"] == _PREGUNTA for fila in seleccionadas),
        "empresas: cambia la pregunta D.1 de la edición CNAE-2025 revisada",
    )
    return encontradas


def _destinos_por_division(relaciones: dict[str, list[str]], existentes: set[int]) -> dict[int, dict[str, set[str]]]:
    """Los destinos de cada clase antigua, conservando sus divisiones completas.

    Returns:
        División de 2009 y, dentro, clases de 2009 con todos sus destinos de 2025.
    """
    clases: dict[int, dict[str, set[str]]] = {}
    for codigo, destinos in relaciones.items():
        division = int(codigo[:2])
        if division in existentes:
            clases.setdefault(division, {})[codigo] = set(destinos)
    exigir(
        set(clases) == existentes,
        "empresas: una división CNAE-2009 no existe en la correspondencia oficial revisada",
    )
    return clases


def _inclusion(clases: dict[int, dict[str, set[str]]], permitidas: set[str]) -> dict[str, Any]:
    """Separa la inclusión completa de la intersección parcial de contenidos.

    Returns:
        Divisiones admitidas y detalle de las que solo tienen una parte dentro.
    """
    completas: list[int] = []
    parciales: dict[str, dict[str, list[str]]] = {}
    excluidas: list[int] = []
    for division, antiguas in sorted(clases.items()):
        destinos = set().union(*antiguas.values())
        fuera = destinos - permitidas
        if not fuera:
            completas.append(division)
        elif destinos & permitidas:
            parciales[f"{division:02d}"] = {
                "clases_2009_fuera": sorted(codigo for codigo, nuevos in antiguas.items() if nuevos - permitidas),
                "destinos_2025_fuera": sorted(fuera),
                "destinos_2025_dentro": sorted(destinos & permitidas),
            }
        else:
            excluidas.append(division)
    return {"divisiones": completas, "divisiones_parciales": parciales, "divisiones_excluidas": excluidas}


def agrupaciones_para_cnae09(filas: list[dict[str, Any]], existentes: set[int]) -> dict[str, dict[str, Any]]:
    """Las agrupaciones revisadas de 2026 y las divisiones de 2009 completamente incluidas.

    Args:
        filas: Filas preparadas de la pregunta D.1 por agrupación y tamaño, más los errores de referencia.
        existentes: Divisiones CNAE-2009 disponibles en el consumidor, por ejemplo en el Censo 2021.

    Returns:
        Por literal de grupo, porcentaje, error de referencia y divisiones incluidas. Las inclusiones parciales se
        documentan aparte y nunca entran en «divisiones».
    """
    contrato = cargar_recurso(_CONTRATO)
    encontradas = _filas_por_agrupacion(filas, set(contrato["agrupaciones"]))
    clases = _destinos_por_division(contrato["clases_2009_a_2025"], existentes)
    errores = {fila["agrupacion"]: fila["valor"] for fila in filas if fila["parte"] == "errores"}
    resultado: dict[str, dict[str, Any]] = {}
    for nombre, permitidas in contrato["agrupaciones"].items():
        resultado[nombre] = {
            **_inclusion(clases, set(permitidas)),
            "pct": encontradas[nombre]["valor"],
            "error_estandar_de_referencia": errores.get(nombre),
            "criterio": contrato["criterio"],
            "clasificacion_origen": contrato["clasificacion_origen"],
            "clasificacion_destino": contrato["clasificacion_destino"],
            "edicion": contrato["edicion"],
        }
    return resultado
