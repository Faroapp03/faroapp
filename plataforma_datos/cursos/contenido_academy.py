"""Temario de la recepción Academy seleccionada por el corte admitido, sin red."""

import json
import sqlite3
from contextlib import closing
from dataclasses import dataclass
from html.parser import HTMLParser

from plataforma_datos.cursos import admision_catalogo as admision
from plataforma_datos.cursos import almacen_catalogo as almacen
from plataforma_datos.cursos import oferta_continua, recibos_compartidos, registro_vigencia
from plataforma_datos.cursos import operacion_fuente as fuente
from plataforma_datos.cursos.contrato_entrega_catalogo import exigir
from plataforma_datos.cursos.fuentes.claude_academy import acceso_publico, control_actual, idioma_curso, lector
from plataforma_datos.cursos.fuentes.claude_academy import condiciones_formacion as condiciones
from plataforma_datos.cursos.fuentes.claude_academy import condiciones_publicadas as comercio
from plataforma_datos.cursos.fuentes.hp_life import actualizacion as hp
from plataforma_datos.cursos.fuentes.hp_life.recepciones import fecha_utc


@dataclass(frozen=True, kw_only=True)
class TemarioAcademy:
    """HTML y metadatos originales de la misma recepción que respalda la instantánea."""

    ficha: lector.FichaAcademy
    cuerpo_html: str
    idioma: str | None
    comprobado_el: str | None = None
    inscripcion: dict | None = None
    modalidad: dict | None = None
    formacion: dict | None = None
    idioma_curso: dict | None = None


