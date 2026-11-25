"""La huella de lo que una fuente recibió en una descarga, sin horas: para comparar dos ciclos.

Algunas fuentes no conservan sus originales en la generación (tich, barcelonactiva, fundae): sin esta huella no se
podría saber si dos ciclos recibieron los mismos bytes. Sale del recibo de la recepción de la descarga
(observacion_remota), que el intento técnico de cada etapa ya conserva: por cada petición, la identidad del recurso y
la huella del cuerpo recibido. Dos descargas con las mismas respuestas dan la misma huella aunque lleguen en otro orden
o a otra hora.

No se guarda en la generación, que conserva su forma: viaja en el evento `etapa-fuente` del diario del supervisor
(diario_mantenimiento.registrar_intentos), que cada ejecución archiva entero en el almacén privado
(archivo_diario: `diarios/<run>/<intento>/<operacion>.json`). Es telemetría: un recibo que no se entiende deja el
evento sin huella y nada se detiene; comparar_ciclos da entonces «sin-evidencia».
"""

import hashlib
import json
from typing import Any


def huella_de_la_recepcion(recibo: dict[str, Any]) -> str:
    """Resume lo recibido: las parejas recurso y cuerpo de cada petición, ordenadas, sin horas ni identificadores.

    Returns:
        El SHA-256 hexadecimal de esas parejas.
    """
    parejas = sorted([peticion["recurso_sha256"], peticion["respuesta_sha256"]] for peticion in recibo["peticiones"])
    return hashlib.sha256(json.dumps(parejas, separators=(",", ":")).encode()).hexdigest()


def huella_o_nada(recibo: object) -> str | None:
    """La huella de un recibo, o nada si no tiene la forma esperada: es telemetría y no detiene a quien la pide.

    Returns:
        La huella, o None si el recibo falta o no se entiende.
    """
    try:
        return huella_de_la_recepcion(recibo)
    except (KeyError, TypeError, ValueError):
        return None
