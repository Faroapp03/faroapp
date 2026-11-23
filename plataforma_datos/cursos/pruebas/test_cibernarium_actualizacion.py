"""Aplicación atribuida y registro Cibernàrium sobre SQLite sintética admitida."""

import hashlib
import io
import json
import sqlite3
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch

from plataforma_datos.comun.entrada_salida import guardar_json
from plataforma_datos.comun.nucleo import FormatoInesperado
from plataforma_datos.cursos import admision_catalogo as admision
from plataforma_datos.cursos import almacen_catalogo as almacen
from plataforma_datos.cursos import catalogo, registro_vigencia
from plataforma_datos.cursos.contrato_entrega_catalogo import ErrorEntregaCatalogo
from plataforma_datos.cursos.fuentes.barcelonactiva import actualizacion, adquisicion, control_actual, negocio_actual
from plataforma_datos.cursos.fuentes.barcelonactiva import robot_cibernarium as robot
from plataforma_datos.cursos.pruebas import test_cibernarium_adquisicion as rx
from plataforma_datos.cursos.pruebas import test_cibernarium_matricula_actual as matricula

CORTE = "2026-10-23T22:00:00Z"


class AplicacionCibernarium(unittest.TestCase):
    """La red es sintética; cargador, registro y admisión son productivos."""

    def setUp(self) -> None:
        """Conserva un programa/edición inicial y un campo ajeno bajo su canal histórico."""
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.raiz = Path(self.tmp.name)
        self.original = self.raiz / "originales"
        self.original.mkdir()
        self.actividad = matricula.actividad()
        self.historica = self.captura(self.actividad, "2026-10-23T21:00:02Z")
        self.programa = negocio_actual.programa(self.actividad)
        self.programa["datos"]["campo_ajeno"] = {"no_inferido": None}
        self.edicion = robot.normalizar_edicion(self.programa["id"], self.actividad, self.actividad["listEditions"][0])
        self.edicion.pop("evidencias")
        self.edicion["datos"].update(
            horas_publicadas=2, metodo_horas=negocio_actual.METODO_HORAS_HTML, idioma_ficha_principal="Català"
        )
        self.base = self.raiz / "entrada.sqlite3"
        prueba = self.prueba(self.historica)
        lote = {
            "schema_version": 1,
            "observado_utc": prueba["capturado_utc"],
            "fuente_lote": "sintetica-cibernarium",
            "proveedores": [
                {"id": "cibernarium", "nombre": "Fuente sintética", "naturaleza": None, "territorio": None}
            ],
            "programas": [{**self.programa, "etiquetas": [], "evidencias": [prueba]}],
            "ediciones": [{**self.edicion, "evidencias": [prueba]}],
        }
        canales = [
            {"entidad": e, "id": o["id"], "canal": "actividad-api", "evidencias": [prueba]}
            for e, o in (("programa", self.programa), ("edicion", self.edicion))
        ]
        catalogo.cargar_lote(self.base, lote, True, self.original, canales_temporales=canales)
        indice = self.raiz / "indice.json"
        guardar_json(indice, {"schema_version": 1, "archivos_conservados": [self.historica["cuerpo"]]})
        solicitud = admision.SolicitudAdmision(
            snapshot=self.ref(self.base),
            procedencia={"captura": self.ref(indice)},
            indices_evidencias={"api-inicial": admision.IndiceEvidencias(archivo=self.ref(indice), raiz=self.original)},
            validacion_destino=self.raiz / "validacion.json",
        )
        admision.admitir_snapshot(solicitud)
        self.entrada = almacen.EntradaCatalogo(
            admision=solicitud, sha256_admision=self.ref(solicitud.validacion_destino).sha256
        )
        self.normas = rx._captura(self.original, adquisicion.NORMAS, rx._normas())

    def captura(self, actividad: dict, fin: str = "2026-10-23T21:30:00Z") -> dict:
        """Conserva bytes/recibo con identidad exacta y reloj declarado.

        Returns:
            Recepción API sintética verificable por el productor real.
        """
        cuerpo = json.dumps({"numActivities": 1, "start": 0, "end": 15, "activities": [actividad]}).encode()
        return rx._captura(self.original, adquisicion.url_pagina(0), cuerpo, tipo="application/json", fin=fin)

    def ref(self, ruta: Path) -> admision.ReferenciaArchivo:
        """Referencia fijada para la admisión aislada.

        Returns:
            SHA y ruta del artefacto de esta prueba.
        """
        return admision.ReferenciaArchivo(ruta=ruta, sha256=hashlib.sha256(ruta.read_bytes()).hexdigest())

    def prueba(self, cap: dict) -> dict:
        """Construye una prueba nativa desde el recibo común.

        Returns:
            Evidencia de API para anclar negocio histórico, sin capturas inventadas.
        """
        _, meta = adquisicion.pagina(self.original, cap)
        return {
            "url": meta["url"],
            "capturado_utc": meta["fin_utc"],
            "sha256": cap["cuerpo"]["sha256"],
            "archivo": cap["cuerpo"]["archivo"],
        }

    def conjunto(self, actividad: dict) -> dict:
        """Reproduce el mismo conjunto que admitirá el ciclo común.

        Returns:
            Censo completo de una actividad con sus propias ediciones.
        """
        documento = {
            "schema_version": 1,
            "fuente_id": "barcelonactiva",
            "canal": "cibernarium",
            "capturas": [self.captura(actividad)],
            "auxiliares": {"normas": self.normas},
            "fichas": {},
            "historial": [],
        }
        return adquisicion.calcular(self.original, documento, [self.programa])

    def aplicar(self, actividad: dict, nombre: str = "salida") -> Path:
        """Invoca el aplicador sin sustituir políticas o admisión.

        Returns:
            Candidata nueva y admitida, todavía sin publicación.
        """
        destino = self.raiz / nombre
        actualizacion.aplicar(
            self.entrada, conjunto=self.conjunto(actividad), original=self.original, destino=destino, corte=CORTE
        )
        return destino

    def test_actualiza_campos_propios_y_conserva_html_entrada_y_ajenos(self) -> None:
        """Título/API cambian; horas/idioma HTML y el origen conservan bytes y fecha."""
        sha = self.ref(self.base).sha256
        a = deepcopy(self.actividad)
        a["title"] = "Título actual"
        a["listEditions"][0]["registrationDesc"] = "Places disponibles: 5."
        destino = self.aplicar(a)
        programas, ediciones = negocio_actual.leer(destino / "catalogo.sqlite3")
        self.assertEqual(programas[self.programa["id"]]["titulo"], "Título actual")
        self.assertEqual(programas[self.programa["id"]]["datos"]["campo_ajeno"], {"no_inferido": None})
        self.assertEqual(ediciones[self.edicion["id"]]["datos"]["horas_publicadas"], 2)
        self.assertEqual(ediciones[self.edicion["id"]]["datos"]["idioma_ficha_principal"], "Català")
        self.assertEqual(self.ref(self.base).sha256, sha)
        estado = registro_vigencia.consultar_edicion(destino / "catalogo.sqlite3", self.edicion["id"])
        self.assertEqual(estado["evaluacion"]["resultado"]["estado"], "disponible-publicamente")
        admision.exigir_snapshot_admitido(
            almacen.solicitud(destino), sha256_validacion=self.ref(destino / "validacion.json").sha256
        )

    def test_ausencia_no_borra_edicion_y_nueva_edicion_no_hereda_html(self) -> None:
        """Identidad nueva por ID propio, repetición sin duplicados y ausencia sin baja."""
        a = deepcopy(self.actividad)
        a["listEditions"][0]["activityId"] = "789"
        destino = self.aplicar(a)
        _, ediciones = negocio_actual.leer(destino / "catalogo.sqlite3")
        self.assertEqual(set(ediciones), {self.edicion["id"], "cibernarium-edicion:789"})
        self.assertEqual(ediciones[self.edicion["id"]], self.edicion)
        self.assertIsNone(ediciones["cibernarium-edicion:789"]["datos"]["idioma_ficha_principal"])
        control = json.loads((destino / almacen.CONTROL).read_bytes())
        recibo = almacen.leer_documento(destino, control["procedencia"]["recibo-cibernarium"])
        self.assertEqual(recibo["ausentes_sin_interpretar_baja"], [self.edicion["id"]])

    def test_contenido_incierto_identificado_registra_causa_sin_rejuvenecer(self) -> None:
        """Cambio factual ilegible no queda oculto ni conserva matrícula anterior."""
        primera = self.aplicar(self.actividad, "primera")
        solicitud = almacen.solicitud(primera)
        self.entrada = almacen.EntradaCatalogo(
            admision=solicitud, sha256_admision=self.ref(solicitud.validacion_destino).sha256
        )
        a = deepcopy(self.actividad)
        a["listEditions"][0]["registrationCode"] = "DESCONOCIDO"
        # Una captura posterior debe desplazar la lectura positiva de la misma edición.
        cap = self.captura(a, "2026-10-23T21:45:00Z")
        doc = {
            "schema_version": 1,
            "fuente_id": "barcelonactiva",
            "canal": "cibernarium",
            "capturas": [cap],
            "auxiliares": {"normas": self.normas},
            "fichas": {},
            "historial": [],
        }
        conjunto = adquisicion.calcular(self.original, doc, [self.programa])
        destino = self.raiz / "incierta"
        actualizacion.aplicar(
            self.entrada, conjunto=conjunto, original=self.original, destino=destino, corte="2026-10-23T22:01:00Z"
        )
        estado = registro_vigencia.consultar_edicion(destino / "catalogo.sqlite3", self.edicion["id"])
        self.assertEqual(estado["evaluacion"]["resultado"]["estado"], "sin-confirmar")
        control = json.loads((destino / almacen.CONTROL).read_bytes())
        recibo = almacen.leer_documento(destino, control["procedencia"]["recibo-cibernarium"])
        self.assertEqual(recibo["resultados"][0]["diagnostico"], "estado_inscripcion_no_interpretable")

    def test_replay_mismo_corte_no_duplica_versiones_ni_observaciones(self) -> None:
        """Conservar la misma consulta no equivale a consultar de nuevo."""
        primera = self.aplicar(self.actividad, "primera")
        solicitud = almacen.solicitud(primera)
        self.entrada = almacen.EntradaCatalogo(
            admision=solicitud, sha256_admision=self.ref(solicitud.validacion_destino).sha256
        )
        segunda = self.aplicar(self.actividad, "segunda")
        for tabla in ("observaciones_vigencia", "evaluaciones_vigencia", "versiones", "canales_temporales"):
            with sqlite3.connect(primera / "catalogo.sqlite3") as a, sqlite3.connect(segunda / "catalogo.sqlite3") as b:
                self.assertEqual(
                    a.execute("SELECT count(*) FROM " + tabla).fetchone(),
                    b.execute("SELECT count(*) FROM " + tabla).fetchone(),
                    tabla,
                )

    def test_replay_del_cierre_historico_y_nueva_recepcion(self) -> None:
        """El histórico permanece sellado y la siguiente visita acredita el cierre de inscripción."""
        a = deepcopy(self.actividad)
        a["listEditions"][0].update(
            registrationCode="DISP2",
            registrationDesc="Inscripció tancada.",
            openingsAvailable=False,
            tancada=True,
            isFinished=True,
        )
        with patch.object(
            actualizacion.observaciones_actuales,
            "_edicion_interpretable",
            return_value=(None, "estado_inscripcion_no_interpretable"),
        ):
            antigua = self.aplicar(a, "primera")
        solicitud = almacen.solicitud(antigua)
        entrada = almacen.EntradaCatalogo(
            admision=solicitud, sha256_admision=self.ref(solicitud.validacion_destino).sha256
        )
        destino = self.raiz / "cierre"
        corte = "2026-10-23T22:01:00Z"
        actualizacion.aplicar(entrada, conjunto=self.conjunto(a), original=self.original, destino=destino, corte=corte)
        base = destino / "catalogo.sqlite3"
        capturas = registro_vigencia.observaciones_hasta(base, tipo="edicion", id=self.edicion["id"], corte=corte)
        self.assertEqual(len(capturas), 1)
        self.assertIsNone(capturas[0]["detalle"]["datos_edicion"])
        control = json.loads((destino / almacen.CONTROL).read_bytes())
        recibo = almacen.leer_documento(destino, control["procedencia"]["recibo-cibernarium"])
        self.assertEqual(recibo["resultados"][0]["diagnostico"], "inscripcion_cerrada_en_recepcion_historica")
        original = self.captura
        with patch.object(self, "captura", side_effect=lambda actividad: original(actividad, "2026-10-23T22:04:00Z")):
            siguiente = self.conjunto(a)
        solicitud = almacen.solicitud(destino)
        nueva = self.raiz / "nueva"
        actualizacion.aplicar(
            almacen.EntradaCatalogo(admision=solicitud, sha256_admision=self.ref(solicitud.validacion_destino).sha256),
            conjunto=siguiente,
            original=self.original,
            destino=nueva,
            corte="2026-10-23T22:05:00Z",
        )
        estado = registro_vigencia.consultar_edicion(nueva / "catalogo.sqlite3", self.edicion["id"])["evaluacion"]
        self.assertEqual(estado["resultado"]["estado"], "no-disponible-publicamente")
        self.assertEqual(estado["resultado"]["comprobado_el"], "2026-10-23T22:04:00Z")
        self.assertEqual(len(estado["entradas"]["observaciones"]), 2)

    def test_ancla_se_verifica_cada_vez_aunque_ruta_y_sha_esperado_se_repitan(self) -> None:
        """La autoridad nunca procede de una caché de rutas previamente válidas."""
        ruta = self.original / self.historica["cuerpo"]["archivo"]
        sha = self.historica["cuerpo"]["sha256"]
        self.assertEqual(negocio_actual._historica(ruta, sha)[0]["activityId"], "123")
        ruta.write_bytes(b'{"activities":[]}')
        with self.assertRaisesRegex(ErrorEntregaCatalogo, "alterada"):
            negocio_actual._historica(ruta, sha)

    def test_ancla_interpreta_los_mismos_bytes_verificados_en_una_lectura(self) -> None:
        """No se abre una segunda vista del archivo entre hash e interpretación."""
        ruta = self.original / self.historica["cuerpo"]["archivo"]
        contenido = ruta.read_bytes()
        cambiado = contenido.replace(b'"123"', b'"999"')
        with patch.object(Path, "open", side_effect=[io.BytesIO(contenido), io.BytesIO(cambiado)]) as abrir:
            filas = negocio_actual._historica(ruta, self.historica["cuerpo"]["sha256"])
        self.assertEqual(filas[0]["activityId"], "123")
        self.assertEqual(abrir.call_count, 1)

    def test_ancla_no_lee_un_cuerpo_excesivo_completo(self) -> None:
        """El límite del robot también acota la lectura de anclas históricas."""
        ruta = self.original / self.historica["cuerpo"]["archivo"]
        with (
            patch.object(Path, "open", return_value=io.BytesIO(b"x" * (robot.MAX_BYTES + 1))),
            self.assertRaisesRegex(ErrorEntregaCatalogo, "excesiva"),
        ):
            negocio_actual._historica(ruta, self.historica["cuerpo"]["sha256"])

    def test_lote_entrega_el_instante_mas_reciente_sin_normalizar_su_literal(self) -> None:
        """Z no desplaza una fracción posterior del mismo segundo y offset UTC."""
        prueba = self.prueba(self.historica)
        posterior = "2026-10-23T21:00:02.123+00:00"
        pruebas = [prueba, {**prueba, "capturado_utc": posterior}]
        canal = {"entidad": "edicion", "id": self.edicion["id"], "canal": "actividad-api", "evidencias": pruebas}
        with patch.object(catalogo, "cargar_lote") as cargar:
            negocio_actual._cargar(self.base, self.edicion, [canal], negocio_actual.CONTRATOS["edicion"], self.original)
        self.assertEqual(cargar.call_args.args[1]["observado_utc"], posterior)

    def test_alta_conserva_el_literal_del_instante_real_mas_reciente(self) -> None:
        """Las dos fases del alta usan el mismo orden temporal de sus pruebas."""
        prueba = self.prueba(self.historica)
        posterior = "2026-10-23T21:00:02.123+00:00"
        pruebas = [prueba, {**prueba, "capturado_utc": posterior}]
        with patch.object(catalogo, "cargar_lote") as cargar:
            negocio_actual.alta(self.base, self.edicion, "edicion", pruebas, self.original)
        self.assertEqual(len(cargar.call_args_list), 2)
        self.assertTrue(all(llamada.args[1]["observado_utc"] == posterior for llamada in cargar.call_args_list))

    def test_ancla_final_recortada_exige_total_e_intervalo_del_mismo_cuerpo(self) -> None:
        """La variante histórica del último tramo no relaja nuevas recepciones."""
        cuerpo = json.dumps({"numActivities": 1, "start": 0, "end": 1, "activities": [self.actividad]}).encode()
        url = adquisicion.url_pagina(0).replace("_end=15&", "_end=1&")
        cap = rx._captura(self.original, url, cuerpo, tipo="application/json")
        ruta = self.original / cap["cuerpo"]["archivo"]
        prueba = {
            "url": url,
            "capturado_utc": "2026-10-23T21:00:02Z",
            "sha256": cap["cuerpo"]["sha256"],
            "archivo": cap["cuerpo"]["archivo"],
        }
        canal = {"entidad": "programa", "id": self.programa["id"], "canal": "actividad-api", "evidencias": [prueba]}
        self.assertEqual(negocio_actual._ancla(self.programa, [canal], self.original, "123", "programa"), [prueba])
        with self.assertRaises(FormatoInesperado):
            adquisicion.actividades(self.original, cap)
        for ajena in (url.replace("_end=1&", "_end=2&"), url.replace("p_p_state=normal", "p_p_state=otro")):
            with self.subTest(url=ajena), self.assertRaises(ErrorEntregaCatalogo):
                negocio_actual._historica(ruta, cap["cuerpo"]["sha256"], ajena)

    def test_identidad_nueva_sin_calendario_se_retiene_sin_fabricar_edicion(self) -> None:
        """Un ID por sí solo no crea una edición ofrecible ni hereda las fechas de otra."""
        a = deepcopy(self.actividad)
        a["listEditions"][0].update(activityId="789", listSessions=[])
        destino = self.aplicar(a)
        _, ediciones = negocio_actual.leer(destino / "catalogo.sqlite3")
        self.assertEqual(set(ediciones), {self.edicion["id"]})
        control = json.loads((destino / almacen.CONTROL).read_bytes())
        recibo = almacen.leer_documento(destino, control["procedencia"]["recibo-cibernarium"])
        self.assertEqual(recibo["resultados"][0]["pendiente"], "edicion_nueva_sin_contenido_contrastable")

    def test_control_rechaza_identidad_contexto_y_referencias_alteradas(self) -> None:
        """No se admite selección de una edición con el contexto de otra captura."""
        destino = self.aplicar(self.actividad)
        control = json.loads((destino / almacen.CONTROL).read_bytes())
        actual = almacen.leer_documento(destino, control["procedencia"]["control-cibernarium"])
        for cambio in ("id", "contexto", "referencia"):
            alterado = deepcopy(actual)
            if cambio == "id":
                alterado["recepciones"][0]["edicion_id"] = "789"
            elif cambio == "contexto":
                alterado["recepciones"][0]["contexto_sha256"] = "a" * 64
            else:
                next(iter(alterado["contextos"].values()))["api"]["cuerpo_sha256"] = "a" * 64
            with self.subTest(cambio=cambio), self.assertRaises(ErrorEntregaCatalogo):
                control_actual.validar(alterado)
