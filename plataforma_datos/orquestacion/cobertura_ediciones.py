"""Consulta de una edición admitida: catálogo vigente y todos sus originales vinculados al mismo intento."""

import json
import stat
from pathlib import Path

import plataforma_datos.comun.fuentes.nombres.lector as nombres
import plataforma_datos.ia_y_trabajo.fuentes.ia_nacional_bra.lector as ia_nacional_bra
import plataforma_datos.ia_y_trabajo.fuentes.ia_nacional_gbr.lector as ia_nacional_gbr
import plataforma_datos.ia_y_trabajo.fuentes.tic_llars.lector as tic_llars
import plataforma_datos.ia_y_trabajo.fuentes.tich.lector as tich
import plataforma_datos.mercado.fuentes.salarios.lector as salarios
from plataforma_datos.comun.estadisticas import API_TEMPUS
from plataforma_datos.comun.nucleo import DATOS_RELATIVOS, FormatoInesperado
from plataforma_datos.comun.observacion_remota import VERSION_VINCULADA, identidad_recurso
from plataforma_datos.ia_y_trabajo.fuentes.tich import edicion as edicion_tich
from plataforma_datos.orquestacion.cobertura_originales import (
    carpeta_originales,
    leer_archivo,
    leer_procedencia,
    original_vinculado,
    por_nombre,
)

MAX_PROCEDENCIA_BYTES = 256 * 1024
CONTRATOS = {
    # En la TIC-H, los originales son los de la edición admitida (_contrato); aquí, los de la primera.
    "tich": (
        tich.FUENTE,
        {"archivo": tich.CATALOGO, "url": tich.RESULTADOS},
        edicion_tich.archivos(edicion_tich.primera()),
    ),
    "tic_llars": (tic_llars.FUENTE, tic_llars.CATALOGO, tic_llars.ARCHIVOS),
    "salarios": (salarios.FUENTE, salarios.CATALOGO, salarios.ARCHIVOS),
    "nombres": (nombres.FUENTE, nombres.CATALOGO, nombres.ARCHIVOS),
    "ia_nacional_gbr": (ia_nacional_gbr.FUENTE, ia_nacional_gbr.CATALOGO, ia_nacional_gbr.ARCHIVOS),
    "ia_nacional_bra": (ia_nacional_bra.FUENTE, ia_nacional_bra.CATALOGO, ia_nacional_bra.ARCHIVOS),
}


def _exigir(condicion: bool) -> None:
    if not condicion:
        raise ValueError("Consulta de edición no verificable.")


def _tich_admitida(raiz: Path) -> edicion_tich.Edicion:
    """La edición de la TIC-H que publica la instalación, de su estado (validados/tich/edicion.json), leído acotado.

    Returns:
        La edición; sin estado, la primera.
    """
    carpeta = raiz / DATOS_RELATIVOS / "validados" / tich.FUENTE
    nombre = edicion_tich.ESTADO.name
    if not (carpeta / nombre).exists():
        return edicion_tich.primera()
    return edicion_tich.valida(json.loads(leer_archivo(carpeta, nombre, MAX_PROCEDENCIA_BYTES)))


def _contrato(raiz: Path, fuente: str) -> tuple[str, dict, list, str, list[dict]]:
    """El contrato de una fuente: su carpeta, su catálogo y sus originales; en la TIC-H, los de la edición admitida.

    En la TIC-H, la EPA es la del año que registró la descarga en la procedencia del año, y el sondeo de la EPA del año
    de la edición, si tuvo respuesta, es una petición más de la consulta.

    Returns:
        (nombre de la fuente, catálogo, originales, subcarpeta de los originales: el año en la TIC-H, si no vacía,
        y otros recursos consultados).
    """
    nombre, catalogo, archivos = CONTRATOS[fuente]
    if fuente != "tich":
        return nombre, catalogo, archivos, "", []
    admitida = _tich_admitida(raiz)
    del_anio = leer_procedencia(carpeta_originales(raiz, nombre) / admitida["anio"], MAX_PROCEDENCIA_BYTES)
    epa_anio = del_anio.get("epa_anio", admitida["epa_anio"])
    sondeo = del_anio.get("epa_sondeo")
    _exigir(type(epa_anio) is str and (sondeo is None or type(sondeo) is dict))
    # Un sondeo fallido no llegó a tener respuesta: no es una petición de la consulta.
    sondeos = [{"url": sondeo["url"]}] if sondeo and sondeo.get("resultado") != "fallido" else []
    return nombre, catalogo, edicion_tich.archivos({**admitida, "epa_anio": epa_anio}), admitida["anio"], sondeos


