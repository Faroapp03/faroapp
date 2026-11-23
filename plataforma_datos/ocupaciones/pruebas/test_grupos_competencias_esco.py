"""Pruebas de la herramienta que escribe los grupos de la jerarquía ESCO de cada competencia del paquete.

(plataforma_datos/ocupaciones/fuentes/esco/piezas/grupos_competencias_esco.py).

Todo es sintético: una base mínima con el esquema de esco.py, un paquete y una salida en carpetas temporales. La salida
real, que pertenece al motor de ocupaciones, nunca se lee ni se escribe: cada prueba sustituye su ruta antes de llamar
a la herramienta.
"""

import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import plataforma_datos.ocupaciones.fuentes.esco.lector as esco
import plataforma_datos.ocupaciones.fuentes.esco.piezas.consultas as consultas
import plataforma_datos.ocupaciones.fuentes.esco.piezas.grupos_competencias_esco as herramienta
from plataforma_datos.comun import entrada_salida
from plataforma_datos.comun.nucleo import ErrorFuente

NOMINAS = "http://data.europa.eu/esco/skill/b-nominas"
PERSONAL = "http://data.europa.eu/esco/skill/c-personal"
RRHH = "http://data.europa.eu/esco/skill/a-recursos-humanos"
GRUPO_RRHH = {"code": "S4.3.2", "title": "gestionar y administrar recursos humanos"}
GRUPO_GESTION = {"code": "S4.3", "title": "gestionar"}
CAPTURA = {"fuente": "ESCO de prueba", "version_solicitada": "v0", "sha256": "0" * 64}


def competencia(uri: str, titulo: str, grupos: list[dict[str, str]], superiores: list[str]) -> dict[str, object]:
    """Una competencia preparada con los campos que guarda la base y su lugar en la jerarquía.

    Returns:
        La ficha de la competencia.
    """
    return {
        "uri": uri,
        "titulo_es": titulo,
        "nombres_alternativos_es": [],
        "descripcion_es": "",
        "tipo": "capacidad_competencia",
        "grupos_superiores": grupos,
        "superiores": superiores,
    }


DATOS = {
    "ocupaciones": [],
    "competencias": [
        competencia(RRHH, "gestionar recursos humanos", [GRUPO_RRHH, GRUPO_GESTION], []),
        competencia(NOMINAS, "gestionar nóminas", [], [RRHH]),
        competencia(PERSONAL, "contratar personal", [], []),
    ],
    "relaciones": [],
}
# El paquete ordena sus competencias por URI, como la exportación de ESCO.
ORDEN_DEL_PAQUETE = sorted(ficha["uri"] for ficha in DATOS["competencias"])


