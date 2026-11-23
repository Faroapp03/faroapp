"""Matrícula actual publicada para una edición nativa de Cibernàrium.

DISP0 se contrasta con la descripción y señales del mismo objeto de edición.
La prueba es una observación de matrícula, nunca acceso al aula, plaza reservada
o un plazo de inscripción inventado. El productor debe reextraerla del cuerpo
íntegro admitido; este contrato puro verifica su identidad y apoyos localizados.
"""

import re
from http import HTTPStatus
from urllib.parse import parse_qs, urlsplit

from plataforma_datos.cursos.contrato_fichas import calendarios_edicion
from plataforma_datos.cursos.tipos_json import ObjetoJson

FUENTE = "barcelonactiva"
VERSION_POLITICA = "3"
METODO = "matricula-actual-cibernarium-edicion-1"
CAMPO = "matricula_actual_edicion"
REGISTRO = ("registrationCode", "registrationDesc", "openingsAvailable", "tancada", "isFinished")
APOYOS = ("actividad", "edicion", *REGISTRO, "calendario")
PREFIJO_EDICION = "cibernarium-edicion:"
ORIGEN = "https://cibernarium.barcelonactiva.cat"
MAX_TEXTO_ESTADO = 160


class ErrorMatriculaActual(ValueError):
    """El método no conserva identidad de edición, estado o evidencia propia."""


def estado_inscripcion(edicion: ObjetoJson) -> str | None:
    """Interpreta el código publicado y exige señales concordantes para acreditar el cierre.

    Returns:
        El estado identificado de esta edición o None cuando falta soporte.
    """
    codigo = edicion.get("registrationCode")
    if (
        codigo == "DISP2"
        and edicion.get("registrationDesc") == "Inscripció tancada."
        and edicion.get("openingsAvailable") is False
        and edicion.get("tancada") is True
        and edicion.get("isFinished") is True
    ):
        return "cerrada"
    return {"DISP0": "disponible-publicamente", "DISP3": "sin-plazas", "DISP52": "apertura-futura"}.get(codigo)


def _exigir(condicion: object, mensaje: str) -> None:
    if not condicion:
        raise ErrorMatriculaActual(mensaje)


def _api(url: str) -> bool:
    if not isinstance(url, str):
        return False
    try:
        u = urlsplit(url)
    except ValueError:
        return False
    q = parse_qs(u.query, keep_blank_values=True)
    fijos = {
        "p_p_id": ["cAct_INSTANCE_uhcx"],
        "p_p_lifecycle": ["2"],
        "p_p_state": ["normal"],
        "p_p_mode": ["view"],
        "p_p_cacheability": ["cacheLevelPage"],
        "_cAct_INSTANCE_uhcx_typeView": ["list"],
    }
    return (
        u.scheme == "https"
        and u.netloc in ("cibernarium.barcelonactiva.cat", "cibernarium.barcelonactiva.cat:443")
        and u.path == "/ca/web/guest/formacions"
        and not u.fragment
        and set(q) == set(fijos) | {"_cAct_INSTANCE_uhcx_start", "_cAct_INSTANCE_uhcx_end"}
        and all(q[k] == v for k, v in fijos.items())
        and all(
            len(q[k]) == 1 and re.fullmatch(r"[0-9]+", q[k][0])
            for k in ("_cAct_INSTANCE_uhcx_start", "_cAct_INSTANCE_uhcx_end")
        )
    )


def _evidencia(observacion: ObjetoJson, indice: object, alcance: str) -> ObjetoJson:
    pruebas = observacion["evidencias"]
    _exigir(
        isinstance(pruebas, list) and type(indice) is int and 0 <= indice < len(pruebas),
        "Índice de apoyo de matrícula inválido",
    )
    prueba = pruebas[indice]
    _exigir(
        isinstance(prueba, dict)
        and prueba.get("alcance") == alcance
        and isinstance(prueba.get("localizador"), dict)
        and prueba["localizador"].get("tipo") == "campo",
        "Matrícula sin apoyo estructurado propio",
    )
    return prueba


