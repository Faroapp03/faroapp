"""Derechos, Común y Derivados conservan la operación fijada en su referencia."""

import unittest
from dataclasses import replace
from unittest import mock

from plataforma_datos.contratos import fuentes
from plataforma_datos.orquestacion import modulos
from plataforma_datos.orquestacion.piezas_de_la_actualizacion import FUENTES
from plataforma_datos.orquestacion.planificacion_de_comprobaciones import CONJUNTOS
from plataforma_datos.orquestacion.pruebas.ayuda_descriptores import referencia_congelada

TEMAS = (("derechos", "Derechos"), ("comun", "Común"), ("derivados", "Derivados"))


class DescriptoresCompartidos(unittest.TestCase):
    """Contrasta seis productores con su referencia independiente de las fichas, fijada por su huella."""

    def test_operacion_anterior_conservada(self) -> None:
        """Políticas, dependencia, orden y cadencia no cambian al mover el código."""
        referencia = referencia_congelada(self, "operacion-derechos-comun-derivados-v1.json")
        activos = {m.id: m for m in modulos.MODULOS}
        descriptores = [d for tema, _ in TEMAS for d in fuentes.cargar_descriptores(tema=tema)]
        temas = {tema for tema, _ in TEMAS}
        candidatos = {c.id for c in modulos.PRODUCTORES_CANDIDATOS if c.tema in temas}
        self.assertEqual({d.id for d in descriptores}, set(referencia) | candidatos)
        self.assertTrue(candidatos.isdisjoint(FUENTES))
        self.assertTrue(candidatos.isdisjoint(activos))
        for d in descriptores:
            if d.id in candidatos:
                continue
            with self.subTest(fuente=d.id):
                r = referencia[d.id]
                self.assertEqual(d.actualizacion._asdict(), r["actualizacion"])
                self.assertEqual(FUENTES[d.id]._asdict(), r["actualizacion"])
                self.assertEqual([c._asdict() for c in d.conjuntos], r["conjuntos"])
                self.assertEqual([c._asdict() for c in CONJUNTOS if c.fuente == d.id], r["conjuntos"])
                self.assertEqual(list(d.dependencias), r["dependencias"])
                self.assertEqual(list(activos[d.id].entradas), r["dependencias"])
                self.assertEqual(activos[d.id].fuentes, (d.id,))
                self.assertEqual(d.casa_datos, r["casa_datos"])
        self.assertEqual(modulos.comprobar_registro(), [])

    def test_readmes_coinciden(self) -> None:
        """Los tres temas participan en la comprobación de documentación operativa."""
        for tema, _ in TEMAS:
            with self.subTest(tema=tema):
                self.assertEqual(fuentes.main(["--tema", tema, "--comprobar"]), 0)

    def test_politica_divergente_se_detecta_en_cada_tema(self) -> None:
        """Una ficha descubierta no puede contradecir la política activa."""
        cargar = fuentes.cargar_descriptores
        for objetivo, _ in TEMAS:

            def alterados(*, tema: str = "cursos", objetivo: str = objetivo) -> tuple[fuentes.DescriptorFuente, ...]:
                registros = cargar(tema=tema)
                return tuple(
                    replace(d, actualizacion=d.actualizacion._replace(red=not d.actualizacion.red))
                    if tema == objetivo
                    else d
                    for d in registros
                )

            with self.subTest(tema=objetivo), mock.patch.object(modulos, "cargar_descriptores", side_effect=alterados):
                self.assertTrue(any("política distinta del descriptor" in e for e in modulos.comprobar_registro()))

    def test_descriptor_roto_no_se_omite(self) -> None:
        """Un tema sin fichas legibles falla de forma visible, sin ignorarlo."""
        cargar = fuentes.cargar_descriptores
        for objetivo, nombre in TEMAS:

            def incompletos(*, tema: str = "cursos", objetivo: str = objetivo) -> tuple[fuentes.DescriptorFuente, ...]:
                if tema == objetivo:
                    raise fuentes.ErrorDescriptor("ficha dañada")
                return cargar(tema=tema)

            with (
                self.subTest(tema=objetivo),
                mock.patch.object(modulos, "cargar_descriptores", side_effect=incompletos),
            ):
                self.assertIn(f"descriptores de {nombre} no válidos: ficha dañada", modulos.comprobar_registro())


if __name__ == "__main__":
    unittest.main()
