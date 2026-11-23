"""Revisiones locales del legado conservadas en V10: integridad, núcleo y guardas de vigencia."""

import json
import sqlite3
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch

from plataforma_datos.comun.huella_json import sha256_json
from plataforma_datos.cursos import catalogo
from plataforma_datos.cursos import enriquecimiento_legado as enriquecimiento
from plataforma_datos.cursos import registro_vigencia as registro
from plataforma_datos.cursos.herramientas import normalizar_investigacion as normalizador
from plataforma_datos.cursos.pruebas.test_catalogo import lote_base
from plataforma_datos.cursos.pruebas.test_normalizar_investigacion import captura
from plataforma_datos.cursos.pruebas.test_vigencia import OFERTA, ficha, politica
from plataforma_datos.cursos.tipos_json import ObjetoJson

FECHA_LOCAL = "2026-10-23T08:00:00Z"


class EnriquecimientoLegadoPruebas(unittest.TestCase):
    """Las revisiones conservadas se verifican en cada lectura y escritura del catálogo V10."""

    def setUp(self) -> None:
        """Crea un catálogo V10 sintético con datos anteriores de la misma investigación."""
        temporal = tempfile.TemporaryDirectory(prefix="Revisión Año ñ ")
        self.addCleanup(temporal.cleanup)
        self.raiz = Path(temporal.name)
        self.fuentes = captura(self.raiz / "fuentes")
        self.bundle = normalizador.preparar_importacion(self.fuentes)
        self.base = self.raiz / "candidata.sqlite"
        legado = {
            "schema_version": 1,
            "observado_utc": "2026-10-22T23:59:00Z",
            "fuente_lote": "captura-historica",
            **{
                g: [deepcopy(x) for lote in self.bundle["lotes"] for x in lote[g]]
                for g in ("proveedores", "programas", "ediciones")
            },
        }
        for objeto in legado["programas"] + legado["ediciones"]:
            objeto["datos"] = {"literal_heredado": "No borrar de la historia", "plaza_confirmada_persona": None}
        catalogo.cargar_lote(self.base, legado, True, self.fuentes)

    def filas(self, tabla: str) -> list[tuple]:
        """Consulta las filas sintéticas ordenadas.

        Returns:
            Contenido físico comparable, sin modificarlo.
        """
        with sqlite3.connect(self.base) as conexion:
            return conexion.execute('SELECT * FROM "' + tabla + '" ORDER BY rowid').fetchall()

    def conservar_revision(self, sellos: int = 1) -> int:
        """Inserta una revisión local íntegra como las que conserva el catálogo admitido.

        Returns:
            Identidad del primer sello local que la revisión protege.
        """
        manifiesto = {
            "version": 1,
            "metodo": {"id": enriquecimiento.METODO},
            "aplicado_utc": FECHA_LOCAL,
            "bundle_sha256": "a" * 64,
            "historia_sha256": "b" * 64,
            "evidencia_hasta_id": 1,
            "cambios": [{"entidad": "programa", "id": "revisado"}],
        }
        with sqlite3.connect(self.base) as conexion:
            conexion.row_factory = sqlite3.Row
            programa = conexion.execute("SELECT id FROM programas ORDER BY id LIMIT 1").fetchone()[0]
            canales = []
            for _ in range(sellos):
                canal = conexion.execute(
                    "INSERT INTO canales_temporales(entidad,entidad_id,canal,ejecucion_id,instantanea_id,"
                    "huella_negocio) VALUES('programa',?,'revision-local',NULL,NULL,?)",
                    (programa, "c" * 64),
                ).lastrowid
                conexion.execute("INSERT INTO pruebas_temporales VALUES(?,1)", (canal,))
                canales.append(canal)
            documento = {
                "manifiesto": manifiesto,
                "canales_ids": canales,
                "sellos_sha256": enriquecimiento._sellos_actuales(conexion, canales),
            }
            conexion.execute(
                "INSERT INTO revisiones_legado(clave,aplicado_utc,contenido,huella_contenido) VALUES(?,?,?,?)",
                (sha256_json(manifiesto), FECHA_LOCAL, json.dumps(documento), sha256_json(documento)),
            )
        return canales[0]

    def rechazo_intacto(self, sql: str, error: type[Exception], patron: str) -> None:
        """Aplica una corrupción y exige rechazo en lectura y escritura sin tocar la base."""
        with sqlite3.connect(self.base) as conexion:
            conexion.executescript(sql)
        antes = self.base.read_bytes()
        with self.assertRaisesRegex(error, patron):
            registro.listar_ediciones(self.base)
        with self.assertRaisesRegex(error, patron):
            registro.consultar_edicion(self.base, "no_importa")
        with self.assertRaisesRegex(catalogo.ErrorCatalogo, patron):
            catalogo.cargar_lote(self.base, lote_base())
        self.assertEqual(self.base.read_bytes(), antes)

    def test_camino_ordinario_sin_canales_sigue_cerrado(self) -> None:
        """Una entidad heredada sin canales no se reimporta como si fuera una consulta nueva."""
        antes = self.base.read_bytes()
        with self.assertRaisesRegex(catalogo.ErrorTemporal, "entidad_existente_sin_canales"):
            normalizador.importar_captura(self.base, self.fuentes)
        self.assertEqual(self.base.read_bytes(), antes)
        self.assertTrue(catalogo.buscar(self.base, "borrar"))

    def test_revision_integra_no_bloquea_altas_y_un_fallo_revierte_datos_e_indice(self) -> None:
        """La auditoría admite altas legítimas; una interrupción no deja datos ni búsqueda parciales."""
        self.conservar_revision()
        revision = self.filas("revisiones_legado")
        self.assertIsNotNone(registro.listar_ediciones(self.base)["revision"])
        antes = self.base.read_bytes()
        buscar_antes = catalogo.buscar(self.base, "Python")
        actualizar = catalogo._actualizar_indice_programa

        def interrumpir(conexion: sqlite3.Connection, objeto: ObjetoJson) -> None:
            actualizar(conexion, objeto)
            raise RuntimeError("interrupción después del índice")

        with (
            patch.object(catalogo, "_actualizar_indice_programa", side_effect=interrumpir),
            self.assertRaisesRegex(RuntimeError, "interrupción"),
        ):
            catalogo.cargar_lote(self.base, lote_base())
        self.assertEqual(self.base.read_bytes(), antes)
        self.assertEqual(catalogo.buscar(self.base, "Python"), buscar_antes)
        catalogo.cargar_lote(self.base, lote_base())
        versiones = self.filas("versiones")
        catalogo.cargar_lote(self.base, lote_base())
        self.assertEqual(self.filas("versiones"), versiones)
        self.assertEqual(self.filas("revisiones_legado"), revision)
        with sqlite3.connect(self.base) as conexion:
            actuales = conexion.execute("SELECT id,titulo,datos FROM programas ORDER BY id").fetchall()
            indice = conexion.execute("SELECT id,titulo,datos FROM programas_fts ORDER BY id").fetchall()
        self.assertEqual(indice, actuales)

    def test_diario_de_revision_alterado_impide_lecturas_y_altas(self) -> None:
        """Contenido, huella, identidad o fecha alterados no se presentan como revisión válida."""
        self.conservar_revision()
        intacta = self.base.read_bytes()
        for sql, patron in (
            ("UPDATE revisiones_legado SET contenido='{}'", "diario inválido"),
            ("UPDATE revisiones_legado SET huella_contenido='" + "c" * 64 + "'", "diario de revisión alterado"),
            ("UPDATE revisiones_legado SET clave='" + "d" * 64 + "'", "identidad de revisión alterada"),
            ("UPDATE revisiones_legado SET aplicado_utc='2026-10-24T00:00:00Z'", "fecha local alterada"),
        ):
            with self.subTest(sql=sql):
                self.base.write_bytes(intacta)
                self.rechazo_intacto(sql, registro.ErrorRegistroVigencia, patron)

    def test_sello_o_prueba_local_alterados_invalidan_la_revision(self) -> None:
        """La revisión no acepta un sello o una evidencia modificados después de registrarse."""
        canal = self.conservar_revision()
        intacta = self.base.read_bytes()
        for sql in (
            f"UPDATE canales_temporales SET huella_negocio='{'a' * 64}' WHERE id={canal}",
            f"UPDATE evidencias SET sha256='{'b' * 64}' WHERE id=1",
            f"UPDATE canales_temporales SET ejecucion_id=1 WHERE id={canal}",
        ):
            with self.subTest(sql=sql):
                self.base.write_bytes(intacta)
                self.rechazo_intacto(sql, registro.ErrorRegistroVigencia, "Revisión local")

    def test_consulta_no_crece_en_sql_por_numero_de_sellos(self) -> None:
        """Las pruebas compartidas se leen por conjuntos en cada consulta, sin caché."""
        intacta = self.base.read_bytes()
        original = catalogo.abrir_lectura
        recuentos = []
        for sellos in (1, 6):
            self.base.write_bytes(intacta)
            self.conservar_revision(sellos)
            sentencias = []

            def abrir(base: str | Path, sentencias: list[str] = sentencias) -> sqlite3.Connection:
                conexion = original(base)
                conexion.set_trace_callback(sentencias.append)
                return conexion

            with patch.object(catalogo, "abrir_lectura", side_effect=abrir):
                registro.listar_ediciones(self.base, limite=1)
            recuentos.append(len(sentencias))
        self.assertEqual(recuentos[0], recuentos[1])

    def test_tabla_de_revisiones_ausente_o_incompatible_se_rechaza(self) -> None:
        """La tabla obligatoria debe corresponder al esquema comprobado, no a una etiqueta de versión."""
        intacta = self.base.read_bytes()
        for sql, patron in (
            ("DROP TABLE revisiones_legado", "tabla revisiones_legado ausente"),
            (
                "DROP TABLE revisiones_legado; CREATE TABLE revisiones_legado(id INTEGER PRIMARY KEY)",
                "formato de revisiones_legado incompatible",
            ),
        ):
            with self.subTest(sql=sql):
                self.base.write_bytes(intacta)
                self.rechazo_intacto(sql, catalogo.ErrorCatalogo, "Formato V10 no verificable: .*" + patron)
                with self.assertRaisesRegex(catalogo.ErrorCatalogo, patron):
                    catalogo.resumen(self.base)

    def test_nucleo_incompleto_o_alterado_no_se_repara(self) -> None:
        """Un objeto del núcleo ausente o alterado se rechaza en todas las vías, sin completarlo."""
        intacta = self.base.read_bytes()
        for sql in (
            "DROP INDEX etiqueta_actual",
            "DROP TABLE conflictos_etiquetas",
            "DROP TABLE conflictos_etiquetas; CREATE TABLE conflictos_etiquetas(id INTEGER PRIMARY KEY)",
        ):
            with self.subTest(sql=sql):
                self.base.write_bytes(intacta)
                self.rechazo_intacto(sql, catalogo.ErrorCatalogo, "núcleo")
                with self.assertRaisesRegex(catalogo.ErrorCatalogo, "núcleo"):
                    catalogo.resumen(self.base)

    def test_version_distinta_de_v10_no_se_acepta(self) -> None:
        """Ni una versión anterior ni una futura abren el registro o admiten escrituras."""
        intacta = self.base.read_bytes()
        for version in (8, 9, 11):
            with self.subTest(version=version):
                self.base.write_bytes(intacta)
                with sqlite3.connect(self.base) as conexion:
                    conexion.execute(f"PRAGMA user_version={version}")
                antes = self.base.read_bytes()
                with self.assertRaisesRegex(catalogo.ErrorCatalogo, "V10"):
                    registro.consultar_edicion(self.base, "no_importa")
                with self.assertRaisesRegex(catalogo.ErrorCatalogo, "V10"):
                    catalogo.resumen(self.base)
                with self.assertRaisesRegex(catalogo.ErrorCatalogo, "V10"):
                    catalogo.cargar_lote(self.base, lote_base())
                self.assertEqual(self.base.read_bytes(), antes)


