"""El TTL solo programa la revisión interna: el tiempo cambia la oferta por límites publicados."""

import ast
import copy
import inspect
import json
import sqlite3
import tempfile
import unittest
from http import HTTPStatus
from pathlib import Path
from unittest.mock import patch

from plataforma_datos.cursos import catalogo, politicas_vigencia, vigencia
from plataforma_datos.cursos import registro_vigencia as registro
from plataforma_datos.cursos.pruebas.test_catalogo import lote_base
from plataforma_datos.cursos.pruebas.test_vigencia import OFERTA, fallo, ficha, politica
from plataforma_datos.cursos.pruebas.test_vigencia import catalogo as lectura_catalogo
from plataforma_datos.cursos.pruebas.test_vigencia_fallos import error_http
from plataforma_datos.cursos.tipos_json import ObjetoJson
from plataforma_datos.cursos.vigencia import ErrorVigencia, evaluar_vigencia

COMPROBADO = "2026-10-22T08:00:00Z"
REVISION = "2026-10-23T08:00:00Z"
CAMPOS_PANEL = ("cierra_el", "revisar_el", "ultimo_intento_fallido_el", "incidencia_enlace")
MOTIVOS_RETIRADOS = ("ttl_de_ficha_vencido", "ttl_de_catalogo_vencido", "limite_de_vigencia_alcanzado")


def evaluar(observaciones: list[ObjetoJson], ahora: str, regla: ObjetoJson | None = None) -> ObjetoJson:
    """Evalúa una copia de las observaciones con la política sintética vigente.

    Returns:
        Resultado del evaluador real.
    """
    return evaluar_vigencia(copy.deepcopy(OFERTA), copy.deepcopy(observaciones), regla or politica(), ahora=ahora)


def cerrada(fecha: str, identificador: str) -> ObjetoJson:
    """Ficha identificada cuya inscripción publicada está cerrada.

    Returns:
        Observación válida de cierre anunciado.
    """
    observacion = ficha(fecha, identificador=identificador)
    observacion["detalle"]["datos_edicion"]["estado_inscripcion"] = "cerrada"
    return observacion


