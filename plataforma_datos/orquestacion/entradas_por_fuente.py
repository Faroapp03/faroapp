"""Entradas privadas verificadas por fuente, independientes del resultado del paquete."""

import hashlib
import re
import tempfile
from collections.abc import Iterator, Mapping
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path
from typing import Any

from plataforma_datos.biblioteca.fuentes.enlaces_lecturas.lector import ARCHIVO as OBSERVACIONES_LECTURAS
from plataforma_datos.comun.entrada_salida import sha256
from plataforma_datos.comun.nucleo import ErrorFuente
from plataforma_datos.cursos.fuentes.formacion.constantes import PREPARADOS as PREPARADOS_FORMACION
from plataforma_datos.orquestacion.admision import exigir_admitido
from plataforma_datos.orquestacion.almacen_trabajos import RUN, UUID, AlmacenTrabajos
from plataforma_datos.orquestacion.archivos_de_generacion import (
    MAX_ARCHIVO_BYTES,
    MAX_ARCHIVOS,
    MAX_MANIFIESTO_BYTES,
    _arbol,
    _camino,
    _propio,
    _ruta,
)
from plataforma_datos.orquestacion.archivos_de_generacion import (
    _json as _json_archivo,
)
from plataforma_datos.orquestacion.bloques_almacen import guardar_archivos, recuperar_archivos
from plataforma_datos.orquestacion.codigo_candidato import promover_directorio
from plataforma_datos.orquestacion.contrato_de_trabajos import (
    _bytes,
    _entero,
    _fecha,
    _json,
    exigir,
    hexa,
    instante,
    objeto,
)
from plataforma_datos.orquestacion.controles_confirmados import MAX_CONTROL_BYTES, escribir_confirmado
from plataforma_datos.orquestacion.generacion_operativa import (
    MAX_TOTAL_BYTES,
    REVISION,
    SHA256,
    _comprobar_rutas,
    _registros,
    originales_de_la_fuente,
)
from plataforma_datos.orquestacion.indices_de_canales import referencias
from plataforma_datos.orquestacion.modulos import MODULOS, carpetas
from plataforma_datos.orquestacion.piezas_de_la_actualizacion import FUENTES

VERSION = 1
ID_FUENTE = re.compile(r"[a-z][a-z0-9_-]{0,63}")
MODULOS_DE_FUENTE = {fuente: (modulo, i) for modulo in MODULOS for i, fuente in enumerate(modulo.fuentes)}
MAX_DEPENDENCIAS = 64
CAMPOS_IDENTIDAD = "runId,intento,solicitudId,revisionReserva,base,dia"
CAMPOS_CONTROL = CAMPOS_IDENTIDAD + ",version,fuente,observadoEn,lectorSha256,dependencias,inventario"
ERROR = "Entradas de la fuente no verificables."


class EntradaInvalida(ValueError):
    """Contenido ausente tras un sello confirmado o no verificable."""


class EntradaNoDisponible(OSError):
    """El almacén o el disco no pudo completar la operación."""


@dataclass(frozen=True)
class IdentidadEntradas:
    """Identidad exacta del intento autorizado y la generación base de la que partió."""

    run_id: str
    intento: str
    solicitud_id: str
    revision_reserva: int
    revision_base: str
    sha256_base: str
    dia: str

    def campos(self) -> dict[str, Any]:
        """Valida y serializa la identidad esperada.

        Returns:
            Campos privados canónicos, incluyendo el día UTC de comienzo del ciclo.
        """
        for valor in (self.run_id, self.intento):
            hexa(valor, RUN)
            _entero(int(valor), 1)
        hexa(self.solicitud_id, UUID)
        _entero(self.revision_reserva, 1)
        hexa(self.revision_base, REVISION)
        hexa(self.sha256_base, SHA256)
        _fecha(self.dia)
        return {
            "runId": self.run_id,
            "intento": self.intento,
            "solicitudId": self.solicitud_id,
            "revisionReserva": self.revision_reserva,
            "base": {"revisionCodigo": self.revision_base, "sha256Manifiesto": self.sha256_base},
            "dia": self.dia,
        }


@contextmanager
def _verificable() -> Iterator[None]:
    try:
        yield
    except (EntradaInvalida, EntradaNoDisponible):
        raise
    except (ErrorFuente, ValueError, FileNotFoundError, FileExistsError, KeyError, TypeError, RecursionError):
        raise EntradaInvalida(ERROR) from None
    except OSError:
        raise EntradaNoDisponible(ERROR) from None


def fuente_elegible(fuente: str) -> bool:
    """Comprueba la política común del motor y del formato de almacén.

    Returns:
        Si la fuente está registrada, tiene acceso remoto y declara originales.
    """
    return fuente in MODULOS_DE_FUENTE and bool(FUENTES[fuente].red and FUENTES[fuente].originales)


def _rutas(fuente: str) -> tuple[str, str, str]:
    hexa(fuente, ID_FUENTE)
    exigir(fuente_elegible(fuente))
    modulo, i = MODULOS_DE_FUENTE[fuente]
    original, preparado, validado = carpetas(modulo)[3 * i : 3 * i + 3]
    return original, preparado, validado


