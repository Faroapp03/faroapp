"""Contrato compartido de la cabecera del estado v5."""

import copy
import unittest

from plataforma_datos.comun.nucleo import FormatoInesperado
from plataforma_datos.orquestacion import estado_de_la_actualizacion as estado
from plataforma_datos.orquestacion.pruebas.test_estado_panel import documento


class CabeceraEstado(unittest.TestCase):
    """Comprobación pública de la cabecera del estado de la actualización."""

    def test_acepta_v5_y_rechaza_version_y_campo_extra(self) -> None:
        """Admite la versión vigente y rechaza otra versión o un campo de más."""
        valido = documento()
        self.assertIsNone(estado.comprobar_cabecera_estado(valido))
        for campo in ("version", "extra"):
            invalido = copy.deepcopy(valido)
            invalido[campo] = 4 if campo == "version" else True
            with self.subTest(campo=campo), self.assertRaises(FormatoInesperado):
                estado.comprobar_cabecera_estado(invalido)
