"""Clasificaciones oficiales de ocupaciones: CNO-11, su correspondencia con ISCO-08 y los títulos ISCO-08 en español.

CNO-11 y su correspondencia con ISCO-08 son del INE; los títulos oficiales en español de ISCO-08, de la OIT.
Descarga, prepara y valida. Python estándar. Depende de la validación de la OIT (grupos ISCO-08 en inglés).

Uso: python3 -m plataforma_datos.ocupaciones.fuentes.clasificaciones.lector
     {descargar,preparar,validar,todo} [--aceptar-cambio]
"""

import sys
from collections import Counter, defaultdict
from collections.abc import Iterable
from typing import Any

from plataforma_datos.comun.entrada_salida import (
    ahora_utc,
    carpetas,
    comprobar_originales,
    controles_de_huella,
    guardar_json,
    guardar_jsonl,
    leer_json,
    leer_jsonl,
)
from plataforma_datos.comun.estadisticas import RESUMEN_LICENCIA_INE
from plataforma_datos.comun.hojas import leer_xls
from plataforma_datos.comun.nucleo import ARCHIVO_DE_PROCEDENCIA, Controles, exigir
from plataforma_datos.comun.red import descargar_originales
from plataforma_datos.comun.textos_y_cifras import codigo, texto
from plataforma_datos.ocupaciones.fuentes.oit.piezas.constantes_oit import (
    GRUPOS_PRIMARIOS_ISCO08,
    LICENCIA_CLASIFICACION_OIT,
)
from plataforma_datos.orquestacion.admision import cerrar_validacion, leer_validado
from plataforma_datos.orquestacion.ordenes import principal_fuente_con_descarga

# Claves normalizadas compartidas por las cifras CNO-11 y, para la ausencia, CNAE-09.
# Los rótulos originales («TOTAL», «_U», «No consta»…) siguen siendo propios de cada proveedor.
TOTAL_OCUPACIONES = "total"
CODIGO_NO_CONSTA = "no_consta"

FUENTE = "clasificaciones"
ORIGINAL, PREPARADO, _ = carpetas(FUENTE)
PROCEDENCIA = ORIGINAL / ARCHIVO_DE_PROCEDENCIA
# Lo que escribe preparar y lee validar.
CNO_PREPARADA = PREPARADO / "cno11.jsonl"
ISCO_PREPARADA = PREPARADO / "isco08-es.jsonl"
CORRESPONDENCIA_PREPARADA = PREPARADO / "correspondencia-isco08-cno11.jsonl"
NOMBRE_FUENTE = "INE y OIT · clasificaciones de ocupaciones"
CITA = (
    "Fuente: INE, Clasificación Nacional de Ocupaciones 2011 y su correspondencia con la CIUO-08 (www.ine.es); "
    "OIT, CIUO-08."
)
LICENCIA = (
    f"CNO-11 y su correspondencia con la CIUO-08: {RESUMEN_LICENCIA_INE} "
    f"CIUO-08 en español: {LICENCIA_CLASIFICACION_OIT}"
)
CNO = "cno11-estructura.xls"
CORRESPONDENCIA = "correspondencia-cno11-ciuo08.xls"
CIUO_ES = "ciuo08-estructura-es.xls"
ARCHIVOS = [
    {
        "archivo": CNO,
        "nivel": "oficial",
        "titulo": "INE · CNO-11: estructura oficial de 1 a 4 dígitos y grupos principales",
        "url": "https://www.ine.es/daco/daco42/clasificaciones/cno11_estructura.xls",
        "norma": "Real Decreto 1591/2010 (BOE 17-12-2010)",
        "licencia": RESUMEN_LICENCIA_INE,
    },
    {
        "archivo": CORRESPONDENCIA,
        "nivel": "oficial",
        "titulo": "INE · Correspondencia oficial CNO-11 / CIUO-08 (ISCO-08) a 4 dígitos",
        "url": "https://www.ine.es/daco/daco42/clasificaciones/corr_cno11_ciuo08.xls",
        "norma": "Real Decreto 1591/2010",
        "licencia": RESUMEN_LICENCIA_INE,
    },
    {
        "archivo": CIUO_ES,
        "nivel": "oficial",
        "titulo": "OIT · CIUO-08 (ISCO-08): estructura oficial en español",
        "url": "https://www.ilo.org/public/spanish/bureau/stat/isco/docs/struct08.xls",
        "norma": "Clasificación Internacional Uniforme de Ocupaciones, 2008",
        "licencia": LICENCIA_CLASIFICACION_OIT,
    },
]
# Real Decreto 1591/2010: 10 grandes grupos, 17 grupos principales (letras), 62 subgrupos principales,
# 170 subgrupos y 502 grupos primarios.
ESPERADO_CNO = {"1": 10, "GP": 17, "2": 62, "3": 170, "4": 502}
CABECERA_CORRESPONDENCIA = ["CNO11", "TITULO11", "FREC11", "CIUO08", "TITULO08", "FREC08"]
FILA_CABECERA_CORRESPONDENCIA = 2
HOJA_CNO = "RD"
HOJA_CORRESPONDENCIA = "Hoja1"
# Columnas de cada fila de la correspondencia (cabecera en CABECERA_CORRESPONDENCIA); la del comentario del INE, que
# va tras ellas, solo la traen las filas que lo tienen.
COLUMNA_CNO11, COLUMNA_FREC11, COLUMNA_CIUO08, COLUMNA_TITULO08, COLUMNA_FREC08 = 0, 2, 3, 4, 5
COLUMNA_COMENTARIO = len(CABECERA_CORRESPONDENCIA)


