"""Parte de salud de la base de datos que lleva el resumen de cada ciclo.

Dice, con lo observado en este ciclo y nada más, cómo está la base de datos ese día: qué fuentes dejaron lectura y con
qué estado y motivos, cuántos cursos entraron y salieron y con qué explicación, qué retiradas se decidieron y cuánto
error de retirada se ha observado. Lo que falta también se dice: una fuente que se leyó y no dejó lectura figura como
«sin-lectura», y una cuya adquisición aún no emite lecturas, como «no-registra-todavia»; ninguna se da por sana.

El veredicto del día sale solo de esos hechos. No usa umbrales de días ni recuentos de fallos seguidos, ni consulta el
reloj: «este ciclo» son las lecturas cuya hora de observación cae dentro del periodo del propio diario.

`componer_salud` es una función pura sobre lecturas, registros de decisiones y filas de la medida del error ya leídos;
`parte_de_salud` los lee del almacén de una instalación, sin escribir nada. Solo lleva identificadores y recuentos:
ningún título de curso ni dato personal. Su forma cerrada está en `formas_del_diario`.
"""

import importlib.util
from collections import Counter
from collections.abc import Collection, Iterable, Mapping
from datetime import datetime
from pathlib import Path
from typing import Any

from plataforma_datos.cursos.decisiones_retirada import cargar_registro, ruta_del_registro
from plataforma_datos.cursos.lectura_error_de_retirada import fuentes_con_lecturas, medir_error_guardado
from plataforma_datos.cursos.lecturas.almacen_lecturas import listar_lecturas
from plataforma_datos.orquestacion.formas_del_diario import (
    EXPLICACIONES_DE_SALIDA,
    GRUPOS_DE_RETIRADA,
    NATURALEZA_DEL_ERROR,
)

# Las fuentes de cursos que se leen cada día: de cada una se espera una lectura aunque aún no la emita.
FUENTES_DE_CURSOS = (
    "barcelonactiva",
    "cibervoluntarios",
    "citilab",
    "claude_academy",
    "consorci",
    "formacion",
    "fundae",
    "hp_life",
)
ETAPA_DE_LECTURA = "descargar"
# De menos a más grave: el estado de una fuente es el peor de los de sus ámbitos.
GRAVEDAD = ("sana", "reconstruida", "incompleta", "anomala")
MODULO_DE_LECTURA = "plataforma_datos.cursos.fuentes.{fuente}.lectura"
CUENTAS = ("sanas", "anomalas", "sinLectura", "noRegistran", "noLeidas")


def emite_lecturas(fuente: str) -> bool:
    """Indica si la adquisición de una fuente ya tiene su módulo de lectura, que es lo que la hace emitir.

    Returns:
        Verdadero si existe `fuentes/<fuente>/lectura.py`.
    """
    return importlib.util.find_spec(MODULO_DE_LECTURA.format(fuente=fuente)) is not None


# La última lectura de cada ámbito dentro del ciclo, por orden de ámbito.
def _ultima_por_ambito(lecturas: Iterable[Mapping[str, Any]]) -> list[Mapping[str, Any]]:
    ultimas: dict[str, Mapping[str, Any]] = {}
    for lectura in sorted(lecturas, key=lambda lectura: (lectura["observado_utc"], lectura["lectura_id"])):
        ultimas[lectura["ambito"]] = lectura
    return [ultimas[ambito] for ambito in sorted(ultimas)]


def _de_la_lectura(lectura: Mapping[str, Any]) -> dict[str, Any]:
    explicadas = Counter(s["explicada_por"] for s in lectura["salidas"] if s["explicada_por"] is not None)
    return {
        "ambito": lectura["ambito"],
        "estado": lectura["estado"],
        "motivos": list(lectura["motivos"]),
        "motivoIncompleta": lectura["motivo_incompleta"],
        "bruto": lectura["recuento_bruto"],
        "vigente": lectura["recuento_vigente"],
        "declarado": lectura["total_declarado"],
        "entradas": len(lectura["entradas"]),
        "salidasExplicadas": {explicacion: explicadas[explicacion] for explicacion in EXPLICACIONES_DE_SALIDA},
        "salidasSinExplicar": sum(1 for s in lectura["salidas"] if s["explicada_por"] is None),
        "valoresNuevos": len(lectura["huella_forma"]["valores_nuevos"]),
        "formaCambiada": "forma_cambiada" in lectura["motivos"],
    }


