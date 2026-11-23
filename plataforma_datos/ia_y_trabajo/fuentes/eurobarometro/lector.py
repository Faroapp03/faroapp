"""Opinión, no medida: el Eurobarómetro especial 554 («Artificial Intelligence and the future of work», 2024).

Encuesta de opinión de la Comisión Europea (oleada 101.4, campo del 25/04 al 22/05/2024, personas de 15 años o más).
No mide la exposición a la IA ni su uso: dice lo que la gente opina. Por eso va en el bloque `encuestas` del archivo
de datos globales, con `naturaleza: "opinion"`, nunca entre los indicadores medidos. Se leen del volumen A (resultados
por país, xlsx) las diez preguntas que publica Faro: QB5 (percepción de los robots y la IA en el trabajo, «Total
'Positively'»), QB6.1, QB6.2 y QB6.3 (afirmaciones sobre los robots y la IA, «Total 'Agree'»), QB11.1 a QB11.5
(importancia de cada regla para la IA en el trabajo, «Total 'Important'») y QB3 (el empleador da herramientas o
formación, «Total 'Agree'», solo quienes trabajan para un empleador), en la UE-27, España, Alemania, Francia e Italia,
como porcentajes enteros, como los publica el Eurobarómetro. El texto literal de cada pregunta, su base y su campo se
vigilan. El xlsx se lee con la biblioteca estándar (zip y XML). Python estándar.

Uso: python3 -m plataforma_datos.ia_y_trabajo.fuentes.eurobarometro.lector {descargar,preparar,validar,todo}
    [--aceptar-cambio]
"""

import datetime
import sys
from decimal import ROUND_HALF_UP, Decimal
from typing import TypedDict

from plataforma_datos.comun.entrada_salida import (
    ahora_utc,
    carpetas,
    controles_de_huella,
    guardar_json,
    leer_json,
    original,
)
from plataforma_datos.comun.hojas import filas_xlsx_por_nombre
from plataforma_datos.comun.nucleo import (
    ARCHIVO_DE_PROCEDENCIA,
    ArchivoDescargable,
    Controles,
    FormatoInesperado,
    exigir,
)
from plataforma_datos.comun.red import descargar_originales
from plataforma_datos.orquestacion.admision import cerrar_validacion
from plataforma_datos.orquestacion.ordenes import principal_fuente_con_descarga

