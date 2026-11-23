"""La cobertura del Censo se contrasta por claves, conservando las referencias no publicadas."""

import unittest
from typing import Any
from unittest import mock

import plataforma_datos.mercado.fuentes.censo.lector as censo
from plataforma_datos.comun.nucleo import CORRECTO, ERROR, Controles


class PruebaGuardasCenso(unittest.TestCase):
    """Regresiones de cobertura con consultas sintéticas de la misma cardinalidad."""

    def test_los_municipios_presentes_deben_ser_los_del_entorno(self) -> None:
        """Sustituir un municipio por otro ajeno conserva el recuento pero incumple la cobertura."""
        filas = [
            {"municipio": municipio, "lugar": lugar, "nivel": nivel, "cno11": censo.CODIGO_NO_CONSTA, "total": 0}
            for municipio in censo.ENTORNO
            for lugar in censo.LUGAR
            for nivel in censo.OCUPACION
        ]
        for municipio, resultado in ((censo.ENTORNO[0], CORRECTO), ("99999", ERROR)):
            controles = Controles()
            with self.subTest(municipio=municipio), mock.patch.object(censo, "codigos_en_cno", return_value=True):
                censo._controles_municipios(controles, [{**filas[0], "municipio": municipio}, *filas[1:]], {})
                self.assertEqual(controles.lista[0]["resultado"], resultado)
                self.assertTrue(all(control["resultado"] == CORRECTO for control in controles.lista[1:]))

    @staticmethod
    def perfil(codigo: str) -> dict[str, Any]:
        """Compone un grupo que suma la referencia en cada variable.

        Returns:
            Perfil preparado sintético de 1.000 personas.
        """
        return {
            "cno11": codigo,
            "nivel": "3",
            **{nombre: {"x": 1000, censo.CIFRAS_SUMADAS: 1} for nombre in censo.NOMBRES_DEL_PERFIL},
        }

    def test_un_perfil_repetido_no_sustituye_otro_de_referencia(self) -> None:
        """Dos copias de 430 no cubren 431 aunque las cifras y el número de perfiles cuadren."""
        referencia = {"ocupados_cno3": {codigo: {"ocupados": 1000} for codigo in ("430", "431")}, "ocupados_cno2": {}}
        casos = ((["430", "431"], True), (["430", "430"], False), (["430", "431", "430"], False))
        for codigos, admitido in casos:
            controles = Controles()
            with self.subTest(codigos=codigos):
                censo._controles_perfiles(controles, [self.perfil(codigo) for codigo in codigos], referencia)
                self.assertEqual(controles.admitido, admitido)

    def test_los_perfiles_sin_referencia_conservan_su_tratamiento(self) -> None:
        """Los grupos no publicados en Cataluña no se convierten en nuevas referencias obligatorias."""
        referencia = {"ocupados_cno3": {"430": {"ocupados": 1000}}, "ocupados_cno2": {}}
        controles = Controles()
        censo._controles_perfiles(controles, [self.perfil("430"), self.perfil(censo.CODIGO_NO_CONSTA)], referencia)
        self.assertTrue(controles.admitido)


if __name__ == "__main__":
    unittest.main()
