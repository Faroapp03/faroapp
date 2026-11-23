"""Proyección HP acotada sobre recursos existentes; el cargador común conserva la autoridad."""

import hashlib
import json
import sqlite3
from copy import deepcopy
from dataclasses import dataclass
from http import HTTPStatus
from pathlib import Path

from plataforma_datos.comun.huella_json import sha256_json
from plataforma_datos.cursos import trozos_catalogo
from plataforma_datos.cursos.atribucion_temporal import ContratoCanal
from plataforma_datos.cursos.fuentes.hp_life import lector
from plataforma_datos.cursos.fuentes.hp_life.recepciones import RecepcionHpLife
from plataforma_datos.cursos.tipos_json import ObjetoJson

RUTA_CONTRATO = Path(__file__).with_name("contrato_actualizacion_v1.json")
CONTRATO_SHA256 = "789ae73a3d851b8355288c959e3113bcfcaa2daa199e24c1b929621efdcf7a27"
VERSION_APRENDIZAJE = 3
CAMPOS_NATIVOS = ("id", "proveedor_id", "titulo", "url", "tipo_unidad")
CAMPOS_EVIDENCIA = ("url", "capturado_utc", "sha256", "archivo")


@dataclass(frozen=True, kw_only=True)
class PlanRecurso:
    """Datos del recurso y lote opcional; el plan nunca contiene una edición fabricada."""

    programa: ObjetoJson
    lote: ObjetoJson | None
    canales: tuple[ObjetoJson, ...]
    recepcion: RecepcionHpLife
    acreditacion: RecepcionHpLife | None = None


def leer_contrato() -> ContratoCanal:
    """Exige los bytes versionados del mapa propio antes de usarlo.

    Returns:
        Contrato fijo del canal de ficha HP; no ejecuta código desde el JSON.

    Raises:
        ErrorFichaHpLife: Si no conserva el artefacto revisado.
    """
    contenido = RUTA_CONTRATO.read_bytes()
    if hashlib.sha256(contenido).hexdigest() != CONTRATO_SHA256:
        raise lector.ErrorFichaHpLife("Contrato de actualización HP alterado")
    canal = json.loads(contenido)["canal"]
    return ContratoCanal(
        id=canal["id"], version=canal["version"], entidad=canal["entidad"], campos=tuple(canal["campos"])
    )


def _programa(conexion: sqlite3.Connection, recepcion: RecepcionHpLife) -> ObjetoJson:
    ruta = lector.CURSO.fullmatch(lector._url(recepcion.captura.url_solicitada))
    if ruta is None:
        raise lector.ErrorFichaHpLife("La recepción no solicita una identidad de curso")
    id = f"hp-life:{int(ruta.group(2))}:{ruta.group(1)}"
    fila = conexion.execute("SELECT * FROM programas WHERE id=?", (id,)).fetchone()
    if fila is None or fila["proveedor_id"] != "hp-life" or fila["tipo_unidad"] != "curso":
        raise lector.ErrorFichaHpLife("Recurso HP inexistente o de otro proveedor/tipo")
    programa = {c: fila[c] for c in CAMPOS_NATIVOS}
    programa["datos"] = json.loads(fila["datos"])
    if sha256_json(programa) != fila["huella"] or programa["url"] != recepcion.captura.url_solicitada:
        raise lector.ErrorFichaHpLife("Identidad, URL o huella nativa HP incoherentes")
    if conexion.execute("SELECT 1 FROM ediciones WHERE programa_id=? LIMIT 1", (id,)).fetchone():
        raise lector.ErrorFichaHpLife("El recurso tiene ediciones: no admite este productor de recurso sin edición")
    return programa


def programa_recibido(conexion: sqlite3.Connection, recepcion: RecepcionHpLife) -> ObjetoJson:
    """Identifica el recurso de una recepción sin proyectar sus datos.

    Returns:
        Datos nativos admitidos del recurso solicitado.
    """
    return _programa(conexion, recepcion)


def _canales(conexion: sqlite3.Connection, id: str) -> list[ObjetoJson]:
    filas = conexion.execute(
        "SELECT * FROM canales_temporales WHERE id IN (SELECT max(id) FROM canales_temporales "
        "WHERE entidad='programa' AND entidad_id=? GROUP BY canal) ORDER BY canal",
        (id,),
    )
    return [
        {
            "entidad": "programa",
            "id": id,
            "canal": fila["canal"],
            "evidencias": [
                dict(e)
                for e in conexion.execute(
                    "SELECT e.url,e.capturado_utc,e.sha256,e.archivo FROM pruebas_temporales p "
                    "JOIN evidencias e ON e.id=p.evidencia_id WHERE p.canal_id=? ORDER BY e.id",
                    (fila["id"],),
                )
            ],
        }
        for fila in filas
    ]


def _proyectar(programa: ObjetoJson, ficha: lector.FichaHpLife) -> ObjetoJson:
    nuevo = deepcopy(programa)
    datos = nuevo["datos"]
    identidad = datos.get("identidad_fuente")
    if (
        not isinstance(identidad, dict)
        or identidad.get("id") != ficha.id_fuente
        or identidad.get("idioma") != ficha.idioma
    ):
        raise lector.ErrorFichaHpLife("Identidad publicada no coincide con la unidad existente")
    nuevo["titulo"] = ficha.titulo
    identidad["codigo"] = ficha.codigo
    for campo, valor in (
        ("cuerpo_html_publicado", ficha.cuerpo_html),
        ("descripcion_publicada", ficha.descripcion),
        ("idiomas_publicados", [ficha.idioma]),
        ("estado_fuente_literal", ficha.estado),
    ):
        datos[campo] = valor
    anterior = programa["datos"]
    if datos["cuerpo_html_publicado"] != anterior.get("cuerpo_html_publicado") or datos[
        "descripcion_publicada"
    ] != anterior.get("descripcion_publicada"):
        # Insumo del mecanismo existente de revisión de etiquetas/aprendizaje, no otra clasificación.
        datos["contenido_huella"] = sha256_json([ficha.cuerpo_html, ficha.descripcion])
    return nuevo


