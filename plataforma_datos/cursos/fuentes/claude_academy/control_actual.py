"""Contrato cerrado del selector de capturas Academy actuales; no evalúa disponibilidad."""

import re

from plataforma_datos.cursos.contrato_entrega_catalogo import exigir
from plataforma_datos.cursos.fuentes.claude_academy.acceso_publico import MAX_CURSOS

VERSION_CON_FAQ = 2


def validar(dato: object) -> None:
    """Rechaza formas ambiguas antes de resolver referencias o abrir la instantánea."""
    exigir(
        isinstance(dato, dict)
        and set(dato)
        in ({"schema_version", "fuente_id", "recepciones"}, {"schema_version", "fuente_id", "recepciones", "faq"}),
        "Campos de control Academy incompatibles",
    )
    exigir(
        type(dato["schema_version"]) is int
        and dato["schema_version"] in (1, VERSION_CON_FAQ)
        and dato["fuente_id"] == "claude_academy",
        "Versión/fuente de control Academy incompatible",
    )
    exigir((dato["schema_version"] == VERSION_CON_FAQ) == ("faq" in dato), "Campos de versión Academy incompatibles")
    if dato["schema_version"] == VERSION_CON_FAQ and dato["faq"] is not None:
        faq = dato["faq"]
        exigir(
            isinstance(faq, dict)
            and set(faq)
            in ({"cuerpo_sha256", "recibo_sha256"}, {"cuerpo_sha256", "recibo_sha256", "metadatos_sha256"}),
            "Referencia FAQ incompatible",
        )
        exigir(
            all(isinstance(v, str) and re.fullmatch(r"[a-f0-9]{64}", v) for v in faq.values()), "SHA FAQ incompatible"
        )
    filas = dato["recepciones"]
    exigir(isinstance(filas, list) and 0 < len(filas) <= MAX_CURSOS, "Recepciones actuales Academy vacías o excesivas")
    vistas = set()
    requeridos = {"id", "observacion_id", "cuerpo_sha256", "recibo_sha256"}
    for fila in filas:
        exigir(
            isinstance(fila, dict) and set(fila) in (requeridos, requeridos | {"metadatos_sha256"}),
            "Campos de recepción actual Academy incompatibles",
        )
        identidad = fila["id"]
        exigir(
            isinstance(identidad, str)
            and re.fullmatch(r"claude-academy:[a-z0-9]+(?:-[a-z0-9]+)*", identidad)
            and identidad not in vistas,
            "Identidad actual Academy inválida o repetida",
        )
        vistas.add(identidad)
        exigir(
            isinstance(fila["observacion_id"], str)
            and re.fullmatch(r"[a-z0-9][a-z0-9:_-]{0,299}", fila["observacion_id"]),
            "Observación actual Academy inválida",
        )
        for campo in set(fila) - {"id", "observacion_id"}:
            exigir(
                isinstance(fila[campo], str) and re.fullmatch(r"[a-f0-9]{64}", fila[campo]),
                "SHA actual Academy incompatible",
            )
