"""Pruebas de la captura de ESCO (esco.py): el ZIP de la captura es reproducible y cambia si cambia una página."""

import contextlib
import io
import os
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import plataforma_datos.ocupaciones.fuentes.esco.lector as esco
import plataforma_datos.ocupaciones.fuentes.esco.piezas.constantes_esco as constantes_esco
from plataforma_datos.comun import entrada_salida


class PruebaCapturaEsco(unittest.TestCase):
    """El ZIP de la captura de ESCO es reproducible."""

    def test_zip_reproducible(self) -> None:
        """Las mismas páginas, escritas en otro momento y en otro orden, dan el mismo ZIP byte a byte."""
        paginas = {"skill-001.json": b'{"b": 2}', "occupation-000.json": b'{"a": 1}'}
        huellas = []
        with tempfile.TemporaryDirectory() as temporal:
            for vuelta, orden_de_escritura in enumerate((list(paginas), list(reversed(paginas)))):
                carpeta = Path(temporal) / str(vuelta)
                carpeta.mkdir()
                for nombre in orden_de_escritura:
                    (carpeta / nombre).write_bytes(paginas[nombre])
                    os.utime(carpeta / nombre, (1e9 * (vuelta + 1), 1e9 * (vuelta + 1)))
                captura = esco.empaquetar(carpeta, orden_de_escritura, carpeta / "captura.zip")
                huellas.append(entrada_salida.sha256(captura))
            self.assertEqual(huellas[0], huellas[1])

    def test_zip_distinto_si_cambia_una_pagina(self) -> None:
        """Una página distinta cambia la huella del ZIP."""
        with tempfile.TemporaryDirectory() as temporal:
            carpeta = Path(temporal)
            (carpeta / "occupation-000.json").write_bytes(b"{}")
            antes = entrada_salida.sha256(esco.empaquetar(carpeta, ["occupation-000.json"], carpeta / "a.zip"))
            (carpeta / "occupation-000.json").write_bytes(b"[]")
            despues = entrada_salida.sha256(esco.empaquetar(carpeta, ["occupation-000.json"], carpeta / "b.zip"))
        self.assertNotEqual(antes, despues)


class PruebaTiposRelacion(unittest.TestCase):
    """Las relaciones de ambos sentidos y el esquema SQL comparten sus tipos admitidos."""

    def test_el_esquema_admite_los_tipos_de_ambos_sentidos_y_rechaza_otros(self) -> None:
        """SQLite acepta todos los tipos declarados y rechaza un tipo ajeno al contrato."""
        directos = {tipo for _, tipo in constantes_esco.RELACIONES_OCUPACION}
        inversos = {tipo for _, tipo in constantes_esco.RELACIONES_COMPETENCIA}
        self.assertEqual(directos, inversos)
        with contextlib.closing(sqlite3.connect(":memory:")) as base:
            base.executescript(constantes_esco.ESQUEMA)
            base.execute("INSERT INTO ocupaciones VALUES ('o', 'O', '1', '', '[]', '{}')")
            base.execute("INSERT INTO competencias VALUES ('c', 'C', 'skill', '', '[]', '{}')")
            for tipo in directos:
                base.execute("INSERT INTO relaciones VALUES ('o', 'c', ?, '{}')", (tipo,))
            with self.assertRaises(sqlite3.IntegrityError):
                base.execute("INSERT INTO relaciones VALUES ('o', 'c', 'desconocida', '{}')")


