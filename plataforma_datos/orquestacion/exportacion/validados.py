"""Lectura sin transformación del conjunto admitido que publica cada fuente."""

from plataforma_datos.comun.entrada_salida import ruta_del_conjunto
from plataforma_datos.orquestacion.admision import leer_validado
from plataforma_datos.orquestacion.exportacion.comun import Paquete


def paquete_validado(fuente: str) -> Paquete:
    """Toma el conjunto validado de una fuente admitida, tal cual.

    Args:
        fuente: El nombre de la fuente.

    Returns:
        Su conjunto y, como origen, su archivo.
    """
    return Paquete(leer_validado(fuente), [ruta_del_conjunto(fuente)])
