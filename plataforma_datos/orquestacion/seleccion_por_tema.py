"""Selección de una actualización por tema: qué módulos de cursos se leen a diario y cómo se acota el plan.

«actualizar-cursos» fuerza la lectura de las fuentes de cursos con cadencia diaria, sin esperar a que venza. El plan
forzado de seguimiento_de_comprobaciones concede descarga a todas las fuentes y recompone todos los módulos; aquí se
acota a la selección. Las demás fuentes ni se descargan ni se ejecutan: conservan su versión publicada y el paquete se
exporta con ellas, igual que en la comprobación programada, que también ejecuta solo una parte del registro. Los
consumidores de un módulo que publica una versión nueva se recomponen sin descarga (actualizar.ejecutar_modulos), así
que la selección no los nombra: los arrastra el cambio real, no una lista fija.

«comprobar-vencidas» hace la misma selección que la programada, pero el ciclo del registro de comprobaciones la anota
con su propio modo: nadie la confunde con la tarea programada ni con su recuperación.
"""

from pathlib import Path
from typing import Protocol

from plataforma_datos.contratos.fuentes import ConjuntoComprobacion, cargar_descriptores
from plataforma_datos.orquestacion.comprobaciones_remotas import leer_registro
from plataforma_datos.orquestacion.modulos import MODULOS
from plataforma_datos.orquestacion.planificacion_de_comprobaciones import Plan

TEMA_CURSOS = "cursos"
CADENCIA_DIARIA = 1  # días entre consultas de un conjunto que se lee a diario
MODO_MANUAL, MODO_PROGRAMADA, MODO_VENCIDAS = "manual", "programada", "vencidas"


class SeleccionPedida(Protocol):
    """Las opciones de la actualización que deciden la selección de módulos y el modo del ciclo."""

    @property
    def solo(self) -> tuple[str, ...] | None:
        """La selección inicial de módulos, o None para todos."""
        ...

    @property
    def programada(self) -> bool:
        """Si se seleccionan solo las consultas vencidas."""
        ...

    @property
    def forzar_comprobaciones(self) -> bool:
        """Si se consultan las fuentes sin esperar su cadencia."""
        ...

    @property
    def a_demanda(self) -> bool:
        """Si la selección de lo vencido se pidió fuera del horario programado."""
        ...


def _se_lee_a_diario(conjuntos: tuple[ConjuntoComprobacion, ...]) -> bool:
    return any(c.operacion == "descargar" and c.intervalo_dias == CADENCIA_DIARIA for c in conjuntos)


def modulos_de_cursos_diarios() -> tuple[str, ...]:
    """Los módulos con alguna fuente de cursos que descarga un conjunto cada día, en el orden del registro.

    La lista sale de las fichas (fuente.json): una fuente nueva de cursos con cadencia diaria entra sola.

    Returns:
        Los identificadores de los módulos, en el orden de MODULOS.
    """
    diarias = {d.id for d in cargar_descriptores(tema=TEMA_CURSOS) if _se_lee_a_diario(d.conjuntos)}
    return tuple(modulo.id for modulo in MODULOS if diarias & set(modulo.fuentes))


MODULOS_DE_CURSOS_DIARIOS = modulos_de_cursos_diarios()


def _modulos_conocidos(solo: object) -> bool:
    return isinstance(solo, tuple) and bool(solo) and set(solo) <= {modulo.id for modulo in MODULOS}


def exigir_seleccion_admitida(opciones: SeleccionPedida) -> None:
    """Admite una selección de módulos junto a la búsqueda forzada; junto a la programada no se admite.

    La programada decide sola qué ha vencido y su recuperación depende de esa decisión: no se le añade otra.

    Raises:
        ValueError: Si la selección acompaña a la programada, está vacía o nombra un módulo que no existe, o si se
            pide a demanda algo que no es la selección de lo vencido.
    """
    if opciones.programada and opciones.solo is not None:
        raise ValueError("la planificación no admite una segunda selección de módulos")
    if opciones.forzar_comprobaciones and opciones.solo is not None and not _modulos_conocidos(opciones.solo):
        raise ValueError("la búsqueda forzada solo se acota a módulos del registro")
    if type(opciones.a_demanda) is not bool or (opciones.a_demanda and not opciones.programada):
        raise ValueError("solo la selección de lo vencido se distingue como pedida a demanda")


def acotar_plan(raiz: Path, plan: Plan, solo: tuple[str, ...] | None) -> Plan:
    """Limita el plan a los módulos elegidos y a sus fuentes; sin selección lo devuelve igual.

    Si un ciclo anterior terminó sin preparar su paquete, el registro pide recomponer todos los módulos. Entonces el
    plan los conserva todos y solo las fuentes elegidas reciben descarga: un ciclo acotado que termina bien retira esa
    petición (comprobaciones_remotas.cerrar_ciclo), así que no puede retirarla sin haberla cumplido.

    Returns:
        El mismo plan si no hay selección; si la hay, sus fuentes y sus módulos (o todos, con una recomposición
        pendiente), en el orden del plan.
    """
    if solo is None:
        return plan
    fuentes = {fuente for modulo in MODULOS if modulo.id in solo for fuente in modulo.fuentes}
    pendiente = leer_registro(raiz)["reconstruccion_pendiente"]
    return Plan(
        tuple(fuente for fuente in plan.fuentes if fuente in fuentes),
        plan.modulos if pendiente else tuple(modulo for modulo in plan.modulos if modulo in solo),
        plan.revisiones,
    )


def modo_del_ciclo(opciones: SeleccionPedida) -> str:
    """El modo con que el registro de comprobaciones anota el ciclo.

    Returns:
        «vencidas» para lo vencido pedido a demanda, «programada» para la tarea programada y «manual» para el resto.
    """
    if not opciones.programada:
        return MODO_MANUAL
    return MODO_VENCIDAS if opciones.a_demanda else MODO_PROGRAMADA
