"""Censo API paginado y declaraciones vinculadas a la portada de autoformación.

Cada página conserva su recibo real; el total exige identidades únicas y páginas
consecutivas. Un fallo no reemplaza la última consulta buena ni acredita bajas: si
una página no responde, lo visto en las demás se confirma y la consulta queda parcial.
"""

import hashlib
import json
import re
from collections.abc import Callable
from http import HTTPStatus
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from plataforma_datos.comun import entrada_salida
from plataforma_datos.comun.nucleo import FormatoInesperado
from plataforma_datos.cursos import operacion_fuente as comun
from plataforma_datos.cursos.contrato_entrega_catalogo import ErrorEntregaCatalogo
from plataforma_datos.cursos.fuentes.cibervoluntarios import (
    bajas,
    destinos,
    lector,
    lectura,
    metodo_interfaz,
    rutas_publicas,
)
from plataforma_datos.cursos.fuentes.cibervoluntarios import declaraciones_publicadas as declaraciones
from plataforma_datos.cursos.tipos_json import ObjetoJson

API = "https://www.cibervoluntarios.org/api/public/activity_catalogs"
ALIAS_FUNDAE = "https://ciber.be/introduccion-ecommerce"
TAMANO_PAGINA = 100
MAX_PAGINAS = 20


def url_pagina(numero: int) -> str:
    """Devuelve solo una página del censo español, con límite operativo explícito.

    Returns:
        URL pública canónica, sin parámetros del entorno o de una persona.
    """
    comun.exigir(type(numero) is int and 1 <= numero <= MAX_PAGINAS, "Página Ciber fuera de límite", FormatoInesperado)
    return API + "?lang=es&itemsPerPage=" + str(TAMANO_PAGINA) + "&page=" + str(numero)


def pagina(original: Path, cap: ObjetoJson) -> tuple[bytes, ObjetoJson]:
    """Verifica cuerpo y recibo antes de interpretar JSON, HTML o JavaScript estático.

    Returns:
        Bytes íntegros y evento reconstruido, con sus fechas originales.
    """
    comun.exigir(cap.get("cuerpo") is not None, "Recepción Ciber sin cuerpo", FormatoInesperado)
    cuerpo = comun.leer_conservado(original, cap["cuerpo"], maximo_bytes=comun.limite_cuerpo("cibervoluntarios"))
    meta = comun.leer_recibo(original, cap)
    comun.exigir(
        meta["cuerpo_sha256"] == hashlib.sha256(cuerpo).hexdigest() and meta["bytes"] == len(cuerpo),
        "Recibo y cuerpo Ciber distintos",
        FormatoInesperado,
    )
    final = urlsplit(meta["url_final"] or "")
    alias = (
        meta["url"] == ALIAS_FUNDAE
        and final.scheme == "https"
        and final.netloc == "www.cibervoluntarios.org"
        and final.path.startswith("/es/formacion-gratuita/aprende-a-tu-ritmo/cursos/")
        and final.query in ("", "origin=fundae")
        and not final.fragment
    )
    comun.exigir(
        (meta["url"] == meta["url_final"] or alias) and meta["http"] == HTTPStatus.OK and meta["completo"] is True,
        "Recepción Ciber incompleta, redirigida o sin HTTP200",
        FormatoInesperado,
    )
    comun.exigir(lector._fecha(meta["fin_utc"]) >= lector._fecha(meta["inicio_utc"]), "Recepción Ciber no causal")
    return cuerpo, meta


def materiales(original: Path, cap: ObjetoJson) -> tuple[lector.MaterialCiber, ...]:
    """Reproduce los hechos del material sin conservar imágenes o participantes.

    Returns:
        Materiales nativos de una página, sin inferir oferta por su estado.
    """
    cuerpo, meta = pagina(original, cap)
    return lector.extraer_materiales(
        cuerpo,
        lector.CapturaCiber(
            url=meta["url"],
            sha256=meta["cuerpo_sha256"],
            bytes_cuerpo=meta["bytes"],
            inicio_utc=meta["inicio_utc"],
            recibido_utc=meta["fin_utc"],
            http=meta["http"],
            completo=meta["completo"],
            localizador="/hydra:member",
        ),
    )


