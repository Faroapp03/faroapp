"""Oferta Ciber por evidencia concreta, sin registro automático o familia por descarte."""

import hashlib
import unittest
from copy import deepcopy
from dataclasses import replace

from plataforma_datos.comun.huella_json import sha256_json
from plataforma_datos.cursos import oferta_continua
from plataforma_datos.cursos.fuentes.cibervoluntarios import control_actual, lector
from plataforma_datos.cursos.fuentes.cibervoluntarios import observaciones_vigencia as puente


class ObservacionesCiberPruebas(unittest.TestCase):
    """Los datos de estas pruebas son sintéticos y no acreditan una oferta real."""

    def setUp(self) -> None:
        """Prepara un material y cuatro apoyos causales independientes."""
        self.material = lector.MaterialCiber(
            id=20,
            actividad_id=10,
            tipo_actividad="Taller",
            tipo_material="Autoformación",
            idioma_publicado="Español",
            slug="curso",
            titulo="Un curso",
            actividad_publicada={"format": ["A tu ritmo", "Online", "Presencial"]},
            material_publicado={
                "type": "Autoformación",
                "status": "Disponible",
                "erased": False,
                "aprenderContent": "<li>Una capacidad publicada</li>",
                "paraTiContent": "<li>Quieres mejorar tus habilidades digitales.</li>",
                "moodleLink": "https://e-learning.cibervoluntarios.org/course/view.php?id=20",
            },
            captura=lector.CapturaCiber(
                url="https://www.cibervoluntarios.org/api/public/activity_catalogs?lang=es&itemsPerPage=100&page=1",
                sha256="a" * 64,
                bytes_cuerpo=100,
                inicio_utc="2026-10-23T18:00:00Z",
                recibido_utc="2026-10-23T18:00:01Z",
                http=200,
                completo=True,
                localizador="/hydra:member",
            ),
            localizador="/hydra:member/0/activityCatalogMaterials/0",
        )
        self.programa = {"id": "cibervoluntarios:material:20", "url": "https://www.cibervoluntarios.org/es/curso"}
        self.ctx = {
            "metodo_confirmado": True,
            "declaraciones": {
                k: {"localizador": "caracteres:10:20", "literal": "Literal revisado"}
                for k in ("registro", "formacion", "requisitos")
            },
            "capturas": {
                k: {
                    "url": "https://www.cibervoluntarios.org/" + k,
                    "cuerpo_sha256": hashlib.sha256(k.encode()).hexdigest(),
                    "inicio_utc": "2026-10-23T18:00:02Z",
                    "fin_utc": "2026-10-23T18:00:03Z",
                }
                for k in ("portada", "declaraciones", "componente", "idioma")
            },
        }

    def observacion(self) -> dict:
        """Construye y valida la observación con el contrato productivo común.

        Returns:
            Observación sintética, validada antes de las afirmaciones de prueba.
        """
        obs = puente.construir(self.material, programa=self.programa, ctx=self.ctx)
        oferta_continua.validar(obs, self.programa)
        return obs

    def test_completa_con_registro_nunca_afirma_acceso_sin_cuenta(self) -> None:
        """Las condiciones públicas y la disponibilidad son afirmaciones distintas."""
        obs = self.observacion()
        self.assertTrue(oferta_continua.acreditada(obs["detalle"]))
        self.assertIsNone(obs["detalle"]["acceso_abierto"])
        condiciones = puente.condiciones(self.material, self.ctx)
        self.assertTrue(condiciones["inscripcion"]["registro_previo_para_inscribirse"])
        self.assertEqual(condiciones["inscripcion"]["alcance"], "declaracion_general")
        self.assertEqual(condiciones["formacion"]["valor"], "gratis_formacion")
        self.assertNotIn("certificado", condiciones)
        self.assertNotIn("practicas", condiciones)

    def test_no_hereda_presencial_de_la_actividad_contenedora(self) -> None:
        """El tipo de actividad no convierte la autoformación en un taller presencial."""
        self.assertEqual(puente.condiciones(self.material, self.ctx)["modalidad"]["valor"], "en-linea")
        self.assertEqual(self.material.tipo_actividad, "Taller")

    def test_idioma_seleccionado_es_del_material_y_no_de_la_actividad(self) -> None:
        """Una actividad multilingüe no acredita todos los idiomas de su material."""
        self.material.actividad_publicada["languages"] = ["Español", "Inglés"]
        idioma = puente.condiciones(self.material, self.ctx)["idioma"]
        self.assertEqual(idioma["valor"], ["Español"])
        self.assertTrue(idioma["evidencia"]["localizador"]["valor"].endswith("/lang"))
        self.material = replace(self.material, idioma_publicado="Inglés")
        self.assertNotIn("idioma", puente.condiciones(self.material, self.ctx))

    def test_metodo_distinto_o_declaracion_ausente_retienen(self) -> None:
        """Ninguna frase suelta sustituye la revisión del componente ni Internet conocido."""
        self.ctx["metodo_confirmado"] = False
        self.assertFalse(oferta_continua.acreditada(self.observacion()["detalle"]))
        self.assertEqual(puente.condiciones(self.material, self.ctx), {})
        self.ctx["metodo_confirmado"] = True
        self.ctx["declaraciones"]["requisitos"] = None
        self.assertFalse(oferta_continua.acreditada(self.observacion()["detalle"]))

    def test_destinatario_familiar_se_excluye_sin_excluir_mencion_incidental(self) -> None:
        """Compartir con la familia no significa que el curso sea para padres/madres."""
        self.material.material_publicado["paraTiContent"] = "<li>Deseas guiar a tus hijos en internet.</li>"
        self.assertFalse(oferta_continua.acreditada(self.observacion()["detalle"]))
        self.material.material_publicado["paraTiContent"] = "<li>Quieres compartir recuerdos con tu familia.</li>"
        self.assertTrue(oferta_continua.acreditada(self.observacion()["detalle"]))

    def test_destinatario_desconocido_no_se_sustituye_por_general(self) -> None:
        """Un campo vacío no acredita compatibilidad con el ámbito profesional."""
        self.material.material_publicado["paraTiContent"] = None
        obs = self.observacion()
        self.assertIsNone(obs["detalle"][oferta_continua.CAMPO]["criterios"]["destinatarios_constatados"]["valor"])
        self.assertFalse(oferta_continua.acreditada(obs["detalle"]))

    def test_pago_explicito_contrario_prevalece_sobre_declaracion_general(self) -> None:
        """No confunde pagar impuestos como contenido con el precio del curso."""
        self.material.material_publicado["description"] = "Este curso es de pago."
        self.assertFalse(oferta_continua.acreditada(self.observacion()["detalle"]))
        self.material.material_publicado["description"] = "Aprender a pagar impuestos por Internet."
        self.assertTrue(oferta_continua.acreditada(self.observacion()["detalle"]))

    def test_moodle_editor_o_host_ajeno_no_acreditan_destino(self) -> None:
        """No ofrece la URL de edición ni sigue enlaces externos del material."""
        for url in (
            "https://e-learning.cibervoluntarios.org/course/edit.php?id=20",
            "https://otro.test/course/view.php?id=20",
        ):
            self.material.material_publicado["moodleLink"] = url
            with self.subTest(url=url):
                self.assertFalse(oferta_continua.acreditada(self.observacion()["detalle"]))

    def test_fragmento_de_seccion_no_cambia_destino_publico(self) -> None:
        """La sección de Moodle se conserva, sin convertir un editor en curso."""
        self.material.material_publicado["moodleLink"] += "#section-0"
        self.assertTrue(oferta_continua.acreditada(self.observacion()["detalle"]))

    def test_material_retirado_o_tipo_formacion_no_se_ofrece(self) -> None:
        """Disponible por sí solo no acredita un material distinto de autoformación."""
        self.material = replace(self.material, tipo_material="Formación")
        self.assertFalse(oferta_continua.acreditada(self.observacion()["detalle"]))
        self.material = replace(self.material, tipo_material="Autoformación")
        self.material.material_publicado["erased"] = True
        self.assertFalse(oferta_continua.acreditada(self.observacion()["detalle"]))

    def test_fecha_y_observacion_no_cambian_al_repetir_sin_recepcion(self) -> None:
        """El reloj de revisión no rejuvenece ninguna captura."""
        primera = self.observacion()
        self.assertEqual(primera, self.observacion())
        self.assertEqual(primera["intentado_el"], "2026-10-23T18:00:00Z")
        self.assertEqual(primera["terminado_el"], "2026-10-23T18:00:03Z")


