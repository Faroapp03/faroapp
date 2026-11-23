"""Regresiones focales del catálogo y de las instantáneas completas."""

import copy
import hashlib
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from typing import Never
from unittest.mock import patch

from plataforma_datos.cursos import catalogo
from plataforma_datos.cursos.catalogo import (
    ErrorCatalogo,
    InstantaneaCatalogo,
    buscar,
    cargar_lote,
    conciliar_instantanea,
    importar_y_conciliar,
    resumen,
)
from plataforma_datos.cursos.tipos_json import ObjetoJson, ValorJson

type ValorSql = None | int | float | str | bytes


def lote_base() -> ObjetoJson:
    """Crea un programa y una edición sintéticos con evidencias declaradas.

    Returns:
        Lote inicial con un proveedor, un programa y una edición.
    """
    return {
        "schema_version": 1,
        "observado_utc": "2026-10-22T08:00:00Z",
        "fuente_lote": "prueba-local",
        "proveedores": [
            {"id": "proveedor-1", "nombre": "Formación de ejemplo", "territorio": None, "naturaleza": "pública"}
        ],
        "programas": [
            {
                "id": "programa-1",
                "proveedor_id": "proveedor-1",
                "titulo": "Introducción a Python",
                "url": "https://example.org/formacion/python",
                "tipo_unidad": "curso",
                "datos": {"modalidad": None, "plazas": None, "temario_huella": "a" * 64},
                "evidencias": [
                    {
                        "url": "https://example.org/formacion/python",
                        "capturado_utc": "2026-10-22T08:00:00Z",
                        "sha256": "b" * 64,
                        "archivo": None,
                    }
                ],
                "etiquetas": [
                    {
                        "codigo": "programacion",
                        "estado": "propuesta",
                        "metodo": "revisión temática de prueba",
                        "evidencia": None,
                    }
                ],
            }
        ],
        "ediciones": [
            {
                "id": "edicion-1",
                "programa_id": "programa-1",
                "datos": {"fecha_inicio": None, "estado_inscripcion": None},
                "evidencias": [],
            }
        ],
    }