# ---------------------------------------------------------------------------------------------------------------------
# Piezas internas de preparar
# ---------------------------------------------------------------------------------------------------------------------


def _cno() -> list[dict[str, str]]:
    """Códigos de la CNO-11 con su nivel, su padre y su grupo principal (letra).

    La hoja los lista en orden jerárquico: cada grupo principal (una letra) aparece tras su gran grupo y antes de sus
    subgrupos, así que basta recordar el último gran grupo y el último grupo principal vistos. El padre de un grupo
    principal es su gran grupo, aunque otro grupo principal del mismo gran grupo vaya delante.

    Returns:
        Una fila por código, en el orden de la hoja, con su código, título, nivel, padre y grupo principal.
    """
    codigos: list[dict[str, str]] = []
    grupo_principal = ""
    gran_grupo = ""
    for fila in leer_xls(ORIGINAL / CNO)[HOJA_CNO]:
        codigo_cno, titulo = codigo(fila[0]), texto(fila[1])
        if not codigo_cno:
            continue
        if codigo_cno.isalpha():
            grupo_principal = codigo_cno
            codigos.append(
                {
                    "codigo": codigo_cno,
                    "titulo": titulo,
                    "nivel": "GP",
                    "padre": gran_grupo,
                    "grupo_principal": codigo_cno,
                }
            )
            continue
        nivel = str(len(codigo_cno))
        if nivel == "1":
            gran_grupo = codigo_cno
        codigos.append(
            {
                "codigo": codigo_cno,
                "titulo": titulo,
                "nivel": nivel,
                "padre": codigo_cno[:-1] if len(codigo_cno) > 1 else "",
                "grupo_principal": "" if nivel == "1" else grupo_principal,
            }
        )
    return codigos


def _isco_es() -> list[dict[str, str]]:
    """Códigos de la CIUO-08 con su título oficial en español.

    Returns:
        Una fila por código, con su título en español y su nivel (número de cifras).
    """
    filas = next(iter(leer_xls(ORIGINAL / CIUO_ES).values()))
    return [
        {"codigo": codigo_isco, "titulo_es": texto(fila[1]), "nivel": str(len(codigo_isco))}
        for fila in filas[1:]
        if (codigo_isco := codigo(fila[0]))
    ]


