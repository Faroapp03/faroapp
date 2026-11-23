"""Regeneración semántica con oferta y recepciones sintéticas; no consulta fuentes."""

import copy
import dataclasses
import hashlib
import html
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from plataforma_datos.comun.huella_json import sha256_json
from plataforma_datos.cursos import admision_catalogo as admision
from plataforma_datos.cursos.aprendizaje_entrega import _Bloques, generar_companero
from plataforma_datos.cursos.contenido_aprendizaje import contenidos_actuales
from plataforma_datos.cursos.contrato_entrega_catalogo import ErrorEntregaCatalogo
from plataforma_datos.cursos.fuentes.hp_life.lector import FichaHpLife, extraer_ficha
from plataforma_datos.cursos.pruebas.test_lectura_hp_life import _captura, _cuerpo, _datos
from plataforma_datos.cursos.tipos_json import ObjetoJson

RAIZ = Path(__file__).resolve().parents[3]
ID = "hp-life:431:es"


def _ficha(cuerpo_html: str) -> FichaHpLife:
    datos = _datos() | {"body": cuerpo_html}
    cuerpo = _cuerpo(datos)
    return extraer_ficha(cuerpo, _captura(cuerpo))


def _definicion_y_cuerpo() -> tuple[ObjetoJson, str]:
    definicion = json.loads((RAIZ / "config/formacion/aprendizaje-revisado.json").read_bytes())
    original = next(f for f in definicion["fichas"] if f["programa_id"] == ID)
    definicion["fichas"] = [original]
    definicion["caminos"] = [c for c in definicion["caminos"] if all(p == ID for p in c["programas"])]
    cuerpo = (
        "<h2>Objetivos sintéticos</h2><p>El curso trata estos objetivos:</p><ul>"
        + "".join("<li>" + html.escape(a["descripcion"]) + "</li>" for a in original["aprendizaje"]["afirmaciones"])
        + "</ul>"
    )
    bloques = _Bloques()
    bloques.feed(cuerpo)
    bloques.close()
    original["firmas_semanticas"] = {
        a["id"]: [bloques.firmas[bloques.bloques.index(e["fragmento"])] for e in a["evidencias"]]
        for a in original["aprendizaje"]["afirmaciones"]
    }
    return definicion, cuerpo


def _publico(actual: FichaHpLife) -> bytes:
    dato = json.loads((RAIZ / "pruebas/fixtures/catalogo-cursos-publico.utf8").read_bytes())
    oferta = dato["ofertas"][0]
    oferta["unidad"] = {"id": ID, "programa_id": ID, "tipo": "recurso"}
    oferta["referencias"] = [
        {
            "url": actual.captura.url_final,
            "sha256": actual.captura.sha256_cuerpo,
            "fecha_referencia": actual.captura.recibido_utc,
            "alcance": "entidad",
            "naturaleza_fecha": "recepcion_conservada",
            "naturaleza_documento": "no_acreditada",
        }
    ]
    dato["revision"] = sha256_json({k: v for k, v in dato.items() if k != "revision"})
    return (json.dumps(dato, ensure_ascii=False) + "\n").encode()


