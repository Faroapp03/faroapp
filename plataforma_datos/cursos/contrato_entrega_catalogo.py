"""Contrato público cerrado del catálogo; no contiene originales ni una regla de oferta."""

import math
import re
from datetime import date, datetime, time, timedelta
from urllib.parse import parse_qs, urlsplit

from plataforma_datos.comun.huella_json import sha256_json
from plataforma_datos.cursos import calendario_entrega, catalogo, contrato_fichas, vigencia
from plataforma_datos.cursos.clasificacion.contrato import validar_bloque
from plataforma_datos.cursos.exigencias_entrega_catalogo import (
    ErrorEntregaCatalogo,
    exigir,
    exigir_campos,
    exigir_texto,
    exigir_url,
)
from plataforma_datos.cursos.fuentes.fundae import hechos as hechos_fundae
from plataforma_datos.cursos.hechos_entrega_catalogo import ALCANCES, CAMPOS_HECHOS, CAMPOS_SIN_PROYECCION, MOTIVOS
from plataforma_datos.cursos.materia_sugerencias_cibernarium import TEMAS_VALIDOS
from plataforma_datos.cursos.referencias_entrega_catalogo import NATURALEZAS_DOCUMENTO, NATURALEZAS_FECHA
from plataforma_datos.cursos.tipos_json import ValorJson

# El productor emite la 7, que añade a la 6 el bloque opcional `clasificacion`. La 6 es su base: una entrega 7 sin
# ningún bloque admite las mismas ofertas, y la 6 se sigue leyendo porque es la que está publicada. La 6 trajo la
# preinscripción de FUNDAE y las evidencias sueltas de idioma, nivel y temas de cada fuente.
VERSION = 7
VERSION_BASE = 6
VERSION_CON_MATERIA = 5
VERSION_ANTERIOR = 4
MAX_FILAS = 100_000
MAX_IDIOMAS = 50
CAMPOS_COLECCIONES = {
    "proveedores": ("id", "nombre"),
    "ofertas": (
        "unidad",
        "proveedor_id",
        "titulo_programa",
        "tipo_unidad",
        "url",
        "hechos",
        "referencias",
        "comprobado_el",
        "cierra_el",
        "incidencia_enlace_el",
        "corte_evaluacion_utc",
    ),
}
# El lector web solo admite estos alcances en un campo sin proyección (como el esquema público).
ALCANCES_SIN_PROYECCION = ("unidad", "edicion")
DERECHOS = {"alcance": "indices_y_hechos_estructurados", "licencia_contenidos": None, "redistribuye_contenidos": False}


def _fecha(valor: ValorJson) -> None:
    if valor is not None:
        vigencia.instante_utc(valor, "fecha conservada de evaluación")


def _hecho(campo: str, hecho: ValorJson) -> None:
    campos = ("valor", "motivo", "unidad", "moneda", "alcance")
    exigir_campos(hecho, (*campos, "vigencia") if isinstance(hecho, dict) and "vigencia" in hecho else campos, "hecho")
    if "vigencia" in hecho:
        temporal = hecho["vigencia"]
        exigir_campos(temporal, ("comprobado_el",), "vigencia de hecho")
        exigir(hecho["valor"] is not None, "Vigencia de hecho desconocido")
        vigencia.instante_utc(temporal["comprobado_el"], "vigencia de hecho")
    if campo in calendario_entrega.CAMPOS_CALENDARIO:
        exigir(hecho["alcance"] in ("unidad", "edicion"), "Ámbito de calendario no admitido")
    valor = hecho["valor"]
    exigir(hecho["motivo"] in MOTIVOS and hecho["alcance"] in ALCANCES, "Motivo o alcance desconocido")
    exigir((valor is not None) == (hecho["motivo"] == "conocido"), "Valor y desconocido incompatibles")
    exigir(hecho["unidad"] == ("h" if campo == "horas_publicadas" else None), "Unidad no admitida")
    _moneda(campo, hecho["moneda"])
    if valor is not None:
        if campo in calendario_entrega.CAMPOS_CALENDARIO:
            exigir(hecho["alcance"] == "edicion" and "vigencia" in hecho, "Calendario sin edición o plazo propio")
        _valor_hecho(campo, valor)


