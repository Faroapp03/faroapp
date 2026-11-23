"""La identidad del producto es portable y no depende del perfil del operador."""

import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from plataforma_datos.comun import exportar_identidad_web, perfil_web


class PruebaConfiguracionProyecto(unittest.TestCase):
    """Contrasta los transportes con la configuración que consume TypeScript."""

    def test_python_y_typescript_comparten_configuracion_sin_home(self) -> None:
        """Una cuenta distinta no cambia las cabeceras ni impide navegar HTML."""
        ruta = Path(__file__).resolve().parents[3] / "config" / "identidad-web.json"
        esperado = json.loads(ruta.read_text(encoding="utf-8"))["identidad"]
        with mock.patch.object(Path, "home", side_effect=AssertionError("HOME no es configuración del producto")):
            for uso in ("datos", "pagina", "idioma-original"):
                with self.subTest(uso=uso):
                    cabeceras = perfil_web.cabeceras_peticion(None, uso)
                    self.assertEqual(perfil_web.identidad_publica(cabeceras), esperado)
                    self.assertEqual(cabeceras["Accept-Encoding"], "gzip, deflate")
                    self.assertEqual("Accept-Language" in cabeceras, uso == "pagina")

    def test_contrato_cerrado_rechaza_ambiguedad_y_exceso(self) -> None:
        """Un JSON mal formado no elige un perfil por defecto ni admite cabeceras adicionales."""
        valido = json.dumps(exportar_identidad_web.documento())
        casos = (
            b"\xff",
            b" " * (perfil_web.MAX_CONFIGURACION + 1),
            b"[]",
            b"[" * 2000 + b"]" * 2000,
            valido.replace('"version": 1', '"version": true').encode(),
            valido.replace('"version": 1', '"version": 2').encode(),
            valido.replace('"version": 1', '"version": 1, "version": 1').encode(),
            valido.replace('"sec-ch-ua-mobile": "?0"', '"sec-ch-ua-mobile": null').encode(),
            valido.replace('"sec-ch-ua-mobile": "?0"', '"sec-ch-ua-mobile": "?1"').encode(),
            valido.replace('"identidad": {', '"identidad": {"X-Privado": "no reenviar",').encode(),
        )
        with tempfile.TemporaryDirectory() as carpeta:
            ruta = Path(carpeta) / "identidad-web.json"
            for contenido in casos:
                ruta.write_bytes(contenido)
                with self.subTest(contenido=contenido[:100]), self.assertRaises(perfil_web.PerfilInvalido):
                    perfil_web.leer_perfil(ruta)

    def test_exportador_comprueba_y_actualiza_solo_version_explicita(self) -> None:
        """Comprobar es de solo lectura; repetir la actualización no reescribe el archivo."""
        with tempfile.TemporaryDirectory(prefix="Perfil Año ") as carpeta:
            ruta = Path(carpeta) / "identidad-web.json"
            ruta.write_text(json.dumps(exportar_identidad_web.documento("156.0.0.0")), encoding="utf-8")
            with mock.patch.object(perfil_web, "RUTA_IDENTIDAD", ruta):
                antes = (ruta.read_bytes(), ruta.stat().st_mtime_ns)
                self.assertEqual(exportar_identidad_web.main(["--comprobar"]), 0)
                self.assertEqual((ruta.read_bytes(), ruta.stat().st_mtime_ns), antes)
                with mock.patch("sys.stderr"), self.assertRaises(SystemExit):
                    exportar_identidad_web.main(["--comprobar", "--version", "157.0.0.0"])
                self.assertEqual((ruta.read_bytes(), ruta.stat().st_mtime_ns), antes)
                self.assertEqual(exportar_identidad_web.main(["--version", "157.0.8078.48"]), 0)
                self.assertEqual(perfil_web.leer_perfil(), perfil_web.perfil_chrome("157.0.0.0"))
                actualizado = (ruta.read_bytes(), ruta.stat().st_mtime_ns)
                self.assertEqual(exportar_identidad_web.main(["--version", "157.0.8078.48"]), 0)
                self.assertEqual((ruta.read_bytes(), ruta.stat().st_mtime_ns), actualizado)
                with mock.patch("sys.stderr"), self.assertRaises(SystemExit):
                    exportar_identidad_web.main([])
                self.assertEqual((ruta.read_bytes(), ruta.stat().st_mtime_ns), actualizado)