def _numero_pagina(url: str) -> int:
    partes = urlsplit(url)
    consulta = parse_qs(partes.query, keep_blank_values=True)
    comun.exigir(
        set(consulta) == {"lang", "itemsPerPage", "page"}
        and consulta["lang"] == ["es"]
        and consulta["itemsPerPage"] == [str(TAMANO_PAGINA)]
        and len(consulta["page"]) == 1
        and consulta["page"][0].isdigit(),
        "Consulta Ciber ajena al censo",
        FormatoInesperado,
    )
    numero = int(consulta["page"][0])
    comun.exigir(url == url_pagina(numero), "URL Ciber no canónica", FormatoInesperado)
    return numero


def fallo_de_pagina(original: Path, cap: ObjetoJson) -> ObjetoJson | None:
    """Reconoce el intento de una página del censo que no aportó una lectura válida.

    Sin respuesta, con descarga incompleta o con un código que es fallo de consulta
    (5xx, autenticación, ritmo), la página no describe el censo: sus unidades quedan
    sin noticia, nunca ausentes. Otras respuestas se leen con el contrato estricto.

    Returns:
        Lectura del intento, sin identidades; None si la respuesta debe leerse como censo.
    """
    meta = comun.leer_recibo(original, cap)
    if cap.get("cuerpo") is None:
        comun.exigir(meta.get("cuerpo_sha256") is None, "Cuerpo Ciber declarado sin referencia", FormatoInesperado)
    else:
        if meta["completo"] is True and not comun.codigo_de_fallo(meta["http"]):
            return None
        cuerpo = comun.leer_conservado(original, cap["cuerpo"], maximo_bytes=comun.limite_cuerpo("cibervoluntarios"))
        comun.exigir(
            meta["cuerpo_sha256"] == hashlib.sha256(cuerpo).hexdigest() and meta["bytes"] == len(cuerpo),
            "Recibo y cuerpo Ciber distintos",
            FormatoInesperado,
        )
    comun.exigir(lector._fecha(meta["fin_utc"]) >= lector._fecha(meta["inicio_utc"]), "Recepción Ciber no causal")
    return {
        "ids": [],
        "actividades": [],
        "pagina": _numero_pagina(meta["url"]),
        "inicio_utc": meta["inicio_utc"],
        "fin_utc": meta["fin_utc"],
        "http": meta.get("http"),
        "completo": False,
        "fallo": meta.get("error") or "http_" + str(meta.get("http")),
    }


def extraer(original: Path, cap: ObjetoJson) -> ObjetoJson:
    """Extrae identidad, paginación y estado técnico reproducibles de una fila común.

    Returns:
        Lectura exacta de la página; aún no declara el censo completo.
    """
    cuerpo, meta = pagina(original, cap)
    numero = _numero_pagina(meta["url"])
    leidos = materiales(original, cap)
    documento = json.loads(cuerpo.decode("utf-8"), object_pairs_hook=lector._pares, parse_constant=lector._constante)
    total = documento.get("hydra:totalItems")
    actividades = [a["id"] for a in documento["hydra:member"]]
    comun.exigir(
        type(total) is int
        and 0 < total <= TAMANO_PAGINA * MAX_PAGINAS
        and len(actividades) == len(set(actividades))
        and len(actividades) <= TAMANO_PAGINA,
        "Censo Ciber vacío, excesivo o con actividades repetidas",
        FormatoInesperado,
    )
    return {
        "ids": ["cibervoluntarios:material:" + str(m.id) for m in leidos],
        "disponibles": sum(m.disponible for m in leidos),
        "estado_desconocido": any(m.estado_desconocido for m in leidos),
        "actividades": actividades,
        "total_actividades": total,
        "pagina": numero,
        "inicio_utc": meta["inicio_utc"],
        "fin_utc": meta["fin_utc"],
        "http": meta["http"],
        "completo": meta["completo"],
    }