def _paginas_navegadas(fuente: str, procedencia: dict) -> list[dict]:
    """Los índices del INE que la TIC-H consultó al localizar las tablas de la edición nueva, si los hubo.

    Returns:
        Un recurso (`url`) por índice consultado, sin el catálogo.
    """
    tablas = procedencia.get("tablas_edicion_nueva") if fuente == "tich" else None
    if tablas is None:
        return []
    _exigir(type(tablas) is dict and type(tablas.get("paginas")) is list)
    return [{"url": pagina["url"]} for pagina in tablas["paginas"][1:]]


def _de_la_candidata(fuente: str, carpeta: Path, procedencia: dict) -> tuple[str, list[dict], list[dict]]:
    """Lo que la TIC-H pidió de su edición candidata en la consulta, si la registró.

    Son sus originales y sus dos documentos, en la carpeta de su año, y el sondeo de la EPA de su año si tuvo
    respuesta. Si la descarga se detuvo, son los que registró hasta el fallo (`candidata_detenida`). Su EPA del año
    declarado, copiada de la admitida (`copia_de`), no es una petición más.

    Returns:
        (año, registros pedidos, sondeos); vacíos sin candidata.
    """
    candidata = procedencia.get("candidata") if fuente == "tich" else None
    detenida = procedencia.get("candidata_detenida") if fuente == "tich" and candidata is None else None
    if candidata is None and detenida is None:
        return "", [], []
    if candidata is not None:
        _exigir(type(candidata) is dict and type(candidata.get("edicion")) is dict)
        anio = candidata["edicion"].get("anio")
        _exigir(type(anio) is str and anio.isdigit() and len(anio) == len("2026"))
        del_anio = leer_procedencia(carpeta / anio, MAX_PROCEDENCIA_BYTES)
        _exigir(
            sorted(f"{anio}/{registro['archivo']}" for registro in del_anio.get("archivos", []))
            == sorted(entrada["archivo"] for entrada in candidata.get("archivos", []))
        )
    else:
        _exigir(type(detenida) is dict)
        anio = detenida.get("anio")
        _exigir(type(anio) is str and anio.isdigit() and len(anio) == len("2026"))
        del_anio = detenida
    registros = del_anio.get("archivos", [])
    sondeo = del_anio.get("epa_sondeo")
    _exigir(type(registros) is list and all(type(registro) is dict for registro in registros))
    _exigir(sondeo is None or type(sondeo) is dict)
    for registro in registros:
        _exigir(type(registro.get("archivo")) is str and type(registro.get("url")) is str)
    pedidos = [registro for registro in registros if "copia_de" not in registro]
    sondeos = [{"url": sondeo["url"]}] if sondeo and sondeo.get("resultado") != "fallido" else []
    return anio, pedidos, sondeos


def _sin_ruta(registro: object, anio: str) -> dict:
    """El registro de la operación, con su ruta de año, como lo registra la procedencia de ese año (sin la ruta).

    Returns:
        El registro con `archivo` sin el año.
    """
    _exigir(type(registro) is dict and type(registro.get("archivo")) is str and type(registro.get("url")) is str)
    _exigir(registro["archivo"].startswith(f"{anio}/") and "/" not in registro["archivo"][len(anio) + 1 :])
    return {**registro, "archivo": registro["archivo"][len(anio) + 1 :]}


