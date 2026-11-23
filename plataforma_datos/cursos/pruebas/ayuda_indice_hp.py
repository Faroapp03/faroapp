"""Páginas sintéticas del índice público de HP LIFE para las pruebas de ciclo, con la forma de las reales."""

import json
from http import HTTPStatus

from plataforma_datos.cursos import recepciones_catalogo as transporte
from plataforma_datos.cursos.fuentes.hp_life import indice

POR_PAGINA = 12


def pagina(numero: int, cursos: list[dict], total: int) -> bytes:
    """Una página del índice con sus cursos y el total declarado.

    Returns:
        HTML con el script de datos de la aplicación.
    """
    datos = {"props": {"pageProps": {"initialCourses": cursos, "totalCourses": total, "page": numero}}}
    return f'<html><script id="__NEXT_DATA__" type="application/json">{json.dumps(datos)}</script></html>'.encode()


def paginas(numeros: list[int], otros_idiomas: dict[int, str] | None = None) -> dict[int, bytes]:
    """Reparte los cursos dados (en español, más los de otro idioma indicados) en páginas de doce.

    Añade una página final vacía, como el índice real.

    Returns:
        Número de página y su HTML.
    """
    idiomas = {**dict.fromkeys(numeros, "es"), **(otros_idiomas or {})}
    cursos = [{"id": n, "name": f"Curso {n}", "language": idioma, "categoryId": 1} for n, idioma in idiomas.items()]
    trozos = [cursos[i : i + POR_PAGINA] for i in range(0, len(cursos), POR_PAGINA)] + [[]]
    return {i: pagina(i, trozo, len(cursos)) for i, trozo in enumerate(trozos, start=1)}


def respuesta(
    url: str, cuerpos: dict[int, bytes], inicio: str, fin: str, *, http: int = HTTPStatus.OK
) -> transporte.RespuestaCatalogo:
    """Respuesta de transporte de una página del índice; sin cuerpo si la página no existe en `cuerpos`.

    Returns:
        Respuesta del transporte común de catálogo.
    """
    numero = indice.numero_de_pagina(url)
    if numero not in cuerpos:
        return transporte.RespuestaCatalogo(url=url, inicio_utc=inicio, fin_utc=fin, cuerpo=None, error="timeout")
    return transporte.RespuestaCatalogo(
        url=url,
        inicio_utc=inicio,
        fin_utc=fin,
        cuerpo=cuerpos[numero],
        url_final=url,
        http=http,
        completo=True,
        content_type="text/html; charset=utf-8",
    )


DECLARACION = (
    "<h3>Los cursos de HP LIFE son gratuitos</h3><p>Son gratuitos para todas las personas en todas partes.</p>"
)
OTRAS_AYUDAS = "<h3>Inscribirse en un curso.</h3><p>Debe iniciar sesión para inscribirse.</p>"


def cuerpo_de_ayuda(temas: str = DECLARACION + OTRAS_AYUDAS) -> bytes:
    """Página de ayuda en español con los temas dados, con la forma de la real.

    Returns:
        HTML con el script de datos de la aplicación y `staticHelpTopics`.
    """
    datos = {"props": {"pageProps": {"staticHelpTopics": temas}}}
    return f'<html><script id="__NEXT_DATA__" type="application/json">{json.dumps(datos)}</script></html>'.encode()


def ayuda(
    url: str, inicio: str, fin: str, *, cuerpo: bytes | None = None, http: int = HTTPStatus.OK
) -> transporte.RespuestaCatalogo:
    """Respuesta de transporte de la página de ayuda; por defecto, con la declaración de gratuidad intacta.

    Returns:
        Respuesta del transporte común de catálogo.
    """
    return transporte.RespuestaCatalogo(
        url=url,
        inicio_utc=inicio,
        fin_utc=fin,
        cuerpo=cuerpo_de_ayuda() if cuerpo is None else cuerpo,
        url_final=url,
        http=http,
        completo=True,
        content_type="text/html; charset=utf-8",
    )
