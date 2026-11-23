"""El visor se consulta con un corte coherente y un fallo conserva el paquete servido."""

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
from plataforma_datos.orquestacion.pruebas import test_cobertura_visor, test_seguimiento_catalogos
from plataforma_datos.orquestacion.pruebas.test_actualizacion_por_modulos import EjecutorDeModulos, publicado
from plataforma_datos.orquestacion.pruebas.test_candidato import preparar


def dejar_pendiente(raiz: Path, fuente: str) -> None:
    """Registra intentos recientes de las demás fuentes, sin atribuirles comprobación ni vigencia."""
    momento = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
    ciclo = registro.iniciar_ciclo(raiz, momento, "manual")
    fuentes = dict.fromkeys(c.fuente for c in CONJUNTOS if c.operacion == "descargar")
    for otra in fuentes:
        if otra != fuente:
            conjuntos = tuple(c.id for c in CONJUNTOS if c.fuente == otra)
            registro.iniciar_fuente(raiz, ciclo, otra, conjuntos, momento, remoto=True)
            registro.terminar_fuente(raiz, ciclo, otra, momento, resultado="parcial", evidencia=None)
    registro.cerrar_ciclo(raiz, ciclo, momento, resultado="preparado", paquete_preparado=True)


class PruebaActualizacionVisor(unittest.TestCase):
    """Coordinador y selección reales; procesos de las fuentes simulados, sin red."""

    def test_registro_exige_cobertura_y_admision_de_cada_parte(self) -> None:
        """Ni una consulta parcial ni una copia rechazada o reconstruida rejuvenecen el registro."""
        control = test_seguimiento_catalogos.PruebaSeguimientoCatalogos()
        for fuente in ("cataluna", "observatori"):
            for variante in ("completo", "rechazado", "parcial", "local", "etapa-fallida"):
                with self.subTest(fuente=fuente, variante=variante):
                    copia = test_cobertura_visor.PruebaCoberturaVisor()
                    copia.setUp()
                    try:
                        control.comprobar(fuente, variante, copia.raiz, copia.recibos[fuente])
                    finally:
                        copia.doCleanups()

    def test_consulta_conjunta_y_recomposicion_sin_descargas_ajenas(self) -> None:
        """Vencer cualquiera de las dos partes consulta ambas y lleva sus entradas a los consumidores."""
        for fuente in ("cataluna", "observatori"):
            with self.subTest(fuente=fuente), tempfile.TemporaryDirectory() as temporal:
                raiz = Path(temporal) / "Mis documentos" / "Año 2026"
                preparar(raiz)
                dejar_pendiente(raiz, fuente)
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
                self.assertEqual(
                    [etapa_de_fuente(orden) for orden in descargas],
                    [("cataluna", "descargar"), ("observatori", "descargar")],
                )
                self.assertTrue(all("--aceptar-cambio" in orden for orden in descargas))
                self.assertEqual(ejecutor.leido["observatori"]["cataluna"], "nuevo cataluna")
                self.assertEqual(ejecutor.leido["censo"]["cataluna"], "nuevo cataluna")
                self.assertEqual(resultado.resultados["paquete"].veredicto, "verde")
                self.assertEqual(registro.leer_registro(raiz)["conjuntos"], {})

    def test_observatori_incompatible_con_cataluna_nueva_no_exporta(self) -> None:
        """Si la versión conservada tampoco valida, el motor no exporta ni sustituye el paquete."""
        with tempfile.TemporaryDirectory() as temporal:
            raiz = Path(temporal) / "producto"
            preparar(raiz)
            antes = publicado(raiz)
            dejar_pendiente(raiz, "cataluna")
            ejecutor = EjecutorDeModulos({"observatori": "codigo"})
            with contextlib.redirect_stdout(io.StringIO()):
                resultado = actualizar.actualizar_con_resultado(
                    raiz, actualizar.Opciones(programada=True, pausa=0, reintento=0), ejecutor
                )
            self.assertEqual(resultado.codigo, actualizar.CODIGO_ROJO)
            self.assertEqual(resultado.resultados["observatori"].veredicto, "rojo")
            self.assertFalse(
                any("plataforma_datos.orquestacion.exportar_paquete" in orden for orden in ejecutor.ordenes)
            )
            despues = publicado(raiz)
            self.assertEqual(despues["paquete"], antes["paquete"])
            self.assertEqual(despues["observatori"], antes["observatori"])
            self.assertEqual(registro.leer_registro(raiz)["conjuntos"], {})


if __name__ == "__main__":
    unittest.main()
