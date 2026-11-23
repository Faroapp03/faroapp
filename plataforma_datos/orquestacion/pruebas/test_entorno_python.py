"""Bibliotecas del intérprete de mantenimiento, sin heredar rutas del ambiente."""

import os
import unittest
from unittest.mock import patch

from plataforma_datos.orquestacion import procesos


class PruebaEntornoPython(unittest.TestCase):
    """El Python de la caché Linux conserva solo su biblioteca de instalación."""

    def test_linux_deriva_biblioteca_del_interprete_base(self) -> None:
        """El venv utiliza la biblioteca de su Python base, incluso con espacios y Unicode."""
        with (
            patch("sys.platform", "linux"),
            patch("sys.base_prefix", "/herramientas/Año 2026/Python 3.12.15"),
            patch("sys.prefix", "/trabajo/candidato/.venv"),
            patch.dict(os.environ, {"LD_LIBRARY_PATH": "/ruta/ajena", "PYTHONHOME": "/otro/python"}),
        ):
            self.assertEqual(
                procesos.bibliotecas_de_python(),
                {"LD_LIBRARY_PATH": "/herramientas/Año 2026/Python 3.12.15/lib"},
            )
            self.assertEqual(os.environ["LD_LIBRARY_PATH"], "/ruta/ajena")

    def test_otros_sistemas_no_agregan_bibliotecas_linux(self) -> None:
        """Otros sistemas, incluido macOS, no reciben ni reenvían LD_LIBRARY_PATH."""
        for sistema in ("darwin", "win32"):
            with (
                self.subTest(sistema=sistema),
                patch("sys.platform", sistema),
                patch.dict(os.environ, {"LD_LIBRARY_PATH": "/ruta/ajena"}),
            ):
                self.assertEqual(procesos.bibliotecas_de_python(), {})


if __name__ == "__main__":
    unittest.main()
