"""Etapas comunes de fuentes del catálogo: recepción, extracción y admisión.

Cada fuente conserva sus capturas y controles. La composición conjunta posterior
actualiza la única SQLite; estas etapas no publican una web ni inventan ediciones.
"""

import hashlib
import json
import sqlite3
import stat
from contextlib import closing
from dataclasses import asdict
from datetime import datetime
from http import HTTPStatus
from pathlib import Path
from urllib.parse import urlsplit

from plataforma_datos.comun import entrada_salida, perfil_web
from plataforma_datos.comun.entrada_salida import guardar_json, leer_json
from plataforma_datos.comun.nucleo import DATOS_RELATIVOS, RAIZ, Controles, Descarga, FormatoInesperado, exigir
from plataforma_datos.comun.observacion_remota import observar_original
from plataforma_datos.cursos import (
    admision_catalogo,
    almacen_catalogo,
    identidades_de_admision,
    recepciones_catalogo,
    recibos_compartidos,
    registro_vigencia,
    trozos_catalogo,
)
from plataforma_datos.cursos.controles_de_recepcion import CODIGOS_FALLO_CONSULTA as CODIGOS_FALLO_CONSULTA
from plataforma_datos.cursos.controles_de_recepcion import FALLOS_POR_UNIDAD, fallo_de_consulta
from plataforma_datos.cursos.controles_de_recepcion import codigo_de_fallo as codigo_de_fallo
from plataforma_datos.cursos.controles_de_recepcion import respuestas_interpretables as _respuestas_interpretables
from plataforma_datos.cursos.fuentes.cibervoluntarios import bajas as bajas_ciber
from plataforma_datos.cursos.fuentes.cibervoluntarios import direcciones
from plataforma_datos.cursos.fuentes.cibervoluntarios import lector as ciber
from plataforma_datos.cursos.fuentes.claude_academy import lector as academy
from plataforma_datos.cursos.fuentes.hp_life import bajas, censo_indice, extraccion, gratuidad
from plataforma_datos.cursos.fuentes.hp_life import lector as hp
from plataforma_datos.cursos.recepciones_catalogo import (
    MAX_CUERPO,
    MAX_CUERPO_CATALOGO,
    conservar_bytes,
    consultar,
    json_bytes,
)
from plataforma_datos.cursos.tipos_json import ObjetoJson
from plataforma_datos.orquestacion.admision import cerrar_validacion, exigir_admitido
from plataforma_datos.orquestacion.ordenes import principal_fuente_con_descarga
from plataforma_datos.orquestacion.sustitucion import escribir_atomico

FUENTES = {
    "hp_life": "hp-life",
    "cibervoluntarios": "cibervoluntarios",
    "claude_academy": "anthropic",
    "fundae": "fundae",
    "barcelonactiva": "cibernarium",
}
CANALES = {"fundae": "catalogos", "barcelonactiva": "cibernarium"}
# Fuentes que guardan el conjunto admitido entero de un ciclo no instalado, con sus auxiliares.
# HP LIFE arrastra sus capturas una a una (`pendientes` de su procedencia).
PENDIENTES_POR_CONJUNTO = frozenset({"claude_academy", "fundae", "cibervoluntarios", "barcelonactiva"})
# Fuentes que traen su censo completo propio y dan de alta lo que publica: pueden partir de un almacén recién sembrado.
# FUNDAE lo trae con el censo de Digitalízate. HP LIFE también da altas y bajas con su índice, pero parte de los cursos
# ya admitidos: un almacén sin ninguno suyo no se aplica hasta restaurar el almacén conservado.
CENSO_PROPIO = frozenset({"barcelonactiva", "cibervoluntarios", "claude_academy", "fundae"})
# Fuentes que dicen en su informe de validación qué bajas no han podido confirmar o contradice la evidencia.
AVISOS = {"hp_life": bajas.avisos, "cibervoluntarios": bajas_ciber.avisos}


def limite_cuerpo(fuente: str) -> int:
    """Fija la cota API Ciber (64 MiB); las fichas HTML conservan 8 MiB.

    Returns:
        Límite compartido de recepción, conservación y lectura por fuente.
    """
    return MAX_CUERPO_CATALOGO if fuente == "cibervoluntarios" else MAX_CUERPO


def rutas_de_la_fuente(fuente: str, raiz: Path) -> tuple[Path, Path, Path]:
    """Carpetas de originales, preparados y validados de una fuente del catálogo (y de su canal, si lo tiene).

    Returns:
        Las tres carpetas bajo `raiz`.

    Raises:
        FormatoInesperado: Si la fuente no es del catálogo.
    """
    exigir(fuente in FUENTES, "Fuente de catálogo desconocida", FormatoInesperado)
    canal = CANALES.get(fuente, "")
    return tuple(raiz / DATOS_RELATIVOS / grupo / fuente / canal for grupo in ("originales", "preparados", "validados"))


def conocidos(fuente: str, raiz: Path) -> list[ObjetoJson] | ObjetoJson:
    """Lee identidades nativas de la única SQLite admitida, sin descubrir candidatos.

    Returns:
        Programas del proveedor, sin transformar su mera presencia en oferta.
    """
    area = raiz / almacen_catalogo.RUTA
    exigir((area / "validacion.json").is_file(), "Catálogo sin inicialización admitida explícita", FormatoInesperado)
    solicitud = almacen_catalogo.solicitud(area)
    sha_admision = entrada_salida.sha256(solicitud.validacion_destino)
    if fuente == "fundae":
        from plataforma_datos.cursos.fuentes.fundae import conocidos as identidades

        return identidades.leer(almacen_catalogo.EntradaCatalogo(admision=solicitud, sha256_admision=sha_admision))
    admision_catalogo.exigir_snapshot_admitido(solicitud, sha256_validacion=sha_admision)
    with closing(sqlite3.connect(solicitud.snapshot.ruta.as_uri() + "?mode=ro&immutable=1", uri=True)) as conexion:
        conexion.row_factory = sqlite3.Row
        filas = [
            dict(f)
            for f in conexion.execute("SELECT * FROM programas WHERE proveedor_id=? ORDER BY id", (FUENTES[fuente],))
        ]
        for fila in filas:
            fila["datos"] = json.loads(fila["datos"])
    exigir(
        bool(filas) or fuente in CENSO_PROPIO,
        "Fuente sin identidades conocidas: solo vuelve a consultar cursos ya admitidos; restaura el almacén conservado."
        " Tras una siembra no tiene cursos que consultar",
        FormatoInesperado,
    )
    return filas