def _clave(identidad: IdentidadEntradas, fuente: str) -> str:
    return f"entradas/v1/{identidad.run_id}/{identidad.intento}/{fuente}.json"


def _metadatos(control: dict[str, Any], identidad: dict[str, Any], fuente: str) -> None:
    exigir(type(control["version"]) is int and control["version"] == VERSION)
    exigir(all(type(control[k]) is type(v) and control[k] == v for k, v in identidad.items()))
    exigir(control["fuente"] == fuente)
    instante(control["observadoEn"])
    dia = date.fromisoformat(identidad["dia"])
    observado = date.fromisoformat(control["observadoEn"][:10])
    exigir(timedelta() <= observado - dia <= timedelta(days=1))
    hexa(control["lectorSha256"], SHA256)
    dependencias = control["dependencias"]
    exigir(type(dependencias) is dict and len(dependencias) <= MAX_DEPENDENCIAS)
    for nombre, huella in dependencias.items():
        hexa(nombre, ID_FUENTE)
        hexa(huella, SHA256)


def _vinculo(valor: object) -> dict[str, Any]:
    vinculo = objeto(valor, "sha256,bytes")
    hexa(vinculo["sha256"], SHA256)
    _entero(vinculo["bytes"], 1)
    exigir(vinculo["bytes"] <= MAX_MANIFIESTO_BYTES)
    return vinculo


def _archivos_de_entrada(raiz: Path, rutas: tuple[str, str, str]) -> set[str]:
    original, preparado, validado = rutas
    procedencia = _json_archivo(_camino(raiz, f"{original}/procedencia.json"))
    declaradas: dict[str, str] = {}
    for nombre, huella in referencias(procedencia):
        exigir(declaradas.setdefault(nombre, huella) == huella)
    archivos = originales_de_la_fuente(raiz, Path(original).name)
    for carpeta in (preparado, validado):
        local = raiz / carpeta
        if carpeta == preparado and not local.exists() and not local.is_symlink():
            continue
        arbol = _camino(raiz, carpeta)
        archivos.update(f"{carpeta}/{ruta.relative_to(arbol).as_posix()}" for ruta in _arbol(arbol))
    return archivos


def _salidas_obligatorias(fuente: str, preparado: str, validado: str) -> set[str]:
    if fuente == "formacion":
        # SOC y el resto de Formación se exportan desde las tablas preparadas.
        return {f"{preparado}/{ruta.name}" for ruta in PREPARADOS_FORMACION.values()}
    if fuente == "enlaces_lecturas":
        return {f"{validado}/{OBSERVACIONES_LECTURAS}"}
    conjunto = {f"{validado}/{Path(validado).name}.json"}
    if fuente == "tich":
        conjunto.add(f"{validado}/edicion.json")
    return conjunto


def _inventario(datos: object, fuente: str, rutas: tuple[str, str, str]) -> list[dict[str, Any]]:
    inventario = objeto(datos, "version,archivos,bytesTotales")
    exigir(type(inventario["version"]) is int and inventario["version"] == VERSION)
    archivos = inventario["archivos"]
    _entero(inventario["bytesTotales"])
    exigir(type(archivos) is list and 0 < len(archivos) <= MAX_ARCHIVOS)
    prefijos = tuple(ruta + "/" for ruta in rutas)
    nombres = []
    tamanos: dict[str, int] = {}
    total = 0
    for archivo in archivos:
        entrada = objeto(archivo, "ruta,sha256,bytes")
        nombre = _ruta(entrada["ruta"])
        exigir(nombre.startswith(prefijos))
        _entero(entrada["bytes"])
        exigir(entrada["bytes"] <= MAX_ARCHIVO_BYTES)
        hexa(entrada["sha256"], SHA256)
        exigir(tamanos.setdefault(entrada["sha256"], entrada["bytes"]) == entrada["bytes"])
        total += entrada["bytes"]
        nombres.append(nombre)
    exigir(total == inventario["bytesTotales"] and total <= MAX_TOTAL_BYTES)
    exigir(nombres == sorted(set(nombres)))
    original, preparado, validado = rutas
    obligatorios = {f"{original}/procedencia.json", f"{validado}/validacion.json"}
    obligatorios |= _salidas_obligatorias(fuente, preparado, validado)
    exigir(obligatorios.issubset(nombres))
    _comprobar_rutas(nombres)
    return archivos


def _capturar_inventario(raiz: Path, fuente: str, rutas: tuple[str, str, str]) -> dict[str, Any]:
    nombres = _archivos_de_entrada(raiz, rutas)
    validacion = _camino(raiz, f"{rutas[2]}/validacion.json")
    _propio(validacion)
    exigir_admitido(fuente, ruta=validacion)
    archivos = _registros(raiz, nombres)
    inventario = {"version": VERSION, "archivos": archivos, "bytesTotales": sum(a["bytes"] for a in archivos)}
    _inventario(inventario, fuente, rutas)
    return inventario