class RevisionInternaPruebas(unittest.TestCase):
    """Fija la regla: ningún umbral cambia lo que ve la persona; solo estados observados."""

    def test_reloj_sin_observaciones_nuevas_no_retira_ni_rejuvenece(self) -> None:
        """Días y semanas después la oferta sigue disponible y solo queda revisión pendiente."""
        for ahora in ("2026-10-23T08:00:00Z", "2026-10-24T10:00:00Z", "2026-10-29T10:00:00Z", "2026-11-19T10:00:00Z"):
            with self.subTest(ahora=ahora):
                resultado = evaluar([ficha()], ahora)
                self.assertEqual(resultado["estado"], "disponible-publicamente")
                self.assertEqual(resultado["motivos"], ["ficha_identificada_y_disponibilidad_vigente"])
                self.assertEqual(resultado["comprobado_el"], COMPROBADO)
                self.assertEqual(resultado["revisar_el"], REVISION)
                self.assertLessEqual(resultado["revisar_el"], ahora)
                self.assertIsNone(resultado["cierra_el"])
                self.assertIsNone(resultado["ultimo_intento_fallido_el"])
                self.assertNotIn("vence_el", resultado)

    def test_confirmado_fallo_recuperacion(self) -> None:
        """El fallo no retira ni rejuvenece; la recuperación renueva y limpia el aviso."""
        ahora = "2026-10-26T10:00:00Z"
        caida = evaluar([ficha(), fallo()], ahora)
        self.assertEqual(caida["estado"], "disponible-publicamente")
        self.assertEqual(caida["comprobado_el"], COMPROBADO)
        self.assertEqual(caida["revisar_el"], REVISION)
        self.assertEqual(caida["ultimo_intento_fallido_el"], "2026-10-22T09:00:00Z")
        recuperacion = ficha("2026-10-24T09:30:00Z", identificador="recuperacion")
        recuperada = evaluar([ficha(), fallo(), recuperacion], ahora)
        self.assertEqual(recuperada["estado"], "disponible-publicamente")
        self.assertEqual(recuperada["comprobado_el"], "2026-10-24T09:30:00Z")
        self.assertEqual(recuperada["revisar_el"], "2026-10-25T09:30:00Z")
        self.assertIsNone(recuperada["ultimo_intento_fallido_el"])
        otra_caida = fallo("2026-10-25T11:00:00Z", identificador="fallo-2")
        de_nuevo = evaluar([ficha(), fallo(), recuperacion, otra_caida], ahora)
        self.assertEqual(de_nuevo["comprobado_el"], "2026-10-24T09:30:00Z")
        self.assertEqual(de_nuevo["ultimo_intento_fallido_el"], "2026-10-25T11:00:00Z")
        self.assertEqual(de_nuevo["estado"], "disponible-publicamente")

    def test_cierre_y_fallo_no_resucita_apertura_anterior(self) -> None:
        """Tras un cierre, un fallo posterior y el paso del tiempo no devuelven la oferta."""
        observaciones = [ficha(), cerrada("2026-10-22T09:00:00Z", "cierre"), fallo("2026-10-22T09:30:00Z")]
        for ahora in ("2026-10-22T10:00:00Z", "2026-10-30T10:00:00Z"):
            with self.subTest(ahora=ahora):
                resultado = evaluar(observaciones, ahora)
                self.assertEqual(resultado["estado"], "no-disponible-publicamente")
                self.assertEqual(resultado["motivos"], ["inscripcion_cerrada_o_sin_plazas"])
                self.assertEqual(resultado["comprobado_el"], "2026-10-22T09:00:00Z")
                self.assertEqual(resultado["ultimo_intento_fallido_el"], "2026-10-22T09:30:00Z")

    def test_respuestas_desordenadas_conservan_la_precedencia(self) -> None:
        """La antigua tardía no pisa la reciente; la posterior contradictoria no queda tapada."""
        ahora = "2026-10-28T10:00:00Z"
        reciente = ficha("2026-10-22T09:00:00Z", identificador="apertura-reciente")
        tardia = cerrada(COMPROBADO, "cierre-antiguo-tardio")
        tardia.update(intentado_el="2026-10-22T07:59:00Z", terminado_el="2026-10-22T09:45:00Z")
        for orden in ([reciente, tardia], [tardia, reciente]):
            with self.subTest(caso="antigua tardía", primero=orden[0]["id"]):
                resultado = evaluar(orden, ahora)
                self.assertEqual(resultado["estado"], "disponible-publicamente")
                self.assertEqual(resultado["comprobado_el"], "2026-10-22T09:00:00Z")
        posterior = cerrada("2026-10-22T09:00:00Z", "cierre-posterior")
        for orden in ([ficha(), posterior], [posterior, ficha()]):
            with self.subTest(caso="posterior contradictoria", primero=orden[0]["id"]):
                resultado = evaluar(orden, ahora)
                self.assertEqual(resultado["estado"], "no-disponible-publicamente")
                self.assertEqual(resultado["motivos"], ["inscripcion_cerrada_o_sin_plazas"])

    def test_limite_publicado_de_matricula_retira_y_entra_en_cierra_el(self) -> None:
        """El fin publicado de matrícula sí retira al alcanzarse; antes solo es cierra_el."""
        fuente = {"estado": "actual_matricula_abierta", "fechas_matricula": ["2026-10-01T00:00Z", "2026-10-25T00:00Z"]}
        observaciones = [ficha(fuente=fuente, abierto=False)]
        antes = evaluar(observaciones, "2026-10-24T10:00:00Z")
        self.assertEqual(antes["estado"], "disponible-publicamente")
        self.assertEqual(antes["cierra_el"], "2026-10-25T00:00:00Z")
        self.assertEqual(antes["revisar_el"], REVISION)
        alcanzado = evaluar(observaciones, "2026-10-25T00:00:00Z")
        self.assertEqual(alcanzado["estado"], "no-disponible-publicamente")
        self.assertEqual(alcanzado["motivos"], ["plazo_de_inscripcion_o_acceso_vencido"])
        self.assertEqual(alcanzado["cierra_el"], "2026-10-25T00:00:00Z")

    def test_limites_publicados_de_acceso_y_formacion_entran_en_cierra_el(self) -> None:
        """El fin de acceso y el de la formación publicados limitan la oferta; el TTL no."""
        for campo, motivo in (
            ("fechas_aula", "ventana_de_acceso_finalizada"),
            ("fechas_edicion", "periodo_formativo_finalizado"),
        ):
            with self.subTest(campo=campo):
                fuente = {
                    "estado": "actual_matricula_abierta",
                    "fechas_matricula": ["2026-10-01T00:00Z", "2026-11-30T00:00Z"],
                    campo: ["2026-10-01T00:00Z", "2026-10-27T00:00Z"],
                }
                observaciones = [ficha(fuente=fuente, abierto=False)]
                antes = evaluar(observaciones, "2026-10-26T10:00:00Z")
                self.assertEqual(antes["cierra_el"], "2026-10-27T00:00:00Z")
                self.assertNotEqual(antes["estado"], "no-disponible-publicamente")
                despues = evaluar(observaciones, "2026-10-27T00:00:00Z")
                self.assertNotEqual(despues["estado"], "disponible-publicamente")
                if campo == "fechas_edicion":
                    self.assertEqual(despues["motivos"], [motivo])

    def test_inicio_formativo_pasado_no_cierra_ni_abre_matricula(self) -> None:
        """Empezar la formación no cierra una matrícula abierta ni acredita una que no consta."""
        ahora = "2026-10-24T10:00:00Z"
        abierta = {
            "estado": "actual_matricula_abierta",
            "fechas_matricula": ["2026-10-01T00:00Z", "2026-11-30T00:00Z"],
            "fechas_edicion": ["2026-10-23T00:00Z", "2026-12-15T00:00Z"],
        }
        resultado = evaluar([ficha(fuente=abierta, abierto=False)], ahora)
        self.assertEqual(resultado["estado"], "disponible-publicamente")
        self.assertEqual(resultado["cierra_el"], "2026-11-30T00:00:00Z")
        sin_matricula = {"fechas_edicion": ["2026-10-23T00:00Z", "2026-12-15T00:00Z"]}
        desconocida = evaluar([ficha(fuente=sin_matricula, abierto=None)], ahora)
        self.assertEqual(desconocida["estado"], "sin-confirmar")
        apertura_no_recomprobada = {"fechas_matricula": ["2026-10-23T00:00Z", "2026-11-30T00:00Z"]}
        pendiente = evaluar([ficha(fuente=apertura_no_recomprobada, abierto=False)], ahora)
        self.assertEqual(pendiente["estado"], "sin-confirmar")
        self.assertEqual(pendiente["motivos"], ["limite_temporal_no_resuelto_o_apertura_sin_recomprobar"])

    def _incidencia(self, observacion: ObjetoJson, tipo: str) -> ObjetoJson:
        """Incidencia esperada para una respuesta de enlace fallido.

        Returns:
            Fecha de fin, tipo y código HTTP de esa respuesta.
        """
        el = vigencia._utc(vigencia.instante_utc(observacion["terminado_el"], "fin"))
        return {
            "el": el,
            "origen": observacion["tipo"],
            "tipo": tipo,
            "codigo_http": observacion["detalle"]["codigo_http"],
        }

    def test_enlace_no_encontrado_conserva_oferta_fecha_e_incidencia(self) -> None:
        """Ni un 404/410 ni varios retiran lo acreditado: conservan la fecha y avisan de la incidencia."""
        for codigo in (HTTPStatus.NOT_FOUND, HTTPStatus.GONE):
            with self.subTest(codigo=codigo):
                caida = error_http(codigo)
                resultado = evaluar([ficha(), caida], "2026-10-22T10:00:00Z")
                self.assertEqual(resultado["estado"], "disponible-publicamente")
                self.assertEqual(resultado["comprobado_el"], COMPROBADO)
                self.assertEqual(resultado["incidencia_enlace"], self._incidencia(caida, "no_encontrado"))
                self.assertIsNone(resultado["ultimo_intento_fallido_el"])
        caidas = []
        for indice, fecha in enumerate(("2026-10-22T08:30:00Z", "2026-10-22T09:00:00Z", "2026-10-22T09:30:00Z")):
            caida = error_http(HTTPStatus.NOT_FOUND, fecha=fecha)
            caida["id"] = f"no-encontrado-{indice}"
            caidas.append(caida)
        repetida = evaluar([ficha(), *caidas[::-1]], "2026-10-22T10:00:00Z")
        self.assertEqual(repetida["estado"], "disponible-publicamente")
        self.assertEqual(repetida["comprobado_el"], COMPROBADO)
        self.assertEqual(repetida["incidencia_enlace"], self._incidencia(caidas[-1], "no_encontrado"))

    def test_ficha_de_otro_curso_es_incidencia_y_no_retira(self) -> None:
        """Una URL que ya lleva a otro curso falla como enlace; no acredita que este cerrara."""
        otro = ficha("2026-10-22T09:00:00Z", identificador="otro-curso")
        otro["detalle"].update(identidad_observada="otro-curso", url_final="https://example.org/otro-curso")
        for evidencia in otro["evidencias"]:
            evidencia["url"] = otro["detalle"]["url_final"]
        resultado = evaluar([ficha(), otro], "2026-10-22T10:00:00Z")
        self.assertEqual(resultado["estado"], "disponible-publicamente")
        self.assertEqual(resultado["comprobado_el"], COMPROBADO)
        self.assertEqual(resultado["incidencia_enlace"], self._incidencia(otro, "otra_identidad"))
        nunca = evaluar([otro], "2026-10-22T10:00:00Z")
        self.assertEqual(nunca["estado"], "sin-confirmar")
        self.assertEqual(nunca["motivos"], ["identidad_de_ficha_no_coincidente"])

    def test_cierre_publicado_sigue_retirando_tras_una_incidencia(self) -> None:
        """La última respuesta identificada de este curso decide: un cierre publicado retira."""
        caida = error_http(HTTPStatus.NOT_FOUND, fecha="2026-10-22T08:30:00Z")
        resultado = evaluar([ficha(), caida, cerrada("2026-10-22T09:00:00Z", "cierre")], "2026-10-22T10:00:00Z")
        self.assertNotEqual(resultado["estado"], "disponible-publicamente")
        self.assertIsNone(resultado["incidencia_enlace"])

    def test_nunca_acreditada_con_404_sigue_desconocida(self) -> None:
        """Conservar lo acreditado no admite lo nunca comprobado."""
        caida = error_http(HTTPStatus.NOT_FOUND)
        resultado = evaluar([caida, error_http(HTTPStatus.GONE, fecha="2026-10-22T09:30:00Z")], "2026-10-22T10:00:00Z")
        self.assertEqual(resultado["estado"], "sin-confirmar")
        self.assertEqual(resultado["motivos"], ["enlace_de_ficha_no_encontrado"])
        self.assertIsNone(resultado["comprobado_el"])
        self.assertEqual(resultado["incidencia_enlace"]["tipo"], "no_encontrado")

    def test_incidencia_antigua_tardia_no_tapa_una_confirmacion_posterior(self) -> None:
        """El orden es el de captura: un 404 anterior a la última ficha identificada no queda pendiente."""
        antigua = error_http(HTTPStatus.NOT_FOUND, fecha="2026-10-22T07:00:00Z")
        reciente = ficha("2026-10-22T09:00:00Z", identificador="reciente")
        resultado = evaluar([ficha(), reciente, antigua], "2026-10-22T10:00:00Z")
        self.assertEqual(resultado["estado"], "disponible-publicamente")
        self.assertEqual(resultado["comprobado_el"], "2026-10-22T09:00:00Z")
        self.assertIsNone(resultado["incidencia_enlace"])

    def _con_catalogo(self) -> ObjetoJson:
        """Política sintética que exige el catálogo, con la misma revisión interna.

        Returns:
            Copia de la política con ``requiere_catalogo`` activo.
        """
        regla = politica()
        regla.update(requiere_catalogo=True, ttl_catalogo_segundos=43200)
        return regla

    def _caida_catalogo(self, fecha: str, indice: int) -> ObjetoJson:
        """404 del catálogo requerido.

        Returns:
            Respuesta de catálogo no encontrada en esa fecha.
        """
        caida = error_http(HTTPStatus.NOT_FOUND, tipo="catalogo", fecha=fecha)
        caida["id"] = f"catalogo-404-{indice}"
        return caida

    def test_catalogo_404_repetido_conserva_presencia_e_incidencia(self) -> None:
        """Presencia válida y tres 404 del catálogo: la oferta sigue con aviso de catálogo."""
        caidas = [
            self._caida_catalogo(fecha, indice)
            for indice, fecha in enumerate(("2026-10-22T08:30:00Z", "2026-10-22T09:00:00Z", "2026-10-22T09:45:00Z"))
        ]
        resultado = evaluar([ficha(), lectura_catalogo(), *caidas[::-1]], "2026-10-22T10:00:00Z", self._con_catalogo())
        self.assertEqual(resultado["estado"], "disponible-publicamente")
        self.assertEqual(resultado["comprobado_el"], COMPROBADO)
        self.assertEqual(resultado["incidencia_enlace"], self._incidencia(caidas[-1], "no_encontrado"))
        self.assertEqual(resultado["incidencia_enlace"]["origen"], "catalogo")
        self.assertIsNone(resultado["ultimo_intento_fallido_el"])

    def test_catalogo_recuperado_borra_la_incidencia(self) -> None:
        """Presencia, 404 y presencia válida otra vez: disponible sin incidencia pendiente."""
        observaciones = [
            ficha(),
            lectura_catalogo(),
            self._caida_catalogo("2026-10-22T08:30:00Z", 1),
            lectura_catalogo("2026-10-22T09:00:00Z", identificador="catalogo-2"),
        ]
        resultado = evaluar(observaciones, "2026-10-22T10:00:00Z", self._con_catalogo())
        self.assertEqual(resultado["estado"], "disponible-publicamente")
        self.assertIsNone(resultado["incidencia_enlace"])

    def test_catalogo_con_fallo_de_transporte_conserva_y_avisa_del_intento(self) -> None:
        """Un fallo sin respuesta del catálogo no retira y queda en ``ultimo_intento_fallido_el``."""
        resultado = evaluar(
            [ficha(), lectura_catalogo(), fallo(tipo="catalogo", identificador="fallo-catalogo")],
            "2026-10-22T10:00:00Z",
            self._con_catalogo(),
        )
        self.assertEqual(resultado["estado"], "disponible-publicamente")
        self.assertEqual(resultado["ultimo_intento_fallido_el"], "2026-10-22T09:00:00Z")
        self.assertIsNone(resultado["incidencia_enlace"])

    def test_catalogo_nunca_presente_sigue_desconocido(self) -> None:
        """Sin presencia acreditada, ni un 404 ni una lectura sin la oferta inventan disponibilidad."""
        regla = self._con_catalogo()
        solo_404 = evaluar([ficha(), self._caida_catalogo("2026-10-22T08:30:00Z", 1)], "2026-10-22T10:00:00Z", regla)
        self.assertEqual(solo_404["estado"], "sin-confirmar")
        self.assertEqual(solo_404["motivos"], ["respuesta_sin_catalogo_identificado"])
        self.assertEqual(solo_404["incidencia_enlace"]["origen"], "catalogo")
        ausente = evaluar([ficha(), lectura_catalogo(presente=False)], "2026-10-22T10:00:00Z", regla)
        self.assertEqual(ausente["estado"], "sin-confirmar")
        self.assertEqual(ausente["motivos"], ["ausente_o_no_identificada_en_catalogo_completo"])

    def test_lectura_completa_sin_la_oferta_es_hecho_observado_no_incidencia(self) -> None:
        """La fuente dejó de listarla en una lectura completa: sin confirmar, sin incidencia ni cierre."""
        observaciones = [
            ficha(),
            lectura_catalogo(),
            lectura_catalogo("2026-10-22T09:00:00Z", presente=False, identificador="ausencia"),
        ]
        resultado = evaluar(observaciones, "2026-10-22T10:00:00Z", self._con_catalogo())
        self.assertEqual(resultado["estado"], "sin-confirmar")
        self.assertEqual(resultado["motivos"], ["ausente_o_no_identificada_en_catalogo_completo"])
        self.assertIsNone(resultado["incidencia_enlace"])

    def test_destino_inseguro_sigue_rechazado(self) -> None:
        """Las incidencias no relajan la validación de URL pública: un destino privado se rechaza."""
        for destino in ("http://127.0.0.1/curso", "https://intranet.local/curso", "https://10.0.0.1/curso"):
            with self.subTest(destino=destino):
                caida = error_http(HTTPStatus.FOUND)
                caida["detalle"]["url_final"] = destino
                with self.assertRaises(ErrorVigencia):
                    evaluar([ficha(), caida], "2026-10-22T10:00:00Z")

    def test_repetir_la_evaluacion_no_rejuvenece_ni_duplica_evidencia(self) -> None:
        """Repetir con el mismo o con un reloj posterior solo cambia evaluado_el."""
        observaciones = [ficha(), fallo()]
        primera = evaluar(observaciones, "2026-10-22T10:00:00Z")
        self.assertEqual(primera, evaluar(observaciones, "2026-10-22T10:00:00Z"))
        posterior = evaluar(observaciones, "2026-11-05T10:00:00Z")
        self.assertEqual(posterior["evaluado_el"], "2026-11-05T10:00:00Z")
        self.assertEqual(
            {k: v for k, v in posterior.items() if k != "evaluado_el"},
            {k: v for k, v in primera.items() if k != "evaluado_el"},
        )
        evidencias = posterior["trazabilidad"]["evidencias"]
        self.assertEqual(len(evidencias), len({repr(e) for e in evidencias}))

    def test_politica_sin_plazo_tecnico_se_rechaza(self) -> None:
        """Ninguna evaluación nueva usa la semántica antigua del TTL."""
        for valor in (None, "limite_de_vigencia", ""):
            regla = politica()
            if valor is None:
                del regla["plazo_tecnico"]
            else:
                regla["plazo_tecnico"] = valor
            with self.subTest(valor=valor), self.assertRaises(ErrorVigencia):
                evaluar([ficha()], "2026-10-22T10:00:00Z", regla)
        for (fuente, version), _ in politicas_vigencia.POLITICAS.items():
            leida = politicas_vigencia.leer_politica(fuente, version)
            with self.subTest(fuente=fuente, version=version):
                if "plazo_tecnico" not in leida:
                    oferta = {**OFERTA, "fuente_id": fuente}
                    with self.assertRaises(ErrorVigencia):
                        vigencia.validar_entrada(oferta, [], leida, ahora="2026-10-22T10:00:00Z")
                else:
                    self.assertEqual(leida["plazo_tecnico"], vigencia.PLAZO_TECNICO)
        vigentes = {("hp_life", "2"), ("cibervoluntarios", "2"), ("claude_academy", "2"), ("fundae", "2")}
        vigentes.add(("barcelonactiva", registro.matricula_actual.VERSION_POLITICA))
        for fuente, version in vigentes:
            with self.subTest(vigente=fuente):
                self.assertEqual(politicas_vigencia.leer_politica(fuente, version)["plazo_tecnico"], "revision_interna")

    def test_revision_interna_es_la_ultima_comprobacion_mas_el_plazo_de_ficha(self) -> None:
        """`revisar_el`, que el panel compara con su reloj, es la comprobación más `ttl_ficha_segundos`."""
        for segundos, esperado in ((3600, "2026-10-22T09:00:00Z"), (86400, REVISION)):
            with self.subTest(segundos=segundos):
                regla = {**politica(), "ttl_ficha_segundos": segundos, "requiere_catalogo": False}
                resultado = evaluar([ficha()], "2026-10-22T08:30:00Z", regla)
                self.assertEqual((resultado["comprobado_el"], resultado["revisar_el"]), (COMPROBADO, esperado))

    def test_guardia_el_ttl_no_vuelve_a_ser_filtro(self) -> None:
        """Ninguna rama produce comprobacion-caducada y el TTL solo se lee para revisar_el."""
        fuente = inspect.getsource(vigencia)
        self.assertNotIn("comprobacion-caducada", vigencia.ESTADOS)
        for prohibido in ("comprobacion-caducada", *MOTIVOS_RETIRADOS, '"vence_el"'):
            self.assertNotIn(prohibido, fuente)
        lectores = set()
        for nodo in ast.walk(ast.parse(fuente)):
            if isinstance(nodo, ast.FunctionDef):
                for interior in ast.walk(nodo):
                    if isinstance(interior, ast.Constant) and interior.value in (
                        "ttl_ficha_segundos",
                        "ttl_catalogo_segundos",
                    ):
                        lectores.add(nodo.name)
        self.assertEqual(lectores, {"_revisar_el", "_validar_politica"})
        regla = {**politica(), "ttl_ficha_segundos": 1, "requiere_catalogo": False}
        for ahora in ("2026-10-22T08:00:01Z", "2026-10-22T10:00:00Z", "2027-10-22T10:00:00Z"):
            with self.subTest(ahora=ahora):
                resultado = evaluar([ficha()], ahora, regla)
                self.assertEqual(resultado["estado"], "disponible-publicamente")
                self.assertTrue(set(CAMPOS_PANEL) <= set(resultado))


