"""El cliente de la reserva a demanda contra un servidor HTTPS local de la biblioteca estándar, sin red exterior."""

from __future__ import annotations

import io
import json
import os
import ssl
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from contextlib import redirect_stderr, redirect_stdout
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, urlsplit

from plataforma_datos.comun.pruebas.hijo_aislado import orden_de_guion_sin_red
from plataforma_datos.orquestacion import reserva_a_demanda as cliente

RAIZ = Path(__file__).resolve().parents[3]
CERTIFICADO = RAIZ / "pruebas" / "navegadores" / "tls-sintetico.pem"
CLAVE = RAIZ / "pruebas" / "navegadores" / "tls-clave-sintetica.pem"
CONTRATO = json.loads((RAIZ / "pruebas" / "fixtures" / "contrato-reserva-a-demanda.json").read_text(encoding="utf-8"))
CREDENCIAL = "credencial-de-solicitud-sintetica"
TOKEN = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJzaW50ZXRpY28ifQ.firma-sintetica_del-run"
SOLICITUD = "12345678-1234-4234-8234-123456789abc"
PLAZO_CORTO_S = 0.5
ESPERA_LARGA_S = 1.5
SALIDA_ERROR = 1
SALIDA_RECHAZADA = 3
DOS_INTENTOS = 2
PROHIBIDO = 401
INEXISTENTE = 404


class Servidor(ThreadingHTTPServer):
    """Sirve el token del runner en /oidc y la reserva en /mantenimiento/reserva, con la respuesta prevista."""

    daemon_threads = True

    def __init__(self) -> None:
        super().__init__(("127.0.0.1", 0), Manejador)
        contexto = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        contexto.load_cert_chain(CERTIFICADO, CLAVE)
        self.socket = contexto.wrap_socket(self.socket, server_side=True)
        self.respuestas: list[tuple[int, Any, str]] = []
        self.peticiones: list[dict[str, Any]] = []
        self.espera_s = 0.0
        self.cortes = 0

    def handle_error(self, _peticion: object, _direccion: object) -> None:
        """Un cliente que se va antes de la respuesta es parte de las pruebas, no un fallo del servidor."""


class Manejador(BaseHTTPRequestHandler):
    """Anota cada petición y responde lo previsto; un corte cierra la conexión sin responder."""

    server: Servidor

    def log_message(self, *_argumentos: object) -> None:
        """Las pruebas leen la salida del cliente: el servidor no escribe en ella."""

    def _responder(self, estado: int, documento: Any, tipo: str = "application/json") -> None:  # noqa: ANN401
        cuerpo = documento if isinstance(documento, bytes) else json.dumps(documento).encode()
        self.send_response(estado)
        self.send_header("Content-Type", tipo)
        self.send_header("Content-Length", str(len(cuerpo)))
        self.end_headers()
        self.wfile.write(cuerpo)

    def do_GET(self) -> None:
        """Token del runner para la audiencia pedida."""
        url = urlsplit(self.path)
        self.server.peticiones.append(
            {
                "ruta": url.path,
                "consulta": dict(parse_qsl(url.query)),
                "autorizacion": self.headers.get("Authorization"),
                "agente": self.headers.get("User-Agent"),
            }
        )
        self._responder(200, {"value": TOKEN})

    def do_POST(self) -> None:
        """Reserva: la respuesta sale de la cola que prepara la prueba."""
        cuerpo = self.rfile.read(int(self.headers.get("Content-Length", "0")))
        self.server.peticiones.append(
            {
                "ruta": self.path,
                "cuerpo": json.loads(cuerpo),
                "autorizacion": self.headers.get("Authorization"),
            }
        )
        if self.server.cortes:
            self.server.cortes -= 1
            self.close_connection = True
            self.connection.close()
            return
        time.sleep(self.server.espera_s)
        estado, documento, tipo = self.server.respuestas.pop(0)
        self._responder(estado, documento, tipo)