def leer_entrada(identidad: IdentidadEntradas, fuente: str, *, almacen: AlmacenTrabajos) -> dict[str, Any] | None:
    """Lee solo el control respaldado por la identidad esperada.

    Returns:
        Descriptor cerrado, o None exclusivamente si falta el control del intento.
    """
    with _verificable():
        esperado = identidad.campos()
        _rutas(fuente)
        lectura = almacen.leer_control(_clave(identidad, fuente), MAX_CONTROL_BYTES)
        if lectura is None:
            return None
        control = objeto(_json(lectura[0], MAX_CONTROL_BYTES), CAMPOS_CONTROL)
        _metadatos(control, esperado, fuente)
        _vinculo(control["inventario"])
        return control


def guardar_entrada(  # noqa: PLR0913 - Identidad, origen y expectativas de la fuente son explícitos.
    identidad: IdentidadEntradas,
    fuente: str,
    raiz: Path,
    *,
    observado_en: str,
    lector_sha256: str,
    dependencias: Mapping[str, str],
    almacen: AlmacenTrabajos,
) -> dict[str, Any]:
    """Publica un control inmutable después de guardar los bytes de la fuente.

    El llamador aporta una recepción y una validación acreditadas del intento, nunca su base anterior como si fuera
    nueva. Debe mantener el árbol de origen estable mientras se sella. Cada dependencia es la huella efectivamente
    utilizada por el lector. Nada del paquete ni su resultado interviene en el sello.

    Returns:
        Descriptor que identifica el inventario confirmado.
    """
    with _verificable():
        rutas = _rutas(fuente)
        esperado = identidad.campos()
        control = {
            **esperado,
            "version": VERSION,
            "fuente": fuente,
            "observadoEn": observado_en,
            "lectorSha256": lector_sha256,
            "dependencias": dict(dependencias),
        }
        _metadatos(control, esperado, fuente)
        exigir(set(dependencias) == set(MODULOS_DE_FUENTE[fuente][0].entradas))
        inventario = _capturar_inventario(raiz, fuente, rutas)
        datos = _bytes(inventario)
        huella = hashlib.sha256(datos).hexdigest()
        control["inventario"] = _vinculo({"sha256": huella, "bytes": len(datos)})
        sello = _bytes(control)
        exigir(len(sello) <= MAX_CONTROL_BYTES)
        previo = leer_entrada(identidad, fuente, almacen=almacen)
        if previo is not None:
            exigir(previo == control)
            return previo
        guardar_archivos(raiz, inventario["archivos"], f"entradas/{huella}.json", almacen)
        with tempfile.TemporaryDirectory(prefix=".inventario-entradas-") as nombre:
            archivo = Path(nombre) / "inventario.json"
            archivo.write_bytes(datos)
            almacen.guardar(f"blobs/{huella}", archivo, huella, len(datos))
        escribir_confirmado(_clave(identidad, fuente), sello, None, almacen)
        return control


def _verificar_materializado(contenido: Path, rutas: tuple[str, str, str], archivos: list[dict[str, Any]]) -> None:
    nombres = {archivo["ruta"] for archivo in archivos}
    exigir(nombres == _archivos_de_entrada(contenido, rutas))
    for archivo in archivos:
        materializado = _camino(contenido, archivo["ruta"])
        _propio(materializado)
        exigir(materializado.stat().st_size == archivo["bytes"] and sha256(materializado) == archivo["sha256"])


def recuperar_entrada(
    identidad: IdentidadEntradas, fuente: str, destino_nuevo: Path, *, almacen: AlmacenTrabajos
) -> dict[str, Any] | None:
    """Restaura solo las rutas de esta fuente, de forma atómica, en un directorio privado nuevo.

    Returns:
        Descriptor del contenido restaurado, o None si no existe el sello. La aptitud del validado se decide comparando
        lector y dependencias con los actuales, y ejecutando las comprobaciones del llamador.
    """
    with _verificable():
        control = leer_entrada(identidad, fuente, almacen=almacen)
        if control is None:
            return None
        rutas = _rutas(fuente)
        _propio(destino_nuevo.parent, directorio=True)
        exigir(not destino_nuevo.exists() and not destino_nuevo.is_symlink())
        with tempfile.TemporaryDirectory(prefix=".recuperando-entradas-", dir=destino_nuevo.parent) as nombre:
            temporal = Path(nombre)
            archivo = temporal / "inventario.json"
            huella, tamano = (control["inventario"][campo] for campo in ("sha256", "bytes"))
            almacen.recuperar(f"blobs/{huella}", archivo, huella, tamano)
            _propio(archivo)
            exigir(archivo.stat().st_size == tamano)
            datos = archivo.read_bytes()
            exigir(hashlib.sha256(datos).hexdigest() == huella)
            archivos = _inventario(_json(datos, MAX_MANIFIESTO_BYTES), fuente, rutas)
            contenido = temporal / "contenido"
            contenido.mkdir(mode=0o700)
            recuperar_archivos(contenido, archivos, f"entradas/{huella}.json", almacen)
            _verificar_materializado(contenido, rutas, archivos)
            promover_directorio(contenido, destino_nuevo)
        return control
