"""Aplica Ciber en candidata cerrada; nunca modifica capturas o la instantánea de entrada.

Actualiza campos atribuidos e incorpora nuevas identidades solo con oferta
acreditada. El alias Fundae conserva todo su negocio; sin vínculo actual de su
URL no se renueva su observación directa.
"""

import hashlib
import json
import re
import sqlite3
from contextlib import closing
from copy import deepcopy
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from urllib.parse import quote

from plataforma_datos.comun.entrada_salida import guardar_json
from plataforma_datos.comun.huella_json import sha256_json
from plataforma_datos.cursos import admision_catalogo as admision
from plataforma_datos.cursos import almacen_catalogo as almacen
from plataforma_datos.cursos import catalogo, oferta_continua
from plataforma_datos.cursos import operacion_fuente as fuente
from plataforma_datos.cursos import registro_vigencia as registro
from plataforma_datos.cursos.atribucion_temporal import PREFIJO, CanalesAtribuidos, ContratoCanal
from plataforma_datos.cursos.contrato_entrega_catalogo import exigir
from plataforma_datos.cursos.fuentes.cibervoluntarios import (
    adquisicion,
    control_actual,
    evaluacion,
    lector,
    metodo_interfaz,
    sin_material,
)
from plataforma_datos.cursos.fuentes.cibervoluntarios import observaciones_vigencia as puente

VERSION_APRENDIZAJE = 3

CONTRATO = ContratoCanal(
    id="ciber-material",
    version=1,
    entidad="programa",
    campos=(
        "/titulo",
        "/datos/actividad_publicada",
        "/datos/material_publicado",
        "/datos/idioma_literal",
        "/datos/tipo_actividad_publicado",
        "/datos/tipo_material_publicado",
        "/datos/soporte_acceso",
        "/datos/destinatario_publicado",
    ),
)
CODIGO = tuple(
    "cursos/fuentes/cibervoluntarios/" + n
    for n in (
        "actualizacion.py",
        "adquisicion.py",
        "bajas.py",
        "control_actual.py",
        "declaraciones_publicadas.py",
        "destinos.py",
        "direcciones.py",
        "evaluacion.py",
        "lector.py",
        "metodo_interfaz.py",
        "observaciones_vigencia.py",
        "politica_vigencia_v3.json",
        "retiradas.py",
        "rutas_publicas.py",
        "sin_material.py",
    )
)


def _sha(ruta: Path) -> str:
    with ruta.open("rb") as archivo:
        return hashlib.file_digest(archivo, "sha256").hexdigest()


