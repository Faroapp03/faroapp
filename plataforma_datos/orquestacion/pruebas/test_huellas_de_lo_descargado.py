"""La huella de lo descargado viaja en el diario archivado, nunca en la generación, y nunca detiene nada."""

import json
import tempfile
import unittest
from datetime import UTC, datetime
from pathlib import Path

from plataforma_datos.orquestacion import actualizar, comprobaciones_remotas, huellas_de_lo_descargado
from plataforma_datos.orquestacion import diario_mantenimiento as diario
from plataforma_datos.orquestacion.ejecucion_observada import CARPETA_DE_INTENTOS
from plataforma_datos.orquestacion.piezas_de_la_actualizacion import CARPETA_DE_INFORMES
from plataforma_datos.orquestacion.pruebas import test_generacion_operativa as casos_generacion
from plataforma_datos.orquestacion.pruebas.test_comparar_ciclos import Descargas
from plataforma_datos.orquestacion.seguimiento_de_comprobaciones import Seguimiento

generacion = casos_generacion.generacion


class PruebaHuellaEnElDiario(unittest.TestCase):
    """El evento `etapa-fuente` de una descarga lleva la huella de lo recibido, si su recibo se entiende."""

    def setUp(self) -> None:
        """Una raíz candidata con la descarga de citilab ya hecha por el seguimiento real."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.raiz = Path(temporal.name) / "candidato"
        self.raiz.mkdir()
        self.diario = Path(temporal.name) / "diario.jsonl"
        comprobaciones_remotas.migrar_registro(self.raiz)
        ciclo = comprobaciones_remotas.iniciar_ciclo(self.raiz, datetime.now(UTC), "manual")
        seguimiento = Seguimiento(self.raiz, ciclo, Descargas({"citilab": "fichas"}), lambda: datetime.now(UTC))
        seguimiento.ejecutar(actualizar.ordenes_de_la_fuente("citilab")[0].orden, self.raiz)
        (self.intento,) = (self.raiz / CARPETA_DE_INFORMES / CARPETA_DE_INTENTOS).glob("*/intento.json")

    def evento_de_la_descarga(self) -> dict:
        """Copia los intentos al diario, como hace el supervisor tras el motor.

        Returns:
            El evento de la descarga de citilab.
        """
        with diario.abrir(self.diario, {"run": "1"}, consola=False):
            diario.registrar_intentos(self.raiz)
        eventos = [json.loads(linea) for linea in self.diario.read_text(encoding="utf-8").splitlines()]
        (evento,) = (e for e in eventos if e["fase"] == "etapa-fuente" and e["etapa"] == "descargar")
        return evento

    def test_el_evento_de_la_descarga_lleva_la_huella_de_lo_recibido(self) -> None:
        """La huella del evento es la del recibo que conserva el intento técnico."""
        recibo = json.loads(self.intento.read_bytes())["recibo"]
        esperada = huellas_de_lo_descargado.huella_de_la_recepcion(recibo)
        self.assertEqual(self.evento_de_la_descarga()["recepcion"], esperada)

    def test_un_recibo_que_no_se_entiende_deja_el_evento_sin_huella(self) -> None:
        """Es telemetría: el diario se escribe igual, sin huella."""
        dato = json.loads(self.intento.read_bytes())
        self.intento.write_text(json.dumps({**dato, "recibo": {"peticiones": "no es una lista"}}), encoding="utf-8")
        self.assertIsNone(self.evento_de_la_descarga()["recepcion"])


class PruebaGeneracionSinHuella(unittest.TestCase):
    """La generación conserva su versión 3 y su inventario: el código anterior la sigue leyendo."""

    def test_la_generacion_conserva_su_version_y_no_lleva_huellas(self) -> None:
        """El manifiesto es de la versión 3 y no hay archivo de huellas entre los suyos."""
        caso = casos_generacion.PruebaGeneracionOperativa(methodName="runTest")
        self.addCleanup(caso.doCleanups)
        caso.setUp()
        resumen = caso.exportar()
        manifiesto = generacion.verificar_generacion(
            caso.bundle, casos_generacion.REVISION, resumen["sha256Manifiesto"]
        )
        self.assertEqual(manifiesto["version"], generacion.VERSION_INVENTARIO)
        self.assertFalse(any("huellas" in archivo["ruta"] for archivo in manifiesto["archivos"]))
        self.assertFalse(hasattr(generacion, "VERSION_HUELLAS"))


if __name__ == "__main__":
    unittest.main()