def _moneda(campo: str, moneda: ValorJson) -> None:
    monetario = campo in ("coste_formacion", "coste_certificado", "coste_practicas")
    exigir(
        moneda is None or monetario and isinstance(moneda, str) and re.fullmatch("[A-Z]{3}", moneda), "Moneda inválida"
    )


def _valor_hecho(campo: str, valor: ValorJson) -> None:
    vocabularios = {
        "modalidad": contrato_fichas.MODALIDADES,
        "sincronia": contrato_fichas.SINCRONIAS,
        "coste_formacion_tipo": contrato_fichas.COSTES,
    }
    if campo in calendario_entrega.CAMPOS_CALENDARIO:
        try:
            calendario_entrega.validar_valor(valor, campo)
        except calendario_entrega.ErrorCalendarioEntrega as error:
            raise ErrorEntregaCatalogo(str(error)) from error
    elif campo in vocabularios:
        exigir(isinstance(valor, str) and valor in vocabularios[campo], "Vocabulario no admitido")
    elif campo.startswith("idiomas_"):
        exigir(isinstance(valor, list) and 0 < len(valor) <= MAX_IDIOMAS, "Lista de idiomas inválida")
        for idioma in valor:
            exigir_texto(idioma)
        exigir(valor == sorted(set(valor)), "Idiomas sin orden canónico o repetidos")
    elif campo in ("certificado_gratuito", "requiere_registro_previo"):
        exigir(type(valor) is bool, "Se exige declaración booleana")
    elif campo == "requisitos_publicados":
        exigir(False, "La prosa de requisitos no forma parte de esta entrega")
    else:
        exigir(type(valor) in (int, float) and math.isfinite(valor) and valor >= 0, "Cantidad no válida")


def _hechos(hechos: ValorJson) -> None:
    exigir_campos(hechos, CAMPOS_HECHOS, "hechos")
    for campo in CAMPOS_HECHOS:
        _hecho(campo, hechos[campo])
        if campo in CAMPOS_SIN_PROYECCION:
            exigir(
                hechos[campo]["valor"] is None
                and hechos[campo]["motivo"] == "sin_soporte_de_campo"
                and hechos[campo]["alcance"] in ALCANCES_SIN_PROYECCION,
                "Campo sin proyección acreditada",
            )


def _referencias(referencias: ValorJson) -> None:
    exigir(isinstance(referencias, list) and len(referencias) <= MAX_FILAS, "Referencias inválidas")
    for referencia in referencias:
        exigir_campos(
            referencia,
            ("url", "fecha_referencia", "sha256", "alcance", "naturaleza_fecha", "naturaleza_documento"),
            "referencia",
        )
        exigir_url(referencia["url"], "referencia pública")
        _fecha(referencia["fecha_referencia"])
        exigir(referencia["fecha_referencia"] is not None, "Referencia sin fecha")
        catalogo.exigir_sha256(referencia["sha256"], "referencia")
        exigir(referencia["alcance"] == "entidad", "No se acredita un campo por proximidad")
        exigir(referencia["naturaleza_fecha"] in NATURALEZAS_FECHA, "Naturaleza temporal no admitida")
        exigir(referencia["naturaleza_documento"] in NATURALEZAS_DOCUMENTO, "Naturaleza documental no admitida")


