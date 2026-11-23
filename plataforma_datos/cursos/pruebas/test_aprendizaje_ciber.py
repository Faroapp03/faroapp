"""Aprendizaje Ciber: contexto completo, identidad y bloques semánticos actuales."""

import copy
import hashlib
import json
import unittest
from dataclasses import replace

from plataforma_datos.cursos import aprendizaje_ciber as ciber
from plataforma_datos.cursos import aprendizaje_entrega as entrega
from plataforma_datos.cursos.contrato_aprendizaje import cargar_registro
from plataforma_datos.cursos.contrato_entrega_catalogo import ErrorEntregaCatalogo
from plataforma_datos.cursos.fuentes.cibervoluntarios import lector
from plataforma_datos.cursos.pruebas.test_aprendizaje_entrega import RAIZ

ID = "cibervoluntarios:material:20"
URL = "https://www.cibervoluntarios.org/es/formacion-gratuita/aprende-a-tu-ritmo/cursos/ejemplo"
OBJETIVOS = "<ul><li>Crear un resumen con IA.</li><li>Proteger los datos personales.</li></ul>"
CONDICIONES = "<ul><li>Ya conoces lo básico sobre desinformación.</li></ul>"


def material(
    *, objetivos: str = OBJETIVOS, condiciones: str = CONDICIONES, descripcion: str = "", foto: str = ""
) -> lector.MaterialCiber:
    """Construye una captura sintética coherente, sin atribuirle una recepción remota.

    Returns:
        Material español y huella del documento de prueba que lo contiene.
    """
    datos = {"aprenderContent": objetivos, "paraTiContent": condiciones, "descriptionContent": descripcion}
    raw = json.dumps({"material": datos, "foto_ajena_al_temario": foto}, ensure_ascii=False).encode()
    return lector.MaterialCiber(
        id=20,
        actividad_id=10,
        tipo_actividad="Taller",
        tipo_material="Autoformación",
        idioma_publicado="Español",
        slug="ejemplo",
        titulo="Ejemplo sintético",
        actividad_publicada={},
        material_publicado=datos,
        captura=lector.CapturaCiber(
            url="https://www.cibervoluntarios.org/api/public/activity_catalogs?lang=es&itemsPerPage=100&page=1",
            sha256=hashlib.sha256(raw).hexdigest(),
            bytes_cuerpo=len(raw),
            inicio_utc="2026-10-23T18:00:00Z",
            recibido_utc="2026-10-23T18:00:01Z",
            http=200,
            completo=True,
            localizador="/hydra:member",
        ),
        localizador="/hydra:member/0/activityCatalogMaterials/0",
    )


