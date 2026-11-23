"""Recepciones privadas por descarga: transporte completo, límites y aislamiento sin red real."""

import copy
import hashlib
import io
import json
import os
import tempfile
import unittest
from contextlib import redirect_stderr, suppress
from http.client import HTTPResponse, IncompleteRead
from pathlib import Path
from unittest import mock

from plataforma_datos.comun import observacion_remota as observacion
from plataforma_datos.comun import red
from plataforma_datos.comun.nucleo import FormatoInesperado
from plataforma_datos.orquestacion import ordenes

FUENTE = "formacion"
INTENTO = "intento_1"
URL = "https://ejemplo.invalid/datos?token=secreto-de-prueba"
AHORA = "2026-10-17T08:00:00+00:00"


def respuesta_http(cabeceras: bytes, cuerpo: bytes) -> HTTPResponse:
    """Interpreta framing HTTP real desde memoria, sin servidor ni socket de red.

    Returns:
        Respuesta HTTP lista para el lector común.
    """
    conexion = mock.Mock()
    conexion.makefile.return_value = io.BytesIO(b"HTTP/1.1 200 OK\r\n" + cabeceras + b"\r\n" + cuerpo)
    respuesta = HTTPResponse(conexion)
    respuesta.begin()
    respuesta.url = URL
    return respuesta


def documento() -> dict:
    """Compone una recepción cerrada de una petición, con instante UTC fijo para los casos del lector.

    Returns:
        Documento independiente y pequeño.
    """
    return {
        "version": 1,
        "fuente": FUENTE,
        "intento": INTENTO,
        "comienzo_utc": AHORA,
        "fin_utc": AHORA,
        "peticiones": [
            {
                "recurso_sha256": observacion.identidad_recurso(URL),
                "url_final_sha256": hashlib.sha256(URL.encode()).hexdigest(),
                "respuesta_sha256": hashlib.sha256(b"dato").hexdigest(),
                "bytes": len(b"dato"),
                "completado_utc": AHORA,
            }
        ],
    }


