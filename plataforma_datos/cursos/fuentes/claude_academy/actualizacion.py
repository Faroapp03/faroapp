"""Aplica recepciones Academy a la única instantánea admitida, sin red ni ediciones ficticias.

La candidata es descartable hasta la promoción común. Conserva canales históricos,
ancla solo negocio idéntico y renueva disponibilidad desde apoyos reales fechados.
"""

import hashlib
import json
import sqlite3
from contextlib import closing
from copy import deepcopy
from http import HTTPStatus
from pathlib import Path

from plataforma_datos.comun.entrada_salida import guardar_json
from plataforma_datos.comun.huella_json import sha256_json
from plataforma_datos.cursos import admision_catalogo as admision
from plataforma_datos.cursos import almacen_catalogo as almacen
from plataforma_datos.cursos import catalogo, politicas_vigencia
from plataforma_datos.cursos import operacion_fuente as fuente
from plataforma_datos.cursos import registro_vigencia as registro
from plataforma_datos.cursos.atribucion_temporal import PREFIJO, CanalesAtribuidos, ContratoCanal
from plataforma_datos.cursos.contrato_entrega_catalogo import exigir
from plataforma_datos.cursos.fuentes.claude_academy import control_actual, lector
from plataforma_datos.cursos.fuentes.claude_academy import observaciones_vigencia as puente
from plataforma_datos.cursos.fuentes.hp_life.recepciones import fecha_utc

VERSION_APRENDIZAJE = 3

CONTRATO = ContratoCanal(
    id="academy-ficha",
    version=1,
    entidad="programa",
    campos=("/titulo", "/datos/contenido_publicado", "/datos/contenido_huella"),
)
CODIGO = (
    "cursos/fuentes/claude_academy/actualizacion.py",
    "cursos/fuentes/claude_academy/control_actual.py",
    "cursos/fuentes/claude_academy/condiciones_formacion.py",
    "cursos/fuentes/claude_academy/observaciones_vigencia.py",
    "cursos/fuentes/claude_academy/condiciones_publicadas.py",
    "cursos/fuentes/claude_academy/lector.py",
    "cursos/fuentes/claude_academy/acceso_publico.py",
    "cursos/fuentes/claude_academy/adquisicion.py",
    "cursos/fuentes/claude_academy/politica_vigencia_v2.json",
)


def _sha(ruta: Path) -> str:
    with ruta.open("rb") as archivo:
        return hashlib.file_digest(archivo, "sha256").hexdigest()


def firma(conjunto: dict) -> str:
    """Identifica recepción y método; ningún cambio de código acredita consulta.

    Returns:
        SHA del conjunto, contrato, política y evaluador usados en esta aplicación.
    """
    return sha256_json(
        {
            "recepciones": conjunto,
            "contrato": CONTRATO.documento(),
            "evaluador": registro.firma_evaluador()["sha256"],
            "codigo": {n: _sha(admision.RAIZ / "plataforma_datos" / n) for n in CODIGO},
        }
    )


def _canales(conexion: sqlite3.Connection, id: str) -> list[dict]:
    return [
        {
            "entidad": "programa",
            "id": id,
            "canal": r["canal"],
            "evidencias": catalogo.pruebas_del_canal(conexion, r["id"]),
        }
        for r in conexion.execute(
            "SELECT id,canal FROM canales_temporales WHERE id IN (SELECT max(id) FROM canales_temporales "
            "WHERE entidad='programa' AND entidad_id=? GROUP BY canal) ORDER BY canal",
            (id,),
        )
    ]


def _programa(conexion: sqlite3.Connection, ficha: lector.FichaAcademy) -> dict | None:
    id = "claude-academy:" + ficha.id
    fila = conexion.execute("SELECT * FROM programas WHERE id=?", (id,)).fetchone()
    if fila is None:
        return None
    exigir(
        fila["proveedor_id"] == "anthropic" and fila["tipo_unidad"] == "curso" and fila["url"] == ficha.url,
        "Identidad Academy nativa incompatible",
    )
    exigir(
        not conexion.execute("SELECT 1 FROM ediciones WHERE programa_id=? LIMIT 1", (id,)).fetchone(),
        "Academy con ediciones requiere contrato propio; no convertirlo en recurso",
    )
    programa = {k: fila[k] for k in ("id", "proveedor_id", "titulo", "url", "tipo_unidad")}
    programa["datos"] = json.loads(fila["datos"])
    exigir(sha256_json(programa) == fila["huella"], "Huella nativa Academy incoherente")
    return programa


