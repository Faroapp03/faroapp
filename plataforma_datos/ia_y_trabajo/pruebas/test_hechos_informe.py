"""Registro editorial, admisión local y fechas: ninguna consulta remota ni almacén del producto."""

import json
import tempfile
import unittest
from dataclasses import replace
from datetime import UTC, date, datetime
from pathlib import Path
from unittest import mock

from plataforma_datos.comun import entrada_salida
from plataforma_datos.comun.nucleo import FormatoInesperado
from plataforma_datos.contratos.fuentes import ErrorDescriptor, cargar_fuente, generar_readme, validar_descriptor
from plataforma_datos.ia_y_trabajo.fuentes.hechos_informe import lector
from plataforma_datos.orquestacion import modulos, reconstruir
from plataforma_datos.orquestacion.estado_de_los_datos import plazo
from plataforma_datos.orquestacion.piezas_de_la_actualizacion import estado_de_las_manuales, fecha_de_la_fuente
from plataforma_datos.orquestacion.planificacion_de_comprobaciones import CONJUNTOS, planificar


class HechosDelInformePruebas(unittest.TestCase):
    """Distingue la validación de estructura de la revisión editorial declarada."""

    def setUp(self) -> None:
        """Cada caso usa archivos propios; el contrato Node se ejecuta realmente."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.raiz = Path(temporal.name)
        self.registro = self.raiz / lector.REGISTRO_RELATIVO
        self.registro.parent.mkdir(parents=True)
        self.registro.write_bytes(lector.REGISTRO.read_bytes())
        parche = mock.patch.object(lector, "REGISTRO", self.registro)
        parche.start()
        self.addCleanup(parche.stop)
        for nombre in ("ORIGINALES", "PREPARADOS", "VALIDADOS"):
            parche = mock.patch.object(entrada_salida, nombre, self.raiz / nombre.lower())
            parche.start()
            self.addCleanup(parche.stop)

    def test_revision_registrada_sin_descarga_y_solo_validar(self) -> None:
        """El plan no concede red ni llama a preparar por registrar una revisión editorial."""
        descriptor = cargar_fuente("hechos_informe", tema="ia_y_trabajo")
        self.assertEqual(descriptor.actualizacion.politica, "redactada")
        self.assertFalse(descriptor.actualizacion.red)
        self.assertEqual(descriptor.actualizacion.renovar_dias, 7)
        conjunto = next(c for c in CONJUNTOS if c.id == lector.FUENTE)
        self.assertEqual(conjunto.operacion, "revision")
        self.assertEqual(conjunto.clase, "editorial")
        self.assertEqual(descriptor.etapas_locales, ("validar",))
        self.assertIn(f"python -m {descriptor.lector} validar", generar_readme(descriptor))
        self.assertNotIn(f"python -m {descriptor.lector} preparar", generar_readme(descriptor))
        self.assertEqual(reconstruir.etapas(True, lector.FUENTE), ("validar",))
        self.assertEqual(reconstruir.etapas(False, lector.FUENTE), ("validar",))
        plan = planificar(datetime(2026, 10, 23, tzinfo=UTC), {}, forzar=True)
        self.assertIn(lector.FUENTE, plan.revisiones)
        self.assertNotIn(lector.FUENTE, plan.fuentes)
        self.assertEqual(modulos.comprobar_registro(), [])

    def test_etapas_documentales_no_conceden_una_operacion_al_productor(self) -> None:
        """Las etapas declaradas se cotejan, nunca se usan para ejecutar nombres del JSON."""
        cargar = modulos.cargar_descriptores

        def alteradas(*, tema: str = "cursos") -> tuple:
            return tuple(
                replace(d, etapas_locales=("preparar", "validar")) if d.id == lector.FUENTE else d
                for d in cargar(tema=tema)
            )

        with mock.patch.object(modulos, "cargar_descriptores", side_effect=alteradas):
            self.assertIn("hechos_informe: etapas locales distintas del registro", modulos.comprobar_registro())
        documento = json.loads((lector.CASA / "fuente.json").read_text())
        for etapas in ([], ["borrar"], ["validar", "validar"], "validar"):
            with self.subTest(etapas=etapas), self.assertRaises(ErrorDescriptor):
                validar_descriptor({**documento, "etapas_locales": etapas})

    def test_admision_real_no_renueva_revision_y_repetir_conserva_su_fecha(self) -> None:
        """Ejecutar Node no se presenta como nueva consulta primaria ni fecha editorial."""
        original = self.registro.read_bytes()
        antes = datetime.now(UTC).date().isoformat()
        lector.validar()
        despues = datetime.now(UTC).date().isoformat()
        carpeta = entrada_salida.carpetas(lector.FUENTE).validado
        informe = json.loads((carpeta / "validacion.json").read_bytes())
        self.assertFalse(informe["comprobacion_remota"])
        revision = informe["revision_editorial"]
        self.assertEqual(
            {k: revision[k] for k in ("fecha_declarada", "vence")},
            {"fecha_declarada": "2026-11-15", "vence": "2026-11-22"},
        )
        # El aviso depende del día de la comprobación, en UTC como en Node: validar no lo renueva ni lo calla.
        self.assertIn(revision["pendiente"], {dia > revision["vence"] for dia in (antes, despues)})
        self.assertEqual(json.loads((carpeta / "hechos_informe.json").read_bytes()), json.loads(original))
        self.assertEqual(entrada_salida.sha256(carpeta / "hechos_informe.json"), informe["conjunto_sha256"])
        lector.validar()
        self.assertEqual(self.registro.read_bytes(), original)
        self.assertEqual(json.loads((carpeta / "validacion.json").read_bytes()), informe)

    def test_rechazo_no_sustituye_la_ultima_admision(self) -> None:
        """Una candidata mal formada falla antes de escribir datos o recibo de admisión."""
        lector.validar()
        carpeta = entrada_salida.carpetas(lector.FUENTE).validado
        antes = {p.name: p.read_bytes() for p in carpeta.iterdir()}
        malo = json.loads(self.registro.read_bytes())
        malo["afirmaciones"]["capacidad"]["porcentaje"] = 101
        self.registro.write_text(json.dumps(malo))
        with self.assertRaises(FormatoInesperado):
            lector.validar()
        self.assertEqual({p.name: p.read_bytes() for p in carpeta.iterdir()}, antes)

    def test_plazo_editorial_debe_coincidir_con_el_registro_comun(self) -> None:
        """No puede conservarse un plazo de panel distinto del usado al construir."""
        candidato = json.loads(self.registro.read_bytes())
        candidato["revision"]["plazo_dias"] = 14
        self.registro.write_text(json.dumps(candidato))
        with self.assertRaisesRegex(FormatoInesperado, "registro común"):
            lector.validar()
        self.assertFalse(entrada_salida.carpetas(lector.FUENTE).validacion.exists())

    def test_fecha_y_plazo_del_estado_salen_de_la_revision_declarada(self) -> None:
        """La observación posterior no rejuvenece la revisión ni la deduce de una fecha prevista."""
        antes = self.registro.read_bytes()
        self.assertEqual(fecha_de_la_fuente(self.raiz, lector.FUENTE), date(2026, 11, 15))
        self.assertEqual(plazo(lector.FUENTE), 7)
        filas = estado_de_las_manuales(self.raiz, date(2026, 11, 23))
        fila = next(f for f in filas if f["fuente"] == lector.FUENTE)
        self.assertEqual(fila["fecha"], "2026-11-15")
        self.assertTrue(fila["renovar"])
        self.assertEqual(self.registro.read_bytes(), antes)


if __name__ == "__main__":
    unittest.main()
