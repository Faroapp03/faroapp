"""Cliente HTTP real con frontera final interceptada: cero sockets, JWT ficticios y cuota de peticiones."""

import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from typing import Any
from unittest import mock
from urllib.parse import parse_qsl, urlencode

from urllib3.connection import HTTPConnection
from urllib3.connectionpool import HTTPConnectionPool
from urllib3.exceptions import ReadTimeoutError
from urllib3.response import HTTPResponse

from plataforma_datos.comun import perfil_web, red
from plataforma_datos.orquestacion import cliente_mantenimiento as cliente

AGENTE_PRUEBA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36"
)

ORIGEN = "https://panel.example.test"
OIDC = "https://pipelines.example.test/runner/oidc?api-version=2.0&x=a%20b"
CREDENCIAL = "credencial-privada-ficticia-solicitud"
ID = "11111111-1111-4111-8111-111111111111"
VERSION_ID = "01234567-89ab-0000-0000-0123456789ab"
JWT_UNO = "cabecera_uno.cuerpo_uno.firma_uno"
JWT_DOS = "cabecera_dos.cuerpo_dos.firma_dos"
RECIBO = b' { "version": 1, "fixture": true }\n'


def documento(valor: object) -> bytes:
    """JSON sintético para la respuesta del emisor o del receptor.

    Returns:
        Bytes UTF-8 de fixture.
    """
    return json.dumps(valor, separators=(",", ":")).encode()


