"""Uso de la IA por las empresas de Islandia (Statistics Iceland, tabla STI03266): su propio módulo de actualización.

Statistics Iceland (Hagstofa Íslands) pregunta por el uso de la IA en su encuesta de uso de las tecnologías de la
información en las empresas, con la lista de ocho tecnologías del cuestionario europeo de 2025. Eurostat no publica
a Islandia, así que la cifra no está dos veces. No es la medida europea: la tabla da las clases de tamaño desde «1 til
9 starfsmenn» (de 1 a 9 personas empleadas; la traducción inglesa de la tabla dice «10 to 19», pero los códigos y la
nota de prensa de Statistics Iceland dicen 1–9), no dice cómo se pondera el total y su muestra es pequeña (848
empresas, 62 % de respuesta, según la nota de prensa). Por eso va como medida nacional, con su definición y sin
comparar. Se lee la fila «All companies» (código A12), columna «Any of the specified technologies» (código A9).

El original es el archivo PC-Axis de la tabla, que la propia base de datos sirve por GET. Python estándar.

Uso: python3 -m plataforma_datos.ia_y_trabajo.fuentes.ia_nacional_isl.lector {descargar,preparar,validar,todo}
    [--aceptar-cambio]
"""

import re
import sys
from typing import Any

from plataforma_datos.comun.entrada_salida import carpetas, comprobar_originales, guardar_json, original
from plataforma_datos.comun.nucleo import Controles, exigir
from plataforma_datos.ia_y_trabajo.comun.medida_nacional import (
    controles_del_indicador,
    descargar_medida,
    indicador_nacional,
    validar_medida,
)
from plataforma_datos.orquestacion.ordenes import principal_fuente_con_descarga

FUENTE = "ia-nacional-isl"
PAIS = "ISL"
ORIGINAL, PREPARADO, VALIDADO = carpetas(FUENTE)
CIFRAS = PREPARADO / "cifras.json"
TABLA = "STI03266"
ARCHIVO = "hagstofa-sti03266.px"
URL = (
    "https://px.hagstofa.is/pxen/Resources/PX/Databases/Atvinnuvegir/visinditaekni/Upplysingataekninotkunfyrirtaekja/"
    "1_gervigreind/STI03266.px"
)
URL_DE_LA_TABLA = (
    "https://px.hagstofa.is/pxen/pxweb/en/Atvinnuvegir/"
    "Atvinnuvegir__visinditaekni__Upplysingataekninotkunfyrirtaekja__1_gervigreind/STI03266.px/"
)
LICENCIA = (
    "Creative Commons Attribution 4.0 International (CC BY 4.0), "
    "https://statice.is/publications/open-data-access: se cita a Statistics Iceland (Hagstofa Íslands) como autora."
)
CITA = "Statistics Iceland (Hagstofa Íslands), tabla STI03266, «Enterprises' use of AI by technology 2025»."
ARCHIVOS = [
    {
        "archivo": ARCHIVO,
        "nivel": "oficial",
        "titulo": "Statistics Iceland, tabla STI03266: uso de la IA por las empresas por tecnología, 2025 (PC-Axis)",
        "url": URL,
        "licencia": LICENCIA,
    }
]
# Los códigos de la fila y la columna que se leen, y los textos literales que dicen qué son: si cambian, se para.
TODAS_LAS_EMPRESAS, ALGUNA_TECNOLOGIA, CLASE_MENOR = "A12", "A9", "1-9"
TEXTO_ALGUNA_TECNOLOGIA = "Any of the specified technologies"
TEXTO_CLASE_MENOR = "1 til 9 starfsmenn"
UNIDAD = "Percentage"
INDICADORES_NACIONALES: dict[str, dict[str, object]] = {
    PAIS: indicador_nacional(
        PAIS,
        nombre={
            "es": "Empresas que usan IA (Islandia, medida nacional)",
            "ca": "Empreses que fan servir IA (Islàndia, mesura nacional)",
        },
        definicion={
            "es": "Porcentaje de empresas de Islandia que usaron al menos una de ocho tecnologías de inteligencia "
            "artificial en 2025 (encuesta de uso de las tecnologías de la información en las empresas de Statistics "
            "Iceland, tabla STI03266; la lista de tecnologías es la del cuestionario europeo de 2025). Medida "
            "nacional: la encuesta incluye empresas desde 1 persona empleada (la europea empieza en 10), la muestra "
            "es de 848 empresas con un 62 % de respuesta y la tabla no dice cómo se pondera el total, que queda por "
            "encima de las cifras de las empresas de 1 a 9 personas (29 %) y de 10 a 49 (48 %). Eurostat no la "
            "publica: no se compara con Europa ni con otros países.",
            "ca": "Percentatge d'empreses d'Islàndia que van fer servir almenys una de vuit tecnologies "
            "d'intel·ligència artificial el 2025 (enquesta d'ús de les tecnologies de la informació a les empreses "
            "de Statistics Iceland, taula STI03266; la llista de tecnologies és la del qüestionari europeu del "
            "2025). Mesura nacional: l'enquesta inclou empreses des d'1 persona ocupada (l'europea comença a 10), la "
            "mostra és de 848 empreses amb un 62 % de resposta i la taula no diu com es pondera el total, que queda "
            "per sobre de les xifres de les empreses d'1 a 9 persones (29 %) i de 10 a 49 (48 %). Eurostat no la "
            "publica: no es compara amb Europa ni amb altres països.",
        },
        fuente="Statistics Iceland (Hagstofa Íslands), encuesta de uso de las TIC en las empresas",
        tabla="STI03266 · All companies · «Any of the specified technologies» · 2025",
        licencia=LICENCIA,
        url=URL_DE_LA_TABLA,
    )
}
# Lo que la definición tiene que decir, por lengua: el universo distinto y la ponderación sin publicar.
FRASES = {
    "es": ("desde 1 persona empleada", "no dice cómo se pondera el total"),
    "ca": ("des d'1 persona ocupada", "no diu com es pondera el total"),
}


