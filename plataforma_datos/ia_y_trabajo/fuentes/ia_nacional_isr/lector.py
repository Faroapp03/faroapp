"""Uso de la IA por las empresas de Israel (CBS, encuesta de coyuntura, junio de 2025): su propio módulo.

La Oficina Central de Estadística de Israel (Central Bureau of Statistics, CBS) preguntó en el tema rotatorio de su
encuesta de coyuntura empresarial (Business Tendency Survey) de junio de 2025 si la empresa había usado inteligencia
artificial en los seis meses anteriores para producir bienes, prestar servicios o en su trabajo habitual, gratuita o de
pago (comunicado 216/2025). Según el comunicado, la encuesta abarca las empresas con 10 o más puestos de trabajo
asalariados de las ramas de esa encuesta; la clase de tamaño menor de la tabla es «11-50 employees». Eurostat no
publica a Israel, así que la cifra no está dos veces. No es la medida europea: es una encuesta de coyuntura, sin la
lista de tecnologías del cuestionario europeo, con un plazo de seis meses y en su primera edición. Por eso va como
medida nacional, con su definición y sin comparar.

El original es la tabla en porcentaje de empresas del comunicado (archivo 31_25_216t2.xlsx). Se lee la fila «Total»
de «Total of Industries»: la cifra es la suma de «Yes, which are provided for free only» y «Yes, including those that
are paid», que con «No» suman el 100 %. El año es el de la edición del comunicado (junio de 2025), que la tabla no
repite. Python estándar.

Uso: python3 -m plataforma_datos.ia_y_trabajo.fuentes.ia_nacional_isr.lector {descargar,preparar,validar,todo}
    [--aceptar-cambio]
"""

import sys
from typing import Any

from plataforma_datos.comun.entrada_salida import carpetas, comprobar_originales, guardar_json, original
from plataforma_datos.comun.hojas import filas_xlsx
from plataforma_datos.comun.nucleo import Controles, FormatoInesperado, exigir
from plataforma_datos.ia_y_trabajo.comun.medida_nacional import (
    controles_del_indicador,
    descargar_medida,
    indicador_nacional,
    validar_medida,
)
from plataforma_datos.orquestacion.ordenes import principal_fuente_con_descarga

