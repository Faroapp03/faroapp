"""Un recurso sin edición no permite eludir condiciones de una convocatoria."""

import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from plataforma_datos.cursos import catalogo
from plataforma_datos.cursos import registro_vigencia as registro
from plataforma_datos.cursos.pruebas import test_vigencia_unidades as casos_unidades
from plataforma_datos.cursos.pruebas.test_catalogo import lote_base


class RecursoSinEdicionPruebas(unittest.TestCase):
    """Comprueba cambios de dominio exclusivamente sobre SQLite sintéticas propias."""

    def setUp(self) -> None:
        """Crea una unidad real sin fabricar una edición ni datos de vigencia anteriores."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.base = Path(temporal.name) / "catálogo.sqlite3"
        lote = lote_base()
        lote["ediciones"] = []
        catalogo.cargar_lote(self.base, lote)

    def solicitud(
        self, tipo: registro.TipoUnidad = "recurso", *, cerrada: bool = False
    ) -> registro.SolicitudEvaluacionUnidad:
        """Reutiliza el constructor de entradas, sin importar casos como pruebas nuevas.

        Returns:
            Petición explícita con la identidad nativa y observaciones sintéticas.
        """
        caso = casos_unidades.VigenciaUnidadesPruebas()
        caso.base = self.base
        return caso.solicitud(tipo, cerrada=cerrada)

    def agregar_edicion(self) -> None:
        """Añade una edición publicada mediante el cargador, sin cambiar el programa."""
        lote = lote_base()
        lote["ediciones"][0]["id"] = "programa-1"
        lote["proveedores"] = []
        lote["programas"] = []
        catalogo.cargar_lote(self.base, lote)

    def test_recurso_no_salta_edicion_cerrada_y_no_es_parte_del_dominio(self) -> None:
        """Una convocatoria cerrada no puede ofrecerse por su programa padre."""
        self.agregar_edicion()
        registro.registrar_unidad(self.base, self.solicitud("edicion", cerrada=True))
        antes = self.base.read_bytes()
        with self.assertRaisesRegex(registro.ErrorRegistroVigencia, "programa-1.*ediciones"):
            registro.registrar_unidad(self.base, self.solicitud())
        self.assertEqual(self.base.read_bytes(), antes)
        self.assertEqual(registro.listar_unidades(self.base, tipo="recurso")["unidades"], [])
        self.assertEqual(registro.listar_unidades(self.base, tipo="recurso")["cobertura"]["total_unidades"], 0)
        self.assertEqual(
            registro.consultar_edicion(self.base, "programa-1")["evaluacion"]["resultado"]["estado"],
            "no-disponible-publicamente",
        )

    def test_nueva_edicion_deja_evaluacion_recurso_como_historia_no_acreditada(self) -> None:
        """El dominio cambia aunque el cuerpo y huella del programa sigan idénticos."""
        registro.registrar_unidad(self.base, self.solicitud())
        anterior = registro.consultar_unidad(self.base, tipo="recurso", id="programa-1")
        historia = registro.historial_unidad(self.base, tipo="recurso", id="programa-1")
        revision = registro.listar_unidades(self.base, tipo="recurso")["revision"]
        self.assertEqual(anterior["evaluacion"]["resultado"]["estado"], "disponible-publicamente")
        self.agregar_edicion()
        antes = self.base.read_bytes(), self.base.stat().st_mtime_ns
        actual = registro.consultar_unidad(self.base, tipo="recurso", id="programa-1")
        self.assertEqual(actual["estado_registro"], "no_evaluado")
        self.assertEqual(actual["motivo"], "programa_con_ediciones_requiere_evaluacion_por_edicion")
        self.assertEqual(actual["unidad"], anterior["unidad"])
        self.assertEqual(actual["evaluacion"], anterior["evaluacion"])
        historia_actual = registro.historial_unidad(self.base, tipo="recurso", id="programa-1")
        self.assertEqual(historia_actual["cambios"], historia["cambios"])
        self.assertEqual(historia_actual["siguiente"], historia["siguiente"])
        self.assertEqual(historia_actual["estado_registro"], "no_evaluado")
        pagina = registro.listar_unidades(self.base, tipo="recurso")
        self.assertEqual(pagina["unidades"], [])
        self.assertEqual(pagina["cobertura"]["evaluadas_mismo_contrato"], 0)
        self.assertNotEqual(pagina["revision"], revision)
        registro.auditar_unidades_vigencia(self.base)
        self.assertEqual((self.base.read_bytes(), self.base.stat().st_mtime_ns), antes)

    def test_asociacion_no_representada_no_afirma_cierre(self) -> None:
        """Tener ediciones no prueba cancelación ni acceso independiente al curso general."""
        self.agregar_edicion()
        actual = registro.consultar_unidad(self.base, tipo="recurso", id="programa-1")
        self.assertEqual(actual["estado_registro"], "no_evaluado")
        self.assertEqual(actual["motivo"], "programa_con_ediciones_requiere_evaluacion_por_edicion")
        self.assertIsNone(actual["evaluacion"])

    def test_recurso_sin_datos_normalizados_no_confirma_acceso_por_booleano(self) -> None:
        """R3: ausencia de fechas no equivale a ausencia de contenido contrastable."""
        solicitud = self.solicitud()
        solicitud.observaciones[0]["detalle"]["datos_edicion"] = None
        registro.registrar_unidad(self.base, solicitud)
        resultado = registro.consultar_unidad(self.base, tipo="recurso", id="programa-1")["evaluacion"]["resultado"]
        self.assertEqual(resultado["estado"], "sin-confirmar")
        self.assertIn("ficha_sin_contenido_contrastable", resultado["motivos"])

    def test_diagnostico_contenido_alterado_identifica_tipo_e_id(self) -> None:
        """R4: el rechazo de una página o auditoría permite localizar la fila exacta."""
        self.agregar_edicion()
        original = self.base.read_bytes()
        for tabla, tipo in (("programas", "programa"), ("ediciones", "edicion")):
            self.base.write_bytes(original)
            with sqlite3.connect(self.base) as conexion:
                datos = json.loads(
                    conexion.execute("SELECT datos FROM " + tabla + " WHERE id='programa-1'").fetchone()[0]
                )
                datos["alterado"] = True
                conexion.execute("UPDATE " + tabla + " SET datos=? WHERE id='programa-1'", (json.dumps(datos),))
            antes = self.base.read_bytes()
            with (
                self.subTest(tabla=tabla),
                self.assertRaisesRegex(registro.ErrorRegistroVigencia, tipo + ":programa-1"),
            ):
                registro.auditar_unidades_vigencia(self.base)
            self.assertEqual(self.base.read_bytes(), antes)


if __name__ == "__main__":
    unittest.main()
