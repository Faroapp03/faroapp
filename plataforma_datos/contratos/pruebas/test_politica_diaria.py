"""La cadencia diaria atraviesa contrato, ejecución observada y recibo sin cambiar su significado."""

import unittest
from unittest import mock

from plataforma_datos.contratos import fuentes
from plataforma_datos.contratos.pruebas.test_fuentes import documento
from plataforma_datos.orquestacion import (
    actualizar,
    ejecucion_observada,
    estado_de_los_datos,
    piezas_de_la_actualizacion,
)


class PruebaPoliticaDiaria(unittest.TestCase):
    """Una fuente diaria se programa y se describe con el mismo contrato."""

    def test_fuente_diaria_conserva_cadencia_y_aceptacion_observada(self) -> None:
        """La orden y el reconocedor remoto coinciden para una cadencia de un día."""
        dato = documento()
        dato["actualizacion"].update(politica="diaria", renovar_dias=1)
        dato["conjuntos"][0]["intervalo_dias"] = 1
        descriptor = fuentes.validar_descriptor(dato)
        with mock.patch.dict(piezas_de_la_actualizacion.FUENTES, {"formacion": descriptor.actualizacion}):
            orden = actualizar.ordenes_de_la_fuente("formacion")[0][1]
            self.assertIn("--aceptar-cambio", orden)
            self.assertEqual(ejecucion_observada.etapa_de_fuente(orden), ("formacion", "descargar"))
            self.assertEqual(estado_de_los_datos.plazo("formacion"), 1)

    def test_politica_desconocida_sigue_rechazada(self) -> None:
        """La nueva política no abre el contrato a etiquetas arbitrarias."""
        dato = documento()
        dato["actualizacion"]["politica"] = "cada-tanto"
        with self.assertRaises(fuentes.ErrorDescriptor):
            fuentes.validar_descriptor(dato)
