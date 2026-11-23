"""Destino registrado de los materiales conocidos que el censo completo no trae: se pide y se lee.

Es la segunda lectura que corrobora o contradice una ausencia (véase `bajas.py`). Una petición por material, sin seguir
redirecciones y con la pausa común por dominio; el cuerpo, el recibo y el intento quedan conservados como en cualquier
otra consulta.
"""

import hashlib
from collections.abc import Callable
from pathlib import Path

from plataforma_datos.comun.nucleo import FormatoInesperado
from plataforma_datos.cursos import almacen_catalogo, recepciones_catalogo, registro_vigencia
from plataforma_datos.cursos import operacion_fuente as comun
from plataforma_datos.cursos.fuentes.cibervoluntarios import bajas, direcciones, lector
from plataforma_datos.cursos.fuentes.hp_life.recepciones import fecha_utc
from plataforma_datos.cursos.tipos_json import ObjetoJson


def destino_registrado(programa: ObjetoJson) -> str | None:
    """Devuelve la dirección del curso que el material publicó al darse de alta.

    Returns:
        La dirección que se consulta, o None si el programa no conserva un destino válido.
    """
    publicado = programa.get("datos", {}).get("material_publicado")
    return direcciones.destino_del_material(publicado.get("moodleLink")) if isinstance(publicado, dict) else None


def esta_retirado(observaciones: list[ObjetoJson]) -> bool:
    """Indica si la última observación de retirada es más reciente que cualquier lectura que ofrece el material.

    Returns:
        True si hay una retirada y ninguna lectura correcta del material es igual de reciente o posterior.
    """
    retiradas = [
        o
        for o in observaciones
        if o["tipo"] == "catalogo" and o["detalle"].get("presente") is False and o["detalle"].get("lectura_completa")
    ]
    if not retiradas:
        return False
    desde = max(fecha_utc(o["terminado_el"]) for o in retiradas)
    return not any(
        o["tipo"] == "ficha" and o["resultado"] == "correcta" and fecha_utc(o["terminado_el"]) >= desde
        for o in observaciones
    )


def retirado_en_el_registro(raiz: Path) -> Callable[[str], bool]:
    """Prepara la consulta al registro de vigencia del catálogo instalado.

    Returns:
        Función que dice si el registro tiene ya como retirada una identidad.
    """
    ruta = almacen_catalogo.solicitud(raiz / almacen_catalogo.RUTA).snapshot.ruta
    corte = recepciones_catalogo.ahora_utc()

    def retirado(id: str) -> bool:
        return esta_retirado(registro_vigencia.observaciones_hasta(ruta, tipo="recurso", id=id, corte=corte))

    return retirado


def descargar(original: Path, ausentes: list[ObjetoJson]) -> dict[str, ObjetoJson]:
    """Pide el destino registrado de cada material ausente, en serie y sin seguir redirecciones.

    Returns:
        La recepción conservada de cada destino, por identidad de programa.
    """
    fichas = {}
    for programa in ausentes:
        url = destino_registrado(programa)
        if url is not None:
            fichas[programa["id"]] = comun.recibir_url(
                url,
                original,
                programa["id"],
                perfil="pagina",
                maximo_bytes=direcciones.LIMITE_BYTES_DESTINO,
                seguir_redirecciones=False,
            )
    return fichas


def _lectura(original: Path, cap: ObjetoJson, url: str) -> ObjetoJson:
    meta = comun.leer_recibo(original, cap)
    comun.exigir(meta["url"] == url, "Destino Ciber ajeno al registrado", FormatoInesperado)
    comun.exigir(lector._fecha(meta["fin_utc"]) >= lector._fecha(meta["inicio_utc"]), "Destino Ciber no causal")
    lectura = {
        "tipo": "destino",
        "url": url,
        "http": meta.get("http"),
        "completo": meta.get("completo") is True,
        "inicio_utc": meta["inicio_utc"],
        "fin_utc": meta["fin_utc"],
        "redireccion": meta.get("redireccion"),
        "pagina_de_error": False,
    }
    if cap["cuerpo"] is None:
        return {**lectura, "completo": False, "fallo": meta.get("error") or "http_" + str(meta.get("http"))}
    cuerpo = comun.leer_conservado(original, cap["cuerpo"], maximo_bytes=direcciones.LIMITE_BYTES_DESTINO)
    comun.exigir(
        meta["cuerpo_sha256"] == hashlib.sha256(cuerpo).hexdigest() and meta["bytes"] == len(cuerpo),
        "Recibo y cuerpo de destino Ciber distintos",
        FormatoInesperado,
    )
    return {**lectura, "pagina_de_error": bajas.pagina_de_error(cuerpo)}


def leer(original: Path, fichas: ObjetoJson, ausentes: list[ObjetoJson]) -> ObjetoJson:
    """Reproduce desde sus recibos la lectura de cada destino pedido.

    Returns:
        Cada captura con su lectura, por identidad de programa.

    Raises:
        FormatoInesperado: Si un destino no corresponde a un material ausente o no es el registrado.
    """
    esperados = {p["id"]: destino_registrado(p) for p in ausentes}
    comun.exigir(set(fichas) <= set(esperados), "Destino Ciber de un material que no falta", FormatoInesperado)
    return {id: {**cap, "lectura": _lectura(original, cap, esperados[id])} for id, cap in sorted(fichas.items())}
