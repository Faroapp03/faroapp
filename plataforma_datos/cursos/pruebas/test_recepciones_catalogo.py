"""Cortes de proceso y errores HTTP: nunca acreditan un cuerpo parcial o un cierre."""

import hashlib
import io
import json
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from contextlib import ExitStack
from http import HTTPStatus
from http.client import HTTPConnection, HTTPResponse
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import ProxyHandler, build_opener

from plataforma_datos.comun.nucleo import FormatoInesperado
from plataforma_datos.comun.pruebas.test_red_identidad import AGENTE_DE_PRUEBA
from plataforma_datos.comun.pruebas.test_red_limites import respuesta
from plataforma_datos.cursos import recepciones_catalogo as recepciones
from plataforma_datos.cursos.contrato_entrega_catalogo import ErrorEntregaCatalogo
from plataforma_datos.cursos.fuentes.hp_life import adquisicion as hp
from plataforma_datos.cursos.pruebas import test_hp_life_observaciones as fixtures

CODIGO_CORTE = 23
CUERPO = b"Recepcion completa repetible " * 100


class RecepcionesCatalogoPruebas(unittest.TestCase):
    """Solo servidores simulados, hijos propios y archivos de la prueba."""

    def setUp(self) -> None:
        """Reserva un directorio exclusivo que no contiene datos del producto."""
        temporal = tempfile.TemporaryDirectory(prefix="Corte recepción ñ ")
        self.addCleanup(temporal.cleanup)
        self.area = Path(temporal.name)

    def test_corte_real_durante_escritura_y_despues_de_promover_recupera(self) -> None:
        """El nombre final nunca tiene bytes parciales; un enlace pendiente se cierra sin renovar mtime."""
        codigo = """
import contextlib,os,sys
from pathlib import Path
from plataforma_datos.cursos import recepciones_catalogo as m
body=b"Recepcion completa repetible "*100
if sys.argv[2]=='escritura':
 real=m.temporal_hermano
 @contextlib.contextmanager
 def archivo(*args,**opts):
  with real(*args,**opts) as f:
   class Corte:
    def __getattr__(self,k):return getattr(f,k)
    def write(self,b):
     f.write(b[:len(b)//2]);f.flush();os.fsync(f.fileno());os._exit(23)
   yield Corte()
 m.temporal_hermano=archivo
else:
 real=m.os.link
 def enlazar(*args,**opts):
  real(*args,**opts);os._exit(23)
 m.os.link=enlazar
m.conservar_bytes(Path(sys.argv[1]),body,'.body')
"""
        sha = hashlib.sha256(CUERPO).hexdigest()
        for fase in ("escritura", "promocion"):
            with self.subTest(fase=fase):
                area = self.area / fase
                proceso = subprocess.run(
                    [sys.executable, "-B", "-c", codigo, str(area), fase], capture_output=True, timeout=10, check=False
                )
                self.assertEqual(proceso.returncode, CODIGO_CORTE, proceso.stderr.decode())
                final = area / (sha + ".body")
                if fase == "escritura":
                    self.assertFalse(final.exists())
                else:
                    self.assertEqual(final.read_bytes(), CUERPO)
                    self.assertEqual(final.stat().st_nlink, 2)
                antes = final.stat().st_mtime_ns if final.exists() else None
                referencia = recepciones.conservar_bytes(area, CUERPO, ".body")
                self.assertEqual(referencia.ruta.read_bytes(), CUERPO)
                self.assertEqual(referencia.ruta.stat().st_nlink, 1)
                if antes is not None:
                    self.assertEqual(referencia.ruta.stat().st_mtime_ns, antes)
                self.assertEqual(list(area.glob(".recepcion-*.tmp")), [])
                archivos = {p.name: (p.read_bytes(), p.stat().st_mtime_ns) for p in area.iterdir()}
                self.assertEqual(recepciones.conservar_bytes(area, CUERPO, ".body"), referencia)
                self.assertEqual({p.name: (p.read_bytes(), p.stat().st_mtime_ns) for p in area.iterdir()}, archivos)

    def test_destino_distinto_no_se_sobrescribe(self) -> None:
        """Un nombre ocupado por otros bytes se conserva exactamente."""
        destino = self.area / (hashlib.sha256(CUERPO).hexdigest() + ".body")
        destino.write_bytes(b"contenido distinto")
        with self.assertRaises(ErrorEntregaCatalogo):
            recepciones.conservar_bytes(self.area, CUERPO, ".body")
        self.assertEqual(destino.read_bytes(), b"contenido distinto")

    def test_error_leyendo_respuesta_negativa_conserva_intento_no_cierre(self) -> None:
        """HTTP503 incompleto no se pierde ni se transforma en recibo completo."""
        error = HTTPError(fixtures.URL, 503, "fallo sintético", {"Content-Length": "100"}, io.BytesIO(b"corto"))
        reloj = iter(("2026-10-23T01:00:00Z", "2026-10-23T01:00:01Z"))
        with patch.object(recepciones.red, "descargar_url", side_effect=error):
            resultado = hp.recibir(fixtures.URL, id=fixtures.OFERTA["id"], area=self.area, reloj=lambda: next(reloj))
        self.assertIsNone(resultado.recepcion)
        intento = json.loads(resultado.intento.ruta.read_bytes())
        self.assertEqual(intento["resultado"], "fallo")
        self.assertEqual(intento["http_observado"], 503)
        self.assertEqual(intento["error"], "FormatoInesperado")
        self.assertEqual(list(self.area.glob("*.body")), [])

    def test_error_de_programacion_se_propaga(self) -> None:
        """Una excepción interna al leer no se atribuye al proveedor."""
        error = HTTPError(fixtures.URL, 503, "fallo sintético", {}, io.BytesIO(b"cuerpo"))
        with (
            patch.object(recepciones.red, "descargar_url", side_effect=error),
            patch.object(recepciones.red, "leer_respuesta_con_plazo", side_effect=TypeError("defecto interno")),
            self.assertRaisesRegex(TypeError, "defecto interno"),
        ):
            hp.recibir(fixtures.URL, id=fixtures.OFERTA["id"], area=self.area)
        self.assertEqual(list(self.area.iterdir()), [])

    def test_plazo_explicito_compartido_por_turno_apertura_y_cuerpo(self) -> None:
        """Un goteo o un EOF tardío no renueva el margen; el HTTP realmente recibido sigue en el intento."""
        for estado in (HTTPStatus.OK, HTTPStatus.FOUND, HTTPStatus.SERVICE_UNAVAILABLE):
            for segundos in (None, 4):
                with self.subTest(estado=estado, segundos=segundos):
                    dato = self.consultar_a_goteo(estado, segundos)
                    self.assertEqual(dato.http, estado)
                    self.assertEqual(dato.completo, segundos is None)
                    self.assertEqual(dato.cuerpo, b"abc" if segundos is None else None)
                    if estado != HTTPStatus.OK:
                        self.assertEqual(dato.redireccion, "/otra")

    def consultar_a_goteo(self, estado: HTTPStatus, segundos: int | None) -> recepciones.RespuestaCatalogo:
        """La apertura consume dos segundos y llega un byte por segundo en la respuesta simulada.

        Returns:
            Intento registrado por el transporte de producción.
        """
        red = recepciones.red
        reloj = [0.0]
        rx = respuesta(b"abc", b"Location: /otra\r\n", estado)
        read1 = rx.read1

        def leer(_cantidad: int) -> bytes:
            reloj[0] += 1
            return read1(1)

        def abrir(_peticion: object, **opciones: object) -> HTTPResponse:
            self.assertIs(opciones["seguir_redirecciones"], False)
            reloj[0] += 2
            if estado != HTTPStatus.OK:
                raise HTTPError(fixtures.URL, estado, "respuesta", rx.headers, rx)
            return rx

        with (
            patch.object(red.time, "monotonic", side_effect=lambda: reloj[0]),
            patch.object(red, "PAUSAS", red.PausasPorDominio(lambda: reloj[0], lambda _: None)),
            patch.object(red.perfil_web, "cabeceras_peticion", return_value={}),
            patch.object(red, "abrir_peticion", side_effect=abrir),
            patch.object(rx, "read1", side_effect=leer),
        ):
            return recepciones.consultar(fixtures.URL, perfil="pagina", segundos=segundos, seguir_redirecciones=False)

    def test_lectura_bloqueada_despierta_al_vencer_sin_validar_un_cuerpo_truncado(self) -> None:
        """Un socket local sin longitud ni EOF no puede ocupar el resto del plazo genérico de 30 minutos."""
        origen, servidor = socket.socketpair()
        with origen, servidor:
            origen.settimeout(2)
            servidor.sendall(b"HTTP/1.1 200 OK\r\n\r\nincompleto")
            with HTTPResponse(origen) as rx:
                rx.begin()
                inicio = time.monotonic()
                with self.assertRaises(TimeoutError):
                    recepciones.red.leer_respuesta_hasta(rx, fixtures.URL, inicio + 0.05, 1024)
            self.assertLess(time.monotonic() - inicio, 1)

    def test_cabecera_inacabada_tampoco_alarga_una_peticion(self) -> None:
        """Las cabeceras se leen antes de recibir el objeto de urllib y comparten el mismo plazo."""
        origen, servidor = socket.socketpair()
        with origen, servidor:
            origen.settimeout(2)
            inicio = time.monotonic()
            conexion = recepciones.red._conexion_acotada(HTTPConnection, inicio + 0.05, "ejemplo.invalid")
            conexion.sock = origen
            self.addCleanup(conexion.close)
            conexion.request("GET", "/")
            servidor.sendall(b"HTTP/1.1 200 OK\r\nCabecera: inacabada")
            with self.assertRaises(TimeoutError):
                conexion.getresponse()
            self.assertLess(time.monotonic() - inicio, 1)

    def test_una_redireccion_seguida_no_espera_un_cuerpo_descartado(self) -> None:
        """El abridor recibe un 302 sin EOF y encuentra la respuesta final en otra conexión local."""
        red = recepciones.red
        url = "http://ejemplo.invalid/inicio"
        respuestas = iter(
            (
                b"HTTP/1.1 302 Found\r\nLocation: /final\r\n\r\ncuerpo sin fin",
                b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nOK",
            )
        )
        with ExitStack() as conexiones:

            class ConexionLocal(HTTPConnection):
                """Cada salto recibe sus bytes sin resolver ni usar ninguna dirección de red."""

                def connect(self) -> None:
                    """Prepara cabeceras y contenido en el otro extremo del socket local."""
                    origen, servidor = socket.socketpair()
                    self.sock = conexiones.enter_context(origen)
                    conexiones.enter_context(servidor)
                    origen.settimeout(1)
                    servidor.sendall(next(respuestas))

            with (
                patch.object(red, "HTTPConnection", ConexionLocal),
                patch.object(red, "build_opener", side_effect=lambda *args: build_opener(ProxyHandler({}), *args)),
                patch.object(red, "PAUSAS", red.PausasPorDominio(lambda: 0, lambda _: None)),
                patch.object(red.perfil_web, "cabeceras_peticion", return_value={"User-Agent": AGENTE_DE_PRUEBA}),
            ):
                dato = recepciones.consultar(url, perfil="pagina", segundos=1)
        self.assertTrue(dato.completo)
        self.assertEqual((dato.cuerpo, dato.url_final), (b"OK", "http://ejemplo.invalid/final"))

    def test_configuracion_rechazada_antes_de_http_no_se_atribuye_a_fuente(self) -> None:
        """Un formato/configuración local inválidos se propagan sin fabricar intento remoto."""
        with (
            patch.object(recepciones.red, "descargar_url", side_effect=FormatoInesperado("configuración local")),
            self.assertRaisesRegex(FormatoInesperado, "configuración local"),
        ):
            hp.recibir(fixtures.URL, id=fixtures.OFERTA["id"], area=self.area)
        self.assertEqual(list(self.area.iterdir()), [])