class PruebaClienteMantenimiento(unittest.TestCase):
    """Comprueba las peticiones que prepara urllib3 y cada confirmación observable."""

    def setUp(self) -> None:
        """Intercepta la última operación HTTP antes de abrir un socket."""
        self.instante = 0.0
        self.esperas: list[float] = []
        pausas = red.PausasPorDominio(lambda: self.instante, self.dormir)
        parche_pausas = mock.patch.object(red, "PAUSAS", pausas)
        parche_pausas.start()
        self.addCleanup(parche_pausas.stop)
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        hogar = Path(temporal.name)
        self.identidad = hogar / "identidad-web.json"
        self.identidad.write_text(
            json.dumps({"version": 1, "identidad": perfil_web.identidad_publica(perfil_web.perfil_chrome())})
        )
        self.identidad_original = self.identidad.read_bytes()
        parche_hogar = mock.patch.object(perfil_web, "RUTA_IDENTIDAD", self.identidad)
        parche_hogar.start()
        self.addCleanup(parche_hogar.stop)
        self.pasos: list[tuple[int, bytes, dict[str, str]] | Exception] = []
        self.peticiones: list[dict[str, Any]] = []
        self.respuestas: list[HTTPResponse] = []
        self.cuerpos: list[io.BytesIO] = []
        parche = mock.patch.object(HTTPConnectionPool, "_make_request", autospec=True, side_effect=self.atender)
        self.http = parche.start()
        self.addCleanup(parche.stop)
        self.instancia = cliente.ClienteMantenimientoGitHub(ORIGEN, OIDC, CREDENCIAL)
        self.addCleanup(self.instancia.close)

    def dormir(self, segundos: float) -> None:
        """Adelanta el reloj del limitador compartido sin esperar tiempo real."""
        self.esperas.append(segundos)
        self.instante += segundos

    def atender(
        self, pool: HTTPConnectionPool, conexion: HTTPConnection, metodo: str, url: str, **opciones: object
    ) -> HTTPResponse:
        """La cuota finita hace fallar cualquier redirect o reintento no esperado.

        Returns:
            Respuesta urllib3 verdadera sobre un buffer pequeño en RAM.
        """
        for nombre, valor in perfil_web.identidad_publica(perfil_web.perfil_chrome()).items():
            self.assertEqual(opciones["headers"][nombre], valor)
        self.assertNotIn("Accept-Language", opciones["headers"])
        self.assertLess(len(self.peticiones), len(self.pasos), "Se excedió la cuota de peticiones")
        paso = self.pasos[len(self.peticiones)]
        self.peticiones.append({"metodo": metodo, "host": pool.host, "url": url, **opciones})
        if isinstance(paso, Exception):
            raise paso
        estado, contenido, headers = paso
        cabeceras = {"content-type": "application/json", "content-length": str(len(contenido)), **headers}
        cuerpo = io.BytesIO(contenido)
        respuesta = HTTPResponse(
            body=cuerpo,
            status=estado,
            headers=cabeceras,
            preload_content=False,
            decode_content=False,
            connection=conexion,
            pool=pool,
            request_method=metodo,
        )
        self.cuerpos.append(cuerpo)
        self.respuestas.append(respuesta)
        return respuesta

    def exito(self, token: str = JWT_UNO, estado: str = "aplicado") -> None:
        """Añade exactamente las dos peticiones de una fase confirmada."""
        self.pasos.extend([(200, documento({"value": token}), {}), (200, documento({"estado": estado}), {})])

    def fallo(self) -> None:
        """Ningún error devuelve autorización ni deja una respuesta abierta."""
        with self.assertRaisesRegex(cliente.ErrorMantenimiento, f"^{cliente.ERROR_GENERICO}$"):
            self.instancia.confirmar_inicio(ID, 1, "actualizar-datos")
        self.assertTrue(all(cuerpo.closed for cuerpo in self.cuerpos))

    def fallo_observacion(self) -> None:
        """Un GET ambiguo no identifica una construcción ni deja conexiones abiertas."""
        with self.assertRaisesRegex(cliente.ErrorMantenimiento, f"^{cliente.ERROR_GENERICO}$"):
            self.instancia.observar_construccion()
        self.assertTrue(all(cuerpo.closed for cuerpo in self.cuerpos))

    def test_oidc_y_callback_comparten_turno_y_cierre_del_dominio(self) -> None:
        """Emisor y llamada de retorno en un mismo dominio esperan tras el cierre efectivo de cada cuerpo."""
        inicios = []
        atender = self.atender

        def responder(*args: object, **opciones: object) -> HTTPResponse:
            inicios.append(self.instante)
            respuesta = atender(*args, **opciones)
            cerrar = respuesta.close

            def cierre() -> None:
                self.instante += 3
                cerrar()

            respuesta.close = cierre
            return respuesta

        self.http.side_effect = responder
        self.exito()
        with cliente.ClienteMantenimientoGitHub(ORIGEN, ORIGEN + "/oidc", CREDENCIAL) as instancia:
            instancia.confirmar_inicio(ID, 1, "actualizar-datos")
        self.assertEqual(inicios, [0, 5])
        self.assertEqual(self.esperas, [2])
        self.assertTrue(all(c.closed for c in self.cuerpos))

    def test_manifiesto_redirect_fallido_libera_turno_sin_salto(self) -> None:
        """Un rechazo público no sigue Location y conserva pausa antes de volver al mismo host."""
        contenido = b"manifiesto local"
        self.pasos = [(307, b"", {"location": "https://ajeno.test"}), (200, contenido, {})]
        with self.assertRaises(cliente.ErrorMantenimiento):
            self.instancia.comprobar_manifiesto_web(
                "https://publico.test", cliente.hashlib.sha256(contenido).hexdigest()
            )
        self.instancia.comprobar_manifiesto_web("https://publico.test", cliente.hashlib.sha256(contenido).hexdigest())
        self.assertEqual(len(self.peticiones), 2)
        self.assertTrue(all(p["host"] == "publico.test" for p in self.peticiones))
        self.assertEqual(self.esperas, [2])
        self.assertTrue(all(c.closed for c in self.cuerpos))

    def test_espera_oidc_no_renueva_presupuesto_antes_callback(self) -> None:
        """El plazo de fase incluye la espera por el mismo dominio; un POST vencido no se envía."""
        self.exito()
        with (
            cliente.ClienteMantenimientoGitHub(ORIGEN, ORIGEN + "/oidc", CREDENCIAL) as instancia,
            mock.patch.object(cliente.time, "monotonic", side_effect=lambda: self.instante),
            mock.patch.object(cliente, "PLAZO_FASE_S", 1),
            self.assertRaises(cliente.ErrorMantenimiento),
        ):
            instancia.confirmar_inicio(ID, 1, "actualizar-datos")
        self.assertEqual(len(self.peticiones), 1)
        self.assertEqual(self.esperas, [2])

    def test_identidad_invalida_no_crea_transporte(self) -> None:
        """Una identidad con datos ajenos al navegador falla antes de crear el cliente HTTP."""
        self.identidad.write_text('user-agent = "AgentePrivado"\n')
        with mock.patch.object(cliente.urllib3, "PoolManager") as crear, self.assertRaises(cliente.ErrorMantenimiento):
            cliente.ClienteMantenimientoGitHub(ORIGEN, OIDC, CREDENCIAL)
        crear.assert_not_called()
        self.assertEqual(self.peticiones, [])

    def test_configuracion_identidad_se_conserva_al_confirmar(self) -> None:
        """La lectura de identidad no modifica el archivo ni cambia autenticación o audiencia."""
        self.exito()
        self.instancia.confirmar_inicio(ID, 1, "actualizar-datos")
        self.assertTrue(all(p["headers"]["User-Agent"] == AGENTE_PRUEBA for p in self.peticiones))
        self.assertEqual(self.identidad.read_bytes(), self.identidad_original)

    def test_observar_version_get_exacto_tokens_frescos_sin_cuerpo(self) -> None:
        """La metadata usa otro GET con JWT nuevo y conserva la cota OIDC de 32 KiB."""
        for token in (JWT_UNO, JWT_DOS):
            self.pasos.extend(
                [
                    (200, documento({"value": token, "metadata": "x" * 2048}), {}),
                    (200, documento({"version": 1, "versionId": VERSION_ID}), {}),
                ]
            )
            self.assertEqual(self.instancia.observar_construccion(), VERSION_ID)
        for peticion, token in zip(self.peticiones[1::2], (JWT_UNO, JWT_DOS), strict=True):
            self.assertEqual(peticion["metodo"], "GET")
            self.assertEqual(peticion["host"], "panel.example.test")
            self.assertEqual(peticion["url"], cliente.RUTA_CONSTRUCCION)
            self.assertIsNone(peticion["body"])
            self.assertEqual(peticion["headers"]["Authorization"], f"Bearer {token}")
            self.assertEqual(peticion["headers"]["User-Agent"], AGENTE_PRUEBA)
            self.assertEqual(peticion["headers"]["Accept-Encoding"], "identity")
            self.assertNotIn("Content-Type", peticion["headers"])
            self.assertNotIn(token, self.instancia.__dict__.values())
        for peticion in self.peticiones[::2]:
            query = dict(parse_qsl(peticion["url"].split("?", 1)[1]))
            self.assertEqual(query["audience"], ORIGEN + cliente.RUTA_RESULTADO)
            self.assertEqual(peticion["headers"]["Authorization"], f"Bearer {CREDENCIAL}")
        self.assertEqual(len(self.peticiones), 4)
        self.assertEqual(self.instancia._http.connection_pool_kw["cert_reqs"], cliente.ssl.CERT_REQUIRED)
        contexto = self.instancia._http.connection_pool_kw["ssl_context"]
        self.assertTrue(contexto.check_hostname)
        self.assertEqual(contexto.verify_mode, cliente.ssl.CERT_REQUIRED)
        self.assertTrue(all(cuerpo.closed for cuerpo in self.cuerpos))

    def test_observar_exige_objeto_version_uuid_cerrados(self) -> None:
        """No interpreta tags, fechas, booleanos ni UUID normalizados como identidad ejecutada."""
        valido = {"version": 1, "versionId": VERSION_ID}
        cuerpos = [
            documento(valor)
            for valor in (
                {},
                [],
                valido | {"tag": "otro"},
                valido | {"timestamp": "2026-10-17"},
                valido | {"version": True},
                valido | {"version": 1.0},
                valido | {"version": 2},
                valido | {"versionId": VERSION_ID.upper()},
                valido | {"versionId": "no-uuid"},
                valido | {"versionId": ID + "\n"},
                valido | {"versionId": 1},
            )
        ]
        cuerpos.extend([b'{"version":1,"version":1,"versionId":"' + VERSION_ID.encode() + b'"}', b"\xff", b"{"])
        for cuerpo in cuerpos:
            with self.subTest(cuerpo=cuerpo[:60]):
                self.pasos = [(200, documento({"value": JWT_UNO}), {}), (200, cuerpo, {})]
                self.peticiones.clear()
                self.fallo_observacion()
                self.assertEqual(len(self.peticiones), 2)

    def test_observar_cota_metadata_un_kib_header_y_stream(self) -> None:
        """Un GET de metadata no hereda la cota mayor de la respuesta OIDC."""
        for sin_longitud in (False, True):
            self.pasos = [
                (200, documento({"value": JWT_UNO}), {}),
                (200, b"x" * (cliente.MAX_CONSTRUCCION_BYTES + 1), {}),
            ]
            self.peticiones.clear()

            def atender(*args: object, sin_longitud: bool = sin_longitud, **kwargs: object) -> HTTPResponse:
                respuesta = self.atender(*args, **kwargs)
                if sin_longitud and self.peticiones[-1]["url"] == cliente.RUTA_CONSTRUCCION:
                    del respuesta.headers["content-length"]
                    respuesta.length_remaining = None
                return respuesta

            self.http.side_effect = atender
            with self.subTest(sin_longitud=sin_longitud):
                self.fallo_observacion()
            self.assertEqual(len(self.peticiones), 2)

    def test_observar_errores_redirect_y_timeout_sin_reenvio(self) -> None:
        """No sigue Location ni repite GET; ningún error refleja la credencial."""
        pasos = [(status, b"{}", {"location": "https://otro.test/robar"}) for status in (301, 307, 401, 503, 504)]
        pasos.append(ReadTimeoutError(None, None, CREDENCIAL))
        for paso in pasos:
            self.pasos = [(200, documento({"value": JWT_UNO}), {}), paso]
            self.peticiones.clear()
            with self.subTest(paso=repr(paso)):
                self.fallo_observacion()
            self.assertEqual(len(self.peticiones), 2)

    def test_observar_plazo_unico_token_y_metadata_tardia(self) -> None:
        """Los 15 s incluyen obtener JWT y leer metadata; no se renuevan entre GET."""
        for fase in (1, 2):
            self.pasos = [
                (200, documento({"value": JWT_UNO}), {}),
                (200, documento({"version": 1, "versionId": VERSION_ID}), {}),
            ]
            self.peticiones.clear()
            reloj = [0.0]

            def lento(*args: object, fase: int = fase, reloj: list[float] = reloj, **kwargs: object) -> HTTPResponse:
                respuesta = self.atender(*args, **kwargs)
                if len(self.peticiones) == fase:
                    reloj[0] = cliente.PLAZO_FASE_S + 1
                return respuesta

            self.http.side_effect = lento
            with (
                self.subTest(fase=fase),
                mock.patch.object(cliente.time, "monotonic", side_effect=lambda reloj=reloj: reloj[0]),
            ):
                self.fallo_observacion()
            self.assertEqual(len(self.peticiones), fase)

    def test_dos_fases_tokens_frescos_misma_audiencia_y_bytes_exactos(self) -> None:
        """El token del runner solo viaja al emisor; cada POST usa un JWT nuevo."""
        self.exito(JWT_UNO)
        self.exito(JWT_DOS, "repetido")
        self.assertEqual(self.instancia.confirmar_inicio(ID, 1, "actualizar-datos"), "aplicado")
        self.assertEqual(self.instancia.enviar_resultado(RECIBO), "repetido")
        self.assertEqual(len(self.peticiones), 4)
        for peticion in self.peticiones:
            self.assertEqual(peticion["headers"]["User-Agent"], AGENTE_PRUEBA)
            self.assertEqual(peticion["headers"]["Accept-Encoding"], "identity")
        for peticion in self.peticiones[::2]:
            self.assertEqual(peticion["metodo"], "GET")
            self.assertEqual(peticion["host"], "pipelines.example.test")
            self.assertTrue(peticion["url"].startswith("/runner/oidc?api-version=2.0&x=a%20b&"))
            self.assertEqual(
                dict(parse_qsl(peticion["url"].split("?", 1)[1]))["audience"], ORIGEN + cliente.RUTA_RESULTADO
            )
            self.assertEqual(peticion["headers"]["Authorization"], f"Bearer {CREDENCIAL}")
        inicio, resultado = self.peticiones[1::2]
        self.assertEqual(inicio["url"], cliente.RUTA_INICIO)
        self.assertEqual(
            json.loads(inicio["body"]), {"solicitudId": ID, "revisionReserva": 1, "accion": "actualizar-datos"}
        )
        self.assertEqual(inicio["headers"]["Authorization"], f"Bearer {JWT_UNO}")
        self.assertEqual(resultado["url"], cliente.RUTA_RESULTADO)
        self.assertEqual(resultado["body"], RECIBO)
        self.assertEqual(resultado["headers"]["Authorization"], f"Bearer {JWT_DOS}")
        self.assertTrue(all(cuerpo.closed for cuerpo in self.cuerpos))
        for secreto in (CREDENCIAL, JWT_UNO, JWT_DOS):
            self.assertNotIn(secreto, repr(self.instancia))
        self.assertNotIn(JWT_UNO, self.instancia.__dict__.values())
        self.assertNotIn(JWT_DOS, self.instancia.__dict__.values())

    def test_query_audience_previa_igual_no_se_duplica(self) -> None:
        """Conserva la query previa sin normalizarla ni añadir una segunda audiencia."""
        url = OIDC + "&" + urlencode({"audience": ORIGEN + cliente.RUTA_RESULTADO})
        with cliente.ClienteMantenimientoGitHub(ORIGEN, url, CREDENCIAL) as instancia:
            self.exito()
            instancia.confirmar_inicio(ID, 1, "reintentar-pendientes")
        query = self.peticiones[0]["url"].split("?", 1)[1]
        self.assertEqual(query, url.split("?", 1)[1])
        self.assertEqual(sum(clave == "audience" for clave, _ in parse_qsl(query)), 1)

    def test_configuracion_invalida_no_crea_cliente_ni_pide(self) -> None:
        """URL canónica, HTTPS y credencial explícita se validan antes de la red."""
        valores = [
            (origen, OIDC, CREDENCIAL)
            for origen in (
                "http://panel.test",
                ORIGEN + "/",
                ORIGEN + "/ruta",
                ORIGEN + "?q=1",
                ORIGEN + "#x",
                "https://user:pass@panel.test",
                "https://Panel.test",
                "https://panel.test:443",
                "https://panel.test:0",
            )
        ]
        valores += [
            (ORIGEN, url, CREDENCIAL)
            for url in (
                "http://runner.test/token",
                "https://user@runner.test/token",
                OIDC + "#fragmento",
                OIDC + "&audience=otra",
                OIDC + "&audience=x&audience=y",
            )
        ]
        valores += [
            (ORIGEN, OIDC, token) for token in ("", "credencial\n", "con espacio", "x" * (cliente.MAX_TOKEN_BYTES + 1))
        ]
        with mock.patch.object(cliente.urllib3, "PoolManager") as gestor:
            for origen, url, token in valores:
                with self.subTest(origen=origen, url=url), self.assertRaises(cliente.ErrorMantenimiento):
                    cliente.ClienteMantenimientoGitHub(origen, url, token)
            gestor.assert_not_called()
        self.assertEqual(self.peticiones, [])

    def test_argumentos_inicio_y_resultado_rechazan_antes_del_token(self) -> None:
        """No envía acciones libres, revisiones inseguras o cuerpos fuera de cuota."""
        for identificador, revision, accion in (
            ("no-uuid", 1, "actualizar-datos"),
            (ID, True, "actualizar-datos"),
            (ID, 0, "actualizar-datos"),
            (ID, cliente.MAX_REVISION + 1, "actualizar-datos"),
            (ID, 1, "shell"),
        ):
            with self.subTest(accion=accion), self.assertRaises(cliente.ErrorMantenimiento):
                self.instancia.confirmar_inicio(identificador, revision, accion)
        for cuerpo in (b"", "texto", bytearray(b"{}"), b"x" * (cliente.MAX_RESULTADO_BYTES + 1)):
            with self.subTest(tipo=type(cuerpo)), self.assertRaises(cliente.ErrorMantenimiento):
                self.instancia.enviar_resultado(cuerpo)
        self.assertEqual(self.peticiones, [])

    def test_errores_y_redirecciones_oidc_no_envian_post(self) -> None:
        """Un Location nunca recibe la credencial y no se reintenta una respuesta fallida."""
        for status in (301, 302, 307, 308, 401, 409, 500, 503):
            with self.subTest(status=status):
                self.pasos = [(status, b"{}", {"location": "https://otro.test/robar"})]
                self.peticiones.clear()
                self.fallo()
                self.assertEqual(len(self.peticiones), 1)

    def test_respuesta_oidc_exige_value_y_token_forma_limite(self) -> None:
        """Un JWT solo es un valor compacto acotado; su autenticación corresponde al receptor."""
        cuerpos = [
            documento(valor)
            for valor in (
                {},
                [],
                {"value": 1},
                {"value": "sin-puntos"},
                {"value": "a.b.c\n"},
                {"value": "a" * cliente.MAX_TOKEN_BYTES + ".b.c"},
            )
        ]
        cuerpos += [b'{"value":"a.b.c","value":"x.y.z"}', b"\xff", b"{", b'{"value":NaN}']
        for cuerpo in cuerpos:
            with self.subTest(cuerpo=cuerpo[:40]):
                self.pasos = [(200, cuerpo, {})]
                self.peticiones.clear()
                self.fallo()
                self.assertEqual(len(self.peticiones), 1)

    def test_metadata_oidc_valida_se_ignora_como_en_toolkit_oficial(self) -> None:
        """La respuesta externa puede incluir metadata, conservando value válido y único."""
        self.pasos = [
            (200, documento({"value": JWT_UNO, "count": 1, "metadata": {"tipo": "token"}}), {}),
            (200, documento({"estado": "aplicado"}), {}),
        ]
        self.assertEqual(self.instancia.confirmar_inicio(ID, 1, "actualizar-datos"), "aplicado")
        self.assertEqual(len(self.peticiones), 2)
        self.assertEqual(self.peticiones[1]["headers"]["Authorization"], f"Bearer {JWT_UNO}")
        self.assertTrue(all(cuerpo.closed for cuerpo in self.cuerpos))

    def test_confirmacion_solo_200_estado_cerrado_aplicado_o_repetido(self) -> None:
        """Errores del receptor o respuestas ambiguas no autorizan ni reenviarán el motor."""
        casos = [(status, documento({"estado": "aplicado"}), {}) for status in (201, 202, 301, 307, 401, 409, 500, 504)]
        casos += [
            (200, documento(valor), {})
            for valor in ({}, [], {"estado": "otro"}, {"estado": True}, {"estado": "aplicado", "extra": True})
        ]
        casos += [(200, b'{"estado":"aplicado","estado":"repetido"}', {}), (200, b"\xff", {})]
        for paso in casos:
            with self.subTest(paso=paso[0]):
                self.pasos = [(200, documento({"value": JWT_UNO}), {}), paso]
                self.peticiones.clear()
                self.fallo()
                self.assertEqual(len(self.peticiones), 2)

    def test_mime_compresion_longitud_y_stream_acotados_se_cierran(self) -> None:
        """Ni el header ni un stream sin longitud permiten superar el máximo."""
        casos = [
            (documento({"value": JWT_UNO}), {"content-type": "text/html"}),
            (documento({"value": JWT_UNO}), {"content-encoding": "gzip"}),
            (b"{}", {"content-length": str(cliente.MAX_RESPUESTA_OIDC + 1)}),
            (b"{}", {"content-length": "1,1"}),
            (b"{}", {"content-length": "3"}),
            (b"x" * (cliente.MAX_RESPUESTA_OIDC + 1), {"content-length": ""}),
        ]
        for cuerpo, headers in casos:
            with self.subTest(headers=headers):
                self.pasos = [(200, cuerpo, headers)]
                self.peticiones.clear()
                self.fallo()
        self.assertTrue(all(cuerpo.closed for cuerpo in self.cuerpos))

    def test_cuerpo_sin_longitud_sigue_acotado(self) -> None:
        """El límite se aplica contando bytes incluso si el servidor omite Content-Length."""
        self.pasos = [(200, b"x" * (cliente.MAX_RESPUESTA_OIDC + 1), {})]
        atender = self.atender

        def sin_longitud(*args: object, **kwargs: object) -> HTTPResponse:
            respuesta = atender(*args, **kwargs)
            del respuesta.headers["content-length"]
            respuesta.length_remaining = None
            return respuesta

        self.http.side_effect = sin_longitud
        self.fallo()
        self.assertEqual(len(self.peticiones), 1)

    def test_timeout_no_autoriza_y_no_reintenta(self) -> None:
        """Un fallo de lectura se comunica sin URL, credencial ni JWT."""
        self.pasos = [ReadTimeoutError(None, None, CREDENCIAL)]
        self.fallo()
        self.assertEqual(len(self.peticiones), 1)

    def test_presupuesto_agotado_antes_post_y_confirmacion_tardia(self) -> None:
        """Una respuesta después del plazo jamás concede permiso al motor."""
        for fase in ("token", "confirmacion"):
            with self.subTest(fase=fase):
                self.exito()
                self.peticiones.clear()
                reloj = [0.0]

                def lento(
                    *args: object, reloj: list[float] = reloj, fase: str = fase, **kwargs: object
                ) -> HTTPResponse:
                    respuesta = self.atender(*args, **kwargs)
                    if len(self.peticiones) == (1 if fase == "token" else 2):
                        reloj[0] = cliente.PLAZO_FASE_S + 1
                    return respuesta

                self.http.side_effect = lento
                with mock.patch.object(cliente.time, "monotonic", side_effect=lambda reloj=reloj: reloj[0]):
                    self.fallo()
                self.assertEqual(len(self.peticiones), 1 if fase == "token" else 2)
                self.pasos.clear()

    def test_tls_verificado_y_proxy_ambiental_no_se_utiliza(self) -> None:
        """La conexión va al destino explícito y conserva TLS, sin perfiles del entorno."""
        self.exito()
        with mock.patch.dict(
            os.environ, {"HTTPS_PROXY": "http://no-usar.invalid", "HTTP_PROXY": "http://no-usar.invalid"}
        ):
            self.instancia.confirmar_inicio(ID, 1, "actualizar-datos")
        self.assertEqual(self.instancia._http.connection_pool_kw["cert_reqs"], cliente.ssl.CERT_REQUIRED)
        contexto = self.instancia._http.connection_pool_kw["ssl_context"]
        self.assertTrue(contexto.check_hostname)
        self.assertEqual(contexto.verify_mode, cliente.ssl.CERT_REQUIRED)
        self.assertEqual([p["host"] for p in self.peticiones], ["pipelines.example.test", "panel.example.test"])

    def test_activacion_oidc_fresco_respuesta_grande_y_operaciones_cerradas(self) -> None:
        """La activación reutiliza audiencia y transporte, con cota independiente de 16 KiB."""
        estado = {"version": 1, "revision": 0, "ultimaActivacion": None, "fixture": "x" * 2048}
        for operacion, solicitud, acuse in (
            ("leer", None, "leido"),
            ("reservar", {"fixture": 1}, "aplicado"),
            ("leer-recuperacion", None, "leido"),
            ("recuperar", {"fixture": 1}, "aplicado"),
            ("paso-recuperacion", {"fixture": 1}, "conflicto"),
        ):
            respuesta = {"estado": acuse, "activacion": estado}
            self.pasos.extend([(200, documento({"value": JWT_UNO}), {}), (200, documento(respuesta), {})])
            self.assertEqual(self.instancia.activacion(operacion, solicitud), respuesta)
            peticion = self.peticiones[-1]
            self.assertEqual(peticion["url"], cliente.RUTA_ACTIVACION)
            self.assertEqual(peticion["headers"]["User-Agent"], AGENTE_PRUEBA)
            esperado = {"operacion": operacion}
            if solicitud is not None:
                esperado["solicitud"] = solicitud
            self.assertEqual(json.loads(peticion["body"]), esperado)
        with self.assertRaises(cliente.ErrorMantenimiento):
            self.instancia.activacion("shell", {})
        self.assertEqual(len(self.peticiones), 10)

    def test_activacion_ambigua_excesiva_y_redirect_no_reintentan(self) -> None:
        """Una respuesta no confirmada no concede permiso ni duplica la petición."""
        for paso in (
            (200, documento({"estado": "aplicado", "activacion": {}}), {}),
            (200, b"x" * (cliente.MAX_ACTIVACION_BYTES + 1), {}),
            (307, b"{}", {"location": "https://ajeno.test"}),
        ):
            self.pasos = [(200, documento({"value": JWT_UNO}), {}), paso]
            self.peticiones.clear()
            with self.subTest(paso=paso[0]), self.assertRaises(cliente.ErrorMantenimiento):
                self.instancia.activacion("leer")
            self.assertEqual(len(self.peticiones), 2)

    def test_manifiesto_web_literal_sin_credenciales_y_sin_solicitud_oidc(self) -> None:
        """Los recursos estáticos públicos reciben únicamente la identidad configurada y se cotejan bytes exactos."""
        contenido = b' {"fixture": true}\n'
        self.pasos = [(200, contenido, {"content-type": "application/octet-stream"})]
        self.instancia.comprobar_manifiesto_web("https://publico.test", cliente.hashlib.sha256(contenido).hexdigest())
        self.assertEqual(len(self.peticiones), 1)
        peticion = self.peticiones[0]
        self.assertEqual(peticion["host"], "publico.test")
        self.assertEqual(peticion["url"], "/firmas/manifiesto.json")
        self.assertEqual(peticion["headers"]["User-Agent"], AGENTE_PRUEBA)
        self.assertNotIn("Authorization", peticion["headers"])
        self.assertTrue(self.cuerpos[-1].closed)
        for paso in (
            (200, contenido + b" ", {}),
            (307, contenido, {"location": "https://ajeno.test"}),
            (200, contenido, {"content-encoding": "gzip"}),
        ):
            self.pasos, self.peticiones = [paso], []
            with self.subTest(paso=paso[0]), self.assertRaises(cliente.ErrorMantenimiento):
                self.instancia.comprobar_manifiesto_web(
                    "https://publico.test", cliente.hashlib.sha256(contenido).hexdigest()
                )
            self.assertEqual(len(self.peticiones), 1)
        for origen in ("http://publico.test", "https://publico.test/", "https://publico.test?q=x"):
            self.peticiones.clear()
            with self.assertRaises(cliente.ErrorMantenimiento):
                self.instancia.comprobar_manifiesto_web(origen, "a" * 64)
            self.assertEqual(self.peticiones, [])

    def test_close_idempotente_contexto_y_operaciones_cerradas(self) -> None:
        """Cerrar retira la credencial de la instancia y no la reabre al reutilizarla."""
        with mock.patch.object(self.instancia._http, "clear", wraps=self.instancia._http.clear) as cerrar:
            with self.instancia:
                self.assertNotIn(CREDENCIAL, repr(self.instancia))
            self.instancia.close()
            cerrar.assert_called_once()
        self.assertEqual(self.instancia._token_solicitud, "")
        with self.assertRaises(cliente.ErrorMantenimiento):
            self.instancia.enviar_resultado(RECIBO)
        with self.assertRaises(cliente.ErrorMantenimiento):
            self.instancia.observar_construccion()
        with self.assertRaises(cliente.ErrorMantenimiento):
            self.instancia.__enter__()
        self.assertEqual(self.peticiones, [])


if __name__ == "__main__":
    unittest.main()
