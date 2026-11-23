"""SOC: un curso retirado se busca, por su identificador publicado, en la oferta oficial que la fuente descarga.

La oferta es un solo archivo (`lector.URL_OFERTA_SOC`), así que la muestra entera de un ciclo se decide con una sola
petición. La respuesta se valida como la descarga diaria (`lector.comprobar_descarga_soc`) y cada curso se lee como
su lectura: la primera fila de su número de curso y su fin publicado (`calendario_curso`), que aún cuenta el día de fin.

- `disponible`: el curso está en la oferta de hoy, en uno de sus dos estados conocidos y sin terminar.
- `cerrado`: el curso está, pero su fin publicado ya pasó.
- `no_existe`: el curso no está en la oferta de hoy.
- `dudoso`: un estado que no se conoce, fechas que no se leen o una oferta que no es la publicada.
"""

from collections.abc import Mapping

from plataforma_datos.comun.nucleo import Descarga, FormatoInesperado
from plataforma_datos.cursos.comprobacion_api.consultor import Consultor, Lectura, dudoso, por_el_fin, respuesta_ajena
from plataforma_datos.cursos.comprobacion_pagina.consulta_de_retirados import Ficha
from plataforma_datos.cursos.comprobacion_pagina.respuesta import Respuesta
from plataforma_datos.cursos.fuentes.formacion import lector, lectura
from plataforma_datos.cursos.fuentes.formacion.calendario_soc import calendario_curso
from plataforma_datos.cursos.fuentes.formacion.json_soc import leer_json_latin1

# Los dos estados que publica hoy la oferta, con su grafía exacta: los dos son cursos en oferta, con la inscripción
# abierta o aún en el período de información.
ESTADOS_EN_OFERTA = ("Curs en període d'inscripcio", "Curs en període d'informacio")


def direccion(_curso: str, _fichas: Mapping[str, Ficha]) -> str:
    """La oferta oficial entera: responde por todos los cursos a la vez.

    Returns:
        La dirección de la oferta del SOC.
    """
    return lector.URL_OFERTA_SOC


def decidir(curso: str, respuesta: Respuesta, pedido_utc: str) -> Lectura:
    """Lo que la oferta de hoy dice del curso.

    Returns:
        La lectura del curso.
    """
    ajena = respuesta_ajena(respuesta)
    if ajena is not None:
        return ajena
    descarga = Descarga(respuesta.cuerpo, respuesta.url_final or respuesta.url, respuesta.tipo or "")
    try:
        lector.comprobar_descarga_soc(descarga)
    except FormatoInesperado as error:
        return dudoso("respuesta_con_otra_forma", error)
    fila = lectura.cursos_de_la_oferta(leer_json_latin1(respuesta.cuerpo)).get(curso)
    if fila is None:
        return Lectura(veredicto="no_existe", motivo="ausente_de_la_oferta")
    if fila["estat_curs"] not in ESTADOS_EN_OFERTA:
        return dudoso("estado_desconocido", fila["estat_curs"])
    return por_el_fin(calendario_curso(fila)["fin"], f"data_fi={fila['data_fi']}", pedido_utc)


CONSULTOR = Consultor(direccion=direccion, decidir=decidir)
