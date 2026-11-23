"""La recepción distingue el cuerpo HTTP del original conservado, sin eludir el control de admisión."""

import copy
import hashlib
import json
import os
import tempfile
import unittest
from contextlib import suppress
from pathlib import Path
from unittest import mock

from plataforma_datos.comun import observacion_remota as observacion
from plataforma_datos.comun import red
from plataforma_datos.comun.nucleo import Descarga, FormatoInesperado, OriginalCambiado
from plataforma_datos.comun.pruebas.test_observacion_remota import documento, respuesta_http

URL = "https://ejemplo.invalid/datos?token=secreto-de-prueba"
NUEVO = b'{"filas":1,"visitas":2}'
PREVIO = b'{"filas":1,"visitas":1}'


class PruebaOriginalObservado(unittest.TestCase):
    """El vínculo se emite después de conservar y solo para la respuesta concreta ya observada."""

    def setUp(self) -> None:
        """Aísla archivos, entorno y HTTP de cada prueba."""
        pausa_red = mock.patch.object(red, "PAUSAS", red.PausasPorDominio(lambda: 0.0, lambda _segundos: None))
        pausa_red.start()
        self.addCleanup(pausa_red.stop)
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.raiz = Path(temporal.name)
        self.recibo = self.raiz / "recepcion.json"
        self.original = self.raiz / "original.json"
        self.original.write_bytes(PREVIO)
        entorno = mock.patch.dict(
            os.environ,
            {
                observacion.VARIABLE_RECEPCION: json.dumps(
                    {"ruta": str(self.recibo), "fuente": "consorci", "intento": "prueba"}
                )
            },
        )
        entorno.start()
        self.addCleanup(entorno.stop)
        self.archivo = {
            "archivo": self.original.name,
            "nivel": "oficial",
            "titulo": "Datos de prueba",
            "url": URL,
            "licencia": "Prueba",
        }

    def respuesta(self) -> object:
        """Crea una respuesta HTTP real en memoria.

        Returns:
            Respuesta con longitud coherente, sin conexiones de red.
        """
        return respuesta_http(f"Content-Length: {len(NUEVO)}\r\n".encode(), NUEVO)

    def test_equivalencia_conserva_bytes_y_vincula_ambas_huellas(self) -> None:
        """Cambiar un contador volátil no impide demostrar qué original admitió la consulta."""
        with mock.patch.object(red, "abrir_peticion", return_value=self.respuesta()), observacion.contexto_descarga():
            registros = red.descargar_originales(
                [self.archivo],
                self.raiz,
                False,
                lambda _archivo: lambda a, b: json.loads(a)["filas"] == json.loads(b)["filas"],
            )
        recibo = observacion.leer_recepcion(self.recibo, "consorci", "prueba")
        self.assertEqual(recibo["version"], 2)
        peticion = recibo["peticiones"][0]
        self.assertEqual(peticion["respuesta_sha256"], hashlib.sha256(NUEVO).hexdigest())
        self.assertEqual(peticion["original_sha256"], hashlib.sha256(PREVIO).hexdigest())
        self.assertEqual(peticion["original_bytes"], len(PREVIO))
        self.assertEqual(registros[0]["sha256"], peticion["original_sha256"])
        self.assertEqual(self.original.read_bytes(), PREVIO)
        self.assertNotIn(b"secreto-de-prueba", self.recibo.read_bytes())

    def test_cambio_rechazado_o_escritura_fallida_no_emiten_vinculo(self) -> None:
        """Ni un cambio sin permiso ni una escritura fallida acreditan un original admitido."""
        for fallo in (False, True):
            with (
                self.subTest(fallo=fallo),
                mock.patch.object(red, "abrir_peticion", return_value=self.respuesta()),
                mock.patch.object(red, "escribir_bytes_entero", side_effect=OSError("sin espacio")),
                self.assertRaises(OSError if fallo else OriginalCambiado),
                observacion.contexto_descarga(),
            ):
                red.descargar_originales([self.archivo], self.raiz, fallo)
            self.assertFalse(self.recibo.exists())
            self.assertEqual(self.original.read_bytes(), PREVIO)
            os.environ[observacion.VARIABLE_RECEPCION] = json.dumps(
                {"ruta": str(self.recibo), "fuente": "consorci", "intento": "prueba"}
            )

    def test_control_de_respuesta_precede_observacion_y_escritura(self) -> None:
        """Un catálogo incompleto detectado por el control específico no llega a conservarse."""

        def rechazar(datos: bytes, cabeceras: object) -> None:
            self.assertEqual(datos, NUEVO)
            self.assertEqual(cabeceras["Content-Length"], str(len(NUEVO)))
            raise FormatoInesperado("Catálogo incompleto")

        with (
            mock.patch.object(red, "abrir_peticion", return_value=self.respuesta()),
            mock.patch.object(red, "observar") as observar,
            self.assertRaises(FormatoInesperado),
            observacion.contexto_descarga(),
        ):
            red.descargar_originales([self.archivo], self.raiz, True, comprobar=rechazar)
        observar.assert_not_called()
        self.assertFalse(self.recibo.exists())
        self.assertEqual(self.original.read_bytes(), PREVIO)

    def test_vinculo_ajeno_o_duplicado_invalida_recepcion(self) -> None:
        """Una llamada de retorno que captura el error tampoco puede emitir la recepción incompleta."""
        for caso in ("sin-http", "url", "destino", "cuerpo", "duplicado"):
            with self.subTest(caso=caso):
                os.environ[observacion.VARIABLE_RECEPCION] = json.dumps(
                    {"ruta": str(self.recibo), "fuente": "consorci", "intento": "prueba"}
                )
                with self.assertRaises(FormatoInesperado), observacion.contexto_descarga():
                    if caso != "sin-http":
                        observacion.observar(URL, "GET", None, URL, NUEVO)
                    if caso == "duplicado":
                        observacion.observar_original(URL, Descarga(NUEVO, URL, ""), PREVIO)
                    with suppress(FormatoInesperado):
                        observacion.observar_original(
                            URL if caso != "url" else URL + "otra",
                            Descarga(
                                NUEVO if caso != "cuerpo" else PREVIO,
                                URL if caso != "destino" else URL + "otro",
                                "",
                            ),
                            PREVIO,
                        )
                self.assertFalse(self.recibo.exists())

    def test_sin_contexto_no_valida_ni_calcula_huellas(self) -> None:
        """La observación no altera llamadas ordinarias sin receptor interno."""
        observacion.observar_original(None, None, None)


