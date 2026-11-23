"""Proyección privada de decisiones conservadas; no evalúa, publica ni consulta fuentes.

Se produce una vez al cerrar mantenimiento desde la instantánea admitida. El panel
recibe solo metadatos y referencias compartidas; nunca cuerpos ni historial.
"""

import hashlib
import json
import re
import sqlite3
from contextlib import closing
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

from plataforma_datos.comun.huella_json import sha256_json
from plataforma_datos.cursos import admision_catalogo as admision
from plataforma_datos.cursos import almacen_catalogo as almacen
from plataforma_datos.cursos import registro_vigencia as registro
from plataforma_datos.cursos import vigencia
from plataforma_datos.cursos.contrato_entrega_catalogo import exigir

VERSION = 1
MAX_BYTES = 4 * 1024 * 1024
MAX_UNIDADES = 10_000
MAX_REFERENCIAS = 10_000
MAX_REFERENCIAS_UNIDAD = 128
MAX_TEXTO = 2048
SHA = re.compile(r"[0-9a-f]{64}")
# `comprobacion-caducada` ya no se produce, pero el registro puede conservar como última una
# evaluación anterior hasta reevaluarla; el panel la muestra tal cual, sin reinterpretarla.
DECISIONES = {
    "disponible-publicamente",
    "no-disponible-publicamente",
    "apertura-futura",
    "sin-confirmar",
    "comprobacion-caducada",
}
CAMPOS = {
    "version",
    "snapshotSha256",
    "admisionSha256",
    "evaluadorSha256",
    "corteRegistro",
    "corteProyeccion",
    "publicacionConfirmada",
    "referencias",
    "unidades",
    "revision",
}
CAMPOS_UNIDAD = {
    "tipo",
    "id",
    "programaId",
    "titulo",
    "url",
    "parametrosOmitidos",
    "fuenteId",
    "estadoRegistro",
    "motivoRegistro",
    "motivoRetencion",
    "decision",
    "motivos",
    "comprobadoEl",
    "cierraEl",
    "revisarEl",
    "ultimoIntentoFallidoEl",
    "incidenciaEnlace",
    "ultimoIntentoEl",
    "ultimoFinEl",
    "evaluadoEl",
    "evaluadorSha256",
    "schemaEvaluacion",
    "politicaVersion",
    "politicaSha256",
    "referencias",
}
TIPOS_INCIDENCIA = {"no_encontrado", "otra_identidad", "redireccion_sin_identidad"}
CAMPOS_REFERENCIA = {"tipo", "url", "parametrosOmitidos", "documento", "sha256", "alcance", "fecha"}


def _url(valor: str) -> tuple[str, bool]:
    """Retira todos los parámetros/fragmentos, no solo una lista incompleta de tokens.

    Returns:
        Dirección presentable y señal de omisión; SHA y fecha conservan la captura exacta.
    """
    exigir(isinstance(valor, str) and 0 < len(valor) <= MAX_TEXTO, "URL privada no presentable")
    partes = urlsplit(valor)
    exigir(
        partes.scheme in {"http", "https"} and partes.hostname and not partes.username and not partes.password,
        "URL privada no presentable",
    )
    exigir(not re.search(r"[\\\x00-\x20\x7f]", valor), "URL privada inválida")
    return urlunsplit((partes.scheme, partes.netloc, partes.path, "", "")), bool(partes.query or partes.fragment)


def _referencia(evidencia: dict) -> dict | None:
    if evidencia.get("url") is not None:
        url, omitidos = _url(evidencia["url"])
        return {
            "tipo": "remota",
            "url": url,
            "parametrosOmitidos": omitidos,
            "documento": None,
            "sha256": evidencia["sha256"],
            "alcance": evidencia["alcance"],
            "fecha": evidencia["capturado_utc"],
        }
    documento = evidencia.get("documento_id")
    if isinstance(documento, str) and re.fullmatch(r"[a-zA-Z0-9:._-]{1,200}", documento):
        return {
            "tipo": "interna",
            "url": None,
            "parametrosOmitidos": False,
            "documento": documento,
            "sha256": evidencia["sha256"],
            "alcance": evidencia["alcance"],
            "fecha": None,
        }
    return None