def claves_px(texto: str) -> dict[str, list[str]]:
    """Las claves de un archivo PC-Axis con sus valores: los textos entre comillas o, sin comillas, los números.

    Returns:
        Las claves del archivo, cada una con la lista de sus valores.
    """
    claves: dict[str, list[str]] = {}
    for sentencia in re.findall(r'(?:[^;"]|"[^"]*")+', texto):
        clave, igual, valor = sentencia.strip().partition("=")
        if igual:
            exigir(clave not in claves, f"Hagstofa: clave repetida {clave!r}")
            claves[clave] = re.findall(r'"([^"]*)"', valor) if '"' in valor else valor.split()
    return claves


def cifra_de_la_tabla(texto: str) -> dict[str, Any]:
    """La cifra de «All companies» y «Any of the specified technologies», con los textos que dicen qué es.

    Returns:
        La cifra (porcentaje) con los textos literales que dicen qué mide.
    """
    claves = claves_px(texto)
    exigir(claves.get("MATRIX") == [TABLA], f"Hagstofa: no es la tabla {TABLA}")
    necesarias = (
        "HEADING",
        'VALUES("Ár")',
        'CODES("Starfsemi/Stærð")',
        'CODES("Tækni")',
        'VALUES("Starfsemi/Stærð")',
        'VALUES[en]("Technology")',
        "UNITS[en]",
        "DATA",
    )
    for clave in necesarias:
        exigir(bool(claves.get(clave)), f"Hagstofa: falta {clave} o no tiene valores")
    filas, tecnologias = claves['CODES("Starfsemi/Stærð")'], claves['CODES("Tækni")']
    exigir(claves["HEADING"] == ["Ár", "Tækni"] and len(claves['VALUES("Ár")']) == 1, "Hagstofa: cabecera inesperada")
    for codigos, etiquetas, dimension in (
        (filas, claves['VALUES("Starfsemi/Stærð")'], "Starfsemi/Stærð"),
        (tecnologias, claves['VALUES[en]("Technology")'], "Tækni"),
    ):
        exigir(len(codigos) == len(set(codigos)), f"Hagstofa: códigos repetidos en {dimension}")
        exigir(len(codigos) == len(etiquetas), f"Hagstofa: códigos y etiquetas desalineados en {dimension}")
    exigir(len(claves["UNITS[en]"]) == 1, "Hagstofa: UNITS[en] debe tener una sola unidad")
    texto_anio = claves['VALUES("Ár")'][0]
    exigir(re.fullmatch(r"[0-9]{4}", texto_anio) is not None, f"Hagstofa: año inesperado {texto_anio!r}")
    datos = claves["DATA"]
    exigir(len(datos) == len(filas) * len(tecnologias), f"Hagstofa: {len(datos)} cifras para la tabla")
    exigir(TODAS_LAS_EMPRESAS in filas and ALGUNA_TECNOLOGIA in tecnologias, "Hagstofa: sin la fila o la columna")
    fila, columna = filas.index(TODAS_LAS_EMPRESAS), tecnologias.index(ALGUNA_TECNOLOGIA)
    texto_cifra = datos[fila * len(tecnologias) + columna]
    exigir(re.fullmatch(r"[0-9]+", texto_cifra) is not None, f"Hagstofa: cifra inesperada {texto_cifra!r}")
    return {
        "valor": float(texto_cifra),
        "anio": int(texto_anio),
        "tabla": TABLA,
        "respuesta": claves['VALUES[en]("Technology")'][columna],
        "clase_menor": claves['VALUES("Starfsemi/Stærð")'][filas.index(CLASE_MENOR)] if CLASE_MENOR in filas else "",
        "unidad": claves["UNITS[en]"][0],
    }


