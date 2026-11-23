"""Uso de la IA por las empresas de Suiza (BFS, encuesta de innovación del KOF): su propio módulo de actualización.

La Oficina Federal de Estadística de Suiza (Bundesamt für Statistik, BFS) publica, con los datos de la encuesta de
innovación del KOF (centro de estudios económicos de la ETH de Zúrich, módulo de uso de las TIC), la proporción de
empresas que usan sistemas basados en inteligencia artificial, por tamaño, cada dos años. Eurostat no publica a Suiza
en su indicador de empresas, así que la cifra no está dos veces. No es la medida europea: la encuesta empieza en las
empresas de 5 personas empleadas (la clase menor es «Kleine (5-49)»), usa una versión simplificada de la definición de
IA de Eurostat y en 2023 respondió el 21,9 % de las empresas invitadas (2 040 de 9 307, según el BFS). Por eso va como
medida nacional, con su definición y sin comparar. Se lee la fila «Total», columna del último año.

El original es el CSV de los datos del gráfico gr-d-16.04-30207a-ind del BFS, que sirve su visor de gráficos.
Python estándar.

Uso: python3 -m plataforma_datos.ia_y_trabajo.fuentes.ia_nacional_che.lector {descargar,preparar,validar,todo}
    [--aceptar-cambio]
"""

import sys
from itertools import pairwise
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

FUENTE = "ia-nacional-che"
PAIS = "CHE"
ORIGINAL, PREPARADO, VALIDADO = carpetas(FUENTE)
CIFRAS = PREPARADO / "cifras.json"
GRAFICO = "gr-d-16.04-30207a-ind"
ARCHIVO = "bfs-ia-empresas-por-tamano.csv"
URL = "https://datawrapper.dwcdn.net/9b56ee691380d1d034579031dfcc3f9d/2/dataset.csv"
URL_DEL_GRAFICO = "https://www.bfs.admin.ch/asset/de/34948994"
# El título del gráfico, literal como lo publica el BFS: la cita obligatoria lleva autor, título y enlace.
TITULO = "Anteil der Unternehmen, die auf künzlicher Intelligenz basierende Systeme einsetzen, nach Grösse - 2019-2023"
LICENCIA = (
    f"Condiciones OPEN-BY del BFS, en la ficha del gráfico ({URL_DEL_GRAFICO}): «Freie Nutzung - Quellenangabe ist "
    "Pflicht»: uso libre, también comercial, con la cita obligatoria del autor, el título y el enlace al conjunto de "
    "datos."
)
CITA = f"Bundesamt für Statistik (BFS), «{TITULO}» ({GRAFICO}), {URL_DEL_GRAFICO}; datos: KOF, Innovationserhebung."
ARCHIVOS = [
    {
        "archivo": ARCHIVO,
        "nivel": "oficial",
        "titulo": f"Bundesamt für Statistik, gráfico {GRAFICO}: empresas que usan sistemas basados en IA, por "
        "tamaño, 2019–2023 (CSV de los datos del gráfico)",
        "url": URL,
        "licencia": LICENCIA,
    }
]
# La cabecera, la fila y la clase de tamaño menor, literales: si cambian, la cifra puede medir otra cosa y se para.
CABECERA, FILA_TOTAL, CLASE_MENOR = "Entreprises", "Total", "Kleine (5-49)"
INDICADORES_NACIONALES: dict[str, dict[str, object]] = {
    PAIS: indicador_nacional(
        PAIS,
        nombre={
            "es": "Empresas que usan IA (Suiza, medida nacional)",
            "ca": "Empreses que fan servir IA (Suïssa, mesura nacional)",
        },
        definicion={
            "es": "Porcentaje de empresas de Suiza que usaban sistemas basados en inteligencia artificial en 2023 "
            "(encuesta de innovación del KOF de la ETH de Zúrich, módulo de uso de las TIC, publicada por la Oficina "
            "Federal de Estadística, BFS). Medida nacional: la encuesta incluye empresas desde 5 personas empleadas "
            "(la europea empieza en 10), usa una versión simplificada de la definición de IA de Eurostat, se hace cada "
            "dos años y respondió el 21,9 % de las empresas invitadas. Eurostat no la publica: no se compara con "
            "Europa ni con otros países.",
            "ca": "Percentatge d'empreses de Suïssa que feien servir sistemes basats en intel·ligència artificial el "
            "2023 (enquesta d'innovació del KOF de l'ETH de Zuric, mòdul d'ús de les TIC, publicada per l'Oficina "
            "Federal d'Estadística, BFS). Mesura nacional: l'enquesta inclou empreses des de 5 persones ocupades "
            "(l'europea comença a 10), fa servir una versió simplificada de la definició d'IA d'Eurostat, es fa cada "
            "dos anys i hi va respondre el 21,9 % de les empreses convidades. Eurostat no la publica: no es compara "
            "amb Europa ni amb altres països.",
        },
        fuente="Bundesamt für Statistik (BFS), con datos de la encuesta de innovación del KOF (ETH de Zúrich)",
        tabla=f"{GRAFICO} · «Total» · 2023",
        licencia=LICENCIA,
        url=URL_DEL_GRAFICO,
    )
}
# Lo que la definición tiene que decir, por lengua: el universo desde 5 personas y la definición simplificada.
FRASES = {
    "es": ("desde 5 personas empleadas", "versión simplificada de la definición de IA de Eurostat"),
    "ca": ("des de 5 persones ocupades", "versió simplificada de la definició d'IA d'Eurostat"),
}