FUENTE = "eurobarometro"
ORIGINAL, PREPARADO, VALIDADO = carpetas(FUENTE)
PROCEDENCIA = ORIGINAL / ARCHIVO_DE_PROCEDENCIA
HOJAS = PREPARADO / "hojas.json"
ARCHIVO = "SP554_Volume_A.xlsx"
URL = "https://webgate.ec.europa.eu/ebsm/api/public/odp/download?key=C94326A822DF47FB19DF4F6700A24CE1"
URL_DEL_CONJUNTO = "https://data.europa.eu/data/datasets/s3222_101_4_sp554_eng"
LICENCIA_EUROBAROMETRO = (
    "Política de reutilización de la Comisión Europea (Decisión 2011/833/UE): reutilización autorizada, también "
    "comercial, citando la fuente (© Unión Europea, Eurobarómetro especial 554)."
)
CITA = (
    "Comisión Europea, Eurobarómetro especial 554 «Artificial Intelligence and the future of work» (oleada 101.4, "
    "2024), volumen A, en data.europa.eu (s3222_101_4_sp554_eng)."
)
ARCHIVOS: list[ArchivoDescargable] = [
    {
        "archivo": ARCHIVO,
        "nivel": "oficial",
        "titulo": "Eurobarómetro especial 554, volumen A (resultados por país), xlsx",
        "url": URL,
        "licencia": LICENCIA_EUROBAROMETRO,
    }
]
ANIO = 2024
CAMPO = "Terrain/Fieldwork :  25/04 - 22/05/2024"
# El campo y la fuente como los muestra el archivo de datos globales (`derivados/fuentes/datos_globales/lector.py`,
# bloque `encuestas`).
CAMPO_LEGIBLE = "25/04/2024 – 22/05/2024"
FUENTE_LEGIBLE = "Comisión Europea, Eurobarómetro especial 554"
BASE = "Base: All respondents"
BASE_CON_EMPLEADOR = "Base: Respondents who work for an employer or manager"
# La base literal de cada pregunta → cómo se dice en el archivo de datos globales.
BASES = {
    BASE: "Personas de 15 años o más (All respondents)",
    BASE_CON_EMPLEADOR: "Personas que trabajan para un empleador o un jefe (Respondents who work for an employer or "
    "manager)",
}
# Las preguntas que no se hacen a todas las personas, con su base; las demás, BASE.
BASE_DE_LA_PREGUNTA = {"QB3": BASE_CON_EMPLEADOR}
_AFIRMACIONES = "Please tell me to what extent you agree or disagree with each of the following statements."
_REGLAS = (
    "How important, if at all, do you think the following rules would be in addressing risks and maximizing the "
    "benefits of digital technologies, including Artificial Intelligence, in the workplace?"
)
# Cada pregunta: hoja, fila del total que se publica y texto literal (pregunta y, si la hay, afirmación).
PREGUNTAS = {
    "QB5": (
        "Total 'Positively'",
        "QB5. How positively or negatively do you perceive the use of robots and Artificial Intelligence in the "
        "workplace?",
    ),
    "QB6_1": (
        "Total 'Agree'",
        f"QB6.1. {_AFIRMACIONES} Due to the use of robots and Artificial Intelligence, more jobs will disappear than "
        "new jobs will be created",
    ),
    "QB6_2": (
        "Total 'Agree'",
        f"QB6.2. {_AFIRMACIONES} Robots and Artificial Intelligence are a good thing for society, because they help "
        "people do their jobs or carry out daily tasks at home",
    ),
    "QB6_3": (
        "Total 'Agree'",
        f"QB6.3. {_AFIRMACIONES} Robots and Artificial Intelligence are technologies that require careful management",
    ),
    "QB11_1": ("Total 'Important'", f"QB11.1. {_REGLAS} Protecting workers' privacy"),
    "QB11_2": ("Total 'Important'", f"QB11.2. {_REGLAS} Prohibiting fully automated decision-making processes"),
    "QB11_3": ("Total 'Important'", f"QB11.3. {_REGLAS} Limiting the automated monitoring of employees"),
    "QB11_4": (
        "Total 'Important'",
        f"QB11.4. {_REGLAS} Enforcing more transparency in the use of digital technologies to handle HR "
        "decision-making",
    ),
    "QB11_5": (
        "Total 'Important'",
        f"QB11.5. {_REGLAS} Involving workers and their representatives in the design and adoption of new technologies",
    ),
    "QB3": (
        "Total 'Agree'",
        "QB3. To what extent do you agree or disagree that your employer provides you with the necessary tools or "
        "training to work effectively with the most recent digital technologies, including Artificial Intelligence?",
    ),
}
# La cabecera de la columna de la UE-27 en el volumen A: la fila que la lleva es la de los países.
COLUMNA_UE27 = "UE27\nEU27"
# Columna del volumen A (cabecera) → código del contrato.
TERRITORIOS = {COLUMNA_UE27: "EU27_2020", "ES": "ESP", "DE": "DEU", "FR": "FRA", "IT": "ITA"}
# Las primeras filas de cada hoja, donde van la pregunta, el campo y la base; y la columna de su texto en inglés.
FILAS_DE_CABECERA = 8
COLUMNA_DEL_TEXTO = "H"
COLUMNA_DE_LOS_PAISES = "C"
COLUMNA_DEL_TOTAL = "B"
# Cómo empiezan, en esa cabecera, el campo y la base.
PREFIJO_DEL_CAMPO = "Terrain"
PREFIJO_DE_LA_BASE = "Base:"
# Los porcentajes enteros del volumen A del Eurobarómetro especial 554, leídos el 11/10/2026: la lectura tiene que
# darlos.
REFERENCIA = {
    "QB5": {"EU27_2020": 62, "ESP": 56, "DEU": 65, "FRA": 53, "ITA": 61},
    "QB6_1": {"EU27_2020": 66, "ESP": 74, "DEU": 53, "FRA": 71, "ITA": 71},
    "QB6_2": {"EU27_2020": 63, "ESP": 64, "DEU": 63, "FRA": 53, "ITA": 64},
    "QB6_3": {"EU27_2020": 84, "ESP": 80, "DEU": 85, "FRA": 92, "ITA": 78},
    "QB11_1": {"EU27_2020": 82, "ESP": 79, "DEU": 86, "FRA": 84, "ITA": 81},
    "QB11_2": {"EU27_2020": 74, "ESP": 70, "DEU": 71, "FRA": 80, "ITA": 75},
    "QB11_3": {"EU27_2020": 72, "ESP": 66, "DEU": 74, "FRA": 79, "ITA": 72},
    "QB11_4": {"EU27_2020": 75, "ESP": 71, "DEU": 71, "FRA": 78, "ITA": 79},
    "QB11_5": {"EU27_2020": 77, "ESP": 74, "DEU": 78, "FRA": 78, "ITA": 81},
    "QB3": {"EU27_2020": 68, "ESP": 78, "DEU": 62, "FRA": 65, "ITA": 65},
}


