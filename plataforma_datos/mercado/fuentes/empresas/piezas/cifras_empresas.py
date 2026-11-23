"""Cifras de la encuesta TIC en empresas del INE (ETICCE) y de Eurostat, y el conjunto de empresas que se exporta.

Lee las tablas de Tempus (INE, Encuesta sobre el uso de TIC y del comercio electrónico en las empresas) y las de
Eurostat `isoc_eb_ain2` (España) e `isoc_r_eb_ain2` (Cataluña): la pregunta sobre el uso de la IA por agrupación de
actividad. Con ellas calcula las divisiones de la CNAE-09 que cubre cada agrupación, la tabla de paso entre el INE,
Eurostat y Cataluña, y la cobertura de cada grupo de ocupación. Lo usan `mercado/fuentes/empresas/lector.py` (descarga,
prepara y valida) y `controles_empresas.py`. Python estándar.
"""

import math
import re
from typing import Any, NamedTuple

import plataforma_datos.mercado.fuentes.empresas.piezas.contrato_eticce as contrato_eticce
import plataforma_datos.mercado.fuentes.sectores.lector as sectores
from plataforma_datos.comun import vigencia
from plataforma_datos.comun.entrada_salida import leer_json, leer_jsonl
from plataforma_datos.comun.estadisticas import (
    CITA_INE,
    Celda,
    celdas_jsonstat,
    etiquetas_jsonstat,
)
from plataforma_datos.comun.nucleo import exigir
from plataforma_datos.comun.textos_y_cifras import pct
from plataforma_datos.mercado.fuentes.empresas.piezas import calendario_ine
from plataforma_datos.mercado.fuentes.empresas.piezas.constantes_empresas import (
    AGRUPACION_ACTIVIDAD,
    CATALUNA,
    CLASIFICACION_EUROSTAT,
    ERROR_ENCUESTA,
    ESTRATOS_TEMPUS,
    ETIQUETAS_EUROSTAT,
    EUROSTAT_CATALUNA_DOI,
    EUROSTAT_DOI,
    GRANDES_SECTORES,
    MARCAS_EUROSTAT,
    MEDIDA_ENCUESTA,
    MEDIDA_REGIONAL,
    NOMBRES_EUROSTAT,
    NOTA_REGIONAL,
    PERIODO_ENCUESTA,
    POBLACION_ENCUESTA,
    POCO_FIABLE,
    PORCENTAJE_MAXIMO,
    PREGUNTA_IA,
    PREGUNTA_TEMPUS,
    SECCIONES,
    TAMANO_EMPRESA,
    TERRITORIO_REGIONAL,
    TERRITORIOS_TEMPUS,
    TOTAL,
    TOTAL_EMPRESAS,
    TOTAL_NACIONAL,
    VARIABLES_PRINCIPALES,
)
from plataforma_datos.mercado.fuentes.empresas.piezas.correspondencia_cnae import agrupaciones_para_cnae09


class Cifra(NamedTuple):
    """Una cifra de una tabla de Tempus sin periodo: el nombre de cada variable y su valor."""

    variables: dict[str, str]
    valor: float | None


def _fila_eurostat(celda: Celda, etiquetas: dict[str, str]) -> dict[str, Any]:
    """Una cifra de Eurostat: el agregado de actividad, su etiqueta, el valor y la marca con que se difunde.

    Returns:
        La fila con el código NACE, su etiqueta, el valor y la marca de difusión.
    """
    codigo = celda.claves["nace_r2"]
    return {"nace": codigo, "etiqueta": etiquetas[codigo], "valor": celda.valor, "marca": celda.estado}


def _extremo(codigo: str, *, final: bool) -> int | None:
    """La división inicial (o final) de un código de Eurostat: «C10» → 10, «C» → 10 (o 33), «S951» → ninguna.

    Args:
        codigo: El código de Eurostat: una sección («C») o una división («C10»).
        final: Si se pide la división final de la sección; si no, la inicial.

    Returns:
        El número de la división, o None si el código no es una sección ni una división.
    """
    if codigo in SECCIONES:
        return SECCIONES[codigo][1 if final else 0]
    # Un grupo de 3 cifras (S951, la reparación de ordenadores) no es una división entera: el agregado no se lee.
    cifras = re.fullmatch(r"[A-U](\d{2})", codigo)
    return int(cifras.group(1)) if cifras else None


