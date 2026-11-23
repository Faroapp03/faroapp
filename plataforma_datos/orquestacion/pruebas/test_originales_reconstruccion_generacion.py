"""Las entradas de reconstructores reales sobreviven al traslado sin depender de otra instalación."""

import io
import json
import tempfile
import unittest
import zlib
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

from plataforma_datos.comun import entrada_salida
from plataforma_datos.comun.entrada_salida import guardar_json, sha256
from plataforma_datos.comun.nucleo import RAIZ, ErrorFuente
from plataforma_datos.ocupaciones.fuentes.clasificaciones import notas_cno11
from plataforma_datos.orquestacion import generacion_operativa as generacion
from plataforma_datos.orquestacion.exportacion import metodos
from plataforma_datos.orquestacion.pruebas.test_generacion_operativa import REVISION, preparar


class OriginalesReconstruccionPruebas(unittest.TestCase):
    """Contrasta la transferencia con el manifiesto publicado y con consumidores, no con la lista del exportador."""

    def setUp(self) -> None:
        """Crea cuerpos sintéticos y conserva las rutas de entrada que declara el paquete."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.area = Path(temporal.name)
        self.raiz = self.area / "Origen independiente"
        preparar(self.raiz)
        manifiesto = json.loads((RAIZ / "datos/manifiesto.json").read_bytes())
        self.entradas = {
            ruta
            for salida in ("mercado.json", "metodos.json")
            for ruta in manifiesto[salida]["origenes"]
            if ruta.startswith("var/actualizacion/originales/")
        }
        self.entradas.update(
            f"var/actualizacion/originales/{casa}/{nombre}.json"
            for casa, nombre in (("epa", "tabla"), ("eaes", "tabla"), ("eaes", "catalogo"), ("ofertas", "tabla"))
        )
        por_casa = {}
        for relativa in sorted(self.entradas):
            ruta = self.raiz / relativa
            ruta.parent.mkdir(parents=True, exist_ok=True)
            ruta.write_text(json.dumps({"fixture": relativa}) + "\n", encoding="utf-8")
            if relativa.endswith("metodos/consenso-isco4.json"):
                guardar_json(
                    ruta,
                    {
                        "fecha": "2026-10-01",
                        "metodos": {"sintetico": {"nombre": "Método de prueba"}},
                        "ocupaciones": {
                            "1234": {"tercio_oit": "bajo", "coinciden_sin_cambra": 1, "con_dato_sin_cambra": 1}
                        },
                    },
                )
            por_casa.setdefault(ruta.parent.name, []).append({"archivo": ruta.name, "sha256": sha256(ruta)})
        pdf = self.raiz / "var/actualizacion/originales/notas-cno11/notas.pdf"
        pdf.parent.mkdir(parents=True, exist_ok=True)
        texto = (
            b"BT (1234 Trabajo de prueba) Tj ET\n"
            b"BT (Ejemplos de ocupaciones incluidas en este grupo primario) Tj ET\n"
            b"BT (Personal de pruebas) Tj ET\n"
        )
        pdf.write_bytes(b"%PDF-fixture\nstream\n" + zlib.compress(texto) + b"\nendstream\n")
        self.entradas.add(pdf.relative_to(self.raiz).as_posix())
        por_casa["notas-cno11"] = [
            {
                "archivo": pdf.name,
                "sha256": sha256(pdf),
                "url": "https://example.org/notas.pdf",
                "descargado_utc": "2026-10-01T00:00:00Z",
            }
        ]
        for casa, archivos in por_casa.items():
            guardar_json(
                self.raiz / f"var/actualizacion/originales/{casa}/procedencia.json",
                {"fuente": "Fixture", "cita": "Prueba sintética", "licencia": "Fixture", "archivos": archivos},
            )
        ruta_manifiesto = self.raiz / "datos/manifiesto.json"
        propio = json.loads(ruta_manifiesto.read_bytes())
        propio["uno.json"]["origenes"] = {r: sha256(self.raiz / r) for r in sorted(self.entradas)}
        guardar_json(ruta_manifiesto, propio)

    def test_roundtrip_resuelve_entradas_del_manifiesto_y_reconstructores_reales(self) -> None:
        """Los originales del paquete se releen con su huella y Métodos/Notas se ejecutan sobre el destino."""
        bundle, destino = self.area / "generación", self.area / "Destino nuevo"
        esperados = {r: (self.raiz / r).read_bytes() for r in self.entradas}
        recibo = generacion.exportar_generacion(self.raiz, bundle, REVISION)
        generacion.restaurar_generacion(bundle, destino, REVISION, recibo["sha256Manifiesto"])
        self.raiz.rename(self.area / "Origen apartado")
        self.assertFalse(self.raiz.exists())
        with patch.object(entrada_salida, "ORIGINALES", destino / "var/actualizacion/originales"):
            for relativa in sorted(self.entradas - {"var/actualizacion/originales/notas-cno11/notas.pdf"}):
                ruta = Path(relativa)
                resuelta = entrada_salida.original(ruta.parent.name, ruta.name)
                self.assertEqual(resuelta, destino / relativa)
                self.assertEqual(resuelta.read_bytes(), esperados[relativa])
            paquete = metodos.paquete_metodos()
            self.assertEqual(
                paquete.datos["ocupaciones"]["1234"], {"tercio_oit": "bajo", "coinciden": 1, "con_dato": 1}
            )
            self.assertTrue(all(p.is_relative_to(destino) for p in paquete.origenes))
        salida = self.area / "denominaciones-fixture.json"
        with (
            patch.object(notas_cno11, "ORIGINAL", destino / "var/actualizacion/originales/notas-cno11"),
            patch.object(notas_cno11, "SALIDA", salida),
            patch.object(notas_cno11, "RAIZ", self.area),
            redirect_stdout(io.StringIO()),
        ):
            notas_cno11.principal()
        self.assertEqual(json.loads(salida.read_bytes())["grupos"], {"1234": ["Personal de pruebas"]})

    def test_indice_parcial_no_omite_un_origen_exigido_por_el_paquete(self) -> None:
        """Una procedencia no vacía debe cubrir también las entradas declaradas en el paquete."""
        ruta = self.raiz / "var/actualizacion/originales/eaes/procedencia.json"
        dato = json.loads(ruta.read_bytes())
        self.assertGreater(len(dato["archivos"]), 1)
        dato["archivos"].pop()
        guardar_json(ruta, dato)
        with self.assertRaises(ValueError):
            generacion.exportar_generacion(self.raiz, self.area / "índice parcial", REVISION)

    def test_huella_del_paquete_debe_coincidir_con_el_original(self) -> None:
        """Dos índices internamente coherentes no pueden vincular cuerpos distintos al paquete."""
        ruta = self.raiz / "datos/manifiesto.json"
        dato = json.loads(ruta.read_bytes())
        entrada = next(r for r in self.entradas if Path(r).parent.name == "metodos")
        dato["uno.json"]["origenes"][entrada] = "0" * 64
        guardar_json(ruta, dato)
        with self.assertRaises(ErrorFuente):
            generacion.exportar_generacion(self.raiz, self.area / "paquete ajeno", REVISION)

    def test_cuerpo_omitido_rechaza_antes_de_publicar(self) -> None:
        """Una procedencia sola no permite producir una generación incompleta."""
        for casa in ("epa", "eaes", "metodos", "notas-cno11", "ofertas"):
            with self.subTest(casa=casa):
                relativa = next(r for r in self.entradas if Path(r).parent.name == casa)
                ruta = self.raiz / relativa
                contenido = ruta.read_bytes()
                ruta.unlink()
                destino = self.area / ("sin-" + casa)
                try:
                    with self.assertRaises((OSError, ErrorFuente, ValueError)):
                        generacion.exportar_generacion(self.raiz, destino, REVISION)
                    self.assertFalse(destino.exists())
                finally:
                    ruta.write_bytes(contenido)

    def test_huella_alterada_rechaza_antes_de_publicar(self) -> None:
        """Un cuerpo presente con bytes diferentes tampoco acredita portabilidad."""
        for casa in ("epa", "eaes", "metodos", "notas-cno11", "ofertas"):
            with self.subTest(casa=casa):
                relativa = next(r for r in self.entradas if Path(r).parent.name == casa)
                ruta = self.raiz / relativa
                contenido = ruta.read_bytes()
                ruta.write_bytes(b"alterado")
                destino = self.area / ("alterado-" + casa)
                try:
                    with self.assertRaises(ErrorFuente):
                        generacion.exportar_generacion(self.raiz, destino, REVISION)
                    self.assertFalse(destino.exists())
                finally:
                    ruta.write_bytes(contenido)


if __name__ == "__main__":
    unittest.main()
