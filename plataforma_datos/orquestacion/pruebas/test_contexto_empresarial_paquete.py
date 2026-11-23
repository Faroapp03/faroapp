"""Proyección de la encuesta admitida: valores, población, edición y procedencia propios."""

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from plataforma_datos.comun.nucleo import Carpetas, FormatoInesperado, ValidacionFallida
from plataforma_datos.orquestacion.exportacion import contexto_empresarial as contexto
from plataforma_datos.orquestacion.exportacion.comun import escribir


class ContextoEmpresarialPaquete(unittest.TestCase):
    """La exportación no crea una serie ni mezcla la encuesta con ocupaciones o Eurostat."""

    def setUp(self) -> None:
        """Crea solo entradas sintéticas en un temporal propio."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.raiz = Path(temporal.name)
        self.carpetas = Carpetas(self.raiz / "originales", self.raiz / "preparados", self.raiz / "validados")
        self.carpetas.original.mkdir()
        self.carpetas.validado.mkdir()
        self.datos = {
            "fuentes": {"ine": "INE, edición de prueba", "eurostat": "Otra fuente"},
            "vigencia": {"periodo": "2031-T1", "publicado": None, "siguiente_prevista": None},
            "encuesta": {
                "edicion": "2030–1T2031",
                "medida": "Pregunta D.1 de prueba",
                "poblacion": "Base publicada",
                "periodo": "Primer trimestre",
                "error": "No es un intervalo de D.1",
                "denominador": "empresas con conexión a Internet",
                "clasificacion": "CNAE-2025",
                "ruptura": "Ruptura declarada",
                "ambito_ine_cnae2025": {"nota": "Ámbito literal"},
            },
            "cataluna": {"total": 35.7, "sectores": {"No exportar": 99}},
            "eurostat": {"periodo": "2025", "pct": 24.04},
            "plantilla_tic": {"filas": ["No exportar"]},
        }
        self.procedencia = {"edicion": {"anio": 2031, "nombre": "2030–1T2031"}, "archivos": []}
        for nombre in ("ine-eticce-2031-comunidades.json", "ine-eticce-2031-comunidades-notas.html"):
            (self.carpetas.original / nombre).write_text("captura sintética", encoding="utf-8")
            self.procedencia["archivos"].append(
                {
                    "archivo": nombre,
                    "url": "https://example.org/tabla",
                    "sha256": "a" * 64,
                    "descargado_utc": "2031-10-22T08:00:00Z",
                }
            )
        for p in [
            self.carpetas.original / "procedencia.json",
            self.carpetas.validado / "empresas.json",
            self.carpetas.validacion,
        ]:
            p.write_text("{}", encoding="utf-8")
        for nombre, valor in [
            ("leer_validado", lambda _: self.datos),
            ("procedencia", lambda _: self.procedencia),
            ("original", lambda _, n: self.carpetas.original / n),
            ("carpetas", lambda _: self.carpetas),
            ("ruta_del_conjunto", lambda fuente: self.carpetas.validado / f"{fuente}.json"),
        ]:
            self.enterContext(patch.object(contexto, nombre, valor))

    def test_conserva_base_cifras_y_periodo_sin_series_o_cruces(self) -> None:
        """La edición y el porcentaje dependen de la entrada, no de constantes de presentación."""
        paquete = contexto.paquete_empresas()
        self.assertEqual(paquete.datos["cataluna"], {"total": 35.7})
        self.assertEqual(paquete.datos["vigencia"], self.datos["vigencia"])
        self.assertEqual(paquete.datos["encuesta"]["denominador"], self.datos["encuesta"]["denominador"])
        self.assertEqual(paquete.datos["encuesta"]["ambito"], "Ámbito literal")
        for grupo in ("eurostat", "plantilla_tic", "paso", "cobertura_de_los_grupos"):
            self.assertNotIn(grupo, paquete.datos)
        self.assertEqual([c["tipo"] for c in paquete.datos["capturas"]], ["tabla", "notas"])
        self.assertEqual(
            [{k: v for k, v in c.items() if k != "tipo"} for c in paquete.datos["capturas"]],
            self.procedencia["archivos"],
        )
        self.datos["cataluna"]["total"] = None
        self.assertIsNone(contexto.paquete_empresas().datos["cataluna"]["total"])

    def test_origenes_se_vinculan_al_manifiesto_sin_modificar_capturas(self) -> None:
        """Los bytes de salida y de todas sus entradas quedan identificados por la escritura común."""
        paquete = contexto.paquete_empresas()
        antes = {p: p.read_bytes() for p in paquete.origenes}
        destino = self.raiz / "salida"
        destino.mkdir()
        entrada = escribir("empresas.json", paquete, destino, formato="compacto")
        self.assertEqual(len(entrada["origenes"]), len(antes))
        self.assertEqual(len(entrada["sha256"]), 64)
        self.assertEqual(json.loads((destino / "empresas.json").read_text()), paquete.datos)
        self.assertEqual(antes, {p: p.read_bytes() for p in paquete.origenes})

    def test_ediciones_distintas_no_se_mezclan(self) -> None:
        """La procedencia de otra tabla no puede acreditar el dato admitido."""
        self.procedencia["edicion"]["nombre"] = "otra edición"
        with self.assertRaises(FormatoInesperado):
            contexto.paquete_empresas()

    def test_fallo_de_admision_se_propaga_sin_producir_paquete(self) -> None:
        """Un informe con errores no se sustituye por datos de otra fuente ni por cero."""
        with (
            patch.object(contexto, "leer_validado", side_effect=ValidacionFallida("sin admisión")),
            self.assertRaisesRegex(ValidacionFallida, "sin admisión"),
        ):
            contexto.paquete_empresas()


class ContextoSectorialPaquete(unittest.TestCase):
    """La proyección conserva el censo como población independiente de la encuesta empresarial."""

    def test_conserva_remisiones_minimos_y_resto_sin_mezclar_territorios(self) -> None:
        """Las referencias y los porcentajes publicados se conservan, sin crear filas de personas residuales."""
        cataluna = {
            "nombre": "Cataluña",
            "cno3": {"141": {"personas": 400, "ver_cno2": "14"}},
            "cno2": {"14": {"personas": 1200, "sectores": [["55", 60.1, 721]], "otros_pct": 39.9}},
        }
        datos = {
            "fuentes": {"sectores": "Censo de prueba"},
            "vigencia": {"periodo": "2021-01-01"},
            "fecha_de_referencia": "1 de enero de 2021",
            "lugar": "lugar de trabajo",
            "min_personas_sector": 100,
            "min_pct_sector": 3.0,
            "min_personas_grupo": 1000,
            "actividades": {"55": "Alojamiento"},
            "territorios": {"cataluna": cataluna, "barcelona": {"No exportar": True}},
        }
        antes = json.dumps(datos, sort_keys=True)
        with patch.object(contexto, "leer_validado", return_value=datos):
            paquete = contexto.paquete_sectores()
        self.assertEqual(paquete.datos["cataluna"], cataluna)
        self.assertEqual(paquete.datos["clasificacion_actividad"], "CNAE-2009")
        self.assertEqual(paquete.datos["clasificacion_ocupacion"], "CNO-11")
        self.assertEqual(paquete.datos["vigencia"], datos["vigencia"])
        self.assertNotIn("barcelona", paquete.datos)
        self.assertNotIn("empresas", paquete.datos)
        self.assertEqual(json.dumps(datos, sort_keys=True), antes)

    def test_sector_no_admitido_no_produce_paquete(self) -> None:
        """La lectura no convierte una validación fallida en un contexto vacío publicado."""
        with (
            patch.object(contexto, "leer_validado", side_effect=ValidacionFallida("sin admisión")),
            self.assertRaisesRegex(ValidacionFallida, "sin admisión"),
        ):
            contexto.paquete_sectores()
