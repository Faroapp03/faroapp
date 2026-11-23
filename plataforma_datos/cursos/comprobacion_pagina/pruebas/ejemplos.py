"""Páginas sintéticas con la estructura y los literales de las fichas reales, y las respuestas que las traen.

Son recortes inventados de pocas líneas: ninguna es una página de un tercero.
"""

import json

from plataforma_datos.cursos.comprobacion_pagina.respuesta import Curso, Respuesta

HORA = "2026-11-22T10:00:00Z"
TITULO = "Hojas de cálculo para la vida diaria"
URL_CURSO = "https://cursos.ejemplo.test/ficha-actividad?activityId=40112"
URL_SONDA = "https://cursos.ejemplo.test/ficha-actividad?activityId=998369006"
RELLENO = "Aprende a ordenar datos, hacer cuentas y presentar resultados paso a paso con ejercicios guiados. " * 4


def pagina(cuerpo: str, scripts: int = 0, cabecera: str = "") -> bytes:
    """Un documento HTML con su cabecera, su cuerpo y el número de `<script>` que se pida.

    Returns:
        Los bytes en UTF-8.
    """
    codigo = "<script>var a = 1;</script>" * scripts
    return f"<!doctype html><html><head><title>{cabecera}</title>{codigo}</head><body>{cuerpo}</body></html>".encode()


def ficha_abierta(titulo: str = TITULO) -> bytes:
    """Una ficha de Cibernàrium con su título, su texto y su botón de inscripción.

    Returns:
        Los bytes de la página.
    """
    return pagina(
        f"<h1>{titulo}</h1><p>{RELLENO}</p><a>Inscriure'm</a><footer><a>Inscriu-te a la IT Academy</a></footer>",
        scripts=2,
        cabecera=titulo,
    )


def ficha_con(frase: str, titulo: str = TITULO) -> bytes:
    """Una ficha de Cibernàrium con el título y una frase suelta, sin botón de inscripción.

    Returns:
        Los bytes de la página.
    """
    return pagina(f"<h1>{titulo}</h1><p>{RELLENO}</p><p>{frase}</p>", cabecera=titulo)


def ficha_generica() -> bytes:
    """La ficha genérica sin título con que un sitio responde 200 a cualquier identificador.

    Returns:
        Los bytes de la página.
    """
    return pagina(f"<h1>Fitxa Activitat</h1><p>{RELLENO}</p><footer><a>Inscriu-te a la IT Academy</a></footer>")


def datos_next(estado: str, privacidad: str = "Public", nombre: str = TITULO) -> bytes:
    """Una página de HP LIFE sin texto visible que trae el curso en `__NEXT_DATA__`.

    Returns:
        Los bytes de la página.
    """
    curso = {"id": 135, "name": nombre, "status": estado, "privacyLevel": privacidad}
    datos = {"page": "/course/[id]", "props": {"pageProps": {"initialCourseData": curso}}}
    return pagina(
        f'<div id="__next"></div><script id="__NEXT_DATA__" type="application/json">{json.dumps(datos)}</script>'
    )


def curso(fuente: str = "barcelonactiva") -> Curso:
    """El curso de pruebas de la fuente que se pida.

    Returns:
        El curso con el título de las pruebas.
    """
    return Curso(id="cibernarium:edicion:40112", fuente=fuente, titulo=TITULO)


def respuesta(cuerpo: bytes = b"", **cambios: object) -> Respuesta:
    """La respuesta 200 de la página del curso, con los campos que se cambien.

    Returns:
        Una respuesta HTML a `URL_CURSO` sin redirecciones.
    """
    datos = {"url": URL_CURSO, "http": 200, "url_final": URL_CURSO, "saltos": 0, "tipo": "text/html", "cuerpo": cuerpo}
    return Respuesta(**{**datos, **cambios})


def sonda(cuerpo: bytes | None = None, **cambios: object) -> Respuesta:
    """La respuesta de la sonda del dominio: por defecto, la ficha genérica con un 200.

    Returns:
        Una respuesta HTML a `URL_SONDA`.
    """
    datos = {
        "url": URL_SONDA,
        "http": 200,
        "url_final": URL_SONDA,
        "saltos": 0,
        "tipo": "text/html",
        "cuerpo": ficha_generica() if cuerpo is None else cuerpo,
    }
    return Respuesta(**{**datos, **cambios})
