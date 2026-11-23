"""FUNDAE: los hechos de una edición, leídos de las tres respuestas públicas de su ficha.

De la ficha de difusiones de la especialidad salen la entidad formadora y el plazo de preinscripción; de la ficha de
su entidad, el nombre, las horas, el nivel digital, el sector de esa entidad y el programa oficial; de la de colectivos,
a quién se dirige. Nunca se guardan los contactos (correos, teléfonos, direcciones y CIF) que traen las respuestas, y
un control para la validación si alguno se cuela.
"""

import re
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from plataforma_datos.comun.nucleo import FormatoInesperado, exigir

PROGRAMAS = "https://www.fundae.es/docs/"
TELEFORMACION = 2
# Los colectivos de FUNDAE, con el texto con que los publica: si cambia el texto, la validación se para.
COLECTIVOS = {
    1: ("asalariados", "Soy trabajador asalariado"),
    2: ("autonomos", "Soy autónomo"),
    3: ("economia-social", "Trabajo/soy socio en una cooperativa. Sociedad laboral, ONG, etc"),
    4: ("administracion-publica", "Trabajo en la administración pública"),
    5: ("desempleados", "Desempleado"),
    6: ("erte", "Situación de ERTE / ERE"),
}
FECHA_API = re.compile(r"([0-9]{4}-[0-9]{2}-[0-9]{2})T00:00:00")
# Los plazos que publica FUNDAE son días civiles de España: el día de una consulta es el de su hora en Madrid.
ZONA = ZoneInfo("Europe/Madrid")
# Lo que nunca sale de la fuente: una arroba o un número de teléfono de España en el conjunto paran la validación.
CONTACTO = re.compile(r"@|\b[6789][0-9]{8}\b")


def fecha_api(valor: object) -> str:
    """«2026-10-31T00:00:00» como «2026-10-31».

    Returns:
        La fecha en formato AAAA-MM-DD.

    Raises:
        FormatoInesperado: Si la fecha no tiene la forma publicada.
    """
    partes = FECHA_API.fullmatch(valor) if isinstance(valor, str) else None
    if partes is None:
        raise FormatoInesperado(f"fecha inesperada de FUNDAE: {valor!r}")
    return partes.group(1)


def dia_civil(instante_utc: str) -> str:
    """El día civil en España (Europe/Madrid) de un instante UTC de un recibo («2026-10-23T22:30:00Z» → «2026-10-24»).

    Returns:
        El día en formato AAAA-MM-DD.
    """
    return datetime.fromisoformat(instante_utc.replace("Z", "+00:00")).astimezone(ZONA).date().isoformat()


def colectivos(lista: object) -> list[str]:
    """Los colectivos de una edición, con el nombre de Faro, en el orden de FUNDAE.

    Returns:
        Los nombres de los colectivos.

    Raises:
        FormatoInesperado: Si un colectivo no es uno de los conocidos o cambia su texto.
    """
    exigir(isinstance(lista, list) and lista, "colectivos de FUNDAE: debe ser una lista no vacía")
    nombres = []
    for fila in lista:
        exigir(isinstance(fila, dict), "colectivo de FUNDAE: debe ser un objeto")
        conocido = COLECTIVOS.get(fila.get("idColectivo"))
        if conocido is None or fila.get("descripcionColectivos") != conocido[1]:
            raise FormatoInesperado(f"colectivo inesperado de FUNDAE: {fila!r}")
        nombres.append(conocido[0])
    return nombres


def difusiones(contenedor: object) -> list[dict[str, Any]]:
    """Las difusiones (ediciones) de una respuesta de FUNDAE (lista `centrosRFO`), cada una con su identificador.

    Returns:
        Las filas de las difusiones.

    Raises:
        FormatoInesperado: Si la respuesta no tiene la forma publicada.
    """
    exigir(isinstance(contenedor, dict), "respuesta de FUNDAE: debe ser un objeto")
    filas = contenedor.get("centrosRFO")
    exigir(isinstance(filas, list), "respuesta de FUNDAE: centrosRFO debe ser una lista")
    for fila in filas:
        exigir(
            isinstance(fila, dict) and type(fila.get("idDifusionAccionFormativa")) is int,
            "difusión de FUNDAE sin identificador",
        )
    return filas


