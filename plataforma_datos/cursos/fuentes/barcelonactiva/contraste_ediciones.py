"""Contraste individual de ediciones con calendario en curso ausentes del censo completo."""

import time
from http import HTTPStatus
from pathlib import Path

from plataforma_datos.comun import perfil_web, red
from plataforma_datos.comun.huella_json import sha256_json
from plataforma_datos.cursos import operacion_fuente as comun
from plataforma_datos.cursos.contrato_fichas import normalizar_datos_edicion, validar_datos_edicion
from plataforma_datos.cursos.fallo_de_consulta import observacion_de_fallo
from plataforma_datos.cursos.fuentes.barcelonactiva import ficha_edicion, negocio_actual
from plataforma_datos.cursos.fuentes.barcelonactiva import robot_cibernarium as robot

PREFIJO = "cibernarium-ficha-edicion-1:"
CAMPO = "fichas_de_ediciones"
MAX_POR_CONSULTA = 20
PLAZO_FICHAS_S = 5 * 60
PLAZO_POR_FICHA_S = 30


def recibir_ficha(  # noqa: PLR0913 - URL, perfil y política de saltos pertenecen al contrato de cada ficha.
    url: str, original: Path, id: str, hasta: float, *, perfil: perfil_web.Uso, seguir_redirecciones: bool = True
) -> dict | None:
    """Recibe una ficha opcional dentro del presupuesto compartido.

    Returns:
        Su recibo, incluso tras un fallo remoto, o None si queda para otra consulta.
    """
    segundos = min(PLAZO_POR_FICHA_S, int(hasta - time.monotonic()))
    if segundos <= red.PAUSA_ENTRE_PETICIONES_S:
        return None
    try:
        return comun.recibir_url(
            url, original, id, perfil=perfil, segundos=segundos, seguir_redirecciones=seguir_redirecciones
        )
    except red.PlazoSinEnvio:
        return None


def recibir(  # noqa: PLR0913 - Comparte el límite de la adquisición y las referencias de su catálogo.
    original: Path, base: Path, vistas: set[str], corte: str, previas: dict, *, hasta: float | None = None
) -> dict:
    """Consulta primero las fichas aún pendientes y después las comprobadas hace más tiempo.

    Returns:
        Recibos por edición, conservando la fecha real cuando quedan para otro turno.
    """
    if hasta is None:
        hasta = time.monotonic() + PLAZO_FICHAS_S
    _, ediciones = negocio_actual.leer(base)
    ahora = robot.fecha_utc(corte)
    pendientes = {}
    for id, edicion in ediciones.items():
        fin = ficha_edicion.instante_de_calendario((edicion["datos"].get("fechas_publicadas") or {}).get("fin"))
        if fin is not None and id not in vistas and fin > ahora:
            nativo = robot.identificador(edicion["datos"]["activity_id"])
            pendientes[nativo] = previas.get(nativo)

    def turno(id: str) -> tuple[str, str]:
        cap = pendientes[id]
        return (comun.leer_recibo(original, cap)["fin_utc"] if cap else "", id)

    for id in sorted(pendientes, key=turno)[:MAX_POR_CONSULTA]:
        nueva = recibir_ficha(
            ficha_edicion.url(id),
            original,
            "cibernarium-edicion:" + id,
            hasta,
            perfil="pagina",
            seguir_redirecciones=False,
        )
        if nueva is None:
            break
        pendientes[id] = nueva
    return {id: cap for id, cap in pendientes.items() if cap is not None}


def comprobar(original: Path, cap: dict, id: str) -> tuple[bytes | None, dict]:
    """Exige que la respuesta pertenezca a la URL propia y distingue el fallo de transporte.

    Returns:
        Cuerpo y metadatos verificados por la misma lectura de recibos que la API.
    """
    from plataforma_datos.cursos.fuentes.barcelonactiva import adquisicion

    cuerpo, meta = adquisicion.pagina(original, cap)
    comun.exigir(
        cap["id"] == "cibernarium-edicion:" + id and meta["url"] == ficha_edicion.url(id),
        "Ficha individual de otra edición",
        comun.FormatoInesperado,
    )
    return cuerpo, meta