def referencia_conservada(ruta: Path, original: Path, sha256: str | None = None) -> ObjetoJson:
    """Cita un archivo conservado en los originales de una fuente por su ruta relativa y su huella.

    Returns:
        El archivo, relativo a `original`, y su SHA-256.
    """
    # Un cuerpo por trozos se cita por la huella del cuerpo original, nunca por la de su manifiesto.
    exigir(ruta.is_relative_to(original), "Recepción fuera de originales", FormatoInesperado)
    return {"archivo": ruta.relative_to(original).as_posix(), "sha256": sha256 or entrada_salida.sha256(ruta)}


def leer_conservado(original: Path, referencia: ObjetoJson, *, maximo_bytes: int = MAX_CUERPO) -> bytes:
    """Lee una recepción conservada, entera o por trozos, y la devuelve solo si coincide con su huella.

    Returns:
        Los bytes verificados.

    Raises:
        FormatoInesperado: Si falta, no es un archivo regular propio, excede `maximo_bytes` o está alterada.
    """
    ruta = almacen_catalogo.ruta_relativa(original, referencia["archivo"])
    exigir(
        stat.S_ISREG(ruta.lstat().st_mode) and ruta.stat().st_nlink == 1 and ruta.stat().st_size <= maximo_bytes,
        "Recepción ausente o excesiva",
        FormatoInesperado,
    )
    try:
        # Una evidencia del almacén puede estar por trozos: solo se devuelve reconstruida y verificada.
        return trozos_catalogo.leer(ruta, referencia["sha256"], limite=maximo_bytes)
    except trozos_catalogo.ErrorTrozos as error:
        raise FormatoInesperado("Recepción alterada") from error


def recibir_pagina_de_fuente(fuente: str, url: str, original: Path, id: str | None) -> ObjetoJson:
    """Recibe una página de Cibervoluntarios o Claude Academy tras validar su URL.

    Returns:
        El registro de la recepción, con el perfil y el límite de su fuente.
    """
    if fuente == "cibervoluntarios":
        direcciones.exigir_pagina_del_censo(url)
    else:
        partes = urlsplit(url)
        exigir(
            partes.scheme == "https"
            and partes.netloc == "academy.claude.com"
            and not partes.query
            and not partes.fragment
            and academy.PATRON_CURSO.fullmatch(partes.path),
            "URL ajena a Academy",
            FormatoInesperado,
        )
    return recibir_url(
        url,
        original,
        id,
        perfil="datos" if fuente == "cibervoluntarios" else "pagina",
        maximo_bytes=limite_cuerpo(fuente),
        tipo_respuesta="application/ld+json" if fuente == "cibervoluntarios" else None,
    )


def recibir_url(  # noqa: PLR0913 - Negociación explícita sin cambiar la identidad central ni los otros lectores.
    url: str,
    original: Path,
    id: str | None,
    *,
    perfil: perfil_web.Uso,
    maximo_bytes: int = MAX_CUERPO,
    tipo_respuesta: str | None = None,
    segundos: int | None = None,
    seguir_redirecciones: bool = True,
) -> ObjetoJson:
    """Conserva una URL ya validada por el adaptador; no decide disponibilidad.

    `segundos` acota el plazo de red de esta consulta (una descarga con presupuesto propio no pasa de lo que le queda).
    Sin `seguir_redirecciones`, una redirección es la respuesta y su destino queda en el recibo.

    Returns:
        Referencias del cuerpo, recibo e intento con sus tiempos reales.
    """
    negociacion = {} if tipo_respuesta is None else {"tipo_respuesta": tipo_respuesta}
    plazo = {} if segundos is None else {"segundos": segundos}
    redirecciones = {} if seguir_redirecciones else {"seguir_redirecciones": False}
    respuesta = consultar(url, **negociacion, **plazo, **redirecciones, perfil=perfil, maximo_bytes=maximo_bytes)
    dato = {k: v for k, v in asdict(respuesta).items() if k != "redireccion" or v is not None}
    if tipo_respuesta is not None:
        dato["tipo_solicitado"] = tipo_respuesta
    cuerpo = dato.pop("cuerpo")
    if cuerpo is not None:
        guardado = conservar_bytes(original / "cuerpos", cuerpo, ".body", maximo_bytes=maximo_bytes)
        observar_original(
            url,
            Descarga(cuerpo, respuesta.url_final, respuesta.content_type),
            trozos_catalogo.leer(guardado.ruta, guardado.sha256, limite=maximo_bytes),
        )
        dato.update(cuerpo_sha256=guardado.sha256, bytes=len(cuerpo))
    estable, evento = recibos_compartidos.separar(json_bytes(dato), campos_evento=frozenset({"inicio_utc", "fin_utc"}))
    cabecera = conservar_bytes(original / "metadatos", estable, ".json")
    meta = conservar_bytes(original / "recepciones", evento, ".json")
    return {
        "metadatos": referencia_conservada(cabecera.ruta, original),
        "id": id,
        "cuerpo": referencia_conservada(guardado.ruta, original, guardado.sha256) if cuerpo is not None else None,
        "recibo": referencia_conservada(meta.ruta, original),
        "intento": referencia_conservada(meta.ruta, original),
    }


