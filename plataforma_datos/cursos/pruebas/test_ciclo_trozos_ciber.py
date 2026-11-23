"""Ciclos reales de Ciber con página grande: crecimiento del almacén por trozos, sin red."""

import base64
import hashlib
import io
import json
import random
import socket
import unittest
from email.message import Message
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError

from plataforma_datos.comun import red
from plataforma_datos.comun.nucleo import Carpetas
from plataforma_datos.cursos import almacen_catalogo as almacen
from plataforma_datos.cursos import componer_catalogo as componer
from plataforma_datos.cursos import migrar_trozos_catalogo, panel_catalogo, trozos_catalogo
from plataforma_datos.cursos import operacion_fuente as fuente
from plataforma_datos.cursos.fuentes.cibervoluntarios import adquisicion
from plataforma_datos.cursos.fuentes.cibervoluntarios import declaraciones_publicadas as declaraciones
from plataforma_datos.cursos.pruebas import test_ciber_actualizacion as caso
from plataforma_datos.cursos.pruebas.test_ciber_adquisicion import codigo_publicado
from plataforma_datos.orquestacion import admision

MIEMBROS = 100
MODULO = "https://frontend.cibervoluntarios.org/vite/assets/main-ejemplo.js"
COMPONENTE = "https://frontend.cibervoluntarios.org/vite/assets/TrainingCourseView-fixture.js"
IDIOMA = "https://frontend.cibervoluntarios.org/vite/assets/useCatalogMaterialByLocale-fixture.js"


def pagina(cambiados: frozenset[int] = frozenset()) -> bytes:
    """Censo sintético de varios MB: materiales con imagen en base64 y actividades por miembro.

    Returns:
        Página JSON-LD; solo cambian las actividades de los miembros indicados.
    """
    azar = random.Random(11)
    miembros = []
    for numero in range(MIEMBROS):
        imagen = base64.b64encode(azar.randbytes(45_000)).decode()
        miembros.append(
            {
                "id": 5000 + numero,
                "activities": [{"plazas": numero + (7 if numero in cambiados else 0)}],
                "activityCatalogMaterials": [{"id": 9000 + numero, "type": "Autoformación", "image": imagen}],
            }
        )
    return json.dumps({"hydra:totalItems": MIEMBROS, "hydra:member": miembros}).encode()


