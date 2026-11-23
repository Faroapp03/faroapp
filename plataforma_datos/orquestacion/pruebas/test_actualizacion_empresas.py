"""Una nueva edición compatible llega a sus consumidores solo tras admitir y comprobar la fuente."""

import contextlib
import io
import tempfile
import unittest
from pathlib import Path

from plataforma_datos.orquestacion import actualizar
from plataforma_datos.orquestacion import comprobaciones_remotas as registro
from plataforma_datos.orquestacion.ejecucion_observada import etapa_de_fuente
from plataforma_datos.orquestacion.pruebas import test_cobertura_empresas, test_seguimiento_catalogos
from plataforma_datos.orquestacion.pruebas.test_actualizacion_por_modulos import EjecutorDeModulos
from plataforma_datos.orquestacion.pruebas.test_actualizacion_visor import dejar_pendiente
from plataforma_datos.orquestacion.pruebas.test_candidato import preparar


class PruebaActualizacionEmpresas(unittest.TestCase):
    """Ejecuta coordinación, seguimiento y cobertura; sustituye las órdenes de fuente, sin red."""

    def test_registro_exige_descubrimiento_completo_y_admision(self) -> None:
        """No basta con consultar las tablas: deben admitirse y estar vinculadas al descubrimiento."""
        control = test_seguimiento_catalogos.PruebaSeguimientoCatalogos()
        for variante in ("completo", "rechazado", "parcial", "local", "etapa-fallida"):
            with self.subTest(variante=variante):
                copia = test_cobertura_empresas.PruebaCoberturaEmpresas()
                copia.setUp()
                try:
                    control.comprobar("empresas", variante, copia.raiz, copia.evidencia)
                finally:
                    copia.doCleanups()

    def test_actualizar_edicion_recompone_contrastes_y_datos_globales(self) -> None:
        """Un cambio admitido llega al contraste Eurostat, ILOSTAT y exportador sin nuevas descargas ajenas."""
        with tempfile.TemporaryDirectory() as temporal:
            raiz = Path(temporal) / "Mis documentos" / "Año 2026"
            preparar(raiz)
            dejar_pendiente(raiz, "empresas")
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
            self.assertEqual(etapa_de_fuente(descargas[0]), ("empresas", "descargar"))
            self.assertIn("--aceptar-cambio", descargas[0])
            self.assertEqual(ejecutor.leido["mundo_eurostat"]["empresas"], "nuevo empresas")
            self.assertEqual(ejecutor.leido["datos_globales"]["empresas"], "nuevo empresas")
            self.assertEqual(ejecutor.leido["ilostat"]["mundo_eurostat"], "nuevo mundo_eurostat")
            self.assertEqual(resultado.resultados["paquete"].veredicto, "verde")
            self.assertEqual(registro.leer_registro(raiz)["conjuntos"], {})


if __name__ == "__main__":
    unittest.main()
