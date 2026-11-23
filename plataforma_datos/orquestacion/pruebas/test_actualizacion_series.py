"""Las series abiertas admiten candidatos periódicos y reconstruyen sus consumidores sin concederles red."""

import contextlib
import io
import tempfile
import unittest
from datetime import UTC, datetime
from pathlib import Path

from plataforma_datos.orquestacion import actualizar
from plataforma_datos.orquestacion import comprobaciones_remotas as registro
from plataforma_datos.orquestacion.ejecucion_observada import etapa_de_fuente
from plataforma_datos.orquestacion.planificacion_de_comprobaciones import CONJUNTOS
from plataforma_datos.orquestacion.pruebas import test_cobertura_series, test_seguimiento_catalogos
from plataforma_datos.orquestacion.pruebas.test_actualizacion_por_modulos import EjecutorDeModulos
from plataforma_datos.orquestacion.pruebas.test_candidato import preparar

SERIES = ("mundo_eurostat", "ilostat", "ue_eurostat", "ocupados")


class PruebaActualizacionSeries(unittest.TestCase):
    """Recorre el coordinador real; las órdenes de fuente usan datos sintéticos aislados."""

    def test_cobertura_y_admision_necesarias_antes_de_registrar_comprobacion(self) -> None:
        """Ninguna recepción parcial, reconstrucción local o validación fallida renueva la comprobación."""
        control = test_seguimiento_catalogos.PruebaSeguimientoCatalogos()
        for fuente in SERIES:
            for variante in ("completo", "rechazado", "parcial", "local", "etapa-fallida"):
                with self.subTest(fuente=fuente, variante=variante):
                    copia = test_cobertura_series.PruebaCoberturaSeries()
                    copia.setUp()
                    try:
                        evidencia = next(caso[3] for caso in copia.casos if caso[0] == fuente)
                        control.comprobar(fuente, variante, copia.raiz, evidencia)
                    finally:
                        copia.doCleanups()

    def test_una_serie_vencida_admite_candidato_y_recompone_consumidores(self) -> None:
        """Solo la serie vencida descarga; sus resultados llegan a los consumidores y al paquete."""
        for fuente in SERIES:
            with self.subTest(fuente=fuente), tempfile.TemporaryDirectory() as temporal:
                raiz = Path(temporal) / "Mis documentos" / "Año 2026"
                preparar(raiz)
                momento = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
                ciclo = registro.iniciar_ciclo(raiz, momento, "manual")
                fuentes = dict.fromkeys(c.fuente for c in CONJUNTOS if c.operacion == "descargar")
                for otra in fuentes:
                    if otra == fuente:
                        continue
                    conjuntos = tuple(c.id for c in CONJUNTOS if c.fuente == otra)
                    registro.iniciar_fuente(raiz, ciclo, otra, conjuntos, momento, remoto=True)
                    registro.terminar_fuente(raiz, ciclo, otra, momento, resultado="parcial", evidencia=None)
                registro.cerrar_ciclo(raiz, ciclo, momento, resultado="preparado", paquete_preparado=True)
                ejecutor = EjecutorDeModulos()
                with contextlib.redirect_stdout(io.StringIO()):
                    resultado = actualizar.actualizar_con_resultado(
                        raiz, actualizar.Opciones(programada=True, pausa=0, reintento=0), ejecutor
                    )
                self.assertEqual(resultado.codigo, 0)
                descargas = [
                    orden
                    for orden in ejecutor.ordenes
                    if (etapa := etapa_de_fuente(orden)) is not None and etapa[1] == "descargar"
                ]
                self.assertEqual(len(descargas), 1)
                self.assertEqual(etapa_de_fuente(descargas[0]), (fuente, "descargar"))
                self.assertIn("--aceptar-cambio", descargas[0])
                self.assertEqual(resultado.resultados["paquete"].veredicto, "verde")
                consumidor = "censo" if fuente == "ocupados" else "datos_globales"
                self.assertEqual(ejecutor.leido[consumidor][fuente], f"nuevo {fuente}")
                if fuente == "mundo_eurostat":
                    self.assertEqual(ejecutor.leido["ilostat"][fuente], f"nuevo {fuente}")
                    self.assertEqual(ejecutor.leido["datos_globales"]["ilostat"], "nuevo ilostat")
                # Las órdenes dobles no traen recepción remota: ni un verde crea evidencia.
                self.assertEqual(registro.leer_registro(raiz)["conjuntos"], {})


if __name__ == "__main__":
    unittest.main()