class _Idioma(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.valores: list[str | None] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "html":
            self.valores.append(dict(attrs).get("lang"))


def _pagina(fila: dict, referencias: dict) -> tuple[bytes, dict]:
    refs = {k: referencias.get(fila[k + "_sha256"]) for k in ("cuerpo", "recibo")}
    exigir(all(refs.values()), "Recepción Academy actual fuera de los índices admitidos")
    cuerpo = hp.leer_verificado(refs["cuerpo"], fuente.limite_cuerpo("claude_academy"))
    envoltorio = recibos_compartidos.leer_json(hp.leer_verificado(refs["recibo"], admision.MAX_INFORME))
    exigir(
        envoltorio.get("metadatos_sha256") == fila.get("metadatos_sha256"),
        "Selección Academy con metadatos de otra recepción",
    )
    recibo = almacen.leer_documento_indexado(refs["recibo"], referencias)
    meta = fuente.metadatos_de_captura_academy(recibo, {"cuerpo": {"archivo": refs["cuerpo"].ruta.name}})
    return cuerpo, meta


def _prueba(meta: dict, localizador: str) -> dict:
    return {
        "url": meta["url_solicitada"],
        "capturado_utc": meta["recibido_utc"],
        "sha256": meta["sha256"],
        "localizador": localizador,
    }


def _inscripcion(faq: tuple[bytes, dict] | None, ficha: lector.FichaAcademy) -> dict | None:
    enlace = condiciones.enlace_inscripcion(ficha)
    if faq is None or enlace is None:
        return None
    try:
        declaracion = condiciones.declaracion_inscripcion(*faq)
    except lector.ErrorFichaAcademy:
        return None
    if declaracion is None:
        return None
    return {
        "regla": condiciones.REGLA,
        "registro_previo_para_inscribirse": True,
        "finalidad": "inscripcion_progreso_acreditacion",
        "alcance": "declaracion_general",
        "evidencia": _prueba(faq[1], declaracion.localizador),
        "fragmento": condiciones.FRAGMENTO,
        "enlace_propio": enlace._asdict(),
    }


def _acreditada(prueba: dict, actual: TemarioAcademy, corte: str) -> bool:
    # Cada prueba conserva la fecha de su propia captura: el tiempo transcurrido no la anula
    # y una consulta posterior de otra página no la renueva.
    return actual.comprobado_el is not None and fecha_utc(prueba["capturado_utc"]) <= fecha_utc(corte)


def _gratuidad(observacion: dict, ficha: lector.FichaAcademy, cuerpo: bytes) -> dict | None:
    detalle = observacion["detalle"]
    if not oferta_continua.acreditada(detalle):
        return None
    declaracion = detalle[oferta_continua.CAMPO]
    if declaracion["curso_id"] != "claude-academy:" + ficha.id:
        return None
    indices = declaracion["criterios"]["formacion_gratuita"]["apoyos"]
    apoyos = [observacion["evidencias"][i] for i in indices]
    precio = comercio.examinar(cuerpo, ficha)
    if precio.precio == "gratis":
        selectores = {
            d["localizador"] for d in precio.declaraciones if d["campo"] == "precio" and d["interpretacion"] == "gratis"
        }
        for apoyo in apoyos:
            if (
                (apoyo["url"], apoyo["capturado_utc"], apoyo["sha256"])
                == (ficha.url, ficha.capturado_utc, ficha.sha256_captura)
                and apoyo["localizador"]["tipo"] == "selector"
                and apoyo["localizador"]["valor"] in selectores
            ):
                return {"valor": "gratis_formacion", "alcance": "unidad", "evidencia": apoyo}
        return None
    if precio.precio == "sin_declaracion" and len(apoyos) == 1:
        general = apoyos[0]
        if general["url"] == acceso_publico.PORTADA and general["localizador"]["tipo"] == "selector":
            return {"valor": "gratis_formacion", "alcance": "declaracion_general", "evidencia": general}
    return None


def _referencia(prueba: dict) -> dict:
    return {
        "url": prueba["url"],
        "sha256": prueba["sha256"],
        "fecha_referencia": prueba["capturado_utc"],
        "alcance": "entidad",
        "naturaleza_fecha": "recepcion_conservada",
        "naturaleza_documento": "no_acreditada",
    }


def datos_para_entrega(actual: TemarioAcademy, corte: str) -> dict:
    """Proyecta solo pruebas de la selección actual, nunca prolonga la vigencia del curso.

    Returns:
        Hechos/referencias con la fecha de su propia captura. Una consulta posterior
        de ficha no renueva ni invalida la fecha de la FAQ.
    """
    propia = {
        "url": actual.ficha.url,
        "capturado_utc": actual.ficha.capturado_utc,
        "sha256": actual.ficha.sha256_captura,
    }
    salida = {"referencias": []}
    if _acreditada(propia, actual, corte):
        salida["referencias"].append(_referencia(propia))
    for campo in ("modalidad", "inscripcion", "formacion", "idioma_curso"):
        dato = getattr(actual, campo)
        if dato is None or not _acreditada(dato["evidencia"], actual, corte):
            continue
        e = dato["evidencia"]
        if campo in ("inscripcion", "formacion", "idioma_curso"):
            dato = {**dato, "vigencia": {"comprobado_el": e["capturado_utc"]}}
        salida["idioma" if campo == "idioma_curso" else campo] = dato
        salida["referencias"].append(_referencia(e))
    return salida


def actuales(solicitud: admision.SolicitudAdmision, ids: set[str], referencias: dict) -> dict[str, TemarioAcademy]:
    """Reextrae cuerpos seleccionados y exige su vínculo con la evaluación actual.

    Returns:
        Temarios concordantes con identidad, contenido nativo y observación actual.
        La ausencia de selección no autoriza buscar capturas históricas alternativas.
    """
    control = solicitud.procedencia.get("control-academy")
    if control is None:
        return {}
    dato = almacen.leer_documento_indexado(control, referencias)
    control_actual.validar(dato)
    filas = {r["id"]: r for r in dato["recepciones"]}
    exigir(len(filas) == len(dato["recepciones"]), "Control Academy con identidad repetida")
    faq = _pagina(dato["faq"], referencias) if dato.get("faq") is not None else None
    salida = {}
    with closing(
        sqlite3.connect(solicitud.snapshot.ruta.resolve().as_uri() + "?mode=ro&immutable=1", uri=True)
    ) as conexion:
        for identidad in sorted(ids & filas.keys()):
            fila = filas[identidad]
            cuerpo, meta = _pagina(fila, referencias)
            ficha = lector.extraer_ficha(cuerpo, meta, url_esperada=meta["url_solicitada"])
            exigir(identidad == "claude-academy:" + ficha.id, "Recepción actual de otro programa Academy")
            programa = conexion.execute(
                "SELECT proveedor_id,url,titulo,datos FROM programas WHERE id=?", (identidad,)
            ).fetchone()
            exigir(
                programa is not None and programa[:3] == ("anthropic", ficha.url, ficha.titulo),
                "Identidad nativa Academy distinta",
            )
            if json.loads(programa[3]).get("contenido_publicado") != ficha.contenido:
                continue
            evaluacion = registro_vigencia.consultar_unidad(solicitud.snapshot.ruta, tipo="recurso", id=identidad)[
                "evaluacion"
            ]
            observaciones = evaluacion["entradas"]["observaciones"] if evaluacion is not None else []
            prueba = (ficha.url, ficha.capturado_utc, ficha.sha256_captura)
            seleccionada = next(
                (o for o in observaciones if o["id"] == fila["observacion_id"]),
                None,
            )
            if seleccionada is None or prueba not in {
                (e["url"], e["capturado_utc"], e["sha256"]) for e in seleccionada["evidencias"]
            }:
                continue
            html = cuerpo.decode("utf-8")
            idioma = _Idioma()
            idioma.feed(html)
            idioma.close()
            declarado = idioma.valores[0] if len(idioma.valores) == 1 else None
            # Es idioma declarado de la ficha, no un idioma docente inferido.
            lengua = declarado.lower().split("-")[0] if declarado else None
            lengua_curso = idioma_curso.extraer(cuerpo, ficha)
            if lengua_curso is not None:
                lengua_curso = {
                    **lengua_curso,
                    "alcance": "unidad",
                    "evidencia": _prueba(meta, lengua_curso["localizador"]),
                }
            modo = condiciones.modalidad(cuerpo, ficha)
            if modo is not None:
                modo["evidencia"] = _prueba(meta, modo["localizador"])
            salida[identidad] = TemarioAcademy(
                ficha=ficha,
                cuerpo_html=html,
                idioma=lengua,
                comprobado_el=evaluacion["resultado"]["comprobado_el"],
                inscripcion=_inscripcion(faq, ficha),
                modalidad=modo,
                formacion=_gratuidad(seleccionada, ficha, cuerpo),
                idioma_curso=lengua_curso,
            )
    return salida
