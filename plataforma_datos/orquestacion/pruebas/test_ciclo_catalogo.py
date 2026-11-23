"""Regresiones de la frontera original/admitido de Cursos en el ejecutor común."""

import shutil
import tempfile
import unittest
from pathlib import Path

from plataforma_datos.orquestacion import actualizar, modulos
from plataforma_datos.orquestacion.piezas_de_la_actualizacion import CARPETA_DE_INFORMES


class CicloCatalogoPruebas(unittest.TestCase):
    """Solo árboles mínimos y ejecutores sintéticos; sin consultas de proveedores."""

    def test_fallo_descarga_conserva_intento_pero_no_pisa_version_buena(self) -> None:
        """Los recibos pertenecen a historia; la admisión anterior sigue siendo la autoridad."""
        with tempfile.TemporaryDirectory() as temporal:
            raiz, area = Path(temporal) / "raíz", Path(temporal) / "candidata"
            modulo = next(m for m in modulos.MODULOS if m.id == "hp_life")
            rutas = modulos.carpetas(modulo)
            for ruta in rutas:
                (raiz / ruta).mkdir(parents=True)
                (raiz / ruta / "anterior.json").write_bytes(b"anterior")
            (raiz / CARPETA_DE_INFORMES).mkdir(parents=True)
            shutil.copytree(raiz, area)

            def ejecutar(orden: list[str], candidata: Path) -> actualizar.Resultado:
                self.assertEqual(orden[-1], "--aceptar-cambio")
                (candidata / rutas[0] / "intento.json").write_bytes(b"fallo HTTP sin baja")
                return actualizar.Resultado(1, "error técnico sintético")

            pasos, resultado = actualizar.ejecutar_modulo(
                raiz, area, modulo, ejecutar, actualizar.Opciones(reintento=0, pausa=0)
            )
            self.assertEqual(resultado.veredicto, actualizar.AMBAR)
            self.assertTrue(pasos)
            self.assertEqual((raiz / rutas[0] / "intento.json").read_bytes(), b"fallo HTTP sin baja")
            for ruta in rutas[1:]:
                self.assertEqual({p.name for p in (raiz / ruta).iterdir()}, {"anterior.json"})
                self.assertEqual((raiz / ruta / "anterior.json").read_bytes(), b"anterior")
            self.assertEqual(actualizar.huella(raiz, rutas), actualizar.huella(area, rutas))
            self.assertFalse(list(raiz.rglob("*.anterior")))
