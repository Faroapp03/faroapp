"""Las unidades del catálogo de cursos que una instalación sirve: lo que la persona ve en la página de Cursos.

El catálogo servido es el archivo que fija la referencia pública (`web/scripts/catalogo-cursos/referencia.js`, que
escribe `publicar_catalogo.publicar`) por su ruta y su huella. Cada oferta lleva su unidad (`unidad.id`), con el mismo
identificador que usa la lectura de su fuente: `cibernarium-edicion:…`, `fundae:edicion:…`, `fundae:1:…`,
`cibervoluntarios:material:…`, `hp-life:…:<idioma>` y `claude-academy:…`. Solo lee: no cambia nada.
"""

import hashlib
import json
import re
from pathlib import Path

from plataforma_datos.cursos.comprobacion_pagina.consulta_de_retirados import Ficha
from plataforma_datos.cursos.publicar_catalogo import RUTA_REFERENCIA
from plataforma_datos.cursos.tipos_json import ObjetoJson

WEB = "web"
RUTA = re.compile(r"^  ruta: '(datos/catalogo-cursos/[0-9a-f]{64}\.json)',$", re.MULTILINE)
HUELLA = re.compile(r"^  sha256: '([0-9a-f]{64})',$", re.MULTILINE)


def _ofertas_servidas(raiz: Path) -> list[ObjetoJson]:
    """Las ofertas del catálogo de cursos que sirve la instalación, comprobada su huella.

    Returns:
        Las ofertas; vacía si la instalación aún no sirve ningún catálogo.

    Raises:
        ValueError: Si la referencia no se entiende o el catálogo no tiene la huella que ella fija.
        OSError: Si el catálogo que fija la referencia no se puede leer.
    """
    referencia = raiz / WEB / RUTA_REFERENCIA
    if not referencia.is_file():
        return []
    texto = referencia.read_text(encoding="utf-8")
    ruta, huella = RUTA.search(texto), HUELLA.search(texto)
    if ruta is None or huella is None:
        raise ValueError("la referencia del catálogo de cursos no dice su ruta y su huella")
    cuerpo = (raiz / WEB / ruta[1]).read_bytes()
    if hashlib.sha256(cuerpo).hexdigest() != huella[1]:
        raise ValueError("el catálogo de cursos servido no tiene la huella que fija su referencia")
    return json.loads(cuerpo)["ofertas"]


def unidades_servidas(raiz: Path) -> frozenset[str]:
    """Los identificadores de las unidades que sirve el catálogo de cursos de la instalación.

    Returns:
        Los identificadores de todas las fuentes; vacío si la instalación aún no sirve ningún catálogo.
    """
    return frozenset(oferta["unidad"]["id"] for oferta in _ofertas_servidas(raiz))


def fichas_servidas(raiz: Path) -> dict[str, Ficha]:
    """La página pública y el título de cada unidad servida, para consultar su página.

    Una oferta sin dirección o sin título no tiene página que consultar y no se lista.

    Returns:
        La ficha de cada unidad por su identificador.
    """
    return {
        oferta["unidad"]["id"]: Ficha(url=oferta["url"], titulo=oferta["titulo_programa"])
        for oferta in _ofertas_servidas(raiz)
        if isinstance(oferta.get("url"), str) and isinstance(oferta.get("titulo_programa"), str)
    }
