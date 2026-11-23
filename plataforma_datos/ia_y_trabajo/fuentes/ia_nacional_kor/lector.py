"""Uso de la IA generativa por las personas de Corea del Sur (MSIT, encuesta de uso de internet): su propio módulo.

El Ministerio de Ciencia y TIC de Corea (MSIT), con la agencia NIA, publica cada año la encuesta de uso de internet
(estadística nacional aprobada). La edición de 2025 (comunicado del 31/03/2026) encuesta a 50 750 personas de 3 o más
años de 22 671 hogares y da el porcentaje que ha usado alguna vez un servicio basado en IA generativa. Es una medida de
personas, aparte de las de empresas, y no es la europea: cuenta el uso «alguna vez» (la europea, los tres últimos
meses), empieza a los 3 años (la europea, a los 16) y el boletín no dice si la base es toda la población encuestada o
quienes usan internet. Por eso va como medida nacional, con su definición y sin comparar. Se lee la fila «생성형 AI 기반
서비스 경험률» del cuadro de resultados principales, columna del último año.

El original es el boletín del comunicado (ODT), que el portal oficial korea.kr publica con la licencia KOGL tipo 1.
Python estándar.

Uso: python3 -m plataforma_datos.ia_y_trabajo.fuentes.ia_nacional_kor.lector {descargar,preparar,validar,todo}
    [--aceptar-cambio]
"""

import re
import sys
import zipfile
from itertools import pairwise
from pathlib import Path
from typing import Any
from xml.etree import ElementTree

from plataforma_datos.comun.entrada_salida import carpetas, comprobar_originales, guardar_json, original
from plataforma_datos.comun.nucleo import Controles, FormatoInesperado, exigir, leer_del_zip
from plataforma_datos.ia_y_trabajo.comun.medida_nacional import (
    PREFIJO_DE_PERSONAS,
    controles_del_indicador,
    descargar_medida,
    indicador_nacional,
    validar_medida,
)
from plataforma_datos.orquestacion.ordenes import principal_fuente_con_descarga

