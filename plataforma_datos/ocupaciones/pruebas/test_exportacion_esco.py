"""Proyección ESCO sobre SQLite propia: JSON defectuoso, orden e identidad de la base admitida."""

import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import plataforma_datos.ocupaciones.fuentes.esco.exportacion as esco
import plataforma_datos.ocupaciones.fuentes.esco.piezas.consultas as consultas
from plataforma_datos.comun import entrada_salida
from plataforma_datos.comun.nucleo import Carpetas, Controles, ErrorFuente, ValidacionFallida
from plataforma_datos.ocupaciones.fuentes.esco.piezas.constantes_esco import ESQUEMA
from plataforma_datos.orquestacion import admision
from plataforma_datos.orquestacion.exportacion.comun import Paquete


class PruebaExportacionEsco(unittest.TestCase):
    """Lee tablas reales con el esquema del productor, sin consultar datos operativos."""

    def setUp(self) -> None:
        """Crea una biblioteca propia y su informe con SHA, incluidos textos y relaciones en distinto orden."""
        temporal = tempfile.TemporaryDirectory(prefix="exportacion-esco-")
        self.addCleanup(temporal.cleanup)
        raiz = Path(temporal.name) / "Mis documentos" / "Año 2026"
        raiz.mkdir(parents=True)
        self.ruta = raiz / "biblioteca-esco.sqlite"
        self.carpetas = Carpetas(raiz / "originales", raiz / "preparados", raiz)
        self.base = sqlite3.connect(self.ruta)
        self.addCleanup(self.base.close)
        self.base.executescript(ESQUEMA)
        self.base.executemany(
            "INSERT INTO competencias VALUES (?,?,?,?,?,?)",
            [
                ("c-z", "Zeta", "no_especificado", "", "[]", "{}"),
                ("c-a", "Ámbito", "capacidad_competencia", "", "[]", "{}"),
                ("c-m", "Materia", "conocimiento", "", "[]", "{}"),
            ],
        )
        self.base.executemany(
            "INSERT INTO ocupaciones VALUES (?,?,?,?,?,?)",
            [
                ("o-b", "Segunda", "2222.2", "", "[]", "{}"),
                ("o-a", "Primera", "1111.1", "Descripción española", '["Sinónimo", "Otra denominación"]', "{}"),
            ],
        )
        self.base.executemany(
            "INSERT INTO relaciones VALUES (?,?,?,?)",
            [
                ("o-a", "c-z", "opcional", "{}"),
                ("o-a", "c-a", "esencial", "{}"),
                ("o-b", "c-m", "esencial", "{}"),
                ("o-a", "c-a", "opcional", "{}"),
            ],
        )
        self.base.commit()
        controles = Controles()
        controles.comprobar(
            self.base.execute("PRAGMA integrity_check").fetchall() == [("ok",)], "integridad SQLite de la fixture ESCO"
        )
        self.informe = {
            "estado": controles.estado,
            "controles": controles.lista,
            "sha256_sqlite": entrada_salida.sha256(self.ruta),
        }
        self.guardar_informe(self.informe)
        for parche in (
            mock.patch.object(consultas, "BASE", self.ruta),
            mock.patch.object(esco, "BASE_ESCO", self.ruta),
            mock.patch.object(entrada_salida, "carpetas", return_value=self.carpetas),
            mock.patch.object(admision, "carpetas", return_value=self.carpetas),
        ):
            parche.start()
            self.addCleanup(parche.stop)

    def guardar_informe(self, informe: dict) -> None:
        """Guarda el informe propio que leen los controles reales de admisión."""
        self.carpetas.validacion.write_text(json.dumps(informe), encoding="utf-8")

    def test_alternativos_json_ilegible_o_con_forma_incorrecta(self) -> None:
        """La columna TEXT no garantiza JSON ni una lista de textos: el error debe identificar la ocupación."""
        for contenido in ("[", "null", "{}", "false", "1", '["válido", null]', "[1]", "[NaN]"):
            with self.subTest(contenido=contenido):
                self.base.execute("UPDATE ocupaciones SET alternativos_json=? WHERE uri='o-a'", (contenido,))
                with self.assertRaisesRegex(ErrorFuente, "esco.*o-a.*alternativos"):
                    esco._ocupaciones_esco(self.base)

    def test_paquete_completo_conserva_orden_indices_y_dos_clases_de_relacion(self) -> None:
        """La proyección usa la lectura admitida real y no escribe la biblioteca; un mismo par admite e y o."""
        huella = entrada_salida.sha256(self.ruta)
        paquete = esco.paquete_esco()
        self.assertIsInstance(paquete, Paquete)
        self.assertEqual(paquete.origenes, [self.ruta])
        self.assertEqual(list(paquete.datos["ocupaciones"]), ["2222.2", "1111.1"])
        self.assertEqual(
            paquete.datos,
            {
                "fuente": f"Comisión Europea, ESCO {esco.VERSION_ESCO}",
                "competencias": [
                    ["c-a", "Ámbito", "capacidad_competencia"],
                    ["c-m", "Materia", "conocimiento"],
                    ["c-z", "Zeta", "no_especificado"],
                ],
                "ocupaciones": {
                    "2222.2": {
                        "uri": "o-b",
                        "titulo": "Segunda",
                        "isco08": "2222",
                        "alternativos": [],
                        "descripcion": "",
                        "competencias": [[1, "e"]],
                    },
                    "1111.1": {
                        "uri": "o-a",
                        "titulo": "Primera",
                        "isco08": "1111",
                        "alternativos": ["Sinónimo", "Otra denominación"],
                        "descripcion": "Descripción española",
                        "competencias": [[0, "e"], [0, "o"], [2, "o"]],
                    },
                },
            },
        )
        self.assertEqual(entrada_salida.sha256(self.ruta), huella)

    def test_paquete_exige_admision_y_huella_sqlite(self) -> None:
        """Un archivo existente con informe rechazado, huella ausente o distinta no se exporta."""
        for cambio in ({"estado": "Con errores"}, {"sha256_sqlite": None}, {"sha256_sqlite": "0" * 64}):
            with self.subTest(cambio=cambio):
                self.guardar_informe({**self.informe, **cambio})
                with self.assertRaises(ValidacionFallida):
                    esco.paquete_esco()


class PruebaRelacionesHuerfanasEsco(unittest.TestCase):
    """Las relaciones de ESCO que citan una competencia ausente se diagnostican con su URI."""

    def test_una_relacion_huerfana_de_esco_dice_cual_es(self) -> None:
        """Una relación que cita una ocupación o competencia ausente es ErrorFuente con su URI, no KeyError."""
        base = sqlite3.connect(":memory:")
        self.addCleanup(base.close)
        base.execute("CREATE TABLE relaciones (ocupacion_uri TEXT, competencia_uri TEXT, tipo TEXT)")
        base.execute("INSERT INTO relaciones VALUES ('o1', 'c-ausente', 'esencial')")
        ocupaciones = {"1234.5": {"uri": "o1", "competencias": []}}
        with self.assertRaisesRegex(ErrorFuente, "c-ausente"):
            esco._anadir_competencias(base, ocupaciones, {"c1": 0})
        esco._anadir_competencias(base, ocupaciones, {"c-ausente": 7})
        self.assertEqual(ocupaciones["1234.5"]["competencias"], [[7, "e"]])


if __name__ == "__main__":
    unittest.main()
