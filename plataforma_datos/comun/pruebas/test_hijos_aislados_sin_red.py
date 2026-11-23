"""Un intérprete hijo lanzado con `-I` ignora `PYTHONPATH` y, con él, la guardia de red heredada.

Cada `-I` del producto y de sus pruebas figura aquí con lo que impide que ese hijo salga a la red: o se pone la
guardia él mismo (`hijo_aislado.py`), o no ejecuta código capaz de abrir red, y eso se comprueba en sus importaciones.
"""

import ast
import json
import os
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from plataforma_datos.comun.pruebas.hijo_aislado import CARPETA_GUARDIA, codigo_sin_red, orden_de_guion_sin_red

RAIZ = Path(__file__).resolve().parents[3]
PLAZO = 30
# Una conexión a una dirección de documentación (TEST-NET-1): la guardia la corta antes de enviar nada.
INTENTO = (
    "import socket, sys\n"
    "try:\n"
    "    socket.create_connection(('192.0.2.10', 443), timeout=1)\n"
    "    print('salio')\n"
    "except Exception as error:\n"
    "    print(type(error).__name__)\n"
)
GUARDIA_PUESTA = "import socket\nprint(bool(getattr(socket, '_faro_guardia_red', False)))\n"

# Archivos que lanzan un hijo con -I y la marca que acredita que ese hijo se pone la guardia.
CON_GUARDIA = {
    "plataforma_datos/comun/pruebas/hijo_aislado.py": "PROLOGO_SIN_RED",
    "plataforma_datos/orquestacion/pruebas/test_rutas.py": "codigo_sin_red(",
    "pruebas/herramientas/verificar.test.ts": "${GUARDIA_RED_HIJO_AISLADO}",
}
# Archivos con -I cuyo hijo no necesita la guardia, con el motivo.
SIN_GUARDIA = {
    "herramientas/mantenimiento/comprobar-sqlite-linux.py": (
        "Producto: el hijo ejecuta entorno_python.py con su biblioteca local y consulta SQLite en memoria."
    ),
    "plataforma_datos/comun/pruebas/test_guardia_red_pruebas.py": (
        "La sonda corre con -I a propósito y ejecuta el lanzador real, que le pone la guardia antes de las pruebas."
    ),
    "plataforma_datos/comun/pruebas/test_hijos_aislados_sin_red.py": (
        "Esta prueba: sus hijos -I llevan la guardia o, los de control, solo miran si está puesta, sin conectar."
    ),
    "plataforma_datos/orquestacion/pruebas/test_preparar_dependencias.py": (
        "Solo comprueba que la orden lleva -I: `ejecutar_con_plazo` está sustituido y no se lanza ningún hijo."
    ),
    "plataforma_datos/orquestacion/preparar_dependencias.py": (
        "Producto: venv, pip con ruedas locales y sondas de entorno y TLS. Las pruebas capturan sus órdenes."
    ),
    "plataforma_datos/biblioteca/fuentes/enlaces_lecturas/pdf.py": (
        "Producto: el extractor lee el PDF por la entrada estándar y escribe JSON; sus importaciones, abajo."
    ),
    "pruebas/herramientas/fixture-sqlite-runner.ts": (
        "Un hijo imprime la URL fijada con fuente-sqlite.py y el otro escribe un ZIP local con zipfile y sys."
    ),
    "pruebas/herramientas/workflow-mantenimiento.test.ts": (
        "Solo compara el argumento del intérprete con el registro del runner simulado."
    ),
    "scripts/verificar.ts": "Producto: comprueba la versión con entorno_python.py; sus importaciones, abajo.",
}
# Hijos del producto que las pruebas ejercen sin guardia: solo pueden importar esto, nada capaz de abrir red.
IMPORTACIONES_PERMITIDAS = {
    "herramientas/mantenimiento/fuente-sqlite.py": {
        "argparse",
        "hashlib",
        "io",
        "pathlib",
        "shutil",
        "sys",
        "tempfile",
        "zipfile",
    },
    "plataforma_datos/biblioteca/fuentes/enlaces_lecturas/pdf.py": {
        "hashlib",
        "io",
        "json",
        "pathlib",
        "pypdf",
        "resource",
        "subprocess",
        "sys",
        "tempfile",
        "time",
        "typing",
    },
    "plataforma_datos/comun/entorno_python.py": {"contextlib", "pathlib", "re", "sqlite3", "sys"},
}
ARGUMENTO_AISLADO = re.compile(r"""["']-I["']""")
CARPETAS = ("plataforma_datos", "pruebas", "scripts", "herramientas", "src", "compartido", "motores")


