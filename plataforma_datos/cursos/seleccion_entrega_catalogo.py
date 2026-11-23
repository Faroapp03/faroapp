"""Proyección de decisiones admitidas: no evalúa ni cambia hechos de una fuente."""

from plataforma_datos.comun.huella_json import sha256_json
from plataforma_datos.cursos import catalogo, oferta_continua, politicas_vigencia, vigencia
from plataforma_datos.cursos import contrato_entrega_catalogo as contrato
from plataforma_datos.cursos.contrato_entrega_catalogo import exigir
from plataforma_datos.cursos.fuentes.barcelonactiva import matricula_actual
from plataforma_datos.cursos.tipos_json import ObjetoJson

VERSION_RESULTADO = 2
# El motivo con que se retiene lo que retira la regla de retirada activa de su fuente (`retirada_en_el_catalogo`).
RETIRADA_POR_EVIDENCIA = "retirada_por_evidencia"


def comprobar_soporte(evaluacion: ObjetoJson) -> str | None:
    """Exige el contrato y apoyos indispensables de una confirmación ya registrada.

    No calcula disponibilidad, calendario ni revisión interna. Reutiliza los validadores y
    vínculos del evaluador; no convierte un acceso o fecha desconocidos en apertura.

    Returns:
        Motivo privado de insuficiencia, o None si el soporte está acreditado.
    """
    incompatible = _contrato_incompatible(evaluacion)
    if incompatible is not None:
        return incompatible
    entradas = evaluacion["entradas"]
    resultado = evaluacion["resultado"]
    politica = entradas["politica"]
    if politica["requiere_catalogo"] and not resultado.get("trazabilidad", {}).get("catalogo", {}).get(
        "ultima_positiva_el"
    ):
        return "catalogo_obligatorio_sin_comprobacion_acreditada"
    continua = politica.get("regla_disponibilidad") == oferta_continua.METODO
    matricula = politica.get("regla_disponibilidad") == matricula_actual.METODO
    if (continua or matricula) and not _politica_registrada(politica):
        return "politica_continua_no_registrada" if continua else "politica_matricula_no_registrada"
    comprobado = resultado.get("comprobado_el")
    if comprobado is None:
        return "confirmacion_sin_fecha_acreditada"
    for observacion in entradas["observaciones"]:
        if not vigencia.ficha_identificada_de_oferta(observacion, entradas["oferta"]):
            continue
        if vigencia.fecha_de_comprobacion(observacion) != vigencia.instante_utc(comprobado, "confirmación registrada"):
            continue
        if _condiciones_indispensables(observacion, entradas["oferta"], continua, matricula):
            return None
    return "acceso_o_calendario_indispensable_sin_soporte"


def _contrato_incompatible(evaluacion: ObjetoJson) -> str | None:
    # Un resultado sin `cierra_el` se calculó con la regla anterior; no se publica hasta reevaluarlo.
    if evaluacion["resultado"].get("schema_version") != VERSION_RESULTADO:
        return "resultado_de_evaluacion_anterior"
    try:
        vigencia.validar_entrada(**evaluacion["entradas"], ahora=evaluacion["corte_utc"])
    except vigencia.ErrorVigencia:
        return "entradas_evaluadas_incompatibles_con_contrato"
    return None


def _politica_registrada(politica: ObjetoJson) -> bool:
    try:
        return politica == politicas_vigencia.leer_politica(politica["fuente_id"], politica["version"])
    except vigencia.ErrorVigencia:
        return False


def _condiciones_indispensables(
    observacion: ObjetoJson, oferta: ObjetoJson, continua: bool = False, matricula: bool = False
) -> bool:
    detalle = observacion["detalle"]
    datos = detalle["datos_edicion"]
    if datos["estado_edicion"] in ("finalizada", "archivada") or datos["estado_inscripcion"] in (
        "cerrada",
        "sin-plazas",
    ):
        return False
    if continua:
        return oferta_continua.acreditada(detalle)
    if matricula:
        return matricula_actual.acreditada(detalle)
    if detalle["acceso_abierto"] is True:
        return True
    if datos["estado_inscripcion"] != "disponible-publicamente":
        return False
    return vigencia.tiene_calendario_acreditado_de_oferta(observacion, oferta)