def _de_la_incorporacion(fuente: str, carpeta: Path, procedencia: dict, anio: str) -> dict:
    """Lo que pidió la consulta del día en que la candidata pasó a ser la admitida, si la procedencia lo conserva.

    Son los originales de la edición anterior, los índices navegados y los PDF de la candidata, tal como estaban
    registrados (`consulta_de_la_incorporacion`), más el sondeo de la EPA de la edición anterior. De cada archivo
    pedido se vincula su cuerpo. Sin el bloque, la consulta es la de siempre.

    Returns:
        `pedidos` (carpeta y registro de lo pedido con cuerpo), `indices` y `sondeos` (solo direcciones).
    """
    vacio: dict = {"pedidos": [], "indices": [], "sondeos": []}
    bloque = procedencia.get("consulta_de_la_incorporacion") if fuente == "tich" else None
    if bloque is None:
        return vacio
    _exigir(type(bloque) is dict and set(bloque) == {"anterior", "indices", "documentos"})
    anterior, indices, documentos = bloque["anterior"], bloque["indices"], bloque["documentos"]
    _exigir(type(anterior) is dict and set(anterior) == {"anio", "archivos"} and type(anterior["archivos"]) is list)
    _exigir(type(anterior["anio"]) is str and anterior["anio"].isdigit() and anterior["anio"] != anio)
    _exigir(
        type(indices) is list and all(type(pagina) is dict and type(pagina.get("url")) is str for pagina in indices)
    )
    _exigir(type(documentos) is list)
    de_antes = [_sin_ruta(registro, anterior["anio"]) for registro in anterior["archivos"]]
    de_ahora = [_sin_ruta(registro, anio) for registro in documentos]
    sondeo = leer_procedencia(carpeta / anterior["anio"], MAX_PROCEDENCIA_BYTES).get("epa_sondeo")
    _exigir(sondeo is None or type(sondeo) is dict)
    return {
        "pedidos": [(carpeta / anterior["anio"], registro) for registro in de_antes]
        + [(carpeta / anio, registro) for registro in de_ahora],
        "indices": [{"url": pagina["url"]} for pagina in indices[1:]],
        "sondeos": [{"url": sondeo["url"]}] if sondeo and sondeo.get("resultado") != "fallido" else [],
    }


def _edicion(fuente: str, contenido: bytes, procedencia: dict, raiz: Path) -> None:
    """Repite la decisión del productor sobre el catálogo observado, sin confiar en un año declarado."""
    if fuente == "tich":
        edicion = tich.edicion_del_catalogo(contenido.decode("utf-8", "strict"))
        tich.ediciones.comprobar_edicion(edicion, _tich_admitida(raiz)["anio"])
    elif fuente == "salarios":
        edicion = salarios.edicion_del_catalogo(contenido)
        salarios.comprobar_edicion(edicion)
    elif fuente == "nombres":
        edicion = nombres.edicion_del_catalogo(contenido)
        nombres.comprobar_edicion(edicion)
    elif fuente == "ia_nacional_gbr":
        edicion = ia_nacional_gbr.edicion_del_catalogo(contenido)
        ia_nacional_gbr.comprobar_edicion(edicion)
    elif fuente == "ia_nacional_bra":
        edicion = ia_nacional_bra.edicion_del_catalogo(contenido)
        ia_nacional_bra.comprobar_edicion(edicion)
    else:
        tic_llars.comprobar_edicion(tic_llars.edicion_del_catalogo(contenido))
        return
    registrada = procedencia.get("edicion")
    _exigir(
        type(registrada) is dict
        and registrada == edicion
        and all(type(registrada[clave]) is type(valor) for clave, valor in edicion.items())
    )


def _extras_de_la_incorporacion(incorporacion: dict, propios: tuple) -> tuple[list[dict], set[str]]:
    """Lo que la edición anterior y la candidata pidieron el día de la incorporación, salvo lo ya contado.

    La EPA de la edición anterior puede ser la misma dirección que la de la admitida: se cuenta una sola vez.

    Returns:
        Los recursos de más y las identidades de los propios.
    """
    ya_contados = {identidad_recurso(archivo["url"]) for archivo in propios}
    extras = [
        archivo
        for archivo in (
            *(registro for _, registro in incorporacion["pedidos"]),
            *incorporacion["indices"],
            *incorporacion["sondeos"],
        )
        if identidad_recurso(archivo["url"]) not in ya_contados
    ]
    _exigir(len({identidad_recurso(archivo["url"]) for archivo in extras}) == len(extras))
    return extras, ya_contados


def _vincular_la_incorporacion(incorporacion: dict, ya_contados: set[str], por_recurso: dict) -> None:
    """Vincula el cuerpo de cada original pedido ese día."""
    for donde, registro in incorporacion["pedidos"]:
        if identidad_recurso(registro["url"]) not in ya_contados:
            pedido = {"archivo": registro["archivo"], "url": registro["url"]}
            original_vinculado(donde, pedido, registro, por_recurso[identidad_recurso(registro["url"])])


