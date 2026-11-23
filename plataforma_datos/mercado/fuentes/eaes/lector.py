"""Ganancia media anual por trabajador en España por grupo de ocupación y sexo, de la EAES (INE, tabla 28186).

Se descargan de la API Tempus del INE los tres últimos años de la tabla, los valores de su variable de ocupación (los
grupos A a Q y «Todas las ocupaciones») y, de cada grupo, sus subgrupos principales de la CNO-11 de dos cifras: la
correspondencia sale de la jerarquía de la variable OCUPACIONES (456), no se escribe a mano. Según las notas del INE, un
signo «-» delante del dato indica entre 100 y 500 observaciones (gran variabilidad) y un nulo, menos de 100: se
conservan tal cual. El último año se lee de los datos y la cita lo dice. Python estándar.

Uso: python3 -m plataforma_datos.mercado.fuentes.eaes.lector {descargar,preparar,validar,todo} [--aceptar-cambio]
"""

import re
import sys
from collections.abc import Callable
from pathlib import Path
from typing import Any

from plataforma_datos.comun import tempus
from plataforma_datos.comun.descarga_acotada import Contrato, descargar_acotados
from plataforma_datos.comun.dia_de_consulta import dia_iso_en_cataluna
from plataforma_datos.comun.entrada_salida import (
    ahora_utc,
    carpetas,
    comprobar_originales,
    controles_de_huella,
    guardar_json,
    hoy_utc,
    leer_json,
    original,
    ruta_del_conjunto,
)
from plataforma_datos.comun.nucleo import ARCHIVO_DE_PROCEDENCIA, ArchivoDescargable, Controles, exigir
from plataforma_datos.mercado.fuentes.epa.lector import LICENCIA
from plataforma_datos.orquestacion.admision import cerrar_validacion
from plataforma_datos.orquestacion.ordenes import principal_fuente_con_descarga

FUENTE = "eaes"
# Lo que escribe preparar y lee validar: los grupos con sus subgrupos y sus cifras por sexo y año.
GRUPOS_PREPARADOS = "grupos.json"
TABLA, GRUPOS = "ine-eaes-28186.json", "ine-eaes-28186-grupos.json"
ANIOS_PEDIDOS = 3
NOMBRE = "INE · Encuesta Anual de Estructura Salarial: ganancia media anual por trabajador por grupo de ocupación y "
NOMBRE += "sexo, España"
TEMPUS = "https://servicios.ine.es/wstempus/js/ES"
ARCHIVOS: tuple[ArchivoDescargable, ...] = (
    {
        "archivo": TABLA,
        "nivel": "oficial",
        "titulo": "INE, EAES, tabla 28186: ganancia media anual por trabajador por grupo de ocupación y sexo, España, "
        f"últimos {ANIOS_PEDIDOS} años",
        "url": f"{TEMPUS}/DATOS_TABLA/28186?nult={ANIOS_PEDIDOS}",
        "licencia": LICENCIA,
    },
    {
        "archivo": GRUPOS,
        "nivel": "oficial",
        "titulo": "INE, EAES, tabla 28186: valores y códigos de la variable de ocupación (grupos A a Q)",
        "url": f"{TEMPUS}/VALORES_GRUPOSTABLA/28186/88012",
        "licencia": LICENCIA,
    },
)
MAX_BYTES = 4 * 1024 * 1024
SUFIJO = ". Salario medio bruto. Total Nacional. Dato base."
SEXOS = {"Ambos sexos": "total", "Mujeres": "mujeres", "Hombres": "hombres"}
LETRAS = tuple("ABCDEFGHIJKLMNOPQ")
TODAS = ""
# El tipo de dato «definitivo» de la API Tempus: la misma tabla pedida con `tip=A` (DATOS_TABLA/28186?nult=3&tip=A,
# consulta del 15/11/2026) trae `T3_TipoDato: "Definitivo"` en los datos que con códigos llevan `FK_TipoDato: 1`. La
# cita dice «Definitivos» solo si lo son todos los del último año.
DEFINITIVO = 1
# El último año y el anterior, con el que se compara.
MIN_ANIOS = 2


def cita(anio: int) -> str:
    """La cita de la fuente con el último año leído.

    Returns:
        El texto de la cita.
    """
    return (
        "Elaboración propia con datos extraídos del sitio web del INE: www.ine.es (Encuesta Anual de Estructura "
        f"Salarial, tabla 28186; Definitivos {anio})."
    )


def _procedencia() -> Path:
    return carpetas(FUENTE).original / ARCHIVO_DE_PROCEDENCIA


