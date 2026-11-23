"""ODEE / Cambra de Comerç de Barcelona (2026): exposición a la IA y personas ocupadas por sexo en Cataluña.

El ODEE y la Cambra enviaron la tabla completa de su estudio, con autorización escrita para usarla en Faro (ver la
procedencia): para cada una de las 163 ocupaciones de la CNO-11 a 3 cifras, la puntuación de exposición potencial de
la OIT (media y máximo de las ocupaciones ISCO-08 de 4 cifras del grupo ISCO de 3 cifras que le corresponde), su nivel
en la escala propia del estudio (cinco tramos de 0,1: nivel 1 por debajo de 0,2 … nivel 5 desde 0,5; no son los
gradientes de la OIT ni las franjas de Faro) y las personas ocupadas por sexo (Cens de població i habitatges 2022). Se
lee con el lector propio de .xls (hojas.py) y se comprueba que reproduce exactamente las cifras que publica el
estudio: el reparto por sexo (pág. impresa 14) y la Taula 4 (pág. impresa 21).

La Taula 13 (personas contratadas por ocupación, pág. impresa 38) no está en la tabla: sus cifras se transcriben del PDF
publicado, con su página, y se comprueban con sus variaciones e índices y, en `mercado/fuentes/cataluna/lector.py`, con
el Observatori.

Uso en el informe: solo el reparto por sexo de toda Cataluña, citado con su escala y su censo (2022), como contexto
colectivo: nunca ajusta la nota de una persona. Es exposición potencial, no adopción en las empresas ni pérdida de
empleo. Las cifras por ocupación del informe salen del INE (Censo 2021) y del Observatori del Treball para todas las
ocupaciones (`mercado/fuentes/cataluna/lector.py`), que se contrastan con la Taula 4 y la Taula 13. Depende de la
validación de las clasificaciones (códigos CNO-11). Python estándar.

Uso: python3 -m plataforma_datos.ia_y_trabajo.fuentes.cambra.lector {descargar,preparar,validar,todo}
"""

import math
import re
import sys
from pathlib import Path
from typing import Any, NamedTuple

from plataforma_datos.comun.entrada_salida import (
    ahora_utc,
    carpetas,
    comprobar_originales,
    guardar_jsonl,
    leer_jsonl,
    original,
)
from plataforma_datos.comun.hojas import leer_xls
from plataforma_datos.comun.nucleo import Controles, FormatoInesperado, exigir
from plataforma_datos.comun.red import aviso_descarga_manual
from plataforma_datos.comun.textos_y_cifras import numero_es
from plataforma_datos.ocupaciones.fuentes.clasificaciones.lector import codigos_en_cno
from plataforma_datos.orquestacion.admision import cerrar_validacion, leer_validado
from plataforma_datos.orquestacion.ordenes import principal_fuente

FUENTE = "cambra"
ORIGINAL, PREPARADO, _ = carpetas(FUENTE)
# Lo que escribe preparar y lee validar (y, desde el conjunto validado, `mercado/fuentes/cataluna/lector.py`).
OCUPACIONES = PREPARADO / "ocupaciones-cno3.jsonl"
CONTRATACION = PREPARADO / "contratacion-cno4.jsonl"
PDF = "informe-odee-cambra-2026.pdf"
TABLA = "iaexpo-desagregados-2022-genero.xls"
CITA = (
    "Observatori Dona, Empresa i Economia, Cambra de Comerç de Barcelona (2026). Impacte de la IA generativa sobre el "
    "mercat laboral: una anàlisi amb perspectiva de gènere i edat."
)
FUENTE_CORTA = "ODEE, Cambra de Comerç de Barcelona (2026)"
FUENTE_PRIMARIA_OCUPADOS = "Cens de població i habitatges (2022)"

# Columnas de la tabla, en la fila 1 de su única hoja, con el nombre del campo preparado que les corresponde.
COLUMNAS = {
    "Mean_mean": "puntuacion_media",
    "Mean_max": "puntuacion_maxima",
    "n_4digit": "ocupaciones_isco_4_cifras",
    "gradient3d_mean5": "nivel_media",
    "gradient3d_max5": "nivel_maxima",
    "cno11_3d": "cno11",
    "titulo_censo_2022": "titulo",
    "homes": "hombres",
    "dones": "mujeres",
    "total": "total",
}
CAMPOS_ENTEROS = ("ocupaciones_isco_4_cifras", "nivel_media", "nivel_maxima", "hombres", "mujeres", "total")
# El título lleva delante el código del estudio entre corchetes: «[P960] Peons construcció i mineria».
TITULO_CON_CODIGO = re.compile(r"^\[(\w+)\]\s*(.+)$")
OCUPACIONES_ESTUDIO = 163