def _lote(programa: dict, pruebas: list[dict], fecha: str) -> dict:
    version = VERSION_APRENDIZAJE if "aprendizaje" in programa["datos"] else 1
    lote = {
        "schema_version": version,
        "observado_utc": fecha,
        "fuente_lote": "claude_academy:recurso:1",
        "proveedores": [],
        "programas": [{**programa, "etiquetas": [], "evidencias": pruebas}],
        "ediciones": [],
    }
    if version == VERSION_APRENDIZAJE:
        lote.update(variantes=[], centros=[], anuncios=[])
    return lote


def _capturas(fila: dict, auxiliares: dict) -> list[dict]:
    return [fila, *auxiliares.values(), *([fila["leccion"]] if isinstance(fila.get("leccion"), dict) else [])]


def _ruta_prueba(inventario: dict, sha: str, defecto: str) -> str:
    return next((n for n, h in sorted(inventario.items()) if h == sha and n.startswith("evidencias/")), defecto)


def _conservar(original: Path, fila: dict, destino: Path, inventario: dict) -> list[dict]:
    if fila.get("cuerpo") is not None:
        _, meta = fuente.pagina_academy(original, fila)
    else:
        recibo = fuente.leer_recibo(original, fila)
        meta = {"url_solicitada": recibo["url"], "recibido_utc": recibo["fin_utc"]}
    salida = []
    for campo, sufijo in (("cuerpo", ".body"), ("recibo", ".recibo.json"), ("metadatos", ".metadatos.json")):
        if fila.get(campo) is None:
            continue
        ref = fila[campo]
        archivo = _ruta_prueba(inventario, ref["sha256"], "evidencias/claude-academy/" + ref["sha256"] + sufijo)
        relativa = archivo.removeprefix("evidencias/")
        prueba = admision.ReferenciaArchivo(ruta=almacen.ruta_relativa(original, ref["archivo"]), sha256=ref["sha256"])
        almacen.copiar_evidencia(prueba, almacen.ruta_relativa(destino / "evidencias", relativa))
        inventario["evidencias/" + relativa] = ref["sha256"]
        salida.append(
            {
                "url": meta["url_solicitada"],
                "capturado_utc": meta["recibido_utc"],
                "sha256": ref["sha256"],
                "archivo": relativa,
            }
        )
    return salida


def _ancla_historica(programa: dict, canales: list[dict], raiz: Path) -> list[dict] | None:
    soporte = programa["datos"].get("soporte_acceso", {})
    if (
        not isinstance(soporte, dict)
        or soporte.get("http") != HTTPStatus.OK
        or soporte.get("HTML_completo") is not True
    ):
        return None
    for prueba in (p for c in canales for p in c["evidencias"]):
        if prueba["url"] != programa["url"] or prueba["capturado_utc"] != soporte.get("recibido_utc"):
            continue
        ruta = almacen.ruta_relativa(raiz, prueba["archivo"])
        cuerpo = almacen.leer_evidencia(ruta, prueba["sha256"], "Ancla histórica Academy alterada")
        meta = {
            "url_solicitada": prueba["url"],
            "url_final": prueba["url"],
            "http": soporte["http"],
            "completo": soporte["HTML_completo"],
            "bytes": len(cuerpo),
            "sha256": prueba["sha256"],
            "archivo": ruta.name,
            "recibido_utc": prueba["capturado_utc"],
        }
        try:
            anterior = lector.extraer_ficha(cuerpo, meta, url_esperada=programa["url"])
        except lector.ErrorFichaAcademy:
            # El mismo canal histórico puede conservar recibos y extractos además del HTML.
            continue
        if anterior.titulo == programa["titulo"] and anterior.contenido == programa["datos"].get("contenido_publicado"):
            return [prueba]
    return None


