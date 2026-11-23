"""La llegada tardía se conserva sin resucitar hechos ni fingir aplicación actual."""

import copy
import json
import sqlite3
import unittest
from dataclasses import replace
from unittest.mock import patch

from plataforma_datos.comun.huella_json import sha256_json
from plataforma_datos.cursos import almacen_catalogo, almacen_vigencia
from plataforma_datos.cursos import registro_vigencia as registro
from plataforma_datos.cursos.fuentes.claude_academy import actualizacion as academy
from plataforma_datos.cursos.pruebas import test_academy_actualizacion as flujo
from plataforma_datos.cursos.pruebas import test_vigencia_unidades as unidades


class LlegadasAcademyPruebas(unittest.TestCase):
    """Composición y registro reales con recepciones sintéticas, sin ninguna red."""

    def test_backfill_no_cachea_actual_y_siguiente_ciclo_conserva_todas_las_observaciones(self) -> None:
        """El segundo corte es menor; el tercero incorpora la historia llegada tarde."""
        caso = flujo.AcademyActualizacionPruebas()
        caso.setUp()
        self.addCleanup(caso.doCleanups)
        caso.componer("2026-10-23T10:05:00Z")
        with (
            patch.object(academy, "firma", return_value="b" * 64),
            patch.object(academy.puente, "METODO", "interpretacion-tardia-1"),
        ):
            caso.componer("2026-10-23T10:04:00Z")
        area = caso.raiz / almacen_catalogo.RUTA
        control_dato = json.loads((area / almacen_catalogo.CONTROL).read_bytes())
        recibo = almacen_catalogo.leer_documento(area, control_dato["procedencia"]["recibo-academy"])
        self.assertTrue(all(not r["evaluacion"]["actual"] for r in recibo["resultados"]))
        self.assertNotEqual(control_dato["aplicados_por_fuente"]["claude_academy"], "b" * 64)
        caso.rx.ciclo()
        with patch.object(academy, "firma", return_value="c" * 64):
            caso.componer("2026-10-23T10:06:00Z")
            actual = registro.consultar_unidad(area / "catalogo.sqlite3", tipo="recurso", id=flujo.ID)
            observadas = actual["evaluacion"]["entradas"]["observaciones"]
            self.assertEqual(len(observadas), 3)
            self.assertTrue(any(o["id"].startswith("interpretacion-tardia-1:") for o in observadas))
            fijo = caso.inventario()
            caso.componer("2026-10-23T10:06:00Z")
            self.assertEqual(caso.inventario(), fijo)

    def test_repetir_readmision_historica_pendiente_no_la_cachea_como_actual(self) -> None:
        """La ausencia de evaluación es pendiente, nunca confirmación actual por vacío."""
        caso = flujo.AcademyActualizacionPruebas()
        caso.setUp()
        self.addCleanup(caso.doCleanups)
        caso.componer("2026-10-23T10:05:00Z")
        area = caso.raiz / almacen_catalogo.RUTA
        with (
            patch.object(academy, "firma", return_value="b" * 64),
            patch.object(academy, "_cargar", return_value="contrato_pendiente") as cargar,
        ):
            for _ in range(2):
                caso.componer("2026-10-23T10:04:00Z")
                control = json.loads((area / almacen_catalogo.CONTROL).read_bytes())
                recibo = almacen_catalogo.leer_documento(area, control["procedencia"]["recibo-academy"])
                self.assertTrue(all(r["evaluacion"] is None for r in recibo["resultados"]))
                self.assertNotEqual(control["aplicados_por_fuente"]["claude_academy"], "b" * 64)
            self.assertEqual(cargar.call_count, 2 * len(recibo["resultados"]))

    def test_relectura_de_publico_respeta_historia_y_solo_la_consulta_posterior_confirma(self) -> None:
        """Dos interpretaciones conservan fecha y recibo; la consulta siguiente puede confirmar la apertura."""
        caso = flujo.AcademyActualizacionPruebas()
        caso.setUp()
        self.addCleanup(caso.doCleanups)
        caso.rx.condiciones = (
            "<article><p>This course helps builders develop practical skills.</p></article>"
            "<h2>Prerequisites</h2><p>No prior experience required.</p>"
        )
        caso.rx.ciclo()
        base = caso.raiz / almacen_catalogo.RUTA / "catalogo.sqlite3"
        with (
            patch.object(academy.lector, "_destinatarios_de_descripcion", return_value=None),
            patch.object(academy.puente, "METODO", "academy-oferta-publicada-continua:5"),
            patch.object(academy, "firma", side_effect=lambda conjunto: sha256_json(["v5", conjunto])),
        ):
            _, dto = caso.componer()
        self.assertNotIn(flujo.ID, {o["unidad"]["id"] for o in dto["ofertas"]})
        previa = registro.consultar_unidad(base, tipo="recurso", id=flujo.ID)["evaluacion"]
        llamadas = list(caso.rx.llamadas)
        _, dto = caso.componer("2026-10-23T10:06:00Z")
        releida = registro.consultar_unidad(base, tipo="recurso", id=flujo.ID)["evaluacion"]
        self.assertIn("fichas_simultaneas_discrepantes", releida["resultado"]["motivos"])
        self.assertNotIn(flujo.ID, {o["unidad"]["id"] for o in dto["ofertas"]})
        viejas = previa["entradas"]["observaciones"]
        actuales = {o["id"]: o for o in releida["entradas"]["observaciones"]}
        self.assertTrue(all(actuales[o["id"]] == o for o in viejas))
        nuevas = [o for id, o in actuales.items() if id not in {v["id"] for v in viejas}]
        self.assertEqual(len(nuevas), 1)
        anterior = max(viejas, key=lambda o: o["terminado_el"])
        self.assertEqual(nuevas[0]["terminado_el"], anterior["terminado_el"])
        self.assertEqual(nuevas[0]["evidencias"][0], anterior["evidencias"][0])
        self.assertEqual(releida["resultado"]["comprobado_el"], previa["resultado"]["comprobado_el"])
        repetida = caso.inventario()
        caso.componer("2026-10-23T10:06:00Z")
        self.assertEqual(caso.inventario(), repetida)
        self.assertEqual(caso.rx.llamadas, llamadas)
        caso.rx.ciclo()
        _, dto = caso.componer("2026-10-23T10:07:00Z")
        self.assertIn(flujo.ID, {o["unidad"]["id"] for o in dto["ofertas"]})
        posterior = registro.consultar_unidad(base, tipo="recurso", id=flujo.ID)["evaluacion"]
        self.assertGreater(posterior["resultado"]["comprobado_el"], releida["resultado"]["comprobado_el"])
        self.assertTrue(actuales.keys() < {o["id"] for o in posterior["entradas"]["observaciones"]})


