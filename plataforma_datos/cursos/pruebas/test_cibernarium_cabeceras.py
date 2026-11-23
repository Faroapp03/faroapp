"""Cada prueba conserva cabecera propia y la oferta sigue la respuesta actual."""

import hashlib
import json
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path

from plataforma_datos.cursos import almacen_catalogo as almacen
from plataforma_datos.cursos import politicas_vigencia, registro_vigencia, vigencia
from plataforma_datos.cursos.fuentes.barcelonactiva import (
    adquisicion,
    cabeceras_actuales,
    matricula_actual,
    observaciones_actuales,
)
from plataforma_datos.cursos.fuentes.barcelonactiva import robot_cibernarium as robot
from plataforma_datos.cursos.pruebas import test_cibernarium_adquisicion as rx
from plataforma_datos.cursos.pruebas import test_cibernarium_identidades as identidades
from plataforma_datos.cursos.pruebas import test_cibernarium_matricula_actual as fixture


class HistorialCabeceras(unittest.TestCase):
    """Usa el constructor y el evaluador productivos, sin parchear decisiones."""

    def setUp(self) -> None:
        """Conserva dos respuestas sintéticas de la misma edición y distintas cabeceras."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.original = Path(temporal.name)
        self.politica = politicas_vigencia.leer_politica("barcelonactiva", "3")
        self.oferta_anterior, self.anterior = self.construir("123", "2026-10-23T21:00:02Z")
        self.oferta, self.actual = self.construir("999", "2026-10-23T21:30:00Z")

    def construir(self, cabecera: str, fecha: str, cambios: dict | None = None) -> tuple[dict, dict]:
        """Prepara bytes, recibo y observación íntegra para la edición 456.

        Returns:
            Oferta propia y observación API, positiva, incierta o de cierre.
        """
        a = fixture.actividad()
        a["activityId"] = cabecera
        a["listEditions"][0].update(cambios or {})
        cuerpo = json.dumps({"numActivities": 1, "start": 0, "end": 15, "activities": [a]}).encode()
        cap = rx._captura(self.original, adquisicion.url_pagina(0), cuerpo, tipo="application/json", fin=fecha)
        return observaciones_actuales.construir(self.original, cap, actividad_id=cabecera, edicion_id="456")

    def evaluar(self, oferta: dict, observaciones: list[dict]) -> dict:
        """Evalúa el historial explícito conservado, sin elegir un positivo favorable.

        Returns:
            Decisión causal con sus fechas originales.
        """
        return vigencia.evaluar_vigencia(oferta, observaciones, self.politica, ahora=fixture.AHORA)

    def test_dos_cabeceras_se_validan_con_sus_apoyos_y_ultima_url_por_instante(self) -> None:
        """Invertir el orden no cambia el estado ni rejuvenece la confirmación."""
        antes = deepcopy(self.anterior)
        for historia in ([self.anterior, self.actual], [self.actual, self.anterior]):
            resultado = self.evaluar(self.oferta, historia)
            self.assertEqual(resultado["estado"], "disponible-publicamente")
            self.assertEqual(resultado["comprobado_el"], "2026-10-23T21:30:00Z")
            self.assertEqual(resultado["revisar_el"], "2026-10-24T21:30:00Z")
        self.assertNotIn("vence_el", resultado)
        self.assertEqual(self.anterior, antes)
        with self.assertRaises(matricula_actual.ErrorMatriculaActual):
            matricula_actual.validar(self.anterior, self.oferta)
        with self.assertRaises(vigencia.ErrorVigencia):
            self.evaluar(self.oferta_anterior, [self.anterior, self.actual])

    def test_cierre_identificado_y_duda_no_se_ocultan_bajo_positivo_anterior(self) -> None:
        """El cierre no necesita DISP0 para vincularse a la última URL propia."""
        for cambios, esperado in (
            (
                {"registrationCode": "DISP3", "registrationDesc": "Sense places.", "openingsAvailable": False},
                "no-disponible-publicamente",
            ),
            ({"registrationCode": "DESCONOCIDO"}, "sin-confirmar"),
        ):
            oferta, nueva = self.construir("888", "2026-10-23T21:45:00Z", cambios)
            self.assertNotIn(matricula_actual.CAMPO, nueva["detalle"])
            self.assertIn(cabeceras_actuales.CAMPO, nueva["detalle"])
            self.assertEqual(self.evaluar(oferta, [self.anterior, self.actual, nueva])["estado"], esperado)
            with self.assertRaises(vigencia.ErrorVigencia):
                self.evaluar(self.oferta, [self.anterior, self.actual, nueva])

    def test_empate_incompatible_y_url_arbitraria_se_rechazan(self) -> None:
        """No hay elección por orden ni por el título de la cabecera."""
        _, otra = self.construir("888", "2026-10-23T21:30:00+00:00")
        for historia in ([self.actual, otra], [otra, self.actual]):
            with self.assertRaises(vigencia.ErrorVigencia):
                self.evaluar(self.oferta, historia)
        with self.assertRaises(vigencia.ErrorVigencia):
            self.evaluar({**self.oferta, "url": robot.url_ficha("777")}, [self.anterior, self.actual])

    def test_fraccion_del_mismo_segundo_prevalece_sin_normalizar_literal(self) -> None:
        """La comparación temporal no usa max lexicográfico de Z frente a fracción."""
        oferta, posterior = self.construir("888", "2026-10-23T21:30:00.123+00:00")
        self.assertEqual(self.evaluar(oferta, [posterior, self.actual])["comprobado_el"], "2026-10-23T21:30:00.123000Z")
        with self.assertRaises(vigencia.ErrorVigencia):
            self.evaluar(self.oferta, [posterior, self.actual])

    def test_el_fin_del_proceso_no_reordena_una_captura_anterior(self) -> None:
        """Una ventana de lectura más larga no convierte una prueba antigua en reciente."""
        anterior = deepcopy(self.anterior)
        anterior["terminado_el"] = "2026-10-23T21:50:00Z"
        self.assertEqual(self.evaluar(self.oferta, [self.actual, anterior])["comprobado_el"], "2026-10-23T21:30:00Z")
        with self.assertRaises(vigencia.ErrorVigencia):
            self.evaluar(self.oferta_anterior, [self.actual, anterior])

    def test_fallo_tecnico_conserva_cabecera_y_revision_anterior(self) -> None:
        """Un intento fallido no constituye otra respuesta identificada de la edición."""
        fallo = {
            "id": "fallo-cabecera",
            "tipo": "ficha",
            "resultado": "fallo",
            "intentado_el": "2026-10-23T21:40:00Z",
            "terminado_el": "2026-10-23T21:40:01Z",
            "url_consultada": adquisicion.url_pagina(0),
            "detalle": {"motivo": "http_403"},
            "evidencias": [],
        }
        resultado = self.evaluar(self.oferta, [self.anterior, fallo, self.actual])
        self.assertEqual(resultado["estado"], "disponible-publicamente")
        self.assertEqual(resultado["comprobado_el"], "2026-10-23T21:30:00Z")
        self.assertEqual(resultado["revisar_el"], "2026-10-24T21:30:00Z")
        self.assertNotIn("vence_el", resultado)

    def test_no_se_adopta_en_otra_fuente_politica_o_contrato_modificado(self) -> None:
        """La nueva interpretación solo existe en Barcelona Activa 2 registrada exacta."""
        for fuente, politica in (
            ("otra", {**self.politica, "fuente_id": "otra"}),
            ("barcelonactiva", politicas_vigencia.leer_politica("barcelonactiva", "1")),
            ("barcelonactiva", politicas_vigencia.leer_politica("barcelonactiva", "2")),
            ("barcelonactiva", {**self.politica, "ttl_ficha_segundos": 1}),
        ):
            with self.subTest(fuente=fuente, politica=politica["version"]), self.assertRaises(vigencia.ErrorVigencia):
                vigencia.evaluar_vigencia(
                    {**self.oferta, "fuente_id": fuente}, [self.anterior, self.actual], politica, ahora=fixture.AHORA
                )
        for campo in ("actividad", "edicion"):
            otra = deepcopy(self.actual)
            otra["detalle"][cabeceras_actuales.CAMPO]["apoyos"][campo] = 4
            with self.assertRaises(vigencia.ErrorVigencia):
                self.evaluar(self.oferta, [self.anterior, otra])

    def test_firma_cubre_el_metodo_y_forma_cerrada_del_esquema(self) -> None:
        """La lectura histórica nueva no se atribuye al evaluador anterior."""
        modulo = Path(cabeceras_actuales.__file__)
        firma = registro_vigencia.firma_evaluador()
        self.assertEqual(
            firma["archivos"][cabeceras_actuales.__name__.replace(".", "/") + ".py"],
            hashlib.sha256(modulo.read_bytes()).hexdigest(),
        )
        esquema = json.loads((modulo.parents[2] / "esquemas/contrato_vigencia.json").read_bytes())["$defs"]
        forma = esquema[cabeceras_actuales.CAMPO]
        self.assertFalse(forma["additionalProperties"])
        self.assertEqual(set(forma["required"]), set(self.actual["detalle"][cabeceras_actuales.CAMPO]))

    def test_ciclo_con_evaluacion_previa_conserva_historial_y_programa_canonico(self) -> None:
        """La regresión atraviesa la continuidad SQLite que antes rechazaba el cambio."""
        caso = identidades.IdentidadesCibernarium()
        caso.setUp()
        self.addCleanup(caso.doCleanups)
        a = deepcopy(caso.ciclo.actividad)
        primera = caso.aplicar([a], "evaluada")
        id = caso.ciclo.edicion["id"]
        previas = registro_vigencia.observaciones_hasta(
            primera / "catalogo.sqlite3", tipo="edicion", id=id, corte=fixture.AHORA
        )
        a["activityId"] = "999"
        segunda = caso.aplicar(
            [a], "nueva", anterior="evaluada", tiempos=("2026-10-23T21:45:00Z", "2026-10-23T22:01:00Z")
        )
        posteriores = registro_vigencia.observaciones_hasta(
            segunda / "catalogo.sqlite3", tipo="edicion", id=id, corte=fixture.AHORA
        )
        self.assertTrue(all(o in posteriores for o in previas))
        self.assertEqual(len(posteriores), len(previas) + 1)
        actual = registro_vigencia.consultar_edicion(segunda / "catalogo.sqlite3", id)["evaluacion"]
        self.assertEqual(actual["entradas"]["oferta"]["url"], robot.url_ficha("999"))
        self.assertEqual(actual["resultado"]["comprobado_el"], "2026-10-23T21:45:00Z")
        self.assertEqual(actual["entradas"]["observaciones"], posteriores)
        self.assertIn("control-cibernarium", almacen.solicitud(segunda).procedencia)
