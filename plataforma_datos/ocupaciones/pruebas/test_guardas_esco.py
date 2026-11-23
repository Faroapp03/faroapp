"""Pruebas de la guarda ESCO común: admisión, huella, identidad y orden antes de leer."""

import tempfile
import unittest
from pathlib import Path
from unittest import mock

import plataforma_datos.ocupaciones.fuentes.esco.piezas.consultas as consultas
from plataforma_datos.comun.entrada_salida import guardar_jsonl, sha256
from plataforma_datos.comun.nucleo import ValidacionFallida


class PruebaGuardaDeOcupacionesEsco(unittest.TestCase):
    """La entrada real comprueba admisión y huella antes de leer la tabla."""

    def setUp(self) -> None:
        """Una tabla registrada en un temporal, con dos filas cuyo orden importa."""
        self.temporal = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporal.cleanup)
        self.ruta = Path(self.temporal.name) / "ocupaciones.jsonl"
        self.filas = [{"codigo_esco": "z", "titulo_es": "Primera"}, {"codigo_esco": "a", "titulo_es": "Segunda"}]
        guardar_jsonl(self.ruta, self.filas)
        self.validacion = {"sha256_preparados": {self.ruta.name: sha256(self.ruta)}}
        self.admitida = self.enterContext(mock.patch.object(consultas, "exigir_admitido", return_value=self.validacion))

    def test_tabla_admitida_y_orden(self) -> None:
        """El lector devuelve exactamente las filas admitidas en su orden."""
        self.assertEqual(consultas.ocupaciones_preparadas(self.ruta), self.filas)
        self.admitida.assert_called_once_with("esco")

    def test_huella_cambiada(self) -> None:
        """Una tabla alterada tras validarse se rechaza con el motivo anterior y no se lee."""
        guardar_jsonl(self.ruta, [*self.filas, {"codigo_esco": "otra"}])
        with (
            mock.patch.object(consultas, "leer_jsonl") as leer,
            self.assertRaisesRegex(ValidacionFallida, "ocupaciones.jsonl no es el validado"),
        ):
            consultas.ocupaciones_preparadas(self.ruta)
        leer.assert_not_called()

    def test_no_admitida(self) -> None:
        """La no admisión se propaga aunque la tabla exista y conserve la huella correcta."""
        self.admitida.side_effect = ValidacionFallida("esco: no admitida")
        with (
            mock.patch.object(consultas, "leer_jsonl") as leer,
            self.assertRaisesRegex(ValidacionFallida, "esco: no admitida"),
        ):
            consultas.ocupaciones_preparadas(self.ruta)
        leer.assert_not_called()


if __name__ == "__main__":
    unittest.main()
