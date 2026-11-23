"""Compone el uso declarado de IA con los motivos de no uso del Idescat, conservando ambas procedencias."""

import re

from plataforma_datos.comun import entrada_salida
from plataforma_datos.comun.entrada_salida import ruta_del_conjunto
from plataforma_datos.comun.nucleo import exigir
from plataforma_datos.ia_y_trabajo.fuentes.tic_llars.lector import FUENTE as TIC_LLARS
from plataforma_datos.ia_y_trabajo.fuentes.tic_llars.lector import motivos_no_uso
from plataforma_datos.ia_y_trabajo.fuentes.tich import edicion as estado
from plataforma_datos.orquestacion.admision import leer_validado
from plataforma_datos.orquestacion.exportacion.comun import Paquete
from plataforma_datos.orquestacion.exportacion.validados import paquete_validado


def paquete_tich() -> Paquete:
    """Añade los motivos por clase de ocupación a la TIC-H, sin reinterpretar sus bases ni cifras.

    Cada encuesta declara su año: el Idescat publica su explotación después que el INE, así que con la TIC-H de un año
    los motivos pueden ser del anterior, y el informe cita cada cifra con el suyo. Unos motivos de un año posterior al
    uso no son posibles (salen de los mismos microdatos) y detienen la exportación. El año de la TIC-H tiene que ser
    el de la edición admitida en su estado (edicion.py): si no, la exportación se detiene.

    Returns:
        El conjunto TIC-H con «motivos_no_uso» y sus dos archivos de origen, en orden de composición.

    Raises:
        ValidacionFallida: Si alguna de las dos fuentes no está admitida.
        FormatoInesperado: Si los motivos carecen de los datos necesarios para el contrato.
    """
    paquete = paquete_validado("tich")
    motivos = motivos_no_uso(leer_validado(TIC_LLARS))
    uso, de_los_motivos = paquete.datos.get("anio"), motivos["anio"]
    exigir(
        all(isinstance(anio, str) and re.fullmatch(r"[0-9]{4}", anio) for anio in (uso, de_los_motivos))
        and de_los_motivos <= uso,
        f"TIC-H e Idescat: el año del uso ({uso!r}) y de sus motivos ({de_los_motivos!r}) deben ser años de cuatro "
        "cifras, y los motivos no pueden ser de un año posterior",
    )
    admitida = estado.leer(entrada_salida.carpetas("tich").validado / estado.ESTADO.name)["anio"]
    exigir(
        uso == admitida,
        f"TIC-H: el conjunto validado es de {uso} y la edición admitida es la de {admitida}; repetir validar",
    )
    datos = {**paquete.datos, "motivos_no_uso": motivos}
    return Paquete(datos, [*paquete.origenes, ruta_del_conjunto(TIC_LLARS)])
