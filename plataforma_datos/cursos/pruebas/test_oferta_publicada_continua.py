"""Oferta continua explícita: evidencia, precio y condiciones separados del registro."""

import unittest
from copy import deepcopy

from plataforma_datos.cursos import oferta_continua, politicas_vigencia, registro_vigencia
from plataforma_datos.cursos.pruebas.test_vigencia import AHORA, OFERTA, evidencia, fallo, ficha, politica
from plataforma_datos.cursos.vigencia import ErrorVigencia, evaluar_vigencia

ANTIGUA = "2026-10-22T07:00:00Z"
RECIENTE = "2026-10-22T09:00:00Z"
VENCIMIENTO = "2026-10-23T07:00:00Z"


def continua() -> dict:
    """Construye una ficha sin periodo ni acceso sin registro afirmado.

    Returns:
        Declaración sintética completa ligada a sus apoyos de disponibilidad.
    """
    observacion = ficha(fuente={"coste_formacion": 0}, abierto=None)
    observacion["detalle"][oferta_continua.CAMPO] = {
        "version": 1,
        "metodo": oferta_continua.METODO,
        "curso_id": OFERTA["id"],
        "criterios": {c: {"valor": True, "apoyos": [1]} for c in oferta_continua.CRITERIOS},
    }
    return observacion


class OfertaPublicadaContinuaPruebas(unittest.TestCase):
    """Entradas sintéticas: ninguna consulta, cuenta o fecha comercial inventada."""

    def evaluar(self, observaciones: list[dict], ahora: str = AHORA, *, nueva: bool = True) -> dict:
        """Ejecuta el evaluador con activación expresa o con el comportamiento anterior.

        Returns:
            Decisión completa con trazabilidad y límites calculados.
        """
        norma = politica()
        if nueva:
            norma["regla_disponibilidad"] = oferta_continua.METODO
        return evaluar_vigencia(OFERTA, observaciones, norma, ahora=ahora)

    def test_oferta_continua_no_necesita_inventar_periodo_o_acceso_sin_registro(self) -> None:
        """El contrato nuevo no altera la regla anterior ni afirma registro personal."""
        observacion = continua()
        self.assertIsNone(observacion["detalle"]["acceso_abierto"])
        self.assertEqual(self.evaluar([observacion], nueva=False)["estado"], "sin-confirmar")
        resultado = self.evaluar([observacion])
        self.assertEqual(resultado["estado"], "disponible-publicamente")
        self.assertIn("oferta_publicada_continua_acreditada", resultado["motivos"])
        self.assertIsNone(observacion["detalle"]["datos_edicion"]["fechas_matricula"]["inicio"])
        self.assertEqual(self.evaluar([ficha()], nueva=False)["estado"], "disponible-publicamente")

    def test_muestra_gratuita_de_curso_de_pago_no_acredita_curso_completo(self) -> None:
        """Una muestra no se amplía a curso ni tapa un precio contrario."""
        for criterio in ("curso_completo", "formacion_gratuita"):
            observacion = continua()
            observacion["detalle"][oferta_continua.CAMPO]["criterios"][criterio]["valor"] = False
            self.assertEqual(self.evaluar([observacion])["estado"], "sin-confirmar")

    def test_cta_ajeno_y_condiciones_no_constatadas_no_abren(self) -> None:
        """Cada criterio es necesario; null no se convierte en ausencia de requisito."""
        for criterio in (
            "cta_identificado",
            "destino_identificado",
            "destinatarios_constatados",
            "requisitos_constatados",
        ):
            observacion = continua()
            observacion["detalle"][oferta_continua.CAMPO]["criterios"][criterio]["valor"] = None
            self.assertEqual(self.evaluar([observacion])["estado"], "sin-confirmar")
        observacion = continua()
        observacion["detalle"][oferta_continua.CAMPO]["curso_id"] = "curso-ajeno"
        with self.assertRaises(ErrorVigencia):
            self.evaluar([observacion])

    def test_cierre_explicito_prevalece_sobre_la_declaracion_positiva(self) -> None:
        """Una inscripción cerrada no se reabre por un CTA o una declaración general."""
        observacion = continua()
        observacion["detalle"]["datos_edicion"] = ficha(fuente={"inscripcion": "Matrícula cerrada"}, abierto=None)[
            "detalle"
        ]["datos_edicion"]
        self.assertEqual(self.evaluar([observacion])["estado"], "no-disponible-publicamente")

    def test_apoyos_de_canales_distintos_conservan_la_edad_del_mas_antiguo(self) -> None:
        """Una declaración reciente no rejuvenece una ficha o condición anterior."""
        observacion = continua()
        observacion["intentado_el"] = ANTIGUA
        observacion["terminado_el"] = RECIENTE
        indice_declaracion = len(observacion["evidencias"])
        observacion["evidencias"].extend(
            [
                evidencia("disponibilidad", ANTIGUA, "https://example.org/declaracion"),
                evidencia("disponibilidad", RECIENTE, "https://example.org/curso-ia-1/inicio"),
            ]
        )
        criterios = observacion["detalle"][oferta_continua.CAMPO]["criterios"]
        criterios["formacion_gratuita"]["apoyos"] = [indice_declaracion]
        criterios["destino_identificado"]["apoyos"] = [indice_declaracion + 1]
        resultado = self.evaluar([observacion])
        self.assertEqual(resultado["comprobado_el"], ANTIGUA)
        self.assertEqual(resultado["revisar_el"], VENCIMIENTO)
        pasada = self.evaluar([observacion], VENCIMIENTO)
        self.assertEqual(pasada["estado"], resultado["estado"])
        self.assertEqual(pasada["comprobado_el"], ANTIGUA)
        posterior = self.evaluar([observacion, fallo()])
        self.assertEqual(posterior["comprobado_el"], ANTIGUA)
        self.assertEqual(posterior["revisar_el"], VENCIMIENTO)
        self.assertNotEqual(posterior["estado"], "no-disponible-publicamente")

    def test_criterios_sin_evidencia_no_se_admiten(self) -> None:
        """Un booleano positivo sin prueba, un índice roto o otra regla se rechazan."""
        for cambio in ([], [True], [9]):
            observacion = continua()
            observacion["detalle"][oferta_continua.CAMPO]["criterios"]["cta_identificado"]["apoyos"] = cambio
            with self.assertRaises(ErrorVigencia):
                self.evaluar([observacion])
        observacion = continua()
        observacion["evidencias"][1]["localizador"] = None
        with self.assertRaises(ErrorVigencia):
            self.evaluar([observacion])

    def test_politica_versionada_y_codigo_auxiliar_entran_en_la_firma(self) -> None:
        """No se puede cambiar el criterio auxiliar sin invalidar su firma de evaluación."""
        norma = politicas_vigencia.leer_politica("claude_academy", "2")
        self.assertEqual(norma["regla_disponibilidad"], oferta_continua.METODO)
        self.assertNotIn("regla_disponibilidad", politicas_vigencia.leer_politica("hp_life", "2"))
        self.assertIn("plataforma_datos/cursos/oferta_continua.py", registro_vigencia.firma_evaluador()["archivos"])
        anterior = deepcopy(norma)
        self.assertEqual(anterior, norma)


if __name__ == "__main__":
    unittest.main()
