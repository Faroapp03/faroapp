"""Regresiones semánticas y conservación de la investigación existente, sin red."""

import tempfile
import unittest
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch

from plataforma_datos.cursos.contrato_fichas import (
    ErrorFicha,
    normalizar_coste,
    normalizar_datos_edicion,
    normalizar_fecha,
    normalizar_horas,
    normalizar_modalidad,
    normalizar_periodo,
    normalizar_territorio,
    validar_datos_edicion,
    validar_lote_fichas,
)
from plataforma_datos.cursos.herramientas.normalizar_investigacion import preparar_importacion
from plataforma_datos.cursos.pruebas.datos_sinteticos import crear_captura_investigacion


class ContratoFichasPruebas(unittest.TestCase):
    """Normalización conservadora de fechas, coste y otras dimensiones publicadas."""

    def test_matricula_mentor_conserva_hora_sin_inventar_utc(self) -> None:
        """Regresión: matricula mentor conserva hora sin inventar utc."""
        publicado = ["2026-10-13", "2026-10-26 23:59 (zona no especificada)"]
        datos = normalizar_datos_edicion({"plazo_matricula": publicado})
        self.assertEqual(
            datos["fechas_matricula"],
            {"inicio": "2026-10-13", "fin": "2026-10-26T23:59"},
        )
        self.assertEqual(
            datos["fechas_matricula_detalle"]["fin"],
            {"precision": "minuto", "zona": None},
        )
        self.assertEqual(datos["publicacion_original"]["plazo_matricula"], publicado)
        self.assertTrue(any("sin zona" in d["motivo"] for d in datos["diagnosticos_normalizacion"]))

    def test_listas_y_aliases_conocidos_tienen_misma_forma(self) -> None:
        """Regresión: listas y aliases conocidos tienen misma forma."""
        esperado = {"inicio": "2026-10-13", "fin": "2026-10-26"}
        for valor in (
            list(esperado.values()),
            esperado,
            {"desde": esperado["inicio"], "hasta": esperado["fin"]},
        ):
            with self.subTest(valor=valor):
                self.assertEqual(normalizar_periodo(valor)[0], esperado)

    def test_extremos_ambiguos_o_invalidos_no_se_adivinan(self) -> None:
        """Regresión: extremos ambiguos o invalidos no se adivinan."""
        periodo, _, problemas = normalizar_periodo({"inicio": "2026-10-13", "desde": "2026-10-14", "fin": "2026-10-26"})
        self.assertIsNone(periodo["inicio"])
        self.assertTrue(problemas)
        for valor in ("mañana", "2026-02-30", 1723412341234, ["2026-10-13"]):
            with self.subTest(valor=valor):
                datos = normalizar_datos_edicion({"fechas_matricula": valor})
                self.assertEqual(datos["fechas_matricula"], {"inicio": None, "fin": None})
                self.assertEqual(datos["publicacion_original"]["fechas_matricula"], valor)
                self.assertTrue(datos["diagnosticos_normalizacion"])

    def test_fechas_invertidas_se_conservan_solo_en_original(self) -> None:
        """Regresión: fechas invertidas se conservan solo en original."""
        for publicado in (
            ["2026-10-26", "2026-10-13"],
            ["2026-10-26", "2026-10-13T23:59"],
        ):
            with self.subTest(publicado=publicado):
                datos = normalizar_datos_edicion({"fechas_matricula": publicado})
                self.assertEqual(datos["fechas_matricula"], {"inicio": None, "fin": None})
                self.assertEqual(datos["publicacion_original"]["fechas_matricula"], publicado)
                self.assertTrue(any("invertidas" in d["motivo"] for d in datos["diagnosticos_normalizacion"]))

    def test_precision_y_zona_publicadas_sin_normalizar_a_utc(self) -> None:
        """Regresión: precision y zona publicadas sin normalizar a utc."""
        for valor, precision, zona in (
            ("2026-10-22", "dia", None),
            ("2026-10-22T14:30", "minuto", None),
            ("2026-10-22T14:30:12+02:00", "segundo", "+02:00"),
            ("2026-10-22T14:30:12.000Z", "fraccion-segundo", "UTC"),
        ):
            with self.subTest(valor=valor):
                self.assertEqual(
                    normalizar_fecha(valor),
                    {"valor": valor, "precision": precision, "zona": zona},
                )

    def test_un_curso_futuro_no_abre_matricula_futura(self) -> None:
        """Regresión: un curso futuro no abre matricula futura."""
        datos = normalizar_datos_edicion({"estado": "futuro", "inicio": "2027-02-01"})
        self.assertEqual(datos["estado_edicion"], "futura")
        self.assertIsNone(datos["estado_inscripcion"])
        self.assertEqual(datos["fechas_matricula"], {"inicio": None, "fin": None})

    def test_boton_no_es_plaza_ni_admision(self) -> None:
        """Regresión: boton no es plaza ni admision."""
        datos = normalizar_datos_edicion({"inscripcion": "Botón Inscribirme visible; matrícula efectiva no realizada."})
        self.assertEqual(datos["estado_inscripcion"], "senal-publica-sin-confirmar")
        self.assertIsNone(datos["plaza_confirmada_persona"])
        self.assertIsNone(datos["admisibilidad_persona"])
        self.assertNotIn("plazas", datos)

    def test_senales_explicitas_de_inscripcion_sin_mezclar_coste_colectivo(self) -> None:
        """Regresión: senales explicitas de inscripcion sin mezclar coste colectivo."""
        fuente = {
            "estado": "actual_matricula_abierta",
            "colectivo": "Solo estudiantes UNED",
            "coste_formacion": "0 € como oyente",
        }
        datos = normalizar_datos_edicion(fuente)
        self.assertEqual(datos["estado_inscripcion"], "disponible-publicamente")
        self.assertEqual(datos["coste_formacion_tipo"], "gratis_formacion")
        self.assertEqual(datos["publicacion_original"]["colectivo"], fuente["colectivo"])
        self.assertIsNone(datos["admisibilidad_persona"])

    def test_modalidad_no_implica_sincronia(self) -> None:
        """Regresión: modalidad no implica sincronia."""
        for descripcion in (
            "Online; no se explicita sincronía",
            "100% online, flexible; no requiere examen presencial",
            "100% online, abierta 24 horas; autoaprendizaje con tutores.",
        ):
            with self.subTest(descripcion=descripcion):
                modalidad, sincronia, _ = normalizar_modalidad(descripcion)
                self.assertEqual(modalidad, "en-linea")
                self.assertIsNone(sincronia)

    def test_asincronia_debe_estar_publicada(self) -> None:
        """Regresión: asincronia debe estar publicada."""
        self.assertEqual(
            normalizar_modalidad("A distancia; asíncrona con tutoría")[0:2],
            ("en-linea", "asincrona"),
        )
        self.assertEqual(
            normalizar_modalidad("Formación online a ritmo propio")[0:2],
            ("en-linea", "asincrona"),
        )
        self.assertEqual(
            normalizar_modalidad("Completamente online", pacing_type="self_paced")[1],
            "asincrona",
        )
        self.assertIsNone(normalizar_modalidad("Online", "Asíncrona cuando pacingType=self_paced")[1])

    def test_sincronias_discrepantes_no_se_fusionan(self) -> None:
        """Regresión: sincronias discrepantes no se fusionan."""
        _, sincronia, problemas = normalizar_modalidad("Online asíncrono", "Síncrona con horario")
        self.assertIsNone(sincronia)
        self.assertTrue(problemas)
        self.assertEqual(normalizar_modalidad("Online", "Sincronía mixta")[1], "mixta")
        self.assertIsNone(normalizar_modalidad("Online", "No es asíncrona")[1])

    def test_horas_en_campos_alternativos_y_dedicacion_sin_sumar(self) -> None:
        """Regresión: horas en campos alternativos y dedicacion sin sumar."""
        for fuente, esperado in (
            ({"duracion": "20 horas"}, 20),
            ({"duracion_horas": 12}, 12),
            ({"horas_totales": 5.5}, 5.5),
            ({"horas": {"catalogo_upvx_horas": 25, "semanas": 5}}, 25),
        ):
            with self.subTest(fuente=fuente):
                self.assertEqual(normalizar_horas(fuente)[0], esperado)
        for fuente in (
            {"duracion": "2 meses; horas no publicadas en convocatoria"},
            {"horas": {"semanas": 5, "horas_semana_min": 4, "horas_semana_max": 5}},
            {"horas": True},
            {"horas": "No consta total en HTML: no publicar horas calculadas."},
        ):
            with self.subTest(fuente=fuente):
                self.assertIsNone(normalizar_horas(fuente)[0])
                self.assertTrue(normalizar_horas(fuente)[2])

    def test_horas_discrepantes_se_quedan_desconocidas(self) -> None:
        """Regresión: horas discrepantes se quedan desconocidas."""
        horas, metodo, problemas = normalizar_horas({"horas": 20, "duracion": "30 horas"})
        self.assertIsNone(horas)
        self.assertIsNone(metodo)
        self.assertTrue(any("discrepantes" in p["motivo"] for p in problemas))

    def test_audit_cero_nunca_se_promueve_a_formacion_completa(self) -> None:
        """Regresión: audit cero nunca se promueve a formacion completa."""
        self.assertEqual(
            normalizar_coste(
                [{"type": "audit", "price": 0}],
                "acceso temporal a contenido seleccionado",
            ),
            "gratis_parcial_temporal",
        )
        self.assertEqual(normalizar_coste("Audit 0 USD, contenido seleccionado"), "gratis_parcial")
        self.assertEqual(
            normalizar_coste("0 € para contenido/aprendizaje"),
            "contenido_gratuito_practicas_por_confirmar",
        )
        self.assertEqual(normalizar_coste("0 € según FAQ"), "gratis_formacion")
        self.assertIsNone(normalizar_coste("No es gratuito"))
        self.assertIsNone(normalizar_coste(None, "gratuito según condiciones sin coste de formación publicado"))
        self.assertIsNone(normalizar_datos_edicion({"coste_certificado": "0 €"})["coste_formacion_tipo"])

    def test_ausencia_de_restriccion_no_acredita_acceso_universal(self) -> None:
        """Regresión: ausencia de restriccion no acredita acceso universal."""
        for publicado in (
            "No consta límite territorial.",
            "Sin límite CCAA observado; colectivo restringido.",
            "Acceso desde España inferido; no prueba de cada territorio.",
        ):
            with self.subTest(publicado=publicado):
                self.assertIsNone(normalizar_territorio(publicado))
        self.assertEqual(
            normalizar_territorio("Exclusivamente residencia o lugar de trabajo en Región de Murcia"),
            "restriccion-territorial-publicada",
        )
        self.assertEqual(
            normalizar_territorio("Nacional y sin restricción de residencia según art.3 del reglamento"),
            "sin-restriccion-residencia-en-norma-general",
        )

    def test_desconocidos_y_pureza(self) -> None:
        """Regresión: desconocidos y pureza."""
        fuente = {
            "colectivo": "Solo mujeres interesadas",
            "edad_colectivo": "Sin edad comprobada",
            "horas": {"semanas": 5},
        }
        original = deepcopy(fuente)
        datos = normalizar_datos_edicion(fuente)
        self.assertEqual(fuente, original)
        for campo in (
            "modalidad",
            "sincronia",
            "horas_publicadas",
            "coste_formacion_tipo",
            "estado_inscripcion",
            "acceso_territorial",
        ):
            self.assertIsNone(datos[campo])
        self.assertEqual(datos["publicacion_original"]["colectivo"], fuente["colectivo"])

    def test_validador_rechaza_formas_semanticas_antiguas_y_valores_imaginados(self) -> None:
        """Regresión: validador rechaza formas semanticas antiguas y valores imaginados."""
        valido = normalizar_datos_edicion({})
        casos = [
            ("fechas_matricula", ["2026-10-13", None]),
            ("estado_inscripcion", "disponible_colectivo_condicionado"),
            ("acceso_territorial", "todo-el-mundo"),
            ("horas_publicadas", True),
            ("plaza_confirmada_persona", True),
        ]
        for campo, valor in casos:
            with self.subTest(campo=campo):
                datos = deepcopy(valido)
                datos[campo] = valor
                with self.assertRaises(ErrorFicha):
                    validar_datos_edicion(datos)
        datos = normalizar_datos_edicion({"fechas_matricula": ["2026-10-13", "2026-10-26"]})
        datos["fechas_matricula_detalle"]["fin"]["zona"] = "UTC"
        with self.assertRaises(ErrorFicha):
            validar_datos_edicion(datos)

    def test_discrepancias_generales_y_run_se_conservan_con_diagnostico(self) -> None:
        """Regresión: discrepancias generales y run se conservan con diagnostico."""
        fuente = {
            "inicio": "2026-10-01",
            "fin": "2026-11-01",
            "fechas_matricula": {"inicio": "2026-09-01", "fin": "2026-09-30"},
        }
        run = {
            "key": "edicion-identificada",
            "pacingType": "self_paced",
            "start": "2026-10-10",
            "end": "2026-11-10",
            "enrollmentStart": "2026-09-10",
            "enrollmentEnd": "2026-10-09",
        }
        datos = normalizar_datos_edicion(fuente, run)
        self.assertEqual(
            datos["fechas_publicadas"],
            {"tipo": "ventana-acceso", "inicio": "2026-10-10", "fin": "2026-11-10"},
        )
        self.assertEqual(datos["fechas_matricula"], {"inicio": "2026-09-10", "fin": "2026-10-09"})
        self.assertEqual(datos["publicacion_original"]["inicio"], fuente["inicio"])
        self.assertEqual(datos["publicacion_original"]["run"], run)
        campos = {d["campo"] for d in datos["diagnosticos_normalizacion"] if "difiere" in d["motivo"]}
        self.assertEqual(campos, {"fechas_publicadas", "fechas_matricula"})

    def test_titulos_no_producen_niveles_ni_capacidades(self) -> None:
        """Regresión: titulos no producen niveles ni capacidades."""
        lote = {
            "programas": [
                {
                    "datos": {"nivel_faro": None, "capacidades_revisadas": None},
                    "etiquetas": [{"estado": "propuesta"}],
                }
            ],
            "ediciones": [],
        }
        validar_lote_fichas(lote)
        for campo in ("nivel_faro", "capacidades_revisadas"):
            otro = deepcopy(lote)
            otro["programas"][0]["datos"][campo] = "inventado desde título"
            with self.assertRaises(ErrorFicha):
                validar_lote_fichas(otro)
        lote["programas"][0]["etiquetas"][0]["estado"] = "sustentada"
        with self.assertRaises(ErrorFicha):
            validar_lote_fichas(lote)


