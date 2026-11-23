"""Ciclo vertical sin red: fuente admitida, SQLite común y publicación con historia."""

import hashlib
import json
import os
import shutil
import tempfile
import unittest
from copy import deepcopy
from unittest.mock import patch

from plataforma_datos.comun import entrada_salida
from plataforma_datos.comun.nucleo import Carpetas, FormatoInesperado
from plataforma_datos.comun.observacion_remota import identidad_recurso
from plataforma_datos.cursos import almacen_catalogo as almacen
from plataforma_datos.cursos import cobertura_catalogo
from plataforma_datos.cursos import componer_catalogo as componer
from plataforma_datos.cursos import operacion_fuente as fuente
from plataforma_datos.cursos.contrato_entrega_catalogo import ErrorEntregaCatalogo
from plataforma_datos.cursos.fronteras_entrega_catalogo import FronteraEscritura
from plataforma_datos.cursos.fuentes.hp_life import actualizacion as hp
from plataforma_datos.cursos.pruebas import test_hp_life_actualizacion as fixtures
from plataforma_datos.orquestacion import admision


class ComponerCatalogoPruebas(unittest.TestCase):
    """Cada prueba tiene almacenamiento y recepciones sintéticas propios."""

    def setUp(self) -> None:
        """Conserva un antecedente admitido y una nueva recepción verificable."""
        self.caso = fixtures.ActualizacionHpLifePruebas()
        self.caso.setUp()
        self.addCleanup(self.caso.doCleanups)
        hp.preparar(self.caso.solicitud)
        entrada = hp.solicitud_admision(self.caso.solicitud.area)
        self.raiz = self.caso.raiz / "Instalación ñ"
        almacen.conservar(
            almacen.EntradaCatalogo(admision=entrada, sha256_admision=self.caso.ref(entrada.validacion_destino).sha256),
            destino=self.raiz / almacen.RUTA,
        )
        self.rx = self.caso.guardar_recepcion(fecha="2026-10-23T03:00:00Z")
        original, _, _ = fuente.rutas_de_la_fuente("hp_life", self.raiz)
        original.mkdir(parents=True)
        fila = {"id": self.rx.id}
        for clave, ref in (("cuerpo", self.rx.cuerpo), ("recibo", self.rx.recibo), ("intento", self.rx.recibo)):
            shutil.copyfile(ref.ruta, original / ref.ruta.name)
            fila[clave] = {"archivo": ref.ruta.name, "sha256": ref.sha256}
        entrada_salida.guardar_json(
            original / "procedencia.json",
            {
                "schema_version": 1,
                "fuente_id": "hp_life",
                "capturas": [fila],
                "historial": [fila["intento"]],
                "censo_completo": False,
            },
        )
        self.admitir()

    def admitir(self) -> None:
        """Ejecuta los tres controles efectivos, redirigiendo solo las rutas del fixture."""

        def carpetas(id: str) -> Carpetas:
            return Carpetas(*fuente.rutas_de_la_fuente(id, self.raiz))

        with (
            patch.object(fuente, "RAIZ", self.raiz),
            patch.object(admision, "carpetas", carpetas),
            patch.object(admision, "ruta_del_conjunto", lambda id: carpetas(id).validado / f"{id}.json"),
        ):
            fuente.preparar("hp_life", raiz=self.raiz)
            fuente.validar("hp_life", raiz=self.raiz)

    def inventario(self) -> dict:
        """Fija contenido y fechas de los resultados operativos y públicos.

        Returns:
            Mapa por ruta de SHA y fecha del archivo.
        """
        return {
            p.relative_to(self.raiz).as_posix(): (hashlib.sha256(p.read_bytes()).hexdigest(), p.stat().st_mtime_ns)
            for carpeta in (self.raiz / almacen.RUTA, self.raiz / "web")
            for p in carpeta.rglob("*")
            if p.is_file()
        }

    def test_fuente_real_controlada_llega_a_oferta_y_repetir_no_rejuvenece(self) -> None:
        """El corte de la evaluación difiere de la recepción; repetir no los renueva."""
        resultado = componer.componer(raiz=self.raiz, corte_utc="2026-10-23T04:00:00Z")
        dto = json.loads((self.raiz / "web" / resultado["referencia"]["ruta"]).read_bytes())
        self.assertEqual(len(dto["ofertas"]), 1)
        self.assertEqual(dto["ofertas"][0]["comprobado_el"], "2026-10-23T03:00:00Z")
        self.assertEqual(dto["corte_proyeccion_utc"], "2026-10-23T04:00:00Z")
        antes = self.inventario()
        repetido = componer.componer(raiz=self.raiz, corte_utc="2026-10-23T05:00:00Z")
        self.assertEqual(repetido, resultado)
        self.assertEqual(self.inventario(), antes)
        self.assertIsNone(fuente.leer_validado("cibervoluntarios", self.raiz))
        self.assertIsNone(fuente.leer_validado("claude_academy", self.raiz))

    def test_error_de_otro_proveedor_no_pisa_salida_de_hp(self) -> None:
        """Un original fallido de Ciber no modifica la última admisión ni la entrega HP."""
        componer.componer(raiz=self.raiz, corte_utc="2026-10-23T04:00:00Z")
        antes = self.inventario()
        original, _, _ = fuente.rutas_de_la_fuente("cibervoluntarios", self.raiz)
        entrada_salida.guardar_json(original / "procedencia.json", {"capturas": [], "fallo": "503 sintético"})
        componer.componer(raiz=self.raiz, corte_utc="2026-10-23T05:00:00Z")
        self.assertEqual(self.inventario(), antes)

    def test_salud_solo_con_recepcion_del_intento_vinculada_al_original_admitido(self) -> None:
        """La copia local, la respuesta sin vínculo y otro intento no acreditan consulta."""
        cuerpo = self.rx.cuerpo.ruta.read_bytes()
        rx = json.loads(self.rx.recibo.ruta.read_bytes())
        captura = rx["captura"]
        evidencia = {
            "version": 2,
            "fuente": "hp_life",
            "comienzo_utc": rx["inicio_utc"],
            "fin_utc": "2026-10-23T03:00:01Z",
            "peticiones": [
                {
                    "recurso_sha256": identidad_recurso(captura["url_solicitada"]),
                    "url_final_sha256": hashlib.sha256(captura["url_final"].encode()).hexdigest(),
                    "respuesta_sha256": self.rx.cuerpo.sha256,
                    "original_sha256": self.rx.cuerpo.sha256,
                    "bytes": len(cuerpo),
                    "original_bytes": len(cuerpo),
                    "completado_utc": captura["recibido_utc"],
                }
            ],
        }
        self.assertTrue(cobertura_catalogo.comprobada(self.raiz, evidencia))
        for campo, valor in (
            ("original_sha256", None),
            ("respuesta_sha256", "a" * 64),
            ("completado_utc", "2026-10-22T03:00:00Z"),
        ):
            with self.subTest(campo=campo):
                ajena = deepcopy(evidencia)
                ajena["peticiones"][0][campo] = valor
                self.assertFalse(cobertura_catalogo.comprobada(self.raiz, ajena))
        sin_consulta = {**evidencia, "peticiones": []}
        self.assertFalse(cobertura_catalogo.comprobada(self.raiz, sin_consulta))
        self.assertFalse(cobertura_catalogo.comprobada(self.raiz, {**evidencia, "fuente": "cibervoluntarios"}))

    def test_recepcion_repetida_no_simula_cobertura_y_no_sustituye_admitido(self) -> None:
        """Dos registros de la misma consulta no equivalen a dos identidades controladas."""
        original, _, validado = fuente.rutas_de_la_fuente("hp_life", self.raiz)
        antes = (validado / "validacion.json").read_bytes()
        ruta = original / "procedencia.json"
        dato = json.loads(ruta.read_bytes())
        dato["capturas"].append(dato["capturas"][0])
        entrada_salida.guardar_json(ruta, dato)
        with self.assertRaises(FormatoInesperado):
            fuente.preparar("hp_life", raiz=self.raiz)
        self.assertEqual((validado / "validacion.json").read_bytes(), antes)

    def test_conjunto_admitido_alterado_se_rechaza_sin_publicar(self) -> None:
        """La etiqueta Admitido no sustituye el SHA ni los cuerpos controlados."""
        original, _, _ = fuente.rutas_de_la_fuente("hp_life", self.raiz)
        (original / self.rx.cuerpo.ruta.name).write_bytes(b"otra respuesta")
        antes = self.inventario()
        with self.assertRaises(FormatoInesperado):
            componer.componer(raiz=self.raiz, corte_utc="2026-10-23T04:00:00Z")
        self.assertEqual(self.inventario(), antes)
        self.assertFalse((self.raiz / "web").exists())

    def test_tmpdir_con_alias_compone_sin_relajar_fronteras_ni_rejuvenecer_captura(self) -> None:
        """La raíz temporal del sistema se resuelve; las rutas ajenas siguen bajo la guarda original."""
        real = self.caso.raiz / "temporal real"
        real.mkdir()
        alias = self.caso.raiz / "alias temporal"
        alias.symlink_to(real, target_is_directory=True)
        with patch.dict(os.environ, {"TMPDIR": str(alias)}), patch.object(tempfile, "tempdir", None):
            resultado = componer.componer(raiz=self.raiz, corte_utc="2026-10-23T04:00:00Z")
        dto = json.loads((self.raiz / "web" / resultado["referencia"]["ruta"]).read_bytes())
        self.assertEqual(dto["ofertas"][0]["comprobado_el"], "2026-10-23T03:00:00Z")
        self.assertEqual(list(real.iterdir()), [])
        self.assertTrue(alias.is_symlink())
        with self.assertRaisesRegex(ErrorEntregaCatalogo, "enlace simbólico"):
            FronteraEscritura(area=alias / "privada", entradas=()).comprobar(alias / "privada")