class AprendizajeEntregaPruebas(unittest.TestCase):
    """Mismo contenido conserva revisión; cambios pertinentes retienen solo lo afectado."""

    def setUp(self) -> None:
        """Prepara temario y oferta sintéticos sobre el contrato nativo vigente."""
        self.definicion, self.cuerpo = _definicion_y_cuerpo()

    def _generar(self, cuerpo: str | None = None) -> ObjetoJson:
        actual = _ficha(cuerpo if cuerpo is not None else self.cuerpo)
        return generar_companero(_publico(actual), {ID: actual}, self.definicion)

    def test_renovar_http_o_fechas_no_obliga_a_revisar_objetivos_identicos(self) -> None:
        """Renueva el vínculo de entrega conservando la revisión semántica igual."""
        actual = _ficha(self.cuerpo)
        nueva = dataclasses.replace(
            actual, captura=dataclasses.replace(actual.captura, recibido_utc="2026-10-23T11:00:00Z")
        )
        salida = generar_companero(_publico(nueva), {ID: nueva}, self.definicion)
        self.assertEqual(len(salida["fichas"][0]["aprendizaje"]["afirmaciones"]), 5)
        self.assertEqual(
            salida["fichas"][0]["aprendizaje"]["afirmaciones"][0]["evidencias"][0]["capturado_utc"],
            "2026-10-23T11:00:00Z",
        )
        self.assertNotIn("firmas_semanticas", salida["fichas"][0])
        self.assertEqual(salida["fichas"][0]["idioma_ficha"], "es")

    def test_cambio_de_un_objetivo_retiene_solo_su_afirmacion_y_cobertura(self) -> None:
        """Retira la cobertura afectada sin invalidar los demás objetivos."""
        frase = self.definicion["fichas"][0]["aprendizaje"]["afirmaciones"][-1]["descripcion"]
        salida = self._generar(self.cuerpo.replace(html.escape(frase), "Contenido diferente"))
        f = salida["fichas"][0]
        self.assertEqual(len(f["aprendizaje"]["afirmaciones"]), 4)
        self.assertEqual([c["criterio"] for c in f["cobertura"]], ["criterios_explicitos"])

    def test_cambio_de_contexto_no_conserva_una_frase_aislada(self) -> None:
        """Una introducción contradictoria invalida la atribución anterior."""
        salida = self._generar(
            self.cuerpo.replace("El curso trata estos objetivos:", "El curso NO trata estos objetivos:")
        )
        self.assertEqual(salida["fichas"][0]["aprendizaje"]["afirmaciones"], [])
        self.assertEqual(salida["fichas"][0]["cobertura"], [])

    def test_informacion_ajena_a_objetivos_no_invalida_todo(self) -> None:
        """Una nota logística independiente no cambia el aprendizaje previsto."""
        salida = self._generar(self.cuerpo + "<p>Aviso logístico adicional de prueba.</p>")
        self.assertEqual(len(salida["fichas"][0]["aprendizaje"]["afirmaciones"]), 5)

    def test_requisito_nuevo_impide_recomendar_aunque_siguen_los_objetivos(self) -> None:
        """Conserva objetivos pero exige revisar condiciones de entrada nuevas."""
        salida = self._generar(self.cuerpo + "<h2>Requisitos</h2><p>Se necesita una titulación.</p>")
        self.assertEqual(salida["fichas"][0]["requisitos"], "sin_verificar")

    def test_falta_captura_actual_no_recupera_referencia_historica(self) -> None:
        """La falta de recepción actual provoca abstención aunque exista un SHA antiguo."""
        salida = generar_companero(_publico(_ficha(self.cuerpo)), {}, self.definicion)
        self.assertFalse(salida["fichas"][0]["aprendizaje"]["contenido_observado"])
        self.assertEqual(salida["fichas"][0]["cobertura"], [])

    def test_edicion_o_campo_editorial_ajeno_no_se_publica(self) -> None:
        """Rechaza alcance de edición no soportado y campos privados inesperados."""
        actual = _ficha(self.cuerpo)
        d = json.loads(_publico(actual))
        d["ofertas"][0]["unidad"] = {"tipo": "edicion", "id": "edicion-a", "programa_id": ID}
        d["cobertura"] = {"recurso": 0, "edicion": 1}
        d["revision"] = sha256_json({k: v for k, v in d.items() if k != "revision"})
        with self.assertRaises(ErrorEntregaCatalogo):
            generar_companero(json.dumps(d).encode(), {ID: actual}, self.definicion)
        alterada = copy.deepcopy(self.definicion)
        alterada["fichas"][0]["dato_privado"] = "No debe publicarse"
        with self.assertRaises(ErrorEntregaCatalogo):
            generar_companero(_publico(actual), {ID: actual}, alterada)

    def test_control_actual_no_elige_el_cuerpo_historico_que_encajaria(self) -> None:
        """El control actual determina la recepción; nunca se busca otra conveniente."""
        with tempfile.TemporaryDirectory() as temporal:
            raiz = Path(temporal)
            cuerpo_actual = _cuerpo(_datos() | {"body": "<p>Temario cambiado</p>"})
            captura = dataclasses.replace(
                _captura(cuerpo_actual),
                original_conservado=True,
                sha256_respuesta=hashlib.sha256(cuerpo_actual).hexdigest(),
            )
            recibo = json.dumps(
                {
                    "captura": dataclasses.asdict(captura),
                    "inicio_utc": captura.recibido_utc,
                    "content_type": "application/json",
                    "representacion_hash": "cuerpo_http_original",
                }
            ).encode()
            entradas = {
                "actual.body": cuerpo_actual,
                "actual.recibo": recibo,
                "historico.body": _cuerpo(_datos() | {"body": self.cuerpo}),
            }
            for nombre, contenido in entradas.items():
                (raiz / nombre).write_bytes(contenido)
            control = {
                "entradas": {
                    "recepciones": [
                        {
                            "id": ID,
                            "cuerpo_sha256": captura.sha256_cuerpo,
                            "recibo_sha256": hashlib.sha256(recibo).hexdigest(),
                        }
                    ]
                }
            }
            (raiz / "control.json").write_text(json.dumps(control))
            (raiz / "indice.json").write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "archivos_conservados": [
                            {"archivo": n, "sha256": hashlib.sha256(c).hexdigest()} for n, c in entradas.items()
                        ],
                    }
                )
            )
            base = raiz / "catalogo.sqlite3"
            with sqlite3.connect(base) as c:
                c.execute("CREATE TABLE programas(id TEXT, datos TEXT)")
                c.execute(
                    "INSERT INTO programas VALUES(?,?)",
                    (ID, json.dumps({"cuerpo_html_publicado": self.cuerpo, "descripcion_publicada": None})),
                )

            def ref(nombre: str) -> admision.ReferenciaArchivo:
                ruta = raiz / nombre
                return admision.ReferenciaArchivo(ruta=ruta, sha256=hashlib.sha256(ruta.read_bytes()).hexdigest())

            s = admision.SolicitudAdmision(
                snapshot=ref("catalogo.sqlite3"),
                procedencia={"control-hp": ref("control.json")},
                indices_evidencias={"actual": admision.IndiceEvidencias(archivo=ref("indice.json"), raiz=raiz)},
                validacion_destino=raiz / "admision.json",
            )
            self.assertEqual(contenidos_actuales(s, [ID]), {})
