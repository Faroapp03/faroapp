"""Programas Cibervoluntarios cuyo material no se selecciona en la consulta: alias, páginas caídas y bajas.

Un material que el censo no trae o no ofrece no se renueva. Si el proveedor lo ha retirado, con la evidencia que pide
`bajas`, queda observado como retirado; si una página caída pudo contenerlo, queda con el fallo de esa consulta; en otro
caso queda sin cambio.
"""

from dataclasses import dataclass
from pathlib import Path
from urllib.parse import quote

from plataforma_datos.cursos import operacion_fuente as fuente
from plataforma_datos.cursos.contrato_entrega_catalogo import exigir
from plataforma_datos.cursos.fuentes.cibervoluntarios import (
    adquisicion,
    bajas,
    control_actual,
    evaluacion,
    lector,
    retiradas,
)
from plataforma_datos.cursos.fuentes.cibervoluntarios import observaciones_vigencia as puente
from plataforma_datos.cursos.tipos_json import ObjetoJson

ALIAS = "fundae:1:3462"
MOTIVO_RETIRADO = "retirado_por_el_proveedor"


@dataclass(frozen=True)
class Consulta:
    """Lo que la aplicación de una consulta sabe de sus materiales, para resolver los programas sin selección."""

    original: Path
    base: Path
    corte: str
    conjunto: ObjetoJson
    materiales: dict[int, tuple]


def seleccionar_alias(programa: dict, materiales: dict[int, tuple], seleccionados: set[int], ctx: dict) -> tuple | str:
    """Elige el material del alias de FUNDAE o devuelve por qué no hay vínculo actual acreditado.

    Returns:
        El material y su recepción, o el motivo por el que no se elige.
    """
    if control_actual.MATERIAL_ALIAS_FUNDAE not in materiales:
        return "alias_sin_vinculo_actual_acreditado_a_url_corta"
    material, fila = materiales[control_actual.MATERIAL_ALIAS_FUNDAE]
    if not ctx.get("alias") or ctx["alias"]["vinculado"] is not True:
        return "alias_sin_vinculo_actual_acreditado_a_url_corta"
    final = ctx["alias"]["captura"]["url_final"]
    ruta = "https://www.cibervoluntarios.org/es/formacion-gratuita/aprende-a-tu-ritmo/cursos/" + quote(
        str(material.slug), safe=""
    )
    exigir(
        programa["proveedor_id"] == "fundae:publicador:catalogo:1" and programa["url"] == adquisicion.ALIAS_FUNDAE,
        "Identidad del alias Fundae incompatible",
    )
    if final not in (ruta, ruta + "?origin=fundae") or material.id not in seleccionados:
        return "alias_sin_vinculo_actual_acreditado_a_url_corta"
    return material, fila


def _material_de(programa: dict) -> int | None:
    if programa["id"] == ALIAS:
        return control_actual.MATERIAL_ALIAS_FUNDAE
    return programa["datos"].get("identidad_fuente", {}).get("material_id")


def _registrar_fallos(consulta: Consulta, programa: dict) -> dict:
    """Registra el intento de cada página caída como fallo de consulta de la unidad sin noticia.

    La unidad conserva su última comprobación y su recepción seleccionada anterior;
    el fallo solo avisa del intento, nunca la retira ni la renueva.

    Returns:
        Resultado de la unidad con su evaluación.
    """
    oferta = {"id": programa["id"], "fuente_id": lector.FUENTE, "url": programa["url"]}
    observaciones = [
        puente.construir_observacion_fallo(
            fuente.leer_recibo(consulta.original, f), f["intento"]["sha256"], oferta=oferta
        )
        for f in consulta.conjunto["paginas_fallidas"]
    ]
    evaluada = evaluacion.evaluar(consulta.base, programa, observaciones, consulta.corte)
    return {"id": programa["id"], "pendiente": "material_sin_noticia_por_pagina_fallida", "evaluacion": evaluada}


def resolver(consulta: Consulta, programa: dict, motivo: str) -> dict:
    """Resuelve un programa sin material seleccionado: fallo de consulta, retirada o sin cambio.

    Returns:
        Resultado de la unidad, con su evaluación si hay observación nueva.
    """
    material = consulta.materiales.get(_material_de(programa))
    if consulta.conjunto.get("paginas_fallidas") and material is None:
        return _registrar_fallos(consulta, programa)
    baja = retiradas.observacion(consulta.original, consulta.conjunto, programa, material)
    if baja is None and programa["id"] in consulta.conjunto.get(bajas.YA_RETIRADOS, []):
        # Ya retirado por evidencia y todavía ausente: su retirada sigue en el registro y no queda nada por aplicar.
        return {"id": programa["id"], "pendiente": MOTIVO_RETIRADO, "evaluacion": None}
    if baja is None:
        return {"id": programa["id"], "pendiente": motivo, "evaluacion": None}
    evaluada = evaluacion.evaluar(consulta.base, programa, [baja], consulta.corte)
    return {"id": programa["id"], "pendiente": MOTIVO_RETIRADO, "evaluacion": evaluada}
