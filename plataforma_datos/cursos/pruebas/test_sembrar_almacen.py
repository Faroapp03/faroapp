"""Almacén de Cursos ausente, ilegible o vacío y siembra desde cero con el ciclo real de una fuente con censo propio."""

import contextlib
import io
import json
import sqlite3
from unittest.mock import patch

from plataforma_datos.comun.nucleo import Carpetas, FormatoInesperado
from plataforma_datos.cursos import almacen_catalogo as almacen
from plataforma_datos.cursos import componer_catalogo as componer
from plataforma_datos.cursos import operacion_fuente as fuente
from plataforma_datos.cursos import sembrar_almacen
from plataforma_datos.cursos.pruebas import test_academy_observaciones_vigencia as academy
from plataforma_datos.orquestacion import admision

CORTE = "2026-10-23T10:05:00Z"


class SembrarAlmacenPruebas(academy.AcademyObservacionesPruebas):
    """Transporte sintético de Academy con cursos gratuitos; almacén, admisión, conocidos y composición reales."""

    def setUp(self) -> None:
        """Retira la simulación de conocidos: aquí se leen del almacén sembrado."""
        super().setUp()
        self.pila.close()

        def carpetas(id: str) -> Carpetas:
            return Carpetas(*fuente.rutas_de_la_fuente(id, self.raiz))

        for contexto in (
            patch.object(fuente, "RAIZ", self.raiz),
            patch.object(fuente, "consultar", side_effect=self.recibir),
            patch.object(admision, "carpetas", carpetas),
            patch.object(admision, "ruta_del_conjunto", lambda id: carpetas(id).validado / f"{id}.json"),
        ):
            self.pila.enter_context(contexto)

    def fallo_de_composicion(self) -> str:
        """Compone y exige que falle sin dejar nada publicado.

        Returns:
            El código estable del fallo del almacén.
        """
        with self.assertRaises(componer.AlmacenNoDisponible) as fallo:
            componer.componer(raiz=self.raiz, corte_utc=CORTE)
        self.assertFalse((self.raiz / "web").exists())
        return fallo.exception.codigo

    def test_almacen_ausente_falla_con_motivo_y_codigo_uno(self) -> None:
        """La orden del ciclo termina en 1, no publica y su motivo dice qué hacer."""
        self.assertEqual(self.fallo_de_composicion(), componer.AUSENTE)
        salida = io.StringIO()
        original = componer.componer
        with (
            patch.object(componer, "componer", lambda: original(raiz=self.raiz, corte_utc=CORTE)),
            contextlib.redirect_stderr(salida),
        ):
            self.assertEqual(componer.main(), 1)
        self.assertIn("Error: almacen-ausente:", salida.getvalue())
        self.assertIn(componer.SEMBRAR, salida.getvalue())

    def test_almacen_ilegible_falla(self) -> None:
        """Un control alterado o una instantánea cambiada no se proyectan."""
        sembrar_almacen.sembrar(self.raiz)
        base = self.raiz / almacen.RUTA
        with sqlite3.connect(base / "catalogo.sqlite3") as conexion:
            conexion.execute("PRAGMA user_version=1")
        self.assertEqual(self.fallo_de_composicion(), componer.ILEGIBLE)
        (base / almacen.CONTROL).write_text("{", encoding="utf-8")
        self.assertEqual(self.fallo_de_composicion(), componer.ILEGIBLE)

    def test_almacen_sembrado_sin_altas_no_publica_un_catalogo_vacio(self) -> None:
        """Recién sembrado y sin fuentes aplicadas, el paso falla en lugar de publicar cero ofertas."""
        sembrar_almacen.sembrar(self.raiz)
        self.assertEqual(self.fallo_de_composicion(), componer.VACIO)

    def test_sembrar_no_sustituye_un_almacen_existente(self) -> None:
        """Repetir la siembra se rechaza y deja intactos los bytes del almacén."""
        sembrar_almacen.sembrar(self.raiz)
        control = (self.raiz / almacen.RUTA / almacen.CONTROL).read_bytes()
        with self.assertRaises(FormatoInesperado):
            sembrar_almacen.sembrar(self.raiz)
        self.assertEqual((self.raiz / almacen.RUTA / almacen.CONTROL).read_bytes(), control)

    def test_fuente_con_censo_propio_da_de_alta_desde_cero_sin_duplicar(self) -> None:
        """Academy parte de cero conocidos, da de alta lo que trae su índice con evidencia y repetir no duplica."""
        sembrar_almacen.sembrar(self.raiz)
        self.assertEqual(fuente.conocidos("claude_academy", self.raiz), [])
        conjunto = self.ciclo()
        self.assertEqual([r["id"] for r in conjunto["recepciones"]], ["claude-academy:nuevo"])
        resultado = componer.componer(raiz=self.raiz, corte_utc=CORTE)
        dto = json.loads((self.raiz / "web" / resultado["referencia"]["ruta"]).read_bytes())
        self.assertEqual([o["unidad"]["id"] for o in dto["ofertas"]], ["claude-academy:nuevo"])
        self.assertTrue(all(o["comprobado_el"] is not None for o in dto["ofertas"]))
        self.ciclo()
        componer.componer(raiz=self.raiz, corte_utc="2026-10-23T11:05:00Z")
        with sqlite3.connect(self.raiz / almacen.RUTA / "catalogo.sqlite3") as conexion:
            self.assertEqual(conexion.execute("SELECT id FROM programas").fetchall(), [("claude-academy:nuevo",)])

    def test_fuente_sin_censo_propio_sigue_rechazando_el_vacio(self) -> None:
        """HP LIFE solo reconsulta conocidos y falla diciendo qué hacer; FUNDAE parte de cero con su censo."""
        sembrar_almacen.sembrar(self.raiz)
        with self.assertRaisesRegex(FormatoInesperado, "restaura el almacén conservado. Tras una siembra no tiene"):
            fuente.conocidos("hp_life", self.raiz)
        # FUNDAE trae su censo completo de Digitalízate: sin entidades, sus altas salen de él.
        self.assertEqual(fuente.conocidos("fundae", self.raiz)["programas"], [])

    def test_conocidos_fundae_exige_una_admision_integra_por_lectura(self) -> None:
        """El acceso de la fuente comprueba una sola vez la SQLite y rechaza una manipulación posterior."""
        sembrar_almacen.sembrar(self.raiz)
        contrato = fuente.admision_catalogo
        with patch.object(contrato, "exigir_snapshot_admitido", wraps=contrato.exigir_snapshot_admitido) as comprobar:
            conocidos = fuente.conocidos("fundae", self.raiz)
            comprobar.assert_called_once()
            self.assertEqual(
                conocidos,
                {"schema_version": 1, "fuente_id": "fundae", "programas": [], "variantes": [], "anuncios": []},
            )
            comprobar.reset_mock()
            with sqlite3.connect(self.raiz / almacen.RUTA / "catalogo.sqlite3") as conexion:
                conexion.execute("PRAGMA user_version=1")
            with self.assertRaisesRegex(contrato.ErrorAdmisionCatalogo, "Archivo alterado"):
                fuente.conocidos("fundae", self.raiz)
            comprobar.assert_called_once()


# Las pruebas heredadas del ciclo de Academy ya se ejecutan en su propio módulo.
for _nombre in [n for n in dir(academy.AcademyObservacionesPruebas) if n.startswith("test_")]:
    setattr(SembrarAlmacenPruebas, _nombre, None)
del _nombre
