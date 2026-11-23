"""Salidas acotadas con procesos propios: drenan ambos canales sin cambiar sus resultados."""

import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from plataforma_datos.orquestacion import informe_de_la_actualizacion as informe
from plataforma_datos.orquestacion import procesos
from plataforma_datos.orquestacion.almacen_artefactos import MAX_SALIDA_DESCRIPTOR

COTA_PRUEBA = 4096


class PruebaProcesosAcotados(unittest.TestCase):
    """Los límites no se confunden con truncar un descriptor contractual válido ni con matar el hijo antes de drenar."""

    def test_cola_de_ambos_canales_limitada_y_codigo_real(self) -> None:
        """Un hijo produce más de una tubería en cada canal; se conservan los finales y el código no cero."""
        programa = (
            "import os,sys; "
            "os.write(1,b'a'*200000+b'FINAL-STDOUT'); "
            "os.write(2,b'b'*200000+b'FINAL-STDERR'); sys.exit(7)"
        )
        with (
            tempfile.TemporaryDirectory() as nombre,
            mock.patch.object(procesos, "MAX_SALIDA_BYTES", COTA_PRUEBA, create=True),
        ):
            resultado = procesos.ejecutar_con_plazo([sys.executable, "-c", programa], Path(nombre), 10)
        self.assertEqual(resultado.returncode, 7)
        for salida, final in ((resultado.stdout, "FINAL-STDOUT"), (resultado.stderr, "FINAL-STDERR")):
            self.assertLessEqual(len(salida.encode()), COTA_PRUEBA)
            self.assertIn("truncada", salida)
            self.assertTrue(salida.endswith(final))

    def test_informe_acota_una_sola_linea_gigante(self) -> None:
        """Cuarenta líneas no es una cota de bytes cuando una sola línea ocupa megabytes."""
        texto = "á" * (1024 * 1024) + "FINAL"
        recortado = informe._ultimas_lineas(texto)
        self.assertLessEqual(len(recortado.encode()), 64 * 1024)
        self.assertIn("recortada", recortado)
        self.assertTrue(recortado.endswith("FINAL"))

    def test_cota_comun_cubre_descriptor_contractual_existente(self) -> None:
        """No se introduce un máximo menor que el JSON ya admitido por el almacén de artefactos."""
        self.assertGreaterEqual(procesos.MAX_SALIDA_BYTES, MAX_SALIDA_DESCRIPTOR)

    def test_utf8_partido_bytes_invalidos_y_saltos_conservan_semantica(self) -> None:
        """La cola reproduce UTF-8 con sustitución y newlines universales de communicate(text=True)."""
        cola = procesos._ColaDeSalida()
        for fragmento in (b"a\r", b"\nb\rc\xff\xc3", b"\xb1", b""):
            cola.incorporar(fragmento, final=not fragmento)
        self.assertEqual(cola.texto(), "a\nb\nc\ufffdñ")

    def test_normalizacion_y_aviso_caben_en_cota_utf8(self) -> None:
        """Bytes inválidos pueden triplicar al decodificar; la cota se aplica al UTF-8 normalizado."""
        with mock.patch.object(procesos, "MAX_SALIDA_BYTES", COTA_PRUEBA):
            cola = procesos._ColaDeSalida()
            cola.incorporar(b"\xff" * (COTA_PRUEBA * 2))
            cola.incorporar("final ñ".encode(), final=True)
            texto = cola.texto()
        self.assertLessEqual(len(texto.encode()), COTA_PRUEBA)
        self.assertTrue(texto.endswith("final ñ"))
        self.assertIn("truncada", texto)

    def test_proceso_cierra_tuberias_pero_sigue_vivo_respeta_plazo(self) -> None:
        """EOF no equivale a que el proceso terminó; el wait también está dentro del mismo plazo."""
        programa = "import os,time; os.close(1); os.close(2); time.sleep(30)"
        with tempfile.TemporaryDirectory() as nombre, self.assertRaises(subprocess.TimeoutExpired):
            procesos.ejecutar_con_plazo([sys.executable, "-c", programa], Path(nombre), 0.2)

    def test_error_de_lectura_mata_hijo_y_siguiente_orden_funciona(self) -> None:
        """El cierre del grupo propio se ejecuta también si el drenaje falla antes del wait."""
        hijos = []
        crear = subprocess.Popen

        def abrir(*args: object, **kwargs: object) -> subprocess.Popen:
            proceso = crear(*args, **kwargs)
            hijos.append(proceso)
            return proceso

        with tempfile.TemporaryDirectory() as nombre:
            raiz = Path(nombre)
            with (
                mock.patch.object(procesos.subprocess, "Popen", abrir),
                mock.patch.object(procesos, "_drenar", side_effect=OSError("lectura sintética")),
                self.assertRaisesRegex(OSError, "lectura sintética"),
            ):
                procesos.ejecutar_con_plazo([sys.executable, "-c", "import time;time.sleep(30)"], raiz, 5)
            self.assertIsNotNone(hijos[0].poll())
            with self.assertRaises(ProcessLookupError):
                os.kill(hijos[0].pid, 0)
            siguiente = procesos.ejecutar_con_plazo([sys.executable, "-c", "print(42)"], raiz, 5)
            self.assertEqual(siguiente.stdout, "42\n")

    def test_timeout_salida_acotada_y_sin_proceso_vivo(self) -> None:
        """El plazo conserva el error real y no deja el grupo de la orden activo."""
        hijos = []
        crear = subprocess.Popen

        def abrir(*args: object, **kwargs: object) -> subprocess.Popen:
            proceso = crear(*args, **kwargs)
            hijos.append(proceso)
            return proceso

        with (
            tempfile.TemporaryDirectory() as nombre,
            mock.patch.object(procesos.subprocess, "Popen", abrir),
            mock.patch.object(procesos, "MAX_SALIDA_BYTES", COTA_PRUEBA),
            self.assertRaises(subprocess.TimeoutExpired) as capturada,
        ):
            procesos.ejecutar_con_plazo(
                [sys.executable, "-c", "import os,time;os.write(1,b'x'*100000);time.sleep(30)"], Path(nombre), 0.2
            )
        self.assertIsNotNone(hijos[0].poll())
        self.assertLessEqual(len(capturada.exception.output.encode()), COTA_PRUEBA)
        self.assertLessEqual(len(capturada.exception.stderr.encode()), COTA_PRUEBA)

    def test_salida_pequena_completa_y_ultimas_lineas_compatibles(self) -> None:
        """No hay marcador ni cambio de contenido si todo cabe en los contratos anteriores."""
        with tempfile.TemporaryDirectory() as nombre:
            resultado = procesos.ejecutar_con_plazo(
                [sys.executable, "-c", "import os;os.write(1,b'a\\r\\nb\\rc\\xff')"], Path(nombre), 5
            )
        self.assertEqual(resultado.returncode, 0)
        self.assertEqual(resultado.stdout, "a\nb\nc\ufffd")
        self.assertEqual(resultado.stderr, "")
        self.assertEqual(informe._ultimas_lineas("uno\ndos\ntres\n", 2), "dos\ntres")
