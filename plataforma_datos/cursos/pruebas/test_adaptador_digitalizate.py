"""Regresiones de identidad, procedencia e importación offline de Digitalízate."""

from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch

from plataforma_datos.cursos.catalogo import ErrorCatalogo, cargar_lote, resumen
from plataforma_datos.cursos.fuentes.fundae.digitalizate import (
    PUBLICADOR_ID,
    ErrorAdaptador,
    construir_lotes,
    importar_captura,
    preparar_importacion,
)
from plataforma_datos.cursos.tipos_json import ObjetoJson, ValorJson

PROVEEDOR_SECUNDARIO = 8
RECURSO_SEGUNDO = 2


def guardar(ruta: Path, valor: str) -> None:
    """Escribe el documento sintético conservando sus valores JSON."""
    ruta.write_text(json.dumps(valor, ensure_ascii=False, indent=2), encoding="utf-8")


def fixture(raiz: Path, *, parcial: bool = False) -> list[ObjetoJson]:
    """Dos cursos con URL compartida y dos tipos excluidos; sin acceso individual.

    Returns:
        Datos sintéticos de la prueba.
    """
    raiz.mkdir()
    (raiz / "capturas").mkdir()
    manifest = []

    def capturar(identidad: str, cuerpo: ValorJson, consulta: str) -> ObjetoJson:
        """Prepara los datos locales de capturar.

        Returns:
            Datos sintéticos de la prueba.
        """
        archivo = "capturas/" + identidad + ".json"
        guardar(raiz / archivo, cuerpo)
        fuente = {
            "id": identidad,
            "archivo": archivo,
            "url_solicitada": "https://agora.fundae.es" + consulta,
            "url_final": "https://agora.fundae.es" + consulta,
            "utc_inicio": "2026-10-22T00:00:00+00:00",
            "utc_fin": "2026-10-22T00:00:01+00:00",
            "http": 200,
            "sha256": hashlib.sha256((raiz / archivo).read_bytes()).hexdigest(),
        }
        manifest.append(fuente)
        return fuente

    catalogo = {
        "idCatalogo": 1,
        "descripcionCatalogo": "Digitalizate",
        "descripcionCard": "Cursos gratuitos del catálogo",
    }
    capturar(
        "fundae_catalogos",
        [catalogo],
        "/Buscador/RecuperarCatalogosEspacioPlataforma?idEspacioPlataforma=1",
    )
    capturar(
        "fundae_catalogo",
        {"respuesta": [{"idRecursoFormativo": i, "idCatalogo": 1} for i in range(1, 5)]},
        "/Buscador/BuscarRecursosFormativosFundaeSEB?idCatalogo=1",
    )
    recursos = []
    for rid, tipo in [(1, "Curso"), (2, "Curso"), (3, "Vídeo formativo"), (4, "Otros")]:
        if parcial and rid == RECURSO_SEGUNDO:
            continue
        recursos.append(
            {
                "idRecursoFormativo": rid,
                "denominacion": f"IA avanzada, programa {rid}",
                "urlCurso": "https://ejemplo.org/misma-portada",
                "tipoRecurso": tipo,
                "descripcionIdioma": "Español",
                "modalidad": "Teleformación",
                "duracion": 0.0,
                "edicion": None,
                "periodoInscripcionInicio": None,
                "periodoInscripcionFin": None,
                "baja": False,
                "botonSolicitud": True,
                "areasInteres": [{"idAreaInteres": 38}],
                "etiquetas": [{"idEtiqueta": 51}],
                "digital": True,
                "descripcion": "Descripción pública con módulos; no redistribuir como temario completo.",
                "catalogos": [catalogo],
                "nivelDigitalizacion": "Avanzado",
            }
        )
    capturar(
        "fundae_recursos1",
        [{"idRecursoFormativo": r["idRecursoFormativo"]} for r in recursos],
        "/Digitalizate/RecuperarRecursosFormativosPorCatalogo?idCatalogo=1",
    )
    padre = {
        "idEmpresaDigitalizate": 7,
        "nombre": "Entidad publicada",
        "marcaComercial": None,
        "url": "https://ejemplo.org",
        "digitalizateCategoria": [
            {
                "idCategoria": 19,
                "categoria": "Categoría",
                "digitalizateRecursoFormativo": recursos,
            }
        ],
    }
    fuente = capturar(
        "fundae_empresa7",
        {"respuesta": padre},
        "/Digitalizate/RecuperaDetalleEmpresaDigitalizate?baja=false&idCatalogo=1&idEmpresaDigitalizate=7",
    )
    guardar(raiz / "manifest.json", manifest)
    guardar(
        raiz / "fundae-proveedores.json",
        [{"id": 7, "nombre": padre["nombre"], "fuente": fuente}],
    )
    campos = {
        "titulo": "denominacion",
        "url_destino": "urlCurso",
        "tipo_recurso_fuente": "tipoRecurso",
        "idioma": "descripcionIdioma",
        "modalidad_fuente": "modalidad",
        "duracion_fuente": "duracion",
        "edicion_fuente": "edicion",
        "matricula_inicio": "periodoInscripcionInicio",
        "matricula_fin": "periodoInscripcionFin",
        "baja_fuente": "baja",
        "boton_solicitud_fuente": "botonSolicitud",
        "temas": "areasInteres",
        "etiquetas": "etiquetas",
        "digital_fuente": "digital",
        "descripcion_fuente_privada": "descripcion",
    }
    derivados = [
        {
            "id": f"fundae:1:{r['idRecursoFormativo']}",
            "id_recurso_fuente": r["idRecursoFormativo"],
            "id_catalogo": 1,
            "id_proveedor": 7,
            "proveedor": padre["nombre"],
            "fuente": fuente,
            "categoria_proveedor": "Categoría",
            **{k: r[v] for k, v in campos.items()},
        }
        for r in recursos
    ]
    guardar(raiz / "fundae-recursos.json", derivados)
    return derivados