FUENTE = "ia-nacional-kor"
PAIS = "KOR"
ORIGINAL, PREPARADO, VALIDADO = carpetas(FUENTE)
CIFRAS = PREPARADO / "cifras.json"
ARCHIVO = "msit-2025-encuesta-uso-internet.odt"
URL = "https://www.korea.kr/common/download.do?fileId=198408434&tblKey=GMN"
URL_DEL_COMUNICADO = "https://www.korea.kr/briefing/pressReleaseView.do?newsId=156751949"
URL_DE_LA_LICENCIA = "https://www.kogl.or.kr/info/licenseType1.do"
# La atribución que pide la licencia KOGL tipo 1, en la forma de su ejemplo, literal.
ATRIBUCION_KOGL = (
    "본 저작물은 '과학기술정보통신부'에서 '2026년' 작성하여 공공누리 제1유형으로 개방한 '「2025 인터넷이용실태조사」 "
    "결과 발표(작성자: 과학기술정보통신부)'을 이용하였으며, 해당 저작물은 '대한민국 정책브리핑, "
    f"{URL_DEL_COMUNICADO}'에서 무료로 다운받으실 수 있습니다."
)
LICENCIA = (
    f"Korea Open Government License (공공누리), tipo 1, atribución ({URL_DE_LA_LICENCIA}): uso libre, también "
    "comercial, con obras derivadas; se indica la fuente con su enlace y no se presenta como respaldado por el "
    f"organismo. «{ATRIBUCION_KOGL}»"
)
CITA = "Ministry of Science and ICT (MSIT) y NIA, 2025 Internet Usage Survey (2025 인터넷이용실태조사), 31/03/2026."
ARCHIVOS = [
    {
        "archivo": ARCHIVO,
        "nivel": "oficial",
        "titulo": "Ministerio de Ciencia y TIC de Corea (MSIT), comunicado de la encuesta de uso de internet 2025, "
        "con el cuadro de resultados principales (ODT)",
        "url": URL,
        "licencia": LICENCIA,
    }
]
# Los textos literales del boletín que dicen qué se mide y en quién: si cambian, se para.
FILA = "생성형 AI 기반 서비스 경험률"
COLUMNA_DEL_CAMBIO = "증감 %p(전년대비)"
UNIVERSO = "만 3세 이상 가구원 50,750명"
PREGUNTA = "생성형 인공지능 서비스를 경험해 봤다는 응답은"
TABLA_ODF = "{urn:oasis:names:tc:opendocument:xmlns:table:1.0}"
INDICADORES_NACIONALES: dict[str, dict[str, object]] = {
    PAIS: indicador_nacional(
        PAIS,
        PREFIJO_DE_PERSONAS,
        nombre={
            "es": "Personas que han usado IA generativa (Corea del Sur, medida nacional)",
            "ca": "Persones que han fet servir IA generativa (Corea del Sud, mesura nacional)",
        },
        definicion={
            "es": "Porcentaje de personas de Corea del Sur que han usado alguna vez un servicio basado en "
            "inteligencia artificial generativa, en 2025 (encuesta de uso de internet del Ministerio de Ciencia y TIC, "
            "MSIT, y la agencia NIA; 50 750 personas de 22 671 hogares). Medida nacional de personas: cuenta el uso "
            "alguna vez, sin el plazo de tres meses de la encuesta europea, incluye a las personas desde los 3 años y "
            "el boletín no dice si la base es toda la población encuestada o quienes usan internet. Eurostat no la "
            "publica: no se compara con Europa ni con otros países.",
            "ca": "Percentatge de persones de Corea del Sud que han fet servir alguna vegada un servei basat en "
            "intel·ligència artificial generativa, el 2025 (enquesta d'ús d'internet del Ministeri de Ciència i TIC, "
            "MSIT, i l'agència NIA; 50.750 persones de 22.671 llars). Mesura nacional de persones: compta l'ús alguna "
            "vegada, sense el termini de tres mesos de l'enquesta europea, inclou les persones des dels 3 anys i el "
            "butlletí no diu si la base és tota la població enquestada o qui fa servir internet. Eurostat no la "
            "publica: no es compara amb Europa ni amb altres països.",
        },
        fuente="Ministerio de Ciencia y TIC de Corea (MSIT) y NIA, encuesta de uso de internet",
        tabla=f"Cuadro de resultados principales · «{FILA}» · 2025",
        licencia=LICENCIA,
        url=URL_DEL_COMUNICADO,
    )
}
# Lo que la definición tiene que decir, por lengua: «alguna vez», la edad desde 3 años y la base sin precisar.
FRASES = {
    "es": ("alguna vez", "desde los 3 años", "no dice si la base"),
    "ca": ("alguna vegada", "des dels 3 anys", "no diu si la base"),
}


def _texto(elemento: ElementTree.Element) -> str:
    """El texto de un elemento ODF con los espacios normalizados (el ODF parte las frases en tramos).

    Returns:
        El texto del elemento, con los espacios simples.
    """
    return re.sub(r"\s+", " ", "".join(elemento.itertext())).strip()


