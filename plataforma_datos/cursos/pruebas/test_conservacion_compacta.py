"""Historia íntegra con recibos acotados: los índices actuales no forman una cadena recursiva."""

import contextlib
import hashlib
import io
import json
import subprocess
import sys
import unittest
from datetime import UTC, datetime, timedelta
from unittest.mock import patch

from plataforma_datos.comun.nucleo import RAIZ
from plataforma_datos.cursos import admision_catalogo as admision
from plataforma_datos.cursos import almacen_catalogo as almacen
from plataforma_datos.cursos import componer_catalogo as componer
from plataforma_datos.cursos import operacion_fuente as fuente
from plataforma_datos.cursos import recepciones_catalogo as transporte
from plataforma_datos.cursos.fuentes.hp_life import actualizacion as hp
from plataforma_datos.cursos.fuentes.hp_life import gratuidad
from plataforma_datos.cursos.pruebas import ayuda_indice_hp as indice_hp
from plataforma_datos.cursos.pruebas import test_componer_catalogo as fixtures
from plataforma_datos.cursos.pruebas.test_hp_life_observaciones import URL, recepcion
from plataforma_datos.orquestacion import generacion_operativa as generacion
from plataforma_datos.orquestacion.pruebas.test_generacion_operativa import REVISION, preparar

CODIGO_CORTE = 23


