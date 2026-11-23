"""Protege la propiedad de temporales, secretos y procesos de la actualización."""

import contextlib
import io
import os
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

from plataforma_datos.orquestacion import actualizar
from plataforma_datos.orquestacion.pruebas.test_actualizar import PAQUETE_VIGENTE, EjecutorSimulado, escribir_paquete


class PruebaAislamientoDeLaActualizacion(unittest.TestCase):
    """Los fallos se reproducen únicamente en árboles y procesos de esta prueba."""

    def setUp(self) -> None:
        """Usa una identidad genérica propia sin leer la configuración del operador."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        hogar = Path(temporal.name)
        self.agente = (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36"
        )
        (hogar / ".curlrc").write_text(f'user-agent = "{self.agente}"\n', encoding="utf-8")
        parche = mock.patch.object(Path, "home", return_value=hogar)
        parche.start()
        self.addCleanup(parche.stop)

    def test_un_area_existente_no_se_borra(self) -> None:
        """El rechazo no elimina contenido anterior ajeno a la ejecución."""
        with tempfile.TemporaryDirectory() as temporal:
            raiz, area = Path(temporal) / "producto", Path(temporal) / "trabajo ajeno"
            raiz.mkdir()
            area.mkdir()
            dato = area / "conservar.txt"
            dato.write_bytes(b"contenido ajeno")
            with self.assertRaises((ValueError, OSError)):
                actualizar.actualizar(raiz, actualizar.Opciones(area=area))
            self.assertTrue(dato.is_file(), "la carpeta anterior pertenece a otra operación")
            self.assertEqual(dato.read_bytes(), b"contenido ajeno")

    def test_un_destino_reservado_durante_el_inicio_no_se_borra(self) -> None:
        """La segunda comprobación conserva un destino creado después de la comprobación inicial."""
        with tempfile.TemporaryDirectory() as temporal:
            raiz, area = Path(temporal) / "producto", Path(temporal) / "area"
            raiz.mkdir()
            preparar = actualizar.preparar_area

            def reserva_ajena(origen: Path, destino: Path) -> None:
                destino.mkdir()
                (destino / "ajeno.txt").write_bytes(b"ajeno")
                preparar(origen, destino)

            with mock.patch.object(actualizar, "preparar_area", reserva_ajena), self.assertRaises(OSError):
                actualizar.actualizar(raiz, actualizar.Opciones(area=area))
            self.assertEqual((area / "ajeno.txt").read_bytes(), b"ajeno")

    def test_un_exportador_fallido_conserva_el_area_para_recuperar(self) -> None:
        """El fallo del subproceso no puede ocultar un respaldo que aún requiera revisión."""
        with tempfile.TemporaryDirectory() as temporal:
            raiz, area = Path(temporal) / "producto", Path(temporal) / "area"
            escribir_paquete(raiz / actualizar.CARPETA_DEL_PAQUETE, PAQUETE_VIGENTE)
            opciones = actualizar.Opciones(area=area, pausa=0, reintento=0, solo=())
            ejecutor = EjecutorSimulado(PAQUETE_VIGENTE, falla_en="plataforma_datos.orquestacion.exportar_paquete")
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(actualizar.actualizar(raiz, opciones, ejecutor), actualizar.CODIGO_AMBAR)
            self.assertTrue(area.is_dir())
            self.assertEqual(
                (raiz / actualizar.CARPETA_DEL_PAQUETE / "oit.json").read_bytes(),
                (area / actualizar.CARPETA_DEL_PAQUETE / "oit.json").read_bytes(),
            )

    def test_fallo_del_diagnostico_no_borra_el_area_de_exportacion_fallida(self) -> None:
        """El fallo al leer la comparación conserva también los posibles respaldos del exportador."""
        with tempfile.TemporaryDirectory() as temporal:
            raiz, area = Path(temporal) / "producto", Path(temporal) / "area"
            escribir_paquete(raiz / actualizar.CARPETA_DEL_PAQUETE, PAQUETE_VIGENTE)
            opciones = actualizar.Opciones(area=area, pausa=0, reintento=0, solo=())
            ejecutor = EjecutorSimulado(PAQUETE_VIGENTE, falla_en="plataforma_datos.orquestacion.exportar_paquete")
            with (
                mock.patch.object(actualizar, "comparar", side_effect=OSError("no se puede leer")),
                contextlib.redirect_stdout(io.StringIO()),
            ):
                self.assertEqual(actualizar.actualizar(raiz, opciones, ejecutor), actualizar.CODIGO_ROJO)
            self.assertTrue(area.is_dir())

    def test_promover_paquete_preserva_recursos_ajenos(self) -> None:
        """README, datos globales y lecturas permanecen idénticos al sustituir el paquete del motor."""
        with tempfile.TemporaryDirectory() as temporal:
            raiz, area = Path(temporal) / "producto", Path(temporal) / "Mis documentos/Año 2026"
            paquete = raiz / actualizar.CARPETA_DEL_PAQUETE
            escribir_paquete(paquete, PAQUETE_VIGENTE)
            ajenos = {"README.md": b"instrucciones", "globales/datos-globales.json": b"{}", "lecturas.json": b"[]"}
            for nombre, contenido in ajenos.items():
                ruta = paquete / nombre
                ruta.parent.mkdir(exist_ok=True)
                ruta.write_bytes(contenido)
            nuevo = {**PAQUETE_VIGENTE, "cambra.json": {"filas": [1, 2, 3, 4, 5, 6]}}
            opciones = actualizar.Opciones(area=area, pausa=0, reintento=0, solo=())
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(actualizar.actualizar(raiz, opciones, EjecutorSimulado(nuevo)), 0)
            self.assertEqual({nombre: (paquete / nombre).read_bytes() for nombre in ajenos}, ajenos)

    def test_recuperacion_incompleta_detiene_fuentes_y_paquete(self) -> None:
        """Una recuperación incompleta no se convierte en ámbar ni elimina el área que permite revisarla."""
        for solo in (("esco",), ()):
            with self.subTest(solo=solo), tempfile.TemporaryDirectory() as temporal:
                raiz, area = Path(temporal) / "producto", Path(temporal) / "area"
                escribir_paquete(raiz / actualizar.CARPETA_DEL_PAQUETE, PAQUETE_VIGENTE)
                opciones = actualizar.Opciones(area=area, pausa=0, reintento=0, solo=solo)
                ejecutor = EjecutorSimulado(PAQUETE_VIGENTE)
                error = actualizar.sustitucion.RecuperacionIncompleta("respaldo pendiente de recuperar")
                with (
                    mock.patch.object(actualizar, "publicar", side_effect=error),
                    contextlib.redirect_stdout(io.StringIO()) as salida,
                ):
                    self.assertEqual(actualizar.actualizar(raiz, opciones, ejecutor), actualizar.CODIGO_ROJO)
                self.assertTrue(area.is_dir())
                self.assertIn("respaldo pendiente de recuperar", salida.getvalue())
                if solo:
                    self.assertFalse(
                        any("plataforma_datos.orquestacion.exportar_paquete" in orden for orden in ejecutor.ordenes)
                    )

    def test_area_solapada_se_rechaza_antes_de_copiar(self) -> None:
        """Ninguna copia recursiva puede empezar dentro de su propio origen."""
        with tempfile.TemporaryDirectory() as temporal:
            raiz = Path(temporal) / "producto"
            raiz.mkdir()
            for area in (raiz, raiz / "copia", raiz.parent):
                with self.subTest(area=area), mock.patch.object(actualizar.shutil, "copytree") as copiar:
                    with self.assertRaises(ValueError):
                        actualizar.preparar_area(raiz, area)
                    copiar.assert_not_called()

    def test_la_copia_excluye_estado_privado_y_reutiliza_dependencias(self) -> None:
        """Las plantillas viajan; los perfiles y registros privados quedan fuera."""
        with tempfile.TemporaryDirectory() as temporal:
            raiz, area = Path(temporal) / "producto", Path(temporal) / "Mis documentos/Año 2026"
            privados = ("registro/consumo.json", "config/conexiones/perfiles/local.json", ".git/config")
            for nombre in (*privados, ".venv/bin/python", "node_modules/paquete/index.js", "config/plantilla.json"):
                archivo = raiz / nombre
                archivo.parent.mkdir(parents=True, exist_ok=True)
                archivo.write_text("señuelo ficticio", encoding="utf-8")
            actualizar.preparar_area(raiz, area)
            for nombre in privados:
                self.assertFalse((area / nombre).exists(), nombre)
            for nombre in (".venv", "node_modules"):
                self.assertTrue((area / nombre).is_symlink(), nombre)
                self.assertEqual((area / nombre).resolve(), (raiz / nombre).resolve())
            self.assertEqual(
                (area / "config/plantilla.json").read_bytes(), (raiz / "config/plantilla.json").read_bytes()
            )

    def test_no_se_copia_un_enlace_a_un_secreto(self) -> None:
        """Un nombre inocente no permite enlazar contenido excluido."""
        with tempfile.TemporaryDirectory() as temporal:
            raiz, area = Path(temporal) / "producto", Path(temporal) / "copia"
            raiz.mkdir()
            secreto = raiz / ".env"
            secreto.write_text("señuelo", encoding="utf-8")
            (raiz / "inocente.json").symlink_to(secreto)
            with self.assertRaisesRegex(ValueError, "enlace"):
                actualizar.preparar_area(raiz, area)
            self.assertEqual(secreto.read_text(), "señuelo")

    def test_las_variables_de_faro_no_autorizan_secretos(self) -> None:
        """El prefijo del producto no convierte credenciales en configuración heredable."""
        recibido = actualizar.entorno_de_las_ordenes(
            {
                "PATH": "/bin",
                "FARO_HOY": "2026-10-15",
                "FARO_TURNSTILE_SECRETO": "ficticio",
                "FARO_AVISO": "programa-ficticio",
                "FARO_PERFIL": "privado",
                "CLAVE_API": "ficticia",
            }
        )
        esperado = {
            "PATH": "/bin",
            "FARO_HOY": "2026-10-15",
            "npm_config_user_agent": self.agente,
            "npm_config_update_notifier": "false",
        }
        if sys.platform == "linux":
            esperado["LD_LIBRARY_PATH"] = str(Path(sys.base_prefix) / "lib")
        self.assertEqual(recibido, esperado)

    def test_biblioteca_del_runtime_sin_rutas_ambientales(self) -> None:
        """Los hijos Linux encuentran su Python sin cargar bibliotecas de una ruta ambiental."""
        with mock.patch.object(sys, "platform", "linux"), mock.patch.object(sys, "base_prefix", "/runtime/Año 2026"):
            recibido = actualizar.entorno_de_las_ordenes({"PATH": "/bin", "LD_LIBRARY_PATH": "/ajena"})
        self.assertEqual(recibido["PATH"], "/bin")
        self.assertEqual(recibido["LD_LIBRARY_PATH"], "/runtime/Año 2026/lib")

    def test_npm_no_consulta_versiones_y_mantiene_identidad_de_red(self) -> None:
        """La cadena fija la política de npm sin aceptar la configuración ambiental del operador."""
        recibido = actualizar.entorno_de_las_ordenes(
            {"npm_config_user_agent": "ajeno", "npm_config_update_notifier": "true"}
        )
        self.assertEqual(recibido.get("npm_config_user_agent"), self.agente)
        self.assertEqual(recibido.get("npm_config_update_notifier"), "false")

    def test_esperas_invalidas_se_rechazan_sin_escrituras(self) -> None:
        """La API Python valida ambas duraciones antes de crear estado."""
        with tempfile.TemporaryDirectory() as temporal:
            raiz = Path(temporal)
            for campo in ("pausa", "reintento"):
                for valor in (-1.0, float("inf"), float("nan")):
                    with (
                        self.subTest(campo=campo, valor=valor),
                        mock.patch.object(actualizar, "_actualizar") as ejecutar,
                    ):
                        with self.assertRaises(ValueError):
                            actualizar.actualizar(raiz, actualizar.Opciones(**{campo: valor}))
                        ejecutar.assert_not_called()
                        self.assertEqual(list(raiz.iterdir()), [])

    def test_cli_rechaza_pausa_invalida_antes_de_actualizar(self) -> None:
        """La CLI informa error de uso sin invocar el coordinador."""
        for valor in ("-1", "nan", "inf"):
            with self.subTest(valor=valor), mock.patch.object(actualizar, "actualizar") as ejecutar:
                with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as fallo:
                    actualizar.main(["--pausa", valor])
                self.assertEqual(fallo.exception.code, 2)
                ejecutar.assert_not_called()

    def test_cada_timeout_informa_el_tope_aplicado(self) -> None:
        """Cada orden cortada dice el tope que se le aplicó: el suyo (verificar:datos) o el general.

        Que el tope de verificar:datos cubra sus plazos internos lo exige `test_ordenes_de_la_actualizacion`.
        """
        verificar = list(actualizar.COMPROBACIONES[0].orden)
        self.assertEqual(verificar, ["npm", "run", "verificar:datos"])
        for orden, tope in ((verificar, 85 * 60), (["npm", "run", "construir"], 45 * 60)):
            with (
                self.subTest(orden=orden),
                mock.patch.object(
                    actualizar, "ejecutar_con_plazo", side_effect=subprocess.TimeoutExpired(orden, tope)
                ) as lanzar,
            ):
                resultado = actualizar.ejecutar_orden(orden, Path.cwd())
                self.assertEqual(lanzar.call_args.args[2], tope)
                self.assertEqual(resultado.codigo, actualizar.CODIGO_TIEMPO_AGOTADO)
                self.assertIn(str(tope), resultado.salida)

    def test_el_plazo_detiene_tambien_el_descendiente(self) -> None:
        """El PID observado pertenece al hijo creado por el programa sintético, nunca a una búsqueda global."""
        with tempfile.TemporaryDirectory() as temporal:
            carpeta = Path(temporal)
            pid_archivo = carpeta / "hijo.pid"
            programa = (
                "import subprocess,sys,time; from pathlib import Path; "
                "p=subprocess.Popen([sys.executable,'-c','import time; time.sleep(30)']); "
                "Path(sys.argv[1]).write_text(str(p.pid)); time.sleep(30)"
            )
            pid = None
            try:
                with mock.patch.object(actualizar, "TOPE_POR_ORDEN", 1):
                    resultado = actualizar.ejecutar_orden([sys.executable, "-c", programa, str(pid_archivo)], carpeta)
                self.assertEqual(resultado.codigo, actualizar.CODIGO_TIEMPO_AGOTADO)
                pid = int(pid_archivo.read_text())
                limite = time.monotonic() + 1
                while time.monotonic() < limite:
                    try:
                        os.kill(pid, 0)
                    except ProcessLookupError:
                        break
                    time.sleep(0.02)
                else:
                    self.fail("el descendiente sigue vivo después del plazo")
            finally:
                if pid is None and pid_archivo.exists():
                    pid = int(pid_archivo.read_text())
                if pid is not None:
                    with contextlib.suppress(ProcessLookupError):
                        os.kill(pid, signal.SIGKILL)


if __name__ == "__main__":
    unittest.main()
