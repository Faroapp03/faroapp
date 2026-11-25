"""Aplica las fuentes a candidatas privadas, cada una con su tramo y su conjunto íntegro."""

import shutil
from collections.abc import Callable
from pathlib import Path
from typing import NamedTuple

from plataforma_datos.cursos import almacen_catalogo as almacen
from plataforma_datos.cursos import operacion_fuente, reevaluar_registros, retencion_composicion
from plataforma_datos.cursos.fuentes.fundae import preinscripcion
from plataforma_datos.cursos.fuentes.hp_life.recepciones import fecha_utc
from plataforma_datos.orquestacion.fallo_del_paso import FUENTES_DE_COMPONER, tramo

CARPETAS_DE_LAS_FUENTES = {
    "cibervoluntarios": "ciber",
    "claude_academy": "academy",
    "fundae": "fundae",
    "barcelonactiva": "cibernarium",
}
BARCELONACTIVA = "barcelonactiva"
FUNDAE = "fundae"


class Aplicaciones(NamedTuple):
    """Aplicadores de HP LIFE y las demás fuentes de composición."""

    hp: Callable[[Path, Path, Path, Path, str], Path]
    por_fuente: dict[str, Callable[..., Path]]
    fundae_sin_aplicar: Callable[[], bool]


class ResultadoDeFuentes(NamedTuple):
    """Almacén final de la composición y aviso que lo acompaña."""

    almacen: Path
    avisos: dict[str, dict]


class _Composicion:
    def __init__(self, raiz: Path, areas: tuple[Path, Path], corte: str, aplicaciones: Aplicaciones) -> None:
        self.raiz = raiz
        self.base = raiz / almacen.RUTA
        self.local, self.externo = areas
        self.corte = corte
        self.aplicaciones = aplicaciones
        self.anterior = retencion_composicion.leer(self.base)
        self.avisos: dict[str, dict] = {}

    def _retener(self, fuente: str, error: almacen.DocumentoArchivadoExcesivo) -> None:
        # La última versión debe estar aplicada en la base común, antes de empezar la composición.
        if (fecha := retencion_composicion.fecha_admitida(self.base, fuente, self.corte)) is None:
            raise error
        desde = retencion_composicion.iso_utc(fecha_utc(self.corte))
        if fecha_utc(fecha) > fecha_utc(desde):
            raise error
        previo = self.anterior.get(fuente)
        if previo and previo["versionEn"] == fecha:
            desde = previo["desde"]
        self.avisos[fuente] = {"motivo": retencion_composicion.DOCUMENTO_EXCESIVO, "desde": desde, "versionEn": fecha}

    def _aplicar_hp(self) -> Path:
        carpeta = self.local / "hp"
        with tramo("hp_life"):
            try:
                return self.aplicaciones.hp(self.raiz, self.base, self.externo, carpeta / almacen.RUTA, self.corte)
            except almacen.DocumentoArchivadoExcesivo as error:
                self._retener("hp_life", error)
                _descartar(carpeta, self.externo / "hp-life")
                return self.base

    def _aplicar_fuente(self, fuente: str, base: Path) -> Path:
        carpeta = self.local / CARPETAS_DE_LAS_FUENTES[fuente]
        aplicar = self.aplicaciones.por_fuente[fuente]
        nueva = base
        try:
            with tramo(f"pendiente-{fuente}"):
                for numero, (propio, pendiente) in enumerate(operacion_fuente.leer_pendientes(fuente, self.raiz)):
                    destino = carpeta / f"pendiente-{numero}" / almacen.RUTA
                    conjunto = (pendiente, self.corte) if fuente == BARCELONACTIVA else pendiente
                    nueva = aplicar(self.raiz, nueva, destino, propio, conjunto)
            with tramo(fuente):
                return aplicar(self.raiz, nueva, carpeta / almacen.RUTA, self.corte)
        except almacen.DocumentoArchivadoExcesivo as error:
            self._retener(fuente, error)
            _descartar(carpeta)
            return base

    def _aplicar_ediciones(self, nueva: Path, *, antes_fundae: Path, tras_fundae: Path) -> Path:
        if FUNDAE in self.avisos:
            return nueva
        carpeta = self.local / "fundae-ediciones"
        with tramo("fundae-ediciones"):
            try:
                return preinscripcion.aplicar_si_cambia(self.raiz, nueva, carpeta / almacen.RUTA, self.corte)
            except almacen.DocumentoArchivadoExcesivo as error:
                self._retener(FUNDAE, error)
                _descartar(carpeta, self.local / CARPETAS_DE_LAS_FUENTES[FUNDAE])
        if antes_fundae == tras_fundae:
            return nueva
        if nueva == tras_fundae:
            return antes_fundae
        # Barcelona se había aplicado sobre la nueva versión de FUNDAE: se vuelve a aplicar desde la base anterior.
        _descartar(self.local / CARPETAS_DE_LAS_FUENTES[BARCELONACTIVA])
        return self._aplicar_fuente(BARCELONACTIVA, antes_fundae)

    def ejecutar(self, sin_identidades: tuple[str, ...]) -> ResultadoDeFuentes:
        """Aplica pendientes y conjuntos actuales en su orden, con la reevaluación común al final.

        Returns:
            Almacén final y retenciones de los productores con fallos separables.
        """
        nueva = self.base if "hp_life" in sin_identidades else self._aplicar_hp()
        antes_fundae = tras_fundae = nueva
        for fuente in FUENTES_DE_COMPONER:
            if fuente in sin_identidades:
                continue
            if fuente == FUNDAE:
                antes_fundae = nueva
            nueva = self._aplicar_fuente(fuente, nueva)
            if fuente == FUNDAE:
                tras_fundae = nueva
        nueva = self._aplicar_ediciones(nueva, antes_fundae=antes_fundae, tras_fundae=tras_fundae)
        with tramo("reevaluacion"):
            nueva = reevaluar_registros.aplicar_si_cambia(nueva, self.local / "reevaluacion" / almacen.RUTA, self.corte)
        # No da por recuperada una fuente si la composición no pudo volver a intentar su conjunto.
        for fuente, aviso in self.anterior.items():
            _, _, validado = operacion_fuente.rutas_de_la_fuente(fuente, self.raiz)
            if (
                fuente in sin_identidades
                or not (validado / "validacion.json").is_file()
                or (fuente == FUNDAE and self.aplicaciones.fundae_sin_aplicar())
            ):
                self.avisos.setdefault(fuente, aviso)
        return ResultadoDeFuentes(nueva, self.avisos)


def _descartar(*carpetas: Path) -> None:
    for carpeta in carpetas:
        if carpeta.exists():
            shutil.rmtree(carpeta)


def aplicar_las_fuentes(
    raiz: Path,
    areas: tuple[Path, Path],
    corte: str,
    sin_identidades: tuple[str, ...],
    aplicaciones: Aplicaciones,
) -> ResultadoDeFuentes:
    """Aplica las fuentes conservando el estado de partida de la que encuentra una cota local.

    Returns:
        Almacén resultante y avisos persistentes.
    """
    return _Composicion(raiz, areas, corte, aplicaciones).ejecutar(sin_identidades)
