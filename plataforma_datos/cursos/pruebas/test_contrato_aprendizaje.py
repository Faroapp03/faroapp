"""Regresiones de aprendizaje en la importación real; vocabulario solo sintético."""

import copy
import hashlib
import io
import json
import sqlite3
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest.mock import patch

from plataforma_datos.cursos import catalogo
from plataforma_datos.cursos.catalogo import (
    ErrorCatalogo,
    cargar_lote,
    consultar_aprendizaje,
    resumen,
)
from plataforma_datos.cursos.contrato_aprendizaje import (
    ErrorAprendizaje,
    cargar_registro,
    competencia_registrada,
    validar_registro,
)
from plataforma_datos.cursos.pruebas.test_catalogo import lote_base
from plataforma_datos.cursos.tipos_json import ObjetoJson

VERSION_OFERTA = 2

COMPETENCIA = {"marco": "marco-sintetico", "version": "prueba-1", "codigo": "C1"}
ESCALA = {"id": "escala-sintetica", "version": "prueba-1"}
REGISTRO = {
    "id": "registro-sintetico",
    "version": "prueba-1",
    "competencias": [
        {
            **COMPETENCIA,
            "denominacion": "Competencia de prueba",
            "fuente": "Fixture sintética",
        }
    ],
    "escalas": [
        {
            **ESCALA,
            "denominacion": "Escala de prueba sin orden implícito",
            "fuente": "Fixture sintética",
            "valores": ["A", "B"],
        }
    ],
}
HUELLA = hashlib.sha256(json.dumps(REGISTRO, sort_keys=True).encode()).hexdigest()


def lote_aprendizaje() -> ObjetoJson:
    """Construye un lote con una afirmación y su evidencia sintéticas.

    Returns:
        El resultado de la operación sintética.
    """
    lote = lote_base()
    lote.update(schema_version=3, variantes=[], centros=[], anuncios=[])
    captura = lote["programas"][0]["evidencias"][0]
    lote["programas"][0]["datos"]["aprendizaje"] = {
        "schema_version": 1,
        "registro": {
            "id": REGISTRO["id"],
            "version": REGISTRO["version"],
            "sha256": HUELLA,
        },
        "contenido_observado": True,
        "afirmaciones": [
            {
                "id": "objetivo-1",
                "competencia": copy.deepcopy(COMPETENCIA),
                "dimension": "resultado_previsto",
                "descripcion": "Objetivo publicado de prueba",
                "nivel": {"escala": None, "valor": None},
                "origen": "inferencia",
                "estado": "propuesta",
                "metodo": {"nombre": "método sintético", "version": "1"},
                "revision": None,
                "revision_requerida": False,
                "evidencias": [
                    {k: captura[k] for k in ("url", "capturado_utc", "sha256")}
                    | {
                        "localizador": {"tipo": "objetivo", "valor": "objetivo 1"},
                        "fragmento": "Objetivo publicado de prueba",
                    }
                ],
                "discrepancias": [],
            }
        ],
    }
    return lote


def revisar(afirmacion: ObjetoJson, tipo: str = "automatizada") -> None:
    """Anota una revisión sintética sin promoverla en la base."""
    afirmacion.update(
        estado="revisada",
        revision={
            "tipo": tipo,
            "referencia": "acta-sintetica-1",
            "metodo": {"nombre": "revisión de prueba", "version": "1"},
            "fecha_utc": "2026-10-22T08:00:00Z",
        },
    )


