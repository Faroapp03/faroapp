"""Metadatos del panel procedentes de fichas, separados de la ejecución y de la entrega activa."""

import json
import tempfile
import unittest
from copy import deepcopy
from datetime import UTC, datetime
from pathlib import Path

from plataforma_datos.orquestacion import almacen_trabajos, estado_panel
from plataforma_datos.orquestacion.instantanea_del_recibo import validar_instantanea
from plataforma_datos.orquestacion.modulos import PRODUCTORES_CANDIDATOS, PRODUCTORES_LOCALES
from plataforma_datos.orquestacion.piezas_de_la_actualizacion import FUENTES


class PruebaCatalogoPanel(unittest.TestCase):
    """La observación añade identidad sin inventar consultas ni promover candidatas."""

    def test_v4_sin_registro_conserva_desconocidos_y_candidatos_separados(self) -> None:
        """Un directorio vacío no tiene fallos remotos ni comprobaciones positivas implícitas."""
        with tempfile.TemporaryDirectory() as temporal:
            raiz = Path(temporal)
            fichas = raiz / "var/actualizacion/preparados/abierta/fichas.json"
            fichas.parent.mkdir(parents=True)
            fichas.write_text('{"fichas": [], "plataformas": {}}')
            datos = estado_panel.estado_panel(raiz, datetime(2026, 10, 23, tzinfo=UTC))
        self.assertEqual(datos["version"], 5)
        activos = {f["id"] for f in datos["catalogoFuentes"] if f["modalidad"] == "operativa"}
        self.assertEqual(activos, set(FUENTES))
        candidatos = {f["id"] for f in datos["catalogoFuentes"] if f["modalidad"] == "candidata"}
        self.assertEqual(candidatos, {p.id for p in PRODUCTORES_CANDIDATOS})
        locales = {f["id"] for f in datos["catalogoFuentes"] if f["modalidad"] == "productor-local"}
        self.assertEqual(locales, {p.productor.id for p in PRODUCTORES_LOCALES})
        self.assertTrue(all(f["nombre"] and f["tema"] for f in datos["catalogoFuentes"]))
        self.assertTrue(all(f["ultimaOperacion"] is None for f in datos["fuentes"]))
        self.assertTrue(all(c["ultimaComprobacion"] is None for c in datos["comprobaciones"]["conjuntos"]))
        validar_instantanea(datos)

    def test_lectura_de_contratos_previos_no_necesita_catalogo_retroactivo(self) -> None:
        """Los recibos anteriores no adquieren metadatos ni hechos de esta versión."""
        raiz = Path(__file__).resolve().parents[3]
        for version in (2, 3):
            ruta = raiz / f"pruebas/fixtures/estado-datos-v{version}.json"
            datos = json.loads(ruta.read_text())
            antes = json.dumps(datos, sort_keys=True)
            validar_instantanea(datos)
            self.assertEqual(json.dumps(datos, sort_keys=True), antes)

    def test_catalogo_no_acepta_promociones_ni_identidades_manipuladas(self) -> None:
        """Las candidatas no pueden ocupar el lugar de una fuente operativa en un recibo."""
        with tempfile.TemporaryDirectory() as temporal:
            raiz = Path(temporal)
            fichas = raiz / "var/actualizacion/preparados/abierta/fichas.json"
            fichas.parent.mkdir(parents=True)
            fichas.write_text('{"fichas": [], "plataformas": {}}')
            datos = estado_panel.estado_panel(raiz, datetime(2026, 10, 23, tzinfo=UTC))
        for campo, valor in (("tema", "inventado"), ("modalidad", "candidata"), ("nombre", "texto\0oculto")):
            mal = deepcopy(datos)
            siguiente = next(f for f in mal["catalogoFuentes"] if f["modalidad"] == "operativa")
            siguiente[campo] = valor
            with self.subTest(campo=campo), self.assertRaises(almacen_trabajos.AlmacenTrabajoInvalido):
                validar_instantanea(mal)
        mal = deepcopy(datos)
        mal["catalogoFuentes"].append(mal["catalogoFuentes"][0])
        with self.assertRaises(almacen_trabajos.AlmacenTrabajoInvalido):
            validar_instantanea(mal)
