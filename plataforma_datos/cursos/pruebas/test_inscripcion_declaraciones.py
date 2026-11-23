"""Una declaración desconocida o negada no se convierte en oferta por sus palabras sueltas."""

import unittest
from copy import deepcopy

from plataforma_datos.cursos.contrato_entrega_catalogo import DERECHOS, validar_publico
from plataforma_datos.cursos.contrato_fichas import normalizar_datos_edicion
from plataforma_datos.cursos.entrega_catalogo import estado_interno_de_unidad
from plataforma_datos.cursos.hechos_entrega_catalogo import proyectar_hechos
from plataforma_datos.cursos.pruebas.test_vigencia import AHORA, OFERTA, fallo, ficha, politica
from plataforma_datos.cursos.seleccion_entrega_catalogo import seleccionar
from plataforma_datos.cursos.tipos_json import ObjetoJson
from plataforma_datos.cursos.vigencia import evaluar_vigencia


class DeclaracionesInscripcion(unittest.TestCase):
    """Recorre normalizador, evaluador, selección y contrato público con capturas sintéticas."""

    def oferta_publicada(self, fuente: ObjetoJson) -> tuple[ObjetoJson, ObjetoJson]:
        """Compone una proyección real en memoria; no abre SQLite ni publica archivos.

        Returns:
            Decisión del evaluador y DTO público validado.
        """
        observacion = ficha(fuente=fuente, abierto=None)
        entradas = {"oferta": OFERTA, "observaciones": [observacion], "politica": politica()}
        resultado = evaluar_vigencia(**entradas, ahora=AHORA)
        evaluacion = {"entradas": entradas, "corte_utc": AHORA, "resultado": resultado}
        estado = estado_interno_de_unidad(
            {
                "evaluacion": evaluacion,
                "unidad": {"id": OFERTA["id"]},
                "estado_registro": "evaluado",
                "motivo": "corte_conservado",
            },
            AHORA,
        )
        privado = {
            "derechos": DERECHOS,
            "proveedores": [{"id": "sintetico", "nombre": "Proveedor de prueba"}],
            "unidades": [
                {
                    "id": "programa-1",
                    "proveedor_id": "sintetico",
                    "titulo": "Programa sintético",
                    "tipo_unidad": "curso",
                    "url": "https://example.org/programa",
                    "evidencia_materia": None,
                    "vigencia": None,
                }
            ],
            "ediciones": [
                {
                    "id": OFERTA["id"],
                    "programa_id": "programa-1",
                    "hechos": proyectar_hechos({}, alcance="edicion"),
                    "referencias": [],
                    "evidencia_materia": None,
                    "vigencia": estado,
                }
            ],
        }
        publico = seleccionar(privado, AHORA)
        validar_publico(publico)
        return resultado, publico

    def test_negaciones_y_prosa_contradictoria_no_producen_oferta(self) -> None:
        """La subcadena afirmativa y las palabras de cierre no sustituyen una declaración completa."""
        for literal in (
            "Inscripciones cerradas. No hay matrícula vigente hasta nuevo aviso.",
            "No hay matrícula vigente hasta nuevo aviso.",
            "Matrícula vigente hasta el 30/10; inscripciones cerradas.",
            "No se afirma que haya inscripciones cerradas.",
            "Error técnico; matrícula vigente hasta fecha por confirmar.",
            "Información de inscripción no disponible: matrícula cerrada sin contrastar.",
            "Matrícula vigente hasta el 31/02/2026",
            "Matrícula vigente hasta el 30/10 solo si la página vuelve a responder",
        ):
            with self.subTest(literal=literal):
                fuente = {
                    "inscripcion": literal,
                    "fechas_matricula": {"inicio": "2026-10-21T00:00:00Z", "fin": "2026-10-25T00:00:00Z"},
                }
                previo = deepcopy(fuente)
                datos = normalizar_datos_edicion(fuente)
                self.assertIsNone(datos["estado_inscripcion"])
                self.assertEqual(datos["publicacion_original"]["inscripcion"], literal)
                self.assertTrue(any(d["campo"] == "estado_inscripcion" for d in datos["diagnosticos_normalizacion"]))
                resultado, publico = self.oferta_publicada(fuente)
                self.assertEqual(resultado["estado"], "sin-confirmar")
                self.assertEqual(publico["ofertas"], [])
                self.assertEqual(fuente, previo)

    def test_declaracion_completa_y_senales_estructuradas_siguen_admitidas(self) -> None:
        """Se conserva matrícula actual aunque la edición sea futura, y la prioridad del run identificado."""
        fuente = {
            "estado": "futura",
            "inscripcion": "Matrícula vigente hasta el 30/10",
            "fechas_matricula": ["2026-10-01T00:00Z", "2026-10-30T00:00Z"],
        }
        resultado, publico = self.oferta_publicada(fuente)
        self.assertEqual(resultado["estado"], "disponible-publicamente")
        self.assertEqual(len(publico["ofertas"]), 1)
        self.assertEqual(
            normalizar_datos_edicion({"estado": "actual_matricula_abierta"})["estado_inscripcion"],
            "disponible-publicamente",
        )
        for disponible in (True, False):
            with self.subTest(disponible=disponible):
                datos = normalizar_datos_edicion(
                    {"inscripcion": "Texto general sin interpretar"}, {"isEnrollable": disponible}
                )
                self.assertEqual(datos["estado_inscripcion"], "disponible-publicamente" if disponible else "cerrada")

    def test_declaraciones_del_mismo_ambito_en_conflicto_quedan_pendientes(self) -> None:
        """Un estado afirmativo y un cierre de la misma ficha no eligen uno por precedencia de código."""
        datos = normalizar_datos_edicion(
            {"estado": "actual_matricula_abierta", "inscripcion": "Inscripciones cerradas"}
        )
        self.assertIsNone(datos["estado_inscripcion"])
        self.assertTrue(any(d["campo"] == "estado_inscripcion" for d in datos["diagnosticos_normalizacion"]))

    def test_cierre_completo_y_boton_revisado_conservan_su_significado(self) -> None:
        """Un cierre declarado sigue siendo cierre; un botón por sí solo conserva incertidumbre."""
        for literal in ("Inscripciones cerradas", "Matrícula cerrada", "No inscribible"):
            with self.subTest(literal=literal):
                self.assertEqual(normalizar_datos_edicion({"inscripcion": literal})["estado_inscripcion"], "cerrada")
        datos = normalizar_datos_edicion({"inscripcion": "Botón Inscribirme visible; matrícula efectiva no realizada."})
        self.assertEqual(datos["estado_inscripcion"], "senal-publica-sin-confirmar")

    def test_error_tecnico_no_impone_cierre_ni_rejuvenece_confirmacion(self) -> None:
        """El evaluador conserva la positiva anterior frente a un intento sin respuesta y solo lo anota."""
        positiva = ficha()
        previo = evaluar_vigencia(OFERTA, [positiva], politica(), ahora=AHORA)
        resultado = evaluar_vigencia(OFERTA, [positiva, fallo()], politica(), ahora=AHORA)
        self.assertEqual(resultado["estado"], "disponible-publicamente")
        self.assertEqual(resultado["comprobado_el"], previo["comprobado_el"])
        self.assertEqual(resultado["revisar_el"], previo["revisar_el"])
        self.assertIsNone(previo["ultimo_intento_fallido_el"])
        self.assertEqual(resultado["ultimo_intento_fallido_el"], fallo()["terminado_el"])


if __name__ == "__main__":
    unittest.main()
