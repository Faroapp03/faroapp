"""Almacén compartido: conserva hechos y permite continuar el productor existente."""

import hashlib
import unittest
from dataclasses import replace

from plataforma_datos.cursos import almacen_catalogo as almacen
from plataforma_datos.cursos.fuentes.hp_life import actualizacion as hp
from plataforma_datos.cursos.pruebas import test_hp_life_actualizacion as fixtures


class AlmacenCatalogoPruebas(unittest.TestCase):
    """Copia privada real de SQLite y capturas sintéticas, sin red."""

    def test_admitir_conservar_y_siguiente_ciclo_hp_conserva_historia(self) -> None:
        """La raíz portable conserva SHA/fechas e inventario íntegro entre operaciones."""
        caso = fixtures.ActualizacionHpLifePruebas()
        caso.setUp()
        self.addCleanup(caso.doCleanups)
        hp.preparar(caso.solicitud)
        entrada = hp.solicitud_admision(caso.solicitud.area)
        original = entrada.snapshot.ruta.read_bytes()
        destino = caso.raiz / "Almacén portable ñ"
        almacen.conservar(
            almacen.EntradaCatalogo(admision=entrada, sha256_admision=caso.ref(entrada.validacion_destino).sha256),
            destino=destino,
        )
        solicitud = almacen.solicitud(destino)
        self.assertEqual(solicitud.snapshot.ruta.read_bytes(), original)
        recibo = caso.guardar_recepcion(fecha="2026-10-23T03:00:00Z")
        siguiente = replace(
            caso.solicitud,
            admision=solicitud,
            sha256_admision=caso.ref(solicitud.validacion_destino).sha256,
            raiz_evidencias=destino / "evidencias",
            recepciones=(recibo,),
            area=caso.raiz / "Siguiente",
            corte_utc="2026-10-23T04:00:00Z",
        )
        control = hp.preparar(siguiente)
        anterior = almacen.json.loads((destino / almacen.CONTROL).read_bytes())
        regenerables = almacen.indices_regenerables(anterior)
        self.assertEqual(regenerables, {"indices/control-hp.json"})
        for prueba in anterior["archivos_conservados"]:
            ruta = siguiente.area / prueba["archivo"]
            if prueba["archivo"] in regenerables:
                self.assertFalse(ruta.exists())
            else:
                self.assertTrue(ruta.is_file())
                self.assertEqual(hashlib.sha256(ruta.read_bytes()).hexdigest(), prueba["sha256"])
        self.assertTrue(control["archivos_conservados"])
        self.assertEqual(solicitud.snapshot.ruta.read_bytes(), original)


class AlmacenEntradasPruebas(unittest.TestCase):
    """La candidata no se promueve antes de admitir y su control se trata como entrada hostil."""

    def setUp(self) -> None:
        """Prepara solo hechos y SQLite sintéticos con admisión efectiva."""
        self.caso = fixtures.ActualizacionHpLifePruebas()
        self.caso.setUp()
        self.addCleanup(self.caso.doCleanups)
        hp.preparar(self.caso.solicitud)
        solicitud = hp.solicitud_admision(self.caso.solicitud.area)
        self.entrada = almacen.EntradaCatalogo(
            admision=solicitud, sha256_admision=self.caso.ref(solicitud.validacion_destino).sha256
        )
        self.destino = self.caso.raiz / "Destino único ñ"

    def test_copia_interrumpida_no_aparece_como_destino_y_se_puede_repetir(self) -> None:
        """Un fallo interior descarta la candidata propia y conserva origen/destino."""
        from pathlib import Path
        from unittest.mock import patch

        original = self.entrada.admision.snapshot.ruta.read_bytes()
        real = almacen.shutil.copyfile

        def parcial(origen: Path, destino: Path) -> Path:
            if Path(origen) == self.entrada.admision.snapshot.ruta:
                Path(destino).write_bytes(original[:100])
                raise OSError("corte sintético durante copia")
            return real(origen, destino)

        with patch.object(almacen.shutil, "copyfile", parcial), self.assertRaises(OSError):
            almacen.conservar(self.entrada, destino=self.destino)
        self.assertFalse(self.destino.exists())
        self.assertEqual(self.entrada.admision.snapshot.ruta.read_bytes(), original)
        almacen.conservar(self.entrada, destino=self.destino)
        self.assertEqual((self.destino / "catalogo.sqlite3").read_bytes(), original)

    def test_control_duplicado_enlazado_no_regular_o_excesivo_se_rechaza(self) -> None:
        """El control se valida antes de usar sus rutas, campos o hashes."""
        import os
        from unittest.mock import patch

        almacen.conservar(self.entrada, destino=self.destino)
        ruta = self.destino / almacen.CONTROL
        original = ruta.read_bytes()
        ruta.write_bytes(b'{"schema_version":1,' + original[1:])
        with self.assertRaises(ValueError):
            almacen.solicitud(self.destino)
        ruta.write_bytes(original)
        with patch.object(almacen.indices_evidencias, "MAX_INDICE", len(original) - 1), self.assertRaises(ValueError):
            almacen.solicitud(self.destino)
        alias = self.destino / "alias.json"
        os.link(ruta, alias)
        with self.assertRaises(ValueError):
            almacen.solicitud(self.destino)
        alias.unlink()
        ruta.unlink()
        ruta.mkdir()
        with self.assertRaises(ValueError):
            almacen.solicitud(self.destino)

    def test_control_bien_formado_no_sustituye_admision_externa(self) -> None:
        """Cambiar un control válido no lo vuelve una entrada admitida."""
        from plataforma_datos.cursos import admision_catalogo

        almacen.conservar(self.entrada, destino=self.destino)
        validacion = self.caso.ref(self.destino / "validacion.json").sha256
        ruta = self.destino / almacen.CONTROL
        dato = almacen.json.loads(ruta.read_bytes())
        dato["aplicados_por_fuente"] = {"hp_life": "a" * 64}
        ruta.write_text(almacen.json.dumps(dato))
        solicitud = almacen.solicitud(self.destino)
        with self.assertRaises(ValueError):
            admision_catalogo.exigir_snapshot_admitido(solicitud, sha256_validacion=validacion)

    def test_contrato_compacto_no_autoriza_descartar_una_evidencia(self) -> None:
        """Ni otro ID ni una ruta de hechos se pueden marcar como índice regenerable."""
        import copy

        almacen.conservar(self.entrada, destino=self.destino)
        ruta = self.destino / almacen.CONTROL
        original = ruta.read_bytes()
        control = almacen.json.loads(original)
        prueba = next(p for p in control["archivos_conservados"] if p["archivo"].startswith("evidencias/"))
        contratos = [
            {"version": True, "indices_regenerables": {}},
            {"version": 1, "indices_regenerables": {"cuerpo": prueba}},
            {"version": 1, "indices_regenerables": {"control-hp": prueba}},
        ]
        for contrato in contratos:
            dato = copy.deepcopy(control)
            dato["conservacion"] = contrato
            ruta.write_bytes(almacen.admision.bytes_json_admision(dato))
            with self.subTest(contrato=contrato), self.assertRaises(ValueError):
                almacen.solicitud(self.destino)
        ruta.write_bytes(original)
