"""La comprobación por API de los cursos que la regla de retirada retiraría en un ciclo, en las fuentes sin página.

Es la hermana de `comprobacion_pagina.consulta_de_retirados` y da lo mismo: la misma muestra determinista de cada
fuente y ciclo, el mismo tope compartido y la misma `Consulta`, con comprobaciones cuyos veredictos son los de la
página. Así el paso del ciclo no distingue de dónde sale cada una; la regla de cada comprobación lo dice.

Las consultas son sanas: una tras otra con la pausa por dominio y la identidad genérica del transporte común, y una
dirección que responde por varios cursos (la oferta entera del SOC, la ficha de una especialidad de FUNDAE) se pide una
sola vez. Antes de cada petición se mira el reloj: lo que ya no cabe queda sin comprobar con el motivo `sin-tiempo`.
"""

import hashlib
from collections.abc import Callable, Iterable, Mapping

from plataforma_datos.cursos.comprobacion_api.consultor import Consultor, Lectura, sin_respuesta
from plataforma_datos.cursos.comprobacion_api.consultores import CONSULTORES
from plataforma_datos.cursos.comprobacion_api.contrato import MAX_TIPO, ComprobacionApi
from plataforma_datos.cursos.comprobacion_api.regla import regla_de_la_api
from plataforma_datos.cursos.comprobacion_pagina.consulta_de_retirados import (
    PARAMETROS,
    SIN_TIEMPO,
    Consulta,
    Ficha,
    ParametrosDeLaConsulta,
    Pedir,
    muestra,
)
from plataforma_datos.cursos.comprobacion_pagina.contrato import BORRAR, MAX_TEXTO, PRIMER_IMPRIMIBLE
from plataforma_datos.cursos.comprobacion_pagina.respuesta import Respuesta
from plataforma_datos.cursos.tipos_json import ObjetoJson


def _imprimible(valor: str | None, maximo: int) -> str | None:
    """El texto sin caracteres de control y acotado, como lo admite el contrato.

    Returns:
        El texto limpio, o None si no había texto o queda vacío.
    """
    if valor is None:
        return None
    limpio = "".join(c if ord(c) >= PRIMER_IMPRIMIBLE and ord(c) != BORRAR else " " for c in valor).strip()
    return limpio[:maximo] or None


def comprobacion(fuente: str, curso: str, respuesta: Respuesta, pedido_utc: str, consultor: Consultor) -> ObjetoJson:
    """La comprobación de un curso con la respuesta de su API.

    Returns:
        La comprobación tal como se guarda.
    """
    lectura: Lectura = sin_respuesta(respuesta) or consultor.decidir(curso, respuesta, pedido_utc)
    return ComprobacionApi(
        curso=curso,
        fuente=fuente,
        url=respuesta.url,
        pedido_utc=pedido_utc,
        http=respuesta.http,
        tipo=None if respuesta.http is None else _imprimible(respuesta.tipo, MAX_TIPO),
        sha256_cuerpo=hashlib.sha256(respuesta.cuerpo).hexdigest(),
        dato=_imprimible(lectura.dato, MAX_TEXTO),
        veredicto=lectura.veredicto,
        motivo=lectura.motivo,
        regla=regla_de_la_api(),
    ).a_json()


def comprobar_por_api(  # noqa: PLR0913 - Cada dependencia llega como dato para probarla sin red ni reloj.
    fuente: str,
    retiradas: Iterable[str],
    fichas: Mapping[str, Ficha],
    *,
    semilla: str,
    pedir: Pedir,
    reloj: Callable[[], float],
    instante: Callable[[], str],
    hasta: float,
    parametros: ParametrosDeLaConsulta = PARAMETROS,
) -> Consulta:
    """Consulta la API de una muestra de las retiradas de una fuente sin pasar del instante `hasta`.

    `hasta` es el final del tope de la consulta de todo el ciclo, en el reloj monotónico `reloj`, y lo comparten
    todas las fuentes, las de página y las de API. Solo entran en la muestra los cursos de los que la API puede
    responder; los demás quedan sin comprobar.

    Returns:
        Las comprobaciones hechas, cuántas retiradas quedaron sin comprobar y el motivo si la consulta se cortó.
    """
    pendientes = sorted(set(retiradas))
    if not pendientes:
        return Consulta()
    consultor = CONSULTORES[fuente]
    direcciones = {curso: consultor.direccion(curso, fichas) for curso in pendientes}
    consultables = {curso: url for curso, url in direcciones.items() if url is not None}
    elegidos = muestra(consultables, semilla, parametros.muestra_por_fuente)
    pedidas: dict[str, tuple[Respuesta, str]] = {}
    hechas: list[ObjetoJson] = []
    for curso in elegidos:
        url = consultables[curso]
        if url not in pedidas:
            if reloj() >= hasta:
                break
            pedido_utc = instante()
            pedidas[url] = (pedir(url, hasta), pedido_utc)
        respuesta, pedido_utc = pedidas[url]
        hechas.append(comprobacion(fuente, curso, respuesta, pedido_utc, consultor))
    cortada = len(hechas) < len(elegidos)
    return Consulta(
        comprobaciones=tuple(hechas),
        sin_comprobar=len(pendientes) - len(hechas),
        motivo=SIN_TIEMPO if cortada else None,
    )
