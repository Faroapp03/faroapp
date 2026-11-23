"""El registro de la actualización coincide con las fichas y las referencias congeladas no se regeneran."""

import copy
import unittest

from plataforma_datos.orquestacion import modulos
from plataforma_datos.orquestacion.piezas_de_la_actualizacion import FUENTES
from plataforma_datos.orquestacion.pruebas.ayuda_descriptores import (
    HUELLAS_DE_REFERENCIA,
    comprobar_tema,
    descriptores_operativos,
    discrepancias_del_registro,
    referencia_congelada,
)


class PruebaRegistroDeFuentes(unittest.TestCase):
    """Invariantes actuales que completan las referencias congeladas de cada tema."""

    def setUp(self) -> None:
        """Reúne las fichas operativas y los productores candidatos de la instalación."""
        self.operativos = descriptores_operativos()
        self.candidatos = [productor.id for productor in modulos.PRODUCTORES_CANDIDATOS]

    def test_registro_y_fichas_operativas_coinciden_exactamente(self) -> None:
        """Cada ficha operativa, salvo los candidatos, tiene su registro con la misma política, y nada más."""
        self.assertEqual(discrepancias_del_registro(FUENTES, self.operativos, self.candidatos), [])
        self.assertTrue(set(self.candidatos) <= set(self.operativos))

    def test_omision_entrada_extra_y_politica_distinta_se_detectan(self) -> None:
        """Quitar un registro, añadir uno ajeno o cambiar una política hace fallar el invariante."""
        quitada = next(iter(FUENTES))
        sin_una = {i: p for i, p in FUENTES.items() if i != quitada}
        con_ajena = {**FUENTES, "ajena": FUENTES[quitada]}
        cambiada = {**FUENTES, quitada: FUENTES[quitada]._replace(red=not FUENTES[quitada].red)}
        casos = (
            (sin_una, f"{quitada}: fuente operativa sin registro"),
            (con_ajena, "ajena: registro sin fuente operativa"),
            (cambiada, f"{quitada}: política registrada distinta de la ficha"),
        )
        for registro, motivo in casos:
            with self.subTest(motivo=motivo):
                self.assertEqual(discrepancias_del_registro(registro, self.operativos, self.candidatos), [motivo])

    def test_referencias_congeladas_conservan_sus_bytes(self) -> None:
        """Ninguna referencia se ha regenerado: sus bytes son los fijados."""
        for nombre in HUELLAS_DE_REFERENCIA:
            with self.subTest(referencia=nombre):
                self.assertIsInstance(referencia_congelada(self, nombre), dict)

    def test_una_politica_distinta_de_la_referencia_hace_fallar_el_tema(self) -> None:
        """La comparación con la referencia detecta una política alterada y una fuente que falta."""
        esperado = referencia_congelada(self, "operacion-mercado-v1.json")
        alterada = copy.deepcopy(esperado)
        fuente = next(iter(alterada))
        alterada[fuente]["actualizacion"]["red"] = not alterada[fuente]["actualizacion"]["red"]
        incompleta = {i: dato for i, dato in esperado.items() if i != fuente}
        for referencia in (alterada, incompleta):
            with self.assertRaises(AssertionError):
                comprobar_tema(unittest.TestCase(), "mercado", referencia)
