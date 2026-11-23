"""Compone código fijado y una generación operativa privada en un candidato nuevo y sin tráfico.

No instala dependencias, descarga fuentes, ejecuta la actualización ni activa datos. El directorio padre pertenece
exclusivamente al job; el checkout, la generación y cualquier instalación servida se conservan intactos.
"""

import argparse
import stat
import sys
import tempfile
from pathlib import Path
from typing import Any

from plataforma_datos.comun.entrada_salida import json_compacto
from plataforma_datos.comun.nucleo import ErrorFuente
from plataforma_datos.orquestacion import diario_mantenimiento as diario
from plataforma_datos.orquestacion import evidencias_censos, recuperar_ediciones
from plataforma_datos.orquestacion.codigo_candidato import exportar_codigo, promover_directorio
from plataforma_datos.orquestacion.generacion_operativa import REVISION, SHA256, restaurar_base_candidata

ERROR_GENERICO = "Candidato no aprovisionable."
ARBOLES_OPERATIVOS = ("datos", "var")


class AprovisionamientoInvalido(ValueError):
    """La composición no cumple las expectativas privadas o el aislamiento exigido."""


def _exigir(condicion: bool) -> None:
    if not condicion:
        raise AprovisionamientoInvalido(ERROR_GENERICO)


def _directorio(ruta: Path) -> None:
    _exigir(stat.S_ISDIR(ruta.lstat().st_mode))


def _comprobar_destino(checkout: Path, generacion: Path, destino: Path) -> None:
    _directorio(checkout)
    _directorio(generacion)
    _directorio(destino.parent)
    _exigir(not destino.exists() and not destino.is_symlink())
    final = destino.resolve()
    for origen in (checkout.resolve(), generacion.resolve()):
        _exigir(not final.is_relative_to(origen) and not origen.is_relative_to(final))


def _integrar(codigo: Path, operativos: Path) -> None:
    _exigir({ruta.name for ruta in operativos.iterdir()} == set(ARBOLES_OPERATIVOS))
    for nombre in ARBOLES_OPERATIVOS:
        _directorio(operativos / nombre)
        salida = codigo / nombre
        _exigir(not salida.exists() and not salida.is_symlink())
    for nombre in ARBOLES_OPERATIVOS:
        (operativos / nombre).rename(codigo / nombre)


def aprovisionar_candidato(  # noqa: PLR0913, PLR0917 - El contrato separa las expectativas privadas de código y generación.
    checkout: Path,
    destino_nuevo: Path,
    revision_codigo: str,
    generacion: Path,
    revision_generacion: str,
    sha256_generacion: str,
    *,
    buscar_apoyo: recuperar_ediciones.BuscarApoyo | None = None,
    apoyo: Path | None = None,
) -> dict[str, Any]:
    """Prepara y promueve exclusivamente un candidato completo en un destino nuevo.

    Args:
        checkout: Repositorio local del que se extrae únicamente el código versionado autorizado.
        destino_nuevo: Destino inexistente, disjunto de ambos orígenes y bajo un padre privado del job.
        revision_codigo: SHA completo del código que debe exportarse.
        generacion: Generación local con manifiesto y contenido, obtenida por un canal privado autenticado.
        revision_generacion: Revisión esperada de la generación base; puede diferir de la del código.
        buscar_apoyo: Recuperación privada de originales históricos acreditados.
        apoyo: Lote local ya recibido en un ensayo aislado.
        sha256_generacion: Huella esperada del manifiesto, configurada fuera de sus propios bytes.

    Returns:
        Resumen cerrado con las dos revisiones y sus inventarios, sin rutas ni afirmación de activación.
    """
    _exigir(isinstance(revision_codigo, str) and REVISION.fullmatch(revision_codigo) is not None)
    _exigir(isinstance(revision_generacion, str) and REVISION.fullmatch(revision_generacion) is not None)
    _exigir(isinstance(sha256_generacion, str) and SHA256.fullmatch(sha256_generacion) is not None)
    _comprobar_destino(checkout, generacion, destino_nuevo)
    with tempfile.TemporaryDirectory(prefix=".aprovisionando-", dir=destino_nuevo.parent) as nombre:
        temporal = Path(nombre)
        codigo = temporal / "codigo"
        operativos = temporal / "operativos"
        resumen_codigo = exportar_codigo(checkout, codigo, revision_codigo)
        resumen_generacion = restaurar_base_candidata(
            generacion, operativos, revision_generacion, sha256_generacion, codigo
        )
        indice = recuperar_ediciones.indice_del_sello(generacion, revision_generacion, sha256_generacion)
        with diario.paso("originales-de-ediciones"):
            restaurados = recuperar_ediciones.restaurar(
                operativos,
                buscar_apoyo or (lambda raiz, destino: recuperar_ediciones.construir(raiz, checkout, destino)),
                apoyo=apoyo,
                indice=indice,
            )
            if restaurados:
                diario.anotar("originales-de-ediciones", "recuperados", archivos=restaurados)
        with diario.paso("originales-de-censos"):
            ausentes = {
                r: h for r, h in evidencias_censos.referencias(operativos).items() if not (operativos / r).exists()
            }
            total = len(ausentes)
            recuperar_ediciones.reponer_desde_sello(operativos, ausentes, indice)
            _exigir(not ausentes)
            if total:
                diario.anotar("originales-de-censos", "recuperados-del-sello", archivos=total)
        _integrar(codigo, operativos)
        promover_directorio(codigo, destino_nuevo)
    return {"version": 1, "codigo": resumen_codigo, "generacion": resumen_generacion}


def main(argv: list[str] | None = None) -> int:
    """CLI privada explícita; no acepta órdenes ni infiere expectativas del contenido.

    Returns:
        Cero con un resumen JSON cerrado; uno con error genérico y sin resumen de éxito.
    """
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("checkout", type=Path)
    parser.add_argument("destino", type=Path)
    parser.add_argument("--revision-codigo", required=True)
    parser.add_argument("--generacion", type=Path, required=True)
    parser.add_argument("--revision-generacion", required=True)
    parser.add_argument("--sha256-generacion", required=True)
    argumentos = parser.parse_args(argv)
    try:
        resultado = aprovisionar_candidato(
            argumentos.checkout,
            argumentos.destino,
            argumentos.revision_codigo,
            argumentos.generacion,
            argumentos.revision_generacion,
            argumentos.sha256_generacion,
        )
    except (ErrorFuente, OSError, ValueError, TypeError, KeyError, RecursionError):
        print(ERROR_GENERICO, file=sys.stderr)
        return 1
    print(json_compacto(resultado))
    return 0


if __name__ == "__main__":
    sys.exit(main())
