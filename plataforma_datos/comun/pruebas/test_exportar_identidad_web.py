"""La configuración pública es única y no importa ajustes personales."""

import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from plataforma_datos.comun import exportar_identidad_web as exportar
from plataforma_datos.comun import perfil_web


class PruebaIdentidadPortable(unittest.TestCase):
    """Contraste con el generador único y discrepancias de versión explícitas."""

    def test_copia_coincide_sin_consultar_hogar(self) -> None:
        """El Worker usa una instantánea pública comprobable sin HOME."""
        with mock.patch.object(Path, "home", side_effect=AssertionError("No consultar HOME")):
            self.assertEqual(exportar.main(["--comprobar"]), 0)
        self.assertEqual(set(exportar.documento()["identidad"]), perfil_web.PISTAS | {"User-Agent"})

    def test_configuracion_personal_no_exporta_proxy_cuenta_ni_opciones(self) -> None:
        """La configuración personal no participa ni en la lectura ni en la exportación."""
        with tempfile.TemporaryDirectory() as temporal:
            ruta = Path(temporal) / ".curlrc"
            ruta.write_text('user-agent = "otro"\nproxy = "http://privado.invalid"\nuser = "oculto"\n')
            antes = ruta.read_bytes()
            with mock.patch.object(Path, "home", return_value=ruta.parent):
                self.assertEqual(exportar.main(["--comprobar"]), 0)
                self.assertNotIn("privado", json.dumps(exportar.documento()))
            self.assertEqual(ruta.read_bytes(), antes)

    def test_version_distinta_no_sustituye_perfil_aprobado(self) -> None:
        """Contrastar una versión diferente no actualiza silenciosamente la configuración."""
        antes = perfil_web.RUTA_IDENTIDAD.read_bytes()
        with mock.patch("sys.stderr"), self.assertRaises(SystemExit):
            exportar.main(["--comprobar", "--version", "157.0.0.0"])
        self.assertEqual(perfil_web.RUTA_IDENTIDAD.read_bytes(), antes)