def validar(observacion: ObjetoJson, oferta: ObjetoJson) -> None:
    """Exige objeto de edición y calendarios vinculados, nunca un CTA genérico.

    Raises:
        ErrorMatriculaActual: Si el método o sus apoyos no corresponden a esta edición.
    """
    d = observacion["detalle"]
    m = d[CAMPO]
    _exigir(
        isinstance(m, dict) and set(m) == {"version", "metodo", "actividad_id", "edicion_id", "registro", "apoyos"},
        "Campos del método de matrícula incompatibles",
    )
    _exigir(
        type(m["version"]) is int
        and m["version"] == 1
        and m["metodo"] == METODO
        and oferta["fuente_id"] == FUENTE
        and observacion["tipo"] == "ficha"
        and observacion["resultado"] == "correcta",
        "Método de matrícula fuera de su fuente",
    )
    _exigir(
        all(isinstance(m[k], str) and re.fullmatch(r"[1-9][0-9]*", m[k]) for k in ("actividad_id", "edicion_id")),
        "Identidad nativa de matrícula inválida",
    )
    _exigir(
        oferta["id"] == PREFIJO_EDICION + m["edicion_id"]
        and d["identidad_observada"] == oferta["id"]
        and oferta["url"] == ORIGEN + "/ficha-actividad?activityId=" + m["actividad_id"],
        "Matrícula de otra actividad o edición",
    )
    _exigir(
        d["codigo_http"] == HTTPStatus.OK
        and d["tipo_destino"] == "ficha"
        and d["acceso_abierto"] is None
        and observacion["url_consultada"] == d["url_final"]
        and _api(d["url_final"]),
        "Matrícula sin respuesta API identificada; no equivale a acceso al aula",
    )
    registro = m["registro"]
    _exigir(isinstance(registro, dict) and set(registro) == set(REGISTRO), "Estado de matrícula incompleto")
    _exigir(
        all(
            registro[k] is None or isinstance(registro[k], str) and len(registro[k]) <= MAX_TEXTO_ESTADO
            for k in ("registrationCode", "registrationDesc")
        )
        and all(
            registro[k] is None or type(registro[k]) is bool for k in ("openingsAvailable", "tancada", "isFinished")
        ),
        "Tipos de estado no reconocidos",
    )
    apoyos = m["apoyos"]
    _exigir(isinstance(apoyos, dict) and set(apoyos) == set(APOYOS), "Apoyos de matrícula incompletos")
    identidad = _evidencia(observacion, apoyos["edicion"], "identidad")
    campo = identidad["localizador"].get("valor", "")
    _exigir(isinstance(campo, str), "Localizador de matrícula no textual")
    ruta = re.fullmatch(r"(/activities/(?:0|[1-9]\d*))/listEditions/(?:0|[1-9]\d*)/activityId", campo)
    _exigir(ruta is not None, "Identidad no vinculada al objeto nativo de edición")
    base = campo.removesuffix("/activityId")
    esperados = {
        "actividad": ("identidad", ruta[1] + "/activityId"),
        "edicion": ("identidad", campo),
        **{k: ("disponibilidad", base + "/" + k) for k in REGISTRO},
    }
    for k, (alcance, localizador) in esperados.items():
        e = _evidencia(observacion, apoyos[k], alcance)
        _exigir(
            e["localizador"]["valor"] == localizador
            and all(e[c] == identidad[c] for c in ("url", "capturado_utc", "sha256"))
            and e["url"] == d["url_final"],
            "Prueba de otro objeto/captura de matrícula",
        )
    datos = d["datos_edicion"]
    _exigir(isinstance(datos, dict), "Matrícula sin datos de edición")
    calendario = _evidencia(observacion, apoyos["calendario"], "calendario")
    _exigir(
        all(calendario[c] == identidad[c] for c in ("url", "capturado_utc", "sha256"))
        and calendario["localizador"]["valor"] in (base + "/sessionsOnline", base + "/listSessions"),
        "Calendario de matrícula ajeno a la edición",
    )
    soporte = {k: v for k, v in calendario.items() if k != "alcance"}
    validos = [
        c
        for c in calendarios_edicion(datos)
        if c["alcance"] == "edicion"
        and c["periodo"]["tipo"] in ("periodo-formativo", "ventana-acceso")
        and all(c["periodo"][e] is not None for e in ("inicio", "fin"))
        and c["vinculo_edicion"] is not None
        and c["vinculo_edicion"]["tipo"] == "id"
        and c["vinculo_edicion"]["valor"] == m["edicion_id"]
        and c["vinculo_edicion"]["edicion"] == {"id": oferta["id"], "url": None}
        and c["vinculo_edicion"]["evidencia"] == soporte
    ]
    _exigir(len(validos) == 1, "No hay calendario inequívoco de esta edición")


def acreditada(detalle: ObjetoJson) -> bool:
    """Corrobora la matrícula actual sin usar sus plazas como garantía personal.

    Returns:
        True solo para DISP0 y las cuatro señales concordantes de esa edición.
    """
    declaracion = detalle.get(CAMPO)
    if not isinstance(declaracion, dict):
        return False
    r = declaracion.get("registro")
    if not isinstance(r, dict) or not isinstance(detalle.get("datos_edicion"), dict):
        return False
    return (
        detalle["datos_edicion"].get("estado_inscripcion") == "disponible-publicamente"
        and r.get("registrationCode") == "DISP0"
        and isinstance(r.get("registrationDesc"), str)
        and re.fullmatch(r"Places disponibles: [1-9]\d*\.", r["registrationDesc"]) is not None
        and r.get("openingsAvailable") is True
        and r.get("tancada") is False
        and r.get("isFinished") is False
    )
