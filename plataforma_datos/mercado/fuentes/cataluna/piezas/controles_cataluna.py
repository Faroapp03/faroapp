"""Controles de la validación de Cataluña: códigos, totales y porcentajes, y contraste con la Cambra.

Los ejecuta `mercado/fuentes/cataluna/lector.py` al validar. Cada control anota su resultado con su motivo en
`Controles`; ninguno detiene la validación con una excepción.
"""

from typing import Any

from plataforma_datos.comun.nucleo import Controles
from plataforma_datos.comun.periodos import MESES_ES
from plataforma_datos.comun.textos_y_cifras import numero_es
from plataforma_datos.mercado.fuentes.cataluna.piezas.constantes_cataluna import (
    CAMPOS_CENSO,
    GRUPO_GRANDE,
    MARGEN_TAULA13,
    MAX_DIFERENCIA_OCUPADOS,
    MAX_DIFERENCIA_PUNTOS_MUJERES,
    MAX_EXCESO_SUMA_OCUPACIONES,
    MIN_OCUPACIONES_OBSERVATORI,
    MIN_VARIACION,
    TOLERANCIA_TOTALES_CENSO,
)
from plataforma_datos.ocupaciones.fuentes.clasificaciones.lector import CODIGO_NO_CONSTA as NO_CONSTA
from plataforma_datos.ocupaciones.fuentes.clasificaciones.lector import codigos_en_cno

# Los porcentajes de censo y contratación miden partes de un total: no pueden superar el 100 %.
PORCENTAJE_MAXIMO = 100


def codigos_que_constan(censo: dict[str, Any]) -> list[str]:
    """Los códigos del censo, sin el grupo «No consta» de las filas sin ocupación.

    Returns:
        Los códigos con ocupación, en el orden del censo.
    """
    return [codigo for codigo in censo if codigo != NO_CONSTA]


def porcentajes_validos(filas: list[dict[str, Any]], campos: tuple[str, ...]) -> bool:
    """Si todos los porcentajes con dato de esos campos están entre 0 y 100.

    Returns:
        True si ningún porcentaje con dato sale de 0 a 100.
    """
    return all(0 <= fila[campo] <= PORCENTAJE_MAXIMO for fila in filas for campo in campos if fila[campo] is not None)


def controles_censo(controles: Controles, censo3: dict[str, Any], censo2: dict[str, Any], cno: dict[str, Any]) -> None:
    """Códigos, totales y porcentajes del censo a 3 y 2 cifras."""
    controles.comprobar(
        codigos_en_cno(codigos_que_constan(censo3), cno, "3"),
        "todos los códigos del censo a 3 cifras existen en la CNO-11",
    )
    controles.comprobar(
        codigos_en_cno(codigos_que_constan(censo2), cno, "2"),
        "todos los códigos del censo a 2 cifras existen en la CNO-11",
    )
    total3 = sum(fila["ocupados"] for fila in censo3.values())
    total2 = sum(fila["ocupados"] for fila in censo2.values())
    controles.comprobar(
        abs(total3 - total2) <= TOLERANCIA_TOTALES_CENSO * total2,
        f"el total de ocupados cuadra entre 3 y 2 cifras ({numero_es(total3)} y {numero_es(total2)}; el INE ajusta "
        "±3 por confidencialidad)",
    )
    controles.comprobar(
        porcentajes_validos([*censo3.values(), *censo2.values()], CAMPOS_CENSO[1:]),
        "porcentajes del censo entre 0 y 100",
    )
    controles.comprobar(
        "59" in censo2 and not any(codigo.startswith("59") for codigo in censo3),
        "591–599 no se publican a 3 cifras y sí a 2 (se usa el grupo 59)",
    )