def interpretar_auxiliares(original: Path, auxiliares: ObjetoJson) -> ObjetoJson:
    """Reproduce la declaración y su enlace desde la portada, sin ejecutar scripts.

    Returns:
        Dos capturas exactas con la lectura acotada de sus declaraciones.
    """
    rutas = {k: v for k, v in auxiliares.items() if re.fullmatch(r"ruta:[1-9][0-9]*", k)}
    comun.exigir(
        set(auxiliares) - set(rutas)
        in (
            {"portada", "declaraciones", "componente", "idioma"},
            {"portada", "declaraciones", "componente", "idioma", "alias"},
        ),
        "Auxiliares Ciber incompletos",
        FormatoInesperado,
    )
    portada, meta_portada = pagina(original, auxiliares["portada"])
    codigo, meta_codigo = pagina(original, auxiliares["declaraciones"])
    lectura = declaraciones.extraer(portada, meta_portada, codigo, meta_codigo)
    componente, meta_componente = pagina(original, auxiliares["componente"])
    idioma, meta_idioma = pagina(original, auxiliares["idioma"])
    comun.exigir(meta_componente["url"] == metodo_interfaz.url_componente(codigo), "Componente Ciber ajeno")
    comun.exigir(meta_idioma["url"] == metodo_interfaz.url_idioma(componente), "Idioma Ciber ajeno")
    resultado = {
        "componente": {
            **auxiliares["componente"],
            "lectura": {
                "metodo": metodo_interfaz.METODO,
                "confirmado": metodo_interfaz.confirmado(componente, idioma, lectura["url_modulo"], codigo),
            },
        },
        "idioma": {**auxiliares["idioma"], "lectura": {"vinculado": True}},
        "portada": {**auxiliares["portada"], "lectura": {"modulo": lectura["url_modulo"]}},
        "declaraciones": {**auxiliares["declaraciones"], "lectura": lectura},
    }
    if "alias" in auxiliares:
        resultado["alias"] = {
            **auxiliares["alias"],
            "lectura": _interpretar_alias(original, auxiliares["alias"], lectura["url_modulo"]),
        }
    for nombre, cap in rutas.items():
        resultado[nombre] = {**cap, "lectura": rutas_publicas.leer(original, cap)}
    return resultado


def _interpretar_alias(original: Path, cap: ObjetoJson, modulo: str) -> ObjetoJson:
    meta = comun.leer_recibo(original, cap)
    comun.exigir(meta["url"] == ALIAS_FUNDAE, "Alias Ciber ajeno")
    salida = {"url_final": meta.get("url_final"), "vinculado": False}
    if cap.get("cuerpo") is None:
        comun.exigir(meta.get("cuerpo_sha256") is None, "Alias con cuerpo confirmado pero referencia ausente")
        return salida
    cuerpo = comun.leer_conservado(original, cap["cuerpo"], maximo_bytes=comun.limite_cuerpo("cibervoluntarios"))
    comun.exigir(
        meta["cuerpo_sha256"] == hashlib.sha256(cuerpo).hexdigest() and meta["bytes"] == len(cuerpo),
        "Recibo y cuerpo de alias distintos",
        FormatoInesperado,
    )
    if meta.get("http") != HTTPStatus.OK or meta.get("completo") is not True:
        return salida
    try:
        cuerpo, _ = pagina(original, cap)
        salida["vinculado"] = declaraciones.modulo_enlazado(cuerpo) == modulo
    except (FormatoInesperado, ErrorEntregaCatalogo):
        # El intento individual se conserva en originales y salud. No renueva
        # este alias ni impide contrastar las páginas independientes del censo.
        return salida
    return salida


