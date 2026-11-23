"""Cifras de mercado laboral para el informe breve de cualquier ocupación: empleo, salarios, contratación y comarcas.

Lee los conjuntos validados de sus productores y solo calcula medias, sumas, variaciones y reconstrucciones hacia atrás
sin redondeos intermedios:

- EPA (conjunto validado `epa`, INE, tabla 65314): personas ocupadas en Cataluña por gran grupo de la CNO-11, media de
  los cuatro últimos trimestres frente a la de los mismos cuatro un año antes.
- EAES (conjunto validado `eaes`, INE, tabla 28186): ganancia media anual por trabajador en España por grupo de
  ocupación A a Q y sexo, con los subgrupos principales de la CNO-11 de dos cifras («cno2») de cada grupo, que salen
  de la jerarquía de la variable OCUPACIONES (456) de la API Tempus del INE.
- Observatori del Treball: variación anual de personas contratadas (C_P2_MES_IND), contratos por periodos de 12 meses
  reconstruidos al mes del corte con la variación interanual de la media móvil de 12 meses (C_P5_EVOL_2) y contratos por
  comarca (C_P8_IND_COMARQUES).
- Ofertas del SOC y Feina Activa (conjunto validado `ofertas`, Observatori del Treball, Excel mensual): puestos
  ofertados en el acumulado del año por ocupación de 4 cifras (solo las 50 más ofertadas), por subgrupo de 2 cifras y
  por gran grupo, frente al mismo periodo del año anterior leído de su propio Excel.

La cita de cada uno es la que su productor genera desde el último periodo que ha leído.
"""

import re
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path
from typing import Any

from plataforma_datos.comun.entrada_salida import leer_json, ruta_del_conjunto, ultimo_original
from plataforma_datos.comun.nucleo import exigir
from plataforma_datos.mercado.fuentes.ofertas.piezas.libro_de_ofertas import MESES
from plataforma_datos.orquestacion.admision import leer_validado
from plataforma_datos.orquestacion.exportacion.comun import Paquete

MIN_COMARCAS = 100
ANIOS_DE_LA_SERIE = 6
TRIMESTRES_DEL_ANIO = 4


def _redondear(valor: float, paso: int = 1) -> int:
    """Redondea a la mitad hacia arriba (no al par), en múltiplos de `paso`.

    Returns:
        El entero redondeado.
    """
    unidades = (Decimal(repr(valor)) / paso).quantize(Decimal(1), rounding=ROUND_HALF_UP)
    return int(unidades) * paso


def _items(ruta: Path) -> list[dict[str, Any]]:
    contenido = leer_json(ruta)
    exigir(isinstance(contenido, dict) and isinstance(contenido.get("items"), list), f"{ruta.name}: sin «items»")
    return contenido["items"]


def _trimestre(texto: str) -> tuple[int, int]:
    anio, numero = texto.split("T")
    return int(anio), int(numero)


def _media(valores: dict[tuple[int, int], float | None], cuales: list[tuple[int, int]]) -> float | None:
    cifras = [valores.get(periodo) for periodo in cuales]
    return None if any(cifra is None for cifra in cifras) else sum(cifras) / len(cifras)


def _empleo(epa: dict[str, Any]) -> dict[str, Any]:
    """Media de los cuatro últimos trimestres y de los cuatro de un año antes, por gran grupo, en Cataluña.

    Returns:
        El bloque «empleo».
    """
    grupos = {
        clave: {_trimestre(periodo): cifra for periodo, cifra in grupo["miles"].items()}
        for clave, grupo in epa["grupos"].items()
    }
    actuales = sorted(grupos["total"])[-TRIMESTRES_DEL_ANIO:]
    anteriores = [(anio - 1, trimestre) for anio, trimestre in actuales]
    exigir(all(periodo in grupos["total"] for periodo in anteriores), "EPA: faltan los trimestres de un año antes")
    salida = {}
    for clave in sorted(grupos, key=lambda c: (c == "total", c)):
        actual, anterior = _media(grupos[clave], actuales), _media(grupos[clave], anteriores)
        salida[clave] = {
            "nombre": epa["grupos"][clave]["nombre"],
            "personas": None if actual is None else _redondear(actual * 1000, 100),
            "anterior": None if anterior is None else _redondear(anterior * 1000, 100),
            "variacion_pct": None
            if actual is None or anterior is None
            else float((Decimal(repr((actual / anterior - 1) * 100))).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)),
        }
    return {
        "trimestres": [f"{anio}T{trimestre}" for anio, trimestre in actuales],
        "anteriores": [f"{anio}T{trimestre}" for anio, trimestre in anteriores],
        "grandes_grupos": salida,
    }