def descargar(fuente: str, aceptar_cambio: bool = False, *, raiz: Path = RAIZ) -> None:
    """Recibe solo identidades/canales conocidos, en serie y conservando todos los intentos.

    Los cuerpos son inmutables, por lo que aceptar_cambio no autoriza sobrescribir
    evidencia; las proyecciones se comprueban después con sus contratos propios.
    """
    original, _, _ = rutas_de_la_fuente(fuente, raiz)
    programas = conocidos(fuente, raiz)
    original.mkdir(parents=True, exist_ok=True)
    anterior = leer_json(original / "procedencia.json") if (original / "procedencia.json").exists() else {}
    # El registro de adquisiciones importa este módulo: se lee al descargar.
    from plataforma_datos.cursos.adquisicion_por_fuente import ADQUIRIENTES

    for problema in ADQUIRIENTES[fuente](programas, original, anterior, raiz) or ():
        print(f"Lectura de {fuente}: {problema}")


def _sello(cap: ObjetoJson) -> str:
    """Identifica la consulta conservada.

    Returns:
        SHA del recibo de una respuesta o del intento de un fallo.
    """
    return (cap["recibo"] if cap["cuerpo"] is not None else cap["intento"])["sha256"]


def _sellos_registrados(raiz: Path, ids: set[str]) -> set[str]:
    """Reúne las consultas que ya sostienen observaciones en el registro del catálogo instalado.

    Returns:
        SHA de las evidencias de las observaciones registradas de esas unidades.
    """
    if not ids:
        return set()
    solicitud = almacen_catalogo.solicitud(raiz / almacen_catalogo.RUTA)
    corte = recepciones_catalogo.ahora_utc()
    return {
        evidencia["sha256"]
        for id in sorted(ids)
        for observacion in registro_vigencia.observaciones_hasta(
            solicitud.snapshot.ruta, tipo="recurso", id=id, corte=corte
        )
        for evidencia in observacion["evidencias"]
    }


def pendientes_sin_instalar(fuente: str, raiz: Path) -> list[ObjetoJson]:
    """Recupera las recepciones admitidas cuyo catálogo no llegó a instalarse.

    Si un ciclo admitió la fuente pero su paquete falló, sus observaciones no entraron
    en el registro. Se vuelven a evaluar en el ciclo siguiente con su fecha de captura;
    cuando ya constan en el registro, dejan de ser pendientes.

    Returns:
        Capturas admitidas aún sin observación registrada, de unidades todavía conocidas.
    """
    _, _, validado = rutas_de_la_fuente(fuente, raiz)
    admitida = validado / "procedencia-admitida.json"
    if not admitida.exists():
        return []
    documento = leer_json(admitida)
    candidatas = [*documento.get("pendientes", []), *documento["capturas"]]
    instaladas = _unidades_instaladas(raiz, {c["id"] for c in candidatas})
    registrados = _sellos_registrados(raiz, instaladas)
    return [c for c in candidatas if c["id"] in instaladas and _sello(c) not in registrados]


def _unidades_instaladas(raiz: Path, ids: set[str]) -> set[str]:
    """Filtra las unidades que existen en el catálogo instalado; sin catálogo no hay qué evaluar.

    Una alta que nunca llegó a instalarse no se arrastra: la consulta siguiente la vuelve a recibir.

    Returns:
        Identidades presentes en el catálogo instalado.
    """
    area = raiz / almacen_catalogo.RUTA
    if not (area / almacen_catalogo.CONTROL).is_file() or not ids:
        return set()
    ruta = almacen_catalogo.solicitud(area).snapshot.ruta
    with closing(sqlite3.connect(ruta.as_uri() + "?mode=ro&immutable=1", uri=True)) as conexion:
        return {
            fila[0]
            for fila in conexion.execute(
                "SELECT id FROM programas WHERE id IN (" + ",".join("?" * len(ids)) + ")", sorted(ids)
            )
        }


def enlazar_canal(fuente: str, raiz: Path) -> None:
    """Añade referencias del canal sin cambiar hechos ni archivos del índice principal."""
    original, _, _ = rutas_de_la_fuente(fuente, raiz)
    indice = original / "procedencia.json"
    if not indice.exists():
        return
    padre = original.parent / "procedencia.json"
    documento = leer_json(padre)
    canal = leer_json(indice)
    referencias = [{"archivo": "procedencia.json", "sha256": entrada_salida.sha256(indice)}, *canal["historial"]]
    documento.setdefault("canales_operativos", {})[CANALES[fuente]] = [
        {"archivo": CANALES[fuente] + "/" + r["archivo"], "sha256": r["sha256"]} for r in referencias
    ]
    guardar_json(padre, documento)


def referencias_de_captura(cap: ObjetoJson) -> list[ObjetoJson]:
    """Enumera las referencias de archivo de una captura, incluidas las de su lección anidada.

    Returns:
        Las referencias, de la captura y de su lección.
    """
    refs = [cap[c] for c in ("cuerpo", "recibo", "intento", "metadatos") if cap.get(c) is not None]
    if isinstance(cap.get("leccion"), dict):
        refs.extend(referencias_de_captura(cap["leccion"]))
    return refs