def lanzar(orden: list[str], entorno: dict[str, str] | None = None) -> str:
    """Ejecuta un intérprete hijo y devuelve su última línea.

    Returns:
        Lo último que escribió el hijo por la salida estándar.
    """
    resultado = subprocess.run(orden, capture_output=True, text=True, timeout=PLAZO, check=True, env=entorno)
    return resultado.stdout.strip().splitlines()[-1]


class HijosAisladosSinRed(unittest.TestCase):
    """Los hijos -I de las pruebas no pueden salir de este equipo."""

    def test_un_hijo_aislado_no_hereda_la_guardia(self) -> None:
        """El defecto: con la guardia preparada como la deja el lanzador, un hijo sin -I la tiene y uno con -I, no."""
        entorno = {**os.environ, "FARO_PRUEBAS_SIN_RED": "1", "PYTHONPATH": str(CARPETA_GUARDIA)}
        self.assertEqual(lanzar([sys.executable, "-B", "-c", GUARDIA_PUESTA], entorno), "True")
        self.assertEqual(lanzar([sys.executable, "-I", "-B", "-c", GUARDIA_PUESTA], entorno), "False")

    def test_un_hijo_aislado_con_la_guardia_no_puede_conectar(self) -> None:
        """Con el prólogo, el mismo hijo -I tiene la guardia y su intento de conexión queda bloqueado."""
        self.assertEqual(lanzar([sys.executable, "-I", "-B", "-c", codigo_sin_red(GUARDIA_PUESTA)]), "True")
        bloqueada = lanzar([sys.executable, "-I", "-B", "-c", codigo_sin_red(INTENTO)])
        self.assertEqual(bloqueada, "ConexionExternaProhibida")

    def test_un_guion_aislado_con_la_guardia_conserva_argv_y_no_puede_conectar(self) -> None:
        """La orden de guion equivale a `python -I -B guion args`: mismo argv y `__file__`, sin carpeta en sys.path."""
        with tempfile.TemporaryDirectory() as nombre:
            guion = Path(nombre) / "guion con espacios ñ.py"
            guion.write_text(
                "import json, sys\n"
                "from pathlib import Path\n"
                "print(json.dumps([sys.argv, __file__, __name__, str(Path(__file__).parent) in sys.path]))\n" + INTENTO,
                encoding="utf-8",
            )
            salida = subprocess.run(
                orden_de_guion_sin_red(sys.executable, guion, "uno", "dos"),
                capture_output=True,
                text=True,
                timeout=PLAZO,
                check=True,
            ).stdout.splitlines()
        self.assertEqual(json.loads(salida[0]), [[str(guion), "uno", "dos"], str(guion), "__main__", False])
        self.assertEqual(salida[-1], "ConexionExternaProhibida")

    def test_cada_hijo_aislado_figura_con_su_garantia(self) -> None:
        """Un -I nuevo sin guardia ni motivo hace fallar la prueba; uno con guardia debe llevar su marca."""
        encontrados = set()
        for carpeta in CARPETAS:
            for ruta in sorted((RAIZ / carpeta).rglob("*")):
                if ruta.suffix not in {".py", ".ts", ".js"} or "node_modules" in ruta.parts or not ruta.is_file():
                    continue
                if ARGUMENTO_AISLADO.search(ruta.read_text(encoding="utf-8", errors="replace")):
                    encontrados.add(ruta.relative_to(RAIZ).as_posix())
        self.assertEqual(sorted(encontrados), sorted({*CON_GUARDIA, *SIN_GUARDIA}))
        for relativa, marca in CON_GUARDIA.items():
            with self.subTest(relativa):
                self.assertIn(marca, (RAIZ / relativa).read_text(encoding="utf-8"))

    def test_los_hijos_del_producto_sin_guardia_no_importan_nada_capaz_de_abrir_red(self) -> None:
        """Las sondas de versiones y los lectores aislados solo importan librerías locales acreditadas."""
        for relativa, permitidas in IMPORTACIONES_PERMITIDAS.items():
            arbol = ast.parse((RAIZ / relativa).read_text(encoding="utf-8"))
            importadas = set()
            for nodo in ast.walk(arbol):
                if isinstance(nodo, ast.Import):
                    importadas.update(alias.name.split(".")[0] for alias in nodo.names)
                elif isinstance(nodo, ast.ImportFrom) and nodo.module:
                    importadas.add(nodo.module.split(".")[0])
            with self.subTest(relativa):
                self.assertEqual(sorted(importadas - permitidas), [])


if __name__ == "__main__":
    unittest.main()