def _evidencia_materia(fila: ValorJson, corte: str) -> None:
    evidencia = fila["evidencia_materia"]
    if evidencia is None:
        return
    exigir_campos(
        evidencia,
        ("version", "actividad_id", "programa_id", "edicion_id", "vinculo", "contenido", "censo_ia", "estado_censo"),
        "evidencia de materia",
    )
    unidad = fila["unidad"]
    exigir(type(evidencia["version"]) is int and evidencia["version"] == 1, "Versión de evidencia inválida")
    for campo in ("actividad_id", "programa_id", "edicion_id"):
        exigir_texto(evidencia[campo])
    exigir(
        fila["proveedor_id"] == "cibernarium"
        and unidad["tipo"] == "edicion"
        and unidad["id"].startswith("cibernarium-edicion:")
        and unidad["programa_id"].startswith("cibernarium:")
        and evidencia["edicion_id"] == unidad["id"]
        and evidencia["programa_id"] == unidad["programa_id"],
        "Evidencia de materia de otra oferta",
    )
    exigir(evidencia["estado_censo"] in ("completo", "parcial", "sin-evidencia"), "Estado de censo inválido")
    exigir(
        evidencia["estado_censo"] != "sin-evidencia" or evidencia["censo_ia"] is None,
        "Censo sin evidencia contradictorio",
    )
    for nombre, adicionales in (
        ("vinculo", ()),
        ("contenido", ("metodo", "sha256_captura")),
        ("censo_ia", ("ambito",)),
    ):
        pieza = evidencia[nombre]
        if pieza is None and nombre != "vinculo":
            continue
        sugerencias = (
            nombre == "contenido"
            and isinstance(pieza, dict)
            and ("temas_sugeridos" in pieza or "reglas_sha256" in pieza)
        )
        extras = ("temas_sugeridos", "reglas_sha256") if sugerencias else ()
        nivel = nombre == "contenido" and isinstance(pieza, dict) and "nivel_sugerido" in pieza
        if nivel:
            extras = (*extras, "nivel_sugerido")
            candidato = pieza["nivel_sugerido"]
            exigir_campos(candidato, ("valor", "origen", "regla"), "nivel sugerido")
            exigir(
                candidato["valor"] in ("inicial", "intermedio", "avanzado")
                and candidato["origen"] in ("categoria", "descripcion")
                and candidato["regla"] in ("nivel-cibernarium-v1", "nivel-cibernarium-v2", "nivel-cibernarium-v3")
                and (candidato["valor"] != "intermedio" or candidato["regla"] == "nivel-cibernarium-v3"),
                "Nivel sugerido incompatible",
            )
        exigir_campos(pieza, ("url", "sha256", "capturado_utc", "localizador", *adicionales, *extras), nombre)
        if sugerencias:
            temas = pieza["temas_sugeridos"]
            exigir(isinstance(temas, list) and bool(temas), "Sugerencias vacías o incompatibles")
            exigir(all(isinstance(t, str) and t in TEMAS_VALIDOS for t in temas), "Tema sugerido incompatible")
            exigir(len(set(temas)) == len(temas), "Tema sugerido repetido")
            catalogo.exigir_sha256(pieza["reglas_sha256"], "reglas de materia")
        exigir_url(pieza["url"], nombre)
        # Este método cita fuentes por dominio; no necesita una política duplicada de redes IP en la web.
        host = urlsplit(pieza["url"]).hostname
        exigir(
            host is not None and re.fullmatch(r"[A-Za-z][A-Za-z0-9-]*", host.rsplit(".", 1)[-1]) is not None,
            "Evidencia de materia sin dominio público",
        )
        catalogo.exigir_sha256(pieza["sha256"], nombre)
        exigir_texto(pieza["localizador"])
        exigir(
            vigencia.instante_utc(pieza["capturado_utc"], nombre) <= vigencia.instante_utc(corte, "corte"),
            "Evidencia posterior a la proyección",
        )
        if nombre == "contenido":
            exigir(pieza["metodo"] == "cibernarium-descripcion-api-v1", "Método de contenido desconocido")
            catalogo.exigir_sha256(pieza["sha256_captura"], "captura de contenido")
        if nombre == "censo_ia":
            exigir(pieza["ambito"] == "ia", "Ámbito de censo desconocido")


