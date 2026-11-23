"""Consultas nuevas de cuerpo idéntico conservan pruebas sin clonar índices acumulativos."""

import contextlib
import io
import json
import unittest
from datetime import UTC, datetime, timedelta
from unittest.mock import patch

from plataforma_datos.comun.nucleo import Carpetas
from plataforma_datos.cursos import operacion_fuente as fuente
from plataforma_datos.cursos import recepciones_catalogo as transporte
from plataforma_datos.cursos.pruebas import test_componer_catalogo as fixtures
from plataforma_datos.cursos.pruebas.test_hp_life_observaciones import URL, recepcion
from plataforma_datos.orquestacion import admision
from plataforma_datos.orquestacion import generacion_operativa as generacion
from plataforma_datos.orquestacion.pruebas.test_generacion_operativa import REVISION, preparar


class HistorialRecepcionesPruebas(unittest.TestCase):
    """La medición incluye todos los archivos de originales, preparados y validados de la fuente."""

    def test_doce_recepciones_distintas_crecimiento_lineal_y_traslado(self) -> None:
        """El historial conserva cada consulta; un índice admitido reemplaza solo al generado anterior."""
        caso = fixtures.ComponerCatalogoPruebas()
        caso.setUp()
        self.addCleanup(caso.doCleanups)
        raiz = caso.raiz
        original, preparado, validado = fuente.rutas_de_la_fuente("hp_life", raiz)
        cuerpo = recepcion()[0]
        tamanos = []

        def carpetas(id: str) -> Carpetas:
            return Carpetas(*fuente.rutas_de_la_fuente(id, raiz))

        for numero in range(1, 13):
            inicio = datetime(2026, 10, 23, 3, 10, tzinfo=UTC) + timedelta(minutes=numero)
            respuesta = transporte.RespuestaCatalogo(
                url=URL,
                inicio_utc=inicio.isoformat(),
                fin_utc=(inicio + timedelta(seconds=1)).isoformat(),
                cuerpo=cuerpo,
                url_final=URL,
                http=200,
                completo=True,
                content_type="text/html",
            )
            with (
                contextlib.redirect_stdout(io.StringIO()),
                patch.object(transporte, "consultar", return_value=respuesta),
                patch.object(fuente, "RAIZ", raiz),
                patch.object(admision, "carpetas", carpetas),
                patch.object(admision, "ruta_del_conjunto", lambda id: carpetas(id).validado / f"{id}.json"),
            ):
                fuente.descargar("hp_life", raiz=raiz)
                fuente.preparar("hp_life", raiz=raiz)
                fuente.validar("hp_life", raiz=raiz)
            tamanos.append(
                sum(
                    p.stat().st_size
                    for carpeta in (original, preparado, validado)
                    for p in carpeta.rglob("*")
                    if p.is_file()
                )
            )
        self.assertEqual(tamanos[7] - tamanos[3], tamanos[11] - tamanos[7])
        self.assertEqual(len(list((original / "recepciones").glob("*.body"))), 1)
        # Cada consulta conserva tres recibos (ficha, página del índice y página de ayuda) con el mismo cuerpo aquí.
        self.assertEqual(len(list((original / "recepciones").glob("*.recepcion.json"))), 36)
        self.assertFalse((original / "procedencias").exists())
        conjunto = fuente.leer_validado("hp_life", raiz)
        documento = json.loads((original / "procedencia.json").read_bytes())
        for ref in documento["historial"]:
            fuente.leer_conservado(original, ref)
        self.assertEqual(
            (validado / "procedencia-admitida.json").read_bytes(), (original / "procedencia.json").read_bytes()
        )
        preparar(raiz)
        bundle, destino = raiz.parent / "Generación", raiz.parent / "Restaurada ñ"
        recibo = generacion.exportar_generacion(raiz, bundle, REVISION)
        generacion.restaurar_generacion(bundle, destino, REVISION, recibo["sha256Manifiesto"])
        self.assertEqual(fuente.leer_validado("hp_life", destino), conjunto)
        for ref in documento["historial"]:
            fuente.leer_conservado(destino / original.relative_to(raiz), ref)
