"""Control de la lectura de fechas de Citilab: fichas que traen fechas en su texto y se quedan sin fecha de fin.

Las fechas salen del texto de cada ficha con un patrón estricto («1 d'octubre de 2026»). Si Citilab cambia su
redacción, el fin queda vacío y el curso deja de terminar por fecha. Lo que se mide es ese fallo de lectura: una ficha
usada sin fecha de fin cuya sección de duración trae algo con forma de fecha, en cualquier redacción (numérica, con el
mes abreviado o en castellano), que pueda ser su fin. Son dos o más fechas, o una sola que el lector no ha leído ni
como inicio. Un curso de un día con su fecha leída, uno periódico o «De setembre a gener» no avisan, ni cuántos cursos
tienen fin.

Si alguna queda así, la validación se detiene, el conjunto admitido sigue siendo el anterior y las fichas quedan en
`fechas-pendientes-de-confirmacion.json`, junto a los originales, con su huella. Una persona revisa sus fichas y, si
su texto de verdad no da un fin legible, las confirma con `confirmar_fechas.py`: la confirmación vale para ese texto
exacto (su SHA-256) y deja de valer si la ficha cambia.
"""

import hashlib
import json
import re
from pathlib import Path
from typing import Any

from plataforma_datos.comun.entrada_salida import guardar_json, leer_json
from plataforma_datos.comun.nucleo import exigir
from plataforma_datos.comun.periodos import MESES_CA

PENDIENTES = "fechas-pendientes-de-confirmacion.json"
CONFIRMADAS = "fechas-confirmadas.json"
# Meses en castellano: la redacción de una ficha puede cambiar de idioma.
MESES_ES = (
    "enero",
    "febrero",
    "marzo",
    "abril",
    "mayo",
    "junio",
    "julio",
    "agosto",
    "septiembre",
    "setiembre",
    "octubre",
    "noviembre",
    "diciembre",
)
# Dos fechas o más en la duración son un periodo: deberían dar un fin.
MIN_FECHAS_DE_UN_PERIODO = 2
# Abreviaturas de mes en catalán y en castellano; solo cuentan con punto o seguidas del año («nov.», «nov 2026»), porque
# «set» o «mar» también son palabras.
ABREVIATURAS = (
    "gen",
    "febr",
    "feb",
    "mar",
    "abr",
    "ag",
    "set",
    "sept",
    "oct",
    "nov",
    "des",
    "ene",
    "ago",
    "sep",
    "dic",
)
_MESES = "|".join(map(re.escape, sorted({*MESES_CA, *MESES_ES}, key=len, reverse=True)))
_ABREVIADOS = "|".join(map(re.escape, sorted(ABREVIATURAS, key=len, reverse=True)))
# Algo con forma de fecha en cualquier redacción: «24/11/2026», «24-11-26» o un día seguido del mes, entero o abreviado,
# en catalán o en castellano. El día va pegado al mes: «18 h, d'octubre» o «4 dimarts de març» no son fechas. Una
# fecha numérica no forma parte de una hora con decimales ni de un rango de horas («10.00-12.00 h»).
FORMA_DE_FECHA = re.compile(
    r"(?<![\d.:])\b\d{1,2}[/.-]\d{1,2}[/.-](?:\d{4}|\d{2})\b(?![.:]\d)"
    r"|\b\d{1,2}(?:r|er|º|ª)?\s*(?:de\s+|d'|del\s+)?"
    rf"(?:(?:{_MESES})\b|(?:{_ABREVIADOS})(?:\.|\s+\d{{4}}\b))"
)


def revision_de_fechas(
    identidad: int, contenido_html: str, duracion: list[str], inicio: str | None, fin: str | None
) -> dict[str, Any]:
    """Si una ficha se queda sin fin aunque su texto trae algo con forma de fecha que puede serlo.

    Args:
        identidad: El id de la ficha.
        contenido_html: El texto de la ficha tal como llega, del que sale su huella.
        duracion: Las líneas de su sección de duración y horario.
        inicio: La fecha de inicio leída, o None.
        fin: La fecha de fin leída, o None.

    Returns:
        El id, la huella del texto y si tiene fechas sin leer.
    """
    menciones = sum(len(FORMA_DE_FECHA.findall(linea.lower())) for linea in duracion)
    # Una sola fecha leída como inicio es un curso de un día; dos o más, o una sin leer, deberían dar un fin.
    sin_leer = fin is None and (menciones >= MIN_FECHAS_DE_UN_PERIODO or (menciones == 1 and inicio is None))
    return {
        "id": identidad,
        "texto_sha256": hashlib.sha256(contenido_html.encode()).hexdigest(),
        "fechas_sin_leer": sin_leer,
    }


