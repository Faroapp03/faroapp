"""El capturador de derechos vincula los originales que conserva con su recibo remoto v2."""

import json
import os
import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest import mock

import plataforma_datos.derechos.fuentes.derechos.lector as derechos
from plataforma_datos.comun.nucleo import Descarga
from plataforma_datos.comun.observacion_remota import VARIABLE_RECEPCION, contexto_descarga, observar


class PruebaRecepcionDerechos(unittest.TestCase):
    """La captura propia debe emitir el vínculo que el descargador común ya registra."""

    def test_cada_original_queda_vinculado_a_su_respuesta(self) -> None:
        """Se conservan bytes y procedencia, y el recibo identifica los siete originales reales."""
        with tempfile.TemporaryDirectory() as temporal:
            raiz = Path(temporal)
            original = raiz / "derechos"
            recibo = raiz / "recepcion.json"
            configuracion = json.dumps({"ruta": str(recibo), "fuente": "derechos", "intento": "prueba"})

            def descargar(url: str, cabeceras: dict) -> Descarga:
                """Simula el transporte observado sin consultar la red.

                Returns:
                    Un cuerpo diferente para cada URL oficial.
                """
                datos = url.encode()
                observar(url, "GET", None, url, datos)
                return Descarga(datos, url, "application/octet-stream")

            with (
                mock.patch.dict(os.environ, {VARIABLE_RECEPCION: configuracion}),
                mock.patch.object(derechos, "ORIGINAL", original),
                mock.patch.object(derechos, "PROCEDENCIA", original / "procedencia.json"),
                mock.patch.object(derechos, "descargar_url", side_effect=descargar),
                mock.patch.object(derechos.time, "sleep"),
                contexto_descarga(),
            ):
                derechos.descargar(hoy=date(2026, 10, 17))
            evidencia = json.loads(recibo.read_text())
            self.assertEqual(len(evidencia["peticiones"]), len(derechos.ARTICULOS) + len(derechos.PAGINAS))
            for peticion in evidencia["peticiones"]:
                self.assertEqual(peticion["original_sha256"], peticion["respuesta_sha256"])
                self.assertEqual(peticion["original_bytes"], peticion["bytes"])


if __name__ == "__main__":
    unittest.main()
