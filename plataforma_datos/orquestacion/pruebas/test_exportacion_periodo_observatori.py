"""La exportación directa tampoco publica cortes distintos de contratación y Observatori."""

import tempfile
import unittest
from contextlib import ExitStack
from pathlib import Path
from unittest import mock

from plataforma_datos.comun.nucleo import ValidacionFallida
from plataforma_datos.orquestacion import exportar_paquete
from plataforma_datos.orquestacion.exportacion.comun import Paquete


class PruebaPeriodoObservatori(unittest.TestCase):
    """Los conjuntos admitidos por separado deben compartir el corte antes de escribir el paquete."""

    def exportar(self, destino: Path, periodo_cataluna: object, periodo_observatori: object) -> None:
        """Ejercita la composición y exportación real con entradas pequeñas, sin datos operativos."""

        def validado(fuente: str) -> Paquete:
            datos = (
                {"periodo_contratacion": periodo_cataluna}
                if fuente == "cataluna"
                else {"periodo": periodo_observatori}
                if fuente == "observatori"
                else {}
            )
            return Paquete(datos, [])

        with ExitStack() as parches:
            parches.enter_context(mock.patch.object(exportar_paquete, "paquete_validado", side_effect=validado))
            for nombre in (
                "paquete_cambra",
                "paquete_esco",
                "paquete_textos",
                "paquete_formacion",
                "paquete_correspondencia_eures",
                "paquete_acreditacion",
                "paquete_derechos",
                "paquete_tich",
                "paquete_mercado",
                "paquete_empresas",
                "paquete_sectores",
                "paquete_metodos",
            ):
                parches.enter_context(mock.patch.object(exportar_paquete, nombre, return_value=Paquete({}, [])))
            parches.enter_context(mock.patch.object(exportar_paquete, "paquete_catalan", return_value=None))
            parches.enter_context(
                mock.patch.object(exportar_paquete, "entrada_escrita_por_herramienta", return_value=None)
            )
            parches.enter_context(
                mock.patch.object(
                    exportar_paquete, "exportar_lecturas", side_effect=lambda ruta: ruta.write_bytes(b"{}")
                )
            )
            parches.enter_context(
                mock.patch.object(
                    exportar_paquete,
                    "exportar_observaciones_lecturas",
                    side_effect=lambda ruta: ruta.write_bytes(b"{}"),
                )
            )
            exportar_paquete.exportar(destino)

    def test_cortes_distintos_no_tocan_el_destino(self) -> None:
        """Una Cataluña nueva y el Observatori conservado se rechazan antes de crear temporales o sustituir datos."""
        with tempfile.TemporaryDirectory() as temporal:
            destino = Path(temporal) / "datos Año 2026"
            destino.mkdir()
            for nombre in ("cataluna.json", "observatori.json", "manifiesto.json"):
                (destino / nombre).write_bytes(b"version servida")
            with self.assertRaisesRegex(ValidacionFallida, "Cataluña.*Observatori.*periodo"):
                self.exportar(destino, "12 meses a septiembre de 2026", "12 meses a junio de 2026")
            self.assertEqual(
                {ruta.name: ruta.read_bytes() for ruta in destino.iterdir()},
                dict.fromkeys(("cataluna.json", "observatori.json", "manifiesto.json"), b"version servida"),
            )
            self.assertEqual(list(Path(temporal).iterdir()), [destino])

    def test_periodos_no_textuales_o_vacios_no_acreditan_coherencia(self) -> None:
        """La igualdad de dos referencias ausentes o inválidas tampoco permite publicar."""
        with tempfile.TemporaryDirectory() as temporal:
            destino = Path(temporal) / "datos"
            for invalido in (None, "", "   ", 202606, []):
                with self.subTest(periodo=invalido), self.assertRaises(ValidacionFallida):
                    self.exportar(destino, invalido, invalido)
                self.assertFalse(destino.exists())

    def test_mismo_corte_conserva_su_serializacion(self) -> None:
        """Un corte coherente conserva el JSON sangrado de Cataluña y el compacto de Observatori."""
        with tempfile.TemporaryDirectory() as temporal:
            destino = Path(temporal) / "datos"
            self.exportar(destino, "12 meses a junio de 2026", "12 meses a junio de 2026")
            self.assertEqual(
                (destino / "cataluna.json").read_bytes(),
                b'{\n  "periodo_contratacion": "12 meses a junio de 2026"\n}\n',
            )
            self.assertEqual((destino / "observatori.json").read_bytes(), b'{"periodo":"12 meses a junio de 2026"}')


if __name__ == "__main__":
    unittest.main()
