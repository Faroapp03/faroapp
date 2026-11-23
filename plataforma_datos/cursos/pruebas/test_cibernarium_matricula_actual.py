"""Método de matrícula por edición, de activación expresa: no confunde inscripción con acceso."""

import hashlib
import json
import sqlite3
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch

from plataforma_datos.comun.nucleo import FormatoInesperado
from plataforma_datos.cursos import catalogo, politicas_vigencia, registro_vigencia, vigencia
from plataforma_datos.cursos.fuentes.barcelonactiva import adquisicion, matricula_actual, observaciones_actuales
from plataforma_datos.cursos.pruebas.test_catalogo import lote_base
from plataforma_datos.cursos.pruebas.test_cibernarium_adquisicion import _actividad, _captura

AHORA = "2026-10-23T22:00:00Z"


def politica() -> dict:
    """Lee la política vigente explícita sin alterar el índice reservado a la integración.

    Returns:
        Criterios y referencia exacta del artefacto propio para la API pura.
    """
    ruta = Path(matricula_actual.__file__).with_name(f"politica_vigencia_v{matricula_actual.VERSION_POLITICA}.json")
    sha = hashlib.sha256(ruta.read_bytes()).hexdigest()
    documento = politicas_vigencia._leer_recurso(ruta, sha)
    return {
        "fuente_id": documento["fuente_id"],
        "version": documento["version"],
        **documento["criterios"],
        "evidencias": [
            {
                "alcance": "politica",
                "tipo": "interna-faro",
                "documento_id": documento["id"],
                "version": documento["version"],
                "sha256": sha,
                "localizador": {"tipo": "campo", "valor": "/criterios"},
            }
        ],
    }


def actividad() -> dict:
    """Propone una edición futura identificada que permite inscribirse ahora.

    Returns:
        Publicación API sintética con actividad y edición de identidades distintas.
    """
    a = _actividad(123)
    a["formationType"] = "PRESENCIAL"
    a["listEditions"] = [
        {
            "activityId": "456",
            "registrationCode": "DISP0",
            "registrationDesc": "Places disponibles: 3.",
            "openingsAvailable": True,
            "tancada": False,
            "isFinished": False,
            "listSessions": [
                {
                    "beginDateTime": "Sun Oct 25 10:00:00 CET 2026",
                    "endDateTime": "Sun Oct 25 12:00:00 CET 2026",
                    "centerType": "Sessió presencial",
                    "centerName": "Centre publicat",
                }
            ],
        }
    ]
    return a


