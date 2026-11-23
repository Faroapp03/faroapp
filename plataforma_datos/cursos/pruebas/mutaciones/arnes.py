"""Piezas comunes del banco: la mutación declarada, lo observado en la cadena y el veredicto del ciclo.

Cada prueba recorre de verdad la cadena de su fuente (recepción, preparación, validación, aplicación al almacén,
vigencia, proyección y publicación del catálogo de Cursos) y anota aquí lo que vio. El último tramo, el de los
subprocesos de la orquestación, no se lanza: se traduce lo observado al resultado que `ejecutar_modulo` y
`ejecutar_paquete` dan a una orden que termina con código distinto de cero (ámbar) y se pasa por el `decidir` real.
"""

from typing import NamedTuple

from plataforma_datos.orquestacion.actualizar import decidir
from plataforma_datos.orquestacion.estado_de_la_actualizacion import AMBAR, VERDE, ResultadoDelModulo
from plataforma_datos.orquestacion.modulos import PAQUETE

# Hasta dónde llega el daño de una mutación, de menor a mayor.
NINGUNO, CURSO, FUENTE, CICLO = "ninguno", "curso", "fuente", "ciclo"


class Mutacion(NamedTuple):
    """Un cambio de la fuente, declarado antes de aplicarlo."""

    nombre: str
    fuente: str
    que_cambia: str


class Observado(NamedTuple):
    """Lo que la cadena real hizo con la mutación.

    `fuente_en_verde` dice si las etapas de la fuente terminaron sin error; `catalogo_compuesto`, si la composición
    del catálogo de Cursos terminó y publicó, o None si la prueba no llega a ese tramo. `decisiones_antes` y
    `decisiones_despues` son la decisión de cada unidad (la de vigencia del panel privado o, si la prueba no llega
    al almacén, su presencia en el conjunto admitido); `mutadas` son las unidades a las que afecta la mutación.
    """

    fuente_en_verde: bool
    catalogo_compuesto: bool | None
    decisiones_antes: dict[str, str]
    decisiones_despues: dict[str, str]
    mutadas: frozenset[str]


def cambiadas(observado: Observado) -> dict[str, tuple[str | None, str | None]]:
    """Las unidades cuya decisión cambió, con la de antes y la de después.

    Returns:
        Decisión anterior y posterior por unidad, solo de las que cambian.
    """
    unidades = set(observado.decisiones_antes) | set(observado.decisiones_despues)
    return {
        u: (observado.decisiones_antes.get(u), observado.decisiones_despues.get(u))
        for u in sorted(unidades)
        if observado.decisiones_antes.get(u) != observado.decisiones_despues.get(u)
    }


def veredicto_del_ciclo(mutacion: Mutacion, observado: Observado) -> str:
    """El veredicto global que da `decidir` con lo observado.

    Una etapa de la fuente que falla deja su módulo en ámbar (`ejecutar_modulo`); una composición que falla deja en
    ámbar el paquete entero (`ejecutar_paquete`), y entonces no se publica nada de `datos/` ni de la web.

    Returns:
        El estado del ciclo: verde, ámbar o rojo.

    Raises:
        ValueError: Si la prueba no recorrió la composición: sin ella no hay veredicto que observar.
    """
    if observado.catalogo_compuesto is None:
        raise ValueError(f"{mutacion.nombre}: la composición del catálogo no se ha recorrido")
    resultados = {
        mutacion.fuente: ResultadoDelModulo(VERDE if observado.fuente_en_verde else AMBAR),
        PAQUETE: ResultadoDelModulo(VERDE if observado.catalogo_compuesto else AMBAR),
    }
    return decidir(resultados, ensayo=True).estado


def alcance(observado: Observado) -> str:
    """Hasta dónde llega el daño: ningún curso, solo los mutados, la fuente entera o el ciclo.

    Returns:
        Uno de NINGUNO, CURSO, FUENTE o CICLO.
    """
    if observado.catalogo_compuesto is False:
        return CICLO
    if not observado.fuente_en_verde:
        return FUENTE
    tocadas = set(cambiadas(observado))
    if not tocadas:
        return NINGUNO
    return CURSO if tocadas <= observado.mutadas else FUENTE
