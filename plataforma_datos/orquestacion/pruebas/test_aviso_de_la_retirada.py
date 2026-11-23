"""El cambio de modo de la regla de retirada de una fuente llega al panel durante una semana y con su forma cerrada."""

import tempfile
import unittest
from datetime import UTC, datetime
from pathlib import Path

from plataforma_datos.orquestacion.aviso_de_la_retirada import aviso_de_la_retirada
from plataforma_datos.orquestacion.contrato_comprobaciones_panel import validar_aviso_de_la_retirada
from plataforma_datos.orquestacion.pruebas.test_activacion_en_el_ciclo import activa_con

AHORA = datetime(2026, 11, 15, 5, tzinfo=UTC)
LECTURA = "a" * 64


class AvisoDeLaRetirada(unittest.TestCase):
    """Del último cambio guardado en el estado de la fuente al aviso del panel."""

    def setUp(self) -> None:
        """Una instalación temporal con la regla de Cibernàrium activada el 12/11."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.raiz = Path(temporal.name)
        activa_con(self.raiz, "barcelonactiva", [LECTURA])

    def test_la_activacion_de_la_ultima_semana_viaja_con_su_cifra(self) -> None:
        """Activada el 12/11 con 30 decisiones: el aviso del 15/11 lo dice y cumple el contrato."""
        aviso = aviso_de_la_retirada(self.raiz, "barcelonactiva", AHORA)
        self.assertEqual(aviso, {"cambio": "activada", "decisiones": 30, "en": "2026-11-12T05:00:00Z"})
        validar_aviso_de_la_retirada(aviso)

    def test_pasada_la_semana_el_aviso_se_retira_solo(self) -> None:
        """Ocho días después ya no hay aviso; la regla sigue activa."""
        self.assertIsNone(aviso_de_la_retirada(self.raiz, "barcelonactiva", datetime(2026, 11, 20, 6, tzinfo=UTC)))

    def test_una_fuente_sin_cambios_no_avisa(self) -> None:
        """Otra fuente, que nunca cambió de modo, no trae aviso."""
        self.assertIsNone(aviso_de_la_retirada(self.raiz, "hp_life", AHORA))

    def test_un_aviso_fuera_de_su_forma_no_se_admite(self) -> None:
        """Un cambio desconocido, una cifra negativa, un campo de más o una hora mal escrita se rechazan."""
        bueno = {"cambio": "vuelta-a-sombra", "decisiones": 0, "en": "2026-11-12T05:00:00Z"}
        validar_aviso_de_la_retirada(bueno)
        for malo in (
            {**bueno, "cambio": "otra"},
            {**bueno, "decisiones": -1},
            {**bueno, "decisiones": True},
            {**bueno, "extra": 1},
            {**bueno, "en": "12/11/2026"},
        ):
            with self.subTest(malo=malo), self.assertRaises(ValueError):
                validar_aviso_de_la_retirada(malo)


if __name__ == "__main__":
    unittest.main()