def controles_conjunto_censo(controles: Controles, censo2: dict[str, Any], contexto: dict[str, Any]) -> None:
    """El conjunto de Cataluña suma los grupos de 2 cifras y sus porcentajes caen dentro de los de los grupos."""
    conjunto = contexto["conjunto_censo"]
    grupos = [fila for codigo, fila in censo2.items() if codigo != NO_CONSTA]
    suma = sum(fila["ocupados"] for fila in grupos)
    # Cada grupo se guarda redondeado a la persona: la suma puede diferir medio punto por grupo.
    cuadra = abs(conjunto["ocupados"] - suma) <= len(grupos) / 2
    por_campo = {campo: [fila[campo] for fila in grupos if fila[campo] is not None] for campo in CAMPOS_CENSO[1:]}
    dentro = all(
        bool(valores) and conjunto[campo] is not None and min(valores) <= conjunto[campo] <= max(valores)
        for campo, valores in por_campo.items()
    )
    controles.comprobar(
        cuadra and dentro,
        f"el conjunto de Cataluña ({numero_es(conjunto['ocupados'])} ocupados) suma los {len(grupos)} grupos de 2 "
        "cifras sin «No consta», y su % de mujeres, menores de 30 y 55 o más cae entre el menor y el mayor de ellos",
    )


def _con_un_decimal(valor: float | None, factor: float = 1) -> str:
    """Una cifra de un mensaje de control con un decimal, o «ninguna» si no hay cifra.

    Args:
        valor: La cifra; None si no se pudo calcular.
        factor: Por cuánto se multiplica antes de escribirla (100 para pasar una fracción a porcentaje).

    Returns:
        La cifra con un decimal y punto decimal, o «ninguna».
    """
    return "ninguna" if valor is None else f"{factor * valor:.1f}"


def controles_contraste_censo(controles: Controles, censo3: dict[str, Any], cambra: dict[str, Any]) -> None:
    """Contraste con la Cambra (Taula 4, censo 2022): mismo concepto, un año después."""
    # Por grupo: ocupados según la Cambra, diferencia relativa de ocupados y diferencia en puntos del % de mujeres.
    # Un grupo que falta en el censo, o sin ocupados en la Cambra, no entra: la cuenta de grupos marca el fallo.
    diferencias = [
        (
            publicado["ocupados"],
            censo3[codigo]["ocupados"] / publicado["ocupados"] - 1,
            censo3[codigo]["pct_mujeres"] - publicado["pct_mujeres"],
        )
        for codigo, publicado in cambra["ocupados_cno3"].items()
        if codigo in censo3 and publicado["ocupados"]
    ]
    grandes = [relativa for ocupados, relativa, _ in diferencias if ocupados >= GRUPO_GRANDE]
    peor = max((abs(relativa) for relativa in grandes), default=None)
    peor_mujeres = max((abs(puntos) for _, _, puntos in diferencias), default=None)
    controles.comprobar(
        len(diferencias) == len(cambra["ocupados_cno3"])
        and peor is not None
        and peor <= MAX_DIFERENCIA_OCUPADOS
        and peor_mujeres is not None
        and peor_mujeres <= MAX_DIFERENCIA_PUNTOS_MUJERES,
        f"los {len(diferencias)} grupos de la Cambra (censo 2022) cuadran con el censo 2021: diferencia máxima "
        f"{_con_un_decimal(peor, 100)} % en los {len(grandes)} grupos de {numero_es(GRUPO_GRANDE)} o más ocupados y "
        f"{_con_un_decimal(peor_mujeres)} puntos en % de mujeres en todos",
    )


def controles_observatori(
    controles: Controles, contratacion: dict[str, Any], cno: dict[str, Any], contexto: dict[str, Any]
) -> None:
    """Periodo, códigos y coherencia interna de cada ocupación del Observatori."""
    filas = list(contratacion.values())
    controles.comprobar(
        len(contratacion) >= MIN_OCUPACIONES_OBSERVATORI and {fila["mes"] for fila in filas} == {contexto["mes"]},
        f"{len(contratacion)} ocupaciones con un único periodo ({contexto['mes']})",
    )
    controles.comprobar(
        codigos_en_cno(contratacion, cno, "4"), "todos los códigos del Observatori existen en la CNO-11 a 4 cifras"
    )
    controles.comprobar(
        all(
            fila["personas_contratadas"] <= fila["contratos"]
            for fila in filas
            if fila["personas_contratadas"] is not None and fila["contratos"] is not None
        ),
        "en cada ocupación, personas contratadas ≤ contratos",
    )
    controles.comprobar(
        porcentajes_validos(filas, ("pct_indefinidos", "pct_mujeres_contratos")),
        "porcentajes de la contratación entre 0 y 100",
    )


