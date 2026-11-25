"""SDK S3 real con respuestas locales interceptadas y Stubber, nunca sockets de red ni credenciales reales."""

import hashlib
import io
import json
import os
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest import mock

import boto3
import botocore.configloader
import botocore.credentials
from botocore.awsrequest import AWSResponse
from botocore.exceptions import EndpointConnectionError, ReadTimeoutError
from botocore.response import StreamingBody
from botocore.stub import ANY, Stubber
from urllib3.response import HTTPResponse

from plataforma_datos.comun import perfil_web, red
from plataforma_datos.orquestacion import almacen_s3 as s3
from plataforma_datos.orquestacion import cliente_s3
from plataforma_datos.orquestacion import diario_mantenimiento as diario
from plataforma_datos.orquestacion.configuracion_almacen_s3 import AlmacenS3Invalido, ConfiguracionAlmacenS3

AGENTE_PRUEBA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36"
)

CONTENIDO = "Edición sintética Año 2026".encode()
HUELLA = hashlib.sha256(CONTENIDO).hexdigest()
VACIO = hashlib.sha256(b"").hexdigest()
OTRA_HUELLA = "0" * 64
CLAVE = f"blobs/{HUELLA}"
BUCKET = "privado-prueba"
PREFIJO = "entidad/ejecutor"


def configuracion(**cambios: object) -> ConfiguracionAlmacenS3:
    """Configuración fija sintética que no puede identificar una cuenta real.

    Returns:
        Configuración explícita para el cliente privado de cada prueba.
    """
    valores = {
        "endpoint": "https://almacen.example",
        "bucket": BUCKET,
        "prefijo": PREFIJO,
        "region": "auto",
        "access_key_id": "AKIDSINTETICA",
        "secret_access_key": "secreto-sintetico-no-real",
    }
    return ConfiguracionAlmacenS3(**(valores | cambios))


class Cuerpo(io.BytesIO):
    """Stream acotado de prueba con la misma operación pública de timeout que StreamingBody."""

    def __init__(self, contenido: bytes) -> None:
        super().__init__(contenido)
        self.plazos: list[float] = []

    def set_socket_timeout(self, plazo: float) -> None:
        """Registra el plazo solicitado antes de cada lectura."""
        self.plazos.append(plazo)


def respuesta(cuerpo: Cuerpo, longitud: int | None = None) -> dict:
    """Respuesta GET del SDK suministrada por Stubber.

    Returns:
        Cuerpo real de bytes y tamaño declarado para probar el cotejo independiente del ETag.
    """
    return {"Body": cuerpo, "ContentLength": len(cuerpo.getvalue()) if longitud is None else longitud}


def parametros_get(clave: str = CLAVE) -> dict:
    """Clave privada completa que debe solicitar el SDK.

    Returns:
        Bucket y clave, sin otros parámetros o cambios de proveedor.
    """
    return {"Bucket": BUCKET, "Key": f"{PREFIJO}/{clave}"}


def parametros_put(clave: str = CLAVE, contenido: bytes = CONTENIDO) -> dict:
    """Parámetros del único PUT condicional permitido.

    Returns:
        Cuerpo de archivo privado, tamaño exacto y precondición no-clobber.
    """
    return {**parametros_get(clave), "Body": ANY, "ContentLength": len(contenido), "IfNoneMatch": "*"}


def http(request: object, estado: int, contenido: bytes = b"") -> AWSResponse:
    """Crea la respuesta HTTP del SDK sin conexión.

    Returns:
        AWSResponse que atraviesa los handlers y el parser reales del cliente.
    """
    return AWSResponse(
        request.url,
        estado,
        {"content-length": str(len(contenido))},
        HTTPResponse(body=io.BytesIO(contenido), preload_content=False),
    )


