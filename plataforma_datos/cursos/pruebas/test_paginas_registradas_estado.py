"""Las páginas registradas a mano describen el estado de su dato, sin notas de trabajo."""

import re
import unittest

from plataforma_datos.cursos.fuentes.acreditacion.piezas.constantes import PAGINAS_REGISTRADAS

# Formas de una tarea por hacer escrita dentro del dato.
NOTA_DE_TRABAJO = re.compile(r"\bfalta\b|\bpendiente\b|\bTODO\b", re.IGNORECASE)


class PruebaEstadoDePaginasRegistradas(unittest.TestCase):
    """Cada «dice» es un hecho del dato; lo que queda por hacer vive en el desarrollo, no en el producto."""

    def test_ningun_dato_lleva_una_tarea_pendiente(self) -> None:
        """Un texto del producto no anuncia trabajo por hacer."""
        for clave, pagina in PAGINAS_REGISTRADAS.items():
            with self.subTest(pagina=clave):
                self.assertIsNone(NOTA_DE_TRABAJO.search(pagina["dice"]), pagina["dice"])

    def test_pagina_sin_copia_dice_por_que_y_como_se_renueva(self) -> None:
        """Sin huella, el dato explica qué fuente no admite lectura automática y cómo se renueva."""
        for clave, pagina in PAGINAS_REGISTRADAS.items():
            if pagina["sha256"] is not None:
                continue
            with self.subTest(pagina=clave):
                self.assertIn("Sin copia conservada", pagina["dice"])
                self.assertIn("no admite lectura automática", pagina["dice"])
                self.assertIn("se renueva guardándola a mano", pagina["dice"])


if __name__ == "__main__":
    unittest.main()