class ConservacionCompactaPruebas(unittest.TestCase):
    """Solo SQLite y recepciones sintéticas; todos los destinos son exclusivos."""

    def setUp(self) -> None:
        """Prepara el circuito real de fuente, admisión y composición sobre datos pequeños."""
        self.caso = fixtures.ComponerCatalogoPruebas()
        self.caso.setUp()
        self.addCleanup(self.caso.doCleanups)
        self.raiz = self.caso.raiz
        self.area = self.raiz / almacen.RUTA

    def control(self) -> dict:
        """Lee el índice actual del fixture.

        Returns:
            Metadatos cuya admisión se comprueba en cada composición.
        """
        return json.loads((self.area / almacen.CONTROL).read_bytes())

    def ciclo(self, numero: int) -> dict:
        """Admite una consulta distinta con el mismo cuerpo y compone con corte explícito.

        Returns:
            Referencia preparada; sin publicación real ni red.
        """
        inicio = datetime(2026, 10, 23, 3, 10, tzinfo=UTC) + timedelta(minutes=numero)
        respuesta = transporte.RespuestaCatalogo(
            url=URL,
            inicio_utc=inicio.isoformat(),
            fin_utc=(inicio + timedelta(seconds=1)).isoformat(),
            cuerpo=recepcion()[0],
            url_final=URL,
            http=200,
            completo=True,
            content_type="text/html",
        )

        def responder(url: str, **_opciones: object) -> transporte.RespuestaCatalogo:
            # La página de ayuda trae la declaración de gratuidad; todo lo demás recibe el mismo cuerpo de ficha.
            if url == gratuidad.URL_AYUDA:
                return indice_hp.ayuda(url, respuesta.inicio_utc, respuesta.fin_utc)
            return respuesta

        with contextlib.redirect_stdout(io.StringIO()), patch.object(transporte, "consultar", side_effect=responder):
            fuente.descargar("hp_life", raiz=self.raiz)
            self.caso.admitir()
            return componer.componer(raiz=self.raiz, corte_utc=(inicio + timedelta(seconds=2)).isoformat())

    def test_ocho_ciclos_conservan_hechos_y_admisiones_sin_indices_historicos_nuevos(self) -> None:
        """Cada recibo se refiere al lote actual, su corte y las evaluaciones realmente almacenadas."""
        hechos = set()
        for numero in range(1, 9):
            salida = self.ciclo(numero)
            control = self.control()
            regenerables = almacen.indices_regenerables(control)
            self.assertEqual(regenerables, {"indices/control-hp.json"})
            actuales = {p["sha256"] for p in control["archivos_conservados"] if p["archivo"] not in regenerables}
            self.assertTrue(hechos <= actuales)
            hechos = actuales
            recibo = control["procedencia"]["recibo-admision"]
            dato = json.loads((self.area / recibo["archivo"]).read_bytes())
            self.assertEqual(dato["snapshot_salida_sha256"], control["snapshot_sha256"])
            self.assertEqual(len(dato["recepciones"]), 1)
            self.assertEqual(len(dato["evaluaciones"]), 1)
            self.assertEqual(dato["tipo"], "admision_snapshot_no_comprobacion_remota")
            self.assertNotIn("archivos_conservados", dato)
            self.assertNotIn("comprobado_el", dato)
            dto = json.loads((self.raiz / "web" / salida["referencia"]["ruta"]).read_bytes())
            corte = datetime.fromisoformat(dato["corte_utc"])
            self.assertEqual(datetime.fromisoformat(dto["ofertas"][0]["corte_evaluacion_utc"]), corte)
            self.assertEqual(datetime.fromisoformat(dto["ofertas"][0]["comprobado_el"]), corte - timedelta(seconds=1))
        self.assertEqual(len(list((self.area / "indices").glob("*.json"))), 1)
        self.assertFalse(list(self.area.rglob("*.control-catalogo.json")))
        recibos = []
        for prueba in self.control()["archivos_conservados"]:
            ruta = self.area / prueba["archivo"]
            try:
                dato = json.loads(ruta.read_bytes())
            except (ValueError, UnicodeError):
                continue
            if isinstance(dato, dict) and dato.get("tipo") == "admision_snapshot_no_comprobacion_remota":
                recibos.append(dato)
        self.assertEqual(len(recibos), 9)  # Entrada más ocho consultas distintas.
        antes = {
            (p.relative_to(self.area).as_posix(), hashlib.sha256(p.read_bytes()).hexdigest())
            for p in self.area.rglob("*")
            if p.is_file()
        }
        self.assertEqual(componer.componer(raiz=self.raiz, corte_utc="2026-10-23T06:00:00Z"), salida)
        self.assertEqual(
            antes,
            {
                (p.relative_to(self.area).as_posix(), hashlib.sha256(p.read_bytes()).hexdigest())
                for p in self.area.rglob("*")
                if p.is_file()
            },
        )
        self._comprobar_traslado(antes)

    def _comprobar_traslado(self, antes: set) -> None:
        """Restaura todos los hechos y su admisión en otro destino Unicode."""
        preparar(self.raiz)
        bundle, destino = self.raiz.parent / "Generación compacta", self.raiz.parent / "Restaurada ñ"
        recibo = generacion.exportar_generacion(self.raiz, bundle, REVISION)
        generacion.restaurar_generacion(bundle, destino, REVISION, recibo["sha256Manifiesto"])
        restaurada = almacen.solicitud(destino / almacen.RUTA)
        admision.exigir_snapshot_admitido(restaurada, sha256_validacion=almacen._sha(restaurada.validacion_destino))
        self.assertEqual(
            antes,
            {
                (p.relative_to(destino / almacen.RUTA).as_posix(), hashlib.sha256(p.read_bytes()).hexdigest())
                for p in (destino / almacen.RUTA).rglob("*")
                if p.is_file()
            },
        )

    def test_prefijo_anterior_sin_contrato_compacto_se_conserva_completo(self) -> None:
        """El alta del contrato no reclasifica ni borra un archivo de la historia anterior."""
        control = self.control()
        del control["conservacion"]
        (self.area / almacen.CONTROL).write_bytes(admision.bytes_json_admision(control))
        admision.admitir_snapshot(almacen.solicitud(self.area))
        historicos = {almacen._sha(p) for p in self.area.rglob("*") if p.is_file() and p.name != "catalogo.sqlite3"}
        self.ciclo(1)
        actuales = {p["sha256"] for p in self.control()["archivos_conservados"]}
        self.assertTrue(historicos <= actuales)
        prefijo = actuales
        self.ciclo(2)
        actuales = {p["sha256"] for p in self.control()["archivos_conservados"]}
        self.assertEqual(len(prefijo - actuales), 1)  # Solo el índice actual declarado regenerable.
        self.assertTrue(historicos <= actuales)
        self.assertIn(hashlib.sha256(admision.bytes_json_admision(control)).hexdigest(), actuales)

    def test_corte_real_tras_recibo_compacto_no_promueve_y_reintento_es_seguro(self) -> None:
        """El nombre final queda ausente tras os._exit; reintentar admite los mismos hechos."""
        entrada = hp.solicitud_admision(self.caso.caso.solicitud.area)
        sha_entrada = almacen._sha(entrada.validacion_destino)
        antes = entrada.snapshot.ruta.read_bytes()
        destino = self.raiz.parent / "Copia interrumpida"
        codigo = """
import os,sys
from pathlib import Path
from plataforma_datos.cursos import almacen_catalogo as almacen
from plataforma_datos.cursos.fuentes.hp_life import actualizacion as hp
real = almacen._recibo_admision
def cortar(*args):
    real(*args)
    os._exit(23)
almacen._recibo_admision = cortar
sol = hp.solicitud_admision(Path(sys.argv[1]))
almacen.conservar(almacen.EntradaCatalogo(admision=sol,sha256_admision=sys.argv[2]),destino=Path(sys.argv[3]))
"""
        resultado = subprocess.run(
            [sys.executable, "-B", "-c", codigo, str(self.caso.caso.solicitud.area), sha_entrada, str(destino)],
            cwd=RAIZ,
            check=False,
            capture_output=True,
            timeout=30,
        )
        self.assertEqual(resultado.returncode, CODIGO_CORTE, resultado.stderr.decode())
        self.assertFalse(destino.exists())
        self.assertEqual(entrada.snapshot.ruta.read_bytes(), antes)
        almacen.conservar(almacen.EntradaCatalogo(admision=entrada, sha256_admision=sha_entrada), destino=destino)
        nueva = almacen.solicitud(destino)
        admision.exigir_snapshot_admitido(nueva, sha256_validacion=almacen._sha(nueva.validacion_destino))
        self.assertEqual(nueva.snapshot.ruta.read_bytes(), antes)
