"""Atribuye únicamente campos API reproducidos del robot de Cibernàrium.

El anclaje inicial coteja la proyección histórica contra su cuerpo exacto.
Horas/idioma de una ficha HTML, costes, requisitos y aprendizaje conservan
su negocio, canal y fecha propios. No se atribuyen a una consulta API nueva.
"""

import hashlib
import json
import re
import sqlite3
from contextlib import closing
from copy import deepcopy
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from plataforma_datos.comun.huella_json import sha256_json
from plataforma_datos.cursos import almacen_catalogo as almacen
from plataforma_datos.cursos import catalogo, recibos_compartidos
from plataforma_datos.cursos.atribucion_temporal import PREFIJO, CanalesAtribuidos, ContratoCanal
from plataforma_datos.cursos.contrato_entrega_catalogo import ErrorEntregaCatalogo, exigir
from plataforma_datos.cursos.fuentes.barcelonactiva import adquisicion, identidades_actuales
from plataforma_datos.cursos.fuentes.barcelonactiva import robot_cibernarium as robot

CAMPOS_PROGRAMA = ("categoria_publicada", "categoria_id_publicada", "subcategoria_id_publicada")
CAMPOS_EDICION = (
    "modalidad",
    "sincronia",
    "ventana_acceso",
    "fechas_publicadas",
    "sesiones",
    "codigo_inscripcion_publicado",
    "estado_inscripcion",
    "apertura_inscripcion",
    "plazas",
    "openings_available_senal",
)
CONTRATOS = {
    "programa": ContratoCanal(
        id="cibernarium-actividad-api",
        version=1,
        entidad="programa",
        campos=("/titulo", *("/datos/" + c for c in CAMPOS_PROGRAMA)),
    ),
    "edicion": ContratoCanal(
        id="cibernarium-edicion-api",
        version=1,
        entidad="edicion",
        campos=tuple("/datos/" + c for c in (*CAMPOS_EDICION, "horas_publicadas", "metodo_horas")),
    ),
}
VERSION_APRENDIZAJE = 3
METODO_HORAS_HTML = "ficha-principal-verificada-bloque-3"


@dataclass(frozen=True, kw_only=True)
class PublicacionApi:
    """Objeto nativo y pruebas inseparables de la misma página API."""

    actividad: dict
    edicion: dict | None
    pruebas: list[dict]
    identidad: dict | None = None


def fila_nativa_verificada(fila: sqlite3.Row) -> dict:
    """Decodifica una fila nativa de Cibernàrium y exige que su contenido coincida con la huella guardada.

    Returns:
        La fila con sus datos decodificados y sin la huella.
    """
    salida = {k: fila[k] for k in dict(fila) if k != "huella"}
    salida["datos"] = json.loads(salida["datos"])
    exigir(sha256_json(salida) == fila["huella"], "Negocio Cibernàrium con huella distinta")
    return salida


def leer(base: Path) -> tuple[dict[str, dict], dict[str, dict]]:
    """Lee únicamente entidades nativas del proveedor, sin crear oferta por presencia.

    Returns:
        Programas y ediciones por ID exacto; no interpreta ausencias como bajas.
    """
    with closing(sqlite3.connect(base.resolve().as_uri() + "?mode=ro&immutable=1", uri=True)) as db:
        db.row_factory = sqlite3.Row
        programas = {
            f["id"]: fila_nativa_verificada(f)
            for f in db.execute("SELECT * FROM programas WHERE proveedor_id='cibernarium'")
        }
        ediciones = {
            f["id"]: fila_nativa_verificada(f)
            for f in db.execute(
                "SELECT e.* FROM ediciones e JOIN programas p ON p.id=e.programa_id WHERE p.proveedor_id='cibernarium'"
            )
        }
    for id, p in programas.items():
        exigir(
            id == "cibernarium:" + p["datos"].get("activity_id", "")
            and p["url"] == robot.url_ficha(p["datos"]["activity_id"]),
            "Identidad o URL nativa Cibernàrium incompatible",
        )
    for id, e in ediciones.items():
        exigir(
            id == "cibernarium-edicion:" + e["datos"].get("activity_id", "") and e["programa_id"] in programas,
            "Edición Cibernàrium sin identidad o programa propio",
        )
    return programas, ediciones


def programa(actividad: dict) -> dict:
    """Reproduce identidad y hechos API sin heredar normas o HTML de otra unidad.

    Returns:
        Programa mínimo para una identidad nativa nueva; desconocidos preservados.
    """
    id = robot.identificador(actividad.get("activityId"))
    titulo = actividad.get("title")
    exigir(isinstance(titulo, str) and bool(titulo.strip()), "Actividad API sin título literal")
    return {
        "id": "cibernarium:" + id,
        "proveedor_id": "cibernarium",
        "titulo": titulo,
        "url": robot.url_ficha(id),
        "tipo_unidad": "actividad-formativa",
        "datos": {
            "activity_id": id,
            **{
                c: actividad.get(k) or None
                for c, k in zip(CAMPOS_PROGRAMA, ("category", "categoryId", "subCategoryId"), strict=True)
            },
            "matricula_eur": None,
            "certificado_coste_eur": None,
            "normas_generales": None,
            "hechos_ficha_principal": None,
            "nivel_faro": None,
            "clasificacion_tematica": "pendiente",
        },
    }