def _evidencias_actuales(evaluacion: dict) -> list[dict]:
    """Últimos intentos por canal y apoyo de la comprobación vigente, sin volcar el historial.

    Returns:
        Referencias de esos eventos, deduplicables por su contenido completo.
    """
    observaciones = evaluacion["entradas"]["observaciones"]
    resultado = evaluacion["resultado"]
    capturas = resultado["trazabilidad"].get("capturas", {})
    elegidas = set()
    for tipo in {o["tipo"] for o in observaciones}:
        propias = [o for o in observaciones if o["tipo"] == tipo]
        ultimo = max((vigencia.instante_utc(o["terminado_el"], "fin de intento") for o in propias), default=None)
        elegidas.update(
            o["id"] for o in propias if vigencia.instante_utc(o["terminado_el"], "fin de intento") == ultimo
        )
    if resultado["comprobado_el"] is not None:
        elegidas.update(
            o["id"]
            for o in observaciones
            if capturas.get(o["id"], {}).get("comprobado_el") == resultado["comprobado_el"]
        )
    return [e for o in observaciones if o["id"] in elegidas for e in o["evidencias"]]


def _incidencia(valor: dict | None) -> dict | None:
    """Traslada la incidencia del enlace al panel: avisa, no cambia la decisión.

    Returns:
        Fecha, origen (ficha o catálogo), tipo y código HTTP, o None si no hay incidencia pendiente.
    """
    if valor is None:
        return None
    return {"el": valor["el"], "origen": valor["origen"], "tipo": valor["tipo"], "codigoHttp": valor["codigo_http"]}


def _fila(estado: dict, identidad: dict, referencias: list, indice: dict) -> dict:
    evaluacion = estado["evaluacion"]
    resultado = evaluacion["resultado"] if evaluacion is not None else {}
    ids = []
    for evidencia in _evidencias_actuales(evaluacion) if evaluacion is not None else []:
        ref = _referencia(evidencia)
        if ref is None:
            continue
        clave = sha256_json(ref)
        if clave not in indice:
            indice[clave] = len(referencias)
            referencias.append(ref)
        if indice[clave] not in ids:
            ids.append(indice[clave])
    exigir(len(ids) <= MAX_REFERENCIAS_UNIDAD, "Demasiadas referencias pertinentes de unidad")
    unidad = estado["unidad"]
    direccion = evaluacion["entradas"]["oferta"]["url"] if evaluacion is not None else None
    if direccion is None and unidad["tipo"] == "recurso":
        direccion = identidad["url"]
    url, omitidos = _url(direccion) if direccion is not None else (None, False)
    politica = evaluacion["entradas"]["politica"] if evaluacion is not None else None
    return {
        "tipo": unidad["tipo"],
        "id": unidad["id"],
        "programaId": identidad["programa_id"],
        "titulo": identidad["titulo"],
        "url": url,
        "parametrosOmitidos": omitidos,
        "fuenteId": evaluacion["entradas"]["oferta"]["fuente_id"] if evaluacion is not None else None,
        "estadoRegistro": estado["estado_registro"],
        "motivoRegistro": estado["motivo"],
        "decision": resultado.get("estado"),
        "motivos": resultado.get("motivos", []),
        "comprobadoEl": resultado.get("comprobado_el"),
        "cierraEl": resultado.get("cierra_el"),
        # Avisos del panel: la revisión interna y el último fallo no cambian la decisión.
        "revisarEl": resultado.get("revisar_el"),
        "ultimoIntentoFallidoEl": resultado.get("ultimo_intento_fallido_el"),
        "incidenciaEnlace": _incidencia(resultado.get("incidencia_enlace")),
        "ultimoIntentoEl": resultado.get("ultimo_intento_el"),
        "ultimoFinEl": resultado.get("ultimo_fin_el"),
        "evaluadoEl": evaluacion["corte_utc"] if evaluacion is not None else None,
        "evaluadorSha256": evaluacion["evaluador"]["sha256"] if evaluacion is not None else None,
        "schemaEvaluacion": evaluacion["schema_version"] if evaluacion is not None else None,
        "politicaVersion": politica["version"] if politica is not None else None,
        "politicaSha256": sha256_json(politica) if politica is not None else None,
        "referencias": ids,
    }


