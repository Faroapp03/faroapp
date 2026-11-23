"""Fechas independientes de capturas de Digitalízate al construir lotes."""

import tempfile
import unittest
from pathlib import Path

from plataforma_datos.cursos.fuentes.fundae.digitalizate import construir_lotes
from plataforma_datos.cursos.pruebas.test_adaptador_digitalizate import captura_fechada


class FechasDigitalizatePruebas(unittest.TestCase):
    """Los detalles conservan la fecha de su propia captura, no la de los índices."""

    def test_capturas_heterogeneas_conservan_fechas_y_proveedores(self) -> None:
        """Cada lote conserva la fecha de su captura y los proveedores del contrato."""
        with tempfile.TemporaryDirectory(prefix="fechas Digitalízate ñ ") as directorio:
            raiz = captura_fechada(
                Path(directorio) / "captura",
                {},
                {7: "2026-10-21", 8: "2026-10-23"},
                "2026-10-24",
            )
            lotes = construir_lotes(raiz)
            self.assertGreater(len(lotes), 1, "Debe haber lote de índices y lotes de detalle")
            self.assertEqual(lotes[0]["observado_utc"], "2026-10-24T00:00:01+00:00")
            fechas = set()
            for lote in lotes[1:]:
                self.assertEqual(lote["proveedores"], [])
                self.assertTrue(lote["programas"], "Cada detalle debe contener programas")
                for programa in lote["programas"]:
                    fecha = programa["evidencias"][0]["capturado_utc"]
                    self.assertEqual(lote["observado_utc"], fecha)
                    fechas.add(fecha)
            self.assertEqual(fechas, {"2026-10-21T00:00:01+00:00", "2026-10-23T00:00:01+00:00"})


if __name__ == "__main__":
    unittest.main()