def _confirmadas(carpeta: Path) -> set[tuple[int, str]]:
    """Las fichas que una persona ha confirmado, cada una con la huella del texto que revisó.

    Returns:
        Los pares id y huella confirmados; ninguno si no hay confirmaciones.
    """
    ruta = carpeta / CONFIRMADAS
    return {(f["id"], f["texto_sha256"]) for f in leer_json(ruta)["fichas"]} if ruta.is_file() else set()


def fichas_sin_confirmar(preparados: dict[str, Any], usados: set[int], carpeta: Path) -> list[dict[str, Any]]:
    """Las fichas usadas con fechas sin leer que nadie ha confirmado para su texto actual.

    Raises:
        FormatoInesperado: Si la copia preparada no trae la lectura de fechas; hay que volver a prepararla.

    Returns:
        Sus revisiones, en orden de id.
    """
    exigir(
        "lectura_de_fechas" in preparados,
        "citilab: la copia preparada no trae la lectura de fechas; vuelve a prepararla",
    )
    confirmadas = _confirmadas(carpeta)
    return [
        r
        for r in preparados["lectura_de_fechas"]
        if r["id"] in usados and r["fechas_sin_leer"] and (r["id"], r["texto_sha256"]) not in confirmadas
    ]


def control_de_fechas(pendientes: list[dict[str, Any]]) -> tuple[bool, str]:
    """El resultado y el texto del control, para el informe y el panel.

    Returns:
        Correcto si no queda ninguna ficha sin confirmar, y el texto con sus ids si queda alguna.
    """
    if not pendientes:
        return True, "ninguna ficha usada se queda sin fecha de fin teniendo en su texto fechas sin leer"
    ids = ", ".join(str(r["id"]) for r in pendientes)
    return False, (
        f"{len(pendientes)} fichas usadas se quedan sin fecha de fin aunque su texto nombra fechas que no se reconocen "
        f"(ids {ids}): puede haber cambiado la redacción; se conserva el conjunto admitido hasta revisarlas"
    )


def huella_de_pendientes(pendientes: list[dict[str, Any]]) -> str:
    """La huella de una lista de fichas pendientes, la que pasa quien las confirma.

    Returns:
        El SHA-256 de la lista en JSON canónico.
    """
    return hashlib.sha256(json.dumps(pendientes, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def guardar_pendientes(carpeta: Path, pendientes: list[dict[str, Any]]) -> None:
    """Deja las fichas pendientes con su huella o, si no queda ninguna, retira la lista anterior."""
    ruta = carpeta / PENDIENTES
    if pendientes:
        guardar_json(ruta, {"huella": huella_de_pendientes(pendientes), "fichas": pendientes})
    else:
        ruta.unlink(missing_ok=True)


def confirmar(carpeta: Path, huella: str) -> int:
    """Registra como revisadas las fichas pendientes, solo si son las que la persona revisó.

    Raises:
        FormatoInesperado: Si no hay fichas pendientes o la lista es otra que la revisada.

    Returns:
        El número de fichas confirmadas.
    """
    ruta = carpeta / PENDIENTES
    exigir(ruta.is_file(), "citilab: no hay fichas pendientes de confirmación")
    pendientes = leer_json(ruta)
    exigir(
        pendientes["huella"] == huella == huella_de_pendientes(pendientes["fichas"]),
        "citilab: las fichas pendientes no son las revisadas; revisa la lista otra vez",
    )
    anteriores = leer_json(carpeta / CONFIRMADAS)["fichas"] if (carpeta / CONFIRMADAS).is_file() else []
    nuevas = [{"id": f["id"], "texto_sha256": f["texto_sha256"]} for f in pendientes["fichas"]]
    # Una ficha ya confirmada para el mismo texto no se repite.
    unicas = list({(f["id"], f["texto_sha256"]): f for f in [*anteriores, *nuevas]}.values())
    guardar_json(carpeta / CONFIRMADAS, {"fichas": unicas})
    ruta.unlink()
    return len(nuevas)