def guardar_capturas_de_fuente(  # noqa: PLR0913 - Cada opción conserva un contrato de fuente explícito.
    original: Path,
    fuente: str,
    capturas: list[ObjetoJson],
    anterior: ObjetoJson,
    auxiliares: ObjetoJson | None = None,
    *,
    pendientes: list[ObjetoJson] | None = None,
    fallos_por_unidad: bool = False,
    censo: ObjetoJson | None = None,
) -> None:
    """Conserva el índice del intento; un fallo de una unidad no anula a las demás si la fuente lo admite.

    Raises:
        FormatoInesperado: Si ninguna consulta respondió, o alguna falló en una fuente sin fallos por unidad.
    """
    historial = {p["sha256"]: p for p in anterior.get("historial", [])}
    # Orden cronológico: ante bytes idénticos prevalece la referencia de la consulta más reciente.
    todas = [*anterior.get("pendientes", []), *anterior.get("capturas", []), *capturas]
    todas.extend(anterior.get("auxiliares", {}).values())
    todas.extend((auxiliares or {}).values())
    # El censo propio de una fuente (Digitalízate en FUNDAE) conserva también sus capturas en el historial.
    from plataforma_datos.cursos.fuentes.fundae import censo_digitalizate

    for documento_censo in filter(None, (anterior.get("censo"), censo)):
        todas.extend(censo_digitalizate.capturas(documento_censo))
    for cap in todas:
        for ref in referencias_de_captura(cap):
            historial[ref["sha256"]] = ref
    documento = {
        "schema_version": 1,
        "fuente_id": fuente,
        "capturas": capturas,
        "historial": list(historial.values()),
        "censo_completo": False,
    }
    if pendientes:
        documento["pendientes"] = pendientes
    if auxiliares is not None:
        documento["auxiliares"] = auxiliares
    if censo is not None:
        documento["censo"] = censo
    guardar_json(original / "procedencia.json", documento)
    respondidas = [c["cuerpo"] is not None for c in capturas]
    exigir(
        any(respondidas) if fallos_por_unidad else all(respondidas),
        "Consulta sin respuesta; se conservan intentos y última versión buena",
        FormatoInesperado,
    )


def leer_recibo(original: Path, cap: ObjetoJson) -> ObjetoJson:
    """Reconstruye el evento exacto desde referencias protegidas, sin renovar fechas.

    Returns:
        Recibo lógico antiguo o compartido, comprobado antes de interpretarlo.
    """
    contenido = leer_conservado(original, cap["recibo"])
    dato = recibos_compartidos.leer_json(contenido)
    if "formato_recibo" in dato:
        exigir("metadatos" in cap, "Recibo sin sus metadatos", FormatoInesperado)
        exigir(dato["metadatos_sha256"] == cap["metadatos"]["sha256"], "Metadatos de otro recibo", FormatoInesperado)
        contenido = recibos_compartidos.reconstruir(contenido, leer_conservado(original, cap["metadatos"]))
        dato = recibos_compartidos.leer_json(contenido)
    else:
        exigir("metadatos" not in cap, "Metadatos ajenos al recibo histórico", FormatoInesperado)
    return dato


def metadatos_de_captura_academy(meta: ObjetoJson, cap: ObjetoJson) -> ObjetoJson:
    """Traduce el recibo conservado de una captura a los metadatos que espera el lector de Claude Academy.

    Returns:
        Los metadatos de la captura.
    """
    return {
        "http": meta["http"],
        "completo": meta["completo"],
        "bytes": meta["bytes"],
        "sha256": meta["cuerpo_sha256"],
        "url_solicitada": meta["url"],
        "url_final": meta["url_final"],
        "archivo": Path(cap["cuerpo"]["archivo"]).name,
        "recibido_utc": meta["fin_utc"],
    }


def pagina_academy(original: Path, cap: ObjetoJson) -> tuple[bytes, ObjetoJson]:
    """Lee una página conservada de Claude Academy con su recibo, que deben corresponderse.

    Returns:
        El cuerpo verificado y los metadatos de su recepción.

    Raises:
        FormatoInesperado: Si falta el cuerpo o el recibo, o no se corresponden.
    """
    exigir(cap["cuerpo"] is not None and cap["recibo"] is not None, "Recepción sin cuerpo", FormatoInesperado)
    cuerpo = leer_conservado(original, cap["cuerpo"])
    meta = leer_recibo(original, cap)
    exigir(
        meta["cuerpo_sha256"] == hashlib.sha256(cuerpo).hexdigest() and meta["bytes"] == len(cuerpo),
        "Recibo y cuerpo distintos",
        FormatoInesperado,
    )
    return cuerpo, metadatos_de_captura_academy(meta, cap)


def _leer_intento_fallido(fuente: str, original: Path, cap: ObjetoJson) -> ObjetoJson:
    """Lee el intento conservado de una consulta sin respuesta; no inventa contenido ni estado.

    Returns:
        Intervalo real y error del intento, sin identidades observadas.
    """
    if fuente != "hp_life":
        # El transporte común guarda el intento sin respuesta como recibo sin cuerpo.
        meta = leer_recibo(original, cap)
        exigir("cuerpo_sha256" not in meta and meta.get("error"), "Recibo sin cuerpo ni error", FormatoInesperado)
        return {
            "ids": [],
            "inicio_utc": meta["inicio_utc"],
            "fin_utc": meta["fin_utc"],
            "http": meta["http"],
            "completo": False,
            "fallo": meta["error"],
        }
    exigir(cap["recibo"] is None and cap["intento"] is not None, "Intento fallido con recibo", FormatoInesperado)
    return extraccion.intento_fallido(
        recibos_compartidos.leer_json(leer_conservado(original, cap["intento"])), cap["id"]
    )