class PruebaGruposDeCompetencias(unittest.TestCase):
    """Solo se escribe desde la base validada, con el paquete alineado, y la vigencia se comprueba sin escribir."""

    def setUp(self) -> None:
        """Base, paquete y salida sintéticos en una carpeta temporal; la salida real queda fuera de alcance."""
        temporal = tempfile.TemporaryDirectory(prefix="Grupos ESCO Año 2026 ")
        self.addCleanup(temporal.cleanup)
        carpeta = Path(temporal.name)
        self.base = carpeta / "biblioteca-esco.sqlite"
        esco.construir_base(self.base, CAPTURA, DATOS)
        self.paquete = carpeta / "esco.json"
        self.escribir_paquete(ORDEN_DEL_PAQUETE)
        self.salida = carpeta / "grupos-de-competencias.json"
        self.validacion = {"sha256_sqlite": entrada_salida.sha256(self.base)}
        for objeto, nombre, valor in [
            (consultas, "BASE", self.base),
            (herramienta, "PAQUETE", self.paquete),
            (herramienta, "SALIDA", self.salida),
            (consultas, "exigir_admitido", lambda _fuente: self.validacion),
        ]:
            parche = mock.patch.object(objeto, nombre, valor)
            parche.start()
            self.addCleanup(parche.stop)
        self.assertEqual(herramienta.SALIDA, self.salida)

    def escribir_paquete(self, uris: list[str]) -> None:
        """Escribe un paquete con estas competencias, en este orden."""
        filas = [[uri, uri.rsplit("/", 1)[-1], "capacidad_competencia"] for uri in uris]
        self.paquete.write_text(json.dumps({"competencias": filas}), encoding="utf-8")

    def test_escribe_los_grupos_en_el_orden_del_paquete(self) -> None:
        """Cada posición lleva los grupos de su competencia, también los heredados de la competencia superior."""
        herramienta.principal([])
        salida = json.loads(self.salida.read_text(encoding="utf-8"))
        self.assertEqual(salida["grupos"], {"S4.3": "gestionar", "S4.3.2": GRUPO_RRHH["title"]})
        self.assertEqual(salida["competencias"], ["S4.3|S4.3.2", "S4.3|S4.3.2", ""])

    def test_base_distinta_de_la_validada(self) -> None:
        """Si la base no es la que se validó, no se escribe nada."""
        self.validacion = {"sha256_sqlite": "0" * 64}
        with self.assertRaisesRegex(ErrorFuente, "no es la validada"):
            herramienta.principal([])
        self.assertFalse(self.salida.exists())

    def test_paquete_desalineado_con_la_base(self) -> None:
        """Un paquete con otro orden, con una competencia de menos o con una ajena no se acepta."""
        for uris in [
            list(reversed(ORDEN_DEL_PAQUETE)),
            ORDEN_DEL_PAQUETE[:-1],
            [*ORDEN_DEL_PAQUETE, "http://data.europa.eu/esco/skill/z-ajena"],
            [ORDEN_DEL_PAQUETE[0], *ORDEN_DEL_PAQUETE],
        ]:
            with self.subTest(uris=uris):
                self.escribir_paquete(uris)
                with self.assertRaisesRegex(ErrorFuente, "no tiene las competencias de la base validada"):
                    herramienta.principal([])
                self.assertFalse(self.salida.exists())

    def test_cierra_la_conexion(self) -> None:
        """La conexión a la base se cierra al terminar, también si el paquete no cuadra."""
        abiertas: list[sqlite3.Connection] = []
        conectar = sqlite3.connect

        def conectar_y_anotar(*argumentos: object, **opciones: object) -> sqlite3.Connection:
            conexion = conectar(*argumentos, **opciones)
            abiertas.append(conexion)
            return conexion

        with mock.patch.object(sqlite3, "connect", conectar_y_anotar):
            herramienta.principal([])
            self.escribir_paquete(ORDEN_DEL_PAQUETE[:-1])
            with self.assertRaises(ErrorFuente):
                herramienta.principal([])
        self.assertEqual(len(abiertas), 2)
        for conexion in abiertas:
            with self.assertRaises(sqlite3.ProgrammingError):
                conexion.execute("SELECT 1")

    def test_comprobar_la_vigencia_sin_escribir(self) -> None:
        """«--comprobar» acepta una salida vigente, rechaza una que ya no corresponde al paquete y nunca escribe."""
        self.assertEqual(herramienta.principal(["--comprobar"]), 1)
        self.assertFalse(self.salida.exists())
        herramienta.principal([])
        self.assertEqual(herramienta.principal(["--comprobar"]), 0)
        vigente = self.salida.read_bytes()
        salida = json.loads(vigente)
        salida["competencias"] = salida["competencias"][1:]
        self.salida.write_text(json.dumps(salida, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        desfasada = self.salida.read_bytes()
        self.assertEqual(herramienta.principal(["--comprobar"]), 1)
        self.assertEqual(self.salida.read_bytes(), desfasada)
        # El formato del archivo no cuenta: la misma salida sangrada sigue vigente.
        self.salida.write_text(json.dumps(json.loads(vigente), ensure_ascii=False, indent=2), encoding="utf-8")
        self.assertEqual(herramienta.principal(["--comprobar"]), 0)

    def test_grupo_con_el_separador(self) -> None:
        """Un código de grupo con «|» rompería la lista; no se escribe."""
        datos = json.loads(json.dumps(DATOS))
        datos["competencias"][0]["grupos_superiores"] = [{"code": "S4|3", "title": "roto"}]
        self.base.unlink()
        esco.construir_base(self.base, CAPTURA, datos)
        self.validacion = {"sha256_sqlite": entrada_salida.sha256(self.base)}
        with self.assertRaisesRegex(ErrorFuente, "separador"):
            herramienta.principal([])
        self.assertFalse(self.salida.exists())


if __name__ == "__main__":
    unittest.main()
