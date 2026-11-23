"""Observación causal de una edición API, usando el normalizador existente.

La matrícula y el calendario se prueban en el mismo objeto nativo. No se usa
el reloj de lectura ni se copia el enlace con p_auth. Una respuesta identificada
sin contenido interpretable conserva incertidumbre, nunca una confirmación previa.
"""

from copy import deepcopy
from pathlib import Path

from plataforma_datos.comun.huella_json import sha256_json
from plataforma_datos.comun.nucleo import FormatoInesperado, exigir
from plataforma_datos.cursos.contrato_fichas import normalizar_datos_edicion, validar_datos_edicion
from plataforma_datos.cursos.fallo_de_consulta import observacion_de_fallo
from plataforma_datos.cursos.fuentes.barcelonactiva import adquisicion, cabeceras_actuales, matricula_actual
from plataforma_datos.cursos.fuentes.barcelonactiva import robot_cibernarium as robot
from plataforma_datos.cursos.tipos_json import ObjetoJson


def id_lectura_cierre(id_anterior: str) -> str:
    """Identifica el método que reconoce el cierre publicado por la edición.

    Returns:
        Identidad de la lectura de cierre para la misma recepción y edición.
    """
    return "cibernarium-observacion-api-1:" + sha256_json([id_anterior, "inscripcion-cerrada-disp2-1"])


def construir(original: Path, cap: ObjetoJson, *, actividad_id: str, edicion_id: str) -> tuple[ObjetoJson, ObjetoJson]:
    """Contrasta la identidad en bytes/recibo antes de preparar su observación.

    Returns:
        Oferta de esa edición y observación reproducible, todavía sin evaluación.
    """
    robot.identificador(actividad_id)
    robot.identificador(edicion_id)
    filas, meta = adquisicion.actividades(original, cap)
    propias = [(i, a) for i, a in enumerate(filas) if a.get("activityId") == actividad_id]
    exigir(len(propias) == 1, "Actividad API ausente o ambigua", FormatoInesperado)
    posicion, actividad = propias[0]
    lista = actividad.get("listEditions")
    exigir(
        isinstance(lista, list) and all(isinstance(e, dict) for e in lista),
        "Falta lista de ediciones",
        FormatoInesperado,
    )
    candidatas = [(i, e) for i, e in enumerate(lista) if e.get("activityId") == edicion_id]
    exigir(len(candidatas) == 1, "Edición API ausente o de otra actividad", FormatoInesperado)
    posicion_edicion, edicion = candidatas[0]
    oferta = {
        "id": matricula_actual.PREFIJO_EDICION + edicion_id,
        "fuente_id": matricula_actual.FUENTE,
        "url": robot.url_ficha(actividad_id),
    }
    base = f"/activities/{posicion}/listEditions/{posicion_edicion}"
    prueba = {"url": meta["url_final"], "capturado_utc": meta["fin_utc"], "sha256": cap["cuerpo"]["sha256"]}

    def evidencia(alcance: str, campo: str) -> ObjetoJson:
        return {"alcance": alcance, **prueba, "localizador": {"tipo": "campo", "valor": campo}}

    obs = {
        "id": "cibernarium-observacion-api-1:"
        + sha256_json(
            [
                actividad_id,
                edicion_id,
                cap["cuerpo"]["sha256"],
                cap["recibo"]["sha256"],
                matricula_actual.METODO,
                cabeceras_actuales.METODO,
            ]
        ),
        "tipo": "ficha",
        "intentado_el": meta["inicio_utc"],
        "terminado_el": meta["fin_utc"],
        "resultado": "correcta",
        "url_consultada": meta["url"],
        "detalle": {},
        "evidencias": [
            evidencia("identidad", f"/activities/{posicion}/activityId"),
            evidencia("identidad", base + "/activityId"),
        ],
    }

    def sin_contraste() -> tuple[ObjetoJson, ObjetoJson]:
        obs["detalle"] = {
            "url_final": meta["url_final"],
            "codigo_http": meta["http"],
            "tipo_destino": "ficha",
            "identidad_observada": oferta["id"],
            "datos_edicion": None,
            "acceso_abierto": None,
            cabeceras_actuales.CAMPO: cabeceras_actuales.declarar(actividad_id, edicion_id),
        }
        return oferta, obs

    nativa, motivo = _edicion_interpretable(actividad_id, actividad, edicion)
    if motivo is not None:
        return sin_contraste()
    estado = nativa["datos"]["estado_inscripcion"]
    if estado == "cerrada":
        obs["id"] = id_lectura_cierre(obs["id"])
    asincrona = nativa["datos"]["ventana_acceso"] is not None
    apoyo_calendario = evidencia("calendario", base + ("/sessionsOnline" if asincrona else "/listSessions"))
    datos = _datos_con_calendario(nativa, oferta, apoyo_calendario)
    registro = {k: deepcopy(edicion.get(k)) for k in matricula_actual.REGISTRO}
    datos["publicacion_original"]["gestion_matricula"] = deepcopy(registro)
    validar_datos_edicion(datos)
    for k in matricula_actual.REGISTRO:
        if k in edicion:
            obs["evidencias"].append(evidencia("disponibilidad", base + "/" + k))
    obs["evidencias"].append(apoyo_calendario)
    obs["detalle"] = {
        "url_final": meta["url_final"],
        "codigo_http": meta["http"],
        "tipo_destino": "ficha",
        "identidad_observada": oferta["id"],
        "datos_edicion": datos,
        "acceso_abierto": None,
        cabeceras_actuales.CAMPO: cabeceras_actuales.declarar(actividad_id, edicion_id),
    }
    if estado == "disponible-publicamente":
        if not all(k in edicion for k in matricula_actual.REGISTRO):
            return sin_contraste()
        apoyos = {
            "actividad": 0,
            "edicion": 1,
            **{k: i + 2 for i, k in enumerate(matricula_actual.REGISTRO)},
            "calendario": len(obs["evidencias"]) - 1,
        }
        obs["detalle"][matricula_actual.CAMPO] = {
            "version": 1,
            "metodo": matricula_actual.METODO,
            "actividad_id": actividad_id,
            "edicion_id": edicion_id,
            "registro": registro,
            "apoyos": apoyos,
        }
        matricula_actual.validar(obs, oferta)
    return oferta, obs


