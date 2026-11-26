"""Opciones de la orden de actualización del catálogo."""

import argparse
from collections.abc import Callable, Sequence
from pathlib import Path


def analizador_de_actualizacion(
    descripcion: str | None, pausa: float, leer_pausa: Callable[[str], float], fuentes: Sequence[str]
) -> argparse.ArgumentParser:
    """Construye el analizador con las fuentes y la cadencia vigentes en el motor.

    Returns:
        Analizador de la orden principal de actualización.
    """
    analizador = argparse.ArgumentParser(description=descripcion, formatter_class=argparse.RawDescriptionHelpFormatter)
    analizador.add_argument("--ensayo", action="store_true", help="hacerlo todo menos sustituir lo vigente")
    seleccion = analizador.add_mutually_exclusive_group()
    seleccion.add_argument("--pendientes", action="store_true", help="solo los módulos cuyo reintento ha vencido")
    seleccion.add_argument("--programada", action="store_true", help="consultas oficiales cuya cadencia ha vencido")
    seleccion.add_argument(
        "--buscar-actualizaciones",
        action="store_true",
        help="comprobar las fuentes automáticas sin esperar su cadencia",
    )
    analizador.add_argument("--area", type=Path, help="carpeta (que no exista) para el área de ensayo")
    analizador.add_argument("--conservar-area", action="store_true", help="no borrar el área al terminar")
    modo = analizador.add_mutually_exclusive_group()
    # Las dos opciones comparten destino y argparse toma el valor por omisión de la primera: por eso va explícito.
    modo.add_argument("--en-serie", dest="en_paralelo", action="store_false", default=False, help="por omisión")
    modo.add_argument("--en-paralelo", action="store_true", help="adelantar las descargas, una cola por servidor")
    analizador.add_argument("--pausa", type=leer_pausa, default=pausa, help="segundos entre fuentes")
    analizador.add_argument(
        "--sin-descargar",
        action="append",
        default=[],
        choices=fuentes,
        metavar="FUENTE",
        help="no descargar esta fuente esta vez (se usa su copia vigente); se puede repetir",
    )
    seleccion.add_argument(
        "--aceptar-cuarentena",
        action="append",
        default=[],
        metavar="ARCHIVO",
        help=(
            "aceptar que un archivo en cuarentena baje hasta las cifras vistas: una ejecución posterior lo publica si "
            "su versión publicada es la misma, no trae menos entradas ni otra pérdida; no actualiza ahora"
        ),
    )
    return analizador