# Escala propia del estudio: cinco niveles por tramos de 0,1 de la puntuación de la OIT. No son los gradientes de la
# OIT ni las franjas de Faro (media desde 0,4 y alta desde 0,6): su «alta» empieza en 0,5.
CORTES_NIVEL = (0.2, 0.3, 0.4, 0.5)
NIVEL_NO_EXPUESTA = 1  # puntuación por debajo de 0,2
NIVEL_MEDIA_O_ALTA = 4  # puntuación de 0,4 o más
NIVEL_ALTA = 5  # puntuación de 0,5 o más
# Qué niveles cuenta cada cifra por sexo que publica el estudio.
NIVELES_DE_LA_CIFRA = {
    "no_expuestas": (NIVEL_NO_EXPUESTA,),
    "media_o_alta": (NIVEL_MEDIA_O_ALTA, NIVEL_ALTA),
    "alta": (NIVEL_ALTA,),
}
# Texto de la pág. impresa 14 (pág. 15 del PDF): % de las mujeres y de los hombres ocupados en Cataluña, sin decimales,
# en ocupaciones no expuestas, de exposición media o alta y de exposición alta. La tabla tiene que reproducirlas.
GENERO_PUBLICADO = {
    "no_expuestas": {"mujeres": 23, "hombres": 34},
    "media_o_alta": {"mujeres": 30, "hombres": 23},
    "alta": {"mujeres": 21, "hombres": 11},
}
PAGINA_GENERO = {"pagina_impresa": 14, "pagina_pdf": 15}

# Taula 4 (pág. impresa 21, pág. 22 del PDF): las 25 ocupaciones que lista el estudio, en su orden. Sus personas
# ocupadas y su % de mujeres salen de la tabla; la fila de totales publicada (ocupados, % sobre la ocupación total y %
# de mujeres) comprueba que es la misma selección.
TAULA4 = (
    "430",
    "450",
    "351",
    "361",
    "411",
    "412",
    "271",
    "442",
    "382",
    "381",
    "261",
    "441",
    "352",
    "353",
    "265",
    "292",
    "422",
    "272",
    "241",
    "444",
    "264",
    "340",
    "291",
    "421",
    "443",
)


class TotalDeLaTaula4(NamedTuple):
    """La fila de totales publicada de la Taula 4."""

    ocupados: int
    pct_ocupacion_total: float
    pct_mujeres: float


TOTAL4 = TotalDeLaTaula4(ocupados=697526, pct_ocupacion_total=22.5, pct_mujeres=56.2)
PAGINA_TAULA4 = {"pagina_impresa": 21, "pagina_pdf": 22}

# Taula 13 (pág. impresa 38, pág. 39 del PDF), transcrita del PDF publicado porque no está en la tabla. Fuente primaria:
# Observatori del Treball i Model Productiu (2025). 12 meses acumulados a septiembre de 2023 y de 2025; índice 100 =
# variación del conjunto (−2,4 %). La nota de la tabla dice «contractes», pero la metodología del estudio (pág. 30) mide
# PERSONAS CONTRATADAS: los campos contratos_2023 y contratos_2025 conservan su nombre original, pero son personas
# (cuadran con el Observatori; ver `mercado/fuentes/cataluna/lector.py`).


class FilaDeLaTaula13(NamedTuple):
    """Una fila de la Taula 13 tal como se publica: ocupación, contratadas de los dos años, variación e índice."""

    cno11: str
    ocupacion_ca: str
    contratos_2023: int
    contratos_2025: int
    variacion_pct: float
    indice: int


