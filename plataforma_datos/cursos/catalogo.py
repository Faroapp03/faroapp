"""Catálogo de investigación local: procedencia, entidades y versiones separadas."""

import argparse
import hashlib
import ipaddress
import json
import math
import re
import sqlite3
import sys
from collections.abc import Iterable, Iterator
from contextlib import contextmanager
from copy import deepcopy
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlsplit

from plataforma_datos.cursos import atribucion_temporal, trozos_catalogo
from plataforma_datos.cursos.atribucion_temporal import CanalesAtribuidos, ContratoCanal
from plataforma_datos.cursos.contrato_aprendizaje import (
    ErrorAprendizaje,
    cargar_registro,
    competencia_registrada,
    validar_aprendizaje,
)
from plataforma_datos.cursos.tipos_json import ObjetoJson, ValorJson

PRIMER_CARACTER_VISIBLE = 32
VERSION_LOTE_OFERTA = 2
VERSION_LOTE_APRENDIZAJE = 3
VERSION_SQLITE_CONTENIDOS = 10


type ObjetosLote = dict[tuple[str, str], tuple[str | None, ObjetoJson]]


class ErrorCatalogo(ValueError):
    """Entrada o catálogo que no cumple el contrato."""


@dataclass(frozen=True, kw_only=True)
class InstantaneaCatalogo:
    """Censo publicado de un proveedor y ámbito, sin afirmar acceso personal."""

    proveedor_id: str
    ambito: str
    ids_programas: list[str]
    total_publicado: int
    completa: bool
    errores: list[str]
    observado_utc: str | None = None


@dataclass(frozen=True, kw_only=True)
class OpcionesCiclo:
    """Verificación de capturas y canales de una misma importación atómica."""

    comprobar_capturas: bool = False
    raiz_evidencias: str | Path | None = None
    canales_temporales: list[ObjetoJson] | list[list[ObjetoJson]] | None = None
    canales_censo: list[ObjetoJson] | None = None


ESQUEMA = (
    "\n"
    "CREATE TABLE IF NOT EXISTS proveedores (\n"
    " id TEXT PRIMARY KEY, nombre TEXT NOT NULL, territorio TEXT, naturaleza TEXT,\n"
    " huella TEXT NOT NULL CHECK(length(huella)=64));\n"
    "CREATE TABLE IF NOT EXISTS programas (\n"
    " id TEXT PRIMARY KEY, proveedor_id TEXT NOT NULL REFERENCES proveedores(id),\n"
    " titulo TEXT NOT NULL, url TEXT NOT NULL, tipo_unidad TEXT NOT NULL,\n"
    " datos TEXT NOT NULL CHECK(json_valid(datos)), huella TEXT NOT NULL "
    "CHECK(length(huella)=64));\n"
    "CREATE TABLE IF NOT EXISTS ediciones (\n"
    " id TEXT PRIMARY KEY, programa_id TEXT NOT NULL REFERENCES programas(id),\n"
    " datos TEXT NOT NULL CHECK(json_valid(datos)), huella TEXT NOT NULL "
    "CHECK(length(huella)=64));\n"
    "CREATE TABLE IF NOT EXISTS ejecuciones (\n"
    " id INTEGER PRIMARY KEY, observado_utc TEXT NOT NULL, importado_utc TEXT NOT NULL,\n"
    " fuente_lote TEXT NOT NULL, huella_lote TEXT NOT NULL CHECK(length(huella_lote)=64));\n"
    "CREATE TABLE IF NOT EXISTS evidencias (\n"
    " id INTEGER PRIMARY KEY, url TEXT NOT NULL, capturado_utc TEXT NOT NULL,\n"
    " sha256 TEXT NOT NULL CHECK(length(sha256)=64), archivo TEXT,\n"
    " clave TEXT NOT NULL UNIQUE CHECK(length(clave)=64));\n"
    "CREATE TABLE IF NOT EXISTS vinculos_evidencia (\n"
    " id INTEGER PRIMARY KEY, evidencia_id INTEGER NOT NULL REFERENCES evidencias(id),\n"
    " programa_id TEXT REFERENCES programas(id), edicion_id TEXT REFERENCES ediciones(id),\n"
    " CHECK((programa_id IS NOT NULL)+(edicion_id IS NOT NULL)=1));\n"
    "CREATE UNIQUE INDEX IF NOT EXISTS evidencia_programa ON "
    "vinculos_evidencia(evidencia_id,programa_id) WHERE programa_id IS NOT NULL;\n"
    "CREATE UNIQUE INDEX IF NOT EXISTS evidencia_edicion ON "
    "vinculos_evidencia(evidencia_id,edicion_id) WHERE edicion_id IS NOT NULL;\n"
    "CREATE TABLE IF NOT EXISTS observaciones_evidencia (\n"
    " ejecucion_id INTEGER NOT NULL REFERENCES ejecuciones(id),\n"
    " vinculo_id INTEGER NOT NULL REFERENCES vinculos_evidencia(id),\n"
    " PRIMARY KEY(ejecucion_id,vinculo_id));\n"
    "CREATE TABLE IF NOT EXISTS observaciones (\n"
    " id INTEGER PRIMARY KEY, ejecucion_id INTEGER NOT NULL REFERENCES ejecuciones(id),\n"
    " proveedor_id TEXT REFERENCES proveedores(id), programa_id TEXT REFERENCES "
    "programas(id),\n"
    " edicion_id TEXT REFERENCES ediciones(id),\n"
    " CHECK((proveedor_id IS NOT NULL)+(programa_id IS NOT NULL)+(edicion_id IS "
    "NOT NULL)=1));\n"
    "CREATE TABLE IF NOT EXISTS versiones (\n"
    " id INTEGER PRIMARY KEY, entidad TEXT NOT NULL CHECK(entidad IN "
    "('proveedor','programa','edicion','etiqueta')),\n"
    " entidad_id TEXT NOT NULL, ejecucion_id INTEGER NOT NULL REFERENCES ejecuciones(id),\n"
    " antes TEXT CHECK(antes IS NULL OR json_valid(antes)), despues TEXT NOT "
    "NULL CHECK(json_valid(despues)),\n"
    " huella_antes TEXT CHECK(huella_antes IS NULL OR length(huella_antes)=64),\n"
    " huella_despues TEXT NOT NULL CHECK(length(huella_despues)=64));\n"
    "CREATE TABLE IF NOT EXISTS etiquetas (\n"
    " id INTEGER PRIMARY KEY, programa_id TEXT NOT NULL REFERENCES "
    "programas(id), codigo TEXT NOT NULL,\n"
    " estado TEXT NOT NULL CHECK(estado IN ('propuesta','sustentada')),\n"
    " metodo TEXT NOT NULL, evidencia TEXT NOT NULL CHECK(json_valid(evidencia)),\n"
    " revision TEXT NOT NULL CHECK(revision IN ('vigente','requiere_revision')),\n"
    " vigente INTEGER NOT NULL CHECK(vigente IN (0,1)),\n"
    " ejecucion_id INTEGER NOT NULL REFERENCES ejecuciones(id));\n"
    "CREATE TABLE IF NOT EXISTS conflictos_etiquetas (\n"
    " id INTEGER PRIMARY KEY, programa_id TEXT NOT NULL REFERENCES "
    "programas(id), codigo TEXT NOT NULL,\n"
    " ejecucion_id INTEGER NOT NULL REFERENCES ejecuciones(id),\n"
    " decision_conservada TEXT NOT NULL CHECK(json_valid(decision_conservada)),\n"
    " entrada TEXT NOT NULL CHECK(json_valid(entrada)),\n"
    " huella_decision TEXT NOT NULL CHECK(length(huella_decision)=64),\n"
    " huella_entrada TEXT NOT NULL CHECK(length(huella_entrada)=64),\n"
    " UNIQUE(programa_id,codigo,huella_decision,huella_entrada));\n"
    "CREATE UNIQUE INDEX IF NOT EXISTS etiqueta_actual ON "
    "etiquetas(programa_id,codigo) WHERE vigente=1;\n"
    "CREATE UNIQUE INDEX IF NOT EXISTS programa_proveedor ON programas(id,proveedor_id);\n"
    "CREATE TABLE IF NOT EXISTS instantaneas (\n"
    " id INTEGER PRIMARY KEY, proveedor_id TEXT NOT NULL REFERENCES "
    "proveedores(id), ambito TEXT NOT NULL,\n"
    " observado_utc TEXT NOT NULL, total_publicado INTEGER NOT NULL "
    "CHECK(total_publicado>=0));\n"
    "CREATE TABLE IF NOT EXISTS pertenencia_catalogo (\n"
    " proveedor_id TEXT NOT NULL, ambito TEXT NOT NULL, programa_id TEXT NOT NULL,\n"
    " activo INTEGER NOT NULL CHECK(activo IN (0,1)), ultima_observacion TEXT NOT NULL,\n"
    " PRIMARY KEY(proveedor_id,ambito,programa_id),\n"
    " FOREIGN KEY(programa_id,proveedor_id) REFERENCES programas(id,proveedor_id));\n"
    "CREATE TABLE IF NOT EXISTS historial_pertenencia (\n"
    " id INTEGER PRIMARY KEY, instantanea_id INTEGER NOT NULL REFERENCES instantaneas(id),\n"
    " proveedor_id TEXT NOT NULL, ambito TEXT NOT NULL, programa_id TEXT NOT NULL,\n"
    " cambio TEXT NOT NULL CHECK(cambio IN ('alta','retirada','reactivacion')),\n"
    " FOREIGN KEY(proveedor_id,ambito,programa_id) REFERENCES "
    "pertenencia_catalogo(proveedor_id,ambito,programa_id));\n"
    "CREATE VIRTUAL TABLE IF NOT EXISTS programas_fts USING fts5(id "
    "UNINDEXED,titulo,datos, tokenize='unicode61 remove_diacritics 2');\n"
)


