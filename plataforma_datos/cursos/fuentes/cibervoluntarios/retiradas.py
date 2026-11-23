"""Observación de retirada de un material de Cibervoluntarios: el censo completo y, si falta, el destino la afirman.

Solo se construye cuando `bajas` ha dado por completo el censo y, si el material falta, el destino responde que el
curso no existe. La observación es una lectura completa del censo con la presencia en falso; el evaluador la lee como
la retirada del proveedor (`retirada_proveedor`) salvo que una lectura posterior del material en un censo completo,
sin borrar, la contradiga.
"""

import hashlib
from http import HTTPStatus
from pathlib import Path

from plataforma_datos.cursos import operacion_fuente as fuente
from plataforma_datos.cursos import retirada_proveedor
from plataforma_datos.cursos.fuentes.cibervoluntarios import adquisicion, bajas, lector
from plataforma_datos.cursos.fuentes.hp_life.recepciones import fecha_utc
from plataforma_datos.cursos.tipos_json import ObjetoJson

METODO_DE_LA_OBSERVACION = "ciber-retirada-v1"


def _pagina(numero: int, meta: ObjetoJson) -> ObjetoJson:
    return {
        "alcance": "catalogo",
        "url": adquisicion.API,
        "capturado_utc": meta["fin_utc"],
        "sha256": meta["cuerpo_sha256"],
        "localizador": {"tipo": "pagina", "valor": f"page={numero}"},
    }


def observacion(
    original: Path,
    conjunto: ObjetoJson,
    programa: ObjetoJson,
    material: tuple[lector.MaterialCiber, ObjetoJson] | None,
) -> ObjetoJson | None:
    """Construye la observación de retirada de un programa, si la evidencia la afirma.

    Con `material`, el censo completo lo trae y declara que ya no lo ofrece (borrado o con un estado distinto de
    Disponible; el motivo y el valor literal quedan en la evidencia). Sin él, el censo completo no lo trae y su destino
    registrado responde que el curso no existe.

    Returns:
        La observación de catálogo con la presencia en falso, o None si no hay evidencia de baja.
    """
    id = programa["id"]
    if id == "fundae:1:3462" or not bajas.censo_apto(conjunto):
        return None
    destino = conjunto.get(bajas.FICHAS, {}).get(id)
    if material is None and (destino is None or bajas.veredicto(destino["lectura"]) != bajas.RETIRADO):
        return None
    baja = None if material is None else material[0].baja_declarada
    if material is not None and baja is None:
        return None
    paginas = [
        (f["lectura"]["pagina"], adquisicion.pagina(original, f)[1], f["recibo"]["sha256"])
        for f in conjunto["recepciones"]
    ]
    evidencias = [_pagina(n, meta) for n, meta, _recibo in paginas]
    lecturas = [meta for _n, meta, _recibo in paginas]
    huellas = [meta["cuerpo_sha256"] + recibo for _n, meta, recibo in paginas]
    if material is not None:
        meta = adquisicion.pagina(original, material[1])[1]
        motivo, literal, campo, objeto = baja
        raiz = material[0].localizador
        if objeto == "actividad":
            raiz = raiz.split("/activityCatalogMaterials/")[0]
        evidencias.extend(
            {
                "alcance": "catalogo",
                "url": adquisicion.API,
                "capturado_utc": meta["fin_utc"],
                "sha256": meta["cuerpo_sha256"],
                "localizador": localizador,
            }
            for localizador in (
                {"tipo": "campo", "valor": f"{raiz}/{campo}"},
                {"tipo": "seccion", "valor": f"baja:{motivo}:{literal}"},
            )
        )
    else:
        meta = fuente.leer_recibo(original, destino)
        evidencias.append(
            {
                "alcance": "diagnostico",
                "url": adquisicion.API,
                "capturado_utc": meta["fin_utc"],
                "sha256": meta["cuerpo_sha256"],
                "localizador": {"tipo": "seccion", "valor": f"destino:{meta['url']}:{meta['http']}"},
            }
        )
        lecturas.append(meta)
        huellas.append(meta["cuerpo_sha256"] + destino["recibo"]["sha256"])
    identidad = "\n".join((retirada_proveedor.METODO, id, *huellas))
    return {
        "id": METODO_DE_LA_OBSERVACION + ":" + hashlib.sha256(identidad.encode()).hexdigest(),
        "tipo": "catalogo",
        "intentado_el": min((m["inicio_utc"] for m in lecturas), key=fecha_utc),
        "terminado_el": max((m["fin_utc"] for m in lecturas), key=fecha_utc),
        "resultado": "correcta",
        "url_consultada": adquisicion.API,
        "detalle": {
            "url_final": adquisicion.API,
            "codigo_http": int(HTTPStatus.OK),
            "tipo_destino": "catalogo",
            "identidad_buscada": id,
            "lectura_completa": True,
            "presente": False,
        },
        "evidencias": evidencias,
    }
