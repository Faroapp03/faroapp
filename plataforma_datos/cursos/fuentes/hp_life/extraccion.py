"""Lectura de una ficha HP conservada para el conjunto de la fuente: qué identidad acredita y con qué intervalo."""

import json
from http import HTTPStatus

from plataforma_datos.comun.nucleo import FormatoInesperado, exigir
from plataforma_datos.cursos.fuentes.hp_life import lector
from plataforma_datos.cursos.fuentes.hp_life.lector import ErrorFichaHpLife
from plataforma_datos.cursos.fuentes.hp_life.recepciones import leer_recepcion
from plataforma_datos.cursos.tipos_json import ObjetoJson


def pagina_de_error(cuerpo: bytes) -> bool:
    """Reconoce la página de error 500 de la aplicación del proveedor, no la de un fallo cualquiera del servidor.

    Es la forma con la que el sitio responde a la ficha de un curso que no existe: la ruta interna `/_error`, el
    único dato `statusCode: 500` y ninguna ficha.

    Returns:
        True solo si el cuerpo tiene exactamente esa forma.
    """
    analizador = lector._Next()
    try:
        analizador.feed(cuerpo.decode("utf-8"))
        analizador.close()
        raiz = json.loads("".join(analizador.partes))
    except (UnicodeDecodeError, ValueError, ErrorFichaHpLife):
        return False
    return (
        analizador.inicios == 1
        and analizador.cierres == 1
        and isinstance(raiz, dict)
        and raiz.get("page") == "/_error"
        and isinstance(raiz.get("props"), dict)
        and raiz["props"].get("pageProps") == {"statusCode": 500}
    )


def extraer(cuerpo: bytes, recibo: bytes, id: str) -> ObjetoJson:
    """Contrasta el cuerpo con su recibo y con el lector de fichas.

    Una ficha 200 que no se puede contrastar deja a su curso sin noticia (`fallo`); no detiene la lectura de
    los demás ni se toma por la baja del curso. Una respuesta 500 con la página de error de la aplicación lo dice en
    `pagina_de_error`.

    Returns:
        Intervalo, respuesta e identidad acreditada (vacía si la ficha no se contrasta).

    Raises:
        ErrorFichaHpLife: Si el recibo o el cuerpo conservados no son íntegros.
    """
    rx = leer_recepcion(cuerpo, recibo)
    lectura = {
        "ids": [id] if rx.captura.http == HTTPStatus.OK and rx.captura.completo else [],
        "inicio_utc": rx.inicio_utc,
        "fin_utc": rx.captura.recibido_utc,
        "http": rx.captura.http,
        "completo": rx.captura.completo,
    }
    if rx.captura.http == HTTPStatus.INTERNAL_SERVER_ERROR and rx.captura.completo and pagina_de_error(cuerpo):
        return {**lectura, "pagina_de_error": True}
    if not lectura["ids"]:
        return lectura
    try:
        lector.extraer_ficha(cuerpo, rx.captura)
    except lector.ErrorFichaHpLife:
        return {**lectura, "ids": [], "fallo": "ficha_hp_no_contrastable"}
    return lectura


def intento_fallido(intento: ObjetoJson, id: str) -> ObjetoJson:
    """Lee un intento sin respuesta de una unidad: su intervalo y su error, sin identidades observadas.

    Returns:
        Lectura de fallo de consulta.

    Raises:
        FormatoInesperado: Si el intento no es de esa unidad o declara una respuesta.
    """
    exigir(
        intento.get("schema_version") == 1 and intento.get("resultado") == "fallo" and intento.get("id") == id,
        "Intento fallido ajeno a la unidad",
        FormatoInesperado,
    )
    return {
        "ids": [],
        "inicio_utc": intento["inicio_utc"],
        "fin_utc": intento["fin_utc"],
        "http": intento.get("http_observado"),
        "completo": False,
        "fallo": intento["error"],
    }