def extraer(fuente: str, original: Path, cap: ObjetoJson) -> ObjetoJson:
    """Contrasta cuerpos y recibos con el lector propio; los errores no acreditan apertura.

    Returns:
        Metadatos de la recepción y las identidades observadas, con campos desconocidos intactos.
    """
    if fuente == "cibervoluntarios":
        from plataforma_datos.cursos.fuentes.cibervoluntarios import adquisicion

        return adquisicion.extraer(original, cap)
    if fuente in FALLOS_POR_UNIDAD and cap["cuerpo"] is None:
        return _leer_intento_fallido(fuente, original, cap)
    exigir(cap["cuerpo"] is not None and cap["recibo"] is not None, "Recepción sin cuerpo íntegro", FormatoInesperado)
    cuerpo = leer_conservado(original, cap["cuerpo"], maximo_bytes=limite_cuerpo(fuente))
    recibo = leer_conservado(original, cap["recibo"])
    if fuente == "hp_life":
        return extraccion.extraer(cuerpo, recibo, cap["id"])
    meta = leer_recibo(original, cap)
    exigir(
        meta["cuerpo_sha256"] == hashlib.sha256(cuerpo).hexdigest() and meta["bytes"] == len(cuerpo),
        "Recibo y cuerpo distintos",
        FormatoInesperado,
    )
    if meta["http"] != HTTPStatus.OK or meta["completo"] is not True:
        return {
            "ids": [],
            "inicio_utc": meta["inicio_utc"],
            "fin_utc": meta["fin_utc"],
            "http": meta["http"],
            "completo": meta["completo"],
        }
    acceso_academy = None
    leida = academy.extraer_ficha(cuerpo, metadatos_de_captura_academy(meta, cap), url_esperada=meta["url"])
    exigir("claude-academy:" + leida.id == cap["id"], "Identidad Academy distinta", FormatoInesperado)
    ids = [cap["id"]]
    from plataforma_datos.cursos.fuentes.claude_academy import adquisicion

    acceso_academy = adquisicion.interpretar_leccion(original, cap, leida)
    resultado = {
        "ids": ids,
        "inicio_utc": meta["inicio_utc"],
        "fin_utc": meta["fin_utc"],
        "http": meta["http"],
        "completo": meta["completo"],
    }
    if fuente == "claude_academy":
        resultado["leccion_publica"] = acceso_academy
    return resultado


def _pendientes_admisibles(documento: ObjetoJson, nativos: set[str]) -> list[ObjetoJson]:
    """Exige que las pendientes sean de unidades conocidas y que ninguna consulta se repita.

    Returns:
        Capturas pendientes de la procedencia, en su orden.
    """
    pendientes = documento.get("pendientes", [])
    sellos = [_sello(c) for c in [*pendientes, *documento["capturas"]]]
    exigir(
        all(c["id"] in nativos for c in pendientes) and len(set(sellos)) == len(sellos),
        "Recepción pendiente ajena o repetida",
        FormatoInesperado,
    )
    return pendientes


def _marcar_consulta_parcial(resultado: ObjetoJson, esperadas: int) -> None:
    """Conserva lo válido, pero una consulta con URL fallidas no acredita la fuente entera."""
    fallidas = sorted(f["id"] for f in resultado["recepciones"] if fallo_de_consulta(f["lectura"]))
    if fallidas:
        resultado["consulta_parcial"] = {"unidades_fallidas": fallidas, "unidades_esperadas": esperadas}


def _unidades_esperadas(
    fuente: str, original: Path, documento: ObjetoJson, programas: list[ObjetoJson] | ObjetoJson
) -> tuple[set[str], ObjetoJson | None, ObjetoJson | None]:
    """Identidades que la consulta debe cubrir: las conocidas y las que el índice de la fuente acredita.

    Returns:
        Identidades, auxiliares de Claude Academy ya interpretados e índice de HP LIFE reproducido.
    """
    nativos = {p["id"] for p in programas}
    if fuente == "claude_academy":
        from plataforma_datos.cursos.fuentes.claude_academy import adquisicion

        auxiliares = adquisicion.interpretar_auxiliares(original, documento.get("auxiliares", {}))
        urls = set(auxiliares["indice"]["lectura"]["urls"])
        return nativos | {"claude-academy:" + urlsplit(u).path.rsplit("/", 1)[1] for u in urls}, auxiliares, None
    if fuente == "hp_life":
        indice_hp = censo_indice.calcular(documento.get("auxiliares", {}), lambda ref: leer_conservado(original, ref))
        return nativos | censo_indice.identidades_de_alta(indice_hp), None, indice_hp
    return nativos, None, None


def calcular_recepciones_de_fuente(
    fuente: str, raiz: Path, *, programas: list[ObjetoJson] | ObjetoJson | None = None
) -> ObjetoJson:
    """Recalcula las recepciones y la procedencia de una fuente a partir de su carpeta de originales.

    Returns:
        Las recepciones y su procedencia.

    Raises:
        FormatoInesperado: Si la procedencia está vacía o es de otra fuente.
    """
    if programas is None:
        programas = conocidos(fuente, raiz)
    return _calcular_con_identidades(fuente, raiz, programas)


