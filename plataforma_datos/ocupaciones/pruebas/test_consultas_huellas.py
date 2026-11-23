"""Pruebas de la lectura de lo validado de ESCO (consultas.py) cuando el informe no registra una huella."""

import tempfile
import unittest
from pathlib import Path
from unittest import mock

import plataforma_datos.ocupaciones.fuentes.esco.piezas.consultas as consultas
from plataforma_datos.comun.nucleo import ValidacionFallida


class PruebaHuellaNoRegistrada(unittest.TestCase):
    """Sin la huella en el informe de validación, la lectura se para con un motivo que nombra lo que falta."""

    def test_base_sin_huella_registrada(self) -> None:
        """Un informe sin «sha256_sqlite» no abre la base."""
        with (
            mock.patch.object(consultas, "exigir_admitido", return_value={}),
            self.assertRaisesRegex(ValidacionFallida, "no registra la huella de la base"),
        ):
            consultas.base_validada()

    def test_preparado_sin_huella_registrada(self) -> None:
        """Un preparado que el informe no registra, o un informe sin huellas de preparados, no se lee."""
        with tempfile.TemporaryDirectory() as temporal:
            ruta = Path(temporal) / "ocupaciones.jsonl"
            ruta.write_text("{}\n", encoding="utf-8")
            for validacion in [{}, {"sha256_preparados": {"otro.jsonl": "0" * 64}}]:
                with (
                    self.subTest(validacion=validacion),
                    mock.patch.object(consultas, "exigir_admitido", return_value=validacion),
                    self.assertRaisesRegex(ValidacionFallida, "no registra la huella de ocupaciones.jsonl"),
                ):
                    consultas.ocupaciones_preparadas(ruta)


if __name__ == "__main__":
    unittest.main()
