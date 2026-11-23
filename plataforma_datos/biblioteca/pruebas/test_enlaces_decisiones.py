"""Diagnósticos de URL y continuidad de evidencia sin borrar el catálogo editorial."""

import unittest
from dataclasses import replace
from datetime import timedelta

from plataforma_datos.biblioteca.fuentes.enlaces_lecturas import contrato
from plataforma_datos.biblioteca.pruebas.test_enlaces_lecturas import AHORA, HTML, _MontadorProductor


class PruebaDecisionesEnlaces(_MontadorProductor, unittest.TestCase):
    """Cada secuencia usa originales sintéticos propios y ninguna red."""

    def test_http_ausente_es_evidencia_de_url_no_error_tecnico_ni_baja_editorial(self) -> None:
        """404/410 describen esta respuesta de la URL; no declaran desaparecida la obra."""
        for codigo, esperado in ((404, "http_no_encontrado"), (410, "http_retirado")):
            captura = replace(self.captura(fallo=True), resultado="http_error", codigo_http=codigo)
            resultado = contrato.evaluar(captura, None, None, contrato.Contexto(AHORA, 7))
            with self.subTest(codigo=codigo):
                self.assertEqual(resultado["estado"], esperado)
                self.assertFalse(resultado["identidad_acreditada"])
                self.assertEqual(resultado["codigo_http"], codigo)

    def test_un_fallo_no_borra_la_respuesta_negativa_intermedia(self) -> None:
        """Una confirmación vieja no tapa un 410 seguido de una caída temporal."""
        self.identidad()
        positiva = self.captura(AHORA - timedelta(days=2))
        negativa = replace(self.captura(AHORA - timedelta(days=1), fallo=True), resultado="http_error", codigo_http=410)
        self.lector.conservar(positiva, HTML)
        self.lector.conservar(negativa, None)
        self.lector.conservar(self.captura(fallo=True), None)
        antes = {p: (p.read_bytes(), p.stat().st_mtime_ns) for p in self.carpetas.original.rglob("*") if p.is_file()}
        fila = self.informe()["objetivos"][0]
        self.assertEqual(fila["ultimo_intento"]["estado"], "fallo_temporal")
        self.assertEqual(fila["ultima_evidencia"]["estado"], "http_retirado")
        self.assertEqual(fila["ultima_evidencia"]["capturado_utc"], negativa.capturado_utc)
        self.assertEqual(fila["ultima_confirmacion"]["capturado_utc"], positiva.capturado_utc)
        despues = {p: (p.read_bytes(), p.stat().st_mtime_ns) for p in antes}
        self.assertEqual(antes, despues)
        self.assertEqual(self.informe()["objetivos"][0], fila)

    def test_diagnostico_de_limite_no_afirma_ausencia_del_documento(self) -> None:
        """Límite local y destino inseguro conservan causas distintas."""
        for error, esperado in (("LimiteDescargaExcedido", "limite_tamano"), ("DestinoNoSeguro", "destino_no_seguro")):
            captura = replace(self.captura(fallo=True), error_tipo=error)
            resultado = contrato.evaluar(captura, None, None, contrato.Contexto(AHORA, 7))
            with self.subTest(error=error):
                self.assertEqual(resultado["estado"], esperado)
                self.assertFalse(resultado["identidad_acreditada"])

    def test_confirmacion_posterior_reemplaza_negativa_sin_cambiar_sus_fechas(self) -> None:
        """La recuperación requiere una respuesta de identidad acreditada más reciente."""
        self.identidad()
        negativa = replace(self.captura(AHORA - timedelta(days=1), fallo=True), resultado="http_error", codigo_http=404)
        self.lector.conservar(negativa, None)
        self.lector.conservar(self.captura(), HTML)
        fila = self.informe()["objetivos"][0]
        self.assertEqual(fila["ultima_evidencia"]["estado"], "verificado")
        self.assertEqual(fila["ultima_evidencia"], fila["ultima_confirmacion"])

    def test_llegada_desordenada_no_pisa_evidencia_reciente(self) -> None:
        """La llegada tardía de un éxito antiguo no reabre una URL retirada después."""
        self.identidad()
        positiva = self.captura(AHORA - timedelta(days=2))
        negativa = replace(self.captura(AHORA - timedelta(days=1), fallo=True), resultado="http_error", codigo_http=410)
        self.lector.conservar(self.captura(fallo=True), None)
        self.lector.conservar(negativa, None)
        self.lector.conservar(positiva, HTML)
        fila = self.informe()["objetivos"][0]
        self.assertEqual(fila["ultimo_intento"]["capturado_utc"], AHORA.isoformat())
        self.assertEqual(fila["ultima_evidencia"]["capturado_utc"], negativa.capturado_utc)
        self.assertEqual(fila["ultima_confirmacion"]["capturado_utc"], positiva.capturado_utc)

    def test_fallos_consecutivos_no_cambian_fecha_de_confirmacion_o_evidencia(self) -> None:
        """Caída, cortafuegos y servidor fallido solo aportan intentos posteriores."""
        self.identidad()
        positiva = self.captura(AHORA - timedelta(days=4))
        self.lector.conservar(positiva, HTML)
        for dias, codigo in ((2, 503), (1, 403), (0, None)):
            fallo = self.captura(AHORA - timedelta(days=dias), fallo=True)
            if codigo is not None:
                fallo = replace(fallo, resultado="http_error", codigo_http=codigo)
            self.lector.conservar(fallo, None)
            fila = self.informe()["objetivos"][0]
            self.assertEqual(fila["ultimo_intento"]["capturado_utc"], fallo.capturado_utc)
            self.assertEqual(fila["ultima_evidencia"]["capturado_utc"], positiva.capturado_utc)
            self.assertEqual(fila["ultima_confirmacion"]["capturado_utc"], positiva.capturado_utc)