class CompatibilidadVigenciaOchoPruebas(unittest.TestCase):
    """El registro de ediciones conserva su historia física y lógica en V10."""

    def test_historia_estable_y_tabla_obligatoria_ausente(self) -> None:
        """Las lecturas no generan comprobaciones nuevas ni toleran una tabla de vigencia ausente."""
        with tempfile.TemporaryDirectory() as temporal:
            base = Path(temporal) / "catálogo.sqlite"
            catalogo.cargar_lote(base, lote_base())
            observacion = ficha()
            observacion["detalle"]["identidad_observada"] = "edicion-1"
            solicitud = registro.SolicitudEvaluacion(
                edicion_id="edicion-1",
                oferta={**OFERTA, "id": "edicion-1"},
                observaciones=[observacion],
                politica=politica(),
                ahora="2026-10-22T10:00:00Z",
            )
            registro.registrar_evaluacion(base, solicitud)
            antes = registro.consultar_edicion(base, "edicion-1")
            historia = registro.historial_decisiones(base, "edicion-1")
            catalogo.cargar_lote(base, lote_base())
            self.assertEqual(registro.consultar_edicion(base, "edicion-1"), antes)
            self.assertEqual(registro.historial_decisiones(base, "edicion-1"), historia)
            with sqlite3.connect(base) as conexion:
                self.assertEqual(
                    conexion.execute("PRAGMA user_version").fetchone()[0], catalogo.VERSION_SQLITE_CONTENIDOS
                )
                conexion.execute("DROP TABLE observaciones_vigencia")
            with self.assertRaisesRegex(catalogo.ErrorCatalogo, "vigencia"):
                registro.consultar_edicion(base, "edicion-1")


if __name__ == "__main__":
    unittest.main()
