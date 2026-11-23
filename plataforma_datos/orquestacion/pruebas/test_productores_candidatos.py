"""Un productor en preparación tiene identidad comprobada y ningún permiso de ejecución."""

import unittest
from dataclasses import replace
from types import SimpleNamespace
from unittest import mock

from plataforma_datos.contratos.fuentes import cargar_fuente
from plataforma_datos.orquestacion import modulos
from plataforma_datos.orquestacion import planificacion_de_comprobaciones as planificacion
from plataforma_datos.orquestacion.piezas_de_la_actualizacion import FUENTES
from plataforma_datos.orquestacion.reconstruir import ORDEN


class ProductoresCandidatosPruebas(unittest.TestCase):
    """La presencia de código y ficha no concede descarga ni promoción de datos."""

    def test_candidata_declarada_no_bloquea_ni_se_activa(self) -> None:
        """Chrome tiene una casa comprobada, pero no forma parte de la operación activa."""
        self.assertEqual(modulos.comprobar_registro(), [])
        self.assertNotIn("versiones_navegadores", FUENTES)
        self.assertNotIn("versiones_navegadores", ORDEN)
        self.assertNotIn("versiones_navegadores", {m.id for m in modulos.MODULOS})
        self.assertNotIn("versiones_navegadores", {c.fuente for c in planificacion.CONJUNTOS})

    def test_ficha_ajena_sigue_rechazada(self) -> None:
        """Un descriptor añadido no puede declararse candidato ni importar un módulo arbitrario."""
        ficha = replace(cargar_fuente("versiones_navegadores", tema="comun"), id="ajena", lector="os.system")
        with mock.patch.object(modulos, "cargar_descriptores", return_value=(ficha,)):
            self.assertIn("ajena: descriptor sin productor estático", modulos.comprobar_registro())

    def test_candidata_exige_descriptor_y_lector_correctos(self) -> None:
        """La excepción de ejecución no exime de identidad ni de una ficha presente."""
        candidatos = modulos.PRODUCTORES_CANDIDATOS
        for atributo, valor in (("lector", "os.system"), ("casa_datos", "otra"), ("tema", "cursos")):
            ficha = replace(cargar_fuente("versiones_navegadores", tema="comun"), **{atributo: valor})
            with (
                self.subTest(atributo=atributo),
                mock.patch.object(modulos, "cargar_descriptores", return_value=(ficha,)),
            ):
                self.assertTrue(any("versiones_navegadores:" in f for f in modulos.comprobar_registro()))
        with mock.patch.object(modulos, "cargar_descriptores", return_value=()):
            self.assertIn(f"{candidatos[0].id}: candidato sin descriptor", modulos.comprobar_registro())

    def test_candidata_no_puede_estar_en_plan_activo(self) -> None:
        """Una incorporación parcial a planificación se rechaza antes de ejecutar nada."""
        ficha = cargar_fuente("versiones_navegadores", tema="comun")
        with mock.patch.object(planificacion, "CONJUNTOS", (*planificacion.CONJUNTOS, *ficha.conjuntos)):
            self.assertIn(
                "versiones_navegadores: candidato incluido en la ejecución activa", modulos.comprobar_registro()
            )

    def test_ids_y_casas_candidatas_no_pueden_duplicarse(self) -> None:
        """Una fuente tiene una sola casa, también durante su preparación."""
        candidato = modulos.PRODUCTORES_CANDIDATOS[0]
        with mock.patch.object(modulos, "PRODUCTORES_CANDIDATOS", (candidato, candidato)):
            self.assertIn("identidades de productores candidatos duplicadas", modulos.comprobar_registro())
        lector = SimpleNamespace(__name__=candidato.lector.__name__, FUENTE="formacion")
        with mock.patch.object(modulos, "PRODUCTORES_CANDIDATOS", (candidato._replace(lector=lector),)):
            self.assertTrue(
                any("dos productores comparten la casa formacion" in f for f in modulos.comprobar_registro())
            )