def _salario_del_grupo(grupo: dict[str, Any], anio: int, anio_anterior: int) -> dict[str, Any]:
    """Las cifras de un grupo en euros enteros; el sexo con signo «-» en el dato se anota en «gran_variabilidad».

    Returns:
        La entrada del grupo, con sus campos en el orden publicado.
    """
    entrada: dict[str, Any] = {"nombre": grupo["nombre"], "gran_variabilidad": []}
    if "cno2" in grupo:
        entrada["cno2"] = grupo["cno2"]
    for campo, por_anio in grupo["sexos"].items():
        for clave, cual in ((campo, anio), ("anterior" if campo == "total" else None, anio_anterior)):
            if clave is None:
                continue
            valor = por_anio.get(str(cual))
            if valor is not None and valor < 0:
                entrada["gran_variabilidad"].append(clave)
            entrada[clave] = None if valor is None else _redondear(abs(valor))
    if not entrada["gran_variabilidad"]:
        del entrada["gran_variabilidad"]
    orden = ("nombre", "cno2", "total", "anterior", "mujeres", "hombres", "gran_variabilidad")
    return {campo: entrada[campo] for campo in orden if campo in entrada}


def _salarios(eaes: dict[str, Any]) -> dict[str, Any]:
    """Ganancia media anual del último año y el anterior, por grupo A a Q y sexo, en euros enteros.

    Según las notas del INE, un signo «-» delante del dato indica entre 100 y 500 observaciones (gran variabilidad):
    se publica su valor absoluto y el sexo se anota en «gran_variabilidad»; un nulo, menos de 100 observaciones.

    Returns:
        El bloque «salarios».
    """
    anio, anio_anterior = eaes["anios"][-1], eaes["anios"][-2]
    grupos = {letra: _salario_del_grupo(grupo, anio, anio_anterior) for letra, grupo in sorted(eaes["grupos"].items())}
    todas = grupos.pop("")
    del todas["nombre"]
    return {"anio": anio, "anio_anterior": anio_anterior, "grupos": grupos, "todas": todas}


def _anual(
    evolucion: list[dict[str, Any]], contratos: dict[str, int | None], fin: int, mes: int, minimo: int
) -> dict[str, Any]:
    """Contratos de cada periodo de 12 meses al corte, hacia atrás sin redondeos intermedios.

    La variación interanual de la media móvil de 12 meses equivale a la de los contratos de esos mismos 12 meses;
    el original la da como fracción (0,0358 es un 3,58 %). Cada paso usa el mismo mes en el año anterior.

    Returns:
        El bloque «anual».
    """
    cortes = [(fin - atras) * 100 + mes for atras in range(ANIOS_DE_LA_SERIE - 1)]
    variaciones: dict[str, dict[int, float]] = {}
    for item in evolucion:
        if item["c_mes"] in cortes and item["eo_var_cont_mm_12m"] is not None:
            variaciones.setdefault(item["c_grup_primari"], {})[item["c_mes"]] = item["eo_var_cont_mm_12m"]
    series = {}
    for cno4, valor in sorted(contratos.items()):
        variacion = variaciones.get(cno4, {})
        if valor is None or valor < minimo or any(corte not in variacion for corte in cortes):
            continue
        valores = [float(valor)]
        for corte in cortes:
            valores.append(valores[-1] / (1 + variacion[corte]))
        series[cno4] = [_redondear(cifra) for cifra in reversed(valores)]
    inicios = range(fin - ANIOS_DE_LA_SERIE, fin)
    return {
        "etiquetas": [
            str(inicio + 1) if mes == len(MESES) else f"{inicio}-{(inicio + 1) % 100:02d}" for inicio in inicios
        ],
        "publicado": [inicio == fin - 1 for inicio in inicios],
        "cno4": series,
    }


def _demandantes(filas: list[dict[str, Any]], periodo: str) -> dict[str, Any]:
    """Personas que buscan cada empleo sin tenerlo en 12 meses, su variación anual y las contratadas por cada una.

    Salen de C_P2_MES_IND, sin redondear: personas demandantes no ocupadas en 12 meses (eo_per_dno_12m_comanual), su
    variación anual en fracción (eo_per_dno_var_anual) y la ratio de personas contratadas por persona demandante
    (eo_rat_per_cont_dno), la que el informe da como «de cada 10».

    Returns:
        El bloque «demandantes».
    """
    cno4 = {}
    for fila in sorted(filas, key=lambda f: f["c_grup_primari"]):
        if fila.get("eo_per_dno_12m_comanual") is None:
            continue
        cno4[fila["c_grup_primari"]] = {
            "personas_12m": fila["eo_per_dno_12m_comanual"],
            "variacion_exacta": fila.get("eo_per_dno_var_anual"),
            "ratio": fila.get("eo_rat_per_cont_dno"),
        }
    exigir(bool(cno4), "Observatori: C_P2_MES_IND no trae demandantes")
    return {
        "periodo": periodo,
        "medida": "personas demandantes no ocupadas en 12 meses, su variación anual en fracción y la ratio de personas "
        "contratadas por persona demandante",
        "cno4": cno4,
    }


