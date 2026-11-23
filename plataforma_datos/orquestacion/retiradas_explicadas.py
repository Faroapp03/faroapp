"""Lo que la regla de retirada activa explica de lo que pierde cada archivo del paquete, para su cuarentena.

La cuarentena retiene un archivo que pierde más de PERDIDA_MAXIMA de sus unidades, porque nadie ha explicado esa
pérdida. Lo que la regla de retirada activa de su fuente quita del archivo sí está explicado: cada retirada tiene su
evidencia registrada y comprobada (`decisiones_retirada` no admite una retirada sin evidencias suficientes). Por eso la
comparación mide lo nuevo frente a lo publicado sin esas unidades, y lo que falte además sigue siendo una pérdida sin
explicar que va a cuarentena aunque coincida con un ciclo en que la regla retira.

Se lee del área, que es la instalación con la que se exportó el paquete nuevo: lo explicado es exactamente lo que la
exportación quitó (`retirada_en_el_paquete`). Cada archivo se explica solo con la regla de su fuente; con la fuente en
sombra no hay nada explicado y la comparación es la de siempre.
"""

import json
from pathlib import Path

from plataforma_datos.cursos.aplicacion_de_la_retirada import retiradas_por_la_regla
from plataforma_datos.cursos.retirada_en_el_paquete import EN_EL_PAQUETE
from plataforma_datos.orquestacion.piezas_de_la_actualizacion import PAQUETE_RELATIVO, Explicada, entradas


def _leer(ruta: Path) -> dict | None:
    """Un archivo del paquete que publica cursos; ninguno si ese lado no lo tiene.

    Returns:
        Su contenido.
    """
    return json.loads(ruta.read_bytes()) if ruta.is_file() else None


def explicada_en(antes: dict, despues: dict, lista: str, retiradas: frozenset[str]) -> Explicada | None:
    """Lo que explican las retiradas de la regla entre la versión publicada de un archivo y la nueva.

    Solo cuenta una unidad que estaba publicada, que la regla retira y que ya no está: una retirada de un ciclo
    anterior ya no estaba, y una que sigue no se ha perdido.

    Returns:
        Las unidades explicadas y las entradas de lo publicado sin ellas; ninguna si no hay nada explicado.
    """
    siguen = {str(unidad["id"]) for unidad in despues[lista]}
    quitadas = {str(u["id"]) for u in antes[lista] if str(u["id"]) in retiradas and str(u["id"]) not in siguen}
    if not quitadas:
        return None
    sin_ellas = {**antes, lista: [unidad for unidad in antes[lista] if str(unidad["id"]) not in quitadas]}
    return Explicada(unidades=len(quitadas), entradas=entradas(sin_ellas))


def retiradas_explicadas(raiz: Path, area: Path) -> dict[str, Explicada]:
    """Por archivo del paquete, lo que la regla activa de su fuente explica de su pérdida.

    Args:
        raiz: La raíz del repositorio, con el paquete publicado.
        area: El área de ensayo, con el paquete recién exportado y el estado de la regla con que se exportó.

    Returns:
        Los archivos con algo explicado; ninguno si todas sus fuentes están en sombra.
    """
    explicadas = {}
    for nombre, (fuente, lista) in EN_EL_PAQUETE.items():
        retiradas = retiradas_por_la_regla(area, fuente)
        if not retiradas:
            continue
        antes, despues = (_leer(base / PAQUETE_RELATIVO / nombre) for base in (raiz, area))
        if antes is None or despues is None:
            continue
        explicada = explicada_en(antes, despues, lista, retiradas)
        if explicada is not None:
            explicadas[nombre] = explicada
    return explicadas
