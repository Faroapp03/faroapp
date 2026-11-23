"""El preparador común de los dos runtimes rechaza fuentes ajenas antes de extraerlas."""

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from plataforma_datos.comun.pruebas.hijo_aislado import orden_de_guion_sin_red

HERRAMIENTA = Path(__file__).resolve().parents[3] / "herramientas/mantenimiento/fuente-sqlite.py"


class PruebaFuenteSqlite(unittest.TestCase):
    """Entrada real del verificador que usan macOS y el runner Linux."""

    def test_url_del_archivo_fijado(self) -> None:
        """Un proceso aislado puede obtener la dirección antes de preparar las dependencias."""
        resultado = subprocess.run(
            orden_de_guion_sin_red(sys.executable, HERRAMIENTA), check=True, capture_output=True, text=True
        )
        self.assertEqual(resultado.stdout.strip(), "https://www.sqlite.org/2026/sqlite-amalgamation-3540100.zip")

    def test_zip_incompleto_o_de_igual_tamano_con_huella_distinta(self) -> None:
        """Una descarga truncada o sustituida no deja archivos disponibles para el compilador."""
        with tempfile.TemporaryDirectory() as temporal:
            base = Path(temporal)
            archivo, destino = base / "sqlite.zip", base / "fuentes"
            for tamano in (0, 2_990_966):
                with self.subTest(tamano=tamano):
                    archivo.write_bytes(bytes(tamano))
                    resultado = subprocess.run(
                        orden_de_guion_sin_red(sys.executable, HERRAMIENTA, str(archivo), str(destino)),
                        check=False,
                        capture_output=True,
                        text=True,
                    )
                    self.assertNotEqual(resultado.returncode, 0)
                    self.assertIn("huella SHA3-256", resultado.stderr)
                    self.assertFalse(destino.exists())