TAULA13 = [
    FilaDeLaTaula13("4423", "Telefonistes", 2020, 1553, -23.1, 79),
    FilaDeLaTaula13("4421", "Empleats d'agències de viatges", 1948, 1539, -21.0, 81),
    FilaDeLaTaula13("4424", "Teleoperadors", 13130, 10437, -20.5, 81),
    FilaDeLaTaula13("2712", "Analistes i dissenyadors de programari", 1952, 1645, -15.7, 86),
    FilaDeLaTaula13("3613", "Assistents de direcció i administratius", 8186, 7595, -7.2, 95),
    FilaDeLaTaula13("4412", "Recepcionistes (excepte d'hotels)", 7566, 7101, -6.1, 96),
    FilaDeLaTaula13("4422", "Recepcionistes d'hotels", 5784, 5498, -4.9, 97),
    FilaDeLaTaula13("2651", "Professionals de la publicitat i la comercialització", 4716, 5017, 6.4, 109),
    FilaDeLaTaula13("4123", "Empleats de logística i transport de passatgers i mercaderies", 8474, 9585, 13.1, 116),
    FilaDeLaTaula13("4411", "Empleats d'informació a l'usuari", 3694, 4538, 22.8, 126),
]
VARIACION_TOTAL = -2.4
VERIFICADO_TAULA13 = "2026-09-27"
PAGINA_TAULA13 = {"pagina_impresa": 38, "pagina_pdf": 39}
# Campos que pasan al conjunto validado del motor.
CAMPOS_TAULA4 = (
    "ocupacion_ca",
    "ocupados",
    "pct_ocupacion_total",
    "pct_mujeres",
    "tabla",
    "pagina_impresa",
    "fuente_primaria",
)
CAMPOS_TAULA13 = (
    "ocupacion_ca",
    "contratos_2023",
    "contratos_2025",
    "variacion_pct",
    "indice",
    "periodo",
    "tabla",
    "pagina_impresa",
    "fuente_primaria",
)
# Tolerancias del recálculo de la Taula 13: el estudio publica variaciones con un decimal e índices enteros.
TOLERANCIA_VARIACION = 0.06  # ±0,05 del redondeo a un decimal, más holgura de coma flotante
TOLERANCIA_INDICE = 1
# Los originales de la fuente: la tabla y el PDF publicado del estudio.
ORIGINALES_DE_LA_FUENTE = 2


# ---------------------------------------------------------------------------------------------------------------------
# Piezas internas
# ---------------------------------------------------------------------------------------------------------------------


def _porcentaje_entero(parte: float, total: float) -> int:
    """Calcula un porcentaje sin decimales, redondeado como se publica (la mitad, hacia arriba).

    Args:
        parte: La parte.
        total: El total (no cero).

    Returns:
        El porcentaje entero.
    """
    return math.floor(100 * parte / total + 0.5)


def _porcentaje_un_decimal(parte: float, total: float) -> float:
    """Calcula un porcentaje con un decimal, redondeado como se publica (la mitad, hacia arriba).

    Args:
        parte: La parte.
        total: El total (no cero).

    Returns:
        El porcentaje con un decimal.
    """
    return math.floor(1000 * parte / total + 0.5) / 10


def nivel_de(puntuacion: float) -> int:
    """Sitúa una puntuación de la OIT en la escala del estudio: un nivel más por cada corte alcanzado.

    Args:
        puntuacion: La puntuación media del grupo (0 a 1).

    Returns:
        El nivel, de 1 a 5.
    """
    return 1 + sum(puntuacion >= corte for corte in CORTES_NIVEL)


def _fila_preparada(fila: dict[str, Any], numero: int) -> dict[str, Any]:
    """Prepara una fila de la tabla: nombres en castellano, enteros donde son recuentos y el código del estudio aparte.

    Args:
        fila: La fila del original, por columna.
        numero: Su número de fila, para el motivo del error.

    Returns:
        La fila preparada.

    Raises:
        FormatoInesperado: Si una cifra no es un entero o el título no empieza por el código del estudio.
    """
    valores = {campo: fila[columna] for columna, campo in COLUMNAS.items()}
    for campo in CAMPOS_ENTEROS:
        motivo = f"{TABLA}, fila {numero}: {campo} no es un número entero"
        try:
            exigir(float(valores[campo]).is_integer(), motivo)
            valores[campo] = int(valores[campo])
        except (TypeError, ValueError, OverflowError):
            raise FormatoInesperado(motivo) from None
    titulo = TITULO_CON_CODIGO.match(str(valores.pop("titulo")))
    if titulo is None:
        raise FormatoInesperado(f"{TABLA}, fila {numero}: el título no empieza por el código del estudio")
    codigo_estudio, ocupacion = titulo.groups()
    cno11 = str(valores.pop("cno11"))
    return {
        "cno11": cno11,
        "codigo_estudio": codigo_estudio,
        "ocupacion_ca": ocupacion,
        **valores,
        "fuente": FUENTE_CORTA,
        "fuente_primaria": FUENTE_PRIMARIA_OCUPADOS,
        "archivo": TABLA,
        "fila": numero,
    }


