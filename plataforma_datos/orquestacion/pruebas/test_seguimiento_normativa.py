"""Consultar el corpus normativo seleccionado no suprime la revisión de su selección ni de entradas manuales."""

import unittest

import plataforma_datos.cursos.pruebas.test_cobertura_acreditacion as test_cobertura_acreditacion
import plataforma_datos.cursos.pruebas.test_cobertura_actic as test_cobertura_actic
import plataforma_datos.derechos.pruebas.test_cobertura_derechos as test_cobertura_derechos
from plataforma_datos.orquestacion import comprobaciones_remotas as registro
from plataforma_datos.orquestacion.pruebas import test_seguimiento_catalogos
from plataforma_datos.orquestacion.seguimiento_de_comprobaciones import plan_desde_registro


class PruebaSeguimientoNormativa(unittest.TestCase):
    """Ejercita el registro y sus coberturas reales, con ejecutor de etapas simulado."""

    def test_consulta_admitida_conserva_revision_y_no_promueve_entradas_manuales(self) -> None:
        """Solo la consulta completa recibe fecha; ninguna variante elimina la revisión del corpus cerrado."""
        fuentes = (
            ("acreditacion", test_cobertura_acreditacion.PruebaCoberturaAcreditacion),
            ("derechos", test_cobertura_derechos.PruebaCoberturaDerechos),
            ("actic", test_cobertura_actic.PruebaCoberturaActic),
        )
        control = test_seguimiento_catalogos.PruebaSeguimientoCatalogos()
        for fuente, fabrica in fuentes:
            for variante in ("completo", "rechazado", "parcial", "local", "etapa-fallida"):
                with self.subTest(fuente=fuente, variante=variante):
                    copia = fabrica()
                    copia.setUp()
                    try:
                        evidencia = copia.evidencia
                        evidencia.update(
                            intento="normativa",
                            comienzo_utc="2026-10-17T08:00:00Z",
                            fin_utc="2026-10-17T08:01:00Z",
                        )
                        for peticion in evidencia["peticiones"]:
                            peticion["completado_utc"] = "2026-10-17T08:00:30Z"
                        control.comprobar(fuente, variante, copia.raiz, evidencia)
                        documento = registro.leer_registro(copia.raiz)
                        self.assertNotIn("formacion-catalogos", documento["conjuntos"])
                        plan = plan_desde_registro(copia.raiz, test_seguimiento_catalogos.FIN)
                        self.assertIn(fuente, plan.revisiones)
                        if variante == "completo":
                            self.assertNotIn(fuente, plan.fuentes)
                    finally:
                        copia.doCleanups()


if __name__ == "__main__":
    unittest.main()
