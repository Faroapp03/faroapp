"""La vigencia usa calendarios vinculados de la misma edición, sin confundir hechos."""

import copy
import unittest

from plataforma_datos.cursos.contrato_fichas import normalizar_datos_edicion
from plataforma_datos.cursos.pruebas.test_vigencia import AHORA, OFERTA, evidencia, fallo, ficha, politica
from plataforma_datos.cursos.tipos_json import ObjetoJson
from plataforma_datos.cursos.vigencia import ErrorVigencia, evaluar_vigencia


def publicacion() -> ObjetoJson:
    """Reúne calendarios independientes, con acceso terminado y matrícula aún abierta.

    Returns:
        Publicación sintética de una edición concreta.
    """
    return {
        "estado": "actual_matricula_abierta",
        "fechas_matricula": {"inicio": "2026-10-01T00:00Z", "fin": "2026-10-30T00:00Z"},
        "fechas_edicion": {"inicio": "2026-10-01T00:00Z", "fin": "2026-11-30T00:00Z"},
        "fechas_aula": {"inicio": "2026-10-01T00:00Z", "fin": "2026-10-21T00:00Z"},
        "fechas_sesiones": {"inicio": "2026-10-05T17:00Z", "fin": "2026-10-06T17:00Z"},
    }


def observacion_calendarios(fuente: ObjetoJson | None = None, *, vincular: bool = True) -> ObjetoJson:
    """Aporta soportes explícitos localizados, sin añadirlos a ninguna captura real.

    Returns:
        Ficha con evidencia de cada campo sintético de calendario.
    """
    fuente = copy.deepcopy(publicacion() if fuente is None else fuente)
    observacion = ficha()
    campos = [c for c in ("fechas_matricula", "fechas_edicion", "fechas_aula", "fechas_sesiones") if c in fuente]
    soportes = []
    vinculos = {}
    for campo in campos:
        soporte = evidencia("calendario")
        soporte["localizador"]["valor"] = "/" + campo
        soportes.append(soporte)
        vinculos[campo] = {
            "tipo": "url",
            "valor": OFERTA["url"],
            "edicion": {"id": None, "url": OFERTA["url"]},
            "evidencia": {k: copy.deepcopy(v) for k, v in soporte.items() if k != "alcance"},
        }
    if vincular:
        fuente["vinculos_calendarios"] = vinculos
    observacion["detalle"]["datos_edicion"] = normalizar_datos_edicion(fuente)
    observacion["detalle"]["acceso_abierto"] = False
    observacion["evidencias"] = [evidencia("identidad"), evidencia("disponibilidad"), *soportes]
    return observacion


