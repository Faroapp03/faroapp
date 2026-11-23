"""La caché pura evita recálculo del documento; nunca acredita el estado SQL."""

import json
import sqlite3
import unittest
from contextlib import closing
from unittest.mock import patch

from plataforma_datos.cursos import catalogo
from plataforma_datos.cursos import enriquecimiento_legado as legado
from plataforma_datos.cursos.pruebas import test_enriquecimiento_legado as fixtures

CICLOS_IDENTICOS = 30


class CacheRevisionLegadoPruebas(unittest.TestCase):
    """Revisa igualdad, cambios tras calentamiento y presupuesto sin fuentes remotas."""

    def setUp(self) -> None:
        """Construye una revisión local real sobre los datos sintéticos existentes."""
        self.caso = fixtures.EnriquecimientoLegadoPruebas()
        self.caso.setUp()
        self.addCleanup(self.caso.doCleanups)
        self.caso.conservar_revision()
        legado._resumen_revision_acotado.cache_clear()
        self.addCleanup(legado._resumen_revision_acotado.cache_clear)
        with closing(sqlite3.connect(self.caso.base)) as conexion:
            self.texto = conexion.execute("SELECT contenido FROM revisiones_legado").fetchone()[0]

    def verificar(self) -> None:
        """Comprueba la misma base desde una conexión nueva y cerrada al terminar."""
        with closing(sqlite3.connect(self.caso.base)) as conexion:
            conexion.row_factory = sqlite3.Row
            legado.verificar_esquema(conexion)

    def test_resultado_igual_sin_objetos_mutables_compartidos(self) -> None:
        """El resultado memorizado coincide con el cálculo puro y solo contiene cadenas."""
        esperado = legado._resumir_revision(self.texto.encode())
        self.assertEqual(legado._huellas_revision(self.texto), esperado)
        with patch.object(legado, "verificar_estructura", wraps=legado.verificar_estructura) as estructura:
            for _ in range(CICLOS_IDENTICOS):
                self.verificar()
        self.assertEqual(estructura.call_count, CICLOS_IDENTICOS)
        info = legado._resumen_revision_acotado.cache_info()
        self.assertEqual(info.misses, 1)
        self.assertEqual(info.hits, CICLOS_IDENTICOS)
        self.assertIsInstance(esperado, tuple)
        self.assertTrue(all(isinstance(x, str) for x in esperado))

    def test_cualquier_byte_distinto_invalida_incluso_formato_equivalente(self) -> None:
        """Una serialización distinta no se identifica por ruta, mtime ni huella declarada."""
        self.verificar()
        formateado = json.dumps(json.loads(self.texto), ensure_ascii=False, indent=2)
        self.assertNotEqual(formateado, self.texto)
        with closing(sqlite3.connect(self.caso.base)) as conexion:
            conexion.execute("UPDATE revisiones_legado SET contenido=?", (formateado,))
            conexion.commit()
        self.verificar()
        self.assertEqual(legado._resumen_revision_acotado.cache_info().misses, 2)
        with closing(sqlite3.connect(self.caso.base)) as conexion:
            conexion.execute("UPDATE revisiones_legado SET contenido='{}'")
            conexion.commit()
        with self.assertRaises(catalogo.ErrorCatalogo):
            self.verificar()

    def test_huella_y_fecha_sql_alteradas_rechazan_aunque_documento_esta_en_cache(self) -> None:
        """Los metadatos de la fila no quedan acreditados por el acierto de caché."""
        self.verificar()
        with closing(sqlite3.connect(self.caso.base)) as conexion:
            conexion.execute("UPDATE revisiones_legado SET huella_contenido=?", ("0" * 64,))
            conexion.commit()
        with self.assertRaisesRegex(catalogo.ErrorCatalogo, "diario de revisión alterado"):
            self.verificar()
        huella, _, _ = legado._huellas_revision(self.texto)
        with closing(sqlite3.connect(self.caso.base)) as conexion:
            conexion.execute(
                "UPDATE revisiones_legado SET huella_contenido=?,aplicado_utc='2026-10-22T00:00:00Z'", (huella,)
            )
            conexion.commit()
        with self.assertRaisesRegex(catalogo.ErrorCatalogo, "fecha local alterada"):
            self.verificar()

    def test_sello_sql_alterado_rechaza_con_cache_caliente(self) -> None:
        """Cada acceso relee canales y evidencias actuales de la revisión."""
        self.verificar()
        with closing(sqlite3.connect(self.caso.base)) as conexion:
            conexion.execute("UPDATE canales_temporales SET huella_negocio=? WHERE id=1", ("0" * 64,))
            conexion.commit()
        with self.assertRaisesRegex(catalogo.ErrorCatalogo, "sello o prueba local alterados"):
            self.verificar()
        self.assertGreater(legado._resumen_revision_acotado.cache_info().hits, 0)

    def test_ddl_incompatible_rechaza_con_cache_caliente(self) -> None:
        """El formato de tablas se comprueba antes de usar el resultado puro."""
        self.verificar()
        with closing(sqlite3.connect(self.caso.base)) as conexion:
            conexion.execute("ALTER TABLE revisiones_legado ADD COLUMN libre TEXT")
            conexion.commit()
        with self.assertRaisesRegex(catalogo.ErrorCatalogo, "formato de revisiones_legado incompatible"):
            self.verificar()

    def test_maximo_dos_documentos_acotados_y_grande_no_se_retiene(self) -> None:
        """No crece con las consultas ni retiene documentos superiores al presupuesto."""
        variantes = [self.texto + " " * n for n in range(3)]
        for texto in variantes:
            legado._huellas_revision(texto)
        info = legado._resumen_revision_acotado.cache_info()
        self.assertEqual(info.currsize, legado.MAX_REVISIONES_CACHE)
        self.assertEqual(info.maxsize, legado.MAX_REVISIONES_CACHE)
        self.assertLessEqual(info.maxsize * legado.MAX_REVISION_CACHE_BYTES, 4 * 1024 * 1024)
        with patch.object(legado, "MAX_REVISION_CACHE_BYTES", len(self.texto.encode()) - 1):
            self.assertEqual(legado._huellas_revision(self.texto), legado._resumir_revision(self.texto.encode()))
        self.assertEqual(legado._resumen_revision_acotado.cache_info(), info)


if __name__ == "__main__":
    unittest.main()
