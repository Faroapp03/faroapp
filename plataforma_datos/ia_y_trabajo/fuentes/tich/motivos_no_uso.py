"""Quienes no usaron la IA generativa y no sabían cómo usarla, en Cataluña por clase de ocupación, desde los microdatos.

Es la base de la tabla 3.4.2 del Idescat, que la explota con los mismos microdatos públicos del INE y su factor
`FACTOR_P`: personas ocupadas de 16 a 74 años de Cataluña que no usaron ninguna herramienta de IA generativa en los
tres meses anteriores (`IAG` = no; la pregunta solo se hace a quien usó internet) y respondieron al motivo
`IAG_NO3` («No sabía cómo utilizarlas»), por clase manual o no manual (`OCUPACION1`).

No es una cifra que Faro publique: es el cálculo con que `tic_llars` contrasta la del Idescat. Por eso no se le aplican
el mínimo de 100 entrevistas ni la regla de publicación, que son para publicar: se estima con dos entrevistas o más
(MIN_PARA_ESTIMAR), con su intervalo de Korn–Graubard, que con pocas entrevistas es ancho y no detiene en falso. Va al
preparado y al informe de validación de `tich`, nunca al paquete, con la descripción de `IAG_NO3` en el diseño de
registro de la edición, para que el contraste compruebe que la variable sigue significando lo mismo.
"""

from collections.abc import Callable
from typing import Any

from plataforma_datos.comun.lugares import CODIGO_INE_DE_CATALUNA as CATALUNA
from plataforma_datos.ia_y_trabajo.fuentes.tich.constantes import (
    EDAD_CONTRASTE,
    NO,
    SI,
    VARIABLE_IA,
    VARIABLE_NO_SABE,
)

# Códigos de `OCUPACION1` en el diseño de registro (lista T_MANU): 1, ocupación manual; 6, no manual.
MANUAL = "1"
NO_MANUAL = "6"
CLASES = {"manual": MANUAL, "no_manual": NO_MANUAL}
# El intervalo de Korn–Graubard usa la t de Student con muestra − 1 grados de libertad: con una sola entrevista no hay
# intervalo. Es una necesidad del estimador, no un umbral de publicación; con menos, queda la muestra y no se contrasta.
MIN_PARA_ESTIMAR = 2


def no_usuarios_de_cataluna_por_clase(filas: list[dict[str, str]]) -> dict[str, list[dict[str, str]]]:
    """Las filas de la base de la tabla 3.4.2 del Idescat, por clase de ocupación.

    Returns:
        Para «manual» y «no_manual», las personas de esa base.
    """
    desde, hasta = EDAD_CONTRASTE
    base = [
        fila
        for fila in filas
        if fila["CCAA"] == CATALUNA
        and desde <= int(fila["EDAD"]) <= hasta
        and fila[VARIABLE_IA] == NO
        and fila[VARIABLE_NO_SABE] in (SI, NO)
    ]
    return {clase: [fila for fila in base if fila["OCUPACION1"] == codigo] for clase, codigo in CLASES.items()}


def descripcion_de_la_variable(diseno: dict[str, Any], variable: str) -> str | None:
    """La descripción de una variable en el diseño de registro de la edición.

    Returns:
        La descripción, o None si la variable no está en el diseño.
    """
    return next((campo.get("description") for campo in diseno["layout"] if campo.get("name") == variable), None)


def no_sabian_como(
    filas: list[dict[str, str]],
    grados: float,
    estimar: Callable[[list[dict[str, str]], str, float], dict[str, Any]],
    diseno: dict[str, Any],
) -> dict[str, Any]:
    """El cálculo de contraste de «no sabía cómo» en cada clase, con la descripción de la variable en el diseño.

    Args:
        filas: Las filas del cuestionario.
        grados: Los grados de libertad del diseño de Cataluña.
        estimar: El estimador de la fuente (porcentaje ponderado con su intervalo de Korn–Graubard).
        diseno: El diseño de registro de la edición.

    Returns:
        `descripcion` de `IAG_NO3` y `por_clase`: {clase: estimación, o solo la muestra si no llega a dos}. Sin
        `IAG_NO3` en la edición, sin descripción ni clases: `tic_llars` queda sin contraste, y `tich` no falla.
    """
    if not filas or VARIABLE_NO_SABE not in filas[0]:
        return {"descripcion": None, "por_clase": {}}
    return {
        "descripcion": descripcion_de_la_variable(diseno, VARIABLE_NO_SABE),
        "por_clase": {
            clase: estimar(grupo, VARIABLE_NO_SABE, grados)
            if len(grupo) >= MIN_PARA_ESTIMAR
            else {"muestra": len(grupo)}
            for clase, grupo in no_usuarios_de_cataluna_por_clase(filas).items()
        },
    }
