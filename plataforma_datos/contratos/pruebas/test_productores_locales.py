"""Productor local de hoja de ruta y cobertura de los lectores presentes en cada tema."""

import json
import unittest
from copy import deepcopy
from dataclasses import replace
from pathlib import Path
from unittest import mock

from plataforma_datos.contratos import fuentes
from plataforma_datos.orquestacion import modulos
from plataforma_datos.orquestacion.piezas_de_la_actualizacion import FUENTES
from plataforma_datos.orquestacion.planificacion_de_comprobaciones import CONJUNTOS


class PruebaProductorLocal(unittest.TestCase):
    """Una producción local explícita no concede red ni se disfraza de lectura pura."""

    def test_hoja_de_ruta_describe_operacion_real_sin_activarse(self) -> None:
        """El comando documentado comprueba datos fijados; no hay descarga ni preparar/validar."""
        descriptor = fuentes.cargar_fuente("hoja_de_ruta")
        self.assertEqual(descriptor.modalidad, "productor-local")
        self.assertIsNone(descriptor.actualizacion)
        self.assertIsNone(descriptor.casa_datos)
        self.assertEqual(descriptor.conjuntos, ())
        self.assertEqual(descriptor.produccion_local.comprobar, ("todo", "--comprobar"))
        texto = fuentes.generar_readme(descriptor)
        self.assertIn("lector todo --comprobar", texto)
        self.assertNotIn("lector preparar", texto)
        self.assertNotIn("lector validar", texto)
        self.assertNotIn("hoja_de_ruta", FUENTES)
        self.assertNotIn("hoja_de_ruta", {m.id for m in modulos.MODULOS})
        self.assertEqual(len(modulos.MODULOS), 56)
        self.assertEqual(len(CONJUNTOS), 59)
        self.assertEqual(modulos.comprobar_registro(), [])

    def test_local_no_admite_operacion_automatica_ni_casa_var(self) -> None:
        """Las modalidades no permiten mezclas parciales que oculten permisos o escrituras."""
        ruta = Path(fuentes.__file__).parents[1] / "cursos/fuentes/hoja_de_ruta/fuente.json"
        original = json.loads(ruta.read_text())
        for cambio in (
            {"casa_datos": "idescat"},
            {"dependencias": ["idescat"]},
            {"actualizacion": fuentes.cargar_fuente("formacion").actualizacion._asdict()},
            {"produccion_local": {"generar": [], "comprobar": ["todo"]}},
        ):
            with self.subTest(cambio=cambio), self.assertRaises(fuentes.ErrorDescriptor):
                fuentes.validar_descriptor({**deepcopy(original), **cambio})

    def test_comandos_locales_se_contrastan_con_registro_estatico(self) -> None:
        """JSON no decide órdenes: incluso un argumento documental distinto invalida el registro."""
        cargar = modulos.cargar_descriptores

        def alteradas(*, tema: str = "cursos") -> tuple[fuentes.DescriptorFuente, ...]:
            return tuple(
                replace(d, produccion_local=fuentes.ProduccionLocal(("todo",), ("preparar",)))
                if d.id == "hoja_de_ruta"
                else d
                for d in cargar(tema=tema)
            )

        with mock.patch.object(modulos, "cargar_descriptores", side_effect=alteradas):
            self.assertIn("hoja_de_ruta: producción local distinta del registro estático", modulos.comprobar_registro())