class PruebaContratoOriginal(unittest.TestCase):
    """La versión anterior sigue legible, sin inventarle evidencia de conservación."""

    def test_version_uno_y_version_dos_con_vinculo_o_sin_el(self) -> None:
        """Una recepción antigua no recibe los campos nuevos por defecto."""
        legado = documento()
        self.assertEqual(observacion.validar_recepcion(legado, legado["fuente"], legado["intento"]), legado)
        nuevo = copy.deepcopy(legado)
        nuevo["version"] = 2
        peticion = nuevo["peticiones"][0]
        for huella, tamano in ((None, None), (hashlib.sha256(PREVIO).hexdigest(), len(PREVIO))):
            peticion.update(original_sha256=huella, original_bytes=tamano)
            self.assertEqual(observacion.validar_recepcion(nuevo, nuevo["fuente"], nuevo["intento"]), nuevo)
        for huella, tamano in ((None, 1), ("0" * 64, None), ("mal", 1), ("0" * 64, True), ("0" * 64, -1)):
            peticion.update(original_sha256=huella, original_bytes=tamano)
            with self.subTest(huella=huella, tamano=tamano), self.assertRaises(FormatoInesperado):
                observacion.validar_recepcion(nuevo, nuevo["fuente"], nuevo["intento"])
        nuevo["version"] = 1
        peticion.update(original_sha256=None, original_bytes=None)
        with self.assertRaises(FormatoInesperado):
            observacion.validar_recepcion(nuevo, nuevo["fuente"], nuevo["intento"])


if __name__ == "__main__":
    unittest.main()