def _pares() -> list[dict[str, str]]:
    """Filas de la tabla de correspondencia del INE (sin las que no tienen código ISCO-08).

    Returns:
        Una fila por par con código ISCO-08, con sus frecuencias, el título ISCO-08 y el comentario del INE.
    """
    filas = leer_xls(ORIGINAL / CORRESPONDENCIA)[HOJA_CORRESPONDENCIA]
    cabecera = [texto(celda) for celda in filas[FILA_CABECERA_CORRESPONDENCIA]]
    exigir(
        cabecera[: len(CABECERA_CORRESPONDENCIA)] == CABECERA_CORRESPONDENCIA,
        f"cabecera inesperada de la correspondencia: {cabecera}",
    )
    pares = []
    for fila in filas[FILA_CABECERA_CORRESPONDENCIA + 1 :]:
        cno, isco = codigo(fila[COLUMNA_CNO11]), codigo(fila[COLUMNA_CIUO08])
        if not isco:
            continue
        pares.append(
            {
                "isco08": isco,
                "cno11": cno,
                "frec11": codigo(fila[COLUMNA_FREC11]),
                "frec08": codigo(fila[COLUMNA_FREC08]),
                "titulo_isco08": texto(fila[COLUMNA_TITULO08]),
                "comentario_ine": texto(fila[COLUMNA_COMENTARIO]) if len(fila) > COLUMNA_COMENTARIO else "",
            }
        )
    return pares


def _agrupar(pares: list[dict[str, str]], clave: str, valor: str) -> dict[str, set[str]]:
    """Por cada código del lado `clave`, los códigos del lado `valor` con los que se corresponde.

    Returns:
        Por código de un lado, el conjunto de códigos del otro.
    """
    grupos: dict[str, set[str]] = defaultdict(set)
    for par in pares:
        if par["cno11"]:
            grupos[par[clave]].add(par[valor])
    return grupos


def _tipo(cnos_del_isco: int, iscos_del_cno: int) -> str:
    """Tipo de correspondencia ISCO-08:CNO-11 según cuántos códigos hay a cada lado.

    «1:n» es un grupo ISCO-08 repartido en varios CNO-11 y «n:1», varios grupos ISCO-08 en un solo CNO-11.

    Args:
        cnos_del_isco: Cuántos CNO-11 tiene el grupo ISCO-08.
        iscos_del_cno: Cuántos grupos ISCO-08 tiene el código CNO-11.

    Returns:
        «1:1», «1:n», «n:1» o «n:m».
    """
    if cnos_del_isco == 1 and iscos_del_cno == 1:
        return "1:1"
    if cnos_del_isco > 1 and iscos_del_cno == 1:
        return "1:n"
    return "n:1" if cnos_del_isco == 1 else "n:m"


def _correspondencia(titulos_cno: dict[str, str]) -> list[dict[str, str]]:
    """Pares ISCO-08 ↔ CNO-11 con su tipo, comprobados contra las frecuencias que publica el propio INE.

    Returns:
        Los pares con su título CNO-11 y su tipo, ordenados por ISCO-08 y CNO-11.
    """
    pares = _pares()
    cnos_por_isco = _agrupar(pares, "isco08", "cno11")
    iscos_por_cno = _agrupar(pares, "cno11", "isco08")
    resultado = []
    for par in pares:
        if not par["cno11"]:
            resultado.append({**par, "titulo_cno11": "", "tipo": "sin_correspondencia"})
            continue
        cnos_del_isco, iscos_del_cno = len(cnos_por_isco[par["isco08"]]), len(iscos_por_cno[par["cno11"]])
        # FREC11 cuenta los ISCO-08 de cada CNO-11 y FREC08, los CNO-11 de cada ISCO-08.
        frecuencias = (str(iscos_del_cno), str(cnos_del_isco))
        exigir(frecuencias == (par["frec11"], par["frec08"]), f"frecuencias del INE incoherentes: {par}")
        tipo = _tipo(cnos_del_isco, iscos_del_cno)
        resultado.append({**par, "titulo_cno11": titulos_cno.get(par["cno11"], ""), "tipo": tipo})
    return sorted(resultado, key=lambda par: (par["isco08"], par["cno11"]))


# ---------------------------------------------------------------------------------------------------------------------
# Piezas internas de validar
# ---------------------------------------------------------------------------------------------------------------------


