"""El plazo del motor sale del último ciclo real completo que se ha medido y de la reserva del paquete."""

import math
import unittest

from plataforma_datos.orquestacion import hora_limite_del_motor, medidas_del_ciclo
from plataforma_datos.orquestacion import ordenes_de_la_actualizacion as ordenes
from plataforma_datos.orquestacion.ejecutor_operativo import PLAZO_CANDIDATO_S

# El plazo se redondea hacia arriba a cinco minutos para que la cifra se lea de un vistazo en el workflow.
REDONDEO_S = 5 * 60


# Las fuentes esperan a la red y se cuentan como se midieron, con su margen; el paquete, con su reserva.
def _lo_que_necesita_el_motor() -> float:
    m = medidas_del_ciclo
    return m.FUENTES_S * m.MARGEN + m.RESERVA_DEL_PAQUETE_S


# Las otras fases del paquete, recalculadas parte por parte con el factor de su tipo de trabajo.
def _otras_fases_en_el_runner_lento() -> float:
    m = medidas_del_ciclo
    python = m.PRUEBAS_PYTHON_EN_EL_MAC_S * m.PYTHON_EN_EL_RUNNER_LENTO
    node = (m.PRUEBAS_NODE_EN_EL_MAC_S + m.RESTO_EN_EL_MAC_S) * m.NODE_EN_EL_RUNNER_LENTO
    return python + node


class ReservaDelPaquete(unittest.TestCase):
    """Una sola reserva para el paquete: el plazo entero de componer y las otras fases medidas, con su margen."""

    def test_las_otras_fases_son_cada_parte_medida_por_el_factor_de_su_tipo_de_trabajo(self) -> None:
        """Las pruebas de Python van con el factor de Python; las de Node y lo demás, con el de Node."""
        m = medidas_del_ciclo
        self.assertAlmostEqual(m.OTRAS_FASES_EN_EL_RUNNER_LENTO_S, _otras_fases_en_el_runner_lento(), places=6)
        self.assertAlmostEqual(
            m.PAQUETE_EN_EL_MAC_S,
            m.COMPONER_EN_EL_MAC_S + m.PRUEBAS_PYTHON_EN_EL_MAC_S + m.PRUEBAS_NODE_EN_EL_MAC_S + m.RESTO_EN_EL_MAC_S,
            places=6,
        )
        self.assertGreaterEqual(m.RESTO_EN_EL_MAC_S, 0)
        self.assertGreater(m.NODE_EN_EL_RUNNER_LENTO, m.PYTHON_EN_EL_RUNNER_LENTO)
        self.assertEqual(m.MARGEN, (100 + m.MARGEN_POR_CIENTO) / 100)

    def test_la_reserva_es_el_plazo_de_componer_entero_mas_las_otras_fases_con_su_margen(self) -> None:
        """Componer entra una sola vez y sin margen, porque ya es un plazo; su medida no se suma de nuevo."""
        m = medidas_del_ciclo
        self.assertAlmostEqual(
            m.RESERVA_DEL_PAQUETE_S, m.PLAZO_DE_COMPONER_S + _otras_fases_en_el_runner_lento() * m.MARGEN, places=6
        )

    def test_las_otras_fases_caben_aunque_componer_agote_su_tope(self) -> None:
        """Lo que queda tras un componer que llega a su tope cubre todavía las otras fases con su margen."""
        m = medidas_del_ciclo
        tras_componer = hora_limite_del_motor.NECESARIO_S - ordenes.COMPONER_EL_CATALOGO.tope
        self.assertGreaterEqual(tras_componer, _otras_fases_en_el_runner_lento() * m.MARGEN)
        self.assertGreaterEqual(hora_limite_del_motor.NECESARIO_S, m.RESERVA_DEL_PAQUETE_S)


class PlazoDelMotor(unittest.TestCase):
    """Un plazo por debajo de lo medido corta el ciclo real antes de publicar, como el 23/11/2026."""

    def test_el_plazo_del_motor_cubre_el_ultimo_ciclo_completo_y_la_reserva_del_paquete(self) -> None:
        """`PLAZO_CANDIDATO_S` cubre las fuentes medidas con su margen y la reserva del paquete."""
        m = medidas_del_ciclo
        self.assertGreaterEqual(
            PLAZO_CANDIDATO_S,
            _lo_que_necesita_el_motor(),
            f"El plazo del motor ({PLAZO_CANDIDATO_S / 60:.0f} min) no cubre el ciclo real {m.CICLO_MEDIDO} (fuentes "
            f"{m.FUENTES_S / 60:.1f} min con el margen del {m.MARGEN_POR_CIENTO} %) más la reserva del paquete "
            f"({m.RESERVA_DEL_PAQUETE_S / 60:.1f} min: componer {m.PLAZO_DE_COMPONER_S / 60:.0f} min y las otras fases "
            f"{m.OTRAS_FASES_EN_EL_RUNNER_LENTO_S / 60:.1f} min en el runner lento, con su margen).",
        )

    def test_el_plazo_del_motor_es_lo_necesario_redondeado_hacia_arriba_a_cinco_minutos(self) -> None:
        """Un plazo mayor de lo necesario gasta minutos del presupuesto mensual del workflow sin motivo medido."""
        esperado = math.ceil(_lo_que_necesita_el_motor() / REDONDEO_S) * REDONDEO_S
        self.assertEqual(PLAZO_CANDIDATO_S, esperado, f"PLAZO_CANDIDATO_S debe ser {esperado // 60} * 60.")

    def test_el_motor_cubre_el_ciclo_medido_aunque_componer_agote_su_tope(self) -> None:
        """Las fuentes con su margen, componer hasta su tope y las otras fases con su margen caben en el motor."""
        m = medidas_del_ciclo
        peor_caso = (
            m.FUENTES_S * m.MARGEN + ordenes.COMPONER_EL_CATALOGO.tope + _otras_fases_en_el_runner_lento() * m.MARGEN
        )
        self.assertGreaterEqual(PLAZO_CANDIDATO_S, peor_caso)
        self.assertGreaterEqual(PLAZO_CANDIDATO_S, m.FUENTES_S * m.MARGEN + hora_limite_del_motor.NECESARIO_S)


if __name__ == "__main__":
    unittest.main()
