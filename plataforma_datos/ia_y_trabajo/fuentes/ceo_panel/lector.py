"""Opinión, no medida: el Panel Ciutadà del CEO (Enquesta longitudinal, 3a onada, 2025; REO 1151), pregunta 26.

El Centre d'Estudis d'Opinió de la Generalitat pregunta a una muestra probabilística de la población de 16 años o más
residente en Cataluña (6.706 personas, del 9/10 al 9/12/2025) por la probabilidad, de 0 («Gens probable») a 10
(«Totalment probable»), de que las personas sean superadas o sustituidas por máquinas, programas informáticos o la
inteligencia artificial en la mayoría de los trabajos. La pregunta solo se hizo en el cuestionario en línea: su base
son quienes respondieron en línea, ponderados con `PONDERA_ENLINIA` (5.840). Se lee de los microdatos anonimizados
(CSV, Dades obertes de la Generalitat), no de las tablas en PDF: la cifra es la parte ponderada de 7 a 10 sobre esa
base, con las omisiones dentro, como la da la tabla de frecuencias del CEO. Las frecuencias ponderadas de 7 a 10, la
base, la media y las etiquetas de la escala se comparan con las publicadas en esas tablas (pregunta 26). Es opinión de
Cataluña, sin otro territorio con la misma pregunta: va en el bloque `encuestas` de los datos globales con
`naturaleza: "opinion"`, cobertura «cataluna» y sin comparar. Python estándar.

Uso: python3 -m plataforma_datos.ia_y_trabajo.fuentes.ceo_panel.lector {descargar,preparar,validar,todo}
    [--aceptar-cambio]
"""

import csv
import math
import sys
from collections import Counter
from datetime import datetime
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

from plataforma_datos.comun.entrada_salida import (
    ahora_utc,
    carpetas,
    comprobar_originales,
    controles_de_huella,
    guardar_json,
    leer_json,
    original,
)
from plataforma_datos.comun.nucleo import ARCHIVO_DE_PROCEDENCIA, Controles, FormatoInesperado, exigir
from plataforma_datos.comun.red import descargar_originales
from plataforma_datos.comun.textos_y_cifras import numero_es
from plataforma_datos.orquestacion.admision import cerrar_validacion
from plataforma_datos.orquestacion.ordenes import principal_fuente_con_descarga

FUENTE = "ceo-panel"
ORIGINAL, PREPARADO, VALIDADO = carpetas(FUENTE)
PROCEDENCIA = ORIGINAL / ARCHIVO_DE_PROCEDENCIA
# Lo que escribe preparar y lee validar: las filas por modo y, en línea, el peso de cada respuesta de la pregunta 26.
FRECUENCIAS = PREPARADO / "frecuencias.json"

ARCHIVO = "REO1151_microdades_anonimitzades.csv"
URL = f"https://documents.dadesobertes.gencat.cat/ceo/docs/{ARCHIVO}"
# La ficha del estudio en el Registre d'Estudis d'Opinió (Socrata), con tablas, cuestionario y microdatos: de sus
# tablas sale el texto literal de la pregunta, que el CSV no trae.
FICHA = "https://analisi.transparenciacatalunya.cat/resource/m5mb-xt5e.json?reo=1151"
LICENCIA_CEO = (
    "Llicència oberta d'ús d'informació – Catalunya (Dades obertes de la Generalitat): reutilización permitida citando "
    "al Centre d'Estudis d'Opinió como fuente y enlazando con la licencia."
)
CITA = (
    "Centre d'Estudis d'Opinió (CEO), Enquesta longitudinal (Panel Ciutadà), 3a onada, 2025 (REO 1151): microdades "
    "anonimitzades, pregunta 26."
)
ARCHIVOS = [
    {
        "archivo": ARCHIVO,
        "nivel": "oficial",
        "titulo": "CEO, Enquesta longitudinal. 3a onada. 2025 (REO 1151), microdades anonimitzades (CSV)",
        "url": URL,
        "licencia": LICENCIA_CEO,
    }
]
# El CSV se publica en Windows-1252, separado por punto y coma y con la coma como separador decimal.
CODIFICACION = "cp1252"
VARIABLE = "OPINIO_TECNOLOGIA_TREBALL_0_10"
PESO = "PONDERA_ENLINIA"
MODO = "MODE_ADMIN"
EN_LINEA = "En línia"
MODOS = (EN_LINEA, "Paper")
# La pregunta, literal de las tablas estadísticas del CEO (REO1151_taules_estadistiques, pregunta 26).
PREGUNTA = (
    "26. Valori, en l'escala següents, la probabilitat que les persones siguin superades o substituïdes per màquines, "
    "programes informàtics o la intel·ligència artificial en la majoria de les feines."
)
# Las etiquetas de la escala, literales del CSV: si cambian, la validación se detiene.
ESCALA = ("0 Gens probable", *(str(punto) for punto in range(1, 10)), "10 Totalment probable")
OMISION = "Valor perdut per omissió de resposta"
ALTA = ESCALA[7:]
RESPUESTA = "De 7 a 10, en una escala de 0 («Gens probable») a 10 («Totalment probable»)"
TRABAJO_DE_CAMPO = "09/10/2025 – 09/12/2025"
FUENTE_CITADA = "Centre d'Estudis d'Opinió (CEO), Enquesta longitudinal (Panel Ciutadà), 3a onada, 2025 (REO 1151)"
TABLA = f"Microdades anonimitzades, pregunta 26 ({VARIABLE}, ponderada con {PESO})"
ANIO = 2025
# Lo publicado en las tablas estadísticas del CEO (pregunta 26): la lectura de los microdatos tiene que darlo.
REFERENCIA = {
    "filas": 6706,
    "en_linea": 5840,
    "frecuencias_de_7_a_10": {"7": 1237, "8": 847, "9": 227, "10 Totalment probable": 693},
    "media": 6.27,
    "porcentaje": 51.4,
}
BASE = (
    "Personas de 16 años o más residentes en Cataluña que respondieron en línea, ponderadas (base de "
    f"{numero_es(REFERENCIA['en_linea'])}; las omisiones, dentro)"
)


