"""Orientación editorial de dificultad de objetivos FUNDAE; no es nivel oficial.

Las reglas describen la complejidad del resultado anunciado, no las aptitudes
previas ni el nivel de digitalización asignado por la fuente. Una coincidencia
negada o señales de niveles opuestos dejan el resultado sin determinar.
"""

from __future__ import annotations

import re
import unicodedata

VERSION = "faro-objetivos-fundae-v1"


def _normalizar(texto: str) -> str:
    return " ".join(
        "".join(c for c in unicodedata.normalize("NFD", texto.lower()) if unicodedata.category(c) != "Mn").split()
    )


# Cada familia exige todos sus grupos. Un verbo o la tecnología por sí solos no
# se consideran evidencia suficiente. La lista se aplica al objetivo completo.
_REGLAS = (
    (
        "inicial",
        "fundamentos",
        (
            r"\b(?:conceptos?|conocimientos?|nociones?|competencias?|operaciones?|funciones?|componentes?|tecnicas?|terminologia)\s+(?:basic[oa]s?|fundamentales?)\b",
        ),
    ),
    ("inicial", "introduccion", (r"\bintroducir\b", r"\bconceptos?\s+basicos?\b")),
    (
        "avanzado",
        "arquitectura_a_escala",
        (
            r"\b(?:disen\w*|optimiz\w*)\b",
            r"\b(?:arquitecturas?|solucion\w* de almacenamiento)\b",
            r"\b(?:gran escala|petabyte|escalar)\b",
        ),
    ),
    (
        "avanzado",
        "procesamiento_gran_escala",
        (
            r"\b(?:procesamiento|procesar)\b",
            r"\bgrandes? volumenes?\b",
            r"\b(?:hadoop|spark)\b",
            r"\b(?:tiempo real|machine learning)\b",
        ),
    ),
    (
        "avanzado",
        "arquitectura_aplicacion",
        (
            r"\b(?:aplicacion\w*)\b",
            r"\bpatron mvc\b",
            r"\binyeccion de dependencias\b",
            r"\b(?:mantenible|testar)\w*\b",
        ),
    ),
    ("intermedio", "modelado_render", (r"\bmodelado\b", r"\btexturizado\b", r"\brender\b")),
    (
        "intermedio",
        "web_completa",
        (r"\b(?:disen\w*|crea\w*|desarroll\w*)\b", r"\b(?:pagina|sitio)\s+web\b", r"\b(?:public\w*|hojas de estilo)\b"),
    ),
    (
        "intermedio",
        "integracion_datos",
        (r"\bimport\w*\b", r"\b(?:datos|fuentes)\b", r"\b(?:visualiz\w*|tablas dinamicas)\b"),
    ),
    (
        "intermedio",
        "instalacion_configuracion",
        (r"\binstal\w*\b", r"\bconfigur\w*\b", r"\b(?:wordpress|moodle|prestashop)\b"),
    ),
    (
        "intermedio",
        "integracion_aplicaciones",
        (r"\bdesarroll\w*\b", r"\baplicacion\w*\b", r"\bintegr\w*\b", r"\b(?:web|cgi\w*)\b"),
    ),
    (
        "intermedio",
        "aplicacion_multiplataforma",
        (r"\bdesarroll\w*\b", r"\baplicacion\w*\b", r"\bmultiplataforma\b", r"\b(?:despliegue|rendimiento)\b"),
    ),
    (
        "intermedio",
        "diseno_gestion_web",
        (r"\bwordpress\b", r"\b(?:creacion|crear)\b", r"\b(?:optimizacion|monetizacion)\b"),
    ),
)


def orientar(objetivo: str) -> dict | None:
    """Devuelve nivel y regla cuando el objetivo admite una orientación justificable.

    El llamante debe validar identidad, fecha y huella de la captura, y respetar
    cualquier nivel declarado. Un resultado no acredita conocimientos de entrada.

    Returns:
        Orientación con su regla y versión, o None si no hay evidencia suficiente.
    """
    if not isinstance(objetivo, str) or not objetivo.strip():
        return None
    texto = _normalizar(objetivo)
    # No atribuir tareas expresamente negadas ni resolver contradicciones sin
    # estructura semántica que asocie las negaciones a cada proposición.
    if re.search(r"\b(?:no|nunca|sin|excepto)\b", texto):
        return None
    candidatas = [(nivel, regla) for nivel, regla, grupos in _REGLAS if all(re.search(g, texto) for g in grupos)]
    niveles = {nivel for nivel, _ in candidatas}
    if len(niveles) != 1:
        return None
    nivel, regla = candidatas[0]
    return {"valor": nivel, "regla": regla, "version": VERSION}
