"""Textos de tareas admitidos, conservando su autoría, prioridad y aviso de traducción."""

from plataforma_datos.ocupaciones.fuentes.textos.lector import PREPARADO as PREPARADO_TEXTOS
from plataforma_datos.ocupaciones.fuentes.textos.lector import archivos_validados as textos_validados
from plataforma_datos.ocupaciones.fuentes.textos.lector import combinar as combinar_textos
from plataforma_datos.ocupaciones.fuentes.textos.lector import validar_textos
from plataforma_datos.orquestacion.admision import leer_validado
from plataforma_datos.orquestacion.exportacion.comun import Paquete


def paquete_textos() -> Paquete:
    """Compone los bytes comprobados y vuelve a contrastar sus tareas con el catálogo OIT.

    Returns:
        Los textos combinados y sus archivos de origen, en el orden de precedencia.
    """
    archivos = textos_validados()
    textos = combinar_textos(archivos=archivos)
    validar_textos(textos["tareas"], leer_validado("oit")["tareas"])
    return Paquete(textos, [PREPARADO_TEXTOS / nombre for nombre in archivos])
