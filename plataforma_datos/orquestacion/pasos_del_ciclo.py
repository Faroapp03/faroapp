"""El registro de cada paso del ciclo que no es una etapa de fuente, con su hora real, para el diario del supervisor.

Las etapas de fuente ya dejan su intento (`ejecucion_observada`); el resto de pasos (revalidar el catálogo, exportar,
componer, ensamblar, construir la web, comprobar los datos) no dejaba nada, y un ciclo cortado en el paquete no decía
en qué paso iba. El ciclo corre en el candidato y el supervisor escribe el diario después; si el supervisor lo detiene
por su plazo, lo que el ciclo tenía en memoria se pierde. Por eso cada paso deja su registro al empezar, sin fin, y lo
completa al terminar: un registro sin fin al copiarlo es el paso que seguía cuando el ciclo se cortó.

Cada registro es de forma cerrada: su número de orden, una clave sacada de la orden (el módulo que ejecuta Python o
el guion que ejecuta npm, nunca rutas), las horas UTC y el código de salida; nada de la salida de la orden.
"""

import json
import re
from collections.abc import Callable, Sequence
from datetime import UTC, datetime
from pathlib import Path

from plataforma_datos.comun.entrada_salida import escribir_bytes_entero
from plataforma_datos.orquestacion.formas_del_diario import NOMBRE
from plataforma_datos.orquestacion.piezas_de_la_actualizacion import CARPETA_DE_INFORMES

CARPETA = f"{CARPETA_DE_INFORMES}/pasos-del-ciclo"
FASE = "paso-ciclo"
MAX_PASOS = 999
MAX_BYTES = 1024
CAMPOS = frozenset({"numero", "paso", "inicio", "fin", "codigo"})
# La orden que no dice qué módulo ni qué guion ejecuta se registra igual, con esta clave.
OTRA = "otra-orden"
_UTC = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}\+00:00")
_NO_ALFANUMERICO = re.compile(r"[^a-z0-9]+")


def clave(orden: Sequence[str]) -> str:
    """Nombra un paso por lo que ejecuta: el último tramo del módulo tras `-m` o el guion tras `run`.

    Returns:
        Una clave con la forma de los nombres del diario, u `OTRA` si la orden no dice ninguna de las dos cosas.
    """
    for marca, tramo in (("-m", lambda valor: valor.rsplit(".", 1)[-1]), ("run", lambda valor: valor)):
        if marca in orden[:-1]:
            texto = _NO_ALFANUMERICO.sub("-", tramo(orden[orden.index(marca) + 1]).lower()).strip("-")[:48].rstrip("-")
            if NOMBRE.fullmatch(texto):
                return texto
    return OTRA


def _guardar(raiz: Path, registro: dict[str, object]) -> None:
    """Guarda un registro; si el disco no lo deja, lo dice y el paso sigue: es telemetría y no cambia el ciclo."""
    ruta = raiz / CARPETA / f"{registro['numero']:03d}.json"
    try:
        ruta.parent.mkdir(parents=True, exist_ok=True)
        escribir_bytes_entero(ruta, json.dumps(registro, sort_keys=True, separators=(",", ":")).encode())
    except OSError as error:
        print(f"No se pudo registrar el paso {registro['numero']} del ciclo ({type(error).__name__}).", flush=True)


def observar[R](
    raiz: Path, ejecutor: Callable[[Sequence[str], Path], R], codigo: Callable[[R], int]
) -> Callable[[Sequence[str], Path], R]:
    """Envuelve un ejecutor para que cada paso deje su registro al empezar y al terminar.

    Args:
        raiz: La raíz del candidato, donde quedan las ejecuciones del ciclo.
        ejecutor: Lo que ejecuta cada orden.
        codigo: Cómo leer el código de salida de lo que devuelve el ejecutor.

    Returns:
        Un ejecutor que hace lo mismo y devuelve lo mismo; pasados `MAX_PASOS`, ya no registra.
    """
    numeros = iter(range(1, MAX_PASOS + 1))

    def ejecutar(orden: Sequence[str], area: Path) -> R:
        numero = next(numeros, None)
        if numero is None:
            return ejecutor(orden, area)
        registro: dict[str, object] = {"numero": numero, "paso": clave(orden), "fin": None, "codigo": None}
        registro["inicio"] = datetime.now(UTC).isoformat(timespec="microseconds")
        _guardar(raiz, registro)
        resultado = ejecutor(orden, area)
        registro.update(fin=datetime.now(UTC).isoformat(timespec="microseconds"), codigo=codigo(resultado))
        _guardar(raiz, registro)
        return resultado

    return ejecutar


def _es_registro(dato: object) -> bool:
    if not isinstance(dato, dict) or dato.keys() != CAMPOS:
        return False
    terminado = dato["fin"] is not None
    return (
        type(dato["numero"]) is int
        and 1 <= dato["numero"] <= MAX_PASOS
        and isinstance(dato["paso"], str)
        and NOMBRE.fullmatch(dato["paso"]) is not None
        and isinstance(dato["inicio"], str)
        and _UTC.fullmatch(dato["inicio"]) is not None
        and (not terminado or (isinstance(dato["fin"], str) and _UTC.fullmatch(dato["fin"]) is not None))
        and (type(dato["codigo"]) is int if terminado else dato["codigo"] is None)
    )


def leer(raiz: Path) -> list[dict[str, object]]:
    """Lee los registros de los pasos del ciclo; si no dejó ninguno, la lista está vacía.

    Returns:
        Los registros, en el orden de los pasos.

    Raises:
        ValueError: Si un archivo no es propio, es demasiado grande o no tiene su forma.
    """
    carpeta = raiz / CARPETA
    if carpeta.is_symlink() or (carpeta.exists() and not carpeta.is_dir()):
        raise ValueError("los registros de los pasos del ciclo no son una carpeta propia")
    rutas = sorted(carpeta.glob("*.json")) if carpeta.is_dir() else []
    if len(rutas) > MAX_PASOS:
        raise ValueError("demasiados registros de pasos del ciclo")
    registros = []
    for ruta in rutas:
        if ruta.is_symlink() or not ruta.is_file() or ruta.stat().st_size > MAX_BYTES:
            raise ValueError("un registro de paso del ciclo no es un archivo propio")
        dato = json.loads(ruta.read_bytes())
        if not _es_registro(dato) or ruta.name != f"{dato['numero']:03d}.json":
            raise ValueError("un registro de paso del ciclo no tiene su forma")
        registros.append(dato)
    return registros