class PruebaInformeMedido(unittest.TestCase):
    """El informe dice la integridad de SQLite que se midió, no un «ok» fijo."""

    def _integridad(self, integra: bool) -> str:
        """Ejecuta los controles con una base en memoria cuya integridad se fija, sin comprobar las consultas.

        Args:
            integra: Lo que devuelve la comprobación de integridad de la base.

        Returns:
            El resultado de la integridad que pasa al informe.
        """
        registros = esco.Registros({}, {}, {})
        with (
            contextlib.closing(sqlite3.connect(":memory:")) as base,
            mock.patch.object(esco, "conexion", return_value=contextlib.nullcontext(base)),
            mock.patch.object(esco, "_integra", return_value=integra),
            mock.patch.object(esco, "_comprobar_preparados"),
            mock.patch.object(esco, "_comprobar_consultas"),
        ):
            controles, motivos, integridad = esco._controles(registros)
        self.assertEqual(controles.admitido, integra)
        self.assertEqual(motivos, [] if integra else ["integridad SQLite"])
        return integridad

    def test_integridad_medida(self) -> None:
        """Con la base íntegra, «ok»; sin ella, el motivo, y el control de preparados falla."""
        self.assertEqual(self._integridad(True), esco.INTEGRIDAD_CORRECTA)
        self.assertEqual(self._integridad(False), "integridad SQLite")


class PruebaEscrituraDeLaBase(unittest.TestCase):
    """Un fallo al guardar la base preparada conserva el archivo anterior completo."""

    def setUp(self) -> None:
        """Prepara rutas aisladas y una construcción mínima, sin originales ni base reales."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        raiz = Path(temporal.name)
        self.base = raiz / "validados" / "biblioteca-esco.sqlite"
        self.base.parent.mkdir()
        self.previa = b"biblioteca ESCO anterior"
        self.base.write_bytes(self.previa)
        registros = esco.Registros({}, {"ocupaciones": [{"nombre": "año"}]}, {"ocupaciones": 1})
        self.enterContext(mock.patch.object(esco, "BASE", self.base))
        self.enterContext(
            mock.patch.object(esco, "PREPARADOS", {"ocupaciones": raiz / "preparados" / "ocupaciones.jsonl"})
        )
        self.enterContext(mock.patch.object(esco, "registros_origen", return_value=registros))

        def construir(ruta: Path, _meta: object, _datos: object) -> None:
            """Escribe los bytes que la preparación debe copiar como base nueva."""
            ruta.write_bytes(b"biblioteca ESCO nueva")

        self.enterContext(mock.patch.object(esco, "construir_base", side_effect=construir))

    def test_fallo_de_escritura_conserva_la_base_anterior(self) -> None:
        """Un error después de escribir parte de los bytes no trunca la base anterior ni deja restos."""
        escribir = Path.write_bytes

        def escribir_a_medias(ruta: Path, datos: bytes) -> int:
            """Simula un error de disco al copiar la base a su carpeta de destino.

            Returns:
                Los bytes escritos, salvo el fallo simulado.

            Raises:
                OSError: Tras escribir parte del archivo en la carpeta de validados.
            """
            if ruta.parent == self.base.parent:
                escribir(ruta, datos[:1])
                raise OSError("disco interrumpido")
            return escribir(ruta, datos)

        with (
            mock.patch.object(Path, "write_bytes", new=escribir_a_medias),
            contextlib.redirect_stdout(io.StringIO()),
            self.assertRaisesRegex(OSError, "disco interrumpido"),
        ):
            esco.preparar()
        self.assertEqual(self.base.read_bytes(), self.previa)
        self.assertEqual(list(self.base.parent.iterdir()), [self.base])

    def test_fallo_de_sustitucion_conserva_la_base_anterior(self) -> None:
        """Un error en la sustitución final conserva la base anterior y limpia el archivo parcial."""
        sustituir = Path.replace

        def sustitucion_interrumpida(ruta: Path, destino: Path) -> Path:
            """Simula el fallo al sustituir la base.

            Returns:
                El destino sustituido, salvo la base cuyo fallo se simula.

            Raises:
                OSError: Al sustituir la base de validados.
            """
            if destino == self.base:
                raise OSError("sustitución interrumpida")
            return sustituir(ruta, destino)

        with (
            mock.patch.object(Path, "replace", new=sustitucion_interrumpida),
            contextlib.redirect_stdout(io.StringIO()),
            self.assertRaisesRegex(OSError, "sustitución interrumpida"),
        ):
            esco.preparar()
        self.assertEqual(self.base.read_bytes(), self.previa)
        self.assertEqual(list(self.base.parent.iterdir()), [self.base])


if __name__ == "__main__":
    unittest.main()
