"""Contratos públicos de periodos mediante casos sintéticos."""

import unittest

from plataforma_datos.comun import periodos


class PruebaPeriodos(unittest.TestCase):
    """Resultados de los auxiliares comunes en sus entradas válidas."""

    def test_rotulo_de_los_doce_meses(self) -> None:
        """Los 12 meses que terminan en junio de 2026 empiezan en julio de 2025, en castellano y en catalán."""
        self.assertEqual(
            periodos.rotulo_de_doce_meses("2026-06", periodos.MESES_ES, "de {inicio} a {fin}"),
            "de julio de 2025 a junio de 2026",
        )
        self.assertEqual(
            periodos.rotulo_de_doce_meses("2026-01", periodos.MESES_CA, "de {inicio} a {fin}"),
            "de febrer del 2025 a gener del 2026",
        )

    def test_en_catalan_de_se_apostrofa_ante_vocal(self) -> None:
        """«d’abril», «d’agost», «d’octubre»: en catalán, «de» ante vocal se apostrofa (’); en castellano, no."""
        for periodo, rotulo in (
            ("2026-03", "d’abril del 2025 a març del 2026"),
            ("2026-07", "d’agost del 2025 a juliol del 2026"),
            ("2026-09", "d’octubre del 2025 a setembre del 2026"),
        ):
            with self.subTest(periodo=periodo):
                self.assertEqual(
                    periodos.rotulo_de_doce_meses(periodo, periodos.MESES_CA, "de {inicio} a {fin}"), rotulo
                )
        self.assertEqual(
            periodos.rotulo_de_doce_meses("2026-03", periodos.MESES_ES, "de {inicio} a {fin}"),
            "de abril de 2025 a marzo de 2026",
        )

    def test_meses_entre_anios(self) -> None:
        """Enero cruza al año anterior y conserva el mes al retroceder años completos."""
        for atras, esperado in ((0, "2026-01"), (1, "2025-12"), (12, "2025-01"), (24, "2024-01")):
            with self.subTest(atras=atras):
                self.assertEqual(periodos.mes_anterior("2026-01", atras), esperado)
        self.assertEqual(periodos.mes_anterior("2026-06", 11), "2025-07")

    def test_conversiones_de_meses_validos(self) -> None:
        """Los meses inicial, intermedio y final conservan año y mes en ambas conversiones."""
        for compacto, iso in ((200001, "2000-01"), (202601, "2026-01"), (202606, "2026-06"), (202612, "2026-12")):
            with self.subTest(compacto=compacto):
                self.assertEqual(periodos.mes_iso(compacto), iso)
                self.assertEqual(periodos.mes_de(iso), compacto)


if __name__ == "__main__":
    unittest.main()
