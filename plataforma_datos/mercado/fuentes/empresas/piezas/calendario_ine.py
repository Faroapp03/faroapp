"""Las fechas de publicación de la encuesta TIC de empresas, leídas del calendario de publicaciones del INE capturado.

El productor de `empresas` descarga el calendario (iCalendar) junto con sus demás originales y lo registra en su
procedencia. De él salen la fecha de publicación de cada edición y la de la siguiente, buscando el evento por su
título, con una sola coincidencia por edición. Que la edición esté publicada de verdad lo acredita el dato leído de la
propia fuente: el calendario solo da fechas, citadas con el día de su consulta.

El calendario cambia en cada generación y no da cifras: se acepta siempre con su huella y su fecha nuevas, sin la
aceptación explícita que piden los demás originales. Un fallo suyo no detiene la fuente: si el INE no responde, o la
respuesta no trae la edición vigente, se conserva el calendario registrado; sin ninguno, la vigencia va sin fecha de
publicación y lo dice.
"""

import re
from collections.abc import Mapping
from pathlib import Path
from typing import Any, NamedTuple

from plataforma_datos.comun.descarga_acotada import Contrato, descargar_acotados
from plataforma_datos.comun.dia_de_consulta import dia_de_consulta
from plataforma_datos.comun.entrada_salida import entradas_procedencia, original, procedencia
from plataforma_datos.comun.estadisticas import LICENCIA_INE
from plataforma_datos.comun.nucleo import ArchivoDescargable, EntradaDeDescarga, FormatoInesperado, exigir
from plataforma_datos.comun.vigencia import CALENDARIO_INE

FUENTE = "empresas"
ARCHIVO = "ine-calendario.ics"
URL = "https://www.ine.es/dynt3/Calendario/calendario.ics"
CALENDARIO: ArchivoDescargable = {
    "archivo": ARCHIVO,
    "nivel": "oficial",
    "titulo": "INE, calendario de publicaciones (iCalendar)",
    "url": URL,
    "licencia": LICENCIA_INE,
}
# El calendario entero ocupa unos 2 MB; el tope deja margen sin admitir otra cosa.
MAX_BYTES = 16 * 1024 * 1024
TITULO = (
    "Encuesta sobre el Uso de Tecnologías de la Información y las Comunicaciones y del Comercio Electrónico en las "
    "Empresas {desde}-{hasta}"
)
# Una línea que empieza por espacio o tabulador continúa la anterior (RFC 5545, 3.1).
PLIEGUE = re.compile(r"\r?\n[ \t]")
DIA = re.compile(r"([0-9]{4})([0-9]{2})([0-9]{2})")


class Fechas(NamedTuple):
    """La publicación de una edición, la de la siguiente si el calendario la trae, y el texto que lo cita."""

    publicado: str | None
    siguiente: str | None
    calendario: str


def contrato(anio: int) -> Contrato:
    """Lo que se acepta del INE: un iCalendar que trae una sola vez la edición vigente (`anio`).

    Returns:
        El contrato de la descarga.
    """

    def cuerpo(datos: bytes) -> None:
        exigir(
            datos.startswith(b"BEGIN:VCALENDAR") and b"END:VCALENDAR" in datos,
            "calendario del INE: la respuesta no es un iCalendar",
        )
        exigir(fecha_de(eventos(datos.decode("utf-8")), anio) is not None, f"calendario del INE: sin la edición {anio}")

    return Contrato(("text/calendar",), MAX_BYTES, cuerpo)


def descargar(carpeta: Path, anio: int, previos: Mapping[str, dict[str, Any]]) -> list[EntradaDeDescarga]:
    """Captura el calendario, aceptado siempre; si falla, conserva el registrado.

    Returns:
        La entrada de procedencia del calendario nuevo, la del registrado si la consulta falla, o nada.
    """
    try:
        return descargar_acotados([CALENDARIO], carpeta, True, contrato(anio))
    except (OSError, UnicodeDecodeError, FormatoInesperado) as error:
        print(f"calendario del INE: se conserva el registrado ({error})")
        return [previos[ARCHIVO]] if ARCHIVO in previos else []


