"""Lleva una comprobación completa a la forma mínima que espera la regla de retirada por evidencia."""

from plataforma_datos.comun.huella_json import sha256_json
from plataforma_datos.cursos.comprobacion_pagina.contrato import validar_comprobacion
from plataforma_datos.cursos.retirada_por_evidencia import ComprobacionPagina
from plataforma_datos.cursos.tipos_json import ObjetoJson


def comprobacion_para_la_regla(comprobacion: ObjetoJson) -> ComprobacionPagina:
    """Resume una comprobación guardada en lo que la regla necesita: el veredicto, la hora y la huella.

    La huella es la de la comprobación entera, no la del cuerpo: dos páginas pueden tener el mismo cuerpo y cada
    comprobación es una observación distinta, con su dirección, su hora y su sonda.

    Args:
        comprobacion: La comprobación tal como se guarda.

    Returns:
        La comprobación que entiende `retirada_por_evidencia`.
    """
    validar_comprobacion(comprobacion)
    return ComprobacionPagina(
        veredicto=comprobacion["veredicto"],
        pedido_utc=comprobacion["pedido_utc"],
        sha256=sha256_json(comprobacion),
    )
