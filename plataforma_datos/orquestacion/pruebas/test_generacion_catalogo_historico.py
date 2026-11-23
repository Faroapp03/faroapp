"""Una admisión firmada por otra revisión se contrasta en privado antes de recuperar sus bytes."""

import json
import shutil
import tempfile
import unittest
from datetime import UTC, datetime
from pathlib import Path
from unittest import mock

from plataforma_datos.comun.entrada_salida import sha256
from plataforma_datos.comun.nucleo import HuellaIncorrecta
from plataforma_datos.cursos import admision_catalogo as admision
from plataforma_datos.cursos import almacen_catalogo, operacion_fuente, revalidar_catalogo
from plataforma_datos.cursos.fuentes.hp_life import actualizacion as hp
from plataforma_datos.cursos.pruebas import test_hp_life_actualizacion as hp_fixtures
from plataforma_datos.orquestacion import almacen_generaciones as remoto
from plataforma_datos.orquestacion import generacion_operativa as gen
from plataforma_datos.orquestacion.aprovisionar_candidato import aprovisionar_candidato
from plataforma_datos.orquestacion.estado_panel import estado_panel
from plataforma_datos.orquestacion.pruebas.test_almacen_generaciones import AlmacenDeDisco
from plataforma_datos.orquestacion.pruebas.test_aprovisionar_candidato import git
from plataforma_datos.orquestacion.pruebas.test_generacion_operativa import REVISION, preparar


