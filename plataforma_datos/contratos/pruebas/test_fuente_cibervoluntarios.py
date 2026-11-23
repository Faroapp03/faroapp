"""Ficha operativa Ciber: adquisición independiente sin disponibilidad inferida."""

import unittest
from pathlib import Path

from plataforma_datos.contratos import fuentes
from plataforma_datos.orquestacion import modulos
from plataforma_datos.orquestacion.piezas_de_la_actualizacion import FUENTES
from plataforma_datos.orquestacion.planificacion_de_comprobaciones import CONJUNTOS


class PruebaFichaCiber(unittest.TestCase):
    """El parser conserva su frontera y la operación entra en el registro común."""

    def test_ficha_operativa_registrada_sin_oferta_inventada(self) -> None:
        """HTTP200 y Disponible publicados no constituyen oferta o conexión configurada."""
        d = fuentes.cargar_fuente("cibervoluntarios")
        self.assertEqual(d.modalidad, "operativa")
        self.assertTrue(d.actualizacion.red)
        self.assertEqual(d.casa_datos, "cibervoluntarios")
        self.assertIsNone(d.produccion_local)
        self.assertEqual(d.dependencias, ())
        self.assertEqual([c.id for c in d.conjuntos], ["cibervoluntarios"])
        self.assertTrue(all(r.licencia is None for r in d.recursos))
        texto = fuentes.generar_readme(d)
        self.assertIn("lector preparar", texto)
        self.assertIn("lector validar", texto)
        self.assertIn("cibervoluntarios", FUENTES)
        self.assertIn("cibervoluntarios", {m.id for m in modulos.MODULOS})
        self.assertIn("cibervoluntarios", {c.fuente for c in CONJUNTOS})
        self.assertEqual(modulos.comprobar_registro(), [])
        ruta = Path(fuentes.__file__).parents[1] / "cursos/fuentes/cibervoluntarios/README.md"
        self.assertEqual(ruta.read_text(), texto)
