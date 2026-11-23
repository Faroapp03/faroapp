"""Monta el conjunto que `mercado/fuentes/observatori/lector.py` exporta al paquete: cifras, series y periodos.

Las cifras relativas solo se publican con MIN_BASE unidades de base: personas o contratos, según el indicador.
Las series por ocupación requieren MIN_SERIE contratos o demandantes; los recuentos se conservan sin esos umbrales.
"""

import re
from datetime import datetime
from typing import Any, TypedDict

from plataforma_datos.comun import vigencia
from plataforma_datos.comun.lugares import COMARCAS_DE_LA_ZONA
from plataforma_datos.comun.nucleo import FormatoInesperado, exigir
from plataforma_datos.comun.periodos import MESES_CA, MESES_ES, mes_anterior, mes_iso, rotulo_de_doce_meses
from plataforma_datos.comun.textos_y_cifras import personas_anteriores
from plataforma_datos.mercado.fuentes.cataluna.piezas.constantes_cataluna import (
    CITA_OBSERVATORI_SIN_FECHA,
    PATRON_ACTUALIZACION,
)
from plataforma_datos.mercado.fuentes.observatori.piezas.constantes_observatori import (
    CALENDARIO,
    COMARCA_DEL_PAQUETE,
    MIN_BASE,
    MIN_SERIE,
    ROTULO_CENSO,
)


class FilasDelObservatori(TypedDict):
    """Grupos preparados que necesita el conjunto exportable."""

    cataluna: list[dict[str, Any]]
    series: list[dict[str, Any]]
    comarcas: list[dict[str, Any]]
    provincias: list[dict[str, Any]]


class ResumenDelObservatori(TypedDict):
    """Totales y series agregadas que exporta el conjunto."""

    total: dict[str, Any]
    series: dict[str, Any]


class ContextoDelObservatori(TypedDict):
    """Periodo vigente de las tablas preparadas."""

    mes: int
    periodo: str


def _series_del_paquete(series: list[dict[str, Any]], del_cataluna: dict[str, dict[str, Any]]) -> dict[str, Any]:
    """Variaciones y recuentos mensuales de las ocupaciones con base suficiente.

    Returns:
        Por código, las series de variaciones («variaciones») y los recuentos mensuales («mensuales»).
    """
    variaciones: dict[str, dict[str, list[float | None] | None]] = {}
    mensuales: dict[str, dict[str, list[float | None]]] = {}
    for serie in series:
        fila = del_cataluna.get(serie["cno11"])
        if fila is None:
            continue
        contratos = serie_publicable(serie["variacion_contratos_mm12"], fila["contratos"])
        demandantes = serie_publicable(serie["variacion_demandantes_mm12"], fila["demandantes_no_ocupados_media"])
        if contratos or demandantes:
            variaciones[serie["cno11"]] = {"contratos": contratos, "demandantes_no_ocupados": demandantes}
        if (fila["contratos"] or 0) >= MIN_SERIE:
            mensuales[serie["cno11"]] = {
                "contratos": serie["contratos_mes"],
                "personas_contratadas": serie["personas_contratadas_mes"],
                "demandantes_no_ocupados": serie["demandantes_no_ocupados_mes"],
            }
    return {"variaciones": variaciones, "mensuales": mensuales}


def con_base(valor: float | None, base: float | None, decimales: int, factor: float = 1) -> float | None:
    """Un porcentaje, una media o una razón, redondeado, si su base llega a `MIN_BASE`; si no, `None`.

    Returns:
        La cifra redondeada (entera si no lleva decimales), o None si no tiene base suficiente.
    """
    if valor is None or base is None or base < MIN_BASE:
        return None
    # Python aplica empates al par; se conserva ese criterio para las cifras del paquete.
    redondeado = round(valor * factor, decimales)
    return int(redondeado) if decimales == 0 else redondeado


def entero(valor: float | None) -> int | None:
    """Un recuento o una media de recuentos como número entero.

    Returns:
        El número entero, o None si no hay dato.
    """
    # round sin decimales devuelve un entero y resuelve los empates hacia el par.
    return None if valor is None else round(valor)