def _comarcas(items: list[dict[str, Any]], periodo: str) -> dict[str, Any]:
    """Contratos por comarca de cada CNO-4: total, comarcas con contratos y la lista completa, de más a menos.

    Returns:
        El bloque «comarcas».
    """
    por_cno4: dict[str, list[tuple[str, int]]] = {}
    for item in items:
        por_cno4.setdefault(item["c_grup_primari"], []).append((item["d_comarca"], item["eo_cont_sum_12m"] or 0))
    salida = {}
    for cno4, filas in sorted(por_cno4.items()):
        total = sum(contratos for _, contratos in filas)
        if total < MIN_COMARCAS:
            continue
        con = sorted(((nombre, contratos) for nombre, contratos in filas if contratos > 0), key=lambda f: (-f[1], f[0]))
        salida[cno4] = {"total": total, "con_contratos": len(con), "todas": [list(fila) for fila in con]}
    return {"periodo": periodo, "cno4": salida}


def _ofertas(ofertas: dict[str, Any]) -> dict[str, Any]:
    """Puestos ofertados del año en curso frente a los del mismo periodo del año anterior, de su propio Excel.

    Las variaciones interanuales del Excel nuevo no se usan: la nota CCAE-2025 del libro avisa de una ruptura.

    Returns:
        El bloque «ofertas».
    """
    hoy, antes = ofertas["actual"], ofertas["anterior"]

    def grupos(nivel: str) -> dict[str, dict[str, int | None]]:
        return {
            codigo: {"puestos": puestos, "anterior": antes[nivel].get(codigo)}
            for codigo, puestos in sorted(hoy[nivel].items())
        }

    return {
        "periodo": hoy["periodo"],
        "periodo_anterior": antes["periodo"],
        "total": hoy["total"],
        "total_anterior": antes["total"],
        "cno4": {
            codigo: {"puestos": puestos, "anterior": antes["cno4"].get(codigo, (None,))[0], "puesto": puesto}
            for codigo, (puestos, puesto) in hoy["cno4"].items()
        },
        "cno2": grupos("cno2"),
        "cno1": grupos("cno1"),
    }


def paquete_mercado() -> Paquete:
    """Compone mercado.json con los conjuntos validados de la EPA, la EAES, las ofertas y el Observatori.

    Returns:
        El paquete y los archivos de los que sale, en orden de composición.

    Raises:
        FormatoInesperado: Si un original del Observatori no trae lo que el contrato necesita o los periodos no
            cuadran.
    """
    observatori = leer_validado("observatori")
    periodo = observatori.get("periodo")
    coincide = re.fullmatch(r"12 meses a (\w+) de (\d{4})", periodo or "")
    exigir(coincide is not None and coincide[1] in MESES, f"Observatori: periodo inesperado {periodo!r}")
    mes, fin = MESES.index(coincide[1]) + 1, int(coincide[2])
    corte = f"{fin}-{mes:02d}"
    contratos = {cno4: fila["contratos"] for cno4, fila in observatori["cataluna"]["cno4"].items()}

    epa, eaes, ofertas = leer_validado("epa"), leer_validado("eaes"), leer_validado("ofertas")
    indicadores = ultimo_original("cataluna", rf"observatori-C_P2_MES_IND-{corte}\.json")
    evolucion = ultimo_original("observatori", rf"observatori-C_P5_EVOL_2-{corte}\.json")
    comarcas = ultimo_original("observatori", rf"observatori-C_P8_IND_COMARQUES-{corte}\.json")
    filas_indicadores = _items(indicadores)
    filas_comarcas = _items(comarcas)
    exigir(
        {fila["c_mes"] for fila in (*filas_indicadores, *filas_comarcas)} == {fin * 100 + mes},
        f"Observatori: indicadores y comarcas deben ser de {corte}",
    )
    datos = {
        "fuentes": {
            "epa": epa["cita"],
            "eaes": eaes["cita"],
            "observatori": observatori["fuentes"]["observatori"],
            "ofertas": ofertas["cita"],
        },
        "empleo": _empleo(epa),
        "salarios": _salarios(eaes),
        "contratacion": {
            "periodo": periodo,
            "cno4": {
                fila["c_grup_primari"]: {"variacion_exacta": fila["eo_per_cont_var_anual"]}
                for fila in sorted(filas_indicadores, key=lambda f: f["c_grup_primari"])
            },
        },
        "anual": _anual(_items(evolucion), contratos, fin, mes, observatori["min_serie"]),
        "comarcas": _comarcas(filas_comarcas, periodo),
        "demandantes": _demandantes(filas_indicadores, periodo),
        "ofertas": _ofertas(ofertas),
    }
    origenes = [
        ruta_del_conjunto("epa"),
        ruta_del_conjunto("eaes"),
        ruta_del_conjunto("observatori"),
        indicadores,
        evolucion,
        comarcas,
        ruta_del_conjunto("ofertas"),
    ]
    return Paquete(datos, origenes)
