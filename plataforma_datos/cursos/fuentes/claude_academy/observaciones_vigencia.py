"""Oferta Academy declarada y contrastada, sin prometer acceso sin registro.

La declaración global de cursos gratuitos no prevalece sobre un precio contrario
o una muestra de un curso de pago. Ficha, CTA, destino, requisitos y destinatarios
conservan sus apoyos y edades; no se inventan fechas ni condiciones personales.
"""

import hashlib
import re
from pathlib import Path
from urllib.parse import urljoin

from plataforma_datos.cursos import oferta_continua
from plataforma_datos.cursos import operacion_fuente as comun
from plataforma_datos.cursos.contrato_fichas import normalizar_datos_edicion
from plataforma_datos.cursos.fallo_de_consulta import observacion_de_fallo
from plataforma_datos.cursos.fuentes.claude_academy import acceso_publico as acceso
from plataforma_datos.cursos.fuentes.claude_academy import adquisicion, lector
from plataforma_datos.cursos.fuentes.claude_academy import condiciones_publicadas as comercio
from plataforma_datos.cursos.fuentes.hp_life.recepciones import fecha_utc
from plataforma_datos.cursos.tipos_json import ObjetoJson

METODO = "academy-oferta-publicada-continua:7"
METODO_FALLO = "academy-oferta-publicada-continua:4"
MUESTRA = re.compile(
    r"^(?:This is|You are viewing) (?:a )?(?:free )?(?:preview|sample) of (?:a |the )?(?:paid )?course\b", re.I
)


def _datos(condiciones: comercio.CondicionesAcademy) -> ObjetoJson:
    literal = next(
        (
            d["literal"]
            for d in condiciones.declaraciones
            if d["campo"] == "inscripcion" and d["interpretacion"] == "cerrada"
        ),
        None,
    )
    datos = normalizar_datos_edicion(
        {"inscripcion": literal} if literal is not None and condiciones.inscripcion == "cerrada" else {}
    )
    if condiciones.inscripcion == "cerrada":
        datos["estado_inscripcion"] = "cerrada"
    return datos


def _apoyo(meta: ObjetoJson, localizador: str, alcance: str = "disponibilidad") -> ObjetoJson:
    return {
        "alcance": alcance,
        "url": meta["url_solicitada"],
        "capturado_utc": meta["recibido_utc"],
        "sha256": meta["sha256"],
        "localizador": {"tipo": "selector", "valor": localizador},
    }


def _criterio(valor: bool | None, apoyos: list[int]) -> ObjetoJson:
    return {"valor": valor, "apoyos": apoyos if valor is not None else []}


def _localizador_indice(cuerpo: bytes, meta: ObjetoJson, url: str) -> str:
    pagina, _prueba = acceso._documento(cuerpo, meta, acceso.INDICE)
    return next(
        lector._localizador(b)
        for b in pagina.bloques
        if b.tag == "a" and b.atributos.get("href") and urljoin(acceso.INDICE, b.atributos["href"]) == url
    )


def _precio_formacion(precio: str, publicada: bool, oferta_general: bool) -> bool | None:
    if precio == "pago":
        return False
    if publicada and precio != "incierto" and (precio == "gratis" or oferta_general):
        return True
    return None


def _formacion(
    ficha: lector.FichaAcademy,
    pagina: tuple[bytes, ObjetoJson],
    indice: tuple[bytes, ObjetoJson],
    portada: tuple[bytes, ObjetoJson],
    condiciones: comercio.CondicionesAcademy,
) -> tuple[ObjetoJson, list[ObjetoJson]]:
    cuerpo, meta = pagina
    publicada = ficha.url in acceso.extraer_indice(*indice).urls
    declaracion = acceso.declaracion_gratuidad(*portada) if publicada else None
    oferta_general = declaracion is not None and declaracion.texto == acceso.DECLARACION
    pruebas = [_apoyo(meta, 'link[rel="canonical"]', "identidad"), _apoyo(meta, "main")]
    gratuita = _precio_formacion(condiciones.precio, publicada, oferta_general)
    muestra = any(MUESTRA.search(b.texto) for b in ficha.bloques)
    completo = False if muestra else None
    indices_curso, indices_precio = [], []
    if muestra:
        indices_curso.append(1)
    elif publicada and condiciones.inscripcion != "incierta":
        inicio = acceso.enlace_inicio(ficha)
        temario = acceso.temario_publicado(cuerpo, meta, ficha, inicio) if inicio and not oferta_general else ()
        if temario or oferta_general:
            completo = True
            pruebas.append(_apoyo(indice[1], _localizador_indice(*indice, ficha.url)))
            indices_curso.extend((1, len(pruebas) - 1))
            for selector in temario:
                pruebas.append(_apoyo(meta, selector))
                indices_curso.append(len(pruebas) - 1)
    if declaracion is not None and (gratuita is True or (completo and oferta_general)):
        pruebas.append(_apoyo(portada[1], declaracion.localizador))
        if gratuita is True:
            indices_precio.append(len(pruebas) - 1)
        if completo and oferta_general:
            indices_curso.append(len(pruebas) - 1)
    return {
        "curso_completo": _criterio(completo, indices_curso),
        "formacion_gratuita": _criterio(gratuita, indices_precio),
    }, pruebas


