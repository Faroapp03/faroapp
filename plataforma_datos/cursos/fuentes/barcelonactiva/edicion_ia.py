"""Cibernàrium: los hechos de la edición propia de cada actividad del censo de IA, solo los que la API da directamente.

Cada actividad publica en `listEditions` sus ediciones; la que lleva el mismo `activityId` es la propia de la actividad
(`vinculacion: id-edicion-publicado`). De ella salen, tal como los publica la fuente:
- las plazas, de una lista cerrada de códigos de inscripción (`CODIGOS_INSCRIPCION`): DISP3 es «sin-plazas»; DISP0
  (con «Places disponibles: N.») y DISP52 (apertura futura) no dicen que falten. Un código desconocido, o un texto de
  plazas de DISP0 con otra forma u otra lengua, deja las plazas en «no consta» y un aviso con su motivo;
- el calendario que normaliza el robot del canal: ventana de acceso (a tu ritmo) o sesiones fijas (horario fijo);
- si el botón de inscripción se muestra (`amagarBoto`: false lo muestra, true lo esconde; si falta, no consta);
- si la fuente la da por cerrada o terminada (`tancada`, `isFinished`): entonces no se ofrece.
Lo que la fuente no dice queda como no consta (null): continuidad de la inscripción, duración, horas e idioma.
"""

import hashlib
import json
import re
from typing import Any

from plataforma_datos.cursos.fuentes.barcelonactiva import robot_cibernarium as robot

PLAZAS_PUBLICADAS = re.compile(r"Places disponibles: [1-9]\d*\.")
CODIGOS_INSCRIPCION = frozenset({"DISP0", "DISP3", "DISP52"})
# Estado de la inscripción que publica la fuente: DISP0 abierta, DISP52 apertura futura; los demás no constan.
ESTADOS_INSCRIPCION = {"DISP0": "abierta", "DISP52": "apertura-futura"}
CODIGO_DESCONOCIDO, TEXTO_DESCONOCIDO = "codigo-de-inscripcion-desconocido", "texto-de-plazas-desconocido"
MOTIVOS = frozenset({CODIGO_DESCONOCIDO, TEXTO_DESCONOCIDO})
SINCRONIA = {"asincrona": "a-tu-ritmo", "sincrona": "horario-fijo"}


def propia(fila: dict[str, Any]) -> tuple[int, dict[str, Any]] | None:
    """La edición propia de una actividad, con su posición en `listEditions`.

    Returns:
        La posición y la edición, o None si no hay exactamente una con el mismo identificador.
    """
    ediciones = fila.get("listEditions")
    if not isinstance(ediciones, list):
        return None
    iguales = [
        (n, e)
        for n, e in enumerate(ediciones)
        if isinstance(e, dict) and str(e.get("activityId")) == str(fila.get("activityId"))
    ]
    return iguales[0] if len(iguales) == 1 else None


def cerrada_en_la_fuente(fila: dict[str, Any]) -> bool:
    """Si la fuente da la actividad o su edición propia por cerrada o terminada.

    Returns:
        True si `tancada` o `isFinished` es true en la actividad o en su edición propia.
    """
    edicion = propia(fila)
    objetos = [fila, *([edicion[1]] if edicion else [])]
    return any(o.get("tancada") is True or o.get("isFinished") is True for o in objetos)


def plazas(edicion: dict[str, Any]) -> tuple[str | None, str | None]:
    """Las plazas que publica la edición y, si no se pueden leer con seguridad, por qué.

    Returns:
        («sin-plazas» o None, motivo del aviso o None).
    """
    codigo = edicion.get("registrationCode")
    if codigo not in CODIGOS_INSCRIPCION:
        return None, CODIGO_DESCONOCIDO
    if codigo == "DISP3":
        return "sin-plazas", None
    descripcion = edicion.get("registrationDesc")
    if codigo == "DISP0" and not (isinstance(descripcion, str) and PLAZAS_PUBLICADAS.fullmatch(descripcion)):
        return None, TEXTO_DESCONOCIDO
    return None, None


def boton_visible(fila: dict[str, Any]) -> bool | None:
    """Si la fuente muestra el botón de inscripción: un hecho leído de `amagarBoto`, nunca deducido de su ausencia.

    Returns:
        True si lo muestra, False si lo esconde y None si el campo falta o tiene otra forma.
    """
    oculto = fila.get("amagarBoto")
    return None if type(oculto) is not bool else not oculto


def _identidad(actividad_id: str, disponibilidad: object, sesiones: object) -> str:
    identidad = {"actividad": actividad_id, "disponibilidad": disponibilidad, "sesiones": sesiones}
    canonica = json.dumps(identidad, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return "ba-edicion-v1:" + hashlib.sha256(canonica).hexdigest()


def edicion(fila: dict[str, Any], pagina: dict[str, Any], localizador: str) -> tuple[dict[str, Any] | None, str | None]:
    """La edición propia de una actividad con la forma `EdicionCibernarium` del paquete.

    Args:
        fila: La actividad tal como la publica la página del censo.
        pagina: La evidencia de su página (dirección, hora y cuerpo).
        localizador: Dónde está la actividad en esa página (`activities[n]`).

    Returns:
        La edición, o None si la actividad no publica una edición propia interpretable; y el motivo de su aviso.
    """
    encontrada = propia(fila)
    if encontrada is None:
        return None, None
    posicion, publicada = encontrada
    identificador = str(fila["activityId"])
    try:
        datos = robot.normalizar_edicion("cibernarium:" + identificador, fila, publicada)["datos"]
    except robot.ErrorRobot:
        return None, None
    de_plazas, aviso = plazas(publicada)
    ventana = datos["ventana_acceso"]
    disponibilidad = (
        {"desde": ventana["desde"][:10], "hasta": ventana["hasta"][:10]}
        if ventana and ventana["desde"] and ventana["hasta"]
        else None
    )
    sesiones = [
        {
            "fecha": s["inicio"][:10],
            "inicioLocal": s["inicio"][11:16],
            "finLocal": s["fin"][11:16] if s["fin"] else None,
        }
        for s in datos["sesiones"]
        if s["inicio"]
    ]
    modalidad = datos["modalidad"] if datos["modalidad"] in {"en-linea", "presencial", "mixta"} else None
    return {
        "idFuente": identificador,
        "identidadInterna": _identidad(identificador, disponibilidad, sesiones),
        "vinculacion": "id-edicion-publicado",
        "modalidad": modalidad,
        "sincronia": SINCRONIA.get(datos["sincronia"]),
        "horas": None,
        "duracionPublicada": None,
        "idioma": None,
        "disponibilidad": disponibilidad,
        "sesiones": sesiones,
        "inscripcion": {
            "continuaDeclarada": None,
            "apertura": None,
            "botonVisible": boton_visible(fila),
            "estado": ESTADOS_INSCRIPCION.get(publicada.get("registrationCode")),
        },
        "plazas": de_plazas,
        "evidencia": {
            "url": pagina["url"],
            "observadoUTC": pagina["consultado_utc"],
            "origenFechaObservacion": "consulta-http",
            "sha256Captura": pagina["cuerpo"]["sha256"],
            "normalizacionFechas": "intervalo-publicado",
            "localizador": f"{localizador}.listEditions[{posicion}]",
        },
    }, aviso
