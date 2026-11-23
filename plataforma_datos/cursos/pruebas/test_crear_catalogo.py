"""Primera creación V10: equivalencia, repetición y cortes, sin capturas ni red."""

import hashlib
import json
import os
import sqlite3
import stat
import subprocess
import sys
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

from plataforma_datos.cursos import catalogo, crear_catalogo, unidades_vigencia
from plataforma_datos.cursos.pruebas.test_catalogo import lote_base

VERSION_ACTUAL = 10
# Esquema que producía la última cadena de migraciones V1→V10, congelado al retirarla.
ESQUEMA_REFERENCIA = Path(__file__).with_name("esquema_v10_referencia.json")
CODIGO_CORTE = 19


class CrearCatalogoPruebas(unittest.TestCase):
    """Cada prueba tiene bases privadas; nunca escribe el estado operativo."""

    def setUp(self) -> None:
        """Prepara una carpeta temporal con espacios y Unicode."""
        temporal = tempfile.TemporaryDirectory(prefix="creación catálogo ñ ")
        self.addCleanup(temporal.cleanup)
        self.raiz = Path(temporal.name)
        self.base = self.raiz / "nueva.sqlite3"

    def test_creacion_directa_equivale_al_esquema_de_referencia_sin_fabricar_filas(self) -> None:
        """Nace V10 vacía con exactamente los objetos SQL de la referencia congelada."""
        resultado = crear_catalogo.crear(self.base)
        self.assertTrue(resultado["creada"])
        self.assertEqual(resultado["version"], VERSION_ACTUAL)
        self.assertTrue(all(n == 0 for n in resultado["recuentos"].values()))

        def normalizar(sql: str) -> list[str]:
            return unidades_vigencia.TOKENS_SQL.findall(sql.strip().rstrip(";"))

        referencia = json.loads(ESQUEMA_REFERENCIA.read_text(encoding="utf-8"))
        esperados = [(tipo, nombre, normalizar(sql)) for tipo, nombre, sql in referencia]
        with closing(sqlite3.connect(self.base)) as nueva:
            consulta = "SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type,name"
            actuales = [(tipo, nombre, normalizar(sql)) for tipo, nombre, sql in nueva.execute(consulta)]
            self.assertEqual(nueva.execute("PRAGMA user_version").fetchone()[0], VERSION_ACTUAL)
        self.assertEqual(actuales, esperados)

    def test_repeticion_conserva_negocio_y_fechas_sin_escritura(self) -> None:
        """La fábrica no vacía una base ya creada ni rejuvenece archivos."""
        crear_catalogo.crear(self.base)
        catalogo.cargar_lote(self.base, lote_base())
        antes = self.base.read_bytes(), self.base.stat().st_mtime_ns
        self.assertFalse(crear_catalogo.crear(self.base)["creada"])
        self.assertEqual((self.base.read_bytes(), self.base.stat().st_mtime_ns), antes)
        self.assertEqual(catalogo.resumen(self.base)["programas"], 1)

    def test_una_base_que_no_es_v10_no_se_migra_ni_sustituye(self) -> None:
        """Una SQLite de otra versión se rechaza intacta; nunca se convierte ni se reemplaza."""
        for version in (1, 9):
            with self.subTest(version=version):
                base = self.raiz / f"anterior-{version}.sqlite3"
                with closing(sqlite3.connect(base)) as conexion:
                    conexion.execute("CREATE TABLE programas (id TEXT PRIMARY KEY)")
                    conexion.execute(f"PRAGMA user_version={version}")
                    conexion.commit()
                antes = hashlib.sha256(base.read_bytes()).hexdigest()
                with self.assertRaisesRegex(ValueError, "exige V10"):
                    crear_catalogo.crear(base)
                self.assertEqual(hashlib.sha256(base.read_bytes()).hexdigest(), antes)

    def test_fallo_durante_ddl_no_publica_base_parcial_y_reintento_funciona(self) -> None:
        """La escritura incompleta queda fuera del destino y se limpia su intento."""
        ejecutar = catalogo.ejecutar_esquema

        def cortar(conexion: sqlite3.Connection, esquema: str) -> None:
            conexion.execute("CREATE TABLE parcial (id INTEGER)")
            raise KeyboardInterrupt("Corte sintético")

        with (
            patch.object(catalogo, "ejecutar_esquema", side_effect=cortar),
            self.assertRaises(KeyboardInterrupt),
        ):
            crear_catalogo.crear(self.base)
        self.assertFalse(self.base.exists())
        self.assertEqual(list(self.raiz.iterdir()), [])
        with patch.object(catalogo, "ejecutar_esquema", wraps=ejecutar):
            self.assertTrue(crear_catalogo.crear(self.base)["creada"])

    def test_un_destino_ajeno_aparecido_durante_creacion_no_se_sobrescribe(self) -> None:
        """La promoción exclusiva conserva incluso un archivo inesperado."""
        real = crear_catalogo._crear

        def interferir(candidata: Path) -> None:
            real(candidata)
            self.base.write_bytes(b"archivo ajeno")

        with patch.object(crear_catalogo, "_crear", side_effect=interferir), self.assertRaises(ValueError):
            crear_catalogo.crear(self.base)
        self.assertEqual(self.base.read_bytes(), b"archivo ajeno")

    def test_corte_no_capturable_conserva_intento_privado_sin_publicar(self) -> None:
        """Un proceso cortado tras escribir no ocupa el nombre operativo."""
        codigo = """
import os, sys
from plataforma_datos.cursos import crear_catalogo
real = crear_catalogo._crear
def cortar(candidata):
    real(candidata)
    os._exit(19)
crear_catalogo._crear = cortar
crear_catalogo.crear(sys.argv[1])
"""
        resultado = subprocess.run([sys.executable, "-B", "-c", codigo, str(self.base)], check=False)
        self.assertEqual(resultado.returncode, CODIGO_CORTE)
        self.assertFalse(self.base.exists())
        intentos = list(self.raiz.glob(".crear-catalogo-*"))
        self.assertEqual(len(intentos), 1)
        conservado = (intentos[0] / "catalogo.sqlite3").read_bytes()
        self.assertTrue(crear_catalogo.crear(self.base)["creada"])
        self.assertEqual((intentos[0] / "catalogo.sqlite3").read_bytes(), conservado)

    def test_corte_despues_de_enlazar_recupera_solo_su_candidata(self) -> None:
        """El enlace definitivo no queda inutilizado por el alias temporal propio."""
        codigo = """
import os, sys
from pathlib import Path
from plataforma_datos.cursos import crear_catalogo
real = Path.hardlink_to
def cortar(self, otra):
    real(self, otra)
    os._exit(19)
Path.hardlink_to = cortar
crear_catalogo.crear(sys.argv[1])
"""
        resultado = subprocess.run([sys.executable, "-B", "-c", codigo, str(self.base)], check=False)
        self.assertEqual(resultado.returncode, CODIGO_CORTE)
        self.assertEqual(self.base.stat().st_nlink, 2)
        antes = self.base.read_bytes(), self.base.stat().st_mtime_ns
        alias = self.raiz / "alias ajeno tras corte.sqlite3"
        alias.hardlink_to(self.base)
        intentos = list(self.raiz.glob(".crear-catalogo-*"))
        with self.assertRaisesRegex(ValueError, "alias ajeno"):
            crear_catalogo.crear(self.base)
        self.assertEqual(alias.read_bytes(), antes[0])
        self.assertTrue(all(p.exists() for p in intentos))
        alias.unlink()  # Solo la prueba retira el alias que acaba de crear.
        self.assertFalse(crear_catalogo.crear(self.base)["creada"])
        self.assertEqual(self.base.stat().st_nlink, 1)
        self.assertEqual((self.base.read_bytes(), self.base.stat().st_mtime_ns), antes)
        self.assertEqual(list(self.raiz.glob(".crear-catalogo-*")), [])

    def test_alias_ajeno_impide_recuperar_sin_borrarlo(self) -> None:
        """Una V10 válida con hardlink ajeno sigue rechazada y ambos nombres intactos."""
        crear_catalogo.crear(self.base)
        ajena = self.raiz / "alias ajeno.sqlite3"
        ajena.hardlink_to(self.base)
        antes = self.base.read_bytes()
        with self.assertRaisesRegex(ValueError, "alias ajeno"):
            crear_catalogo.crear(self.base)
        self.assertEqual(ajena.read_bytes(), antes)
        self.assertEqual(self.base.stat().st_nlink, 2)

    def test_directorio_persiste_enlace_antes_de_retirar_candidata(self) -> None:
        """La entrada final se sincroniza antes de perder su otro nombre durable."""
        eventos = []
        sincronizar, enlazar, retirar = os.fsync, Path.hardlink_to, Path.unlink
        raiz_ino = self.raiz.stat().st_ino

        def fsync(fd: int) -> None:
            dato = os.fstat(fd)
            eventos.append(("directorio" if stat.S_ISDIR(dato.st_mode) else "archivo", dato.st_ino))
            sincronizar(fd)

        def link(ruta: Path, otra: Path) -> None:
            enlazar(ruta, otra)
            eventos.append(("enlace", 0))

        def unlink(ruta: Path, *, missing_ok: bool = False) -> None:
            if ruta.name == "catalogo.sqlite3":
                eventos.append(("retirar candidata", 0))
            retirar(ruta, missing_ok=missing_ok)

        with (
            patch.object(os, "fsync", side_effect=fsync),
            patch.object(Path, "hardlink_to", link),
            patch.object(Path, "unlink", unlink),
        ):
            crear_catalogo.crear(self.base)
        enlace = eventos.index(("enlace", 0))
        retirada = eventos.index(("retirar candidata", 0))
        self.assertTrue(any(tipo == "archivo" for tipo, _ in eventos[:enlace]))
        self.assertIn(("directorio", raiz_ino), eventos[:enlace])
        self.assertIn(("directorio", raiz_ino), eventos[enlace + 1 : retirada])
        self.assertEqual(eventos[-1], ("directorio", raiz_ino))

    def test_no_admite_enlaces(self) -> None:
        """La repetición no sigue enlaces hacia otra base."""
        otra = self.raiz / "otra.sqlite3"
        crear_catalogo.crear(otra)
        self.base.symlink_to(otra)
        with self.assertRaisesRegex(ValueError, "enlaces"):
            crear_catalogo.crear(self.base)


if __name__ == "__main__":
    unittest.main()
