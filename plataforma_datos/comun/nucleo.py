"""Núcleo de la cadena de datos: rutas operativas, errores con motivo, registros y controles de validación."""

import json
import sqlite3
import zipfile
from collections.abc import Callable
from pathlib import Path
from typing import BinaryIO, Final, Literal, NamedTuple, TypedDict

from plataforma_datos.comun.perfil_web import AGENTE_POR_DEFECTO as AGENTE_POR_DEFECTO

RAIZ = Path(__file__).resolve().parents[2]
# Carpeta de trabajo de la actualización, relativa a la raíz: la misma bajo otra raíz (pruebas, áreas de trabajo y
# copias de la generación) y en los nombres relativos de manifiestos e inventarios (`.as_posix()`).
DATOS_RELATIVOS = Path("var/actualizacion")
DATOS = RAIZ / DATOS_RELATIVOS
ORIGINALES = DATOS / "originales"
PREPARADOS = DATOS / "preparados"
VALIDADOS = DATOS / "validados"
PAQUETE = RAIZ / "datos"
# Los dos archivos que tiene cada fuente: de dónde sale cada original y qué controles ha pasado.
ARCHIVO_DE_PROCEDENCIA = "procedencia.json"
ARCHIVO_DE_VALIDACION = "validacion.json"

# El resultado de un control en `validacion.json`: lo leen las revisiones y el paquete tal como está escrito.
CORRECTO: Final = "correcto"
ERROR: Final = "ERROR"
type Resultado = Literal["correcto", "ERROR"]
# El estado de una validación en `validacion.json`; quien lo lee comprueba que empieza por ADMITIDO.
ADMITIDO: Final = "Admitido"
CON_ERRORES: Final = "Con errores"
# Las etapas de una orden, en el orden en que se ejecutan, y la acción que las encadena todas.
ETAPAS: Final = ("descargar", "preparar", "validar")
TODO: Final = "todo"
ACCIONES: Final = (*ETAPAS, TODO)
# Identidad de navegador genérica y portable: no se deduce del equipo ni incorpora datos del proyecto o personales.
# red.py utiliza config/identidad-web.json; la constante solo sirve para consumidores sin red.
SEGUNDOS_DESCARGA = 120
# Tope de lo que se lee de fuera de una vez, sea una descarga o un archivo de un .zip. El original más grande que se
# descarga entero ocupa unos 30 MB (el censo del INE por provincias): el tope corta una respuesta o un .zip desmedidos.
MAX_DESCARGA_BYTES = 256 * 1024 * 1024
# Lo que un archivo descargable puede declarar además y pasa tal cual a su procedencia: la norma que lo publica.
CAMPOS_OPCIONALES_DE_PROCEDENCIA = ("norma",)


# ---------------------------------------------------------------------------------------------------------------------
# Errores
# ---------------------------------------------------------------------------------------------------------------------


class ErrorFuente(Exception):
    """Error de la cadena de datos, con un motivo legible para quien la ejecuta."""


class HuellaIncorrecta(ErrorFuente):
    """Un archivo no coincide con la huella SHA-256 registrada."""


class FormatoInesperado(ErrorFuente):
    """Un original no tiene la estructura que se espera de él."""


class OriginalCambiado(ErrorFuente):
    """La versión oficial ha cambiado respecto al original conservado."""


class ValidacionFallida(ErrorFuente):
    """Uno o más controles de una validación no se cumplen."""


class ArchivoFaltante(ErrorFuente):
    """Falta un archivo necesario para una etapa."""


# Lo que una orden de la cadena explica en una línea, sin traza: sus propios errores, los del disco y los de SQLite,
# y un original dañado que no se puede abrir como .zip (un libro .xlsx también lo es) o como JSON.
ERRORES_CON_MOTIVO = (ErrorFuente, OSError, sqlite3.Error, zipfile.BadZipFile, json.JSONDecodeError)


# ---------------------------------------------------------------------------------------------------------------------
# Tipos
# ---------------------------------------------------------------------------------------------------------------------


class Carpetas(NamedTuple):
    """Carpetas de una fuente en las tres etapas de var/actualizacion/."""

    original: Path
    preparado: Path
    validado: Path

    @property
    def validacion(self) -> Path:
        """El `validacion.json` de la fuente."""
        return self.validado / ARCHIVO_DE_VALIDACION


class Descarga(NamedTuple):
    """Respuesta de una descarga: contenido, dirección final tras redirecciones y tipo declarado.

    `content_type` conserva el nombre del encabezado HTTP porque así se publica en `procedencia.json`.
    """

    datos: bytes
    url_final: str
    content_type: str


class ReglaDeCambio(NamedTuple):
    """Qué hacer cuando una descarga no coincide con el original conocido.

    `equivalentes(previo, nuevo)` decide si una descarga con otros bytes dice lo mismo que el original conservado (por
    ejemplo, una página que solo cambia su ofuscación de correos). `huella_registrada` es la huella de la procedencia:
    permite detectar un cambio aunque el original ya no esté en disco. `aceptar_cambio` sustituye el original a
    propósito, cuando una persona ha revisado la versión nueva (`--aceptar-cambio`).
    """

    equivalentes: Callable[[bytes, bytes], bool] | None = None
    huella_registrada: str | None = None
    aceptar_cambio: bool = False


# Regla por defecto: ninguna descarga distinta del original se admite sin que una persona lo decida.
REGLA_ESTRICTA = ReglaDeCambio()