def _agrupaciones(filas: list[dict[str, Any]], existentes: set[int]) -> dict[str, dict[str, Any]]:
    """Las agrupaciones del INE (España, todas las empresas de 10 o más) con sus divisiones, su cifra y su error.

    Returns:
        Por rótulo de la agrupación, sus divisiones, su % y su error estándar de referencia.
    """
    del_sector = [fila for fila in filas if fila["parte"] == "sectores" and fila["tamano"] == TOTAL]
    excluidas = excluidas_por_el_ine(next((fila["dimension"] for fila in del_sector if fila["dimension"]), ""))
    errores = {fila["agrupacion"]: fila["valor"] for fila in filas if fila["parte"] == "errores"}
    agrupaciones: dict[str, dict[str, Any]] = {}
    for fila in del_sector:
        divisiones = divisiones_ine(fila["agrupacion"], excluidas, existentes)
        if divisiones:
            agrupaciones[fila["agrupacion"]] = {
                "divisiones": sorted(divisiones),
                "pct": fila["valor"],
                "error_estandar_de_referencia": errores.get(fila["agrupacion"]),
            }
    return agrupaciones


def _vigencias(edicion: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """La vigencia de la parte del INE y, si la hay, la de Eurostat.

    Args:
        edicion: La edición de la encuesta; su clave «eurostat», si existe, trae la actualización de Eurostat.

    Returns:
        El bloque de vigencia «ine» y, si hay datos de Eurostat, el bloque «eurostat».
    """
    eurostat = edicion.get("eurostat")
    anio = str(edicion["anio"])
    fechas = calendario_ine.capturadas(int(anio))
    ine = vigencia.bloque(
        f"{anio}-T1",
        fechas.publicado,
        fechas.siguiente,
        fechas.calendario,
        f"{CITA_INE} (Encuesta sobre el uso de TIC y del comercio electrónico en las empresas, edición "
        f"{edicion['nombre']})",
    )
    partes = {"ine": ine}
    if eurostat:
        partes["eurostat"] = vigencia.bloque(
            str(eurostat.get("anio", edicion["anio"])),
            eurostat["actualizado"],
            None,
            "Eurostat no publica una fecha para la versión siguiente: se actualiza cuando llega la encuesta de cada "
            "país.",
            f"Eurostat, isoc_eb_ain2 ({EUROSTAT_DOI}), versión filtrada a España, consultada el {eurostat['consulta']}",
        )
    return partes


def cataluna_por_seccion(filas: list[dict[str, Any]], actualizacion: dict[str, Any] | None) -> dict[str, Any] | None:
    """Cataluña (Eurostat, ES51): el % de cada sección de actividad por año, con la marca de cada cifra.

    Returns:
        Las cifras por sección y año con su vigencia, sus marcas y su nota; None si no hay datos de Cataluña.
    """
    if not filas or not actualizacion:
        return None
    anios = sorted({fila["anio"] for fila in filas})
    actividades: dict[str, dict[str, Any]] = {}
    for fila in sorted(filas, key=lambda fila: (fila["nace"], fila["anio"])):
        actividad = actividades.setdefault(fila["nace"], {"nombre": NOMBRES_EUROSTAT.get(fila["nace"]), "por_anio": {}})
        actividad["por_anio"][str(fila["anio"])] = cifra_marcada(fila)
    marcas = sorted({fila["marca"] for fila in filas if fila["marca"]})
    return {
        "vigencia": vigencia.bloque(
            str(anios[-1]),
            actualizacion["actualizado"],
            None,
            "Eurostat no publica una fecha para la versión siguiente: se actualiza cuando llega la encuesta de cada "
            "país.",
            f"Eurostat, isoc_r_eb_ain2 ({EUROSTAT_CATALUNA_DOI}), versión filtrada a Cataluña (ES51), consultada el "
            f"{actualizacion['consulta']}",
        ),
        "territorio": TERRITORIO_REGIONAL,
        "medida": MEDIDA_REGIONAL,
        "anios": anios,
        "marcas": {marca: MARCAS_EUROSTAT.get(marca, marca) for marca in marcas},
        "nota": NOTA_REGIONAL,
        "actividades": actividades,
    }


def cifras_tempus(series: list[dict[str, Any]]) -> list[Cifra]:
    """Las cifras de una tabla de Tempus de una sola edición (sin año en cada dato): una por serie.

    Returns:
        Una cifra por serie, con el nombre de cada variable y su valor.
    """
    exigir(isinstance(series, list), "Tempus: se esperaba una lista de series")
    cifras: list[Cifra] = []
    for serie in series:
        exigir(
            isinstance(serie, dict)
            and isinstance(serie.get("MetaData"), list)
            and isinstance(serie.get("Data"), list)
            and len(serie["Data"]) == 1,
            "Tempus: se esperaba una serie con metadatos y un solo dato",
        )
        metadatos = serie["MetaData"]
        exigir(
            all(
                isinstance(metadato, dict)
                and all(
                    isinstance(metadato.get(campo), str) and bool(metadato[campo])
                    for campo in ("T3_Variable", "Nombre")
                )
                for metadato in metadatos
            ),
            "Tempus: variables y categorías deben ser cadenas no vacías",
        )
        variables = {metadato["T3_Variable"]: metadato["Nombre"] for metadato in serie["MetaData"]}
        exigir(len(variables) == len(metadatos), "Tempus: variable duplicada en la definición de una serie")
        exigir(isinstance(serie["Data"][0], dict) and "Valor" in serie["Data"][0], "Tempus: dato sin Valor")
        cifras.append(Cifra(variables, serie["Data"][0]["Valor"]))
    return cifras


def variable_que_empieza(cifra: Cifra, prefijo: str) -> str | None:
    """El nombre de la variable de una cifra cuyo título empieza por `prefijo` («Agrupación de actividad…»).

    Returns:
        El nombre de la variable, o None si ninguna empieza así.
    """
    return next((nombre for nombre in cifra.variables if nombre.startswith(prefijo)), None)


def es_la_pregunta_ia(nombre: str) -> bool:
    """Si una variable es la pregunta E.1: empresas que usan alguna tecnología de IA (no una tecnología concreta).

    Returns:
        True si la variable es la pregunta E.1.
    """
    return bool(PREGUNTA_IA.search(nombre))


def filas_ine(parte: str, cifras: list[Cifra]) -> list[dict[str, Any]]:
    """Las cifras de la pregunta E.1 (o, en la tabla de errores, todas) de una parte, como filas planas.

    Returns:
        Una fila plana por cifra, con su parte, pregunta, agrupación, tamaño, territorio y valor.
    """
    filas: list[dict[str, Any]] = []
    for cifra in cifras:
        pregunta = cifra.variables.get(VARIABLES_PRINCIPALES) or cifra.variables.get(PREGUNTA_TEMPUS, "")
        if parte != "errores" and not es_la_pregunta_ia(pregunta):
            continue
        agrupacion = variable_que_empieza(cifra, AGRUPACION_ACTIVIDAD) or variable_que_empieza(cifra, ESTRATOS_TEMPUS)
        filas.append(
            {
                "parte": parte,
                "pregunta": pregunta,
                "dimension": agrupacion,
                "agrupacion": cifra.variables.get(agrupacion, TOTAL) if agrupacion else TOTAL,
                "tamano": cifra.variables.get(TAMANO_EMPRESA, TOTAL),
                "territorio": cifra.variables.get(TERRITORIOS_TEMPUS, TOTAL_NACIONAL),
                "valor": cifra.valor,
            }
        )
    return filas


def _celdas_eurostat(tabla: dict[str, Any], territorio: str, anios: set[int] | None) -> list[Celda]:
    """Comprueba la medida antes de descartar sus dimensiones al preparar las filas.

    Returns:
        Las celdas del filtro conocido; otra definición requiere revisar el contrato de la fuente.
    """
    dimensiones = {"freq", "size_emp", "nace_r2", "indic_is", "unit", "geo", "time"}
    identificadores = tabla.get("id")
    exigir(
        isinstance(identificadores, list)
        and all(isinstance(identificador, str) for identificador in identificadores)
        and set(identificadores) == dimensiones
        and len(identificadores) == len(dimensiones),
        "empresas: dimensiones de Eurostat distintas del contrato",
    )
    celdas = celdas_jsonstat(tabla)
    exigir(
        tabla["dimension"]["nace_r2"].get("label") == CLASIFICACION_EUROSTAT,
        "empresas: Eurostat cambia la clasificación NACE Rev. 2",
    )
    for dimension, (codigo, etiqueta) in ETIQUETAS_EUROSTAT.items():
        exigir(
            etiquetas_jsonstat(tabla, dimension) == {codigo: etiqueta},
            f"empresas: Eurostat cambia la definición de {dimension}",
        )
    for dimension, codigo in (("freq", "A"), ("geo", territorio)):
        exigir(
            set(etiquetas_jsonstat(tabla, dimension)) == {codigo},
            f"empresas: Eurostat no respeta el filtro {dimension}={codigo}",
        )
    tiempos = set(etiquetas_jsonstat(tabla, "time"))
    exigir(
        bool(tiempos) and all(re.fullmatch(r"[0-9]{4}", anio) for anio in tiempos),
        "empresas: Eurostat no publica años válidos",
    )
    if anios is not None:
        exigir(tiempos == {str(anio) for anio in anios}, "empresas: Eurostat no trae los años solicitados")
    return celdas


def filas_eurostat(tabla: dict[str, Any], anio: int | None = None) -> list[dict[str, Any]]:
    """Las cifras de Eurostat por agregado de actividad, con su etiqueta y su marca de fiabilidad.

    Returns:
        Una fila por cifra, con su agregado, su etiqueta, su valor y su marca.
    """
    celdas = _celdas_eurostat(tabla, "ES", {anio} if anio is not None else None)
    etiquetas = etiquetas_jsonstat(tabla, "nace_r2")
    exigir(len(etiquetas_jsonstat(tabla, "time")) == 1, "empresas: Eurostat nacional debe traer un solo año")
    return [_fila_eurostat(celda, etiquetas) for celda in celdas]


def filas_eurostat_cataluna(tabla: dict[str, Any], anios: set[int] | None = None) -> list[dict[str, Any]]:
    """Las cifras de Cataluña por año y agregado de actividad, con su marca.

    Returns:
        Una fila por cifra, con su año, su agregado, su etiqueta, su valor y su marca.
    """
    celdas = _celdas_eurostat(tabla, "ES51", anios)
    etiquetas = etiquetas_jsonstat(tabla, "nace_r2")
    return [{"anio": int(celda.claves["time"]), **_fila_eurostat(celda, etiquetas)} for celda in celdas]


def divisiones_eurostat(codigo: str, existentes: set[int]) -> frozenset[int]:
    """Las divisiones de la CNAE-09 que cubre un agregado de Eurostat («C22_C23», «N77-N82_X_N79», «L_M»…).

    Se llama a sí misma con lo que sigue a «_X_», que es más corto que `codigo`: la longitud del código acota la
    recursión, y los códigos de Eurostat tienen como mucho un «_X_».

    Returns:
        Las divisiones que cubre, entre las existentes; vacío si alguna parte del código no se puede leer.
    """
    incluido, _, excluido = codigo.partition("_X_")
    divisiones: set[int] = set()
    for parte in incluido.split("_"):
        inicio, _, fin = parte.partition("-")
        desde, hasta = _extremo(inicio, final=False), _extremo(fin or inicio, final=True)
        if desde is None or hasta is None:
            return frozenset()
        divisiones |= {division for division in existentes if desde <= division <= hasta}
    if excluido:
        divisiones -= divisiones_eurostat(excluido, existentes)
    return frozenset(divisiones)


def excluidas_por_el_ine(dimension: str) -> set[int]:
    """Las divisiones que el INE deja fuera de sus agrupaciones, leídas del nombre de la dimensión.

    «Agrupación de actividad (excepto CNAE 56, 64-66 y 95.1)» → {56, 64, 65, 66}: el grupo 95.1 no es una división.

    Returns:
        Los números de las divisiones excluidas; vacío si el nombre no dice ninguna.
    """
    coincidencia = re.search(r"excepto CNAE ([^)]*)", dimension)
    if coincidencia is None:
        return set()
    excluidas: set[int] = set()
    for desde, hasta in re.findall(r"\b(\d{2})(?:-(\d{2}))?\b(?!\.)", coincidencia.group(1)):
        excluidas |= set(range(int(desde), int(hasta or desde) + 1))
    return excluidas


def divisiones_ine(agrupacion: str, excluidas: set[int], existentes: set[int]) -> frozenset[int]:
    """Las divisiones de una agrupación del INE por su rótulo («… (CNAE 45-47)»), sin las que el INE excluye.

    Returns:
        Las divisiones de la agrupación, entre las existentes y sin las excluidas; vacío si el rótulo no da CNAE.
    """
    coincidencia = re.search(r"CNAE\s*(\d{2})(?:\s*-\s*(\d{2}))?", agrupacion)
    if not coincidencia:
        return frozenset()
    desde, hasta = int(coincidencia.group(1)), int(coincidencia.group(2) or coincidencia.group(1))
    return frozenset(division for division in existentes if desde <= division <= hasta and division not in excluidas)


def agregados_eurostat(filas: list[dict[str, Any]], existentes: set[int]) -> dict[str, dict[str, Any]]:
    """Los agregados de Eurostat con cifra fiable y sus divisiones (sin los que no se pueden leer, como «ICT»).

    Returns:
        Por código del agregado, sus divisiones y su %.
    """
    agregados: dict[str, dict[str, Any]] = {}
    for fila in filas:
        divisiones = divisiones_eurostat(fila["nace"], existentes)
        cifra = cifra_marcada(fila)
        if divisiones and cifra["pct"] is not None:
            agregados[fila["nace"]] = {"divisiones": sorted(divisiones), "pct": fila["valor"]}
    return agregados


def mas_detallado(division: int, agregados: dict[str, dict[str, Any]]) -> str | None:
    """El agregado con menos divisiones que contiene una división (a igualdad, el de código más corto).

    Returns:
        El código del agregado, o None si ninguno contiene la división.
    """
    candidatos = [
        (len(datos["divisiones"]), len(codigo), codigo)
        for codigo, datos in agregados.items()
        if division in datos["divisiones"]
    ]
    return min(candidatos)[2] if candidatos else None


def tabla_de_paso(
    agrupaciones: dict[str, dict[str, Any]],
    eurostat: dict[str, dict[str, Any]],
    cataluna: dict[str, dict[str, Any]],
    existentes: set[int],
) -> dict[str, dict[str, str | None]]:
    """Cada división de la CNAE-09 que mide la encuesta, con su agrupación del INE, de Eurostat y de Cataluña.

    Returns:
        Por división (dos cifras), su agrupación del INE, su agregado de Eurostat y su gran sector de Cataluña.
    """
    paso: dict[str, dict[str, str | None]] = {}
    for division in sorted(existentes):
        ine, europa = mas_detallado(division, agrupaciones), mas_detallado(division, eurostat)
        if ine or europa:
            sector = next((nombre for nombre, datos in cataluna.items() if division in datos["divisiones"]), None)
            paso[f"{division:02d}"] = {"ine": ine, "eurostat": europa, "cataluna": sector}
    return paso


def cifras_de_cataluna(
    filas: list[dict[str, Any]], agrupaciones: dict[str, dict[str, Any]]
) -> dict[str, dict[str, Any]]:
    """Cataluña: el total y los tres grandes sectores, con las divisiones de su agrupación «Total …» del INE.

    Returns:
        El % del total y, por gran sector, su % y sus divisiones.
    """
    del_territorio = {
        fila["agrupacion"]: fila["valor"]
        for fila in filas
        if fila["parte"] == "comunidades" and fila["territorio"] == CATALUNA
    }
    grandes: dict[str, dict[str, Any]] = {}
    for sector in GRANDES_SECTORES:
        espanol = next((nombre for nombre in agrupaciones if f"Total {sector}" in nombre), None)
        grandes[sector] = {
            "pct": del_territorio.get(sector),
            "divisiones": agrupaciones[espanol]["divisiones"] if espanol else [],
        }
    return {"total": del_territorio.get(TOTAL_EMPRESAS), "sectores": grandes}


CoberturaPorTerritorio = dict[str, dict[str, dict[str, float]]]
"""Territorio → nivel de la CNO-11 («cno3», «cno2») → grupo → % de personas en divisiones que mide la encuesta."""


def cobertura_de_los_grupos(paso: dict[str, dict[str, Any]]) -> CoberturaPorTerritorio:
    """Por territorio y grupo de ocupación, el % de personas que trabaja en divisiones que mide la encuesta.

    Returns:
        Por territorio y nivel de la CNO-11, el % de cada grupo con base suficiente.
    """
    cubiertas = set(paso)
    por_territorio: CoberturaPorTerritorio = {}
    for fila in leer_jsonl(sectores.GRUPOS):
        if fila["cno11"] == sectores.NO_CONSTA:
            continue
        if fila["personas"] >= sectores.MIN_PERSONAS_GRUPO:
            dentro = sum(personas for actividad, personas in fila["actividades"].items() if actividad in cubiertas)
            porcentaje = pct(dentro, fila["personas"])
            exigir(porcentaje is not None, f"{fila['cno11']}: un grupo con base suficiente no puede tener 0 personas")
            territorio = por_territorio.setdefault(fila["territorio"], {}).setdefault(f"cno{fila['nivel']}", {})
            territorio[fila["cno11"]] = porcentaje
    return por_territorio


def cifra_marcada(fila: dict[str, Any]) -> dict[str, Any]:
    """Una cifra con su marca: la poco fiable va aparte, nunca como firme; la confidencial o vacía no tiene cifra.

    Returns:
        El % firme (o None) y, si es poco fiable, «pct_poco_fiable», con su marca si la tiene.
    """
    estado, valor = fila["marca"], fila["valor"]
    exigir(
        estado is None or isinstance(estado, str) and all(letra in MARCAS_EUROSTAT for letra in estado),
        f"Eurostat: marca desconocida {estado!r}",
    )
    letras = set(estado or "")
    exigir("c" not in letras or valor is None, "Eurostat: una cifra confidencial no puede tener valor publicado")
    exigir("z" not in letras or valor is None, "Eurostat: una cifra no aplicable no puede tener valor publicado")
    exigir(
        valor is None
        or isinstance(valor, (int, float))
        and not isinstance(valor, bool)
        and math.isfinite(valor)
        and 0 <= valor <= PORCENTAJE_MAXIMO,
        "Eurostat: el porcentaje debe ser una cifra finita entre 0 y 100",
    )
    marca = {"marca": estado} if estado else {}
    if valor is not None and letras & {POCO_FIABLE, "n"}:
        return {"pct": None, "pct_poco_fiable": fila["valor"], **marca}
    return {"pct": fila["valor"], **marca}


def conjunto(
    filas_del_ine: list[dict[str, Any]],
    filas_de_eurostat: list[dict[str, Any]],
    filas_de_cataluna: list[dict[str, Any]],
    edicion: dict[str, Any],
    existentes: set[int],
) -> dict[str, Any]:
    """Versión para el motor: las cifras de la encuesta, la tabla de paso y la cobertura de cada grupo.

    Returns:
        El conjunto que exporta el paquete (empresas.json).
    """
    revisado = contrato_eticce.es_contrato_2026(edicion)
    agrupaciones = (
        {
            nombre: datos
            for nombre, datos in agrupaciones_para_cnae09(filas_del_ine, existentes).items()
            if nombre != TOTAL_EMPRESAS and not nombre.startswith("4.")
        }
        if revisado
        else _agrupaciones(filas_del_ine, existentes)
    )
    europa = agregados_eurostat(filas_de_eurostat, existentes)
    cataluna = cifras_de_cataluna(filas_del_ine, agrupaciones)
    paso = tabla_de_paso(agrupaciones, europa, cataluna["sectores"], existentes)
    total = {
        fila["tamano"]: fila["valor"]
        for fila in filas_del_ine
        if fila["parte"] == "sectores" and fila["agrupacion"] == TOTAL_EMPRESAS
    }
    micro = [fila["valor"] for fila in filas_del_ine if fila["parte"] == "menos_de_10"]
    vigencias = _vigencias(edicion)
    return {
        "vigencia": vigencias["ine"],
        "fuentes": {parte: datos["fuente"] for parte, datos in vigencias.items()},
        "encuesta": {
            "edicion": edicion["nombre"],
            "medida": (
                "% de empresas con Internet que usan al menos una tecnología de inteligencia artificial (D.1)"
                if revisado
                else MEDIDA_ENCUESTA
            ),
            "poblacion": (
                "empresas de 10 o más personas con conexión a Internet; ámbito CNAE-2025 de la ETICCE"
                if revisado
                else POBLACION_ENCUESTA
            ),
            "periodo": PERIODO_ENCUESTA,
            "error": (
                "El error estándar publicado corresponde a D.1.A, análisis del lenguaje escrito, sobre empresas "
                "usuarias de IA. No es un error ni una cota del indicador D.1 y no se utiliza para su intervalo."
                if revisado
                else ERROR_ENCUESTA
            ),
            **({"divisiones_del_paso_cnae2009": sorted(paso)} if revisado else {"divisiones_que_mide": sorted(paso)}),
            **(
                {
                    "clasificacion": "CNAE-2025",
                    "ambito_ine_cnae2025": contrato_eticce.contrato()["ambito"],
                    "clasificacion_del_paso": "CNAE-2009",
                    "denominador": contrato_eticce.contrato()["denominador"],
                    "ruptura": contrato_eticce.contrato()["ruptura"],
                    "correspondencia": "Solo inclusión completa de contenidos; sin equivalencia estadística.",
                }
                if revisado
                else {}
            ),
        },
        "espana": {
            "total": total.get(TOTAL),
            "por_tamano": {tamano: cifra for tamano, cifra in total.items() if tamano != TOTAL},
            "menos_de_10_personas": micro[0] if micro else None,
        },
        "cataluna": {
            "total": cataluna["total"],
            "sectores": {nombre: datos["pct"] for nombre, datos in cataluna["sectores"].items()},
        },
        "agrupaciones_ine": agrupaciones,
        "eurostat": {
            "vigencia": vigencias.get("eurostat"),
            "agregados": {
                codigo: {"nombre": NOMBRES_EUROSTAT.get(codigo), "pct": europa[codigo]["pct"]}
                for codigo in sorted({datos["eurostat"] for datos in paso.values() if datos["eurostat"]})
            },
        },
        "paso": paso,
        "cobertura_de_los_grupos": cobertura_de_los_grupos(paso),
        "cataluna_por_seccion": cataluna_por_seccion(filas_de_cataluna, edicion.get("eurostat_cataluna")),
    }


def divisiones_existentes() -> set[int]:
    """Las divisiones de la CNAE-09 que publica el Censo 2021 (`mercado/fuentes/sectores/lector.py`), como números.

    Returns:
        Los números de las divisiones.
    """
    return {int(codigo) for codigo in leer_json(sectores.RESUMEN)["actividades"] if codigo.isdigit()}
