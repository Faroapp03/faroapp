"""Calendarios independientes de una edición, sin perder restricciones ni cruzar runs."""

import unittest
from copy import deepcopy

from plataforma_datos.cursos import contrato_fichas as contrato
from plataforma_datos.cursos.tipos_json import ObjetoJson


def varias_fechas() -> ObjetoJson:
    """Publicación con formación, acceso, matrícula y sesiones de la misma edición.

    Returns:
        Entrada nueva en cada llamada para comprobar también pureza.
    """
    return {
        "estado": "actual_matricula_abierta",
        "fechas_matricula": {"fin": "2026-10-30T00:00Z"},
        "fechas_edicion": {"inicio": "2026-10-01T00:00Z", "fin": "2026-11-30T00:00Z"},
        "fechas_aula": {"inicio": "2026-10-01T00:00Z", "fin": "2026-10-21T00:00Z"},
        "fechas_sesiones": {"inicio": "2026-10-05T17:00Z", "fin": "2026-10-06T17:00Z"},
    }


class CalendariosFichaPruebas(unittest.TestCase):
    """El inventario aditivo coincide con la vista v1 y conserva el alcance de cada fecha."""

    def test_no_se_pierde_acceso_cuando_tambien_hay_formacion_y_sesiones(self) -> None:
        """La ventana terminada permanece disponible para la evaluación, sin reducirla al calendario largo."""
        fuente = varias_fechas()
        original = deepcopy(fuente)
        datos = contrato.normalizar_datos_edicion(fuente)
        calendarios = datos["calendarios_publicados"]
        self.assertEqual([c["campo"] for c in calendarios], ["fechas_edicion", "fechas_aula", "fechas_sesiones"])
        self.assertEqual(
            [c["periodo"]["tipo"] for c in calendarios], ["periodo-formativo", "ventana-acceso", "sesiones"]
        )
        self.assertEqual(calendarios[1]["periodo"]["fin"], "2026-10-21T00:00Z")
        self.assertEqual(datos["fechas_publicadas"], calendarios[0]["periodo"])
        self.assertEqual(datos["fechas_publicadas_detalle"], calendarios[0]["detalle"])
        self.assertEqual(datos["fechas_matricula"]["fin"], "2026-10-30T00:00Z")
        self.assertEqual(datos["publicacion_original"]["fechas_sesiones"], fuente["fechas_sesiones"])
        self.assertEqual(fuente, original)

    def test_inventario_no_puede_omitirse_ni_perder_un_calendario(self) -> None:
        """Las fichas antiguas con múltiples fechas deben renormalizarse, no seguir verdes silenciosamente."""
        datos = contrato.normalizar_datos_edicion(varias_fechas())
        sin_inventario = deepcopy(datos)
        sin_inventario.pop("calendarios_publicados", None)
        with self.assertRaises(contrato.ErrorFicha):
            contrato.validar_datos_edicion(sin_inventario)
        datos["calendarios_publicados"].pop()
        with self.assertRaises(contrato.ErrorFicha):
            contrato.validar_datos_edicion(datos)

    def test_vista_v1_inventario_y_publicacion_no_pueden_divergir(self) -> None:
        """Cambiar vista, periodo secundario o detalle no puede esquivar el validador real."""
        for objetivo in ("vista", "periodo", "detalle", "orden"):
            with self.subTest(objetivo=objetivo):
                datos = contrato.normalizar_datos_edicion(varias_fechas())
                if objetivo == "vista":
                    datos["fechas_publicadas"]["fin"] = "2027-01-01T00:00Z"
                elif objetivo == "periodo":
                    datos["calendarios_publicados"][1]["periodo"]["fin"] = "2027-01-01T00:00Z"
                elif objetivo == "detalle":
                    datos["calendarios_publicados"][1]["detalle"]["fin"]["zona"] = None
                else:
                    datos["calendarios_publicados"].reverse()
                with self.assertRaises(contrato.ErrorFicha):
                    contrato.validar_datos_edicion(datos)

    def test_solo_sesiones_conserva_su_significado(self) -> None:
        """Las fechas de sesiones se publican como sesiones, no como final del acceso."""
        datos = contrato.normalizar_datos_edicion({"fechas_sesiones": ["2026-10-10", "2026-10-11"]})
        self.assertEqual(datos["fechas_publicadas"]["tipo"], "sesiones")
        self.assertEqual(datos["fechas_publicadas"]["fin"], "2026-10-11")

    def test_runs_independientes_no_heredan_aula_ni_matricula_general(self) -> None:
        """La edición identificada solo recibe calendarios publicados para ella."""
        fuente = varias_fechas()
        resultados = []
        for clave, fin in (("edicion-octubre", "2026-10-23T00:00Z"), ("edicion-diciembre", "2026-12-23T00:00Z")):
            run = {"key": clave, "pacingType": "self_paced", "start": "2026-10-01T00:00Z", "end": fin}
            datos = contrato.normalizar_datos_edicion(fuente, run)
            self.assertEqual(datos["fechas_publicadas"]["fin"], fin)
            self.assertEqual(datos["fechas_publicadas"]["tipo"], "ventana-acceso")
            self.assertEqual(datos["fechas_matricula"], {"inicio": None, "fin": None})
            self.assertNotIn("calendarios_publicados", datos)
            self.assertEqual(datos["publicacion_original"]["run"], run)
            resultados.append(datos)
        self.assertNotEqual(resultados[0]["fechas_publicadas"], resultados[1]["fechas_publicadas"])

    def test_run_con_calendarios_propios_conserva_todos_sin_heredar_generales(self) -> None:
        """El aula y la formación de otra edición siguen solo en el original general."""
        run = {
            "key": "run-propio",
            "pacingType": "self_paced",
            "start": "2026-12-01T00:00Z",
            "end": "2027-01-01T00:00Z",
            "fechas_edicion": {"inicio": "2026-12-01T00:00Z", "fin": "2026-12-30T00:00Z"},
        }
        datos = contrato.normalizar_datos_edicion(varias_fechas(), run)
        self.assertEqual([c["campo"] for c in datos["calendarios_publicados"]], ["run", "run.fechas_edicion"])
        self.assertEqual(datos["calendarios_publicados"][1]["periodo"]["fin"], "2026-12-30T00:00Z")

    def test_fechas_incompatibles_de_mismo_tipo_se_diagnostican(self) -> None:
        """Dos publicaciones de acceso distintas no se resuelven eligiendo la primera."""
        datos = contrato.normalizar_datos_edicion(varias_fechas(), tipo_fechas="ventana-acceso")
        self.assertTrue(
            any(
                d["campo"] == "calendarios_publicados" and "incompatibles" in d["motivo"]
                for d in datos["diagnosticos_normalizacion"]
            )
        )
        sin_conflicto = deepcopy(datos)
        sin_conflicto["diagnosticos_normalizacion"] = []
        with self.assertRaises(contrato.ErrorFicha):
            contrato.validar_datos_edicion(sin_conflicto)

    def test_material_auxiliar_no_se_convierte_en_acceso_necesario(self) -> None:
        """El alcance explícito queda disponible al evaluador, sin inferirlo del título."""
        fuente = varias_fechas()
        fuente["fechas_aula"]["alcance"] = "material-auxiliar"
        datos = contrato.normalizar_datos_edicion(fuente)
        calendario = contrato.calendarios_edicion(datos)[1]
        self.assertEqual(calendario["alcance"], "material-auxiliar")
        self.assertEqual(calendario["periodo"]["fin"], "2026-10-21T00:00Z")
        datos["calendarios_publicados"][1]["alcance"] = "edicion"
        with self.assertRaises(contrato.ErrorFicha):
            contrato.validar_datos_edicion(datos)

    def test_alcance_desconocido_no_se_supone_edicion(self) -> None:
        """Una pertenencia no interpretable conserva diagnóstico y no se promueve a aula propia."""
        fuente = varias_fechas()
        fuente["fechas_aula"]["alcance"] = "otra-edicion-sin-identificar"
        datos = contrato.normalizar_datos_edicion(fuente)
        self.assertEqual(contrato.calendarios_edicion(datos)[1]["alcance"], "desconocido")
        self.assertTrue(any("Alcance" in d["motivo"] for d in datos["diagnosticos_normalizacion"]))

    def test_vinculo_conserva_destino_y_captura_sin_deducirlos(self) -> None:
        """La relación de una fecha exige soporte, no solo un nombre de campo."""
        fuente = varias_fechas()
        vinculo = {
            "tipo": "url",
            "valor": "https://example.org/edicion-2026",
            "edicion": {"id": None, "url": "https://example.org/edicion-2026"},
            "evidencia": {
                "url": "https://example.org/edicion-2026",
                "capturado_utc": "2026-10-22T08:00:00Z",
                "sha256": "a" * 64,
                "localizador": {"tipo": "campo", "valor": "/ediciones/2026/fechas_aula"},
            },
        }
        fuente["vinculos_calendarios"] = {"fechas_aula": vinculo, "fechas_matricula": vinculo}
        datos = contrato.normalizar_datos_edicion(fuente)
        self.assertEqual(contrato.calendarios_edicion(datos)[1]["vinculo_edicion"], vinculo)
        self.assertEqual(contrato.vinculo_matricula(datos), vinculo)
        self.assertIsNone(contrato.calendarios_edicion(datos)[0]["vinculo_edicion"])
        datos["calendarios_publicados"][1]["vinculo_edicion"]["edicion"]["url"] = "https://example.org/otra"
        with self.assertRaises(contrato.ErrorFicha):
            contrato.validar_datos_edicion(datos)

    def test_run_no_hereda_vinculo_general_de_matricula(self) -> None:
        """No se inventa asociación entre la ficha general y cada run de un programa."""
        fuente = varias_fechas()
        fuente["vinculos_calendarios"] = {"fechas_matricula": {"no": "es-un-soporte"}}
        run = {"key": "otra-edicion", "start": "2026-12-01", "end": "2026-12-30"}
        datos = contrato.normalizar_datos_edicion(fuente, run)
        self.assertIsNone(contrato.vinculo_matricula(datos))
        self.assertIsNone(contrato.calendarios_edicion(datos)[0]["vinculo_edicion"])

    def test_vinculo_sin_destino_o_sin_captura_no_es_prueba(self) -> None:
        """Una etiqueta de relación o un puntero suelto no acredita una edición."""
        for vinculo in (
            {"tipo": "id", "valor": "id-sin-mapeo"},
            {"tipo": "relacion-estructurada", "valor": "/ediciones/0"},
        ):
            with self.subTest(vinculo=vinculo):
                fuente = varias_fechas()
                fuente["vinculos_calendarios"] = {"fechas_aula": vinculo}
                with self.assertRaises(contrato.ErrorFicha):
                    contrato.normalizar_datos_edicion(fuente)

    def test_ficha_simple_conserva_formato_v1(self) -> None:
        """El inventario múltiple es aditivo y no exige migrar una ficha de un solo calendario."""
        datos = contrato.normalizar_datos_edicion({"fechas_aula": ["2026-10-01", "2026-11-01"]})
        self.assertEqual(datos["schema_ficha_version"], 1)
        self.assertNotIn("calendarios_publicados", datos)
        self.assertEqual(contrato.calendarios_edicion(datos)[0]["campo"], "fechas_aula")
        contrato.validar_datos_edicion(datos)


if __name__ == "__main__":
    unittest.main()
