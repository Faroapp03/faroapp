"""Cobertura de canales conocidos de Cursos, distinta de disponibilidad de ofertas."""

import hashlib
from http import HTTPStatus
from pathlib import Path

from plataforma_datos.comun.nucleo import ErrorFuente
from plataforma_datos.comun.observacion_remota import identidad_recurso
from plataforma_datos.cursos import operacion_fuente
from plataforma_datos.cursos.fuentes.cibervoluntarios import bajas, direcciones
from plataforma_datos.cursos.fuentes.hp_life import gratuidad, indice
from plataforma_datos.cursos.fuentes.hp_life.recepciones import fecha_utc, leer_recepcion

VERSION_RECEPCION = 2


def _recepcion(fuente: str, original: Path, fila: dict) -> dict:
    if fila.get("cuerpo") is None:
        # Unidad cuya consulta falló (fuentes con fallos por unidad): la cobertura de ese intento no está completa.
        raise ErrorFuente("Recepción sin cuerpo: la consulta de esa unidad falló")
    cuerpo = operacion_fuente.leer_conservado(
        original, fila["cuerpo"], maximo_bytes=operacion_fuente.limite_cuerpo(fuente)
    )
    recibo = operacion_fuente.leer_conservado(original, fila["recibo"])
    if fuente == "hp_life":
        rx = leer_recepcion(cuerpo, recibo)
        return {
            "url": rx.captura.url_solicitada,
            "url_final": rx.captura.url_final,
            "http": rx.captura.http,
            "completo": rx.captura.completo,
            "inicio_utc": rx.inicio_utc,
            "fin_utc": rx.captura.recibido_utc,
            "sha256": rx.captura.sha256_cuerpo,
            "bytes": len(cuerpo),
        }
    dato = operacion_fuente.leer_recibo(original, fila)
    return {**dato, "sha256": dato["cuerpo_sha256"]}


def _destinos_de_ciber(admitido: dict) -> dict[str, dict | None]:
    """Destinos que Cibervoluntarios pide a los materiales ausentes del censo: uno por cada ausente no retirado ya.

    Un destino cuenta como recibido solo si respondió como se reconoce (la página de error de un curso que no existe
    o el inicio de sesión de uno que existe). Un ausente sin destino pedido es un recurso esperado sin recibo.

    Returns:
        Su captura por dirección; None si no hay respuesta reconocida. Sin destino pedido, la clave es la identidad.
    """
    fichas = admitido.get(bajas.FICHAS, {})
    destinos = {
        f["lectura"]["url"]: f if bajas.veredicto(f["lectura"]) != bajas.SIN_NOTICIA else None for f in fichas.values()
    }
    resueltos = {*fichas, *admitido.get(bajas.YA_RETIRADOS, [])}
    destinos.update(dict.fromkeys(set(admitido["censo"].get("conocidos_ausentes", [])) - resueltos))
    return destinos


def _apoyos(fuente: str, admitido: dict) -> dict[str, dict | None]:
    """Páginas que una fuente consulta además de sus fichas: en HP LIFE, las del índice y la ayuda de la gratuidad.

    La ayuda solo cuenta como recibida si su declaración de gratuidad está intacta; si no, es un recurso esperado sin
    recibo y la fuente no se acredita.

    Returns:
        Su captura por dirección; None en una página que no cuenta como recibida. Vacío en otras fuentes.
    """
    if fuente == "cibervoluntarios":
        return _destinos_de_ciber(admitido)
    if fuente != "hp_life":
        return {}
    censo = admitido.get("indice") or {}
    apoyos: dict[str, dict | None] = {indice.url_pagina(n): None for n in censo.get("paginas_sin_noticia", [])}
    apoyos.update({indice.url_pagina(p["pagina"]): p for p in censo.get("paginas", [])})
    if admitido.get("gratuidad"):
        ayuda = admitido["gratuidad"]
        apoyos[gratuidad.URL_AYUDA] = ayuda["captura"] if ayuda["intacta"] else None
    return apoyos


def _canales(raiz: Path, fuente: str, admitido: dict) -> set[str]:
    programas = operacion_fuente.conocidos(fuente, raiz)
    if fuente == "cibervoluntarios":
        if admitido.get("censo_completo") is not True:
            raise ErrorFuente("Censo Ciber incompleto")
        recibos = _recibos(fuente, original=operacion_fuente.rutas_de_la_fuente(fuente, raiz)[0], admitido=admitido)
        return {rx["url"] for rx in recibos} | set(_apoyos(fuente, admitido))
    if fuente == "claude_academy":
        if not {p["id"] for p in programas} <= {f["id"] for f in admitido["recepciones"]}:
            raise ErrorFuente("Cobertura Academy sin sus identidades previas")
        return {
            rx["url"]
            for rx in _recibos(fuente, original=operacion_fuente.rutas_de_la_fuente(fuente, raiz)[0], admitido=admitido)
        }
    if {p["id"] for p in programas} != {f["id"] for f in admitido["recepciones"]}:
        raise ErrorFuente("Cobertura de identidades incompleta")
    return {p["url"] for p in programas} | set(_apoyos(fuente, admitido))