class HistorialAnteriorPruebas(unittest.TestCase):
    """El historial con contrato 1 se lee por huella, sin reescribirse ni reevaluarse."""

    def setUp(self) -> None:
        """Crea un catálogo aislado con registro de vigencia."""
        temporal = tempfile.TemporaryDirectory(prefix="historial vigencia ")
        self.addCleanup(temporal.cleanup)
        self.base = Path(temporal.name) / "catalogo.sqlite"
        catalogo.cargar_lote(self.base, lote_base())

    def test_registro_schema1_sigue_legible_sin_alterarse(self) -> None:
        """Una evaluación v1 (TTL, vence_el, comprobacion-caducada) se lee igual tras el cambio."""
        oferta = {**OFERTA, "id": "edicion-1"}
        observacion = ficha()
        observacion["detalle"]["identidad_observada"] = "edicion-1"
        antigua = {k: v for k, v in politica().items() if k != "plazo_tecnico"}
        nuevo = evaluar_vigencia(oferta, [observacion], politica(), ahora="2026-10-23T09:00:00Z")
        resultado_v1 = {k: v for k, v in nuevo.items() if k not in CAMPOS_PANEL}
        resultado_v1.update(
            schema_version=1, estado="comprobacion-caducada", motivos=["ttl_de_ficha_vencido"], vence_el=REVISION
        )
        firma_v1 = {**registro.firma_evaluador(), "version": 1, "version_contrato_vigencia": 1}
        firma_v1["sha256"] = registro._huella({k: firma_v1[k] for k in ("version_contrato_vigencia", "archivos")})
        solicitud = registro.SolicitudEvaluacion(
            edicion_id="edicion-1",
            oferta=oferta,
            observaciones=[observacion],
            politica=antigua,
            ahora="2026-10-23T09:00:00Z",
        )
        with (
            patch.object(registro.vigencia, "validar_entrada"),
            patch.object(registro.vigencia, "evaluar_vigencia", return_value=copy.deepcopy(resultado_v1)),
            patch.object(registro, "firma_evaluador", return_value=copy.deepcopy(firma_v1)),
        ):
            registro.registrar_evaluacion(self.base, solicitud)
        bytes_antes = self.base.read_bytes()
        with (
            patch.object(registro.vigencia, "evaluar_vigencia", side_effect=AssertionError("No reevaluar")),
            patch.object(registro.vigencia, "validar_entrada", side_effect=AssertionError("No revalidar")),
        ):
            estado = registro.consultar_edicion(self.base, "edicion-1")
            self.assertEqual(registro.consultar_edicion(self.base, "edicion-1"), estado)
        self.assertEqual(self.base.read_bytes(), bytes_antes)
        evaluacion = estado["evaluacion"]
        self.assertEqual(evaluacion["resultado"], resultado_v1)
        self.assertEqual(evaluacion["entradas"]["politica"], antigua)
        self.assertEqual(evaluacion["evaluador"], firma_v1)
        self.assertEqual(estado["estado_registro"], "no_evaluado")
        self.assertEqual(estado["motivo"], "evaluador_modificado_requiere_evaluacion")
        self.assertEqual(registro.firma_evaluador()["version"], 2)
        self.assertEqual(registro.firma_evaluador()["version_contrato_vigencia"], 2)
        actual = registro.SolicitudEvaluacion(
            edicion_id="edicion-1",
            oferta=oferta,
            observaciones=[observacion],
            politica=politica(),
            ahora="2026-10-24T09:00:00Z",
        )
        registro.registrar_evaluacion(self.base, actual)
        reciente = registro.consultar_edicion(self.base, "edicion-1")
        self.assertEqual(reciente["estado_registro"], "evaluado")
        self.assertEqual(reciente["evaluacion"]["resultado"]["schema_version"], 2)
        self.assertEqual(reciente["evaluacion"]["resultado"]["comprobado_el"], COMPROBADO)
        with sqlite3.connect(self.base) as conexion:
            self.assertEqual(conexion.execute("SELECT count(*) FROM evaluaciones_vigencia").fetchone()[0], 2)

    def test_esquemas_aceptan_resultado_v1_del_historial(self) -> None:
        """El contrato 2 conserva la forma 1 para leer el registro, sin volver a producirla."""
        nuevo = evaluar([ficha()], "2026-10-22T10:00:00Z")
        resultado_v1 = {*(set(nuevo) - set(CAMPOS_PANEL)), "vence_el"}
        esquema = Path(vigencia.__file__).with_name("esquemas")
        defs = json.loads((esquema / "contrato_vigencia.json").read_text())["$defs"]
        self.assertEqual(set(defs["resultado_v1"]["required"]), resultado_v1)
        self.assertIn("comprobacion-caducada", defs["resultado_v1"]["properties"]["estado"]["enum"])
        self.assertEqual(set(defs["resultado"]["required"]), set(nuevo))
        propiedades = json.loads((esquema / "registro_vigencia.json").read_text())["properties"]
        self.assertEqual(
            propiedades["resultado"]["oneOf"],
            [
                {"$ref": "contrato_vigencia.json#/$defs/resultado"},
                {"$ref": "contrato_vigencia.json#/$defs/resultado_v1"},
            ],
        )
        self.assertEqual(propiedades["evaluador"]["properties"]["version"]["enum"], [1, 2])


if __name__ == "__main__":
    unittest.main()
