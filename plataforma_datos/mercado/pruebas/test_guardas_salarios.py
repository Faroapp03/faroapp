"""Regresiones de entradas defectuosas en las tablas salariales del INE."""

import unittest
from pathlib import Path
from unittest import mock

import plataforma_datos.mercado.fuentes.salarios.lector as salarios
from plataforma_datos.comun.nucleo import Controles, FormatoInesperado
from plataforma_datos.mercado.pruebas.test_salarios import serie


class PruebaGuardasSalarios(unittest.TestCase):
    """Las entradas inválidas no se convierten en cifras publicables ni ocultan controles."""

    def test_total_cataluna_ausente_no_impide_registrar_controles(self) -> None:
        """Todos los totales ausentes coinciden; uno ausente frente a otro publicado falla sin TypeError."""
        filas = [
            {"dimension": dimension, "gran_grupo": grupo, "categoria": "total", "salario": None}
            for dimension in salarios.TABLAS
            for grupo in (*salarios.GRANDES_GRUPOS, salarios.TOTAL_OCUPACIONES)
        ]
        controles = Controles()
        salarios._controles_tablas(controles, filas)
        self.assertEqual(controles.fallidos, [])
        self.assertEqual([control["resultado"] for control in controles.lista], ["correcto", "correcto"])
        filas[-1]["salario"] = 1.0
        controles = Controles()
        salarios._controles_tablas(controles, filas)
        self.assertEqual(len(controles.fallidos), 1)

    def test_subgrupos_solo_de_dos_cifras_ascii(self) -> None:
        """Cifras arábigas, de ancho completo o superíndices no son códigos oficiales CNO-11."""
        for codigo in ("٤٣", "４３", "²³"):
            with self.subTest(codigo=codigo):
                self.assertEqual(salarios.filas_espana([serie("Ambos sexos", codigo, "Media", 1.0)]), [])

    def test_valor_invalido_de_tempus_se_informa_antes_del_valor_absoluto(self) -> None:
        """Una cifra inválida de Tempus falla con motivo en Cataluña y España, sin llegar a abs."""
        for valor in (float("nan"), float("inf"), float("-inf"), True, False, "25944.52"):
            invalida = serie("Ambos sexos", "43", "Media", valor)
            invalida["MetaData"].append(
                {"T3_Variable": salarios.CATEGORIAS["estudios"][0], "Nombre": "Educación primaria", "Codigo": "1"}
            )
            with (
                self.subTest(territorio="España", valor=valor),
                self.assertRaisesRegex(FormatoInesperado, "salario no numérico o no finito"),
            ):
                salarios.filas_espana([invalida])
            with (
                self.subTest(territorio="Cataluña", valor=valor),
                mock.patch.object(salarios, "leer_json", return_value=[invalida]),
                mock.patch.object(salarios, "original", return_value=Path("sintetico.json")),
                self.assertRaisesRegex(FormatoInesperado, "salario no numérico o no finito"),
            ):
                salarios._filas("estudios")

    def test_valor_no_numerico_o_no_finito_no_es_fiable(self) -> None:
        """NaN, infinitos, booleanos y textos se detienen, sin reinterpretarlos como salarios."""
        for valor in (float("nan"), float("inf"), float("-inf"), True, False, "25944.52"):
            with self.subTest(valor=valor), self.assertRaises(FormatoInesperado):
                salarios.fiabilidad(valor, ())


if __name__ == "__main__":
    unittest.main()
