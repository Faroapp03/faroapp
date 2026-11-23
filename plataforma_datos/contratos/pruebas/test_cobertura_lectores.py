"""Guardia de inventario: ningún lector presente queda sin descriptor."""

import tempfile
import unittest
from pathlib import Path
from unittest import mock

from plataforma_datos.contratos import fuentes


class PruebaCoberturaLectores(unittest.TestCase):
    """Una casa con lector real no puede desaparecer por ausencia de su declaración."""

    def test_lector_sin_descriptor_no_se_omite_ni_ejecuta(self) -> None:
        """El inventario rechaza el hueco, aunque haya otras fichas correctas."""
        with tempfile.TemporaryDirectory() as temporal:
            carpeta = Path(temporal)
            valida = carpeta / "formacion"
            valida.mkdir()
            original = Path(fuentes.__file__).parents[1] / "cursos/fuentes/formacion/fuente.json"
            (valida / "fuente.json").write_bytes(original.read_bytes())
            casa = carpeta / "otra"
            casa.mkdir()
            (casa / "lector.py").write_text("raise AssertionError('no ejecutar lector')\n", encoding="utf-8")
            for ids in (None, ("formacion",)):
                with (
                    self.subTest(ids=ids),
                    mock.patch.object(fuentes, "carpeta_de_fuentes", return_value=carpeta),
                    self.assertRaisesRegex(fuentes.ErrorDescriptor, "lector sin descriptor.*otra"),
                ):
                    fuentes.cargar_descriptores(ids)

    def test_lector_enlazado_fuera_del_paquete_falla_antes_de_leer(self) -> None:
        """Ni la cobertura del inventario sigue implementaciones enlazadas fuera del tema."""
        with tempfile.TemporaryDirectory() as temporal:
            carpeta = Path(temporal) / "fuentes"
            casa = carpeta / "otra"
            casa.mkdir(parents=True)
            ajeno = Path(temporal) / "no-leer.py"
            ajeno.write_text("raise AssertionError('no ejecutar')", encoding="utf-8")
            (casa / "lector.py").symlink_to(ajeno)
            with (
                mock.patch.object(fuentes, "carpeta_de_fuentes", return_value=carpeta),
                mock.patch.object(Path, "read_text", side_effect=AssertionError("no leer")),
                self.assertRaisesRegex(fuentes.ErrorDescriptor, "lector fuera del paquete"),
            ):
                fuentes.cargar_descriptores()