def leer_tabla(ruta: Path) -> list[dict[str, Any]]:
    """Lee las filas de la tabla del estudio, preparadas.

    Args:
        ruta: El libro .xls del estudio.

    Returns:
        Una fila preparada por ocupación.

    Raises:
        FormatoInesperado: Si el libro no tiene una sola hoja o sus columnas no son las esperadas.
    """
    hojas = leer_xls(ruta)
    exigir(len(hojas) == 1, f"{TABLA}: se esperaba una sola hoja y tiene {len(hojas)}")
    hoja = next(iter(hojas.values()))
    exigir(bool(hoja), f"{TABLA}: la hoja está vacía")
    cabecera, *filas = hoja
    exigir(cabecera == list(COLUMNAS), f"{TABLA}: columnas inesperadas {cabecera}")
    # La fila 1 es la cabecera: los datos empiezan en la fila 2, como se numeran en una hoja de cálculo.
    preparadas: list[dict[str, Any]] = []
    for numero, fila in enumerate(filas, start=2):
        exigir(len(fila) >= len(cabecera), f"{TABLA}, fila {numero}: faltan columnas")
        preparadas.append(_fila_preparada(dict(zip(cabecera, fila, strict=False)), numero))
    return preparadas


def reparto_por_sexo(filas: list[dict[str, Any]]) -> dict[str, dict[str, int]]:
    """Calcula el % de las mujeres y de los hombres ocupados en cada cifra que publica el estudio, sin decimales.

    Args:
        filas: Las 163 ocupaciones de la tabla.

    Returns:
        Por cifra de NIVELES_DE_LA_CIFRA, el porcentaje de mujeres y el de hombres.
    """
    mujeres = sum(fila["mujeres"] for fila in filas)
    hombres = sum(fila["hombres"] for fila in filas)
    reparto = {}
    for cifra, niveles in NIVELES_DE_LA_CIFRA.items():
        en_la_cifra = [fila for fila in filas if fila["nivel_media"] in niveles]
        reparto[cifra] = {
            "mujeres": _porcentaje_entero(sum(fila["mujeres"] for fila in en_la_cifra), mujeres),
            "hombres": _porcentaje_entero(sum(fila["hombres"] for fila in en_la_cifra), hombres),
        }
    return reparto


