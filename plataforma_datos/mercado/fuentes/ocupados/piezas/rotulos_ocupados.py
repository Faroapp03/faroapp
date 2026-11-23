"""Los rótulos con periodo de `ocupados`: se componen desde los años recibidos, nunca sustituyendo texto en prosa.

Cada rótulo es una plantilla con sus huecos con nombre: `{periodo}` (del censo de 2021 al último año), `{periodo_anual}`
(del primer censo anual al último año) y `{comparables}` (los años anuales que se comparan entre sí). Una plantilla sin
ningún hueco, o con uno que no se rellena, es un fallo: así un rótulo no se queda con un periodo viejo en silencio.
"""

import string

from plataforma_datos.comun.nucleo import exigir

ANIO_DECENAL = "2021"
PRIMER_ANUAL = "2022"


def componer(plantilla: str, **valores: str) -> str:
    """Rellena los huecos de una plantilla; todos tienen que tener valor y tiene que haber alguno.

    Returns:
        El rótulo compuesto.

    Raises:
        FormatoInesperado: Si la plantilla no tiene huecos o pide uno que no se da.
    """
    huecos = {campo for _, campo, _, _ in string.Formatter().parse(plantilla) if campo is not None}
    exigir(bool(huecos), f"ocupados: la plantilla no lleva ningún periodo: {plantilla!r}")
    faltan = sorted(huecos - valores.keys())
    exigir(not faltan, f"ocupados: la plantilla pide {faltan}: {plantilla!r}")
    return plantilla.format_map(valores)


def de_los_anios(plantilla: str, anios: tuple[str, ...]) -> str:
    """El rótulo de una plantilla para los años recibidos, hasta el último.

    Returns:
        El rótulo, con «2021–AAAA», «2022–AAAA» y los años comparables («2022 y 2023» o «los años desde 2022
        hasta AAAA»).
    """
    ultimo = anios[-1]
    comparables = (
        f"{PRIMER_ANUAL} y {ultimo}"
        if int(ultimo) == int(PRIMER_ANUAL) + 1
        else f"los años desde {PRIMER_ANUAL} hasta {ultimo}"
    )
    return componer(
        plantilla,
        periodo=f"{ANIO_DECENAL}–{ultimo}",
        periodo_anual=f"{PRIMER_ANUAL}–{ultimo}",
        comparables=comparables,
    )
