"""Capturas sintéticas: procedencia temporal, sin red ni SQLite ajeno."""

from __future__ import annotations

import hashlib
import json
import sqlite3
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path

from plataforma_datos.cursos import catalogo
from plataforma_datos.cursos.herramientas import normalizar_investigacion as normalizador
from plataforma_datos.cursos.tipos_json import ValorJson


def guardar(ruta: Path, dato: ValorJson) -> None:
    """Escribe el documento sintético conservando sus valores JSON."""
    ruta.write_text(json.dumps(dato, ensure_ascii=False), encoding="utf-8")


def captura(
    raiz: Path, dia_a: int = 22, dia_b: int = 22, titulo_a: str = "Curso A", dia_condiciones: int | None = None
) -> Path:
    """Crea las fichas y evidencias sintéticas de investigación.

    Returns:
        Datos sintéticos de la prueba.
    """
    otras = raiz / "fuentes-investigadas/otras-entidades"
    uni = raiz / "fuentes-investigadas/universidades"
    otras.mkdir(parents=True)
    uni.mkdir(parents=True)
    pruebas, fichas = [], []
    for ident, dia, titulo in [("a", dia_a, titulo_a), ("b", dia_b, "Curso B")]:
        url = "https://learn.microsoft.com/es-es/training/modules/" + ident
        p = otras / (ident + ".html")
        p.write_text("<h1>" + titulo + "</h1>")
        pruebas.append(
            {
                "url": url,
                "utc": f"2026-10-{dia:02d}T00:00:01+00:00",
                "archivo": p.name,
                "sha256": hashlib.sha256(p.read_bytes()).hexdigest(),
            }
        )
        fichas.append({"url": url, "titulo": titulo})
    if dia_condiciones is not None:
        url = "https://learn.microsoft.com/es-es/training/support/faq"
        p = otras / "condiciones.html"
        p.write_text("Condiciones publicadas")
        pruebas.append(
            {
                "url": url,
                "utc": f"2026-10-{dia_condiciones:02d}T00:00:01+00:00",
                "archivo": p.name,
                "sha256": hashlib.sha256(p.read_bytes()).hexdigest(),
            }
        )
        fichas[0]["fuente_gratuidad"] = url
    guardar(otras / "manifest-capturas.json", pruebas)
    for n in ["capturas-nuevas.json", "ampliacion-capturas.json", "territorio-capturas.json"]:
        guardar(otras / n, [])
    guardar(otras / "fichas-verificadas.json", {"fichas": fichas})
    guardar(otras / "ampliacion-tecnologia.json", {"disponibles_saps": [], "ediciones_regionales_condicionadas": []})
    guardar(otras / "mentor-12-cursos.json", {"cursos": []})
    guardar(otras / "cursos-territoriales.json", {"cursos_con_ficha_y_condiciones": []})
    guardar(uni / "informe-ia-universidades.json", {"resultados": []})
    guardar(
        uni / "informe-tecnologia-andalucia-valencia.json",
        {"universidad_granada": [], "upv_cursos_tecnologia_audit_parcial": []},
    )
    return raiz