class HallazgosAuditoriaPruebas(unittest.TestCase):
    """Regresiones de ambigüedades semánticas detectadas en fichas."""

    def test_gratuidad_del_primer_modulo_no_hace_gratis_formacion_completa(self) -> None:
        """Regresión: gratuidad del primer modulo no hace gratis formacion completa."""
        publicado = "Gratuito solo el primer módulo; resto de formación: 100 €"
        datos = normalizar_datos_edicion({"coste_formacion": publicado})
        self.assertIsNone(datos["coste_formacion_tipo"])
        self.assertEqual(datos["publicacion_original"]["coste_formacion"], publicado)
        self.assertTrue(any(d["campo"] == "coste_formacion_tipo" for d in datos["diagnosticos_normalizacion"]))

    def test_gratuidad_no_confirmada_es_desconocida(self) -> None:
        """Regresión: gratuidad no confirmada es desconocida."""
        publicado = "No se confirma que sea gratuito"
        datos = normalizar_datos_edicion({"coste_formacion": publicado})
        self.assertIsNone(datos["coste_formacion_tipo"])
        self.assertEqual(datos["publicacion_original"]["coste_formacion"], publicado)
        self.assertTrue(any(d["campo"] == "coste_formacion_tipo" for d in datos["diagnosticos_normalizacion"]))

    def test_sin_restriccion_de_edad_no_elimina_restriccion_de_residencia(self) -> None:
        """Regresión: sin restriccion de edad no elimina restriccion de residencia."""
        publicado = "Sin restricción de edad según reglamento; acceso solo para residentes en Madrid"
        datos = normalizar_datos_edicion({"territorio": publicado})
        self.assertIsNone(datos["acceso_territorial"])
        self.assertEqual(datos["publicacion_original"]["territorio"], publicado)
        self.assertTrue(any(d["campo"] == "acceso_territorial" for d in datos["diagnosticos_normalizacion"]))

    def test_asincronia_no_confirmada_no_se_afirma(self) -> None:
        """Regresión: asincronia no confirmada no se afirma."""
        publicado = "No se confirma que sea asíncrona"
        _, sincronia, diagnosticos = normalizar_modalidad("Online", publicado)
        self.assertIsNone(sincronia)
        self.assertTrue(diagnosticos)
        datos = normalizar_datos_edicion({"modalidad": "Online", "sincronia": publicado})
        self.assertEqual(datos["publicacion_original"]["sincronia"], publicado)

    def test_intervalo_offsets_valido_compara_instantes_no_fechas_locales(self) -> None:
        """Regresión: intervalo offsets valido compara instantes no fechas locales."""
        publicado = ["2026-10-22T00:30+02:00", "2026-10-21T23:30Z"]
        periodo, _, problemas = normalizar_periodo(publicado)
        self.assertEqual(periodo, {"inicio": publicado[0], "fin": publicado[1]})
        self.assertFalse(any("invertidas" in d["motivo"] for d in problemas))

    def test_modalidad_online_negada_no_se_afirma(self) -> None:
        """Regresión: modalidad online negada no se afirma."""
        publicado = "No es online; modalidad no confirmada"
        modalidad, _, diagnosticos = normalizar_modalidad(publicado)
        self.assertIsNone(modalidad)
        self.assertTrue(diagnosticos)
        datos = normalizar_datos_edicion({"modalidad": publicado})
        self.assertEqual(datos["publicacion_original"]["modalidad"], publicado)

    def test_cero_con_limite_parcial_no_hace_gratis_formacion_completa(self) -> None:
        """Regresión: cero con limite parcial no hace gratis formacion completa."""
        limite = "Solo el primer módulo; resto de formación de pago"
        datos = normalizar_datos_edicion({"coste_formacion": "0 €", "limite_gratuidad": limite})
        self.assertIsNone(datos["coste_formacion_tipo"])
        self.assertEqual(datos["publicacion_original"]["limite_gratuidad"], limite)
        self.assertTrue(any(d["campo"] == "coste_formacion_tipo" for d in datos["diagnosticos_normalizacion"]))

    def test_controles_positivos_de_la_auditoria(self) -> None:
        """Regresión: controles positivos de la auditoria."""
        self.assertEqual(normalizar_coste("0 € según FAQ"), "gratis_formacion")
        self.assertEqual(
            normalizar_coste([{"type": "audit", "price": 0}], "acceso temporal"),
            "gratis_parcial_temporal",
        )
        self.assertEqual(
            normalizar_territorio("Nacional y sin restricción de nacionalidad/residencia según art.3 del reglamento"),
            "sin-restriccion-residencia-en-norma-general",
        )
        self.assertEqual(normalizar_modalidad("A distancia; asíncrona con tutoría")[1], "asincrona")
        periodo, _, problemas = normalizar_periodo(["2026-10-21T23:30Z", "2026-10-22T00:30+02:00"])
        self.assertEqual(periodo, {"inicio": None, "fin": None})
        self.assertTrue(any("invertidas" in d["motivo"] for d in problemas))


