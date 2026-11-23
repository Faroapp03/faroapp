"""Regresiones del almacenamiento independiente de variantes, centros y anuncios."""

import sqlite3
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path

from plataforma_datos.cursos import catalogo
from plataforma_datos.cursos.tipos_json import ObjetoJson

type ValorSql = None | int | float | str | bytes


def lote(version: int = 2) -> ObjetoJson:
    """Crea oferta sintética con variantes, centros y anuncios según su versión.

    Returns:
        Lote sintético con la estructura de la versión solicitada.
    """
    resultado = {
        "schema_version": version,
        "observado_utc": "2026-10-22T00:00:00Z",
        "fuente_lote": "oferta-sintetica",
        "proveedores": [
            {"id": "fuente", "nombre": "Publicador", "territorio": None, "naturaleza": None},
            {"id": "impartidor", "nombre": "Centro formador", "territorio": None, "naturaleza": None},
        ],
        "programas": [
            {
                "id": "p1",
                "proveedor_id": "fuente",
                "titulo": "IA",
                "url": "https://example.org/curso",
                "tipo_unidad": "especialidad",
                "datos": {"rol_proveedor": "publicador"},
                "evidencias": [],
                "etiquetas": [],
            }
        ],
        "ediciones": [],
    }
    if version == catalogo.VERSION_LOTE_OFERTA:
        resultado.update(
            {
                "variantes": [{"id": "v1", "programa_id": "p1", "datos": {"modalidad": "en-linea"}, "evidencias": []}],
                "centros": [
                    {"id": "c1", "proveedor_id": "impartidor", "nombre": "Centro 1", "datos": {}, "evidencias": []}
                ],
                "anuncios": [
                    {
                        "id": "a1",
                        "variante_id": "v1",
                        "proveedor_id": "impartidor",
                        "centro_id": "c1",
                        "datos": {"plaza_confirmada": False, "mes_imparticion": "2026-11"},
                        "evidencias": [],
                    }
                ],
            }
        )
    return resultado


