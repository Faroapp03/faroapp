"""La hora límite del motor: el supervisor la fija y el motor no empieza lo que ya no cabe antes de ella.

El supervisor corta el motor cuando se agota su plazo (`ejecutor_operativo.PLAZO_CANDIDATO_S`). Un corte deja el ciclo
a medias y sin decir dónde, así que el supervisor le pasa al motor, por el entorno, la hora a la que lo cortará. Antes
de cada módulo y antes del paquete, el motor mira si lo que queda cubre lo que tardaría el paquete medido en el runner
más lento medido (`medidas_del_ciclo.PAQUETE_EN_EL_RUNNER_LENTO_S`), con un margen. Si
no lo cubre, no lo empieza: lo ya hecho se queda registrado, el paquete no se ejecuta (el recibo sale «rechazado») y
la parada se anota, con la causa `plazo-insuficiente` y el paso que no empezó, en un archivo de las ejecuciones que el
supervisor copia a su diario.

Sin hora límite en el entorno (un ensayo, una ejecución en el Mac) no hay nada que comprobar.
"""

import json
import os
import re
import time
from collections.abc import Callable, Mapping
from pathlib import Path

from plataforma_datos.comun.entrada_salida import escribir_bytes_entero
from plataforma_datos.orquestacion.medidas_del_ciclo import MARGEN_POR_CIENTO, PAQUETE_EN_EL_RUNNER_LENTO_S
from plataforma_datos.orquestacion.piezas_de_la_actualizacion import CARPETA_DE_INFORMES

# Segundos desde 1970 (UTC) a los que el supervisor cortará el motor.
VARIABLE = "FARO_HORA_LIMITE_DEL_MOTOR"
CAUSA = "plazo-insuficiente"
# El paquete es cálculo y tarda más en un runner lento: 42,9 minutos en el Mac, 91,4 llevado al más lento medido. Con
# el mismo margen que el plazo del motor: 5.486 × 1,2 = 6.584 segundos (110 minutos).
MARGEN = 1 + MARGEN_POR_CIENTO / 100
NECESARIO_S = round(PAQUETE_EN_EL_RUNNER_LENTO_S * MARGEN)
ARCHIVO = f"{CARPETA_DE_INFORMES}/parada-del-motor.json"
MOTIVO = "no se ejecuta: no queda tiempo para el paquete antes de la hora límite del motor"
MAX_BYTES = 1024
_SEGUNDOS = re.compile(r"[1-9][0-9]{0,11}")
# El paso que no empezó: el identificador de un módulo o el del paquete.
_PASO = re.compile(r"[a-z][a-z0-9_-]{0,47}")
_CAMPOS = frozenset({"causa", "paso", "quedanSegundos", "necesariosSegundos"})


def hora_limite(entorno: Mapping[str, str]) -> int | None:
    """Lee la hora límite que fijó el supervisor.

    Returns:
        Los segundos desde 1970 a los que se cortará el motor, o `None` si no hay hora límite.

    Raises:
        ValueError: Si la variable existe pero no tiene la forma que escribe el supervisor.
    """
    valor = entorno.get(VARIABLE)
    if valor is None:
        return None
    if _SEGUNDOS.fullmatch(valor) is None:
        raise ValueError("Hora límite del motor fuera de su forma")
    return int(valor)


def segundos_hasta_la_hora_limite(
    entorno: Mapping[str, str] = os.environ, reloj: Callable[[], float] = time.time
) -> float | None:
    """Lo que falta para que el supervisor corte el motor.

    Returns:
        Los segundos que quedan (negativos si la hora ya pasó), o `None` si no hay hora límite.
    """
    limite = hora_limite(entorno)
    return None if limite is None else limite - reloj()


def queda_tiempo(
    raiz: Path,
    paso: str,
    *,
    entorno: Mapping[str, str] = os.environ,
    reloj: Callable[[], float] = time.time,
) -> bool:
    """Dice si a este paso le queda tiempo de empezar sin dejar el paquete sin hacer.

    Si no le queda, anota la parada; si ya había una, se conserva la primera, que es el paso que de verdad no empezó.

    Returns:
        Verdadero si no hay hora límite o si lo que queda cubre lo necesario para el paquete.
    """
    limite = hora_limite(entorno)
    if limite is None:
        return True
    quedan = limite - reloj()
    if quedan >= NECESARIO_S:
        return True
    destino = raiz / ARCHIVO
    if not destino.exists() and not destino.is_symlink():
        parada = {
            "causa": CAUSA,
            "paso": paso,
            "quedanSegundos": max(0, int(quedan)),
            "necesariosSegundos": NECESARIO_S,
        }
        destino.parent.mkdir(parents=True, exist_ok=True)
        escribir_bytes_entero(destino, json.dumps(parada, sort_keys=True).encode())
    print(f"No queda tiempo para el paquete antes de la hora límite del motor: «{paso}» no empieza.", flush=True)
    return False


def leer_parada(raiz: Path) -> dict[str, object] | None:
    """Lee la parada del ciclo, si la hubo.

    Returns:
        La parada con su forma cerrada, o `None` si el ciclo no paró por la hora límite.

    Raises:
        ValueError: Si el archivo no es propio o no tiene su forma.
    """
    ruta = raiz / ARCHIVO
    if not ruta.exists() and not ruta.is_symlink():
        return None
    if ruta.is_symlink() or not ruta.is_file() or ruta.stat().st_size > MAX_BYTES:
        raise ValueError("La parada del motor no es un archivo propio")
    parada = json.loads(ruta.read_bytes())
    if (
        not isinstance(parada, dict)
        or parada.keys() != _CAMPOS
        or parada["causa"] != CAUSA
        or not isinstance(parada["paso"], str)
        or _PASO.fullmatch(parada["paso"]) is None
        or any(type(parada[c]) is not int or parada[c] < 0 for c in ("quedanSegundos", "necesariosSegundos"))
    ):
        raise ValueError("La parada del motor no tiene su forma")
    return parada
