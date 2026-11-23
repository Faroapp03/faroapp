"""Combina la acreditación admitida y la escala del servicio, conservando sus dos orígenes."""

import re
from datetime import date

from plataforma_datos.comun.entrada_salida import ruta_del_conjunto
from plataforma_datos.comun.nucleo import ValidacionFallida, exigir
from plataforma_datos.cursos.fuentes.acreditacion.piezas.revision import faltas_de_procedencia
from plataforma_datos.orquestacion.admision import leer_validado
from plataforma_datos.orquestacion.exportacion.comun import Paquete
from plataforma_datos.orquestacion.exportacion.validados import paquete_validado


def paquete_acreditacion() -> Paquete:
    """Añade la memoria FPCAT a las relaciones cuya revisión está documentada.

    Returns:
        El conjunto de acreditación con «memoria_fpcat», y sus dos archivos de origen.

    Raises:
        ValidacionFallida: Si una fuente no está admitida, falta la procedencia de una relación o la fecha de
            comprobación no se puede leer.
    """
    paquete = paquete_validado("acreditacion")
    # El informe da los requisitos siempre con esta fecha: una fecha ilegible es un error de los datos y se para aquí.
    exigir(
        _fecha_legible(paquete.datos.get("comprobado")),
        "acreditacion: fecha de comprobación no válida",
        ValidacionFallida,
    )
    faltas = faltas_de_procedencia(paquete.datos)
    exigir(not faltas, f"acreditacion: procedencia de la revisión incompleta ({'; '.join(faltas)})", ValidacionFallida)
    datos = {**paquete.datos, "memoria_fpcat": leer_validado("memoria-fpcat")}
    return Paquete(datos, [*paquete.origenes, ruta_del_conjunto("memoria-fpcat")])


def _fecha_legible(valor: object) -> bool:
    if not isinstance(valor, str) or re.fullmatch(r"\d{4}-\d{2}-\d{2}", valor) is None:
        return False
    try:
        date.fromisoformat(valor)
    except ValueError:
        return False
    return True