# El grupo que sostuvo una retirada: la fuente si la afirma; si no, el censo con la página o el censo repetido.
def _grupo_de(decision: Mapping[str, Any]) -> str:
    grupos = {evidencia["grupo"] for evidencia in decision["evidencias"]}
    if "fuente" in grupos:
        return "fuente"
    return "censo_y_pagina" if "pagina" in grupos else "censo_repetido"


# Lo decidido en este ciclo: retiradas por grupo, pendientes y cursos que se mantienen.
def _decisiones(registros: Collection[Mapping[str, Any]]) -> dict[str, Any]:
    decisiones = [decision for registro in registros for decision in registro["decisiones"]]
    por_grupo = Counter(_grupo_de(decision) for decision in decisiones if decision["decision"] == "retirar")
    return {
        "registros": len(registros),
        "retirar": {grupo: por_grupo[grupo] for grupo in GRUPOS_DE_RETIRADA},
        "pendientes": sum(1 for decision in decisiones if decision["decision"] == "pendiente"),
        "mantenidas": sum(registro["mantenidas"] for registro in registros),
    }


# El error de retirada observado, con su cota; sin retiradas comprobables no hay tasa ni cota.
def _error(fila: Mapping[str, Any] | None) -> dict[str, Any]:
    if fila is None:
        estado, retiradas, comprobables, reaparecidas = "sin-medida", 0, 0, 0
        tasa = cota = None
    else:
        retiradas, comprobables = fila["retiradas"], fila["con_lectura_posterior"]
        reaparecidas, tasa, cota = fila["reaparecidas"], fila["tasa"], fila["cota95"]
        estado = "medido" if comprobables else "sin-retiradas-comprobables"
    return {
        "estado": estado,
        "retiradas": retiradas,
        "comprobables": comprobables,
        "reaparecidas": reaparecidas,
        "tasa": tasa,
        "cota95": cota,
        "naturaleza": NATURALEZA_DEL_ERROR,
    }


# Quién es la fuente y en qué situación está: dejó lectura, se leyó sin dejarla, no registra o no se leyó.
def _cabecera(
    fuente: str, ultimas: list[Mapping[str, Any]], descarga: Mapping[str, Any] | None, *, emite: bool
) -> dict:
    if ultimas:
        registro = "lee"
    elif descarga is None:
        registro = "no-leida"
    else:
        registro = "sin-lectura" if emite else "no-registra-todavia"
    return {
        "fuente": fuente,
        "registro": registro,
        "descarga": {"estado": None, "causa": None} if descarga is None else dict(descarga),
    }


def _fila(
    cabecera: dict[str, Any],
    ultimas: list[Mapping[str, Any]],
    registros: Collection[Mapping[str, Any]],
    error: Mapping[str, Any] | None,
) -> dict[str, Any]:
    return {
        **cabecera,
        "estado": max((lectura["estado"] for lectura in ultimas), key=GRAVEDAD.index, default=None),
        "lecturas": [_de_la_lectura(lectura) for lectura in ultimas],
        "decisiones": _decisiones(registros),
        "error": _error(error),
    }


def veredicto_del_dia(filas: Collection[Mapping[str, Any]]) -> str:
    """El veredicto del día, derivado solo de lo observado en las filas de las fuentes.

    Una fuente sin lectura pesa más que una anómala; «anomala» recoge toda lectura que no es sana (anómala, incompleta
    o reconstruida) y el estado de cada fuente dice cuál. Si las que registran están sanas pero otras no registran o no
    se leyeron, es «sana-parcial»; sin ninguna lectura que valorar, «sin-observaciones».

    Returns:
        Uno de `VEREDICTOS_DE_SALUD`, salvo «no-calculado», que solo da quien no pudo leer el almacén.
    """
    registros = [fila["registro"] for fila in filas]
    if "sin-lectura" in registros:
        return "sin-lectura"
    if any(fila["registro"] == "lee" and fila["estado"] != "sana" for fila in filas):
        return "anomala"
    if "lee" not in registros:
        return "sin-observaciones"
    return "sana-parcial" if "no-registra-todavia" in registros or "no-leida" in registros else "sana"


def _cuenta(filas: Collection[Mapping[str, Any]]) -> dict[str, int]:
    leen = [fila for fila in filas if fila["registro"] == "lee"]
    return {
        "sanas": sum(1 for fila in leen if fila["estado"] == "sana"),
        "anomalas": sum(1 for fila in leen if fila["estado"] != "sana"),
        "sinLectura": sum(1 for fila in filas if fila["registro"] == "sin-lectura"),
        "noRegistran": sum(1 for fila in filas if fila["registro"] == "no-registra-todavia"),
        "noLeidas": sum(1 for fila in filas if fila["registro"] == "no-leida"),
    }


