"""Bootstrap con HTTP preparado real interceptado y procesos simulados; no red ni instalaciones."""

import hashlib
import io
import json
import os
import ssl
import subprocess
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from email.message import Message
from http.client import HTTPResponse
from pathlib import Path
from typing import Any
from unittest import mock
from urllib.request import HTTPSHandler, Request
from urllib.response import addinfourl

from plataforma_datos.comun import confianza_tls as tls
from plataforma_datos.comun import perfil_web, red
from plataforma_datos.orquestacion import preparar_dependencias as preparar

AGENTE_PRUEBA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36"
)

SECRETO = "SECRETO-SENTINELA"


class Cuerpo(io.BytesIO):
    """Permite comprobar que no hay lecturas una vez vencido el presupuesto."""

    def __init__(self, contenido: bytes) -> None:
        super().__init__(contenido)
        self.lecturas = 0

    def read(self, cantidad: int = -1) -> bytes:
        """Cuenta una lectura.

        Returns:
            El bloque solicitado del cuerpo simulado.
        """
        self.lecturas += 1
        return super().read(cantidad)

    def read1(self, cantidad: int = -1) -> bytes:
        """Cuenta una lectura sin agregar varias operaciones del transporte.

        Returns:
            El bloque disponible del cuerpo simulado.
        """
        self.lecturas += 1
        return super().read1(cantidad)