class PruebaAlmacenS3(unittest.TestCase):
    """Escrituras inmutables y recuperación exclusiva con comprobación real del contenido."""

    def setUp(self) -> None:
        """Cliente nuevo y rutas propias portátiles por caso."""
        self.instante = 0.0
        self.esperas: list[float] = []
        pausas = red.PausasPorDominio(lambda: self.instante, self.dormir)
        parche_pausas = mock.patch.object(red, "PAUSAS", pausas)
        parche_pausas.start()
        self.addCleanup(parche_pausas.stop)
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.temporal = Path(temporal.name).resolve()
        self.identidad = self.temporal / "identidad-web.json"
        self.identidad.write_text(
            json.dumps({"version": 1, "identidad": perfil_web.identidad_publica(perfil_web.perfil_chrome())})
        )
        self.identidad_original = self.identidad.read_bytes()
        hogar = mock.patch.object(perfil_web, "RUTA_IDENTIDAD", self.identidad)
        hogar.start()
        self.addCleanup(hogar.stop)
        self.origen = self.temporal / "Edición Año 2026.bin"
        self.origen.write_bytes(CONTENIDO)
        self.destino = self.temporal / "Recuperación nueva.bin"
        self.almacen = s3.AlmacenS3(configuracion())
        self.addCleanup(self.almacen.close)

    def dormir(self, segundos: float) -> None:
        """Adelanta el reloj del limitador compartido sin esperar tiempo real."""
        self.esperas.append(segundos)
        self.instante += segundos

    def respuesta_lenta(self, request: object, estado: int = 200) -> AWSResponse:
        """Respuesta cuyo cierre tarda tres segundos virtuales, una sola vez.

        Returns:
            Cuerpo HTTP real local con cierre observable.
        """
        respuesta_http = http(request, estado, CONTENIDO)
        cerrar = respuesta_http.raw.close
        cerrado = False

        def cierre() -> None:
            nonlocal cerrado
            if not cerrado:
                self.instante += 3
                cerrado = True
            cerrar()

        respuesta_http.raw.close = cierre
        return respuesta_http

    def test_turno_incluye_lectura_cierre_y_espera_desde_fin(self) -> None:
        """Dos GET del SDK respetan dos segundos desde el cierre, no desde el envío."""
        inicios = []

        def enviar(request: object) -> AWSResponse:
            inicios.append(self.instante)
            return self.respuesta_lenta(request)

        with (
            mock.patch.object(self.almacen._cliente._endpoint.http_session, "send", side_effect=enviar),
            mock.patch.object(StreamingBody, "set_socket_timeout"),
        ):
            self.almacen.recuperar(CLAVE, self.destino, HUELLA, len(CONTENIDO))
            self.almacen.recuperar(CLAVE, self.temporal / "segunda", HUELLA, len(CONTENIDO))
        self.assertEqual(inicios, [0, 5])
        self.assertEqual(self.esperas, [2])

    def test_retry_oculto_sdk_cierra_anterior_y_reserva_otro_intento(self) -> None:
        """El hook HTTP cubre incluso otro envío solicitado internamente por el SDK."""
        inicios, cuerpos = [], []

        def enviar(request: object) -> AWSResponse:
            if cuerpos:
                self.assertTrue(cuerpos[-1].closed)
            inicios.append(self.instante)
            respuesta_http = self.respuesta_lenta(request)
            cuerpos.append(respuesta_http.raw)
            return respuesta_http

        def repetir(attempts: int, **_opciones: object) -> int | None:
            return 0 if attempts == 1 else None

        self.almacen._cliente.meta.events.register_first("needs-retry.s3.GetObject", repetir)
        with (
            mock.patch.object(self.almacen._cliente._endpoint.http_session, "send", side_effect=enviar),
            mock.patch.object(StreamingBody, "set_socket_timeout"),
        ):
            self.almacen.recuperar(CLAVE, self.destino, HUELLA, len(CONTENIDO))
        self.assertEqual(inicios, [0, 5])
        self.assertTrue(all(c.closed for c in cuerpos))
        self.assertEqual(self.esperas, [2])

    def test_redirect_rechazado_libera_turno_tras_cerrar_error(self) -> None:
        """Un 307 no habilita salto; el próximo intento propio espera tras cerrar el rechazo."""
        inicios = []

        def enviar(request: object) -> AWSResponse:
            inicios.append(self.instante)
            return self.respuesta_lenta(request, 307 if len(inicios) == 1 else 200)

        with (
            mock.patch.object(self.almacen._cliente._endpoint.http_session, "send", side_effect=enviar),
            mock.patch.object(StreamingBody, "set_socket_timeout"),
        ):
            with self.assertRaises(s3.AlmacenS3NoDisponible):
                self.almacen.recuperar(CLAVE, self.destino, HUELLA, len(CONTENIDO))
            self.almacen.recuperar(CLAVE, self.destino, HUELLA, len(CONTENIDO))
        self.assertEqual(inicios, [0, 5])

    def test_esperar_no_renueva_plazo_ni_emite_get_vencido(self) -> None:
        """Si la cortesía agota el presupuesto anterior al turno, no se abre otra petición."""
        with (
            mock.patch.object(
                self.almacen._cliente._endpoint.http_session, "send", side_effect=lambda r: http(r, 200, CONTENIDO)
            ) as enviar,
            mock.patch.object(StreamingBody, "set_socket_timeout"),
            mock.patch.object(s3.time, "monotonic", side_effect=lambda: self.instante),
            mock.patch.object(s3, "PLAZO_LECTURA_S", 1),
        ):
            self.almacen.recuperar(CLAVE, self.destino, HUELLA, len(CONTENIDO))
            with self.assertRaises(s3.AlmacenS3NoDisponible):
                self.almacen.recuperar(CLAVE, self.temporal / "vencida", HUELLA, len(CONTENIDO))
        enviar.assert_called_once()

    def test_control_tardio_no_confirma_200_404_412_ni_ausencia(self) -> None:
        """Respuesta o cierre al vencer el plazo significan resultado incierto, nunca éxito/ausencia/CAS."""
        for estado, metodo in ((200, "PUT"), (404, "GET"), (412, "PUT")):
            for fase in ("respuesta", "cierre"):
                for instante_final in (5, 6):
                    self.instante = 0
                    cuerpos, inicios = [], []
                    pausas = red.PausasPorDominio(lambda: self.instante, self.dormir)

                    def enviar(
                        request: object, caso: tuple = (estado, metodo, fase, instante_final, inicios, cuerpos)
                    ) -> AWSResponse:
                        estado, metodo, fase, instante_final, inicios, cuerpos = caso
                        inicios.append(self.instante)
                        self.assertEqual(request.method, metodo)
                        if request.method == "PUT":
                            self.assertEqual(request.body.read(), b"{}")
                        if fase == "respuesta":
                            self.instante = instante_final
                        respuesta_http = http(request, estado)
                        cuerpos.append(respuesta_http.raw)
                        cerrar = respuesta_http.raw.close

                        def cierre() -> None:
                            if fase == "cierre" and not respuesta_http.raw.closed:
                                self.instante = instante_final
                            cerrar()

                        respuesta_http.raw.close = cierre
                        return respuesta_http

                    with (
                        self.subTest(estado=estado, fase=fase, instante_final=instante_final),
                        mock.patch.object(red, "PAUSAS", pausas),
                        mock.patch.object(s3.time, "monotonic", side_effect=lambda: self.instante),
                        mock.patch.object(s3, "PLAZO_SUBIDA_S", 5),
                        mock.patch.object(s3, "PLAZO_LECTURA_S", 5),
                        mock.patch.object(self.almacen._cliente._endpoint.http_session, "send", side_effect=enviar),
                    ):
                        with red.turno_por_dominio("https://almacen.example/previa"):
                            pass
                        with self.assertRaises(s3.AlmacenS3NoDisponible) as error:
                            if metodo == "GET":
                                self.almacen.leer_control(s3.REFERENCIA, 8192)
                            else:
                                self.almacen.guardar_control(s3.REFERENCIA, b"{}", None)
                        self.assertEqual(str(error.exception), s3.ERROR_DISPONIBILIDAD)
                        self.assertEqual(inicios, [2])
                        self.assertTrue(all(c.closed for c in cuerpos))
                        with red.turno_por_dominio("https://almacen.example/siguiente"):
                            self.assertEqual(self.instante, instante_final + 2)

    def test_cierre_tardio_get_no_promueve_destino(self) -> None:
        """El cuerpo íntegro recibido a tiempo tampoco se acredita si su cierre vence el plazo."""
        cuerpos, inicios = [], []

        def enviar(request: object) -> AWSResponse:
            inicios.append(self.instante)
            respuesta_http = http(request, 200, CONTENIDO)
            cuerpos.append(respuesta_http.raw)
            cerrar = respuesta_http.raw.close
            terminado = False

            def cierre() -> None:
                nonlocal terminado
                if not terminado:
                    self.instante = 6
                    terminado = True
                cerrar()

            respuesta_http.raw.close = cierre
            return respuesta_http

        with (
            mock.patch.object(s3.time, "monotonic", side_effect=lambda: self.instante),
            mock.patch.object(s3, "PLAZO_LECTURA_S", 5),
            mock.patch.object(self.almacen._cliente._endpoint.http_session, "send", side_effect=enviar),
            mock.patch.object(StreamingBody, "set_socket_timeout"),
        ):
            with red.turno_por_dominio("https://almacen.example/previa"):
                pass
            with self.assertRaises(s3.AlmacenS3NoDisponible):
                self.almacen.recuperar(CLAVE, self.destino, HUELLA, len(CONTENIDO))
            with red.turno_por_dominio("https://almacen.example/siguiente"):
                self.assertEqual(self.instante, 8)
        self.assertEqual(inicios, [2])
        self.assertTrue(all(c.closed for c in cuerpos))
        self.assertFalse(self.destino.exists())
        self.assertFalse(any(p.name.startswith(".objeto-") for p in self.temporal.iterdir()))

    def test_plazo_final_no_oculta_excepcion_causal(self) -> None:
        """Si el bloque falla, el cierre tardío no reemplaza su causa por un error de presupuesto."""
        cuerpo = io.BytesIO(b"")
        cerrar = cuerpo.close
        causa = ValueError("causa sintética anterior al cierre")

        def cierre() -> None:
            self.instante = 6
            cerrar()

        cuerpo.close = cierre
        with mock.patch.object(s3.time, "monotonic", side_effect=lambda: self.instante):
            with self.assertRaises(ValueError) as error, self.almacen._peticion(s3.REFERENCIA, 5):
                self.almacen._ultima_respuesta = AWSResponse("https://almacen.example/objeto", 200, {}, cuerpo)
                raise causa
            with red.turno_por_dominio("https://almacen.example/siguiente"):
                self.assertEqual(self.instante, 8)
        self.assertIs(error.exception, causa)
        self.assertTrue(cuerpo.closed)

    def test_identidad_configurada_impide_sufijos_del_sdk_en_el_envio(self) -> None:
        """La configuración común llega exacta al transporte y sobrescribe cualquier sufijo del SDK."""
        self.assertTrue(self.almacen._cliente.meta.config.user_agent.startswith(AGENTE_PRUEBA))

        def contaminar(request: object, **_opciones: object) -> None:
            request.headers["User-Agent"] = b"SDK/1.0 Python/3.12 entorno-sintetico"

        def enviar(request: object) -> AWSResponse:
            self.assertEqual(request.headers["User-Agent"], AGENTE_PRUEBA)
            for nombre, valor in perfil_web.identidad_publica(perfil_web.perfil_chrome()).items():
                self.assertEqual(request.headers[nombre], valor)
            firmadas = request.headers["Authorization"].decode().split("SignedHeaders=", 1)[1].split(",", 1)[0]
            self.assertTrue(perfil_web.PISTAS.issubset(firmadas.split(";")))
            self.assertNotIn("X-Amz-User-Agent", request.headers)
            self.assertNotIn("Accept-Language", request.headers)
            return http(request, 200, CONTENIDO)

        self.almacen._cliente.meta.events.register_first("before-send.s3.GetObject", contaminar)
        with (
            mock.patch.object(self.almacen._cliente._endpoint.http_session, "send", side_effect=enviar) as transporte,
            mock.patch.object(StreamingBody, "set_socket_timeout"),
        ):
            self.almacen.recuperar(CLAVE, self.destino, HUELLA, len(CONTENIDO))
        transporte.assert_called_once()
        self.assertEqual(self.identidad.read_bytes(), self.identidad_original)

    def test_identidad_invalida_no_crea_sdk(self) -> None:
        """Una configuración existente inválida no cae al defecto ni abre transporte."""
        self.identidad.write_text('user-agent = "AgentePrivado"\n')
        with mock.patch.object(s3, "crear_cliente") as crear, self.assertRaises(AlmacenS3Invalido):
            s3.AlmacenS3(configuracion())
        crear.assert_not_called()

    def test_guardar_solo_termina_despues_de_get_bytes_completos(self) -> None:
        """ETag y el código PUT no sustituyen GET y SHA256 de todos los bytes."""
        cuerpo = Cuerpo(CONTENIDO)
        with Stubber(self.almacen._cliente) as stub:
            stub.add_response("put_object", {"ETag": "no-es-sha256"}, parametros_put())
            stub.add_response("get_object", respuesta(cuerpo), parametros_get())
            self.almacen.guardar(CLAVE, self.origen, HUELLA, len(CONTENIDO))
            stub.assert_no_pending_responses()
        self.assertTrue(cuerpo.closed)
        self.assertTrue(cuerpo.plazos)
        self.assertEqual(self.origen.read_bytes(), CONTENIDO)

    def test_412_requiere_get_exacto_sin_segundo_put(self) -> None:
        """Una clave existente solo admite repetición idéntica, nunca sobrescritura."""
        cuerpo = Cuerpo(CONTENIDO)
        with Stubber(self.almacen._cliente) as stub:
            stub.add_client_error(
                "put_object", "PreconditionFailed", http_status_code=412, expected_params=parametros_put()
            )
            stub.add_response("get_object", respuesta(cuerpo), parametros_get())
            self.almacen.guardar(CLAVE, self.origen, HUELLA, len(CONTENIDO))
            stub.assert_no_pending_responses()
        self.assertTrue(cuerpo.closed)

    def test_descriptor_artefacto_usa_transporte_inmutable_y_recuperacion_exacta(self) -> None:
        """El descriptor nuevo pasa por la firma y la guardia HTTP sin ampliar el acceso mutable."""
        clave = f"artefactos/{HUELLA}.json"
        metodos = []

        def enviar(request: object) -> AWSResponse:
            metodos.append(request.method)
            self.assertEqual(request.url, f"https://almacen.example/{BUCKET}/{PREFIJO}/{clave}")
            self.assertEqual(request.headers["User-Agent"], AGENTE_PRUEBA)
            self.assertIn(b"AWS4-HMAC-SHA256", request.headers["Authorization"])
            if request.method == "PUT":
                self.assertEqual(request.headers["If-None-Match"], b"*")
                self.assertEqual(request.body.read(), CONTENIDO)
                return http(request, 200)
            return http(request, 200, CONTENIDO)

        with (
            mock.patch.object(self.almacen._cliente._endpoint.http_session, "send", side_effect=enviar),
            mock.patch.object(StreamingBody, "set_socket_timeout"),
        ):
            self.almacen.guardar(clave, self.origen, HUELLA, len(CONTENIDO))
            self.almacen.recuperar(clave, self.destino, HUELLA, len(CONTENIDO))
        self.assertEqual(metodos, ["PUT", "GET", "GET"])
        self.assertEqual(self.destino.read_bytes(), CONTENIDO)

    def test_descriptor_artefacto_rechaza_alias_y_sha_ajena_antes_de_red(self) -> None:
        """Solo el nombre inmutable ligado a la huella permite transportar el descriptor."""
        for clave in (f"artefactos/{OTRA_HUELLA}.json", "artefactos/latest.json", f"artefactos/../{HUELLA}.json"):
            with self.subTest(clave=clave), mock.patch.object(self.almacen._cliente, "get_object") as leer:
                with self.assertRaises(ValueError):
                    self.almacen.recuperar(clave, self.destino, HUELLA, len(CONTENIDO))
                leer.assert_not_called()
        with mock.patch.object(self.almacen._cliente, "put_object") as enviar:
            with self.assertRaises(ValueError):
                self.almacen.guardar_control(f"artefactos/{HUELLA}.json", CONTENIDO, None)
            enviar.assert_not_called()

    def test_412_y_put_verde_no_admiten_contenido_distinto(self) -> None:
        """Un objeto corrupto no se declara durable aunque tenga la misma longitud o ETag."""
        for existente in (False, True):
            cuerpo = Cuerpo(b"x" * len(CONTENIDO))
            with self.subTest(existente=existente), Stubber(self.almacen._cliente) as stub:
                if existente:
                    stub.add_client_error(
                        "put_object", "PreconditionFailed", http_status_code=412, expected_params=parametros_put()
                    )
                else:
                    stub.add_response("put_object", {}, parametros_put())
                stub.add_response("get_object", respuesta(cuerpo), parametros_get())
                with self.assertRaises(AlmacenS3Invalido):
                    self.almacen.guardar(CLAVE, self.origen, HUELLA, len(CONTENIDO))
                stub.assert_no_pending_responses()
            self.assertTrue(cuerpo.closed)

    def test_recuperar_promueve_solo_archivo_completo_verificado(self) -> None:
        """La salida nueva conserva bytes exactos y se retira solo el temporal propio."""
        cuerpo = Cuerpo(CONTENIDO)
        with Stubber(self.almacen._cliente) as stub:
            stub.add_response("get_object", respuesta(cuerpo), parametros_get())
            self.almacen.recuperar(CLAVE, self.destino, HUELLA, len(CONTENIDO))
        self.assertEqual(self.destino.read_bytes(), CONTENIDO)
        self.assertTrue(cuerpo.closed)
        self.assertFalse(any(r.name.startswith(".objeto-") for r in self.temporal.iterdir()))

    def test_objeto_vacio_guarda_y_recupera_con_cota_cero(self) -> None:
        """Cero bytes es un objeto válido; la ausencia de cuerpo no se infiere del tamaño."""
        self.origen.write_bytes(b"")
        clave = f"blobs/{VACIO}"
        with Stubber(self.almacen._cliente) as stub:
            stub.add_response("put_object", {}, parametros_put(clave, b""))
            stub.add_response("get_object", respuesta(Cuerpo(b"")), parametros_get(clave))
            self.almacen.guardar(clave, self.origen, VACIO, 0)
            stub.add_response("get_object", respuesta(Cuerpo(b"")), parametros_get(clave))
            self.almacen.recuperar(clave, self.destino, VACIO, 0)
            stub.assert_no_pending_responses()
        self.assertEqual(self.destino.read_bytes(), b"")

    def test_lectura_completa_con_socket_liberado_al_recibir_el_ultimo_byte(self) -> None:
        """Tras Content-Length urllib3 puede liberar la conexión antes de que se compruebe el fin del stream."""
        cuerpo = Cuerpo(CONTENIDO)

        def ajustar_plazo(_segundos: float) -> None:
            self.assertLess(cuerpo.tell(), len(CONTENIDO), "El socket ya se ha liberado")

        with Stubber(self.almacen._cliente) as stub, mock.patch.object(cuerpo, "set_socket_timeout", ajustar_plazo):
            stub.add_response("get_object", respuesta(cuerpo), parametros_get())
            self.almacen.recuperar(CLAVE, self.destino, HUELLA, len(CONTENIDO))
        self.assertEqual(self.destino.read_bytes(), CONTENIDO)

    def test_recuperacion_corrupta_excesiva_o_incompleta_no_deja_destino(self) -> None:
        """La longitud declarada no evita leer con cota y comprobar el final del stream."""
        for contenido, longitud, limite in (
            (b"mal", 3, 3),
            (CONTENIDO, len(CONTENIDO), 1),
            (CONTENIDO, 1, 1),
            (CONTENIDO, len(CONTENIDO) + 1, len(CONTENIDO) + 1),
        ):
            cuerpo = Cuerpo(contenido)
            antes = set(self.temporal.iterdir())
            with self.subTest(longitud=longitud, limite=limite), Stubber(self.almacen._cliente) as stub:
                stub.add_response("get_object", respuesta(cuerpo, longitud), parametros_get())
                with self.assertRaises(AlmacenS3Invalido):
                    self.almacen.recuperar(CLAVE, self.destino, HUELLA, limite)
            self.assertTrue(cuerpo.closed)
            self.assertEqual(set(self.temporal.iterdir()), antes)

    def test_stream_cortado_o_plazo_total_cierra_y_limpia(self) -> None:
        """El plazo total se comprueba también después de una lectura y el cuerpo siempre se cierra."""
        reloj = {"ahora": 0.0}

        class Lento(Cuerpo):
            def read(self, cantidad: int = -1) -> bytes:
                reloj["ahora"] = s3.PLAZO_LECTURA_S + 1
                return super().read(cantidad)

        for cuerpo in (Lento(CONTENIDO), Cuerpo(CONTENIDO)):
            antes = set(self.temporal.iterdir())
            reloj["ahora"] = 0.0
            with (
                Stubber(self.almacen._cliente) as stub,
                mock.patch.object(s3.time, "monotonic", side_effect=lambda: reloj["ahora"]),
            ):
                stub.add_response("get_object", respuesta(cuerpo), parametros_get())
                if not isinstance(cuerpo, Lento):
                    cuerpo.read = mock.Mock(side_effect=OSError("detalle privado"))
                with self.assertRaises(s3.AlmacenS3NoDisponible):
                    self.almacen.recuperar(CLAVE, self.destino, HUELLA, len(CONTENIDO))
            self.assertTrue(cuerpo.closed)
            self.assertEqual(set(self.temporal.iterdir()), antes)

    def test_destino_existente_o_creado_durante_get_no_se_sobrescribe(self) -> None:
        """La promoción usa enlace exclusivo, incluso ante una carrera con otro escritor."""
        self.destino.write_bytes(b"otra salida")
        with mock.patch.object(self.almacen._cliente, "get_object") as pedir, self.assertRaises(ValueError):
            self.almacen.recuperar(CLAVE, self.destino, HUELLA, len(CONTENIDO))
        pedir.assert_not_called()
        self.destino.unlink()
        real = s3.os.link

        def carrera(origen: Path, destino: Path, *, follow_symlinks: bool) -> None:
            destino.write_bytes(b"otra salida")
            real(origen, destino, follow_symlinks=follow_symlinks)

        with Stubber(self.almacen._cliente) as stub, mock.patch.object(s3.os, "link", side_effect=carrera):
            stub.add_response("get_object", respuesta(Cuerpo(CONTENIDO)), parametros_get())
            with self.assertRaises(s3.AlmacenS3NoDisponible):
                self.almacen.recuperar(CLAVE, self.destino, HUELLA, len(CONTENIDO))
        self.assertEqual(self.destino.read_bytes(), b"otra salida")

    def test_enlaces_y_origen_no_regular_no_se_abren_o_envian(self) -> None:
        """No sigue symlinks, hardlinks ni FIFO; rechaza tamaño/huella antes del primer PUT."""
        enlace = self.temporal / "enlace"
        enlace.symlink_to(self.origen)
        fifo = self.temporal / "fifo"
        os.mkfifo(fifo)
        for ruta in (enlace, fifo, self.temporal):
            with self.subTest(ruta=ruta), mock.patch.object(self.almacen._cliente, "put_object") as enviar:
                with self.assertRaises((ValueError, OSError)):
                    self.almacen.guardar(CLAVE, ruta, HUELLA, len(CONTENIDO))
                enviar.assert_not_called()
        os.link(self.origen, self.temporal / "hardlink")
        with self.assertRaises(ValueError):
            self.almacen.guardar(CLAVE, self.origen, HUELLA, len(CONTENIDO))

    def test_claves_huellas_limites_y_origen_incorrectos_no_envian(self) -> None:
        """Solo admite nombres por contenido y cotas numéricas explícitas de hasta 4 GiB."""
        for clave, huella, limite in (
            ("../fuera", HUELLA, len(CONTENIDO)),
            (CLAVE, OTRA_HUELLA, len(CONTENIDO)),
            (CLAVE, HUELLA, True),
            (CLAVE, HUELLA, -1),
            (CLAVE, HUELLA, s3.MAX_OBJETO_BYTES + 1),
            (CLAVE, HUELLA, 1),
        ):
            with (
                self.subTest(clave=clave, limite=limite),
                mock.patch.object(self.almacen._cliente, "put_object") as enviar,
            ):
                with self.assertRaises((ValueError, OSError)):
                    self.almacen.guardar(clave, self.origen, huella, limite)
                enviar.assert_not_called()

    def test_configuracion_invalida_no_construye_cliente_ni_representa_secretos(self) -> None:
        """Punto de acceso, credenciales y namespace tienen forma cerrada antes de instanciar SDK."""
        for cambio in (
            {"endpoint": "http://almacen.example"},
            {"endpoint": "https://usuario:clave@almacen.example"},
            {"endpoint": "https://almacen.example/"},
            {"endpoint": "https://almacen.example?extra"},
            {"endpoint": "https://almacen.example\n"},
            {"prefijo": "../otro"},
            {"prefijo": "uno//otro"},
            {"bucket": "../otro"},
            {"region": ""},
            {"access_key_id": ""},
            {"secret_access_key": ""},
            {"secret_access_key": None},
        ):
            with self.subTest(cambio=cambio), mock.patch.object(s3, "crear_cliente") as crear:
                with self.assertRaises(AlmacenS3Invalido):
                    s3.AlmacenS3(configuracion(**cambio))
                crear.assert_not_called()
        self.assertNotIn("AKIDSINTETICA", repr(configuracion()))
        self.assertNotIn("secreto-sintetico", repr(configuracion()))

    def test_sslkeylogfile_rechazado_antes_de_construir_sdk(self) -> None:
        """El SDK no recibe configuración ambiental que habilite registro de secretos TLS."""
        with tempfile.TemporaryDirectory() as nombre:
            ruta = Path(nombre) / "no-crear.log"
            with (
                mock.patch.dict(os.environ, {"SSLKEYLOGFILE": str(ruta)}),
                mock.patch.object(cliente_s3.botocore.session, "Session") as sesion,
                self.assertRaisesRegex(AlmacenS3Invalido, "SSLKEYLOGFILE"),
            ):
                s3.AlmacenS3(configuracion())
            sesion.assert_not_called()
            self.assertFalse(ruta.exists())

    def test_sesion_privada_no_descubre_perfiles_credenciales_proxies_o_endpoint_ambiente(self) -> None:
        """La configuración local/ambiental nunca se utiliza como segunda autoridad."""
        ambiente = {
            "AWS_PROFILE": "ajeno",
            "AWS_ACCESS_KEY_ID": "NO-USAR",
            "AWS_SECRET_ACCESS_KEY": "NO-USAR",
            "AWS_CONFIG_FILE": "/no-leer",
            "AWS_SHARED_CREDENTIALS_FILE": "/no-leer",
            "AWS_ENDPOINT_URL_S3": "https://ajeno.example",
            "AWS_DATA_PATH": "/no-leer",
            "AWS_CA_BUNDLE": "/no-leer",
            "HTTPS_PROXY": "http://ajeno.example",
        }
        real = botocore.configloader.raw_config_parse

        def comprobar(ruta: str, *args: object, **opciones: object) -> dict:
            self.assertEqual(ruta, os.devnull)
            return real(ruta, *args, **opciones)

        with (
            mock.patch.dict(os.environ, ambiente),
            mock.patch.object(
                botocore.credentials.CredentialResolver,
                "load_credentials",
                side_effect=AssertionError("cadena prohibida"),
            ),
            mock.patch.object(botocore.configloader, "raw_config_parse", side_effect=comprobar),
            mock.patch.object(boto3, "client", side_effect=AssertionError("sesion global prohibida")),
            s3.AlmacenS3(configuracion()) as almacen,
        ):
            self.assertEqual(almacen._cliente.meta.endpoint_url, "https://almacen.example")
            self.assertEqual(almacen._cliente.meta.region_name, "auto")
            self.assertEqual(almacen._cliente.meta.config.proxies, {})
            autoridad = str(cliente_s3.ruta_ca_runtime_verificada())
            self.assertEqual(almacen._cliente._endpoint.http_session._verify, autoridad)

    def test_http_preparado_real_ua_exacto_firma_sdk_y_put_condicional_seguido_de_get(self) -> None:
        """El borde HTTP real del SDK solo recibe la identidad configurada, sin prefijos ni telemetría añadida."""
        peticiones = []

        def enviar(request: object) -> AWSResponse:
            peticiones.append(request)
            self.assertEqual(request.headers["User-Agent"], AGENTE_PRUEBA)
            self.assertEqual(request.url, f"https://almacen.example/{BUCKET}/{PREFIJO}/{CLAVE}")
            self.assertIn(b"AWS4-HMAC-SHA256", request.headers["Authorization"])
            if request.method == "PUT":
                self.assertEqual(request.headers["If-None-Match"], b"*")
                self.assertEqual(request.body.read(), CONTENIDO)
                return http(request, 200)
            return http(request, 200, CONTENIDO)

        with (
            mock.patch.object(self.almacen._cliente._endpoint.http_session, "send", side_effect=enviar),
            mock.patch.object(StreamingBody, "set_socket_timeout") as plazo,
            redirect_stdout(io.StringIO()) as salida,
            redirect_stderr(io.StringIO()) as errores,
        ):
            self.almacen.guardar(CLAVE, self.origen, HUELLA, len(CONTENIDO))
        self.assertEqual([p.method for p in peticiones], ["PUT", "GET"])
        self.assertTrue(plazo.called)
        self.assertEqual(salida.getvalue() + errores.getvalue(), "")

    def test_http_412_cierra_sin_leer_cuerpo_y_coteja_get_una_vez(self) -> None:
        """El cuerpo privado de un error no pasa al parser/logs y 412 no se toma como éxito sin GET."""
        peticiones = []

        def enviar(request: object) -> AWSResponse:
            peticiones.append(request.method)
            return http(request, 412, b"detalle privado") if request.method == "PUT" else http(request, 200, CONTENIDO)

        with (
            mock.patch.object(self.almacen._cliente._endpoint.http_session, "send", side_effect=enviar),
            mock.patch.object(StreamingBody, "set_socket_timeout"),
        ):
            self.almacen.guardar(CLAVE, self.origen, HUELLA, len(CONTENIDO))
        self.assertEqual(peticiones, ["PUT", "GET"])

    def test_redirect_y_fallo_red_son_unico_envio_sin_lectura_o_reintento(self) -> None:
        """Ni el redirector S3 ni la política de retry pueden reenviar una petición incierta."""
        for fallo in (
            301,
            307,
            503,
            EndpointConnectionError(endpoint_url="https://almacen.example", error="detalle privado"),
        ):
            peticiones = []

            def enviar(request: object, error: int | Exception = fallo, enviados: list = peticiones) -> AWSResponse:
                enviados.append(request)
                if isinstance(error, Exception):
                    raise error
                return http(request, error, b"detalle privado no publicar")

            with (
                self.subTest(fallo=type(fallo).__name__),
                mock.patch.object(self.almacen._cliente._endpoint.http_session, "send", side_effect=enviar),
                self.assertRaises(s3.AlmacenS3NoDisponible) as error,
            ):
                self.almacen.guardar(CLAVE, self.origen, HUELLA, len(CONTENIDO))
            self.assertEqual(len(peticiones), 1)
            self.assertEqual(str(error.exception), s3.ERROR_DISPONIBILIDAD)

    def test_destino_http_fuera_endpoint_ni_siquiera_se_envia(self) -> None:
        """Una mutación previa de URL no puede entregar credenciales a otro host."""

        def cambiar(request: object, **_opciones: object) -> None:
            request.url = "https://ajeno.example/objeto"

        self.almacen._cliente.meta.events.register_first("before-send.s3.PutObject", cambiar)
        with (
            mock.patch.object(self.almacen._cliente._endpoint.http_session, "send") as enviar,
            self.assertRaises(AlmacenS3Invalido),
        ):
            self.almacen.guardar(CLAVE, self.origen, HUELLA, len(CONTENIDO))
        enviar.assert_not_called()

    def test_close_idempotente_y_operaciones_posteriores_no_reabren(self) -> None:
        """El cliente privado se libera una sola vez incluso con contexto y cierre repetido."""
        with mock.patch.object(self.almacen._cliente, "close") as cerrar:
            self.almacen.close()
            self.almacen.close()
            cerrar.assert_called_once()
        with (
            mock.patch.object(self.almacen._cliente, "put_object") as enviar,
            self.assertRaises(s3.AlmacenS3NoDisponible),
        ):
            self.almacen.guardar(CLAVE, self.origen, HUELLA, len(CONTENIDO))
        enviar.assert_not_called()

    def test_subida_vencida_antes_firma_o_envio_no_llega_a_http(self) -> None:
        """El cuerpo impide firmar/enviar tras el plazo global, sin dormir ni cancelar procesos ajenos."""
        reloj = {"ahora": 0.0}
        for etapa in ("before-sign.s3.PutObject", "before-send.s3.PutObject"):
            reloj["ahora"] = 0.0

            def vencer(**_opciones: object) -> None:
                reloj["ahora"] = s3.PLAZO_SUBIDA_S + 1

            identificador = f"vencer-{etapa}"
            self.almacen._cliente.meta.events.register_first(etapa, vencer, unique_id=identificador)
            try:
                with (
                    mock.patch.object(s3.time, "monotonic", side_effect=lambda: reloj["ahora"]),
                    mock.patch.object(self.almacen._cliente._endpoint.http_session, "send") as enviar,
                ):
                    with self.assertRaises(s3.AlmacenS3NoDisponible):
                        self.almacen.guardar(CLAVE, self.origen, HUELLA, len(CONTENIDO))
                    enviar.assert_not_called()
            finally:
                self.almacen._cliente.meta.events.unregister(etapa, unique_id=identificador)

    def test_control_http_cas_usa_etag_opaco_y_creacion_exclusiva(self) -> None:
        """El SDK firma IfMatch/IfNoneMatch, conserva bytes y descubre solo controles cerrados."""
        peticiones = []
        contenido = b'{"version":1}'

        def enviar(request: object) -> AWSResponse:
            peticiones.append(request)
            self.assertEqual(request.headers["User-Agent"], AGENTE_PRUEBA)
            self.assertIn(b"AWS4-HMAC-SHA256", request.headers["Authorization"])
            if request.method == "PUT":
                self.assertEqual(request.body.read(), contenido)
                return http(request, 200)
            respuesta_http = http(request, 200, contenido)
            respuesta_http.headers["etag"] = '"opaco-no-es-hash"'
            return respuesta_http

        with (
            mock.patch.object(self.almacen._cliente._endpoint.http_session, "send", side_effect=enviar),
            mock.patch.object(StreamingBody, "set_socket_timeout"),
        ):
            self.assertTrue(self.almacen.guardar_control(s3.REFERENCIA, contenido, None))
            self.assertEqual(self.almacen.leer_control(s3.REFERENCIA, 8192), (contenido, '"opaco-no-es-hash"'))
            self.assertTrue(self.almacen.guardar_control(s3.REFERENCIA, contenido, '"opaco-no-es-hash"'))
        self.assertEqual([p.method for p in peticiones], ["PUT", "GET", "PUT"])
        self.assertEqual(peticiones[0].headers["If-None-Match"], b"*")
        self.assertNotIn("If-Match", peticiones[0].headers)
        self.assertEqual(peticiones[2].headers["If-Match"], b'"opaco-no-es-hash"')
        self.assertNotIn("If-None-Match", peticiones[2].headers)

    def test_control_http_404_y_412_son_explicitos_sin_parser_o_retry(self) -> None:
        """Solo 404 significa ausencia; solo 412 significa CAS perdida y ningún error revela su cuerpo."""
        peticiones = []
        cuerpos = []

        def enviar(request: object) -> AWSResponse:
            peticiones.append(request.method)
            res = http(request, 404 if request.method == "GET" else 412, b"detalle privado")
            cuerpos.append(res.raw)
            return res

        with mock.patch.object(self.almacen._cliente._endpoint.http_session, "send", side_effect=enviar):
            self.assertIsNone(self.almacen.leer_control(s3.REFERENCIA, 8192))
            self.assertFalse(self.almacen.guardar_control(s3.REFERENCIA, b"{}", '"etag"'))
            with self.assertRaises(s3.AlmacenS3NoDisponible):
                self.almacen.recuperar(CLAVE, self.destino, HUELLA, 8192)
        self.assertEqual(peticiones, ["GET", "PUT", "GET"])
        self.assertTrue(all(c.closed for c in cuerpos))

    def test_solo_el_404_de_una_lectura_dice_que_el_objeto_no_existe(self) -> None:
        """La ausencia sigue siendo AlmacenS3NoDisponible; un 503 o un 404 al escribir no son ausencia."""
        estados = {"GET": 404}

        def enviar(request: object) -> AWSResponse:
            return http(request, estados[request.method])

        with mock.patch.object(self.almacen._cliente._endpoint.http_session, "send", side_effect=enviar):
            with self.assertRaises(s3.AlmacenS3Ausente) as fallo:
                self.almacen.recuperar(CLAVE, self.destino, HUELLA, 8192)
            self.assertIsInstance(fallo.exception, s3.AlmacenS3NoDisponible)
            self.assertIsInstance(fallo.exception, FileNotFoundError)
            estados.update(GET=503, PUT=404)
            for operacion in (
                lambda: self.almacen.recuperar(CLAVE, self.destino, HUELLA, 8192),
                lambda: self.almacen.guardar_control(s3.REFERENCIA, b"{}", None),
            ):
                with self.assertRaises(s3.AlmacenS3NoDisponible) as fallo:
                    operacion()
                self.assertNotIsInstance(fallo.exception, s3.AlmacenS3Ausente)
        self.assertFalse(self.destino.exists())

    def test_controles_no_abren_namespace_ni_permiten_indices_mutables(self) -> None:
        """La ampliación no convierte el SDK en un almacén de claves o cuerpos arbitrarios."""
        indice = "trabajos/12345678-1234-4234-8234-123456789abc/1/123.json"
        with mock.patch.object(self.almacen._cliente._endpoint.http_session, "send") as enviar:
            for clave in (
                CLAVE,
                "referencias/otra.json",
                "referencias/../mantenimiento.json",
                indice.replace("/1/", "/01/"),
                indice.replace("/1/", "/9007199254740992/"),
                indice.replace("/123.json", "/9007199254740992.json"),
            ):
                with self.subTest(clave=clave), self.assertRaises(ValueError):
                    self.almacen.leer_control(clave, 8192)
            for clave, contenido, etag in (
                (indice, b"{}", '"etag"'),
                (s3.REFERENCIA, b"{}", "etag\ninyectado"),
                (s3.REFERENCIA, b"x" * 8193, None),
            ):
                with self.subTest(clave=clave), self.assertRaises(ValueError):
                    self.almacen.guardar_control(clave, contenido, etag)
            enviar.assert_not_called()

    def test_resumen_del_diario_admite_su_clave_y_64_kib_y_nada_mas(self) -> None:
        """Solo la clave exacta del resumen admite hasta 64 KiB; el resto de controles conserva sus 8.192 bytes."""
        resumen = "diarios-resumen/0000000000000123/1/ejecutar.json"
        contenido = b"{" + b" " * (64 * 1024 - 2) + b"}"
        peticiones = []

        def enviar(request: object) -> AWSResponse:
            peticiones.append(request)
            if request.method == "PUT":
                return http(request, 200)
            respuesta_http = http(request, 200, contenido)
            respuesta_http.headers["etag"] = '"resumen"'
            return respuesta_http

        with (
            mock.patch.object(self.almacen._cliente._endpoint.http_session, "send", side_effect=enviar),
            mock.patch.object(StreamingBody, "set_socket_timeout"),
        ):
            self.assertTrue(self.almacen.guardar_control(resumen, contenido, None))
            self.assertEqual(self.almacen.leer_control(resumen, 64 * 1024), (contenido, '"resumen"'))
        self.assertEqual([p.method for p in peticiones], ["PUT", "GET"])
        self.assertTrue(peticiones[0].url.endswith(resumen))
        with mock.patch.object(self.almacen._cliente._endpoint.http_session, "send") as rechazado:
            for clave in (
                "diarios-resumen/123/1/ejecutar.json",
                "diarios-resumen/0000000000000123/01/ejecutar.json",
                "diarios-resumen/0000000000000123/1/otra.json",
                "diarios-resumenes/0000000000000123/1/ejecutar.json",
                "diarios-resumen/0000000000000123/1/ejecutar.json.bak",
            ):
                with self.subTest(clave=clave), self.assertRaises(ValueError):
                    self.almacen.guardar_control(clave, b"{}", None)
            for clave, excesivo in ((resumen, contenido + b" "), (s3.REFERENCIA, b"x" * 8193)):
                with self.subTest(clave=clave, bytes=len(excesivo)), self.assertRaises(ValueError):
                    self.almacen.guardar_control(clave, excesivo, None)
            for clave, maximo in ((resumen, 64 * 1024 + 1), (s3.REFERENCIA, 8193)):
                with self.subTest(clave=clave, maximo=maximo), self.assertRaises(ValueError):
                    self.almacen.leer_control(clave, maximo)
            rechazado.assert_not_called()

    def test_acta_de_desbloqueo_solo_se_crea_y_se_lee(self) -> None:
        """El acta se crea con If-None-Match, una segunda creación es 412 y nunca admite sustituirse con If-Match."""
        acta = "desbloqueos/12345678-1234-4234-8234-123456789abc/1/123.json"
        contenido = b'{"version":1}'
        peticiones = []
        existe = False

        def enviar(request: object) -> AWSResponse:
            nonlocal existe
            peticiones.append(request)
            if request.method == "PUT":
                estado, existe = (412 if existe else 200), True
                return http(request, estado)
            respuesta_http = http(request, 200, contenido)
            respuesta_http.headers["etag"] = '"acta"'
            return respuesta_http

        with (
            mock.patch.object(self.almacen._cliente._endpoint.http_session, "send", side_effect=enviar),
            mock.patch.object(StreamingBody, "set_socket_timeout"),
        ):
            self.assertTrue(self.almacen.guardar_control(acta, contenido, None))
            self.assertFalse(self.almacen.guardar_control(acta, contenido, None))
            self.assertEqual(self.almacen.leer_control(acta, 8192), (contenido, '"acta"'))
            with self.assertRaises(ValueError):
                self.almacen.guardar_control(acta, contenido, '"acta"')
        self.assertEqual([p.method for p in peticiones], ["PUT", "PUT", "GET"])
        self.assertTrue(all(p.headers["If-None-Match"] == b"*" for p in peticiones[:2]))
        self.assertTrue(all("If-Match" not in p.headers for p in peticiones))
        self.assertTrue(peticiones[0].url.endswith(acta))

    def test_claves_parecidas_al_acta_siguen_rechazadas(self) -> None:
        """Solo `desbloqueos/` con la tupla exacta del trabajo; otra carpeta o una tupla mal formada no se envían."""
        acta = "desbloqueos/12345678-1234-4234-8234-123456789abc/1/123.json"
        with mock.patch.object(self.almacen._cliente._endpoint.http_session, "send") as enviar:
            for clave in (
                acta.replace("desbloqueos/", "desbloqueo/"),
                acta.replace("desbloqueos/", "actas/"),
                acta.replace("desbloqueos/", "desbloqueos/x/"),
                acta.replace("-4234-", "-5234-"),
                acta.replace("/1/", "/01/"),
                acta.replace("/1/", "/0/"),
                acta.replace("/123.json", "/123"),
                acta.replace("/1/", "/9007199254740992/"),
                acta.replace("/123.json", "/9007199254740992.json"),
            ):
                with self.subTest(clave=clave):
                    with self.assertRaises(ValueError):
                        self.almacen.leer_control(clave, 8192)
                    with self.assertRaises(ValueError):
                        self.almacen.guardar_control(clave, b"{}", None)
            enviar.assert_not_called()

    def test_asociacion_de_bloques_esta_limitada_al_marcador_y_solo_admite_creacion(self) -> None:
        """Solo los dos tipos de marcador con SHA completo permiten el control v1."""
        valor = HUELLA.encode()
        with Stubber(self.almacen._cliente) as stub:
            for tipo in ("generaciones", "artefactos"):
                clave = f"agrupaciones/v1/{tipo}/{HUELLA}.sha256"
                put = {**parametros_get(clave), "Body": ANY, "ContentLength": len(valor), "IfNoneMatch": "*"}
                stub.add_response("put_object", {}, put)
                stub.add_response("get_object", {**respuesta(Cuerpo(valor)), "ETag": '"indice"'}, parametros_get(clave))
                self.assertTrue(self.almacen.guardar_control(clave, valor, None))
                self.assertEqual(self.almacen.leer_control(clave, len(valor)), (valor, '"indice"'))
                with self.assertRaises(ValueError):
                    self.almacen.guardar_control(clave, valor, '"indice"')
            for clave in (
                f"agrupaciones/v2/generaciones/{HUELLA}.sha256",
                f"agrupaciones/v1/trabajos/{HUELLA}.sha256",
                "agrupaciones/v1/generaciones/../x.sha256",
                f"agrupaciones/v1/generaciones/{HUELLA[:-1]}.sha256",
            ):
                with self.assertRaises(ValueError):
                    self.almacen.leer_control(clave, len(valor))
            stub.assert_no_pending_responses()

    def test_control_incompleto_sin_etag_o_excesivo_cierra_stream(self) -> None:
        """No entrega un documento parcial ni un ETag ausente para una CAS posterior."""
        for contenido, etag, limite in ((b"{}", None, 10), (b"{}", '"etag"', 1)):
            cuerpo = Cuerpo(contenido)
            res = respuesta(cuerpo)
            if etag is not None:
                res["ETag"] = etag
            with Stubber(self.almacen._cliente) as stub:
                stub.add_response("get_object", res, parametros_get(s3.REFERENCIA))
                with self.assertRaises(ValueError):
                    self.almacen.leer_control(s3.REFERENCIA, limite)
            self.assertTrue(cuerpo.closed)

    def test_etag_wildcard_lista_o_debil_no_sustituye_cas_exacta(self) -> None:
        """IfMatch solo recibe una entidad fuerte única, no operadores, listas o un validador débil."""
        for etag in ("*", '"uno","dos"', 'W/"debil"', "sin-comillas"):
            with (
                self.subTest(etag=etag),
                mock.patch.object(
                    self.almacen._cliente._endpoint.http_session, "send", side_effect=lambda request: http(request, 200)
                ) as enviar,
                self.assertRaises(ValueError),
            ):
                self.almacen.guardar_control(s3.REFERENCIA, b"{}", etag)
            enviar.assert_not_called()

    def test_tras_el_reposo_del_motor_la_peticion_abre_una_conexion_nueva(self) -> None:
        """Tras más de REPOSO_MAXIMO_S sin uso se vacía el conjunto de conexiones; entre peticiones seguidas, no."""
        reloj = {"ahora": 1000.0}
        sesion = self.almacen._cliente._endpoint.http_session
        eventos: list[str] = []

        def enviar(request: object) -> AWSResponse:
            eventos.append("enviar")
            return http(request, 200, CONTENIDO)

        with (
            mock.patch.object(s3.time, "monotonic", side_effect=lambda: reloj["ahora"]),
            mock.patch.object(sesion, "send", side_effect=enviar),
            mock.patch.object(sesion, "close", side_effect=lambda: eventos.append("vaciar")),
            mock.patch.object(StreamingBody, "set_socket_timeout"),
        ):
            self.almacen.recuperar(CLAVE, self.temporal / "primera", HUELLA, len(CONTENIDO))
            reloj["ahora"] += s3.REPOSO_MAXIMO_S
            self.almacen.recuperar(CLAVE, self.temporal / "seguida", HUELLA, len(CONTENIDO))
            # Las 2 h 22 min del motor del ciclo del 24/11/2026.
            reloj["ahora"] += 2 * 3600 + 22 * 60
            self.almacen.recuperar(CLAVE, self.temporal / "tras el motor", HUELLA, len(CONTENIDO))
        self.assertEqual(eventos, ["enviar", "enviar", "vaciar", "enviar"])

    def conservar_recibo(self, enviar: object) -> tuple[list[str], list[dict]]:
        """Conserva un objeto como el paso del recibo, con su reintento, sobre un transporte dado.

        Returns:
            Los eventos del transporte («vaciar» cuando se vacía el conjunto de conexiones) y los del diario.
        """
        sesion = self.almacen._cliente._endpoint.http_session
        eventos: list[str] = []
        self.transporte = eventos
        ruta = self.temporal / "diario.jsonl"
        try:
            with (
                diario.abrir(ruta, {"run": "1"}, consola=False),
                mock.patch.object(diario, "PAUSAS", (0, 0)),
                mock.patch.object(sesion, "send", side_effect=lambda request: enviar(request, eventos)),
                mock.patch.object(sesion, "close", side_effect=lambda: eventos.append("vaciar")),
                mock.patch.object(StreamingBody, "set_socket_timeout"),
            ):
                diario.conservar_con_reintento(
                    "conservar-recibo", lambda: self.almacen.guardar(CLAVE, self.origen, HUELLA, len(CONTENIDO))
                )
        finally:
            self.diario = [json.loads(linea) for linea in ruta.read_text(encoding="utf-8").splitlines()]
        return eventos, self.diario

    def test_un_recibo_sin_respuesta_se_reintenta_con_una_conexion_nueva_y_se_conserva(self) -> None:
        """La conexión que no responde agota su plazo; el reintento abre otra, guarda y comprueba por lectura."""

        def enviar(request: object, eventos: list[str]) -> AWSResponse:
            if not eventos:
                eventos.append("sin-respuesta")
                raise ReadTimeoutError(endpoint_url=request.url)
            eventos.append(request.method)
            return http(request, 200, CONTENIDO if request.method == "GET" else b"")

        eventos, anotados = self.conservar_recibo(enviar)
        self.assertEqual(eventos, ["sin-respuesta", "vaciar", "PUT", "GET"])
        self.assertEqual(
            [(evento["fase"], evento["estado"], evento.get("causa")) for evento in anotados],
            [
                ("conservar-recibo", "inicio", None),
                ("conservar-recibo", "reintento", "almacen-no-disponible"),
                ("conservar-recibo", "confirmado", None),
            ],
        )

    def test_un_almacen_caido_sigue_sin_disponible_tras_los_intentos(self) -> None:
        """Si ninguna conexión responde, tras sus tres intentos el paso falla con almacen-no-disponible."""

        def enviar(request: object, eventos: list[str]) -> AWSResponse:
            eventos.append("sin-respuesta")
            raise ReadTimeoutError(endpoint_url=request.url)

        with self.assertRaises(s3.AlmacenS3NoDisponible):
            self.conservar_recibo(enviar)
        self.assertEqual(self.transporte, ["sin-respuesta", "vaciar", "sin-respuesta", "vaciar", "sin-respuesta"])
        self.assertEqual(
            [(evento["estado"], evento["causa"]) for evento in self.diario[1:]],
            [("reintento", "almacen-no-disponible")] * 2 + [("error", "almacen-no-disponible")],
        )


if __name__ == "__main__":
    unittest.main()