def _preinscripcion(fila: ValorJson, corte: str) -> None:
    datos = fila["preinscripcion"]
    exigir_campos(datos, ("centro", "inicio", "fin", "colectivos", "sector"), "preinscripción")
    unidad = fila["unidad"]
    codigo = re.fullmatch(r"fundae:oferta:programa:([A-Z0-9_-]{1,40})", unidad["programa_id"])
    exigir(
        unidad["tipo"] == "edicion"
        and re.fullmatch(r"fundae:edicion:[1-9][0-9]*", unidad["id"])
        and codigo is not None
        and fila["proveedor_id"] == "fundae:publicador:catalogo:3"
        and fila["url"] == "https://experienciafundae.es/ficha-curso/oferta/2/" + codigo[1],
        "Ficha pública de otra convocatoria",
    )
    for campo in ("centro", "sector"):
        exigir_texto(datos[campo])
        exigir(datos[campo].strip(), "Centro o sector vacío en la preinscripción")
        exigir(not hechos_fundae.CONTACTO.search(datos[campo]), "Contacto individual en la ficha pública")
    grupos = datos["colectivos"]
    permitidos = {nombre for nombre, _ in hechos_fundae.COLECTIVOS.values()}
    exigir(
        isinstance(grupos, list)
        and grupos
        and all(isinstance(g, str) and g in permitidos for g in grupos)
        and len(set(grupos)) == len(grupos),
        "Colectivos de la edición no reconocidos",
    )
    for extremo in ("inicio", "fin"):
        exigir(
            isinstance(datos[extremo], str) and re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", datos[extremo]),
            "Día de preinscripción no identificado",
        )
    inicio, fin = date.fromisoformat(datos["inicio"]), date.fromisoformat(datos["fin"])
    fecha_corte = vigencia.instante_utc(corte, "corte").astimezone(hechos_fundae.ZONA).date()
    exigir(inicio <= fecha_corte <= fin < date.max, "Plazo de solicitud fuera del corte")
    ultimo = datetime.combine(fin + timedelta(days=1), time(), hechos_fundae.ZONA)
    exigir(
        fila["cierra_el"] is not None and vigencia.instante_utc(fila["cierra_el"], "fin") <= ultimo,
        "La oferta excede el plazo de solicitud",
    )


def _nivel_actividad(fila: dict, corte: str) -> None:
    unidad = fila["unidad"]
    nivel = fila["nivel_actividad"]
    exigir_campos(
        nivel,
        ("valor", "literal", "actividad_id", "material_id", "url", "sha256", "capturado_utc", "localizador"),
        "nivel de actividad",
    )
    for clave in ("valor", "literal", "actividad_id", "material_id", "url", "localizador"):
        exigir_texto(nivel[clave])
    catalogo.exigir_sha256(nivel["sha256"], "huella del nivel")
    exigir(
        {"Básico": "inicial", "Intermedio": "intermedio", "Avanzado": "avanzado"}.get(nivel["literal"])
        == nivel["valor"],
        "Nivel no reconocido",
    )
    exigir(
        unidad["id"] == "cibervoluntarios:material:" + nivel["material_id"]
        and unidad["programa_id"] == unidad["id"]
        and nivel["actividad_id"].isdigit(),
        "Nivel de otro material",
    )
    u = urlsplit(nivel["url"])
    exigir(
        u.scheme == "https" and u.netloc == "www.cibervoluntarios.org" and u.path == "/api/public/activity_catalogs",
        "Nivel de otra fuente",
    )
    exigir(
        nivel["localizador"].endswith("/level")
        and vigencia.instante_utc(nivel["capturado_utc"], "nivel") <= vigencia.instante_utc(corte, "corte"),
        "Nivel sin localizador o posterior al corte",
    )
    exigir(
        any(
            r["url"] == nivel["url"]
            and r["sha256"] == nivel["sha256"]
            and r["fecha_referencia"] == nivel["capturado_utc"]
            for r in fila["referencias"]
        ),
        "Nivel sin referencia",
    )


def _idioma_del_programa(fila: dict) -> None:
    unidad = fila["unidad"]
    dato = fila["idioma_programa"]
    exigir_campos(dato, ("valores", "url", "sha256"), "idioma del programa")
    exigir(dato["valores"] == ["es"], "Idioma programático no admitido")
    codigo = unidad["programa_id"].removeprefix("fundae:oferta:programa:")
    u = urlsplit(dato["url"])
    exigir(
        u.scheme == "https"
        and u.netloc == "agora.fundae.es"
        and u.path == "/Oferta/RecuperarDifusionesRFO"
        and parse_qs(u.query).get("codigoTitulacion") == [codigo],
        "Idioma programático de otro programa",
    )
    exigir(
        any(r["url"] == dato["url"] and r["sha256"] == dato["sha256"] for r in fila["referencias"]),
        "Idioma programático sin referencia",
    )