def incluir(original: Path, documento: dict, conjunto: dict) -> dict:
    """Valida las fichas individuales del ciclo antes de incorporarlas a la admisión.

    Returns:
        Conjunto con las mismas recepciones contrastadas, incluidos los ciclos históricos.
    """
    if CAMPO in documento:
        individuales = documento[CAMPO]
        comun.exigir(
            isinstance(individuales, dict) and conjunto["censo_completo"],
            "Fichas individuales sin censo completo",
            comun.FormatoInesperado,
        )
        vistas = set(conjunto["censo"]["ediciones"])
        for id, cap in individuales.items():
            comun.exigir(
                "cibernarium-edicion:" + id not in vistas,
                "Edición individual presente en el censo",
                comun.FormatoInesperado,
            )
            comprobar(original, cap, id)
        conjunto[CAMPO] = individuales
    return conjunto


def observar(original: Path, cap: dict, titulo: str, edicion: dict) -> tuple[str, dict]:
    """Reconstruye un hecho HTML de su captura y del calendario admitido de la edición.

    Returns:
        Diagnóstico de la fuente y observación para el evaluador común.
    """
    id = robot.identificador(edicion["datos"]["activity_id"])
    cuerpo, meta = comprobar(original, cap, id)
    url = ficha_edicion.url(id)
    identidad = PREFIJO + sha256_json(
        [edicion["id"], cap["recibo"]["sha256"], edicion["datos"].get("sesiones"), titulo]
    )
    html = (meta.get("content_type") or "").partition(";")[0].strip().lower() == "text/html"

    def fallo(motivo: str) -> tuple[str, dict]:
        return motivo, observacion_de_fallo(
            id=identidad,
            intentado_el=meta["inicio_utc"],
            terminado_el=meta["fin_utc"],
            url=url,
            motivo=motivo,
            sha256=cap["intento"]["sha256"],
            localizador="/error" if meta.get("error") else "/http",
        )

    if (
        cuerpo is None
        or meta["http"] != HTTPStatus.OK
        or not meta["completo"]
        or not html
        or meta.get("url_final") != url
    ):
        return fallo("ficha_individual_sin_respuesta_valida")
    try:
        lectura = ficha_edicion.contrastar(cuerpo, id=id, titulo=titulo, edicion=edicion)
    except (UnicodeDecodeError, comun.FormatoInesperado):
        return fallo("ficha_individual_no_interpretable")
    if not lectura.identificada:
        return fallo("ficha_individual_no_identificada")
    observacion = {
        "id": identidad,
        "tipo": "ficha",
        "resultado": "correcta",
        "url_consultada": url,
        "intentado_el": meta["inicio_utc"],
        "terminado_el": meta["fin_utc"],
        "detalle": {
            "url_final": url,
            "codigo_http": meta["http"],
            "tipo_destino": "ficha",
            "identidad_observada": edicion["id"],
            "datos_edicion": None,
            "acceso_abierto": None,
        },
        "evidencias": [],
    }
    apoyo = {"url": url, "capturado_utc": meta["fin_utc"], "sha256": cap["cuerpo"]["sha256"]}

    def evidencia(alcance: str, selector: str) -> dict:
        return {"alcance": alcance, **apoyo, "localizador": {"tipo": "selector", "valor": selector}}

    observacion["evidencias"] = [
        evidencia("identidad", "meta[property='og:url']"),
        evidencia("diagnostico", lectura.selector),
    ]
    if lectura.estado in ("cerrada", "sin-plazas", "boton-de-inscripcion"):
        datos = normalizar_datos_edicion({})
        datos["estado_inscripcion"] = (
            "disponible-publicamente" if lectura.estado == "boton-de-inscripcion" else lectura.estado
        )
        # El botón permite solicitar matrícula; por sí solo no acredita plazas ni acceso al aula.
        validar_datos_edicion(datos)
        observacion["detalle"]["datos_edicion"] = datos
        observacion["evidencias"].append(evidencia("disponibilidad", lectura.selector))
    return "ficha_individual_" + lectura.estado.replace("-", "_"), observacion