class ControlCiberPruebas(unittest.TestCase):
    """El control conserva contextos por huella, sin multiplicar apoyos por recurso."""

    def setUp(self) -> None:
        """Prepara dos materiales de una página con un único contexto compartido."""
        captura = {k + "_sha256": "a" * 64 for k in ("cuerpo", "recibo", "metadatos")}
        contexto = {**captura, "auxiliares": dict.fromkeys(control_actual.AUXILIARES, captura)}
        self.sha = sha256_json(contexto)
        self.control = {
            "schema_version": 1,
            "fuente_id": "cibervoluntarios",
            "contextos": {self.sha: contexto},
            "recepciones": [
                {
                    "id": "cibervoluntarios:material:" + str(id),
                    "material_id": id,
                    "observacion_id": "ciber-oferta-autoformacion-publicada:1:" + "b" * 64,
                    "contexto_sha256": self.sha,
                }
                for id in (20, 21)
            ],
        }

    def test_contexto_unico_para_dos_materiales_y_lectura_no_mutan(self) -> None:
        """Validar no duplica ni cambia el documento recibido."""
        copia = deepcopy(self.control)
        control_actual.validar(self.control)
        self.assertEqual(self.control, copia)
        self.assertEqual(len(self.control["contextos"]), 1)

    def test_hash_ajeno_contexto_huerfano_y_doble_material_se_rechazan(self) -> None:
        """No se resuelven identidades o referencias ambiguas por orden de llegada."""
        alterados = []
        alterado = deepcopy(self.control)
        alterado["contextos"][self.sha]["cuerpo_sha256"] = "c" * 64
        alterados.append(alterado)
        alterado = deepcopy(self.control)
        alterado["recepciones"][0]["contexto_sha256"] = "c" * 64
        alterados.append(alterado)
        alterado = deepcopy(self.control)
        alterado["recepciones"][1]["material_id"] = 20
        alterados.append(alterado)
        for alterado in alterados:
            with self.subTest(control=alterado), self.assertRaises(ValueError):
                control_actual.validar(alterado)


if __name__ == "__main__":
    unittest.main()