class PruebaObservacionRemota(unittest.TestCase):
    """El contexto emite solo al terminar la descarga y nunca persiste datos de la petición."""

    def setUp(self) -> None:
        """Crea una recepción nueva por prueba y limpia solo su variable interna."""
        pausa_red = mock.patch.object(red, "PAUSAS", red.PausasPorDominio(lambda: 0.0, lambda _segundos: None))
        pausa_red.start()
        self.addCleanup(pausa_red.stop)
        self.temporal = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporal.cleanup)
        self.ruta = Path(self.temporal.name) / "recepcion.json"
        self.entorno = mock.patch.dict(os.environ)
        self.entorno.start()
        self.addCleanup(self.entorno.stop)
        os.environ.pop(observacion.VARIABLE_RECEPCION, None)

    def configurar(self, intento: str = INTENTO) -> None:
        """Inyecta la recepción privada del padre, que el contexto consumirá una sola vez."""
        os.environ[observacion.VARIABLE_RECEPCION] = json.dumps(
            {
                "ruta": str(self.ruta),
                "fuente": FUENTE,
                "intento": intento,
            }
        )

    def leer(self) -> dict:
        """Lee la recepción usando el contrato público del padre.

        Returns:
            Documento presente y validado.
        """
        resultado = observacion.leer_recepcion(self.ruta, FUENTE, INTENTO)
        self.assertIsNotNone(resultado)
        return resultado

    def descargar(self, cabeceras: bytes = b"Content-Length: 4\r\n", datos: bytes = b"dato") -> bytes:
        """Llama al transporte real con respuesta HTTP en memoria.

        Returns:
            Bytes exactos entregados por el transporte.
        """
        with mock.patch.object(red, "abrir_peticion", return_value=respuesta_http(cabeceras, datos)) as abrir:
            contenido = red.descargar_url(URL, {"User-Agent": "otro"}, cuerpo=b"clave=secreto-de-prueba").datos
        peticion = abrir.call_args.args[0]
        self.assertEqual(peticion.get_header("User-agent"), red.agente_de_usuario())
        return contenido

    def test_recepcion_registra_hashes_y_bytes_sin_datos_sensibles(self) -> None:
        """El documento vincula una petición completa; nunca contiene URL, consulta, cuerpo o cabeceras."""
        self.configurar()
        with observacion.contexto_descarga():
            self.assertNotIn(observacion.VARIABLE_RECEPCION, os.environ)
            self.assertFalse(self.ruta.exists())
            self.assertEqual(self.descargar(), b"dato")
        recibo = self.leer()
        peticion = recibo["peticiones"][0]
        self.assertEqual(
            peticion["recurso_sha256"], observacion.identidad_recurso(URL, "POST", b"clave=secreto-de-prueba")
        )
        self.assertEqual(peticion["respuesta_sha256"], hashlib.sha256(b"dato").hexdigest())
        self.assertEqual(peticion["bytes"], len(b"dato"))
        self.assertNotIn(b"secreto-de-prueba", self.ruta.read_bytes())
        self.assertNotIn(b"https:", self.ruta.read_bytes())
        self.assertEqual(self.ruta.stat().st_mode & 0o777, 0o600)

    def test_sin_variable_no_observa_ni_valida_argumentos(self) -> None:
        """Otros controles conservan su conducta sin recepción ni estado residual."""
        with observacion.contexto_descarga():
            observacion.observar(None, None, None, None, None)
            self.assertEqual(self.descargar(), b"dato")
        self.assertFalse(self.ruta.exists())

    def test_cero_peticiones_y_descarga_manual_no_acreditan_http(self) -> None:
        """El éxito de una etapa que solo revisa copias produce cero observaciones, no una petición inventada."""
        self.configurar()
        self.assertEqual(ordenes.principal_fuente("manual", {"descargar": lambda: None}, ["descargar"]), 0)
        self.assertEqual(self.leer()["peticiones"], [])

    def test_ambas_cli_abren_contexto_solo_descargar(self) -> None:
        """Preparar y validar pueden consultar HTTP sin entrar en el recibo de la descarga."""
        for con_descarga in (False, True):
            with self.subTest(con_descarga=con_descarga):
                self.ruta.unlink(missing_ok=True)
                self.configurar()

                def descargar(aceptar: bool = False, esperado: bool = con_descarga) -> None:
                    self.assertEqual(aceptar, esperado)
                    self.descargar()

                etapas = {"preparar": self.descargar, "validar": self.descargar}
                if con_descarga:
                    codigo = ordenes.principal_fuente_con_descarga(
                        "fuente",
                        descargar,
                        etapas,
                        ["todo", "--aceptar-cambio"],
                    )
                else:
                    codigo = ordenes.principal_fuente("fuente", {"descargar": descargar, **etapas}, ["todo"])
                self.assertEqual(codigo, 0)
                self.assertEqual(len(self.leer()["peticiones"]), 1)

    def test_validar_solo_no_consume_variable_ni_crea_recepcion(self) -> None:
        """Una variable presente no activa recepción en etapas locales."""
        self.configurar()
        self.assertEqual(ordenes.principal_fuente("fuente", {"validar": self.descargar}, ["validar"]), 0)
        self.assertIn(observacion.VARIABLE_RECEPCION, os.environ)
        self.assertFalse(self.ruta.exists())

    def test_fallo_timeout_o_corte_no_crean_recepcion_y_limpian_contexto(self) -> None:
        """Ni siquiera peticiones previas completas convierten una llamada de retorno interrumpida en éxito."""
        for error in (OSError("fallo"), TimeoutError("plazo"), KeyboardInterrupt()):
            with self.subTest(error=type(error).__name__):
                self.configurar()
                with self.assertRaises(type(error)), observacion.contexto_descarga():
                    self.descargar()
                    raise error
                self.assertFalse(self.ruta.exists())
                observacion.observar(None, None, None, None, None)
        self.configurar()
        with observacion.contexto_descarga():
            pass
        self.assertEqual(self.leer()["peticiones"], [])

    def test_truncado_content_length_no_puede_afirmar_http_completo(self) -> None:
        """read1 real puede terminar antes del Content-Length sin lanzar: la frontera debe rechazarlo."""
        self.configurar()
        with self.assertRaises(FormatoInesperado), observacion.contexto_descarga():
            self.descargar(b"Content-Length: 8\r\n", b"dato")
        self.assertFalse(self.ruta.exists())

    def test_chunked_completo_prevalece_y_sin_longitud_se_permite(self) -> None:
        """El framing chunked manda sobre Content-Length; sin ninguno, EOF es el límite válido."""
        for cabeceras, cuerpo in (
            (b"Transfer-Encoding: chunked\r\nContent-Length: 99\r\n", b"4\r\ndato\r\n0\r\n\r\n"),
            (b"Content-Type: application/octet-stream\r\n", b"dato"),
        ):
            with self.subTest(cabeceras=cabeceras):
                self.ruta.unlink(missing_ok=True)
                self.configurar()
                with observacion.contexto_descarga():
                    self.assertEqual(self.descargar(cabeceras, cuerpo), b"dato")
                self.assertEqual(self.leer()["peticiones"][0]["bytes"], len(b"dato"))

    def test_chunked_truncado_no_emite_recepcion(self) -> None:
        """El lector HTTP real detecta el corte de un chunk antes de que observar pueda registrarlo."""
        self.configurar()
        with self.assertRaises(IncompleteRead), observacion.contexto_descarga():
            self.descargar(b"Transfer-Encoding: chunked\r\n", b"8\r\ndato")
        self.assertFalse(self.ruta.exists())

    def test_transferencia_chunked_no_decodificada_no_se_admite(self) -> None:
        """No normaliza un TE que HTTPResponse no reconoce: sus tramas crudas no son el cuerpo del recurso."""
        respuesta = respuesta_http(b"Transfer-Encoding: chunked \r\nContent-Length: 99\r\n", b"4\r\ndato\r\n")
        self.assertFalse(respuesta.chunked)
        self.configurar()
        with (
            mock.patch.object(red, "abrir_peticion", return_value=respuesta),
            self.assertRaises(FormatoInesperado),
            observacion.contexto_descarga(),
        ):
            red.descargar_url(URL)
        self.assertFalse(self.ruta.exists())

    def test_longitud_malformada_o_incompatible_no_se_admite(self) -> None:
        """Un encabezado que afirma otra longitud no puede producir una prueba de lectura completa."""
        for longitud in (b"+4", b"-1", b"4,5", b"invalida"):
            with self.subTest(longitud=longitud):
                self.configurar()
                with self.assertRaises(FormatoInesperado), observacion.contexto_descarga():
                    self.descargar(b"Content-Length: " + longitud + b"\r\n")
                self.assertFalse(self.ruta.exists())
        self.configurar()
        with self.assertRaises(FormatoInesperado), observacion.contexto_descarga():
            self.descargar(b"Content-Length: 4\r\nContent-Length: 8\r\n")
        self.assertFalse(self.ruta.exists())

    def test_limite_observaciones_invalida_aunque_callback_capture_error(self) -> None:
        """No se emite una recepción incompleta al alcanzar la cota y ocultar ese error en la llamada de retorno."""
        self.configurar()
        with (
            mock.patch.object(observacion, "MAX_PETICIONES", 1),
            self.assertRaises(FormatoInesperado),
            observacion.contexto_descarga(),
        ):
            self.descargar()
            with suppress(FormatoInesperado):
                self.descargar()
        self.assertFalse(self.ruta.exists())

    def test_contexto_anidado_no_emite_y_no_contamina_siguiente(self) -> None:
        """La colección activa no se mezcla con otra; después puede observarse un intento nuevo."""
        self.configurar()
        with self.assertRaises(FormatoInesperado), observacion.contexto_descarga(), observacion.contexto_descarga():
            pass
        self.assertFalse(self.ruta.exists())
        self.configurar()
        with observacion.contexto_descarga():
            self.descargar()
        self.assertEqual(len(self.leer()["peticiones"]), 1)

    def test_no_sobrescribe_archivo_existente_o_enlace(self) -> None:
        """La recepción es nueva y exclusiva; nunca trunca ni sustituye entradas ajenas."""
        ajeno = self.ruta.parent / "ajeno"
        ajeno.write_bytes(b"conservar")
        for enlace in (False, True):
            with self.subTest(enlace=enlace):
                self.ruta.unlink(missing_ok=True)
                if enlace:
                    self.ruta.symlink_to(ajeno)
                else:
                    self.ruta.write_bytes(b"conservar")
                self.configurar()
                with self.assertRaises(FormatoInesperado), observacion.contexto_descarga():
                    self.descargar()
                self.assertEqual(self.ruta.read_bytes(), b"conservar")
                self.assertEqual(ajeno.read_bytes(), b"conservar")

    def test_reintento_no_acepta_recepcion_del_intento_anterior(self) -> None:
        """La identidad opaca del padre evita reutilizar un documento previo como éxito de otra ejecución."""
        self.configurar()
        with observacion.contexto_descarga():
            self.descargar()
        with self.assertRaises(FormatoInesperado):
            observacion.leer_recepcion(self.ruta, FUENTE, "intento_2")

    def test_error_escritura_retira_solo_archivo_propio_y_restablece_contexto(self) -> None:
        """Una recepción no confirmada se retira y el fallo no deja la observación activa."""
        self.configurar()
        with (
            mock.patch.object(observacion.os, "fsync", side_effect=OSError("sin espacio")),
            self.assertRaises(FormatoInesperado),
            observacion.contexto_descarga(),
        ):
            self.descargar()
        self.assertFalse(self.ruta.exists())
        observacion.observar(None, None, None, None, None)

    def test_cota_del_documento_se_aplica_antes_de_crear_archivo(self) -> None:
        """Aunque la llamada de retorno termine, un documento fuera del límite no se escribe parcialmente."""
        self.configurar()
        with (
            mock.patch.object(observacion, "MAX_RECEPCION_BYTES", 1),
            self.assertRaises(FormatoInesperado),
            observacion.contexto_descarga(),
        ):
            self.descargar()
        self.assertFalse(self.ruta.exists())

    def test_configuracion_invalida_se_consume_y_error_no_refleja_contenido(self) -> None:
        """El canal interno no acepta claves repetidas, rutas relativas ni identidades defectuosas."""
        for configuracion in (
            '{"ruta":"secreto","ruta":"otra","fuente":"formacion","intento":"i"}',
            json.dumps({"ruta": "secreto", "fuente": FUENTE, "intento": INTENTO}),
            json.dumps({"ruta": str(self.ruta), "fuente": "fuente secreta", "intento": INTENTO}),
            json.dumps({"ruta": "/tmp/\ud800", "fuente": FUENTE, "intento": INTENTO}),
        ):
            with self.subTest(configuracion=configuracion):
                os.environ[observacion.VARIABLE_RECEPCION] = configuracion
                with redirect_stderr(io.StringIO()) as salida:
                    codigo = ordenes.principal_fuente("fuente", {"descargar": lambda: None}, ["descargar"])
                self.assertEqual(codigo, 1)
                self.assertNotIn("secreto", salida.getvalue())
                self.assertNotIn(observacion.VARIABLE_RECEPCION, os.environ)
                self.assertFalse(self.ruta.exists())