class Pregunta(TypedDict):
    """Lo que se lee de la hoja de una pregunta: campo, base, texto y proporción publicada por territorio."""

    campo: str
    base: str
    pregunta: str
    proporciones: dict[str, str]


def _es_proporcion(texto: str) -> bool:
    """Dice si una celda es una proporción entre 0 y 1 (la fila publicada), no un número de entrevistas.

    Args:
        texto: Valor de la celda.

    Returns:
        `True` si es un número decimal entre 0 y 1.
    """
    if not isinstance(texto, str):
        return False
    try:
        numero = Decimal(texto)
        return numero.is_finite() and Decimal(0) <= numero <= 1
    except ArithmeticError:
        return False


def leer_pregunta(filas: list[dict[str, str]], total: str) -> Pregunta:
    """El texto en inglés (columna H) de la cabecera, el campo, la base y el total publicado de cada territorio.

    Cada respuesta tiene dos filas: las entrevistas (con la etiqueta en francés) y la proporción (en inglés). Cuando las
    dos etiquetas coinciden («Total 'Important'»), la publicada es la única de proporciones.

    Args:
        filas: Filas de la hoja de la pregunta, como `{columna: texto}`.
        total: Etiqueta de la fila del total publicado («Total 'Agree'»…).

    Returns:
        El campo, la base, el texto de la pregunta y la proporción publicada de cada territorio.

    Raises:
        FormatoInesperado: Si la hoja no tiene la cabecera de países o no tiene una sola fila de proporciones.
    """
    textos = [fila.get(COLUMNA_DEL_TEXTO, "") for fila in filas[:FILAS_DE_CABECERA] if fila.get(COLUMNA_DEL_TEXTO)]
    cabeceras = [fila for fila in filas if fila.get(COLUMNA_DE_LOS_PAISES) == COLUMNA_UE27]
    exigir(len(cabeceras) == 1, f"la hoja no tiene una sola cabecera de países ({len(cabeceras)})")
    cabecera = cabeceras[0]
    for territorio in TERRITORIOS:
        exigir(
            list(cabecera.values()).count(territorio) <= 1,
            f"territorio {territorio!r} duplicado en la cabecera de países",
        )
    columnas = {codigo: columna for columna, codigo in cabecera.items()}
    claves = [columnas.get(clave, "") for clave in TERRITORIOS]
    candidatas = [
        fila
        for fila in filas
        if fila.get(COLUMNA_DEL_TOTAL) == total and all(_es_proporcion(fila.get(columna, "")) for columna in claves)
    ]
    exigir(len(candidatas) == 1, f"la hoja no tiene una sola fila de proporciones «{total}» ({len(candidatas)})")
    fila_total = candidatas[0]
    return {
        "campo": next((texto for texto in textos if texto.startswith(PREFIJO_DEL_CAMPO)), ""),
        "base": next((texto for texto in textos if texto.startswith(PREFIJO_DE_LA_BASE)), ""),
        "pregunta": " ".join(
            texto for texto in textos if not texto.startswith((PREFIJO_DEL_CAMPO, PREFIJO_DE_LA_BASE))
        ),
        "proporciones": {codigo: fila_total.get(columnas.get(clave, ""), "") for clave, codigo in TERRITORIOS.items()},
    }


