"""La guardia de red del ensayo: niega toda salida, también a los nietos y al resolvedor, y deja el bucle local."""

import os
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import unittest
from pathlib import Path

from plataforma_datos.comun.nucleo import RAIZ
from plataforma_datos.orquestacion import guardia_sin_red

EN_MACOS = sys.platform == "darwin" and shutil.which("sandbox-exec") is not None
# La guardia de la batería (scripts/sin_red), que heredan los intérpretes hijos con esta variable.
GUARDIA_DE_LAS_PRUEBAS = "FARO_PRUEBAS_SIN_RED"
# La sonda va a una dirección de documentación (RFC 5737): no se enruta, así que ni un fallo de la guardia
# llega a nadie.
CONECTAR = (
    "import socket\n"
    "try:\n"
    "    socket.create_connection(('192.0.2.1', 443), timeout=2)\n"
    "    print('permitida')\n"
    "except PermissionError:\n"
    "    print('negada')\n"
)
LANZAR = (
    "import subprocess, sys\n"
    "print(subprocess.run([sys.executable, '-I', *sys.argv[1:]], capture_output=True, text=True).stdout.strip())\n"
)
RESOLVER = (
    "import socket\n"
    "try:\n"
    "    socket.getaddrinfo('example.com', 443)\n"
    "    print('resuelto')\n"
    "except OSError:\n"
    "    print('negado')\n"
)


def _bajo_la_guardia(*orden: str, cwd: Path | None = None) -> str:
    # Lo que corre bajo la guardia no hereda la de la batería: esa niega la sonda con su propio error antes que el
    # sistema, y la prueba mediría la batería en vez del sandbox, que sigue negando toda salida.
    entorno = {nombre: valor for nombre, valor in os.environ.items() if nombre != GUARDIA_DE_LAS_PRUEBAS}
    salida = subprocess.run(
        guardia_sin_red.con_guardia(list(orden)),
        capture_output=True,
        text=True,
        check=True,
        timeout=60,
        cwd=cwd,
        env=entorno,
    )
    return salida.stdout.strip()


class GuardiaPruebas(unittest.TestCase):
    """Lo que la guardia niega y lo que deja."""

    def test_en_otro_sistema_el_ensayo_se_niega_y_dice_por_que(self) -> None:
        """En otro sistema el ensayo se niega y dice por qué."""
        for sistema in ("linux", "win32"):
            with self.assertRaisesRegex(guardia_sin_red.SinGuardiaDeRed, "solo se ejecuta en macOS"):
                guardia_sin_red.con_guardia(["true"], sistema)

    def test_el_perfil_no_admite_sockets_unix_por_ruta(self) -> None:
        """El perfil solo admite el bucle local: ningún socket unix por ruta, tampoco el del resolvedor."""
        self.assertNotIn("unix-socket", guardia_sin_red.PERFIL)
        self.assertIn('(allow network-outbound (remote ip "localhost:*"))', guardia_sin_red.PERFIL)

    @unittest.skipUnless(EN_MACOS, "la guardia de macOS")
    def test_una_conexion_externa_se_niega(self) -> None:
        """Una conexión externa se niega."""
        self.assertEqual(_bajo_la_guardia(sys.executable, "-I", "-c", CONECTAR), "negada")

    @unittest.skipUnless(EN_MACOS, "la guardia de macOS")
    def test_un_proceso_nieto_tampoco_sale(self) -> None:
        """Un proceso nieto tampoco sale."""
        carpeta = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, carpeta)
        (carpeta / "nieto.py").write_text(CONECTAR)
        (carpeta / "hijo.py").write_text(LANZAR)
        # El proceso bajo la guardia lanza un hijo, y el hijo lanza al nieto que intenta conectar.
        orden = (sys.executable, "-I", "-c", LANZAR, str(carpeta / "hijo.py"), str(carpeta / "nieto.py"))
        self.assertEqual(_bajo_la_guardia(*orden), "negada")

    @unittest.skipUnless(EN_MACOS, "la guardia de macOS")
    def test_un_nombre_externo_no_se_resuelve(self) -> None:
        """Un nombre externo no se resuelve."""
        self.assertEqual(_bajo_la_guardia(sys.executable, "-I", "-c", RESOLVER), "negado")

    @unittest.skipUnless(EN_MACOS, "la guardia de macOS")
    def test_el_bucle_local_y_la_tabla_de_procesos_funcionan(self) -> None:
        """El bucle local (el servidor del humo de datos) y `ps` funcionan bajo la guardia."""
        servidor = socket.create_server(("127.0.0.1", 0))
        self.addCleanup(servidor.close)
        hilo = threading.Thread(target=lambda: servidor.accept()[0].close(), daemon=True)
        hilo.start()
        puerto = servidor.getsockname()[1]
        conectar = (
            f"import socket\nsocket.create_connection(('127.0.0.1', {puerto}), timeout=5).close()\nprint('local')\n"
        )
        self.assertEqual(_bajo_la_guardia(sys.executable, "-I", "-c", conectar), "local")
        self.assertEqual(_bajo_la_guardia("ps", "-p", "1", "-o", "pid="), "1")


class ExigirSinRedPruebas(unittest.TestCase):
    """La suborden del ciclo solo empieza bajo la guardia."""

    def test_una_negacion_del_sistema_deja_empezar(self) -> None:
        """Una negación del sistema deja empezar."""

        def negada() -> None:
            raise PermissionError(1, "Operation not permitted")

        guardia_sin_red.exigir_sin_red(negada)

    def test_sin_guardia_no_empieza(self) -> None:
        """Si la conexión se intenta (llega o se agota su plazo), el ciclo no empieza."""

        def agotada() -> None:
            raise TimeoutError("timed out")

        for conectar in (agotada, lambda: None):
            with self.assertRaises(guardia_sin_red.SinGuardiaDeRed):
                guardia_sin_red.exigir_sin_red(conectar)

    @unittest.skipUnless(EN_MACOS, "la guardia de macOS")
    def test_bajo_la_guardia_la_comprobacion_pasa(self) -> None:
        """Bajo la guardia, la comprobación del ciclo pasa."""
        comprobar = (
            "from plataforma_datos.orquestacion.guardia_sin_red import exigir_sin_red\n"
            "exigir_sin_red()\n"
            "print('bajo la guardia')\n"
        )
        self.assertEqual(_bajo_la_guardia(sys.executable, "-c", comprobar, cwd=RAIZ), "bajo la guardia")


if __name__ == "__main__":
    unittest.main()