def calcular(original: Path, documento: ObjetoJson, programas: list[ObjetoJson]) -> ObjetoJson:
    """Contrasta todas las páginas; no infiere una baja individual por ausencia.

    Una página caída deja la consulta parcial: lo leído en las demás se conserva y
    las unidades conocidas que no aparecen quedan sin noticia, no ausentes.

    Returns:
        Conjunto común con censo de actividades acreditado y auxiliares vinculados.
    """
    comun.exigir(
        documento.get("schema_version") == 1
        and documento.get("fuente_id") == lector.FUENTE
        and isinstance(documento.get("capturas"), list)
        and documento["capturas"],
        "Procedencia Ciber vacía o ajena",
        FormatoInesperado,
    )
    filas, fallidas = [], []
    for cap in documento["capturas"]:
        fallo = fallo_de_pagina(original, cap)
        if fallo is None:
            filas.append({**cap, "lectura": extraer(original, cap)})
        else:
            fallidas.append({**cap, "lectura": fallo})
    # El número de página identifica cada recepción; el orden del índice no decide nada.
    filas.sort(key=lambda f: f["lectura"]["pagina"])
    fallidas.sort(key=lambda f: f["lectura"]["pagina"])
    comun.exigir(
        bool(filas) and filas[0]["lectura"]["pagina"] == 1,
        "Primera página Ciber sin respuesta: no hay censo que contrastar",
        FormatoInesperado,
    )
    total = filas[0]["lectura"]["total_actividades"]
    numero = (total + TAMANO_PAGINA - 1) // TAMANO_PAGINA
    comun.exigir(
        sorted(f["lectura"]["pagina"] for f in [*filas, *fallidas]) == list(range(1, numero + 1))
        and all(f["lectura"]["total_actividades"] == total for f in filas),
        "Páginas Ciber faltantes, repetidas o totales contradictorios",
        FormatoInesperado,
    )
    actividades = [id for f in filas for id in f["lectura"]["actividades"]]
    ids = [id for f in filas for id in f["lectura"]["ids"]]
    comun.exigir(
        (len(actividades) <= total if fallidas else len(actividades) == total)
        and len(actividades) == len(set(actividades))
        and len(ids) == len(set(ids))
        and all(len(f["lectura"]["actividades"]) == TAMANO_PAGINA for f in filas if f["lectura"]["pagina"] < numero),
        "Censo Ciber truncado o con identidades repetidas",
        FormatoInesperado,
    )
    sin_ver = sorted({p["id"] for p in programas} - set(ids))
    resultado = {
        "schema_version": 1,
        "fuente_id": lector.FUENTE,
        "procedencia_sha256": entrada_salida.sha256(original / "procedencia.json"),
        "recepciones": filas,
        "censo_completo": not fallidas,
        "censo": {
            "actividades": actividades,
            "materiales": ids,
            "disponibles": sum(f["lectura"]["disponibles"] for f in filas),
            "estado_desconocido": any(f["lectura"]["estado_desconocido"] for f in filas),
        },
        "auxiliares": interpretar_auxiliares(original, documento.get("auxiliares", {})),
        "publicacion_confirmada": None,
    }
    if fallidas:
        # Las conocidas sin ver pudieron estar en la página caída: no se leen como ausencias.
        resultado["paginas_fallidas"] = fallidas
        resultado["consulta_parcial"] = {
            "unidades_fallidas": sin_ver,
            "unidades_esperadas": len(programas),
            "paginas_fallidas": [f["lectura"]["pagina"] for f in fallidas],
            "paginas_esperadas": numero,
        }
    else:
        resultado["censo"]["conocidos_ausentes"] = sin_ver
        propio = documento.get("censo", {})
        if propio.get(bajas.FICHAS):
            resultado[bajas.FICHAS] = destinos.leer(
                original, propio[bajas.FICHAS], [p for p in programas if p["id"] in sin_ver]
            )
        if propio.get(bajas.YA_RETIRADOS):
            comun.exigir(
                set(propio[bajas.YA_RETIRADOS]) <= set(sin_ver), "Retirado Ciber que no falta", FormatoInesperado
            )
            resultado[bajas.YA_RETIRADOS] = sorted(propio[bajas.YA_RETIRADOS])
    return resultado


def _ausentes_del_censo(original: Path, capturas: list[ObjetoJson], programas: list[ObjetoJson]) -> list[ObjetoJson]:
    """Selecciona los programas conocidos que el censo no trae, si el censo es completo y tiene materiales.

    Returns:
        Los programas ausentes; ninguno ante una página caída, ilegible o un censo sin materiales.
    """
    try:
        if any(fallo_de_pagina(original, cap) is not None for cap in capturas):
            return []
        lecturas = [extraer(original, cap) for cap in capturas]
    except (FormatoInesperado, lector.ErrorLecturaCiber):
        return []
    vistos = {id for lectura in lecturas for id in lectura["ids"]}
    if not sum(lectura["disponibles"] for lectura in lecturas) or any(x["estado_desconocido"] for x in lecturas):
        return []
    return [p for p in programas if p["id"] not in vistos]


def _consultar_rutas(original: Path, capturas: list[ObjetoJson], programas: list[ObjetoJson]) -> ObjetoJson:
    """Busca la ficha registrada de cada material que el proveedor identifica con un slug distinto.

    Returns:
        Consultas individuales del buscador público del visor, recibidas en serie.
    """
    propias = {p["id"]: p for p in programas}
    rutas = {}
    for cap in capturas:
        if fallo_de_pagina(original, cap) is not None:
            continue
        for material in materiales(original, cap):
            programa = propias.get("cibervoluntarios:material:" + str(material.id))
            if (
                not programa
                or not material.disponible
                or material.idioma_publicado != "Español"
                or material.tipo_material != "Autoformación"
            ):
                continue
            anterior = rutas_publicas.slug_registrado(programa.get("url"))
            if (
                anterior
                and anterior != material.slug
                and programa.get("datos", {}).get("identidad_fuente", {}).get("actividad_id") == material.actividad_id
            ):
                rutas["ruta:" + str(material.id)] = comun.recibir_url(
                    rutas_publicas.consulta(anterior),
                    original,
                    programa["id"],
                    perfil="datos",
                    tipo_respuesta="application/ld+json",
                    seguir_redirecciones=False,
                )
    return rutas


