"""La exportación anual respeta el mes del corte admitido y conserva las guardas de fuente."""

import unittest
from pathlib import Path
from unittest import mock

from plataforma_datos.comun.nucleo import FormatoInesperado
from plataforma_datos.orquestacion.exportacion import mercado

MESES_EN_DOS_ANIOS = 24
DICIEMBRE = 12


class MercadoPorPeriodo(unittest.TestCase):
    """Compone el paquete real con conjuntos y originales sintéticos; no descarga ni escribe datos."""

    def componer(self, mes: int, *, incompleto: bool = False, corte_distinto: bool = False) -> mercado.Paquete:
        """Las variaciones del mes correcto son 25 %; las de otros meses, 50 %.

        Returns:
            El paquete compuesto, con su lista de originales.
        """
        fin = 2026
        periodo = f"12 meses a {mercado.MESES[mes - 1]} de {fin}"
        observatori = {
            "periodo": periodo,
            "fuentes": {"observatori": "fuente sintética"},
            "min_serie": 1000,
            "cataluna": {
                "cno4": {"4110": {"contratos": 10000}, "0001": {"contratos": 999}, "0002": {"contratos": None}}
            },
        }
        evolucion = []
        for atras in range(49):
            anio, indice_mes = divmod(fin * 12 + mes - 1 - atras, 12)
            for cno4 in ("4110", "0001", "0002"):
                evolucion.append(
                    {
                        "c_mes": anio * 100 + indice_mes + 1,
                        "c_grup_primari": cno4,
                        "eo_var_cont_mm_12m": None
                        if incompleto and atras == MESES_EN_DOS_ANIOS
                        else 0.25
                        if indice_mes + 1 == mes
                        else 0.5,
                    }
                )
        indicadores = [
            {
                "c_mes": fin * 100 + (mes % 12 + 1 if corte_distinto else mes),
                "c_grup_primari": "4110",
                "eo_per_cont_var_anual": 0.1,
                "eo_per_dno_12m_comanual": 300,
            }
        ]
        comarcas = [
            {"c_mes": fin * 100 + mes, "c_grup_primari": "4110", "d_comarca": "Comarca", "eo_cont_sum_12m": 10000}
        ]

        def items(ruta: Path) -> list[dict]:
            if "C_P2_MES_IND" in ruta.name:
                return indicadores
            if "C_P5_EVOL_2" in ruta.name:
                return evolucion
            return comarcas

        def ultimo(casa: str, patron: str) -> Path:
            self.assertIn(f"{fin}-{mes:02d}", patron)
            return Path(casa) / patron

        with (
            mock.patch.object(
                mercado,
                "leer_validado",
                side_effect=lambda fuente: observatori if fuente == "observatori" else {"cita": "cita sintética"},
            ),
            mock.patch.object(mercado, "ultimo_original", side_effect=ultimo),
            mock.patch.object(mercado, "ruta_del_conjunto", side_effect=lambda fuente: Path(f"{fuente}.json")),
            mock.patch.object(mercado, "_items", side_effect=items),
            mock.patch.object(mercado, "_empleo", return_value={}),
            mock.patch.object(mercado, "_salarios", return_value={}),
            mock.patch.object(mercado, "_ofertas", return_value={}),
        ):
            return mercado.paquete_mercado()

    def test_junio_conserva_la_serie_el_umbral_y_la_forma(self) -> None:
        """El único corte previamente admitido conserva sus etiquetas, redondeos y último publicado."""
        anual = self.componer(6).datos["anual"]
        self.assertEqual(
            anual,
            {
                "etiquetas": ["2020-21", "2021-22", "2022-23", "2023-24", "2024-25", "2025-26"],
                "publicado": [False] * 5 + [True],
                "cno4": {"4110": [3277, 4096, 5120, 6400, 8000, 10000]},
            },
        )

    def test_septiembre_y_diciembre_reconstruyen_su_propio_mes(self) -> None:
        """El corte fija originales, variaciones, periodo y años; diciembre ya no cruza dos años."""
        for mes in (9, 12):
            with self.subTest(mes=mes):
                datos = self.componer(mes).datos
                anual = datos["anual"]
                self.assertEqual(anual["cno4"], {"4110": [3277, 4096, 5120, 6400, 8000, 10000]})
                self.assertEqual(anual["publicado"], [False] * 5 + [True])
                self.assertEqual(anual["etiquetas"][-1], "2026" if mes == DICIEMBRE else "2025-26")
                self.assertEqual(anual["etiquetas"][0], "2021" if mes == DICIEMBRE else "2020-21")
                self.assertEqual(datos["contratacion"]["periodo"], f"12 meses a {mercado.MESES[mes - 1]} de 2026")
                self.assertEqual(datos["comarcas"]["periodo"], datos["contratacion"]["periodo"])
                self.assertEqual(datos["demandantes"]["periodo"], datos["contratacion"]["periodo"])

    def test_no_inventa_serie_si_falta_una_variacion_necesaria(self) -> None:
        """La ausencia en un corte anual conserva la omisión por cobertura incompleta."""
        for mes in (6, 9, 12):
            with self.subTest(mes=mes):
                self.assertEqual(self.componer(mes, incompleto=True).datos["anual"]["cno4"], {})

    def test_fuentes_de_otro_corte_siguen_rechazadas(self) -> None:
        """Admitir meses nuevos no permite mezclar indicadores ni comarcas de otro periodo."""
        for mes in (6, 9, 12):
            with self.subTest(mes=mes), self.assertRaisesRegex(FormatoInesperado, "indicadores y comarcas"):
                self.componer(mes, corte_distinto=True)


if __name__ == "__main__":
    unittest.main()