def _contrato(comprobar: Callable[[bytes, str], None], que: str) -> Contrato:
    return Contrato(tempus.TIPOS_TEMPUS, MAX_BYTES, lambda datos: comprobar(datos, f"EAES {que}"))


def archivo_de_hijos(letra: str, identificador: int) -> ArchivoDescargable:
    """El original con los subgrupos principales de la CNO-11 de un grupo, por su identificador en la variable 456.

    Returns:
        El archivo descargable.
    """
    exigir(letra in LETRAS and isinstance(identificador, int), f"EAES: grupo inesperado {letra!r} {identificador!r}")
    return {
        "archivo": f"ine-eaes-cno11-{letra}.json",
        "nivel": "oficial",
        "titulo": "INE, jerarquía de la variable OCUPACIONES (456): subgrupos principales CNO-11 del grupo "
        f"{letra} de la EAES",
        "url": f"{TEMPUS}/VALORES_HIJOS/456/{identificador}",
        "licencia": LICENCIA,
    }


def descargar(aceptar_cambio: bool = False) -> None:
    """Descarga la tabla, sus grupos y los subgrupos de cada grupo; la procedencia guarda huella y fecha de cada uno."""
    carpeta = carpetas(FUENTE).original
    tabla, grupos = ARCHIVOS
    entradas = descargar_acotados([tabla], carpeta, aceptar_cambio, _contrato(tempus.comprobar_tabla, TABLA))
    entradas += descargar_acotados([grupos], carpeta, aceptar_cambio, _contrato(tempus.comprobar_valores, GRUPOS))
    for valor in leer_json(carpeta / GRUPOS):
        if valor["Codigo"]:
            hijos = archivo_de_hijos(valor["Codigo"], valor.get("Id"))
            contrato = _contrato(tempus.comprobar_valores, hijos["archivo"])
            entradas += descargar_acotados([hijos], carpeta, aceptar_cambio, contrato)
    guardar_json(_procedencia(), {"fuente": NOMBRE, "licencia": LICENCIA, "archivos": entradas})


def grupos_de_la_tabla(
    tabla: list[dict[str, Any]], grupos: list[dict[str, Any]], hijos: dict[str, list[dict[str, Any]]]
) -> dict[str, Any]:
    """Por grupo (y «» para todas las ocupaciones): su nombre, sus subgrupos y sus cifras por sexo y año.

    Returns:
        {letra: {nombre, cno2, sexos: {sexo: {año: cifra o None}}, definitivos: {año: bool}}}.
    """
    letra_de = {valor["Nombre"]: valor["Codigo"] for valor in grupos}
    salida: dict[str, Any] = {}
    for serie in tabla:
        nombre = serie["Nombre"].strip()
        exigir(nombre.endswith(SUFIJO), f"EAES: serie inesperada {nombre!r}")
        grupo, sexo = nombre.removesuffix(SUFIJO).rsplit(". ", 1)
        exigir(grupo in letra_de and sexo in SEXOS, f"EAES: grupo o sexo desconocido en {nombre!r}")
        entrada = salida.setdefault(letra_de[grupo], {"nombre": grupo, "sexos": {}, "definitivos": {}})
        exigir(SEXOS[sexo] not in entrada["sexos"], f"EAES: serie repetida {nombre!r}")
        cifras: dict[str, float | None] = {}
        for dato in serie["Data"]:
            exigir(
                dato["FK_Periodo"] == tempus.ANUAL and isinstance(dato["Anyo"], int), f"EAES: dato no anual {nombre}"
            )
            cifras[str(dato["Anyo"])] = tempus.cifra(dato["Valor"], f"EAES {nombre} {dato['Anyo']}")
            definitivo = dato.get("FK_TipoDato") == DEFINITIVO
            entrada["definitivos"][str(dato["Anyo"])] = (
                entrada["definitivos"].get(str(dato["Anyo"]), True) and definitivo
            )
        entrada["sexos"][SEXOS[sexo]] = dict(sorted(cifras.items()))
    for letra, valores in hijos.items():
        exigir(letra in salida, f"EAES: subgrupos de un grupo sin serie: {letra}")
        salida[letra]["cno2"] = [valor["Codigo"] for valor in valores]
    return dict(sorted(salida.items()))