class PruebaPrepararDependencias(unittest.TestCase):
    """El bootstrap solo acredita el venv completo y conserva directorios ajenos."""

    def setUp(self) -> None:
        """Lock pequeño de ambas plataformas sin duplicar el inventario real del coordinador."""
        self.instante = 0.0
        self.esperas: list[float] = []
        pausas = red.PausasPorDominio(lambda: self.instante, self.dormir)
        parche_pausas = mock.patch.object(red, "PAUSAS", pausas)
        parche_pausas.start()
        self.addCleanup(parche_pausas.stop)
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.checkout = Path(temporal.name).resolve() / "Código Año 2026"
        self.checkout.mkdir()
        self.hogar = self.checkout.parent / "hogar"
        self.hogar.mkdir()
        self.identidad = self.hogar / "identidad-web.json"
        self.identidad.write_text(
            json.dumps({"version": 1, "identidad": perfil_web.identidad_publica(perfil_web.perfil_chrome())})
        )
        self.identidad_original = self.identidad.read_bytes()
        parche_hogar = mock.patch.object(perfil_web, "RUTA_IDENTIDAD", self.identidad)
        parche_hogar.start()
        self.addCleanup(parche_hogar.stop)
        (self.checkout / "config").mkdir()
        self.contenidos: dict[str, bytes] = {}
        requisitos = {
            "requirements.txt": f"comun==1.0\ncertifi=={tls.CERTIFI_VERSION}\n".encode(),
            "requirements-dev.txt": b"-r requirements.txt\nruff==1.0\npip==26.2.2\n",
        }
        for nombre, contenido in requisitos.items():
            (self.checkout / nombre).write_bytes(contenido)
        self.lock = {
            "version": 1,
            "python": "3.12",
            "requisitos": {n: hashlib.sha256(c).hexdigest() for n, c in requisitos.items()},
            "comunes": [
                self.rueda("comun"),
                self.rueda("pip", version="26.2.2"),
                self.rueda("certifi", version=tls.CERTIFI_VERSION),
            ],
            "plataformas": {
                "linux-x86_64": [self.rueda("ruff", "manylinux_2_17_x86_64")],
                "darwin-arm64": [self.rueda("ruff", "macosx_11_0_arm64")],
            },
        }
        self.escribir_lock()
        self.eventos: list[tuple[str, Any]] = []
        self.cuerpos: list[Cuerpo] = []
        self.estado_http = 200
        self.cabeceras: dict[str, str] = {}
        self.ordenes: list[list[str]] = []
        self.requisitos_instalados: list[str] = []
        for parche in (
            mock.patch.object(HTTPSHandler, "do_open", side_effect=self.transporte),
            mock.patch.object(preparar, "ejecutar_con_plazo", side_effect=self.proceso),
            mock.patch.object(preparar.platform, "system", return_value="Darwin"),
            mock.patch.object(preparar.platform, "machine", return_value="arm64"),
            mock.patch("socket.create_connection", side_effect=AssertionError("No se permiten sockets")),
        ):
            parche.start()
            self.addCleanup(parche.stop)

    def dormir(self, segundos: float) -> None:
        """Adelanta el reloj del limitador compartido sin esperar tiempo real."""
        self.esperas.append(segundos)
        self.instante += segundos

    def rueda(self, nombre: str, plataforma: str = "any", version: str = "1.0") -> dict:
        """Produce bytes pequeños para verificar el transporte, nunca para instalarlos.

        Returns:
            Registro cerrado de una rueda sintética.
        """
        archivo = f"{nombre}-{version}-py3-none-{plataforma}.whl"
        url = f"https://files.pythonhosted.org/packages/ab/{archivo}"
        contenido = ("rueda sintética " + archivo).encode()
        self.contenidos[url] = contenido
        return {
            "nombre": nombre,
            "version": version,
            "archivo": archivo,
            "url": url,
            "sha256": hashlib.sha256(contenido).hexdigest(),
            "bytes": len(contenido),
        }

    def escribir_lock(self) -> None:
        """Escribe exclusivamente la fixture privada de esta prueba."""
        (self.checkout / preparar.LOCK).write_text(json.dumps(self.lock), encoding="utf-8")

    def transporte(self, _clase: type, solicitud: Request, **_opciones: object) -> addinfourl:
        """Inspecciona la petición después de los handlers del opener real.

        Returns:
            Respuesta HTTPS interceptada con cuerpo cerrable y acotable.
        """
        self.assertEqual(solicitud.get_header("User-agent"), AGENTE_PRUEBA)
        for nombre, valor in perfil_web.identidad_publica(perfil_web.perfil_chrome()).items():
            self.assertEqual(solicitud.get_header(nombre.capitalize()), valor)
        self.assertIsNone(solicitud.get_header("Accept-language"))
        self.assertEqual(solicitud.host, "files.pythonhosted.org")
        self.assertFalse(solicitud.has_proxy())
        self.assertIsNone(solicitud.get_header("Authorization"))
        self.assertNotIn(SECRETO, json.dumps(solicitud.header_items()))
        contenido = self.contenidos[solicitud.full_url]
        cuerpo = Cuerpo(contenido)
        self.cuerpos.append(cuerpo)
        cabeceras = Message()
        for nombre, valor in {"Content-Length": str(len(contenido)), **self.cabeceras}.items():
            cabeceras[nombre] = valor
        self.eventos.append(("GET", solicitud.full_url))
        return addinfourl(cuerpo, cabeceras, solicitud.full_url, self.estado_http)

    def proceso(self, orden: list[str], cwd: Path, plazo: float, entorno: dict) -> subprocess.CompletedProcess:
        """Registra las órdenes aisladas sin crear procesos ni instalar paquetes.

        Returns:
            Resultado exitoso de la orden simulada.
        """
        self.assertEqual(cwd, self.checkout)
        self.assertEqual(plazo, preparar.PLAZO_ORDEN_S)
        self.assertEqual(
            set(entorno), {"PATH", "HOME", "TMPDIR", "PIP_CONFIG_FILE"} | set(preparar.bibliotecas_de_python())
        )
        self.assertEqual(entorno["PIP_CONFIG_FILE"], os.devnull)
        self.assertNotIn(SECRETO, json.dumps(orden + list(entorno.values())))
        for nombre in ("HOME", "TMPDIR"):
            self.assertTrue(Path(entorno[nombre]).is_relative_to(self.checkout))
        self.eventos.append(("orden", orden))
        self.ordenes.append(orden)
        if "install" in orden:
            contenido = Path(orden[-1]).read_text(encoding="utf-8")
            self.requisitos_instalados.append(contenido)
            self.assertNotIn("https:", contenido)
            self.assertIn("file:", contenido)
            self.assertIn("C%C3%B3digo%20A%C3%B1o%202026", contenido)
            self.assertEqual(
                contenido.count("--hash=sha256:"),
                1 if Path(orden[-1]).name == "pip.txt" else len(self.lock["comunes"]) + 1,
            )
            self.assertTrue(
                all(
                    opcion in orden
                    for opcion in (
                        "--isolated",
                        "--no-index",
                        "--no-deps",
                        "--require-hashes",
                        "--only-binary=:all:",
                        "--no-cache-dir",
                        "--disable-pip-version-check",
                    )
                )
            )
        return subprocess.CompletedProcess(orden, 0, "", "")

    def ejecutar(self) -> dict:
        """Prepara el checkout de la fixture.

        Returns:
            Resumen confirmado del bootstrap.
        """
        return preparar.preparar_dependencias(self.checkout)

    def test_pip_fijado_se_instala_antes_del_resto_y_se_verifica_entorno(self) -> None:
        """El pip de ensurepip solo instala la rueda local fijada antes de invocar al nuevo pip."""
        self.ejecutar()
        self.assertEqual(self.requisitos_instalados[0].count("--hash=sha256:"), 1)
        self.assertIn("pip-26.2.2-", self.requisitos_instalados[0])
        self.assertEqual(self.requisitos_instalados[1].count("--hash=sha256:"), 4)
        self.assertEqual(
            self.ordenes[1],
            [
                str(self.checkout / ".venv/bin/python"),
                "-I",
                "-B",
                str(self.checkout / "plataforma_datos/comun/entorno_python.py"),
            ],
        )
        self.assertEqual(self.ordenes[-1][1], "-I")
        self.assertEqual(self.ordenes[-1][-1], str(self.checkout / "plataforma_datos/comun/confianza_tls.py"))

    def test_lock_rechaza_pip_o_certifi_ajenos_antes_de_red(self) -> None:
        """Un lock formalmente válido no autoriza otra versión de las dos piezas de confianza."""
        for indice, nombre, version in ((1, "pip", "25.0.1"), (2, "certifi", "2024.8.30")):
            original = self.lock["comunes"][indice]
            self.lock["comunes"][indice] = self.rueda(nombre, version=version)
            self.escribir_lock()
            with self.subTest(nombre=nombre):
                with self.assertRaises(preparar.DependenciasInvalidas):
                    self.ejecutar()
                self.assertEqual(self.eventos, [])
            if (self.checkout / ".venv").exists():
                preparar.shutil.rmtree(self.checkout / ".venv")
            self.eventos.clear()
            self.lock["comunes"][indice] = original

    def test_semilla_ausente_impide_descargar_o_crear_venv(self) -> None:
        """La preparación no puede buscar su primera CA en la red o en el sistema."""
        with (
            mock.patch.object(tls, "RECURSOS", self.checkout / "ausente"),
            self.assertRaises(preparar.DependenciasInvalidas),
        ):
            self.ejecutar()
        self.assertEqual(self.eventos, [])
        self.assertFalse((self.checkout / ".venv").exists())

    def test_tls_bootstrap_explicito_antes_del_venv(self) -> None:
        """El envío real simulado lleva contexto verificado sin depender de certifi instalado."""
        transporte = self.transporte

        def comprobar(*args: object, **opciones: object) -> addinfourl:
            contexto = opciones["context"]
            self.assertIsInstance(contexto, ssl.SSLContext)
            self.assertTrue(contexto.check_hostname)
            self.assertEqual(contexto.verify_mode, ssl.CERT_REQUIRED)
            return transporte(*args, **opciones)

        with mock.patch.object(HTTPSHandler, "do_open", side_effect=comprobar):
            self.ejecutar()

    def test_ruedas_esperan_desde_cierre_sin_limitar_fuentes_por_separado(self) -> None:
        """Dos ruedas usan el mismo controlador central hasta cerrar su respuesta."""
        inicios = []
        transporte = self.transporte
        cerrar = Cuerpo.close

        def cierre(cuerpo: Cuerpo) -> None:
            if not cuerpo.closed:
                self.instante += 3
            cerrar(cuerpo)

        def responder(*args: object, **opciones: object) -> addinfourl:
            inicios.append(self.instante)
            return transporte(*args, **opciones)

        with (
            mock.patch.object(HTTPSHandler, "do_open", side_effect=responder),
            mock.patch.object(Cuerpo, "close", cierre),
        ):
            self.ejecutar()
        self.assertEqual(inicios, [0, 5, 10, 15])
        self.assertEqual(self.esperas, [2, 2, 2])

    def test_fallo_al_abrir_libera_turno_y_espacia_siguiente_intento(self) -> None:
        """La excepción de transporte no deja turno activo ni olvida el tiempo del fallo."""
        inicios = []
        transporte = self.transporte

        def responder(*args: object, **opciones: object) -> addinfourl:
            inicios.append(self.instante)
            if len(inicios) == 1:
                self.instante += 3
                raise OSError("fallo sintético")
            return transporte(*args, **opciones)

        with mock.patch.object(HTTPSHandler, "do_open", side_effect=responder):
            with self.assertRaises(preparar.DependenciasInvalidas):
                self.ejecutar()
            self.ejecutar()
        self.assertEqual(inicios, [0, 5, 7, 9, 11])
        self.assertEqual(self.esperas, [2, 2, 2, 2])

    def test_espera_entre_ruedas_no_renueva_plazo_de_descarga(self) -> None:
        """Una espera que vence el presupuesto impide emitir la rueda siguiente."""
        with (
            mock.patch.object(preparar.time, "monotonic", side_effect=lambda: self.instante),
            mock.patch.object(preparar, "PLAZO_DESCARGA_S", 1),
            self.assertRaises(preparar.DependenciasInvalidas),
        ):
            self.ejecutar()
        self.assertEqual(len(self.eventos), 1)
        self.assertEqual(self.esperas, [2])
        self.assertFalse((self.checkout / ".venv").exists())

    def test_identidad_invalida_no_descarga_ni_instala(self) -> None:
        """La configuración inválida no se sustituye por una identidad automática."""
        self.identidad.write_text('user-agent = "AgentePrivado"\n')
        with self.assertRaises(preparar.DependenciasInvalidas):
            self.ejecutar()
        self.assertEqual(self.eventos, [])
        self.assertEqual(self.ordenes, [])
        self.assertFalse((self.checkout / ".venv").exists())

    def test_configuracion_identidad_no_se_modifica_ni_se_copian_opciones(self) -> None:
        """La cabecera configurada se emite exacta sin heredar el proxy de curl."""
        self.ejecutar()
        self.assertEqual(self.identidad.read_bytes(), self.identidad_original)
        self.assertEqual(sum(e[0] == "GET" for e in self.eventos), 4)

    def test_nominal_verifica_todo_antes_venv_y_aisla_ambiente(self) -> None:
        """Ninguna configuración de pip/proxy ni clave ambiental modifica las peticiones u órdenes."""
        ambiente = {
            "HTTPS_PROXY": f"http://u:{SECRETO}@ajeno.invalid",
            "PIP_INDEX_URL": SECRETO,
            "AWS_SECRET_ACCESS_KEY": SECRETO,
            "ACTIONS_ID_TOKEN_REQUEST_TOKEN": SECRETO,
        }
        with mock.patch.dict(os.environ, ambiente):
            resumen = self.ejecutar()
        self.assertEqual(
            resumen,
            {
                "version": 1,
                "python": "3.12",
                "plataforma": "darwin-arm64",
                "paquetes": 4,
                "sha256Lock": hashlib.sha256((self.checkout / preparar.LOCK).read_bytes()).hexdigest(),
            },
        )
        self.assertEqual([e[0] for e in self.eventos], ["GET"] * 4 + ["orden"] * 6)
        self.assertTrue(all(c.closed for c in self.cuerpos))
        self.assertTrue((self.checkout / ".venv").is_dir())
        self.assertFalse(any(p.name.startswith(".dependencias-") for p in self.checkout.iterdir()))

    def test_linux_selecciona_su_rueda_y_python_o_plataforma_ajena_rechazan(self) -> None:
        """La selección es cerrada; no intenta resolver una variante distinta por red."""
        with (
            mock.patch.object(preparar.platform, "system", return_value="Linux"),
            mock.patch.object(preparar.platform, "machine", return_value="x86_64"),
        ):
            self.assertEqual(self.ejecutar()["plataforma"], "linux-x86_64")
        self.assertIn("manylinux", self.eventos[3][1])
        # Otro checkout no tiene venv previo: se rechaza por plataforma antes de descargar.
        preparar.shutil.rmtree(self.checkout / ".venv")
        for parche in (
            mock.patch.object(preparar.sys, "version_info", (3, 13)),
            mock.patch.object(preparar.platform, "machine", return_value="ajena"),
        ):
            with parche, self.assertRaises(ValueError):
                self.ejecutar()
        self.assertEqual(len(self.ordenes), 6)

    def test_python_anterior_al_parche_minimo_no_descarga_ni_instala(self) -> None:
        """Python3.12.14 comparte rama, pero no cumple el mínimo de mantenimiento."""
        with (
            mock.patch.object(preparar.sys, "version_info", (3, 12, 14, "final", 0)),
            self.assertRaises(preparar.DependenciasInvalidas),
        ):
            self.ejecutar()
        self.assertEqual(self.eventos, [])
        self.assertEqual(self.ordenes, [])

    def test_sqlite_no_admitido_impide_descargar_o_crear_el_entorno(self) -> None:
        """La comprobación de SQLite del bootstrap precede incluso a la primera rueda."""
        with (
            mock.patch.object(preparar, "comprobar_sqlite", side_effect=ValueError("SQLite no admitido")),
            self.assertRaises(preparar.DependenciasInvalidas),
        ):
            self.ejecutar()
        self.assertEqual(self.eventos, [])
        self.assertFalse((self.checkout / ".venv").exists())

    def test_linux_deriva_biblioteca_del_interprete_sin_ld_ambiental(self) -> None:
        """Python del runner encuentra su biblioteca mediante el prefijo propio, sin aceptar rutas ajenas."""
        prefijo = self.checkout.parent / "Python privado"
        real = self.proceso

        def comprobar(orden: list[str], cwd: Path, plazo: float, entorno: dict) -> subprocess.CompletedProcess:
            self.assertEqual(entorno["LD_LIBRARY_PATH"], str(prefijo / "lib"))
            return real(orden, cwd, plazo, entorno)

        with (
            mock.patch.object(preparar.sys, "platform", "linux"),
            mock.patch.object(preparar.sys, "base_prefix", str(prefijo)),
            mock.patch.object(preparar.platform, "system", return_value="Linux"),
            mock.patch.object(preparar.platform, "machine", return_value="x86_64"),
            mock.patch.dict(os.environ, {"LD_LIBRARY_PATH": SECRETO}),
            mock.patch.object(preparar, "ejecutar_con_plazo", side_effect=comprobar),
        ):
            self.ejecutar()
        self.assertEqual(len(self.ordenes), 6)

    def test_requisitos_distintos_lock_duplicado_y_campos_abiertos_no_descargan(self) -> None:
        """La huella del requirements y el esquema se comprueban antes de cualquier petición."""
        ruta = self.checkout / "requirements.txt"
        contenido = ruta.read_bytes()
        ruta.write_bytes(b"otra dependencia")
        with self.assertRaises(ValueError):
            self.ejecutar()
        ruta.write_bytes(contenido)
        ruta_lock = self.checkout / preparar.LOCK
        for texto in ('{"version":1,"version":1}', json.dumps(self.lock | {"extra": True}), "null"):
            ruta_lock.write_text(texto, encoding="utf-8")
            with self.assertRaises(ValueError):
                self.ejecutar()
        self.assertEqual(self.eventos, [])

    def test_urls_y_nombres_no_permiten_rutas_credenciales_redirect_o_query(self) -> None:
        """La entrada del lock no convierte el bootstrap en un descargador general."""
        original = dict(self.lock["comunes"][0])
        casos = [
            ("url", "http://files.pythonhosted.org/packages/x.whl"),
            ("url", "https://u:p@files.pythonhosted.org/packages/x.whl"),
            ("url", original["url"] + "?token=privado"),
            ("url", original["url"] + "#fragmento"),
            ("url", original["url"] + "\n"),
            ("url", original["url"] + "?"),
            ("url", original["url"].replace("files.pythonhosted.org", "ajeno.invalid")),
            ("url", original["url"].replace("/packages/", "/packages/../")),
            ("archivo", "../fuera.whl"),
            ("nombre", "otro"),
            ("version", "2.0"),
        ]
        for campo, valor in casos:
            self.lock["comunes"][0] = original | {campo: valor}
            self.escribir_lock()
            with self.subTest(campo=campo, valor=valor), self.assertRaises(ValueError):
                self.ejecutar()
        self.assertEqual(self.eventos, [])

    def test_colision_normalizada_y_limites_del_lock_rechazan_antes_red(self) -> None:
        """Duplicados, booleanos y presupuestos superados no reservan venv ni descargan."""
        original = dict(self.lock["comunes"][0])
        for valor in (True, 0, preparar.MAX_ARCHIVO_BYTES + 1):
            self.lock["comunes"][0] = original | {"bytes": valor}
            self.escribir_lock()
            with self.subTest(bytes=valor), self.assertRaises(ValueError):
                self.ejecutar()
        self.lock["comunes"] = [original, original]
        self.escribir_lock()
        with self.assertRaises(ValueError):
            self.ejecutar()
        self.lock["comunes"] = [original]
        self.escribir_lock()
        with mock.patch.object(preparar, "MAX_TOTAL_BYTES", 1), self.assertRaises(ValueError):
            self.ejecutar()
        self.assertEqual(self.eventos, [])

    def test_estados_http_no_reenvian_ni_leen_cuerpos(self) -> None:
        """Un 302 con destino externo se devuelve como fallo tras una sola petición."""
        self.cabeceras["Location"] = f"https://ajeno.invalid/{SECRETO}"
        for estado in (302, 307, 401, 500):
            self.estado_http = estado
            with self.subTest(estado=estado), self.assertRaisesRegex(ValueError, preparar.ERROR):
                self.ejecutar()
            self.assertEqual(self.cuerpos[-1].lecturas, 0)
            self.assertTrue(self.cuerpos[-1].closed)
        self.assertEqual(len(self.eventos), 4)
        self.assertEqual(self.ordenes, [])

    def test_cuerpo_truncado_excesivo_hash_y_codificacion_no_instalan(self) -> None:
        """Ni HEAD/longitud ni una respuesta parcial acreditan los bytes de una rueda."""
        rueda = self.lock["comunes"][0]
        original = self.contenidos[rueda["url"]]
        for contenido in (original[:-1], original + b"exceso", b"x" * len(original)):
            self.contenidos[rueda["url"]] = contenido
            self.cabeceras = {"Content-Length": str(rueda["bytes"])}
            with self.subTest(bytes=len(contenido)), self.assertRaises(ValueError):
                self.ejecutar()
        self.contenidos[rueda["url"]] = original
        self.cabeceras = {"Content-Encoding": "gzip"}
        with self.assertRaises(ValueError):
            self.ejecutar()
        self.assertEqual(self.ordenes, [])
        self.assertFalse((self.checkout / ".venv").exists())

    def test_presupuesto_vencido_no_inicia_lectura(self) -> None:
        """La lectura no prosigue después del deadline, sin dormir ni abrir sockets."""
        with (
            mock.patch.object(preparar.time, "monotonic", side_effect=[0, 0, preparar.PLAZO_DESCARGA_S + 1]),
            self.assertRaises(ValueError),
        ):
            self.ejecutar()
        self.assertEqual(self.cuerpos[0].lecturas, 0)
        self.assertTrue(self.cuerpos[0].closed)
        self.assertEqual(self.ordenes, [])

    def test_fallo_en_cada_orden_retira_solo_venv_propio(self) -> None:
        """Creación, instalación o pip check fallidos no dejan un entorno acreditado a medias."""
        for fase in range(6):
            llamadas = 0

            def fallar(
                orden: list[str], cwd: Path, plazo: float, entorno: dict, fase_actual: int = fase
            ) -> subprocess.CompletedProcess:
                nonlocal llamadas
                self.proceso(orden, cwd, plazo, entorno)
                llamadas += 1
                return subprocess.CompletedProcess(orden, int(llamadas == fase_actual + 1), "", "")

            with (
                self.subTest(fase=fase),
                mock.patch.object(preparar, "ejecutar_con_plazo", side_effect=fallar),
                self.assertRaises(ValueError),
            ):
                self.ejecutar()
            self.assertFalse((self.checkout / ".venv").exists())
            self.assertFalse(any(p.name.startswith(".dependencias-") for p in self.checkout.iterdir()))

    def test_venv_existente_enlace_y_checkout_enlace_no_se_modifican(self) -> None:
        """Ni un venv ajeno ni aliases permiten descargar o sobrescribir una instalación."""
        destino = self.checkout / ".venv"
        destino.mkdir()
        (destino / "propio-ajeno").write_bytes(b"conservar")
        with self.assertRaises(ValueError):
            self.ejecutar()
        self.assertEqual((destino / "propio-ajeno").read_bytes(), b"conservar")
        preparar.shutil.rmtree(destino)
        destino.symlink_to(self.checkout / "ausente", target_is_directory=True)
        with self.assertRaises(ValueError):
            self.ejecutar()
        self.assertTrue(destino.is_symlink())
        enlace = self.checkout.parent / "alias"
        enlace.symlink_to(self.checkout, target_is_directory=True)
        with self.assertRaises(ValueError):
            preparar.preparar_dependencias(enlace)
        self.assertEqual(self.eventos, [])

    def test_reemplazo_de_reserva_no_borra_directorio_ajeno(self) -> None:
        """El cleanup exige el dev/ino reservado antes de retirar un directorio."""

        def reemplazar(*_args: object) -> subprocess.CompletedProcess:
            destino = self.checkout / ".venv"
            destino.rename(self.checkout / "reserva-original")
            destino.mkdir()
            (destino / "conservar").write_bytes(b"ajeno")
            return subprocess.CompletedProcess([], 1, "", "")

        with mock.patch.object(preparar, "ejecutar_con_plazo", side_effect=reemplazar), self.assertRaises(ValueError):
            self.ejecutar()
        self.assertEqual((self.checkout / ".venv/conservar").read_bytes(), b"ajeno")

    def test_cli_error_neutro_sin_rutas_cuerpos_o_secretos(self) -> None:
        """Un fallo de transporte no imprime su diagnóstico interno ni un resumen de éxito."""
        with (
            mock.patch.object(HTTPSHandler, "do_open", side_effect=OSError(SECRETO)),
            redirect_stdout(io.StringIO()) as salida,
            redirect_stderr(io.StringIO()) as errores,
        ):
            codigo = preparar.main([str(self.checkout)])
        self.assertEqual(codigo, 1)
        self.assertEqual(salida.getvalue(), "")
        self.assertEqual(errores.getvalue(), preparar.ERROR + "\n")

    def test_http_chunked_truncado_real_cierra_y_cli_devuelve_error_neutro(self) -> None:
        """IncompleteRead del lector HTTP real no escapa al contrato de error de la CLI."""
        cuerpo = io.BytesIO(b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n8\r\nabc")
        conexion = mock.Mock()
        conexion.makefile.return_value = cuerpo
        respuesta = HTTPResponse(conexion)
        respuesta.begin()
        with (
            mock.patch.object(HTTPSHandler, "do_open", return_value=respuesta),
            redirect_stdout(io.StringIO()) as salida,
            redirect_stderr(io.StringIO()) as errores,
        ):
            codigo = preparar.main([str(self.checkout)])
        self.assertEqual(codigo, 1)
        self.assertEqual(salida.getvalue(), "")
        self.assertEqual(errores.getvalue(), preparar.ERROR + "\n")
        self.assertTrue(respuesta.isclosed())
        self.assertTrue(cuerpo.closed)
        self.assertEqual(self.ordenes, [])
        self.assertFalse((self.checkout / ".venv").exists())

    def test_lock_real_cubre_requisitos_exactos_en_ambas_plataformas(self) -> None:
        """La integridad del inventario se compara con requisitos, sin atribuírsela a pip check."""
        raiz = Path(__file__).resolve().parents[3]
        esperados = set()
        for archivo in ("requirements.txt", "requirements-dev.txt"):
            for linea in (raiz / archivo).read_text(encoding="utf-8").splitlines():
                if not linea or linea.startswith("#") or linea == "-r requirements.txt":
                    continue
                nombre, version = linea.split("==")
                esperados.add((nombre, version))
        for sistema, maquina, plataforma in (("Linux", "x86_64", "linux-x86_64"), ("Darwin", "arm64", "darwin-arm64")):
            with (
                self.subTest(plataforma=plataforma),
                mock.patch.object(preparar.platform, "system", return_value=sistema),
                mock.patch.object(preparar.platform, "machine", return_value=maquina),
            ):
                ruedas, seleccion, _huella = preparar._lock(raiz)
                self.assertEqual(seleccion, plataforma)
                self.assertEqual({(r["nombre"], r["version"]) for r in ruedas}, esperados)
                self.assertEqual(len(ruedas), len(esperados))


if __name__ == "__main__":
    unittest.main()