def porcentaje_entero(proporcion: str) -> int:
    """Convierte una proporción del volumen A (0.56000000000000005) en el porcentaje entero publicado (56).

    Args:
        proporcion: Proporción tal como la guarda el libro.

    Returns:
        El porcentaje redondeado al entero, con las mitades hacia arriba.
    """
    exigir(_es_proporcion(proporcion), f"proporción inválida del Eurobarómetro: {proporcion!r}")
    return int((Decimal(proporcion) * 100).quantize(Decimal(1), rounding=ROUND_HALF_UP))


def _comprobar_hojas(hojas: object) -> None:
    """Exige el preparado de las diez preguntas y sus proporciones, con contexto de archivo y celda."""
    exigir(isinstance(hojas, dict), f"{HOJAS.name}: se esperaba un objeto de preguntas")
    faltantes = set(PREGUNTAS) - hojas.keys()
    exigir(not faltantes, f"{HOJAS.name}: faltan preguntas {sorted(faltantes)}")
    territorios = set(TERRITORIOS.values())
    for hoja in PREGUNTAS:
        pregunta = hojas[hoja]
        contexto = f"{HOJAS.name}, {hoja}"
        exigir(isinstance(pregunta, dict), f"{contexto}: se esperaba un objeto")
        for campo in ("pregunta", "base", "campo"):
            exigir(isinstance(pregunta.get(campo), str), f"{contexto}: {campo} no es texto")
        proporciones = pregunta.get("proporciones")
        exigir(isinstance(proporciones, dict), f"{contexto}: proporciones no es un objeto")
        diferencia = territorios ^ proporciones.keys()
        exigir(not diferencia, f"{contexto}: territorios ausentes o inesperados {sorted(diferencia)}")
        for codigo, valor in proporciones.items():
            exigir(_es_proporcion(valor), f"{contexto}, {codigo}: proporción inválida {valor!r}")


def _consulta_del_libro(procedencia: object) -> str:
    """Fecha civil de la única entrada del xlsx, sin convertir su huso horario.

    Returns:
        El día declarado de descarga del volumen A.

    Raises:
        FormatoInesperado: Si falta la entrada única o su fecha no es válida, con archivo y campo.
    """
    exigir(isinstance(procedencia, dict), f"{ARCHIVO}: procedencia sin objeto archivos")
    archivos = procedencia.get("archivos")
    exigir(isinstance(archivos, list), f"{ARCHIVO}: procedencia sin lista archivos")
    exigir(all(isinstance(entrada, dict) for entrada in archivos), f"{ARCHIVO}: archivos contiene una entrada inválida")
    entradas = [entrada for entrada in archivos if entrada.get("archivo") == ARCHIVO]
    exigir(len(entradas) == 1, f"{ARCHIVO}: se esperaba una única entrada en archivos ({len(entradas)})")
    fecha = entradas[0].get("descargado_utc")
    exigir(isinstance(fecha, str), f"{ARCHIVO}: descargado_utc no es una fecha de texto")
    try:
        return datetime.datetime.fromisoformat(fecha).date().isoformat()
    except ValueError as error:
        raise FormatoInesperado(f"{ARCHIVO}: descargado_utc no es una fecha válida: {fecha!r}") from error


