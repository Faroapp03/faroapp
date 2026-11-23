"""Coherencia interna de las tablas del Idescat capturadas y su contraste con el cálculo propio de la TIC-H."""

import unicodedata
from collections.abc import Mapping
from typing import Any

from plataforma_datos.comun.entrada_salida import carpetas, leer_json
from plataforma_datos.comun.nucleo import Controles

# El total queda entre las cifras de mujeres y de hombres, y el uso para trabajar no supera el uso total (es una parte
# de él), en el total y en cada sexo.
ENTRE_SEXOS = {
    "personas-ia-generativa-usuarios-internet": (
        "mujeres-ia-generativa-usuarios-internet",
        "hombres-ia-generativa-usuarios-internet",
    ),
    "personas-ia-generativa-trabajo-usuarios-internet": (
        "mujeres-ia-generativa-trabajo-usuarios-internet",
        "hombres-ia-generativa-trabajo-usuarios-internet",
    ),
}
PARTE_DE = {
    "personas-ia-generativa-trabajo-usuarios-internet": "personas-ia-generativa-usuarios-internet",
    "mujeres-ia-generativa-trabajo-usuarios-internet": "mujeres-ia-generativa-usuarios-internet",
    "hombres-ia-generativa-trabajo-usuarios-internet": "hombres-ia-generativa-usuarios-internet",
}


def incoherencias(cifras: dict[str, float | None]) -> dict[str, tuple[float | None, ...]]:
    """Los indicadores cuyas cifras no cumplen la coherencia interna de las tablas (`ENTRE_SEXOS`, `PARTE_DE`).

    Returns:
        Cada indicador incoherente con las cifras que lo contradicen; vacío si todas cuadran.
    """
    fallos: dict[str, tuple[float | None, ...]] = {}
    for total, (mujeres, hombres) in ENTRE_SEXOS.items():
        trio = (cifras.get(total), cifras.get(mujeres), cifras.get(hombres))
        t, m, h = trio
        if t is None or m is None or h is None or not min(m, h) <= t <= max(m, h):
            fallos[total] = trio
    for parte, todo in PARTE_DE.items():
        par = (cifras.get(parte), cifras.get(todo))
        if par[0] is None or par[1] is None or par[0] > par[1]:
            fallos[parte] = par
    return fallos


# La descripción de `IAG_NO3` en el diseño de registro de la TIC-H: si una edición la cambia, la variable ya no es la
# que contrasta la tabla 3.4.2 del Idescat, y el contraste se detiene con ese motivo, que entonces es real.
DESCRIPCION_NO_SABE = "Razones para no utilizar IA Generativa: No sabía cómo utilizarlas"
# Lo que tiene que decir la descripción tras los dos puntos, normalizada: un cambio de mayúsculas, de espacios, de
# forma Unicode o un punto final no cambia el significado.
SIGNIFICADO_NO_SABE = "no sabía cómo utilizarlas"


def significado(descripcion: object) -> str | None:
    """La parte significativa de una descripción del diseño de registro, la que va tras los dos puntos.

    Se compara en NFC, en minúsculas, con los espacios colapsados y sin puntuación final.

    Returns:
        Esa parte, o None si la descripción no es un texto.
    """
    if not isinstance(descripcion, str):
        return None
    texto = " ".join(unicodedata.normalize("NFC", descripcion).casefold().split())
    return texto.rpartition(":")[2].strip().rstrip(".;,").strip()


def motivo_calculado_por_tich() -> dict[str, Any] | None:
    """El cálculo de contraste de «no sabía cómo» del informe de validación de `tich` (no va en su conjunto publicado).

    Returns:
        `descripcion` y `por_clase`, o None si `tich` aún no lo ha calculado (una validación anterior a este cálculo).
    """
    validacion = carpetas("tich").validacion
    return leer_json(validacion).get("contraste_no_sabe_como") if validacion.exists() else None


def _con_su_muestra(clase: str, estimacion: Mapping[str, Any]) -> str:
    desde, hasta = (f"{valor:.1f}".replace(".", ",") for valor in estimacion["ic95"])
    return f"{clase} ({estimacion['muestra']} entrevistas, IC {desde}–{hasta})"


def control_del_motivo(
    controles: Controles,
    cifras: dict[str, float | None],
    indicador_por_clase: Mapping[str, str],
    calculado: Mapping[str, Any] | None,
) -> bool:
    """Contrasta «no sabía cómo» de cada clase con el intervalo del 95 % del cálculo de Faro con los microdatos.

    Con los microdatos de 2025 el cálculo reproduce al decimal las cifras del Idescat, que explota los mismos microdatos
    públicos del INE: una cifra fuera del intervalo es otra base o una lectura errónea. El cálculo es de contraste, con
    dos entrevistas o más (con pocas, el intervalo es ancho). Sin cálculo, o sin clases con dos entrevistas, no
    hay contraste posible: no se registra un control, y la fuente lo declara como aviso (`contraste_con_la_tich`).

    Args:
        controles: Donde se registra.
        cifras: La cifra de cada indicador en Cataluña.
        indicador_por_clase: El indicador del Idescat de cada clase de ocupación.
        calculado: El cálculo de contraste de `tich` (descripción de la variable y estimación por clase), o None.

    Returns:
        Si se contrastó.
    """
    por_clase = (calculado or {}).get("por_clase", {})
    comparadas = [clase for clase in indicador_por_clase if "ic95" in por_clase.get(clase, {})]
    if calculado is None or not comparadas:
        return False
    descripcion = calculado.get("descripcion")
    if significado(descripcion) != SIGNIFICADO_NO_SABE:
        controles.comprobar(False, f"la variable IAG_NO3 de la TIC-H ya no es «{DESCRIPCION_NO_SABE}»: {descripcion!r}")
        return True
    fuera = {}
    for clase in comparadas:
        valor, (desde, hasta) = cifras[indicador_por_clase[clase]], por_clase[clase]["ic95"]
        if valor is None or not desde <= valor <= hasta:
            fuera[indicador_por_clase[clase]] = (valor, [desde, hasta])
    controles.comprobar(
        not fuera,
        "«no sabía cómo» por clase, dentro del intervalo del 95 % del cálculo de Faro con los microdatos de la TIC-H; "
        f"clases comparadas: {', '.join(_con_su_muestra(clase, por_clase[clase]) for clase in comparadas)}"
        + (f"; fuera: {fuera}" if fuera else ""),
    )
    return True