class ReservaADemanda(unittest.TestCase):
    """Cada respuesta del servidor da un resultado del paso y ninguna saca el token del proceso."""

    def setUp(self) -> None:
        """Cada prueba tiene su servidor, su archivo de salidas y el entorno de un run a demanda."""
        self.servidor = Servidor()
        hilo = threading.Thread(target=self.servidor.serve_forever, daemon=True)
        hilo.start()
        self.addCleanup(hilo.join)
        self.addCleanup(self.servidor.server_close)
        self.addCleanup(self.servidor.shutdown)
        carpeta = tempfile.TemporaryDirectory()
        self.addCleanup(carpeta.cleanup)
        self.salidas = Path(carpeta.name) / "salidas"
        self.salidas.write_text("")
        puerto = self.servidor.server_address[1]
        self.origen = f"https://127.0.0.1:{puerto}"
        self.entorno = {
            "FARO_ACTUALIZACION_ORIGEN": self.origen,
            "FARO_ACCION": "actualizar-cursos",
            "ACTIONS_ID_TOKEN_REQUEST_URL": f"https://127.0.0.1:{puerto}/oidc?api-version=2.0",
            "ACTIONS_ID_TOKEN_REQUEST_TOKEN": CREDENCIAL,
            "GITHUB_OUTPUT": str(self.salidas),
        }

    def responder(self, estado: int, documento: Any, tipo: str = "application/json") -> None:  # noqa: ANN401
        """Pone en cola la respuesta del servidor a la siguiente reserva."""
        self.servidor.respuestas.append((estado, documento, tipo))

    def ejecutar(self, plazo_s: float = cliente.PLAZO_S, **entorno: str) -> tuple[int, str]:
        """Ejecuta el paso y comprueba que ni la credencial ni el token salen por ninguna vía.

        Returns:
            El código de salida y lo que el paso escribe en su salida.
        """
        salida, estandar, errores = io.StringIO(), io.StringIO(), io.StringIO()
        with redirect_stdout(estandar), redirect_stderr(errores):
            ajustes = cliente.Ajustes(ruta_ca=CERTIFICADO, plazo_s=plazo_s, espera_s=0)
            codigo = cliente.ejecutar({**self.entorno, **entorno}, salida, ajustes)
        for texto in (salida.getvalue(), estandar.getvalue(), errores.getvalue(), self.salidas.read_text()):
            self.assertNotIn(TOKEN, texto)
            self.assertNotIn(CREDENCIAL, texto)
        self.assertEqual(estandar.getvalue() + errores.getvalue(), "")
        return codigo, salida.getvalue()

    def test_una_reserva_aceptada_queda_como_salidas_del_paso(self) -> None:
        """El paso pide el token con la audiencia del permiso de inicio y deja la reserva para los pasos siguientes."""
        self.responder(200, {"estado": "reservada", "solicitudId": SOLICITUD, "revisionReserva": 7})
        self.assertEqual(self.ejecutar(), (0, "::notice title=Faro · reserva::aceptada estado=reservada\n"))
        self.assertEqual(self.salidas.read_text(), f"solicitud_id={SOLICITUD}\nrevision_reserva=7\n")
        oidc, reserva = self.servidor.peticiones
        self.assertEqual(oidc["ruta"], "/oidc")
        self.assertEqual(oidc["consulta"], {"api-version": "2.0", "audience": f"{self.origen}/mantenimiento/resultado"})
        self.assertEqual(oidc["autorizacion"], f"Bearer {CREDENCIAL}")
        self.assertEqual(
            oidc["agente"], json.loads((RAIZ / "config/identidad-web.json").read_text())["identidad"]["User-Agent"]
        )
        self.assertEqual(reserva["ruta"], "/mantenimiento/reserva")
        self.assertEqual(reserva["cuerpo"], {"operacion": "reservar", "accion": "actualizar-cursos"})
        self.assertEqual(reserva["autorizacion"], f"Bearer {TOKEN}")

    def test_una_reserva_repetida_da_la_misma_reserva(self) -> None:
        """Si el run ya tenía su reserva, el servidor la devuelve y el paso sigue igual."""
        self.responder(200, {"estado": "repetida", "solicitudId": SOLICITUD, "revisionReserva": 7})
        self.assertEqual(self.ejecutar(), (0, "::notice title=Faro · reserva::aceptada estado=repetida\n"))
        self.assertEqual(self.salidas.read_text(), f"solicitud_id={SOLICITUD}\nrevision_reserva=7\n")

    def test_cada_motivo_de_rechazo_termina_el_paso_con_su_aviso(self) -> None:
        """Un 409 con motivo conocido termina el run en este paso, sin salidas."""
        for motivo in cliente.MOTIVOS_DE_RECHAZO:
            with self.subTest(motivo=motivo):
                self.responder(409, {"error": motivo})
                aviso = f"::notice title=Faro · reserva::rechazada motivo={motivo}\n"
                self.assertEqual(self.ejecutar(), (SALIDA_RECHAZADA, aviso))
                self.assertEqual(self.salidas.read_text(), "")

    def test_401_y_404_terminan_con_el_mismo_error_sin_motivo(self) -> None:
        """Ni la identidad rechazada ni la vía deshabilitada se distinguen en la salida."""
        resultados = []
        for estado in (PROHIBIDO, INEXISTENTE):
            self.responder(estado, {"error": "no_autorizado"})
            resultados.append(self.ejecutar())
        self.assertEqual(resultados, [(SALIDA_ERROR, f"::error title=Faro · reserva::{cliente.NO_CONCEDIDA}\n")] * 2)
        self.assertEqual(self.salidas.read_text(), "")

    def test_una_respuesta_mal_formada_no_concede_la_reserva(self) -> None:
        """Cualquier desviación del contrato es un error, nunca una reserva ni un rechazo."""
        valida = {"estado": "reservada", "solicitudId": SOLICITUD, "revisionReserva": 7}
        casos = [
            (200, {**valida, "extra": 1}, "application/json"),
            (200, {**valida, "estado": "rechazada"}, "application/json"),
            (200, {**valida, "solicitudId": SOLICITUD.upper()}, "application/json"),
            (200, {**valida, "revisionReserva": True}, "application/json"),
            (200, {**valida, "revisionReserva": 0}, "application/json"),
            (200, valida, "text/plain"),
            (200, b'{"estado":"reservada","estado":"reservada"}', "application/json"),
            (200, b"no es json", "application/json"),
            (409, {"error": "otro"}, "application/json"),
            (409, {"error": "ocupado", "detalle": "x"}, "application/json"),
            (500, valida, "application/json"),
        ]
        for estado, documento, tipo in casos:
            with self.subTest(estado=estado, documento=documento, tipo=tipo):
                self.responder(estado, documento, tipo)
                self.assertEqual(
                    self.ejecutar(), (SALIDA_ERROR, f"::error title=Faro · reserva::{cliente.NO_CONCEDIDA}\n")
                )
                self.assertEqual(self.salidas.read_text(), "")

    def test_con_el_plazo_agotado_reintenta_una_vez_y_termina(self) -> None:
        """Un servidor que no responde a tiempo recibe dos intentos y el paso termina con error."""
        self.servidor.espera_s = ESPERA_LARGA_S
        valida = {"estado": "reservada", "solicitudId": SOLICITUD, "revisionReserva": 7}
        self.responder(200, valida)
        self.responder(200, valida)
        codigo, salida = self.ejecutar(plazo_s=PLAZO_CORTO_S)
        self.assertEqual((codigo, salida), (SALIDA_ERROR, f"::error title=Faro · reserva::{cliente.SIN_RESPUESTA}\n"))
        reservas = [p for p in self.servidor.peticiones if p["ruta"] == "/mantenimiento/reserva"]
        self.assertEqual(len(reservas), DOS_INTENTOS)
        self.assertEqual(self.salidas.read_text(), "")

    def test_un_corte_de_red_se_reintenta_una_sola_vez(self) -> None:
        """Tras un corte, el segundo intento pide un token nuevo y obtiene la reserva."""
        self.servidor.cortes = 1
        self.responder(200, {"estado": "repetida", "solicitudId": SOLICITUD, "revisionReserva": 7})
        self.assertEqual(self.ejecutar(), (0, "::notice title=Faro · reserva::aceptada estado=repetida\n"))
        self.assertEqual([p["ruta"] for p in self.servidor.peticiones], ["/oidc", "/mantenimiento/reserva"] * 2)

    def test_dos_cortes_terminan_sin_reserva(self) -> None:
        """Solo hay un reintento."""
        self.servidor.cortes = 2
        self.assertEqual(self.ejecutar(), (SALIDA_ERROR, f"::error title=Faro · reserva::{cliente.SIN_RESPUESTA}\n"))
        self.assertEqual(len(self.servidor.peticiones), 2 * DOS_INTENTOS)

    def test_una_accion_o_una_configuracion_no_admitida_no_llega_al_servidor(self) -> None:
        """Lo que no se puede pedir a demanda, o un origen dudoso, termina antes de cualquier petición."""
        casos = [
            ({"FARO_ACCION": "reintentar-pendientes"}, cliente.ACCION_NO_ADMITIDA),
            ({"FARO_ACCION": "comprobar-programada"}, cliente.ACCION_NO_ADMITIDA),
            ({"FARO_ACTUALIZACION_ORIGEN": self.origen.replace("https", "http")}, cliente.CONFIGURACION),
            ({"FARO_ACTUALIZACION_ORIGEN": f"{self.origen}/ruta"}, cliente.CONFIGURACION),
            ({"ACTIONS_ID_TOKEN_REQUEST_URL": f"{self.origen}/oidc?audience=otra"}, cliente.CONFIGURACION),
            ({"ACTIONS_ID_TOKEN_REQUEST_TOKEN": ""}, cliente.CONFIGURACION),
            ({"GITHUB_OUTPUT": ""}, cliente.CONFIGURACION),
        ]
        for entorno, mensaje in casos:
            with self.subTest(entorno=entorno):
                self.assertEqual(self.ejecutar(**entorno), (SALIDA_ERROR, f"::error title=Faro · reserva::{mensaje}\n"))
        self.assertEqual(self.servidor.peticiones, [])

    def test_la_activacion_consulta_la_reserva_de_su_run(self) -> None:
        """La consulta nunca reserva: envía la operación con la acción del run y acepta solo una reserva confirmada."""
        self.responder(200, {"estado": "reservada", "solicitudId": SOLICITUD, "revisionReserva": 9})
        ajustes = cliente.Ajustes(ruta_ca=CERTIFICADO, espera_s=0)
        self.assertEqual(cliente.reserva_del_run(self.entorno, ajustes), (SOLICITUD, "9"))
        self.assertEqual(
            self.servidor.peticiones[-1]["cuerpo"], {"operacion": "consultar", "accion": "actualizar-cursos"}
        )
        for estado, documento in ((409, {"error": "ocupado"}), (200, {"estado": "repetida"}), (INEXISTENTE, {})):
            with self.subTest(estado=estado), self.assertRaises(cliente.ReservaNoConcedida) as error:
                self.responder(estado, documento)
                cliente.reserva_del_run(self.entorno, ajustes)
            self.assertEqual(str(error.exception), cliente.NO_CONCEDIDA)

    def test_la_consulta_con_una_accion_no_admitida_no_llega_al_servidor(self) -> None:
        """La consulta comprueba la acción igual que la reserva, antes de pedir el token."""
        ajustes = cliente.Ajustes(ruta_ca=CERTIFICADO, espera_s=0)
        for accion in ("", "reintentar-pendientes", "comprobar-programada"):
            with self.subTest(accion=accion), self.assertRaises(cliente.ReservaNoConcedida) as error:
                cliente.reserva_del_run({**self.entorno, "FARO_ACCION": accion}, ajustes)
            self.assertEqual(str(error.exception), cliente.ACCION_NO_ADMITIDA)
        self.assertEqual(self.servidor.peticiones, [])

    def test_el_contrato_comun_con_el_servidor(self) -> None:
        """Cada caso del contrato: el cuerpo enviado es el del caso y su respuesta da el resultado previsto."""
        self.assertEqual(sorted(cliente.ACCIONES_A_DEMANDA), sorted(CONTRATO["acciones"]))
        self.assertEqual(sorted(cliente.MOTIVOS_DE_RECHAZO), sorted(CONTRATO["motivosDeRechazo"]))
        ajustes = cliente.Ajustes(ruta_ca=CERTIFICADO, espera_s=0)
        for caso in CONTRATO["casos"]:
            with self.subTest(caso=caso["nombre"]):
                peticion, respuesta = caso["peticion"], caso["respuesta"]
                entorno = {**self.entorno, "FARO_ACCION": peticion["accion"]}
                self.salidas.write_text("")
                self.responder(respuesta["estado"], respuesta["cuerpo"])
                if peticion["operacion"] == "reservar":
                    obtenido: object = self.ejecutar(**entorno)
                else:
                    try:
                        obtenido = cliente.reserva_del_run(entorno, ajustes)
                    except cliente.ReservaNoConcedida as error:
                        obtenido = str(error)
                self.assertEqual(self.servidor.peticiones[-1]["cuerpo"], peticion)
                self.assertEqual(obtenido, self.resultado_del_contrato(peticion["operacion"], respuesta))

    @staticmethod
    def resultado_del_contrato(operacion: str, respuesta: dict[str, Any]) -> object:
        """Lo que debe dar el cliente ante una respuesta del contrato.

        Returns:
            Para reservar, el código y el aviso del paso; para consultar, la reserva o el error.
        """
        cuerpo = respuesta["cuerpo"]
        if respuesta["estado"] == 200:  # noqa: PLR2004 - Estado HTTP del contrato.
            reserva = (cuerpo["solicitudId"], str(cuerpo["revisionReserva"]))
            aviso = f"::notice title=Faro · reserva::aceptada estado={cuerpo['estado']}\n"
            return (0, aviso) if operacion == "reservar" else reserva
        if operacion == "reservar":
            return (SALIDA_RECHAZADA, f"::notice title=Faro · reserva::rechazada motivo={cuerpo['error']}\n")
        return cliente.NO_CONCEDIDA

    def test_el_paso_se_ejecuta_aislado_solo_con_la_biblioteca_estandar(self) -> None:
        """Aislado y sin entorno, el guion arranca, no importa nada del proyecto y termina con su error."""
        resultado = subprocess.run(
            orden_de_guion_sin_red(sys.executable, Path(cliente.__file__)),
            env={"PATH": os.defpath},
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
        self.assertEqual(resultado.returncode, SALIDA_ERROR, resultado.stderr)
        self.assertEqual(resultado.stdout, f"::error title=Faro · reserva::{cliente.ACCION_NO_ADMITIDA}\n")
        self.assertEqual(resultado.stderr, "")


if __name__ == "__main__":
    unittest.main()
