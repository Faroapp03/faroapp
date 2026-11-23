"""Pruebas de los datos de Cataluña (cataluna.py): lectura, cruces y controles que no dependen de los originales."""

import unittest
from unittest import mock

import plataforma_datos.mercado.fuentes.cataluna.lector as cataluna
import plataforma_datos.mercado.fuentes.cataluna.piezas.controles_cataluna as controles_cataluna
from plataforma_datos.comun.nucleo import ArchivoFaltante, Controles, FormatoInesperado
from plataforma_datos.comun.textos_y_cifras import personas_anteriores


class PruebaCataluna(unittest.TestCase):
    """Resúmenes del censo y de la contratación."""

    def test_pct(self) -> None:
        """Porcentaje con un decimal; sin total no hay porcentaje."""
        self.assertEqual(cataluna.pct(1, 3), 33.3)
        self.assertIsNone(cataluna.pct(1, 0))

    def test_edad_de(self) -> None:
        """Edad inicial de un grupo de edad del censo."""
        self.assertEqual(cataluna.edad_de("30-34"), 30)
        self.assertEqual(cataluna.edad_de("65 y más"), 65)

    def test_resumen_censo(self) -> None:
        """Ocupados y porcentajes de mujeres, menores de 30 y de 55 o más."""
        sexo = {"111": {"Hombre": 60, "Mujer": 40}}
        edad = {"111": {"25-29": 10, "30-34": 70, "55-59": 20}}
        self.assertEqual(
            cataluna.resumen_censo(sexo, edad),
            {"111": {"ocupados": 100, "pct_mujeres": 40.0, "pct_menores_30": 10.0, "pct_55_o_mas": 20.0}},
        )

    def test_conjunto_de_cataluna(self) -> None:
        """Suma las personas de los grupos antes de dividir (no promedia porcentajes) y deja fuera «No consta»."""
        sexo = {"11": {"Hombre": 90, "Mujer": 10}, "43": {"Hombre": 100, "Mujer": 300}, "no_consta": {"Mujer": 500}}
        edad = {"11": {"55-59": 100}, "43": {"25-29": 200, "30-34": 200}, "no_consta": {"25-29": 500}}
        self.assertEqual(
            cataluna.conjunto_de_cataluna(sexo, edad),
            {"ocupados": 500, "pct_mujeres": 62.0, "pct_menores_30": 40.0, "pct_55_o_mas": 20.0},
        )

    def test_personas_del_ano_anterior(self) -> None:
        """Se deducen de la variación; sin variación válida no se inventan."""
        self.assertEqual(personas_anteriores(110, 0.1), 100)
        self.assertIsNone(personas_anteriores(110, None))
        self.assertIsNone(personas_anteriores(110, -1))

    def test_variacion_solo_con_suficientes_personas(self) -> None:
        """La variación solo se publica con al menos MIN_VARIACION personas en los dos años."""
        base = {
            "c_grup_primari": "1111",
            "d_grup_primari_cno11": "x",
            "c_mes": "202606",
            "eo_cont_sum_12m": 500,
            "eo_perc_indef_tot_cont": None,
            "eo_dno_mitj": None,
        }
        grande = cataluna._contratacion({**base, "eo_per_cont_com_anual": 300, "eo_per_cont_var_anual": 0.5}, {}, {})
        pequena = cataluna._contratacion({**base, "eo_per_cont_com_anual": 90, "eo_per_cont_var_anual": 0.5}, {}, {})
        self.assertEqual(grande["variacion_pct"], 50.0)
        self.assertIsNone(pequena["variacion_pct"])


def _contratada(personas: int, anterior: int) -> dict[str, int]:
    """Una ocupación del Observatori con sus personas contratadas en los dos años.

    Returns:
        La fila con las dos cifras, como la guarda preparar.
    """
    return {"personas_contratadas": personas, "personas_contratadas_anterior": anterior}


