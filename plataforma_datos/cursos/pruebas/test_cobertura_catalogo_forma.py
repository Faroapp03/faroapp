"""La cobertura del catálogo distingue un recibo inválido (no comprobada) de un error de programación (se propaga)."""

import unittest
from pathlib import Path
from unittest import mock

from plataforma_datos.comun.nucleo import ErrorFuente
from plataforma_datos.cursos import cobertura_catalogo, operacion_fuente

FUENTE = sorted(operacion_fuente.FUENTES)[0]
RAIZ = Path("/no-existe/faro-pruebas-cobertura")


def _recibo(**cambios: object) -> dict:
    return {"version": cobertura_catalogo.VERSION_RECEPCION, "fuente": FUENTE, "peticiones": [], **cambios}


class CoberturaCatalogoFormaPruebas(unittest.TestCase):
    """Sin instalación: los recibos inválidos se rechazan antes de leer nada."""

    def test_recibos_con_otra_forma_no_se_comprueban(self) -> None:
        """Otra versión, otra fuente u otra forma de las peticiones dan False sin excepción."""
        invalidos = [
            None,
            [],
            "recibo",
            _recibo(version=1),
            _recibo(fuente="inexistente"),
            _recibo(fuente=[]),
            _recibo(fuente={}),
            _recibo(fuente=None),
            _recibo(peticiones=None),
            _recibo(peticiones=["x"]),
            _recibo(peticiones=[{}]),
            _recibo(peticiones=[{"recurso_sha256": 5}]),
        ]
        for evidencia in invalidos:
            with self.subTest(evidencia=evidencia):
                self.assertFalse(cobertura_catalogo.comprobada(RAIZ, evidencia))

    def test_un_error_de_datos_de_la_admision_da_no_comprobada(self) -> None:
        """Si la fuente no tiene admisión legible, el recibo queda sin comprobar."""
        with mock.patch.object(operacion_fuente, "leer_validado", side_effect=ErrorFuente("admisión ilegible")):
            self.assertFalse(cobertura_catalogo.comprobada(RAIZ, _recibo()))

    def test_un_error_de_programacion_no_se_oculta(self) -> None:
        """Un fallo del código (aquí, un atributo inexistente) se propaga en vez de convertirse en «no comprobada»."""
        with (
            mock.patch.object(operacion_fuente, "leer_validado", side_effect=AttributeError("fallo interno")),
            self.assertRaises(AttributeError),
        ):
            cobertura_catalogo.comprobada(RAIZ, _recibo())


if __name__ == "__main__":
    unittest.main()
