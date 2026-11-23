"""Recepciones reales modeladas por transporte sintético, sin red ni archivos ajenos."""

import json
import tempfile
import unittest
from collections.abc import Callable
from pathlib import Path
from unittest.mock import patch
from urllib.error import URLError

from plataforma_datos.comun.nucleo import Descarga
from plataforma_datos.cursos import recepciones_catalogo as recepciones
from plataforma_datos.cursos.fuentes.hp_life import adquisicion as hp
from plataforma_datos.cursos.fuentes.hp_life.recepciones import leer_recepcion
from plataforma_datos.cursos.pruebas import test_hp_life_observaciones as fixtures


class AdquisicionHpLifePruebas(unittest.TestCase):
    """Adquisición aislada con conservación e identidad verificables."""

    def setUp(self) -> None:
        """Cada caso posee sus archivos y reloj explícitos."""
        temporal = tempfile.TemporaryDirectory(prefix="Recepción HP ñ ")
        self.addCleanup(temporal.cleanup)
        self.area = Path(temporal.name)
        self.cuerpo, _ = fixtures.recepcion()

    def recibir(self, *, inicio: str = "2026-10-23T02:07:20Z", fin: str = fixtures.FIN) -> hp.AdquisicionHpLife:
        """Ejecuta el adaptador con dos fechas del transporte de prueba.

        Returns:
            Intento y recepción de ese único envío sintético.
        """
        fechas = iter((inicio, fin))
        return hp.recibir(fixtures.URL, id=fixtures.OFERTA["id"], area=self.area, reloj=lambda: next(fechas))

    def transporte(self, *, codigo: int = 200, cabeceras: dict[str, str] | None = None) -> Callable[..., Descarga]:
        """Respuesta íntegra con llamada de retorno HTTP.

        Returns:
            Transporte sustituido que no abre conexiones.
        """

        def descargar(url: str, **opciones: object) -> Descarga:
            self.assertEqual(url, fixtures.URL)
            self.assertEqual(opciones["perfil"], "pagina")
            self.assertEqual(opciones["maximo_bytes"], recepciones.MAX_CUERPO)
            opciones["comprobar_cabeceras"](codigo, url, cabeceras or {})
            return Descarga(self.cuerpo, url, "text/html; charset=utf-8")

        return descargar

    def test_conserva_recepcion_intervalo_y_original_completos(self) -> None:
        """La recepción aporta fechas de consulta; no las toma del mtime ni de la migración."""
        with patch.object(recepciones.red, "descargar_url", side_effect=self.transporte()):
            resultado = self.recibir()
        rx = resultado.recepcion
        recepcion = leer_recepcion(rx.cuerpo.ruta.read_bytes(), rx.recibo.ruta.read_bytes())
        self.assertEqual(recepcion.cuerpo, self.cuerpo)
        self.assertEqual(recepcion.inicio_utc, "2026-10-23T02:07:20Z")
        self.assertEqual(recepcion.captura.recibido_utc, fixtures.FIN)
        self.assertTrue(recepcion.captura.completo)
        self.assertTrue(recepcion.captura.original_conservado)

    def test_otro_intento_identico_conserva_ambos_recibos_y_un_cuerpo(self) -> None:
        """Bytes iguales no fusionan consultas; repetir una misma recepción conserva su archivo."""
        with patch.object(recepciones.red, "descargar_url", side_effect=self.transporte()):
            primera = self.recibir()
            antes = primera.recepcion.recibo.ruta.read_bytes(), primera.recepcion.recibo.ruta.stat().st_mtime_ns
            segunda = self.recibir(inicio="2026-10-23T03:00:00Z", fin="2026-10-23T03:00:01Z")
            repetida = self.recibir()
        self.assertEqual(primera.recepcion.cuerpo, segunda.recepcion.cuerpo)
        self.assertNotEqual(primera.recepcion.recibo, segunda.recepcion.recibo)
        self.assertEqual(primera, repetida)
        self.assertEqual(
            (primera.recepcion.recibo.ruta.read_bytes(), primera.recepcion.recibo.ruta.stat().st_mtime_ns), antes
        )
        self.assertEqual(len(list(self.area.glob("*.body"))), 1)
        self.assertEqual(len(list(self.area.glob("*.recepcion.json"))), 2)

    def test_fallo_sin_respuesta_no_fabrica_http_ni_recepcion(self) -> None:
        """Un error temporal conserva el intento; no produce cuerpo vacío o HTTP de cierre."""
        with patch.object(recepciones.red, "descargar_url", side_effect=URLError("fallo sintético")):
            resultado = self.recibir()
        self.assertIsNone(resultado.recepcion)
        intento = json.loads(resultado.intento.ruta.read_bytes())
        self.assertEqual(intento["resultado"], "fallo")
        self.assertNotIn("http", intento)
        self.assertEqual(list(self.area.glob("*.body")), [])

    def test_parcial_no_se_presenta_como_captura_completa(self) -> None:
        """HTTP206 y Content-Range explícito se conservan como incompletos."""
        for codigo, cabeceras in ((206, {}), (200, {"Content-Range": "bytes 0-9/100"})):
            with (
                self.subTest(codigo=codigo),
                patch.object(
                    recepciones.red, "descargar_url", side_effect=self.transporte(codigo=codigo, cabeceras=cabeceras)
                ),
            ):
                resultado = self.recibir()
            rx = resultado.recepcion
            self.assertFalse(leer_recepcion(rx.cuerpo.ruta.read_bytes(), rx.recibo.ruta.read_bytes()).captura.completo)

    def test_url_o_identidad_ajenas_se_rechazan_antes_de_red(self) -> None:
        """Solo identidades conocidas del curso pueden salir por el transporte."""
        for url, identidad in (
            ("https://example.org/course/1", fixtures.OFERTA["id"]),
            (fixtures.URL, "hp-life:99999:es"),
        ):
            with (
                self.subTest(url=url),
                patch.object(recepciones.red, "descargar_url") as descargar,
                self.assertRaises(hp.ErrorFichaHpLife),
            ):
                hp.recibir(url, id=identidad, area=self.area)
            descargar.assert_not_called()
