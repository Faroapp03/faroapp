"""El plazo del motor sale del último ciclo real completo que se ha medido, con su margen."""

import math
import unittest

from plataforma_datos.orquestacion import medidas_del_ciclo
from plataforma_datos.orquestacion.ejecutor_operativo import PLAZO_CANDIDATO_S

# El plazo se redondea hacia arriba a cinco minutos para que la cifra se lea de un vistazo en el workflow.
REDONDEO_S = 5 * 60


# Las fuentes esperan a la red y se cuentan como se midieron; el paquete es cálculo y se cuenta en el runner lento.
def _medido_en_el_runner_lento_con_margen() -> float:
    medido = medidas_del_ciclo.FUENTES_S + medidas_del_ciclo.PAQUETE_EN_EL_RUNNER_LENTO_S
    return medido * (100 + medidas_del_ciclo.MARGEN_POR_CIENTO) / 100


class PlazoDelMotor(unittest.TestCase):
    """Un plazo por debajo de lo medido corta el ciclo real antes de publicar, como el 23/11/2026."""

    def test_el_paquete_en_el_runner_lento_es_cada_parte_medida_por_el_factor_de_su_tipo_de_trabajo(self) -> None:
        """Componer y las pruebas de Python van con el factor de Python; las de Node y lo demás, con el de Node."""
        m = medidas_del_ciclo
        python = (m.COMPONER_EN_EL_MAC_S + m.PRUEBAS_PYTHON_EN_EL_MAC_S) * m.PYTHON_EN_EL_RUNNER_LENTO
        node = (m.PRUEBAS_NODE_EN_EL_MAC_S + m.RESTO_EN_EL_MAC_S) * m.NODE_EN_EL_RUNNER_LENTO
        self.assertAlmostEqual(m.PAQUETE_EN_EL_RUNNER_LENTO_S, python + node, places=6)
        self.assertAlmostEqual(
            m.PAQUETE_EN_EL_MAC_S,
            m.COMPONER_EN_EL_MAC_S + m.PRUEBAS_PYTHON_EN_EL_MAC_S + m.PRUEBAS_NODE_EN_EL_MAC_S + m.RESTO_EN_EL_MAC_S,
            places=6,
        )
        self.assertGreaterEqual(m.RESTO_EN_EL_MAC_S, 0)
        self.assertGreater(m.NODE_EN_EL_RUNNER_LENTO, m.PYTHON_EN_EL_RUNNER_LENTO)

    def test_el_plazo_del_motor_cubre_el_ultimo_ciclo_completo_en_el_runner_lento_con_su_margen(self) -> None:
        """`PLAZO_CANDIDATO_S` cubre las fuentes medidas y el paquete en el runner lento, más el margen."""
        self.assertGreaterEqual(
            PLAZO_CANDIDATO_S,
            _medido_en_el_runner_lento_con_margen(),
            f"El plazo del motor ({PLAZO_CANDIDATO_S / 60:.0f} min) no cubre el ciclo real "
            f"{medidas_del_ciclo.CICLO_MEDIDO} (fuentes {medidas_del_ciclo.FUENTES_S / 60:.1f} min y paquete "
            f"{medidas_del_ciclo.PAQUETE_EN_EL_RUNNER_LENTO_S / 60:.1f} min en el runner lento) más el margen del "
            f"{medidas_del_ciclo.MARGEN_POR_CIENTO} % (medidas_del_ciclo.MARGEN_POR_CIENTO).",
        )

    def test_el_plazo_del_motor_es_lo_medido_con_margen_redondeado_hacia_arriba_a_cinco_minutos(self) -> None:
        """Un plazo mayor de lo necesario gasta minutos del presupuesto mensual del workflow sin motivo medido."""
        esperado = math.ceil(_medido_en_el_runner_lento_con_margen() / REDONDEO_S) * REDONDEO_S
        self.assertEqual(PLAZO_CANDIDATO_S, esperado, f"PLAZO_CANDIDATO_S debe ser {esperado // 60} * 60.")


if __name__ == "__main__":
    unittest.main()