def pagina_para_la_lectura(original: Path, cap: ObjetoJson) -> lectura.Pagina | None:
    """Entrega al registro de lecturas lo que una página del censo aportó.

    Returns:
        La página con su hora, su total y su contenido, o None si no aportó una lectura válida.
    """
    if fallo_de_pagina(original, cap) is not None:
        return None
    leida = extraer(original, cap)
    actividades = json.loads(pagina(original, cap)[0].decode("utf-8"))["hydra:member"]
    return lectura.Pagina(
        fin_utc=leida["fin_utc"],
        total_declarado=leida["total_actividades"],
        actividades=tuple(actividades),
        materiales=materiales(original, cap),
    )


def descargar(
    programas: list[ObjetoJson],
    original: Path,
    anterior: ObjetoJson,
    retirado: Callable[[str], bool] = lambda _id: False,
) -> lectura.Resultado:
    """Adquiere el censo, el destino de cada material conocido que falta en él y los apoyos públicos, en serie.

    Con el censo completo se pide, sin seguir redirecciones, el destino registrado de cada material conocido que no
    trae. No inicia sesiones ni ejecuta código del proveedor. Al final emite la lectura del censo; si no se puede
    emitir, el resultado lo dice y nada más cambia.

    Returns:
        Las lecturas emitidas y los problemas que impidieron emitirlas, si los hubo.
    """
    capturas, auxiliares, censo = [], {}, None
    try:
        capturas.append(comun.recibir_pagina_de_fuente(lector.FUENTE, url_pagina(1), original, None))
        # Sin la primera página no se conoce el total: la consulta falla entera.
        comun.exigir(
            fallo_de_pagina(original, capturas[0]) is None,
            "Primera página Ciber sin respuesta válida",
            FormatoInesperado,
        )
        primera = extraer(original, capturas[0])
        paginas = (primera["total_actividades"] + TAMANO_PAGINA - 1) // TAMANO_PAGINA
        for numero in range(2, paginas + 1):
            # Una página caída queda como intento propio; las demás se siguen consultando.
            capturas.append(comun.recibir_pagina_de_fuente(lector.FUENTE, url_pagina(numero), original, None))
        ausentes = _ausentes_del_censo(original, capturas, programas)
        if ausentes:
            ya = [p for p in ausentes if retirado(p["id"])]
            pedir = [p for p in ausentes if p not in ya]
            censo = {bajas.FICHAS: destinos.descargar(original, pedir), bajas.YA_RETIRADOS: [p["id"] for p in ya]}
        auxiliares["portada"] = comun.recibir_url(declaraciones.PORTADA, original, None, perfil="pagina")
        cuerpo, meta = pagina(original, auxiliares["portada"])
        url = declaraciones.modulo_publicado(cuerpo, meta)
        auxiliares["declaraciones"] = comun.recibir_url(url, original, None, perfil="datos")
        codigo, _ = pagina(original, auxiliares["declaraciones"])
        auxiliares["componente"] = comun.recibir_url(
            metodo_interfaz.url_componente(codigo), original, None, perfil="datos"
        )
        componente, _ = pagina(original, auxiliares["componente"])
        auxiliares["idioma"] = comun.recibir_url(metodo_interfaz.url_idioma(componente), original, None, perfil="datos")
        auxiliares["alias"] = comun.recibir_url(ALIAS_FUNDAE, original, None, perfil="pagina")
        auxiliares.update(_consultar_rutas(original, capturas, programas))
        interpretar_auxiliares(original, auxiliares)
    finally:
        comun.guardar_capturas_de_fuente(
            original, lector.FUENTE, capturas, anterior, auxiliares, fallos_por_unidad=True, censo=censo
        )
    return lectura.emitir(original, capturas, programas, leer=pagina_para_la_lectura)