class NormalizadorTemporalTest(unittest.TestCase):
    """Regresiones offline de identidad, procedencia y conservación temporal."""

    def setUp(self) -> None:
        """Prepara datos sintéticos en una carpeta exclusiva, sin red."""
        self.temporal = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporal.cleanup)
        self.raiz = Path(self.temporal.name)
        self.base = self.raiz / "candidata.sqlite"

    def test_dos_fichas_no_comparten_max_ni_min_y_rollback_exacto(self) -> None:
        """Comprueba dos fichas no comparten max ni min y rollback exacto."""
        nuevo = captura(self.raiz / "nuevo")
        normalizador.importar_captura(self.base, nuevo)
        antiguo = captura(self.raiz / "mixto", 21, 23, "Título antiguo")
        antes = self.base.read_bytes()
        with self.assertRaises(catalogo.ErrorTemporal):
            normalizador.importar_captura(self.base, antiguo)
        self.assertEqual(self.base.read_bytes(), antes)

    def test_a1_b3_a_a2_b2_no_retrocede_b_ni_deja_a_parcial(self) -> None:
        """Comprueba A1 B3 a A2 B2 no retrocede B ni deja A parcial."""
        inicial = captura(self.raiz / "A1B3", 21, 23)
        normalizador.importar_captura(self.base, inicial)
        intermedio = captura(self.raiz / "A2B2", 22, 22, "Cambio A")
        antes = self.base.read_bytes()
        with self.assertRaises(catalogo.ErrorTemporal):
            normalizador.importar_captura(self.base, intermedio)
        self.assertEqual(self.base.read_bytes(), antes)

    def test_condiciones_posteriores_no_rejuvenecen_ficha_antigua(self) -> None:
        """Comprueba condiciones posteriores no rejuvenecen ficha antigua."""
        inicial = captura(self.raiz / "inicial", dia_condiciones=22)
        normalizador.importar_captura(self.base, inicial)
        mezcla = captura(self.raiz / "auxiliar", 21, 23, "Antiguo", 23)
        antes = self.base.read_bytes()
        with self.assertRaises(catalogo.ErrorTemporal):
            normalizador.importar_captura(self.base, mezcla)
        self.assertEqual(self.base.read_bytes(), antes)

    def test_entrada_repetida_conserva_negocio_y_fechas_reales(self) -> None:
        """Comprueba entrada repetida conserva negocio y fechas reales."""
        origen = captura(self.raiz / "inicial", 21, 23, dia_condiciones=22)
        preparado = normalizador.preparar_importacion(origen)
        antes = deepcopy(preparado)
        normalizador.importar_captura(self.base, origen)
        resumen = catalogo.resumen(self.base)
        normalizador.importar_captura(self.base, origen)
        for tabla in ["programas", "ediciones", "versiones", "evidencias"]:
            self.assertEqual(catalogo.resumen(self.base)[tabla], resumen[tabla])
        self.assertEqual(normalizador.preparar_importacion(origen), antes)
        self.assertFalse(preparado["control"]["conciliacion"])
        with sqlite3.connect(self.base) as con:
            self.assertEqual(con.execute("PRAGMA integrity_check").fetchall(), [("ok",)])
            self.assertEqual(con.execute("PRAGMA foreign_key_check").fetchall(), [])

    def test_manifest_posterior_no_sobrescribe_detalle_ambiguo(self) -> None:
        """Comprueba manifest posterior no sobrescribe detalle ambiguo."""
        origen = captura(self.raiz / "ambiguo")
        otras = origen / "fuentes-investigadas/otras-entidades"
        anterior = json.loads((otras / "manifest-capturas.json").read_text())[0]
        otro = otras / "otro-cuerpo.html"
        otro.write_text("Contenido distinto")
        nuevo = dict(
            anterior,
            utc="2026-10-23T00:00:01+00:00",
            archivo=otro.name,
            sha256=hashlib.sha256(otro.read_bytes()).hexdigest(),
        )
        guardar(otras / "capturas-nuevas.json", [nuevo])
        with self.assertRaisesRegex(ValueError, "ambiguas"):
            normalizador.importar_captura(self.base, origen)
        self.assertFalse(self.base.exists())

    def test_interfaz_legacy_no_expone_lote_agregado_importable(self) -> None:
        """Comprueba interfaz legacy no expone lote agregado importable."""
        origen = captura(self.raiz / "origen", 21, 23)
        with self.assertRaisesRegex(ValueError, "canales temporales"):
            normalizador.construir(origen)

    def test_anotaciones_duplicadas_conservadas_invertir_orden_no_cambia_salida(self) -> None:
        """Comprueba anotaciones duplicadas conservadas invertir orden no cambia salida."""
        origen = captura(self.raiz / "anotaciones")
        otras = origen / "fuentes-investigadas/otras-entidades"
        manifest = json.loads((otras / "manifest-capturas.json").read_text())
        doble = dict(manifest[0], utc="2026-10-23T00:00:01+00:00")
        guardar(otras / "manifest-capturas.json", manifest + [doble])
        preparado = normalizador.preparar_importacion(origen)
        guardar(otras / "manifest-capturas.json", [doble] + manifest)
        self.assertEqual(normalizador.preparar_importacion(origen), preparado)
        canal = next(
            c
            for lista in preparado["canales_temporales"]
            for c in lista
            if c["id"].endswith(hashlib.sha256(manifest[0]["url"].encode()).hexdigest()[:20])
            and c["canal"] == "ficha-principal"
        )
        self.assertEqual(len(canal["evidencias"]), 2)
        self.assertTrue(any("no acredita dos consultas" in i["motivo"] for i in preparado["incidencias"]))

    def test_anotacion_nueva_del_mismo_cuerpo_no_rejuvenece_captura_antigua(self) -> None:
        """Comprueba anotacion nueva del mismo cuerpo no rejuvenece captura antigua."""
        inicial = captura(self.raiz / "inicial")
        normalizador.importar_captura(self.base, inicial)
        viejo = captura(self.raiz / "viejo", 21, 23, "Título antiguo")
        otras = viejo / "fuentes-investigadas/otras-entidades"
        manifest = json.loads((otras / "manifest-capturas.json").read_text())
        guardar(otras / "capturas-nuevas.json", [dict(manifest[0], utc="2026-10-24T00:00:01+00:00")])
        antes = self.base.read_bytes()
        with self.assertRaises(catalogo.ErrorTemporal):
            normalizador.importar_captura(self.base, viejo)
        self.assertEqual(self.base.read_bytes(), antes)

    def test_pin_explicito_debe_coincidir_con_cuerpo_archivo_fecha(self) -> None:
        """Comprueba pin explicito debe coincidir con cuerpo archivo fecha."""
        origen = captura(self.raiz / "pin")
        otras = origen / "fuentes-investigadas/otras-entidades"
        manifest = json.loads((otras / "manifest-capturas.json").read_text())
        fichas = json.loads((otras / "fichas-verificadas.json").read_text())
        fichas["fichas"][0]["evidencia"] = {
            "archivo_html": manifest[0]["archivo"],
            "sha256": manifest[0]["sha256"],
            "utc": manifest[0]["utc"],
        }
        guardar(otras / "fichas-verificadas.json", fichas)
        normalizador.preparar_importacion(origen)
        fichas["fichas"][0]["evidencia"]["utc"] = "2026-10-24T00:00:01+00:00"
        guardar(otras / "fichas-verificadas.json", fichas)
        with self.assertRaisesRegex(ValueError, "Referencia de captura"):
            normalizador.preparar_importacion(origen)


if __name__ == "__main__":
    unittest.main()