class VigenciaCalendariosPruebas(unittest.TestCase):
    """Fechas preservadas no equivalen a fechas acreditadas de esta edición."""

    def evaluar(self, observacion: ObjetoJson) -> ObjetoJson:
        """Evalúa con reloj fijo y sin E/S.

        Returns:
            Resultado público y su trazabilidad.
        """
        return evaluar_vigencia(OFERTA, [observacion], politica(), ahora=AHORA)

    def test_matricula_abierta_y_acceso_terminado_es_fuente_contradictoria(self) -> None:
        """La segunda ventana no desaparece tras el periodo formativo más largo."""
        resultado = self.evaluar(observacion_calendarios())
        self.assertEqual(resultado["estado"], "sin-confirmar")
        self.assertIn("fuente_contradictoria_matricula_abierta_y_acceso_finalizado", resultado["motivos"])
        self.assertEqual(resultado["cierra_el"], "2026-10-21T00:00:00Z")

    def test_asociacion_generica_no_acredita_cierre_ni_disponibilidad(self) -> None:
        """El alcance calendario y un título de ficha no relacionan fechas con una edición."""
        observacion = observacion_calendarios(vincular=False)
        observacion["evidencias"] = [evidencia(c) for c in ("identidad", "disponibilidad", "calendario")]
        resultado = self.evaluar(observacion)
        self.assertEqual(resultado["estado"], "sin-confirmar")
        self.assertIn("calendario_sin_vinculo_verificable_a_edicion", resultado["motivos"])
        self.assertEqual(resultado["revisar_el"], "2026-10-23T08:00:00Z")
        self.assertIsNone(resultado["cierra_el"])
        self.assertEqual(resultado["trazabilidad"]["limites_calculados"], [])

    def test_soporte_estructurado_existente_no_exige_etiqueta_nueva(self) -> None:
        """Identidad y campo exacto de la misma captura acreditan la relación existente."""
        resultado = self.evaluar(observacion_calendarios(vincular=False))
        self.assertIn("fuente_contradictoria_matricula_abierta_y_acceso_finalizado", resultado["motivos"])

    def test_fin_formativo_no_cierra_acceso_explicito_vigente(self) -> None:
        """La formación terminada no limita artificialmente una ventana posterior de acceso."""
        fuente = publicacion()
        fuente["fechas_edicion"]["fin"] = "2026-10-20T00:00Z"
        fuente["fechas_aula"]["fin"] = "2026-11-30T00:00Z"
        resultado = self.evaluar(observacion_calendarios(fuente))
        self.assertEqual(resultado["estado"], "disponible-publicamente")
        self.assertEqual(resultado["revisar_el"], "2026-10-23T08:00:00Z")
        self.assertEqual(
            resultado["cierra_el"],
            min(c["cota_operativa_utc"] for c in resultado["trazabilidad"]["limites_calculados"]),
        )
        self.assertFalse(any("fechas_edicion" in c["campo"] for c in resultado["trazabilidad"]["limites_calculados"]))

    def test_material_auxiliar_y_sesiones_no_caducan_oferta(self) -> None:
        """El material con plazo propio y las sesiones pasadas no cierran el curso."""
        fuente = publicacion()
        fuente["fechas_aula"]["alcance"] = "material-auxiliar"
        resultado = self.evaluar(observacion_calendarios(fuente))
        self.assertEqual(resultado["estado"], "disponible-publicamente")
        self.assertFalse(
            any(
                c["campo"].startswith(("fechas_aula", "fechas_sesiones"))
                for c in resultado["trazabilidad"]["limites_calculados"]
            )
        )

    def test_vinculo_ajeno_o_no_observado_no_se_sustituye_por_default(self) -> None:
        """Destino, hash, fecha y localizador del soporte deben pertenecer a la observación real."""
        for alteracion in ("hash", "fecha", "localizador", "id"):
            with self.subTest(alteracion=alteracion):
                observacion = observacion_calendarios()
                fuente = observacion["detalle"]["datos_edicion"]["publicacion_original"]
                vinculo = fuente["vinculos_calendarios"]["fechas_aula"]
                if alteracion == "id":
                    vinculo["edicion"]["id"] = "otra-edicion"
                else:
                    clave, valor = {
                        "hash": ("sha256", "b" * 64),
                        "fecha": ("capturado_utc", "2026-10-22T07:00:00Z"),
                        "localizador": ("localizador", {"tipo": "campo", "valor": "otra-fecha"}),
                    }[alteracion]
                    vinculo["evidencia"][clave] = valor
                observacion["detalle"]["datos_edicion"] = normalizar_datos_edicion(fuente)
                resultado = self.evaluar(observacion)
                self.assertEqual(resultado["estado"], "sin-confirmar")
                self.assertIn("calendario_sin_vinculo_verificable_a_edicion", resultado["motivos"])

    def test_id_oficial_no_se_equipara_quitando_namespace(self) -> None:
        """Solo se acepta el destino declarado, sin reparar ni deducir un identificador Faro."""
        observacion = observacion_calendarios()
        fuente = observacion["detalle"]["datos_edicion"]["publicacion_original"]
        vinculo = fuente["vinculos_calendarios"]["fechas_aula"]
        vinculo.update(tipo="id", valor="id-oficial-1", edicion={"id": OFERTA["id"], "url": None})
        observacion["detalle"]["datos_edicion"] = normalizar_datos_edicion(fuente)
        self.assertIn(
            "fuente_contradictoria_matricula_abierta_y_acceso_finalizado", self.evaluar(observacion)["motivos"]
        )
        vinculo["edicion"]["id"] = "ia-1"
        observacion["detalle"]["datos_edicion"] = normalizar_datos_edicion(fuente)
        self.assertEqual(self.evaluar(observacion)["estado"], "disponible-publicamente")

    def test_acceso_acreditado_no_depende_de_fecha_opcional_sin_vinculo(self) -> None:
        """La confirmación independiente de acceso no exige un calendario opcional ambiguo."""
        observacion = observacion_calendarios(
            {"estado": "actual_matricula_abierta", "fechas_matricula": {"fin": "2026-10-30T00:00Z"}}, vincular=False
        )
        observacion["evidencias"][-1]["localizador"]["valor"] = "calendario"
        observacion["detalle"]["acceso_abierto"] = True
        self.assertEqual(self.evaluar(observacion)["estado"], "disponible-publicamente")

    def test_fallo_y_orden_no_borran_contradiccion_ni_capturas(self) -> None:
        """La decisión no muta evidencia ni depende del orden de recepción."""
        observaciones = [observacion_calendarios(), fallo()]
        original = copy.deepcopy(observaciones)
        resultado = evaluar_vigencia(OFERTA, observaciones, politica(), ahora=AHORA)
        self.assertEqual(resultado["estado"], "sin-confirmar")
        self.assertIn("fuente_contradictoria_matricula_abierta_y_acceso_finalizado", resultado["motivos"])
        self.assertIn("fallo-1", resultado["trazabilidad"]["observaciones"])
        self.assertEqual(resultado, evaluar_vigencia(OFERTA, observaciones[::-1], politica(), ahora=AHORA))
        self.assertEqual(original, observaciones)

    def test_sesiones_pasadas_solas_no_son_cierre_global(self) -> None:
        """El fin de una sesión no se convierte en fin de disponibilidad."""
        fuente = {"estado": "actual_matricula_abierta", "fechas_sesiones": {"fin": "2026-10-21T00:00Z"}}
        observacion = observacion_calendarios(fuente)
        observacion["detalle"]["acceso_abierto"] = True
        resultado = self.evaluar(observacion)
        self.assertEqual(resultado["estado"], "disponible-publicamente")
        self.assertEqual(resultado["trazabilidad"]["limites_calculados"], [])

    def test_autoformacion_abierta_no_exige_fechas_fijas(self) -> None:
        """La declaración positiva localizada de acceso basta sin inventar un calendario."""
        observacion = ficha(fuente={"estado": "actual_matricula_abierta"}, abierto=True)
        resultado = self.evaluar(observacion)
        self.assertEqual(resultado["estado"], "disponible-publicamente")
        self.assertEqual(resultado["trazabilidad"]["limites_calculados"], [])
        observacion["evidencias"] = [e for e in observacion["evidencias"] if e["alcance"] != "disponibilidad"]
        with self.assertRaisesRegex(ErrorVigencia, "Disponibilidad declarada sin evidencia"):
            self.evaluar(observacion)

    def test_auxiliar_antiguo_no_caduca_confirmacion_independiente(self) -> None:
        """Una captura de material opcional conserva su fecha sin limitar el TTL del acceso."""
        fuente = {
            "estado": "actual_matricula_abierta",
            "fechas_aula": {"fin": "2026-10-21T00:00Z", "alcance": "material-auxiliar"},
        }
        observacion = observacion_calendarios(fuente)
        observacion["detalle"]["acceso_abierto"] = True
        observacion["intentado_el"] = "2026-10-01T08:00:00Z"
        observacion["evidencias"][-1]["capturado_utc"] = "2026-10-01T08:00:00Z"
        resultado = self.evaluar(observacion)
        self.assertEqual(resultado["estado"], "disponible-publicamente")
        self.assertEqual(resultado["comprobado_el"], "2026-10-22T08:00:00Z")
        self.assertEqual(resultado["revisar_el"], "2026-10-23T08:00:00Z")

    def test_fecha_de_otra_edicion_no_cierra_matricula_actual(self) -> None:
        """Un destino explícitamente ajeno queda fuera de los límites de esta oferta."""
        observacion = observacion_calendarios()
        fuente = observacion["detalle"]["datos_edicion"]["publicacion_original"]
        vinculo = fuente["vinculos_calendarios"]["fechas_aula"]
        vinculo["edicion"]["url"] = vinculo["valor"] = "https://example.org/otra-edicion"
        observacion["detalle"]["datos_edicion"] = normalizar_datos_edicion(fuente)
        self.assertEqual(self.evaluar(observacion)["estado"], "disponible-publicamente")

    def test_cierre_pertinente_prevalece_sobre_booleano_abierto(self) -> None:
        """Acceso declarado abierto y acceso necesario terminado no permiten elegir lo favorable."""
        observacion = observacion_calendarios()
        observacion["detalle"]["acceso_abierto"] = True
        self.assertIn(
            "fuente_contradictoria_matricula_abierta_y_acceso_finalizado", self.evaluar(observacion)["motivos"]
        )

    def test_condicion_necesaria_sin_soporte_no_se_confirma_por_matricula(self) -> None:
        """La matrícula actual no inventa la comprobación de la ventana propia de acceso."""
        observacion = observacion_calendarios()
        observacion["evidencias"] = [
            e for e in observacion["evidencias"] if e["localizador"]["valor"] != "/fechas_aula"
        ]
        self.assertIn("calendario_sin_vinculo_verificable_a_edicion", self.evaluar(observacion)["motivos"])

    def test_material_auxiliar_malformado_no_impone_calendario_global(self) -> None:
        """Un error del calendario auxiliar no invalida el acceso independiente confirmado."""
        fuente = {
            "estado": "actual_matricula_abierta",
            "fechas_aula": {"inicio": "fecha-no-interpretable", "alcance": "material-auxiliar"},
        }
        observacion = observacion_calendarios(fuente)
        observacion["detalle"]["acceso_abierto"] = True
        self.assertEqual(self.evaluar(observacion)["estado"], "disponible-publicamente")

    def test_acceso_secundario_necesario_malformado_queda_pendiente(self) -> None:
        """La pérdida de una fecha secundaria por error no convierte en válido su calendario."""
        fuente = publicacion()
        fuente["fechas_aula"]["fin"] = "fecha-no-interpretable"
        resultado = self.evaluar(observacion_calendarios(fuente))
        self.assertEqual(resultado["estado"], "sin-confirmar")
        self.assertIn("calendario_publicado_no_resuelto", resultado["motivos"])

    def test_dos_accesos_de_destinos_distintos_no_son_conflicto_actual(self) -> None:
        """Un diagnóstico del inventario no convierte el calendario de otra edición en propio."""
        fuente = publicacion()
        observacion = observacion_calendarios(fuente)
        fuente = observacion["detalle"]["datos_edicion"]["publicacion_original"]
        vinculo = fuente["vinculos_calendarios"]["fechas_aula"]
        vinculo["edicion"]["url"] = vinculo["valor"] = "https://example.org/otra-edicion"
        observacion["detalle"]["datos_edicion"] = normalizar_datos_edicion(fuente, tipo_fechas="ventana-acceso")
        self.assertTrue(
            any(
                d["campo"] == "calendarios_publicados"
                for d in observacion["detalle"]["datos_edicion"]["diagnosticos_normalizacion"]
            )
        )
        self.assertEqual(self.evaluar(observacion)["estado"], "disponible-publicamente")

    def test_dos_accesos_pertinentes_discrepantes_no_eligen_el_favorable(self) -> None:
        """La discordancia de la misma dimensión y edición se conserva como pendiente."""
        observacion = observacion_calendarios()
        fuente = observacion["detalle"]["datos_edicion"]["publicacion_original"]
        observacion["detalle"]["datos_edicion"] = normalizar_datos_edicion(fuente, tipo_fechas="ventana-acceso")
        self.assertEqual(self.evaluar(observacion)["estado"], "sin-confirmar")

    def test_diagnostico_de_calendario_ajeno_anidado_no_contamina_run(self) -> None:
        """El prefijo run no hace pertinente cualquier fecha anidada de otra edición."""
        observacion = observacion_calendarios({"estado": "actual_matricula_abierta"})
        soporte = evidencia("calendario")
        soporte["localizador"]["valor"] = "run"
        vinculo = {
            "tipo": "url",
            "valor": OFERTA["url"],
            "edicion": {"id": None, "url": OFERTA["url"]},
            "evidencia": {k: copy.deepcopy(v) for k, v in soporte.items() if k != "alcance"},
        }
        ajeno = copy.deepcopy(vinculo)
        ajeno["valor"] = ajeno["edicion"]["url"] = "https://example.org/otra-edicion"
        run = {
            "key": OFERTA["id"],
            "pacingType": "self_paced",
            "isEnrollable": True,
            "start": "2026-10-01T00:00Z",
            "end": "2026-11-30T00:00Z",
            "fechas_aula": {"fin": "fecha-no-interpretable"},
            "vinculos_calendarios": {"run": vinculo, "fechas_aula": ajeno},
        }
        observacion["detalle"]["datos_edicion"] = normalizar_datos_edicion({"estado": "actual_matricula_abierta"}, run)
        observacion["evidencias"].append(soporte)
        self.assertEqual(self.evaluar(observacion)["estado"], "disponible-publicamente")

    def test_misma_captura_con_varias_ediciones_no_vincula_otro_objeto(self) -> None:
        """Compartir documento no comparte la pertenencia de sus calendarios."""
        observacion = observacion_calendarios(vincular=False)
        for soporte in observacion["evidencias"]:
            if soporte["alcance"] == "identidad":
                soporte["localizador"]["valor"] = "/ediciones/actual/id"
            elif soporte["alcance"] == "calendario":
                soporte["localizador"]["valor"] = "/ediciones/otra" + soporte["localizador"]["valor"]
        resultado = self.evaluar(observacion)
        self.assertEqual(resultado["estado"], "sin-confirmar")
        self.assertIn("calendario_sin_vinculo_verificable_a_edicion", resultado["motivos"])
        observacion["detalle"]["datos_edicion"]["estado_inscripcion"] = "cerrada"
        self.assertEqual(self.evaluar(observacion)["estado"], "no-disponible-publicamente")