class AprendizajeCiberPruebas(unittest.TestCase):
    """La selección admitida se prueba en ciclo_catalogo_ciber; aquí no se parchea el evaluador."""

    def setUp(self) -> None:
        """Fija evidencia y contexto sintéticos sin leer datos de una instalación."""
        self.ctx = {
            "declaraciones": {
                "requisitos": {"literal": "Una conexión a Internet.", "localizador": "es.training1/requisitos"}
            },
            "capturas": {
                "declaraciones": {
                    "url": "https://frontend.cibervoluntarios.org/vite/assets/main-ejemplo.js",
                    "fin_utc": "2026-10-23T18:00:02Z",
                    "cuerpo_sha256": "c" * 64,
                }
            },
        }
        self.actual = self.leer(material())
        modelo = json.loads((RAIZ / "config/formacion/aprendizaje-revisado.json").read_bytes())["fichas"][0]
        self.ficha = copy.deepcopy(modelo)
        self.ficha.update(
            programa_id=ID, requisitos="publicados", contexto_condiciones_sha256=self.actual.contexto_condiciones_sha256
        )
        self.ficha["aprendizaje"]["afirmaciones"] = []
        self.ficha["firmas_semanticas"] = {}
        for i, bloque in enumerate(self.actual.bloques):
            a = copy.deepcopy(modelo["aprendizaje"]["afirmaciones"][0])
            requisito = "/aprenderContent/" not in bloque.evidencia["localizador"]
            a.update(
                id=f"ciber-ejemplo-{i}",
                descripcion=bloque.texto,
                dimension="requisito_entrada" if requisito else "resultado_previsto",
            )
            e = bloque.evidencia
            a["evidencias"] = [
                {
                    **{k: v for k, v in e.items() if k != "localizador"},
                    "fragmento": bloque.texto,
                    "localizador": {"tipo": "requisito" if requisito else "objetivo", "valor": e["localizador"]},
                }
            ]
            self.ficha["aprendizaje"]["afirmaciones"].append(a)
            self.ficha["firmas_semanticas"][a["id"]] = [bloque.firma]
        self.ficha["cobertura"] = [
            {
                "criterio": criterio,
                "afirmaciones": [f"ciber-ejemplo-{i}"],
                "justificacion": {"es": "Objetivo literal de prueba.", "ca": "Objectiu literal de prova."},
                "via": None,
            }
            for i, criterio in enumerate(("tarea_sencilla", "privacidad"))
        ]

    def leer(self, dato: lector.MaterialCiber) -> ciber.TemarioCiber:
        """Usa el lector puro sobre material cuyo origen queda identificado como sintético.

        Returns:
            Bloques y contexto para las pruebas causales.
        """
        return ciber.construir(ID, dato, self.ctx, URL)

    def test_definicion_valida_y_proyeccion_no_atribuye_nivel(self) -> None:
        """Publica solo sus campos conocidos, retirando el control privado del DTO."""
        registro, sha = cargar_registro()
        entrega._validar_ficha(self.ficha, registro, sha)
        ficha = entrega._ficha_actual(self.ficha, self.actual)
        self.assertEqual(ficha["idioma_ficha"], "es")
        self.assertEqual(ficha["requisitos"], "publicados")
        self.assertNotIn("contexto_condiciones_sha256", ficha)
        self.assertTrue(
            all(a["nivel"] == {"escala": None, "valor": None} for a in ficha["aprendizaje"]["afirmaciones"])
        )

    def test_cambio_de_un_objetivo_no_borra_el_otro(self) -> None:
        """Mantiene privacidad y requisitos cuando cambia solo la tarea publicada."""
        nuevo = self.leer(material(objetivos=OBJETIVOS.replace("Crear un resumen", "Crear un presupuesto")))
        ficha = entrega._ficha_actual(self.ficha, nuevo)
        self.assertEqual({c["criterio"] for c in ficha["cobertura"]}, {"privacidad"})
        self.assertEqual(ficha["requisitos"], "publicados")

    def test_nueva_condicion_no_se_oculta_tras_requisito_antiguo_intacto(self) -> None:
        """Un plan de pago nuevo retiene la selección sin borrar objetivos conservados."""
        nuevo = self.leer(material(descripcion="<p>Ahora necesitas un plan de pago.</p>"))
        ficha = entrega._ficha_actual(self.ficha, nuevo)
        self.assertEqual(ficha["requisitos"], "sin_verificar")
        self.assertEqual(len(ficha["cobertura"]), 2)

    def test_identidad_distinta_no_presta_texto_igual(self) -> None:
        """Ni la misma API ni un fragmento repetido acreditan otro material."""
        with self.assertRaises(ErrorEntregaCatalogo):
            ciber.construir("cibervoluntarios:material:21", material(), self.ctx, URL)
        ficha = entrega._ficha_actual(self.ficha, replace(self.actual, programa_id="cibervoluntarios:material:21"))
        self.assertEqual(ficha["aprendizaje"]["afirmaciones"], [])
        self.assertFalse(ficha["aprendizaje"]["contenido_observado"])

    def test_otro_campo_o_duplicado_no_prestan_localizador(self) -> None:
        """Exige campo y contexto inequívocos, sin next ni elección de la primera coincidencia."""
        for dato in (
            material(objetivos="", descripcion=OBJETIVOS),
            material(
                objetivos=OBJETIVOS.replace(
                    "<li>Crear un resumen con IA.</li>", "<li>Crear un resumen con IA.</li>" * 2
                )
            ),
        ):
            ficha = entrega._ficha_actual(self.ficha, self.leer(dato))
            self.assertNotIn("tarea_sencilla", {c["criterio"] for c in ficha["cobertura"]})

    def test_renovar_captura_de_igual_contenido_no_cambia_revision(self) -> None:
        """Reasocia los mismos bloques a la captura actual aunque cambie una imagen."""
        dato = material(foto="Otra imagen sin cambiar contenido o condiciones")
        dato = replace(dato, captura=replace(dato.captura, recibido_utc="2026-10-23T19:00:01Z"))
        ficha = entrega._ficha_actual(self.ficha, self.leer(dato))
        self.assertEqual(ficha["revision"], self.ficha["revision"])
        self.assertEqual(ficha["requisitos"], "publicados")
        self.assertEqual(len(ficha["cobertura"]), 2)
        self.assertEqual(ficha["aprendizaje"]["afirmaciones"][0]["evidencias"][0]["sha256"], dato.captura.sha256)

    def test_script_entidad_ajena_o_campo_excesivo_no_acreditan_objetivo(self) -> None:
        """Un texto fuera del ámbito no se convierte en un resultado previsto."""
        for objetivos in (
            "<script>" + OBJETIVOS + "</script>",
            '<section itemid="https://example.test/otra">' + OBJETIVOS + "</section>",
            "x" * (ciber.MAX_CAMPO_BYTES + 1),
        ):
            ficha = entrega._ficha_actual(self.ficha, self.leer(material(objetivos=objetivos)))
            self.assertEqual(ficha["cobertura"], [])
        with self.assertRaises(ErrorEntregaCatalogo):
            self.leer(replace(material(), idioma_publicado="Inglés"))


if __name__ == "__main__":
    unittest.main()