def difusion(contenedor: object, edicion: int) -> dict[str, Any]:
    """La difusión `edicion` de una respuesta de FUNDAE (lista `centrosRFO`).

    Returns:
        La fila de esa difusión.

    Raises:
        FormatoInesperado: Si la respuesta no tiene la forma publicada o no trae esa difusión.
    """
    for fila in difusiones(contenedor):
        if fila["idDifusionAccionFormativa"] == edicion:
            return fila
    raise FormatoInesperado(f"la respuesta de FUNDAE no trae la difusión {edicion}")


def plazo(fila: dict[str, Any]) -> dict[str, str]:
    """El plazo de preinscripción de una difusión, en días.

    Returns:
        `inicio` y `fin`, en formato AAAA-MM-DD.
    """
    return {
        "inicio": fecha_api(fila.get("fechaPreinscripcionInicio")),
        "fin": fecha_api(fila.get("fechaPreinscripcionFin")),
    }


def abierta(fila: dict[str, Any], dia: str) -> bool:
    """Si la preinscripción de una difusión está abierta el día `dia` (AAAA-MM-DD), según la propia ficha.

    Returns:
        True si `dia` está dentro del plazo publicado.
    """
    fechas = plazo(fila)
    return fechas["inicio"] <= dia <= fechas["fin"]


def curso(contenedor: object, codigo: str) -> dict[str, Any]:
    """La ficha del curso de una respuesta de FUNDAE, comprobando que es de `codigo` y en teleformación.

    Returns:
        La ficha del curso.

    Raises:
        FormatoInesperado: Si falta, es de otra especialidad o de otra modalidad.
    """
    ficha = contenedor.get("curso") if isinstance(contenedor, dict) else None
    exigir(isinstance(ficha, dict), f"{codigo}: la respuesta de FUNDAE no trae la ficha del curso")
    exigir(ficha.get("codigoTitulacion") == codigo, f"{codigo}: la ficha es de {ficha.get('codigoTitulacion')!r}")
    exigir(ficha.get("idModalidad") == TELEFORMACION, f"{codigo}: la ficha no es de teleformación")
    for campo in ("denominacion", "descripcionEstructurasSectoriales", "descripcionNivelDigitalizacion"):
        exigir(isinstance(ficha.get(campo), str), f"{codigo}: {campo} debe ser texto")
    exigir(isinstance(ficha.get("duracion"), int) and ficha["duracion"] > 0, f"{codigo}: duracion inesperada")
    return ficha


def programa(ficha: dict[str, Any], codigo: str) -> str:
    """El programa oficial en PDF de la especialidad, en fundae.es.

    Returns:
        Su dirección.

    Raises:
        FormatoInesperado: Si la ficha no lo trae o no está en fundae.es.
    """
    enlaces = ficha.get("url")
    exigir(isinstance(enlaces, list) and enlaces and isinstance(enlaces[0], dict), f"{codigo}: sin programa oficial")
    direccion = enlaces[0].get("item2")
    exigir(
        isinstance(direccion, str) and direccion.startswith(PROGRAMAS), f"{codigo}: programa inesperado {direccion!r}"
    )
    return direccion


def edicion(codigo: str, identificador: int, de_difusiones: object, centro: object, lista: object) -> dict[str, Any]:
    """Los hechos de una edición, de sus tres respuestas: difusiones de la especialidad, de su entidad y colectivos.

    El sector es el de la ficha de su entidad (cambia de una entidad a otra); el resto, de la difusión.

    Returns:
        La edición con su especialidad, nombre, horas, nivel, entidad, plazo, colectivos, sector y programa.
    """
    fila = difusion(de_difusiones, identificador)
    exigir(difusion(centro, identificador) is not None, f"{codigo}: la ficha de la entidad no trae la edición")
    ficha = curso(centro, codigo)
    exigir(isinstance(fila.get("entidadFormadora"), str), f"{codigo}: entidadFormadora debe ser texto")
    return {
        "id": str(identificador),
        "especialidad": codigo,
        "nombre": " ".join(ficha["denominacion"].split()),
        "horas": ficha["duracion"],
        "nivel_digital": ficha["descripcionNivelDigitalizacion"] or None,
        "entidad": " ".join(fila["entidadFormadora"].split()),
        "preinscripcion": plazo(fila),
        "colectivos": colectivos(lista),
        "sector": " ".join(ficha["descripcionEstructurasSectoriales"].split()),
        "programa": programa(ficha, codigo),
    }
