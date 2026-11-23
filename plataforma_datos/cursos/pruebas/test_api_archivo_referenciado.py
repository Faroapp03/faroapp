"""Contrato compartido de referencias de archivo de admisión y almacenamiento."""

import hashlib
import tempfile
import unittest
from pathlib import Path

from plataforma_datos.cursos import admision_catalogo as admision


class ArchivoReferenciado(unittest.TestCase):
    """Comprobación pública de un archivo referenciado por ruta y huella."""

    def test_huella_y_limite_sobre_bytes_y_rechazo_de_alteracion(self) -> None:
        """Devuelve huella y tamaño exactos y rechaza el límite superado o un archivo alterado."""
        with tempfile.TemporaryDirectory() as temporal:
            archivo = Path(temporal) / "evidencia"
            datos = "Año 2026\n".encode()
            archivo.write_bytes(datos)
            referencia = admision.ReferenciaArchivo(ruta=archivo, sha256=hashlib.sha256(datos).hexdigest())
            self.assertEqual(
                admision.comprobar_archivo_referenciado(referencia, len(datos)),
                {"sha256": referencia.sha256, "bytes": len(datos)},
            )
            with self.assertRaises(admision.ErrorAdmisionCatalogo):
                admision.comprobar_archivo_referenciado(referencia, len(datos) - 1)
            archivo.write_bytes(b"distinto")
            with self.assertRaises(admision.ErrorAdmisionCatalogo):
                admision.comprobar_archivo_referenciado(referencia, 100)

    def test_rechaza_enlace_simbolico(self) -> None:
        """Un enlace simbólico no se admite como archivo referenciado."""
        with tempfile.TemporaryDirectory() as temporal:
            archivo = Path(temporal) / "original"
            archivo.write_bytes(b"dato")
            enlace = Path(temporal) / "enlace"
            enlace.symlink_to(archivo)
            referencia = admision.ReferenciaArchivo(ruta=enlace, sha256=hashlib.sha256(b"dato").hexdigest())
            with self.assertRaises(admision.ErrorAdmisionCatalogo):
                admision.comprobar_archivo_referenciado(referencia, 100)
