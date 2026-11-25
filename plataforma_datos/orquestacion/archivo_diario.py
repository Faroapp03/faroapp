"""Archivo del diario del supervisor en el almacén privado, por ejecución, intento y operación."""

import hashlib
import json
import tempfile
from contextlib import suppress
from pathlib import Path
from typing import NamedTuple

from plataforma_datos.orquestacion import diario_mantenimiento as diario
from plataforma_datos.orquestacion import resumen_diario
from plataforma_datos.orquestacion.almacen_trabajos import RUN, AlmacenTrabajos
from plataforma_datos.orquestacion.controles_confirmados import escribir_confirmado
from plataforma_datos.orquestacion.formas_del_diario import MAX_RESUMEN, OPERACIONES

MAX_DIARIO = 8 * 1024 * 1024


def _clave(run: str, intento: str, operacion: str) -> str:
    if not (RUN.fullmatch(run) and RUN.fullmatch(intento) and operacion in OPERACIONES):
        raise ValueError("Identidad de diario inválida")
    return f"diarios/{run}/{intento}/{operacion}.json"


def clave_resumen(run: str, intento: str, operacion: str) -> str:
    """Clave del resumen: la ejecución con 16 cifras hace que el orden de las claves sea el de las ejecuciones.

    Returns:
        Clave privada del resumen de esa ejecución, intento y operación.
    """
    _clave(run, intento, operacion)
    return f"diarios-resumen/{int(run):016d}/{intento}/{operacion}.json"


class Ejecucion(NamedTuple):
    """La identidad de lo que se archiva: la ejecución, su intento y la operación."""

    run: str
    intento: str
    operacion: str


def archivar(archivo: Path, almacen: AlmacenTrabajos, ejecucion: Ejecucion, raiz: Path | None = None) -> None:
    """Guarda el resumen y el diario completo de una ejecución; el fallo de uno no impide el otro.

    El resumen va primero para que, si falla, su anotación quede dentro del diario completo archivado. `raiz` es la
    instalación que guarda las lecturas del ciclo: el resumen lleva su parte de salud. Un parte que no se puede
    calcular no impide archivar el resumen: este dice «no-calculado» con su motivo y el diario lo anota.
    """
    run, intento, operacion = ejecucion
    clave = _clave(run, intento, operacion)
    sin_parte = None
    try:
        lineas = archivo.read_text(encoding="utf-8").splitlines()
        contenido = resumen_diario.componer(lineas, operacion, run, intento, raiz)
        sin_parte = json.loads(contenido)["salud"]["motivo"]
        guardar_resumen(clave_resumen(run, intento, operacion), contenido, almacen)
    except (resumen_diario.ResumenNoValido, UnicodeDecodeError):
        diario.anotar("archivo-resumen", "pendiente", causa="diario-no-resumible")
    except (OSError, ValueError):
        diario.anotar("archivo-resumen", "pendiente", causa="almacen-no-confirmado")
    if sin_parte is not None:
        diario.anotar("parte-de-salud", "no-calculado", causa=sin_parte)
    guardar_contenido(clave, archivo, almacen)


def guardar_resumen(clave: str, contenido: bytes, almacen: AlmacenTrabajos) -> None:
    """Crea el resumen sin sobrescribir y solo lo da por guardado al releer exactamente sus bytes.

    Raises:
        ValueError: Si el almacén no conserva exactamente ese resumen.
    """
    # Una respuesta perdida no implica fallo de la escritura; solo la lectura exacta posterior la confirma.
    with suppress(OSError):
        almacen.guardar_control(clave, contenido, None)
    lectura = almacen.leer_control(clave, MAX_RESUMEN)
    if lectura is None or lectura[0] != contenido:
        raise ValueError("Resumen de diario no confirmado")


def guardar_contenido(clave: str, archivo: Path, almacen: AlmacenTrabajos) -> None:
    """Guarda el contenido y confirma su índice inmutable antes de declarar disponible el archivo.

    Raises:
        ValueError: Si el tamaño del diario excede el límite documentado.
    """
    tamano = archivo.stat().st_size
    if not 0 < tamano <= MAX_DIARIO:
        raise ValueError("Tamaño de diario inválido")
    huella = hashlib.sha256(archivo.read_bytes()).hexdigest()
    almacen.guardar("blobs/" + huella, archivo, huella, tamano)
    indice = json.dumps({"version": 1, "sha256": huella, "bytes": tamano}, sort_keys=True).encode()
    escribir_confirmado(clave, indice, None, almacen)


def leer(almacen: AlmacenTrabajos, run: str, intento: str, operacion: str) -> str:
    """Recupera un diario por su identidad y coteja sus bytes antes de mostrarlos.

    Returns:
        Secuencia JSONL en el orden en que el supervisor confirmó los hechos.

    """
    return leer_contenido(_clave(run, intento, operacion), almacen)


def leer_contenido(clave: str, almacen: AlmacenTrabajos) -> str:
    """Recupera un objeto referenciado por un índice privado inmutable.

    Returns:
        Texto recuperado tras comprobar la huella y longitud exactas.

    Raises:
        FileNotFoundError: Si no se guardó el índice.
        ValueError: Si el contenido no cumple el contrato.
    """
    from plataforma_datos.orquestacion.generacion_operativa import SHA256

    control = almacen.leer_control(clave, 1024)
    if control is None:
        raise FileNotFoundError("Diario ausente")
    indice = json.loads(control[0])
    if not (
        isinstance(indice, dict)
        and set(indice) == {"version", "bytes", "sha256"}
        and type(indice["version"]) is int
        and indice["version"] == 1
        and type(indice["bytes"]) is int
        and 0 < indice["bytes"] <= MAX_DIARIO
        and isinstance(indice["sha256"], str)
        and SHA256.fullmatch(indice["sha256"])
    ):
        raise ValueError("Índice de diario inválido")
    with tempfile.TemporaryDirectory() as nombre:
        ruta = Path(nombre) / "diario.jsonl"
        almacen.recuperar("blobs/" + indice["sha256"], ruta, indice["sha256"], indice["bytes"])
        if ruta.stat().st_size != indice["bytes"]:
            raise ValueError("Diario incompleto")
        return ruta.read_text(encoding="utf-8")
