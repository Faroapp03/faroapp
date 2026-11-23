"""Rutas portables y separación entre el trabajo de actualización y el paquete oficial."""

import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from plataforma_datos.comun import entrada_salida, nucleo
from plataforma_datos.comun.pruebas.hijo_aislado import codigo_sin_red


class RutasDeActualizacion(unittest.TestCase):
    """La actualización trabaja bajo var/ y conserva el paquete canónico en datos/."""

    def test_rutas_operativas_y_paquete_separados(self) -> None:
        """Las etapas comparten un área operativa independiente del paquete oficial."""
        self.assertEqual(nucleo.RAIZ, Path(__file__).resolve().parents[3])
        self.assertEqual(nucleo.DATOS, nucleo.RAIZ / "var" / "actualizacion")
        self.assertEqual(nucleo.PAQUETE, nucleo.RAIZ / "datos")
        carpetas = entrada_salida.carpetas("prueba")
        self.assertEqual(carpetas.original, nucleo.DATOS / "originales" / "prueba")
        self.assertEqual(carpetas.preparado, nucleo.DATOS / "preparados" / "prueba")
        self.assertEqual(carpetas.validado, nucleo.DATOS / "validados" / "prueba")
        self.assertEqual(entrada_salida.ruta_del_conjunto("prueba"), carpetas.validado / "prueba.json")
        with tempfile.TemporaryDirectory() as temporal:
            raiz = Path(temporal).resolve()
            validacion = raiz / carpetas.validacion.relative_to(nucleo.RAIZ)
            with mock.patch.object(entrada_salida, "RAIZ", raiz):
                self.assertEqual(
                    entrada_salida.relativa(validacion), "var/actualizacion/validados/prueba/validacion.json"
                )

    def test_instalacion_con_espacios_unicode_y_cwd_ajeno(self) -> None:
        """Una copia mínima importa y escribe sus etapas desde otro cwd sin tocar el paquete."""
        with tempfile.TemporaryDirectory() as temporal:
            base = Path(temporal).resolve()
            instalacion = base / "Mis documentos" / "Año 2026"
            for nombre in (
                "plataforma_datos/__init__.py",
                "plataforma_datos/comun/__init__.py",
                "plataforma_datos/comun/nucleo.py",
                "plataforma_datos/comun/entrada_salida.py",
                "plataforma_datos/comun/perfil_web.py",
                "config/identidad-web.json",
                "plataforma_datos/orquestacion/__init__.py",
                "plataforma_datos/orquestacion/admision.py",
            ):
                relativa = Path(nombre)
                destino = instalacion / relativa
                destino.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(nucleo.RAIZ / relativa, destino)
            paquete = instalacion / "datos"
            paquete.mkdir()
            canonico = paquete / "fixture.json"
            contenido = '{"nombre":"año","valores":[1,2]}\n'.encode()
            canonico.write_bytes(contenido)
            cwd_ajeno = base / "Otra carpeta"
            cwd_ajeno.mkdir()
            programa = """
import sys
from pathlib import Path
sys.path.insert(0, sys.argv[1])
from plataforma_datos.comun import entrada_salida as es, nucleo as n
from plataforma_datos.comun import perfil_web
from plataforma_datos.orquestacion import admision
raiz = Path(sys.argv[1])
assert Path(perfil_web.__file__).resolve().is_relative_to(raiz)
assert n.AGENTE_POR_DEFECTO == perfil_web.perfil_chrome()["User-Agent"]
assert perfil_web.leer_perfil() == perfil_web.perfil_chrome()
assert n.RAIZ == raiz
assert n.DATOS == raiz / "var" / "actualizacion"
assert n.PAQUETE == raiz / "datos"
carpetas = es.carpetas("prueba")
es.guardar_json(carpetas.original / "procedencia.json", {"nombre": "año"})
es.guardar_jsonl(carpetas.preparado / "filas.jsonl", [{"nombre": "año"}])
controles = n.Controles()
controles.comprobar(True, "fixture")
admision.cerrar_validacion("prueba", {"estado": controles.estado, "controles": controles.lista}, controles,
                     lambda: {"nombre": "año"})
assert admision.leer_validado("prueba") == {"nombre": "año"}
assert es.relativa(carpetas.validacion) == "var/actualizacion/validados/prueba/validacion.json"
"""
            resultado = subprocess.run(
                # -I es lo que se prueba; el hijo se pone la guardia de red él mismo (PYTHONPATH no llega).
                [sys.executable, "-I", "-B", "-c", codigo_sin_red(programa), str(instalacion)],
                cwd=cwd_ajeno,
                capture_output=True,
                text=True,
                timeout=10,
                check=False,
            )
            self.assertEqual(resultado.returncode, 0, resultado.stderr)
            self.assertEqual(canonico.read_bytes(), contenido)
            self.assertEqual(list(paquete.iterdir()), [canonico])
            self.assertEqual(list(cwd_ajeno.iterdir()), [])


if __name__ == "__main__":
    unittest.main()