def _campos_de_oferta(fila: ValorJson, corte: str, version: int) -> None:  # noqa: C901, PLR0912, PLR0915
    campos = CAMPOS_COLECCIONES["ofertas"]
    if version >= VERSION_CON_MATERIA:
        campos = (*campos, "evidencia_materia")
    exigir(isinstance(fila, dict) and isinstance(fila.get("unidad"), dict), "Oferta sin unidad")
    unidad = fila["unidad"]
    exigir_campos(unidad, ("tipo", "id", "programa_id"), "unidad evaluada")
    for campo in ("id", "programa_id"):
        exigir_texto(unidad[campo])
    es_difusion = unidad["id"].startswith("fundae:edicion:") or (
        unidad["tipo"] == "edicion"
        and (
            fila.get("proveedor_id") == "fundae:publicador:catalogo:3"
            or unidad["programa_id"].startswith("fundae:oferta:programa:")
        )
    )
    if version >= VERSION_BASE and es_difusion:
        campos = (*campos, "preinscripcion")
    if "clasificacion" in fila:
        exigir(version >= VERSION, "Clasificación fuera de versión admitida")
        campos = (*campos, "clasificacion")
        validar_bloque(fila["clasificacion"], corte)
    if "nivel_actividad" in fila:
        exigir(
            version >= VERSION_BASE and fila.get("proveedor_id") == "cibervoluntarios" and unidad["tipo"] == "recurso",
            "Nivel de actividad ajeno",
        )
        campos = (*campos, "nivel_actividad")
        _nivel_actividad(fila, corte)
    if "idioma_programa" in fila:
        exigir(version >= VERSION_BASE and es_difusion, "Idioma de programa fuera de FUNDAE")
        campos = (*campos, "idioma_programa")
        _idioma_del_programa(fila)
    if "nivel_objetivos" in fila:
        exigir(version >= VERSION_BASE and es_difusion, "Nivel por objetivos fuera de FUNDAE")
        campos = (*campos, "nivel_objetivos")
        dato = fila["nivel_objetivos"]
        exigir_campos(
            dato,
            (
                "unidad_id",
                "programa_id",
                "titulo",
                "url",
                "sha256",
                "localizador",
                "reglas_sha256",
                "valor",
                "regla",
                "version",
            ),
            "nivel por objetivos",
        )
        exigir(
            dato["unidad_id"] == unidad["id"]
            and dato["programa_id"] == unidad["programa_id"]
            and dato["titulo"] == fila["titulo_programa"],
            "Identidad de nivel distinta",
        )
        for clave in ("sha256", "reglas_sha256"):
            catalogo.exigir_sha256(dato[clave], "huella de nivel")
        for clave in ("localizador", "regla", "version"):
            exigir_texto(dato[clave])
        exigir_url(dato["url"], "fuente de nivel")
        exigir(dato["valor"] in ("inicial", "intermedio", "avanzado"), "Nivel inválido")
        exigir(
            urlsplit(dato["url"]).netloc == "agora.fundae.es"
            and any(r["url"] == dato["url"] and r["sha256"] == dato["sha256"] for r in fila["referencias"]),
            "Nivel sin referencia FUNDAE",
        )
    if "evidencia_temas" in fila:
        exigir(version >= VERSION_BASE, "Temas fuera de versión admitida")
        campos = (*campos, "evidencia_temas")
        dato = fila["evidencia_temas"]
        exigir_campos(
            dato,
            ("unidad_id", "programa_id", "titulo", "url", "sha256", "localizador", "reglas_sha256", "temas"),
            "evidencia de temas",
        )
        exigir(
            dato["unidad_id"] == unidad["id"]
            and dato["programa_id"] == unidad["programa_id"]
            and dato["titulo"] == fila["titulo_programa"],
            "Identidad temática distinta",
        )
        for clave in ("sha256", "reglas_sha256"):
            catalogo.exigir_sha256(dato[clave], "huella temática")
        exigir_texto(dato["localizador"])
        exigir_url(dato["url"], "fuente temática")
        exigir(
            any(r["url"] == dato["url"] and r["sha256"] == dato["sha256"] for r in fila["referencias"]),
            "Tema sin referencia",
        )
        exigir(
            (es_difusion and urlsplit(dato["url"]).netloc == "agora.fundae.es")
            or (
                fila.get("proveedor_id") == "cibervoluntarios"
                and unidad["tipo"] == "recurso"
                and urlsplit(dato["url"]).netloc == "www.cibervoluntarios.org"
            ),
            "Fuente temática fuera de proveedor",
        )
        temas = dato["temas"]
        exigir(
            isinstance(temas, list)
            and bool(temas)
            and all(t in TEMAS_VALIDOS for t in temas)
            and len(set(temas)) == len(temas),
            "Temas inválidos",
        )
    if "nivel_itinerario" in fila:
        exigir(
            version >= VERSION_BASE
            and fila.get("proveedor_id") == "cibernarium"
            and unidad["tipo"] == "edicion"
            and re.fullmatch(r"cibernarium:[1-9][0-9]*", unidad["programa_id"])
            and re.fullmatch(r"cibernarium-edicion:[1-9][0-9]*", unidad["id"]),
            "Itinerario fuera de Cibernàrium",
        )
        campos = (*campos, "nivel_itinerario")
        itinerario = fila["nivel_itinerario"]
        exigir_campos(
            itinerario,
            ("unidad_id", "programa_id", "titulo", "url", "sha256", "localizador", "valor", "version"),
            "nivel por itinerario",
        )
        exigir(
            itinerario["unidad_id"] == unidad["id"]
            and itinerario["programa_id"] == unidad["programa_id"]
            and itinerario["titulo"] == fila["titulo_programa"],
            "Itinerario de otra identidad",
        )
        id_programa = unidad["programa_id"].removeprefix("cibernarium:")
        exigir(
            itinerario["url"] == "https://cibernarium.barcelonactiva.cat/ca/formacio?activityId=" + id_programa,
            "Ficha de otro programa",
        )
        catalogo.exigir_sha256(itinerario["sha256"], "huella del itinerario")
        exigir_texto(itinerario["localizador"])
        exigir(
            (itinerario["valor"] == "intermedio" and itinerario["version"] == "cibernarium-itinerario-v1")
            or (
                itinerario["valor"] in ("inicial", "intermedio")
                and itinerario["version"] == "cibernarium-ficha-tareas-v1"
            ),
            "Orientación de ficha incompatible",
        )
        exigir(
            any(r["url"] == itinerario["url"] and r["sha256"] == itinerario["sha256"] for r in fila["referencias"]),
            "Itinerario sin captura",
        )
    exigir_campos(fila, campos, "oferta")
    if version >= VERSION_CON_MATERIA:
        _evidencia_materia(fila, corte)
    if version >= VERSION_BASE and es_difusion:
        _preinscripcion(fila, corte)


