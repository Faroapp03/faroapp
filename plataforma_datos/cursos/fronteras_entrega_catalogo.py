"""Fronteras locales de entrega; no sobrescribe entradas ni atraviesa enlaces."""

from dataclasses import dataclass
from pathlib import Path

from plataforma_datos.cursos.admision_catalogo import entrada_regular_ajena_al_destino
from plataforma_datos.cursos.contrato_entrega_catalogo import exigir


@dataclass(frozen=True, kw_only=True)
class FronteraEscritura:
    """Área exclusiva y archivos declarados; sus carpetas no son entradas implícitas."""

    area: Path
    entradas: tuple[Path, ...]

    def comprobar(self, ruta: Path, *, publica: bool = False) -> None:
        """Comprueba hoja, padres y alias antes de cada creación/reemplazo."""
        absoluta = ruta.absolute()
        for componente in (absoluta, *absoluta.parents):
            exigir(not componente.is_symlink(), "Frontera de escritura con enlace simbólico")
        resuelta = absoluta.resolve()
        for entrada in self.entradas:
            if entrada_regular_ajena_al_destino(entrada, absoluta):
                continue
            exigir(not resuelta.is_relative_to(entrada.resolve()), "Escritura sobre entrada protegida")
            exigir(
                not (absoluta.exists() and entrada.exists() and absoluta.samefile(entrada)),
                "Alias duro de entrada protegida",
            )
        if publica:
            exigir(not resuelta.is_relative_to(self.area.resolve()), "Destino dentro del área privada")
        else:
            exigir(resuelta.is_relative_to(self.area.resolve()), "Escritura privada fuera de su área")
