"""Oferta de autoformación compuesta; registro, gratuidad y destinatario separados.

La interpretación de la interfaz es una inferencia revisada del código público,
no una cuenta creada, aula leída o admisión personal. El estado API no la sustituye.
"""

import hashlib
import re
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit

from plataforma_datos.cursos import oferta_continua
from plataforma_datos.cursos.contrato_fichas import normalizar_datos_edicion
from plataforma_datos.cursos.fallo_de_consulta import observacion_de_fallo
from plataforma_datos.cursos.fuentes.cibervoluntarios import adquisicion, lector, metodo_interfaz
from plataforma_datos.cursos.fuentes.hp_life.recepciones import fecha_utc
from plataforma_datos.cursos.tipos_json import ObjetoJson

DESTINATARIO_FAMILIAR = re.compile(
    r"\b(?:tus hijos|padres y madres|madres y padres|convives con menores|eres (?:padre|madre))\b", re.I
)
PRECIO_CONTRARIO = re.compile(r"\b(?:este curso|el curso|la formaci[oó]n) (?:es|ser[aá]) de pago\b", re.I)


class _Texto(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.textos: list[str] = []

    def handle_data(self, data: str) -> None:
        self.textos.append(data)


def texto_publicado(valor: object) -> str | None:
    """Obtiene solo texto del campo de negocio, sin ejecutar etiquetas o scripts.

    Returns:
        Texto publicado no vacío, o None si no existe un campo textual.
    """
    if not isinstance(valor, str):
        return None
    parser = _Texto()
    parser.feed(valor)
    parser.close()
    return " ".join(" ".join(parser.textos).split()) or None


def contexto(original: Path, auxiliares: ObjetoJson) -> ObjetoJson:
    """Verifica los cuatro apoyos una vez para toda la aplicación de fuente.

    Returns:
        Declaraciones, método y eventos propios; no usa relojes o archivos históricos.
    """
    actuales = adquisicion.interpretar_auxiliares(original, auxiliares)
    capturas = {
        k: adquisicion.pagina(original, fila)[1]
        for k, fila in actuales.items()
        if k != "alias" and not k.startswith("ruta:")
    }
    return {
        "metodo_confirmado": actuales["componente"]["lectura"]["confirmado"],
        "declaraciones": actuales["declaraciones"]["lectura"]["declaraciones"],
        "capturas": capturas,
        "rutas": {
            k: {"lectura": fila["lectura"], "captura": adquisicion.comun.leer_recibo(original, fila)}
            for k, fila in actuales.items()
            if k.startswith("ruta:") and fila["lectura"] is not None
        },
        "alias": (
            {
                "vinculado": actuales["alias"]["lectura"]["vinculado"],
                "captura": adquisicion.comun.leer_recibo(original, actuales["alias"]),
            }
            if "alias" in actuales
            else None
        ),
    }


def _apoyo(meta: ObjetoJson, localizador: str, *, alcance: str = "disponibilidad") -> ObjetoJson:
    return {
        "alcance": alcance,
        "url": meta["url"],
        "capturado_utc": meta["fin_utc"],
        "sha256": meta["cuerpo_sha256"],
        "localizador": {"tipo": "campo", "valor": localizador},
    }


def condiciones(material: lector.MaterialCiber, ctx: ObjetoJson) -> ObjetoJson:
    """Separa las declaraciones generales de los atributos nativos del material.

    Returns:
        Condiciones actuales reextraíbles, sin precios de certificado/prácticas ni requisitos inventados.
    """
    if ctx["metodo_confirmado"] is not True:
        return {}
    salida = {}
    for nombre, clave, valor in (
        ("registro", "inscripcion", {"registro_previo_para_inscribirse": True}),
        ("formacion", "formacion", {"valor": "gratis_formacion"}),
    ):
        declaracion = ctx["declaraciones"][nombre]
        if declaracion is not None:
            salida[clave] = {
                **valor,
                "alcance": "declaracion_general",
                "evidencia": _apoyo(ctx["capturas"]["declaraciones"], declaracion["localizador"]),
            }
    if material.idioma_publicado == "Español":
        cap = material.captura
        salida["idioma"] = {
            "valor": [material.idioma_publicado],
            "alcance": "unidad",
            "evidencia": _apoyo(
                {"url": cap.url, "fin_utc": cap.recibido_utc, "cuerpo_sha256": cap.sha256},
                material.localizador + "/lang",
            ),
        }
    if material.tipo_material == "Autoformación":
        salida["modalidad"] = {
            "valor": "en-linea",
            "alcance": "unidad",
            "evidencia": _apoyo(ctx["capturas"]["componente"], "metodo:" + metodo_interfaz.METODO),
        }
    return salida


def _criterio(valor: bool | None, apoyos: list[int]) -> ObjetoJson:
    return {"valor": valor, "apoyos": apoyos if valor is not None else []}


def _destino_publicado(material: lector.MaterialCiber) -> bool:
    valor = material.material_publicado.get("moodleLink")
    if not isinstance(valor, str):
        return False
    partes = urlsplit(valor)
    return (
        partes.scheme == "https"
        and partes.netloc == "e-learning.cibervoluntarios.org"
        and partes.path == "/course/view.php"
        and re.fullmatch(r"id=[1-9][0-9]*", partes.query) is not None
        and (not partes.fragment or re.fullmatch(r"section-[0-9]+", partes.fragment) is not None)
    )


def construir(material: lector.MaterialCiber, *, programa: ObjetoJson, ctx: ObjetoJson) -> ObjetoJson:
    """Construye criterios de la misma identidad; las familias quedan fuera del ámbito.

    Returns:
        Observación de oferta publicada, con cada apoyo y su fecha causal propia.
    """
    cap = material.captura
    api = {"url": cap.url, "fin_utc": cap.recibido_utc, "cuerpo_sha256": cap.sha256}
    prefijo = material.localizador
    pruebas = [_apoyo(api, prefijo + "/id", alcance="identidad"), _apoyo(api, prefijo)]
    for nombre, meta in ctx["capturas"].items():
        localizador = ctx["localizador_ruta"] if nombre == "ruta" else "metodo:" + metodo_interfaz.METODO + ":" + nombre
        pruebas.append(_apoyo(meta, localizador))
    apoyos_metodo = list(range(2, len(pruebas)))
    declaraciones = ctx["declaraciones"]
    metodo = ctx["metodo_confirmado"] is True
    publicado = material.material_publicado
    activo = material.disponible
    completo = material.tipo_material == "Autoformación" and bool(texto_publicado(publicado.get("aprenderContent")))
    destinatario = texto_publicado(publicado.get("paraTiContent"))
    familiar = destinatario is not None and DESTINATARIO_FAMILIAR.search(destinatario) is not None
    precio_contrario = any(
        PRECIO_CONTRARIO.search(texto_publicado(publicado.get(k)) or "")
        for k in ("description", "descriptionContent", "paraTiContent", "aprenderContent")
    )
    criterios = {
        "curso_completo": _criterio(True if metodo and activo and completo else None, [1, *apoyos_metodo]),
        "formacion_gratuita": _criterio(False if precio_contrario else None, [1]),
        "cta_identificado": _criterio(True if metodo and activo else None, apoyos_metodo),
        "destino_identificado": _criterio(
            True if metodo and _destino_publicado(material) else None, [1, *apoyos_metodo]
        ),
        "destinatarios_constatados": _criterio(False if familiar else True if destinatario else None, [1]),
        "requisitos_constatados": _criterio(None, []),
    }
    for nombre, criterio in (("formacion", "formacion_gratuita"), ("requisitos", "requisitos_constatados")):
        declaracion = declaraciones[nombre]
        if metodo and declaracion is not None and not (nombre == "formacion" and precio_contrario):
            pruebas.append(_apoyo(ctx["capturas"]["declaraciones"], declaracion["localizador"]))
            criterios[criterio] = _criterio(True, [len(pruebas) - 1])
    return _observacion(material, programa, ctx, pruebas, criterios)


def _observacion(
    material: lector.MaterialCiber,
    programa: ObjetoJson,
    ctx: ObjetoJson,
    pruebas: list[ObjetoJson],
    criterios: ObjetoJson,
) -> ObjetoJson:
    usados = {0, 1} | {i for criterio in criterios.values() for i in criterio["apoyos"]}
    mapa = {viejo: nuevo for nuevo, viejo in enumerate(sorted(usados))}
    pruebas = [pruebas[i] for i in sorted(usados)]
    criterios = {k: {**v, "apoyos": [mapa[i] for i in v["apoyos"]]} for k, v in criterios.items()}
    cap = material.captura
    fechas = [{"inicio_utc": cap.inicio_utc, "fin_utc": cap.recibido_utc}, *ctx["capturas"].values()]
    # Una segunda interpretación del mismo cuerpo no sobrescribe la observación
    # inmutable que el lector anterior registró al desconocer esta interfaz.
    revision = metodo_interfaz.METODO
    if ctx["metodo_confirmado"] and ctx["capturas"]["componente"]["cuerpo_sha256"] != metodo_interfaz.COMPONENTE_SHA256:
        revision = "ciber-oferta-autoformacion-publicada:2"
    identidad = "\n".join(
        (
            revision,
            programa["id"],
            cap.sha256,
            cap.recibido_utc,
            *(m["cuerpo_sha256"] + m["fin_utc"] for m in ctx["capturas"].values()),
        )
    )
    return {
        "id": revision + ":" + hashlib.sha256(identidad.encode()).hexdigest(),
        "tipo": "ficha",
        "resultado": "correcta",
        "url_consultada": cap.url,
        "intentado_el": min((f["inicio_utc"] for f in fechas), key=fecha_utc),
        "terminado_el": max((f["fin_utc"] for f in fechas), key=fecha_utc),
        "detalle": {
            "url_final": cap.url,
            "codigo_http": cap.http,
            "tipo_destino": "ficha",
            "identidad_observada": programa["id"],
            "datos_edicion": normalizar_datos_edicion({}),
            "acceso_abierto": None,
            oferta_continua.CAMPO: {
                "version": 1,
                "metodo": oferta_continua.METODO,
                "curso_id": programa["id"],
                "criterios": criterios,
            },
        },
        "evidencias": pruebas,
    }


METODO_FALLO = "cibervoluntarios-pagina-fallida-v1"


def fallo_solo_de_interfaz(
    material: lector.MaterialCiber, obs: ObjetoJson, ctx: ObjetoJson, recibo: str
) -> ObjetoJson | None:
    """Distingue un visor desconocido de un cambio en la oferta.

    Returns:
        El intento fallido cuando el resto de la evidencia permite conservar la comprobación anterior.
    """
    criterios = obs["detalle"][oferta_continua.CAMPO]["criterios"]
    if (
        ctx["metodo_confirmado"]
        or not material.disponible
        or material.tipo_material != "Autoformación"
        or not texto_publicado(material.material_publicado.get("aprenderContent"))
        or not _destino_publicado(material)
        or criterios["destinatarios_constatados"]["valor"] is not True
        or criterios["formacion_gratuita"]["valor"] is False
        or not all(ctx["declaraciones"].get(k) for k in ("formacion", "requisitos", "registro"))
    ):
        return None
    meta = ctx["capturas"]["componente"]
    return observacion_de_fallo(
        id="ciber-interfaz-no-reconocida:" + obs["id"].rsplit(":", 1)[1],
        intentado_el=meta["inicio_utc"],
        terminado_el=meta["fin_utc"],
        url=meta["url"],
        motivo="interfaz_de_inscripcion_no_reconocida",
        sha256=recibo,
        localizador="/http",
    )


def construir_observacion_fallo(intento: ObjetoJson, intento_sha256: str, *, oferta: ObjetoJson) -> ObjetoJson:
    """Convierte el intento de una página caída del censo en un fallo de consulta de la unidad.

    La unidad conocida que no aparece en las páginas leídas pudo estar en la caída: el
    fallo solo informa del intento. No aporta cuerpo, no retira la oferta y no renueva
    su última comprobación válida. La evidencia es el recibo del propio intento.

    Returns:
        Entrada del evaluador común con el intervalo real del intento.
    """
    adquisicion.comun.exigir(
        oferta.get("fuente_id") == lector.FUENTE and intento["url"].startswith(adquisicion.API + "?"),
        "Intento ajeno al censo Ciber o a su fuente",
    )
    identidad = "\n".join((METODO_FALLO, oferta["id"], intento_sha256))
    return observacion_de_fallo(
        id=METODO_FALLO + ":" + hashlib.sha256(identidad.encode()).hexdigest(),
        intentado_el=intento["inicio_utc"],
        terminado_el=intento["fin_utc"],
        url=intento["url"],
        motivo="pagina_del_censo_sin_respuesta_valida",
        sha256=intento_sha256,
        localizador="/error" if intento.get("error") else "/http",
    )
