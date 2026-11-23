"""Clasificación (idioma, nivel y materia) de las ofertas de Anthropic Academy, decidida en el productor.

Esta fuente no decide ningún dato en el productor: la web los decide con las evidencias sueltas de cada oferta. Cuando
decida uno, lo devuelve aquí y la prueba de paridad (`clasificacion/paridad.py`) lo compara, oferta a oferta, con lo
que muestra la web.
"""

from collections.abc import Sequence

from plataforma_datos.cursos.clasificacion.contrato import Clasificacion, Evidencia
from plataforma_datos.cursos.tipos_json import ObjetoJson


def clasificar(oferta: ObjetoJson, evidencias: Sequence[Evidencia]) -> Clasificacion | None:
    """Clasifica una oferta de Anthropic Academy con la interfaz común `Clasificador`.

    Returns:
        `None`: la oferta viaja sin bloque `clasificacion`.
    """
    return None