def _controles(
    cno: list[dict[str, str]],
    isco4: set[str],
    pares: list[dict[str, str]],
    procedencia: dict[str, Any],
    ocupaciones_oit: dict[str, Any],
) -> Controles:
    """Huellas de los originales, CNO-11 completa y cobertura de la correspondencia en los dos sentidos.

    Args:
        cno: La CNO-11 preparada.
        isco4: Los grupos primarios de la CIUO-08 en español.
        pares: La correspondencia preparada.
        procedencia: La procedencia de los originales.
        ocupaciones_oit: Los grupos ISCO-08 de la validación de la OIT, con los que se contrastan.

    Returns:
        Los controles, con su resultado.
    """
    controles = Controles()
    controles_de_huella(controles, ORIGINAL, procedencia)
    controles.comprobar(
        dict(Counter(fila["nivel"] for fila in cno)) == ESPERADO_CNO,
        f"CNO-11 completa: {ESPERADO_CNO['1']}, {ESPERADO_CNO['GP']} grupos principales, {ESPERADO_CNO['2']}, "
        f"{ESPERADO_CNO['3']} y {ESPERADO_CNO['4']} códigos",
    )
    codigos_cno = {fila["codigo"] for fila in cno}
    controles.comprobar(
        all(bool(fila["padre"]) and fila["padre"] in codigos_cno for fila in cno if fila["nivel"] != "1"),
        "cada código de la CNO-11, salvo los grandes grupos, tiene su padre en la jerarquía",
    )
    cno4 = {fila["codigo"] for fila in cno if fila["nivel"] == "4"}
    controles.comprobar(
        len(isco4) == GRUPOS_PRIMARIOS_ISCO08,
        f"{GRUPOS_PRIMARIOS_ISCO08} grupos primarios en la CIUO-08 oficial en español",
    )
    controles.comprobar(
        {par["cno11"] for par in pares if par["cno11"]} == cno4,
        f"la correspondencia cubre los {ESPERADO_CNO['4']} códigos CNO-11 de 4 dígitos",
    )
    controles.comprobar(
        {par["isco08"] for par in pares} == isco4,
        f"la correspondencia cubre los {GRUPOS_PRIMARIOS_ISCO08} grupos ISCO-08",
    )
    controles.comprobar(
        set(ocupaciones_oit) == isco4,
        f"los {GRUPOS_PRIMARIOS_ISCO08} grupos coinciden con la clasificación ISCO-08 de la OIT en inglés",
    )
    return controles


def _cobertura(cno: list[dict[str, str]], isco4: set[str], pares: list[dict[str, str]]) -> dict[str, Any]:
    """Resumen de lo que cubren las clasificaciones y de los tipos de correspondencia.

    Returns:
        Los recuentos por nivel de la CNO-11, de ISCO-08, de pares, por tipo y de ISCO-08 con un solo CNO-11.
    """
    cnos_por_isco = _agrupar(pares, "isco08", "cno11")
    un_solo = sum(1 for grupo in isco4 if len(cnos_por_isco.get(grupo, ())) == 1)
    return {
        "cno11": dict(Counter(fila["nivel"] for fila in cno)),
        "isco08_4_digitos": len(isco4),
        "pares": len(pares),
        "tipos": dict(Counter(par["tipo"] for par in pares)),
        "isco_con_un_solo_cno": un_solo,
    }


def _titulos_distintos(pares: list[dict[str, str]], titulos: dict[str, str]) -> list[str]:
    """Grupos ISCO-08 cuyo título en la tabla del INE difiere del título oficial en español de la OIT.

    Returns:
        Los códigos ISCO-08 con título distinto, ordenados.
    """
    return sorted(
        {par["isco08"] for par in pares if par["titulo_isco08"].lower() != titulos.get(par["isco08"], "").lower()}
    )


def _conjunto_validado(
    cno: list[dict[str, str]], isco: list[dict[str, str]], pares: list[dict[str, str]], procedencia: dict[str, Any]
) -> dict[str, Any]:
    """Versión para el motor: CNO-11, títulos ISCO-08 en español y correspondencia completa ISCO-08 → CNO-11.

    Returns:
        El conjunto que exporta el paquete (clasificaciones.json).
    """
    por_isco = defaultdict(list)
    for par in pares:
        if par["cno11"]:
            por_isco[par["isco08"]].append({"cno11": par["cno11"], "tipo": par["tipo"]})
    return {
        "fuente": procedencia["cita"],
        "cno11": {
            fila["codigo"]: {"titulo": fila["titulo"], "nivel": fila["nivel"], "padre": fila["padre"]} for fila in cno
        },
        "isco08_es": {grupo["codigo"]: grupo["titulo_es"] for grupo in isco},
        "isco08_a_cno11": por_isco,
    }


