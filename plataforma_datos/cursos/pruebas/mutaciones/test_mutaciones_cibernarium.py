"""Mutaciones de Cibernàrium sobre la instalación sin red de dos actividades con su edición.

La ficha de cada actividad es la de la API publicada que usan las pruebas de la fuente (`test_cibernarium_matricula_
actual.actividad`); el árbol no conserva una respuesta real de esta API.
"""

import io
import json
import unittest
from collections.abc import Iterator
from contextlib import contextmanager, redirect_stderr
from unittest.mock import patch

from plataforma_datos.cursos.pruebas import test_cibernarium_paginas_fallidas as paginas
from plataforma_datos.cursos.pruebas.mutaciones import arnes
from plataforma_datos.orquestacion.ordenes import con_motivo

NORMALES = dict.fromkeys(paginas.PAGINAS, "normal")
CORTE = "2026-10-23T23:30:00Z"


class MutacionesCibernariumPruebas(unittest.TestCase):
    """Un ciclo sano a las 22:00 y, a las 23:00, el mismo censo con una sola mutación."""

    def setUp(self) -> None:
        """Instala las dos actividades admitidas y las compone en un primer ciclo sano."""
        self.caso = paginas.PaginasFallidasCibernariumPruebas()
        self.caso.setUp()
        self.addCleanup(self.caso.doCleanups)
        self.assertTrue(self.caso.consultar_fuente("22:00", NORMALES))
        self.ofertas = self.caso.componer("2026-10-23T22:30:00Z")
        self.assertEqual(set(self.ofertas), {paginas.PRIMERA, paginas.SEGUNDA})
        self.antes = self.decisiones("2026-10-23T22:30:00Z")

    @contextmanager
    def cuerpos(self, actividad: dict[int, dict], edicion: dict[int, dict]) -> Iterator[None]:
        """Sirve cada página con los campos añadidos a su actividad y a su edición.

        Yields:
            Nada: el parche dura lo que dura el bloque.
        """
        original = paginas._cuerpo

        def cuerpo(desde: int, **opciones: object) -> bytes:
            documento = json.loads(original(desde, **opciones))
            publicada = documento["activities"][0]
            publicada.update(actividad.get(desde, {}))
            publicada["listEditions"][0].update(edicion.get(desde, {}))
            return json.dumps(documento).encode()

        with patch.object(paginas, "_cuerpo", cuerpo):
            yield

    def decisiones(self, corte: str) -> dict[str, str]:
        """La decisión de vigencia de cada edición en el panel privado.

        Returns:
            Decisión por unidad.
        """
        return {u: f["decision"] for u, f in self.caso.panel(corte).items()}

    def test_m1_campo_nuevo_en_una_ficha(self) -> None:
        """M1: la ficha de la primera actividad y su edición traen un campo que Faro no conoce."""
        mutacion = arnes.Mutacion("M1", "barcelonactiva", "campo nuevo en la actividad y en su edición")
        recibida: list[bool] = []
        self.errores = io.StringIO()
        nuevo = {"modalitatHibrida": {"codi": "HIB", "descripcio": "Sessions híbrides"}}
        with self.cuerpos({0: nuevo}, {0: nuevo}), redirect_stderr(self.errores):
            codigo = con_motivo(lambda: recibida.append(self.caso.consultar_fuente("23:00", NORMALES)))
        despues = self.caso.componer(CORTE)
        observado = arnes.Observado(
            codigo == 0 and recibida == [True], True, self.antes, self.decisiones(CORTE), frozenset({paginas.PRIMERA})
        )
        self.assertTrue(observado.fuente_en_verde, self.errores.getvalue())
        self.assertEqual(arnes.cambiadas(observado), {})
        self.assertEqual(arnes.alcance(observado), arnes.NINGUNO)
        self.assertEqual(arnes.veredicto_del_ciclo(mutacion, observado), "verde")
        self.assertEqual(set(despues), {paginas.PRIMERA, paginas.SEGUNDA})
        # El campo desconocido no llega a la oferta: la mutada cambia lo mismo que la sana (la comprobación nueva)
        # y ningún hecho publicado cambia de valor.
        distintos = {u: {k for k in o if o[k] != despues[u][k]} for u, o in self.ofertas.items()}
        self.assertEqual(distintos[paginas.PRIMERA], distintos[paginas.SEGUNDA])
        for unidad, oferta in self.ofertas.items():
            valores = {k: h.get("valor") for k, h in oferta["hechos"].items()}
            self.assertEqual({k: h.get("valor") for k, h in despues[unidad]["hechos"].items()}, valores)