def _calcular_con_identidades(fuente: str, raiz: Path, programas: list[ObjetoJson] | ObjetoJson) -> ObjetoJson:
    original, _, _ = rutas_de_la_fuente(fuente, raiz)
    documento = leer_json(original / "procedencia.json")
    exigir(
        documento["schema_version"] == 1
        and documento["fuente_id"] == fuente
        and (documento["capturas"] or fuente == "fundae" and documento.get("auxiliares")),
        "Procedencia vacía o ajena",
        FormatoInesperado,
    )
    if fuente == "barcelonactiva":
        from plataforma_datos.cursos.fuentes.barcelonactiva import adquisicion

        return {
            **adquisicion.calcular(original, documento, programas),
            "procedencia_sha256": entrada_salida.sha256(original / "procedencia.json"),
        }
    if fuente == "fundae":
        from plataforma_datos.cursos.fuentes.fundae import adquisicion

        return {
            **adquisicion.calcular(original, documento, programas),
            "procedencia_sha256": entrada_salida.sha256(original / "procedencia.json"),
        }
    if fuente == "cibervoluntarios":
        from plataforma_datos.cursos.fuentes.cibervoluntarios import adquisicion

        try:
            return adquisicion.calcular(original, documento, programas)
        except ciber.ErrorLecturaCiber as error:
            raise FormatoInesperado(str(error)) from error
    nativos, auxiliares, indice_hp = _unidades_esperadas(fuente, original, documento, programas)
    capturas = documento["capturas"]
    esperadas = nativos
    # Cada unidad esperada aporta una observación del intento: respuesta o fallo propio.
    recibidas = [c["id"] for c in capturas]
    exigir(
        len(recibidas) == len(esperadas) and set(recibidas) == esperadas,
        "Recepciones sin cobertura exacta de las identidades o canales conocidos",
        FormatoInesperado,
    )
    # Una alta admitida antes y sin instalar sigue siendo conocida aunque el índice de hoy no la traiga.
    admitidas = nativos | censo_indice.altas_pendientes(documento.get("pendientes", []), fuente)
    pendientes = _pendientes_admisibles(documento, admitidas)
    filas = []
    try:
        for cap in [*pendientes, *capturas]:
            extraida = extraer(fuente, original, cap)
            exigir(cap["id"] is None or cap["id"] in admitidas, "Recepción de identidad no censada", FormatoInesperado)
            filas.append({**cap, "lectura": extraida})
    except (hp.ErrorFichaHpLife, ciber.ErrorLecturaCiber, academy.ErrorFichaAcademy) as error:
        raise FormatoInesperado(str(error)) from error
    resultado = {
        "schema_version": 1,
        "fuente_id": fuente,
        "procedencia_sha256": entrada_salida.sha256(original / "procedencia.json"),
        # Las recepciones son la consulta de este intento; las pendientes, consultas
        # admitidas antes cuyo catálogo no llegó a instalarse.
        "recepciones": filas[len(pendientes) :],
        "censo_completo": False,
        "publicacion_confirmada": None,
    }
    if pendientes:
        resultado["pendientes"] = filas[: len(pendientes)]
    _marcar_consulta_parcial(resultado, len(esperadas))
    if auxiliares is not None:
        resultado["auxiliares"] = auxiliares
    if indice_hp is not None:
        resultado["indice"] = indice_hp
        resultado["bajas"] = bajas.decidir(indice_hp, resultado["recepciones"])
        ayuda = gratuidad.estado(documento.get("auxiliares", {}).get("ayuda"), lambda r: leer_conservado(original, r))
        resultado.update({} if ayuda is None else {"gratuidad": ayuda})
    return resultado


def preparar(fuente: str, *, raiz: Path = RAIZ) -> None:
    """Conserva únicamente la extracción completa reproducible de esta fuente."""
    _, preparado, _ = rutas_de_la_fuente(fuente, raiz)
    guardar_json(preparado / "recepciones.json", calcular_recepciones_de_fuente(fuente, raiz))


def validar(fuente: str, *, raiz: Path = RAIZ) -> None:
    """Ejecuta controles reales y admite su conjunto; no evalúa disponibilidad."""
    original, preparado, validado = rutas_de_la_fuente(fuente, raiz)
    programas = conocidos(fuente, raiz)
    if fuente in identidades_de_admision.FUENTES:
        programas = identidades_de_admision.proyectar(fuente, programas)
    calculado = calcular_recepciones_de_fuente(fuente, raiz, programas=programas)
    controles = Controles()
    controles.comprobar(
        calculado == leer_json(preparado / "recepciones.json"), "Extracción reproducida desde cuerpos y recibos"
    )
    controles.comprobar(
        bool(calculado["auxiliares"] if fuente == "fundae" else calculado["recepciones"]),
        "Recepciones no vacías de identidades/canales conocidos",
    )
    controles.comprobar(
        _respuestas_interpretables(fuente, calculado),
        "Recepciones completas con respuesta reconocida por el contrato propio",
    )
    informe = {
        "schema_version": 1,
        "estado": "Admitido" if controles.admitido else "Con errores",
        "controles": controles.lista,
        "conjunto_sha256": hashlib.sha256(json_bytes(calculado)).hexdigest(),
        **({"avisos": avisos(calculado)} if (avisos := AVISOS.get(fuente)) else {}),
    }
    # La CLI se ejecuta desde su copia raíz; la API de prueba no redirige rutas globales de admisión.
    exigir(raiz == RAIZ, "Validación operativa requiere el módulo de esa copia", FormatoInesperado)
    if controles.admitido:
        _apartar_anterior(fuente, raiz, calculado)
        if fuente in identidades_de_admision.FUENTES:
            informe.update(identidades_de_admision.sellar(fuente, programas))
        ref = {"archivo": "procedencia.json", "sha256": calculado["procedencia_sha256"]}
        contenido = leer_conservado(original, ref)
        # Solo la última admisión necesita su índice exacto. Los recibos/intentos
        # permanecen todos en originales; no se clona su lista acumulada por consulta.
        destino = almacen_catalogo.ruta_relativa(
            raiz, (validado / "procedencia-admitida.json").relative_to(raiz).as_posix()
        )
        destino.parent.mkdir(parents=True, exist_ok=True)
        if destino.exists():
            exigir(
                stat.S_ISREG(destino.lstat().st_mode) and destino.stat().st_nlink == 1,
                "Procedencia admitida no regular o con alias",
                FormatoInesperado,
            )
        if not destino.exists() or destino.read_bytes() != contenido:
            escribir_atomico(destino, contenido.decode("utf-8"))
    cerrar_validacion(fuente, informe, controles, conjunto=lambda: calculado, directorio=validado)


def _archivos_instalados(raiz: Path) -> set[str]:
    """SHA de los archivos conservados por el catálogo instalado; sin catálogo, ninguno.

    Returns:
        Huellas de las evidencias que ya forman parte de la instalación.
    """
    area = raiz / almacen_catalogo.RUTA
    if not (area / almacen_catalogo.CONTROL).is_file():
        return set()
    referencia = almacen_catalogo.solicitud(area).procedencia["control-catalogo"]
    contenido = referencia.ruta.read_bytes()
    exigir(
        hashlib.sha256(contenido).hexdigest() == referencia.sha256, "Control del catálogo alterado", FormatoInesperado
    )
    return {p["sha256"] for p in recibos_compartidos.leer_json(contenido)["archivos_conservados"]}


