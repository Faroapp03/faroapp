"""La fase del paquete se mide sola: solo sus órdenes, en un área de ensayo, sin tocar lo publicado."""

import contextlib
import hashlib
import io
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from plataforma_datos.orquestacion import medir_paquete
from plataforma_datos.orquestacion.ordenes_de_la_actualizacion import ORDENES_DEL_PAQUETE
from plataforma_datos.orquestacion.pruebas.test_candidato import EjecutorCandidato, preparar


def arbol(raiz: Path) -> dict[str, str]:
    """La huella de cada archivo de la instalación.

    Returns:
        Ruta relativa y huella.
    """
    return {
        ruta.relative_to(raiz).as_posix(): hashlib.sha256(ruta.read_bytes()).hexdigest()
        for ruta in sorted(raiz.rglob("*"))
        if ruta.is_file()
    }


class MedirPaquetePruebas(unittest.TestCase):
    """Sobre una instalación como la del candidato, con un ejecutor que no sale del área."""

    def setUp(self) -> None:
        """Una instalación propia y una carpeta temporal vigilada."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.carpeta = Path(temporal.name).resolve()
        self.raiz = self.carpeta / "instalacion"
        preparar(self.raiz)
        parche = mock.patch.dict(os.environ, {"FARO_AVISO": ""})
        parche.start()
        self.addCleanup(parche.stop)

    def test_solo_ejecuta_las_ordenes_del_paquete_y_no_cambia_lo_publicado(self) -> None:
        """Ninguna orden de las fuentes, ninguna descarga, lo publicado intacto y el área borrada."""
        antes = arbol(self.raiz)
        ejecutor = EjecutorCandidato()
        with mock.patch.object(medir_paquete.tempfile, "mkdtemp", return_value=str(self.carpeta / "area")):
            (self.carpeta / "area").mkdir()
            with contextlib.redirect_stdout(io.StringIO()):
                pasos, resultado = medir_paquete.medir(self.raiz, ejecutor)
        self.assertEqual([list(orden) for orden in ejecutor.ordenes], [list(o.orden) for o in ORDENES_DEL_PAQUETE])
        self.assertEqual([paso.nombre for paso in pasos], [o.nombre for o in ORDENES_DEL_PAQUETE])
        self.assertEqual(resultado.veredicto, "verde")
        self.assertEqual(arbol(self.raiz), antes)
        self.assertFalse((self.carpeta / "area").exists())


if __name__ == "__main__":
    unittest.main()
