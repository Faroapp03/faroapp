"""Retirada de una oferta por el proveedor: el listado completo la afirma y una ficha íntegra posterior la contradice.

El adaptador solo emite la observación de ausencia cuando el listado es completo y la lectura de la página del curso
lo corrobora (véase `fuentes/hp_life/bajas.py` y `fuentes/cibervoluntarios/bajas.py`); este contrato fija qué decide el
evaluador con ella.
"""

from collections.abc import Callable
from typing import Protocol

from plataforma_datos.cursos import oferta_continua
from plataforma_datos.cursos.tipos_json import ObjetoJson


class _Contexto(Protocol):
    """Lo que la decisión necesita de la evaluación en curso."""

    @property
    def oferta(self) -> ObjetoJson: ...
    @property
    def politica(self) -> ObjetoJson: ...
    @property
    def catalogos(self) -> list[ObjetoJson]: ...
    @property
    def fichas(self) -> list[ObjetoJson]: ...


METODO = "retirada-por-catalogo-completo-1"
FUENTE = "hp_life"
VERSION_POLITICA = "3"
MOTIVO = "retirado_por_el_proveedor"
# Política que aplica la retirada, por fuente y versión, con la regla de disponibilidad que declara. HP LIFE la declara
# como regla propia; Cibervoluntarios conserva la de su oferta publicada y añade la retirada.
POLITICAS = {
    ("hp_life", "3"): METODO,
    ("cibervoluntarios", "3"): oferta_continua.METODO,
}


def regla_valida(politica: ObjetoJson) -> bool:
    """Indica si la política registra esta regla para su fuente y versión.

    Returns:
        True solo para las políticas de HP LIFE y de Cibervoluntarios que la declaran.
    """
    regla = POLITICAS.get((politica["fuente_id"], politica["version"]))
    return regla is not None and politica.get("regla_disponibilidad") == regla


def decidir(
    evaluacion: _Contexto, ficha_identificada: Callable[[ObjetoJson, ObjetoJson], bool]
) -> tuple[str, str] | None:
    """Decide la retirada de una oferta sin tocar su decisión cuando no se cumple.

    Se retira si la última lectura del listado, completa, no la incluye y ninguna ficha íntegra de la oferta es más
    reciente o igual de reciente que esa lectura.

    Returns:
        Estado y motivo de la retirada, o None si no hay retirada que aplicar.
    """
    from plataforma_datos.cursos.vigencia import instante_utc

    if not regla_valida(evaluacion.politica):
        return None
    ausencias = [
        c
        for c in evaluacion.catalogos
        if c["detalle"]["lectura_completa"] is True and c["detalle"]["presente"] is False
    ]
    if not ausencias:
        return None
    desde = max(instante_utc(c["terminado_el"], "terminado_el") for c in ausencias)
    # Con un empate exacto gana la ficha íntegra: el curso sigue vigente.
    vigentes = [
        f
        for f in evaluacion.fichas
        if instante_utc(f["terminado_el"], "terminado_el") >= desde and ficha_identificada(f, evaluacion.oferta)
    ]
    return None if vigentes else ("no-disponible-publicamente", MOTIVO)