def _capturas_del_conjunto(conjunto: ObjetoJson) -> list[ObjetoJson]:
    capturas = [
        *conjunto.get("recepciones", []),
        *conjunto.get("auxiliares", {}).values(),
        *conjunto.get("paginas_fallidas", []),
        *conjunto.get("fichas", {}).values(),
        *conjunto.get("fichas_de_ediciones", {}).values(),
    ]
    capturas.extend(c["leccion"] for c in list(capturas) if isinstance(c.get("leccion"), dict))
    return [c for c in capturas if isinstance(c, dict) and c.get("recibo") is not None]


def _instalado(fuente: str, conjunto: ObjetoJson, instalados: set[str]) -> bool | None:
    """Comprueba si la instalación conserva la consulta propia de la fuente.

    Returns:
        True si se instaló, False si falta, o None si un ciclo histórico no se puede identificar.
    """
    if fuente == "barcelonactiva":
        from plataforma_datos.cursos.fuentes.barcelonactiva import adquisicion

        return adquisicion.censo_instalado(conjunto, instalados)
    return any(c["recibo"]["sha256"] in instalados for c in _capturas_del_conjunto(conjunto))


def _apartar_anterior(fuente: str, raiz: Path, nuevo: ObjetoJson) -> None:
    """Antes de sustituir la admisión, aparta el conjunto anterior si su catálogo no llegó a instalarse.

    Solo se apartan conjuntos admitidos: un ciclo cuya admisión falló nunca llega aquí.
    Los apartados ya instalados se retiran: sus observaciones constan en el registro. Los que quedan sin instalar
    teniendo un conjunto posterior instalado ya no se podrán aplicar: dejan de ser pendientes y pasan, como evidencia,
    a `superados/`.
    """
    if fuente not in PENDIENTES_POR_CONJUNTO:
        return
    original, _, validado = rutas_de_la_fuente(fuente, raiz)
    carpeta = validado / "pendientes"
    instalados = _archivos_instalados(raiz)
    try:
        anterior = leer_validado(fuente, raiz)
    except FormatoInesperado:
        # Una admisión anterior que ya no se reproduce desde sus pruebas no se arrastra como evidencia.
        anterior = None
    if anterior is not None and anterior != nuevo and not _instalado(fuente, anterior, instalados):
        contenido = json_bytes(anterior)
        carpeta.mkdir(parents=True, exist_ok=True)
        destino = carpeta / (hashlib.sha256(contenido).hexdigest() + ".json")
        if not destino.exists():
            escribir_atomico(destino, contenido.decode("utf-8"))
    apartados = [(ruta, _leer_apartado(ruta)) for ruta in sorted(carpeta.glob("*.json"))] if carpeta.is_dir() else []
    cortes = [
        corte
        for c in (anterior, *(c for _, c in apartados))
        if c is not None and _instalado(fuente, c, instalados) and (corte := _corte_legible(original, c)) is not None
    ]
    for ruta, conjunto in apartados:
        instalado = _instalado(fuente, conjunto, instalados)
        if instalado:
            ruta.unlink()
        elif (
            instalado is False
            and cortes
            and (corte := _corte_legible(original, conjunto)) is not None
            and corte < max(cortes)
        ):
            (validado / "superados").mkdir(exist_ok=True)
            escribir_atomico(validado / "superados" / ruta.name, ruta.read_text(encoding="utf-8"))
            ruta.unlink()


def _corte_legible(original: Path, conjunto: ObjetoJson) -> datetime | None:
    """El corte de un conjunto como instante, o None si no se puede saber con certeza.

    Un conjunto sin capturas, o con un recibo ausente, alterado o ilegible, no tiene corte: ni se aparta ni sirve de
    referencia para apartar otros.

    Returns:
        El instante UTC de su última captura, o None.
    """
    try:
        return datetime.fromisoformat(_corte_del_conjunto(original, conjunto).replace("Z", "+00:00"))
    except (FormatoInesperado, KeyError, TypeError, ValueError, OSError):
        return None


def _leer_apartado(ruta: Path) -> ObjetoJson:
    contenido = ruta.read_bytes()
    exigir(hashlib.sha256(contenido).hexdigest() == ruta.stem, "Conjunto pendiente alterado", FormatoInesperado)
    return recibos_compartidos.leer_json(contenido)


def _corte_del_conjunto(original: Path, conjunto: ObjetoJson) -> str:
    """Fin de la última captura del ciclo: su evaluación no puede ser anterior ni posterior a él.

    Returns:
        Instante UTC con sufijo Z.
    """
    fines = [leer_recibo(original, c)["fin_utc"] for c in _capturas_del_conjunto(conjunto)]
    mayor = max(fines, key=lambda f: datetime.fromisoformat(f.replace("Z", "+00:00")))
    return datetime.fromisoformat(mayor.replace("Z", "+00:00")).isoformat().replace("+00:00", "Z")


def leer_pendientes(fuente: str, raiz: Path) -> list[tuple[str, ObjetoJson]]:
    """Lee los conjuntos admitidos cuyo catálogo no llegó a instalarse, en orden de captura.

    Returns:
        Pares (corte propio, conjunto) aún no instalados; cada uno conserva sus auxiliares.
    """
    original, _, validado = rutas_de_la_fuente(fuente, raiz)
    carpeta = validado / "pendientes"
    if fuente not in PENDIENTES_POR_CONJUNTO or not carpeta.is_dir():
        return []
    instalados = _archivos_instalados(raiz)
    pendientes = []
    for ruta in sorted(carpeta.glob("*.json")):
        conjunto = _leer_apartado(ruta)
        if _instalado(fuente, conjunto, instalados) is False:
            pendientes.append((_corte_del_conjunto(original, conjunto), conjunto))
    return sorted(pendientes, key=lambda p: (datetime.fromisoformat(p[0].replace("Z", "+00:00")), json_bytes(p[1])))