# La ampliación es aditiva: no reconstruye ni modifica tablas del catálogo v1.
ESQUEMA_OFERTA = (
    "\n"
    "CREATE TABLE IF NOT EXISTS variantes (\n"
    " id TEXT PRIMARY KEY, programa_id TEXT NOT NULL REFERENCES programas(id),\n"
    " datos TEXT NOT NULL CHECK(json_valid(datos)), huella TEXT NOT NULL "
    "CHECK(length(huella)=64));\n"
    "CREATE TABLE IF NOT EXISTS centros (\n"
    " id TEXT PRIMARY KEY, proveedor_id TEXT NOT NULL REFERENCES "
    "proveedores(id), nombre TEXT NOT NULL,\n"
    " datos TEXT NOT NULL CHECK(json_valid(datos)), huella TEXT NOT NULL "
    "CHECK(length(huella)=64),\n"
    " UNIQUE(id,proveedor_id));\n"
    "CREATE TABLE IF NOT EXISTS anuncios (\n"
    " id TEXT PRIMARY KEY, variante_id TEXT NOT NULL REFERENCES variantes(id),\n"
    " proveedor_id TEXT NOT NULL REFERENCES proveedores(id), centro_id TEXT,\n"
    " datos TEXT NOT NULL CHECK(json_valid(datos)), huella TEXT NOT NULL "
    "CHECK(length(huella)=64),\n"
    " FOREIGN KEY(centro_id,proveedor_id) REFERENCES centros(id,proveedor_id) "
    "DEFERRABLE INITIALLY DEFERRED);\n"
    "CREATE INDEX IF NOT EXISTS variante_programa ON variantes(programa_id);\n"
    "CREATE INDEX IF NOT EXISTS anuncio_variante ON anuncios(variante_id);\n"
    "CREATE INDEX IF NOT EXISTS anuncio_proveedor ON anuncios(proveedor_id);\n"
    "CREATE TABLE IF NOT EXISTS observaciones_oferta (\n"
    " id INTEGER PRIMARY KEY, ejecucion_id INTEGER NOT NULL REFERENCES ejecuciones(id),\n"
    " variante_id TEXT REFERENCES variantes(id), centro_id TEXT REFERENCES centros(id),\n"
    " anuncio_id TEXT REFERENCES anuncios(id),\n"
    " CHECK((variante_id IS NOT NULL)+(centro_id IS NOT NULL)+(anuncio_id IS NOT NULL)=1));\n"
    "CREATE TABLE IF NOT EXISTS versiones_oferta (\n"
    " id INTEGER PRIMARY KEY, entidad TEXT NOT NULL CHECK(entidad IN "
    "('variante','centro','anuncio')),\n"
    " entidad_id TEXT NOT NULL, ejecucion_id INTEGER NOT NULL REFERENCES ejecuciones(id),\n"
    " antes TEXT CHECK(antes IS NULL OR json_valid(antes)), despues TEXT NOT "
    "NULL CHECK(json_valid(despues)),\n"
    " huella_antes TEXT CHECK(huella_antes IS NULL OR length(huella_antes)=64),\n"
    " huella_despues TEXT NOT NULL CHECK(length(huella_despues)=64));\n"
    "CREATE TABLE IF NOT EXISTS vinculos_evidencia_oferta (\n"
    " id INTEGER PRIMARY KEY, evidencia_id INTEGER NOT NULL REFERENCES evidencias(id),\n"
    " variante_id TEXT REFERENCES variantes(id), centro_id TEXT REFERENCES centros(id),\n"
    " anuncio_id TEXT REFERENCES anuncios(id),\n"
    " CHECK((variante_id IS NOT NULL)+(centro_id IS NOT NULL)+(anuncio_id IS NOT NULL)=1));\n"
    "CREATE UNIQUE INDEX IF NOT EXISTS evidencia_variante ON "
    "vinculos_evidencia_oferta(evidencia_id,variante_id) WHERE variante_id IS NOT NULL;\n"
    "CREATE UNIQUE INDEX IF NOT EXISTS evidencia_centro ON "
    "vinculos_evidencia_oferta(evidencia_id,centro_id) WHERE centro_id IS NOT NULL;\n"
    "CREATE UNIQUE INDEX IF NOT EXISTS evidencia_anuncio ON "
    "vinculos_evidencia_oferta(evidencia_id,anuncio_id) WHERE anuncio_id IS NOT NULL;\n"
    "CREATE TABLE IF NOT EXISTS observaciones_evidencia_oferta (\n"
    " ejecucion_id INTEGER NOT NULL REFERENCES ejecuciones(id),\n"
    " vinculo_id INTEGER NOT NULL REFERENCES vinculos_evidencia_oferta(id),\n"
    " PRIMARY KEY(ejecucion_id,vinculo_id));\n"
)

ESQUEMA_APRENDIZAJE = """
CREATE TABLE IF NOT EXISTS conflictos_aprendizaje (
 id INTEGER PRIMARY KEY, programa_id TEXT NOT NULL REFERENCES programas(id), afirmacion_id TEXT NOT NULL,
 ejecucion_id INTEGER NOT NULL REFERENCES ejecuciones(id),
 decision_conservada TEXT NOT NULL CHECK(json_valid(decision_conservada)),
 entrada TEXT NOT NULL CHECK(json_valid(entrada)),
 registro_decision TEXT NOT NULL CHECK(json_valid(registro_decision)),
 registro_entrada TEXT NOT NULL CHECK(json_valid(registro_entrada)),
 huella_decision TEXT NOT NULL CHECK(length(huella_decision)=64),
 huella_entrada TEXT NOT NULL CHECK(length(huella_entrada)=64),
 UNIQUE(programa_id,afirmacion_id,huella_decision,huella_entrada));
"""


ESQUEMA_PROCEDENCIAS_APRENDIZAJE = """
CREATE TABLE IF NOT EXISTS procedencias_aprendizaje (
 programa_id TEXT NOT NULL REFERENCES programas(id) DEFERRABLE INITIALLY DEFERRED,
 afirmacion_id TEXT NOT NULL, huella_afirmacion TEXT NOT NULL CHECK(length(huella_afirmacion)=64),
 registro TEXT CHECK(registro IS NULL OR json_valid(registro)),
 PRIMARY KEY(programa_id,afirmacion_id));
"""


GRUPOS_OFERTA = (("variantes", "variante"), ("centros", "centro"), ("anuncios", "anuncio"))
ENTIDADES_OFERTA = frozenset(entidad for _, entidad in GRUPOS_OFERTA)


def ejecutar_esquema(conexion: sqlite3.Connection, esquema: str) -> None:
    """Ejecuta DDL dentro de la transacción actual, sin commits implícitos."""
    sentencia = ""
    for linea in esquema.splitlines(keepends=True):
        sentencia += linea
        if sqlite3.complete_statement(sentencia):
            conexion.execute(sentencia)
            sentencia = ""
    exigir(not sentencia.strip(), "El esquema contiene una sentencia incompleta")


