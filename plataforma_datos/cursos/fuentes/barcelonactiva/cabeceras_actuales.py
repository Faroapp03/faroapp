"""Identidad localizada de cada respuesta de edición, aunque cambie su cabecera.

La continuidad conserva todas las observaciones. Su cabecera se valida con sus
propios apoyos; la URL de la oferta corresponde a la última respuesta identificada,
no al orden de ingreso ni a una confirmación antigua favorable.
"""

import re
from http import HTTPStatus

from plataforma_datos.cursos.fuentes.barcelonactiva import matricula_actual as matricula
from plataforma_datos.cursos.fuentes.barcelonactiva import robot_cibernarium as robot

CAMPO = "cabecera_cibernarium_edicion"
METODO = "cabecera-cibernarium-edicion-1"


def declarar(actividad_id: str, edicion_id: str) -> dict:
    """Vincula ambos IDs a los dos apoyos de identidad del constructor API.

    Returns:
        Declaración cerrada que el evaluador vuelve a contrastar.
    """
    return {
        "version": 1,
        "metodo": METODO,
        "actividad_id": actividad_id,
        "edicion_id": edicion_id,
        "apoyos": {"actividad": 0, "edicion": 1},
    }


def _cabecera(observacion: dict) -> dict | None:
    detalle = observacion["detalle"]
    if not isinstance(detalle, dict):
        return None
    return detalle.get(CAMPO, detalle.get(matricula.CAMPO))


def oferta_propia(observacion: dict, oferta: dict) -> dict:
    """Forma la oferta de esa prueba sin convertirla en oferta actual.

    Returns:
        Misma edición y fuente, con la URL exacta de su propia cabecera.
    """
    cabecera = _cabecera(observacion)
    if cabecera is None:
        return oferta
    matricula._exigir(
        isinstance(cabecera, dict)
        and isinstance(cabecera.get("actividad_id"), str)
        and re.fullmatch(r"[1-9][0-9]*", cabecera["actividad_id"])
        and oferta["fuente_id"] == matricula.FUENTE
        and oferta["id"] == matricula.PREFIJO_EDICION + str(cabecera.get("edicion_id")),
        "Cabecera de otra fuente o edición",
    )
    return {**oferta, "url": robot.url_ficha(cabecera["actividad_id"])}


def validar(observacion: dict, oferta: dict) -> None:
    """Contrasta IDs y localizadores de una respuesta identificada propia.

    Raises:
        matricula.ErrorMatriculaActual: Si falta identidad o sus pruebas son ajenas.
    """
    d, c = observacion["detalle"], observacion["detalle"][CAMPO]
    matricula._exigir(
        isinstance(c, dict)
        and set(c) == {"version", "metodo", "actividad_id", "edicion_id", "apoyos"}
        and type(c["version"]) is int
        and c["version"] == 1
        and c["metodo"] == METODO,
        "Prueba de cabecera incompatible",
    )
    matricula._exigir(
        all(isinstance(c[k], str) and re.fullmatch(r"[1-9][0-9]*", c[k]) for k in ("actividad_id", "edicion_id"))
        and oferta["fuente_id"] == matricula.FUENTE
        and oferta["id"] == matricula.PREFIJO_EDICION + c["edicion_id"]
        and d["identidad_observada"] == oferta["id"]
        and oferta["url"] == robot.url_ficha(c["actividad_id"]),
        "Cabecera de otra actividad o edición",
    )
    matricula._exigir(
        observacion["tipo"] == "ficha"
        and observacion["resultado"] == "correcta"
        and d["codigo_http"] == HTTPStatus.OK
        and d["tipo_destino"] == "ficha"
        and observacion["url_consultada"] == d["url_final"]
        and matricula._api(d["url_final"]),
        "Cabecera sin respuesta API identificada",
    )
    apoyos = c["apoyos"]
    matricula._exigir(isinstance(apoyos, dict) and set(apoyos) == {"actividad", "edicion"}, "Apoyos de cabecera ajenos")
    a = matricula._evidencia(observacion, apoyos["actividad"], "identidad")
    e = matricula._evidencia(observacion, apoyos["edicion"], "identidad")
    ruta = e["localizador"].get("valor")
    patron = r"(/activities/(?:0|[1-9]\d*))/listEditions/(?:0|[1-9]\d*)/activityId"
    propia = re.fullmatch(patron, ruta) if isinstance(ruta, str) else None
    matricula._exigir(
        propia is not None
        and a["localizador"].get("valor") == propia[1] + "/activityId"
        and all(a[k] == e[k] for k in ("url", "capturado_utc", "sha256"))
        and a["url"] == d["url_final"],
        "Apoyos de otra cabecera o captura",
    )


def identificadas(observaciones: list[dict], oferta: dict) -> list[dict]:
    """Delimita las respuestas propias para la selección temporal común.

    Returns:
        Respuestas identificadas, incluidas cierre o incertidumbre; no fallos técnicos.
    """
    return [
        o
        for o in observaciones
        if o["tipo"] == "ficha"
        and o["resultado"] == "correcta"
        and o["detalle"]["codigo_http"] == HTTPStatus.OK
        and o["detalle"]["tipo_destino"] == "ficha"
        and o["detalle"]["identidad_observada"] == oferta["id"]
    ]


def validar_actual(oferta: dict, ultimas: list[dict]) -> None:
    """Exige la URL propia de la selección causal del evaluador, incluido cierre o duda.

    Raises:
        matricula.ErrorMatriculaActual: Si hay empate incompatible o URL ajena.
    """
    if not ultimas:
        return
    cabeceras = [_cabecera(o) for o in ultimas]
    if all(c is None for c in cabeceras):
        # Las observaciones anteriores a este método conservan su contrato.
        return
    matricula._exigir(all(c is not None for c in cabeceras), "Cabeceras simultáneas sin identidad comparable")
    urls = {oferta_propia(o, oferta)["url"] for o in ultimas}
    matricula._exigir(len(urls) == 1 and oferta["url"] in urls, "Oferta distinta de la última cabecera identificada")