def _numero(texto: str, fila: int) -> float:
    """Un número del CSV del CEO («,1», «5,51») como float.

    Args:
        texto: La celda, con la coma como separador decimal.
        fila: El número de la fila de datos (desde 1), para el mensaje.

    Returns:
        El número.

    Raises:
        FormatoInesperado: Si la celda no es un número finito; el mensaje dice la fila.
    """
    try:
        numero = float(texto.strip().replace(",", "."))
    except ValueError:
        numero = math.nan
    exigir(math.isfinite(numero), f"{FUENTE}: «{texto}» no es un número en la fila {fila} de los microdatos")
    return numero


def leer_microdatos(filas: list[dict[str, str]]) -> dict[str, Any]:
    """Filas por modo de respuesta y, en línea, el peso total de cada respuesta de la pregunta (suma exacta).

    Args:
        filas: Las filas del CSV, por el nombre de cada columna.

    Returns:
        El número de filas, las filas por modo y, en línea, la suma de los pesos de cada respuesta.

    Raises:
        FormatoInesperado: Si a una fila le falta una de las columnas que se leen (el CEO cambió el archivo) o su
            peso no es un número finito no negativo, el CSV está vacío o trae un modo desconocido.
    """
    exigir(bool(filas), f"{FUENTE}: {ARCHIVO} no contiene filas de microdatos")
    pesos: dict[str, list[float]] = {}
    por_modo: Counter[str] = Counter()
    for numero, fila in enumerate(filas, start=1):
        faltan = [columna for columna in (MODO, VARIABLE, PESO) if fila.get(columna) is None]
        exigir(not faltan, f"{FUENTE}: a la fila {numero} de los microdatos le faltan las columnas {faltan}")
        exigir(fila[MODO] in MODOS, f"{FUENTE}: modo «{fila[MODO]}» desconocido en la fila {numero} de {ARCHIVO}")
        por_modo[fila[MODO]] += 1
        if fila[MODO] == EN_LINEA:
            peso = _numero(fila[PESO], numero)
            exigir(peso >= 0, f"{FUENTE}: peso negativo en la fila {numero} de {ARCHIVO}")
            pesos.setdefault(fila[VARIABLE], []).append(peso)
    return {
        "filas": len(filas),
        "por_modo": dict(sorted(por_modo.items())),
        "ponderado_en_linea": {respuesta: math.fsum(lista) for respuesta, lista in sorted(pesos.items())},
    }


def redondeo(valor: float, decimales: int) -> float:
    """Redondeo a la mitad hacia arriba, como en las tablas publicadas.

    Args:
        valor: La cifra; ha de ser finita.
        decimales: Cuántos decimales se conservan.

    Returns:
        La cifra redondeada.

    Raises:
        FormatoInesperado: Si la cifra no es finita (infinita o NaN).
    """
    exigir(math.isfinite(valor), f"{FUENTE}: no se redondea una cifra no finita ({valor})")
    return float(Decimal(repr(valor)).quantize(Decimal(1).scaleb(-decimales), rounding=ROUND_HALF_UP))


def frecuencias_publicadas(ponderado: dict[str, float]) -> dict[str, int]:
    """Las frecuencias ponderadas de 7 a 10 como enteros, con el redondeo de las tablas del CEO (mitad hacia arriba).

    Returns:
        Por punto de 7 a 10, la frecuencia ponderada redondeada a la unidad.
    """
    return {punto: int(redondeo(ponderado.get(punto, 0.0), 0)) for punto in ALTA}


