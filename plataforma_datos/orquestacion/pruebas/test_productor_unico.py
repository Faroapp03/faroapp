"""Impide que dos productores registrados escriban en la misma casa de datos."""

import unittest
from types import SimpleNamespace
from unittest.mock import patch

from plataforma_datos.orquestacion import modulos


class ProductorUnico(unittest.TestCase):
    """Comprueba autoridad por destino, aunque un segundo lector use otro identificador."""

    def _con_productor(self, destino: str) -> list[str]:
        nombre = "lector-candidato"
        productor = SimpleNamespace(FUENTE=destino)
        with (
            patch.object(modulos, "FUENTES_EN_ORDEN", (*modulos.FUENTES_EN_ORDEN, (nombre, productor))),
            patch.object(modulos, "ORDEN", (*modulos.ORDEN, nombre)),
            patch.object(modulos, "MODULOS", (*modulos.MODULOS, modulos.Modulo(nombre, (nombre,)))),
        ):
            return modulos.comprobar_registro()

    def test_registro_actual_tiene_un_productor_por_destino(self) -> None:
        """Los productores actuales conservan una casa distinta por conjunto."""
        self.assertEqual(modulos.comprobar_registro(), [])

    def test_otro_nombre_no_autoriza_escribir_en_fundae(self) -> None:
        """Registrar con otro ID el destino FUNDAE no permite dos actualizaciones competidoras."""
        self.assertIn(
            "dos productores comparten la casa fundae: fundae y lector-candidato", self._con_productor("fundae")
        )

    def test_un_conjunto_independiente_conserva_su_casa(self) -> None:
        """El control no confunde un recurso distinto con otro del mismo organismo."""
        self.assertEqual(self._con_productor("conjunto-independiente"), [])


if __name__ == "__main__":
    unittest.main()