class MatriculaCibernarium(unittest.TestCase):
    """Casos causales sobre captura, calendario, estado y TTL propios de edición."""

    def setUp(self) -> None:
        """Prepara únicamente una recepción y una base sintéticas aisladas."""
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.original = Path(self.tmp.name)
        self.oferta, self.obs = self.construir(actividad())
        self.politica = politica()

    def construir(self, a: dict, fin: str = "2026-10-23T21:00:02Z") -> tuple[dict, dict]:
        """Usa el constructor productivo con cuerpo y recibo reales de la fixture.

        Returns:
            Oferta y observación sin resultados de vigencia inyectados.
        """
        cuerpo = json.dumps({"numActivities": 1, "start": 0, "end": 15, "activities": [a]}).encode()
        cap = _captura(self.original, adquisicion.url_pagina(0), cuerpo, tipo="application/json", fin=fin)
        return observaciones_actuales.construir(self.original, cap, actividad_id="123", edicion_id="456")

    def evaluar(self, observaciones: list[dict] | None = None, ahora: str = AHORA) -> dict:
        """Invoca el evaluador real, sin reloj o red.

        Returns:
            Decisión y trazabilidad del conjunto explícito de observaciones.
        """
        return vigencia.evaluar_vigencia(self.oferta, observaciones or [self.obs], self.politica, ahora=ahora)

    def test_matricula_actual_sin_inventar_plazo_o_acceso(self) -> None:
        """Una inscripción corroborada se ofrece con condiciones para su edición futura."""
        resultado = self.evaluar()
        self.assertEqual(resultado["estado"], "disponible-publicamente")
        self.assertEqual(resultado["comprobado_el"], "2026-10-23T21:00:02Z")
        self.assertEqual(resultado["revisar_el"], "2026-10-24T21:00:02Z")
        self.assertEqual(
            resultado["cierra_el"],
            min(c["cota_operativa_utc"] for c in resultado["trazabilidad"]["limites_calculados"]),
        )
        detalle = self.obs["detalle"]
        self.assertIsNone(detalle["acceso_abierto"])
        self.assertEqual(detalle["datos_edicion"]["fechas_matricula"], {"inicio": None, "fin": None})
        self.assertIsNone(detalle["datos_edicion"]["plaza_confirmada_persona"])
        self.assertIsNone(detalle["datos_edicion"]["admisibilidad_persona"])

    def test_ventana_de_acceso_futuro_no_se_finge_abierta(self) -> None:
        """Matrícula actual y apertura posterior del Campus son hechos distintos."""
        a = actividad()
        a["formationType"] = "ONLINE"
        a["listEditions"][0].update(
            listSessions=[],
            sessionsOnline={"startDate": "Sun Oct 25 10:00:00 CET 2026", "endDate": "Thu Dec 31 23:59:00 CET 2026"},
        )
        self.oferta, self.obs = self.construir(a)
        self.assertEqual(self.evaluar()["estado"], "disponible-publicamente")
        self.assertIsNone(self.obs["detalle"]["acceso_abierto"])

    def test_no_se_presta_estado_de_otra_edicion(self) -> None:
        """ID y pruebas de otra edición invalidan el método."""
        for cambiar in ("declaracion", "calendario", "localizador"):
            obs = deepcopy(self.obs)
            if cambiar == "declaracion":
                obs["detalle"][matricula_actual.CAMPO]["edicion_id"] = "123"
            elif cambiar == "calendario":
                original = obs["detalle"]["datos_edicion"]["publicacion_original"]
                original["vinculos_calendarios"]["fechas_edicion"]["valor"] = "123"
            else:
                obs["evidencias"][1]["localizador"]["valor"] = "/activities/0/listEditions/1/activityId"
            with self.subTest(cambiar=cambiar), self.assertRaises(vigencia.ErrorVigencia):
                self.evaluar([obs])

    def test_cta_generico_no_prueba_matricula(self) -> None:
        """Un botón general no sustituye campos del objeto de esa edición."""
        obs = deepcopy(self.obs)
        obs["evidencias"][2]["localizador"] = {"tipo": "selector", "valor": "a.inscribirse"}
        with self.assertRaises(vigencia.ErrorVigencia):
            self.evaluar([obs])
        cap = _captura(self.original, adquisicion.url_pagina(0), b"<a>Inscriu-te</a>")
        with self.assertRaises(FormatoInesperado):
            observaciones_actuales.construir(self.original, cap, actividad_id="123", edicion_id="456")

    def test_estado_ambiguo_se_conserva_sin_confirmacion(self) -> None:
        """Señales incompatibles o incompletas nunca producen matrícula positiva."""
        for campo, valor in (
            ("registrationDesc", "Sense places."),
            ("openingsAvailable", False),
            ("tancada", True),
            ("isFinished", True),
        ):
            a = actividad()
            a["listEditions"][0][campo] = valor
            oferta, obs = self.construir(a, "2026-10-23T21:30:00Z")
            self.assertEqual(obs["resultado"], "correcta")
            for historial in ([obs], [self.obs, obs]):
                self.assertEqual(
                    vigencia.evaluar_vigencia(oferta, historial, self.politica, ahora=AHORA)["estado"], "sin-confirmar"
                )

    def test_403_y_redireccion_no_anulan_ni_renuevan(self) -> None:
        """Los fallos dejan vigente la prueba anterior solo hasta su propio TTL."""
        for codigo in (403, 302):
            cuerpo = json.dumps({"numActivities": 1, "start": 0, "end": 15, "activities": [actividad()]}).encode()
            cap = _captura(self.original, adquisicion.url_pagina(0), cuerpo, http=codigo, tipo="application/json")
            with self.assertRaises(FormatoInesperado):
                observaciones_actuales.construir(self.original, cap, actividad_id="123", edicion_id="456")
            fallo = deepcopy(self.obs)
            fallo.update(
                id="fallo-" + str(codigo), intentado_el="2026-10-23T21:30:00Z", terminado_el="2026-10-23T21:30:01Z"
            )
            fallo["detalle"] = {
                "url_final": matricula_actual.ORIGEN + "/ca/",
                "codigo_http": codigo,
                "tipo_destino": "portada",
                "identidad_observada": None,
                "datos_edicion": None,
                "acceso_abierto": None,
            }
            fallo["evidencias"] = [
                {
                    "alcance": "diagnostico",
                    "url": fallo["url_consultada"],
                    "capturado_utc": fallo["terminado_el"],
                    "sha256": "b" * 64,
                    "localizador": {"tipo": "campo", "valor": "/http"},
                }
            ]
            conjunto = [self.obs, fallo]
            vigente = self.evaluar(conjunto)
            self.assertEqual(vigente["estado"], "disponible-publicamente")
            self.assertEqual(vigente["revisar_el"], "2026-10-24T21:00:02Z")
            pasada = self.evaluar(conjunto, "2026-10-24T21:00:02Z")
            self.assertEqual(pasada["estado"], "disponible-publicamente")
            self.assertEqual(pasada["comprobado_el"], "2026-10-23T21:00:02Z")

    def test_respuesta_identificada_no_interpretable_desplaza_la_anterior(self) -> None:
        """No se conserva el favor previo si la fuente respondió sobre la misma edición."""
        for campo, valor in (
            ("registrationCode", "DESCONOCIDO"),
            ("registrationCode", "DISP52"),
            ("listSessions", []),
            ("listSessions", "formato cambiado"),
            ("registrationCode", "DISP3"),
            ("falta_flag", None),
        ):
            a = actividad()
            if campo == "falta_flag":
                del a["listEditions"][0]["openingsAvailable"]
            else:
                a["listEditions"][0][campo] = valor
            oferta, obs = self.construir(a, "2026-10-23T21:30:00Z")
            self.assertEqual(obs["resultado"], "correcta")
            self.assertIsNone(obs["detalle"]["datos_edicion"])
            for historial in ([obs], [self.obs, obs]):
                resultado = vigencia.evaluar_vigencia(oferta, historial, self.politica, ahora=AHORA)
                self.assertEqual(resultado["estado"], "sin-confirmar")
                self.assertEqual(resultado["motivos"], ["ficha_sin_contenido_contrastable"])

    def test_cierre_conocido_prevalece_sobre_ultima_matricula(self) -> None:
        """Una respuesta identificada de cierre no se oculta detrás del TTL previo."""
        a = actividad()
        a["listEditions"][0].update(registrationCode="DISP3", registrationDesc="Sense places.", openingsAvailable=False)
        _, cierre = self.construir(a, "2026-10-23T21:30:00Z")
        self.assertEqual(self.evaluar([self.obs, cierre])["estado"], "no-disponible-publicamente")

    def test_inscripcion_cerrada_con_sesiones_futuras(self) -> None:
        """El cierre expreso de la inscripción no significa que acabaran las clases."""
        a = actividad()
        edicion = a["listEditions"][0]
        edicion.update(
            registrationCode="DISP2",
            registrationDesc="Inscripció tancada.",
            openingsAvailable=False,
            tancada=True,
            isFinished=True,
        )
        _, cierre = self.construir(a, "2026-10-23T21:30:00Z")
        resultado = self.evaluar([self.obs, cierre])
        self.assertEqual(resultado["estado"], "no-disponible-publicamente")
        self.assertEqual(resultado["motivos"], ["inscripcion_cerrada_o_sin_plazas"])
        datos = cierre["detalle"]["datos_edicion"]
        self.assertEqual(datos["estado_inscripcion"], "cerrada")
        self.assertIsNone(datos["estado_edicion"])
        self.assertEqual(datos["calendarios_publicados"][0]["periodo"]["fin"], "2026-10-25T12:00:00+01:00")
        for campo, valor in (
            ("registrationCode", "DISP9"),
            ("registrationDesc", "Places disponibles: 3."),
            ("openingsAvailable", True),
            ("tancada", False),
            ("isFinished", None),
        ):
            with self.subTest(campo=campo):
                contradictoria = deepcopy(a)
                contradictoria["listEditions"][0][campo] = valor
                _, sin_cierre = self.construir(contradictoria, "2026-10-23T21:35:00Z")
                self.assertEqual(self.evaluar([self.obs, sin_cierre])["estado"], "sin-confirmar")

    def test_calendario_terminado_prevalece_sobre_senales_ambiguas(self) -> None:
        """Un calendario propio vencido no se oculta detrás de la incertidumbre."""
        a = actividad()
        edicion = a["listEditions"][0]
        edicion["tancada"] = True
        edicion["listSessions"][0].update(
            beginDateTime="Thu Oct 22 10:00:00 CEST 2026", endDateTime="Thu Oct 22 12:00:00 CEST 2026"
        )
        _, vencida = self.construir(a, "2026-10-23T21:30:00Z")
        self.assertEqual(self.evaluar([self.obs, vencida])["estado"], "no-disponible-publicamente")

    def test_metodo_solo_en_politica_explicita(self) -> None:
        """Políticas anteriores y otra fuente no adquieren el permiso nuevo."""
        for version in ("1", "2"):
            anterior = politicas_vigencia.leer_politica("barcelonactiva", version)
            with self.subTest(version=version), self.assertRaises(vigencia.ErrorVigencia):
                vigencia.evaluar_vigencia(self.oferta, [self.obs], anterior, ahora=AHORA)
        otro = {**self.politica, "fuente_id": "otra"}
        with self.assertRaises(vigencia.ErrorVigencia):
            vigencia.evaluar_vigencia({**self.oferta, "fuente_id": "otra"}, [self.obs], otro, ahora=AHORA)
        ruta = Path(matricula_actual.__file__).with_name("politica_vigencia_v1.json")
        self.assertEqual(
            hashlib.sha256(ruta.read_bytes()).hexdigest(), politicas_vigencia.POLITICAS[("barcelonactiva", "1")][1]
        )

    def test_esquema_publica_el_metodo_cerrado(self) -> None:
        """La extensión mantiene las formas previas y publica solo sus campos."""
        ruta = Path(vigencia.__file__).with_name("esquemas") / "contrato_vigencia.json"
        defs = json.loads(ruta.read_bytes())["$defs"]
        metodo = defs[matricula_actual.CAMPO]
        self.assertFalse(metodo["additionalProperties"])
        self.assertEqual(set(metodo["required"]), set(self.obs["detalle"][matricula_actual.CAMPO]))
        self.assertEqual(metodo["properties"]["metodo"], {"const": matricula_actual.METODO})
        self.assertEqual(set(metodo["properties"]["apoyos"]["required"]), set(matricula_actual.APOYOS))
        self.assertIn("oferta_publicada_continua", defs["detalle_ficha"]["properties"])

    def test_firma_cubre_modulo_y_reevaluacion_no_rejuvenece(self) -> None:
        """Cambiar el artefacto del método exige reevaluar, conservando pruebas y fechas."""
        ruta = Path(matricula_actual.__file__)
        firma = registro_vigencia.firma_evaluador()
        clave = matricula_actual.__name__.replace(".", "/") + ".py"
        self.assertEqual(firma["archivos"][clave], hashlib.sha256(ruta.read_bytes()).hexdigest())
        base = self.original / "registro.sqlite"
        lote = lote_base()
        lote["ediciones"][0]["id"] = self.oferta["id"]
        catalogo.cargar_lote(base, lote)
        inicial = registro_vigencia.SolicitudEvaluacion(
            edicion_id=self.oferta["id"],
            oferta=self.oferta,
            observaciones=[self.obs],
            politica=self.politica,
            ahora=AHORA,
        )
        registro_vigencia.registrar_evaluacion(base, inicial)
        original = registro_vigencia.consultar_edicion(base, self.oferta["id"])["evaluacion"]
        leer = Path.read_bytes

        def bytes_distintos(path: Path) -> bytes:
            return leer(path) + b"\n# variacion sintetica\n" if path == ruta else leer(path)

        with patch.object(Path, "read_bytes", bytes_distintos):
            nueva = registro_vigencia.firma_evaluador()
            self.assertNotEqual(nueva["sha256"], firma["sha256"])
            registro_vigencia.registrar_evaluacion(
                base,
                registro_vigencia.SolicitudEvaluacion(
                    edicion_id=self.oferta["id"],
                    oferta=self.oferta,
                    observaciones=[self.obs],
                    politica=self.politica,
                    ahora="2026-10-23T22:01:00Z",
                ),
            )
            posterior = registro_vigencia.consultar_edicion(base, self.oferta["id"])["evaluacion"]
        self.assertEqual(posterior["entradas"]["observaciones"], original["entradas"]["observaciones"])
        for campo in ("estado", "comprobado_el", "cierra_el", "revisar_el", "ultimo_intento_el", "ultimo_fin_el"):
            self.assertEqual(posterior["resultado"][campo], original["resultado"][campo])
        with sqlite3.connect(base) as db:
            self.assertEqual(db.execute("SELECT count(*) FROM evaluaciones_vigencia").fetchone()[0], 2)


if __name__ == "__main__":
    unittest.main()