def desde_admision(solicitud: admision.SolicitudAdmision, sha256_admision: str, *, corte_utc: str) -> dict:
    """Produce una observación privada explícita; no pertenece a cada petición web.

    Returns:
        Colección completa ligada a la instantánea y al informe admitido, sin autoridad de publicación.
    """
    from plataforma_datos.cursos.entrega_catalogo import estado_interno_de_unidad
    from plataforma_datos.cursos.seleccion_entrega_catalogo import motivo_de_retencion

    vigencia.instante_utc(corte_utc, "corte explícito de proyección")
    admision.exigir_snapshot_admitido(solicitud, sha256_validacion=sha256_admision)
    referencias, indice, unidades, estados = [], {}, [], []
    with closing(sqlite3.connect(solicitud.snapshot.ruta.as_uri() + "?mode=ro&immutable=1", uri=True)) as conexion:
        conexion.row_factory = sqlite3.Row
        programas = {
            f["id"]: {**dict(f), "programa_id": f["id"]}
            for f in conexion.execute("SELECT id,titulo,url FROM programas")
        }
        ediciones = {
            f["id"]: programas[f["programa_id"]] for f in conexion.execute("SELECT id,programa_id FROM ediciones")
        }
        for tipo, entidades in (("recurso", programas), ("edicion", ediciones)):
            cursor, revision = None, None
            while True:
                pagina = registro.listar_unidades(
                    solicitud.snapshot.ruta, tipo=tipo, limite=100, despues_de=cursor, revision_esperada=revision
                )
                exigir(pagina["estado_registro"] == "disponible", "Registro privado no disponible")
                revision = pagina["revision"]
                for fila in pagina["unidades"]:
                    unidades.append(_fila(fila, entidades[fila["unidad"]["id"]], referencias, indice))
                    estados.append(estado_interno_de_unidad(fila, corte_utc))
                exigir(
                    len(unidades) <= MAX_UNIDADES and len(referencias) <= MAX_REFERENCIAS, "Proyección privada excesiva"
                )
                cursor = pagina["siguiente"]
                if cursor is None:
                    break
    corte = max(
        (f["evaluadoEl"] for f in unidades if f["evaluadoEl"] is not None),
        default=None,
        key=lambda f: vigencia.instante_utc(f, "corte de evaluación"),
    )
    for fila, estado in zip(unidades, estados, strict=True):
        fila["motivoRetencion"] = motivo_de_retencion(estado, corte_utc)
    salida = {
        "version": VERSION,
        "snapshotSha256": solicitud.snapshot.sha256,
        "admisionSha256": sha256_admision,
        "evaluadorSha256": registro.firma_evaluador()["sha256"],
        "corteRegistro": corte,
        "corteProyeccion": corte_utc,
        "publicacionConfirmada": None,
        "referencias": referencias,
        "unidades": unidades,
    }
    salida["revision"] = sha256_json(salida)
    validar(salida)
    admision.exigir_snapshot_admitido(solicitud, sha256_validacion=sha256_admision)
    return salida


def crear(raiz: Path, *, corte_utc: str) -> dict | None:
    """Lee la única casa bajo el cerrojo común; ausencia significa desconocido.

    Returns:
        Proyección de la misma instantánea admitida, o None si nunca se inicializó.
    """
    from plataforma_datos.orquestacion.generacion_operativa import sin_recuperacion
    from plataforma_datos.orquestacion.sustitucion import cerrojo

    with cerrojo(raiz):
        sin_recuperacion(raiz)
        area = raiz / almacen.RUTA
        if not area.exists():
            return None
        solicitud = almacen.solicitud(area)
        with solicitud.validacion_destino.open("rb") as archivo:
            sha = hashlib.file_digest(archivo, "sha256").hexdigest()
        return desde_admision(solicitud, sha, corte_utc=corte_utc)


def _texto(valor: object) -> bool:
    return isinstance(valor, str) and 0 < len(valor) <= MAX_TEXTO and not re.search(r"[\x00-\x1f\x7f]", valor)