def cifra_del_grafico(texto: str) -> dict[str, Any]:
    """La cifra de la fila «Total» en la columna del último año, con la clase menor que dice el universo.

    Returns:
        La cifra (porcentaje) del último año, con el universo y la clase menor que lo delimita.
    """
    filas = [linea.split(";") for linea in texto.strip().splitlines()]
    exigir(bool(filas), f"BFS: {ARCHIVO}, tabla vacía")
    cabecera = filas[0]
    exigir(
        cabecera[0] == CABECERA and len(cabecera) > 1 and all(col.isascii() and col.isdigit() for col in cabecera[1:]),
        "BFS: cabecera inesperada",
    )
    anios = [int(col) for col in cabecera[1:]]
    exigir(all(anterior < actual for anterior, actual in pairwise(anios)), "BFS: años repetidos o desordenados")
    exigir(all(len(fila) == len(cabecera) for fila in filas), "BFS: filas de distinta longitud")
    por_nombre = {fila[0]: fila[1:] for fila in filas[1:]}
    exigir(len(por_nombre) == len(filas) - 1, "BFS: filas repetidas")
    exigir(FILA_TOTAL in por_nombre, "BFS: sin la fila «Total»")
    exigir(CLASE_MENOR in por_nombre, f"BFS: sin la clase menor «{CLASE_MENOR}»")
    texto_cifra = por_nombre[FILA_TOTAL][-1]
    exigir(
        texto_cifra.isascii() and texto_cifra.replace(".", "", 1).isdigit(), f"BFS: cifra inesperada {texto_cifra!r}"
    )
    return {
        "valor": round(float(texto_cifra), 1),
        "anio": anios[-1],
        "grafico": GRAFICO,
        "fila": FILA_TOTAL,
        "clase_menor": CLASE_MENOR,
    }


def descargar(aceptar_cambio: bool = False) -> None:
    """Descarga el gráfico fijado; --aceptar-cambio permite variaciones de sus bytes, no otra edición."""
    cabecera = {"fuente": "Bundesamt für Statistik (BFS)", "cita": CITA, "licencia": LICENCIA}
    descargar_medida(FUENTE, cabecera, ARCHIVOS, aceptar_cambio)


def preparar() -> None:
    """Deja la cifra con su año, la fila leída y la clase de tamaño menor, literales."""
    comprobar_originales(FUENTE)
    cifra = cifra_del_grafico(original(FUENTE, ARCHIVO).read_text(encoding="utf-8-sig"))
    guardar_json(CIFRAS, {"paises": {PAIS: cifra}})
    print(f"Suiza: {cifra['valor']} % ({cifra['anio']})")


def _propios(controles: Controles, cifra: dict[str, Any], _procedencia: dict[str, Any]) -> None:
    """El gráfico, la fila «Total» y el universo desde 5 personas, literales; y la definición que lo dice."""
    controles.comprobar(cifra.get("grafico") == GRAFICO, f"Suiza: gráfico {GRAFICO}")
    controles.comprobar(cifra.get("fila") == FILA_TOTAL, "Suiza: fila «Total»")
    controles.comprobar(cifra.get("clase_menor") == CLASE_MENOR, "Suiza: la clase menor empieza en 5 personas")
    controles_del_indicador(controles, PAIS, INDICADORES_NACIONALES[PAIS], LICENCIA, FRASES)


def validar() -> None:
    """Comprueba la huella, la licencia, la cifra, el año (2023) y lo que dice la definición."""
    limites = (
        "Medida nacional: universo desde 5 personas empleadas, definición simplificada de la IA de Eurostat, encuesta "
        "bienal con un 21,9 % de respuesta; no se compara con Eurostat ni con otros países."
    )
    validar_medida(FUENTE, PAIS, range(2023, 2024), _propios, limites)


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
