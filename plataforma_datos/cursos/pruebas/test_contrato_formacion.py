"""Casos compartidos con el motor: código CO-SISPE exacto o grupo, salvo desde una relación estrecha."""

import json
import unittest
from pathlib import Path

from plataforma_datos.cursos.fuentes.formacion.controles import cobertura


class PruebaContratoFormacion(unittest.TestCase):
    """La cobertura oficial de la cadena cumple los mismos casos públicos que el motor."""

    def test_relaciones_por_codigo_y_grupo(self) -> None:
        """Las cuatro relaciones EURES cubren código completo, grupo publicado, grupo exacto y otro grupo."""
        casos = json.loads(Path(__file__).with_name("casos-relaciones-formacion.json").read_text(encoding="utf-8"))
        for caso in casos:
            with self.subTest(caso=caso["id"]):
                resultado = cobertura(
                    {"ocupacion": "uri"},
                    [{"esco": "ocupacion", "cosispe": caso["cosispe"], "relacion": caso["relacion"]}],
                    [{"codigo": "especialidad", "ocupaciones": [caso["ocupacion_sepe"]]}],
                    [],
                )
                self.assertEqual(resultado["ocupaciones_con_especialidad_sepe"], int(caso["esperado"]))


if __name__ == "__main__":
    unittest.main()