def estado_interno_de_unidad(fila: ObjetoJson, corte: str) -> ObjetoJson:
    """Resume el estado registrado de una unidad en el corte pedido, tras exigir que su evaluación no sea posterior.

    Returns:
        El estado privado de la unidad en ese corte.
    """
    evaluacion = fila["evaluacion"]
    resultado = evaluacion["resultado"] if evaluacion is not None else {}
    if evaluacion is not None:
        exigir(
            vigencia.instante_utc(evaluacion["corte_utc"], "corte registrado")
            <= vigencia.instante_utc(corte, "corte de proyección"),
            "Evaluación posterior al corte de proyección",
        )
        exigir(evaluacion["entradas"]["oferta"]["id"] == fila["unidad"]["id"], "Identidad evaluada distinta de unidad")
    url = evaluacion["entradas"]["oferta"]["url"] if fila["estado_registro"] == "evaluado" else None
    if url is not None:
        catalogo.exigir_url_publica(url, "URL de oferta evaluada")
    motivo = fila["motivo"]
    if (
        motivo == "evaluador_modificado_requiere_evaluacion"
        and evaluacion["entradas"]["politica"].get("regla_disponibilidad") == matricula_actual.METODO
        and resultado.get("estado") == "disponible-publicamente"
        and (
            resultado.get("cierra_el") is None
            or vigencia.instante_utc(resultado["cierra_el"], "fin publicado") > vigencia.instante_utc(corte, "corte")
        )
    ):
        motivo = "matricula_actual_de_edicion_por_confirmar"
    return {
        "estado_registro": fila["estado_registro"],
        "motivo": motivo,
        "decision_en_corte": resultado.get("estado"),
        "corte_utc": evaluacion["corte_utc"] if evaluacion is not None else None,
        "comprobado_el": resultado.get("comprobado_el"),
        "cierra_el": resultado.get("cierra_el"),
        # Revisión interna e intento fallido solo informan al panel; no deciden la selección.
        "revisar_el": resultado.get("revisar_el"),
        "ultimo_intento_fallido_el": resultado.get("ultimo_intento_fallido_el"),
        # Incidencia del enlace (404/410, otra identidad…): avisa sin retirar ni cambiar fechas.
        "incidencia_enlace": resultado.get("incidencia_enlace"),
        "url_oferta_evaluada": url,
        "publicacion_confirmada": None,
        "soporte_publicacion": comprobar_soporte(evaluacion)
        if evaluacion is not None and resultado.get("estado") == "disponible-publicamente"
        else None,
    }


def motivo_de_retencion(estado: ObjetoJson, corte: str) -> str | None:
    """Explica por qué la selección retiene una unidad en el corte, con su mismo criterio; `None` si no la retiene.

    Returns:
        El motivo de retención, o `None` si la unidad se publica.
    """
    if estado["estado_registro"] != "evaluado":
        return estado["motivo"]
    if estado["decision_en_corte"] != "disponible-publicamente":
        return "decision_registrada_no_acredita_oferta"
    if estado["soporte_publicacion"] is not None:
        return estado["soporte_publicacion"]
    if any(estado[c] is None for c in ("comprobado_el", "corte_utc", "url_oferta_evaluada")):
        return "confirmacion_sin_fechas_o_url_indispensables"
    comprobado, evaluado, proyectado = (
        vigencia.instante_utc(f, "fecha conservada") for f in (estado["comprobado_el"], estado["corte_utc"], corte)
    )
    if not comprobado <= evaluado <= proyectado:
        return "confirmacion_posterior_o_fechas_incoherentes"
    # Solo un límite publicado retira la oferta; la revisión interna no cambia la selección.
    cierra = estado["cierra_el"]
    alcanzado = cierra is not None and proyectado >= vigencia.instante_utc(cierra, "límite publicado")
    return "limite_publicado_alcanzado_en_corte" if alcanzado else None


def _retencion_de_preinscripcion(fila: ObjetoJson) -> str | None:
    if "preinscripcion" in fila:
        if fila.get("tramite_preinscripcion_acreditado") is not True:
            return "tramite_de_preinscripcion_sin_acreditar"
        if fila.get("gratuidad_subvencionada_acreditada") is not True:
            return "gratuidad_de_preinscripcion_sin_acreditar"
    return None