def taula4(filas: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Compone las 25 ocupaciones de la Taula 4, con sus ocupados, su parte de la ocupación total y su % de mujeres.

    Args:
        filas: Las ocupaciones de la tabla; deben estar todas las de TAULA4.

    Returns:
        Una fila por ocupación de TAULA4, en su orden, con su tabla, su página y su fuente primaria.
    """
    por_codigo = {fila["cno11"]: fila for fila in filas}
    total = sum(fila["total"] for fila in filas)
    ocupaciones = []
    for codigo in TAULA4:
        fila = por_codigo[codigo]
        ocupaciones.append(
            {
                "cno11": codigo,
                "ocupacion_ca": fila["ocupacion_ca"],
                "ocupados": fila["total"],
                "pct_ocupacion_total": _porcentaje_un_decimal(fila["total"], total),
                "pct_mujeres": _porcentaje_un_decimal(fila["mujeres"], fila["total"]),
                "tabla": "Taula 4",
                "pagina_impresa": PAGINA_TAULA4["pagina_impresa"],
                "fuente_primaria": FUENTE_PRIMARIA_OCUPADOS,
            }
        )
    return ocupaciones


def _taula13() -> list[dict[str, Any]]:
    """Escribe las filas transcritas de la Taula 13 con su procedencia.

    Returns:
        Una fila por ocupación de TAULA13.
    """
    return [
        {
            "fuente": FUENTE_CORTA,
            "verificado": VERIFICADO_TAULA13,
            "metodo_verificacion": "Transcripción desde la página del PDF oficial (huella en la procedencia).",
            "cno11": fila.cno11,
            "ocupacion_ca": fila.ocupacion_ca,
            "contratos_2023": fila.contratos_2023,
            "contratos_2025": fila.contratos_2025,
            "variacion_pct": fila.variacion_pct,
            "indice": fila.indice,
            "periodo": "12 meses acumulados a septiembre de 2023 y de 2025",
            "tabla": "Taula 13",
            **PAGINA_TAULA13,
            "fuente_primaria": "Observatori del Treball i Model Productiu, contratación por ocupación (2025)",
        }
        for fila in TAULA13
    ]


def _variacion_reproducida(fila: dict[str, Any]) -> bool:
    """Indica si la variación publicada coincide con la que dan las personas contratadas de los dos años.

    Args:
        fila: Una fila de la Taula 13.

    Returns:
        True si la diferencia no pasa de TOLERANCIA_VARIACION.
    """
    variacion = (fila["contratos_2025"] / fila["contratos_2023"] - 1) * 100
    return abs(variacion - fila["variacion_pct"]) <= TOLERANCIA_VARIACION


def _indice_reproducido(fila: dict[str, Any]) -> bool:
    """Indica si el índice publicado coincide con la variación de la ocupación frente a la del conjunto (100 = igual).

    Args:
        fila: Una fila de la Taula 13.

    Returns:
        True si la diferencia no pasa de TOLERANCIA_INDICE.
    """
    indice = (1 + fila["variacion_pct"] / 100) / (1 + VARIACION_TOTAL / 100) * 100
    return abs(indice - fila["indice"]) <= TOLERANCIA_INDICE


def _cortes_en_texto() -> str:
    """Escribe los cortes de la escala del estudio como «0,2; 0,3; 0,4 y 0,5».

    Returns:
        Los CORTES_NIVEL con coma decimal, separados por «;» y el último con «y».
    """
    cortes = [numero_es(corte, 1) for corte in CORTES_NIVEL]
    return "; ".join(cortes[:-1]) + " y " + cortes[-1]


def _comprobar_tabla(controles: Controles, filas: list[dict[str, Any]], cno: dict[str, Any]) -> None:
    """Cobertura, códigos, sumas por sexo y niveles de la tabla."""
    codigos = [fila["cno11"] for fila in filas]
    controles.comprobar(
        len(filas) == OCUPACIONES_ESTUDIO and len(set(codigos)) == len(codigos),
        f"la tabla tiene las {OCUPACIONES_ESTUDIO} ocupaciones del estudio, sin repetir ninguna",
    )
    controles.comprobar(
        codigos_en_cno(codigos, cno, "3"), f"los {len(codigos)} códigos existen en la CNO-11 a 3 dígitos"
    )
    controles.comprobar(
        all(fila["codigo_estudio"][1:] == fila["cno11"] for fila in filas),
        "el código del estudio de cada título es el de su ocupación en la CNO-11",
    )
    controles.comprobar(
        all(fila["hombres"] + fila["mujeres"] == fila["total"] for fila in filas),
        "en cada ocupación, hombres + mujeres = total",
    )
    controles.comprobar(
        all(fila["nivel_media"] == nivel_de(fila["puntuacion_media"]) for fila in filas)
        and all(fila["nivel_maxima"] == nivel_de(fila["puntuacion_maxima"]) for fila in filas),
        "cada nivel corresponde a su puntuación con los cortes del estudio (" + _cortes_en_texto() + ")",
    )


def _comprobar_publicadas(controles: Controles, filas: list[dict[str, Any]]) -> None:
    """La tabla reproduce el reparto por sexo de la pág. 14 y la fila de totales de la Taula 4."""
    reparto = reparto_por_sexo(filas)
    for cifra, publicada in GENERO_PUBLICADO.items():
        controles.comprobar(
            reparto[cifra] == publicada,
            f"la tabla reproduce el reparto publicado «{cifra.replace('_', ' ')}»: {publicada['mujeres']} % de las "
            f"mujeres y {publicada['hombres']} % de los hombres (pág. impresa {PAGINA_GENERO['pagina_impresa']})",
        )
    por_codigo = {fila["cno11"]: fila for fila in filas}
    # Una ocupación de la Taula 4 que falta en la tabla deja fallido el control de sus totales, con su código.
    faltan = sorted(set(TAULA4) - set(por_codigo))
    seleccion = [] if faltan else taula4(filas)
    suma = sum(fila["ocupados"] for fila in seleccion)
    mujeres = sum(por_codigo[fila["cno11"]]["mujeres"] for fila in seleccion)
    total = sum(fila["total"] for fila in filas)
    controles.comprobar(
        not faltan
        and suma == TOTAL4.ocupados
        and _porcentaje_un_decimal(suma, total) == TOTAL4.pct_ocupacion_total
        and _porcentaje_un_decimal(mujeres, suma) == TOTAL4.pct_mujeres,
        f"las {len(TAULA4)} ocupaciones de la Taula 4 reproducen su fila de totales: "
        f"{numero_es(TOTAL4.ocupados)} ocupados, {numero_es(TOTAL4.pct_ocupacion_total, 1)} % de la ocupación total "
        f"y {numero_es(TOTAL4.pct_mujeres, 1)} % de mujeres" + (f"; faltan en la tabla: {faltan}" if faltan else ""),
    )


def _comprobar_taula13(controles: Controles, filas: list[dict[str, Any]], cno: dict[str, Any]) -> None:
    """Códigos, variaciones e índices de la Taula 13."""
    controles.comprobar(
        codigos_en_cno([fila["cno11"] for fila in filas], cno, "4"),
        f"los {len(filas)} códigos de la Taula 13 existen en la CNO-11 a 4 dígitos",
    )
    controles.comprobar(
        all(_variacion_reproducida(fila) for fila in filas),
        "cada variación publicada se reproduce con las personas contratadas (redondeo ±0,05 y holgura numérica)",
    )
    controles.comprobar(
        all(_indice_reproducido(fila) for fila in filas),
        f"cada índice se reproduce con la variación del conjunto ({numero_es(VARIACION_TOTAL, 1)} %)",
    )


def _controles(filas: list[dict[str, Any]], taula13: list[dict[str, Any]], cno: dict[str, Any]) -> Controles:
    """Aplica los controles de los originales, de la tabla y de la Taula 13, en el orden de `validacion.json`.

    Args:
        filas: Las ocupaciones de la tabla.
        taula13: Las filas de la Taula 13.
        cno: La CNO-11 validada.

    Returns:
        Los controles, cumplidos o no.
    """
    controles = Controles()
    controles.comprobar(
        len(comprobar_originales(FUENTE)) == ORIGINALES_DE_LA_FUENTE, "huellas de la tabla y del PDF publicado"
    )
    _comprobar_tabla(controles, filas, cno)
    _comprobar_publicadas(controles, filas)
    _comprobar_taula13(controles, taula13, cno)
    return controles


def _genero(filas: list[dict[str, Any]]) -> dict[str, Any]:
    """Compone el reparto por sexo de toda Cataluña, calculado con la tabla, con los nombres de campo que lee el motor.

    Args:
        filas: Las 163 ocupaciones de la tabla.

    Returns:
        El reparto, con su escala, su censo y su cita.
    """
    reparto = reparto_por_sexo(filas)
    return {
        "mujeres_exposicion_media_o_alta": reparto["media_o_alta"]["mujeres"],
        "hombres_exposicion_media_o_alta": reparto["media_o_alta"]["hombres"],
        "mujeres_exposicion_alta": reparto["alta"]["mujeres"],
        "hombres_exposicion_alta": reparto["alta"]["hombres"],
        "mujeres_no_expuestas": reparto["no_expuestas"]["mujeres"],
        "hombres_no_expuestos": reparto["no_expuestas"]["hombres"],
        "ocupaciones_analizadas": len(filas),
        **PAGINA_GENERO,
    }


def _conjunto_validado(filas: list[dict[str, Any]], taula13: list[dict[str, Any]]) -> dict[str, Any]:
    """Construye, por código CNO-11, lo que usan el motor y el contraste de `mercado/fuentes/cataluna/lector.py`.

    La variación de la contratación del conjunto es VARIACION_TOTAL, la misma con que los controles reproducen cada
    índice de la Taula 13: lo exportado es lo comprobado.

    Args:
        filas: Las 163 ocupaciones de la tabla.
        taula13: Las filas transcritas de la Taula 13.

    Returns:
        Fuente, estado, escala, ocupaciones, ocupados de la Taula 4, contratación de la Taula 13, variación del
        conjunto y reparto por sexo.
    """
    return {
        "fuente": CITA,
        "estado": f"completo: tabla de las {OCUPACIONES_ESTUDIO} ocupaciones del estudio y Taula 13 transcrita",
        "escala": {
            "cortes": list(CORTES_NIVEL),
            "nivel_media_o_alta": NIVEL_MEDIA_O_ALTA,
            "nivel_alta": NIVEL_ALTA,
            "nota": "Escala propia del estudio sobre la puntuación media de la OIT del grupo: nivel 1 por debajo de "
            "0,2 y un nivel más cada 0,1, hasta el nivel 5 desde 0,5. No son los gradientes de la OIT.",
        },
        # La puntuación y el nivel van tal cual los da la tabla; el nivel es el del estudio, no una franja de Faro.
        "ocupaciones_cno3": {
            fila["cno11"]: {
                "puntuacion": fila["puntuacion_media"],
                "nivel": fila["nivel_media"],
                "mujeres": fila["mujeres"],
                "hombres": fila["hombres"],
            }
            for fila in sorted(filas, key=lambda ocupacion: ocupacion["cno11"])
        },
        "ocupados_cno3": {fila["cno11"]: {campo: fila[campo] for campo in CAMPOS_TAULA4} for fila in taula4(filas)},
        "contratacion_cno4": {fila["cno11"]: {campo: fila[campo] for campo in CAMPOS_TAULA13} for fila in taula13},
        "variacion_contratacion_total": VARIACION_TOTAL,
        "genero": _genero(filas),
    }


# ---------------------------------------------------------------------------------------------------------------------
# Etapas
# ---------------------------------------------------------------------------------------------------------------------


def descargar() -> None:
    """La tabla llegó por correo y el PDF se conserva tal como se publicó: no se descargan con código."""
    aviso_descarga_manual(
        FUENTE,
        f"La tabla de las {OCUPACIONES_ESTUDIO} ocupaciones la enviaron el ODEE y la Cambra por correo; el PDF es el "
        "publicado. Una "
        "versión nueva de cualquiera de los dos se registra a mano en la procedencia y se vuelve a validar.",
    )


def preparar() -> None:
    """Guarda la tabla de las 163 ocupaciones y la Taula 13 transcrita."""
    original(FUENTE, PDF)  # solo exige que exista y comprueba su huella; no se lee
    filas = leer_tabla(original(FUENTE, TABLA))
    guardar_jsonl(OCUPACIONES, filas)
    guardar_jsonl(CONTRATACION, _taula13())
    print(f"Tabla: {len(filas)} ocupaciones · Taula 13: {len(TAULA13)} filas")


def validar() -> None:
    """Comprueba la tabla, reproduce las cifras publicadas y guarda la validación y el conjunto para el motor."""
    filas = leer_jsonl(OCUPACIONES)
    taula13 = leer_jsonl(CONTRATACION)
    cno = leer_validado("clasificaciones")["cno11"]
    controles = _controles(filas, taula13, cno)
    informe = {
        "estado": controles.estado,
        "comprobado_utc": ahora_utc(),
        "cobertura": {
            "ocupaciones_cno3": len(filas),
            "personas_ocupadas": sum(fila["total"] for fila in filas),
            "taula4_cno3": len(TAULA4),
            "contratacion_cno4": len(taula13),
        },
        "limites": "Datos del grupo de ocupación, no de personas: contexto colectivo, nunca un ajuste de la "
        "nota de una persona. Exposición potencial, no adopción en las empresas ni pérdida de empleo. La "
        "puntuación es la de la OIT por grupo ISCO de 3 cifras, menos fina que la correspondencia de Faro a 4 "
        "cifras: no sustituye la exposición de Faro. Su escala de cinco niveles no es la de Faro: su «alta» "
        "empieza en 0,5 y la de Faro en 0,6. La variación de la contratación no permite atribuir causas a la IA.",
        "condiciones": "Autorización escrita del ODEE (25/09/2026): citar al ODEE y a la Cambra de Comerç de "
        "Barcelona como fuente de los datos e informarles de cada publicación que los use, con su enlace.",
        "controles": controles.lista,
    }
    cerrar_validacion(FUENTE, informe, controles, lambda: _conjunto_validado(filas, taula13))


def main(argv: list[str] | None = None) -> int:
    """Ejecuta la interfaz de línea de órdenes: descargar, preparar, validar o todo.

    Args:
        argv: Los argumentos (sin el nombre del programa); None lee los del proceso.

    Returns:
        El código de salida de la orden.
    """
    etapas = {"descargar": descargar, "preparar": preparar, "validar": validar}
    return principal_fuente(__doc__, etapas, argv)


if __name__ == "__main__":
    sys.exit(main())