class AprendizajePruebas(unittest.TestCase):
    """Contrasta el contrato con entradas válidas, incompletas y adversas."""

    def setUp(self) -> None:
        """Prepara una base y capturas sintéticas para cada caso."""
        temporal = tempfile.TemporaryDirectory(prefix="aprendizaje ñ ")
        self.addCleanup(temporal.cleanup)
        self.base = Path(temporal.name) / "base con espacios.sqlite3"
        self.lote = lote_aprendizaje()
        parche = patch(
            "plataforma_datos.cursos.catalogo.cargar_registro", return_value=(copy.deepcopy(REGISTRO), HUELLA)
        )
        parche.start()
        self.addCleanup(parche.stop)

    @property
    def aprendizaje(self) -> ObjetoJson:
        """Devuelve el aprendizaje del programa de prueba.

        Returns:
            El resultado de la operación sintética.
        """
        return self.lote["programas"][0]["datos"]["aprendizaje"]

    @property
    def afirmacion(self) -> ObjetoJson:
        """Devuelve la afirmación que modifica cada caso.

        Returns:
            El resultado de la operación sintética.
        """
        return self.aprendizaje["afirmaciones"][0]

    def importar(self, lote: ObjetoJson | None = None) -> ObjetoJson:
        """Importa el lote de prueba en su base temporal.

        Returns:
            El resultado de la operación sintética.
        """
        return cargar_lote(self.base, self.lote if lote is None else lote)

    def filas(self, sql: str) -> list[tuple[object, ...]]:
        """Consulta las filas SQLite para contrastar el estado persistido.

        Returns:
            El resultado de la operación sintética.
        """
        with sqlite3.connect(self.base) as conexion:
            return conexion.execute(sql).fetchall()

    def guardado(self) -> ObjetoJson:
        """Lee el aprendizaje persistido del programa de prueba.

        Returns:
            El resultado de la operación sintética.
        """
        return json.loads(self.filas("SELECT datos FROM programas")[0][0])["aprendizaje"]

    def test_desconocido_explicito_no_crea_nivel_cero_ni_cita(self) -> None:
        """Comprueba desconocido explicito no crea nivel cero ni cita."""
        registro, huella = cargar_registro()
        # Un marco conocido no convierte el aprendizaje desconocido del curso en un nivel.
        self.assertTrue(registro["competencias"])
        self.assertTrue(registro["escalas"])
        self.aprendizaje.update(
            registro={
                "id": registro["id"],
                "version": registro["version"],
                "sha256": huella,
            },
            contenido_observado=False,
            afirmaciones=[],
        )
        with patch("plataforma_datos.cursos.catalogo.cargar_registro", return_value=(registro, huella)):
            self.importar()
        self.assertEqual(self.guardado(), self.aprendizaje)
        self.assertNotIn("nivel_faro", self.guardado())

    def test_identidad_no_registrada_se_conserva_pendiente_sin_nivel(self) -> None:
        """Comprueba identidad no registrada se conserva pendiente sin nivel."""
        self.afirmacion["competencia"]["version"] = "otra-version"
        self.assertFalse(competencia_registrada(self.afirmacion["competencia"], REGISTRO))
        self.importar()
        self.assertEqual(
            self.guardado()["afirmaciones"][0]["competencia"],
            self.afirmacion["competencia"],
        )
        self.afirmacion["nivel"] = {"escala": ESCALA, "valor": "A"}
        with self.assertRaisesRegex(ErrorCatalogo, "competencia registrada"):
            self.importar()

    def test_escala_version_valor_y_tipos_no_se_inventan(self) -> None:
        """Comprueba escala version valor y tipos no se inventan."""
        for nivel in (
            {"escala": None, "valor": "0"},
            {"escala": ESCALA, "valor": 0},
            {"escala": ESCALA, "valor": "0"},
            {"escala": {**ESCALA, "version": "otra"}, "valor": None},
        ):
            with self.subTest(nivel=nivel):
                self.afirmacion["nivel"] = nivel
                with self.assertRaises(ErrorCatalogo):
                    self.importar()
        self.assertFalse(self.base.exists())
        self.afirmacion["nivel"] = {"escala": ESCALA, "valor": "B"}
        self.importar()
        self.assertEqual(self.guardado()["afirmaciones"][0]["nivel"]["valor"], "B")

    def test_entrada_conocida_solo_requisito_oficial(self) -> None:
        """Comprueba entrada conocida solo requisito oficial."""
        self.afirmacion.update(dimension="requisito_entrada", nivel={"escala": ESCALA, "valor": "A"})
        with self.assertRaisesRegex(ErrorCatalogo, "requisito oficial"):
            self.importar()
        self.afirmacion.update(origen="extraccion_oficial", estado="extraida")
        with self.assertRaisesRegex(ErrorCatalogo, "requisito oficial"):
            self.importar()
        self.afirmacion["evidencias"][0]["localizador"]["tipo"] = "requisito"
        self.importar()
        self.assertEqual(self.guardado()["afirmaciones"][0]["dimension"], "requisito_entrada")

    def test_afirmacion_conocida_exige_captura_y_localizador(self) -> None:
        """Comprueba afirmacion conocida exige captura y localizador."""
        casos = []
        for campo, valor in (("evidencias", []), ("evidencias", [{"url": "otra"}])):
            nuevo = copy.deepcopy(self.lote)
            nuevo["programas"][0]["datos"]["aprendizaje"]["afirmaciones"][0][campo] = valor
            casos.append(nuevo)
        for campo, valor in (
            ("sha256", "c" * 64),
            ("capturado_utc", "2026-10-23T08:00:00Z"),
            ("localizador", {"tipo": "titulo", "valor": "h1"}),
            ("fragmento", None),
        ):
            nuevo = copy.deepcopy(self.lote)
            nuevo["programas"][0]["datos"]["aprendizaje"]["afirmaciones"][0]["evidencias"][0][campo] = valor
            casos.append(nuevo)
        for nuevo in casos:
            with self.subTest(nuevo=nuevo), self.assertRaises(ErrorCatalogo):
                self.importar(nuevo)
        self.assertFalse(self.base.exists())

    def test_captura_alterada_revierte_antes_de_escribir(self) -> None:
        """Comprueba captura alterada revierte antes de escribir."""
        archivo = self.base.parent / "captura.txt"
        archivo.write_text("Objetivo publicado de prueba")
        sha = hashlib.sha256(archivo.read_bytes()).hexdigest()
        self.lote["programas"][0]["evidencias"][0].update(archivo=archivo.name, sha256=sha)
        self.afirmacion["evidencias"][0]["sha256"] = sha
        cargar_lote(self.base, self.lote, True, self.base.parent)
        antes = self.base.read_bytes()
        archivo.write_text("alterada")
        with self.assertRaises(ErrorCatalogo):
            cargar_lote(self.base, self.lote, True, self.base.parent)
        self.assertEqual(antes, self.base.read_bytes())

    def test_huella_version_registro_y_version_lote_obligatorias(self) -> None:
        """Comprueba huella version registro y version lote obligatorias."""
        for campo, valor in (("sha256", "0" * 64), ("version", "otra"), ("id", "otro")):
            nuevo = copy.deepcopy(self.lote)
            nuevo["programas"][0]["datos"]["aprendizaje"]["registro"][campo] = valor
            with self.subTest(campo=campo), self.assertRaises(ErrorCatalogo):
                self.importar(nuevo)
        nuevo = copy.deepcopy(self.lote)
        nuevo["schema_version"] = 2
        with self.assertRaisesRegex(ErrorCatalogo, "exige lote 3"):
            self.importar(nuevo)

    def test_revisada_exige_procedencia_y_conserva_tipo_automatizado(self) -> None:
        """Comprueba revisada exige procedencia y conserva tipo automatizado."""
        self.afirmacion["estado"] = "revisada"
        with self.assertRaises(ErrorCatalogo):
            self.importar()
        revisar(self.afirmacion)
        self.importar()
        self.assertEqual(self.guardado()["afirmaciones"][0]["revision"]["tipo"], "automatizada")

    def test_propuesta_no_se_promueve_conflicto_idempotente_conserva_entrada(self) -> None:
        """Comprueba propuesta no se promueve conflicto idempotente conserva entrada."""
        self.importar()
        revisar(self.afirmacion, "humana")
        self.importar()
        primera = resumen(self.base)
        self.importar()
        self.assertEqual(resumen(self.base)["versiones"], primera["versiones"])
        self.assertEqual(resumen(self.base)["conflictos_aprendizaje"], 1)
        self.assertEqual(resumen(self.base)["etiquetas_requieren_revision"], 1)
        actual = self.guardado()["afirmaciones"][0]
        self.assertEqual(actual["estado"], "propuesta")
        self.assertTrue(actual["revision_requerida"])
        decision, entrada = self.filas("SELECT decision_conservada,entrada FROM conflictos_aprendizaje")[0]
        self.assertEqual(json.loads(decision)["estado"], "propuesta")
        self.assertEqual(json.loads(entrada)["revision"]["tipo"], "humana")

    def test_revisada_no_se_sustituye_silenciosamente(self) -> None:
        """Comprueba revisada no se sustituye silenciosamente."""
        revisar(self.afirmacion)
        self.importar()
        self.afirmacion["descripcion"] = "Conclusión discrepante"
        self.importar()
        self.assertEqual(
            self.guardado()["afirmaciones"][0]["descripcion"],
            "Objetivo publicado de prueba",
        )
        self.assertEqual(resumen(self.base)["conflictos_aprendizaje"], 1)

    def test_robot_factual_legacy_actualiza_sin_borrar_enriquecimiento(self) -> None:
        """Comprueba robot factual legacy actualiza sin borrar enriquecimiento."""
        self.importar()
        legado = lote_base()
        legado["programas"][0]["titulo"] = "Título corregido en fuente"
        self.importar(legado)
        self.assertEqual(
            self.filas("SELECT titulo FROM programas")[0][0],
            "Título corregido en fuente",
        )
        self.assertEqual(self.guardado()["afirmaciones"][0]["id"], "objetivo-1")
        self.assertTrue(self.guardado()["afirmaciones"][0]["revision_requerida"])
        self.assertEqual(resumen(self.base)["etiquetas_requieren_revision"], 1)
        versiones = resumen(self.base)["versiones"]
        self.importar(legado)
        self.assertEqual(resumen(self.base)["versiones"], versiones)
        self.assertIn(
            "aprendizaje",
            json.loads(
                self.filas("SELECT antes FROM versiones WHERE entidad='programa' ORDER BY id DESC LIMIT 1")[0][0]
            )["datos"],
        )

    def test_dato_comercial_legacy_conserva_vigencia_y_ausencia_no_retira_afirmaciones(self) -> None:
        """Comprueba dato comercial legacy conserva vigencia y ausencia no retira afirmaciones."""
        self.importar()
        legado = lote_base()
        legado["programas"][0]["datos"]["plazas"] = 3
        self.importar(legado)
        self.assertFalse(self.guardado()["afirmaciones"][0]["revision_requerida"])
        self.aprendizaje["afirmaciones"] = []
        self.aprendizaje["contenido_observado"] = False
        self.importar()
        self.assertEqual(len(self.guardado()["afirmaciones"]), 1)

    def test_cambio_aprendizaje_invalida_clasificacion_y_conserva_historia(self) -> None:
        """Comprueba cambio aprendizaje invalida clasificacion y conserva historia."""
        self.importar()
        self.afirmacion["descripcion"] = "Objetivo corregido con evidencia conservada"
        self.importar()
        self.assertEqual(resumen(self.base)["etiquetas_requieren_revision"], 1)
        self.assertTrue(self.guardado()["afirmaciones"][0]["revision_requerida"])
        self.assertEqual(
            self.filas("SELECT count(*) FROM versiones WHERE entidad='programa'")[0][0],
            2,
        )

    def test_lote_y_registro_no_se_mutan_y_reimportacion_no_duplica_versiones(self) -> None:
        """Comprueba lote y registro no se mutan y reimportacion no duplica versiones."""
        original = copy.deepcopy(self.lote)
        self.importar()
        versiones = resumen(self.base)["versiones"]
        self.importar()
        self.assertEqual(self.lote, original)
        self.assertEqual(resumen(self.base)["versiones"], versiones)

    def test_conflicto_y_entidades_se_revierten_con_referencia_invalida(self) -> None:
        """Comprueba conflicto y entidades se revierten con referencia invalida."""
        self.importar()
        antes = self.base.read_bytes()
        revisar(self.afirmacion)
        self.lote["ediciones"][0]["programa_id"] = "inexistente"
        with self.assertRaises(ErrorCatalogo):
            self.importar()
        self.assertEqual(self.base.read_bytes(), antes)
        self.assertEqual(resumen(self.base)["conflictos_aprendizaje"], 0)

    def test_base_sin_aprendizaje_lo_admite_despues_sin_reescribir_programas(self) -> None:
        """Una base V10 nacida con contrato 1 o 2 sin aprendizaje lo recibe en una importación posterior."""
        for version in (1, 2):
            with self.subTest(version=version):
                self.base = self.base.parent / f"base-{version}.sqlite3"
                inicial = lote_base()
                if version == VERSION_OFERTA:
                    inicial.update(schema_version=2, variantes=[], centros=[], anuncios=[])
                self.importar(inicial)
                self.assertEqual(self.filas("PRAGMA user_version"), [(catalogo.VERSION_SQLITE_CONTENIDOS,)])
                versiones = resumen(self.base)["versiones"]
                self.importar()
                self.assertEqual(len(self.guardado()["afirmaciones"]), len(self.aprendizaje["afirmaciones"]))
                antes = resumen(self.base)["versiones"]
                self.assertGreater(antes, versiones)
                self.importar()
                self.assertEqual(resumen(self.base)["versiones"], antes)
                self.assertEqual(self.filas("PRAGMA user_version"), [(catalogo.VERSION_SQLITE_CONTENIDOS,)])

    def test_tablas_de_aprendizaje_ajenas_revierten_la_importacion(self) -> None:
        """Un DDL ajeno en conflictos o procedencias no se adopta: la importación se revierte entera."""
        self.importar()
        revisar(self.afirmacion)
        original = self.base.read_bytes()
        for tabla in ("conflictos_aprendizaje", "procedencias_aprendizaje"):
            with self.subTest(tabla=tabla):
                self.base.write_bytes(original)
                with sqlite3.connect(self.base) as conexion:
                    conexion.execute("DROP TABLE " + tabla)
                    conexion.execute("CREATE TABLE " + tabla + " (otra TEXT)")
                antes = self.base.read_bytes()
                with self.assertRaisesRegex(ErrorCatalogo, "Operación revertida"):
                    self.importar()
                self.assertEqual(self.base.read_bytes(), antes)

    def test_revisada_no_verifica_identidad_desconocida_al_consultar(self) -> None:
        """Comprueba revisada no verifica identidad desconocida al consultar."""
        self.afirmacion["competencia"]["codigo"] = "codigo-no-registrado"
        revisar(self.afirmacion)
        self.importar()
        resultado = consultar_aprendizaje(self.base, "programa-1")
        self.assertEqual(resultado["aprendizaje"]["afirmaciones"][0]["estado"], "revisada")
        self.assertFalse(resultado["aprendizaje"]["afirmaciones"][0]["revision_requerida"])
        self.assertTrue(resultado["registro_disponible"])
        self.assertEqual(
            resultado["identidades"],
            [
                {
                    "afirmacion_id": "objetivo-1",
                    "estado_referencia": "no_registrada",
                    "registro_decision": {
                        "id": REGISTRO["id"],
                        "version": REGISTRO["version"],
                        "sha256": HUELLA,
                    },
                    "procedencia_registro": "conservada",
                }
            ],
        )

    def test_consulta_exige_registro_vinculado_y_no_cambia_datos(self) -> None:
        """Comprueba consulta exige registro vinculado y no cambia datos."""
        self.importar()
        antes = self.base.read_bytes()
        self.assertEqual(
            consultar_aprendizaje(self.base, "programa-1")["identidades"][0]["estado_referencia"],
            "registrada",
        )
        with patch(
            "plataforma_datos.cursos.catalogo.cargar_registro", return_value=(copy.deepcopy(REGISTRO), "c" * 64)
        ):
            resultado = consultar_aprendizaje(self.base, "programa-1")
        self.assertFalse(resultado["registro_disponible"])
        self.assertEqual(resultado["identidades"][0]["estado_referencia"], "registro_no_disponible")
        self.assertEqual(self.base.read_bytes(), antes)
        self.assertIsNone(consultar_aprendizaje(self.base, "inexistente"))

    def test_registro_actualizado_no_invalida_silenciosamente_nivel_conservado(self) -> None:
        """Comprueba registro actualizado no invalida silenciosamente nivel conservado."""
        self.afirmacion["nivel"] = {"escala": ESCALA, "valor": "A"}
        self.importar()
        antes = self.base.read_bytes()
        registro = copy.deepcopy(REGISTRO)
        registro["escalas"] = []
        self.aprendizaje["registro"]["sha256"] = "c" * 64
        self.aprendizaje.update(contenido_observado=False, afirmaciones=[])
        with (
            patch("plataforma_datos.cursos.catalogo.cargar_registro", return_value=(registro, "c" * 64)),
            self.assertRaisesRegex(ErrorCatalogo, "Escala no registrada"),
        ):
            self.importar()
        self.assertEqual(antes, self.base.read_bytes())

    def test_entradas_adversas_producen_error_de_contrato_no_typeerror(self) -> None:
        """Comprueba entradas adversas producen error de contrato no typeerror."""
        for campo, valor in (("origen", []), ("estado", {})):
            nuevo = copy.deepcopy(self.lote)
            nuevo["programas"][0]["datos"]["aprendizaje"]["afirmaciones"][0][campo] = valor
            with self.subTest(campo=campo), self.assertRaises(ErrorCatalogo):
                self.importar(nuevo)
        self.afirmacion["evidencias"][0]["url"] = []
        with self.assertRaises(ErrorCatalogo):
            self.importar()

    def test_orden_enviado_se_conserva_y_omision_no_pierde_evidencia_previa(self) -> None:
        """Comprueba orden enviado se conserva y omision no pierde evidencia previa."""
        otra = copy.deepcopy(self.afirmacion)
        otra["id"] = "objetivo-2"
        self.aprendizaje["afirmaciones"].append(otra)
        self.importar()
        self.aprendizaje["afirmaciones"].reverse()
        self.importar()
        self.assertEqual(
            [a["id"] for a in self.guardado()["afirmaciones"]],
            ["objetivo-2", "objetivo-1"],
        )
        self.aprendizaje["afirmaciones"] = []
        self.lote["programas"][0]["evidencias"] = []
        self.importar()
        self.assertEqual(len(self.guardado()["afirmaciones"]), 2)

    def test_consulta_no_crea_base_ausente(self) -> None:
        """Consultar aprendizaje sobre una ruta inexistente falla con un error del catálogo y sin crear la base."""
        with self.assertRaisesRegex(ErrorCatalogo, "No existe el catálogo"):
            consultar_aprendizaje(self.base, "programa-1")
        self.assertFalse(self.base.exists())

    def test_orden_aprendizaje_da_la_consulta_de_diagnostico(self) -> None:
        """`catalogo aprendizaje` imprime lo mismo que la consulta y, sin base, falla con código 2 sin crearla."""
        self.importar()
        salida = io.StringIO()
        with redirect_stdout(salida):
            codigo = catalogo.main(["aprendizaje", "--base", str(self.base), "--programa", "programa-1"])
        self.assertEqual(codigo, 0)
        self.assertEqual(json.loads(salida.getvalue()), consultar_aprendizaje(self.base, "programa-1"))
        ausente = self.base.with_name("ausente.sqlite3")
        errores = io.StringIO()
        with redirect_stderr(errores):
            codigo = catalogo.main(["aprendizaje", "--base", str(ausente), "--programa", "programa-1"])
        self.assertEqual(codigo, 2)
        self.assertIn("No existe el catálogo", errores.getvalue())
        self.assertFalse(ausente.exists())

    def test_registro_rechaza_identidades_y_valores_duplicados(self) -> None:
        """Comprueba registro rechaza identidades y valores duplicados."""
        for grupo in ("competencias", "escalas"):
            registro = copy.deepcopy(REGISTRO)
            registro[grupo].append(copy.deepcopy(registro[grupo][0]))
            with self.subTest(grupo=grupo), self.assertRaises(ErrorAprendizaje):
                validar_registro(registro)
        registro = copy.deepcopy(REGISTRO)
        registro["escalas"][0]["valores"] = ["A", "A"]
        with self.assertRaises(ErrorAprendizaje):
            validar_registro(registro)

    def test_conflicto_entre_registros_conserva_origen_y_repeticion_exacta(self) -> None:
        """Comprueba conflicto entre registros conserva origen y repeticion exacta."""
        self.importar()
        revisar(self.afirmacion)
        self.importar()
        registro = copy.deepcopy(REGISTRO)
        registro["version"] = "prueba-2"
        huella = hashlib.sha256(json.dumps(registro, sort_keys=True).encode()).hexdigest()
        referencia = {
            "id": registro["id"],
            "version": registro["version"],
            "sha256": huella,
        }
        self.aprendizaje["registro"] = referencia
        with patch("plataforma_datos.cursos.catalogo.cargar_registro", return_value=(registro, huella)):
            self.importar()
            versiones = resumen(self.base)["versiones"]
            self.importar()
            self.importar()
            self.assertEqual(resumen(self.base)["conflictos_aprendizaje"], 2)
            self.assertEqual(resumen(self.base)["versiones"], versiones)
            consulta = consultar_aprendizaje(self.base, "programa-1")
        registros = self.filas("SELECT registro_decision,registro_entrada FROM conflictos_aprendizaje ORDER BY id")
        self.assertEqual([json.loads(f[0])["version"] for f in registros], ["prueba-1", "prueba-1"])
        self.assertEqual([json.loads(f[1])["version"] for f in registros], ["prueba-1", "prueba-2"])
        self.assertEqual(self.guardado()["afirmaciones"][0]["estado"], "propuesta")
        self.assertEqual(self.guardado()["registro"], referencia)
        identidad = consulta["identidades"][0]
        self.assertEqual(identidad["registro_decision"]["version"], "prueba-1")
        self.assertEqual(identidad["procedencia_registro"], "conservada")
        self.assertEqual(identidad["estado_referencia"], "registro_no_disponible")
        self.assertFalse(consulta["registro_disponible"])

    def test_procedencias_distintas_se_consultan_por_decision(self) -> None:
        """Comprueba procedencias distintas se consultan por decision."""
        self.importar()
        registro = copy.deepcopy(REGISTRO)
        registro["version"] = "prueba-2"
        huella = hashlib.sha256(json.dumps(registro, sort_keys=True).encode()).hexdigest()
        self.aprendizaje["registro"] = {
            "id": registro["id"],
            "version": registro["version"],
            "sha256": huella,
        }
        otra = copy.deepcopy(self.afirmacion)
        otra["id"] = "objetivo-2"
        self.aprendizaje["afirmaciones"].append(otra)
        with patch("plataforma_datos.cursos.catalogo.cargar_registro", return_value=(registro, huella)):
            self.importar()
            consulta = consultar_aprendizaje(self.base, "programa-1")
        self.assertEqual(
            [a["estado_referencia"] for a in consulta["identidades"]],
            ["registro_no_disponible", "registrada"],
        )
        self.assertEqual(
            [a["registro_decision"]["version"] for a in consulta["identidades"]],
            ["prueba-1", "prueba-2"],
        )
        self.assertFalse(consulta["registro_disponible"])

    def test_consulta_distingue_error_fisico_invalido_y_referencia_historica(self) -> None:
        """Comprueba consulta distingue error fisico invalido y referencia historica."""
        self.importar()
        antes = self.base.read_bytes()
        with (
            patch(
                "plataforma_datos.cursos.catalogo.cargar_registro",
                side_effect=FileNotFoundError("registro ausente"),
            ),
            self.assertRaises(FileNotFoundError),
        ):
            consultar_aprendizaje(self.base, "programa-1")
        with (
            patch(
                "plataforma_datos.cursos.catalogo.cargar_registro",
                side_effect=ErrorAprendizaje("registro inválido"),
            ),
            self.assertRaisesRegex(ErrorCatalogo, "registro inválido"),
        ):
            consultar_aprendizaje(self.base, "programa-1")
        with patch(
            "plataforma_datos.cursos.catalogo.cargar_registro", return_value=(copy.deepcopy(REGISTRO), "c" * 64)
        ):
            consulta = consultar_aprendizaje(self.base, "programa-1")
        self.assertEqual(consulta["identidades"][0]["estado_referencia"], "registro_no_disponible")
        self.assertEqual(self.base.read_bytes(), antes)

    def test_conflictos_tambien_distinguen_registro_de_la_decision(self) -> None:
        """Comprueba conflictos tambien distinguen registro de la decision."""
        original = copy.deepcopy(self.aprendizaje["registro"])
        descripcion = self.afirmacion["descripcion"]
        self.importar()
        revisar(self.afirmacion)
        self.importar()
        registro = copy.deepcopy(REGISTRO)
        registro["version"] = "prueba-2"
        huella = hashlib.sha256(json.dumps(registro, sort_keys=True).encode()).hexdigest()
        self.aprendizaje["registro"] = {
            "id": registro["id"],
            "version": registro["version"],
            "sha256": huella,
        }
        self.afirmacion.update(estado="propuesta", revision=None, descripcion="Corrección de prueba")
        with patch("plataforma_datos.cursos.catalogo.cargar_registro", return_value=(registro, huella)):
            self.importar()
            self.afirmacion["descripcion"] = descripcion
            self.importar()
            consulta = consultar_aprendizaje(self.base, "programa-1")
            self.assertEqual(consulta["identidades"][0]["estado_referencia"], "registrada")
            self.assertEqual(consulta["identidades"][0]["registro_decision"]["version"], "prueba-2")
        self.aprendizaje["registro"] = original
        revisar(self.afirmacion)
        self.importar()
        versiones = resumen(self.base)["versiones"]
        self.importar()
        self.assertEqual(resumen(self.base)["conflictos_aprendizaje"], 2)
        self.assertEqual(resumen(self.base)["versiones"], versiones)
        registros = self.filas("SELECT registro_decision,registro_entrada FROM conflictos_aprendizaje ORDER BY id")
        self.assertEqual([json.loads(f[0])["version"] for f in registros], ["prueba-1", "prueba-2"])
        self.assertEqual([json.loads(f[1])["version"] for f in registros], ["prueba-1", "prueba-1"])

    def test_actualizacion_de_procedencia_revierte_con_el_lote(self) -> None:
        """Comprueba actualizacion de procedencia revierte con el lote."""
        self.importar()
        antes = self.base.read_bytes()
        registro = copy.deepcopy(REGISTRO)
        registro["version"] = "prueba-2"
        huella = hashlib.sha256(json.dumps(registro, sort_keys=True).encode()).hexdigest()
        self.aprendizaje["registro"] = {
            "id": registro["id"],
            "version": registro["version"],
            "sha256": huella,
        }
        self.afirmacion["descripcion"] = "Corrección todavía propuesta"
        self.lote["ediciones"][0]["programa_id"] = "inexistente"
        with (
            patch("plataforma_datos.cursos.catalogo.cargar_registro", return_value=(registro, huella)),
            self.assertRaises(ErrorCatalogo),
        ):
            self.importar()
        self.assertEqual(self.base.read_bytes(), antes)
        consulta = consultar_aprendizaje(self.base, "programa-1")
        self.assertEqual(consulta["identidades"][0]["registro_decision"]["version"], "prueba-1")
        self.assertEqual(consulta["identidades"][0]["estado_referencia"], "registrada")


if __name__ == "__main__":
    unittest.main()