def componer_salud(
    *,
    lecturas: Iterable[Mapping[str, Any]],
    registros: Iterable[Mapping[str, Any]],
    error: Iterable[Mapping[str, Any]],
    descargas: Mapping[str, Mapping[str, Any]],
    emiten: Collection[str],
) -> dict[str, Any]:
    """Compone el bloque `salud` a partir de lo observado en el ciclo.

    Args:
        lecturas: Las lecturas de este ciclo, de cualquier fuente.
        registros: Los registros de decisiones de retirada de esas lecturas; pueden no existir.
        error: Las filas de la medida del error de retirada, una por fuente (todo el historial).
        descargas: Por fuente que este ciclo descargó, el estado y la causa de su etapa de descarga.
        emiten: Las fuentes cuya adquisición ya emite lecturas.

    Returns:
        El bloque con el veredicto, el recuento por situación y una fila por fuente, en orden alfabético.
    """
    lecturas, registros = list(lecturas), list(registros)
    por_fuente = {fila["fuente"]: fila for fila in error}
    nombres = sorted({*FUENTES_DE_CURSOS, *(lectura["fuente"] for lectura in lecturas)})
    filas = []
    for fuente in nombres:
        ultimas = _ultima_por_ambito(lectura for lectura in lecturas if lectura["fuente"] == fuente)
        cabecera = _cabecera(fuente, ultimas, descargas.get(fuente), emite=fuente in emiten)
        propios = [registro for registro in registros if registro["fuente"] == fuente]
        filas.append(_fila(cabecera, ultimas, propios, por_fuente.get(fuente)))
    return {"veredicto": veredicto_del_dia(filas), "motivo": None, "cuenta": _cuenta(filas), "fuentes": filas}


def _no_calculado(motivo: str) -> dict[str, Any]:
    return {"veredicto": "no-calculado", "motivo": motivo, "cuenta": dict.fromkeys(CUENTAS, 0), "fuentes": []}


# La hora a la resolución de las lecturas, que se guardan al segundo.
def _instante(texto: str) -> datetime:
    return datetime.fromisoformat(texto).replace(microsecond=0)


def _en_el_periodo(observado: str, periodo: Mapping[str, str | None]) -> bool:
    desde, hasta = periodo["desde"], periodo["hasta"]
    return desde is not None and hasta is not None and _instante(desde) <= _instante(observado) <= _instante(hasta)


# Por fuente, cómo terminó su etapa de descarga en este ciclo, según el diario.
def _descargas(etapas: Iterable[Mapping[str, Any]]) -> dict[str, dict[str, Any]]:
    return {
        etapa["fuente"]: {"estado": etapa["estado"], "causa": etapa["causa"]}
        for etapa in etapas
        if etapa["etapa"] == ETAPA_DE_LECTURA
    }


def parte_de_salud(
    raiz: Path | None, periodo: Mapping[str, str | None], etapas: Iterable[Mapping[str, Any]]
) -> dict[str, Any]:
    """Lee del almacén de una instalación lo que pide `componer_salud` y compone el parte. No escribe nada.

    Sin instalación, o con un almacén que no se puede leer, el parte es «no-calculado» con su motivo: no se da por sano
    lo que no se ha podido mirar.

    Args:
        raiz: La instalación que guarda las lecturas del ciclo, o `None` si el resumen no la conoce.
        periodo: El periodo del diario (`desde` y `hasta`, UTC): las lecturas de este ciclo caen dentro.
        etapas: Las etapas de fuente del diario, con su fuente, su etapa, su estado y su causa.

    Returns:
        El bloque `salud` del resumen.
    """
    if raiz is None:
        return _no_calculado("sin-almacen")
    try:
        lecturas = [
            lectura
            for fuente in fuentes_con_lecturas(raiz)
            for lectura in listar_lecturas(raiz, fuente)
            if _en_el_periodo(lectura["observado_utc"], periodo)
        ]
        registros = [
            cargar_registro(raiz, lectura["fuente"], lectura["lectura_id"])
            for lectura in lecturas
            if ruta_del_registro(raiz, lectura["fuente"], lectura["lectura_id"]).exists()
        ]
        error = medir_error_guardado(raiz)
    except (ValueError, OSError):
        return _no_calculado("almacen-ilegible")
    emiten = {fuente for fuente in FUENTES_DE_CURSOS if emite_lecturas(fuente)}
    return componer_salud(
        lecturas=lecturas, registros=registros, error=error, descargas=_descargas(etapas), emiten=emiten
    )
