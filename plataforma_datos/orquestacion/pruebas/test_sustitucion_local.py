"""Diarios locales, primeros destinos y recuperación compatibles con la sustitución común."""

import json
import tempfile
import unittest
from pathlib import Path

from plataforma_datos.orquestacion import sustitucion
from plataforma_datos.orquestacion.pruebas.ayudas import Corte
from plataforma_datos.orquestacion.pruebas.test_sustitucion import corte_en


class PruebaDiarioLocal(unittest.TestCase):
    """El control explícito no inventa un árbol var y conoce destinos inicialmente ausentes."""

    def setUp(self) -> None:
        """Prepara una candidata fuera del destino aún ausente."""
        temporal = tempfile.TemporaryDirectory(prefix="Sustitución local Año ")
        self.addCleanup(temporal.cleanup)
        self.raiz = Path(temporal.name)
        self.area = self.raiz / "area"
        self.control = self.raiz / "control"
        self.control.mkdir()
        self.diario = self.control / "diario.json"
        (self.area / "originales").mkdir(parents=True)
        (self.area / "originales" / "datos.json").write_text("nuevos", encoding="utf-8")

    def test_cerrojo_explicito_no_crea_carpeta_de_informes(self) -> None:
        """Un control de fuente no cambia la ubicación por defecto de otros consumidores."""
        with sustitucion.cerrojo(self.raiz, carpeta=self.control):
            with (
                self.assertRaises(sustitucion.ActualizacionEnCurso),
                sustitucion.cerrojo(self.raiz, carpeta=self.control),
            ):
                pass
            with sustitucion.cerrojo(self.raiz):
                pass
        self.assertTrue((self.control / sustitucion.ARCHIVO_DEL_CERROJO).exists())
        self.assertTrue((self.raiz / sustitucion.CARPETA / sustitucion.ARCHIVO_DEL_CERROJO).exists())

    def test_primera_publicacion_con_diario_explicito(self) -> None:
        """Admite un destino ausente y limpia el diario sin crear informes de actualización."""
        sustitucion.sustituir(self.raiz, self.area, ("originales",), self.diario)
        self.assertEqual((self.raiz / "originales" / "datos.json").read_text(), "nuevos")
        self.assertFalse(self.diario.exists())
        self.assertFalse((self.raiz / sustitucion.CARPETA).exists())
        self.assertIsNone(sustitucion.recuperar(self.raiz, ("originales",), self.diario))

    def test_cortes_antes_y_despues_de_hecho_con_destino_ausente(self) -> None:
        """Antes de confirmar no queda destino; tras confirmar queda completo, incluso tras otro recuperar."""
        numero, completa = 0, False
        while not completa:
            numero += 1
            with tempfile.TemporaryDirectory(dir=self.raiz) as temporal:
                raiz = Path(temporal)
                diario = raiz / "diario.json"
                with self.subTest(corte=numero), corte_en(numero):
                    try:
                        sustitucion.sustituir(raiz, self.area, ("originales",), diario)
                        completa = True
                    except Corte:
                        pass
                hecho = completa or (diario.exists() and json.loads(diario.read_text())["fase"] == sustitucion.HECHO)
                sustitucion.recuperar(raiz, ("originales",), diario)
                sustitucion.recuperar(raiz, ("originales",), diario)
                self.assertEqual((raiz / "originales").exists(), hecho)
                self.assertFalse((raiz / "originales.nuevo").exists())
                self.assertFalse((raiz / "originales.anterior").exists())
                self.assertFalse(diario.exists())
                if hecho:
                    self.assertEqual((raiz / "originales" / "datos.json").read_text(), "nuevos")
        self.assertGreater(numero, 4)

    def test_ausentes_invalidos_no_amplian_el_alcance_del_diario(self) -> None:
        """Un diario no puede marcar ausente una ruta que el llamador no autorizó."""
        destino = self.raiz / "originales"
        destino.mkdir()
        (destino / "conservar").write_text("previo", encoding="utf-8")
        for ausentes in (["otra"], ["originales", "originales"], "originales", [True]):
            with self.subTest(ausentes=ausentes):
                self.diario.write_text(
                    json.dumps({"fase": "preparado", "sustituidos": ["originales"], "ausentes": ausentes})
                )
                with self.assertRaises(sustitucion.RecuperacionIncompleta):
                    sustitucion.recuperar(self.raiz, ("originales",), self.diario)
                self.assertTrue(self.diario.exists())
                self.assertEqual((destino / "conservar").read_text(), "previo")

    def test_diario_no_json_conserva_originales_y_se_declara_pendiente(self) -> None:
        """La recuperación inválida no permite continuar ni elimina su evidencia."""
        self.diario.write_text("diario truncado", encoding="utf-8")
        with self.assertRaises(sustitucion.RecuperacionIncompleta):
            sustitucion.recuperar(self.raiz, ("originales",), self.diario)
        self.assertEqual(self.diario.read_text(), "diario truncado")
        self.assertFalse((self.raiz / "originales").exists())

    def test_destinos_mixtos_previos_y_ausentes_recuperan_juntos(self) -> None:
        """Un corte antes o después de confirmar conserva coherencia entre un archivo previo y una carpeta nueva."""
        (self.area / "registro.json").write_text("registro nuevo", encoding="utf-8")
        numero, completa = 0, False
        while not completa:
            numero += 1
            with tempfile.TemporaryDirectory(dir=self.raiz) as temporal:
                raiz = Path(temporal)
                diario = raiz / "diario.json"
                (raiz / "registro.json").write_text("registro previo", encoding="utf-8")
                with self.subTest(corte=numero), corte_en(numero):
                    try:
                        sustitucion.sustituir(raiz, self.area, ("registro.json", "originales"), diario)
                        completa = True
                    except Corte:
                        pass
                hecho = completa or (diario.exists() and json.loads(diario.read_text())["fase"] == sustitucion.HECHO)
                sustitucion.recuperar(raiz, ("registro.json", "originales"), diario)
                self.assertEqual((raiz / "originales").exists(), hecho)
                esperado = "registro nuevo" if hecho else "registro previo"
                self.assertEqual((raiz / "registro.json").read_text(), esperado)
                self.assertFalse(diario.exists())


if __name__ == "__main__":
    unittest.main()
