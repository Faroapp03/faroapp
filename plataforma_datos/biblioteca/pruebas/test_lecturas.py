"""El productor editorial conserva bytes y fechas y usa el contrato web existente."""

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from plataforma_datos.biblioteca.fuentes.lecturas import lector
from plataforma_datos.comun import entrada_salida
from plataforma_datos.comun.nucleo import FormatoInesperado, ValidacionFallida
from plataforma_datos.contratos.fuentes import generar_readme

TOTAL_ACTUAL = 75
REVISION = "2026-10-07"
CONSULTA = "2026-10-18"


class PruebaLecturas(unittest.TestCase):
    """Todas las escrituras operativas van a una carpeta temporal propia."""

    def setUp(self) -> None:
        """Copia solo las tres entradas editoriales y aísla preparados y validados."""
        self.temporal = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporal.cleanup)
        self.raiz = Path(self.temporal.name)
        self.casa = self.raiz / "fuente"
        self.casa.mkdir()
        for nombre in ("catalogo.json", "procedencia.json", "fuente.json"):
            shutil.copyfile(lector.CASA / nombre, self.casa / nombre)
        for nombre, archivo in (
            ("CATALOGO", "catalogo.json"),
            ("PROCEDENCIA", "procedencia.json"),
            ("DESCRIPTOR", "fuente.json"),
        ):
            parche = mock.patch.object(lector, nombre, self.casa / archivo)
            parche.start()
            self.addCleanup(parche.stop)
        for nombre in ("PREPARADOS", "VALIDADOS"):
            parche = mock.patch.object(entrada_salida, nombre, self.raiz / nombre.lower())
            parche.start()
            self.addCleanup(parche.stop)
        self.datos = lector.CATALOGO.read_bytes()
        self.destino = self.raiz / "entrega" / "lecturas.json"

    def cambiar_catalogo(self, contenido: object) -> None:
        """Modifica la autoría de prueba y registra su huella sin tocar el catálogo real."""
        entrada_salida.guardar_json(lector.CATALOGO, contenido)
        procedencia = json.loads(lector.PROCEDENCIA.read_text())
        procedencia["sha256"] = entrada_salida.sha256(lector.CATALOGO)
        entrada_salida.guardar_json(lector.PROCEDENCIA, procedencia)

    def ciclo(self) -> None:
        """Prepara y admite localmente las entradas aisladas."""
        lector.preparar()
        lector.validar()

    def test_entrega_actual_identica_byte_a_byte(self) -> None:
        """La nueva casa editorial coincide con la entrega actual de 75 fichas."""
        self.assertEqual(self.datos, (lector.RAIZ / "datos/lecturas.json").read_bytes())
        self.ciclo()
        self.assertEqual(lector.exportar(self.destino), self.destino)
        self.assertEqual(self.destino.read_bytes(), self.datos)
        self.assertEqual(len(json.loads(self.datos)["lecturas"]), TOTAL_ACTUAL)

    def test_repetir_no_reescribe_ni_renueva_fechas(self) -> None:
        """Cambiar el reloj no rejuvenece revisión, consultas ni admisión idéntica."""
        with mock.patch.object(lector, "ahora_utc", return_value="2026-10-22T00:00:00+00:00"):
            self.ciclo()
            lector.exportar(self.destino)
        rutas = (
            lector.carpetas(lector.FUENTE).preparado / "lecturas.json",
            lector.carpetas(lector.FUENTE).validado / "lecturas.json",
            lector.carpetas(lector.FUENTE).validacion,
            self.destino,
        )
        antes = [(p.read_bytes(), p.stat().st_mtime_ns) for p in rutas]
        with mock.patch.object(lector, "ahora_utc", return_value="2099-01-01T00:00:00+00:00"):
            self.ciclo()
            lector.exportar(self.destino)
        self.assertEqual(antes, [(p.read_bytes(), p.stat().st_mtime_ns) for p in rutas])
        datos = json.loads(self.destino.read_bytes())
        self.assertEqual(datos["revisado"], REVISION)
        self.assertEqual({x["consultado"] for x in datos["lecturas"]}, {CONSULTA})
        informe = json.loads(rutas[2].read_bytes())
        self.assertEqual(informe["revision_editorial"]["estado"], "vigencia_no_acreditada_revision_pendiente")
        self.assertFalse(informe["comprobacion_remota"])

    def test_fuente_invalida_no_publica(self) -> None:
        """Una identidad de descriptor equivocada no admite ni prepara datos."""
        d = json.loads(lector.DESCRIPTOR.read_bytes())
        d["id"] = "otra"
        entrada_salida.guardar_json(lector.DESCRIPTOR, d)
        with self.assertRaises(FormatoInesperado):
            lector.preparar()
        self.assertFalse(lector.carpetas(lector.FUENTE).preparado.exists())

    def test_ids_duplicados_rechazados_por_contrato_ts(self) -> None:
        """La guarda compartida de referencias rechaza IDs repetidos."""
        d = json.loads(self.datos)
        d["lecturas"].append(d["lecturas"][0])
        self.cambiar_catalogo(d)
        with self.assertRaisesRegex(FormatoInesperado, "repetido"):
            lector.preparar()

    def test_idiomas_y_tipos_no_tienen_contrato_python_alternativo(self) -> None:
        """Idiomas y tipos inválidos los decide el validador TypeScript real."""
        for campo, valor, motivo in (
            ("idiomas", ["en"], "castellano ni en catalán"),
            ("tipo", "cartel", "forma esperada"),
        ):
            d = json.loads(self.datos)
            d["lecturas"][0][campo] = valor
            self.cambiar_catalogo(d)
            with self.subTest(campo=campo), self.assertRaisesRegex(FormatoInesperado, motivo):
                lector.preparar()

    def test_preparado_alterado_no_se_admite(self) -> None:
        """Validar no usa datos preparados distintos de los editoriales."""
        lector.preparar()
        (lector.carpetas(lector.FUENTE).preparado / "lecturas.json").write_bytes(b"{}")
        with self.assertRaises(ValidacionFallida):
            lector.validar()

    def test_validado_alterado_no_se_exporta(self) -> None:
        """Una admisión antigua no permite exportar bytes manipulados."""
        self.ciclo()
        (lector.carpetas(lector.FUENTE).validado / "lecturas.json").write_bytes(b"{}")
        with self.assertRaises(ValidacionFallida):
            lector.exportar(self.destino)
        self.assertFalse(self.destino.exists())

    def test_descriptor_cambiado_exige_revalidar(self) -> None:
        """Incluso un cambio válido de contrato invalida la admisión anterior."""
        self.ciclo()
        d = json.loads(lector.DESCRIPTOR.read_bytes())
        d["significado"] += " Revisión editorial."
        entrada_salida.guardar_json(lector.DESCRIPTOR, d)
        with self.assertRaises(ValidacionFallida):
            lector.exportar(self.destino)
        self.ciclo()
        lector.exportar(self.destino)
        self.assertEqual(self.destino.read_bytes(), self.datos)

    def test_catalogo_cambiado_sin_preparar_no_reutiliza_admision(self) -> None:
        """La procedencia nueva tampoco admite automáticamente el conjunto antiguo."""
        self.ciclo()
        d = json.loads(self.datos)
        d["descripcion"] += " Revisión."
        self.cambiar_catalogo(d)
        with self.assertRaises(ValidacionFallida):
            lector.exportar(self.destino)

    def test_huella_editorial_incorrecta(self) -> None:
        """Cambiar el catálogo sin actualizar su procedencia se rechaza."""
        lector.CATALOGO.write_bytes(self.datos + b" ")
        with self.assertRaises(FormatoInesperado):
            lector.preparar()

    def test_reemplazo_fallido_conserva_entrega_anterior(self) -> None:
        """Un fallo al sustituir no deja una entrega parcial ni elimina la anterior."""
        self.ciclo()
        self.destino.parent.mkdir()
        self.destino.write_bytes(b"entrega anterior")
        with (
            mock.patch.object(Path, "replace", side_effect=OSError("disco")),
            self.assertRaisesRegex(OSError, "disco"),
        ):
            lector.exportar(self.destino)
        self.assertEqual(self.destino.read_bytes(), b"entrega anterior")
        self.assertEqual(list(self.destino.parent.iterdir()), [self.destino])

    def test_timeout_node_da_motivo_y_no_publica(self) -> None:
        """El proceso local tiene plazo y no usa shell."""
        with (
            mock.patch.object(lector.subprocess, "run", side_effect=subprocess.TimeoutExpired("node", 1)),
            self.assertRaisesRegex(FormatoInesperado, "plazo"),
        ):
            lector.preparar()
        self.assertFalse(self.destino.exists())

    def test_revision_desconocida_sigue_pendiente_sin_fecha_inventada(self) -> None:
        """Una fecha desconocida explícita no toma el día de ejecución ni fechas de otras lecturas."""
        d = json.loads(self.datos)
        del d["revisado"]
        self.cambiar_catalogo(d)
        procedencia = json.loads(lector.PROCEDENCIA.read_text())
        procedencia["revision_declarada"] = None
        entrada_salida.guardar_json(lector.PROCEDENCIA, procedencia)
        self.ciclo()
        lector.exportar(self.destino)
        informe = json.loads(lector.carpetas(lector.FUENTE).validacion.read_bytes())
        self.assertIsNone(informe["revision_editorial"]["fecha_declarada"])
        self.assertEqual(informe["revision_editorial"]["estado"], "vigencia_no_acreditada_revision_pendiente")
        self.assertNotIn("revisado", json.loads(self.destino.read_bytes()))

    def test_readme_generado_y_operacion_editorial(self) -> None:
        """La documentación nace del descriptor y no habilita red o cadencia inventada."""
        descriptor = lector.descriptor()
        self.assertEqual((lector.CASA / "README.md").read_text(), generar_readme(descriptor))
        self.assertFalse(descriptor.actualizacion.red)
        self.assertIsNone(descriptor.actualizacion.renovar_dias)
        self.assertTrue(all(c.intervalo_dias is None for c in descriptor.conjuntos))


if __name__ == "__main__":
    unittest.main()
