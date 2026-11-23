"""Restituye en un candidato privado los originales citados por una generación anterior al inventario v2."""

from __future__ import annotations

import hashlib
import tempfile
import zipfile
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import TYPE_CHECKING

from plataforma_datos.comun.entrada_salida import sha256
from plataforma_datos.cursos import trozos_catalogo as trozos
from plataforma_datos.orquestacion import diario_mantenimiento as diario
from plataforma_datos.orquestacion import evidencias_ediciones as ediciones
from plataforma_datos.orquestacion import originales_troceados
from plataforma_datos.orquestacion.archivos_de_generacion import _camino, _exigir, _propio
from plataforma_datos.orquestacion.generacion_operativa import leer_manifiesto_generacion

MAX_APOYO = 128 * 1024 * 1024
BuscarApoyo = Callable[[Path, Path], None]


if TYPE_CHECKING:
    from plataforma_datos.orquestacion.almacen_trabajos import AlmacenTrabajos


def _clave(raiz: Path) -> str:
    return f"evidencias/fundae/v1/{sha256(_camino(raiz, ediciones.INFORME))}.sha256"


def construir(raiz: Path, archivo: Path, destino: Path) -> None:
    """Crea el mismo ZIP a partir del informe sellado y de originales privados cotejados por contenido."""
    por_huella = {huella: ruta for ruta, huella in ediciones.referencias(raiz).items()}
    with zipfile.ZipFile(destino, "x") as lote:
        for huella, nombre in sorted(por_huella.items()):
            ruta = _camino(archivo, nombre)
            _propio(ruta)
            datos = trozos.leer(ruta, huella, limite=trozos.MAX_CUERPO)
            _exigir(destino.stat().st_size + len(datos) <= MAX_APOYO)
            lote.writestr(zipfile.ZipInfo(huella), datos)
    _exigir(destino.stat().st_size <= MAX_APOYO)


@contextmanager
def _lote(apoyo: Path, huellas: set[str]) -> Iterator[zipfile.ZipFile]:
    _propio(apoyo)
    _exigir(apoyo.stat().st_size <= MAX_APOYO)
    try:
        with zipfile.ZipFile(apoyo) as lote:
            entradas = lote.infolist()
            _exigir(len(entradas) == len(huellas) and set(lote.namelist()) == huellas)
            _exigir(sum(e.file_size for e in entradas) <= MAX_APOYO)
            _exigir(
                all(
                    e.compress_type == zipfile.ZIP_STORED and e.compress_size == e.file_size and not e.flag_bits
                    for e in entradas
                )
            )
            yield lote
    except zipfile.BadZipFile as error:
        raise ValueError("Archivo histórico de ediciones FUNDAE dañado") from error


def _leer(lote: zipfile.ZipFile, huella: str) -> bytes:
    datos = lote.read(huella)
    _exigir(hashlib.sha256(datos).hexdigest() == huella)
    return datos


def guardar(raiz: Path, apoyo: Path, almacen: AlmacenTrabajos) -> None:
    """Guarda el lote por su huella y confirma la asociación inmutable con la validación de origen."""
    huellas = set(ediciones.referencias(raiz).values())
    with _lote(apoyo, huellas) as lote:
        for miembro in huellas:
            _leer(lote, miembro)
    huella = sha256(apoyo)
    almacen.guardar(f"blobs/{huella}", apoyo, huella, apoyo.stat().st_size)
    clave = _clave(raiz)
    dato = huella.encode("ascii")
    almacen.guardar_control(clave, dato, None)
    actual = almacen.leer_control(clave, len(dato))
    _exigir(actual is not None and actual[0] == dato)


def descargar(raiz: Path, destino: Path, almacen: AlmacenTrabajos) -> None:
    """Obtiene únicamente el apoyo asociado al informe de la generación ya verificada.

    Raises:
        ValueError: Si falta el archivo asociado a la validación.
    """
    lectura = almacen.leer_control(_clave(raiz), 64)
    if lectura is None:
        raise ValueError("Falta el archivo histórico de las ediciones FUNDAE")
    huella = lectura[0].decode("ascii")
    _exigir(ediciones.HUELLA.fullmatch(huella) is not None)
    almacen.recuperar(f"blobs/{huella}", destino, huella, MAX_APOYO)


def indice_del_sello(generacion: Path, revision: str, huella: str) -> dict[str, str]:
    """Indexa las copias físicas que ya acredita el manifiesto de confianza.

    Returns:
        Una ruta del inventario por cada SHA-256.
    """
    manifiesto = leer_manifiesto_generacion(generacion, revision, huella)
    return {r["sha256"]: r["ruta"] for r in manifiesto["archivos"]}


def faltan(raiz: Path, indice: dict[str, str] | None = None) -> bool:
    """Detecta referencias que requieren un archivo externo.

    Returns:
        Verdadero si una referencia está ausente tanto en su ruta como en el índice por contenido.
    """
    sellados = indice or {}
    return any(
        not (raiz / ruta).exists() and huella not in sellados for ruta, huella in ediciones.referencias(raiz).items()
    )


def _destino(raiz: Path, ruta: str) -> Path:
    padre = raiz
    for parte in Path(ruta).parts[:-1]:
        padre /= parte
        padre.mkdir(exist_ok=True)
        _propio(padre, directorio=True)
    salida = _camino(raiz, ruta)
    _exigir(not salida.is_symlink())
    return salida


def reponer_desde_sello(raiz: Path, ausentes: dict[str, str], indice: dict[str, str]) -> None:
    """Repone cada ruta que ya tiene los mismos bytes en el sello y retira las recuperadas de la lista."""
    for ruta, huella in list(ausentes.items()):
        if huella in indice:
            fuente = _camino(raiz, indice[huella])
            _propio(fuente)
            datos = trozos.leer(fuente, huella, limite=trozos.MAX_CUERPO)
            trozos.conservar(_destino(raiz, ruta), datos, huella)
            del ausentes[ruta]


def restaurar(
    raiz: Path, buscar: BuscarApoyo, *, apoyo: Path | None = None, indice: dict[str, str] | None = None
) -> int:
    """Recupera dentro de la copia descartable exclusivamente los bytes acreditados por su validación.

    Returns:
        Número de rutas restituidas desde el sello y, si hace falta, el respaldo externo.
    """
    referencias = ediciones.referencias(raiz)
    ausentes = {}
    for ruta, huella in referencias.items():
        if (raiz / ruta).exists() or (raiz / ruta).is_symlink():
            originales_troceados.seleccionar(raiz, ruta, huella, _camino, _propio)
        else:
            ausentes[ruta] = huella
    total = len(ausentes)
    reponer_desde_sello(raiz, ausentes, indice or {})
    if total > len(ausentes):
        diario.anotar("originales-de-ediciones", "reutilizados-del-sello", archivos=total - len(ausentes))
    if not ausentes:
        return total
    with tempfile.TemporaryDirectory(dir=raiz.parent) as temporal:
        if apoyo is None:
            apoyo = Path(temporal) / "ediciones.zip"
            buscar(raiz, apoyo)
        with _lote(apoyo, set(referencias.values())) as lote:
            for ruta, huella in ausentes.items():
                datos = _leer(lote, huella)
                trozos.conservar(_destino(raiz, ruta), datos, huella)
    diario.anotar("originales-de-ediciones", "recuperados-del-archivo", archivos=len(ausentes))
    return total