class Control(TypedDict):
    """Un control de `validacion.json`: lo que se comprueba y su resultado (CORRECTO o ERROR)."""

    control: str
    resultado: Resultado


class _CamposDelArchivo(TypedDict):
    """Lo que declara siempre un original que se descarga con código."""

    archivo: str
    nivel: str
    titulo: str
    url: str
    licencia: str


class ArchivoDescargable(_CamposDelArchivo, total=False):
    """Un original oficial y su norma, como cita textual o metadatos que conserva la procedencia."""

    norma: str | dict[str, str]


class EntradaDeDescarga(ArchivoDescargable):
    """La entrada de `procedencia.json` de un original descargado: lo declarado, la respuesta y su huella.

    Los nombres de los campos son los del registro publicado: `content_type` es el encabezado HTTP y `bytes`, el tamaño
    del original en bytes (como clave de un diccionario no oculta al tipo `bytes`).
    """

    url_final: str
    content_type: str
    bytes: int
    sha256: str
    descargado_utc: str


class Controles:
    """Controles de una validación, en el formato de `validacion.json`: `{control, resultado}`."""

    def __init__(self) -> None:
        self.lista: list[Control] = []

    def comprobar(self, cumple: bool, descripcion: str) -> bool:
        """Registra un control con su resultado.

        Args:
            cumple: Si la condición del control se cumple.
            descripcion: Lo que se comprueba, tal como se escribe en `validacion.json`.

        Returns:
            El mismo `cumple`, para encadenar el control con lo que depende de él.
        """
        self.lista.append({"control": descripcion, "resultado": CORRECTO if cumple else ERROR})
        return cumple

    @property
    def fallidos(self) -> list[str]:
        """Descripciones de los controles que no se cumplen."""
        return [control["control"] for control in self.lista if control["resultado"] != CORRECTO]

    @property
    def admitido(self) -> bool:
        """Si se ha ejecutado al menos un control y todos se cumplen."""
        return bool(self.lista) and not self.fallidos

    @property
    def estado(self) -> str:
        """El estado que se publica en `validacion.json`: ADMITIDO si todos se cumplen; si no, CON_ERRORES."""
        return ADMITIDO if self.admitido else CON_ERRORES

    def imprimir(self) -> None:
        """Muestra cada control con ✓ o ✗."""
        for control in self.lista:
            marca = "✓" if control["resultado"] == CORRECTO else "✗"
            print(f"{marca} {control['control']}")

    def exigir(self, fuente: str) -> None:
        """Comprueba que todos los controles se cumplen.

        Args:
            fuente: Nombre de la fuente, para el motivo del error.

        Raises:
            ValidacionFallida: Si algún control no se cumple; el motivo los enumera.
        """
        if not self.lista:
            raise ValidacionFallida(f"{fuente}: validación sin controles ejecutados")
        fallidos = self.fallidos
        if fallidos:
            raise ValidacionFallida(f"{fuente}: {len(fallidos)} controles fallidos: " + "; ".join(fallidos))


# ---------------------------------------------------------------------------------------------------------------------
# Condiciones
# ---------------------------------------------------------------------------------------------------------------------


def exigir(condicion: bool, motivo: str, error: type[ErrorFuente] = FormatoInesperado) -> None:
    """Exige una condición (sustituye a `assert`, que desaparece con -O).

    Args:
        condicion: Lo que debe cumplirse.
        motivo: Explicación legible del fallo.
        error: Clase de error que se lanza.

    Raises:
        ErrorFuente: La clase `error` con `motivo`, si la condición no se cumple.
    """
    if not condicion:
        raise error(motivo)


def leer_con_tope(flujo: BinaryIO, nombre: str, maximo: int = MAX_DESCARGA_BYTES) -> bytes:
    """Lee el contenido entero de `flujo` (una respuesta HTTP o un archivo de un .zip) con un tope.

    Lee un byte más del tope: si llega, el contenido no cabe y no se sigue leyendo.

    Args:
        flujo: Lo que se lee.
        nombre: Nombre del contenido, para el motivo del error.
        maximo: Tope en bytes.

    Returns:
        El contenido, de `maximo` bytes como mucho.

    Raises:
        FormatoInesperado: Si el contenido pasa de `maximo` bytes.
    """
    datos = flujo.read(maximo + 1)
    exigir(len(datos) <= maximo, f"{nombre} pasa de {maximo} bytes")
    return datos


def leer_del_zip(archivo: zipfile.ZipFile, nombre: str, maximo: int = MAX_DESCARGA_BYTES) -> bytes:
    """Lee un archivo de un .zip (o de un libro .xlsx), con un tope antes de descomprimir y al leer el contenido.

    Args:
        archivo: El .zip abierto.
        nombre: Ruta del miembro dentro del .zip.
        maximo: Tope en bytes, del tamaño declarado y de lo leído.

    Returns:
        El contenido descomprimido del miembro.

    Raises:
        FormatoInesperado: Si el .zip no contiene `nombre` o su tamaño pasa de `maximo` bytes.
    """
    exigir(nombre in archivo.namelist(), f"el .zip no contiene {nombre}")
    tamano = archivo.getinfo(nombre).file_size
    exigir(tamano <= maximo, f"{nombre}: declara {tamano} bytes, más que el tope de {maximo}")
    with archivo.open(nombre) as contenido:
        return leer_con_tope(contenido, nombre, maximo)