def _oferta(fila: ValorJson, corte: str, version: int) -> tuple[str, str]:
    _campos_de_oferta(fila, corte, version)
    unidad = fila["unidad"]
    exigir(unidad["tipo"] in ("recurso", "edicion"), "Tipo de unidad no admitido")
    exigir(unidad["tipo"] != "recurso" or unidad["id"] == unidad["programa_id"], "Identidad de recurso incompatible")
    for campo in ("proveedor_id", "titulo_programa", "tipo_unidad"):
        exigir_texto(fila[campo])
    exigir_url(fila["url"], "URL propia de oferta")
    _hechos(fila["hechos"])
    exigir(
        unidad["tipo"] == "edicion"
        or all(fila["hechos"][c]["valor"] is None for c in calendario_entrega.CAMPOS_CALENDARIO),
        "Calendario sin edición propia",
    )
    _referencias(fila["referencias"])
    comprobado, evaluado, proyectado = (
        vigencia.instante_utc(f, "fecha de oferta acreditada")
        for f in (fila["comprobado_el"], fila["corte_evaluacion_utc"], corte)
    )
    exigir(comprobado <= evaluado <= proyectado, "Oferta posterior a su proyección o fechas incoherentes")
    if fila["incidencia_enlace_el"] is not None:
        incidencia = vigencia.instante_utc(fila["incidencia_enlace_el"], "incidencia de enlace")
        # La incidencia puede ser del catálogo y anterior a la última comprobación de la ficha: son canales
        # independientes. Solo se exige que no sea posterior a la evaluación que la registró.
        exigir(incidencia <= evaluado, "Incidencia de enlace posterior a su evaluación")
    if fila["cierra_el"] is not None:
        cierra = vigencia.instante_utc(fila["cierra_el"], "límite publicado de oferta")
        exigir(proyectado < cierra, "Oferta con su límite publicado alcanzado")
    fechas_referencias = {
        vigencia.instante_utc(r["fecha_referencia"], "referencia de hecho") for r in fila["referencias"]
    }
    for hecho in fila["hechos"].values():
        if "vigencia" not in hecho:
            continue
        inicio = vigencia.instante_utc(hecho["vigencia"]["comprobado_el"], "vigencia de hecho")
        exigir(inicio <= proyectado, "Hecho comprobado después de la proyección")
        exigir(inicio in fechas_referencias, "Hecho temporal sin referencia fechada")
    return unidad["tipo"], unidad["id"]


