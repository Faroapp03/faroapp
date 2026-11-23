"""FUNDAE: una edición retirada se busca en la ficha de difusiones de su especialidad, la API que usa su descarga.

La edición es una difusión (`fundae:edicion:<idDifusionAccionFormativa>`) y su ficha servida es la de su especialidad
(`tramite.ficha(codigo)`), de donde sale el código que se pregunta a `ediciones.url_difusiones`. Las filas se leen con
`hechos`, como la descarga, y el día de la consulta se compara con el plazo de preinscripción publicado.

- `disponible`: la difusión sale y hoy cae dentro de su plazo de preinscripción.
- `cerrado`: la difusión sale, pero su preinscripción ya terminó.
- `no_existe`: la especialidad responde, pero sin esa difusión.
- `dudoso`: la preinscripción aún no ha abierto, o la respuesta no tiene la forma publicada.

Los recursos de Digitalízate (`fundae:1:…`) no tienen ninguna API por curso: no se pregunta por ellos.
"""

import re
from collections.abc import Mapping

from plataforma_datos.comun.nucleo import FormatoInesperado
from plataforma_datos.cursos.comprobacion_api.consultor import (
    Consultor,
    Lectura,
    dia_de,
    dudoso,
    json_de,
    respuesta_ajena,
)
from plataforma_datos.cursos.comprobacion_pagina.consulta_de_retirados import Ficha
from plataforma_datos.cursos.comprobacion_pagina.respuesta import Respuesta
from plataforma_datos.cursos.fuentes.fundae import ediciones, hechos, lectura_preinscripcion, tramite

EDICION = re.compile(re.escape(lectura_preinscripcion.PREFIJO) + r"(?P<difusion>[1-9][0-9]{0,11})")
FICHA = re.compile(re.escape(tramite.ORIGEN + "ficha-curso/oferta/2/") + r"(?P<codigo>[A-Z0-9_-]{1,40})")


def _codigo(curso: str, fichas: Mapping[str, Ficha]) -> str | None:
    ficha = fichas.get(curso)
    coincidencia = None if ficha is None else FICHA.fullmatch(ficha.url)
    return None if coincidencia is None else coincidencia["codigo"]


def direccion(curso: str, fichas: Mapping[str, Ficha]) -> str | None:
    """La ficha de difusiones de la especialidad de la edición.

    Returns:
        Su dirección, o None si el curso no es una edición con la ficha servida de su especialidad.
    """
    codigo = _codigo(curso, fichas) if EDICION.fullmatch(curso) else None
    return None if codigo is None else ediciones.url_difusiones(codigo)


def decidir(curso: str, respuesta: Respuesta, pedido_utc: str) -> Lectura:
    """Lo que la ficha de difusiones de hoy dice de la edición.

    Returns:
        La lectura de la edición.
    """
    ajena = respuesta_ajena(respuesta)
    if ajena is not None:
        return ajena
    difusion = int(EDICION.fullmatch(curso)["difusion"])
    try:
        filas = [
            fila for fila in hechos.difusiones(json_de(respuesta)) if fila["idDifusionAccionFormativa"] == difusion
        ]
        plazos = [hechos.plazo(fila) for fila in filas]
    except FormatoInesperado as error:
        return dudoso("respuesta_con_otra_forma", error)
    if not plazos:
        return Lectura(veredicto="no_existe", motivo="ausente_de_la_oferta")
    plazo = plazos[0]
    texto = f"fechaPreinscripcionInicio={plazo['inicio']} fechaPreinscripcionFin={plazo['fin']}"
    hoy = dia_de(pedido_utc).isoformat()
    if hoy < plazo["inicio"]:
        return dudoso("plazo_sin_abrir", texto)
    if hoy > plazo["fin"]:
        return Lectura(veredicto="cerrado", motivo="plazo_terminado", dato=texto)
    return Lectura(veredicto="disponible", motivo="plazo_abierto", dato=texto)


CONSULTOR = Consultor(direccion=direccion, decidir=decidir)
