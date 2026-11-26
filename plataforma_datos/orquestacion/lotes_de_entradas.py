"""Sella un lote de fuentes, con bloques comunes y reutilización de la base operativa exacta."""

import hashlib
import tempfile
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from plataforma_datos.orquestacion import observacion_de_entradas
from plataforma_datos.orquestacion.almacen_trabajos import AlmacenTrabajos
from plataforma_datos.orquestacion.archivos_de_generacion import MAX_ARCHIVOS, MAX_MANIFIESTO_BYTES, _camino, _propio
from plataforma_datos.orquestacion.bloques_almacen import (
    Contenido,
    _copiar_origen,
    guardar_archivos,
    recuperar_archivos,
)
from plataforma_datos.orquestacion.codigo_candidato import promover_directorio
from plataforma_datos.orquestacion.contrato_de_trabajos import _bytes, _fecha, _json, exigir, hexa, objeto
from plataforma_datos.orquestacion.controles_confirmados import (
    MAX_CONTROL_BYTES,
    ConflictoReferencia,
    escribir_confirmado,
)
from plataforma_datos.orquestacion.entradas_por_fuente import (
    CAMPOS_IDENTIDAD,
    MODULOS_DE_FUENTE,
    VERSION,
    EntradaInvalida,
    EntradaNoDisponible,
    IdentidadEntradas,
    _capturar_inventario,
    _inventario,
    _metadatos,
    _rutas,
    _verificable,
    _verificar_materializado,
    _vinculo,
)
from plataforma_datos.orquestacion.generacion_operativa import (
    MAX_TOTAL_BYTES,
    REVISION,
    SHA256,
    leer_manifiesto_generacion,
)

MINIMO_PARA_AGRUPAR = 16
INTENTOS_CAS = 3
CAMPOS_LOTE = CAMPOS_IDENTIDAD + ",version,inventario"


@dataclass(frozen=True)
class DatosEntrada:
    """Datos que el supervisor acredita para una fuente del intento."""

    observado_en: str
    lector_sha256: str
    dependencias: Mapping[str, str]
    observacion_remota: dict[str, Any] | None = None


def _clave(identidad: IdentidadEntradas) -> str:
    return f"entradas/v1/{identidad.run_id}/{identidad.intento}/lote.json"


def _puntero(revision: str, huella: str, dia: str) -> str:
    hexa(revision, REVISION)
    hexa(huella, SHA256)
    _fecha(dia)
    return f"entradas/v1/bases/{huella}/{dia}.json"


def _identidad(control: dict[str, Any]) -> IdentidadEntradas:
    objeto(control, CAMPOS_LOTE)
    exigir(type(control["version"]) is int and control["version"] == VERSION)
    base = objeto(control["base"], "revisionCodigo,sha256Manifiesto")
    identidad = IdentidadEntradas(
        control["runId"],
        control["intento"],
        control["solicitudId"],
        control["revisionReserva"],
        base["revisionCodigo"],
        base["sha256Manifiesto"],
        control["dia"],
    )
    identidad.campos()
    _vinculo(control["inventario"])
    return identidad


def _control(identidad: IdentidadEntradas, almacen: AlmacenTrabajos) -> dict[str, Any] | None:
    identidad.campos()
    lectura = almacen.leer_control(_clave(identidad), MAX_CONTROL_BYTES)
    if lectura is None:
        return None
    control = _json(lectura[0], MAX_CONTROL_BYTES)
    exigir(_identidad(control) == identidad)
    return control


def _identidad_en_puntero(lectura: tuple[bytes, str], base: IdentidadEntradas) -> IdentidadEntradas:
    identidad = _identidad(_json(lectura[0], MAX_CONTROL_BYTES))
    exigir(
        (identidad.revision_base, identidad.sha256_base, identidad.dia)
        == (base.revision_base, base.sha256_base, base.dia)
    )
    return identidad


def leer_ultimo_lote(
    revision_base: str,
    sha256_base: str,
    dia: str,
    *,
    almacen: AlmacenTrabajos,
) -> IdentidadEntradas | None:
    """Descubre el último intento confirmado para esa base y ese día.

    Returns:
        Identidad a recuperar, o None si falta exclusivamente el puntero. Un sello ausente o distinto es inválido.
    """
    with _verificable():
        clave = _puntero(revision_base, sha256_base, dia)
        anterior = almacen.leer_control(clave, MAX_CONTROL_BYTES)
        if anterior is None:
            return None
        documento = _json(anterior[0], MAX_CONTROL_BYTES)
        identidad = _identidad(documento)
        exigir((identidad.revision_base, identidad.sha256_base, identidad.dia) == (revision_base, sha256_base, dia))
        exigir(_control(identidad, almacen) == documento)
        return identidad


