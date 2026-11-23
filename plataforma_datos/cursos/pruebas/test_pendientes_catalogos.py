"""Ciclos sin red de Ciber y Cibernàrium: un catálogo no instalado no pierde sus observaciones.

Un ciclo se admite pero su paquete falla. El siguiente ciclo evalúa lo pendiente con su
fecha de captura y sus propios auxiliares, sin duplicar, y lo retira una vez instalado.
Recorre recepción, admisión, registro de vigencia, entrega pública y panel.
"""

import hashlib
import shutil
import unittest
from unittest.mock import patch

from plataforma_datos.cursos import componer_catalogo as componer
from plataforma_datos.cursos import operacion_fuente as fuente
from plataforma_datos.cursos import recepciones_catalogo as transporte
from plataforma_datos.cursos.fuentes.barcelonactiva import adquisicion
from plataforma_datos.cursos.fuentes.barcelonactiva import robot_cibernarium as robot
from plataforma_datos.cursos.pruebas import test_ciber_paginas_fallidas as ciber
from plataforma_datos.cursos.pruebas import test_cibernarium_adquisicion as capturas
from plataforma_datos.cursos.pruebas import test_cibernarium_paginas_fallidas as cibernarium


class _Pendientes:
    """Escenario común; cada subclase fija su fuente, su fixture y sus horas."""

    FUENTE = ""
    FIXTURE: type = object
    PAGINAS: tuple[int, int] = (0, 1)
    HORAS = ("", "", "", "")
    UNIDADES = ("", "")

    def setUp(self) -> None:
        """Bloquea la red y prepara la instalación del fixture de la fuente."""
        for modulo in (fuente, transporte):
            bloqueo = patch.object(modulo, "consultar", side_effect=AssertionError("consulta de red no simulada"))
            bloqueo.start()
            self.addCleanup(bloqueo.stop)
        self.caso = self.FIXTURE()
        self.caso.setUp()
        self.addCleanup(self.caso.doCleanups)

    def componer_sin_instalar(self, corte: str) -> None:
        """Compone en una copia que se descarta: el paquete falló y la instalación no cambia."""
        copia = self.caso.trabajo / "ciclo-descartado"
        shutil.copytree(self.caso.raiz, copia)
        try:
            with patch.object(fuente, "consultar", side_effect=AssertionError("sin red")):
                componer.componer(raiz=copia, corte_utc=corte)
        finally:
            shutil.rmtree(copia)

    def test_paquete_fallido_el_ciclo_siguiente_evalua_lo_pendiente(self) -> None:
        """Lo admitido sin instalar entra con su fecha; la página caída después no lo rejuvenece."""
        primera, segunda = self.PAGINAS
        instalado, pendiente, actual, siguiente = self.HORAS
        unidades = self.UNIDADES
        self.assertTrue(self.caso.consultar_fuente(instalado, {primera: "normal", segunda: "normal"}))
        self.caso.componer(f"2026-10-23T{instalado[:2]}:40:00Z")
        registradas = {id: len(self.caso.observaciones(id)) for id in unidades}
        self.assertTrue(self.caso.consultar_fuente(pendiente, {primera: "normal", segunda: "normal"}))
        apartado = fuente.leer_validado(self.FUENTE, self.caso.raiz)
        self.componer_sin_instalar(f"2026-10-23T{pendiente[:2]}:30:00Z")
        self.assertTrue(self.caso.consultar_fuente(actual, {primera: "normal", segunda: None}))
        self.assertEqual([c for _corte, c in fuente.leer_pendientes(self.FUENTE, self.caso.raiz)], [apartado])
        corte = f"2026-10-23T{actual[:2]}:30:00Z"
        self.caso.componer(corte)
        for id in unidades:
            observaciones = self.caso.observaciones(id)
            self.assertEqual(len(observaciones), registradas[id] + 2)
            self.assertEqual(len({o["id"] for o in observaciones}), len(observaciones))
        panel = self.caso.panel(corte)
        segunda_id = unidades[1]
        # La unidad de la página caída queda confirmada por el ciclo pendiente, con su fecha propia.
        self.assertEqual(panel[segunda_id]["comprobadoEl"], f"2026-10-23T{pendiente}:01Z")
        self.assertEqual(panel[segunda_id]["ultimoIntentoFallidoEl"], f"2026-10-23T{actual}:01Z")
        self.assertEqual(panel[unidades[0]]["comprobadoEl"], f"2026-10-23T{actual}:01Z")
        # Instalado el catálogo, una consulta nueva ya no arrastra pendientes.
        self.assertTrue(self.caso.consultar_fuente(siguiente, {primera: "normal", segunda: "normal"}))
        self.assertEqual(fuente.leer_pendientes(self.FUENTE, self.caso.raiz), [])
        _, _, validado = fuente.rutas_de_la_fuente(self.FUENTE, self.caso.raiz)
        self.assertEqual(list((validado / "pendientes").glob("*.json")), [])