def _cargar(base: Path, ficha: lector.FichaAcademy, pruebas: list[dict], raiz: Path) -> str | None:
    with closing(sqlite3.connect(base)) as conexion:
        conexion.row_factory = sqlite3.Row
        programa = _programa(conexion, ficha)
        canales = _canales(conexion, "claude-academy:" + ficha.id)
        proveedor_existe = conexion.execute("SELECT 1 FROM proveedores WHERE id=?", ("anthropic",)).fetchone()
    fecha = max((p["capturado_utc"] for p in pruebas), key=fecha_utc)
    if programa is None:
        programa = {
            "id": "claude-academy:" + ficha.id,
            "proveedor_id": "anthropic",
            "titulo": ficha.titulo,
            "url": ficha.url,
            "tipo_unidad": "curso",
            "datos": {"identidad_fuente": {"slug": ficha.id}, "contenido_publicado": ficha.contenido},
        }
        lote = _lote(programa, pruebas, fecha)
        lote["proveedores"] = (
            []
            if proveedor_existe
            else [{"id": "anthropic", "nombre": "Anthropic / Claude Academy", "naturaleza": None, "territorio": None}]
        )
        inicial = {"entidad": "programa", "id": programa["id"], "canal": "academy-ficha-inicial", "evidencias": pruebas}
        catalogo.cargar_lote(base, lote, True, raiz, canales_temporales=[inicial])
        canal = {"entidad": "programa", "id": programa["id"], "canal": CONTRATO.clave, "evidencias": pruebas}
        catalogo.cargar_lote(
            base,
            _lote(programa, pruebas, fecha),
            True,
            raiz,
            canales_temporales=CanalesAtribuidos(canales_por_lote=((inicial, canal),), contratos=(CONTRATO,)),
        )
        return None
    if any(c["canal"].startswith(PREFIJO) and c["canal"] != CONTRATO.clave for c in canales):
        return "contrato_protegido_ajeno_requiere_transicion"
    nuevo = deepcopy(programa)
    nuevo["titulo"] = ficha.titulo
    nuevo["datos"]["contenido_publicado"] = ficha.contenido
    if programa["titulo"] != ficha.titulo or programa["datos"].get("contenido_publicado") != ficha.contenido:
        nuevo["datos"]["contenido_huella"] = sha256_json([ficha.titulo, ficha.contenido])
    anterior = next((c for c in canales if c["canal"] == CONTRATO.clave), None)
    # La consulta nueva pertenece al registro de vigencia. Si el mismo cuerpo
    # conserva el negocio, no vuelve a crear atribuciones/versiones nativas;
    # la fecha y el resultado nuevos siguen en su observación independiente.
    if (
        anterior is not None
        and nuevo == programa
        and {p["sha256"] for p in anterior["evidencias"] if p.get("archivo", "").endswith(".body")}
        == {p["sha256"] for p in pruebas if p.get("archivo", "").endswith(".body")}
    ):
        return None
    anclado = anterior is not None
    if not anclado and nuevo != programa:
        historicas = _ancla_historica(programa, canales, raiz)
        if historicas is None:
            return "contenido_cambiado_sin_ancla_historica_acreditada"
        ancla = {"entidad": "programa", "id": programa["id"], "canal": CONTRATO.clave, "evidencias": historicas}
        unidos = [*canales, ancla]
        pruebas_ancla = [p for c in unidos for p in c["evidencias"]]
        catalogo.cargar_lote(
            base,
            _lote(programa, pruebas_ancla, max((p["capturado_utc"] for p in pruebas_ancla), key=fecha_utc)),
            True,
            raiz,
            canales_temporales=CanalesAtribuidos(canales_por_lote=(tuple(unidos),), contratos=(CONTRATO,)),
        )
    actuales = [c for c in canales if c["canal"] != CONTRATO.clave]
    actuales.append({"entidad": "programa", "id": programa["id"], "canal": CONTRATO.clave, "evidencias": pruebas})
    lote = _lote(nuevo, [p for c in actuales for p in c["evidencias"]], fecha)
    catalogo.cargar_lote(
        base,
        lote,
        True,
        raiz,
        canales_temporales=CanalesAtribuidos(canales_por_lote=(tuple(actuales),), contratos=(CONTRATO,)),
    )
    return None


