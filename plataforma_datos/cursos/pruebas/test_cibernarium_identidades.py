"""Transiciones de cabecera por ediciones propias, sin fusión por título."""

import hashlib
import json
import sqlite3
import unittest
from copy import deepcopy
from pathlib import Path

from plataforma_datos.cursos import almacen_catalogo as almacen
from plataforma_datos.cursos import contenido_aprendizaje, contenido_cibernarium, registro_vigencia
from plataforma_datos.cursos.contrato_entrega_catalogo import ErrorEntregaCatalogo
from plataforma_datos.cursos.fuentes.barcelonactiva import (
    actualizacion,
    adquisicion,
    identidades_actuales,
    negocio_actual,
)
from plataforma_datos.cursos.fuentes.barcelonactiva import robot_cibernarium as robot
from plataforma_datos.cursos.pruebas import test_cibernarium_actualizacion as ciclo
from plataforma_datos.cursos.pruebas import test_cibernarium_adquisicion as rx


class IdentidadesCibernarium(unittest.TestCase):
    """SQLite y registro reales con una recepción sintética declarada."""

    def setUp(self) -> None:
        """Conserva el ancla original antes de cambiar una cabecera."""
        self.ciclo = ciclo.AplicacionCibernarium()
        self.ciclo.setUp()
        self.addCleanup(self.ciclo.doCleanups)

    def aplicar(
        self,
        actividades: list[dict],
        nombre: str,
        *,
        anterior: str | None = None,
        tiempos: tuple[str, str] = ("2026-10-23T21:30:00Z", ciclo.CORTE),
    ) -> Path:
        """Aplica un censo completo, sin sustituir resolver, cargador ni evaluador.

        Returns:
            Ruta de una candidata admitida y separada de la entrada.
        """
        cuerpo = json.dumps(
            {"numActivities": len(actividades), "start": 0, "end": 15, "activities": actividades}
        ).encode()
        cap = rx._captura(
            self.ciclo.original, adquisicion.url_pagina(0), cuerpo, tipo="application/json", fin=tiempos[0]
        )
        doc = {
            "schema_version": 1,
            "fuente_id": "barcelonactiva",
            "canal": "cibernarium",
            "capturas": [cap],
            "auxiliares": {"normas": self.ciclo.normas},
            "fichas": {},
            "historial": [],
        }
        entrada = self.ciclo.entrada
        if anterior is not None:
            solicitud = almacen.solicitud(self.ciclo.raiz / anterior)
            entrada = almacen.EntradaCatalogo(
                admision=solicitud,
                sha256_admision=hashlib.sha256(solicitud.validacion_destino.read_bytes()).hexdigest(),
            )
        programas, _ = negocio_actual.leer(entrada.admision.snapshot.ruta)
        conjunto = adquisicion.calcular(self.ciclo.original, doc, list(programas.values()))
        destino = self.ciclo.raiz / nombre
        actualizacion.aplicar(
            entrada, conjunto=conjunto, original=self.ciclo.original, destino=destino, corte=tiempos[1]
        )
        return destino

    def test_cabecera_nueva_conserva_programa_hijos_url_canonica_y_negocio_ajeno(self) -> None:
        """Una nueva principal prueba una URL actual, no una identidad duplicada."""
        a = deepcopy(self.ciclo.actividad)
        a.update(activityId="999", title="Cabecera y título publicados actuales")
        nueva = deepcopy(a["listEditions"][0])
        nueva["activityId"] = "789"
        a["listEditions"].append(nueva)
        destino = self.aplicar([a], "cabecera")
        programas, ediciones = negocio_actual.leer(destino / "catalogo.sqlite3")
        self.assertEqual(set(programas), {self.ciclo.programa["id"]})
        programa = programas[self.ciclo.programa["id"]]
        self.assertEqual(programa["url"], self.ciclo.programa["url"])
        self.assertEqual(programa["datos"], self.ciclo.programa["datos"])
        self.assertEqual(programa["titulo"], a["title"])
        self.assertEqual({e["programa_id"] for e in ediciones.values()}, {self.ciclo.programa["id"]})
        self.assertEqual(ediciones[self.ciclo.edicion["id"]], self.ciclo.edicion)
        self.assertIsNone(ediciones["cibernarium-edicion:789"]["datos"]["idioma_ficha_principal"])
        solicitud = almacen.solicitud(destino)
        evaluaciones = {
            id: registro_vigencia.consultar_edicion(solicitud.snapshot.ruta, id)["evaluacion"] for id in ediciones
        }
        extras = contenido_cibernarium.actuales(
            solicitud,
            set(ediciones),
            contenido_aprendizaje.referencias_de_evidencia_indexadas(solicitud),
            evaluaciones,
            ciclo.CORTE,
        )
        self.assertEqual(set(extras), set(ediciones))
        for id, dato in extras.items():
            identidad = dato["identidad_actual"]
            self.assertEqual(identidad["programa_id"], self.ciclo.programa["id"])
            self.assertEqual(identidad["url_actual"], robot.url_ficha("999"))
            self.assertEqual(evaluaciones[id]["entradas"]["oferta"]["url"], identidad["url_actual"])
            self.assertEqual(identidad["ediciones_testigo"], [self.ciclo.edicion["id"]])
            # La identidad no caduca por el plazo interno: conserva la fecha de su propia captura.
            self.assertNotIn("vigente", identidad)
            self.assertEqual(identidad["vigencia"], {"comprobado_el": identidad["evidencia"]["capturado_utc"]})
            self.assertEqual(identidad["evidencia"]["sha256"], dato["matricula_actual"]["evidencia"]["sha256"])
            self.assertEqual(identidad["vigencia"], dato["matricula_actual"]["vigencia"])
        control = json.loads((destino / almacen.CONTROL).read_bytes())
        recibo = almacen.leer_documento(destino, control["procedencia"]["recibo-cibernarium"])
        self.assertTrue(all(r["pendiente"] is None for r in recibo["resultados"]))

    def test_segundo_ciclo_y_replay_no_reasignan_ni_duplican_negocio(self) -> None:
        """La siguiente lectura de la nueva cabecera conserva el ID anterior."""
        a = deepcopy(self.ciclo.actividad)
        a["activityId"] = "999"
        nueva = deepcopy(a["listEditions"][0])
        nueva["activityId"] = "789"
        a["listEditions"].append(nueva)
        primera = self.aplicar([a], "primera")
        segunda = self.aplicar([a], "segunda", anterior="primera")
        self.assertEqual(
            negocio_actual.leer(primera / "catalogo.sqlite3"), negocio_actual.leer(segunda / "catalogo.sqlite3")
        )
        for tabla in ("versiones", "canales_temporales", "observaciones_vigencia", "evaluaciones_vigencia"):
            with sqlite3.connect(primera / "catalogo.sqlite3") as p, sqlite3.connect(segunda / "catalogo.sqlite3") as s:
                self.assertEqual(
                    p.execute("SELECT count(*) FROM " + tabla).fetchone(),
                    s.execute("SELECT count(*) FROM " + tabla).fetchone(),
                )
        ambigua = deepcopy(a)
        ambigua["activityId"] = "998"
        ambigua["listEditions"] = [ambigua["listEditions"][1]]
        a["listEditions"] = [a["listEditions"][0]]
        retenida = self.aplicar([a, ambigua], "retenida", anterior="segunda")
        self.assertEqual(
            negocio_actual.leer(segunda / "catalogo.sqlite3"), negocio_actual.leer(retenida / "catalogo.sqlite3")
        )
        control = json.loads((retenida / almacen.CONTROL).read_bytes())
        recibo = almacen.leer_documento(retenida, control["procedencia"]["recibo-cibernarium"])
        self.assertEqual({r["pendiente"] for r in recibo["resultados"]}, {"identidad_repartida_entre_cabeceras"})

    def test_matriz_rechaza_varios_padres_reparto_y_colision_sin_usar_titulo(self) -> None:
        """Compartir palabras no demuestra identidad; los padres propios sí la limitan."""
        programas = {"cibernarium:123": {}, "cibernarium:222": {}}
        ediciones = {
            "cibernarium-edicion:456": {"programa_id": "cibernarium:123"},
            "cibernarium-edicion:789": {"programa_id": "cibernarium:222"},
        }
        a = deepcopy(self.ciclo.actividad)
        a["activityId"] = "999"
        otra = deepcopy(a["listEditions"][0])
        otra["activityId"] = "789"
        a["listEditions"].append(otra)
        relaciones, motivos = identidades_actuales.resolver([a], programas, ediciones, [])
        self.assertEqual(relaciones, {})
        self.assertEqual(motivos, {"999": "ediciones_de_varios_programas"})
        a["listEditions"].pop()
        a["activityId"] = "222"
        self.assertEqual(
            identidades_actuales.resolver([a], programas, ediciones, [])[1],
            {"222": "cabecera_colisiona_con_identidad_canonica"},
        )
        a["activityId"] = "999"
        b = deepcopy(a)
        b["activityId"] = "998"
        self.assertEqual(set(identidades_actuales.resolver([a, b], programas, ediciones, [])[1]), {"999", "998"})
        b["listEditions"][0]["activityId"] = "888"
        relaciones, motivos = identidades_actuales.resolver([a, b], programas, ediciones, [])
        self.assertFalse(motivos)
        self.assertEqual(relaciones["998"]["programa_id"], "cibernarium:998")

    def test_consumidor_rechaza_testigo_ausente_o_de_otro_padre(self) -> None:
        """Un control con forma correcta no sustituye la prueba de relación nativa."""
        a = deepcopy(self.ciclo.actividad)
        a["activityId"] = "999"
        programas = {self.ciclo.programa["id"]: self.ciclo.programa}
        ediciones = {self.ciclo.edicion["id"]: self.ciclo.edicion}
        relaciones, _ = identidades_actuales.resolver([a], programas, ediciones, [])
        identidad = relaciones["999"]
        for cambio in ("ausente", "padre", "url"):
            dato, propios = deepcopy(identidad), deepcopy(ediciones)
            if cambio == "ausente":
                dato["ediciones_testigo"] = ["cibernarium-edicion:789"]
            elif cambio == "padre":
                propios[self.ciclo.edicion["id"]]["programa_id"] = "cibernarium:222"
            else:
                dato["url_actual"] = robot.url_ficha("888")
            with self.subTest(cambio=cambio), self.assertRaises(ErrorEntregaCatalogo):
                identidades_actuales.comprobar(dato, a, programas, propios)
        b = deepcopy(a)
        b["listEditions"][0]["activityId"] = "789"
        self.assertEqual(
            identidades_actuales.resolver([b], programas, ediciones, [identidad])[1],
            {"999": "alias_anterior_sin_testigos_actuales"},
        )