def _edicion_interpretable(
    actividad_id: str, actividad: ObjetoJson, edicion: ObjetoJson
) -> tuple[ObjetoJson | None, str | None]:
    """Separa fallo de lectura de señales nativas y cierre acreditado.

    Returns:
        Edición normalizada o el diagnóstico que impide confirmar su estado.
    """
    try:
        nativa = robot.normalizar_edicion("cibernarium:" + actividad_id, actividad, edicion)
    except robot.ErrorRobot:
        return None, "edicion_api_no_interpretable"
    estado = nativa["datos"]["estado_inscripcion"]
    if estado is None:
        return None, "estado_inscripcion_no_interpretable"
    if estado == "sin-plazas" and edicion.get("registrationDesc") != "Sense places.":
        return None, "cierre_de_matricula_no_corroborado"
    if estado == "apertura-futura" and robot.apertura_inscripcion(edicion.get("registrationDesc")) is None:
        return None, "apertura_de_matricula_no_interpretable"
    if not all(nativa["datos"]["fechas_publicadas"][e] is not None for e in ("inicio", "fin")):
        return None, "calendario_edicion_no_acreditado"
    return nativa, None


def _datos_con_calendario(nativa: ObjetoJson, oferta: ObjetoJson, apoyo: ObjetoJson) -> ObjetoJson:
    """Vincula el calendario normalizado y su prueba al identificador de la edición.

    Returns:
        Datos de edición sin matrícula inventada ni acceso al aula.
    """
    datos = nativa["datos"]
    fechas = datos["fechas_publicadas"]
    campo = "fechas_aula" if datos["ventana_acceso"] is not None else "fechas_edicion"
    fuente = {
        "modalidad": datos["modalidad"],
        "sincronia": datos["sincronia"],
        campo: {"inicio": fechas["inicio"], "fin": fechas["fin"], "alcance": "edicion"},
        "vinculos_calendarios": {
            campo: {
                "tipo": "id",
                "valor": oferta["id"].removeprefix(matricula_actual.PREFIJO_EDICION),
                "edicion": {"id": oferta["id"], "url": None},
                "evidencia": {k: v for k, v in apoyo.items() if k != "alcance"},
            }
        },
    }
    resultado = normalizar_datos_edicion(fuente)
    resultado["estado_inscripcion"] = datos["estado_inscripcion"]
    return resultado


METODO_FALLO = "cibernarium-pagina-fallida-v1"


def construir_fallo(intento: ObjetoJson, intento_sha256: str, *, oferta: ObjetoJson) -> ObjetoJson:
    """Convierte el intento de una página caída del censo en un fallo de consulta de la edición.

    La edición conocida que no aparece en las páginas leídas pudo estar en la caída: el
    fallo solo informa del intento. No aporta cuerpo, no retira la oferta y no renueva
    su última comprobación válida. La evidencia es el recibo del propio intento.

    Returns:
        Entrada del evaluador común con el intervalo real del intento.
    """
    adquisicion.inicio_de_pagina(intento["url"])
    exigir(
        oferta.get("fuente_id") == matricula_actual.FUENTE
        and str(oferta.get("id", "")).startswith(matricula_actual.PREFIJO_EDICION),
        "Intento de página para una oferta ajena a Cibernàrium",
        FormatoInesperado,
    )
    return observacion_de_fallo(
        id=METODO_FALLO + ":" + sha256_json([METODO_FALLO, oferta["id"], intento_sha256]),
        intentado_el=intento["inicio_utc"],
        terminado_el=intento["fin_utc"],
        url=intento["url"],
        motivo="pagina_del_censo_sin_respuesta_valida",
        sha256=intento_sha256,
        localizador="/error" if intento.get("error") else "/http",
    )
