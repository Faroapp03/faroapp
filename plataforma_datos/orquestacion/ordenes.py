"""Interfaz de órdenes común de las fuentes: descargar, preparar, validar y todo, y el error con su motivo.

`--comprobar-orden` interpreta la orden con el intérprete real de la fuente y termina sin ejecutar ninguna etapa:
la actualización lo usa (motivo_de_rechazo) para que una orden que la fuente no admite quede como error propio de la
orquestación, antes de abrir una consulta remota que nunca llegaría a la red.
"""

import argparse
import contextlib
import io
import sys
from collections.abc import Callable, Sequence
from contextvars import ContextVar

from plataforma_datos.comun.nucleo import ACCIONES, ERRORES_CON_MOTIVO, ETAPAS, TODO, ErrorFuente, exigir
from plataforma_datos.comun.observacion_remota import contexto_descarga

COMPROBAR_ORDEN = "--comprobar-orden"
MAX_MOTIVO_DE_RECHAZO = 300  # caracteres del error del intérprete que se conservan en el motivo
# Mientras se comprueba una orden, ninguna etapa puede ejecutarse, aunque un lector no respetara COMPROBAR_ORDEN.
_COMPROBANDO: ContextVar[bool] = ContextVar("comprobando_orden", default=False)


class EtapaDuranteLaComprobacion(Exception):
    """Un lector intentó ejecutar una etapa mientras solo se comprobaba su orden."""


def interfaz(descripcion: str) -> argparse.ArgumentParser:
    """Crea el intérprete de argumentos común: `descargar`, `preparar`, `validar` y `todo` (las tres, en ese orden).

    Args:
        descripcion: Texto de ayuda de la orden.

    Returns:
        El intérprete, con la acción y la opción `--depurar`.
    """
    analizador = argparse.ArgumentParser(description=descripcion, formatter_class=argparse.RawDescriptionHelpFormatter)
    analizador.add_argument("accion", choices=ACCIONES, help=f"etapa que se ejecuta; «{TODO}» encadena las tres")
    analizador.add_argument(
        "--depurar",
        action="store_true",
        help="ante un error, mostrar la traza completa en lugar del motivo en una línea",
    )
    analizador.add_argument(
        COMPROBAR_ORDEN,
        action="store_true",
        help="interpretar la orden y terminar sin ejecutar ninguna etapa",
    )
    return analizador


def interfaz_con_descarga(descripcion: str) -> argparse.ArgumentParser:
    """Crea la interfaz común de una fuente que descarga con código: añade `--aceptar-cambio`.

    Args:
        descripcion: Texto de ayuda de la orden.

    Returns:
        El intérprete común con la opción `--aceptar-cambio`.
    """
    analizador = interfaz(descripcion)
    analizador.add_argument(
        "--aceptar-cambio",
        action="store_true",
        help="sustituir un original que ya no coincide con su procedencia, tras revisar la versión nueva",
    )
    return analizador


def con_motivo(orden: Callable[[], None], depurar: bool = False) -> int:
    """Ejecuta una orden de la línea de órdenes; si falla, escribe «Error: <motivo>» sin traza.

    Args:
        orden: Lo que se ejecuta.
        depurar: Con la opción --depurar, el error se relanza con su traza completa para diagnosticarlo.

    Returns:
        El código de salida: 0 si va bien y 1 si falla con un error de ERRORES_CON_MOTIVO.

    Raises:
        ERRORES_CON_MOTIVO: Con `depurar`, el error de la orden tal cual, con su traza.
    """
    try:
        orden()
    except ERRORES_CON_MOTIVO as error:
        if depurar:
            raise
        print(f"Error: {error}", file=sys.stderr)
        return 1
    return 0


