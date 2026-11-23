"""Comprueba el paquete desde una copia y un cwd ajeno con espacios y Unicode."""

import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from plataforma_datos.cursos.pruebas.test_catalogo import lote_base


class PortabilidadPruebas(unittest.TestCase):
    """Ejecuta módulos sin depender del cwd o la carpeta del repositorio original."""

    def setUp(self) -> None:
        """Copia solo el paquete en una ubicación temporal independiente."""
        temporal = tempfile.TemporaryDirectory(prefix="Cursos · ámbito ñ ")
        self.addCleanup(temporal.cleanup)
        self.raiz = Path(temporal.name)
        self.copia = self.raiz / "Paquete con espacios Á"
        origen = Path(__file__).resolve().parents[2]
        shutil.copytree(origen, self.copia / "plataforma_datos", ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
        self.cwd = self.raiz / "Carpeta externa ñ"
        self.cwd.mkdir()
        self.entorno = {
            "PYTHONPATH": str(self.copia),
            "PYTHONUTF8": "1",
            "PYTHONDONTWRITEBYTECODE": "1",
            "TMPDIR": str(self.raiz),
        }

    def _ejecutar(self, argumentos: list[str]) -> subprocess.CompletedProcess[str]:
        """Ejecuta Python con la copia en su ruta normal de módulos.

        Returns:
            Salida y estado de la ejecución comprobada.
        """
        return subprocess.run(
            [sys.executable, *argumentos],
            cwd=self.cwd,
            env=self.entorno,
            check=True,
            capture_output=True,
            text=True,
            timeout=30,
        )

    def test_importacion_y_registro_sin_cwd_original(self) -> None:
        """Resuelve el registro, los cuatro adaptadores y los dos lectores puros."""
        codigo = (
            "from plataforma_datos.cursos.contrato_aprendizaje import cargar_registro; "
            "from plataforma_datos.cursos import catalogo, contrato_fichas, vigencia; "
            "from plataforma_datos.cursos.fuentes.fundae import digitalizate; "
            "from plataforma_datos.cursos.fuentes.barcelonactiva import robot_cibernarium; "
            "from plataforma_datos.cursos.herramientas import normalizar_investigacion; "
            "from plataforma_datos.cursos.fuentes.hp_life import lector as hp_life; "
            "from plataforma_datos.cursos.fuentes.claude_academy import lector as claude_academy; "
            "print(cargar_registro()[1])"
        )
        resultado = self._ejecutar(["-c", codigo])
        registro = self.copia / "plataforma_datos" / "cursos" / "esquemas" / "registro_aprendizaje.json"
        self.assertEqual(resultado.stdout.strip(), hashlib.sha256(registro.read_bytes()).hexdigest())

    def test_ayuda_de_cada_cli_por_modulo(self) -> None:
        """Las cinco entradas CLI funcionan sin usar red ni una captura externa."""
        modulos = [
            "plataforma_datos.cursos.catalogo",
            "plataforma_datos.cursos.fuentes.fundae.digitalizate",
            "plataforma_datos.cursos.herramientas.normalizar_investigacion",
            "plataforma_datos.cursos.fuentes.barcelonactiva.robot_cibernarium",
        ]
        for modulo in modulos:
            with self.subTest(modulo=modulo):
                self.assertIn("usage:", self._ejecutar(["-m", modulo, "--help"]).stdout)

    def test_cli_importa_y_consulta_solo_una_base_temporal(self) -> None:
        """Ejercita importación y consulta con rutas externas que contienen espacios."""
        lote = lote_base()
        entrada = self.raiz / "Lote sintético ñ.json"
        entrada.write_text(json.dumps(lote, ensure_ascii=False), encoding="utf-8")
        base = self.raiz / "Catálogo independiente.sqlite3"
        modulo = "plataforma_datos.cursos.catalogo"
        carga = self._ejecutar(["-m", modulo, "importar", "--base", str(base), "--entrada", str(entrada)])
        self.assertEqual(json.loads(carga.stdout)["programas_observados"], len(lote["programas"]))
        consulta = self._ejecutar(["-m", modulo, "buscar", "--base", str(base), "--texto", "Python"])
        self.assertEqual(json.loads(consulta.stdout)[0]["titulo"], lote["programas"][0]["titulo"])
        resumen = self._ejecutar(["-m", modulo, "resumen", "--base", str(base)])
        self.assertEqual(json.loads(resumen.stdout)["ediciones"], len(lote["ediciones"]))