def _evaluar(base: Path, id: str, nuevas: list[dict], corte: str) -> dict:
    """Registra en una sola evaluación del corte todas las observaciones nuevas de la unidad.

    Returns:
        Evaluación registrada; una misma recepción no se duplica al reevaluarse.
    """
    observaciones = registro.observaciones_hasta(base, tipo="recurso", id=id, corte=corte)
    for observacion in sorted(nuevas, key=lambda o: (fecha_utc(o["terminado_el"]), o["id"])):
        iguales = [o for o in observaciones if o["id"] == observacion["id"]]
        exigir(not iguales or iguales == [observacion], "Observación Academy de la misma recepción en conflicto")
        if not iguales:
            observaciones.append(observacion)
    with closing(sqlite3.connect(base)) as conexion:
        url, huella = conexion.execute("SELECT url,huella FROM programas WHERE id=?", (id,)).fetchone()
    return registro.registrar_unidad(
        base,
        registro.SolicitudEvaluacionUnidad(
            unidad=registro.UnidadEvaluable(tipo="recurso", id=id, huella=huella),
            oferta={"id": id, "fuente_id": "claude_academy", "url": url},
            observaciones=observaciones,
            politica=politicas_vigencia.leer_politica("claude_academy", "2"),
            ahora=corte,
        ),
    )


def _url_conocida(base: Path, id: str) -> str | None:
    with closing(sqlite3.connect(base)) as conexion:
        fila = conexion.execute("SELECT url FROM programas WHERE id=? AND proveedor_id='anthropic'", (id,)).fetchone()
    return fila[0] if fila is not None else None


def _guardar_seleccion(
    destino: Path, control: dict, inventario: dict, recepciones_actuales: list[dict], faq: dict | None
) -> None:
    """Conserva el selector actual en la misma candidata que sus cuerpos y SQLite."""
    if not recepciones_actuales:
        return
    anteriores, faq_previa = {}, None
    if "control-academy" in control["procedencia"]:
        referencias = {
            h: admision.ReferenciaArchivo(ruta=almacen.ruta_relativa(destino, n), sha256=h)
            for n, h in inventario.items()
        }
        ref = control["procedencia"]["control-academy"]
        anterior = almacen.leer_documento_indexado(referencias[ref["sha256"]], referencias)
        control_actual.validar(anterior)
        anteriores = {r["id"]: r for r in anterior["recepciones"]}
        faq_previa = anterior.get("faq")
    anteriores.update({r["id"]: r for r in recepciones_actuales})
    control["procedencia"]["control-academy"] = almacen.archivar_documento(
        fuente.json_bytes(
            {
                "schema_version": 2,
                "fuente_id": "claude_academy",
                "recepciones": [anteriores[k] for k in sorted(anteriores)],
                "faq": {
                    campo + "_sha256": faq[campo]["sha256"]
                    for campo in ("cuerpo", "recibo", "metadatos")
                    if campo in faq
                }
                if faq is not None
                and (not faq["lectura"].get("fallo") or faq["lectura"].get("retener_anterior") is False)
                else faq_previa,
            }
        ),
        destino,
        inventario,
        campos_evento=frozenset({"recepciones", "faq"}),
    )


def _observar(conjunto: dict, original: Path, destino: Path, inventario: dict, resultados: list[dict]) -> dict:
    """Construye por unidad las observaciones nuevas y su selección, sin evaluarlas todavía.

    Returns:
        Observaciones y selección vigente por unidad; los casos sin unidad quedan en resultados.
    """
    base = destino / "catalogo.sqlite3"
    por_unidad: dict[str, dict] = {}
    auxiliares = conjunto["auxiliares"]
    for fila in conjunto["recepciones"]:
        if fuente.fallo_de_consulta(fila["lectura"]):
            # La unidad conserva su última selección; solo se registra el intento fallido.
            url = _url_conocida(base, fila["id"])
            if url is None:
                # Un alta del índice sin respuesta válida no tiene unidad que evaluar todavía.
                resultados.append({"id": fila["id"], "pendiente": "alta_sin_respuesta_valida", "evaluacion": None})
                continue
            _conservar(original, fila, destino, inventario)
            unidad = por_unidad.setdefault(fila["id"], {"observaciones": [], "seleccion": None})
            unidad["observaciones"].append(puente.construir_fallo(original, fila, url))
            continue
        ficha, observacion = puente.construir(original, fila, auxiliares)
        pruebas = None
        for captura in _capturas(fila, auxiliares):
            conservadas = _conservar(original, captura, destino, inventario)
            if captura is fila:
                pruebas = conservadas
        motivo = _cargar(base, ficha, pruebas, destino / "evidencias")
        if motivo:
            resultados.append({"id": fila["id"], "pendiente": motivo, "evaluacion": None})
            continue
        unidad = por_unidad.setdefault(fila["id"], {"observaciones": [], "seleccion": None})
        unidad["observaciones"].append(observacion)
        unidad["seleccion"] = {
            "id": fila["id"],
            "observacion_id": observacion["id"],
            **{
                campo + "_sha256": fila[campo]["sha256"] for campo in ("cuerpo", "recibo", "metadatos") if campo in fila
            },
        }
    return por_unidad


