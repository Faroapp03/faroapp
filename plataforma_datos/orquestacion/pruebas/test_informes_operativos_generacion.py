"""La transferencia conserva los informes que consumen el estado y el resumen de la última ejecución."""

import json
import tempfile
import unittest
from pathlib import Path

from plataforma_datos.comun.entrada_salida import guardar_json
from plataforma_datos.orquestacion import generacion_operativa as generacion
from plataforma_datos.orquestacion.estado_de_los_datos import ultima_actualizacion
from plataforma_datos.orquestacion.pruebas.test_generacion_operativa import REVISION, preparar


class InformesOperativosGeneracionPruebas(unittest.TestCase):
    """Ejercita el lector real tras restaurar, sin incorporar toda la historia ni registrar intentos."""

    def setUp(self) -> None:
        """Tres ejecuciones sintéticas: estado en la primera, resumen en la última, otra sin consumidor."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.area = Path(temporal.name)
        self.raiz = self.area / "Origen"
        preparar(self.raiz)
        self.carpeta = self.raiz / "var/actualizacion/ejecuciones"
        for dia in (1, 2, 3):
            nombre = f"2026-10-{dia:02d}-000000"
            guardar_json(
                self.carpeta / (nombre + ".json"), {"utc": f"2026-10-{dia:02d}T00:00:00Z", "veredicto": "verde"}
            )
            (self.carpeta / (nombre + ".md")).write_text(f"Informe sintético {dia}\n", encoding="utf-8")
        self.estado = json.loads((self.raiz / generacion.ESTADO).read_bytes())
        self.estado["actualizacion"]["informe"] = "var/actualizacion/ejecuciones/2026-10-01-000000.md"
        guardar_json(self.raiz / generacion.ESTADO, self.estado)

    def test_resumen_real_y_referencia_del_estado_sobreviven_sin_toda_la_historia(self) -> None:
        """La última ejecución y la pareja distinta del estado mantienen contenido y fechas exactos."""
        esperado = ultima_actualizacion(self.raiz)
        bundle, destino = self.area / "generación", self.area / "Destino"
        recibo = generacion.exportar_generacion(self.raiz, bundle, REVISION)
        generacion.restaurar_generacion(bundle, destino, REVISION, recibo["sha256Manifiesto"])
        self.assertEqual(ultima_actualizacion(destino), esperado)
        for dia in (1, 3):
            for extension in ("json", "md"):
                relativa = f"var/actualizacion/ejecuciones/2026-10-{dia:02d}-000000.{extension}"
                self.assertEqual((destino / relativa).read_bytes(), (self.raiz / relativa).read_bytes())
        self.assertFalse((destino / "var/actualizacion/ejecuciones/2026-10-02-000000.json").exists())

    def test_referencia_incompleta_se_rechaza(self) -> None:
        """Ni el JSON sin MD ni la referencia del estado sin su pareja se presentan como completos."""
        for nombre in ("2026-10-03-000000.md", "2026-10-01-000000.json", "2026-10-01-000000.md"):
            with self.subTest(nombre=nombre):
                ruta = self.carpeta / nombre
                contenido = ruta.read_bytes()
                ruta.unlink()
                destino = self.area / ("incompleta-" + nombre)
                try:
                    with self.assertRaises((OSError, ValueError)):
                        generacion.exportar_generacion(self.raiz, destino, REVISION)
                    self.assertFalse(destino.exists())
                finally:
                    ruta.write_bytes(contenido)

    def test_referencia_ajena_o_no_fechada_no_concede_lectura(self) -> None:
        """El estado no puede elegir otra casa, escapar ni trasladar archivos arbitrarios de ejecuciones."""
        for relativa in (
            "var/actualizacion/ejecuciones/../registro/cuenta.md",
            "var/actualizacion/originales/2026-10-01-000000.md",
            "var/actualizacion/ejecuciones/privado.md",
        ):
            with self.subTest(relativa=relativa):
                self.estado["actualizacion"]["informe"] = relativa
                guardar_json(self.raiz / generacion.ESTADO, self.estado)
                with self.assertRaises(ValueError):
                    generacion.exportar_generacion(self.raiz, self.area / ("ajeno-" + Path(relativa).stem), REVISION)

    def test_informe_json_ininterpretable_no_oculta_el_fallo(self) -> None:
        """El resumen debe poder leer la pareja seleccionada; presencia de bytes no equivale a validez."""
        guardar_json(self.carpeta / "2026-10-03-000000.json", {"utc": 7, "veredicto": False})
        with self.assertRaises(ValueError):
            generacion.exportar_generacion(self.raiz, self.area / "informe inválido", REVISION)


if __name__ == "__main__":
    unittest.main()
