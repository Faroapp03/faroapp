"""Por qué un candidato terminó sin estado, en palabras de listas cerradas, para el diario del supervisor.

Un candidato rechazado sin estado dice solo su error (`ERRORES_DEL_RECIBO`): no se sabría qué excepción lo detuvo ni
dónde. El candidato corre en otro proceso y su recibo tiene campos fijos; por eso, cuando captura una excepción, deja
aquí su clase y la función donde saltó, y el supervisor lo copia al diario al terminar el motor, como los pasos del
ciclo. Nunca se guarda el mensaje de la excepción, que puede llevar rutas o datos: la clase sale de `CLASES` y la
función es siempre una función de los dos módulos del motor (`MODULOS_DEL_MOTOR`), comprobada en el propio marco.
"""

import json
import re
import traceback
from importlib.machinery import ModuleSpec
from pathlib import Path

from plataforma_datos.comun.entrada_salida import escribir_bytes_entero
from plataforma_datos.orquestacion.piezas_de_la_actualizacion import CARPETA_DE_INFORMES

ARCHIVO = f"{CARPETA_DE_INFORMES}/fallo-del-candidato.json"
FASE = "candidato"
ESTADO = "excepcion"
MAX_BYTES = 1024
# Los errores con que el candidato rechaza su recibo (candidato.py).
ERRORES_DEL_RECIBO = ("actualizacion_no_completada", "actualizacion_no_admitida", "candidato_no_verificable")
# De la más concreta a la más general: una excepción se nombra por la primera de su jerarquía que está aquí.
CLASES = (
    "EstadoPanelInvalido",
    "HuellaIncorrecta",
    "FormatoInesperado",
    "OriginalCambiado",
    "ValidacionFallida",
    "ArchivoFaltante",
    "ErrorFuente",
    "FileNotFoundError",
    "PermissionError",
    "OSError",
    "JSONDecodeError",
    "UnicodeDecodeError",
    "ValueError",
    "KeyError",
    "TypeError",
    "OverflowError",
    "RecursionError",
)
OTRA = "otra"
MODULOS_DEL_MOTOR = {
    "plataforma_datos.orquestacion.candidato": "candidato",
    "plataforma_datos.orquestacion.actualizar": "actualizar",
}
FUNCION = re.compile(rf"(?:{'|'.join(MODULOS_DEL_MOTOR.values())})\.[a-z][a-z0-9_]{{0,63}}")
# Solo lanza la excepción de una comprobación: la función que comprobaba es la que la llama.
AYUDANTES = frozenset({"_exigir"})


def clase(error: BaseException) -> str:
    """Nombra una excepción por la clase más concreta de su jerarquía que está en `CLASES`.

    Returns:
        El nombre de esa clase, u `OTRA` si ninguna está en la lista.
    """
    return next((tipo.__name__ for tipo in type(error).__mro__ if tipo.__name__ in CLASES), OTRA)


def funcion(error: BaseException) -> str:
    """La función del motor más interna de la traza en la que saltó la excepción.

    Un marco cuenta si su código es el de una función definida en uno de `MODULOS_DEL_MOTOR`. En la CLI con `-m`,
    `__main__` conserva el nombre del módulo en su especificación. Las funciones anidadas, el código de otros
    módulos y los ayudantes que solo lanzan no cuentan.

    Returns:
        `modulo.funcion`, sin el guion bajo inicial, u `OTRA` si ningún marco es del motor.
    """
    nombre = OTRA
    for marco, _linea in traceback.walk_tb(error.__traceback__):
        identidad = marco.f_globals.get("__name__")
        especificacion = marco.f_globals.get("__spec__")
        if identidad == "__main__" and isinstance(especificacion, ModuleSpec):
            identidad = especificacion.name
        modulo = MODULOS_DEL_MOTOR.get(identidad)
        propia = marco.f_globals.get(marco.f_code.co_name)
        if modulo and getattr(propia, "__code__", None) is marco.f_code and marco.f_code.co_name not in AYUDANTES:
            nombre = f"{modulo}.{marco.f_code.co_name.lstrip('_')}"
    return nombre if FUNCION.fullmatch(nombre) else OTRA


def guardar(raiz: Path, error: BaseException) -> None:
    """Deja en el candidato la clase y la función de la excepción que lo detuvo; nunca su mensaje.

    Es telemetría: si la raíz no es una carpeta propia o el disco no lo deja, lo dice y el recibo sale igual.
    """
    if raiz.is_symlink() or not raiz.is_dir():
        print("No se pudo anotar el fallo del candidato (su raíz no es una carpeta propia).", flush=True)
        return
    ruta = raiz / ARCHIVO
    datos = {"clase": clase(error), "funcion": funcion(error)}
    try:
        ruta.parent.mkdir(parents=True, exist_ok=True)
        escribir_bytes_entero(ruta, json.dumps(datos, sort_keys=True, separators=(",", ":")).encode())
    except OSError as fallo:
        print(f"No se pudo anotar el fallo del candidato ({type(fallo).__name__}).", flush=True)


def leer(candidato: Path) -> dict[str, str] | None:
    """Lee lo que dejó el candidato, comprobando que sigue en su forma cerrada.

    Returns:
        La clase y la función, o None si el candidato no capturó ninguna excepción.

    Raises:
        ValueError: Si el archivo no es el que escribe `guardar`.
    """
    ruta = candidato / ARCHIVO
    if not ruta.exists() and not ruta.is_symlink():
        return None
    if ruta.is_symlink() or not ruta.is_file() or ruta.stat().st_size > MAX_BYTES:
        raise ValueError("Fallo del candidato ilegible")
    datos = json.loads(ruta.read_bytes())
    if not (
        isinstance(datos, dict)
        and set(datos) == {"clase", "funcion"}
        and datos["clase"] in (*CLASES, OTRA)
        and isinstance(datos["funcion"], str)
        and (datos["funcion"] == OTRA or FUNCION.fullmatch(datos["funcion"]))
    ):
        raise ValueError("Fallo del candidato fuera de su forma")
    return datos


def error_del_recibo(valor: object) -> str | None:
    """El error de un recibo, de su lista cerrada.

    Returns:
        El error, None si el recibo no lo tiene, u `OTRA` si no es uno de `ERRORES_DEL_RECIBO`.
    """
    if valor is None:
        return None
    return valor if valor in ERRORES_DEL_RECIBO else OTRA
