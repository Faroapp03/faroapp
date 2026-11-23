"""Qué retira de verdad la regla de retirada de una fuente según su modo.

Con la fuente en `sombra`, la regla no retira nada. Con la fuente `activa`, retira lo que decidió retirar en las
lecturas de su último ciclo; lo quitan de lo publicado la entrega del catálogo (`retirada_en_el_catalogo`) y la
exportación del paquete (`retirada_en_el_paquete`). Cada fuente se resuelve con su propio estado: el de una no cambia
lo que publica otra.
"""

from pathlib import Path

from plataforma_datos.cursos.activacion_de_la_retirada import ACTIVA
from plataforma_datos.cursos.decisiones_retirada import cargar_registro
from plataforma_datos.cursos.estado_de_la_retirada import ultimo_registro


def regla_activa(raiz: Path, fuente: str) -> bool:
    """Si la regla de retirada de la fuente decide de verdad.

    Returns:
        Si su último registro de estado la deja activa; una fuente sin registro está en sombra.
    """
    registro = ultimo_registro(raiz, fuente)
    return registro is not None and registro["estado"] == ACTIVA


def retiradas_por_la_regla(raiz: Path, fuente: str) -> frozenset[str]:
    """Los cursos que la regla retira en las lecturas del último ciclo de la fuente, solo si está activa.

    Returns:
        Sus identificadores; ninguno si la fuente está en sombra.
    """
    registro = ultimo_registro(raiz, fuente)
    if registro is None or registro["estado"] != ACTIVA:
        return frozenset()
    return frozenset(
        decision["curso"]
        for lectura_id in registro["lecturas"]
        for decision in cargar_registro(raiz, fuente, lectura_id)["decisiones"]
        if decision["decision"] == "retirar"
    )