def porcentaje_de_7_a_10(ponderado: dict[str, float]) -> float:
    """La parte ponderada de 7 a 10 sobre toda la base en línea (las omisiones, dentro), con un decimal.

    Args:
        ponderado: El peso de cada respuesta. Precondición: trae las etiquetas de ALTA (si no, KeyError) y su suma es
            mayor que cero (si no, ZeroDivisionError); `_controles` comprueba la escala y una base positiva.

    Returns:
        El porcentaje de 7 a 10, con un decimal.
    """
    return redondeo(100 * math.fsum(ponderado[punto] for punto in ALTA) / math.fsum(ponderado.values()), 1)


def media(ponderado: dict[str, float]) -> float:
    """La media ponderada de la escala, sin las omisiones, con dos decimales (la de la tabla del CEO).

    Args:
        ponderado: El peso de cada respuesta. Precondición: trae todas las etiquetas de ESCALA (si no, KeyError) y la
            suma de sus pesos es mayor que cero (si no, ZeroDivisionError); `_controles` comprueba ambas condiciones.

    Returns:
        La media de 0 a 10, con dos decimales.
    """
    puntos = {int(etiqueta.split(" ")[0]): ponderado[etiqueta] for etiqueta in ESCALA}
    return redondeo(math.fsum(punto * peso for punto, peso in puntos.items()) / math.fsum(puntos.values()), 2)


def descargar(aceptar_cambio: bool = False) -> None:
    """Descarga los microdatos; una versión distinta se detiene hasta aceptarla a propósito."""
    guardar_json(
        PROCEDENCIA,
        {
            "fuente": FUENTE_CITADA,
            "cita": CITA,
            "licencia": LICENCIA_CEO,
            "archivos": descargar_originales(ARCHIVOS, ORIGINAL, aceptar_cambio),
        },
    )


def preparar() -> None:
    """Lee los microdatos y guarda, en línea, el peso de cada respuesta de la pregunta 26."""
    comprobar_originales(FUENTE)
    with original(FUENTE, ARCHIVO).open(encoding=CODIFICACION, newline="") as archivo:
        lector = csv.DictReader(archivo, delimiter=";")
        cabeceras = lector.fieldnames or []
        exigir(
            all(cabeceras.count(columna) == 1 for columna in (MODO, VARIABLE, PESO)),
            f"{FUENTE}: {ARCHIVO} necesita las columnas {MODO}, {VARIABLE}, {PESO} una sola vez; "
            f"cabeceras leídas: {cabeceras}",
        )
        frecuencias = leer_microdatos(list(lector))
    guardar_json(FRECUENCIAS, frecuencias)
    print(f"{frecuencias['filas']} personas en los microdatos del CEO (REO 1151)")


def _comprobar_frecuencias(frecuencias: object) -> None:
    """Exige la forma del preparado y pesos finitos no negativos antes de sumarlos."""
    contexto = f"{FUENTE}: frecuencias.json"
    exigir(isinstance(frecuencias, dict), f"{contexto} debe ser un objeto")
    exigir(
        type(frecuencias.get("filas")) is int and frecuencias["filas"] > 0,
        f"{contexto}: filas debe ser un entero positivo",
    )
    modos = frecuencias.get("por_modo")
    exigir(isinstance(modos, dict), f"{contexto}: por_modo debe ser un objeto")
    exigir(
        bool(modos)
        and all(modo in MODOS and type(cantidad) is int and cantidad >= 0 for modo, cantidad in modos.items()),
        f"{contexto}: por_modo necesita modos conocidos y recuentos enteros no negativos",
    )
    ponderado = frecuencias.get("ponderado_en_linea")
    exigir(isinstance(ponderado, dict), f"{contexto}: ponderado_en_linea debe ser un objeto")
    exigir(
        all(
            isinstance(etiqueta, str) and type(peso) in (int, float) and math.isfinite(peso) and peso >= 0
            for etiqueta, peso in ponderado.items()
        ),
        f"{contexto}: ponderado_en_linea necesita etiquetas de texto y pesos finitos no negativos",
    )
    if set(ponderado) == {*ESCALA, OMISION}:
        exigir(
            math.fsum(ponderado[etiqueta] for etiqueta in ESCALA) > 0,
            f"{contexto}: la base de respuestas de la escala debe ser positiva para calcular la media y el porcentaje",
        )