class CicloTrozosCiberPruebas(unittest.TestCase):
    """descargar → preparar → validar → componer → entrega pública → panel, con transporte falso."""

    def setUp(self) -> None:
        """Instala un almacén admitido real y bloquea cualquier conexión de red."""
        for contexto in (
            patch.object(socket.socket, "connect", side_effect=OSError("Red bloqueada en la prueba")),
            patch.object(socket, "create_connection", side_effect=OSError("Red bloqueada en la prueba")),
        ):
            contexto.start()
            self.addCleanup(contexto.stop)
        self.caso = caso.ActualizacionCiberPruebas()
        self.caso.setUp()
        self.addCleanup(self.caso.doCleanups)
        self.caso.parche_politica.stop()
        self.raiz = self.caso.raiz
        almacen.conservar(self.caso.entrada, destino=self.raiz / almacen.RUTA)
        self.original, _, _ = fuente.rutas_de_la_fuente("cibervoluntarios", self.raiz)

        def carpetas(id: str) -> Carpetas:
            return Carpetas(*fuente.rutas_de_la_fuente(id, self.raiz))

        for contexto in (
            patch.object(fuente, "RAIZ", self.raiz),
            patch.object(admision, "carpetas", carpetas),
            patch.object(admision, "ruta_del_conjunto", lambda id: carpetas(id).validado / (id + ".json")),
            patch.object(red, "descargar_url", self.transporte),
        ):
            contexto.start()
            self.addCleanup(contexto.stop)
        portada = ('<html><head><script type="module" src="' + MODULO + '"></script></head></html>').encode()
        self.respuestas = {
            declaraciones.PORTADA: (portada, "text/html"),
            adquisicion.ALIAS_FUNDAE: (portada, "text/html"),
            MODULO: (codigo_publicado(), "text/javascript"),
            COMPONENTE: (
                b'import{x}from"./main-ejemplo.js";import{u}from"./useCatalogMaterialByLocale-fixture.js";',
                "text/javascript",
            ),
            IDIOMA: (b"export{};", "text/javascript"),
        }

    def transporte(self, url: str, **opciones: object) -> tuple[bytes, str, str]:
        """Responde como el servidor público, sin abrir ninguna conexión.

        Returns:
            Cuerpo, URL final y tipo de contenido.

        Raises:
            HTTPError: Si se pide el destino de un material, que no responde.
        """
        if url.startswith("https://e-learning.cibervoluntarios.org/"):
            # Un material conocido que el censo no trae: su destino no responde y la baja queda sin confirmar.
            raise HTTPError(url, 503, "Servicio no disponible", Message(), io.BytesIO(b"Servicio no disponible"))
        cuerpo, tipo = self.respuestas[url]
        opciones["comprobar_cabeceras"](200, url, {"Content-Type": tipo})
        return cuerpo, url, tipo

    def ocupado(self) -> tuple[int, int]:
        """Mide el almacén del catálogo en disco y lo que ocuparía con cuerpos enteros.

        Returns:
            Bytes físicos actuales y bytes equivalentes con el diseño anterior.
        """
        area = self.raiz / almacen.RUTA
        fisicos = sum(p.stat().st_size for p in area.rglob("*") if p.is_file())
        control = json.loads((area / almacen.CONTROL).read_bytes())
        trozos = area / "evidencias" / trozos_catalogo.CARPETA
        enteros = sum(p.stat().st_size for p in area.rglob("*") if p.is_file() and not p.is_relative_to(trozos))
        for prueba in control["archivos_conservados"]:
            ruta = area / prueba["archivo"]
            manifiesto = trozos_catalogo.manifiesto_de(ruta, prueba["sha256"], limite=trozos_catalogo.MAX_CUERPO)
            if manifiesto is not None:
                enteros += manifiesto.bytes - ruta.stat().st_size
        return fisicos, enteros

    def originales(self) -> int:
        """Mide los originales de Ciber en disco, trozos incluidos.

        Returns:
            Bytes de todos los archivos regulares de los originales.
        """
        return sum(p.stat().st_size for p in self.original.rglob("*") if p.is_file())

    def test_originales_enteros_migran_sin_cambiar_su_validacion_y_tras_un_corte(self) -> None:
        """Cuerpos enteros de una versión anterior pasan a trozos; un corte no deja nada inválido."""
        inicial = pagina()
        with patch.object(trozos_catalogo, "UMBRAL", 1 << 40):
            self.ciclo(inicial, "2026-10-23T18:30:00Z")
        cuerpo = self.original / "cuerpos" / (hashlib.sha256(inicial).hexdigest() + ".body")
        self.assertEqual(cuerpo.read_bytes(), inicial)
        previo = fuente.leer_validado("cibervoluntarios", self.raiz)
        with (
            patch.object(Path, "replace", side_effect=OSError("corte simulado")),
            self.assertRaises(OSError),
        ):
            migrar_trozos_catalogo.migrar_originales(self.raiz)
        self.assertEqual(cuerpo.read_bytes(), inicial)
        self.assertEqual(fuente.leer_validado("cibervoluntarios", self.raiz), previo)
        resumen = migrar_trozos_catalogo.migrar_originales(self.raiz)["cibervoluntarios"]
        self.assertEqual(resumen["cuerpos_migrados"], 1)
        self.assertLess(resumen["bytes_despues"], resumen["bytes_antes"] + 64 * 1024)
        self.assertTrue(cuerpo.read_bytes().startswith(trozos_catalogo.MAGIA))
        self.assertEqual(migrar_trozos_catalogo.migrar_originales(self.raiz)["cibervoluntarios"]["cuerpos_migrados"], 0)
        self.assertEqual(fuente.leer_validado("cibervoluntarios", self.raiz), previo)
        self.ciclo(pagina(frozenset({5})), "2026-10-23T19:30:00Z")

    def ciclo(self, cuerpo: bytes, corte: str) -> dict:
        """Ejecuta un ciclo completo con la página indicada.

        Returns:
            Panel privado producido al cerrar el ciclo.
        """
        self.respuestas[adquisicion.url_pagina(1)] = (cuerpo, "application/ld+json")
        fuente.descargar("cibervoluntarios", raiz=self.raiz)
        fuente.preparar("cibervoluntarios", raiz=self.raiz)
        fuente.validar("cibervoluntarios", raiz=self.raiz)
        resultado = componer.componer(raiz=self.raiz, corte_utc=corte)
        publico = json.loads((self.raiz / "web" / resultado["referencia"]["ruta"]).read_bytes())
        self.assertIn("ofertas", publico)
        return panel_catalogo.crear(self.raiz, corte_utc=corte)

    def test_ciclos_identicos_no_crecen_y_un_cambio_crece_poco(self) -> None:
        """Mide el crecimiento real por ciclo frente a guardar cada página entera."""
        inicial = pagina()
        self.assertGreater(len(inicial), trozos_catalogo.UMBRAL)
        self.ciclo(inicial, "2026-10-23T18:30:00Z")
        medidas, originales = [self.ocupado()], [self.originales()]
        for hora in ("19", "20", "21"):
            self.ciclo(inicial, f"2026-10-23T{hora}:30:00Z")
            medidas.append(self.ocupado())
            originales.append(self.originales())
        cambiada = pagina(frozenset({3, 30, 60, 90}))
        self.ciclo(cambiada, "2026-10-23T22:30:00Z")
        medidas.append(self.ocupado())
        originales.append(self.originales())
        en_originales = [b - a for a, b in zip(originales, originales[1:], strict=False)]
        print("\nCrecimiento de originales por ciclo:", en_originales)
        self.assertTrue(all(c < len(inicial) // 10 for c in en_originales))
        cuerpo = self.original / "cuerpos" / (hashlib.sha256(cambiada).hexdigest() + ".body")
        self.assertTrue(cuerpo.read_bytes().startswith(trozos_catalogo.MAGIA))
        crecimientos = [(f - medidas[i][0], e - medidas[i][1]) for i, (f, e) in enumerate(medidas[1:])]
        print("\nCrecimiento por ciclo (trozos, enteros):", crecimientos, "página:", len(cambiada))
        for fisico, entero in crecimientos[:3]:
            self.assertLess(fisico, len(inicial) // 10)
            self.assertLess(entero, len(inicial) // 10)
        fisico, entero = crecimientos[3]
        self.assertGreater(entero, len(cambiada) * 0.9)
        self.assertLess(fisico, len(cambiada) // 10)
        area = self.raiz / almacen.RUTA
        control = json.loads((area / almacen.CONTROL).read_bytes())
        for prueba in control["archivos_conservados"]:
            almacen.leer_evidencia(area / prueba["archivo"], prueba["sha256"], "Evidencia no reconstruida")


if __name__ == "__main__":
    unittest.main()