class PruebaControlesQueFallan(unittest.TestCase):
    """Cada control de Cataluña falla con su motivo, sin detener la validación con una excepción sin contexto."""

    def test_edad_de_un_grupo_sin_cifra_inicial(self) -> None:
        """Un grupo que no empieza por su edad («De 30 a 34 años») se rechaza con su nombre."""
        with self.assertRaisesRegex(FormatoInesperado, "De 30 a 34 años"):
            cataluna.edad_de("De 30 a 34 años")

    def test_contraste_del_censo_sin_grupos_grandes(self) -> None:
        """Sin ningún grupo grande ni grupos de la Cambra con ocupados, el control falla y dice «ninguna»."""
        controles = Controles()
        censo3 = {"111": {"ocupados": 50, "pct_mujeres": 40.0}}
        cambra = {"ocupados_cno3": {"111": {"ocupados": 60, "pct_mujeres": 41.0}, "112": {"ocupados": 0}}}
        controles_cataluna.controles_contraste_censo(controles, censo3, cambra)
        self.assertEqual(len(controles.fallidos), 1)
        self.assertIn("diferencia máxima ninguna %", controles.lista[0]["control"])

    def test_contraste_del_censo_que_cuadra(self) -> None:
        """Con los grupos de la Cambra presentes y cerca del censo, el control pasa con sus cifras."""
        controles = Controles()
        censo3 = {"111": {"ocupados": 20000, "pct_mujeres": 40.0}}
        cambra = {"ocupados_cno3": {"111": {"ocupados": 19000, "pct_mujeres": 41.0}}}
        controles_cataluna.controles_contraste_censo(controles, censo3, cambra)
        self.assertEqual(controles.fallidos, [])
        self.assertIn("diferencia máxima 5.3 %", controles.lista[0]["control"])

    def test_taula13_con_un_codigo_que_el_observatori_no_trae(self) -> None:
        """Un código de la Taula 13 ausente del Observatori queda fuera del rango, con su código en el motivo."""
        controles = Controles()
        cambra = {"contratacion_cno4": {"1111": {"contratos_2025": 1000}, "2222": {"contratos_2025": 50}}}
        contratacion = {"1111": _contratada(1000, 900)}
        controles_cataluna.controles_contraste_contratacion(controles, contratacion, cambra, {"mes": 202606})
        self.assertEqual(len(controles.fallidos), 1)
        self.assertIn("fuera: 2222", controles.lista[0]["control"])

    def test_taula13_nombra_los_dos_anios_de_la_copia(self) -> None:
        """El texto del control sale del mes de la copia vigente, no de unas fechas escritas a mano."""
        controles = Controles()
        cambra = {"contratacion_cno4": {"1111": {"contratos_2025": 1000}}}
        controles_cataluna.controles_contraste_contratacion(
            controles, {"1111": _contratada(1000, 900)}, cambra, {"mes": 202609}
        )
        self.assertIn("entre septiembre de 2025 y septiembre de 2026", controles.lista[0]["control"])
        self.assertEqual(controles.fallidos, [])

    def test_variacion_del_conjunto(self) -> None:
        """Solo cuentan las ocupaciones con dato en los dos años; la variación es la de las sumas."""
        filas = [_contratada(110, 100), _contratada(300, 200), {**_contratada(50, 0), "personas_contratadas": None}]
        self.assertEqual(cataluna._variacion_conjunto(filas), 36.7)

    def test_censo_solo_de_cataluna_y_no_consta_aparte(self) -> None:
        """Las filas de otros territorios no cuentan y las que no tienen código van a «No consta»."""
        consulta = {
            "metadata": [{"row": "ID_RESIDENCIA_N1"}, {"row": "ID_OCU171"}, {"row": "ID_SEXO"}],
            "data": [
                {"ID_RESIDENCIA_N1": "Cataluña", "ID_OCU171": "111 - Miembros", "ID_SEXO": "Mujer", "SPERSONAS": 7},
                {"ID_RESIDENCIA_N1": "Aragón", "ID_OCU171": "111 - Miembros", "ID_SEXO": "Mujer", "SPERSONAS": 9},
                {"ID_RESIDENCIA_N1": "Cataluña", "ID_OCU171": "No consta", "ID_SEXO": "Hombre", "SPERSONAS": 3},
            ],
        }
        with (
            mock.patch.object(cataluna, "original", return_value="consulta.json"),
            mock.patch.object(cataluna, "leer_json", return_value=consulta),
        ):
            personas = cataluna._censo("consulta.json", "ID_OCU171")
        self.assertEqual(personas, {"111": {"Mujer": 7}, cataluna.CODIGO_NO_CONSTA: {"Hombre": 3}})

    def test_sumar_valores_y_que_constan_dejan_fuera_no_consta(self) -> None:
        """La suma de todos los grupos y los grupos que constan no incluyen la fila «No consta»."""
        por_codigo = {"111": {"Mujer": 7, "Hombre": 2}, "112": {"Mujer": 1}, cataluna.CODIGO_NO_CONSTA: {"Hombre": 3}}
        self.assertEqual(cataluna._sumar_valores(por_codigo), {"Mujer": 8, "Hombre": 2})
        self.assertEqual(sorted(cataluna._que_constan(por_codigo)), ["111", "112"])

    def test_mes_de_la_sonda_con_guion(self) -> None:
        """AAAAMM pasa a AAAA-MM, que ordena como las fechas y se compara con el periodo archivado."""
        self.assertEqual(cataluna._mes_con_guion("202606"), "2026-06")
        self.assertGreater(cataluna._mes_con_guion("202607"), "2026-06")

    def test_cita_sin_su_copia_en_la_procedencia(self) -> None:
        """Si la copia vigente de la contratación no consta en la procedencia, falta ese archivo, con su nombre."""
        total = {"d_periode": "juny de 2026"}
        with (
            mock.patch.object(cataluna, "_items", return_value=[total]),
            mock.patch.object(cataluna, "periodo_archivado", return_value="2026-06"),
            mock.patch.object(cataluna, "procedencia", return_value={"archivos": [{"archivo": "otro.json"}]}),
            self.assertRaisesRegex(ArchivoFaltante, "observatori-C_P2_MES_IND-2026-06.json"),
        ):
            cataluna.fuentes()


if __name__ == "__main__":
    unittest.main()
