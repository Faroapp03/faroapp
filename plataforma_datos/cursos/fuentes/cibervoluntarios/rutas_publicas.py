"""Reproduce la búsqueda del visor español al abrir la dirección registrada de un curso."""

import json
import re
from http import HTTPStatus
from pathlib import Path
from urllib.parse import quote, unquote

from plataforma_datos.comun.nucleo import FormatoInesperado, exigir
from plataforma_datos.cursos import operacion_fuente as comun
from plataforma_datos.cursos.fuentes.cibervoluntarios import direcciones, lector

FICHA = "https://www.cibervoluntarios.org/es/formacion-gratuita/aprende-a-tu-ritmo/cursos/"
BUSCADOR = "https://www.cibervoluntarios.org/api/public/activity_catalogs?activityCatalogMaterials.slug="


def slug_registrado(url: object) -> str | None:
    """Extrae el slug únicamente de una ficha pública canónica.

    Returns:
        Slug exacto del proveedor con su codificación comprobada o None.
    """
    if not isinstance(url, str) or not url.startswith(FICHA):
        return None
    slug = unquote(url[len(FICHA) :])
    return slug if re.fullmatch(r"[\w@-]+", slug) and FICHA + quote(slug, safe="") == url else None


def consulta(slug: str) -> str:
    """Reproduce la petición pública del visor con idioma español.

    Returns:
        Dirección de la búsqueda que corresponde al slug exacto.
    """
    exigir(re.fullmatch(r"[\w@-]+", slug), "Slug Ciber inesperado", FormatoInesperado)
    return BUSCADOR + quote(slug, safe="") + "&lang=es"


def leer(original: Path, cap: dict) -> dict | None:
    """Solo una actividad y un único material visible de autoformación en español prueban la ruta.

    Returns:
        Identidad publicada con su localizador o None para respuestas insuficientes.
    """
    meta = comun.leer_recibo(original, cap)
    url = meta["url"]
    slug = unquote(url.removeprefix(BUSCADOR).removesuffix("&lang=es"))
    exigir(consulta(slug) == url, "Consulta de ruta Ciber ajena", FormatoInesperado)
    exigir(
        lector._fecha(meta["fin_utc"]) >= lector._fecha(meta["inicio_utc"]),
        "Recepción de ruta Ciber no causal",
        FormatoInesperado,
    )
    if cap["cuerpo"] is None:
        return None
    cuerpo = comun.leer_conservado(original, cap["cuerpo"])
    exigir(
        meta["cuerpo_sha256"] == cap["cuerpo"]["sha256"] and meta["bytes"] == len(cuerpo),
        "Recibo de ruta Ciber distinto",
        FormatoInesperado,
    )
    if meta["url_final"] != url or meta["http"] != HTTPStatus.OK or meta["completo"] is not True:
        return None
    try:
        pagina = json.loads(cuerpo, object_pairs_hook=lector._pares, parse_constant=lector._constante)
    except (ValueError, UnicodeError):
        return None
    return _seleccion_del_visor(pagina, slug)


def _seleccion_del_visor(pagina: object, slug: str) -> dict | None:
    if (
        not isinstance(pagina, dict)
        or type(pagina.get("hydra:totalItems")) is not int
        or pagina["hydra:totalItems"] != 1
    ):
        return None
    miembros = pagina.get("hydra:member")
    if not isinstance(miembros, list) or len(miembros) != 1 or not isinstance(miembros[0], dict):
        return None
    actividad = miembros[0]
    materiales = actividad.get("activityCatalogMaterials")
    if (
        actividad.get("status") != "Disponible"
        or actividad.get("erased") is not False
        or type(actividad.get("id")) is not int
        or actividad["id"] < 1
        or not isinstance(materiales, list)
        or not all(isinstance(m, dict) and type(m.get("id")) is int and m["id"] > 0 for m in materiales)
        or len({m["id"] for m in materiales}) != len(materiales)
    ):
        return None
    visibles = [
        (i, m)
        for i, m in enumerate(materiales)
        if m.get("lang") == "Español"
        and m.get("type") == "Autoformación"
        and m.get("status") == "Disponible"
        and m.get("erased") is False
    ]
    if len(visibles) != 1:
        return None
    indice, material = visibles[0]
    if not direcciones.destino_del_material(material.get("moodleLink")):
        return None
    return {
        "ficha": FICHA + quote(slug, safe=""),
        "actividad_id": actividad["id"],
        "material_id": material["id"],
        "slug": material.get("slug"),
        "titulo": material.get("title"),
        "destino": material["moodleLink"],
        "localizador": f"/hydra:member/0/activityCatalogMaterials/{indice}",
    }


def acredita(programa: dict, material: lector.MaterialCiber, lectura: dict | None) -> bool:
    """Contrasta la resolución del visor con el censo y el destino registrado del mismo material.

    Returns:
        True solo para la ficha histórica y las tres identidades concordantes.
    """
    anterior = programa["datos"].get("material_publicado", {})
    return bool(
        lectura
        and lectura["ficha"] == programa["url"]
        and lectura["actividad_id"] == material.actividad_id
        and lectura["material_id"] == material.id
        and lectura["slug"] == material.slug
        and isinstance(material.slug, str)
        and lectura["titulo"] == material.titulo == anterior.get("title")
        and isinstance(material.titulo, str)
        and lectura["destino"] == material.material_publicado.get("moodleLink") == anterior.get("moodleLink")
    )