def proyectar(actual: dict, actividad: dict, edicion: dict | None, identidad: dict | None = None) -> dict:
    """Actualiza la proyección explícita sin modificar identidad ni otros campos.

    Returns:
        Copia del negocio con hechos propios del objeto API de esta edición.
    """
    nuevo = deepcopy(actual)
    padre = "cibernarium:" + actividad["activityId"]
    if identidad is not None:
        identidades_actuales.validar(identidad)
        exigir(identidad["actividad_id"] == actividad["activityId"], "Proyección de otra cabecera")
        ids = {"cibernarium-edicion:" + e["activityId"] for e in actividad["listEditions"]}
        exigir(set(identidad["ediciones_testigo"]) <= ids, "Testigo ausente en la cabecera API")
        padre = identidad["programa_id"]
    if edicion is None:
        nativo = programa(actividad)
        exigir(
            actual["id"] == padre
            and actual["proveedor_id"] == nativo["proveedor_id"]
            and actual["tipo_unidad"] == nativo["tipo_unidad"]
            and actual["id"] == "cibernarium:" + actual["datos"].get("activity_id", "")
            and actual["url"] == robot.url_ficha(actual["datos"]["activity_id"]),
            "Actividad de otra identidad",
        )
        nuevo["titulo"] = nativo["titulo"]
        nuevo["datos"].update({k: nativo["datos"][k] for k in CAMPOS_PROGRAMA})
    else:
        nativo = robot.normalizar_edicion(padre, actividad, edicion)
        exigir(
            actual["id"] == nativo["id"] and actual["programa_id"] == nativo["programa_id"], "Edición de otra actividad"
        )
        nuevo["datos"].update({k: nativo["datos"][k] for k in CAMPOS_EDICION})
        if actual["datos"].get("metodo_horas") != METODO_HORAS_HTML:
            nuevo["datos"].update({k: nativo["datos"][k] for k in ("horas_publicadas", "metodo_horas")})
    return nuevo


def _canales(db: sqlite3.Connection, entidad: str, id: str) -> list[dict]:
    return [
        {
            "entidad": entidad,
            "id": id,
            "canal": c["canal"],
            "evidencias": catalogo.pruebas_del_canal(db, c["id"]),
        }
        for c in db.execute(
            "SELECT id,canal FROM canales_temporales WHERE id IN "
            "(SELECT max(id) FROM canales_temporales WHERE entidad=? AND entidad_id=? GROUP BY canal) ORDER BY canal",
            (entidad, id),
        )
    ]


def _url_historica(url: str, documento: dict) -> None:
    valores = parse_qs(urlsplit(url).query, keep_blank_values=True).get("_cAct_INSTANCE_uhcx_start")
    exigir(
        isinstance(valores, list) and len(valores) == 1 and re.fullmatch(r"[0-9]+", valores[0]),
        "Ancla API sin intervalo",
    )
    desde = int(valores[0])
    canonica = adquisicion.url_pagina(desde)
    try:
        total, _ = robot.validar_pagina(documento, desde)
    except robot.ErrorRobot as error:
        raise ErrorEntregaCatalogo("Intervalo del cuerpo histórico incompatible") from error
    recortada = canonica.replace(
        f"_cAct_INSTANCE_uhcx_end={desde + robot.PAGINA}&", f"_cAct_INSTANCE_uhcx_end={total}&"
    )
    exigir(
        total > desde
        and (url == canonica or url == recortada and total < desde + robot.PAGINA and documento["end"] == total),
        "Consulta histórica ajena o último tramo sin soporte",
    )


def _historica(ruta: Path, sha: str, url: str | None = None) -> list[dict]:
    exigir(ruta.is_file(), "Ancla API histórica ausente")
    with ruta.open("rb") as archivo:
        contenido = archivo.read(robot.MAX_BYTES + 1)
    exigir(len(contenido) <= robot.MAX_BYTES, "Ancla API histórica excesiva")
    exigir(hashlib.sha256(contenido).hexdigest() == sha, "Ancla API histórica alterada")
    documento = recibos_compartidos.leer_json(contenido)
    exigir(isinstance(documento, dict) and isinstance(documento.get("activities"), list), "Ancla API sin actividades")
    exigir(all(isinstance(a, dict) for a in documento["activities"]), "Ancla API con actividad no interpretable")
    if url is not None:
        _url_historica(url, documento)
    return documento["activities"]


