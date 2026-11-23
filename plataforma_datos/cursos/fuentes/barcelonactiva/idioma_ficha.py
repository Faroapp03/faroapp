"""Única regla para leer el idioma del bloque factual de una ficha de Cibernàrium.

La ficha escribe sus campos seguidos («Idioma: Català Data: Dimarts…»): el idioma
termina donde empieza el rótulo del campo siguiente. La usan el robot al leer la
ficha y la entrega al publicar hechos conservados que se guardaron con una regla
anterior, para que ambos den el mismo literal.
"""

import re

ROTULOS_TRAS_IDIOMA = ("Data:", "Dates:", "Modalitat:", "Durada:")
_FIN_DEL_IDIOMA = re.compile("|".join(map(re.escape, ROTULOS_TRAS_IDIOMA)), re.IGNORECASE)


def literal_de_idioma(texto: str) -> str:
    """Corta el texto que sigue a «Idioma:» en el primer rótulo de otro campo.

    Returns:
        El literal de idioma sin espacios en los extremos; vacío si no queda ninguno.
    """
    return _FIN_DEL_IDIOMA.split(texto, maxsplit=1)[0].strip()


def idioma_de_ficha(texto: str) -> str | None:
    """Lee el idioma del texto factual de la ficha, con los espacios ya normalizados.

    Returns:
        El literal que sigue al primer «Idioma:», o None si la ficha no lo declara.
    """
    rotulo = re.search(r"Idioma:(.*)", texto, re.IGNORECASE)
    return literal_de_idioma(rotulo.group(1)) if rotulo else None