class InvestigacionSinteticaPruebas(unittest.TestCase):
    """Contrato del conjunto de investigación con capturas sintéticas locales."""

    @classmethod
    def setUpClass(cls) -> None:
        """Prepara capturas sintéticas y un conjunto de investigación compartido."""
        cls.temporal = tempfile.TemporaryDirectory(prefix="fichas sintéticas ñ ")
        cls.addClassCleanup(cls.temporal.cleanup)
        cls.raiz = crear_captura_investigacion(Path(cls.temporal.name) / "capturas")
        cls.preparado = preparar_importacion(cls.raiz)
        # Vista solo para aserciones; no se entrega como lote importable.
        cls.lote = {
            **cls.preparado["lotes"][0],
            **{
                grupo: [objeto for lote in cls.preparado["lotes"] for objeto in lote[grupo]]
                for grupo in ("proveedores", "programas", "ediciones")
            },
        }
        cls.incidencias = cls.preparado["incidencias"]

    def test_identidades_evidencias_contenidos_y_observaciones_exactos(self) -> None:
        """Regresión: identidades evidencias contenidos y observaciones exactos."""
        self.assertEqual((len(self.lote["programas"]), len(self.lote["ediciones"])), (6, 6))
        self.assertEqual(self.incidencias, [])
        self.assertEqual(
            {p["proveedor_id"] for p in self.lote["programas"]}, {"microsoft", "saps", "cyldigital", "mentor", "upv"}
        )
        for lote, canales in zip(self.preparado["lotes"], self.preparado["canales_temporales"], strict=True):
            for objeto in lote["programas"] + lote["ediciones"]:
                self.assertEqual(lote["observado_utc"], objeto["evidencias"][0]["capturado_utc"])
                self.assertTrue(any(c["id"] == objeto["id"] for c in canales))
                self.assertTrue(all((self.raiz / e["archivo"]).is_file() for e in objeto["evidencias"]))
                self.assertIsNone(objeto["datos"].get("nivel_faro"))

    def test_todas_las_ediciones_tienen_contrato_semantico(self) -> None:
        """Regresión: todas las ediciones tienen contrato semantico."""
        validar_lote_fichas(self.lote)
        for edicion in self.lote["ediciones"]:
            self.assertEqual(set(edicion["datos"]["fechas_matricula"]), {"inicio", "fin"})
            self.assertIsNone(edicion["datos"]["plaza_confirmada_persona"])
            self.assertIsNone(edicion["datos"]["admisibilidad_persona"])

    def test_regresiones_reales_saps_mentor_cyl_y_microsoft(self) -> None:
        """Regresión: regresiones reales saps mentor cyl y microsoft."""
        por_proveedor = {}
        proveedores = {p["id"]: p["proveedor_id"] for p in self.lote["programas"]}
        for edicion in self.lote["ediciones"]:
            por_proveedor.setdefault(proveedores[edicion["programa_id"]], []).append(edicion["datos"])
        self.assertTrue(any(d["sincronia"] is None for d in por_proveedor["saps"]))
        self.assertTrue(all(d["horas_publicadas"] is None for d in por_proveedor["microsoft"]))
        self.assertTrue(all(d["horas_publicadas"] is None for d in por_proveedor["mentor"]))
        self.assertTrue(
            all(
                d["fechas_matricula"]["fin"] == "2026-10-26T23:59"
                and d["fechas_matricula_detalle"]["fin"]["zona"] is None
                for d in por_proveedor["mentor"]
            )
        )
        self.assertTrue(all(d["estado_inscripcion"] is None for d in por_proveedor["cyldigital"]))
        self.assertTrue(all(d["coste_formacion_tipo"].startswith("gratis_parcial") for d in por_proveedor["upv"]))

    def test_normalizador_rechaza_antes_de_producir_lote_si_falla_validador(self) -> None:
        """Regresión: normalizador rechaza antes de producir lote si falla validador."""
        with (
            patch(
                "plataforma_datos.cursos.herramientas.normalizar_investigacion.validar_lote_fichas",
                side_effect=ErrorFicha("fallo semántico inyectado"),
            ),
            self.assertRaisesRegex(ErrorFicha, "fallo semántico"),
        ):
            preparar_importacion(self.raiz)


if __name__ == "__main__":
    unittest.main()
