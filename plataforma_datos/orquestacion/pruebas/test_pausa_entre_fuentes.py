"""La pausa entre dos fuentes con red: la cortesía por dominio de un proceso no pasa al proceso siguiente.

Cada fuente se descarga en su propio proceso y `red.PausasPorDominio` recuerda los dominios solo en memoria. Dos fuentes
seguidas pueden consultar el mismo sitio (la formación y los enlaces, el SEPE): entre la última consulta de una y la
primera de la otra hace falta la misma pausa que entre dos consultas del mismo proceso, y no más.
"""

import contextlib
import io
import unittest
from pathlib import Path
from unittest import mock

from plataforma_datos.comun import red
from plataforma_datos.orquestacion import actualizar


def _bien(_orden: list[str], _area: Path) -> actualizar.Resultado:
    return actualizar.Resultado(0, "")


class PausaEntreFuentes(unittest.TestCase):
    """Antes de cada descarga con red se espera la pausa de cortesía por dominio, y solo entonces."""

    def test_la_pausa_entre_fuentes_es_la_de_cortesia_por_dominio(self) -> None:
        """La pausa por omisión de una actualización es la mínima entre dos consultas al mismo dominio."""
        self.assertEqual(actualizar.PAUSA_ENTRE_FUENTES, red.PAUSA_ENTRE_PETICIONES_S)
        self.assertEqual(actualizar.Opciones().pausa, red.PAUSA_ENTRE_PETICIONES_S)

    def test_solo_las_descargas_con_red_esperan(self) -> None:
        """Cada descarga con red espera la pausa de cortesía; una preparación no espera."""
        ordenes = [
            actualizar.Orden("consorci · descargar", ["a"], "consorci", "descargar"),
            actualizar.Orden("consorci · preparar", ["b"], "consorci", "preparar"),
            actualizar.Orden("enlaces · descargar", ["c"], "enlaces", "descargar"),
        ]
        with mock.patch.object(actualizar.time, "sleep") as dormir, contextlib.redirect_stdout(io.StringIO()):
            actualizar.ejecutar_pasos(Path(), _bien, ordenes, actualizar.Opciones())
        self.assertEqual([llamada.args for llamada in dormir.call_args_list], [(2.0,), (2.0,)])


if __name__ == "__main__":
    unittest.main()