def _ancla(actual: dict, canales: list[dict], raiz: Path, actividad_id: str, entidad: str) -> list[dict] | None:
    for prueba in (p for c in canales if c["canal"] == "actividad-api" for p in c["evidencias"]):
        relativa = Path(prueba["archivo"])
        exigir(not relativa.is_absolute() and ".." not in relativa.parts, "Ancla API fuera del almacén")
        filas = _historica(almacen.ruta_relativa(raiz, prueba["archivo"]), prueba["sha256"], prueba["url"])
        actividades = [a for a in filas if a.get("activityId") == actividad_id]
        exigir(len(actividades) <= 1, "Actividad histórica repetida")
        if not actividades:
            continue
        actividad = actividades[0]
        if entidad == "programa":
            if proyectar(actual, actividad, None) == actual:
                return [prueba]
        else:
            ediciones = [
                e
                for e in actividad.get("listEditions", [])
                if isinstance(e, dict) and e.get("activityId") == actual["datos"]["activity_id"]
            ]
            exigir(len(ediciones) <= 1, "Edición histórica repetida")
            if ediciones and proyectar(actual, actividad, ediciones[0]) == actual:
                return [prueba]
    return None


def _lote(objeto: dict, entidad: str, pruebas: list[dict], fecha: str) -> dict:
    version = VERSION_APRENDIZAJE if "aprendizaje" in objeto["datos"] else 1
    salida = {
        "schema_version": version,
        "observado_utc": fecha,
        "fuente_lote": "cibernarium:api:1",
        "proveedores": [],
        "programas": [],
        "ediciones": [],
    }
    registro = {**objeto, "evidencias": pruebas}
    if entidad == "programa":
        registro["etiquetas"] = []
    salida["programas" if entidad == "programa" else "ediciones"] = [registro]
    if version == VERSION_APRENDIZAJE:
        salida.update(variantes=[], centros=[], anuncios=[])
    return salida


def cargar(base: Path, actual: dict, publicacion: PublicacionApi, raiz: Path) -> str | None:
    """Ancla por bytes históricos y aplica solo campos protegidos de ese canal.

    Returns:
        Motivo de retención si no se acredita el anclaje, sin sobrescribir negocio.
    """
    actividad, edicion, pruebas = publicacion.actividad, publicacion.edicion, publicacion.pruebas
    entidad = "programa" if edicion is None else "edicion"
    contrato = CONTRATOS[entidad]
    with closing(sqlite3.connect(base)) as db:
        db.row_factory = sqlite3.Row
        canales = _canales(db, entidad, actual["id"])
    if any(c["canal"].startswith(PREFIJO) and c["canal"] != contrato.clave for c in canales):
        return "contrato_protegido_ajeno_requiere_transicion"
    propio = next((c for c in canales if c["canal"] == contrato.clave), None)
    if propio is None:
        canonico = actual["id"] if entidad == "programa" else actual["programa_id"]
        prueba = _ancla(actual, canales, raiz, canonico.removeprefix("cibernarium:"), entidad)
        if prueba is None:
            return "negocio_anterior_sin_ancla_api_acreditada"
        ancla = {"entidad": entidad, "id": actual["id"], "canal": contrato.clave, "evidencias": prueba}
        _cargar(base, actual, [*canales, ancla], contrato, raiz)
    nuevo = proyectar(actual, actividad, edicion, publicacion.identidad)
    if propio is not None and nuevo == actual and propio["evidencias"] == pruebas:
        return None
    canal = {"entidad": entidad, "id": actual["id"], "canal": contrato.clave, "evidencias": pruebas}
    _cargar(base, nuevo, [c for c in canales if c["canal"] != contrato.clave] + [canal], contrato, raiz)
    return None


def _cargar(base: Path, objeto: dict, canales: list[dict], contrato: ContratoCanal, raiz: Path) -> None:
    pruebas = [p for c in canales for p in c["evidencias"]]
    catalogo.cargar_lote(
        base,
        _lote(objeto, contrato.entidad, pruebas, max((p["capturado_utc"] for p in pruebas), key=robot.fecha_utc)),
        True,
        raiz,
        canales_temporales=CanalesAtribuidos(canales_por_lote=(tuple(canales),), contratos=(contrato,)),
    )


def alta(base: Path, objeto: dict, entidad: str, pruebas: list[dict], raiz: Path) -> None:
    """Incorpora un ID nuevo, sin fusionar ni borrar entidades anteriores."""
    contrato = CONTRATOS[entidad]
    inicial = {"entidad": entidad, "id": objeto["id"], "canal": "actividad-api", "evidencias": pruebas}
    lote = _lote(objeto, entidad, pruebas, max((p["capturado_utc"] for p in pruebas), key=robot.fecha_utc))
    with closing(sqlite3.connect(base)) as db:
        # Un almacén recién sembrado aún no tiene el proveedor: la primera alta lo incorpora.
        if db.execute("SELECT 1 FROM proveedores WHERE id=?", (robot.PROVEEDOR,)).fetchone() is None:
            lote["proveedores"] = [robot.FICHA_PROVEEDOR]
    catalogo.cargar_lote(
        base,
        lote,
        True,
        raiz,
        canales_temporales=[inicial],
    )
    _cargar(base, objeto, [inicial, {**inicial, "canal": contrato.clave}], contrato, raiz)