def cifra_del_boletin(contenido: bytes) -> dict[str, Any]:
    """La cifra del último año en la fila de la IA generativa, con el universo y la pregunta, literales.

    Returns:
        La cifra (porcentaje) del último año, con el universo y la pregunta literales.

    Raises:
        FormatoInesperado: Si la tabla no tiene la forma esperada.
    """
    try:
        raiz = ElementTree.fromstring(contenido)
    except ElementTree.ParseError as error:
        raise FormatoInesperado(f"MSIT: XML ilegible ({error})") from error
    elegidas_por_tabla = []
    for tabla in raiz.iter(f"{TABLA_ODF}table"):
        filas = [
            [_texto(celda) for celda in fila.iter(f"{TABLA_ODF}table-cell")]
            for fila in tabla.iter(f"{TABLA_ODF}table-row")
        ]
        elegidas = [fila for fila in filas if FILA in fila]
        if not elegidas:
            continue
        exigir(len(elegidas) == 1, f"MSIT: la fila «{FILA}» aparece {len(elegidas)} veces")
        elegidas_por_tabla.append((filas, elegidas[0]))
    exigir(len(elegidas_por_tabla) == 1, f"MSIT: {len(elegidas_por_tabla)} tablas con la fila «{FILA}»")
    filas, fila = elegidas_por_tabla[0]
    cabecera = filas[0]
    anios, valores = cabecera[2:], fila[fila.index(FILA) + 1 :]
    exigir(
        len(anios) > 1
        and len(anios) == len(valores)
        and anios[-1] == COLUMNA_DEL_CAMBIO
        and anios.count(COLUMNA_DEL_CAMBIO) == 1,
        "MSIT: columnas inesperadas",
    )
    anios_numericos = []
    for columna in anios[:-1]:
        anio = re.fullmatch(r"‘([0-9]{2})년", columna)
        exigir(anio is not None, f"MSIT: año inesperado {columna!r}")
        anios_numericos.append(2000 + int(anio.group(1)))
    exigir(
        all(antes < despues for antes, despues in pairwise(anios_numericos)),
        "MSIT: años repetidos o fuera de orden",
    )
    valor = valores[-2]
    exigir(re.fullmatch(r"[0-9]+\.[0-9]", valor) is not None, f"MSIT: cifra inesperada {valor!r}")
    cuerpo = _texto(raiz)
    return {
        "valor": float(valor),
        "anio": anios_numericos[-1],
        "fila": FILA,
        "universo": UNIVERSO if UNIVERSO in cuerpo else "",
        "pregunta": PREGUNTA if PREGUNTA in cuerpo else "",
    }


def leer_boletin(ruta: Path) -> bytes:
    """El contenido (content.xml) del boletín ODT, con el tope de lectura de los archivos comprimidos.

    Returns:
        Los bytes XML de content.xml, sin decodificar.
    """
    with zipfile.ZipFile(ruta) as libro:
        return leer_del_zip(libro, "content.xml")


def descargar(aceptar_cambio: bool = False) -> None:
    """Descarga el boletín de 2025; --aceptar-cambio permite variaciones de sus bytes, no otra edición."""
    cabecera = {"fuente": "Ministry of Science and ICT (MSIT), Corea", "cita": CITA, "licencia": LICENCIA}
    descargar_medida(FUENTE, cabecera, ARCHIVOS, aceptar_cambio)


def preparar() -> None:
    """Deja la cifra con su año, la fila leída, el universo y la pregunta, literales."""
    comprobar_originales(FUENTE)
    cifra = cifra_del_boletin(leer_boletin(original(FUENTE, ARCHIVO)))
    guardar_json(CIFRAS, {"paises": {PAIS: cifra}})
    print(f"Corea del Sur: {cifra['valor']} % ({cifra['anio']})")


def _propios(controles: Controles, cifra: dict[str, Any], _procedencia: dict[str, Any]) -> None:
    """La fila, el universo desde 3 años y la pregunta «alguna vez», literales; y la definición que lo dice."""
    controles.comprobar(cifra.get("fila") == FILA, "Corea del Sur: fila de la IA generativa, literal")
    controles.comprobar(cifra.get("universo") == UNIVERSO, "Corea del Sur: personas de 3 o más años, literal")
    controles.comprobar(cifra.get("pregunta") == PREGUNTA, "Corea del Sur: uso «alguna vez», literal")
    controles_del_indicador(controles, PAIS, INDICADORES_NACIONALES[PAIS], LICENCIA, FRASES)


def validar() -> None:
    """Comprueba la huella, la licencia, la cifra, el año (2025) y lo que dice la definición."""
    limites = (
        "Medida nacional de personas: uso alguna vez de la IA generativa, desde los 3 años, base sin precisar en el "
        "boletín; no se compara con Eurostat ni con otros países."
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
