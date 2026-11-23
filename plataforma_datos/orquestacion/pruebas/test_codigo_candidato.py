"""Repositorios Git locales pequeños; sin descarga, hooks ni commits del producto."""

import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from plataforma_datos.orquestacion import codigo_candidato as codigo


class PruebaCodigoCandidato(unittest.TestCase):
    """La revisión fijada, no el checkout o sus atributos, determina cada byte."""

    def setUp(self) -> None:
        """Repositorio propio con nombres Unicode y recursos estáticos versionados."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.base = Path(temporal.name).resolve()
        self.repo = self.base / "Mis documentos" / "Año 2026"
        self.repo.mkdir(parents=True)
        self.destino = self.base / "código nuevo"
        self.git("init", "-q")
        self.git("config", "user.name", "Equipo Faro")
        self.git("config", "user.email", "equipo@example.test")
        self.git("config", "core.ignorecase", "false")
        self.git("config", "core.precomposeunicode", "false")
        self.archivos = {
            "src/aplicación.py": b"print('original')\n",
            "web/recursos/imagen.bin": bytes(range(256)),
            "herramientas/ejecutar": b"#!/bin/sh\nexit 0\n",
            ".dev.vars.example": b"PLANTILLA=\n",
        }
        for nombre, contenido in self.archivos.items():
            self.escribir(nombre, contenido)
        (self.repo / "herramientas/ejecutar").chmod(0o755)
        self.revision = self.commit()

    def git(self, *args: str, entrada: bytes | None = None) -> str:
        """Orden Git de fixture con entorno local mínimo.

        Returns:
            Salida UTF-8 del comando privado de la prueba.
        """
        resultado = subprocess.run(
            ["git", "-C", str(self.repo), *args],
            input=entrada,
            env={
                "PATH": os.defpath,
                "GIT_CONFIG_NOSYSTEM": "1",
                "GIT_CONFIG_GLOBAL": os.devnull,
                "GIT_CONFIG_SYSTEM": os.devnull,
            },
            capture_output=True,
            check=True,
            timeout=5,
        )
        return resultado.stdout.decode().strip()

    def escribir(self, nombre: str, contenido: bytes) -> None:
        """Escribe solo el pequeño árbol de fixture."""
        archivo = self.repo / nombre
        archivo.parent.mkdir(parents=True, exist_ok=True)
        archivo.write_bytes(contenido)

    def commit(self) -> str:
        """Fija una revisión del repositorio de prueba.

        Returns:
            SHA completo del commit local recién creado.
        """
        self.git("add", "-f", ".")
        self.git("commit", "-q", "-m", "Fixture de código")
        return self.git("rev-parse", "HEAD")

    def fallar(self, revision: str | None = None) -> None:
        """La salida y el staging no sobreviven al rechazo."""
        with self.assertRaisesRegex(codigo.CodigoInvalido, f"^{codigo.ERROR}$"):
            codigo.exportar_codigo(self.repo, self.destino, revision or self.revision)
        self.assertFalse(self.destino.exists())
        self.assertEqual(list(self.base.glob(".codigo-*")), [])

    def test_bytes_commit_fijo_no_head_ni_workingtree_y_modo(self) -> None:
        """Un commit posterior, suciedad y un secreto no versionado no se copian."""
        self.escribir("src/aplicación.py", b"otro commit\n")
        self.commit()
        self.escribir("src/aplicación.py", b"workingtree sucio\n")
        self.escribir(".dev.vars", b"NO_LEER=fixture\n")
        resumen = codigo.exportar_codigo(self.repo, self.destino, self.revision)
        self.assertEqual(
            resumen,
            {
                "version": 1,
                "revisionCodigo": self.revision,
                "archivos": len(self.archivos),
                "bytesTotales": sum(map(len, self.archivos.values())),
            },
        )
        for nombre, contenido in self.archivos.items():
            self.assertEqual((self.destino / nombre).read_bytes(), contenido)
        self.assertEqual((self.destino / "herramientas/ejecutar").stat().st_mode & 0o777, 0o755)
        self.assertFalse((self.destino / ".git").exists())
        self.assertFalse((self.destino / ".dev.vars").exists())
        self.assertEqual((self.repo / "src/aplicación.py").read_bytes(), b"workingtree sucio\n")

    def test_atributos_y_filtro_no_transforman_blob_ni_ejecutan(self) -> None:
        """export-ignore, export-subst y smudge no afectan ls-tree/cat-file."""
        marcador = self.base / "filtro-ejecutado"
        self.git("config", "filter.fixture.smudge", f"touch '{marcador}'")
        self.escribir(".gitattributes", b"*.py filter=fixture export-subst export-ignore\n")
        contenido = b"$Format:%H$\r\noriginal\x00\n"
        self.escribir("src/aplicación.py", contenido)
        revision = self.commit()
        codigo.exportar_codigo(self.repo, self.destino, revision)
        self.assertEqual((self.destino / "src/aplicación.py").read_bytes(), contenido)
        self.assertFalse(marcador.exists())

    def test_replace_y_entorno_git_no_sustituyen_commit(self) -> None:
        """Ni refs/replace ni variables heredadas eligen otro repositorio."""
        self.escribir("src/aplicación.py", b"reemplazado\n")
        otra = self.commit()
        self.git("replace", self.revision, otra)
        with mock.patch.dict(
            os.environ,
            {"GIT_DIR": "/inexistente", "GIT_WORK_TREE": "/inexistente", "GIT_CONFIG_PARAMETERS": "entrada hostil"},
        ):
            codigo.exportar_codigo(self.repo, self.destino, self.revision)
        self.assertEqual((self.destino / "src/aplicación.py").read_bytes(), self.archivos["src/aplicación.py"])

    def test_revision_exige_commit_exacto_y_no_ref_tag_tree_blob(self) -> None:
        """No acepta abreviaturas, refs, etiquetas anotadas ni objetos de otro tipo."""
        self.git("tag", "-a", "fixture", "-m", "Etiqueta fixture")
        for revision in (
            "HEAD",
            self.revision[:12],
            "A" * 40,
            "0" * 40,
            self.git("rev-parse", "HEAD^{tree}"),
            self.git("rev-parse", "fixture^{tag}"),
            self.git("rev-parse", "HEAD:web/recursos/imagen.bin"),
        ):
            with self.subTest(revision=revision):
                self.fallar(revision)

    def test_excluye_datos_var_locales_dependencias_y_conserva_web(self) -> None:
        """La composición posterior aporta datos/var y ningún estado local se extrae."""
        for nombre in (
            "datos/uno.json",
            "var/actualizacion/estado.json",
            "registro/local.json",
            "config/conexiones/perfiles/local.json",
            "node_modules/modulo/a.js",
            ".venv/bin/python",
            "src/__pycache__/x.pyc",
            ".wrangler/local",
            ".ruff_cache/local",
        ):
            self.escribir(nombre, b"excluido")
        resumen = codigo.exportar_codigo(self.repo, self.destino, self.commit())
        self.assertEqual(resumen["archivos"], len(self.archivos))
        self.assertEqual(
            {p.relative_to(self.destino).as_posix() for p in self.destino.rglob("*") if p.is_file()}, set(self.archivos)
        )

    def test_secreto_versionado_rechaza_antes_de_leer_blobs(self) -> None:
        """Un secreto comprometido no se omite silenciosamente ni se exporta."""
        for nombre in (".env.privado", "config/.dev.vars", ".npmrc"):
            self.escribir(nombre, b"sintetico-no-leer")
        revision = self.commit()
        with mock.patch.object(codigo, "_extraer") as extraer:
            self.fallar(revision)
        extraer.assert_not_called()

    def test_enlaces_y_submodulos_se_rechazan_incluso_excluidos(self) -> None:
        """El árbol debe contener solo blobs regulares; no sigue enlaces."""
        (self.repo / "datos").mkdir()
        (self.repo / "datos/enlace").symlink_to("../src/aplicación.py")
        self.fallar(self.commit())
        self.git("rm", "-q", "datos/enlace")
        self.git("update-index", "--add", "--cacheinfo", f"160000,{self.revision},submodulo")
        self.git("commit", "-q", "-m", "Submódulo fixture")
        self.fallar(self.git("rev-parse", "HEAD"))

    def test_rutas_no_portables_rechazadas(self) -> None:
        """No admite traversal, separadores ambiguos, controles ni rutas no UTF-8."""
        for nombre in (
            b"../fuera",
            b"/absoluta",
            b"uno\\dos",
            b"uno:dos",
            b"uno\ndos",
            b"no-utf8-\xff",
            b".GIT/config",
            b"REGISTRO/local",
            b".ENV",
            b"CONFIG/conexiones/perfiles/local",
        ):
            with self.subTest(nombre=nombre), self.assertRaises(codigo.CodigoInvalido):
                codigo._ruta(nombre)

    def test_colisiones_casefold_y_nfc_con_unicode_valido(self) -> None:
        """Los nombres Unicode se conservan; solo se rechazan colisiones del volumen."""
        prefijo = b"100644 blob " + b"a" * 40 + b" 1\t"
        for nombres in (("Web/uno", "web/dos"), ("año/uno", "an\u0303o/dos"), ("uno", "uno")):
            arbol = b"".join(prefijo + n.encode() + b"\0" for n in nombres)
            with self.subTest(nombres=nombres), self.assertRaises(codigo.CodigoInvalido):
                codigo._entradas(arbol)

    def test_limites_fallan_sin_salida_y_sin_temporales(self) -> None:
        """Número, tamaños, salida Git y plazo se comprueban antes de promover."""
        for constante in ("MAX_ARCHIVOS", "MAX_ARCHIVO_BYTES", "MAX_TOTAL_BYTES", "MAX_ARBOL_BYTES", "PLAZO_SEGUNDOS"):
            with self.subTest(constante=constante), mock.patch.object(codigo, constante, 0):
                self.fallar()

    def test_fallo_extraccion_rollback_y_no_toca_origen(self) -> None:
        """Incluso si ya se escribió un archivo, solo se limpia el staging propio."""

        def interrumpir(_checkout: Path, destino: Path, _entradas: list, _plazo: float) -> None:
            (destino / "parcial").write_bytes(b"parcial")
            raise OSError("fallo sintético")

        with mock.patch.object(codigo, "_extraer", side_effect=interrumpir):
            self.fallar()
        self.assertEqual((self.repo / "web/recursos/imagen.bin").read_bytes(), self.archivos["web/recursos/imagen.bin"])

    def test_destinos_existentes_enlaces_y_dentro_origen_no_se_sobrescriben(self) -> None:
        """No admite destino existente, enlace o modificación del checkout."""
        self.destino.mkdir()
        (self.destino / "propio").write_bytes(b"conservar")
        with self.assertRaises(codigo.CodigoInvalido):
            codigo.exportar_codigo(self.repo, self.destino, self.revision)
        self.assertEqual((self.destino / "propio").read_bytes(), b"conservar")
        enlace = self.base / "enlace"
        enlace.symlink_to(self.base / "inexistente", target_is_directory=True)
        for destino in (enlace, self.repo / "nuevo"):
            with self.subTest(destino=destino), self.assertRaises(codigo.CodigoInvalido):
                codigo.exportar_codigo(self.repo, destino, self.revision)
        self.assertTrue(enlace.is_symlink())

    def test_checkout_subdirectorio_no_permite_destino_dentro_raiz_real(self) -> None:
        """Git discovery no amplía la raíz permitida ni modifica el origen."""
        destino = self.repo / "candidato"
        with self.assertRaises(codigo.CodigoInvalido):
            codigo.exportar_codigo(self.repo / "src", destino, self.revision)
        self.assertFalse(destino.exists())
        self.assertEqual(list(self.repo.glob(".codigo-*")), [])

    def test_promocion_no_reemplaza_destino_que_gana_carrera(self) -> None:
        """La reserva exclusiva conserva incluso un directorio vacío de otro job."""
        extraer = codigo._extraer

        def ganar(checkout: Path, destino: Path, entradas: list, plazo: float) -> None:
            extraer(checkout, destino, entradas, plazo)
            self.destino.mkdir()

        with mock.patch.object(codigo, "_extraer", side_effect=ganar), self.assertRaises(codigo.CodigoInvalido):
            codigo.exportar_codigo(self.repo, self.destino, self.revision)
        self.assertTrue(self.destino.is_dir())
        self.assertEqual(list(self.destino.iterdir()), [])
        self.assertEqual(list(self.base.glob(".codigo-*")), [])

    def test_promocion_fallida_limpia_solo_reserva_propia_y_exige_contenido(self) -> None:
        """Un fallo al renombrar no deja destino vacío ni modifica un destino ajeno."""
        temporal = self.base / "preparado"
        temporal.mkdir()
        with self.assertRaises(codigo.CodigoInvalido):
            codigo.promover_directorio(temporal, self.destino)
        (temporal / "listo").write_bytes(b"completo")

        def fallar_tras_inspeccion(_origen: Path, destino: Path) -> None:
            os.utime(destino, ns=(1, 2))
            raise OSError("fallo sintético")

        with (
            mock.patch.object(Path, "rename", autospec=True, side_effect=fallar_tras_inspeccion),
            self.assertRaises(OSError),
        ):
            codigo.promover_directorio(temporal, self.destino)
        self.assertFalse(self.destino.exists())
        self.assertEqual((temporal / "listo").read_bytes(), b"completo")
        codigo.promover_directorio(temporal, self.destino)
        self.assertEqual((self.destino / "listo").read_bytes(), b"completo")
        self.assertFalse(temporal.exists())


if __name__ == "__main__":
    unittest.main()
