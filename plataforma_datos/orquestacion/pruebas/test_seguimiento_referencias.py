"""Una consulta íntegra de una referencia fijada conserva la revisión de su edición."""

import unittest

from plataforma_datos.orquestacion import comprobaciones_remotas as registro
from plataforma_datos.orquestacion.pruebas import test_cobertura_referencias, test_seguimiento_catalogos
from plataforma_datos.orquestacion.seguimiento_de_comprobaciones import plan_desde_registro


class PruebaSeguimientoReferencias(unittest.TestCase):
    """Contrasta admisión, recibo, registro durable y planificación, sin simular la cobertura."""

    def test_consulta_completa_no_elimina_revision_de_edicion(self) -> None:
        """Solo consulta completa y módulo admitido dan fecha; ninguna variante declara última edición."""
        control = test_seguimiento_catalogos.PruebaSeguimientoCatalogos()
        for fuente in ("oit", "clasificaciones", "idescat", "territorios", "decada_digital"):
            for variante in ("completo", "rechazado", "parcial", "local", "etapa-fallida"):
                with self.subTest(fuente=fuente, variante=variante):
                    copia = test_cobertura_referencias.PruebaCoberturaReferencias()
                    copia.crear(fuente)
                    try:
                        control.comprobar(fuente, variante, copia.raiz, copia.evidencia)
                        documento = registro.leer_registro(copia.raiz)
                        self.assertEqual(set(documento["conjuntos"]), {fuente} if variante == "completo" else set())
                        plan = plan_desde_registro(copia.raiz, test_seguimiento_catalogos.FIN)
                        self.assertIn(fuente, plan.revisiones)
                        if variante == "completo":
                            self.assertNotIn(fuente, plan.fuentes)
                    finally:
                        copia.doCleanups()


if __name__ == "__main__":
    unittest.main()