def preparar() -> None:
    """Deja los grupos con sus subgrupos y sus cifras por sexo y año, y el último año que traen."""
    comprobar_originales(FUENTE)
    grupos = leer_json(original(FUENTE, GRUPOS))
    letras = [valor["Codigo"] for valor in grupos if valor["Codigo"]]
    hijos = {letra: leer_json(original(FUENTE, f"ine-eaes-cno11-{letra}.json")) for letra in letras}
    salida = grupos_de_la_tabla(leer_json(original(FUENTE, TABLA)), grupos, hijos)
    anios = sorted(
        {int(anio) for entrada in salida.values() for cifras in entrada["sexos"].values() for anio in cifras}
    )
    exigir(bool(anios), "EAES: la tabla no trae años")
    guardar_json(carpetas(FUENTE).preparado / GRUPOS_PREPARADOS, {"anios": anios, "grupos": salida})
    print(f"{len(salida)} grupos; último año {anios[-1]}")


def controles_de_los_grupos(preparado: dict[str, Any], anterior: int | None, anio_en_curso: int) -> Controles:
    """Los controles: grupos y sexos completos, subgrupos de dos cifras, años consecutivos y que no retroceden.

    Returns:
        Los controles, con su resultado.
    """
    grupos, anios = preparado["grupos"], preparado["anios"]
    ultimo = anios[-1]
    controles = Controles()
    controles.comprobar(set(grupos) == {TODAS, *LETRAS}, f"están los grupos A a Q y el total: {sorted(grupos)}")
    controles.comprobar(
        all(set(grupo["sexos"]) == set(SEXOS.values()) for grupo in grupos.values()),
        "cada grupo trae total, mujeres y hombres",
    )
    controles.comprobar(
        all(
            grupo.get("cno2") and all(re.fullmatch(r"\d\d", codigo) for codigo in grupo["cno2"])
            for letra, grupo in grupos.items()
            if letra != TODAS
        ),
        "cada grupo tiene sus subgrupos principales de la CNO-11 de dos cifras",
    )
    controles.comprobar(
        len(anios) >= MIN_ANIOS and anios == list(range(anios[0], ultimo + 1)) and ultimo < anio_en_curso,
        f"al menos dos años consecutivos y ya cerrados: {anios}",
    )
    controles.comprobar(
        all(grupo["definitivos"].get(str(ultimo)) for grupo in grupos.values()),
        f"los datos de {ultimo} son definitivos",
    )
    controles.comprobar(
        grupos.get(TODAS, {}).get("sexos", {}).get("total", {}).get(str(ultimo)) is not None,
        f"hay ganancia media de todas las ocupaciones en {ultimo}",
    )
    controles.comprobar(
        anterior is None or ultimo >= anterior,
        f"el último año ({ultimo}) no retrocede respecto al validado ({anterior})",
    )
    return controles


def validar() -> None:
    """Comprueba los grupos y el periodo; guarda las cifras con su cita, generada desde el último año leído."""
    preparado, procedencia = leer_json(carpetas(FUENTE).preparado / GRUPOS_PREPARADOS), leer_json(_procedencia())
    ruta = ruta_del_conjunto(FUENTE)
    anterior = leer_json(ruta).get("ultimo_anio") if ruta.exists() else None
    controles = controles_de_los_grupos(preparado, anterior, hoy_utc().year)
    controles_de_huella(controles, carpetas(FUENTE).original, procedencia)
    ultimo = preparado["anios"][-1]
    informe = {
        "estado": controles.estado,
        "comprobado_utc": ahora_utc(),
        "cobertura": {"ultimo_anio": ultimo, "anterior_validado": anterior},
        "limites": "España, sin desglose territorial; los grupos A a Q agrupan subgrupos de la CNO-11 según la "
        "jerarquía del INE. Un signo «-» marca gran variabilidad y un nulo, menos de 100 observaciones.",
        "controles": controles.lista,
    }
    consultado = max(dia_iso_en_cataluna(entrada["descargado_utc"]) for entrada in procedencia["archivos"])
    cerrar_validacion(
        FUENTE,
        informe,
        controles,
        lambda: {
            "cita": cita(ultimo),
            "licencia": LICENCIA,
            "consultado": consultado,
            "ultimo_anio": ultimo,
            "anios": preparado["anios"],
            "grupos": preparado["grupos"],
        },
    )


def main(argv: list[str] | None = None) -> int:
    """Interfaz de línea de órdenes: descargar, preparar, validar o todo.

    Args:
        argv: Los argumentos; None toma los de la línea de órdenes.

    Returns:
        El código de salida del proceso.
    """
    return principal_fuente_con_descarga(
        __doc__,
        descargar=descargar,
        preparacion_y_validacion={"preparar": preparar, "validar": validar},
        argumentos=argv,
    )


if __name__ == "__main__":
    sys.exit(main())