class PruebaLectorRecepcion(unittest.TestCase):
    """El padre interpreta solo documentos cerrados, completos y ligados a su intento."""

    def test_identidad_encuadra_campos_y_distingue_cuerpo_vacio(self) -> None:
        """No confunde partes concatenadas, métodos o ausencia de cuerpo con un POST vacío."""
        identidades = {
            observacion.identidad_recurso("ab", "GET", b"c"),
            observacion.identidad_recurso("a", "GET", b"bc"),
            observacion.identidad_recurso("ab", "POST", b"c"),
            observacion.identidad_recurso("ab", "GET", None),
            observacion.identidad_recurso("ab", "GET", b""),
        }
        self.assertEqual(len(identidades), 5)
        self.assertEqual(observacion.identidad_recurso(URL), observacion.identidad_recurso(URL))

    def test_validador_copia_entrada_y_rechaza_tipos_hashes_y_fechas(self) -> None:
        """Booleanos, claves sobrantes, hashes o tiempos defectuosos nunca quedan normalizados."""
        original = documento()
        copia = observacion.validar_recepcion(original, FUENTE, INTENTO)
        copia["peticiones"][0]["bytes"] = 0
        self.assertEqual(original["peticiones"][0]["bytes"], len(b"dato"))
        casos = [{**original, "version": True}, {**original, "extra": 1}, {**original, "fuente": "citilab"}]
        for campo, valor in (
            ("bytes", True),
            ("bytes", -1),
            ("recurso_sha256", "0" * 63),
            ("completado_utc", "2026-10-17T09:00:00+01:00"),
            ("completado_utc", "2026-02-30T08:00:00Z"),
            ("completado_utc", "2026-10-17T09:00:00Z"),
        ):
            caso = copy.deepcopy(original)
            caso["peticiones"][0][campo] = valor
            casos.append(caso)
        for caso in casos:
            with self.subTest(caso=caso), self.assertRaises(FormatoInesperado):
                observacion.validar_recepcion(caso, FUENTE, INTENTO)

    def test_lector_ausente_corrupto_truncado_duplicado_y_enlaces(self) -> None:
        """Ausente es None; toda entrada existente defectuosa se rechaza sin seguir enlaces."""
        with tempfile.TemporaryDirectory() as temporal:
            ruta = Path(temporal) / "recepcion.json"
            self.assertIsNone(observacion.leer_recepcion(ruta, FUENTE, INTENTO))
            for contenido in (b"", b"{", b'{"version":1,"version":1}', b'{"version":NaN}'):
                with self.subTest(contenido=contenido):
                    ruta.write_bytes(contenido)
                    with self.assertRaises(FormatoInesperado):
                        observacion.leer_recepcion(ruta, FUENTE, INTENTO)
            ruta.write_text(json.dumps(documento()))
            self.assertEqual(observacion.leer_recepcion(ruta, FUENTE, INTENTO), documento())
            alias = ruta.parent / "alias"
            alias.symlink_to(ruta)
            with self.assertRaises(FormatoInesperado):
                observacion.leer_recepcion(alias, FUENTE, INTENTO)
            alias.unlink()
            os.link(ruta, alias)
            with self.assertRaises(FormatoInesperado):
                observacion.leer_recepcion(ruta, FUENTE, INTENTO)

    def test_orden_temporal_de_las_peticiones_se_exige(self) -> None:
        """Peticiones dentro de la ventana pero invertidas no forman una recepción válida."""
        copia = documento()
        copia["fin_utc"] = "2026-10-17T10:00:00Z"
        copia["peticiones"] = [
            {**copia["peticiones"][0], "completado_utc": "2026-10-17T09:00:00Z"},
            copia["peticiones"][0],
        ]
        with self.assertRaises(FormatoInesperado):
            observacion.validar_recepcion(copia, FUENTE, INTENTO)

    def test_lector_rechaza_archivo_excesivo_sin_leerlo(self) -> None:
        """La cota se aplica a fstat antes de cargar el JSON."""
        with tempfile.TemporaryDirectory() as temporal:
            ruta = Path(temporal) / "recepcion.json"
            with ruta.open("wb") as archivo:
                archivo.truncate(observacion.MAX_RECEPCION_BYTES + 1)
            with self.assertRaises(FormatoInesperado):
                observacion.leer_recepcion(ruta, FUENTE, INTENTO)


if __name__ == "__main__":
    unittest.main()
