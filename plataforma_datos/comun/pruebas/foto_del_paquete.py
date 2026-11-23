"""Las fotos del paquete en las pruebas de Python, pareja de `pruebas/ayudas/foto-del-paquete.ts`.

Una foto fija cifras o contenidos del paquete de una fecha para detectar que un cambio de código altera el resultado
sin querer. Solo vale contra ese mismo paquete, así que la comprobación del ciclo, que cada día recibe uno nuevo, no
la ejecuta; la batería completa sí. Un módulo de pruebas es una foto si decora una clase de casos con
`@foto_del_paquete(...)`: ese decorador declara el paquete y es la marca que lee `scripts/fotos-del-paquete.ts`.
"""

import hashlib
import unittest
from collections.abc import Callable
from pathlib import Path
from typing import TypeVar

RAIZ = Path(__file__).resolve().parents[3]
CATALOGO = RAIZ / "web/datos/catalogo-cursos"

Casos = TypeVar("Casos", bound=type[unittest.TestCase])


def huella_del_catalogo() -> str:
    """La huella SHA-256 del catálogo de Cursos publicado en el árbol.

    Returns:
        La huella en hexadecimal.
    """
    (ruta,) = sorted(CATALOGO.glob("*.json"))
    return hashlib.sha256(ruta.read_bytes()).hexdigest()


def exigir_el_paquete_de_la_foto(catalogo: str, regenerar: str) -> None:
    """Exige que el catálogo del árbol sea el de la foto.

    Raises:
        AssertionError: Si no lo es, con las dos huellas y lo que hay que hacer para regenerar la foto.
    """
    arbol = huella_del_catalogo()
    if arbol != catalogo:
        raise AssertionError(
            f"Esta prueba es una foto del paquete con el catálogo {catalogo}, y el paquete del árbol es otro "
            f"(catálogo {arbol}). Sus cifras solo valen para aquel paquete. Si el cambio de datos es el esperado, "
            f"regenera la foto: {regenerar}, y declara en ella la huella del árbol."
        )


def foto_del_paquete(catalogo: str, regenerar: str) -> Callable[[Casos], Casos]:
    """Marca una clase de casos como foto del paquete y comprueba el paquete antes de cada caso.

    Returns:
        El decorador de la clase.
    """

    def marcar(clase: Casos) -> Casos:
        preparar = clase.setUp

        def comprobar_y_preparar(caso: unittest.TestCase) -> None:
            exigir_el_paquete_de_la_foto(catalogo, regenerar)
            preparar(caso)

        clase.setUp = comprobar_y_preparar
        return clase

    return marcar
