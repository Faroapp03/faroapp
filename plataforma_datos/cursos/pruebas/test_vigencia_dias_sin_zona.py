"""Días sin zona: una incertidumbre de borde no invalida un interior inequívoco."""

import unittest

from plataforma_datos.cursos.pruebas.test_vigencia import OFERTA, ficha, politica
from plataforma_datos.cursos.tipos_json import ObjetoJson
from plataforma_datos.cursos.vigencia import evaluar_vigencia


class PruebaDiasSinZona(unittest.TestCase):
    """No se publica una hora de fuente ni se adopta la zona de la máquina."""

    def evaluar(self, inicio: str, fin: str, ahora: str, captura: str | None = None) -> ObjetoJson:
        """Evalúa una ventana sintética vinculada a su propia edición.

        Returns:
            Decisión del evaluador real con una política de prueba explícita.
        """
        observacion = ficha(
            captura or ahora,
            fuente={"fechas_aula": {"inicio": inicio, "fin": fin}, "estado": "actual_matricula_abierta"},
            abierto=None,
        )
        criterio = {**politica(), "zona_fechas_dia": None, "ttl_ficha_segundos": 10 * 86400}
        return evaluar_vigencia(OFERTA, [observacion], criterio, ahora=ahora)

    def test_interior_claro_no_exige_zona_ni_inclusividad_inventadas(self) -> None:
        """Octubre está dentro de enero–diciembre bajo todos los offsets UTC admisibles."""
        resultado = self.evaluar("2026-01-01", "2026-12-31", "2026-10-22T10:00:00Z")
        self.assertEqual(resultado["estado"], "disponible-publicamente")
        self.assertIsNone(resultado["trazabilidad"]["politica"]["zona_fechas_dia"])

    def test_inicio_futuro_claro_y_borde_ambiguo_no_abren(self) -> None:
        """Antes de todas las aperturas posibles es futuro; cerca del día publicado sigue sin confirmar."""
        futuro = self.evaluar("2026-10-22", "2026-12-31", "2026-10-20T23:59:59Z")
        self.assertEqual(futuro["estado"], "apertura-futura")
        for ahora in ("2026-10-21T12:00:00Z", "2026-10-21T23:59:59Z", "2026-10-22T00:00:00Z"):
            with self.subTest(ahora=ahora):
                borde = self.evaluar("2026-10-22", "2026-12-31", ahora)
                self.assertEqual(borde["estado"], "sin-confirmar")

    def test_despues_de_todos_los_inicios_posibles_permite_oferta(self) -> None:
        """No se mantiene oculta después de que todas las interpretaciones del inicio ya pasaron."""
        resultado = self.evaluar("2026-10-22", "2026-12-31", "2026-10-24T00:00:00Z")
        self.assertEqual(resultado["estado"], "disponible-publicamente")

    def test_borde_fin_no_afirma_cierre_ni_ttl_lo_atraviesa(self) -> None:
        """La cota del límite publicado es conservadora, no una hora publicada de cierre."""
        dentro = self.evaluar("2026-01-01", "2026-10-24", "2026-10-22T12:00:00Z")
        self.assertEqual(dentro["estado"], "disponible-publicamente")
        self.assertEqual(dentro["cierra_el"], "2026-10-23T00:00:00.000001Z")
        self.assertEqual(
            dentro["trazabilidad"]["limites_calculados"][0]["criterio"],
            "inicio_de_ambiguedad_sin_zona_desfase_menor_24h",
        )
        borde = self.evaluar("2026-01-01", "2026-10-24", dentro["cierra_el"], "2026-10-22T12:00:00Z")
        self.assertEqual(borde["estado"], "sin-confirmar")
        self.assertNotIn("fuente_contradictoria_matricula_abierta_y_acceso_finalizado", borde["motivos"])

    def test_fin_inequivocamente_pasado_conserva_contradiccion_no_cancelacion(self) -> None:
        """Matrícula declarada abierta y acceso terminado conserva el conflicto en vez de afirmar cancelación."""
        resultado = self.evaluar("2026-01-01", "2026-10-22", "2026-10-24T00:00:00Z")
        self.assertEqual(resultado["estado"], "sin-confirmar")
        self.assertIn("fuente_contradictoria_matricula_abierta_y_acceso_finalizado", resultado["motivos"])
