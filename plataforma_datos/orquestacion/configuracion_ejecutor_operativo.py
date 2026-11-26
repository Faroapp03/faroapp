"""Identidad y opciones admitidas del supervisor operativo."""

from dataclasses import dataclass
from pathlib import Path

from plataforma_datos.orquestacion.almacen_trabajos import ACCIONES, MAX_ENTERO, RUN, UUID
from plataforma_datos.orquestacion.generacion_operativa import REVISION
from plataforma_datos.orquestacion.piezas_de_la_actualizacion import FUENTES

ERROR = "No se ha completado la ejecución de mantenimiento."
# Cada variante lleva su propio Worker principal: solo la oficial atiende el disparador horario (scheduled).
VARIANTES_CLOUDFLARE = ("privado", "oficial")


class ErrorEjecucionOperativa(ValueError):
    """Fallo cerrado: no autoriza repetir el motor ni afirma activación o conservación."""


def _exigir(condicion: bool) -> None:
    if not condicion:
        raise ErrorEjecucionOperativa(ERROR)


@dataclass(frozen=True, kw_only=True)
class ConfiguracionEjecutorOperativo:
    """Expectativas privadas del workflow; ninguna contiene credenciales u órdenes recibidas por HTTP.

    `variante_cloudflare` es la de la instalación: el artefacto se exporta con ella y la activación exige que coincida.
    No tiene valor por omisión, porque exportar otra variante sustituiría el Worker de la instalación por otro.
    """

    checkout: Path
    directorio_trabajo: Path
    revision_codigo: str
    solicitud_id: str
    revision_reserva: int
    run_id: str
    run_attempt: str
    accion: str
    variante_cloudflare: str
    recuperacion_activacion: bool = False
    revisar_paquete_pendiente: bool = False
    reanudar_entradas: bool = False
    en_paralelo: bool = False  # descargar las fuentes en paralelo (variable FARO_FUENTES_EN_PARALELO); si no, en serie
    fuentes_en_serie: tuple[str, ...] = ()  # con en_paralelo, las que se quedan en serie (FARO_FUENTES_EN_SERIE)

    def __post_init__(self) -> None:
        _exigir(isinstance(self.checkout, Path) and isinstance(self.directorio_trabajo, Path))
        _exigir(isinstance(self.revision_codigo, str) and REVISION.fullmatch(self.revision_codigo) is not None)
        _exigir(isinstance(self.solicitud_id, str) and UUID.fullmatch(self.solicitud_id) is not None)
        _exigir(type(self.revision_reserva) is int and 0 < self.revision_reserva <= MAX_ENTERO)
        _exigir(isinstance(self.run_id, str) and RUN.fullmatch(self.run_id) is not None)
        _exigir(type(self.recuperacion_activacion) is bool and type(self.reanudar_entradas) is bool)
        _exigir(
            not self.reanudar_entradas
            or (self.accion == "actualizar-datos" and not self.recuperacion_activacion and not self.en_paralelo)
        )
        _exigir(type(self.revisar_paquete_pendiente) is bool and type(self.en_paralelo) is bool)
        _exigir(type(self.fuentes_en_serie) is tuple and all(fuente in FUENTES for fuente in self.fuentes_en_serie))
        _exigir(self.en_paralelo or not self.fuentes_en_serie)  # la lista solo acompaña al paralelo
        _exigir(
            not self.revisar_paquete_pendiente
            or (self.accion == "comprobar-programada" and not self.recuperacion_activacion)
        )
        _exigir(isinstance(self.variante_cloudflare, str) and self.variante_cloudflare in VARIANTES_CLOUDFLARE)
        _exigir(isinstance(self.run_attempt, str) and RUN.fullmatch(self.run_attempt) is not None)
        intento = int(self.run_attempt)
        _exigir(int(self.run_id) <= MAX_ENTERO and intento <= MAX_ENTERO and self.accion in ACCIONES)
        _exigir(intento > 1 if self.recuperacion_activacion else intento == 1)