def cambiar_destino(raiz: Path, valor: str) -> None:
    """Actualiza captura y referencias juntas para probar el valor publicado real."""
    archivo = raiz / "capturas/fundae_empresa7.json"
    original = json.loads(archivo.read_text())
    original["respuesta"]["digitalizateCategoria"][0]["digitalizateRecursoFormativo"][0]["urlCurso"] = valor
    guardar(archivo, original)
    manifest = json.loads((raiz / "manifest.json").read_text())
    registro = next(r for r in manifest if r["id"] == "fundae_empresa7")
    registro["sha256"] = hashlib.sha256(archivo.read_bytes()).hexdigest()
    guardar(raiz / "manifest.json", manifest)
    for nombre in ["fundae-proveedores.json", "fundae-recursos.json"]:
        filas = json.loads((raiz / nombre).read_text())
        for r in filas:
            r["fuente"] = registro
        if nombre == "fundae-recursos.json":
            filas[0]["url_destino"] = valor
        guardar(raiz / nombre, filas)


def _segundo_proveedor(
    doc7: ObjetoJson, manifest: list[ObjetoJson], proveedores: list[ObjetoJson], recursos: list[ObjetoJson]
) -> ObjetoJson:
    doc8 = deepcopy(doc7)
    padre8 = doc8["respuesta"]
    padre8["idEmpresaDigitalizate"] = 8
    padre8["nombre"] = "Segundo proveedor publicado"
    padre8["digitalizateCategoria"][0]["digitalizateRecursoFormativo"] = [
        r
        for r in padre8["digitalizateCategoria"][0]["digitalizateRecursoFormativo"]
        if r["idRecursoFormativo"] == RECURSO_SEGUNDO
    ]
    doc7["respuesta"]["digitalizateCategoria"][0]["digitalizateRecursoFormativo"] = [
        r
        for r in doc7["respuesta"]["digitalizateCategoria"][0]["digitalizateRecursoFormativo"]
        if r["idRecursoFormativo"] != RECURSO_SEGUNDO
    ]
    registro8 = deepcopy(next(r for r in manifest if r["id"] == "fundae_empresa7"))
    registro8["id"] = "fundae_empresa8"
    registro8["archivo"] = "capturas/fundae_empresa8.json"
    for campo in ["url_solicitada", "url_final"]:
        registro8[campo] = registro8[campo].replace("idEmpresaDigitalizate=7", "idEmpresaDigitalizate=8")
    manifest.append(registro8)
    proveedores.append({"id": 8, "nombre": padre8["nombre"], "fuente": registro8})
    for r in recursos:
        if r["id_recurso_fuente"] == RECURSO_SEGUNDO:
            r["id_proveedor"] = 8
            r["proveedor"] = padre8["nombre"]
    return doc8


