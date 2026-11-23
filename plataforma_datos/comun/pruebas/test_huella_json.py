"""Huella SHA-256 de JSON canónico: representación exacta y rechazo de lo que no es JSON."""

import hashlib
import unittest

from plataforma_datos.comun.huella_json import JsonNoCanonico, sha256_json


class HuellaJson(unittest.TestCase):
    """La huella identifica la representación JSON, no la igualdad de Python."""

    def test_claves_ordenadas_sin_espacios_y_utf8(self) -> None:
        """El orden de las claves no cambia la huella, que es la del texto canónico en UTF-8."""
        self.assertEqual(sha256_json({"b": 1, "a": "ñ"}), sha256_json({"a": "ñ", "b": 1}))
        self.assertEqual(sha256_json({"a": "ñ", "b": 1}), hashlib.sha256('{"a":"ñ","b":1}'.encode()).hexdigest())

    def test_booleanos_enteros_y_decimales_son_distintos(self) -> None:
        """0, False, 1 y 1.0 son valores JSON distintos."""
        self.assertNotEqual(sha256_json(0), sha256_json(False))
        self.assertNotEqual(sha256_json(1), sha256_json(1.0))

    def test_json_no_finito_o_ajeno_rechazado(self) -> None:
        """No se firman objetos ajenos, claves numéricas ni valores no finitos."""
        for valor in (float("nan"), float("inf"), {1: "uno"}, ("tupla",), {"a": {"b": object()}}):
            with self.subTest(valor=repr(valor)), self.assertRaisesRegex(JsonNoCanonico, "Valor JSON no canónico"):
                sha256_json(valor)

    def test_es_un_error_de_valor(self) -> None:
        """Quien ya trataba los errores de valor los sigue recibiendo."""
        self.assertTrue(issubclass(JsonNoCanonico, ValueError))


if __name__ == "__main__":
    unittest.main()