def firma(conjunto: dict) -> str:
    """Identifica pruebas y código; una nueva firma no inventa consulta.

    Returns:
        Firma determinista de la aplicación y su evaluador/política propios.
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
    canales = [
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

    return canales


def _programas(base: Path) -> list[dict]:
    with closing(sqlite3.connect(base)) as conexion:
        conexion.row_factory = sqlite3.Row
        salida = []
        for fila in conexion.execute(
            "SELECT * FROM programas WHERE proveedor_id='cibervoluntarios' OR id='fundae:1:3462' ORDER BY id"
        ):
            programa = {k: fila[k] for k in ("id", "proveedor_id", "titulo", "url", "tipo_unidad")}
            programa["datos"] = json.loads(fila["datos"])
            exigir(sha256_json(programa) == fila["huella"], "Huella Ciber incoherente")
            exigir(
                not conexion.execute("SELECT 1 FROM ediciones WHERE programa_id=? LIMIT 1", (fila["id"],)).fetchone(),
                "Ciber con edición requiere contrato específico",
            )
            salida.append(programa)
    return salida


def _lote(programa: dict, pruebas: list[dict], fecha: str) -> dict:
    version = VERSION_APRENDIZAJE if "aprendizaje" in programa["datos"] else 1
    lote = {
        "schema_version": version,
        "observado_utc": fecha,
        "fuente_lote": "cibervoluntarios:material:1",
        "proveedores": [],
        "programas": [{**programa, "etiquetas": [], "evidencias": pruebas}],
        "ediciones": [],
    }
    if version == VERSION_APRENDIZAJE:
        lote.update(variantes=[], centros=[], anuncios=[])
    return lote


@lru_cache(maxsize=20)
def _materiales_historicos(ruta: Path, sha: str, url: str, fecha: str) -> tuple[lector.MaterialCiber, ...]:
    cuerpo = almacen.leer_evidencia(ruta, sha, "Ancla histórica Ciber alterada")
    return lector.extraer_materiales(
        cuerpo,
        lector.CapturaCiber(
            url=url,
            sha256=sha,
            bytes_cuerpo=len(cuerpo),
            inicio_utc=fecha,
            recibido_utc=fecha,
            http=200,
            completo=True,
            localizador="/hydra:member",
        ),
    )


def titulo_visible(material: lector.MaterialCiber) -> str:
    """Conserva la regla visible ya aplicada al importar, sin cambiar el literal.

    Returns:
        Espacios colapsados; material_publicado.title conserva el texto exacto fuente.
    """
    exigir(isinstance(material.titulo, str), "Título material Ciber no textual")
    visible = " ".join(material.titulo.split())
    catalogo.exigir_texto(visible, "título visible Ciber")
    return visible


def _ancla(programa: dict, canales: list[dict], raiz: Path) -> list[dict] | None:
    soporte = programa["datos"].get("soporte_acceso", {})
    for prueba in (p for c in canales for p in c["evidencias"]):
        if prueba["url"] != soporte.get("url_api") or prueba["capturado_utc"] != soporte.get("recibido_utc"):
            continue
        try:
            materiales = _materiales_historicos(
                almacen.ruta_relativa(raiz, prueba["archivo"]), prueba["sha256"], prueba["url"], prueba["capturado_utc"]
            )
        except lector.ErrorLecturaCiber:
            # Los canales conservan también recibos/extractos, que no son una página API.
            continue
        for material in materiales:
            if (
                programa["id"] == "cibervoluntarios:material:" + str(material.id)
                and material.material_publicado == programa["datos"].get("material_publicado")
                and material.actividad_publicada == programa["datos"].get("actividad_publicada")
                and titulo_visible(material) == programa["titulo"]
            ):
                return [prueba]
    return None


def _con_material(programa: dict, material: lector.MaterialCiber) -> dict:
    nuevo = deepcopy(programa)
    nuevo["titulo"] = titulo_visible(material)
    nuevo["datos"].update(
        actividad_publicada=material.actividad_publicada,
        material_publicado=material.material_publicado,
        idioma_literal=material.idioma_publicado,
        tipo_actividad_publicado=material.tipo_actividad,
        tipo_material_publicado=material.tipo_material,
    )
    nuevo["datos"]["soporte_acceso"] = {
        "canal": "api_catalogo_material",
        "entidad": "material",
        "id_material": material.id,
        "id_actividad": material.actividad_id,
        "slug_publicado": material.slug,
        "url": programa["url"],
        "url_api": material.captura.url,
        "http": material.captura.http,
        "recibido_utc": material.captura.recibido_utc,
        "url_destino_publicada": material.material_publicado.get("moodleLink"),
        "estado_literal": material.material_publicado.get("status"),
        "alcance": (
            "Contenido del material; acceso por método público revisado, no lectura de aula ni admisión personal"
        ),
    }
    nuevo["datos"]["destinatario_publicado"] = {
        "texto_publicado": puente.texto_publicado(material.material_publicado.get("paraTiContent")),
        "restriccion_exclusiva": None,
        "evidencia": {
            "url": material.captura.url,
            "capturado_utc": material.captura.recibido_utc,
            "sha256": material.captura.sha256,
            "localizador": material.localizador + "/paraTiContent",
        },
    }
    return nuevo


def _cargar(base: Path, programa: dict, material: lector.MaterialCiber, pruebas: list[dict], raiz: Path) -> str | None:
    with closing(sqlite3.connect(base)) as conexion:
        conexion.row_factory = sqlite3.Row
        canales = _canales(conexion, programa["id"])

    if any(c["canal"].startswith(PREFIJO) and c["canal"] != CONTRATO.clave for c in canales):
        return "contrato_protegido_ajeno_requiere_transicion"
    if not any(c["canal"] == CONTRATO.clave for c in canales):
        antiguas = _ancla(programa, canales, raiz)
        if antiguas is None:
            return "negocio_anterior_sin_ancla_historica_acreditada"
        ancla = {"entidad": "programa", "id": programa["id"], "canal": CONTRATO.clave, "evidencias": antiguas}
        unidos = [*canales, ancla]
        catalogo.cargar_lote(
            base,
            _lote(programa, [p for c in unidos for p in c["evidencias"]], material.captura.recibido_utc),
            True,
            raiz,
            canales_temporales=CanalesAtribuidos(canales_por_lote=(tuple(unidos),), contratos=(CONTRATO,)),
        )
    nuevo = _con_material(programa, material)
    anterior = next((c for c in canales if c["canal"] == CONTRATO.clave), None)
    if (
        anterior is not None
        and nuevo == programa
        and sorted(anterior["evidencias"], key=sha256_json) == sorted(pruebas, key=sha256_json)
    ):
        return None
    actuales = [c for c in canales if c["canal"] != CONTRATO.clave]
    actuales.append({"entidad": "programa", "id": programa["id"], "canal": CONTRATO.clave, "evidencias": pruebas})
    catalogo.cargar_lote(
        base,
        _lote(nuevo, [p for c in actuales for p in c["evidencias"]], material.captura.recibido_utc),
        True,
        raiz,
        canales_temporales=CanalesAtribuidos(canales_por_lote=(tuple(actuales),), contratos=(CONTRATO,)),
    )
    return None


def _referencias(fila: dict) -> dict:
    return {campo + "_sha256": fila[campo]["sha256"] for campo in ("cuerpo", "recibo", "metadatos")}


def _guardar_seleccion(destino: Path, control: dict, inventario: dict, filas: list[dict], contextos: dict) -> None:
    anteriores = {}
    if "control-ciber" in control["procedencia"]:
        referencias = {
            h: admision.ReferenciaArchivo(ruta=almacen.ruta_relativa(destino, n), sha256=h)
            for n, h in inventario.items()
        }
        ref = control["procedencia"]["control-ciber"]
        anterior = almacen.leer_documento_indexado(referencias[ref["sha256"]], referencias)
        control_actual.validar(anterior)
        anteriores = {r["id"]: r for r in anterior["recepciones"]}
        contextos = {**anterior["contextos"], **contextos}
    anteriores.update({r["id"]: r for r in filas})
    if not anteriores:
        return
    usados = {r["contexto_sha256"] for r in anteriores.values()}
    documento = {
        "schema_version": 1,
        "fuente_id": "cibervoluntarios",
        "recepciones": [anteriores[k] for k in sorted(anteriores)],
        "contextos": {k: contextos[k] for k in sorted(usados)},
    }
    control_actual.validar(documento)
    control["procedencia"]["control-ciber"] = almacen.archivar_documento(
        fuente.json_bytes(documento),
        destino,
        inventario,
        campos_evento=frozenset({"recepciones", "contextos"}),
    )


def seleccionar_material_del_programa(
    programa: dict, materiales: dict[int, tuple], seleccionados: set[int], ctx: dict
) -> tuple | str:
    """Elige el material actual de un programa por su identidad registrada, o devuelve por qué no puede elegirse.

    Returns:
        El material y su recepción, o el motivo por el que no se elige.
    """
    if programa["id"] == "fundae:1:3462":
        return sin_material.seleccionar_alias(programa, materiales, seleccionados, ctx)
    identidad = programa["datos"].get("identidad_fuente", {})
    id = identidad.get("material_id")
    if id not in materiales:
        return "material_ausente_del_censo_no_renovado"
    material, fila = materiales[id]
    exigir(
        programa["id"] == "cibervoluntarios:material:" + str(id)
        and identidad.get("actividad_id") == material.actividad_id,
        "Identidad Ciber cambiada",
    )
    if programa["url"] != "https://www.cibervoluntarios.org/es/formacion-gratuita/aprende-a-tu-ritmo/cursos/" + quote(
        str(material.slug), safe=""
    ):
        ruta = ctx.get("rutas", {}).get("ruta:" + str(id))
        if not ctx.get("metodo_confirmado") or not adquisicion.rutas_publicas.acredita(
            programa, material, (ruta or {}).get("lectura")
        ):
            return "ruta_actual_distinta_requiere_revision_de_identidad"
    if id not in seleccionados:
        return "material_no_seleccionado_por_interfaz_espanola"
    return material, fila


def contexto_de_unidad(ctx: dict, programa: dict, material: lector.MaterialCiber) -> tuple[dict, str | None]:
    """Vincula cada apoyo adicional únicamente al programa al que pertenece.

    Returns:
        Contexto verificable de esa oferta y nombre del auxiliar que se debe conservar.
    """
    if programa["id"] == "fundae:1:3462":
        return {**ctx, "capturas": {**ctx["capturas"], "alias": ctx["alias"]["captura"]}}, "alias"
    nombre = "ruta:" + str(material.id)
    ruta = ctx.get("rutas", {}).get(nombre)
    if ruta and adquisicion.rutas_publicas.acredita(programa, material, ruta["lectura"]):
        return {
            **ctx,
            "capturas": {**ctx["capturas"], "ruta": ruta["captura"]},
            "localizador_ruta": ruta["lectura"]["localizador"],
        }, nombre
    return ctx, None


def _programa_nuevo(material: lector.MaterialCiber) -> dict:
    return _con_material(
        {
            "id": "cibervoluntarios:material:" + str(material.id),
            "proveedor_id": "cibervoluntarios",
            "titulo": titulo_visible(material),
            "url": "https://www.cibervoluntarios.org/es/formacion-gratuita/aprende-a-tu-ritmo/cursos/"
            + quote(str(material.slug), safe=""),
            "tipo_unidad": "material_autoformacion",
            "datos": {
                "identidad_fuente": {
                    "material_id": material.id,
                    "actividad_id": material.actividad_id,
                    "slug": material.slug,
                },
                "nivel_faro": None,
                "capacidades_revisadas": None,
                "admisibilidad_persona": None,
                "plaza_confirmada_persona": None,
            },
        },
        material,
    )


def _motivo_alta(material: lector.MaterialCiber, seleccionado: bool) -> str | None:
    reglas = (
        (material.id == control_actual.MATERIAL_ALIAS_FUNDAE, "material_reservado_a_identidad_fundae_no_se_duplica"),
        (material.tipo_material != "Autoformación", "tipo_material_fuera_de_autoformacion"),
        (material.idioma_publicado != "Español", "idioma_no_seleccionado_por_ruta_espanola"),
        (not seleccionado, "material_no_seleccionado_por_interfaz_espanola"),
        (
            not isinstance(material.slug, str) or re.fullmatch(r"[\w@-]+", material.slug) is None,
            "ruta_de_material_no_acreditada",
        ),
        (not isinstance(material.titulo, str) or not material.titulo.strip(), "titulo_de_material_no_publicado"),
    )
    return next((motivo for rechazar, motivo in reglas if rechazar), None)


def _preparar_altas(
    programas: list[dict], materiales: dict[int, tuple], seleccionados: set[int], ctx: dict
) -> tuple[list[dict], list[dict]]:
    conocidos = {p["datos"].get("identidad_fuente", {}).get("material_id") for p in programas}
    if any(p["id"] == "fundae:1:3462" for p in programas):
        conocidos.add(control_actual.MATERIAL_ALIAS_FUNDAE)
    nuevas, rechazadas = [], []
    for id, (material, _) in sorted(materiales.items()):
        if id in conocidos:
            continue
        motivo = _motivo_alta(material, id in seleccionados)
        programa = _programa_nuevo(material) if motivo is None else None
        if programa is not None:
            criterios = puente.construir(material, programa=programa, ctx=ctx)["detalle"][oferta_continua.CAMPO][
                "criterios"
            ]
            faltan = [k for k, v in criterios.items() if v["valor"] is not True]
            motivo = "oferta_nueva_no_acreditada:" + ",".join(faltan) if faltan else None
        if motivo is None:
            nuevas.append(programa)
        else:
            rechazadas.append(
                {"id": "cibervoluntarios:material:" + str(id), "alta": False, "pendiente": motivo, "evaluacion": None}
            )
    return nuevas, rechazadas


def _alta(base: Path, programa: dict, pruebas: list[dict], raiz: Path) -> None:
    with closing(sqlite3.connect(base)) as conexion:
        exigir(
            not conexion.execute("SELECT 1 FROM programas WHERE id=?", (programa["id"],)).fetchone(),
            "Identidad nueva Ciber ya existente: no se fusiona ni sustituye proveedor",
        )
        proveedor = conexion.execute("SELECT 1 FROM proveedores WHERE id='cibervoluntarios'").fetchone()
    lote = _lote(programa, pruebas, max(p["capturado_utc"] for p in pruebas))
    if not proveedor:
        lote["proveedores"] = [
            {"id": "cibervoluntarios", "nombre": "Fundación Cibervoluntarios", "naturaleza": None, "territorio": None}
        ]
    inicial = {"entidad": "programa", "id": programa["id"], "canal": "ciber-material-inicial", "evidencias": pruebas}
    catalogo.cargar_lote(base, lote, True, raiz, canales_temporales=[inicial])
    canal = {**inicial, "canal": CONTRATO.clave}
    catalogo.cargar_lote(
        base,
        _lote(programa, pruebas, lote["observado_utc"]),
        True,
        raiz,
        canales_temporales=CanalesAtribuidos(canales_por_lote=((inicial, canal),), contratos=(CONTRATO,)),
    )


def leer_materiales_del_intento(original: Path, conjunto: dict) -> tuple[dict[int, tuple], set[int]]:
    """Carga los materiales del intento y marca los de autoformación publicados en español.

    Returns:
        Los materiales por identificador y los identificadores seleccionados.
    """
    materiales, seleccionados = {}, set()
    for fila in conjunto["recepciones"]:
        actividades = {}
        for material in adquisicion.materiales(original, fila):
            materiales[material.id] = (material, fila)
            if (
                material.idioma_publicado == "Español"
                and material.tipo_material == "Autoformación"
                and material.disponible
            ):
                actividades.setdefault(material.actividad_id, material.id)
        seleccionados.update(actividades.values())
    return materiales, seleccionados


def aplicar(entrada: almacen.EntradaCatalogo, *, conjunto: dict, original: Path, destino: Path, corte: str) -> dict:
    """Prepara una candidata atribuida y admitida, sin publicar ni tocar la entrada.

    Returns:
        Control común; los casos retenidos quedan explícitos, sin nuevos duplicados.
    """
    ctx = puente.contexto(original, conjunto["auxiliares"])
    materiales, seleccionados = leer_materiales_del_intento(original, conjunto)
    control = almacen.conservar(entrada, destino=destino)
    inventario = {p["archivo"]: p["sha256"] for p in control["archivos_conservados"]}
    pruebas_paginas = {
        f["cuerpo"]["sha256"]: evaluacion.conservar(original, f, destino, inventario) for f in conjunto["recepciones"]
    }
    for fila in [*conjunto.get("paginas_fallidas", []), *conjunto.get("fichas", {}).values()]:
        evaluacion.conservar(original, fila, destino, inventario)
    for nombre, cap in conjunto["auxiliares"].items():
        if nombre.startswith("ruta:") and nombre not in ctx["rutas"]:
            continue
        if nombre != "alias" or ctx.get("alias") and ctx["alias"]["vinculado"]:
            evaluacion.conservar(original, cap, destino, inventario)
    programas = _programas(destino / "catalogo.sqlite3")
    nuevas, resultados = _preparar_altas(programas, materiales, seleccionados, ctx)
    consulta = sin_material.Consulta(original, destino / "catalogo.sqlite3", corte, conjunto, materiales)
    ids_nuevos = {p["id"] for p in nuevas}
    filas, contextos = [], {}
    auxiliares = {
        k: _referencias(v) for k, v in conjunto["auxiliares"].items() if k != "alias" and not k.startswith("ruta:")
    }
    for programa in [*programas, *nuevas]:
        seleccionado = seleccionar_material_del_programa(programa, materiales, seleccionados, ctx)
        if isinstance(seleccionado, str):
            resultados.append(sin_material.resolver(consulta, programa, seleccionado))
            continue
        material, fila = seleccionado
        es_alias = programa["id"] == "fundae:1:3462"
        ctx_unidad, adicional = contexto_de_unidad(ctx, programa, material)
        obs = puente.construir(material, programa=programa, ctx=ctx_unidad)
        fallo = puente.fallo_solo_de_interfaz(
            material, obs, ctx_unidad, conjunto["auxiliares"]["componente"]["recibo"]["sha256"]
        )
        # Fundae conserva todo su negocio y sus observaciones anteriores.
        # La fuente directa solo confirma actualmente la misma identidad;
        # sus hechos se reextraen de las pruebas de control-ciber, por origen.
        if programa["id"] in ids_nuevos:
            _alta(
                destino / "catalogo.sqlite3",
                programa,
                pruebas_paginas[fila["cuerpo"]["sha256"]],
                destino / "evidencias",
            )
        # La entrega reproduce la última selección con sus datos nativos. Si el visor
        # falla, la nueva captura queda en el inventario hasta poder verificar la ficha.
        motivo = (
            None
            if fallo is not None or es_alias or programa["id"] in ids_nuevos
            else _cargar(
                destino / "catalogo.sqlite3",
                programa,
                material,
                pruebas_paginas[fila["cuerpo"]["sha256"]],
                destino / "evidencias",
            )
        )
        evaluada = None if motivo else evaluacion.evaluar(destino / "catalogo.sqlite3", programa, [fallo or obs], corte)
        if fallo is not None and not motivo:
            motivo = fallo["detalle"]["motivo"]
        resultados.append({"id": programa["id"], "pendiente": motivo, "evaluacion": evaluada})
        if evaluada is not None and evaluada["actual"] and fallo is None:
            apoyos_unidad = (
                {**auxiliares, adicional: _referencias(conjunto["auxiliares"][adicional])} if adicional else auxiliares
            )
            contexto = {**_referencias(fila), "auxiliares": apoyos_unidad}
            sha = sha256_json(contexto)
            contextos[sha] = contexto
            filas.append(
                {"id": programa["id"], "material_id": material.id, "observacion_id": obs["id"], "contexto_sha256": sha}
            )
    return _cerrar(entrada, destino, conjunto, corte, _Aplicacion(control, inventario, resultados, filas, contextos))


@dataclass(frozen=True)
class _Aplicacion:
    control: dict
    inventario: dict
    resultados: list[dict]
    filas: list[dict]
    contextos: dict


def _cerrar(entrada: almacen.EntradaCatalogo, destino: Path, conjunto: dict, corte: str, estado: _Aplicacion) -> dict:
    control, inventario = estado.control, estado.inventario
    resultados, filas, contextos = estado.resultados, estado.filas, estado.contextos
    firmas = {}
    for nombre in CODIGO:
        origen = admision.RAIZ / "plataforma_datos" / nombre
        sha = _sha(origen)
        relativa = next((n for n, h in inventario.items() if h == sha), "evidencias/codigo/" + sha + ".ref")
        almacen.copiar_evidencia(admision.ReferenciaArchivo(ruta=origen, sha256=sha), destino / relativa)
        inventario[relativa], firmas[nombre] = sha, sha
    huella = firma(conjunto)
    recibo = {
        "schema_version": 1,
        "fuente_id": "cibervoluntarios",
        "metodo": metodo_interfaz.METODO,
        "conjunto_sha256": sha256_json(conjunto),
        "firma_aplicacion": huella,
        "snapshot_entrada_sha256": entrada.admision.snapshot.sha256,
        "snapshot_salida_sha256": _sha(destino / "catalogo.sqlite3"),
        "corte_evaluacion_utc": corte,
        "contrato": CONTRATO.documento(),
        "codigo": firmas,
        "resultados": resultados,
    }
    control["procedencia"]["recibo-ciber"] = almacen.archivar_documento(
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
    _guardar_seleccion(destino, control, inventario, filas, contextos)
    control["snapshot_sha256"] = recibo["snapshot_salida_sha256"]
    control["archivos_conservados"] = [{"archivo": n, "sha256": h} for n, h in sorted(inventario.items())]
    if resultados and all(
        r.get("alta") is False
        or r["pendiente"]
        in (
            "alias_sin_vinculo_actual_acreditado_a_url_corta",
            "material_ausente_del_censo_no_renovado",
            "material_no_seleccionado_por_interfaz_espanola",
            "ruta_actual_distinta_requiere_revision_de_identidad",
            sin_material.MOTIVO_RETIRADO,
        )
        or r["evaluacion"] is not None
        and r["evaluacion"]["actual"]
        for r in resultados
    ):
        control["aplicados_por_fuente"]["cibervoluntarios"] = huella
    guardar_json(destino / almacen.CONTROL, control)
    admision.admitir_snapshot(almacen.solicitud(destino))
    return control