def ejecutar(accion: str, etapas: dict[str, Callable[[], None]], depurar: bool = False) -> int:
    """Ejecuta una acción de la interfaz común.

    Args:
        accion: Una etapa de ETAPAS o TODO, que las encadena en su orden.
        etapas: La función de cada etapa de la fuente.
        depurar: Si un error se relanza con su traza en lugar de resumirse en una línea.

    Returns:
        El código de salida: 0 si todo va bien y 1 si una etapa falla o la fuente no la define.

    Raises:
        EtapaDuranteLaComprobacion: Si se llama mientras motivo_de_rechazo solo comprueba una orden.
    """
    if _COMPROBANDO.get():
        raise EtapaDuranteLaComprobacion(accion)
    etapas_de_la_accion = [etapa for etapa in ETAPAS if accion in (etapa, TODO)]

    def en_orden() -> None:
        """Ejecuta las etapas de la acción, en el orden de la interfaz común.

        Raises:
            ErrorFuente: Si la fuente no define una etapa de la acción (antes de ejecutar ninguna).
        """
        for etapa in etapas_de_la_accion:
            exigir(etapa in etapas, f"la fuente no define la etapa «{etapa}»", ErrorFuente)
        for etapa in etapas_de_la_accion:
            if etapa == "descargar":
                with contexto_descarga():
                    etapas[etapa]()
            else:
                etapas[etapa]()

    return con_motivo(en_orden, depurar=depurar)


def principal_fuente(
    descripcion: str | None,
    etapas: dict[str, Callable[[], None]],
    argumentos: list[str] | None = None,
) -> int:
    """Interpreta la orden de una fuente y ejecuta las etapas con el tratamiento común de errores.

    Args:
        descripcion: Texto de ayuda de la orden (el docstring del módulo de la fuente).
        etapas: La función de cada etapa de la fuente.
        argumentos: Los argumentos de la línea de órdenes; sin ellos, los del proceso.

    Returns:
        El código de salida de `ejecutar`.
    """
    opciones = interfaz(descripcion or "").parse_args(argumentos)
    if opciones.comprobar_orden:
        return 0
    return ejecutar(opciones.accion, etapas=etapas, depurar=opciones.depurar)


def principal_fuente_con_descarga(
    descripcion: str | None,
    descargar: Callable[[bool], None],
    preparacion_y_validacion: dict[str, Callable[[], None]],
    argumentos: list[str] | None = None,
) -> int:
    """Interpreta la orden y entrega a la descarga la aceptación explícita de una copia nueva.

    Args:
        descripcion: Texto de ayuda de la orden (el docstring del módulo de la fuente).
        descargar: La descarga de la fuente; recibe si se acepta un original cambiado.
        preparacion_y_validacion: La función de las etapas `preparar` y `validar`.
        argumentos: Los argumentos de la línea de órdenes; sin ellos, los del proceso.

    Returns:
        El código de salida de `ejecutar`.
    """
    opciones = interfaz_con_descarga(descripcion or "").parse_args(argumentos)
    if opciones.comprobar_orden:
        return 0
    etapas = {"descargar": lambda: descargar(opciones.aceptar_cambio), **preparacion_y_validacion}
    return ejecutar(opciones.accion, etapas=etapas, depurar=opciones.depurar)


def motivo_de_rechazo(principal: Callable[[list[str]], int], argumentos: Sequence[str]) -> str | None:
    """Interpreta una orden con el `main` real de una fuente, sin ejecutar ninguna etapa ni salir a la red.

    Añade COMPROBAR_ORDEN: con la interfaz común, el intérprete termina tras validar los argumentos. Un lector con
    otro intérprete no conoce esa opción y la rechaza; y si uno de la interfaz común no la respetara, `ejecutar` se
    niega a correr etapas durante la comprobación. Así la comprobación nunca ejecuta una etapa por error.

    Args:
        principal: El `main` del lector, que recibe sus argumentos sin el nombre del programa.
        argumentos: La etapa y sus parámetros, tal como los recibirá el proceso.

    Returns:
        None si la fuente admite la orden; si no, el motivo en una línea (el error del intérprete, acotado).
    """
    errores = io.StringIO()
    marca = _COMPROBANDO.set(True)
    try:
        with contextlib.redirect_stderr(errores), contextlib.redirect_stdout(io.StringIO()):
            codigo = principal([*argumentos, COMPROBAR_ORDEN])
    except SystemExit as salida:
        lineas = errores.getvalue().strip().splitlines()
        detalle = lineas[-1].split("error: ", 1)[-1] if lineas else f"el intérprete terminó con {salida.code!r}"
        return detalle[:MAX_MOTIVO_DE_RECHAZO]
    except EtapaDuranteLaComprobacion:
        return f"el lector no respeta {COMPROBAR_ORDEN}: intentó ejecutar sus etapas"
    finally:
        _COMPROBANDO.reset(marca)
    return None if codigo == 0 else f"la comprobación de la orden terminó con el código {codigo!r}"
