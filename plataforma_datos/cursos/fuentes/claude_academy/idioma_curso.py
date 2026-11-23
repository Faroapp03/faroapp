"""Idioma explícito del objeto Course de la ficha correcta, nunca del atributo html lang."""

import re

from plataforma_datos.cursos import recibos_compartidos
from plataforma_datos.cursos.fuentes.claude_academy import condiciones_publicadas, lector

_IDIOMA = re.compile(r"[a-z]{2,3}(?:-[a-z0-9]{2,8})*", re.IGNORECASE)


def extraer(cuerpo: bytes, ficha: lector.FichaAcademy) -> dict | None:
    """Lee únicamente Course propio, con nombre, URL y proveedor concordantes.

    Returns:
        Idiomas explícitos y localizador o None si faltan o son ambiguos.
    """
    metadatos = condiciones_publicadas._Metadatos(ficha.url)
    try:
        metadatos.feed(cuerpo.decode("utf-8"))
        metadatos.close()
    except (UnicodeDecodeError, ValueError):
        return None
    candidatas = []
    for numero, texto in enumerate(metadatos.jsonld, 1):
        try:
            dato = recibos_compartidos.leer_json(texto.encode())
        except ValueError:
            return None
        elementos = dato if isinstance(dato, list) else [dato] if isinstance(dato, dict) else []
        if isinstance(dato, dict) and isinstance(dato.get("@graph"), list):
            elementos = dato["@graph"]
        for curso in elementos:
            if not isinstance(curso, dict) or curso.get("@type") != "Course" or curso.get("url") != ficha.url:
                continue
            proveedor = curso.get("provider")
            if (
                curso.get("name") != ficha.titulo
                or not isinstance(proveedor, dict)
                or proveedor.get("@type") != "Organization"
                or proveedor.get("name") != "Anthropic"
                or proveedor.get("url") != "https://www.anthropic.com"
            ):
                return None
            valor = curso.get("inLanguage")
            valores = [valor] if isinstance(valor, str) else valor
            if (
                not isinstance(valores, list)
                or not valores
                or not all(isinstance(x, str) and _IDIOMA.fullmatch(x) for x in valores)
            ):
                return None
            idiomas = sorted({x.lower().split("-")[0] for x in valores})
            candidatas.append(
                {
                    "valor": idiomas,
                    "localizador": f'script[type="application/ld+json"] número {numero}/Course/inLanguage',
                }
            )
    return candidatas[0] if len(candidatas) == 1 else None
