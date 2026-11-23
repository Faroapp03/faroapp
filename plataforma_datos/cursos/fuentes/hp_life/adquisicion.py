"""Adquiere una ficha HP o una página de su índice público y conserva su recepción real.

No usa cuentas, no evalúa oferta ni modifica SQLite. Los fallos
sin respuesta no se convierten en un recibo HTTP o en una baja del curso.
"""

import hashlib
from collections.abc import Callable
from dataclasses import asdict, dataclass
from pathlib import Path

from plataforma_datos.comun.nucleo import Descarga
from plataforma_datos.comun.observacion_remota import observar_original
from plataforma_datos.cursos import recepciones_catalogo as recepciones
from plataforma_datos.cursos import trozos_catalogo
from plataforma_datos.cursos.admision_catalogo import ReferenciaArchivo
from plataforma_datos.cursos.fuentes.hp_life import gratuidad, indice
from plataforma_datos.cursos.fuentes.hp_life.actualizacion import RecepcionEnDisco
from plataforma_datos.cursos.fuentes.hp_life.lector import CURSO, CapturaHpLife, ErrorFichaHpLife, _url
from plataforma_datos.cursos.fuentes.hp_life.recepciones import leer_recepcion


@dataclass(frozen=True, kw_only=True)
class AdquisicionHpLife:
    """Intento conservado; una recepción puede faltar sin alterar la última oferta admitida."""

    intento: ReferenciaArchivo
    recepcion: RecepcionEnDisco | None


def recibir(
    url: str,
    *,
    id: str,
    area: Path,
    reloj: Callable[[], str] = recepciones.ahora_utc,
) -> AdquisicionHpLife:
    """Conserva bytes descomprimidos y recibo íntegro; cada consulta mantiene su intervalo.

    Returns:
        Intento real y recepción verificable, o solo intento ante error de transporte.

    Raises:
        ErrorFichaHpLife: Si la identidad solicitada o la conservación no son válidas.
    """
    curso = CURSO.fullmatch(_url(url))
    if curso is None or id != f"hp-life:{int(curso.group(2))}:{curso.group(1)}":
        raise ErrorFichaHpLife("La consulta exige la URL de la identidad HP conocida")
    return _conservar_consulta(url, id=id, area=area, reloj=reloj)


def recibir_indice(
    pagina: int,
    *,
    area: Path,
    reloj: Callable[[], str] = recepciones.ahora_utc,
) -> AdquisicionHpLife:
    """Conserva una página del índice público con el mismo recibo íntegro que una ficha.

    Returns:
        Intento real y recepción verificable, o solo intento ante error de transporte.

    Raises:
        ErrorFichaHpLife: Si el número de página no es posible.
    """
    return _conservar_consulta(indice.url_pagina(pagina), id=f"hp-life:indice:{pagina}", area=area, reloj=reloj)


def recibir_ayuda(
    *,
    area: Path,
    reloj: Callable[[], str] = recepciones.ahora_utc,
) -> AdquisicionHpLife:
    """Conserva la página de ayuda en español, donde HP LIFE declara la gratuidad de sus cursos.

    Returns:
        Intento real y recepción verificable, o solo intento ante error de transporte.
    """
    return _conservar_consulta(gratuidad.URL_AYUDA, id="hp-life:ayuda", area=area, reloj=reloj)


def _conservar_consulta(url: str, *, id: str, area: Path, reloj: Callable[[], str]) -> AdquisicionHpLife:
    respuesta = recepciones.consultar(url, perfil="pagina", reloj=reloj)
    inicio, fin = respuesta.inicio_utc, respuesta.fin_utc
    if respuesta.cuerpo is None:
        intento = {
            "schema_version": 1,
            "id": id,
            "url": url,
            "inicio_utc": inicio,
            "fin_utc": fin,
            "resultado": "fallo",
            "error": respuesta.error,
        }
        if respuesta.http is not None:
            intento["http_observado"] = respuesta.http
        return AdquisicionHpLife(
            intento=recepciones.conservar_bytes(area, recepciones.json_bytes(intento), ".intento.json"), recepcion=None
        )
    cuerpo, final, mime, status = respuesta.cuerpo, respuesta.url_final, respuesta.content_type, respuesta.http
    sha = hashlib.sha256(cuerpo).hexdigest()
    captura = CapturaHpLife(
        url_solicitada=url,
        url_final=final,
        localizador="recepcion-principal",
        formato="html_next",
        sha256_cuerpo=sha,
        bytes_cuerpo=len(cuerpo),
        http=status,
        completo=respuesta.completo,
        original_conservado=True,
        recibido_utc=fin,
        fecha_declarada_utc=None,
        sha256_respuesta=sha,
    )
    recibo = recepciones.json_bytes(
        {
            "captura": asdict(captura),
            "inicio_utc": inicio,
            "content_type": mime,
            "representacion_hash": "cuerpo-http-descomprimido",
        }
    )
    leer_recepcion(cuerpo, recibo)
    body = recepciones.conservar_bytes(area, cuerpo, ".body")
    observar_original(
        url, Descarga(cuerpo, final, mime), trozos_catalogo.leer(body.ruta, body.sha256, limite=len(cuerpo))
    )
    meta = recepciones.conservar_bytes(area, recibo, ".recepcion.json")
    intento = {
        "schema_version": 1,
        "id": id,
        "url": url,
        "inicio_utc": inicio,
        "fin_utc": fin,
        "resultado": "respuesta",
        "http": status,
        "cuerpo_sha256": sha,
        "recibo_sha256": meta.sha256,
    }
    return AdquisicionHpLife(
        intento=recepciones.conservar_bytes(area, recepciones.json_bytes(intento), ".intento.json"),
        recepcion=RecepcionEnDisco(id=id, cuerpo=body, recibo=meta),
    )