def _conservar(origen: Path, destino: Path, sha: str) -> None:
    # Un cuerpo grande puede estar por trozos: se reconstruye verificado y se conserva igual.
    if origen.is_symlink() or not origen.is_file():
        raise lector.ErrorFichaHpLife("La evidencia histórica no conserva su archivo y SHA")
    try:
        cuerpo = trozos_catalogo.leer(origen, sha, limite=trozos_catalogo.MAX_CUERPO)
    except trozos_catalogo.ErrorTrozos as error:
        raise lector.ErrorFichaHpLife("La evidencia histórica no conserva su archivo y SHA") from error
    destino.parent.mkdir(parents=True, exist_ok=True)
    try:
        trozos_catalogo.conservar(destino, cuerpo, sha)
    except trozos_catalogo.ErrorTrozos as error:
        raise lector.ErrorFichaHpLife("Colisión de ruta de evidencia") from error


def conservar_canales(canales: list[ObjetoJson], origen: Path, destino: Path) -> None:
    """Copia solo las pruebas usadas, conservando exactamente sus rutas relativas y fechas.

    Raises:
        ErrorFichaHpLife: Si una prueba sale de su raíz, falta o fue alterada.
    """
    for canal in canales:
        for evidencia in canal["evidencias"]:
            archivo = evidencia["archivo"]
            if not isinstance(archivo, str):
                raise lector.ErrorFichaHpLife("Evidencia temporal sin archivo conservado")
            ruta = Path(archivo)
            if (
                ruta.is_absolute()
                or ".." in ruta.parts
                or not (origen / ruta).resolve().is_relative_to(origen.resolve())
            ):
                raise lector.ErrorFichaHpLife("Ruta de evidencia fuera de su raíz")
            _conservar(origen / ruta, destino / ruta, evidencia["sha256"])


def conservar_recepcion(recepcion: RecepcionHpLife, destino: Path) -> list[ObjetoJson]:
    """Deduplica cuerpos por SHA y conserva los recibos íntegros por su propia identidad.

    Returns:
        Evidencias de ambos artefactos, con la fecha real de esa recepción.

    Raises:
        ErrorFichaHpLife: Si una ruta existente tiene otros bytes.
    """
    cap = recepcion.captura
    resultado = []
    for carpeta, extension, contenido, sha in (
        ("cuerpos", ".body", recepcion.cuerpo, cap.sha256_cuerpo),
        ("recepciones", ".json", recepcion.recibo, recepcion.sha256_recibo),
    ):
        relativa = Path("hp-life") / carpeta / (sha + extension)
        archivo = destino / relativa
        archivo.parent.mkdir(parents=True, exist_ok=True)
        if archivo.exists():
            # Lo ya conservado puede estar por trozos (cuerpos grandes): se compara lo reconstruido y verificado.
            try:
                conservado = trozos_catalogo.leer(archivo, sha, limite=trozos_catalogo.MAX_CUERPO)
            except trozos_catalogo.ErrorTrozos as error:
                raise lector.ErrorFichaHpLife("Colisión de cuerpo o recibo HP") from error
            if conservado != contenido:
                raise lector.ErrorFichaHpLife("Colisión de cuerpo o recibo HP")
        else:
            archivo.write_bytes(contenido)
        resultado.append(
            {
                "url": cap.url_solicitada,
                "capturado_utc": cap.recibido_utc,
                "sha256": sha,
                "archivo": relativa.as_posix(),
            }
        )
    return resultado


def planificar_recurso(
    conexion: sqlite3.Connection, recepcion: RecepcionHpLife, contrato: ContratoCanal, observacion: ObjetoJson
) -> PlanRecurso:
    """Ancla solo negocio íntegro idéntico; luego admite la proyección acreditada del canal nuevo.

    Returns:
        Lote de activación expresa para cargar_lotes o ausencia de cambio para un intento técnico.

    Raises:
        ErrorFichaHpLife: Si el recurso o la proyección no permiten el anclaje.
    """
    programa = _programa(conexion, recepcion)
    canales = _canales(conexion, programa["id"])
    cap = recepcion.captura
    if cap.http != HTTPStatus.OK or cap.completo is not True or observacion["detalle"].get("tipo_destino") != "ficha":
        return PlanRecurso(programa=programa, lote=None, canales=tuple(canales), recepcion=recepcion)
    ficha = lector.extraer_ficha(recepcion.cuerpo, cap)
    nuevo = _proyectar(programa, ficha)
    anclado = any(c["canal"] == contrato.clave for c in canales)
    if not anclado and sha256_json(nuevo) != sha256_json(programa):
        raise lector.ErrorFichaHpLife("Primer anclaje exige proyección y negocio íntegro idénticos")
    version = VERSION_APRENDIZAJE if "aprendizaje" in programa["datos"] else 1
    lote = {
        "schema_version": version,
        "observado_utc": cap.recibido_utc,
        "fuente_lote": "hp_life:recurso:1",
        "proveedores": [],
        "programas": [{**nuevo, "etiquetas": [], "evidencias": []}],
        "ediciones": [],
    }
    if version == VERSION_APRENDIZAJE:
        lote.update(variantes=[], centros=[], anuncios=[])
    return PlanRecurso(programa=programa, lote=lote, canales=tuple(canales), recepcion=recepcion)