def seleccionar(privado: ObjetoJson, corte: str, *, retiradas: frozenset[str] = frozenset()) -> ObjetoJson:
    """Selecciona solo decisiones suficientes y sin límite publicado alcanzado, guardando rechazos privados.

    Args:
        privado: El catálogo privado proyectado.
        corte: El corte de la proyección.
        retiradas: Las unidades que retira la regla de retirada activa de su fuente; se retienen antes de mirar su
            vigencia. Sin ninguna, la selección es la de producción.

    Returns:
        Proyección pública reducida; el registro conserva toda la autoridad factual.
    """
    programas = {u["id"]: u for u in privado["unidades"]}
    ofertas, retenciones = [], []
    por_convocatoria = {}
    for grupo, tipo in (("unidades", "recurso"), ("ediciones", "edicion")):
        for fila in privado[grupo]:
            estado = fila["vigencia"]
            if estado is None:
                continue
            unidad = {
                "tipo": tipo,
                "id": fila["id"],
                "programa_id": fila["id"] if tipo == "recurso" else fila["programa_id"],
            }
            programa = programas[unidad["programa_id"]]
            motivo = (
                (RETIRADA_POR_EVIDENCIA if fila["id"] in retiradas else None)
                or motivo_de_retencion(estado, corte)
                or _retencion_de_preinscripcion(fila)
                or programa.get("motivo_retencion_publicacion")
            )
            if motivo is not None:
                retenciones.append({"unidad": unidad, "motivo": motivo})
                continue
            if "preinscripcion" in fila:
                huella = fila["equivalencia_difusion"]
                catalogo.exigir_sha256(huella, "equivalencia de difusión")
                clave = (programa["id"], huella)
                numero = int(fila["id"].removeprefix("fundae:edicion:"))
                por_convocatoria.setdefault(clave, []).append((numero, unidad))
            exigir(
                tipo != "recurso" or estado["url_oferta_evaluada"] == programa["url"],
                "URL evaluada distinta de recurso",
            )
            ofertas.append(
                {
                    "unidad": unidad,
                    "proveedor_id": programa["proveedor_id"],
                    "titulo_programa": programa["titulo"],
                    "tipo_unidad": programa["tipo_unidad"],
                    "url": estado["url_oferta_evaluada"],
                    "hechos": fila["hechos"],
                    "referencias": fila["referencias"],
                    "evidencia_materia": fila["evidencia_materia"],
                    **({"nivel_itinerario": fila["nivel_itinerario"]} if "nivel_itinerario" in fila else {}),
                    **({"evidencia_temas": fila["evidencia_temas"]} if "evidencia_temas" in fila else {}),
                    **({"nivel_objetivos": fila["nivel_objetivos"]} if "nivel_objetivos" in fila else {}),
                    **({"idioma_programa": fila["idioma_programa"]} if "idioma_programa" in fila else {}),
                    **({"nivel_actividad": fila["nivel_actividad"]} if "nivel_actividad" in fila else {}),
                    **({"preinscripcion": fila["preinscripcion"]} if "preinscripcion" in fila else {}),
                    "comprobado_el": estado["comprobado_el"],
                    "cierra_el": estado["cierra_el"],
                    # Solo la fecha: la web avisa de que el enlace falló sin publicar diagnósticos.
                    "incidencia_enlace_el": (estado["incidencia_enlace"] or {}).get("el"),
                    "corte_evaluacion_utc": estado["corte_utc"],
                }
            )
    duplicados = set()
    for miembros in por_convocatoria.values():
        representante, *otros = sorted(miembros, key=lambda par: par[0])
        for _, unidad in otros:
            duplicados.add(unidad["id"])
            retenciones.append(
                {"unidad": unidad, "motivo": "difusion_equivalente", "representante": representante[1]["id"]}
            )
    ofertas = [oferta for oferta in ofertas if oferta["unidad"]["id"] not in duplicados]
    privado["retenciones_publicacion"] = retenciones
    ofertas.sort(key=lambda f: (f["unidad"]["tipo"], f["unidad"]["id"]))
    proveedores = {o["proveedor_id"] for o in ofertas}
    publico = {
        "schema_version": contrato.VERSION,
        "corte_proyeccion_utc": corte,
        "derechos": privado["derechos"],
        "proveedores": [p for p in privado["proveedores"] if p["id"] in proveedores],
        "ofertas": ofertas,
        "cobertura": {t: sum(o["unidad"]["tipo"] == t for o in ofertas) for t in ("recurso", "edicion")},
    }
    publico["revision"] = sha256_json(publico)
    return publico
