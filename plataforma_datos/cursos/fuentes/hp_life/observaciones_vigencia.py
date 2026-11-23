"""Observaciones del recurso HP, sin edición ficticia ni acceso individual afirmado.

El acceso se interpreta con una regla versionada del JavaScript público oficial.
No es un botón observado ya renderizado. Su contrato conserva URL y SHA del código
revisado; FAQ y sus declaraciones generales no se injertan en esta captura.
"""

import hashlib
import json
from copy import deepcopy
from html.parser import HTMLParser
from http import HTTPStatus
from urllib.parse import urljoin

from plataforma_datos.cursos import retirada_proveedor
from plataforma_datos.cursos.contrato_fichas import normalizar_datos_edicion
from plataforma_datos.cursos.fallo_de_consulta import observacion_de_fallo
from plataforma_datos.cursos.fuentes.hp_life import indice, lector
from plataforma_datos.cursos.fuentes.hp_life.recepciones import RecepcionHpLife, fecha_utc, leer_recepcion
from plataforma_datos.cursos.tipos_json import ObjetoJson

METODO = "hp-life:inscripcion-publica-inferida-js:1"
LOCALIZADOR = "/props/pageProps/initialCourseData"
SOPORTES_METODO = (
    (
        "https://www.life-global.org/_next/static/chunks/pages/course/%5Bslug%5D-314db3a8a9fd4aee.js",
        "9bfd083d32ee1e095759e40496585cd2a3b7ced16238df839944606619392f34",
    ),
    (
        "https://www.life-global.org/_next/static/chunks/pages/_app-52049ba10e75b4de.js",
        "623ae773889dfa98578f4db2394423f592d8c25b002b96cd9a3fb2540d921f7a",
    ),
)


