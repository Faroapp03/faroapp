"""Direcciones que Cibervoluntarios puede pedir: las páginas de su censo y el destino registrado de un material."""

import re
from urllib.parse import parse_qs, urlsplit

from plataforma_datos.comun.nucleo import FormatoInesperado, exigir

SERVIDOR_DE_CURSOS = "e-learning.cibervoluntarios.org"
INICIO_DE_SESION = "https://" + SERVIDOR_DE_CURSOS + "/login/index.php"
# El destino de un material es una página de error o una redirección corta: un megabyte sobra.
LIMITE_BYTES_DESTINO = 1024 * 1024
_DESTINO = re.compile(r"id=([1-9][0-9]*)")
_SECCION = re.compile(r"section-[0-9]+")


def exigir_pagina_del_censo(url: str) -> None:
    """Comprueba que la dirección es una página del censo público, con solo sus tres parámetros.

    Raises:
        FormatoInesperado: Si la dirección es ajena al censo o ambigua.
    """
    u = urlsplit(url)
    qs = parse_qs(u.query, strict_parsing=True)
    exigir(
        u.scheme == "https"
        and u.netloc == "www.cibervoluntarios.org"
        and u.path == "/api/public/activity_catalogs"
        and not u.fragment
        and set(qs) <= {"lang", "page", "itemsPerPage"},
        "URL ajena al catálogo Ciber",
        FormatoInesperado,
    )
    exigir(all(len(v) == 1 for v in qs.values()), "Consulta Ciber ambigua", FormatoInesperado)


def destino_del_material(valor: object) -> str | None:
    """Reconoce el destino registrado de un material: la página de su curso, sin la sección.

    Returns:
        La dirección que se pide (`https://e-learning.cibervoluntarios.org/course/view.php?id=N`), o None si el
        valor no es una dirección de curso de ese servidor.
    """
    if not isinstance(valor, str):
        return None
    partes = urlsplit(valor)
    curso = _DESTINO.fullmatch(partes.query)
    seccion = not partes.fragment or _SECCION.fullmatch(partes.fragment) is not None
    if partes.scheme != "https" or partes.netloc != SERVIDOR_DE_CURSOS or partes.path != "/course/view.php":
        return None
    return f"https://{SERVIDOR_DE_CURSOS}/course/view.php?id={curso.group(1)}" if curso and seccion else None
