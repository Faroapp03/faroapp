"""El reparto de las ocupaciones de la TIC-H frente al de la EPA, y qué grupos se dan en su gran grupo.

La regla compara la cuota de cada grupo de 2 cifras dentro de su gran grupo en la TIC-H con la de la EPA (Eurostat
lfsa_egai2d): entre la mitad y el doble (`RAZON_MAXIMA_DE_CUOTA`), el grupo describe a la misma gente que llega por la
correspondencia desde la CNO-11. Un grupo que no la cumple, o que no tiene cuota en la EPA del año declarado
(`epa_anio`), no se da a 2 cifras: se da en su gran grupo, que es menos detalle pero cierto, y el dato lo dice con su
motivo. Para que un error sistemático no quede oculto bajo muchas bajadas, el gran grupo que los recibe tiene que tener
cifra y cumplir la misma regla en el total de ocupados; si no, la validación se detiene.
"""

from collections.abc import Container, Iterable, Mapping

from plataforma_datos.comun.nucleo import Controles
from plataforma_datos.ia_y_trabajo.fuentes.tich.constantes import RAZON_MAXIMA_DE_CUOTA

FUERA_DE_LA_REGLA = "reparto-distinto-de-la-epa"
SIN_CUOTA = "sin-cuota-en-la-epa"


def _cuotas_en_su_gran_grupo(personas: Mapping[str, float]) -> dict[str, float]:
    """La parte de su gran grupo que es cada grupo de 2 cifras.

    Returns:
        {grupo: parte de su gran grupo, en tanto por 1}.
    """
    por_gran_grupo: dict[str, float] = {}
    for grupo, cuantas in personas.items():
        por_gran_grupo[grupo[:1]] = por_gran_grupo.get(grupo[:1], 0) + cuantas
    return {grupo: cuantas / por_gran_grupo[grupo[:1]] for grupo, cuantas in personas.items() if cuantas}


def razones_de_cuota(poblacion: Mapping[str, float], epa: Mapping[str, float]) -> dict[str, float]:
    """Cuota de cada grupo dentro de su gran grupo en la TIC-H, dividida por la de la EPA: 1 si las dos coinciden.

    Las dos usan la ISCO-08; dentro del gran grupo se quita la composición de la muestra y queda cómo se codifica.

    Returns:
        {grupo: razón de cuotas}.
    """
    tich, en_la_epa = _cuotas_en_su_gran_grupo(poblacion), _cuotas_en_su_gran_grupo(epa)
    return {grupo: round(cuota / en_la_epa[grupo], 2) for grupo, cuota in tich.items() if grupo in en_la_epa}


def razon_del_bloque(grupos: Iterable[str], poblacion: Mapping[str, float], epa: Mapping[str, float]) -> float:
    """Cuota de un bloque (o de un gran grupo) en el total de ocupados en la TIC-H dividida por la de la EPA.

    Returns:
        La razón de cuotas del bloque.
    """
    del_bloque = list(grupos)
    tich = sum(poblacion.get(grupo, 0) for grupo in del_bloque) / sum(poblacion.values())
    en_la_epa = sum(epa.get(grupo, 0) for grupo in del_bloque) / sum(epa.values())
    return round(tich / en_la_epa, 2)


def en_la_regla(razon: float) -> bool:
    """Si una razón de cuotas está entre la mitad y el doble (`RAZON_MAXIMA_DE_CUOTA`).

    Returns:
        True si la razón está dentro de la regla.
    """
    return 1 / RAZON_MAXIMA_DE_CUOTA <= razon <= RAZON_MAXIMA_DE_CUOTA


def grupos_a_su_gran_grupo(de_paso: Iterable[str], razones: Mapping[str, float]) -> dict[str, str]:
    """Los grupos que se darían a 2 cifras y que la EPA no confirma, con su motivo.

    Returns:
        {grupo: motivo}, en orden; vacío si la EPA confirma todos.
    """
    return {
        grupo: SIN_CUOTA if grupo not in razones else FUERA_DE_LA_REGLA
        for grupo in sorted(de_paso)
        if grupo not in razones or not en_la_regla(razones[grupo])
    }


def control_de_sus_grandes_grupos(
    controles: Controles,
    bajados: Mapping[str, str],
    grandes_grupos_con_cifra: Container[str],
    poblacion: Mapping[str, float],
    epa: Mapping[str, float],
) -> None:
    """Exige que cada gran grupo que recibe grupos bajados tenga cifra y cumpla la regla en el total de ocupados.

    Sin grupos bajados no hay nada que exigir y no se registra ningún control.

    Args:
        controles: Donde se registra.
        bajados: Los grupos que se dan en su gran grupo, con su motivo.
        grandes_grupos_con_cifra: Los grandes grupos de España que tienen cifra publicable.
        poblacion: Personas ocupadas de la TIC-H por grupo de 2 cifras.
        epa: Personas ocupadas de la EPA por grupo de 2 cifras.
    """
    if not bajados:
        return
    grandes = sorted({grupo[:1] for grupo in bajados})
    sin_cifra = [gran for gran in grandes if gran not in grandes_grupos_con_cifra]
    razones = {gran: razon_del_bloque((g for g in poblacion if g[:1] == gran), poblacion, epa) for gran in grandes}
    fuera = {gran: razon for gran, razon in razones.items() if not en_la_regla(razon)}
    controles.comprobar(
        not sin_cifra and not fuera,
        f"{len(bajados)} grupos que la EPA no confirma se dan en su gran grupo ({dict(bajados)}); cada gran grupo que "
        f"los recibe tiene cifra y entre la mitad y el doble de la cuota de la EPA en el total de ocupados: {razones}"
        + (f"; sin cifra: {sin_cifra}" if sin_cifra else "")
        + (f"; fuera: {fuera}" if fuera else ""),
    )