class CatalogoPruebas(unittest.TestCase):
    """Importación, historial y conciliación atómica sobre una base aislada."""

    def setUp(self) -> None:
        """Prepara una candidata aislada y registra su limpieza."""
        self.temporal = tempfile.TemporaryDirectory(prefix="catálogo-")
        self.addCleanup(self.temporal.cleanup)
        self.raiz = Path(self.temporal.name)
        self.base = self.raiz / "base con espacios ñ.sqlite"
        self.lote = lote_base()

    def filas(self, sql: str, parametros: tuple[ValorSql, ...] = ()) -> list[tuple[ValorSql, ...]]:
        """Consulta filas de la candidata para comprobar conservación exacta.

        Returns:
            Filas SQL en el orden solicitado por la prueba.
        """
        with sqlite3.connect(self.base) as conexion:
            return conexion.execute(sql, parametros).fetchall()

    def importar(self, lote: ObjetoJson | None = None) -> dict[str, int]:
        """Carga el lote de prueba en la candidata aislada.

        Returns:
            Recuentos confirmados por la importación del lote.
        """
        return cargar_lote(self.base, self.lote if lote is None else lote)

    def test_idempotencia_con_nueva_observacion_y_captura(self) -> None:
        """Regresión: idempotencia con nueva observacion y captura."""
        self.importar()
        versiones = resumen(self.base)["versiones"]
        self.lote["observado_utc"] = "2026-10-23T08:00:00+00:00"
        self.lote["programas"][0]["evidencias"][0]["capturado_utc"] = "2026-10-23T08:00:00Z"
        self.importar()
        self.importar()
        estado = resumen(self.base)
        self.assertEqual(estado["versiones"], versiones)
        self.assertEqual(estado["evidencias"], 2)
        self.assertEqual(estado["ejecuciones"], 3)
        self.assertEqual(estado["observaciones"], 9)
        self.assertEqual(estado["programas"], 1)

    def test_edicion_nueva_no_duplica_programa(self) -> None:
        """Regresión: edicion nueva no duplica programa."""
        self.importar()
        self.lote["ediciones"][0]["id"] = "edicion-2"
        self.importar()
        estado = resumen(self.base)
        self.assertEqual((estado["programas"], estado["ediciones"]), (1, 2))
        self.assertEqual(self.filas("SELECT count(*) FROM versiones WHERE entidad='programa'")[0][0], 1)

    def test_cambio_preserva_antes_despues_y_huellas(self) -> None:
        """Regresión: cambio preserva antes despues y huellas."""
        self.importar()
        self.lote["programas"][0]["titulo"] = "Python aplicado"
        self.importar()
        antes, despues, huella_antes, huella_despues = self.filas(
            "SELECT antes,despues,huella_antes,huella_despues FROM versiones WHERE "
            "entidad='programa' ORDER BY id DESC LIMIT 1"
        )[0]
        self.assertEqual(json.loads(antes)["titulo"], "Introducción a Python")
        self.assertEqual(json.loads(despues)["titulo"], "Python aplicado")
        self.assertNotEqual(huella_antes, huella_despues)
        self.assertEqual(len(buscar(self.base, "aplicado")), 1)
        self.assertEqual(buscar(self.base, "Introducción"), [])

    def test_desconocidos_siguen_siendo_null(self) -> None:
        """Regresión: desconocidos siguen siendo null."""
        self.importar()
        datos = buscar(self.base, "Python")[0]["datos"]
        self.assertIsNone(datos["modalidad"])
        self.assertIsNone(datos["plazas"])
        self.assertNotIn("elegible", datos)
        self.assertIsNone(json.loads(self.filas("SELECT datos FROM ediciones")[0][0])["estado_inscripcion"])

    def test_tipos_json_distintos_generan_version(self) -> None:
        """Regresión: tipos json distintos generan version."""
        self.importar()
        self.lote["programas"][0]["datos"]["plazas"] = False
        self.importar()
        self.lote["programas"][0]["datos"]["plazas"] = 0
        self.importar()
        self.assertEqual(self.filas("SELECT count(*) FROM versiones WHERE entidad='programa'")[0][0], 3)
        self.assertEqual(type(buscar(self.base, "Python")[0]["datos"]["plazas"]), int)

    def test_referencia_invalida_revierte_todo(self) -> None:
        """Regresión: referencia invalida revierte todo."""
        self.importar()
        antes = resumen(self.base)
        self.lote["proveedores"][0]["nombre"] = "No debe guardarse"
        self.lote["ediciones"][0]["programa_id"] = "inexistente"
        with self.assertRaises(ErrorCatalogo):
            self.importar()
        self.assertEqual(resumen(self.base), antes)
        self.assertEqual(self.filas("SELECT nombre FROM proveedores")[0][0], "Formación de ejemplo")

    def test_ausencia_en_lote_parcial_no_borra(self) -> None:
        """Regresión: ausencia en lote parcial no borra."""
        self.importar()
        self.lote["proveedores"] = []
        self.lote["programas"] = []
        self.lote["ediciones"][0]["id"] = "edicion-2"
        self.importar()
        self.assertEqual(resumen(self.base)["ediciones"], 2)
        self.assertEqual(resumen(self.base)["etiquetas_vigentes"], 1)

    def test_cambio_temario_invalida_y_conserva_historia(self) -> None:
        """Regresión: cambio temario invalida y conserva historia."""
        self.importar()
        self.lote["programas"][0]["datos"]["temario_huella"] = "c" * 64
        self.lote["programas"][0]["etiquetas"] = []
        self.importar()
        self.assertEqual(
            self.filas("SELECT revision,vigente FROM etiquetas ORDER BY id"), [("vigente", 0), ("requiere_revision", 1)]
        )
        self.lote["programas"][0]["etiquetas"] = copy.deepcopy(lote_base()["programas"][0]["etiquetas"])
        self.lote["programas"][0]["etiquetas"][0]["estado"] = "sustentada"
        self.importar()
        self.assertEqual(
            self.filas("SELECT estado,revision FROM etiquetas WHERE vigente=1"), [("propuesta", "requiere_revision")]
        )

    def test_cambio_captura_no_invalida_temario(self) -> None:
        """Regresión: cambio captura no invalida temario."""
        self.importar()
        self.lote["programas"][0]["evidencias"][0]["sha256"] = "d" * 64
        self.importar()
        self.assertEqual(resumen(self.base)["etiquetas_requieren_revision"], 0)

    def test_lote_no_promueve_propuesta_a_sustentada(self) -> None:
        """Regresión: lote no promueve propuesta a sustentada."""
        self.importar()
        self.lote["programas"][0]["etiquetas"][0].update(estado="sustentada", evidencia={"url": "https://example.org"})
        self.importar()
        self.assertEqual(
            self.filas("SELECT estado,revision,vigente FROM etiquetas ORDER BY id"),
            [("propuesta", "vigente", 0), ("propuesta", "requiere_revision", 1)],
        )
        decision, entrada = self.filas("SELECT decision_conservada,entrada FROM conflictos_etiquetas")[0]
        self.assertEqual(json.loads(decision)["estado"], "propuesta")
        self.assertEqual(json.loads(entrada)["estado"], "sustentada")

    def test_sustentada_se_preserva_ante_reclasificacion_derivada(self) -> None:
        """Regresión: sustentada se preserva ante reclasificacion derivada."""
        for estado_nuevo in ("propuesta", "sustentada"):
            with self.subTest(estado=estado_nuevo):
                self.base = self.raiz / (estado_nuevo + ".sqlite")
                self.lote = lote_base()
                anterior = self.lote["programas"][0]["etiquetas"][0]
                anterior.update(estado="sustentada", metodo="decisión revisada", evidencia={"decision": "previa"})
                self.importar()
                self.lote["programas"][0]["etiquetas"][0].update(
                    estado=estado_nuevo, metodo="reglas derivadas nuevas", evidencia={"decision": "derivada"}
                )
                self.importar()
                estado = resumen(self.base)
                self.importar()
                self.assertEqual(resumen(self.base)["versiones"], estado["versiones"])
                self.assertEqual(resumen(self.base)["conflictos_etiquetas"], 1)
                vigente = self.filas("SELECT estado,metodo,evidencia,revision FROM etiquetas WHERE vigente=1")[0]
                self.assertEqual(
                    vigente, ("sustentada", "decisión revisada", '{"decision":"previa"}', "requiere_revision")
                )

    def test_invalida_cada_insumo_pedagogico_con_temario_desconocido(self) -> None:
        """Regresión: invalida cada insumo pedagogico con temario desconocido."""
        cambios = {
            "titulo": "Contenido pedagógico nuevo",
            "contenido_huella": "e" * 64,
            "resumen_investigacion": "Nuevos objetivos de aprendizaje",
            "nivel_publicado": "Intermedio",
            "requisitos_publicados": ["Experiencia previa"],
            "capacidades_revisadas": ["Capacidad nueva"],
            "temario_huella": "f" * 64,
        }
        for campo, valor in cambios.items():
            with self.subTest(campo=campo):
                self.base = self.raiz / (campo + ".sqlite")
                self.lote = lote_base()
                self.lote["programas"][0]["datos"]["temario_huella"] = None
                self.importar()
                self.assertEqual(resumen(self.base)["etiquetas_requieren_revision"], 0)
                if campo == "titulo":
                    self.lote["programas"][0][campo] = valor
                else:
                    self.lote["programas"][0]["datos"][campo] = valor
                self.importar()
                self.assertEqual(resumen(self.base)["etiquetas_requieren_revision"], 1)
                self.assertEqual(
                    self.filas("SELECT revision,vigente FROM etiquetas ORDER BY id"),
                    [("vigente", 0), ("requiere_revision", 1)],
                )
                versiones = resumen(self.base)["versiones"]
                self.importar()
                self.assertEqual(resumen(self.base)["versiones"], versiones)

    def test_cambio_comercial_no_invalida_clasificacion(self) -> None:
        """Regresión: cambio comercial no invalida clasificacion."""
        self.importar()
        self.lote["programas"][0]["datos"]["plazas"] = 15
        self.importar()
        self.assertEqual(resumen(self.base)["etiquetas_requieren_revision"], 0)

    def test_lote_atrasado_se_rechaza_por_entidad_y_atomico(self) -> None:
        """Regresión: lote atrasado se rechaza por entidad y atomico."""
        self.lote["observado_utc"] = "2026-10-23T08:00:00Z"
        self.importar()
        antes = resumen(self.base)
        atrasado = copy.deepcopy(self.lote)
        atrasado["observado_utc"] = "2026-10-20T08:00:00+00:00"
        atrasado["programas"][0]["titulo"] = "Título antiguo"
        atrasado["proveedores"][0]["nombre"] = "Proveedor antiguo"
        atrasado["ediciones"].append(
            {"id": "nueva-no-guardar", "programa_id": "programa-1", "datos": {}, "evidencias": []}
        )
        with self.assertRaises(ErrorCatalogo):
            self.importar(atrasado)
        self.assertEqual(resumen(self.base), antes)
        self.assertEqual(buscar(self.base, "Python")[0]["titulo"], "Introducción a Python")
        # Misma fecha absoluta expresada con otro sufijo no es una observación atrasada.
        self.lote["observado_utc"] = "2026-10-23T08:00:00+00:00"
        self.importar()
        self.assertEqual(resumen(self.base)["versiones"], antes["versiones"])

    def test_antiguedad_de_programa_no_depende_de_enviar_proveedor(self) -> None:
        """Regresión: antiguedad de programa no depende de enviar proveedor."""
        self.importar()
        self.lote["proveedores"] = []
        self.lote["ediciones"] = []
        self.lote["observado_utc"] = "2026-10-23T08:00:00Z"
        self.importar()
        self.lote["observado_utc"] = "2026-10-22T09:00:00Z"
        with self.assertRaises(ErrorCatalogo):
            self.importar()
        self.lote["programas"][0]["id"] = "otro-programa-sin-observacion"
        self.importar()
        self.assertEqual(resumen(self.base)["programas"], 2)

    def test_validacion_rechaza_tipos_urls_sha_y_duplicados(self) -> None:
        """Regresión: validacion rechaza tipos urls sha y duplicados."""
        casos = []
        for url in (
            "file:///tmp/archivo",
            "https://127.0.0.1/x",
            "https://192.168.1.1/x",
            "https://usuario:clave@example.org",
            "https://localhost/x",
            "https://[::1]/",
            "https://example.internal/x",
            "https://example.org:mal/x",
        ):
            lote = lote_base()
            lote["programas"][0]["url"] = url
            casos.append(lote)
        for campo, valor in (("schema_version", True), ("observado_utc", "2026-10-22")):
            lote = lote_base()
            lote[campo] = valor
            casos.append(lote)
        lote = lote_base()
        lote["programas"][0]["datos"]["temario_huella"] = "no-es-sha"
        casos.append(lote)
        lote = lote_base()
        lote["programas"].append(copy.deepcopy(lote["programas"][0]))
        casos.append(lote)
        lote = lote_base()
        lote["programas"][0]["datos"]["horas"] = float("nan")
        casos.append(lote)
        for lote in casos:
            with self.subTest(lote=lote), self.assertRaises(ErrorCatalogo):
                self.importar(lote)
        self.assertFalse(self.base.exists())

    def test_capturas_se_comprueban_solo_en_raiz_explicita(self) -> None:
        """Regresión: capturas se comprueban solo en raiz explicita."""
        capturas = self.raiz / "capturas"
        capturas.mkdir()
        archivo = capturas / "fuente.html"
        archivo.write_bytes(b"contenido local")
        evidencia = self.lote["programas"][0]["evidencias"][0]
        evidencia.update(archivo="fuente.html", sha256=hashlib.sha256(archivo.read_bytes()).hexdigest())
        cargar_lote(self.base, self.lote, True, capturas)
        antes = resumen(self.base)
        archivo.write_bytes(b"alterado")
        with self.assertRaises(ErrorCatalogo):
            cargar_lote(self.base, self.lote, True, capturas)
        self.assertEqual(resumen(self.base), antes)
        with self.assertRaises(ErrorCatalogo):
            cargar_lote(self.base, self.lote, True)
        exterior = self.raiz / "exterior.html"
        exterior.write_bytes(b"exterior")
        (capturas / "enlace").symlink_to(exterior)
        evidencia["archivo"] = "enlace"
        with self.assertRaises(ErrorCatalogo):
            cargar_lote(self.base, self.lote, True, capturas)
        evidencia["archivo"] = "../exterior.html"
        with self.assertRaises(ErrorCatalogo):
            self.importar()

    def test_json_con_claves_repetidas_se_rechaza(self) -> None:
        """Regresión: json con claves repetidas se rechaza."""
        entrada = self.raiz / "duplicado.json"
        entrada.write_text('{"schema_version":1,"schema_version":1}')
        with self.assertRaises(ErrorCatalogo):
            cargar_lote(self.base, entrada)

    def test_entrada_archivo_y_procedencia_de_evidencias(self) -> None:
        """Regresión: entrada archivo y procedencia de evidencias."""
        entrada = self.raiz / "lote ñ.json"
        entrada.write_text(json.dumps(self.lote, ensure_ascii=False), encoding="utf-8")
        cargar_lote(self.base, entrada)
        self.assertEqual(
            self.filas("SELECT e.fuente_lote FROM observaciones_evidencia o JOIN ejecuciones e ON e.id=o.ejecucion_id"),
            [("prueba-local",)],
        )

    def test_error_apertura_no_crea_bases_de_consulta(self) -> None:
        """Regresión: error apertura no crea bases de consulta."""
        with self.assertRaises(ErrorCatalogo):
            cargar_lote(self.raiz / "ausente" / "base.sqlite", self.lote)
        with self.assertRaises(ErrorCatalogo):
            conciliar_instantanea(
                self.base,
                InstantaneaCatalogo(
                    proveedor_id="proveedor-1",
                    ambito="web",
                    ids_programas=[],
                    total_publicado=0,
                    completa=True,
                    errores=[],
                    observado_utc=self.lote["observado_utc"],
                ),
            )
        self.assertFalse(self.base.exists())

    def programas_numerados(self, cantidad: int) -> list[str]:
        """Prepara e importa programas distintos para comprobar el censo.

        Returns:
            Identificadores de los programas importados, en orden numérico.
        """
        programa = self.lote["programas"][0]
        self.lote["programas"] = []
        self.lote["ediciones"] = []
        for numero in range(cantidad):
            nuevo = copy.deepcopy(programa)
            nuevo["id"] = f"p{numero:02d}"
            nuevo["etiquetas"] = []
            nuevo["datos"]["estado_inscripcion"] = "desconocido"
            self.lote["programas"].append(nuevo)
        self.importar()
        return [programa["id"] for programa in self.lote["programas"]]

    def conciliar(self, ids: list[str], **ajustes: ValorJson) -> ObjetoJson:
        """Concilia el censo sintético con las variaciones del caso.

        Returns:
            Resultado de pertenencia del censo probado.
        """
        argumentos = {
            ("proveedor_id"): ("proveedor-1"),
            ("ambito"): ("catalogo-web"),
            ("ids_programas"): ids,
            ("total_publicado"): len(ids),
            ("completa"): True,
            ("errores"): [],
            ("observado_utc"): self.lote[("observado_utc")],
        }
        argumentos.update(ajustes)
        return conciliar_instantanea(self.base, InstantaneaCatalogo(**argumentos))

    def test_diez_mas_tres_menos_dos_once_activos_y_reaparicion(self) -> None:
        """Regresión: diez mas tres menos dos once activos y reaparicion."""
        ids = self.programas_numerados(13)
        primera = self.conciliar(ids[:10])
        self.assertEqual(len(primera["activados"]), 10)
        segunda = self.conciliar(ids[2:])
        self.assertEqual(segunda["activos"], 11)
        self.assertEqual(segunda["activados"], ids[10:])
        self.assertEqual(segunda["retirados"], ids[:2])
        self.assertEqual(resumen(self.base)["programas"], 13)
        tercera = self.conciliar(ids[1:])
        self.assertEqual(tercera["reactivados"], [ids[1]])
        self.assertEqual(
            self.filas("SELECT cambio FROM historial_pertenencia WHERE programa_id=? ORDER BY id", (ids[1],)),
            [("alta",), ("retirada",), ("reactivacion",)],
        )
        self.assertEqual(buscar(self.base, "Python")[0]["datos"]["estado_inscripcion"], "desconocido")

    def test_instantanea_invalida_no_retira_ninguno(self) -> None:
        """Regresión: instantanea invalida no retira ninguno."""
        ids = self.programas_numerados(10)
        self.conciliar(ids)
        antes = resumen(self.base)
        casos = (
            {"completa": False},
            {"errores": ["fallo página 2"]},
            {"total_publicado": 10},
            {"ids_programas": ["inexistente"], "total_publicado": 1},
            {"ids_programas": [ids[0], ids[0]], "total_publicado": 1},
            {"total_publicado": True},
        )
        for ajustes in casos:
            with self.subTest(ajustes=ajustes), self.assertRaises(ErrorCatalogo):
                self.conciliar(ids[:9], **ajustes)
            self.assertEqual(resumen(self.base), antes)
        otro = copy.deepcopy(self.lote)
        otro["proveedores"][0]["id"] = "otro"
        otro["programas"] = []
        self.importar(otro)
        with self.assertRaises(ErrorCatalogo):
            self.conciliar(ids, proveedor_id="otro")
        self.assertEqual(resumen(self.base)["pertenencias_activas"], 10)

    def test_ambitos_independientes_y_vacio_completo_retira(self) -> None:
        """Regresión: ambitos independientes y vacio completo retira."""
        ids = self.programas_numerados(3)
        self.conciliar(ids)
        self.conciliar(ids[:1], ambito="otro-ambito")
        self.assertEqual(self.conciliar([])["retirados"], ids)
        self.assertEqual(self.filas("SELECT programa_id FROM pertenencia_catalogo WHERE activo=1"), [(ids[0],)])
        self.assertEqual(resumen(self.base)["programas"], 3)

    def test_instantanea_anterior_no_retira_y_usa_fecha_real(self) -> None:
        """Regresión: instantanea anterior no retira y usa fecha real."""
        ids = self.programas_numerados(3)
        self.conciliar(ids, observado_utc="2026-10-23T08:00:00Z")
        antes = resumen(self.base)
        with self.assertRaises(ErrorCatalogo):
            self.conciliar([], observado_utc="2026-10-20T08:00:00+00:00")
        self.assertEqual(resumen(self.base), antes)
        self.assertEqual(
            self.filas("SELECT DISTINCT ultima_observacion FROM pertenencia_catalogo"), [("2026-10-23T08:00:00Z",)]
        )
        self.conciliar([], ambito="otro-ambito", observado_utc="2026-10-20T08:00:00Z")
        self.assertEqual(resumen(self.base)["pertenencias_activas"], 3)
        with self.assertRaises(ErrorCatalogo):
            self.conciliar([], observado_utc=None)

    def ciclo_atomico(self, ids: list[str] | None = None, **ajustes: ValorJson) -> ObjetoJson:
        """Importa y concilia el mismo censo en una única transacción.

        Returns:
            Resultados de importación y conciliación de la candidata.
        """
        ids = [programa["id"] for programa in self.lote["programas"]] if ids is None else ids
        argumentos = {
            ("proveedor_id"): ("proveedor-1"),
            ("ambito"): ("catalogo-web"),
            ("ids_programas"): ids,
            ("total_publicado"): len(ids),
            ("completa"): True,
            ("errores"): [],
            ("observado_utc"): self.lote[("observado_utc")],
        }
        argumentos.update(ajustes)
        return importar_y_conciliar(self.base, self.lote, InstantaneaCatalogo(**argumentos))

    def test_ciclo_atomico_confirma_datos_y_pertenencia_juntos(self) -> None:
        """Regresión: ciclo atomico confirma datos y pertenencia juntos."""
        resultado = self.ciclo_atomico()
        self.assertEqual(resultado["importacion"]["programas_observados"], 1)
        self.assertEqual(resultado["conciliacion"]["activados"], ["programa-1"])
        self.assertEqual(resultado["conciliacion"]["activos"], 1)
        versiones = resumen(self.base)["versiones"]
        self.ciclo_atomico()
        self.assertEqual(resumen(self.base)["versiones"], versiones)
        self.assertEqual(resumen(self.base)["historial_pertenencia"], 1)

    def test_ciclo_atomico_fallo_postconciliacion_preserva_bytes_base(self) -> None:
        """Regresión: ciclo atomico fallo postconciliacion preserva bytes base."""
        self.ciclo_atomico()
        antes = resumen(self.base)
        bytes_antes = self.base.read_bytes()
        self.lote["programas"][0]["titulo"] = "Título nuevo que debe revertirse"
        nuevo = copy.deepcopy(self.lote["programas"][0])
        nuevo["id"] = "programa-2"
        self.lote["programas"].append(nuevo)
        accion_original = catalogo._conciliar_en_conexion

        def fallar_despues_de_ambas_acciones(
            conexion: sqlite3.Connection, instantanea: InstantaneaCatalogo, ids: set[str], protegido: bool = False
        ) -> Never:
            self.assertEqual(conexion.execute("SELECT count(*) FROM programas").fetchone()[0], 2)
            accion_original(conexion, instantanea, ids, protegido)
            self.assertEqual(
                conexion.execute("SELECT count(*) FROM pertenencia_catalogo WHERE activo=1").fetchone()[0], 1
            )
            self.assertEqual(
                conexion.execute("SELECT programa_id FROM pertenencia_catalogo WHERE activo=1").fetchone()[0],
                "programa-2",
            )
            raise RuntimeError("Fallo inyectado después de importar y conciliar")

        with (
            patch(
                "plataforma_datos.cursos.catalogo._conciliar_en_conexion", side_effect=fallar_despues_de_ambas_acciones
            ),
            self.assertRaisesRegex(RuntimeError, "Fallo inyectado"),
        ):
            self.ciclo_atomico(ids=["programa-2"])
        self.assertEqual(self.base.read_bytes(), bytes_antes)
        self.assertEqual(resumen(self.base), antes)
        self.assertEqual(buscar(self.base, "Python")[0]["titulo"], "Introducción a Python")

    def test_ciclo_atomico_referencia_snapshot_invalida_revierte_importacion(self) -> None:
        """Regresión: ciclo atomico referencia de instantánea inválida revierte importacion."""
        self.ciclo_atomico()
        bytes_antes = self.base.read_bytes()
        self.lote["programas"][0]["titulo"] = "No debe confirmarse"
        with self.assertRaises(ErrorCatalogo):
            self.ciclo_atomico(ids=["inexistente"])
        self.assertEqual(self.base.read_bytes(), bytes_antes)
        self.assertEqual(buscar(self.base, "Python")[0]["titulo"], "Introducción a Python")

    def test_ciclo_atomico_primera_carga_fallida_no_deja_programas(self) -> None:
        """Regresión: ciclo atomico primera carga fallida no deja programas."""
        with self.assertRaises(ErrorCatalogo):
            self.ciclo_atomico(ids=["inexistente"])
        self.assertEqual(self.filas("SELECT count(*) FROM sqlite_master WHERE type='table'")[0][0], 0)

    def test_ciclo_diario_atomico_diez_mas_tres_menos_dos(self) -> None:
        """Regresión: ciclo diario atomico diez mas tres menos dos."""
        plantilla = self.lote["programas"][0]
        todos = []
        for numero in range(13):
            programa = copy.deepcopy(plantilla)
            programa["id"] = f"programa-{numero:02d}"
            todos.append(programa)
        self.lote["ediciones"] = []
        self.lote["programas"] = todos[:10]
        self.ciclo_atomico()
        self.lote["observado_utc"] = "2026-10-23T08:00:00Z"
        self.lote["programas"] = todos[2:]
        resultado = self.ciclo_atomico()
        self.assertEqual(len(resultado["conciliacion"]["activados"]), 3)
        self.assertEqual(len(resultado["conciliacion"]["retirados"]), 2)
        self.assertEqual(resultado["conciliacion"]["activos"], 11)
        self.assertEqual(resumen(self.base)["programas"], 13)
        self.assertEqual(resumen(self.base)["pertenencias_activas"], 11)

    def test_instantanea_identica_no_duplica_cambios(self) -> None:
        """Regresión: instantanea identica no duplica cambios."""
        ids = self.programas_numerados(2)
        self.conciliar(ids)
        self.conciliar(list(reversed(ids)))
        self.assertEqual(resumen(self.base)["historial_pertenencia"], 2)
        self.assertEqual(resumen(self.base)["instantaneas"], 2)


if __name__ == "__main__":
    unittest.main()
