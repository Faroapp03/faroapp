"""El actualizador migra el registro legado bajo cerrojo antes de ejecutar fuentes."""

import contextlib
import io
import json
import tempfile
import unittest
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest import mock

from plataforma_datos.orquestacion import actualizar, comprobaciones_remotas, sustitucion


class MigracionRegistroActualizacionPruebas(unittest.TestCase):
    """Entrada real del actualizador con almacenamiento temporal y sin consultas remotas."""

    def setUp(self) -> None:
        """Crea un registro legado verificable cuyo último intento remoto falló."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.raiz = Path(temporal.name) / "Mis documentos" / "Año 2026"
        self.raiz.mkdir(parents=True)
        self.ruta = self.raiz / comprobaciones_remotas.ARCHIVO
        inicio = datetime(2026, 10, 21, 10, tzinfo=UTC)
        with sustitucion.cerrojo(self.raiz):
            ciclo = comprobaciones_remotas.iniciar_ciclo(self.raiz, inicio, "manual")
            comprobaciones_remotas.iniciar_fuente(self.raiz, ciclo, "formacion", ("soc-oferta",), inicio, remoto=True)
            fin = inicio + timedelta(seconds=1)
            comprobaciones_remotas.terminar_fuente(
                self.raiz, ciclo, "formacion", fin, resultado="fallo", evidencia=None
            )
            comprobaciones_remotas.cerrar_ciclo(self.raiz, ciclo, fin, resultado="fallo", paquete_preparado=False)
        self.legado = comprobaciones_remotas.leer_registro(self.raiz)
        self.legado.pop("seguimiento_remoto")
        self.legado["version"] = 1
        self.ruta.write_text(json.dumps(self.legado), encoding="utf-8")
        self.antes = (self.ruta.read_bytes(), self.ruta.stat().st_mtime_ns)

    def ejecutar(self, *, ensayo: bool = False) -> actualizar.ResultadoActualizacion:
        """Invoca el límite operativo, sustituyendo únicamente la ejecución posterior de fuentes.

        Returns:
            Resultado del actualizador real; el llamador controla el doble de la fase posterior.
        """
        opciones = actualizar.Opciones(ensayo=ensayo, pausa=0, reintento=0)
        with contextlib.redirect_stdout(io.StringIO()):
            return actualizar.actualizar_con_resultado(self.raiz, opciones)

    def test_migra_bajo_cerrojo_antes_de_iniciar_fuentes(self) -> None:
        """El registro se adapta sin borrar fechas ni el fallo anterior antes de ejecutar órdenes."""
        migrar = comprobaciones_remotas.migrar_registro

        def comprobar_cerrojo(raiz: Path) -> dict:
            with self.assertRaises(sustitucion.ActualizacionEnCurso), sustitucion.cerrojo(raiz):
                self.fail("El actualizador no conserva el cerrojo durante la migración")
            migrado = migrar(raiz)
            for campo in ("reloj_utc", "fuentes", "conjuntos", "ultimo_ciclo", "reconstruccion_pendiente"):
                self.assertEqual(migrado[campo], self.legado[campo])
            return migrado

        def comprobar_antes_de_fuentes(*_args: object) -> actualizar.ResultadoActualizacion:
            estado = comprobaciones_remotas.leer_registro(self.raiz)
            self.assertEqual(estado["version"], 2)
            seguimiento = estado["seguimiento_remoto"]["formacion"]
            self.assertEqual(seguimiento["ultimo_intento"], self.legado["fuentes"]["formacion"])
            self.assertEqual(set(seguimiento["incidencias_pendientes"]), {"soc-oferta"})
            return actualizar.ResultadoActualizacion(0, None, None, {})

        with (
            mock.patch.object(comprobaciones_remotas, "migrar_registro", side_effect=comprobar_cerrojo) as llamada,
            mock.patch.object(actualizar, "_actualizar", side_effect=comprobar_antes_de_fuentes) as fase,
        ):
            self.assertEqual(self.ejecutar().codigo, 0)
        llamada.assert_called_once_with(self.raiz)
        fase.assert_called_once()

    def test_ensayo_no_migra_ni_escribe_el_registro(self) -> None:
        """Un ensayo conserva los bytes y la fecha del legado sin efectos sobre su historia."""
        with (
            mock.patch.object(comprobaciones_remotas, "migrar_registro") as migrar,
            mock.patch.object(
                actualizar, "_actualizar", return_value=actualizar.ResultadoActualizacion(0, None, None, {})
            ),
        ):
            self.assertEqual(self.ejecutar(ensayo=True).codigo, 0)
        migrar.assert_not_called()
        self.assertEqual((self.ruta.read_bytes(), self.ruta.stat().st_mtime_ns), self.antes)

    def test_fallo_de_migracion_impide_ejecutar_fuentes(self) -> None:
        """Un fallo de almacenamiento se propaga sin ejecutar órdenes ni modificar el legado."""
        with (
            mock.patch.object(comprobaciones_remotas, "migrar_registro", side_effect=OSError("escritura simulada")),
            mock.patch.object(actualizar, "_actualizar") as fase,
            self.assertRaises(OSError),
        ):
            self.ejecutar()
        fase.assert_not_called()
        self.assertEqual((self.ruta.read_bytes(), self.ruta.stat().st_mtime_ns), self.antes)
