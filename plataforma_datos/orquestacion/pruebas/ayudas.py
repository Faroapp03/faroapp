"""Inyección de cortes de proceso para comprobar la recuperación de actualizaciones."""

from collections.abc import Callable, Iterator, Sequence
from contextlib import ExitStack, contextmanager
from unittest import mock


class Corte(BaseException):
    """El proceso muere a mitad: ningún `except` (tampoco `except OSError`) lo atrapa."""


@contextmanager
def corte_en(numero: int, operaciones: Sequence[tuple[object, str, str]]) -> Iterator[list[str]]:
    """Corta el proceso antes de la operación de disco `numero`, contada entre las dadas.

    Args:
        numero: La operación, contada desde 1, que no llega a hacerse.
        operaciones: Lo que se vigila, como (objeto, atributo, nombre con que se anota).

    Yields:
        Los nombres de las operaciones hechas hasta el corte, que crece mientras el bloque se ejecuta.
    """
    hechas: list[str] = []

    def envolver(nombre: str, original: Callable[..., object]) -> Callable[..., object]:
        def operacion(*argumentos: object, **opciones: object) -> object:
            if len(hechas) + 1 == numero:
                raise Corte(nombre)
            hechas.append(nombre)
            return original(*argumentos, **opciones)

        return operacion

    with ExitStack() as pila:
        for objeto, atributo, nombre in operaciones:
            pila.enter_context(mock.patch.object(objeto, atributo, envolver(nombre, getattr(objeto, atributo))))
        yield hechas