class RestauracionHistoricaPruebas(unittest.TestCase):
    """Archivo, almacenamiento y lectura nativa para la misma edición de HP LIFE."""

    def setUp(self) -> None:
        """Conserva una generación real pequeña producida con la firma anterior."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.base = Path(temporal.name).resolve()
        self.instalacion = self.base / "operativos"
        preparar(self.instalacion)
        caso = hp_fixtures.ActualizacionHpLifePruebas()
        caso.setUp()
        self.addCleanup(caso.doCleanups)
        hp.preparar(caso.solicitud)
        fuente = hp.solicitud_admision(caso.solicitud.area)
        self.id = caso.entrada.id
        almacen_catalogo.conservar(
            almacen_catalogo.EntradaCatalogo(admision=fuente, sha256_admision=sha256(fuente.validacion_destino)),
            destino=self.instalacion / almacen_catalogo.RUTA,
        )
        self.generacion = self.base / "sellada"
        self.descargada = self.base / "descargada"
        self.restaurada = self.base / "restaurada"
        self.fichero = almacen_catalogo.RUTA / "validacion.json"
        self.contenido = self.generacion / "contenido"
        self.huella = gen.exportar_generacion(self.instalacion, self.generacion, REVISION)["sha256Manifiesto"]
        self.almacen = AlmacenDeDisco(self.base / "almacen")
        self.firma = admision.firma_codigo()
        self.nueva = {**self.firma, next(iter(self.firma)): "0" * 64}

    def resellar(self, ruta: Path) -> str:
        """Acredita que incluso con el hash esperado correcto hay controles sobre los hechos.

        Returns:
            La huella que la prueba proporciona como expectativa externa.
        """
        archivo = self.generacion / "manifiesto.json"
        manifiesto = json.loads(archivo.read_bytes())
        registro = next(r for r in manifiesto["archivos"] if self.contenido / r["ruta"] == ruta)
        registro.update(bytes=ruta.stat().st_size, sha256=sha256(ruta))
        manifiesto["bytesTotales"] = sum(r["bytes"] for r in manifiesto["archivos"])
        archivo.write_bytes(admision.bytes_json_admision(manifiesto))
        return sha256(archivo)

    def test_descarga_y_restauracion_conservan_el_archivo_y_sus_lectores_usan_la_nueva_admision(self) -> None:
        """Revalida en cada copia privada y conserva el archivo histórico en ambos destinos."""
        remoto.guardar_generacion(self.generacion, REVISION, self.huella, self.almacen)
        self.almacen.guardados.clear()
        anterior = (self.contenido / self.fichero).read_bytes()
        raiz_consultada = []
        admitidos = gen._admitidos

        def leer_fuente(raiz: Path) -> None:
            admitidos(raiz)
            self.assertEqual(operacion_fuente.conocidos("hp_life", raiz)[0]["id"], self.id)
            self.assertEqual(json.loads((raiz / self.fichero).read_bytes())["codigo_sha256"], self.nueva)
            raiz_consultada.append(raiz)

        with (
            mock.patch.object(admision, "firma_codigo", return_value=self.nueva),
            mock.patch.object(gen, "_admitidos", side_effect=leer_fuente),
        ):
            with self.assertRaises(ValueError):
                gen.exportar_generacion(self.instalacion, self.base / "otra-generacion", "b" * 40)
            with self.assertRaises(remoto.AlmacenGeneracionesInvalido):
                remoto.guardar_generacion(self.generacion, REVISION, self.huella, self.almacen)
            self.assertEqual(self.almacen.guardados, [])
            remoto.recuperar_generacion(self.descargada, REVISION, self.huella, self.almacen)
            gen.restaurar_generacion(self.descargada, self.restaurada, REVISION, self.huella)
            self.assertGreaterEqual(len(raiz_consultada), 2)
            self.assertNotIn(self.contenido, raiz_consultada)
            self.assertNotIn(self.descargada / "contenido", raiz_consultada)
            for base in (self.instalacion, self.contenido, self.descargada / "contenido", self.restaurada):
                self.assertEqual((base / self.fichero).read_bytes(), anterior)
            self.assertEqual(sha256(self.descargada / "manifiesto.json"), self.huella)
            self.assertIn("revalidado", revalidar_catalogo.revalidar(self.restaurada))
            self.assertEqual(operacion_fuente.conocidos("hp_life", self.restaurada)[0]["id"], self.id)

    def test_rechaza_cambio_de_cobertura_e_informe_no_canonico_aunque_se_selle(self) -> None:
        """Una firma distinta solo autoriza una auditoría: el resto del recibo debe reproducirse."""
        ruta = self.contenido / self.fichero
        original = json.loads(ruta.read_bytes())
        cobertura = dict(original["cobertura"])
        cobertura[next(iter(cobertura))] += 1
        for contenido in (
            admision.bytes_json_admision({**original, "cobertura": cobertura}),
            (json.dumps(original, indent=2) + "\n").encode(),
            admision.bytes_json_admision({**original, "codigo_sha256": {"../fuera": "0" * 64}}),
        ):
            with (
                self.subTest(recibo=contenido[:30]),
                mock.patch.object(admision, "firma_codigo", return_value=self.nueva),
            ):
                ruta.write_bytes(contenido)
                huella = self.resellar(ruta)
                with self.assertRaises(ValueError):
                    gen.restaurar_generacion(self.generacion, self.restaurada, REVISION, huella)
                self.assertEqual(ruta.read_bytes(), contenido)
                self.assertFalse(self.restaurada.exists())
                self.assertFalse(list(self.base.glob(".restaurando-*")))

    def test_dato_alterado_no_se_promueve_y_fallo_de_lectura_no_toca_el_origen(self) -> None:
        """La admisión enlaza SQLite, procedencia y archivos, incluso en caso de fallo posterior."""
        archivo = self.contenido / self.fichero
        anterior = archivo.read_bytes()
        with mock.patch.object(admision, "firma_codigo", return_value=self.nueva):
            with mock.patch.object(gen, "_admitidos", side_effect=OSError("fallo local")), self.assertRaises(OSError):
                gen.restaurar_generacion(self.generacion, self.restaurada, REVISION, self.huella)
            self.assertFalse(self.restaurada.exists())
            self.assertEqual(archivo.read_bytes(), anterior)
            base = self.contenido / almacen_catalogo.RUTA
            snapshot = almacen_catalogo.solicitud(base).snapshot.ruta
            with snapshot.open("ab") as datos:
                datos.write(b"alterado")
            with self.assertRaises(ValueError), mock.patch.object(admision, "admitir_snapshot") as auditar:
                gen.restaurar_generacion(self.generacion, self.restaurada, REVISION, self.huella)
            auditar.assert_not_called()
            with self.assertRaises(ValueError):
                gen.restaurar_generacion(self.generacion, self.restaurada, REVISION, self.resellar(snapshot))
            self.assertEqual(archivo.read_bytes(), anterior)
            self.assertFalse(self.restaurada.exists())

    def test_aprovisionamiento_conserva_la_admision_que_leyo_el_panel_sin_auditar_dos_veces(self) -> None:
        """La copia operativa ya está admitida al entrar en el motor aun cuando no haya tareas pendientes."""
        checkout = self.base / "checkout"
        checkout.mkdir()
        git(checkout, "init", "-q")
        for relativa in self.firma:
            copia = checkout / relativa
            copia.parent.mkdir(exist_ok=True, parents=True)
            shutil.copyfile(admision.RAIZ / relativa, copia)
        git(checkout, "add", ".")
        git(checkout, "commit", "-qm", "Codigo de prueba")
        revision = git(checkout, "rev-parse", "HEAD")
        destino = self.base / "candidata"
        archivo = self.contenido / self.fichero
        anterior = admision.bytes_json_admision({**json.loads(archivo.read_bytes()), "codigo_sha256": self.nueva})
        archivo.write_bytes(anterior)
        huella = self.resellar(archivo)
        with mock.patch.object(admision, "admitir_snapshot", wraps=admision.admitir_snapshot) as auditar:
            recibo = aprovisionar_candidato(checkout, destino, revision, self.generacion, REVISION, huella)
            self.assertEqual(recibo["generacion"]["sha256Manifiesto"], huella)
            self.assertEqual(operacion_fuente.conocidos("hp_life", destino)[0]["id"], self.id)
            estado_panel(destino, datetime.now(UTC))
            self.assertIn("admitido con el código vigente", revalidar_catalogo.revalidar(destino))
            auditar.assert_called_once()
        self.assertEqual((self.contenido / self.fichero).read_bytes(), anterior)
        self.assertEqual(json.loads((destino / self.fichero).read_bytes())["codigo_sha256"], self.firma)
        (checkout / next(iter(self.firma))).write_bytes(b"otra revision")
        git(checkout, "commit", "-qam", "Otro codigo")
        destino_ajeno = self.base / "otra-candidata"
        revision_ajena = git(checkout, "rev-parse", "HEAD")
        for firma in (self.nueva, self.firma):
            contenido = admision.bytes_json_admision({**json.loads(anterior), "codigo_sha256": firma})
            archivo.write_bytes(contenido)
            with self.subTest(firma_vigente=firma == self.firma), self.assertRaises(HuellaIncorrecta):
                aprovisionar_candidato(
                    checkout, destino_ajeno, revision_ajena, self.generacion, REVISION, self.resellar(archivo)
                )
            self.assertFalse(destino_ajeno.exists())
            self.assertEqual(archivo.read_bytes(), contenido)