def captura_fechada(raiz: Path, titulos: dict[int, str], fechas_detalle: dict[int, str], fecha_indices: str) -> Path:
    """Una o dos capturas de detalle, con índices de fecha independiente.

    Returns:
        Datos sintéticos de la prueba.
    """
    fixture(raiz)
    manifest = json.loads((raiz / "manifest.json").read_text())
    proveedores = json.loads((raiz / "fundae-proveedores.json").read_text())
    recursos = json.loads((raiz / "fundae-recursos.json").read_text())
    archivo7 = raiz / "capturas/fundae_empresa7.json"
    doc7 = json.loads(archivo7.read_text())
    cuerpos = {7: doc7}
    if PROVEEDOR_SECUNDARIO in fechas_detalle:
        cuerpos[8] = _segundo_proveedor(doc7, manifest, proveedores, recursos)
    for pid, documento in cuerpos.items():
        for r in documento["respuesta"]["digitalizateCategoria"][0]["digitalizateRecursoFormativo"]:
            if r["idRecursoFormativo"] in titulos:
                r["denominacion"] = titulos[r["idRecursoFormativo"]]
        guardar(raiz / f"capturas/fundae_empresa{pid}.json", documento)
    for r in manifest:
        pid = int(r["id"].removeprefix("fundae_empresa")) if r["id"].startswith("fundae_empresa") else None
        dia = fechas_detalle[pid] if pid is not None else fecha_indices
        r["utc_inicio"] = dia + "T00:00:00+00:00"
        r["utc_fin"] = dia + "T00:00:01+00:00"
        r["sha256"] = hashlib.sha256((raiz / r["archivo"]).read_bytes()).hexdigest()
    por_id = {r["id"]: r for r in manifest}
    for p in proveedores:
        p["fuente"] = por_id[f"fundae_empresa{p['id']}"]
    for r in recursos:
        r["fuente"] = por_id[f"fundae_empresa{r['id_proveedor']}"]
        if r["id_recurso_fuente"] in titulos:
            r["titulo"] = titulos[r["id_recurso_fuente"]]
    guardar(raiz / "manifest.json", manifest)
    guardar(raiz / "fundae-proveedores.json", proveedores)
    guardar(raiz / "fundae-recursos.json", recursos)
    return raiz


def entidades(preparado: ObjetoJson, grupo: str) -> list[ObjetoJson]:
    """Reúne las entidades del grupo respetando el orden de los lotes.

    Returns:
        Datos sintéticos de la prueba.
    """
    return [e for lote in preparado["lotes"] for e in lote[grupo]]


def semilla() -> ObjetoJson:
    """Devuelve el lote previo que debe conservarse ante rechazo.

    Returns:
        Datos sintéticos de la prueba.
    """
    return {
        "schema_version": 1,
        "observado_utc": "2026-10-21T00:00:00+00:00",
        "fuente_lote": "semilla",
        "proveedores": [{"id": "previo", "nombre": "Previo", "territorio": None, "naturaleza": None}],
        "programas": [
            {
                "id": "previo:curso",
                "proveedor_id": "previo",
                "titulo": "Curso previo",
                "url": "https://ejemplo.org/previo",
                "tipo_unidad": "curso",
                "datos": {"conservar": True},
                "evidencias": [],
                "etiquetas": [],
            }
        ],
        "ediciones": [],
    }


