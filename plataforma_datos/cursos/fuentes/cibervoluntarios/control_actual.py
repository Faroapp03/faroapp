"""Selección acotada de pruebas actuales Ciber, con contextos no recursivos."""

import re

from plataforma_datos.comun.huella_json import sha256_json
from plataforma_datos.cursos.contrato_entrega_catalogo import exigir

MAX_RECEPCIONES = 2000
MATERIAL_ALIAS_FUNDAE = 10059786850
SHA = re.compile(r"[a-f0-9]{64}")
AUXILIARES = {"portada", "declaraciones", "componente", "idioma"}


def _captura(dato: object) -> None:
    exigir(
        isinstance(dato, dict) and set(dato) == {"cuerpo_sha256", "recibo_sha256", "metadatos_sha256"},
        "Campos de captura Ciber incompatibles",
    )
    exigir(all(isinstance(v, str) and SHA.fullmatch(v) for v in dato.values()), "SHA de captura Ciber incompatible")


def validar(dato: object) -> None:
    """Exige filas y contextos cerrados, sin duplicados, huérfanos o referencias recursivas."""
    exigir(
        isinstance(dato, dict) and set(dato) == {"schema_version", "fuente_id", "contextos", "recepciones"},
        "Campos de control Ciber incompatibles",
    )
    exigir(
        type(dato["schema_version"]) is int and dato["schema_version"] == 1 and dato["fuente_id"] == "cibervoluntarios",
        "Versión/fuente de control Ciber incompatible",
    )
    filas, contextos = dato["recepciones"], dato["contextos"]
    exigir(isinstance(filas, list) and 0 < len(filas) <= MAX_RECEPCIONES, "Recepciones Ciber vacías o excesivas")
    exigir(isinstance(contextos, dict) and 0 < len(contextos) <= len(filas), "Contextos Ciber vacíos o excesivos")
    for sha, contexto in contextos.items():
        exigir(
            isinstance(contexto, dict)
            and set(contexto) == {"cuerpo_sha256", "recibo_sha256", "metadatos_sha256", "auxiliares"}
            and sha == sha256_json(contexto),
            "Contexto Ciber alterado o incompatible",
        )
        _captura({k: v for k, v in contexto.items() if k != "auxiliares"})
        auxiliares = contexto["auxiliares"]
        exigir(
            isinstance(auxiliares, dict)
            and set(auxiliares) >= AUXILIARES
            and len(set(auxiliares) - AUXILIARES) <= 1
            and all(k == "alias" or re.fullmatch(r"ruta:[1-9][0-9]*", k) for k in set(auxiliares) - AUXILIARES),
            "Apoyos Ciber incompletos",
        )
        for captura in auxiliares.values():
            _captura(captura)
    vistas, usados, materiales = set(), set(), set()
    for fila in filas:
        exigir(
            isinstance(fila, dict) and set(fila) == {"id", "material_id", "observacion_id", "contexto_sha256"},
            "Campos de recepción Ciber incompatibles",
        )
        id, material = fila["id"], fila["material_id"]
        exigir(
            isinstance(id, str)
            and (id == "fundae:1:3462" or re.fullmatch(r"cibervoluntarios:material:[1-9][0-9]*", id))
            and id not in vistas,
            "Identidad Ciber inválida o repetida",
        )
        exigir(
            type(material) is int
            and material > 0
            and material not in materiales
            and (id != "fundae:1:3462" or material == MATERIAL_ALIAS_FUNDAE)
            and (id == "fundae:1:3462" or id == "cibervoluntarios:material:" + str(material)),
            "Material Ciber incompatible o duplicado",
        )
        exigir(
            isinstance(fila["observacion_id"], str)
            and re.fullmatch(r"ciber-oferta-autoformacion-publicada:[12]:[a-f0-9]{64}", fila["observacion_id"]),
            "Observación Ciber incompatible",
        )
        exigir(
            isinstance(fila["contexto_sha256"], str) and fila["contexto_sha256"] in contextos,
            "Recepción Ciber sin contexto",
        )
        exigir(
            ("alias" in contextos[fila["contexto_sha256"]]["auxiliares"]) == (id == "fundae:1:3462"),
            "Apoyo de alias incompatible con su consumidor",
        )
        rutas = set(contextos[fila["contexto_sha256"]]["auxiliares"]) - AUXILIARES - {"alias"}
        exigir(not rutas or rutas == {"ruta:" + str(material)}, "Prueba de ruta asignada a otro material Ciber")
        vistas.add(id)
        materiales.add(material)
        usados.add(fila["contexto_sha256"])
    exigir(usados == set(contextos), "Contextos Ciber sin consumidor")