def validado_sin_instalar(fuente: str, raiz: Path) -> ObjetoJson | None:
    """El último conjunto admitido si su catálogo aún no se instaló.

    Returns:
        El conjunto, o None si no hay, no se puede leer o ya está instalado.
    """
    try:
        validado = leer_validado(fuente, raiz)
    except FormatoInesperado:
        return None
    return (
        validado if validado is not None and _instalado(fuente, validado, _archivos_instalados(raiz)) is False else None
    )


def sellar_identidades_historicas(fuente: str, raiz: Path) -> bool:
    """Reproduce una admisión histórica con el catálogo de partida y conserva su contexto y sus fechas.

    El llamador tiene el cerrojo de la actualización o la exclusividad del área candidata.

    Returns:
        Verdadero si se amplió el informe tras reproducir el conjunto y comprobar los originales.
    """
    exigir(fuente in identidades_de_admision.FUENTES, "Fuente sin contexto de censo", FormatoInesperado)
    _, _, validado = rutas_de_la_fuente(fuente, raiz)
    ruta = validado / "validacion.json"
    if not ruta.exists():
        return False
    informe = exigir_admitido(fuente, ruta=ruta)
    if identidades_de_admision.leer(fuente, informe) is not None:
        return False
    programas = identidades_de_admision.proyectar(fuente, conocidos(fuente, raiz))
    _leer_validado(fuente, raiz, programas)
    from plataforma_datos.cursos.migracion_admisiones_censos import exigir_informe_fuera_del_paquete

    exigir_informe_fuera_del_paquete(raiz, ruta)
    ampliado = {**informe, **identidades_de_admision.sellar(fuente, programas)}
    escribir_atomico(ruta, json.dumps(ampliado, ensure_ascii=False, indent=2) + "\n")
    return True


def leer_validado(fuente: str, raiz: Path) -> ObjetoJson | None:
    """Lee el último conjunto admitido; ausencia no se transforma en una oferta vacía.

    Returns:
        Conjunto privado o None si nunca se admitió esa fuente.
    """
    return _leer_validado(fuente, raiz, None)


def _leer_validado(fuente: str, raiz: Path, historicas: identidades_de_admision.Programas | None) -> ObjetoJson | None:
    original, _, validado = rutas_de_la_fuente(fuente, raiz)
    if not (validado / "validacion.json").exists():
        return None
    informe = exigir_admitido(fuente, ruta=validado / "validacion.json")
    dato = leer_json(validado / (fuente + ".json"))
    exigir(
        hashlib.sha256(json_bytes(dato)).hexdigest() == informe["conjunto_sha256"],
        "Conjunto de fuente alterado",
        FormatoInesperado,
    )
    exigir(
        _respuestas_interpretables(fuente, dato),
        "Recepción no interpretable como comprobación válida",
        FormatoInesperado,
    )
    procedencia = leer_conservado(
        validado, {"archivo": "procedencia-admitida.json", "sha256": dato["procedencia_sha256"]}
    )
    if fuente in identidades_de_admision.FUENTES:
        programas = identidades_de_admision.leer(fuente, informe)
        if programas is None:
            programas = conocidos(fuente, raiz) if historicas is None else historicas
    if fuente == "barcelonactiva":
        from plataforma_datos.cursos.fuentes.barcelonactiva import lectura_censo

        documento = recibos_compartidos.leer_json(procedencia)
        coincide = lectura_censo.reproduce(original, documento, programas, dato)
        exigir(coincide, "Censo Cibernàrium admitido distinto de sus pruebas", FormatoInesperado)
        return dato
    if fuente == "fundae":
        from plataforma_datos.cursos.fuentes.fundae import adquisicion

        reproducido = adquisicion.calcular(
            original,
            recibos_compartidos.leer_json(procedencia),
            programas,
        )
        reproducido["procedencia_sha256"] = dato["procedencia_sha256"]
        exigir(reproducido == dato, "Catálogos FUNDAE admitidos distintos de sus pruebas", FormatoInesperado)
        return dato
    if fuente == "cibervoluntarios":
        from plataforma_datos.cursos.fuentes.cibervoluntarios import adquisicion

        reproducido = adquisicion.calcular(
            original,
            recibos_compartidos.leer_json(procedencia),
            programas,
        )
        # La selección admitida conserva su índice propio, aunque originales ya
        # contenga un intento posterior fallido. Los cuerpos/recibos siguen íntegros.
        reproducido["procedencia_sha256"] = dato["procedencia_sha256"]
        exigir(reproducido == dato, "Censo Ciber admitido distinto de sus pruebas", FormatoInesperado)
        return dato
    if fuente == "claude_academy":
        from plataforma_datos.cursos.fuentes.claude_academy import adquisicion

        exigir(
            adquisicion.interpretar_auxiliares(original, dato["auxiliares"]) == dato["auxiliares"],
            "Auxiliares admitidos distintos",
            FormatoInesperado,
        )
    if fuente == "hp_life":
        propias = recibos_compartidos.leer_json(procedencia).get("auxiliares", {})
        reproduce = censo_indice.reproduce(propias, lambda ref: leer_conservado(original, ref), dato)
        exigir(reproduce, "Censo HP admitido distinto de sus pruebas", FormatoInesperado)
    for fila in [*dato.get("pendientes", []), *dato["recepciones"]]:
        exigir(extraer(fuente, original, fila) == fila["lectura"], "Extracción admitida distinta", FormatoInesperado)
    return dato


def main(fuente: str, argv: list[str] | None = None) -> int:
    """Conecta las etapas al mismo ejecutor, recepción y tratamiento de errores comunes.

    Returns:
        Código de la etapa, sin publicar ni activar el catálogo.
    """
    return principal_fuente_con_descarga(
        __doc__,
        lambda aceptar: descargar(fuente, aceptar),
        {"preparar": lambda: preparar(fuente), "validar": lambda: validar(fuente)},
        argv,
    )
