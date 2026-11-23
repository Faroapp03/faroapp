"""Selección actual de pruebas por edición, con contextos compartidos no recursivos."""

import re
from pathlib import Path

from plataforma_datos.comun.huella_json import sha256_json
from plataforma_datos.cursos import admision_catalogo as admision
from plataforma_datos.cursos import almacen_catalogo as almacen
from plataforma_datos.cursos.contrato_entrega_catalogo import exigir
from plataforma_datos.cursos.fuentes.barcelonactiva import identidades_actuales
from plataforma_datos.cursos.recepciones_catalogo import json_bytes

MAX_EDICIONES = 20000
SHA = re.compile(r"[a-f0-9]{64}")


def referencia(captura: dict) -> dict:
    """Identifica los tres artefactos causales sin duplicarlos por edición.

    Returns:
        Huellas de cuerpo, recibo y metadatos del canal recibido.
    """
    return {
        k + "_sha256": captura[k]["sha256"] if captura.get(k) is not None else None
        for k in ("cuerpo", "recibo", "metadatos")
    }


def leer_anterior(destino: Path, control: dict, inventario: dict) -> dict:
    """Recupera y valida las últimas recepciones de las ediciones.

    Returns:
        Documento conservado o colecciones vacías en la primera aplicación.
    """
    if "control-cibernarium" not in control["procedencia"]:
        return {"recepciones": [], "contextos": {}}
    referencias = {
        sha: admision.ReferenciaArchivo(ruta=almacen.ruta_relativa(destino, nombre), sha256=sha)
        for nombre, sha in inventario.items()
    }
    ref = control["procedencia"]["control-cibernarium"]
    anterior = almacen.leer_documento_indexado(referencias[ref["sha256"]], referencias)
    validar(anterior)
    return anterior


def contexto(api: dict, normas: dict, anterior: dict | None) -> dict:
    """Selecciona las normas acreditadas para la recepción de una edición.

    Returns:
        Pruebas de la API, de las normas vigentes y de su último intento.
    """
    intento = referencia(normas)
    seleccionada = intento if normas["lectura"]["identificada"] else (anterior or {}).get("normas")
    return {"api": referencia(api), "normas": seleccionada, "normas_intento": intento}


def guardar_seleccion(destino: Path, control: dict, inventario: dict, nuevas: list[dict], contextos: dict) -> None:
    """Conserva la última recepción de cada edición y los contextos que se usan."""
    anterior = leer_anterior(destino, control, inventario)
    filas = {f["id"]: f for f in anterior["recepciones"]}
    contextos = {**anterior["contextos"], **contextos}
    filas.update({f["id"]: f for f in nuevas})
    if not filas:
        return
    usados = {f["contexto_sha256"] for f in filas.values()}
    documento = {
        "schema_version": 1,
        "fuente_id": "barcelonactiva",
        "canal": "cibernarium",
        "recepciones": [filas[k] for k in sorted(filas)],
        "contextos": {k: contextos[k] for k in sorted(usados)},
    }
    validar(documento)
    control["procedencia"]["control-cibernarium"] = almacen.archivar_documento(
        json_bytes(documento), destino, inventario, campos_evento=frozenset({"recepciones", "contextos"})
    )


def validar(dato: object) -> None:
    """Exige filas de edición y contextos planos cerrados, sin huérfanos."""
    exigir(
        isinstance(dato, dict) and set(dato) == {"schema_version", "fuente_id", "canal", "contextos", "recepciones"},
        "Campos de control Cibernàrium incompatibles",
    )
    exigir(
        type(dato["schema_version"]) is int
        and dato["schema_version"] == 1
        and dato["fuente_id"] == "barcelonactiva"
        and dato["canal"] == "cibernarium",
        "Versión/canal Cibernàrium incompatible",
    )
    filas, contextos = dato["recepciones"], dato["contextos"]
    exigir(isinstance(filas, list) and 0 < len(filas) <= MAX_EDICIONES, "Control Cibernàrium vacío o excesivo")
    exigir(isinstance(contextos, dict) and 0 < len(contextos) <= len(filas), "Contextos Cibernàrium vacíos o excesivos")
    for sha, ctx in contextos.items():
        exigir(
            isinstance(ctx, dict)
            and set(ctx)
            in (
                {"api", "normas", "normas_intento", "identidad"},
                {"api", "normas", "normas_intento", "identidad", "ficha"},
            )
            and sha == sha256_json(ctx),
            "Contexto Cibernàrium alterado",
        )
        identidades_actuales.validar(ctx["identidad"])
        for campo, captura in ctx.items():
            if campo == "identidad":
                continue
            if campo in ("normas", "ficha") and captura is None:
                continue
            exigir(
                isinstance(captura, dict) and set(captura) == {"cuerpo_sha256", "recibo_sha256", "metadatos_sha256"},
                "Captura Cibernàrium incompatible",
            )
            exigir(
                all(
                    isinstance(captura[k], str) and SHA.fullmatch(captura[k])
                    for k in ("recibo_sha256", "metadatos_sha256")
                )
                and (
                    captura["cuerpo_sha256"] is None
                    or isinstance(captura["cuerpo_sha256"], str)
                    and SHA.fullmatch(captura["cuerpo_sha256"])
                ),
                "SHA de contexto incompatible",
            )
    vistos, usados = set(), set()
    for fila in filas:
        exigir(
            isinstance(fila, dict)
            and set(fila) == {"id", "actividad_id", "edicion_id", "observacion_id", "contexto_sha256", "diagnostico"},
            "Campos de edición Cibernàrium incompatibles",
        )
        exigir(
            all(
                isinstance(fila[k], str) and re.fullmatch(r"[1-9][0-9]*", fila[k])
                for k in ("actividad_id", "edicion_id")
            ),
            "IDs nativos Cibernàrium inválidos",
        )
        exigir(
            fila["id"] == "cibernarium-edicion:" + fila["edicion_id"] and fila["id"] not in vistos,
            "Edición repetida o incompatible",
        )
        exigir(
            isinstance(fila["observacion_id"], str)
            and re.fullmatch(r"cibernarium-observacion-api-1:[a-f0-9]{64}", fila["observacion_id"]),
            "Observación Cibernàrium incompatible",
        )
        exigir(
            isinstance(fila["contexto_sha256"], str) and fila["contexto_sha256"] in contextos,
            "Edición sin contexto actual",
        )
        exigir(
            contextos[fila["contexto_sha256"]]["identidad"]["actividad_id"] == fila["actividad_id"],
            "Relación de otra cabecera de edición",
        )
        exigir(
            fila["diagnostico"] is None
            or isinstance(fila["diagnostico"], str)
            and re.fullmatch(r"[a-z_]{1,100}", fila["diagnostico"]),
            "Diagnóstico Cibernàrium incompatible",
        )
        vistos.add(fila["id"])
        usados.add(fila["contexto_sha256"])
    exigir(usados == set(contextos), "Contextos Cibernàrium sin consumidor")