# ---------------------------------------------------------------------------------------------------------------------
# Lo público: ayudas que usan otras fuentes
# ---------------------------------------------------------------------------------------------------------------------


def codigo_de_ocupacion(etiqueta: str) -> str:
    """Código CNO-11 de una ocupación tal como la nombra una API del INE («430 - Otros empleados…» → «430»).

    Args:
        etiqueta: La ocupación; empieza por su código y « - », o es un texto sin código («No consta»).

    Returns:
        El código CNO-11, o CODIGO_NO_CONSTA si la etiqueta no empieza por una cifra.
    """
    return etiqueta.split(" - ")[0].strip() if etiqueta[:1].isdigit() else CODIGO_NO_CONSTA


def codigos_en_cno(codigos: Iterable[str], cno: dict[str, Any], nivel: str) -> bool:
    """Si cada código existe en la CNO-11 validada (`cno11` del conjunto) con el nivel (número de cifras) indicado.

    Returns:
        True si todos los códigos existen con ese nivel.
    """
    return all(cno.get(buscado, {}).get("nivel") == nivel for buscado in codigos)


# ---------------------------------------------------------------------------------------------------------------------
# Etapas
# ---------------------------------------------------------------------------------------------------------------------


def descargar(aceptar_cambio: bool = False) -> None:
    """Descarga cada clasificación desde su dirección oficial y registra su procedencia.

    Un original que ya no coincide con su procedencia detiene la descarga, salvo con `aceptar_cambio`.
    """
    registros = descargar_originales(ARCHIVOS, ORIGINAL, aceptar_cambio)
    guardar_json(PROCEDENCIA, {"fuente": NOMBRE_FUENTE, "licencia": LICENCIA, "cita": CITA, "archivos": registros})


def preparar() -> None:
    """Lee las tres tablas oficiales y guarda la CNO-11, la CIUO-08 en español y su correspondencia."""
    comprobar_originales(FUENTE)
    cno = _cno()
    isco = _isco_es()
    pares = _correspondencia({fila["codigo"]: fila["titulo"] for fila in cno})
    guardar_jsonl(CNO_PREPARADA, cno)
    guardar_jsonl(ISCO_PREPARADA, isco)
    guardar_jsonl(CORRESPONDENCIA_PREPARADA, pares)
    print(f"CNO-11 {len(cno)} · ISCO-08 es {len(isco)} · pares {len(pares)}")


def validar() -> None:
    """Comprueba cobertura y coherencia de las clasificaciones y guarda la validación y el conjunto para el motor."""
    cno = leer_jsonl(CNO_PREPARADA)
    isco = leer_jsonl(ISCO_PREPARADA)
    pares = leer_jsonl(CORRESPONDENCIA_PREPARADA)
    procedencia = leer_json(PROCEDENCIA)
    isco4 = {grupo["codigo"] for grupo in isco if grupo["nivel"] == "4"}
    titulos = {grupo["codigo"]: grupo["titulo_es"] for grupo in isco}
    controles = _controles(cno, isco4, pares, procedencia, leer_validado("oit")["ocupaciones"])
    informe = {
        "estado": controles.estado,
        "comprobado_utc": ahora_utc(),
        "cobertura": _cobertura(cno, isco4, pares),
        "titulos_isco_distintos_ine_oit": _titulos_distintos(pares, titulos),
        "regla": "Una correspondencia múltiple se conserva completa; nunca se elige el primer código por defecto.",
        "controles": controles.lista,
    }
    cerrar_validacion(FUENTE, informe, controles, lambda: _conjunto_validado(cno, isco, pares, procedencia))


def main(argv: list[str] | None = None) -> int:
    """Interfaz de línea de órdenes: descargar, preparar, validar o todo.

    Returns:
        El código de salida de la orden: 0 si cada etapa termina bien.
    """
    etapas = {"preparar": preparar, "validar": validar}
    return principal_fuente_con_descarga(__doc__, descargar=descargar, preparacion_y_validacion=etapas, argumentos=argv)


if __name__ == "__main__":
    sys.exit(main())