def _comprobar(raiz: Path, evidencia: dict) -> None:
    _exigir(type(evidencia) is dict and type(evidencia.get("version")) is int)
    _exigir(evidencia["version"] == VERSION_VINCULADA)
    fuente = evidencia["fuente"]
    nombre, catalogo, archivos, subcarpeta, sondeos = _contrato(raiz, fuente)
    carpeta = carpeta_originales(raiz, nombre)
    del_anio = carpeta / subcarpeta if subcarpeta else carpeta
    _exigir(stat.S_ISDIR(del_anio.lstat().st_mode))
    clave = (lambda archivo: f"{subcarpeta}/{archivo}") if subcarpeta else (lambda archivo: archivo)
    procedencia = leer_procedencia(carpeta, MAX_PROCEDENCIA_BYTES)
    descubrimiento = por_nombre(procedencia["descubrimiento"])
    registros = por_nombre(procedencia["archivos"])
    _exigir(set(descubrimiento) == {catalogo["archivo"]})
    _exigir(set(registros) == {clave(archivo["archivo"]) for archivo in archivos})
    peticiones = evidencia["peticiones"]
    _exigir(type(peticiones) is list and all(type(peticion) is dict for peticion in peticiones))
    por_recurso = {peticion["recurso_sha256"]: peticion for peticion in peticiones}
    anio_candidata, de_la_candidata, sondeos_candidata = _de_la_candidata(fuente, carpeta, procedencia)
    pedidos_candidata = [{"archivo": registro["archivo"], "url": registro["url"]} for registro in de_la_candidata]
    incorporacion = _de_la_incorporacion(fuente, carpeta, procedencia, subcarpeta)
    propios = (
        catalogo,
        *archivos,
        *_paginas_navegadas(fuente, procedencia),
        *sondeos,
        *pedidos_candidata,
        *sondeos_candidata,
    )
    extras, ya_contados = _extras_de_la_incorporacion(incorporacion, propios)
    esperados = (*propios, *extras)
    _exigir(len(por_recurso) == len(peticiones) == len(esperados))
    _exigir(set(por_recurso) == {identidad_recurso(archivo["url"]) for archivo in esperados})
    contenido = original_vinculado(
        carpeta, catalogo, descubrimiento[catalogo["archivo"]], por_recurso[identidad_recurso(catalogo["url"])]
    )
    _edicion(fuente, contenido, procedencia, raiz)
    for archivo in archivos:
        url = archivo["url"]
        finales = {url}
        if url.startswith(API_TEMPUS + "/"):
            # Tempus puede servir el mismo recurso desde su caché, conservando host, tabla y filtros.
            finales.add(url.replace("/js/", "/jsCache/", 1))
        original_vinculado(
            del_anio,
            archivo,
            # El registro de la operación lleva la ruta con el año; dentro de su carpeta, el archivo es el del contrato.
            {**registros[clave(archivo["archivo"])], "archivo": archivo["archivo"]},
            por_recurso[identidad_recurso(url)],
            urls_finales=finales,
        )
    for pedido, registro in zip(pedidos_candidata, de_la_candidata, strict=True):
        original_vinculado(carpeta / anio_candidata, pedido, registro, por_recurso[identidad_recurso(pedido["url"])])
    _vincular_la_incorporacion(incorporacion, ya_contados, por_recurso)


def comprobada(raiz: Path, evidencia: dict) -> bool:
    """Acredita consulta completa de la edición conocida solo si sigue siendo la anunciada.

    El llamador valida el recibo v2 del intento y exige preparación, validación y admisión del módulo.
    Una sucesora requiere revisar el contrato estadístico; aceptar bytes no autoriza otro método.
    Ni un catálogo aislado ni la reconstrucción local renuevan la fecha de comprobación remota.

    Returns:
        True con catálogo vigente y todos los cuerpos íntegros, sin alterar originales ni fechas.
    """
    try:
        _comprobar(raiz, evidencia)
    except (OSError, ValueError, TypeError, KeyError, RecursionError, FormatoInesperado):
        return False
    return True
