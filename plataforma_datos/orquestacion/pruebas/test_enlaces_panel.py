"""Los enlaces de la formación llegan al panel solo cuando la validación admitida los trae, y con cifras coherentes."""

import tempfile
import unittest
from pathlib import Path

from plataforma_datos.comun.entrada_salida import guardar_json
from plataforma_datos.comun.nucleo import DATOS_RELATIVOS
from plataforma_datos.orquestacion.contrato_comprobaciones_panel import (
    validar_recuento_de_enlaces,
    validar_salida_parcial,
)
from plataforma_datos.orquestacion.estado_panel import recuento_de_enlaces, salida_parcial


class EnlacesPanelPruebas(unittest.TestCase):
    """De la validación admitida de la fuente `enlaces` al campo del panel."""

    def setUp(self) -> None:
        """Una raíz temporal con la carpeta de validados."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.raiz = Path(temporal.name)

    def informe(self, estado: str = "Admitido", **campos: object) -> None:
        """Guarda la validación de la fuente `enlaces` con esos campos."""
        guardar_json(
            self.raiz / DATOS_RELATIVOS / "validados" / "enlaces" / "validacion.json", {"estado": estado, **campos}
        )

    def test_las_cifras_viajan_con_sus_nombres(self) -> None:
        """Comprobados, ocultos y sin comprobar salen de la cobertura del informe admitido."""
        self.informe(cobertura={"comprobados": 120, "ocultos": 3, "sin_comprobar": 40, "candidatos": 160})
        self.assertEqual(
            recuento_de_enlaces(self.raiz, "enlaces"), {"comprobados": 120, "ocultos": 3, "sinComprobar": 40}
        )

    def test_sin_validacion_admitida_o_de_otra_fuente_no_viaja(self) -> None:
        """Una validación con errores, ausente o de otra fuente: None."""
        self.assertIsNone(recuento_de_enlaces(self.raiz, "enlaces"))
        self.informe("Con errores", cobertura={"comprobados": 1, "ocultos": 0, "sin_comprobar": 0})
        self.assertIsNone(recuento_de_enlaces(self.raiz, "enlaces"))
        self.assertIsNone(recuento_de_enlaces(self.raiz, "consorci"))
        self.informe()
        self.assertIsNone(recuento_de_enlaces(self.raiz, "enlaces"))

    def test_el_tope_de_consultas_llega_como_salida_parcial(self) -> None:
        """Un ciclo cortado por su tope o su plazo lo dice con los motivos que ya conoce el panel."""
        self.informe(consulta_parcial={"motivo": "tope-de-consultas"})
        self.assertEqual(
            salida_parcial(self.raiz, "enlaces"), {"motivos": ["tope-de-consultas"], "descartadas": 0, "aRevisar": 0}
        )
        self.informe(consulta_parcial={"motivo": "plazo-de-la-descarga"})
        self.assertEqual(
            salida_parcial(self.raiz, "enlaces"),
            {"motivos": ["plazo-de-la-descarga"], "descartadas": 0, "aRevisar": 0},
        )
        self.informe()
        self.assertIsNone(salida_parcial(self.raiz, "enlaces"))

    def test_un_dominio_con_limite_llega_como_motivo_cerrado(self) -> None:
        """El freno por dominio viaja junto al tope, con un motivo de la lista cerrada."""
        self.informe(consulta_parcial={"motivo": "tope-de-consultas, dominio-con-limite"})
        salida = salida_parcial(self.raiz, "enlaces")
        self.assertEqual(
            salida, {"motivos": ["tope-de-consultas", "dominio-con-limite"], "descartadas": 0, "aRevisar": 0}
        )
        validar_salida_parcial(salida)

    def test_una_cifra_mala_no_se_admite(self) -> None:
        """Negativas, no enteras, de más o con ocultos que no caben entre los enlaces se rechazan."""
        validar_recuento_de_enlaces({"comprobados": 1, "ocultos": 2, "sinComprobar": 1})
        for malo in (
            {"comprobados": -1, "ocultos": 0, "sinComprobar": 0},
            {"comprobados": 1.5, "ocultos": 0, "sinComprobar": 0},
            {"comprobados": 1, "ocultos": 5, "sinComprobar": 1},
            {"comprobados": 1, "ocultos": 0},
            {"comprobados": True, "ocultos": 0, "sinComprobar": 0},
        ):
            with self.subTest(malo=malo), self.assertRaises(ValueError):
                validar_recuento_de_enlaces(malo)


if __name__ == "__main__":
    unittest.main()