def descargar(aceptar_cambio: bool = False) -> None:
    """Descarga el volumen A; una versión distinta se detiene hasta aceptarla a propósito."""
    guardar_json(
        PROCEDENCIA,
        {
            "fuente": "Comisión Europea · Eurobarómetro especial 554",
            "cita": CITA,
            "licencia": LICENCIA_EUROBAROMETRO,
            "archivos": descargar_originales(ARCHIVOS, ORIGINAL, aceptar_cambio),
        },
    )


def preparar() -> None:
    """Guarda, de cada pregunta, su texto, su base, su campo y el total publicado por territorio."""
    filas = filas_xlsx_por_nombre(original(FUENTE, ARCHIVO), PREGUNTAS)
    hojas = {hoja: leer_pregunta(filas[hoja], total) for hoja, (total, _) in PREGUNTAS.items()}
    guardar_json(HOJAS, hojas)
    print(f"{len(hojas)} preguntas del Eurobarómetro especial 554")


def validar() -> None:
    """Comprueba el texto, la base y el campo de cada pregunta y sus cifras publicadas, y guarda el conjunto."""
    hojas, procedencia = leer_json(HOJAS), leer_json(PROCEDENCIA)
    _comprobar_hojas(hojas)
    consulta = _consulta_del_libro(procedencia)
    controles = Controles()
    controles_de_huella(controles, ORIGINAL, procedencia)
    distintas = [hoja for hoja, (_, texto) in PREGUNTAS.items() if hojas[hoja]["pregunta"] != texto]
    controles.comprobar(
        not distintas, "el texto literal de cada pregunta" + (f"; cambia: {distintas}" if distintas else "")
    )
    controles.comprobar(
        all(
            hojas[hoja]["base"] == BASE_DE_LA_PREGUNTA.get(hoja, BASE) and hojas[hoja]["campo"] == CAMPO
            for hoja in PREGUNTAS
        ),
        f"la base de cada pregunta («{BASE}», salvo {sorted(BASE_DE_LA_PREGUNTA)}) y su campo",
    )
    cifras = {
        hoja: {codigo: porcentaje_entero(valor) for codigo, valor in hojas[hoja]["proporciones"].items()}
        for hoja in PREGUNTAS
    }
    controles.comprobar(cifras == REFERENCIA, f"los porcentajes enteros publicados en el volumen A; leídos: {cifras}")
    conjunto = {
        "cita": CITA,
        "licencia": LICENCIA_EUROBAROMETRO,
        "url": URL_DEL_CONJUNTO,
        "consultado": consulta,
        "anio": ANIO,
        "preguntas": {
            hoja: {
                "pregunta": PREGUNTAS[hoja][1],
                "respuesta": PREGUNTAS[hoja][0],
                "base": BASES[BASE_DE_LA_PREGUNTA.get(hoja, BASE)],
                "cifras": cifras[hoja],
            }
            for hoja in PREGUNTAS
        },
    }
    informe = {
        "estado": controles.estado,
        "comprobado_utc": ahora_utc(),
        "cobertura": {"preguntas": len(PREGUNTAS), "territorios": len(TERRITORIOS)},
        "limites": (
            "Opinión de personas de 15 años o más (QB3, solo de quienes trabajan para un empleador), no una "
            "medida de la exposición ni del uso de la IA. Porcentajes enteros, como los publica el Eurobarómetro."
        ),
        "controles": controles.lista,
    }
    cerrar_validacion(FUENTE, informe, controles, lambda: conjunto)


def main(argv: list[str] | None = None) -> int:
    """Ejecuta la etapa pedida del Eurobarómetro especial 554: descargar, preparar, validar o todo.

    Args:
        argv: Argumentos de la línea de órdenes; `None` lee los del proceso.

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
