"""La generación del ensayo: se exporta como en el supervisor, a una carpeta local, y su fallo se nombra igual."""

import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from plataforma_datos.orquestacion import almacen_generaciones, generacion_del_ensayo
from plataforma_datos.orquestacion.pruebas.test_generacion_operativa import REVISION, preparar


class GeneracionDelEnsayoPruebas(unittest.TestCase):
    """Una instalación pequeña y válida, y la misma con un archivo del paquete que su manifiesto ya no cita."""

    def setUp(self) -> None:
        """Prepara una instalación mínima con todas las raíces del registro."""
        self.carpeta = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.carpeta)
        self.candidato = self.carpeta / "candidato"
        preparar(self.candidato)
        # Nunca se guarda en el almacén: si algo lo intentara, la prueba fallaría aquí.
        guardar = patch.object(almacen_generaciones, "guardar_generacion", side_effect=AssertionError("almacén"))
        self.guardar = guardar.start()
        self.addCleanup(guardar.stop)

    def exportar(self, resultado: str) -> dict:
        """Exporta la generación del candidato a una carpeta nueva de la prueba.

        Returns:
            El resultado de la exportación.
        """
        destino = self.carpeta / f"generacion-{len(list(self.carpeta.iterdir()))}"
        return generacion_del_ensayo.exportar_en_local(self.candidato, destino, REVISION, resultado)

    def test_una_instalacion_coherente_conserva_su_generacion(self) -> None:
        """Una instalación coherente conserva su generación, con la huella de su manifiesto, en local."""
        generacion = self.exportar("validado")
        self.assertEqual(generacion["estado"], generacion_del_ensayo.CONSERVADA)
        self.assertRegex(generacion["sha256Manifiesto"], "^[0-9a-f]{64}$")
        self.assertTrue(any((c / "manifiesto.json").exists() for c in self.carpeta.glob("generacion-*")))
        self.guardar.assert_not_called()

    def test_un_archivo_del_paquete_que_el_manifiesto_no_cita_no_se_conserva(self) -> None:
        """El fallo del ciclo real: un archivo antiguo del paquete que el manifiesto ya no cita.

        Se nombra como el supervisor (comprobación «datos», causa «paquete-incoherente») y, con el recibo
        rechazado, el supervisor deja la base como estaba; con el recibo validado, se detendría.
        """
        (self.candidato / "datos" / "cambra.json").write_text("{}")
        rechazado = self.exportar("rechazado")
        self.assertEqual(
            {c: rechazado[c] for c in ("estado", "comprobacion", "causa")},
            {"estado": "no-conservada", "comprobacion": "datos", "causa": "paquete-incoherente"},
        )
        self.assertEqual(rechazado["supervisor"], generacion_del_ensayo.SUPERVISOR_RECHAZA)
        self.assertEqual(self.exportar("validado")["supervisor"], generacion_del_ensayo.SUPERVISOR_SE_DETIENE)
        self.guardar.assert_not_called()

    def test_sin_pendientes_no_se_exporta(self) -> None:
        """Sin nada que actualizar, el supervisor conserva la base: no hay generación que exportar."""
        self.assertEqual(self.exportar("sin-pendientes")["estado"], generacion_del_ensayo.SIN_PENDIENTES)
        self.assertEqual(list(self.carpeta.glob("generacion-*")), [])


if __name__ == "__main__":
    unittest.main()