def cifras_del_grupo(fila: dict[str, Any]) -> dict[str, Any]:
    """Lo que el paquete da de una ocupación en un territorio, con la regla de las cifras.

    Returns:
        Las cifras de la ocupación que publica el paquete; None en las que no tienen base suficiente.
    """
    contratos, personas = fila["contratos"], fila["personas_contratadas"]
    demandantes = fila["demandantes_no_ocupados_12m"]
    indefinidos = fila["fraccion_indefinidos"]
    # Sin la parte de indefinidos no se sabe cuántos contratos fueron temporales: la duración media no tiene base.
    temporales = None if contratos is None or indefinidos is None else contratos * (1 - indefinidos)
    del_anio_anterior = personas_anteriores(personas, fila["variacion_personas_contratadas"])
    base_variacion = None if del_anio_anterior is None else min(personas or 0, del_anio_anterior)
    return {
        "contratos": entero(contratos),
        "personas_contratadas": entero(personas),
        "variacion_personas_contratadas": con_base(fila["variacion_personas_contratadas"], base_variacion, 1, 100),
        "contratos_por_persona": con_base(fila["contratos_por_persona"], personas, 2),
        "pct_indefinidos": con_base(fila["fraccion_indefinidos"], contratos, 1, 100),
        "pct_parcial": con_base(fila["fraccion_parcial"], contratos, 1, 100),
        "duracion_media_temporales_dias": con_base(fila["duracion_media_temporales_dias"], temporales, 0),
        "demandantes_no_ocupados_12m": entero(demandantes),
        "demandantes_no_ocupados_media": entero(fila["demandantes_no_ocupados_media"]),
        "contratadas_por_demandante": con_base(
            fila["contratadas_por_demandante"], min(personas or 0, demandantes or 0), 2
        ),
    }


def serie_publicable(valores: list[float | None], base: float | None) -> list[float | None] | None:
    """Una serie de variaciones en %, con un decimal, si la ocupación llega a `MIN_SERIE` al año.

    Returns:
        Las variaciones en %, o None si la ocupación no llega a MIN_SERIE.
    """
    if base is None or base < MIN_SERIE or not valores:
        return None
    return [None if valor is None else round(100 * valor, 1) for valor in valores]


def provincias_del_paquete(
    provincias: list[dict[str, Any]], del_cataluna: dict[str, dict[str, Any]], tabla: dict[str, Any]
) -> dict[str, Any]:
    """Contratos por provincia de las ocupaciones con `MIN_BASE` contratos o más en Cataluña, con su cita y su nota.

    Returns:
        La medida, la cita, las comarcas partidas y, por código, los contratos por provincia.
    """
    return {
        "medida": "contratos firmados en 12 meses, por provincia; cada comarca, en la provincia de la mayoría de sus "
        "municipios",
        "cita": tabla["fuente"]["cita"],
        "comarcas_partidas": sorted(comarca["nombre"] for comarca in tabla["partidas"].values()),
        "cno4": {
            fila["cno11"]: fila["contratos"]
            for fila in provincias
            if (del_cataluna.get(fila["cno11"], {}).get("contratos") or 0) >= MIN_BASE
        },
    }


def bloque_de_vigencia(periodo: str, cita: str) -> dict[str, Any]:
    """La vigencia del conjunto: los 12 meses que terminan en `periodo`, publicados en la fecha de su cita.

    Returns:
        El bloque de vigencia del conjunto.

    Raises:
        FormatoInesperado: Si la cita no identifica el periodo o contiene una fecha de actualización inválida.
    """
    actualizacion = re.search(PATRON_ACTUALIZACION, cita)
    if actualizacion is None:
        nombre = f"{MESES_CA[int(periodo[5:]) - 1]} de {periodo[:4]}"
        exigir(
            cita == CITA_OBSERVATORI_SIN_FECHA.format(periodo=nombre),
            f"cita sin fecha de actualización ni periodo: {cita}",
        )
        return vigencia.bloque(f"{mes_anterior(periodo, 11)}/{periodo}", None, None, CALENDARIO, cita)
    try:
        publicado = datetime.strptime(actualizacion.group(1), "%d/%m/%Y").date().isoformat()
    except ValueError as error:
        raise FormatoInesperado(f"fecha de actualización inválida del Observatori: {actualizacion.group(1)}") from error
    return vigencia.bloque(f"{mes_anterior(periodo, 11)}/{periodo}", publicado, None, CALENDARIO, cita)