FUENTE = "ia-nacional-isr"
PAIS = "ISR"
ORIGINAL, PREPARADO, VALIDADO = carpetas(FUENTE)
CIFRAS = PREPARADO / "cifras.json"
ARCHIVO = "cbs-31_25_216t2.xlsx"
URL = "https://www.cbs.gov.il/he/mediarelease/DocLib/2025/216/31_25_216t2.xlsx"
URL_DEL_COMUNICADO = "https://www.cbs.gov.il/he/mediarelease/DocLib/2025/216/31_25_216b.pdf"
URL_DE_LA_LICENCIA = "https://www.cbs.gov.il/en/Pages/Enduser-license.aspx"
# La edición del comunicado (junio de 2025): la tabla no lleva fecha.
ANIO = 2025
LICENCIA = (
    f"Licencia abierta del Central Bureau of Statistics (CBS) de Israel ({URL_DE_LA_LICENCIA}): uso libre, también "
    "comercial, con obras derivadas; se cita la fuente en la forma que fija la licencia y no se presenta como "
    "respaldado por el CBS ni por el Estado de Israel."
)
CITA = (
    f"The Central Bureau of Statistics (CBS), {ARCHIVO.removeprefix('cbs-')} (media release 216/2025, Business "
    f"Tendency Survey, June 2025), available online: {URL}, according to the CBS license at the website "
    f"{URL_DE_LA_LICENCIA}."
)
ARCHIVOS = [
    {
        "archivo": ARCHIVO,
        "nivel": "oficial",
        "titulo": "Central Bureau of Statistics (Israel), comunicado 216/2025: uso de la IA en las empresas en los "
        "seis meses anteriores, por rama y tamaño, en porcentaje de empresas (junio de 2025)",
        "url": URL,
        "licencia": LICENCIA,
    }
]
# Los textos literales de la tabla que dicen qué se mide: si cambian, la cifra puede medir otra cosa y se para.
PREGUNTA = (
    "Table 1- During the past six months, has your business made use of Artificial Intelligence (AI) for product "
    "manufacturing, service provision, or in routine operational workflows? by industry (Businesses)"
)
RESPUESTAS = ("Yes, which are provided for free only", "Yes, including those that are paid", "No", "% Businesses")
TOTAL_DE_RAMAS, TOTAL, CLASE_MENOR = "Total of Industries", "Total", "11-50 employees"
INDICADORES_NACIONALES: dict[str, dict[str, object]] = {
    PAIS: indicador_nacional(
        PAIS,
        nombre={
            "es": "Empresas que usan IA (Israel, medida nacional)",
            "ca": "Empreses que fan servir IA (Israel, mesura nacional)",
        },
        definicion={
            "es": "Porcentaje de empresas de Israel con 10 o más puestos de trabajo asalariados que usaron "
            "inteligencia artificial, gratuita o de pago, para producir bienes, prestar servicios o en su trabajo "
            "habitual en los seis meses anteriores a junio de 2025 (tema rotatorio de la encuesta de coyuntura "
            "empresarial de la Oficina Central de Estadística de Israel, CBS; primera edición; ramas de esa "
            "encuesta). Medida nacional: es una encuesta de coyuntura, sin la lista de tecnologías de la encuesta "
            "europea y con otro plazo. Eurostat no la publica: no se compara con Europa ni con otros países.",
            "ca": "Percentatge d'empreses d'Israel amb 10 o més llocs de treball assalariats que van fer servir "
            "intel·ligència artificial, gratuïta o de pagament, per produir béns, prestar serveis o en la seva feina "
            "habitual en els sis mesos anteriors al juny del 2025 (tema rotatori de l'enquesta de conjuntura "
            "empresarial de l'Oficina Central d'Estadística d'Israel, CBS; primera edició; branques d'aquesta "
            "enquesta). Mesura nacional: és una enquesta de conjuntura, sense la llista de tecnologies de l'enquesta "
            "europea i amb un altre termini. Eurostat no la publica: no es compara amb Europa ni amb altres països.",
        },
        fuente="Central Bureau of Statistics (CBS) de Israel, encuesta de coyuntura empresarial (Business Tendency "
        "Survey), tema rotatorio de junio de 2025",
        tabla="31_25_216t2.xlsx · Total of Industries · «Total» · sí, gratuita o de pago",
        licencia=LICENCIA,
        url=URL,
    )
}
# Lo que la definición tiene que decir, por lengua: el plazo, el instrumento y que es la primera edición.
FRASES = {
    "es": ("seis meses anteriores", "encuesta de coyuntura", "primera edición"),
    "ca": ("sis mesos anteriors", "enquesta de conjuntura", "primera edició"),
}
# Las tres respuestas suman el 100 %: con esta holgura de redondeo binario se comprueba que no falta ninguna.
HOLGURA_DE_LA_SUMA = 1e-9
# Índice de la fila con los textos de las respuestas (las anteriores son título y pregunta).
FILA_DE_RESPUESTAS = 3