def validar_publico(dato: ValorJson) -> None:
    """Exige ofertas acreditadas, sin estados ocultos o diagnósticos de administración.

    No evalúa la fuente: comprueba estructura, relaciones e intervalo temporal de
    las decisiones ya admitidas. El consumidor retira la oferta cuando su reloj alcanza
    el límite publicado (`cierra_el`); los hechos no caducan con el reloj.
    """
    exigir_campos(
        dato,
        ("schema_version", "revision", "derechos", "corte_proyeccion_utc", "proveedores", "ofertas", "cobertura"),
        "entrega pública",
    )
    exigir(
        type(dato["schema_version"]) is int
        and dato["schema_version"] in (VERSION_ANTERIOR, VERSION_CON_MATERIA, VERSION_BASE, VERSION),
        "Versión desconocida",
    )
    exigir(
        dato["derechos"] == DERECHOS and dato["derechos"]["redistribuye_contenidos"] is False,
        "Alcance de redistribución inválido",
    )
    vigencia.instante_utc(dato["corte_proyeccion_utc"], "corte de proyección")
    for nombre in CAMPOS_COLECCIONES:
        exigir(isinstance(dato[nombre], list) and len(dato[nombre]) <= MAX_FILAS, "Límite de filas: " + nombre)
    ids = []
    for fila in dato["proveedores"]:
        exigir_campos(fila, CAMPOS_COLECCIONES["proveedores"], "proveedor")
        exigir_texto(fila["id"])
        exigir_texto(fila["nombre"])
        ids.append(fila["id"])
    exigir(ids == sorted(set(ids)), "Proveedores duplicados o sin orden canónico")
    claves = [_oferta(fila, dato["corte_proyeccion_utc"], dato["schema_version"]) for fila in dato["ofertas"]]
    exigir(claves == sorted(set(claves)), "Ofertas duplicadas o sin orden canónico")
    exigir(set(ids) == {f["proveedor_id"] for f in dato["ofertas"]}, "Proveedor huérfano o sin oferta acreditada")
    exigir_campos(dato["cobertura"], ("recurso", "edicion"), "cobertura pública")
    esperada = {t: sum(c[0] == t for c in claves) for t in ("recurso", "edicion")}
    exigir(
        all(type(n) is int for n in dato["cobertura"].values()) and dato["cobertura"] == esperada,
        "Cobertura pública incoherente",
    )
    exigir(dato["revision"] == sha256_json({k: v for k, v in dato.items() if k != "revision"}), "Revisión distinta")