class OfertaSeparada(unittest.TestCase):
    """Oferta publicada separada de ediciones y de admisibilidad personal."""

    def setUp(self) -> None:
        """Prepara una candidata aislada y registra su limpieza."""
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name) / "catálogo.sqlite3"

    def filas(self, tabla: str) -> list[tuple[ValorSql, ...]]:
        """Consulta filas de la candidata para comprobar conservación exacta.

        Returns:
            Filas SQL en el orden solicitado por la prueba.
        """
        with sqlite3.connect(self.base) as conexion:
            return conexion.execute("SELECT * FROM " + tabla + " ORDER BY id").fetchall()

    def test_anuncios_no_se_convierten_en_ediciones_y_reimportar_no_duplica(self) -> None:
        """Regresión: anuncios no se convierten en ediciones y reimportar no duplica."""
        entrada = lote()
        catalogo.cargar_lote(self.base, entrada)
        antes = catalogo.resumen(self.base)
        catalogo.cargar_lote(self.base, entrada)
        despues = catalogo.resumen(self.base)
        for nombre in (
            "proveedores",
            "programas",
            "ediciones",
            "variantes",
            "centros",
            "anuncios",
            "versiones",
            "versiones_oferta",
            "evidencias",
        ):
            self.assertEqual(antes[nombre], despues[nombre], nombre)
        self.assertEqual(despues["ediciones"], 0)
        self.assertEqual(despues["anuncios"], 1)

    def test_lote_parcial_no_retira_ni_sustituye_anuncios_hermanos(self) -> None:
        """Regresión: lote parcial no retira ni sustituye anuncios hermanos."""
        primero = lote()
        segundo = deepcopy(primero["anuncios"][0])
        segundo["id"] = "a2"
        primero["anuncios"].append(segundo)
        catalogo.cargar_lote(self.base, primero)
        antes = self.filas("anuncios")[1]
        parcial = lote()
        parcial["observado_utc"] = "2026-10-23T00:00:00Z"
        parcial["proveedores"] = []
        parcial["programas"] = []
        parcial["variantes"] = []
        parcial["centros"] = []
        parcial["anuncios"][0]["datos"]["mes_imparticion"] = "2026-12"
        catalogo.cargar_lote(self.base, parcial)
        self.assertEqual(self.filas("anuncios")[1], antes)
        self.assertEqual(catalogo.resumen(self.base)["versiones_oferta"], 5)

    def test_referencia_ajena_revierte_todo_el_lote(self) -> None:
        """Regresión: referencia ajena revierte todo el lote."""
        catalogo.cargar_lote(self.base, lote())
        antes = self.base.read_bytes()
        malo = lote()
        malo["observado_utc"] = "2026-10-23T00:00:00Z"
        malo["programas"][0]["titulo"] = "No debe quedar"
        malo["anuncios"][0]["variante_id"] = "no-existe"
        with self.assertRaises(catalogo.ErrorCatalogo):
            catalogo.cargar_lote(self.base, malo)
        self.assertEqual(self.base.read_bytes(), antes)

    def test_centro_de_otro_proveedor_no_se_acepta(self) -> None:
        """Regresión: centro de otro proveedor no se acepta."""
        malo = lote()
        malo["anuncios"][0]["proveedor_id"] = "fuente"
        with self.assertRaises(catalogo.ErrorCatalogo):
            catalogo.cargar_lote(self.base, malo)
        if self.base.exists():
            with sqlite3.connect(self.base) as conexion:
                self.assertEqual(
                    conexion.execute("SELECT count(*) FROM sqlite_master WHERE name='anuncios'").fetchone()[0], 0
                )

    def test_anuncio_sin_centro_es_desconocido_y_permite_futuro_enlace(self) -> None:
        """Regresión: anuncio sin centro es desconocido y permite futuro enlace."""
        primero = lote()
        primero["anuncios"][0]["centro_id"] = None
        catalogo.cargar_lote(self.base, primero)
        self.assertIsNone(self.filas("anuncios")[0][3])
        segundo = lote()
        segundo["observado_utc"] = "2026-10-23T00:00:00Z"
        catalogo.cargar_lote(self.base, segundo)
        self.assertEqual(self.filas("anuncios")[0][3], "c1")

    def test_observacion_antigua_se_rechaza_sin_perder_datos(self) -> None:
        """Regresión: observacion antigua se rechaza sin perder datos."""
        catalogo.cargar_lote(self.base, lote())
        antes = self.base.read_bytes()
        viejo = lote()
        viejo["observado_utc"] = "2026-10-21T23:59:59Z"
        with self.assertRaises(catalogo.ErrorCatalogo):
            catalogo.cargar_lote(self.base, viejo)
        self.assertEqual(self.base.read_bytes(), antes)

    def test_contratos_1_y_2_alternados_conservan_oferta_e_integridad(self) -> None:
        """Un lote de contrato 1 posterior no retira la oferta separada del contrato 2."""
        catalogo.cargar_lote(self.base, lote(1))
        tablas = ("proveedores", "programas", "ediciones", "ejecuciones", "observaciones", "versiones")
        anteriores = {tabla: self.filas(tabla) for tabla in tablas}
        catalogo.cargar_lote(self.base, lote())
        for tabla in tablas:
            self.assertEqual(self.filas(tabla)[: len(anteriores[tabla])], anteriores[tabla], tabla)
        catalogo.cargar_lote(self.base, lote(1))
        self.assertEqual(catalogo.resumen(self.base)["anuncios"], 1)
        with sqlite3.connect(self.base) as conexion:
            self.assertEqual(conexion.execute("PRAGMA user_version").fetchone()[0], catalogo.VERSION_SQLITE_CONTENIDOS)
            self.assertEqual(conexion.execute("PRAGMA integrity_check").fetchone()[0], "ok")
            self.assertEqual(conexion.execute("PRAGMA foreign_key_check").fetchall(), [])

    def test_lote_invalido_en_base_inexistente_no_deja_datos(self) -> None:
        """Un lote inválido no crea la base; uno rechazado al cargar no deja ninguna fila."""
        entrada = lote()
        entrada["schema_version"] = 3
        with self.assertRaises(catalogo.ErrorCatalogo):
            catalogo.cargar_lote(self.base, entrada)
        self.assertFalse(self.base.exists())
        entrada = lote()
        entrada["anuncios"][0]["centro_id"] = "centro-ausente"
        with self.assertRaises(catalogo.ErrorCatalogo):
            catalogo.cargar_lote(self.base, entrada)
        if self.base.exists():
            # La creación del esquema se revierte con la carga: no queda ningún objeto del catálogo.
            with sqlite3.connect(self.base) as conexion:
                self.assertEqual(conexion.execute("SELECT count(*) FROM sqlite_master").fetchone()[0], 0)

    def test_evidencias_se_vinculan_a_la_entidad_correcta(self) -> None:
        """Regresión: evidencias se vinculan a la entidad correcta."""
        entrada = lote()
        evidencia = {
            "url": "https://example.org/fuente",
            "capturado_utc": "2026-10-22T00:00:00Z",
            "sha256": "a" * 64,
            "archivo": None,
        }
        for grupo in ("variantes", "centros", "anuncios"):
            entrada[grupo][0]["evidencias"] = [evidencia]
        catalogo.cargar_lote(self.base, entrada)
        catalogo.cargar_lote(self.base, entrada)
        self.assertEqual(catalogo.resumen(self.base)["evidencias"], 1)
        self.assertEqual(len(self.filas("vinculos_evidencia_oferta")), 3)
        with sqlite3.connect(self.base) as conexion:
            self.assertEqual(conexion.execute("SELECT count(*) FROM observaciones_evidencia_oferta").fetchone()[0], 6)

    def test_validacion_rechaza_versiones_duplicados_y_campos_no_declarados(self) -> None:
        """Regresión: validacion rechaza versiones duplicados y campos no declarados."""
        for modificar in (
            lambda d: d.update(schema_version=3),
            lambda d: d["variantes"].append(deepcopy(d["variantes"][0])),
            lambda d: d["centros"][0].update(nombre=""),
            lambda d: d["anuncios"][0].update(centro_id=3),
            lambda d: d["anuncios"][0].update(edicion_confirmada=True),
        ):
            entrada = lote()
            modificar(entrada)
            with self.assertRaises(catalogo.ErrorCatalogo):
                catalogo.validar_lote(entrada)
        antiguo = lote(1)
        antiguo["anuncios"] = []
        with self.assertRaises(catalogo.ErrorCatalogo):
            catalogo.validar_lote(antiguo)