def contrato_indefinido(periodo: str) -> dict[str, Any]:
    """Las dos medidas del contrato indefinido, cada una con su periodo: la del Observatori y la del censo.

    Returns:
        Las dos medidas («contratos_firmados» y «personas_ocupadas»), cada una con dónde está y su periodo.
    """
    return {
        "contratos_firmados": {
            "medida": "porcentaje de los contratos firmados en 12 meses que fueron indefinidos",
            "donde": "cataluna.cno4.<ocupación>.pct_indefinidos y comarca.cno4.<ocupación>.pct_indefinidos",
            "periodo": {
                "es": rotulo_de_doce_meses(periodo, MESES_ES, "de {inicio} a {fin}"),
                "ca": rotulo_de_doce_meses(periodo, MESES_CA, "de {inicio} a {fin}"),
            },
        },
        "personas_ocupadas": {
            "medida": "porcentaje de las personas ocupadas que tenían contrato indefinido",
            "donde": "censo.json: perfil_cno3.<grupo>.situacion.indefinido",
            "periodo": ROTULO_CENSO,
        },
    }


def conjunto_validado(
    filas: FilasDelObservatori,
    resumen: ResumenDelObservatori,
    contexto: ContextoDelObservatori,
    cita: str,
    tabla: dict[str, Any],
) -> dict[str, Any]:
    """Versión para el motor: Cataluña, la comarca del Baix Llobregat y las series, con la regla de las cifras.

    Returns:
        El conjunto que exporta el paquete (observatori.json).
    """
    # Las series agregadas de Cataluña se publican sin umbral por ocupación; MIN_SERIE permite usar el mismo redondeo.
    periodo = mes_iso(contexto["mes"])
    por_codigo = {fila["cno11"]: fila for fila in filas["cataluna"]}
    del_paquete = _series_del_paquete(filas["series"], por_codigo)
    series = resumen["series"]
    return {
        "vigencia": bloque_de_vigencia(periodo, cita),
        "fuentes": {"observatori": cita},
        "periodo": contexto["periodo"],
        "min_base": MIN_BASE,
        "min_serie": MIN_SERIE,
        "contrato_indefinido": contrato_indefinido(periodo),
        "cataluna": {
            "total": cifras_del_grupo(resumen["total"]),
            "cno4": {codigo: cifras_del_grupo(fila) for codigo, fila in sorted(por_codigo.items())},
        },
        "comarca": {
            "codigo": COMARCA_DEL_PAQUETE,
            "nombre": COMARCAS_DE_LA_ZONA[COMARCA_DEL_PAQUETE],
            "cno4": {
                fila["cno11"]: cifras_del_grupo(fila)
                for fila in filas["comarcas"]
                if fila["comarca"] == COMARCA_DEL_PAQUETE
            },
        },
        "provincias": provincias_del_paquete(filas["provincias"], por_codigo, tabla),
        "series": {
            "meses": series["meses_de_variacion"],
            "medida": "variación interanual de la media móvil de 12 meses, en %",
            "cataluna": {
                "contratos": serie_publicable(series["variacion_contratos_mm12"], MIN_SERIE),
                "demandantes_no_ocupados": serie_publicable(series["variacion_demandantes_mm12"], MIN_SERIE),
            },
            "cno4": del_paquete["variaciones"],
        },
        "mensual": {"meses": series["meses_mensuales"], "cno4": del_paquete["mensuales"]},
    }
