"""La atribución distingue datos y código sin cambiar las cifras del consenso ni el original."""

import copy
import json
import unittest
from pathlib import Path
from typing import Any
from unittest.mock import patch

from plataforma_datos.comun.nucleo import FormatoInesperado
from plataforma_datos.orquestacion.exportacion import metodos
from plataforma_datos.orquestacion.exportacion.comun import Paquete


class CondicionesMetodos(unittest.TestCase):
    """El recurso, su licencia y su periodo permanecen asociados de forma explícita."""

    def setUp(self) -> None:
        """Construye un cálculo sintético con atribución de código confundida con datos."""
        self.condiciones = json.loads(metodos.CONDICIONES.read_text())
        self.original = Path("consenso-isco4.json")
        self.calculo = {
            "fecha": "2026-10-21",
            "metodos": {
                "anthropic": {
                    "url": self.condiciones["anthropic"]["recurso"],
                    "licencia": "MIT (ficha del conjunto de datos en Hugging Face)",
                    "anio": 2026,
                },
                "oit": {"licencia": "CC BY 4.0"},
                "cambra_odee": {"licencia": "autorización propia"},
            },
            "ocupaciones": {
                "1111": {"tercio_oit": "medio", "coinciden_sin_cambra": 2, "con_dato_sin_cambra": 4},
            },
        }

    def paquete(self) -> Paquete:
        """Compone el cálculo sin abrir originales de una instalación.

        Returns:
            La entrega y las entradas que deben figurar en su manifiesto.
        """

        def leer(ruta: Path) -> dict[str, Any]:
            return self.calculo if ruta == self.original else self.condiciones

        with (
            patch.object(metodos, "original", return_value=self.original),
            patch.object(metodos, "leer_json", side_effect=leer),
        ):
            return metodos.paquete_metodos()

    def test_datos_ccby_codigo_mit_sin_rejuvenecer_ni_modificar_el_calculo(self) -> None:
        """Corrige la atribución conservando periodos, recuentos e idempotencia."""
        anterior = copy.deepcopy(self.calculo)
        paquete = self.paquete()
        self.assertEqual(
            paquete.datos["metodos"]["anthropic"]["licencia"], "CC-BY (versión no especificada por la fuente)"
        )
        self.assertEqual(paquete.datos["metodos"]["oit"], self.calculo["metodos"]["oit"])
        self.assertNotIn("cambra_odee", paquete.datos["metodos"])
        self.assertEqual(paquete.datos["fecha"], "2026-10-21")
        self.assertEqual(paquete.datos["ocupaciones"], {"1111": {"tercio_oit": "medio", "coinciden": 2, "con_dato": 4}})
        self.assertEqual(paquete.origenes, [self.original, metodos.CONDICIONES])
        self.assertEqual(self.calculo, anterior)
        self.assertEqual(self.paquete(), paquete)

    def test_la_declaracion_no_se_aplica_a_otro_recurso(self) -> None:
        """Un cambio de recurso exige una declaración aplicable a ese recurso."""
        self.calculo["metodos"]["anthropic"]["url"] = "https://example.org/otro.csv"
        with self.assertRaises(FormatoInesperado):
            self.paquete()

    def test_version_de_condiciones_desconocida_no_se_ignora(self) -> None:
        """Una versión desconocida detiene la composición antes de publicar."""
        self.condiciones["version"] = 99
        with self.assertRaises(FormatoInesperado):
            self.paquete()
