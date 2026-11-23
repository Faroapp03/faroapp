"""Una autoridad de versión completa para verificador, bootstrap y carpetas entregadas."""

import shutil
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from plataforma_datos.comun import entorno_python as entorno
from plataforma_datos.comun.pruebas.hijo_aislado import orden_de_guion_sin_red


class PruebaVersionPython(unittest.TestCase):
    """El parche mínimo no admite otra rama ni una prepublicación aunque su número sea mayor."""

    def test_contrato_y_runtime_reales(self) -> None:
        """El pin completo está vigente y el intérprete real cumple ese contrato."""
        self.assertEqual(entorno.version_minima(), (3, 12, 15))
        self.assertEqual(entorno.comprobar_python(), "3.12")

    def test_mismo_minimo_y_parches_posteriores_de_la_rama(self) -> None:
        """El mínimo no se convierte en un pin de parche exacto para ejecutar el producto."""
        for parche in (15, 16, 99):
            with patch.object(entorno.sys, "version_info", (3, 12, parche, "final", 0)):
                self.assertEqual(entorno.comprobar_python(), "3.12")

    def test_parches_anteriores_otras_ramas_y_prepublicaciones_fallan(self) -> None:
        """Ningún runtime fuera de la rama y el mínimo finales queda admitido."""
        for version in (
            (3, 12, 0, "final", 0),
            (3, 12, 14, "final", 0),
            (3, 11, 99, "final", 0),
            (3, 13, 0, "final", 0),
            (3, 14, 0, "final", 0),
            (3, 12, 15, "candidate", 1),
            (3, 12, 16, "alpha", 1),
        ):
            with (
                self.subTest(version=version),
                patch.object(entorno.sys, "version_info", version),
                self.assertRaisesRegex(entorno.ErrorVersionPython, "Se requiere Python 3.12 desde 3.12.15"),
            ):
                entorno.comprobar_python()

    def test_contrato_ausente_incompleto_o_no_canonico_no_admite_runtime(self) -> None:
        """Una configuración no acreditada no se reemplaza por un mínimo implícito."""
        with tempfile.TemporaryDirectory() as nombre:
            ruta = Path(nombre) / ".python-version"
            for contenido in (
                None,
                b"3.12\n",
                b"3.12.15rc1\n",
                b"03.12.15\n",
                b" 3.12.15\n",
                b"3.12.15\n\n",
                b"\xff",
                b"3" * 65,
            ):
                with self.subTest(contenido=contenido):
                    if contenido is not None:
                        ruta.write_bytes(contenido)
                    with patch.object(entorno, "ARCHIVO_VERSION", ruta), self.assertRaises(entorno.ErrorVersionPython):
                        entorno.comprobar_python()

    def test_helper_y_contrato_viajan_juntos_en_instalacion_minima(self) -> None:
        """La copia sin Git ni dependencias funciona desde otra carpeta con -I."""
        with tempfile.TemporaryDirectory() as nombre:
            base = Path(nombre)
            instalacion = base / "Mis documentos" / "Año 2026"
            helper = instalacion / "plataforma_datos/comun/entorno_python.py"
            helper.parent.mkdir(parents=True)
            shutil.copyfile(Path(entorno.__file__), helper)
            contrato = instalacion / ".python-version"
            shutil.copyfile(entorno.ARCHIVO_VERSION, contrato)
            ajena = base / "cwd ajeno"
            ajena.mkdir()
            for existe, codigo in ((True, 0), (False, 1)):
                if not existe:
                    contrato.unlink()
                resultado = subprocess.run(
                    # Como `python -I -B helper`, con la guardia de red puesta antes (PYTHONPATH no llega).
                    orden_de_guion_sin_red(sys.executable, helper),
                    cwd=ajena,
                    capture_output=True,
                    text=True,
                    timeout=5,
                    check=False,
                )
                self.assertEqual(resultado.returncode, codigo, resultado.stderr)
                if existe:
                    self.assertIn("con FTS5 operativo", resultado.stdout)
                else:
                    self.assertIn("contrato de versión", resultado.stderr)
            self.assertEqual(list(ajena.iterdir()), [])


class PruebaSQLite(unittest.TestCase):
    """El mínimo y la búsqueda se verifican en el mismo motor que usará el catálogo."""

    def test_version_informada_por_sql_y_busqueda_real(self) -> None:
        """El resultado depende de la versión consultada y admite nuevos parches o ramas."""
        for version, admitida in (
            ("3.9.9", False),
            ("3.53.99", False),
            ("3.54.0", False),
            ("3.54.1", True),
            ("3.54.1.1", True),
            ("3.54.10", True),
            ("3.55.0", True),
        ):
            conexion = sqlite3.connect(":memory:")
            conexion.create_function("sqlite_version", 0, lambda v=version: v)
            with self.subTest(version=version), patch.object(sqlite3, "connect", return_value=conexion):
                if admitida:
                    self.assertEqual(entorno.comprobar_sqlite(), version)
                else:
                    with self.assertRaisesRegex(entorno.ErrorSQLite, "Se requiere SQLite 3.54.1 o posterior"):
                        entorno.comprobar_sqlite()

    def test_el_minimo_sin_el_modulo_fts5_falla(self) -> None:
        """Reproduce la respuesta de un SQLite compatible compilado sin FTS5."""
        conexion = sqlite3.connect(":memory:")
        conexion.create_function("sqlite_version", 0, lambda: "3.54.1")
        sin_fts5 = Mock(wraps=conexion)

        def ejecutar(sql: str) -> sqlite3.Cursor:
            if sql.startswith("CREATE VIRTUAL TABLE"):
                self.assertIn("USING fts5(", sql)
                raise sqlite3.OperationalError("no such module: fts5")
            return conexion.execute(sql)

        sin_fts5.execute.side_effect = ejecutar
        with (
            patch.object(sqlite3, "connect", return_value=sin_fts5),
            self.assertRaisesRegex(entorno.ErrorSQLite, "FTS5 operativa") as fallo,
        ):
            entorno.comprobar_sqlite()
        self.assertEqual(str(fallo.exception.__cause__), "no such module: fts5")

    def test_crear_el_indice_sin_poder_buscar_tampoco_basta(self) -> None:
        """El índice se crea e indexa de verdad, pero SQLite deniega el uso de MATCH."""
        conexion = sqlite3.connect(":memory:")
        conexion.create_function("sqlite_version", 0, lambda: "3.54.1")
        conexion.set_authorizer(
            lambda accion, _objeto, funcion, _bd, _origen: (
                sqlite3.SQLITE_DENY if accion == sqlite3.SQLITE_FUNCTION and funcion == "match" else sqlite3.SQLITE_OK
            )
        )
        with (
            patch.object(sqlite3, "connect", return_value=conexion),
            self.assertRaisesRegex(entorno.ErrorSQLite, "FTS5 operativa"),
        ):
            entorno.comprobar_sqlite()


if __name__ == "__main__":
    unittest.main()