def _avanzar(identidad: IdentidadEntradas, control: dict[str, Any], almacen: AlmacenTrabajos) -> None:
    clave = _puntero(identidad.revision_base, identidad.sha256_base, identidad.dia)
    for _ in range(INTENTOS_CAS):
        lectura = almacen.leer_control(clave, MAX_CONTROL_BYTES)
        if lectura is not None:
            previa = _identidad_en_puntero(lectura, identidad)
            if previa.revision_reserva > identidad.revision_reserva:
                return
            if previa.revision_reserva == identidad.revision_reserva:
                exigir(control == _json(lectura[0], MAX_CONTROL_BYTES))
                return
        try:
            escribir_confirmado(clave, _bytes(control), None if lectura is None else lectura[1], almacen)
        except ConflictoReferencia:
            continue
        return
    raise EntradaNoDisponible("No se pudo confirmar el último lote de fuentes.")


def _base(identidad: IdentidadEntradas, base_sellada: Path | None) -> dict[str, dict[str, Any]]:
    if base_sellada is None:
        return {}
    manifiesto = leer_manifiesto_generacion(base_sellada, identidad.revision_base, identidad.sha256_base)
    return {archivo["ruta"]: archivo for archivo in manifiesto["archivos"]}


def _fuentes_del_lote(
    documento: dict[str, Any],
    identidad: IdentidadEntradas,
) -> tuple[dict[str, dict[str, Any]], list[dict[str, Any]]]:
    objeto(documento, "version,usaBase,fuentes")
    exigir(type(documento["version"]) is int and documento["version"] == VERSION)
    exigir(type(documento["usaBase"]) is bool)
    fuentes = documento["fuentes"]
    exigir(type(fuentes) is dict and 0 < len(fuentes) <= len(MODULOS_DE_FUENTE))
    esperado = identidad.campos()
    descriptores = {}
    comunes = []
    for fuente, entrada in fuentes.items():
        rutas = _rutas(fuente)
        campos_entrada = "observadoEn,lectorSha256,dependencias,inventario"
        if type(entrada) is dict and "observacionRemota" in entrada:
            campos_entrada += ",observacionRemota"
        objeto(entrada, campos_entrada)
        campos = {k: entrada[k] for k in ("observadoEn", "lectorSha256", "dependencias")}
        control = {**esperado, "version": VERSION, "fuente": fuente, **campos}
        _metadatos(control, esperado, fuente)
        if "observacionRemota" in entrada:
            control["observacionRemota"] = observacion_de_entradas.validar_observacion_de_lote(
                fuente, entrada["observacionRemota"], entrada["observadoEn"]
            )
        archivos = _inventario(entrada["inventario"], fuente, rutas)
        contenido = _bytes(entrada["inventario"])
        control["inventario"] = {"bytes": len(contenido), "sha256": hashlib.sha256(contenido).hexdigest()}
        descriptores[fuente] = control
        comunes.extend(archivos)
    exigir(len(comunes) == len({a["ruta"] for a in comunes}) <= MAX_ARCHIVOS)
    exigir(sum(a["bytes"] for a in comunes) <= MAX_TOTAL_BYTES)
    return descriptores, comunes


