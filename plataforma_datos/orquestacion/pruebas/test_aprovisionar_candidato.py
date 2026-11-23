"""Composición real de Git local y generación sintética, sin fuentes por red ni instalación servida."""

import io
import json
import os
import subprocess
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest import mock

from plataforma_datos.comun.nucleo import ErrorFuente
from plataforma_datos.orquestacion import aprovisionar_candidato as aprovisionamiento
from plataforma_datos.orquestacion import generacion_operativa
from plataforma_datos.orquestacion.pruebas.test_generacion_operativa import preparar
from plataforma_datos.orquestacion.sustitucion import huellas_del_arbol

REVISION_GENERACION = "b" * 40
OTRA_REVISION = "c" * 40
OTRA_HUELLA = "0" * 64
CONTENIDO_CODIGO = {
    "src/aplicacion.py": b"print('codigo versionado')\n",
    "web/administracion/panel.js": b"export const version = 1;\n",
    "web/globo/mapa.json": b'{"recurso":"versionado"}\n',
}


def git(checkout: Path, *argumentos: str) -> str:
    """Ejecuta solo Git local con configuración e identidad sintéticas propias.

    Returns:
        Salida de la orden local una vez terminado y recolectado el proceso.
    """
    ambiente = {
        "PATH": os.defpath,
        "GIT_CONFIG_NOSYSTEM": "1",
        "GIT_CONFIG_GLOBAL": os.devnull,
        "GIT_TERMINAL_PROMPT": "0",
        "GIT_AUTHOR_NAME": "Equipo Faro",
        "GIT_AUTHOR_EMAIL": "equipo@example.test",
        "GIT_COMMITTER_NAME": "Equipo Faro",
        "GIT_COMMITTER_EMAIL": "equipo@example.test",
    }
    return subprocess.run(
        ["git", "-C", str(checkout), *argumentos],
        env=ambiente,
        capture_output=True,
        text=True,
        timeout=10,
        check=True,
    ).stdout.strip()