class Digitalizate(unittest.TestCase):
    """Regresiones offline de identidad, procedencia y conservación temporal."""

    def setUp(self) -> None:
        """Prepara datos sintéticos en una carpeta exclusiva, sin red."""
        temp = tempfile.TemporaryDirectory(prefix="Digitalízate Año 2026 ")
        self.addCleanup(temp.cleanup)
        self.raiz = Path(temp.name)
        self.captura = self.raiz / "captura"
        self.derivados = fixture(self.captura)
        self.base = self.raiz / "copia.sqlite3"

    def test_identidad_y_metadatos_sin_inferencias(self) -> None:
        """Comprueba identidad y metadatos sin inferencias."""
        a = preparar_importacion(self.captura)
        self.assertEqual(a, preparar_importacion(self.captura))
        self.assertEqual([p["id"] for p in entidades(a, "programas")], ["fundae:1:1", "fundae:1:2"])
        self.assertEqual(entidades(a, "ediciones"), [])
        self.assertEqual(a["control"]["excluidos_por_tipo"], {"Vídeo formativo": 1, "Otros": 1})
        for programa in entidades(a, "programas"):
            self.assertEqual(programa["proveedor_id"], PUBLICADOR_ID)
            self.assertEqual(programa["etiquetas"], [])
            d = programa["datos"]
            self.assertIsNone(d["nivel_faro"])
            self.assertIsNone(d["coste_formacion"])
            self.assertIsNone(d["coste_certificado"])
            self.assertIsNone(d["plaza_confirmada_persona"])
            self.assertEqual(d["metadatos_fuente"]["nivelDigitalizacion"], "Avanzado")
            self.assertEqual(d["metadatos_fuente"]["duracion"], 0.0)
            self.assertEqual(
                d["descripcion_catalogo"]["sha256_texto_utf8"],
                hashlib.sha256(self.derivados[0]["descripcion_fuente_privada"].encode()).hexdigest(),
            )
            self.assertNotIn("Descripción pública", json.dumps(d, ensure_ascii=False))

    def test_indice_no_puede_inventar_datos_ni_coste(self) -> None:
        """Comprueba indice no puede inventar datos ni coste."""
        for campo, valor in [
            ("titulo", "Otro"),
            ("coste_certificado", 0),
            ("id", "fundae:1:999"),
            ("digital_fuente", False),
            ("fuente", {}),
            ("id_proveedor", 8),
        ]:
            with self.subTest(campo=campo):
                filas = deepcopy(self.derivados)
                filas[0][campo] = valor
                guardar(self.captura / "fundae-recursos.json", filas)
                with self.assertRaises(ErrorAdaptador):
                    preparar_importacion(self.captura)

    def test_captura_alterada_no_se_importa(self) -> None:
        """Comprueba captura alterada no se importa."""
        cargar_lote(self.base, semilla())
        antes = self.base.read_bytes()
        ruta = self.captura / "capturas/fundae_empresa7.json"
        ruta.write_bytes(ruta.read_bytes() + b" ")
        with self.assertRaisesRegex(ErrorAdaptador, "Huella"):
            importar_captura(self.base, self.captura)
        self.assertEqual(self.base.read_bytes(), antes)

    def test_identidades_duplicadas_y_proveedor_omitido_fallan(self) -> None:
        """Comprueba identidades duplicadas y proveedor omitido fallan."""
        guardar(self.captura / "fundae-recursos.json", self.derivados + [self.derivados[0]])
        with self.assertRaisesRegex(ErrorAdaptador, "duplicada"):
            preparar_importacion(self.captura)
        guardar(self.captura / "fundae-recursos.json", self.derivados)
        guardar(self.captura / "fundae-proveedores.json", [])
        with self.assertRaises(ErrorAdaptador):
            preparar_importacion(self.captura)

    def test_json_ambiguo_y_ruta_ajena_fallan(self) -> None:
        """Comprueba json ambiguo y ruta ajena fallan."""
        archivo = self.captura / "manifest.json"
        original = archivo.read_bytes()
        archivo.write_text('{"id": 1, "id": 2}')
        with self.assertRaisesRegex(ErrorAdaptador, "repetida"):
            preparar_importacion(self.captura)
        archivo.write_bytes(original)
        m = json.loads(original)
        m[0]["archivo"] = "../ajena.json"
        guardar(archivo, m)
        with self.assertRaisesRegex(ErrorAdaptador, "Ruta"):
            preparar_importacion(self.captura)

    def test_doble_importacion_conserva_versiones_y_ausentes(self) -> None:
        """Comprueba doble importacion conserva versiones y ausentes."""
        cargar_lote(self.base, semilla())
        importar_captura(self.base, self.captura)
        primero = resumen(self.base)
        importar_captura(self.base, self.captura)
        segundo = resumen(self.base)
        for campo in [
            "programas",
            "proveedores",
            "ediciones",
            "evidencias",
            "versiones",
            "pertenencia_catalogo",
        ]:
            self.assertEqual(primero[campo], segundo[campo], campo)
        self.assertEqual(
            segundo["ejecuciones"],
            primero["ejecuciones"] + len(construir_lotes(self.captura)),
        )
        parcial = self.raiz / "parcial"
        fixture(parcial, parcial=True)
        control = importar_captura(self.base, parcial)["control"]
        self.assertEqual(control["ids_solo_buscador"], [2])
        self.assertFalse(control["conciliacion"])
        self.assertEqual(resumen(self.base)["programas"], 3)
        self.assertEqual(resumen(self.base)["historial_pertenencia"], 0)
        with sqlite3.connect(self.base) as c:
            self.assertEqual(
                json.loads(c.execute("SELECT datos FROM programas WHERE id='previo:curso'").fetchone()[0]),
                {"conservar": True},
            )

    def test_fallo_durante_escritura_revierte_todo(self) -> None:
        """Comprueba fallo durante escritura revierte todo."""
        cargar_lote(self.base, semilla())
        antes = self.base.read_bytes()
        with (
            patch(
                "plataforma_datos.cursos.catalogo._guardar_evidencias",
                side_effect=RuntimeError("fallo inyectado"),
            ),
            self.assertRaisesRegex(RuntimeError, "inyectado"),
        ):
            importar_captura(self.base, self.captura)
        self.assertEqual(self.base.read_bytes(), antes)
        self.assertEqual(resumen(self.base)["programas"], 1)

    def test_recorte_externo_documentado_conserva_original(self) -> None:
        """Comprueba recorte externo documentado conserva original."""
        publicada = "  https://ejemplo.org/c/a?x=1%20  "
        cambiar_destino(self.captura, publicada)
        a = preparar_importacion(self.captura)
        p = entidades(a, "programas")[0]
        self.assertEqual(p["url"], "https://ejemplo.org/c/a?x=1%20")
        self.assertEqual(p["datos"]["url_destino_publicada"], publicada)
        self.assertEqual(p["datos"]["normalizacion_url"]["original"], publicada)
        self.assertEqual(len(a["control"]["normalizaciones_url"]), 1)

    def test_destino_invalido_se_conserva_en_cuarentena_sin_ficha_falsa(self) -> None:
        """Comprueba destino invalido se conserva en cuarentena sin ficha falsa."""
        for valor in [
            "Un título en lugar de enlace",
            "https://ejemplo.org/a b",
            "https://127.0.0.1/a",
            "https://usuario:clave@ejemplo.org/a",
            " https://ejemplo.org/a\t",
            "https://ejemplo.org/a\x7f",
        ]:
            with self.subTest(valor=valor):
                cambiar_destino(self.captura, valor)
                a = preparar_importacion(self.captura)
                self.assertEqual([p["id"] for p in entidades(a, "programas")], ["fundae:1:2"])
                self.assertFalse(a["control"]["conciliacion"])
                q = a["control"]["incidencias"][0]
                self.assertEqual(q["id"], "fundae:1:1")
                self.assertEqual(q["registro_original"]["urlCurso"], valor)
                self.assertEqual(q["registro_indice"]["url_destino"], valor)
                self.assertEqual(len(q["evidencia"]["sha256"]), 64)
                self.assertEqual(len(q["recurso_sha256"]), 64)

    def _exigir_rechazo_sin_sobrescritura(self, primera: Path, segunda: Path, titulos_previos: dict[int, str]) -> None:
        """Prepara los datos locales de exigir rechazo sin sobrescritura."""
        importar_captura(self.base, primera)
        importar_captura(self.base, primera)
        antes = self.base.read_bytes()
        recuentos = resumen(self.base)
        with self.assertRaises(ErrorCatalogo):
            importar_captura(self.base, segunda)
        self.assertEqual(self.base.read_bytes(), antes)
        self.assertEqual(resumen(self.base), recuentos)
        with sqlite3.connect(self.base) as c:
            actuales = dict(c.execute("SELECT id,titulo FROM programas"))
        for rid, titulo in titulos_previos.items():
            self.assertEqual(actuales[f"fundae:1:{rid}"], titulo)

    def test_indice_posterior_no_rejuvenece_detalle_antiguo(self) -> None:
        """Comprueba indice posterior no rejuvenece detalle antiguo."""
        primera = captura_fechada(self.raiz / "actual", {1: "Título moderno"}, {7: "2026-10-22"}, "2026-10-22")
        segunda = captura_fechada(
            self.raiz / "antigua",
            {1: "Título antiguo"},
            {7: "2026-10-21"},
            "2026-10-23",
        )
        self._exigir_rechazo_sin_sobrescritura(primera, segunda, {1: "Título moderno"})

    def test_proveedor_posterior_no_rejuvenece_otro_detalle_antiguo(self) -> None:
        """Comprueba proveedor posterior no rejuvenece otro detalle antiguo."""
        primera = captura_fechada(
            self.raiz / "dos-actuales",
            {1: "A moderno", 2: "B moderno"},
            {7: "2026-10-22", 8: "2026-10-22"},
            "2026-10-22",
        )
        segunda = captura_fechada(
            self.raiz / "dos-mixtos",
            {1: "A antiguo", 2: "B posterior"},
            {7: "2026-10-21", 8: "2026-10-23"},
            "2026-10-23",
        )
        self._exigir_rechazo_sin_sobrescritura(primera, segunda, {1: "A moderno", 2: "B moderno"})

    def test_minimo_global_no_oculta_retroceso_de_una_entidad(self) -> None:
        """Comprueba minimo global no oculta retroceso de una entidad."""
        primera = captura_fechada(
            self.raiz / "a1-b3",
            {1: "A día1", 2: "B día3"},
            {7: "2026-10-21", 8: "2026-10-23"},
            "2026-10-23",
        )
        segunda = captura_fechada(
            self.raiz / "a2-b2",
            {1: "A día2", 2: "B día2"},
            {7: "2026-10-22", 8: "2026-10-22"},
            "2026-10-24",
        )
        self._exigir_rechazo_sin_sobrescritura(primera, segunda, {1: "A día1", 2: "B día3"})

    @unittest.skipUnless(
        os.environ.get("DIGITALIZATE_CAPTURA_REAL"),
        "Captura real explícita no indicada",
    )
    def test_captura_real_offline(self) -> None:
        """Comprueba captura real offline."""
        preparado = preparar_importacion(Path(os.environ["DIGITALIZATE_CAPTURA_REAL"]))
        self.assertEqual(preparado["control"]["recursos_detallados"], 1428)
        self.assertEqual(preparado["control"]["recursos_buscador"], 1453)
        self.assertEqual(
            preparado["control"]["excluidos_por_tipo"],
            {"Vídeo formativo": 381, "Otros": 149},
        )
        self.assertEqual(len(entidades(preparado, "programas")), 895)
        self.assertEqual(entidades(preparado, "ediciones"), [])
        self.assertEqual(preparado["control"]["cursos_capturados"], 898)
        self.assertEqual(preparado["control"]["cursos_pendientes"], 3)
        self.assertEqual(len(preparado["control"]["normalizaciones_url"]), 26)
        self.assertEqual(
            [r["id"] for r in preparado["control"]["incidencias"]],
            ["fundae:1:3704", "fundae:1:3706", "fundae:1:3707"],
        )


if __name__ == "__main__":
    unittest.main()