def cifra_de_la_tabla(filas: list[dict[str, str]]) -> dict[str, Any]:
    """La suma de los dos «Yes» en la fila «Total» de todas las ramas, con los textos que dicen qué es.

    Returns:
        La cifra (porcentaje, suma de las dos respuestas) con los textos literales que dicen qué mide.

    Raises:
        FormatoInesperado: Si la sección es ambigua o incompleta, o alguna proporción no es válida.
    """
    exigir(
        len(filas) > FILA_DE_RESPUESTAS and filas[1].get("E") == PREGUNTA, "CBS: no es la tabla de empresas esperada"
    )
    exigir(tuple(filas[3].get(col) for col in "BCDE") == RESPUESTAS, "CBS: respuestas inesperadas")
    secciones = [i for i, fila in enumerate(filas) if fila.get("A") == TOTAL_DE_RAMAS]
    exigir(len(secciones) == 1, f"CBS: {ARCHIVO}: se espera una sección «Total of Industries» única")
    seccion = secciones[0]
    exigir(len(filas) > seccion + 2, f"CBS: {ARCHIVO}: sección «Total of Industries» truncada")
    total, menor = filas[seccion + 1], filas[seccion + 2]
    exigir(total.get("E") == TOTAL, "CBS: sin la fila «Total» de todas las ramas")
    proporciones = []
    for columna in "BCD":
        contexto = f"CBS: {ARCHIVO}, fila «Total», columna {columna}"
        try:
            proporcion = float(total[columna])
        except (KeyError, TypeError, ValueError) as error:
            raise FormatoInesperado(f"{contexto}: falta una proporción numérica") from error
        exigir(0 <= proporcion <= 1, f"{contexto}: la proporción debe estar entre 0 y 1")
        proporciones.append(proporcion)
    gratis, pago, no = proporciones
    exigir(abs(gratis + pago + no - 1) < HOLGURA_DE_LA_SUMA, "CBS: las respuestas no suman el 100 %")
    return {
        "valor": round((gratis + pago) * 100, 1),
        "anio": ANIO,
        "pregunta": filas[1]["E"],
        "respuestas": [filas[3]["B"], filas[3]["C"]],
        "clase_menor": menor.get("E", ""),
    }


def descargar(aceptar_cambio: bool = False) -> None:
    """Descarga la edición 216/2025; --aceptar-cambio permite variaciones de sus bytes, no otra edición."""
    cabecera = {"fuente": "Central Bureau of Statistics (CBS), Israel", "cita": CITA, "licencia": LICENCIA}
    descargar_medida(FUENTE, cabecera, ARCHIVOS, aceptar_cambio)


def preparar() -> None:
    """Deja la cifra con su año, la pregunta y la clase de tamaño menor, literales."""
    comprobar_originales(FUENTE)
    cifra = cifra_de_la_tabla(filas_xlsx(original(FUENTE, ARCHIVO), 1))
    guardar_json(CIFRAS, {"paises": {PAIS: cifra}})
    print(f"Israel: {cifra['valor']} % ({cifra['anio']})")


def _propios(controles: Controles, cifra: dict[str, Any], procedencia: dict[str, Any]) -> None:
    """La pregunta, las respuestas sumadas y la clase menor, literales; y la definición que lo dice."""
    # La tabla no lleva fecha: otra URL, incluso tras una redirección, no acredita el año del comunicado.
    archivos = procedencia["archivos"]
    controles.comprobar(
        len(archivos) == 1
        and archivos[0].get("archivo") == ARCHIVO
        and archivos[0].get("url") == URL
        and archivos[0].get("url_final") == URL,
        "Israel: el original corresponde al comunicado 216/2025, sin redirección a otra edición",
    )
    controles.comprobar(cifra.get("pregunta") == PREGUNTA, "Israel: la pregunta del CBS es la fijada, literal")
    controles.comprobar(cifra.get("respuestas") == list(RESPUESTAS[:2]), "Israel: suma de «Yes» gratuita y de pago")
    controles.comprobar(cifra.get("clase_menor") == CLASE_MENOR, "Israel: la clase menor es de 11 a 50 personas")
    controles_del_indicador(controles, PAIS, INDICADORES_NACIONALES[PAIS], LICENCIA, FRASES)


def validar() -> None:
    """Comprueba la huella, la licencia, la cifra, el año (2025) y lo que dice la definición."""
    limites = (
        "Medida nacional: encuesta de coyuntura de junio de 2025 (primera edición), empresas de 10 o más puestos "
        "asalariados de sus ramas, plazo de seis meses; no se compara con Eurostat ni con otros países."
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
