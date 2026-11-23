"""Reproduce un censo admitido con el contrato de lectura que produjo sus hechos."""

from pathlib import Path

from plataforma_datos.cursos.fuentes.barcelonactiva import robot_cibernarium as robot
from plataforma_datos.cursos.tipos_json import ObjetoJson

CAMPO = "version_lectura_fichas"
VERSION = 2


def destinos_ficha(id: str, *, historica: bool) -> set[str]:
    """Devuelve los destinos exactos reconocidos para la misma actividad.

    Returns:
        URL de la ficha y redirecciones acreditadas por la versión del lector.
    """
    destinos = {robot.url_ficha(id), robot.ORIGEN + "/ca/formacio?activityId=" + id}
    if not historica:
        destinos.add(robot.ORIGEN + "/formacio?activityId=" + id)
    return destinos


def reproduce(original: Path, documento: ObjetoJson, programas: list[ObjetoJson], admitido: ObjetoJson) -> bool:
    """Contrasta todos los hechos con las capturas conservadas. Dos lectores previos emitieron censos sin versión.

    Returns:
        Verdadero si un único contrato aplicado a todo el censo reproduce la selección admitida.
    """
    from plataforma_datos.cursos.fuentes.barcelonactiva import adquisicion

    versionado = CAMPO in admitido
    if versionado and (type(admitido[CAMPO]) is not int or admitido[CAMPO] != VERSION):
        return False
    for historica in (False,) if versionado else (False, True):
        candidato = adquisicion.calcular(original, documento, programas, historica=historica)
        # El llamador coteja el fichero de procedencia por su hash antes de deserializarlo.
        candidato["procedencia_sha256"] = admitido["procedencia_sha256"]
        if not versionado:
            del candidato[CAMPO]
        if candidato == admitido:
            return True
    return False