def aplicar(entrada: almacen.EntradaCatalogo, *, conjunto: dict, original: Path, destino: Path, corte: str) -> dict:
    """Produce una instantánea cerrada con evidencias únicas y recibo compacto de esta admisión.

    No cambia el origen ni ofrece por mera incorporación. Los casos sin ancla quedan
    pendientes explícitos; un error interno aborta toda esta candidata de fuente.

    Returns:
        Control admitido de la nueva instantánea, con aplicación identificada por fuente.
    """
    control = almacen.conservar(entrada, destino=destino)
    inventario = {p["archivo"]: p["sha256"] for p in control["archivos_conservados"]}
    resultados = []
    recepciones_actuales = []
    base = destino / "catalogo.sqlite3"
    por_unidad = _observar(conjunto, original, destino, inventario, resultados)
    for id, unidad in por_unidad.items():
        evaluacion = _evaluar(base, id, unidad["observaciones"], corte)
        resultados.append({"id": id, "pendiente": None, "evaluacion": evaluacion})
        if evaluacion["actual"] and unidad["seleccion"] is not None:
            recepciones_actuales.append(unidad["seleccion"])
    firmas_codigo = {}
    for nombre in CODIGO:
        origen = admision.RAIZ / "plataforma_datos" / nombre
        sha = _sha(origen)
        relativa = _ruta_prueba(inventario, sha, "evidencias/codigo/" + sha + ".ref")
        almacen.copiar_evidencia(admision.ReferenciaArchivo(ruta=origen, sha256=sha), destino / relativa)
        inventario[relativa] = sha
        firmas_codigo[nombre] = sha
    huella = firma(conjunto)
    recibo = {
        "schema_version": 1,
        "fuente_id": "claude_academy",
        "metodo": puente.METODO,
        "conjunto_sha256": sha256_json(conjunto),
        "firma_aplicacion": huella,
        "snapshot_entrada_sha256": entrada.admision.snapshot.sha256,
        "snapshot_salida_sha256": _sha(destino / "catalogo.sqlite3"),
        "corte_evaluacion_utc": corte,
        "contrato": CONTRATO.documento(),
        "codigo": firmas_codigo,
        "resultados": resultados,
    }
    control["procedencia"]["recibo-academy"] = almacen.archivar_documento(
        fuente.json_bytes(recibo),
        destino,
        inventario,
        campos_evento=frozenset(
            {
                "conjunto_sha256",
                "firma_aplicacion",
                "snapshot_entrada_sha256",
                "snapshot_salida_sha256",
                "corte_evaluacion_utc",
                "resultados",
            }
        ),
    )
    _guardar_seleccion(destino, control, inventario, recepciones_actuales, conjunto["auxiliares"].get("faq"))
    control["snapshot_sha256"] = recibo["snapshot_salida_sha256"]
    control["archivos_conservados"] = [{"archivo": n, "sha256": h} for n, h in sorted(inventario.items())]
    # Un corte histórico puede registrar información sin sustituir el corte
    # actual. No cachear ese trabajo como si ya hubiera actualizado la fuente.
    if resultados and all(r["evaluacion"] is not None and r["evaluacion"]["actual"] for r in resultados):
        control["aplicados_por_fuente"]["claude_academy"] = huella
    guardar_json(destino / almacen.CONTROL, control)
    admision.admitir_snapshot(almacen.solicitud(destino))
    return control
