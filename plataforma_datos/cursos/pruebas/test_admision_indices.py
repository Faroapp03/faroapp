"""Índices de evidencia sujetos a la misma admisión y sus presupuestos globales."""

import hashlib
import json
import unittest
from dataclasses import replace
from unittest.mock import patch

from plataforma_datos.cursos import admision_catalogo as admision
from plataforma_datos.cursos import indices_evidencias
from plataforma_datos.cursos.pruebas import test_admision_catalogo as fixtures
from plataforma_datos.cursos.tipos_json import ObjetoJson


class AdmisionIndicesPruebas(unittest.TestCase):
    """Solo bases y archivos del fixture; ningún acceso a var, originales o red."""

    def setUp(self) -> None:
        """Prepara V9 y dos evidencias con identidades de bytes independientes."""
        self.caso = fixtures.AdmisionCatalogoPruebas()
        self.caso.setUp()
        self.addCleanup(self.caso.doCleanups)
        self.raiz = self.caso.raiz / "evidencia Año"
        self.raiz.mkdir()
        self.archivos = {"curso.body": b"cuerpo", "recibo.json": b'{"recibido":"2026-10-23T08:00:00Z"}'}
        for nombre, contenido in self.archivos.items():
            (self.raiz / nombre).write_bytes(contenido)
        self.indice = self.caso.raiz / "control.json"
        self.solicitud = self.conservar_indice(self.filas())

    def filas(self) -> list[dict[str, str]]:
        """Declara hashes de las entradas sintéticas conocidas, no de archivos modificados.

        Returns:
            Inventario explícito del fixture.
        """
        return [{"archivo": n, "sha256": hashlib.sha256(c).hexdigest()} for n, c in self.archivos.items()]

    def conservar_indice(self, filas: list[dict[str, str]]) -> admision.SolicitudAdmision:
        """Conserva un nuevo índice declarado y fija su identidad de recepción local.

        Returns:
            Solicitud de pruebas con el índice físico explícito.
        """
        self.indice.write_text(json.dumps({"schema_version": 1, "archivos_conservados": filas}))
        return replace(
            self.caso.solicitud,
            indices_evidencias={
                "pruebas": admision.IndiceEvidencias(archivo=self.caso.referencia(self.indice), raiz=self.raiz)
            },
        )

    def exigir(self) -> ObjetoJson:
        """Reutiliza la guarda común sin volver a auditar el catálogo.

        Returns:
            Informe admitido y físicamente verificado.
        """
        return admision.exigir_snapshot_admitido(
            self.solicitud,
            sha256_validacion=self.caso.referencia(self.solicitud.validacion_destino).sha256,
        )

    def test_schema2_opt_in_y_repeticion_sin_reescribir(self) -> None:
        """No crece el informe por archivo ni se pierde la comprobación física."""
        informe = admision.admitir_snapshot(self.solicitud)
        self.assertEqual(informe["schema_version"], 2)
        self.assertEqual(informe["indices_evidencias"]["pruebas"]["archivos"], len(self.archivos))
        self.assertEqual(
            informe["indices_evidencias"]["pruebas"]["bytes_archivos"], sum(map(len, self.archivos.values()))
        )
        destino = self.solicitud.validacion_destino
        anterior = destino.read_bytes(), destino.stat().st_mtime_ns
        self.assertEqual(self.exigir(), informe)
        self.assertEqual(admision.admitir_snapshot(self.solicitud), informe)
        self.assertEqual((destino.read_bytes(), destino.stat().st_mtime_ns), anterior)
        self.assertNotIn(str(self.raiz), destino.read_text())

    def test_cuerpo_recibo_e_indice_ausentes_alterados_rechazan_sin_reemplazar(self) -> None:
        """Ni la lectura ni la readmisión bendicen bytes distintos recalculando SHA."""
        admision.admitir_snapshot(self.solicitud)
        anterior = self.solicitud.validacion_destino.read_bytes()
        for archivo in (self.indice, *(self.raiz / n for n in self.archivos)):
            original = archivo.read_bytes()
            for alterar in (False, True):
                with self.subTest(archivo=archivo.name, alterar=alterar):
                    archivo.unlink()
                    if alterar:
                        archivo.write_bytes(b"sustitucion")
                    try:
                        with self.assertRaises(admision.ErrorAdmisionCatalogo):
                            self.exigir()
                        with self.assertRaises(admision.ErrorAdmisionCatalogo):
                            admision.admitir_snapshot(self.solicitud)
                        self.assertEqual(self.solicitud.validacion_destino.read_bytes(), anterior)
                    finally:
                        archivo.unlink(missing_ok=True)
                        archivo.write_bytes(original)

    def test_rutas_duplicadas_escape_y_claves_ajenas_se_rechazan(self) -> None:
        """No hay normalización permisiva ni selector JSON que autorice referencias."""
        primera = self.filas()[0]
        casos = [
            [primera, primera],
            [primera, {**primera, "sha256": "f" * 64}],
            [{**primera, "extra": "otra autoridad"}],
            *[
                [{**primera, "archivo": ruta}]
                for ruta in (
                    "../escape",
                    "/absoluta",
                    "a/../curso.body",
                    "./curso.body",
                    "a//b",
                    "C:/escape",
                    "a\\b",
                    ".",
                )
            ],
        ]
        for filas in casos:
            with self.subTest(filas=filas), self.assertRaises(admision.ErrorAdmisionCatalogo):
                admision.admitir_snapshot(self.conservar_indice(filas))
        for cuerpo in (
            b'{"schema_version":1,"schema_version":1}',
            b'{"schema_version":NaN}',
            b'{"schema_version":true,"archivos_conservados":[]}',
            b"[",
        ):
            self.indice.write_bytes(cuerpo)
            solicitud = replace(
                self.solicitud,
                indices_evidencias={
                    "pruebas": admision.IndiceEvidencias(archivo=self.caso.referencia(self.indice), raiz=self.raiz)
                },
            )
            with self.subTest(cuerpo=cuerpo), self.assertRaises(admision.ErrorAdmisionCatalogo):
                admision.admitir_snapshot(solicitud)

    def test_enlaces_duros_simbolicos_padres_y_destino_sobre_evidencia_rechazados(self) -> None:
        """Todas las referencias efectivas participan en la frontera de escritura."""
        archivo = self.raiz / "curso.body"
        original = archivo.read_bytes()
        archivo.unlink()
        archivo.symlink_to(self.raiz / "recibo.json")
        with self.assertRaises(admision.ErrorAdmisionCatalogo):
            admision.admitir_snapshot(self.solicitud)
        archivo.unlink()
        archivo.write_bytes(original)
        enlace = self.caso.raiz / "padre"
        enlace.symlink_to(self.raiz, target_is_directory=True)
        solicitud = replace(
            self.solicitud,
            indices_evidencias={
                "pruebas": admision.IndiceEvidencias(archivo=self.caso.referencia(self.indice), raiz=enlace)
            },
        )
        with self.assertRaises(admision.ErrorAdmisionCatalogo):
            admision.admitir_snapshot(solicitud)
        duro = self.raiz / "alias-duro"
        duro.hardlink_to(archivo)
        with self.assertRaises(admision.ErrorAdmisionCatalogo):
            admision.admitir_snapshot(self.solicitud)
        duro.unlink()
        with self.assertRaises(admision.ErrorAdmisionCatalogo):
            admision.admitir_snapshot(replace(self.solicitud, validacion_destino=archivo))
        self.assertEqual(archivo.read_bytes(), original)

    def test_presupuesto_compartido_duplicados_entre_indices_y_cotas(self) -> None:
        """Cada índice no recibe una bolsa de bytes o de archivos independiente."""
        segundo = replace(
            self.solicitud,
            indices_evidencias={
                **self.solicitud.indices_evidencias,
                "otras": self.solicitud.indices_evidencias["pruebas"],
            },
        )
        with self.assertRaisesRegex(admision.ErrorAdmisionCatalogo, "repetido"):
            admision.admitir_snapshot(segundo)
        total = (
            self.caso.procedencia.stat().st_size + self.indice.stat().st_size + sum(map(len, self.archivos.values()))
        )
        with patch.object(admision, "MAX_TOTAL_ENTRADAS", total - 1), self.assertRaises(admision.ErrorAdmisionCatalogo):
            admision.admitir_snapshot(self.solicitud)
        for modulo, campo in (
            (indices_evidencias, "MAX_INDICE"),
            (indices_evidencias, "MAX_ARCHIVOS"),
            (admision, "MAX_ENTRADA"),
            (admision, "MAX_INFORME"),
            (admision, "MAX_REFERENCIAS"),
        ):
            with (
                patch.object(modulo, campo, 1),
                self.subTest(campo=campo),
                self.assertRaises(admision.ErrorAdmisionCatalogo),
            ):
                admision.admitir_snapshot(self.solicitud)
        self.assertFalse(self.solicitud.validacion_destino.exists())

    def test_cota_de_archivos_compartida_entre_dos_indices_distintos(self) -> None:
        """Dos índices no duplicados consumen el mismo contador global."""
        filas = self.filas()
        primero = self.conservar_indice(filas[:1]).indices_evidencias["pruebas"]
        segundo = self.indice.with_name("segundo.json")
        segundo.write_text(json.dumps({"schema_version": 1, "archivos_conservados": filas[1:]}))
        solicitud = replace(
            self.solicitud,
            indices_evidencias={
                "primero": primero,
                "segundo": admision.IndiceEvidencias(archivo=self.caso.referencia(segundo), raiz=self.raiz),
            },
        )
        with (
            patch.object(indices_evidencias, "MAX_ARCHIVOS", 1),
            self.assertRaisesRegex(admision.ErrorAdmisionCatalogo, "Demasiados"),
        ):
            admision.admitir_snapshot(solicitud)
        self.assertFalse(solicitud.validacion_destino.exists())

    def test_37_fichas_seis_ciclos_superan_256_archivos_sin_perder_identidades(self) -> None:
        """Cuerpos deduplicados y consultas distintas conservan sus SHA y recuentos."""
        self.archivos = {f"curso-{i}.body": f"cuerpo-{i}".encode() for i in range(37)}
        for nombre, contenido in self.archivos.items():
            (self.raiz / nombre).write_bytes(contenido)
        anteriores = {}
        for ciclo in range(6):
            for i in range(37):
                nombre = f"recibo-{ciclo}-{i}.json"
                contenido = json.dumps({"curso": i, "consulta_sintetica": ciclo}).encode()
                self.archivos[nombre] = contenido
                (self.raiz / nombre).write_bytes(contenido)
            self.solicitud = self.conservar_indice(self.filas())
            informe = admision.admitir_snapshot(self.solicitud)
            self.assertEqual(informe["indices_evidencias"]["pruebas"]["archivos"], len(self.archivos))
            self.assertEqual(self.exigir(), informe)
            self.assertTrue(anteriores.items() <= self.archivos.items())
            anteriores = dict(self.archivos)
        self.assertGreater(len(self.archivos), admision.MAX_REFERENCIAS)
        destino = self.solicitud.validacion_destino
        antes = destino.read_bytes(), destino.stat().st_mtime_ns
        self.assertEqual(admision.admitir_snapshot(self.solicitud), informe)
        self.assertEqual((destino.read_bytes(), destino.stat().st_mtime_ns), antes)
        self.assertEqual(len(self.solicitud.procedencia), 1)