class BordesOferta(unittest.TestCase):
    """Concurrencia, referencias e integridad de las migraciones de oferta."""

    def setUp(self) -> None:
        """Prepara una candidata aislada y registra su limpieza."""
        self.temporal = tempfile.TemporaryDirectory(prefix="regresion-oferta-")
        self.addCleanup(self.temporal.cleanup)
        self.base = Path(self.temporal.name) / "base ñ.sqlite"

    def version(self) -> int:
        """Lee la versión de esquema de la candidata.

        Returns:
            Entero de versión registrado en SQLite.
        """
        with sqlite3.connect(self.base) as con:
            return con.execute("PRAGMA user_version").fetchone()[0]

    def test_cambio_conjunto_centro_y_anuncio_a_otro_proveedor(self) -> None:
        """Regresión: cambio conjunto centro y anuncio a otro proveedor."""
        catalogo.cargar_lote(self.base, lote())
        cambio = lote()
        cambio["observado_utc"] = "2026-10-23T00:00:00Z"
        cambio["centros"][0]["proveedor_id"] = "fuente"
        cambio["anuncios"][0]["proveedor_id"] = "fuente"
        catalogo.cargar_lote(self.base, cambio)
        with sqlite3.connect(self.base) as con:
            self.assertEqual(con.execute("SELECT proveedor_id FROM centros").fetchall(), [("fuente",)])
            self.assertEqual(con.execute("SELECT proveedor_id FROM anuncios").fetchall(), [("fuente",)])
            self.assertEqual(con.execute("PRAGMA foreign_key_check").fetchall(), [])

    def test_cambio_solo_centro_incompatible_revierte_bytes(self) -> None:
        """Regresión: cambio solo centro incompatible revierte bytes."""
        catalogo.cargar_lote(self.base, lote())
        antes = self.base.read_bytes()
        cambio = lote()
        cambio["observado_utc"] = "2026-10-23T00:00:00Z"
        cambio["proveedores"] = []
        cambio["programas"] = []
        cambio["variantes"] = []
        cambio["anuncios"] = []
        cambio["centros"][0]["proveedor_id"] = "fuente"
        with self.assertRaises(catalogo.ErrorCatalogo):
            catalogo.cargar_lote(self.base, cambio)
        self.assertEqual(self.base.read_bytes(), antes)

    def test_tabla_de_oferta_incompatible_revierte_la_importacion(self) -> None:
        """Una tabla de anuncios ajena, con cualquier capitalización, no se adopta al importar oferta."""
        for indice, nombre in enumerate(("anuncios", "ANUNCIOS", "AnUnCiOs")):
            with self.subTest(nombre=nombre):
                base = self.base.with_name(f"colision-{indice}.sqlite")
                catalogo.cargar_lote(base, lote(1))
                with sqlite3.connect(base) as conexion:
                    conexion.execute("DROP TABLE anuncios")
                    conexion.execute(
                        f'CREATE TABLE "{nombre}" (id TEXT PRIMARY KEY,variante_id TEXT,proveedor_id TEXT)'
                    )
                antes = base.read_bytes()
                with self.assertRaises(catalogo.ErrorCatalogo):
                    catalogo.cargar_lote(base, lote())
                self.assertEqual(base.read_bytes(), antes)


if __name__ == "__main__":
    unittest.main()
