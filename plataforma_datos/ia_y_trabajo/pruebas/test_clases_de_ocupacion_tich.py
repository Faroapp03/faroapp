"""La clase de cada grupo es un hecho de cada edición: la que reúne el 95 % de sus entrevistas; si no, sin clase."""

import unittest

from plataforma_datos.comun.nucleo import Controles
from plataforma_datos.ia_y_trabajo.fuentes.tich import clases_de_ocupacion as clases

REPARTO = {
    "21": {"no_manual": 40},
    "51": {"manual": 1, "no_manual": 528},
    "52": {"manual": 3, "no_manual": 9},
    "93": {"manual": 12},
}


class PruebaClasesDeOcupacion(unittest.TestCase):
    """Clase dominante, grupos sin clase y control de coherencia del dato."""

    def test_la_clase_es_la_que_reune_el_95_por_ciento(self) -> None:
        """528 a 1 y el grupo entero tienen clase; 94 a 6 no; 95 a 5 sí, en cualquiera de las dos clases."""
        for reparto, esperado in (
            ({"manual": 1, "no_manual": 528}, "no_manual"),
            ({"manual": 94, "no_manual": 6}, None),
            ({"manual": 95, "no_manual": 5}, "manual"),
            ({"manual": 5, "no_manual": 95}, "no_manual"),
            ({"manual": 50, "no_manual": 50}, None),
            ({"manual": 7}, "manual"),
        ):
            with self.subTest(reparto=reparto):
                self.assertEqual(clases.clase_de_cada_grupo({"51": reparto}).get("51"), esperado)
                self.assertEqual(clases.sin_clase({"51": reparto}), [] if esperado else ["51"])

    def test_los_grupos_con_las_dos_clases_llevan_su_reparto_tengan_clase_o_no(self) -> None:
        """El 51 tiene clase y el 52 no, y los dos dejan su reparto; los enteros no."""
        self.assertEqual(clases.clase_de_cada_grupo(REPARTO), {"21": "no_manual", "51": "no_manual", "93": "manual"})
        self.assertEqual(clases.sin_clase(REPARTO), ["52"])
        self.assertEqual(
            clases.con_las_dos_clases(REPARTO),
            {"51": {"manual": 1, "no_manual": 528}, "52": {"manual": 3, "no_manual": 9}},
        )

    def test_la_frase_de_limites_es_verdad_con_y_sin_grupos_sin_clase(self) -> None:
        """Siempre dice el criterio; con grupos sin clase los nombra y sin ellos dice que todos la tienen."""
        con = clases.frase_de_los_sin_clase({"grupos_sin_clase": ["52"]})
        sin = clases.frase_de_los_sin_clase({"grupos_sin_clase": []})
        self.assertIn("al menos el 95 % de sus entrevistas. En esta edición, los grupos 52 no la tienen", con)
        self.assertIn("al menos el 95 % de sus entrevistas. En esta edición todos los grupos tienen clase.", sin)

    def test_el_control_exige_que_el_dato_declare_lo_observado(self) -> None:
        """Pasa con lo observado; una clase sin el umbral, un grupo sin clase que la tiene o una clase ajena, no."""
        bueno = {"clase_por_isco2": {"21": "no_manual", "51": "no_manual", "93": "manual"}, "grupos_sin_clase": ["52"]}
        for conjunto, admitido in (
            (bueno, True),
            ({**bueno, "grupos_sin_clase": []}, False),
            (
                {**bueno, "clase_por_isco2": {**bueno["clase_por_isco2"], "52": "no_manual"}, "grupos_sin_clase": []},
                False,
            ),
            (
                {**bueno, "clase_por_isco2": {"21": "no_manual", "93": "manual"}, "grupos_sin_clase": ["51", "52"]},
                False,
            ),
            ({**bueno, "grupos_sin_clase": ["21", "52"]}, False),
            ({**bueno, "clase_por_isco2": {**bueno["clase_por_isco2"], "51": "manual"}}, False),
        ):
            with self.subTest(conjunto=conjunto):
                controles = Controles()
                clases.control_de_las_clases(controles, REPARTO, conjunto)
                self.assertEqual(controles.admitido, admitido)

    def test_el_cambio_a_la_clase_contraria_detiene_y_el_paso_a_sin_clase_o_desde_ella_se_declara(self) -> None:
        """Manual a no manual falla el control; pasar a sin clase o salir de ella lo pasa y queda en los cambios."""
        antes = {"clase_por_isco2": {"21": "no_manual", "51": "manual", "93": "manual"}, "grupos_sin_clase": ["52"]}
        for ahora, contrarios, a_sin, desde_sin in (
            (
                {"clase_por_isco2": {"21": "manual", "51": "manual", "93": "manual"}, "grupos_sin_clase": ["52"]},
                ["21"],
                [],
                [],
            ),
            (
                {"clase_por_isco2": {"21": "no_manual", "93": "manual"}, "grupos_sin_clase": ["51", "52"]},
                [],
                ["51"],
                [],
            ),
            (
                {"clase_por_isco2": {"21": "no_manual", "51": "manual", "52": "manual"}, "grupos_sin_clase": []},
                [],
                [],
                ["52"],
            ),
        ):
            with self.subTest(ahora=ahora):
                controles = Controles()
                cambios = clases.control_de_los_cambios_de_clase(controles, antes, ahora)
                self.assertEqual(controles.admitido, not contrarios)
                self.assertEqual(
                    cambios, {"clase_contraria": contrarios, "a_sin_clase": a_sin, "desde_sin_clase": desde_sin}
                )


if __name__ == "__main__":
    unittest.main()
