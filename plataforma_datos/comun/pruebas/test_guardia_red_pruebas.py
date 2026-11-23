"""La batería Python no puede salir a la red: el lanzador real pone la guardia y sus hijos la heredan.

Cada comprobación corre en un intérprete aparte, para no depender de cómo se lanza esta prueba.
"""

import json
import subprocess
import sys
import unittest
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[3]
LANZADOR = RAIZ / "scripts/pruebas_python.py"

# Ejecuta el `principal` real del lanzador sustituyendo solo el descubrimiento: la prueba única que descubre
# intenta salir por cada vía cubierta, lanza un hijo que hereda el entorno y comprueba el bucle local.
SONDA = r"""
import importlib.util, json, os, socket, subprocess, sys, threading, unittest
especificacion = importlib.util.spec_from_file_location("lanzador", sys.argv[1])
lanzador = importlib.util.module_from_spec(especificacion)
especificacion.loader.exec_module(lanzador)
resultado = {}

class Sonda(unittest.TestCase):
    def test_sonda(self):
        import guardia_red
        intentos = {
            "connect": lambda: socket.create_connection(("192.0.2.10", 443), timeout=1),
            "connect_ex": lambda: socket.socket(socket.AF_INET6).connect_ex(("2001:db8::1", 443, 0, 0)),
            "sendto": lambda: socket.socket(socket.AF_INET, socket.SOCK_DGRAM).sendto(b"x", ("192.0.2.10", 53)),
            "getaddrinfo": lambda: socket.getaddrinfo("ejemplo.invalid", 443),
            "gethostbyname": lambda: socket.gethostbyname("ejemplo.invalid"),
            "gethostbyname_ex": lambda: socket.gethostbyname_ex("ejemplo.invalid"),
            "gethostbyaddr": lambda: socket.gethostbyaddr("192.0.2.10"),
            "getnameinfo": lambda: socket.getnameinfo(("192.0.2.10", 443), 0),
        }
        for nombre, intento in intentos.items():
            try:
                intento()
                resultado[nombre] = "salio"
            except guardia_red.ConexionExternaProhibida:
                resultado[nombre] = "bloqueada"
            except OSError as error:
                resultado[nombre] = f"otro error: {error}"
        servidor = socket.create_server(("127.0.0.1", 0))
        threading.Thread(target=lambda: servidor.accept()[0].sendall(b"local"), daemon=True).start()
        with socket.create_connection(servidor.getsockname(), timeout=5) as cliente:
            resultado["bucle_local"] = cliente.recv(5).decode()
        hijo = subprocess.run(
            [sys.executable, "-B", "-c",
             "import socket\ntry:\n    socket.create_connection(('192.0.2.10', 443), timeout=1)\n    print('salio')\n"
             "except Exception as e:\n    print(type(e).__name__)"],
            capture_output=True, text=True, timeout=30,
        )
        resultado["hijo"] = hijo.stdout.strip()

unittest.TestLoader.discover = lambda self, *a, **k: unittest.defaultTestLoader.loadTestsFromTestCase(Sonda)
codigo = lanzador.principal()
print(json.dumps({"codigo": codigo, **resultado}))
"""


class GuardiaDeRedPruebas(unittest.TestCase):
    """Una prueba que olvide sustituir el transporte falla con un error claro, sin consultar fuentes reales."""

    def test_el_lanzador_real_bloquea_toda_salida_y_los_hijos_la_heredan(self) -> None:
        """Conexiones, UDP y resoluciones externas bloqueadas; el bucle local responde; un hijo sin -I la hereda."""
        salida = (
            subprocess.run(
                [sys.executable, "-I", "-B", "-c", SONDA, str(LANZADOR)],
                capture_output=True,
                text=True,
                timeout=60,
                check=True,
                cwd=RAIZ,
            )
            .stdout.strip()
            .splitlines()[-1]
        )
        resultado = json.loads(salida)
        bloqueos = {k: v for k, v in resultado.items() if k not in ("codigo", "bucle_local", "hijo")}
        self.assertEqual(set(bloqueos.values()), {"bloqueada"}, bloqueos)
        self.assertEqual(len(bloqueos), 8)
        self.assertEqual(resultado["bucle_local"], "local")
        self.assertEqual(resultado["hijo"], "ConexionExternaProhibida")
        self.assertEqual(resultado["codigo"], 0)


if __name__ == "__main__":
    unittest.main()