class PendientesCibernariumPruebas(_Pendientes, unittest.TestCase):
    """Cibernàrium: ediciones de un censo paginado."""

    FUENTE = "barcelonactiva"
    FIXTURE = cibernarium.PaginasFallidasCibernariumPruebas
    PAGINAS = (0, 1)
    HORAS = ("21:10", "22:00", "23:00", "23:50")
    UNIDADES = (cibernarium.PRIMERA, cibernarium.SEGUNDA)

    def test_la_ficha_reutilizada_no_pierde_el_cierre_de_un_ciclo_sin_instalar(self) -> None:
        """La segunda consulta cierra una edición y la tercera no alcanza a leerla."""
        raiz = self.caso.raiz
        original, _, _ = fuente.rutas_de_la_fuente(self.FUENTE, raiz)
        ficha = capturas._captura(original, robot.url_ficha("123"), b"Ficha conservada", id="cibernarium:123")
        adquisicion._guardar(original, [], {}, {"123": ficha}, {})
        self.assertTrue(self.caso.consultar_fuente("21:10", {0: "normal", 1: "normal"}))
        self.caso.componer("2026-10-23T21:40:00Z")
        primero = fuente.leer_validado(self.FUENTE, raiz)
        self.assertIsNone(fuente.validado_sin_instalar(self.FUENTE, raiz))

        self.assertTrue(self.caso.consultar_fuente("22:00", {0: "normal", 1: "cerrada"}))
        cierre = fuente.leer_validado(self.FUENTE, raiz)
        self.assertEqual(primero["fichas"]["123"]["recibo"], cierre["fichas"]["123"]["recibo"])
        self.assertNotEqual(primero["recepciones"][0]["recibo"], cierre["recepciones"][0]["recibo"])
        self.assertEqual(fuente.validado_sin_instalar(self.FUENTE, raiz), cierre)
        solo_primera = {cierre["recepciones"][0]["recibo"]["sha256"]}
        with patch.object(fuente, "_archivos_instalados", return_value=solo_primera):
            self.assertEqual(fuente.validado_sin_instalar(self.FUENTE, raiz), cierre)

        self.assertTrue(self.caso.consultar_fuente("23:00", {0: "normal", 1: None}))
        self.assertEqual([c for _, c in fuente.leer_pendientes(self.FUENTE, raiz)], [cierre])
        parcial = fuente.leer_validado(self.FUENTE, raiz)
        recibidos = {parcial["recepciones"][0]["recibo"]["sha256"]}
        with patch.object(fuente, "_archivos_instalados", return_value=recibidos):
            self.assertEqual(fuente.validado_sin_instalar(self.FUENTE, raiz), parcial)
            recibidos.add(parcial["paginas_fallidas"][0]["intento"]["sha256"])
            self.assertIsNone(fuente.validado_sin_instalar(self.FUENTE, raiz))
        corte = "2026-10-23T23:30:00Z"
        self.assertNotIn(cibernarium.SEGUNDA, self.caso.componer(corte))
        panel = self.caso.panel(corte)[cibernarium.SEGUNDA]
        self.assertEqual(panel["decision"], "no-disponible-publicamente")
        self.assertEqual(panel["ultimoIntentoFallidoEl"], "2026-10-23T23:00:01Z")
        self.assertEqual(fuente.leer_pendientes(self.FUENTE, raiz), [])

    def test_apartado_historico_sin_primera_pagina_conserva_su_evidencia(self) -> None:
        """Una ficha recibida no acredita ni fecha el censo de un apartado indeterminado."""
        raiz = self.caso.raiz
        original, _, validado = fuente.rutas_de_la_fuente(self.FUENTE, raiz)
        ficha = capturas._captura(original, robot.url_ficha("123"), b"Ficha conservada", id="cibernarium:123")
        historico = {"fuente_id": self.FUENTE, "canal": "cibernarium", "recepciones": [], "fichas": {"123": ficha}}
        contenido = fuente.json_bytes(historico)
        ruta = validado / "pendientes" / (hashlib.sha256(contenido).hexdigest() + ".json")
        ruta.parent.mkdir(parents=True)
        ruta.write_bytes(contenido)
        with patch.object(fuente, "_archivos_instalados", return_value={ficha["recibo"]["sha256"]}):
            fuente._apartar_anterior(self.FUENTE, raiz, {})
            self.assertEqual(fuente.leer_pendientes(self.FUENTE, raiz), [])
        self.assertEqual(ruta.read_bytes(), contenido)


class PendientesCiberPruebas(_Pendientes, unittest.TestCase):
    """Cibervoluntarios: materiales de un censo paginado."""

    FUENTE = "cibervoluntarios"
    FIXTURE = ciber.PaginasFallidasCiberPruebas
    PAGINAS = (1, 2)
    HORAS = ("19:00", "20:00", "21:00", "21:50")
    UNIDADES = (ciber.PRIMERA, ciber.SEGUNDA)


if __name__ == "__main__":
    unittest.main()
