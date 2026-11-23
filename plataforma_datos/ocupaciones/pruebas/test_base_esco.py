"""La construcción SQLite libera su conexión tanto al terminar como ante errores."""

import sqlite3
import unittest
from pathlib import Path
from unittest import mock

import plataforma_datos.ocupaciones.fuentes.esco.piezas.base_esco as base_esco


class PruebaCierreDeBase(unittest.TestCase):
    """Un fallo de preparación no deja abierta la base que su llamante debe retirar."""

    def setUp(self) -> None:
        """Conexión real retenida para comprobar su cierre sin depender del recolector."""
        self.base = sqlite3.connect(":memory:")
        self.addCleanup(self.base.close)
        parche = mock.patch.object(base_esco.sqlite3, "connect", return_value=self.base)
        parche.start()
        self.addCleanup(parche.stop)
        self.meta = {"fuente": "ESCO de prueba", "version_solicitada": "v1.2.1", "sha256": "0" * 64}
        self.datos = {"ocupaciones": [], "competencias": [], "relaciones": []}
        self.ruta = Path(":memory:")

    def comprobar_cerrada(self) -> None:
        """La conexión ya no acepta operaciones después de salir de construir_base."""
        with self.assertRaises(sqlite3.ProgrammingError):
            self.base.execute("SELECT 1")

    def test_fallo_al_crear_esquema_cierra_la_conexion(self) -> None:
        """Un error SQL inicial se propaga y cierra la conexión tomada."""
        with (
            mock.patch.object(base_esco, "ESQUEMA", "SQL inválido"),
            self.assertRaises(sqlite3.OperationalError),
        ):
            base_esco.construir_base(self.ruta, self.meta, self.datos)
        self.comprobar_cerrada()

    def test_fallo_al_insertar_cierra_la_conexion(self) -> None:
        """Un registro duplicado produce su error de integridad y libera el recurso."""
        ocupacion = {
            "uri": "o",
            "titulo_es": "O",
            "codigo_esco": "1",
            "descripcion_es": "",
            "nombres_alternativos_es": [],
        }
        self.datos["ocupaciones"] = [ocupacion, ocupacion]
        with self.assertRaises(sqlite3.IntegrityError):
            base_esco.construir_base(self.ruta, self.meta, self.datos)
        self.comprobar_cerrada()

    def test_fallo_al_comprobar_integridad_cierra_la_conexion(self) -> None:
        """Un error después del commit también se propaga con la conexión cerrada."""
        fallo = sqlite3.DatabaseError("fallo de integridad")
        with (
            mock.patch.object(base_esco, "base_integra", side_effect=fallo),
            self.assertRaises(sqlite3.DatabaseError) as capturado,
        ):
            base_esco.construir_base(self.ruta, self.meta, self.datos)
        self.assertIs(capturado.exception, fallo)
        self.comprobar_cerrada()

    def test_construccion_correcta_cierra_la_conexion(self) -> None:
        """La salida normal sigue cerrando la conexión tras guardar la base."""
        base_esco.construir_base(self.ruta, self.meta, self.datos)
        self.comprobar_cerrada()


if __name__ == "__main__":
    unittest.main()
