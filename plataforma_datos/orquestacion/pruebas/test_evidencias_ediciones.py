"""Regresión de las ediciones conservadas cuando una fuente devuelve un índice parcial."""

import hashlib
import json
import shutil
import sqlite3
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import Mock

from plataforma_datos.orquestacion import evidencias_ediciones as pruebas
from plataforma_datos.orquestacion import recuperar_ediciones as archivo
from plataforma_datos.orquestacion.almacen_de_ensayo import AlmacenDeEnsayo
from plataforma_datos.orquestacion.archivos_de_generacion import GeneracionInvalida


class EvidenciasEdicionesTest(unittest.TestCase):
    """Un informe histórico conserva dos rutas por consulta y contenidos compartidos por varias ediciones."""

    def setUp(self) -> None:
        """Construye originales independientes de la copia sellada incompleta."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.zona = Path(temporal.name).resolve()
        self.origen = self.zona / "original"
        self.copia = self.zona / "restaurada"
        self.lote = self.zona / "archivo.zip"
        self.informe = self.copia / pruebas.INFORME
        self.informe.parent.mkdir(parents=True)
        consultas = {}
        for nombre in ("indice", "difusiones", "centro", "colectivos"):
            consulta = {"http": 200, "consultado_utc": "2026-11-18T12:00:00Z"}
            for campo, carpeta, extension in (("cuerpo", "cuerpos", "body"), ("recibo", "recepciones", "json")):
                datos = (nombre + campo).encode()
                huella = hashlib.sha256(datos).hexdigest()
                relativa = f"{carpeta}/{huella}.{extension}"
                consulta[campo] = {"archivo": relativa, "sha256": huella}
                canal = "catalogos" if nombre == "indice" else "ediciones"
                ruta = self.origen / pruebas.BASE / canal / relativa
                ruta.parent.mkdir(parents=True, exist_ok=True)
                ruta.write_bytes(datos)
            consultas[nombre] = consulta
        self.validacion = {"cobertura": {"ediciones": 2}, "evidencias": {"101": consultas, "102": consultas}}
        self.informe.write_text(json.dumps(self.validacion))
        self.conexion = sqlite3.connect(self.zona / "controles.sqlite")
        self.addCleanup(self.conexion.close)
        self.almacen = AlmacenDeEnsayo(self.zona / "objetos", self.conexion)

    def test_recupera_en_almacen_y_repetir_no_relee_ni_reescribe(self) -> None:
        """La misma prueba se transfiere una vez y queda incorporada al siguiente inventario."""
        archivo.construir(self.copia, self.origen, self.lote)
        for _ in range(2):
            archivo.guardar(self.copia, self.lote, self.almacen)
        buscar = Mock(side_effect=lambda raiz, destino: archivo.descargar(raiz, destino, self.almacen))
        self.assertEqual(archivo.restaurar(self.copia, buscar), 8)
        self.assertEqual(archivo.restaurar(self.copia, buscar), 0)
        buscar.assert_called_once()
        self.assertEqual(pruebas.archivos(self.copia), set(pruebas.referencias(self.copia)))
        self.assertFalse(archivo.faltan(self.copia))

    def test_el_sello_se_repara_con_sus_propios_bytes_sin_consultar_el_almacen(self) -> None:
        """La misma evidencia puede estar guardada en la base SQLite y faltar en el canal de su fuente."""
        indice = {}
        for nombre, huella in pruebas.referencias(self.copia).items():
            ruta = self.copia / "var/actualizacion/validados/catalogo-cursos/evidencias/conservadas" / (huella + ".ref")
            ruta.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(self.origen / nombre, ruta)
            indice[huella] = ruta.relative_to(self.copia).as_posix()
        buscar = Mock(side_effect=AssertionError("el respaldo no debe consultarse"))
        self.assertFalse(archivo.faltan(self.copia, indice))
        self.assertEqual(archivo.restaurar(self.copia, buscar, indice=indice), 8)
        self.assertEqual(archivo.restaurar(self.copia, buscar, indice=indice), 0)
        self.assertEqual(pruebas.archivos(self.copia), set(pruebas.referencias(self.copia)))
        buscar.assert_not_called()

    def test_una_copia_alterada_no_ocupa_el_destino_y_un_reintento_la_recupera(self) -> None:
        """Un fallo de integridad deja la ruta de destino libre para el siguiente intento."""
        ruta, huella = next(iter(pruebas.referencias(self.copia).items()))
        copia = self.copia / "copia.ref"
        copia.write_bytes(b"alterada")
        buscar = Mock(side_effect=AssertionError("no se consulta un origen distinto ante una alteración"))
        with self.assertRaises(ValueError):
            archivo.restaurar(self.copia, buscar, indice={huella: copia.name})
        self.assertFalse((self.copia / ruta).exists())
        shutil.copyfile(self.origen / ruta, copia)
        archivo.construir(self.copia, self.origen, self.lote)
        self.assertEqual(archivo.restaurar(self.copia, buscar, indice={huella: copia.name}, apoyo=self.lote), 8)
        self.assertEqual(archivo.restaurar(self.copia, buscar), 0)
        buscar.assert_not_called()

    def test_rechaza_entrada_alterada_antes_del_marcador(self) -> None:
        """Un ZIP con todos los nombres esperados y otros bytes no adquiere autoridad."""
        with zipfile.ZipFile(self.lote, "x") as lote:
            for huella in pruebas.referencias(self.copia).values():
                lote.writestr(huella, b"alterado")
        with self.assertRaises(GeneracionInvalida):
            archivo.guardar(self.copia, self.lote, self.almacen)
        self.assertEqual(self.conexion.execute("SELECT count(*) FROM controles").fetchone(), (0,))

    def test_rechaza_ruta_ajena_y_enlace(self) -> None:
        """El archivo nunca elige el destino y un enlace no redirige una recuperación."""
        archivo.construir(self.copia, self.origen, self.lote)
        salida = self.copia / pruebas.BASE
        salida.parent.mkdir(parents=True)
        salida.symlink_to(self.origen / pruebas.BASE, target_is_directory=True)
        ausente = next(iter(pruebas.referencias(self.copia)))
        (self.origen / ausente).unlink()
        with self.assertRaises(GeneracionInvalida):
            archivo.restaurar(self.copia, Mock(), apoyo=self.lote)
        self.assertFalse((self.origen / ausente).exists())
        self.validacion["evidencias"]["101"]["indice"]["recibo"]["archivo"] = "../desvio"
        self.informe.write_text(json.dumps(self.validacion))
        with self.assertRaises(GeneracionInvalida):
            pruebas.referencias(self.copia)

    def test_una_generacion_nueva_verifica_tambien_la_consulta_reutilizable(self) -> None:
        """Un metadato ya probado por el índice forma parte del inventario aunque no se publique en la ficha."""
        shutil.copytree(self.origen / pruebas.BASE, self.copia / pruebas.BASE)
        base = self.copia / pruebas.BASE / "ediciones"
        sha = hashlib.sha256(b"metadato").hexdigest()
        ruta = base / "metadatos" / f"{sha}.json"
        ruta.parent.mkdir()
        ruta.write_bytes(b"metadato")
        indice = base / "procedencia.json"
        indice.write_text(
            json.dumps(
                {
                    "schema_version": 1,
                    "fuente_id": "fundae",
                    "indice": {},
                    "especialidades": [{"metadatos": {"archivo": f"metadatos/{sha}.json", "sha256": sha}}],
                }
            )
        )
        rutas = pruebas.archivos(self.copia)
        self.assertIn(ruta.relative_to(self.copia).as_posix(), rutas)
        self.assertIn(indice.relative_to(self.copia).as_posix(), rutas)
        ruta.unlink()
        with self.assertRaises(FileNotFoundError):
            pruebas.archivos(self.copia)