def _fecha(valor: object) -> None:
    if valor is not None:
        vigencia.instante_utc(valor, "fecha de proyección privada")


def validar(valor: dict) -> None:
    """Contrato privado acotado compartido por productor y recibo; no admite rutas locales."""
    exigir(
        isinstance(valor, dict)
        and set(valor) == CAMPOS
        and type(valor["version"]) is int
        and valor["version"] == VERSION,
        "Formato privado incompatible",
    )
    for campo in ("snapshotSha256", "admisionSha256", "evaluadorSha256", "revision"):
        exigir(isinstance(valor[campo], str) and SHA.fullmatch(valor[campo]), "Huella privada inválida")
    exigir(valor["publicacionConfirmada"] is None, "Una decisión no acredita publicación")
    _fecha(valor["corteRegistro"])
    exigir(valor["corteProyeccion"] is not None, "Falta corte explícito de proyección")
    _fecha(valor["corteProyeccion"])
    exigir(
        valor["corteRegistro"] is None
        or vigencia.instante_utc(valor["corteRegistro"], "registro")
        <= vigencia.instante_utc(valor["corteProyeccion"], "proyección"),
        "Registro posterior a su proyección",
    )
    exigir(
        isinstance(valor["referencias"], list) and len(valor["referencias"]) <= MAX_REFERENCIAS,
        "Referencias privadas excesivas",
    )
    bytes_parciales = 0
    for ref in valor["referencias"]:
        _validar_referencia(ref, valor["corteProyeccion"])
        bytes_parciales += len(json.dumps(ref, ensure_ascii=False, separators=(",", ":")).encode()) + 1
        exigir(bytes_parciales <= MAX_BYTES, "Proyección privada sobre el límite")
    exigir(
        isinstance(valor["unidades"], list) and len(valor["unidades"]) <= MAX_UNIDADES, "Unidades privadas excesivas"
    )
    vistos = set()
    for fila in valor["unidades"]:
        _validar_unidad(fila, valor["corteProyeccion"], len(valor["referencias"]))
        clave = (fila["tipo"], fila["id"])
        exigir(clave not in vistos, "Unidad privada repetida")
        vistos.add(clave)
        bytes_parciales += len(json.dumps(fila, ensure_ascii=False, separators=(",", ":")).encode()) + 1
        exigir(bytes_parciales <= MAX_BYTES, "Proyección privada sobre el límite")
    exigir(
        len(json.dumps(valor, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode()) <= MAX_BYTES,
        "Proyección privada sobre el límite",
    )
    exigir(
        sha256_json({k: v for k, v in valor.items() if k != "revision"}) == valor["revision"],
        "Proyección privada alterada",
    )


def _validar_referencia(ref: dict, corte: str) -> None:
    """Referencia cerrada, presentable y no posterior a la proyección."""
    exigir(isinstance(ref, dict) and set(ref) == CAMPOS_REFERENCIA, "Referencia privada incompatible")
    exigir(
        ref["tipo"] in {"remota", "interna"} and type(ref["parametrosOmitidos"]) is bool,
        "Tipo de referencia incompatible",
    )
    exigir(
        isinstance(ref["sha256"], str) and SHA.fullmatch(ref["sha256"]) and _texto(ref["alcance"]),
        "Referencia sin huella o alcance",
    )
    _fecha(ref["fecha"])
    exigir(
        ref["fecha"] is None
        or vigencia.instante_utc(ref["fecha"], "referencia") <= vigencia.instante_utc(corte, "proyección"),
        "Referencia posterior a la proyección",
    )
    if ref["tipo"] == "remota":
        exigir(
            _url(ref["url"]) == (ref["url"], False) and ref["documento"] is None and ref["fecha"] is not None,
            "Referencia remota no presentable",
        )
    else:
        exigir(
            ref["url"] is None
            and isinstance(ref["documento"], str)
            and re.fullmatch(r"[a-zA-Z0-9:._-]{1,200}", ref["documento"])
            and ref["fecha"] is None,
            "Referencia interna incompatible",
        )


def _validar_unidad(fila: dict, corte: str, numero_referencias: int) -> None:
    """Unidad cerrada sin cuerpos ni fechas atribuidas retrospectivamente."""
    exigir(isinstance(fila, dict) and set(fila) == CAMPOS_UNIDAD, "Unidad privada incompatible")
    exigir(
        fila["tipo"] in {"recurso", "edicion"}
        and all(_texto(fila[k]) for k in ("id", "programaId", "titulo", "motivoRegistro")),
        "Identidad privada inválida",
    )
    exigir(fila["motivoRetencion"] is None or _texto(fila["motivoRetencion"]), "Motivo de retención incompatible")
    exigir(
        (fila["url"] is None or _url(fila["url"]) == (fila["url"], False))
        and type(fila["parametrosOmitidos"]) is bool
        and (fila["url"] is not None or fila["parametrosOmitidos"] is False),
        "URL de unidad privada inválida",
    )
    exigir(
        fila["estadoRegistro"] in {"evaluado", "no_evaluado", "no_disponible"}
        and fila["decision"] in DECISIONES | {None},
        "Decisión privada incompatible",
    )
    exigir(
        isinstance(fila["motivos"], list)
        and len(fila["motivos"]) <= MAX_REFERENCIAS_UNIDAD
        and all(_texto(m) for m in fila["motivos"]),
        "Motivos privados inválidos",
    )
    exigir(
        fila["fuenteId"] is None
        or isinstance(fila["fuenteId"], str)
        and re.fullmatch(r"[a-z0-9_-]{1,80}", fila["fuenteId"]),
        "Fuente privada incompatible",
    )
    exigir(
        fila["evaluadorSha256"] is None
        or isinstance(fila["evaluadorSha256"], str)
        and SHA.fullmatch(fila["evaluadorSha256"]),
        "Firma de evaluación incompatible",
    )
    exigir(
        fila["schemaEvaluacion"] is None
        or type(fila["schemaEvaluacion"]) is int
        and fila["schemaEvaluacion"] in {1, 2},
        "Versión de evaluación incompatible",
    )
    exigir(fila["politicaVersion"] is None or _texto(fila["politicaVersion"]), "Versión de política incompatible")
    exigir(
        fila["politicaSha256"] is None
        or isinstance(fila["politicaSha256"], str)
        and SHA.fullmatch(fila["politicaSha256"]),
        "Huella de política incompatible",
    )
    for campo in (
        "comprobadoEl",
        "cierraEl",
        "revisarEl",
        "ultimoIntentoFallidoEl",
        "ultimoIntentoEl",
        "ultimoFinEl",
        "evaluadoEl",
    ):
        _fecha(fila[campo])
        # Límite publicado y próxima revisión son fechas futuras; el resto, hechos ya ocurridos.
        if campo not in ("cierraEl", "revisarEl") and fila[campo] is not None:
            exigir(
                vigencia.instante_utc(fila[campo], "unidad") <= vigencia.instante_utc(corte, "proyección"),
                "Unidad posterior a la proyección",
            )
    incidencia = fila["incidenciaEnlace"]
    exigir(
        incidencia is None
        or isinstance(incidencia, dict)
        and set(incidencia) == {"el", "origen", "tipo", "codigoHttp"}
        and incidencia["origen"] in {"ficha", "catalogo"}
        and incidencia["tipo"] in TIPOS_INCIDENCIA
        and type(incidencia["codigoHttp"]) is int
        and 100 <= incidencia["codigoHttp"] <= 599,  # noqa: PLR2004 - Rango de códigos HTTP.
        "Incidencia de enlace incompatible",
    )
    if incidencia is not None:
        _fecha(incidencia["el"])
        exigir(
            vigencia.instante_utc(incidencia["el"], "incidencia") <= vigencia.instante_utc(corte, "proyección"),
            "Incidencia posterior a la proyección",
        )
    exigir(
        isinstance(fila["referencias"], list)
        and len(fila["referencias"]) <= MAX_REFERENCIAS_UNIDAD
        and all(type(i) is int and 0 <= i < numero_referencias for i in fila["referencias"]),
        "Vínculos privados inválidos",
    )