def descargar(aceptar_cambio: bool = False) -> None:
    """Descarga la tabla; una edición nueva se acepta a propósito (--aceptar-cambio)."""
    cabecera = {"fuente": "Statistics Iceland (Hagstofa Íslands)", "cita": CITA, "licencia": LICENCIA}
    descargar_medida(FUENTE, cabecera, ARCHIVOS, aceptar_cambio)


def preparar() -> None:
    """Deja la cifra con su año y los textos literales de la fila, la columna y la clase de tamaño menor."""
    comprobar_originales(FUENTE)
    cifra = cifra_de_la_tabla(original(FUENTE, ARCHIVO).read_text(encoding="utf-8-sig"))
    guardar_json(CIFRAS, {"paises": {PAIS: cifra}})
    print(f"Islandia: {cifra['valor']} % ({cifra['anio']})")


def _propios(controles: Controles, cifra: dict[str, Any], _procedencia: dict[str, Any]) -> None:
    """La tabla, la columna, el universo desde 1 persona y la unidad, literales; y la definición que lo dice."""
    controles.comprobar(cifra.get("tabla") == TABLA, f"Islandia: tabla {TABLA}")
    controles.comprobar(cifra.get("respuesta") == TEXTO_ALGUNA_TECNOLOGIA, "Islandia: columna «Any of the specified»")
    controles.comprobar(cifra.get("clase_menor") == TEXTO_CLASE_MENOR, "Islandia: la clase menor es de 1 a 9 personas")
    controles.comprobar(cifra.get("unidad") == UNIDAD, "Islandia: la cifra es un porcentaje")
    controles_del_indicador(controles, PAIS, INDICADORES_NACIONALES[PAIS], LICENCIA, FRASES)


def validar() -> None:
    """Comprueba la huella, la licencia, la cifra, el año (2025) y lo que dice la definición."""
    limites = (
        "Medida nacional: universo desde 1 persona empleada, ponderación del total sin publicar y muestra de 848 "
        "empresas; no se compara con Eurostat ni con otros países."
    )
    validar_medida(FUENTE, PAIS, range(2025, 2026), _propios, limites)


def main(argv: list[str] | None = None) -> int:
    """Interfaz de línea de órdenes: descargar, preparar, validar o todo.

    Returns:
        El código de salida del proceso (0 si todo fue bien).
    """
    return principal_fuente_con_descarga(
        __doc__,
        descargar=descargar,
        preparacion_y_validacion={"preparar": preparar, "validar": validar},
        argumentos=argv,
    )


if __name__ == "__main__":
    sys.exit(main())