class ObservacionesCausalesPruebas(unittest.TestCase):
    """Consulta acotada y verificada, sin expandir evaluaciones históricas."""

    def setUp(self) -> None:
        """Prepara dos dominios con igual ID y una llegada histórica posterior."""
        self.caso = unidades.VigenciaUnidadesPruebas()
        self.caso.setUp()
        self.addCleanup(self.caso.doCleanups)
        self.base = self.caso.base
        self.solicitud = self.caso.solicitud(cerrada=True)
        self.cerrada = self.mover(self.solicitud.observaciones[0], "2026-10-22T09:30:00Z", "cerrada")
        registro.registrar_unidad(self.base, replace(self.solicitud, observaciones=[self.cerrada]))
        anterior = self.caso.solicitud().observaciones[0]
        self.antigua = self.mover(anterior, "2026-10-22T08:00:00Z", "abierta-antigua")
        registro.registrar_unidad(
            self.base, replace(self.solicitud, observaciones=[self.antigua], ahora="2026-10-22T09:00:00Z")
        )

    @staticmethod
    def mover(observacion: dict, fecha: str, id: str) -> dict:
        """Cambia solo el reloj/ID sintéticos y sus capturas coherentes.

        Returns:
            Observación independiente, sin reescribir la anterior.
        """
        copia = copy.deepcopy(observacion)
        copia.update(id=id, intentado_el=fecha, terminado_el=fecha)
        for e in copia["evidencias"]:
            e["capturado_utc"] = fecha
        return copia

    def test_llegada_desordenada_no_resucita_estado_antiguo_y_filtra_futuro(self) -> None:
        """La autoridad es el intervalo observado, no la fecha de incorporación al almacén."""
        datos = registro.observaciones_hasta(self.base, tipo="recurso", id="programa-1", corte="2026-10-22T11:00:00Z")
        self.assertEqual({o["id"] for o in datos}, {"cerrada", "abierta-antigua"})
        solicitud = replace(self.solicitud, observaciones=datos, ahora="2026-10-22T11:00:00Z")
        registro.registrar_unidad(self.base, solicitud)
        actual = registro.consultar_unidad(self.base, tipo="recurso", id="programa-1")["evaluacion"]["resultado"]
        self.assertEqual(actual["estado"], "no-disponible-publicamente")
        self.assertEqual(actual["ultimo_intento_el"], "2026-10-22T09:30:00Z")
        futura = self.mover(self.antigua, "2026-10-22T12:00:00Z", "abierta-futura")
        registro.registrar_unidad(
            self.base, replace(solicitud, observaciones=[*datos, futura], ahora="2026-10-22T13:00:00Z")
        )
        self.assertEqual(
            registro.observaciones_hasta(self.base, tipo="recurso", id="programa-1", corte=solicitud.ahora), datos
        )

    def test_lectura_por_unidad_no_expande_evaluaciones_y_repite_bytes_sin_escritura(self) -> None:
        """Decodifica cada cuerpo único causal una vez, sin consultar otras ediciones/unidades."""
        registro.registrar_unidad(self.base, self.caso.solicitud("edicion"))
        antes = self.base.read_bytes(), self.base.stat().st_mtime_ns
        with (
            patch.object(
                registro, "contenido_verificado_de_evaluacion", side_effect=AssertionError("No expandir evaluaciones")
            ),
            patch.object(
                almacen_vigencia, "leer_observacion_verificada", wraps=almacen_vigencia.leer_observacion_verificada
            ) as leer,
        ):
            datos = registro.observaciones_hasta(
                self.base, tipo="recurso", id="programa-1", corte="2026-10-22T11:00:00Z"
            )
        self.assertEqual(leer.call_count, len(datos))
        self.assertEqual(len(datos), 2)
        self.assertEqual((self.base.read_bytes(), self.base.stat().st_mtime_ns), antes)
        with sqlite3.connect(self.base) as conexion:
            plan = conexion.execute(
                "EXPLAIN QUERY PLAN SELECT * FROM observaciones_vigencia WHERE unidad_clave=? AND hasta_us<=?",
                ('["recurso","programa-1"]', almacen_vigencia.corte("2026-10-22T11:00:00Z")),
            ).fetchall()
        self.assertTrue(any("SEARCH" in p[3] and "unidad_clave=?" in p[3] for p in plan))


if __name__ == "__main__":
    unittest.main()