def _delta(archivos: list[dict[str, Any]], inventario_base: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    return [archivo for archivo in archivos if inventario_base.get(archivo["ruta"]) != archivo]


def _capturar(fuente: str, datos: DatosEntrada, raiz: Path, esperado: dict[str, Any]) -> dict[str, Any]:
    with _verificable():
        rutas = _rutas(fuente)
        campos = {
            "observadoEn": datos.observado_en,
            "lectorSha256": datos.lector_sha256,
            "dependencias": dict(datos.dependencias),
        }
        _metadatos({**esperado, "version": VERSION, "fuente": fuente, **campos}, esperado, fuente)
        exigir(set(datos.dependencias) == set(MODULOS_DE_FUENTE[fuente][0].entradas))
        if datos.observacion_remota is not None:
            campos["observacionRemota"] = observacion_de_entradas.validar_observacion_de_lote(
                fuente, datos.observacion_remota, datos.observado_en
            )
        return {**campos, "inventario": _capturar_inventario(raiz, fuente, rutas)}


def guardar_lote(
    identidad: IdentidadEntradas,
    raiz: Path,
    fuentes: Mapping[str, DatosEntrada],
    *,
    almacen: AlmacenTrabajos,
    base_sellada: Path | None = None,
) -> dict[str, dict[str, Any]]:
    """Sella las fuentes verificables y apunta al lote únicamente después de confirmar todos sus objetos.

    El supervisor aporta solo entradas y dependencias de la reserva acreditada y mantiene la candidata estable.
    La base opcional es el directorio verificado de la generación de partida, con manifiesto y contenido.

    Returns:
        Descriptores por fuente confirmada. Las fuentes inválidas quedan fuera del lote y de este resultado.
    """
    with _verificable():
        esperado = identidad.campos()
        capturas = {}
        for fuente, datos in fuentes.items():
            try:
                capturas[fuente] = _capturar(fuente, datos, raiz, esperado)
            except EntradaInvalida:
                continue
        if not capturas:
            return {}
        inventario_base = _base(identidad, base_sellada)
        lote = {"version": VERSION, "usaBase": base_sellada is not None, "fuentes": capturas}
        descriptores, archivos = _fuentes_del_lote(lote, identidad)
        datos_lote = _bytes(lote)
        huella = hashlib.sha256(datos_lote).hexdigest()
        control = {**esperado, "version": VERSION, "inventario": _vinculo({"sha256": huella, "bytes": len(datos_lote)})}
        previo = _control(identidad, almacen)
        if previo is None:
            guardar_archivos(
                raiz,
                _delta(archivos, inventario_base),
                f"entradas/{huella}.json",
                almacen,
                desde_contenidos=MINIMO_PARA_AGRUPAR,
            )
            with tempfile.TemporaryDirectory(prefix=".inventario-lote-") as nombre:
                archivo = Path(nombre) / "lote.json"
                archivo.write_bytes(datos_lote)
                almacen.guardar(f"blobs/{huella}", archivo, huella, len(datos_lote))
            escribir_confirmado(_clave(identidad), _bytes(control), None, almacen)
        else:
            exigir(previo == control)
        _avanzar(identidad, control, almacen)
        return descriptores


def _recuperar_inventario(
    temporal: Path,
    control: dict[str, Any],
    almacen: AlmacenTrabajos,
) -> tuple[str, dict[str, Any]]:
    archivo = temporal / "lote.json"
    vinculo = control["inventario"]
    huella, tamano = vinculo["sha256"], vinculo["bytes"]
    almacen.recuperar(f"blobs/{huella}", archivo, huella, tamano)
    _propio(archivo)
    exigir(archivo.stat().st_size == tamano)
    contenido = archivo.read_bytes()
    exigir(hashlib.sha256(contenido).hexdigest() == huella)
    return huella, _json(contenido, MAX_MANIFIESTO_BYTES)


def _reponer(
    contenido: Path,
    base_sellada: Path,
    archivo: dict[str, Any],
) -> None:
    relativa = archivo["ruta"]
    destino = contenido / relativa
    destino.parent.mkdir(parents=True, exist_ok=True)
    origen = _camino(base_sellada / "contenido", relativa)
    with destino.open("xb") as salida:
        _copiar_origen(origen, salida, Contenido(archivo["sha256"], archivo["bytes"], [relativa]))


def recuperar_lote(
    identidad: IdentidadEntradas,
    destino_nuevo: Path,
    *,
    almacen: AlmacenTrabajos,
    base_sellada: Path | None = None,
) -> dict[str, dict[str, Any]] | None:
    """Materializa en un árbol nuevo los archivos verificados de las fuentes solicitadas al supervisor.

    Returns:
        Descriptores por fuente, o None exclusivamente si no hay un sello del intento.
    """
    with _verificable():
        control = _control(identidad, almacen)
        if control is None:
            return None
        _propio(destino_nuevo.parent, directorio=True)
        exigir(not destino_nuevo.exists() and not destino_nuevo.is_symlink())
        with tempfile.TemporaryDirectory(prefix=".recuperando-lote-", dir=destino_nuevo.parent) as nombre:
            temporal = Path(nombre)
            huella, documento = _recuperar_inventario(temporal, control, almacen)
            descriptores, archivos = _fuentes_del_lote(documento, identidad)
            contenido = temporal / "contenido"
            contenido.mkdir(mode=0o700)
            inventario_base = {}
            if documento["usaBase"]:
                exigir(base_sellada is not None)
                assert base_sellada is not None
                inventario_base = _base(identidad, base_sellada)
                for archivo in archivos:
                    if inventario_base.get(archivo["ruta"]) == archivo:
                        _reponer(contenido, base_sellada, archivo)
            recuperar_archivos(
                contenido,
                _delta(archivos, inventario_base),
                f"entradas/{huella}.json",
                almacen,
                desde_contenidos=MINIMO_PARA_AGRUPAR,
            )
            for fuente, entrada in documento["fuentes"].items():
                _verificar_materializado(contenido, _rutas(fuente), entrada["inventario"]["archivos"])
            promover_directorio(contenido, destino_nuevo)
        return descriptores
