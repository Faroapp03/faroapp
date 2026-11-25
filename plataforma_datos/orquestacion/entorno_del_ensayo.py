"""El reloj y el entorno con que corre el ciclo de un ensayo con datos grabados.

El entorno se construye como el del ejecutor de producción (`ejecutor_operativo._entorno`): solo las variables que
heredan las órdenes (`actualizar.entorno_de_las_ordenes`), con una carpeta personal y una temporal propias dentro de
la salida. Como el del ejecutor, lleva la señal del ciclo operativo (`ordenes_de_la_actualizacion.COMPLETAR_RENOMBRES`),
con la que la exportación completa los renombres del paquete. Además no lleva ninguna variable de proxy, porque el
ensayo no sale a la red, y lleva el reloj del ensayo.

El reloj es único para todo el ciclo: el día de validación (FARO_HOY) y el instante del ciclo (FARO_INSTANTE,
`comun/instante_del_ciclo.py`). Por omisión el instante es el comienzo del ensayo, en el pasado para todo lo que corre
después: las comprobaciones que leen el catálogo con la hora real exigen que su corte no sea posterior a ella. Lo que
el ciclo anota (el comienzo del intento y el seguimiento de las comprobaciones) lleva ese mismo instante, y por eso
el estado del panel, que exige que lo anotado no sea posterior al suyo, se mide con él.
"""

import os
from collections.abc import Mapping
from datetime import UTC, date, datetime
from pathlib import Path

from plataforma_datos.comun import instante_del_ciclo
from plataforma_datos.orquestacion.actualizar import entorno_de_las_ordenes
from plataforma_datos.orquestacion.ordenes_de_la_actualizacion import COMPLETAR_RENOMBRES, SI

VARIABLES_DE_PROXY = frozenset(
    {"HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy", "ALL_PROXY", "all_proxy"}
)
# Donde Playwright guarda sus navegadores en macOS: con otra carpeta personal no los encontraría.
NAVEGADORES_DE_PLAYWRIGHT = Path.home() / "Library" / "Caches" / "ms-playwright"


def reloj_del_ensayo(hoy: str | None, instante: str | None, ahora: datetime | None = None) -> dict[str, str]:
    """El reloj único del ensayo: el día de validación y el instante que leen todas las piezas del ciclo.

    Args:
        hoy: El día de validación (AAAA-MM-DD), o None para el de hoy.
        instante: El instante del ciclo (AAAA-MM-DDTHH:MM:SSZ), o None para el comienzo del ensayo.
        ahora: El comienzo del ensayo, o None para el momento actual.

    Returns:
        «hoy» e «instante», comprobados.

    Raises:
        ValueError: Si el día o el instante no tienen su formato, o si el día es otro que el del comienzo y no lleva
            su instante: el comienzo no sería un instante de ese día.
    """
    comienzo = (ahora or datetime.now(UTC)).astimezone(UTC).replace(microsecond=0)
    dia_del_comienzo = comienzo.astimezone().date().isoformat()
    hoy = hoy or dia_del_comienzo
    date.fromisoformat(hoy)
    if instante is None and hoy != dia_del_comienzo:
        raise ValueError("un día de validación que no es el del comienzo del ensayo necesita su instante")
    instante = instante or comienzo.isoformat().replace("+00:00", "Z")
    instante_del_ciclo.fijado({instante_del_ciclo.VARIABLE: instante})
    return {"hoy": hoy, "instante": instante}


def entorno_del_ciclo(entorno: Mapping[str, str], reloj: dict[str, str], salida: Path) -> dict[str, str]:
    """El entorno del ciclo: el de las órdenes de producción, sin proxy, con su reloj y con carpetas propias.

    Lleva además la señal del ciclo operativo, como el candidato del ejecutor (`ejecutor_operativo._candidato`).

    Args:
        entorno: El entorno de quien ejecuta el ensayo.
        reloj: El reloj del ensayo (`reloj_del_ensayo`).
        salida: La salida del ensayo, donde quedan la carpeta personal y la temporal del ciclo.

    Returns:
        El entorno del proceso del ciclo.
    """
    hogar, temporal = salida / "hogar", salida / "temporales"
    hogar.mkdir(exist_ok=True)
    temporal.mkdir(exist_ok=True)
    filtrado = {
        nombre: valor for nombre, valor in entorno_de_las_ordenes(entorno).items() if nombre not in VARIABLES_DE_PROXY
    }
    filtrado.setdefault("PATH", os.defpath)
    if "PLAYWRIGHT_BROWSERS_PATH" not in filtrado and NAVEGADORES_DE_PLAYWRIGHT.is_dir():
        filtrado["PLAYWRIGHT_BROWSERS_PATH"] = str(NAVEGADORES_DE_PLAYWRIGHT)
    return {
        **filtrado,
        "HOME": str(hogar),
        "TMPDIR": str(temporal),
        "FARO_HOY": reloj["hoy"],
        instante_del_ciclo.VARIABLE: reloj["instante"],
        COMPLETAR_RENOMBRES: SI,
    }