def _json(valor: ValorJson) -> str:
    return json.dumps(valor, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def huella(valor: ValorJson) -> str:
    """Calcula el SHA-256 del JSON canónico del catálogo, la huella con que se comparan filas y evidencias.

    Returns:
        El SHA-256 hexadecimal del JSON canónico.
    """
    return hashlib.sha256(_json(valor).encode("utf-8")).hexdigest()


def exigir(condicion: object, mensaje: str) -> None:
    """Lanza `ErrorCatalogo` con el mensaje si la condición no se cumple.

    Raises:
        ErrorCatalogo: Si la condición es falsa.
    """
    if not condicion:
        raise ErrorCatalogo(mensaje)


def exigir_texto(valor: ValorJson, lugar: str) -> None:
    """Exige texto no vacío y sin caracteres de control, con el error propio del catálogo."""
    exigir(
        isinstance(valor, str) and bool(valor.strip()) and not any(ord(c) < PRIMER_CARACTER_VISIBLE for c in valor),
        f"{lugar}: se requiere texto no vacío sin caracteres de control",
    )


def _campos(objeto: ObjetoJson, requeridos: Iterable[str], lugar: str) -> None:
    exigir(isinstance(objeto, dict), f"{lugar}: se requiere un objeto")
    exigir(set(objeto) == set(requeridos), f"{lugar}: campos esperados: {', '.join(requeridos)}")


def fecha_utc(valor: ValorJson, lugar: str) -> datetime:
    """Exige una fecha ISO 8601 con zona UTC y la devuelve; el fallo se informa como `ErrorCatalogo`.

    Returns:
        La fecha leída, con zona UTC.

    Raises:
        ErrorCatalogo: Si no es texto ISO 8601 en UTC.
    """
    exigir_texto(valor, lugar)
    try:
        fecha = datetime.fromisoformat(valor.replace("Z", "+00:00"))
        exigir(
            "T" in valor and fecha.utcoffset() is not None and fecha.utcoffset().total_seconds() == 0,
            f"{lugar}: fecha ISO 8601 con zona UTC obligatoria",
        )
        return fecha
    except ValueError as error:
        raise ErrorCatalogo(f"{lugar}: fecha ISO 8601 UTC inválida") from error


def exigir_url_publica(valor: ValorJson, lugar: str) -> None:
    """Exige una URL http(s) pública, sin credenciales ni direcciones privadas o reservadas.

    Raises:
        ErrorCatalogo: Si la URL no es pública, lleva credenciales o está mal formada.
    """
    exigir_texto(valor, lugar)
    try:
        url = urlsplit(valor)
        host = url.hostname
        exigir(
            url.scheme in ("http", "https") and host and not url.username and not url.password,
            f"{lugar}: URL pública http(s), sin credenciales",
        )
        exigir(not any(c.isspace() for c in valor) and "\\" not in valor, f"{lugar}: URL inválida")
        _ = url.port
        try:
            direccion = ipaddress.ip_address(host)
        except ValueError:
            exigir(
                "." in host
                and not host.endswith(".")
                and re.fullmatch(r"[A-Za-z][A-Za-z0-9-]*", host.split(".")[-1]) is not None
                and not host.lower().endswith(
                    (".local", ".internal", ".localhost", ".localdomain", ".onion", ".test", ".invalid")
                )
                and all(re.fullmatch(r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?", p) for p in host.split(".")),
                f"{lugar}: host público inválido",
            )
        else:
            exigir(direccion.is_global, f"{lugar}: no se admiten direcciones privadas o reservadas")
    except ValueError as error:
        raise ErrorCatalogo(f"{lugar}: URL pública inválida") from error


def exigir_sha256(valor: ValorJson, lugar: str) -> None:
    """Exige un SHA-256 de 64 caracteres hexadecimales en minúsculas, sin normalizarlo."""
    exigir(
        isinstance(valor, str) and re.fullmatch("[0-9a-f]{64}", valor) is not None,
        f"{lugar}: SHA-256 de 64 caracteres hexadecimales en minúsculas",
    )


def _json_valido(valor: object, lugar: str) -> None:
    if valor is None or isinstance(valor, (str, bool, int)):
        return
    if isinstance(valor, float):
        exigir(math.isfinite(valor), f"{lugar}: número no finito")
        return
    if isinstance(valor, list):
        for item in valor:
            _json_valido(item, lugar)
        return
    exigir(isinstance(valor, dict) and all(isinstance(k, str) for k in valor), f"{lugar}: solo se admiten valores JSON")
    for item in valor.values():
        _json_valido(item, lugar)


def _evidencias(lista: ValorJson, lugar: str, comprobar: bool, raiz: Path | None) -> None:
    exigir(isinstance(lista, list), f"{lugar}: se requiere una lista")
    for evidencia in lista:
        _campos(evidencia, ("url", "capturado_utc", "sha256", "archivo"), lugar)
        exigir_url_publica(evidencia["url"], lugar + ".url")
        fecha_utc(evidencia["capturado_utc"], lugar + ".capturado_utc")
        exigir_sha256(evidencia["sha256"], lugar + ".sha256")
        archivo = evidencia["archivo"]
        if archivo is not None:
            exigir_texto(archivo, lugar + ".archivo")
            ruta = Path(archivo)
            exigir(
                not ruta.is_absolute() and ".." not in ruta.parts,
                f"{lugar}: archivo debe ser una ruta relativa sin ascensos",
            )
        if comprobar:
            exigir(archivo is not None, f"{lugar}: falta archivo para comprobar captura")
            destino = (raiz / archivo).resolve()
            exigir(
                destino.is_relative_to(raiz) and destino.is_file(),
                f"{lugar}: captura ausente o fuera de la raíz autorizada",
            )
            try:
                # Una captura grande puede estar por trozos; solo cuenta su cuerpo reconstruido y verificado.
                trozos_catalogo.leer(destino, evidencia["sha256"], limite=trozos_catalogo.MAX_CUERPO)
            except trozos_catalogo.ErrorTrozos as error:
                raise ErrorCatalogo(f"{lugar}: huella de captura incorrecta") from error


def validar_lote(lote: ValorJson, comprobar_capturas: bool = False, raiz_evidencias: str | Path | None = None) -> None:
    """Valida el contrato sin red; las referencias se validan dentro de la transacción.

    Raises:
        ErrorCatalogo: El lote incumple el contrato o sus capturas no son verificables.
    """
    exigir(isinstance(lote, dict), "lote debe ser objeto")
    version = lote.get("schema_version")
    exigir(type(version) is int and version in (1, 2, 3), "schema_version debe ser 1, 2 o 3")
    campos_lote = ("schema_version", "observado_utc", "fuente_lote", "proveedores", "programas", "ediciones")
    if version >= VERSION_LOTE_OFERTA:
        campos_lote += tuple(grupo for grupo, _ in GRUPOS_OFERTA)
    _campos(lote, campos_lote, "lote")
    fecha_utc(lote["observado_utc"], "observado_utc")
    exigir_texto(lote["fuente_lote"], "fuente_lote")
    exigir(type(comprobar_capturas) is bool, "comprobar_capturas debe ser booleano")
    raiz = Path(raiz_evidencias).resolve() if raiz_evidencias is not None else None
    exigir(
        not comprobar_capturas or (raiz is not None and raiz.is_dir()),
        "comprobar_capturas exige una carpeta raíz de evidencias existente",
    )
    _json_valido(lote, "lote")
    try:
        registro = cargar_registro() if version == VERSION_LOTE_APRENDIZAJE else None
    except ErrorAprendizaje as error:
        raise ErrorCatalogo(str(error)) from error
    _validar_entidades(lote, comprobar_capturas, raiz, registro)

    if version >= VERSION_LOTE_OFERTA:
        _validar_oferta(lote, comprobar_capturas, raiz)


def _validar_etiquetas(objeto: ObjetoJson) -> None:
    exigir(isinstance(objeto["etiquetas"], list), "etiquetas debe ser una lista")
    codigos = set()
    for etiqueta in objeto["etiquetas"]:
        _campos(etiqueta, ("codigo", "estado", "metodo", "evidencia"), "etiqueta")
        for campo in ("codigo", "metodo"):
            exigir_texto(etiqueta[campo], "etiqueta." + campo)
        exigir(etiqueta["estado"] in ("propuesta", "sustentada"), "estado de etiqueta inválido")
        exigir(etiqueta["codigo"] not in codigos, "código de etiqueta duplicado")
        codigos.add(etiqueta["codigo"])


def _validar_programa(objeto: ObjetoJson, version: int, registro: tuple[ObjetoJson, str] | None) -> None:
    if version == VERSION_LOTE_APRENDIZAJE:
        exigir("aprendizaje" in objeto["datos"], "Lote 3 exige aprendizaje explícito, incluso desconocido")
        try:
            validar_aprendizaje(objeto["datos"]["aprendizaje"], objeto["evidencias"], *registro, fecha_utc)
        except ErrorAprendizaje as error:
            raise ErrorCatalogo(str(error)) from error
    else:
        exigir("aprendizaje" not in objeto["datos"], "El aprendizaje exige lote 3")
    for campo_huella in ("temario_huella", "contenido_huella"):
        valor_huella = objeto["datos"].get(campo_huella)
        if valor_huella is not None:
            exigir_sha256(valor_huella, "datos." + campo_huella)
    _validar_etiquetas(objeto)


def _validar_entidades(
    lote: ObjetoJson, comprobar_capturas: bool, raiz: Path | None, registro: tuple[ObjetoJson, str] | None
) -> None:
    version = lote["schema_version"]
    for grupo, campos in (
        ("proveedores", ("id", "nombre", "territorio", "naturaleza")),
        ("programas", ("id", "proveedor_id", "titulo", "url", "tipo_unidad", "datos", "evidencias", "etiquetas")),
        ("ediciones", ("id", "programa_id", "datos", "evidencias")),
    ):
        exigir(isinstance(lote[grupo], list), f"{grupo}: se requiere una lista")
        vistos = set()
        for objeto in lote[grupo]:
            _campos(objeto, campos, grupo)
            exigir_texto(objeto["id"], grupo + ".id")
            exigir(objeto["id"] not in vistos, f"{grupo}: identificador duplicado {objeto['id']}")
            vistos.add(objeto["id"])
            if grupo == "proveedores":
                exigir_texto(objeto["nombre"], "proveedor.nombre")
                for campo in ("territorio", "naturaleza"):
                    if objeto[campo] is not None:
                        exigir_texto(objeto[campo], "proveedor." + campo)
                continue
            exigir_texto(objeto["proveedor_id" if grupo == "programas" else "programa_id"], grupo + ".referencia")
            exigir(isinstance(objeto["datos"], dict), f"{grupo}.datos debe ser objeto")
            _evidencias(objeto["evidencias"], grupo + ".evidencias", comprobar_capturas, raiz)
            if grupo == "ediciones":
                continue
            for campo in ("titulo", "tipo_unidad"):
                exigir_texto(objeto[campo], "programa." + campo)
            exigir_url_publica(objeto["url"], "programa.url")
            _validar_programa(objeto, version, registro)


def _validar_oferta(lote: ObjetoJson, comprobar_capturas: bool, raiz: Path | None) -> None:
    for grupo, campos, referencias in (
        ("variantes", ("id", "programa_id", "datos", "evidencias"), ("programa_id",)),
        ("centros", ("id", "proveedor_id", "nombre", "datos", "evidencias"), ("proveedor_id",)),
        (
            "anuncios",
            ("id", "variante_id", "proveedor_id", "centro_id", "datos", "evidencias"),
            ("variante_id", "proveedor_id", "centro_id"),
        ),
    ):
        exigir(isinstance(lote[grupo], list), f"{grupo}: se requiere una lista")
        vistos = set()
        for objeto in lote[grupo]:
            _campos(objeto, campos, grupo)
            exigir_texto(objeto["id"], grupo + ".id")
            exigir(objeto["id"] not in vistos, f"{grupo}: identificador duplicado {objeto['id']}")
            vistos.add(objeto["id"])
            for campo in referencias:
                if campo == "centro_id" and objeto[campo] is None:
                    continue
                exigir_texto(objeto[campo], grupo + "." + campo)
            if grupo == "centros":
                exigir_texto(objeto["nombre"], "centros.nombre")
            exigir(isinstance(objeto["datos"], dict), f"{grupo}.datos debe ser objeto")
            _evidencias(objeto["evidencias"], grupo + ".evidencias", comprobar_capturas, raiz)


@dataclass(frozen=True, kw_only=True)
class _CambioEntidad:
    """Estado anterior y posterior de una entidad en una misma ejecución."""

    entidad: str
    identificador: str
    antes: ObjetoJson | None
    despues: ObjetoJson


def _version(conexion: sqlite3.Connection, cambio: _CambioEntidad, ejecucion: int) -> None:
    entidad, identificador = cambio.entidad, cambio.identificador
    antes, despues = cambio.antes, cambio.despues
    tabla = "versiones_oferta" if entidad in ENTIDADES_OFERTA else "versiones"
    conexion.execute(
        f"INSERT INTO {tabla}(entidad,entidad_id,ejecucion_id,antes,despues,huella_antes,huella_despues) "
        "VALUES(?,?,?,?,?,?,?)",
        (
            entidad,
            identificador,
            ejecucion,
            None if antes is None else _json(antes),
            _json(despues),
            None if antes is None else huella(antes),
            huella(despues),
        ),
    )


def _negocio(objeto: ObjetoJson) -> ObjetoJson:
    return {k: v for k, v in objeto.items() if k not in ("evidencias", "etiquetas")}


def contenido_anterior(fila: sqlite3.Row | None) -> ObjetoJson | None:
    """Reconstruye el contenido canónico de una fila guardada, sin su huella, para compararlo con el nuevo.

    Returns:
        El contenido sin huella, o `None` si la fila no existía.
    """
    if fila is None:
        return None
    resultado = dict(fila)
    resultado.pop("huella", None)
    if "datos" in resultado:
        resultado["datos"] = json.loads(resultado["datos"])
    return resultado


def _actualizar_indice_programa(conexion: sqlite3.Connection, objeto: ObjetoJson) -> None:
    conexion.execute("DELETE FROM programas_fts WHERE id=?", (objeto["id"],))
    conexion.execute(
        "INSERT INTO programas_fts(id,titulo,datos) VALUES(?,?,?)",
        (objeto["id"], objeto["titulo"], _json(objeto["datos"])),
    )


def _guardar_entidad(
    conexion: sqlite3.Connection, tabla: str, entidad: str, objeto: ObjetoJson, ejecucion: int
) -> ObjetoJson | None:
    antes = contenido_anterior(conexion.execute(f"SELECT * FROM {tabla} WHERE id=?", (objeto["id"],)).fetchone())
    despues = _negocio(objeto)
    if _json(antes) != _json(despues):
        columnas = list(despues) + ["huella"]
        valores = [_json(v) if k == "datos" else v for k, v in despues.items()] + [huella(despues)]
        actualizaciones = ",".join(f"{c}=excluded.{c}" for c in columnas if c != "id")
        marcadores = ",".join("?" for _ in columnas)
        conexion.execute(
            f"INSERT INTO {tabla}({','.join(columnas)}) VALUES({marcadores}) "
            f"ON CONFLICT(id) DO UPDATE SET {actualizaciones}",
            valores,
        )
        _version(
            conexion,
            _CambioEntidad(entidad=entidad, identificador=objeto["id"], antes=antes, despues=despues),
            ejecucion,
        )
        if entidad == "programa":
            _actualizar_indice_programa(conexion, objeto)
    tabla_observaciones = "observaciones_oferta" if entidad in ENTIDADES_OFERTA else "observaciones"
    conexion.execute(
        f"INSERT INTO {tabla_observaciones}(ejecucion_id,{entidad}_id) VALUES(?,?)", (ejecucion, objeto["id"])
    )
    return antes


def _etiqueta_negocio(fila: sqlite3.Row) -> ObjetoJson:
    return {
        k: (json.loads(fila[k]) if k == "evidencia" else fila[k])
        for k in ("codigo", "estado", "metodo", "evidencia", "revision")
    }


CAMPOS_PEDAGOGICOS = (
    "temario_huella",
    "contenido_huella",
    "resumen_investigacion",
    "nivel_publicado",
    "requisitos_publicados",
    "capacidades_revisadas",
    "aprendizaje",
)


def _insumos_clasificacion(programa: ObjetoJson) -> ObjetoJson:
    # Dos null indican desconocimiento, nunca que se haya observado todo el temario.
    datos = {campo: deepcopy(programa["datos"].get(campo)) for campo in CAMPOS_PEDAGOGICOS}
    if datos["aprendizaje"] is not None:
        for afirmacion in datos["aprendizaje"]["afirmaciones"]:
            afirmacion.pop("revision_requerida", None)
    return {"titulo": programa["titulo"], "datos": datos}


def _afirmacion_decidida(afirmacion: ObjetoJson) -> ObjetoJson:
    return {k: v for k, v in afirmacion.items() if k != "revision_requerida"}


def _huella_decision(afirmacion: ObjetoJson, registro: ObjetoJson | None) -> str:
    return huella({"afirmacion": afirmacion, "registro": registro})


def _procedencia_decision(conexion: sqlite3.Connection, programa_id: str, afirmacion: ObjetoJson) -> ObjetoJson | None:
    fila = conexion.execute(
        "SELECT huella_afirmacion,registro FROM procedencias_aprendizaje WHERE programa_id=? AND afirmacion_id=?",
        (programa_id, afirmacion["id"]),
    ).fetchone()
    exigir(
        fila is not None and fila["huella_afirmacion"] == huella(_afirmacion_decidida(afirmacion)),
        "Procedencia de aprendizaje ausente o incoherente con la decisión conservada",
    )
    return None if fila["registro"] is None else json.loads(fila["registro"])


def _guardar_procedencia(
    conexion: sqlite3.Connection, programa_id: str, afirmacion: ObjetoJson, registro: ObjetoJson | None
) -> None:
    conexion.execute(
        (
            "INSERT INTO procedencias_aprendizaje(programa_id,afirmacion_id,huella_afirmacion,"
            "registro) VALUES(?,?,?,?) ON CONFLICT(programa_id,afirmacion_id) DO UPDATE SET "
            "huella_afirmacion=excluded.huella_afirmacion,registro=excluded.registro"
        ),
        (
            programa_id,
            afirmacion["id"],
            huella(_afirmacion_decidida(afirmacion)),
            None if registro is None else _json(registro),
        ),
    )


def _conservar_afirmaciones(
    conexion: sqlite3.Connection, programa: ObjetoJson, previo: ObjetoJson | None, ejecucion: int
) -> bool:
    entrante = programa["datos"]["aprendizaje"]
    conflicto_detectado = False
    decisiones = {a["id"]: a for a in previo["afirmaciones"]} if previo else {}
    conservadas = []
    for entrada in entrante["afirmaciones"]:
        decision = decisiones.pop(entrada["id"], None)
        if decision is None:
            _guardar_procedencia(conexion, programa["id"], entrada, entrante["registro"])
            conservadas.append(deepcopy(entrada))
            continue
        registro_decision = _procedencia_decision(conexion, programa["id"], decision)
        decision_limpia = _afirmacion_decidida(decision)
        entrada_limpia = _afirmacion_decidida(entrada)
        distinta = _json(decision_limpia) != _json(entrada_limpia)
        conflicto = distinta and (
            decision["estado"] == "revisada"
            or entrada["estado"] == "revisada"
            or (decision["estado"] == "propuesta" and entrada["origen"] != "inferencia")
        )
        if conflicto:
            conflicto_detectado = True
            conexion.execute(
                (
                    "INSERT OR IGNORE INTO conflictos_aprendizaje(programa_id,afirmacion_id,ejecucion_id,"
                    "decision_conservada,entrada,registro_decision,registro_entrada,huella_decision,"
                    "huella_entrada) VALUES(?,?,?,?,?,?,?,?,?)"
                ),
                (
                    programa["id"],
                    decision["id"],
                    ejecucion,
                    _json(decision_limpia),
                    _json(entrada_limpia),
                    _json(registro_decision),
                    _json(entrante["registro"]),
                    _huella_decision(decision_limpia, registro_decision),
                    _huella_decision(entrada_limpia, entrante["registro"]),
                ),
            )
            elegida = deepcopy(decision)
        else:
            elegida = deepcopy(entrada)
            if distinta:
                _guardar_procedencia(conexion, programa["id"], entrada, entrante["registro"])
        elegida["revision_requerida"] = bool(
            conflicto or decision["revision_requerida"] or entrada["revision_requerida"]
        )
        conservadas.append(elegida)
    conservadas.extend(deepcopy(list(decisiones.values())))
    entrante["afirmaciones"] = conservadas
    if conservadas:
        entrante["contenido_observado"] = True
    return conflicto_detectado


def _preparar_aprendizaje(
    conexion: sqlite3.Connection,
    programa: ObjetoJson,
    antes: ObjetoJson | None,
    ejecucion: int,
    registro: tuple[ObjetoJson, str] | None,
) -> tuple[ObjetoJson, bool]:
    """Conserva cada decisión y su registro de origen, incluso si cambia el bloque.

    Returns:
        Programa con decisiones conservadas e indicador de revisión requerida.

    Raises:
        ErrorCatalogo: Las afirmaciones conservadas incumplen el contrato de aprendizaje.
    """
    programa = deepcopy(programa)
    conflicto_detectado = False
    previo = antes["datos"].get("aprendizaje") if antes else None
    entrante = programa["datos"].get("aprendizaje")
    if previo is not None and entrante is None:
        programa["datos"]["aprendizaje"] = deepcopy(previo)
    elif entrante is not None:
        conflicto_detectado = _conservar_afirmaciones(conexion, programa, previo, ejecucion)

    if entrante is not None:
        # Las afirmaciones omitidas o en conflicto conservan sus capturas ya vinculadas.
        capturas = [
            dict(fila)
            for fila in conexion.execute(
                (
                    "SELECT e.url,e.capturado_utc,e.sha256 FROM evidencias e JOIN vinculos_evidencia v ON "
                    "v.evidencia_id=e.id WHERE v.programa_id=?"
                ),
                (programa["id"],),
            )
        ] + programa["evidencias"]
        try:
            validar_aprendizaje(entrante, capturas, *registro, fecha_utc)
        except ErrorAprendizaje as error:
            raise ErrorCatalogo(str(error)) from error
    cambio = conflicto_detectado or (
        antes is not None and _json(_insumos_clasificacion(antes)) != _json(_insumos_clasificacion(programa))
    )
    if cambio and "aprendizaje" in programa["datos"]:
        for afirmacion in programa["datos"]["aprendizaje"]["afirmaciones"]:
            afirmacion["revision_requerida"] = True
    return programa, cambio


def _guardar_etiquetas(
    conexion: sqlite3.Connection, programa: ObjetoJson, ejecucion: int, cambio_insumos: bool
) -> None:
    actuales = {
        fila["codigo"]: fila
        for fila in conexion.execute("SELECT * FROM etiquetas WHERE programa_id=? AND vigente=1", (programa["id"],))
    }
    entradas = {etiqueta["codigo"]: etiqueta for etiqueta in programa["etiquetas"]}
    # La ausencia en un lote parcial no retira etiquetas ni entidades.
    for codigo in sorted(actuales.keys() | entradas.keys()):
        fila = actuales.get(codigo)
        antes = _etiqueta_negocio(fila) if fila else None
        entrada = entradas.get(codigo)
        despues = dict(entrada) if entrada is not None else dict(antes)
        conflicto = False
        if antes is not None and entrada is not None:
            decision = {k: v for k, v in antes.items() if k != "revision"}
            discrepancia = _json(decision) != _json(entrada)
            # Un lote derivado no sustituye una decisión sustentada ni la promueve.
            conflicto = discrepancia and (antes["estado"] == "sustentada" or entrada["estado"] == "sustentada")
            if conflicto:
                conexion.execute(
                    (
                        "INSERT OR IGNORE INTO conflictos_etiquetas(programa_id,codigo,ejecucion_id,"
                        "decision_conservada,entrada,huella_decision,huella_entrada) VALUES(?,?,?,?,?,?,?)"
                    ),
                    (
                        programa["id"],
                        codigo,
                        ejecucion,
                        _json(decision),
                        _json(entrada),
                        huella(decision),
                        huella(entrada),
                    ),
                )
                despues = dict(antes)
        despues["revision"] = (
            "requiere_revision"
            if cambio_insumos or conflicto or (antes and antes["revision"] == "requiere_revision")
            else "vigente"
        )
        if _json(antes) == _json(despues):
            continue
        if fila:
            conexion.execute("UPDATE etiquetas SET vigente=0 WHERE id=?", (fila["id"],))
        conexion.execute(
            (
                "INSERT INTO etiquetas(programa_id,codigo,estado,metodo,evidencia,revision,vigente,"
                "ejecucion_id) VALUES(?,?,?,?,?,?,1,?)"
            ),
            (
                programa["id"],
                codigo,
                despues["estado"],
                despues["metodo"],
                _json(despues["evidencia"]),
                despues["revision"],
                ejecucion,
            ),
        )
        _version(
            conexion,
            _CambioEntidad(
                entidad="etiqueta", identificador=_json([programa["id"], codigo]), antes=antes, despues=despues
            ),
            ejecucion,
        )


def _guardar_evidencias(conexion: sqlite3.Connection, objeto: ObjetoJson, entidad: str, ejecucion: int) -> None:
    sufijo = "_oferta" if entidad in ENTIDADES_OFERTA else ""
    vinculos = "vinculos_evidencia" + sufijo
    observaciones = "observaciones_evidencia" + sufijo
    for evidencia in objeto["evidencias"]:
        conexion.execute(
            "INSERT OR IGNORE INTO evidencias(url,capturado_utc,sha256,archivo,clave) VALUES(?,?,?,?,?)",
            (
                evidencia["url"],
                evidencia["capturado_utc"],
                evidencia["sha256"],
                evidencia["archivo"],
                huella(evidencia),
            ),
        )
        evidencia_id = conexion.execute("SELECT id FROM evidencias WHERE clave=?", (huella(evidencia),)).fetchone()[0]
        conexion.execute(
            f"INSERT OR IGNORE INTO {vinculos}(evidencia_id,{entidad}_id) VALUES(?,?)", (evidencia_id, objeto["id"])
        )
        vinculo_id = conexion.execute(
            f"SELECT id FROM {vinculos} WHERE evidencia_id=? AND {entidad}_id=?", (evidencia_id, objeto["id"])
        ).fetchone()[0]
        conexion.execute(
            f"INSERT OR IGNORE INTO {observaciones}(ejecucion_id,vinculo_id) VALUES(?,?)", (ejecucion, vinculo_id)
        )


ESQUEMA_TEMPORAL = """
CREATE TABLE IF NOT EXISTS canales_temporales (
 id INTEGER PRIMARY KEY, entidad TEXT NOT NULL, entidad_id TEXT NOT NULL, canal TEXT NOT NULL,
 ejecucion_id INTEGER REFERENCES ejecuciones(id), instantanea_id INTEGER REFERENCES instantaneas(id),
 huella_negocio TEXT NOT NULL CHECK(length(huella_negocio)=64));
CREATE INDEX IF NOT EXISTS canal_entidad ON canales_temporales(entidad,entidad_id,canal,id);
CREATE TABLE IF NOT EXISTS pruebas_temporales (
 canal_id INTEGER NOT NULL REFERENCES canales_temporales(id),
 evidencia_id INTEGER NOT NULL REFERENCES evidencias(id), PRIMARY KEY(canal_id,evidencia_id));
"""


class ErrorTemporal(ErrorCatalogo):
    """Entrada pendiente: no acredita continuidad de una observación real."""

    def __init__(
        self,
        motivo: str,
        entidad: str,
        identidad: str,
        canal: str | list[str] | None = None,
        pruebas: ObjetoJson | None = None,
    ) -> None:
        self.detalle = {
            "motivo": motivo,
            "entidad": entidad,
            "id": identidad,
            "canal": canal,
            "estado": "pendiente_no_importado",
        }
        if pruebas is not None:
            self.detalle["pruebas"] = pruebas
        super().__init__("Continuidad temporal pendiente: " + _json(self.detalle))


def _objetos_lote(lote: ObjetoJson) -> ObjetosLote:
    grupos = (("proveedores", "proveedor"), ("programas", "programa"), ("ediciones", "edicion"))
    if lote["schema_version"] >= VERSION_LOTE_OFERTA:
        grupos += GRUPOS_OFERTA
    return {(entidad, obj["id"]): (grupo, obj) for grupo, entidad in grupos for obj in lote[grupo]}


def _validar_canales(
    lote: ObjetoJson,
    canales: list[ObjetoJson] | None,
    raiz: Path | None,
    contratos: tuple[ContratoCanal, ...] = (),
) -> list[ObjetoJson] | None:
    try:
        atribucion_temporal.validar_contratos(contratos)
    except atribucion_temporal.ErrorAtribucion as error:
        raise ErrorCatalogo(str(error)) from error
    if canales is None:
        exigir(not contratos, "El contrato de campos exige canales explícitos")
        return None
    exigir(isinstance(canales, list), "canales_temporales debe ser una lista por lote")
    raiz = Path(raiz).resolve() if raiz is not None else None
    exigir(raiz is not None and raiz.is_dir(), "Los canales exigen raíz de capturas existente")
    objetos = _objetos_lote(lote)
    vistos = set()
    for item in canales:
        _campos(item, {"entidad", "id", "canal", "evidencias"}, "canal temporal")
        exigir_texto(item["entidad"], "entidad del canal")
        exigir_texto(item["id"], "id del canal")
        clave = (item["entidad"], item["id"])
        exigir(clave in objetos, "Canal temporal ajeno al lote")
        exigir_texto(item["canal"], "rol semántico del canal")
        if item["canal"].startswith(atribucion_temporal.PREFIJO):
            exigir(
                any(c.clave == item["canal"] and c.entidad == item["entidad"] for c in contratos),
                "Canal atribuido sin su contrato exacto",
            )
        exigir((*clave, item["canal"]) not in vistos, "Canal temporal duplicado")
        vistos.add((*clave, item["canal"]))
        _evidencias(item["evidencias"], "pruebas del canal", True, raiz)
        exigir(bool(item["evidencias"]), "Canal temporal sin captura")
        firmas = {
            (e["url"], fecha_utc(e["capturado_utc"], "captura").isoformat(), e["sha256"]) for e in item["evidencias"]
        }
        exigir(len(firmas) == len(item["evidencias"]), "Prueba temporal duplicada")
        if clave[0] != "proveedor":
            propias = {huella(e) for e in objetos[clave][1]["evidencias"]}
            exigir(all(huella(e) in propias for e in item["evidencias"]), "Prueba no vinculada a la entidad del lote")
    for clave in objetos:
        if clave[0] != "proveedor" and not any(x[:2] == clave for x in vistos):
            raise ErrorTemporal("entidad_sin_canales_declarados", *clave)
    return canales


def _roles_previos(conexion: sqlite3.Connection, entidad: str, identidad: str) -> set[str]:
    return {
        r[0]
        for r in conexion.execute(
            "SELECT DISTINCT canal FROM canales_temporales WHERE entidad=? AND entidad_id=?", (entidad, identidad)
        )
    }


def pruebas_del_canal(conexion: sqlite3.Connection, canal_id: int) -> list[ObjetoJson]:
    """Devuelve las evidencias conservadas que respaldan un canal: URL, captura, huella y archivo.

    Returns:
        Las evidencias del canal como diccionarios.
    """
    return [
        dict(r)
        for r in conexion.execute(
            (
                "SELECT e.url,e.capturado_utc,e.sha256,e.archivo FROM pruebas_temporales p JOIN "
                "evidencias e ON e.id=p.evidencia_id WHERE p.canal_id=?"
            ),
            (canal_id,),
        )
    ]


def _firma_pruebas(pruebas: list[ObjetoJson]) -> list[tuple[str, str, str]]:
    # La ruta local no define la observación: copiar una captura no rejuvenece su cuerpo.
    return sorted((e["url"], fecha_utc(e["capturado_utc"], "captura").isoformat(), e["sha256"]) for e in pruebas)


def _comparar_capturas(item: ObjetoJson, antiguas: list[ObjetoJson]) -> bool:
    iguales = _firma_pruebas(antiguas) == _firma_pruebas(item["evidencias"])
    if not iguales:
        anteriores = [fecha_utc(e["capturado_utc"], "captura previa") for e in antiguas]
        nuevas = [fecha_utc(e["capturado_utc"], "captura entrante") for e in item["evidencias"]]
        if min(nuevas) <= max(anteriores):
            raise ErrorTemporal(
                "captura_antigua_simultanea_o_intervalo_solapado",
                item["entidad"],
                item["id"],
                item["canal"],
                {"anteriores": antiguas, "entrantes": item["evidencias"]},
            )
    return iguales


def _existe_entidad(
    conexion: sqlite3.Connection, entidad: str, identidad: str, tabla: str | None, objeto: ObjetoJson
) -> bool:
    if entidad == "catalogo":
        return bool(
            conexion.execute("SELECT 1 FROM instantaneas WHERE proveedor_id=? AND ambito=?", objeto["clave"]).fetchone()
        )
    return bool(conexion.execute(f"SELECT 1 FROM {tabla} WHERE id=?", (identidad,)).fetchone())


@dataclass(frozen=True, kw_only=True)
class _ComparacionCanales:
    """Resultado del cotejo temporal, separado de la atribución semántica."""

    todos_iguales: bool
    huellas_previas: frozenset[str]
    capturas_repetidas: frozenset[str]
    negocio_distinto_con_capturas_iguales: tuple[str, ...]


def _comparar_canales_actuales(
    conexion: sqlite3.Connection, actuales: list[ObjetoJson], objeto: ObjetoJson
) -> _ComparacionCanales:
    todos_iguales = True
    huellas_previas, capturas_repetidas = set(), set()
    negocio_distinto = []
    for item in actuales:
        previo = conexion.execute(
            "SELECT id,huella_negocio FROM canales_temporales WHERE entidad=? AND entidad_id=? "
            "AND canal=? ORDER BY id DESC LIMIT 1",
            (item["entidad"], item["id"], item["canal"]),
        ).fetchone()
        if previo is None:
            todos_iguales = False
            continue
        iguales = _comparar_capturas(item, pruebas_del_canal(conexion, previo["id"]))
        todos_iguales = todos_iguales and iguales
        huellas_previas.add(previo["huella_negocio"])
        if iguales:
            capturas_repetidas.add(item["canal"])
            if previo["huella_negocio"] != huella(_negocio(objeto)):
                negocio_distinto.append(item["canal"])
    return _ComparacionCanales(
        todos_iguales=todos_iguales,
        huellas_previas=frozenset(huellas_previas),
        capturas_repetidas=frozenset(capturas_repetidas),
        negocio_distinto_con_capturas_iguales=tuple(negocio_distinto),
    )


def _evaluar_canales(
    conexion: sqlite3.Connection,
    objetos: ObjetosLote,
    canales: list[ObjetoJson] | None,
    contratos: tuple[ContratoCanal, ...] = (),
) -> None:
    """Compara capturas por rol y aplica solo atribuciones explícitas ya ancladas.

    Raises:
        ErrorTemporal: No se demuestra continuidad para cada canal o campo protegido.
    """
    for (entidad, identidad), (tabla, objeto) in objetos.items():
        roles = _roles_previos(conexion, entidad, identidad)
        actuales = [x for x in (canales or []) if (x["entidad"], x["id"]) == (entidad, identidad)]
        nuevos = {x["canal"] for x in actuales}
        if not roles <= nuevos:
            raise ErrorTemporal("faltan_canales_protegidos", entidad, identidad, sorted(roles - nuevos))
        if not actuales:
            continue
        existe = _existe_entidad(conexion, entidad, identidad, tabla, objeto)
        if existe and not roles:
            raise ErrorTemporal("entidad_existente_sin_canales", entidad, identidad)
        comparacion = _comparar_canales_actuales(conexion, actuales, objeto)
        if comparacion.todos_iguales and nuevos == roles and comparacion.huellas_previas != {huella(_negocio(objeto))}:
            raise ErrorTemporal("mismas_capturas_con_negocio_distinto", entidad, identidad)
        aplicables = tuple(c for c in contratos if c.entidad == entidad and c.clave in nuevos)
        if aplicables or any(r.startswith(atribucion_temporal.PREFIJO) for r in roles):
            fila = conexion.execute("SELECT * FROM " + tabla + " WHERE id=?", (identidad,)).fetchone()
            exigir(fila is None or huella(contenido_anterior(fila)) == fila["huella"], "Huella nativa alterada")
            try:
                atribucion_temporal.comprobar_cambio(
                    contenido_anterior(fila), _negocio(objeto), aplicables, roles, set(comparacion.capturas_repetidas)
                )
            except atribucion_temporal.ErrorAtribucion as error:
                raise ErrorTemporal(str(error), entidad, identidad) from error
        if comparacion.negocio_distinto_con_capturas_iguales and not aplicables:
            raise ErrorTemporal(
                "actualizacion_compuesta_parcial_sin_atribucion_de_campos",
                entidad,
                identidad,
                list(comparacion.negocio_distinto_con_capturas_iguales),
            )


def _guardar_canales(
    conexion: sqlite3.Connection,
    objetos: ObjetosLote,
    canales: list[ObjetoJson] | None,
    ejecucion: int | None = None,
    instantanea: int | None = None,
) -> None:
    for item in canales or []:
        tabla, objeto = objetos[(item["entidad"], item["id"])]
        if item["entidad"] != "catalogo":
            # Aprendizaje puede conservar decisiones previas frente a una entrada
            # discrepante. El sello describe el estado realmente persistido.
            fila = conexion.execute(f"SELECT * FROM {tabla} WHERE id=?", (item["id"],)).fetchone()
            exigir(fila is not None, "No se sella una entidad no persistida")
            objeto = contenido_anterior(fila)
        canal = conexion.execute(
            (
                "INSERT INTO canales_temporales(entidad,entidad_id,canal,ejecucion_id,instantanea_id,"
                "huella_negocio) VALUES(?,?,?,?,?,?)"
            ),
            (item["entidad"], item["id"], item["canal"], ejecucion, instantanea, huella(_negocio(objeto))),
        ).lastrowid
        for e in item["evidencias"]:
            conexion.execute(
                "INSERT OR IGNORE INTO evidencias(url,capturado_utc,sha256,archivo,clave) VALUES(?,?,?,?,?)",
                (e["url"], e["capturado_utc"], e["sha256"], e["archivo"], huella(e)),
            )
            evidencia = conexion.execute("SELECT id FROM evidencias WHERE clave=?", (huella(e),)).fetchone()[0]
            conexion.execute("INSERT OR IGNORE INTO pruebas_temporales VALUES(?,?)", (canal, evidencia))


def _cargar_protegido(
    conexion: sqlite3.Connection,
    lote: ObjetoJson,
    canales: list[ObjetoJson] | None,
    contratos: tuple[ContratoCanal, ...] = (),
) -> dict[str, int]:
    objetos = _objetos_lote(lote)
    _evaluar_canales(conexion, objetos, canales, contratos)
    resultado = _cargar_en_conexion(conexion, lote)
    _guardar_canales(conexion, objetos, canales, resultado["ejecucion_id"])
    return resultado


def _leer_json(ruta: str | Path) -> ValorJson:
    def pares_unicos(pares: list[tuple[str, ValorJson]]) -> ObjetoJson:
        resultado = {}
        for clave, valor in pares:
            exigir(clave not in resultado, f"Clave JSON repetida: {clave}")
            resultado[clave] = valor
        return resultado

    with Path(ruta).open(encoding="utf-8") as entrada:
        return json.load(entrada, object_pairs_hook=pares_unicos)


def _comprobar_antiguedad_lote(conexion: sqlite3.Connection, lote: ObjetoJson) -> None:
    observado = fecha_utc(lote["observado_utc"], "observado_utc")
    grupos = (("proveedores", "proveedor"), ("programas", "programa"), ("ediciones", "edicion"))
    if lote["schema_version"] >= VERSION_LOTE_OFERTA:
        grupos += GRUPOS_OFERTA
    for grupo, entidad in grupos:
        tabla = "observaciones_oferta" if entidad in ENTIDADES_OFERTA else "observaciones"
        for objeto in lote[grupo]:
            if _roles_previos(conexion, entidad, objeto["id"]):
                continue
            if entidad == "proveedor":
                fila = conexion.execute("SELECT * FROM proveedores WHERE id=?", (objeto["id"],)).fetchone()
                if fila is not None and contenido_anterior(fila) == _negocio(objeto):
                    continue  # Identidad estática idéntica: no se modifica ningún hecho del proveedor.
            anteriores = conexion.execute(
                f"SELECT e.observado_utc FROM {tabla} o JOIN ejecuciones e ON e.id=o.ejecucion_id "
                f"WHERE o.{entidad}_id=?",
                (objeto["id"],),
            )
            exigir(
                all(observado >= fecha_utc(fila["observado_utc"], "observación almacenada") for fila in anteriores),
                f"Lote anterior a la última observación de {entidad}: {objeto['id']}",
            )


@contextmanager
def transaccion(base: str | Path, permitir_crear: bool) -> Iterator[sqlite3.Connection]:
    """Una conexión y un único commit sobre un catálogo V10; cualquier excepción revierte las acciones.

    Con `permitir_crear`, una base nueva o vacía (versión 0 y sin objetos) recibe el esquema V10 de `crear_catalogo`
    dentro de esta misma transacción: si la carga falla, no queda ninguna tabla. No se opera sobre otra versión ni se
    migra nada.

    Yields:
        Conexión con la versión leída y la escritura protegidas por la misma transacción.

    Raises:
        ErrorCatalogo: No se puede abrir la base, no es V10 o SQLite rechaza la operación.
    """
    try:
        if permitir_crear:
            conexion = sqlite3.connect(str(base), timeout=30)
        else:
            conexion = sqlite3.connect(Path(base).resolve().as_uri() + "?mode=rw", uri=True, timeout=30)
    except sqlite3.Error as error:
        raise ErrorCatalogo(f"No se puede abrir la base: {error}") from error
    conexion.row_factory = sqlite3.Row
    try:
        conexion.execute("PRAGMA foreign_keys=ON")
        # La versión y el esquema se leen bajo el mismo cerrojo que protege su escritura.
        conexion.execute("BEGIN IMMEDIATE")
        version = conexion.execute("PRAGMA user_version").fetchone()[0]
        if permitir_crear and version == 0:
            exigir(
                conexion.execute("SELECT count(*) FROM sqlite_master").fetchone()[0] == 0,
                "La base sin versión contiene objetos ajenos al catálogo",
            )
            # Importación local: crear_catalogo importa este módulo.
            from plataforma_datos.cursos import crear_catalogo

            ejecutar_esquema(conexion, crear_catalogo.esquema())
            conexion.execute(f"PRAGMA user_version={VERSION_SQLITE_CONTENIDOS}")
            version = VERSION_SQLITE_CONTENIDOS
        exigir(version == VERSION_SQLITE_CONTENIDOS, f"Versión de base no admitida: {version}; el catálogo es V10")
        _verificar_formato_ocho(conexion, verificar_revision=True)
        yield conexion
        conexion.commit()
    except sqlite3.Error as error:
        conexion.rollback()
        raise ErrorCatalogo(f"Operación revertida: {error}") from error
    except Exception:
        conexion.rollback()
        raise
    finally:
        conexion.close()


def _preparar_lote(
    entrada: ObjetoJson | str | Path, comprobar_capturas: bool, raiz_evidencias: str | Path | None
) -> ObjetoJson:
    lote = entrada if isinstance(entrada, dict) else _leer_json(entrada)
    validar_lote(lote, comprobar_capturas, raiz_evidencias)
    return lote


def _cargar_en_conexion(conexion: sqlite3.Connection, lote: ObjetoJson) -> dict[str, int]:
    try:
        registro = cargar_registro() if lote["schema_version"] == VERSION_LOTE_APRENDIZAJE else None
    except ErrorAprendizaje as error:
        raise ErrorCatalogo(str(error)) from error
    _comprobar_antiguedad_lote(conexion, lote)
    ejecucion = conexion.execute(
        "INSERT INTO ejecuciones(observado_utc,importado_utc,fuente_lote,huella_lote) VALUES(?,?,?,?)",
        (lote["observado_utc"], datetime.now(UTC).isoformat(), lote["fuente_lote"], huella(lote)),
    ).lastrowid
    for proveedor in lote["proveedores"]:
        _guardar_entidad(conexion, "proveedores", "proveedor", proveedor, ejecucion)
    for programa in lote["programas"]:
        antes = contenido_anterior(conexion.execute("SELECT * FROM programas WHERE id=?", (programa["id"],)).fetchone())
        programa, cambio = _preparar_aprendizaje(conexion, programa, antes, ejecucion, registro)
        _guardar_entidad(conexion, "programas", "programa", programa, ejecucion)
        _guardar_etiquetas(conexion, programa, ejecucion, cambio)
        _guardar_evidencias(conexion, programa, "programa", ejecucion)
    for edicion in lote["ediciones"]:
        _guardar_entidad(conexion, "ediciones", "edicion", edicion, ejecucion)
        _guardar_evidencias(conexion, edicion, "edicion", ejecucion)
    resultado = {
        "ejecucion_id": ejecucion,
        "proveedores_observados": len(lote["proveedores"]),
        "programas_observados": len(lote["programas"]),
        "ediciones_observadas": len(lote["ediciones"]),
    }
    if lote["schema_version"] >= VERSION_LOTE_OFERTA:
        for grupo, entidad in GRUPOS_OFERTA:
            for objeto in lote[grupo]:
                _guardar_entidad(conexion, grupo, entidad, objeto, ejecucion)
                _guardar_evidencias(conexion, objeto, entidad, ejecucion)
            resultado[grupo + "_observados"] = len(lote[grupo])
    return resultado


def cargar_lote(
    base: str | Path,
    entrada: ObjetoJson | str | Path,
    comprobar_capturas: bool = False,
    raiz_evidencias: str | Path | None = None,
    *,
    canales_temporales: list[ObjetoJson] | CanalesAtribuidos | None = None,
) -> dict[str, int]:
    """Importa un dict o archivo JSON; cualquier error revierte el lote entero.

    Las listas pueden ser parciales. Para un ciclo de fuente con actualización de
    pertenencias, utilizar importar_y_conciliar y su único commit conjunto.

    Returns:
        Recuentos de objetos observados en la transacción confirmada.
    """
    contratos_temporales = ()
    if isinstance(canales_temporales, CanalesAtribuidos):
        contratos_temporales = canales_temporales.contratos
        canales_temporales = canales_temporales.unico()
    lote = _preparar_lote(entrada, comprobar_capturas, raiz_evidencias)
    canales = _validar_canales(lote, canales_temporales, raiz_evidencias, contratos_temporales)
    with transaccion(base, permitir_crear=True) as conexion:
        return _cargar_protegido(conexion, lote, canales, contratos_temporales)


def cargar_lotes(
    base: str | Path,
    entradas: list[ObjetoJson | str | Path],
    comprobar_capturas: bool = False,
    raiz_evidencias: str | Path | None = None,
    *,
    canales_temporales: list[list[ObjetoJson]] | CanalesAtribuidos | None = None,
) -> list[dict[str, int]]:
    """Confirma varios lotes juntos sin sustituir sus fechas de observación.

    Se validan todos antes de abrir la base. Se respeta el orden explícito de
    entrada para las referencias entre lotes; no se ordenan ni concilian fuentes.
    Un fallo de antigüedad, referencia o escritura revierte la operación completa.
    El retorno es una lista de resultados de cargar_lote en el mismo orden.

    Returns:
        Un resultado por lote, en el orden recibido y con confirmación conjunta.
    """
    contratos_temporales = ()
    if isinstance(canales_temporales, CanalesAtribuidos):
        contratos_temporales = canales_temporales.contratos
        canales_temporales = canales_temporales.lotes()
    exigir(isinstance(entradas, list) and bool(entradas), "entradas debe ser una lista no vacía de lotes")
    lotes = [_preparar_lote(entrada, comprobar_capturas, raiz_evidencias) for entrada in entradas]
    exigir(
        canales_temporales is None or (isinstance(canales_temporales, list) and len(canales_temporales) == len(lotes)),
        "canales_temporales debe estar alineado con los lotes",
    )
    canales = [
        _validar_canales(lote_actual, c, raiz_evidencias, contratos_temporales)
        for lote_actual, c in zip(lotes, canales_temporales or [None] * len(lotes), strict=False)
    ]
    with transaccion(base, permitir_crear=True) as conexion:
        return [
            _cargar_protegido(conexion, lote_actual, c, contratos_temporales)
            for lote_actual, c in zip(lotes, canales, strict=False)
        ]


def _validar_instantanea(instantanea: InstantaneaCatalogo) -> set[str]:
    proveedor_id, ambito = instantanea.proveedor_id, instantanea.ambito
    ids_programas, total_publicado = instantanea.ids_programas, instantanea.total_publicado
    completa, errores, observado_utc = instantanea.completa, instantanea.errores, instantanea.observado_utc
    exigir_texto(proveedor_id, "proveedor_id")
    exigir_texto(ambito, "ambito")
    fecha_utc(observado_utc, "observado_utc de la captura real")
    exigir(
        completa is True and isinstance(errores, list) and not errores,
        "Solo se concilian instantáneas completas sin errores",
    )
    exigir(isinstance(ids_programas, list), "ids_programas debe ser una lista")
    for identificador in ids_programas:
        exigir_texto(identificador, "ids_programas")
    ids = set(ids_programas)
    exigir(len(ids) == len(ids_programas), "La instantánea contiene IDs duplicados")
    exigir(
        type(total_publicado) is int and total_publicado >= 0 and total_publicado == len(ids),
        "El total publicado debe coincidir con el número de IDs únicos",
    )
    return ids


def _conciliar_en_conexion(
    conexion: sqlite3.Connection, instantanea: InstantaneaCatalogo, ids: set[str], protegido: bool = False
) -> ObjetoJson:
    proveedor_id, ambito = instantanea.proveedor_id, instantanea.ambito
    total_publicado, observado_utc = instantanea.total_publicado, instantanea.observado_utc
    observado = fecha_utc(observado_utc, "observado_utc de la captura real")
    exigir(
        conexion.execute("SELECT 1 FROM proveedores WHERE id=?", (proveedor_id,)).fetchone() is not None,
        "Proveedor inexistente",
    )
    for identificador in sorted(ids):
        fila = conexion.execute("SELECT proveedor_id FROM programas WHERE id=?", (identificador,)).fetchone()
        exigir(
            fila is not None and fila["proveedor_id"] == proveedor_id,
            f"Programa inexistente o de otro proveedor: {identificador}",
        )
    if _roles_previos(conexion, "catalogo", _json([proveedor_id, ambito])) and not protegido:
        raise ErrorTemporal("censo_protegido_sin_pruebas", "catalogo", _json([proveedor_id, ambito]))
    anteriores_fechas = conexion.execute(
        "SELECT observado_utc FROM instantaneas WHERE proveedor_id=? AND ambito=?", (proveedor_id, ambito)
    )
    exigir(
        protegido
        or all(observado >= fecha_utc(fila["observado_utc"], "instantánea almacenada") for fila in anteriores_fechas),
        "La instantánea es anterior a la última aceptada en este ámbito",
    )
    instantanea = conexion.execute(
        "INSERT INTO instantaneas(proveedor_id,ambito,observado_utc,total_publicado) VALUES(?,?,?,?)",
        (proveedor_id, ambito, observado_utc, total_publicado),
    ).lastrowid
    anteriores = {
        fila["programa_id"]: fila["activo"]
        for fila in conexion.execute(
            "SELECT programa_id,activo FROM pertenencia_catalogo WHERE proveedor_id=? AND ambito=?",
            (proveedor_id, ambito),
        )
    }
    resultado = {
        "instantanea_id": instantanea,
        "activados": [],
        "retirados": [],
        "reactivados": [],
        "activos": len(ids),
    }
    for identificador in sorted(ids | set(anteriores)):
        previo = anteriores.get(identificador)
        if identificador in ids:
            conexion.execute(
                (
                    "INSERT INTO pertenencia_catalogo(proveedor_id,ambito,programa_id,activo,"
                    "ultima_observacion) VALUES(?,?,?,1,?) ON CONFLICT(proveedor_id,ambito,programa_id) "
                    "DO UPDATE SET activo=1,ultima_observacion=excluded.ultima_observacion"
                ),
                (proveedor_id, ambito, identificador, observado_utc),
            )
            cambio = "alta" if previo is None else "reactivacion" if previo == 0 else None
        elif previo == 1:
            conexion.execute(
                "UPDATE pertenencia_catalogo SET activo=0 WHERE proveedor_id=? AND ambito=? AND programa_id=?",
                (proveedor_id, ambito, identificador),
            )
            cambio = "retirada"
        else:
            cambio = None
        if cambio:
            conexion.execute(
                (
                    "INSERT INTO historial_pertenencia(instantanea_id,proveedor_id,ambito,programa_id,"
                    "cambio) VALUES(?,?,?,?,?)"
                ),
                (instantanea, proveedor_id, ambito, identificador, cambio),
            )
            resultado[{"alta": "activados", "retirada": "retirados", "reactivacion": "reactivados"}[cambio]].append(
                identificador
            )
    return resultado


def conciliar_instantanea(base: str | Path, instantanea: InstantaneaCatalogo) -> ObjetoJson:
    """Concilia una instantánea validada en una base ya existente.

    Es una operación autónoma. El ciclo de fuente debe usar importar_y_conciliar
    para que sus datos y su pertenencia se confirmen juntos.

    Returns:
        Altas, retiradas, reactivaciones y total activo de ese ámbito.
    """
    ids = _validar_instantanea(instantanea)
    with transaccion(base, permitir_crear=False) as conexion:
        return _conciliar_en_conexion(conexion, instantanea, ids)


def importar_y_conciliar(
    base: str | Path,
    entrada: ObjetoJson | str | Path | list[ObjetoJson | str | Path],
    instantanea: InstantaneaCatalogo,
    *,
    opciones: OpcionesCiclo | None = None,
) -> ObjetoJson:
    """Confirma lote y publicación de fuente en una sola conexión/transacción.

    Cualquier fallo, incluida la conciliación posterior a importar, revierte
    todas las entidades, evidencias, versiones, observaciones y pertenencias.

    Returns:
        Resultados de importación y conciliación confirmados juntos.
    """
    opciones = opciones if opciones is not None else OpcionesCiclo()
    proveedor_id, ambito = instantanea.proveedor_id, instantanea.ambito
    total_publicado = instantanea.total_publicado
    comprobar_capturas, raiz_evidencias = opciones.comprobar_capturas, opciones.raiz_evidencias
    canales_temporales, canales_censo = opciones.canales_temporales, opciones.canales_censo
    multiple = isinstance(entrada, list)
    entradas = entrada if multiple else [entrada]
    exigir(bool(entradas), "No hay lotes para importar")
    lotes = [_preparar_lote(e, comprobar_capturas, raiz_evidencias) for e in entradas]
    declarados = canales_temporales if multiple else [canales_temporales]
    if declarados is None:
        declarados = [None] * len(lotes)
    exigir(isinstance(declarados, list) and len(declarados) == len(lotes), "Canales desalineados con los lotes")
    canales = [
        _validar_canales(lote_actual, c, raiz_evidencias) for lote_actual, c in zip(lotes, declarados, strict=False)
    ]
    ids = _validar_instantanea(instantanea)
    identidad = _json([proveedor_id, ambito])
    objetos_censo = {
        ("catalogo", identidad): (
            None,
            {"clave": [proveedor_id, ambito], "ids": sorted(ids), "total_publicado": total_publicado},
        )
    }
    if canales_censo is not None:
        exigir(isinstance(canales_censo, list) and canales_censo, "Censo sin canales")
        vistos = set()
        for item in canales_censo:
            _campos(item, {"entidad", "id", "canal", "evidencias"}, "canal de censo")
            exigir(item["entidad"] == "catalogo" and item["id"] == identidad, "Canal ajeno al censo")
            exigir_texto(item["canal"], "rol del censo")
            exigir(item["canal"] not in vistos, "Rol de censo duplicado")
            vistos.add(item["canal"])
            exigir(raiz_evidencias is not None, "El censo exige raíz de capturas")
            _evidencias(item["evidencias"], "pruebas del censo", True, Path(raiz_evidencias).resolve())
            exigir(bool(item["evidencias"]), "Censo sin pruebas")
    with transaccion(base, permitir_crear=True) as conexion:
        _evaluar_canales(conexion, objetos_censo, canales_censo)
        resultados = [
            _cargar_protegido(conexion, lote_actual, c) for lote_actual, c in zip(lotes, canales, strict=False)
        ]
        if canales_censo is None:
            conciliacion = _conciliar_en_conexion(conexion, instantanea, ids)
        else:
            conciliacion = _conciliar_en_conexion(conexion, instantanea, ids, protegido=True)
        _guardar_canales(conexion, objetos_censo, canales_censo, instantanea=conciliacion["instantanea_id"])
        return {"importacion": resultados if multiple else resultados[0], "conciliacion": conciliacion}


def _verificar_formato_ocho(conexion: sqlite3.Connection, *, verificar_revision: bool = False) -> None:
    from plataforma_datos.cursos import registro_vigencia

    try:
        registro_vigencia.exigir_esquema_de_vigencia(conexion, verificar_revision=verificar_revision)
    except (ErrorCatalogo, registro_vigencia.ErrorRegistroVigencia) as error:
        version = conexion.execute("PRAGMA user_version").fetchone()[0]
        raise ErrorCatalogo(f"Formato V{version} no verificable: " + str(error)) from error


def abrir_lectura(base: str | Path) -> sqlite3.Connection:
    """Abre un catálogo V10 existente solo para leer, tras comprobar su versión y su formato.

    Returns:
        La conexión de solo lectura, con filas por nombre de columna.

    Raises:
        ErrorCatalogo: Si la base no existe, no es un catálogo V10 o su formato no es el esperado.
    """
    ruta = Path(base).resolve()
    exigir(ruta.is_file(), f"No existe el catálogo {ruta}; se crea al importar el primer lote")
    conexion = sqlite3.connect(ruta.as_uri() + "?mode=ro", uri=True)
    conexion.row_factory = sqlite3.Row
    try:
        version = conexion.execute("PRAGMA user_version").fetchone()[0]
        exigir(version == VERSION_SQLITE_CONTENIDOS, f"La base no contiene un catálogo V10 (versión {version})")
        _verificar_formato_ocho(conexion)
    except Exception:
        conexion.close()
        raise
    return conexion


def buscar(base: str | Path, texto: str) -> list[ObjetoJson]:
    """Busca sintaxis FTS5 en título/datos; devuelve hasta 50 programas.

    Returns:
        Programas coincidentes con sus datos y etiquetas vigentes.
    """
    exigir_texto(texto, "texto de búsqueda")
    conexion = abrir_lectura(base)
    try:
        filas = conexion.execute(
            (
                "SELECT p.id,p.titulo,p.url,p.proveedor_id,p.tipo_unidad,p.datos FROM programas_fts "
                "JOIN programas p ON p.id=programas_fts.id WHERE programas_fts MATCH ? ORDER BY rank,"
                "p.id LIMIT 50"
            ),
            (texto,),
        )
        return [dict(fila, datos=json.loads(fila["datos"])) for fila in filas]
    finally:
        conexion.close()


def consultar_aprendizaje(base: str | Path, programa_id: str) -> ObjetoJson | None:
    """Comprueba cada identidad contra el registro real de su decisión conservada.

    Returns:
        Aprendizaje con procedencias y conflictos, o None si el programa no existe.

    Raises:
        ErrorCatalogo: No se puede leer el catálogo.
    """
    exigir_texto(programa_id, "programa_id")
    conexion = abrir_lectura(base)
    try:
        conexion.execute("BEGIN")
        fila = conexion.execute("SELECT datos FROM programas WHERE id=?", (programa_id,)).fetchone()
        aprendizaje = None if fila is None else json.loads(fila["datos"]).get("aprendizaje")
        procedencias = {}
        if aprendizaje is not None:
            procedencias = {
                a["id"]: _procedencia_decision(conexion, programa_id, a) for a in aprendizaje["afirmaciones"]
            }
    finally:
        conexion.close()
    if fila is None:
        return None
    resultado = {"programa_id": programa_id, "aprendizaje": aprendizaje, "registro_disponible": None, "identidades": []}
    if aprendizaje is None:
        return resultado
    try:
        registro, huella_registro = cargar_registro()
    except ErrorAprendizaje as error:
        raise ErrorCatalogo(str(error)) from error
    referencia_actual = {"id": registro["id"], "version": registro["version"], "sha256": huella_registro}
    disponibilidades = []
    for afirmacion in aprendizaje["afirmaciones"]:
        referencia = afirmacion["competencia"]
        registro_decision = procedencias.get(afirmacion["id"])
        disponible = registro_decision == referencia_actual
        disponibilidades.append(disponible)
        if referencia is None:
            estado = "sin_referencia"
        elif not disponible:
            estado = "registro_no_disponible"
        else:
            estado = "registrada" if competencia_registrada(referencia, registro) else "no_registrada"
        resultado["identidades"].append(
            {
                "afirmacion_id": afirmacion["id"],
                "estado_referencia": estado,
                "registro_decision": registro_decision,
                "procedencia_registro": "conservada" if registro_decision is not None else "no_acreditada",
            }
        )
    resultado["registro_disponible"] = (
        all(disponibilidades) if disponibilidades else aprendizaje["registro"] == referencia_actual
    )
    return resultado


def resumen(base: str | Path) -> dict[str, int]:
    """Consulta los recuentos del catálogo sin modificarlo.

    Returns:
        Recuentos actuales de entidades, evidencias, versiones y observaciones.
    """
    conexion = abrir_lectura(base)
    try:
        tablas = (
            "proveedores",
            "programas",
            "ediciones",
            "evidencias",
            "versiones",
            "ejecuciones",
            "observaciones",
            "instantaneas",
            "pertenencia_catalogo",
            "historial_pertenencia",
            "conflictos_etiquetas",
            "variantes",
            "centros",
            "anuncios",
            "versiones_oferta",
            "observaciones_oferta",
            "conflictos_aprendizaje",
            "procedencias_aprendizaje",
        )
        resultado = {tabla: conexion.execute(f"SELECT count(*) FROM {tabla}").fetchone()[0] for tabla in tablas}
        resultado["pertenencias_activas"] = conexion.execute(
            "SELECT count(*) FROM pertenencia_catalogo WHERE activo=1"
        ).fetchone()[0]
        resultado["etiquetas_vigentes"] = conexion.execute("SELECT count(*) FROM etiquetas WHERE vigente=1").fetchone()[
            0
        ]
        resultado["etiquetas_requieren_revision"] = conexion.execute(
            "SELECT count(*) FROM etiquetas WHERE vigente=1 AND revision='requiere_revision'"
        ).fetchone()[0]
        return resultado
    finally:
        conexion.close()


def main(argv: list[str] | None = None) -> int:
    """Ejecuta la operación local de catálogo elegida en la línea de comandos.

    Returns:
        Código cero tras completar la operación solicitada.
    """
    parser = argparse.ArgumentParser(description="Catálogo local de investigación de formación")
    subcomandos = parser.add_subparsers(dest="orden", required=True)
    importar = subcomandos.add_parser("importar", help="Importar un lote JSON transaccional")
    importar.add_argument("--base", required=True)
    importar.add_argument("--entrada", required=True)
    importar.add_argument("--comprobar-capturas", action="store_true")
    importar.add_argument("--raiz-evidencias")
    consulta = subcomandos.add_parser("buscar", help="Consultar título y datos mediante FTS5")
    consulta.add_argument("--base", required=True)
    consulta.add_argument("--texto", required=True)
    estadisticas = subcomandos.add_parser("resumen", help="Consultar recuentos del catálogo")
    estadisticas.add_argument("--base", required=True)
    aprendizaje = subcomandos.add_parser(
        "aprendizaje", help="Diagnosticar el aprendizaje de un programa contra el registro con el que se decidió"
    )
    aprendizaje.add_argument("--base", required=True)
    aprendizaje.add_argument("--programa", required=True)
    argumentos = parser.parse_args(argv)
    try:
        if argumentos.orden == "importar":
            resultado = cargar_lote(
                argumentos.base, argumentos.entrada, argumentos.comprobar_capturas, argumentos.raiz_evidencias
            )
        elif argumentos.orden == "buscar":
            resultado = buscar(argumentos.base, argumentos.texto)
        elif argumentos.orden == "aprendizaje":
            resultado = consultar_aprendizaje(argumentos.base, argumentos.programa)
        else:
            resultado = resumen(argumentos.base)
        print(json.dumps(resultado, ensure_ascii=False, indent=2))
        return 0
    except (ValueError, OSError, sqlite3.Error) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