def _recibos(fuente: str, *, original: Path, admitido: dict) -> list[dict]:
    capturas = list(admitido["recepciones"])
    if fuente in ("claude_academy", "cibervoluntarios"):
        capturas.extend(admitido["auxiliares"].values())
    capturas.extend(captura for captura in _apoyos(fuente, admitido).values() if captura is not None)
    if fuente == "claude_academy":
        capturas.extend(f["leccion"] for f in admitido["recepciones"] if isinstance(f.get("leccion"), dict))
    return [_recepcion(fuente, original, fila) for fila in capturas]


def _es_inicio_de_sesion(rx: dict) -> bool:
    """El destino de un curso que existe responde 303 al inicio de sesión de la plataforma de cursos.

    Returns:
        True si la respuesta es esa redirección.
    """
    return rx["http"] == HTTPStatus.SEE_OTHER and rx.get("redireccion") == direcciones.INICIO_DE_SESION


def _vinculada(rx: dict, p: dict, evidencia: dict) -> bool:
    """Si la petición del recibo es la recepción leída: mismos bytes, destino y orden de los instantes.

    `rx` sale de los lectores del paquete; `p` y `evidencia`, del recibo recibido, por eso se leen sin suponer campos.

    Returns:
        True solo si todo coincide; False si falta o difiere algo.

    Raises:
        ValueError: Si un instante no es UTC válido (error de datos, no de programación).
    """
    return (
        rx["completo"] is True
        and (rx["http"] in (200, 404, 410) or _es_inicio_de_sesion(rx))
        and p.get("respuesta_sha256") == p.get("original_sha256") == rx["sha256"]
        and p.get("bytes") == p.get("original_bytes") == rx["bytes"]
        and p.get("url_final_sha256") == hashlib.sha256(rx["url_final"].encode()).hexdigest()
        and fecha_utc(evidencia.get("comienzo_utc"))
        <= fecha_utc(rx["inicio_utc"])
        <= fecha_utc(p.get("completado_utc"))
        <= fecha_utc(rx["fin_utc"])
        <= fecha_utc(evidencia.get("fin_utc"))
    )


def _peticiones_del_recibo(evidencia: object) -> list[dict] | None:
    """Las peticiones de un recibo de recepción de una fuente del catálogo, si tiene la forma esperada.

    Returns:
        Las peticiones, cada una con la identidad de su recurso, o `None` si el recibo es de otra versión, de otra
        fuente o tiene otra forma.
    """
    if not isinstance(evidencia, dict):
        return None
    fuente = evidencia.get("fuente")
    if (
        evidencia.get("version") != VERSION_RECEPCION
        or not isinstance(fuente, str)
        or fuente not in operacion_fuente.FUENTES
    ):
        return None
    peticiones = evidencia.get("peticiones")
    if not isinstance(peticiones, list) or not all(
        isinstance(p, dict) and isinstance(p.get("recurso_sha256"), str) for p in peticiones
    ):
        return None
    return peticiones


def comprobada(raiz: Path, evidencia: dict) -> bool:
    """Exige recepción nueva vinculada a todos los canales declarados, nunca un censo.

    Un recibo con otra forma o datos inválidos da False; un error de programación se propaga, no se oculta.

    Returns:
        False si faltan cuerpos, identidades, admisión, canales o vínculos del intento.
    """
    lista = _peticiones_del_recibo(evidencia)
    if lista is None:
        return False
    try:
        fuente = evidencia["fuente"]
        admitido = operacion_fuente.leer_validado(fuente, raiz)
        if admitido is None:
            return False
        urls = _canales(raiz, fuente, admitido)
        peticiones = {p["recurso_sha256"]: p for p in lista}
        peticiones_completas = (
            urls and len(peticiones) == len(lista) and set(peticiones) == {identidad_recurso(url) for url in urls}
        )
        original, _, _ = operacion_fuente.rutas_de_la_fuente(fuente, raiz)
        recibos = _recibos(fuente, original=original, admitido=admitido)
        canales_completos = len(recibos) == len(urls) and {r["url"] for r in recibos} == urls
        return bool(
            peticiones_completas
            and canales_completos
            and all(_vinculada(rx, peticiones[identidad_recurso(rx["url"])], evidencia) for rx in recibos)
        )
    except (ErrorFuente, OSError, ValueError):
        return False