class _Scripts(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.urls: set[str] = set()

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "script" and (src := dict(attrs).get("src")):
            self.urls.add(urljoin("https://www.life-global.org", src))


def _metodo_presente(recepcion: RecepcionHpLife) -> bool:
    parser = _Scripts()
    parser.feed(recepcion.cuerpo.decode("utf-8"))
    parser.close()
    return all(url in parser.urls for url, _sha in SOPORTES_METODO)


def _base(recepcion: RecepcionHpLife, oferta: ObjetoJson) -> ObjetoJson:
    cap = recepcion.captura
    identidad = "\n".join((METODO, oferta["id"], cap.sha256_cuerpo, recepcion.sha256_recibo))
    return {
        "id": "hp-life-observacion-v1:" + hashlib.sha256(identidad.encode()).hexdigest(),
        "tipo": "ficha",
        "intentado_el": recepcion.inicio_utc,
        "terminado_el": cap.recibido_utc,
        "resultado": "correcta",
        "url_consultada": cap.url_solicitada,
        "detalle": {
            "url_final": cap.url_final,
            "codigo_http": cap.http,
            "tipo_destino": "desconocido",
            "identidad_observada": None,
            "datos_edicion": None,
            "acceso_abierto": None,
        },
        "evidencias": [
            {
                "alcance": "diagnostico",
                "url": cap.url_solicitada,
                "capturado_utc": cap.recibido_utc,
                "sha256": recepcion.sha256_recibo,
                "localizador": {"tipo": "campo", "valor": "/captura/http"},
            }
        ],
    }


def _apertura_interpretada(ficha: lector.FichaHpLife) -> bool:
    return (
        ficha.tipo == "SelfPaced"
        and ficha.privacidad == "Public"
        and ficha.estado == "Published"
        and ficha.requiere_grupo is False
        and ficha.requiere_licencia is False
        and ficha.producto_id in (None, "")
        and ficha.numero_localizaciones_externas == 0
        and ficha.inicio_publicado is None
        and ficha.fin_publicado is None
    )


def construir_observacion_fallo(intento: bytes, *, oferta: ObjetoJson) -> ObjetoJson:
    """Convierte un intento sin respuesta en un fallo de consulta de esa unidad.

    El fallo solo informa del intento: no aporta cuerpo, no retira la oferta y no
    renueva su última comprobación válida. La evidencia es el propio intento conservado.

    Returns:
        Entrada del evaluador común con el intervalo real del intento.

    Raises:
        ErrorFichaHpLife: Si el intento no pertenece a la unidad o declara una respuesta.
    """
    try:
        dato = json.loads(intento)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise lector.ErrorFichaHpLife("Intento HP ilegible") from error
    if (
        not isinstance(dato, dict)
        or dato.get("schema_version") != 1
        or dato.get("resultado") != "fallo"
        or oferta.get("fuente_id") != "hp_life"
        or dato.get("id") != oferta.get("id")
        or dato.get("url") != oferta.get("url")
    ):
        raise lector.ErrorFichaHpLife("Intento ajeno a la unidad o con respuesta")
    sha = hashlib.sha256(intento).hexdigest()
    identidad = "\n".join((METODO, oferta["id"], sha))
    return observacion_de_fallo(
        id="hp-life-intento-fallido-v1:" + hashlib.sha256(identidad.encode()).hexdigest(),
        intentado_el=dato["inicio_utc"],
        terminado_el=dato["fin_utc"],
        url=dato["url"],
        motivo="consulta_hp_sin_respuesta",
        sha256=sha,
        localizador="/error",
    )


def construir_observacion(recepcion: RecepcionHpLife, *, oferta: ObjetoJson) -> ObjetoJson:
    """Interpreta únicamente la recepción real del mismo recurso y conserva los fallos.

    Returns:
        Entrada del evaluador común; no evalúa, escribe, admite o publica.

    Raises:
        ErrorFichaHpLife: Si la solicitud no pertenece al recurso o el cuerpo contradice su identidad.
    """
    if type(recepcion) is not RecepcionHpLife or leer_recepcion(recepcion.cuerpo, recepcion.recibo) != recepcion:
        raise lector.ErrorFichaHpLife("La recepción no coincide con sus metadatos originales")
    cap = recepcion.captura
    if oferta.get("fuente_id") != "hp_life" or oferta.get("url") != cap.url_solicitada:
        raise lector.ErrorFichaHpLife("Recepción ajena a la URL o fuente de la oferta")
    observacion = _base(recepcion, oferta)
    if cap.http == HTTPStatus.PARTIAL_CONTENT or cap.completo is not True:
        observacion.update(resultado="fallo", detalle={"motivo": "lectura_hp_incompleta"})
        return observacion
    if cap.http != HTTPStatus.OK:
        return observacion
    if recepcion.content_type.split(";", 1)[0].strip().lower() != "text/html":
        observacion.update(resultado="fallo", detalle={"motivo": "respuesta_hp_no_html"})
        return observacion
    # La ruta final genérica no permite atribuir contenido de otra página a este curso.
    try:
        ficha = lector.extraer_ficha(recepcion.cuerpo, cap)
    except lector.ErrorFichaHpLife as error:
        observacion.update(resultado="fallo", detalle={"motivo": "ficha_hp_no_contrastable: " + str(error)})
        return observacion
    if ficha.id != oferta["id"]:
        raise lector.ErrorFichaHpLife("La identidad nativa de la ficha no corresponde a la unidad")
    soporte = {
        "url": cap.url_final,
        "capturado_utc": cap.recibido_utc,
        "sha256": cap.sha256_cuerpo,
        "localizador": {"tipo": "campo", "valor": LOCALIZADOR},
    }
    datos = normalizar_datos_edicion({"estado": "archivado"} if ficha.estado == "Archived" else {})
    observacion["detalle"].update(
        tipo_destino="ficha",
        identidad_observada=ficha.id,
        datos_edicion=datos,
        acceso_abierto=True if _metodo_presente(recepcion) and _apertura_interpretada(ficha) else None,
    )
    observacion["evidencias"].extend(
        [
            {
                "alcance": "identidad",
                **deepcopy(soporte),
                "localizador": {"tipo": "campo", "valor": LOCALIZADOR + "/id"},
            },
            {"alcance": "disponibilidad", **soporte},
        ]
    )
    return observacion


def construir_observacion_retirada(paginas: list[tuple[int, RecepcionHpLife]], *, oferta: ObjetoJson) -> ObjetoJson:
    """Observa que la lectura completa del listado público ya no incluye la oferta.

    Solo la emite quien haya comprobado el censo completo y la ficha que lo corrobora (`bajas.decidir`). Cada
    página del listado es una evidencia con su huella y su hora, localizada por su número de página.

    Returns:
        Entrada de catálogo del evaluador común, con la lectura completa y la presencia en falso.

    Raises:
        ErrorFichaHpLife: Si no hay páginas o alguna no corresponde al listado público.
    """
    if not paginas or oferta.get("fuente_id") != "hp_life":
        raise lector.ErrorFichaHpLife("La retirada exige las páginas del listado y una oferta de HP LIFE")
    for numero, recepcion in paginas:
        if numero != indice.numero_de_pagina(recepcion.captura.url_solicitada):
            raise lector.ErrorFichaHpLife("Página del listado distinta de la declarada")
    inicio = min((r.inicio_utc for _n, r in paginas), key=fecha_utc)
    fin = max((r.captura.recibido_utc for _n, r in paginas), key=fecha_utc)
    identidad = "\n".join(
        (retirada_proveedor.METODO, oferta["id"], *(r.captura.sha256_cuerpo + r.sha256_recibo for _n, r in paginas))
    )
    return {
        "id": "hp-life-retirada-v1:" + hashlib.sha256(identidad.encode()).hexdigest(),
        "tipo": "catalogo",
        "intentado_el": inicio,
        "terminado_el": fin,
        "resultado": "correcta",
        "url_consultada": indice.INDICE,
        "detalle": {
            "url_final": indice.INDICE,
            "codigo_http": int(HTTPStatus.OK),
            "tipo_destino": "catalogo",
            "identidad_buscada": oferta["id"],
            "lectura_completa": True,
            "presente": False,
        },
        "evidencias": [
            {
                "alcance": "catalogo",
                "url": indice.INDICE,
                "capturado_utc": r.captura.recibido_utc,
                "sha256": r.captura.sha256_cuerpo,
                "localizador": {"tipo": "pagina", "valor": f"page={n}"},
            }
            for n, r in sorted(paginas, key=lambda p: p[0])
        ],
    }