class PruebaAprovisionarCandidato(unittest.TestCase):
    """Solo se publica un árbol compuesto nuevo; las expectativas se capturan por separado."""

    def setUp(self) -> None:
        """Código y generación independientes en rutas con espacios y Unicode."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.temporal = Path(temporal.name).resolve()
        self.checkout = self.temporal / "Código autorizado Año 2026"
        self.checkout.mkdir()
        git(self.checkout, "init", "-q")
        for relativa, contenido in CONTENIDO_CODIGO.items():
            ruta = self.checkout / relativa
            ruta.parent.mkdir(parents=True, exist_ok=True)
            ruta.write_bytes(contenido)
        for relativa in ("datos/obsoleto.json", "var/antiguo.txt"):
            ruta = self.checkout / relativa
            ruta.parent.mkdir(parents=True, exist_ok=True)
            ruta.write_bytes(b"no mezclar con la generacion")
        git(self.checkout, "add", ".")
        git(self.checkout, "commit", "-qm", "Fixture local")
        self.revision = git(self.checkout, "rev-parse", "HEAD")
        (self.checkout / "src/aplicacion.py").write_bytes(b"workingtree distinto que no se ejecuta")
        (self.checkout / "registro").mkdir()
        (self.checkout / "registro/credenciales.sqlite").write_bytes(b"conservar local sin copiar")
        self.origen = self.temporal / "Instalación conservada"
        preparar(self.origen)
        self.generacion = self.temporal / "Generación privada"
        self.resumen_generacion = generacion_operativa.exportar_generacion(
            self.origen, self.generacion, REVISION_GENERACION
        )
        self.huella = self.resumen_generacion["sha256Manifiesto"]
        self.destino = self.temporal / "Candidato nuevo"

    def aprovisionar(self, **cambios: object) -> dict:
        """Invoca el contrato privado con expectativas conocidas en la fixture.

        Returns:
            Resumen cerrado de la composición completa.
        """
        argumentos = {
            "checkout": self.checkout,
            "destino_nuevo": self.destino,
            "revision_codigo": self.revision,
            "generacion": self.generacion,
            "revision_generacion": REVISION_GENERACION,
            "sha256_generacion": self.huella,
        }
        return aprovisionamiento.aprovisionar_candidato(**(argumentos | cambios))

    def argumentos_cli(self) -> list[str]:
        """Opciones privadas explícitas de la CLI.

        Returns:
            Argumentos con ambas revisiones y la huella esperada.
        """
        return [
            str(self.checkout),
            str(self.destino),
            "--revision-codigo",
            self.revision,
            "--generacion",
            str(self.generacion),
            "--revision-generacion",
            REVISION_GENERACION,
            "--sha256-generacion",
            self.huella,
        ]

    def test_nominal_bytes_exactos_revisiones_distintas_y_origenes_intactos(self) -> None:
        """El candidato usa el commit y la generación autorizados, sin workingtree ni credenciales."""
        antes = {ruta: huellas_del_arbol(ruta) for ruta in (self.checkout, self.generacion, self.origen)}
        resumen = self.aprovisionar()
        self.assertNotEqual(self.revision, REVISION_GENERACION)
        self.assertEqual(set(resumen), {"version", "codigo", "generacion"})
        self.assertEqual(resumen["version"], 1)
        self.assertEqual(
            resumen["codigo"],
            {
                "version": 1,
                "revisionCodigo": self.revision,
                "archivos": len(CONTENIDO_CODIGO),
                "bytesTotales": sum(len(contenido) for contenido in CONTENIDO_CODIGO.values()),
            },
        )
        self.assertEqual(resumen["generacion"], self.resumen_generacion)
        for relativa, contenido in CONTENIDO_CODIGO.items():
            self.assertEqual((self.destino / relativa).read_bytes(), contenido)
        manifiesto = json.loads((self.generacion / "manifiesto.json").read_text())
        for registro in manifiesto["archivos"]:
            self.assertEqual(
                (self.destino / registro["ruta"]).read_bytes(),
                (self.generacion / "contenido" / registro["ruta"]).read_bytes(),
            )
        for relativa in ("datos/obsoleto.json", "var/antiguo.txt", ".git", "registro"):
            self.assertFalse((self.destino / relativa).exists())
        for raiz, huellas in antes.items():
            self.assertEqual(huellas_del_arbol(raiz), huellas)
        self.assertNotIn(str(self.temporal), json.dumps(resumen))

    def test_expectativas_obligatorias_no_se_derivan_del_manifiesto(self) -> None:
        """Código y generación se verifican contra argumentos privados completos y separados."""
        for cambio in (
            {"revision_codigo": OTRA_REVISION},
            {"revision_generacion": OTRA_REVISION},
            {"sha256_generacion": OTRA_HUELLA},
            {"revision_codigo": "main"},
            {"revision_generacion": ""},
            {"sha256_generacion": ""},
        ):
            with self.subTest(cambio=cambio):
                antes = set(self.temporal.iterdir())
                with self.assertRaises((OSError, ValueError, ErrorFuente)):
                    self.aprovisionar(**cambio)
                self.assertFalse(self.destino.exists())
                self.assertEqual(set(self.temporal.iterdir()), antes)

    def test_generacion_corrupta_no_publica_codigo_aislado(self) -> None:
        """Los fallos de integridad después de exportar el código retiran solo el staging propio."""
        (self.generacion / "contenido/datos/uno.json").write_bytes(b"alterado")
        antes = set(self.temporal.iterdir())
        with self.assertRaises((ValueError, ErrorFuente)):
            self.aprovisionar()
        self.assertFalse(self.destino.exists())
        self.assertEqual(set(self.temporal.iterdir()), antes)

    def test_fallo_o_interrupcion_restaurando_no_deja_destino_ni_staging(self) -> None:
        """Ningún error o interrupción concede una raíz candidata parcial."""
        antes = set(self.temporal.iterdir())
        for error in (OSError("fallo privado"), KeyboardInterrupt()):
            with self.subTest(error=type(error).__name__):
                with (
                    mock.patch.object(aprovisionamiento, "restaurar_base_candidata", side_effect=error),
                    self.assertRaises(type(error)),
                ):
                    self.aprovisionar()
                self.assertFalse(self.destino.exists())
                self.assertEqual(set(self.temporal.iterdir()), antes)

    def test_fallo_integrando_segundo_arbol_no_publica_primero(self) -> None:
        """Una integración cortada tras datos/ se conserva fuera del destino final y se limpia."""
        real = Path.rename

        def fallar(ruta: Path, destino: Path) -> Path:
            if ruta.parent.name == "operativos" and ruta.name == "var":
                raise OSError("fallo privado")
            return real(ruta, destino)

        antes = set(self.temporal.iterdir())
        with mock.patch.object(Path, "rename", new=fallar), self.assertRaises(OSError):
            self.aprovisionar()
        self.assertFalse(self.destino.exists())
        self.assertEqual(set(self.temporal.iterdir()), antes)

    def test_colision_de_arbol_o_entrada_operativa_ajena_rechaza_composicion(self) -> None:
        """Aunque un helper incumpla su contrato, no se mezclan árboles o raíces inesperadas."""
        real = aprovisionamiento.restaurar_base_candidata

        def colision(*args: object) -> dict:
            resumen = real(*args)
            operativos = args[1]
            if defecto == "colision":
                (operativos.parent / "codigo/datos").mkdir()
            else:
                (operativos / "no-declarado").write_bytes(b"no mezclar")
            return resumen

        antes = set(self.temporal.iterdir())
        for defecto in ("colision", "extra"):
            with self.subTest(defecto=defecto):
                with (
                    mock.patch.object(aprovisionamiento, "restaurar_base_candidata", side_effect=colision),
                    self.assertRaises(ValueError),
                ):
                    self.aprovisionar()
                self.assertEqual(set(self.temporal.iterdir()), antes)

    def test_destino_creado_durante_composicion_no_se_sobrescribe_ni_borra(self) -> None:
        """La reserva exclusiva final rechaza incluso un directorio ajeno vacío recién creado."""
        real = aprovisionamiento.promover_directorio

        def ocupado(temporal: Path, destino: Path) -> None:
            destino.mkdir()
            real(temporal, destino)

        with (
            mock.patch.object(aprovisionamiento, "promover_directorio", side_effect=ocupado),
            self.assertRaises((OSError, ValueError)),
        ):
            self.aprovisionar()
        self.assertTrue(self.destino.is_dir())
        self.assertEqual(list(self.destino.iterdir()), [])
        self.assertFalse(any(r.name.startswith(".aprovisionando-") for r in self.temporal.iterdir()))

    def test_destinos_existentes_y_solapados_rechazan_antes_de_exportar(self) -> None:
        """No hay merge ni modificación del checkout, generación o destino ajeno."""
        self.destino.mkdir()
        (self.destino / "conservar").write_bytes(b"intacto")
        antes = huellas_del_arbol(self.temporal)
        for destino in (
            self.destino,
            self.checkout,
            self.checkout / "interno",
            self.generacion / "interno",
            self.temporal,
        ):
            with self.subTest(destino=destino):
                with mock.patch.object(aprovisionamiento, "exportar_codigo") as exportar, self.assertRaises(ValueError):
                    self.aprovisionar(destino_nuevo=destino)
                exportar.assert_not_called()
        self.assertEqual(huellas_del_arbol(self.temporal), antes)

    def test_enlaces_en_origen_destino_y_padre_no_se_siguen(self) -> None:
        """Ni un enlace colgante ni aliases de los árboles reciben una composición."""
        enlace = self.temporal / "enlace"
        enlace.symlink_to(self.checkout, target_is_directory=True)
        casos = (
            {"checkout": enlace},
            {"generacion": enlace},
            {"destino_nuevo": enlace},
            {"destino_nuevo": enlace / "interno"},
        )
        for cambio in casos:
            with self.subTest(cambio=cambio), self.assertRaises(ValueError):
                self.aprovisionar(**cambio)
        enlace.unlink()
        enlace.symlink_to(self.temporal / "ausente", target_is_directory=True)
        with self.assertRaises(ValueError):
            self.aprovisionar(destino_nuevo=enlace)
        self.assertTrue(enlace.is_symlink())
        self.assertFalse(self.destino.exists())

    def test_padre_ausente_y_fallo_promocion_no_dejan_destino(self) -> None:
        """Solo el padre privado ya existente permite staging y una promoción fallida no lo filtra."""
        with self.assertRaises(OSError):
            self.aprovisionar(destino_nuevo=self.temporal / "ausente/candidato")
        antes = set(self.temporal.iterdir())
        with (
            mock.patch.object(aprovisionamiento, "promover_directorio", side_effect=OSError("fallo privado")),
            self.assertRaises(OSError),
        ):
            self.aprovisionar()
        self.assertEqual(set(self.temporal.iterdir()), antes)

    def test_cli_recibo_cerrado_y_error_integridad_generico_sin_rutas(self) -> None:
        """El error esperado no produce traceback, diagnóstico interno ni resumen de éxito."""
        with redirect_stdout(io.StringIO()) as salida, redirect_stderr(io.StringIO()) as errores:
            codigo = aprovisionamiento.main(self.argumentos_cli())
        self.assertEqual(codigo, 0)
        self.assertEqual(json.loads(salida.getvalue())["generacion"], self.resumen_generacion)
        self.assertEqual(errores.getvalue(), "")
        (self.generacion / "contenido/datos/uno.json").write_bytes(b"alterado")
        self.destino = self.temporal / "Otro candidato"
        with redirect_stdout(io.StringIO()) as salida, redirect_stderr(io.StringIO()) as errores:
            codigo = aprovisionamiento.main(self.argumentos_cli())
        self.assertEqual(codigo, 1)
        self.assertEqual(salida.getvalue(), "")
        self.assertEqual(errores.getvalue(), aprovisionamiento.ERROR_GENERICO + "\n")
        self.assertFalse(self.destino.exists())


if __name__ == "__main__":
    unittest.main()