def eventos(texto: str) -> list[tuple[str, str]]:
    """Los eventos del calendario, con las líneas plegadas desplegadas: su título y el día de su comienzo.

    Returns:
        (título, AAAA-MM-DD) por evento, en el orden del calendario.

    Raises:
        FormatoInesperado: Si un evento no trae título o día de comienzo.
    """
    salida = []
    for bloque in PLIEGUE.sub("", texto).split("BEGIN:VEVENT")[1:]:
        campos: dict[str, str] = {}
        for linea in bloque.splitlines():
            clave, _, valor = linea.partition(":")
            campos.setdefault(clave.split(";")[0], valor)
        titulo, comienzo = campos.get("SUMMARY"), campos.get("DTSTART")
        dia = DIA.match(comienzo or "")
        if titulo is None or dia is None:
            raise FormatoInesperado("calendario del INE: un evento no trae título o día de comienzo")
        salida.append((titulo.strip(), "-".join(dia.groups())))
    return salida


def fecha_de(lista: list[tuple[str, str]], anio: int) -> str | None:
    """El día del evento de la edición cuyo primer trimestre es de `anio` (la de 2026 se titula «2025-2026»).

    Returns:
        El día (AAAA-MM-DD), o None si el calendario no trae esa edición.

    Raises:
        FormatoInesperado: Si el título aparece más de una vez.
    """
    titulo = TITULO.format(desde=anio - 1, hasta=anio)
    dias = [dia for nombre, dia in lista if nombre == titulo]
    exigir(len(dias) <= 1, f"calendario del INE: «{titulo}» aparece {len(dias)} veces; no se elige ninguna fecha")
    return dias[0] if dias else None


def nota_de_la_siguiente(anio: int, siguiente: str | None) -> str:
    """Lo que dice el calendario de la edición que sigue a la del año `anio`.

    Returns:
        «la edición siguiente (2026–2027) está anunciada en el calendario del INE para el 21/10/2027», o que el
        calendario aún no la publica.
    """
    nombre = f"{anio}–{anio + 1}"
    if siguiente is None:
        return f"el calendario del INE aún no publica la edición siguiente ({nombre})"
    dia = "/".join(reversed(siguiente.split("-")))
    return f"la edición siguiente ({nombre}) está anunciada en el calendario del INE para el {dia}"


def fechas(texto: str, consulta: str, anio: int) -> Fechas:
    """Las fechas de la edición `anio` y de la siguiente, del calendario capturado en el instante `consulta`.

    Returns:
        Las fechas y el texto que las cita con el día de la consulta en Cataluña.

    Raises:
        FormatoInesperado: Si el calendario no trae la edición vigente, o la trae más de una vez.
    """
    lista = eventos(texto)
    publicado = fecha_de(lista, anio)
    exigir(publicado is not None, f"calendario del INE: no trae la edición {anio - 1}-{anio}; no se inventa su fecha")
    siguiente = fecha_de(lista, anio + 1)
    citado = f"{CALENDARIO_INE}, consultado el {dia_de_consulta(consulta)}: {nota_de_la_siguiente(anio, siguiente)}"
    return Fechas(publicado, siguiente, citado)


def capturadas(anio: int) -> Fechas:
    """Las fechas de la edición `anio` en el calendario registrado; sin él o sin la edición, sin fecha y dicho.

    Returns:
        Las fechas del calendario registrado, o ninguna con el texto que explica por qué.
    """
    entrada = next((e for e in entradas_procedencia(procedencia(FUENTE)) if e["archivo"] == ARCHIVO), None)
    if entrada is None:
        return Fechas(None, None, f"{CALENDARIO_INE}: Faro aún no lo ha consultado; no consta la fecha de publicación")
    try:
        return fechas(original(FUENTE, ARCHIVO).read_text(encoding="utf-8"), entrada["descargado_utc"], anio)
    except FormatoInesperado:
        consulta = dia_de_consulta(entrada["descargado_utc"])
        return Fechas(
            None, None, f"{CALENDARIO_INE}, consultado el {consulta}: no da la fecha de publicación de esta edición"
        )