def _controles(frecuencias: dict[str, Any], procedencia: dict[str, Any]) -> tuple[Controles, float | None]:
    """Los controles de la base, la escala y lo publicado por el CEO, y la cifra si la escala es la esperada.

    Args:
        frecuencias: Lo que escribió preparar (filas, filas por modo y pesos en línea).
        procedencia: La procedencia de los microdatos, con su huella.

    Returns:
        Los controles y la parte de 7 a 10 en % (None si las etiquetas de la escala no son las literales).
    """
    _comprobar_frecuencias(frecuencias)
    ponderado = frecuencias["ponderado_en_linea"]
    controles = Controles()
    controles_de_huella(controles, ORIGINAL, procedencia)
    controles.comprobar(
        frecuencias["filas"] == REFERENCIA["filas"]
        and frecuencias["por_modo"].get(EN_LINEA) == REFERENCIA["en_linea"]
        and redondeo(math.fsum(ponderado.values()), 1) == REFERENCIA["en_linea"],
        f"la muestra ({REFERENCIA['filas']}) y la base ponderada en línea ({REFERENCIA['en_linea']}) del CEO; "
        f"leídas: {frecuencias['filas']}, {frecuencias['por_modo']}",
    )
    escala_literal = set(ponderado) == {*ESCALA, OMISION}
    controles.comprobar(escala_literal, f"las etiquetas de la escala, literales; leídas: {sorted(ponderado)}")
    publicadas = frecuencias_publicadas(ponderado)
    controles.comprobar(
        publicadas == REFERENCIA["frecuencias_de_7_a_10"],
        f"las frecuencias ponderadas de 7 a 10 de la tabla del CEO; leídas: {publicadas}",
    )
    controles.comprobar(
        escala_literal and media(ponderado) == REFERENCIA["media"],
        f"la media de la tabla del CEO ({REFERENCIA['media']})",
    )
    cifra = porcentaje_de_7_a_10(ponderado) if escala_literal else None
    controles.comprobar(
        cifra == REFERENCIA["porcentaje"], f"de 7 a 10, el {REFERENCIA['porcentaje']} %; leído: {cifra}"
    )
    return controles, cifra


def consulta_del_csv(procedencia: dict[str, Any]) -> str:
    """El día (AAAA-MM-DD) en que se descargó el CSV de los microdatos, según la procedencia.

    Args:
        procedencia: La procedencia de los microdatos.

    Returns:
        La fecha de descarga del archivo ARCHIVO.

    Raises:
        FormatoInesperado: Si la procedencia no registra el archivo ARCHIVO una sola vez o su fecha no es válida.
    """
    entradas = [entrada for entrada in procedencia["archivos"] if entrada["archivo"] == ARCHIVO]
    exigir(len(entradas) == 1, f"{FUENTE}: la procedencia no registra {ARCHIVO} una sola vez")
    fecha = entradas[0].get("descargado_utc")
    contexto = f"{FUENTE}: {ARCHIVO}, descargado_utc debe ser una fecha ISO 8601 válida"
    exigir(isinstance(fecha, str), contexto)
    try:
        instante = datetime.fromisoformat(fecha)
    except ValueError as error:
        raise FormatoInesperado(contexto) from error
    exigir(instante.date().isoformat() == fecha[:10], contexto)
    return fecha[:10]


def validar() -> None:
    """Comprueba la base, la escala y lo publicado por el CEO, y guarda la cifra de Cataluña."""
    frecuencias, procedencia = leer_json(FRECUENCIAS), leer_json(PROCEDENCIA)
    controles, cifra = _controles(frecuencias, procedencia)
    conjunto = {
        "cita": CITA,
        "fuente": FUENTE_CITADA,
        "tabla": TABLA,
        "licencia": LICENCIA_CEO,
        "url": URL,
        "ficha": FICHA,
        "consultado": consulta_del_csv(procedencia),
        "anio": ANIO,
        "pregunta": PREGUNTA,
        "respuesta": RESPUESTA,
        "base": BASE,
        "campo": TRABAJO_DE_CAMPO,
        "cifra": cifra,
    }
    informe = {
        "estado": controles.estado,
        "comprobado_utc": ahora_utc(),
        "cobertura": {"personas": frecuencias["filas"], "en_linea": frecuencias["por_modo"].get(EN_LINEA)},
        "limites": "Opinión de la población de 16 años o más residente en Cataluña que respondió en línea, no una "
        "medida de la exposición ni del uso de la IA. Solo Cataluña: ningún otro territorio tiene la misma pregunta.",
        "controles": controles.lista,
    }
    cerrar_validacion(FUENTE, informe, controles, lambda: conjunto)


def main(argv: list[str] | None = None) -> int:
    """Interfaz de línea de órdenes: descargar, preparar, validar o todo.

    Returns:
        El código de salida de la orden: 0 si cada etapa termina bien.
    """
    return principal_fuente_con_descarga(
        __doc__,
        descargar=descargar,
        preparacion_y_validacion={"preparar": preparar, "validar": validar},
        argumentos=argv,
    )


if __name__ == "__main__":
    sys.exit(main())