def _variacion_publicable(fila: dict[str, Any]) -> bool:
    """Si una variación publicada se apoya en suficientes personas contratadas en los dos años.

    Returns:
        True si los dos años llegan a MIN_VARIACION personas contratadas.
    """
    return fila["personas_contratadas"] >= MIN_VARIACION and fila["personas_contratadas_anterior"] >= MIN_VARIACION


def controles_totales_observatori(controles: Controles, contratacion: dict[str, Any], contexto: dict[str, Any]) -> None:
    """Suma de todas las ocupaciones frente al total de Cataluña, y variaciones con base suficiente."""
    suma = sum(fila["personas_contratadas"] or 0 for fila in contratacion.values())
    total = contexto["personas_contratadas_total"]
    controles.comprobar(
        total != 0 and 1 <= suma / total <= MAX_EXCESO_SUMA_OCUPACIONES,
        f"la suma por ocupaciones ({numero_es(suma)}) es algo mayor que el total de Cataluña ({numero_es(total)}): hay "
        "personas contratadas en más de una ocupación",
    )
    controles.comprobar(
        all(fila["variacion_pct"] is None or _variacion_publicable(fila) for fila in contratacion.values()),
        f"la variación solo se publica con al menos {MIN_VARIACION} personas contratadas en los dos años",
    )


def _en_rango_taula13(publicada: dict[str, Any], fila: dict[str, Any]) -> bool:
    """Si la cifra de la Taula 13 cae entre las de los dos años del Observatori, con el margen admitido.

    Returns:
        True si la cifra de la Cambra cae en el rango ampliado por MARGEN_TAULA13.
    """
    extremos = (fila["personas_contratadas"], fila["personas_contratadas_anterior"])
    minimo = (1 - MARGEN_TAULA13) * min(extremos)
    maximo = (1 + MARGEN_TAULA13) * max(extremos)
    return minimo <= publicada["contratos_2025"] <= maximo


def _meses_de_los_dos_anios(mes: int) -> str:
    """Los finales de los dos años de 12 meses de la copia del Observatori, como los dice un control.

    Args:
        mes: El mes final de la copia, AAAAMM (`c_mes`, 202606).

    Returns:
        «junio de 2025 y junio de 2026»: el mismo mes un año antes y el de la copia.
    """
    anio, numero = divmod(mes, 100)
    nombre = MESES_ES[numero - 1]
    return f"{nombre} de {anio - 1} y {nombre} de {anio}"


def controles_contraste_contratacion(
    controles: Controles, contratacion: dict[str, Any], cambra: dict[str, Any], contexto: dict[str, Any]
) -> bool:
    """Contraste con la Cambra (Taula 13): sus personas contratadas, entre los dos años de la copia del Observatori.

    Un código de la Taula 13 que el Observatori no trae cuenta como fuera del rango. Fuera del intervalo temporal
    comparable no se registra un contraste ficticio: el informe lo declara no aplicable.

    Returns:
        True si septiembre de 2025 está entre los finales de los dos años de la copia.
    """
    anio, mes = divmod(contexto["mes"], 100)
    final = anio * 12 + mes
    referencia = 2025 * 12 + 9
    if not final - 12 <= referencia <= final:
        return False
    fuera = [
        codigo
        for codigo, publicada in cambra["contratacion_cno4"].items()
        if codigo not in contratacion or not _en_rango_taula13(publicada, contratacion[codigo])
    ]
    detalle = "; fuera: " + ", ".join(fuera) if fuera else ""
    controles.comprobar(
        not fuera,
        f"las {len(cambra['contratacion_cno4'])} cifras de la Taula 13 de la Cambra (septiembre de 2025) caen entre "
        f"{_meses_de_los_dos_anios(contexto['mes'])} (±{round(100 * MARGEN_TAULA13)} %): misma medida y territorio"
        + detalle,
    )
    return True