def construir(original: Path, fila: ObjetoJson, auxiliares: ObjetoJson) -> tuple[lector.FichaAcademy, ObjetoJson]:
    """Construye una comprobación compuesta con cada captura y su fecha propias.

    Returns:
        Ficha actual y observación del curso completo; una condición desconocida
        impide acreditar la oferta continua sin declarar inexistente el recurso.
    """
    cuerpo, meta = comun.pagina_academy(original, fila)
    ficha = lector.extraer_ficha(cuerpo, meta, url_esperada=meta["url_solicitada"])
    condiciones = comercio.examinar(cuerpo, ficha)
    criterios, pruebas = _formacion(
        ficha,
        (cuerpo, meta),
        comun.pagina_academy(original, auxiliares["indice"]),
        comun.pagina_academy(original, auxiliares["portada"]),
        condiciones,
    )
    inicio = acceso.enlace_inicio(ficha)
    leccion = adquisicion.interpretar_leccion(original, fila, ficha)
    criterios.update(
        {
            "cta_identificado": _criterio(True if inicio is not None else None, [1]),
            "destino_identificado": _criterio(True if leccion is not None else None, []),
            "destinatarios_constatados": _criterio(True if ficha.destinatarios is not None else None, []),
            "requisitos_constatados": _criterio(True if ficha.requisitos is not None else None, []),
        }
    )
    if inicio is not None:
        pruebas.append(_apoyo(meta, inicio.localizador))
        criterios["cta_identificado"]["apoyos"] = [len(pruebas) - 1]
    if leccion is not None:
        _, leccion_meta = comun.pagina_academy(original, fila["leccion"])
        pruebas.append(_apoyo(leccion_meta, leccion["bloques"][0]["localizador"]))
        criterios["destino_identificado"]["apoyos"] = [len(pruebas) - 1]
    for nombre, bloques in (
        ("destinatarios_constatados", ficha.destinatarios),
        ("requisitos_constatados", ficha.requisitos),
    ):
        for bloque in bloques or ():
            pruebas.append(_apoyo(meta, bloque.localizador))
            criterios[nombre]["apoyos"].append(len(pruebas) - 1)
    _apoyos_comerciales(meta, condiciones, pruebas, criterios)
    capturas = [fila, auxiliares["indice"], auxiliares["portada"]]
    if isinstance(fila.get("leccion"), dict):
        capturas.append(fila["leccion"])
    return ficha, _observacion(original, ficha, capturas, pruebas, _detalle(ficha, criterios, condiciones))


def construir_fallo(original: Path, fila: ObjetoJson, url: str) -> ObjetoJson:
    """Convierte una consulta de ficha fallida en el fallo de esa unidad, sin contenido.

    Sirve para transporte sin respuesta y para respuestas que son fallo de consulta
    (5xx, bloqueos, redirecciones). No retira la oferta ni renueva su última comprobación.

    Returns:
        Observación de fallo con el intervalo real y el recibo como diagnóstico.
    """
    meta = comun.leer_recibo(original, fila)
    comun.exigir(meta["url"] == url, "Fallo Academy de otra URL")
    identidad = "\n".join((METODO_FALLO, "fallo", fila["id"], fila["recibo"]["sha256"]))
    return observacion_de_fallo(
        id=METODO_FALLO + ":fallo:" + hashlib.sha256(identidad.encode()).hexdigest(),
        intentado_el=meta["inicio_utc"],
        terminado_el=meta["fin_utc"],
        url=url,
        motivo="consulta_academy_sin_respuesta_valida",
        sha256=fila["recibo"]["sha256"],
        localizador="/http",
    )


def _apoyos_comerciales(
    meta: ObjetoJson, condiciones: comercio.CondicionesAcademy, pruebas: list[ObjetoJson], criterios: ObjetoJson
) -> None:
    for declaracion in condiciones.declaraciones:
        apoyo = _apoyo(meta, declaracion["localizador"])
        if apoyo not in pruebas:
            pruebas.append(apoyo)
        indice = pruebas.index(apoyo)
        if declaracion["campo"] == "precio" and (
            condiciones.precio in ("pago", "incierto") or criterios["formacion_gratuita"]["valor"] is True
        ):
            indices = criterios["formacion_gratuita"]["apoyos"]
            if indice not in indices:
                indices.append(indice)


def _detalle(ficha: lector.FichaAcademy, criterios: ObjetoJson, condiciones: comercio.CondicionesAcademy) -> ObjetoJson:
    return {
        "url_final": ficha.url,
        "codigo_http": 200,
        "tipo_destino": "ficha",
        "identidad_observada": "claude-academy:" + ficha.id,
        "datos_edicion": _datos(condiciones),
        "acceso_abierto": None,
        oferta_continua.CAMPO: {
            "version": 1,
            "metodo": oferta_continua.METODO,
            "curso_id": "claude-academy:" + ficha.id,
            "criterios": criterios,
        },
    }


def _observacion(
    original: Path,
    ficha: lector.FichaAcademy,
    capturas: list[ObjetoJson],
    pruebas: list[ObjetoJson],
    detalle: ObjetoJson,
) -> ObjetoJson:
    recibos = [comun.leer_recibo(original, c) for c in capturas]
    identidad = "\n".join((METODO, ficha.id, *(c["recibo"]["sha256"] for c in capturas)))
    return {
        "id": METODO + ":" + hashlib.sha256(identidad.encode()).hexdigest(),
        "tipo": "ficha",
        "intentado_el": min((r["inicio_utc"] for r in recibos), key=fecha_utc),
        "terminado_el": max((r["fin_utc"] for r in recibos), key=fecha_utc),
        "resultado": "correcta",
        "url_consultada": ficha.url,
        "detalle": detalle,
        "evidencias": pruebas,
    }
