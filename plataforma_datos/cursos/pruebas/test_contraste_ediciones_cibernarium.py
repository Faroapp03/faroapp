"""Pruebas de la ficha de cada edición ausente y del significado de un fallo de transporte."""

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from plataforma_datos.cursos import vigencia
from plataforma_datos.cursos.fuentes.barcelonactiva import adquisicion, observaciones_actuales
from plataforma_datos.cursos.fuentes.barcelonactiva import contraste_ediciones as contraste
from plataforma_datos.cursos.fuentes.barcelonactiva import ficha_edicion as ficha
from plataforma_datos.cursos.pruebas import test_cibernarium_adquisicion as capturas
from plataforma_datos.cursos.pruebas.test_cibernarium_matricula_actual import actividad, politica

ID = "456"
TITULO = "Edición con horario"
EDICION = {
    "id": "cibernarium-edicion:456",
    "datos": {
        "activity_id": ID,
        "sesiones": [
            {"inicio": "2026-11-17T12:00:00+01:00", "fin": "2026-11-17T13:00:00+01:00"},
            {"inicio": "2026-11-19T12:00:00+01:00", "fin": "2026-11-19T13:00:00+01:00"},
        ],
        "fechas_publicadas": {"fin": "2026-11-19T13:00:00+01:00"},
    },
}
MARCA = '<span class="next-edition code-DISP2">Inscripció tancada.</span>'
# Disposición de la ficha plegada: la marca sin código queda en la columna derecha del propio bloque.
SIN_PLAZAS = '<div class="inlineBlock derecha"><span class="no-places">Sense places</span></div>'
# Resumen lateral de la actividad, fuera de la lista de ediciones y sin calendario propio.
RESUMEN = (
    '<div class="last-edition"><div id="itemEdiciones" class="item-ediciones item1">'
    '<span class="next-edition code-DISP3">Sense places</span></div></div>'
)


def _bloque(marca: str = MARCA, primera: str = "17", n: int = 1) -> str:
    return f"""<div class="item-ediciones izq item{n}">
        <div class="dates">Dates: Del {primera}/11/2026 al 19/11/2026</div>
        <li class="activity-session-date">Dimarts {primera} de novembre, 12:00h - 13:00h</li>
        <li class="activity-session-date">Dijous 19 de novembre, 12:00h - 13:00h</li>
        {marca}</div>"""


def _pagina(*bloques: str) -> bytes:
    return (
        '<meta property="og:url" content="'
        + ficha.url(ID)
        + '"><meta property="og:title" content="'
        + TITULO
        + '"><div id="edicionesList">'
        + "".join(bloques)
        + "</div>"
    ).encode()


def _leer(cuerpo: bytes) -> str:
    return ficha.contrastar(cuerpo, id=ID, titulo=TITULO, edicion=EDICION).estado


def _marca(clases: str, texto: str) -> str:
    return f'<span class="{clases}">{texto}</span>'


class ContrasteEdiciones(unittest.TestCase):
    """Cada lectura conserva edición, calendario y recepción propios."""

    def test_cierre_y_falta_de_plazas_solo_en_su_bloque(self) -> None:
        """El código y su literal coinciden en un único horario del año correcto."""
        self.assertEqual(_leer(_pagina(_bloque())), "cerrada")
        sin = MARCA.replace("DISP2", "DISP3").replace("Inscripció tancada.", "Sense places.")
        self.assertEqual(_leer(_pagina(_bloque(sin))), "sin-plazas")
        self.assertEqual(_leer(_pagina(_bloque(MARCA.replace("DISP2", "DISP3")))), "sin-contraste")
        self.assertEqual(_leer(_pagina(_bloque(), _bloque(sin))), "sin-contraste")
        self.assertEqual(_leer(_pagina(_bloque(primera="24"))), "otra-edicion")
        self.assertEqual(_leer(_pagina(_bloque()).replace(b"2026", b"2037")), "sin-contraste")

    def test_marca_sin_codigo_de_falta_de_plazas_en_el_bloque_propio(self) -> None:
        """La marca no-places o el código sin punto solo valen con su literal y como única marca del bloque."""
        lectura = ficha.contrastar(_pagina(_bloque(SIN_PLAZAS)), id=ID, titulo=TITULO, edicion=EDICION)
        self.assertEqual(
            (lectura.estado, lectura.selector, lectura.identificada),
            ("sin-plazas", "#edicionesList .item-ediciones.izq.item1 span.no-places", True),
        )
        boton = (
            '<a class="botonRosaDerecha" onclick="javascript:_com_davinci_ba_ciber_activity_record_'
            """CibernariumActivityRecordPortlet_INSTANCE_x_setRedirect(123,456);">Inscriure'm</a>"""
        )
        for marca, esperado in (
            (_marca("no-places", "Sense places."), "sin-plazas"),
            (_marca("no-places code-DISP3", "Sense places"), "sin-plazas"),
            (_marca("next-edition code-DISP3", "Sense places"), "sin-plazas"),
            (_marca("next-edition code-DISP2", "Inscripció tancada"), "cerrada"),
            (_marca("next-edition code-DISP3", "Inscripció tancada"), "sin-contraste"),
            (_marca("no-places", "Inscripció tancada."), "sin-contraste"),
            (_marca("no-places code-DISP2", "Sense places"), "sin-contraste"),
            (_marca("no-places code-DISP3 code-DISP2", "Sense places"), "sin-contraste"),
            (_marca("no-places", "Sense places disponibles"), "sin-contraste"),
            (_marca("no-places", "Sense places.."), "sin-contraste"),
            (_marca("no-places", ""), "sin-contraste"),
            (SIN_PLAZAS + _marca("next-edition code-DISP3", "Sense places."), "sin-contraste"),
            (SIN_PLAZAS + SIN_PLAZAS, "sin-contraste"),
            (SIN_PLAZAS + boton, "sin-contraste"),
            (f"<template>{SIN_PLAZAS}</template>", "sin-contraste"),
            (SIN_PLAZAS.replace("<span ", "<span hidden "), "sin-contraste"),
            (SIN_PLAZAS.replace("<span ", '<span aria-hidden="true" '), "sin-contraste"),
        ):
            with self.subTest(marca=marca):
                self.assertEqual(_leer(_pagina(_bloque(marca))), esperado)

    def test_la_falta_de_plazas_no_se_presta_a_otra_edicion(self) -> None:
        """Hermanos, resúmenes, calendarios ajenos o una identidad imprecisa no atribuyen la marca."""
        propio = _bloque("")
        resumen_en_lista = '<div class="item-ediciones item2">' + SIN_PLAZAS + "</div>"
        for cuerpo, esperado in (
            (_pagina(propio, _bloque(SIN_PLAZAS, primera="24", n=2)), "sin-contraste"),
            (_pagina(_bloque(SIN_PLAZAS, primera="24")), "otra-edicion"),
            (_pagina(propio) + RESUMEN.encode(), "sin-contraste"),
            (_pagina(propio) + SIN_PLAZAS.encode(), "sin-contraste"),
            (_pagina(propio, resumen_en_lista), "sin-contraste"),
            (_pagina(_bloque(SIN_PLAZAS), _bloque(SIN_PLAZAS, n=2)), "sin-contraste"),
            (_pagina(_bloque(SIN_PLAZAS)).replace(b"2026", b"2037"), "sin-contraste"),
        ):
            with self.subTest(cuerpo=cuerpo):
                self.assertEqual(_leer(cuerpo), esperado)
        # La página plegada real repite el rango de fechas y añade el resumen con código y sin punto.
        plegada = _bloque(SIN_PLAZAS).replace(
            '<div class="dates">', '<div class="dates">Dates: Del 17/11/2026 al 19/11/2026</div><div class="dates">', 1
        )
        self.assertEqual(_leer(_pagina(plegada) + RESUMEN.encode()), "sin-plazas")
        for ajena in (b"activityId=999", b"activityId=4567"):
            cuerpo = _pagina(_bloque(SIN_PLAZAS)).replace(b"activityId=456", ajena)
            lectura = ficha.contrastar(cuerpo, id=ID, titulo=TITULO, edicion=EDICION)
            self.assertEqual((lectura.estado, lectura.identificada), ("sin-contraste", False))
        lectura = ficha.contrastar(_pagina(_bloque(SIN_PLAZAS)), id=ID, titulo="Otro programa", edicion=EDICION)
        self.assertEqual((lectura.estado, lectura.identificada), ("sin-contraste", False))

    def test_boton_exige_numero_de_edicion_y_horario_propios(self) -> None:
        """Una acción de otra edición o contradicha por una marca queda pendiente."""
        boton = (
            '<a class="botonRosaDerecha" onclick="javascript:_com_davinci_ba_ciber_activity_record_'
            """CibernariumActivityRecordPortlet_INSTANCE_x_setRedirect(123,456);">Inscriure'm</a>"""
        )
        self.assertEqual(_leer(_pagina(_bloque(boton))), "boton-de-inscripcion")
        self.assertEqual(_leer(_pagina(_bloque(boton.replace("123,456", "123,789")))), "sin-contraste")
        self.assertEqual(_leer(_pagina(_bloque(boton + MARCA))), "sin-contraste")
        self.assertEqual(_leer(_pagina(_bloque()).replace(b"activityId=456", b"activityId=999")), "sin-contraste")
        self.assertEqual(_leer(_pagina(_bloque(boton)).replace(b"2026", b"2037")), "sin-contraste")
        for etiqueta in ('aria-disabled="true"', "hidden", "disabled", 'aria-hidden="true"', "inert"):
            with self.subTest(etiqueta=etiqueta):
                inactivo = boton.replace("<a ", "<a " + etiqueta + " ")
                self.assertEqual(_leer(_pagina(_bloque(inactivo))), "sin-contraste")
                self.assertEqual(_leer(_pagina(_bloque(f"<div {etiqueta}>{boton}</div>"))), "sin-contraste")

    def test_el_calendario_incompleto_o_sin_zona_conserva_la_incertidumbre(self) -> None:
        """La hora de la máquina o las sesiones que faltan no completan una ficha."""
        for sesiones in (None, [], [{"inicio": None}], [{"inicio": "2026-11-17", "fin": "2026-11-19"}]):
            edicion = {"datos": {"sesiones": sesiones}}
            lectura = ficha.contrastar(_pagina(_bloque()), id=ID, titulo=TITULO, edicion=edicion)
            self.assertEqual((lectura.estado, lectura.identificada), ("sin-contraste", True))

    def test_la_captura_entra_en_la_politica_real_sin_acreditar_otra_edicion(self) -> None:
        """El evaluador distingue cierre, ficha de otras ediciones y fallo de consulta."""
        with tempfile.TemporaryDirectory() as tmp:
            original = Path(tmp).resolve()
            for cuerpo, http, esperado, clase in (
                (_pagina(_bloque()), 200, "no-disponible-publicamente", "correcta"),
                (_pagina(_bloque(SIN_PLAZAS)), 200, "no-disponible-publicamente", "correcta"),
                (_pagina(_bloque(SIN_PLAZAS, primera="24")), 200, "sin-confirmar", "correcta"),
                (_pagina(_bloque(primera="24")), 200, "sin-confirmar", "correcta"),
                (b"<html>Acceso</html>", 200, "sin-confirmar", "fallo"),
                (b"", 503, "sin-confirmar", "fallo"),
            ):
                cap = capturas._captura(original, ficha.url(ID), cuerpo, id=EDICION["id"], http=http)
                _, obs = contraste.observar(original, cap, TITULO, EDICION)
                oferta = {"id": EDICION["id"], "fuente_id": "barcelonactiva", "url": ficha.url(ID)}
                resultado = vigencia.evaluar_vigencia(
                    oferta=oferta, observaciones=[obs], politica=politica(), ahora="2026-11-18T14:00:00Z"
                )
                self.assertEqual((resultado["estado"], obs["resultado"]), (esperado, clase))
                if clase == "correcta":
                    self.assertEqual(obs["detalle"]["identidad_observada"], EDICION["id"])

    def test_lecturas_historica_y_actual_simultaneas_no_desempatan_por_version(self) -> None:
        """El mismo cuerpo con interpretaciones distintas conserva el conflicto en ambos órdenes."""
        boton = (
            '<a class="botonRosaDerecha" onclick="javascript:_com_davinci_ba_ciber_activity_record_'
            """CibernariumActivityRecordPortlet_INSTANCE_x_setRedirect(123,456);">Inscriure'm</a>"""
        )
        oferta = {"id": EDICION["id"], "fuente_id": "barcelonactiva", "url": ficha.url(ID)}
        leer_historica = ficha.contrastar
        with tempfile.TemporaryDirectory() as tmp:
            original = Path(tmp).resolve()
            for marca, anterior, actual in (
                (SIN_PLAZAS, "sin-contraste", "sin-plazas"),
                (SIN_PLAZAS + boton, "boton-de-inscripcion", "sin-contraste"),
            ):
                cuerpo = _pagina(_bloque(marca))
                cap = capturas._captura(original, ficha.url(ID), cuerpo, id=EDICION["id"])
                diagnostico, nueva = contraste.observar(original, cap, TITULO, EDICION)
                self.assertEqual(diagnostico, "ficha_individual_" + actual.replace("-", "_"))
                with (
                    patch.object(contraste, "PREFIJO", contraste.PREFIJO_ANTERIOR),
                    patch.object(
                        ficha,
                        "contrastar",
                        side_effect=lambda *a, **kw: leer_historica(*a, **kw, historica=True),
                    ),
                ):
                    diagnostico, antigua = contraste.observar(original, cap, TITULO, EDICION)
                self.assertEqual(diagnostico, "ficha_individual_" + anterior.replace("-", "_"))
                self.assertNotEqual(antigua["id"], nueva["id"])
                self.assertEqual(antigua["terminado_el"], nueva["terminado_el"])
                for observaciones in ([antigua, nueva], [nueva, antigua]):
                    with self.subTest(marca=marca, primera=observaciones[0]["id"]):
                        resultado = vigencia.evaluar_vigencia(
                            oferta, observaciones, politica(), ahora="2026-11-18T14:00:00Z"
                        )
                        self.assertEqual(resultado["estado"], "sin-confirmar")
                        self.assertEqual(resultado["motivos"], ["fichas_simultaneas_discrepantes"])
                        self.assertCountEqual(resultado["trazabilidad"]["observaciones"], [antigua["id"], nueva["id"]])

    def test_la_ruta_normal_consume_la_falta_de_plazas_con_su_fecha(self) -> None:
        """La observación conserva selector, captura y fecha; frente a la API decide la captura posterior."""
        with tempfile.TemporaryDirectory() as tmp:
            original = Path(tmp).resolve()
            api = json.dumps({"numActivities": 1, "start": 0, "end": 15, "activities": [actividad()]}).encode()

            def evaluar(fin_api: str, fin_ficha: str) -> tuple[str, dict]:
                cap_api = capturas._captura(
                    original, adquisicion.url_pagina(0), api, tipo="application/json", fin=fin_api
                )
                oferta, obs_api = observaciones_actuales.construir(original, cap_api, actividad_id="123", edicion_id=ID)
                cap = capturas._captura(
                    original, ficha.url(ID), _pagina(_bloque(SIN_PLAZAS)), id=EDICION["id"], fin=fin_ficha
                )
                diagnostico, obs = contraste.observar(original, cap, TITULO, EDICION)
                self.assertEqual(diagnostico, "ficha_individual_sin_plazas")
                self.assertEqual(obs["detalle"]["datos_edicion"]["estado_inscripcion"], "sin-plazas")
                self.assertEqual(
                    {(e["alcance"], e["localizador"]["valor"], e["capturado_utc"]) for e in obs["evidencias"][1:]},
                    {
                        (alcance, "#edicionesList .item-ediciones.izq.item1 span.no-places", fin_ficha)
                        for alcance in ("diagnostico", "disponibilidad")
                    },
                )
                resultado = vigencia.evaluar_vigencia(
                    oferta=oferta, observaciones=[obs_api, obs], politica=politica(), ahora="2026-10-23T22:00:00Z"
                )
                return resultado["estado"], resultado

            # La ficha posterior a la API disponible prevalece; la API posterior vuelve a mandar.
            estado, resultado = evaluar("2026-10-23T21:00:02Z", "2026-10-23T21:30:00Z")
            self.assertEqual(estado, "no-disponible-publicamente")
            self.assertEqual(resultado["comprobado_el"], "2026-10-23T21:30:00Z")
            estado, resultado = evaluar("2026-10-23T21:40:00Z", "2026-10-23T21:30:00Z")
            self.assertEqual(estado, "disponible-publicamente")
            self.assertEqual(resultado["comprobado_el"], "2026-10-23T21:40:00Z")

    def test_censo_limita_y_espacia_las_fichas_por_antiguedad(self) -> None:
        """La rotación respeta su cuota, las fechas y las ediciones ya vistas en la API."""

        def edicion(n: str) -> dict:
            return {"datos": {**EDICION["datos"], "activity_id": n}}

        ediciones = {"cibernarium-edicion:" + n: edicion(n) for n in ("1", "2", "3", "4")}
        anteriores = {"2": {"id": "anterior"}}
        with (
            patch.object(contraste.negocio_actual, "leer", return_value=({}, ediciones)),
            patch.object(contraste, "MAX_POR_CONSULTA", 1),
            patch.object(contraste.comun, "leer_recibo", return_value={"fin_utc": "2026-11-17T10:00:00Z"}),
            patch.object(contraste.comun, "recibir_url", return_value={"id": "nueva"}) as recibir,
        ):
            res = contraste.recibir(Path(), Path("base"), {"cibernarium-edicion:1"}, "2026-11-18T10:00:00Z", anteriores)
            self.assertEqual(set(res), {"2", "3"})
            self.assertEqual(recibir.call_args.args[0], ficha.url("3"))
            recibir.reset_mock()
            self.assertEqual(contraste.recibir(Path(), Path("base"), set(), "2026-12-01T10:00:00Z", anteriores), {})
            recibir.assert_not_called()

    def test_el_presupuesto_pospone_sin_fabricar_recepciones(self) -> None:
        """Se conserva lo leído y la fecha de lo aplazado, incluso si una consulta intentada falló."""
        reloj = [0.0]
        ediciones = {
            "cibernarium-edicion:" + n: {"datos": {**EDICION["datos"], "activity_id": n}} for n in ("1", "2", "3", "4")
        }
        previa = {"id": "anterior", "fin_utc": "2026-11-17T10:00:00Z"}
        fallida = {"id": "cibernarium-edicion:2", "error": "TimeoutError"}
        llamadas = []

        def recibir(_url: str, _original: Path, id: str, **opciones: object) -> dict:
            self.assertIs(opciones["seguir_redirecciones"], False)
            llamadas.append((id, opciones["segundos"]))
            reloj[0] += 7
            return fallida if id.endswith(":2") else {"id": id}

        with (
            patch.object(contraste.negocio_actual, "leer", return_value=({}, ediciones)),
            patch.object(contraste.comun, "leer_recibo", return_value=previa),
            patch.object(contraste.time, "monotonic", side_effect=lambda: reloj[0]),
            patch.object(contraste.comun, "recibir_url", side_effect=recibir),
        ):
            res = contraste.recibir(Path(), Path(), set(), "2026-11-18T10:00:00Z", {"4": previa}, hasta=15)
        self.assertEqual(llamadas, [("cibernarium-edicion:1", 15), ("cibernarium-edicion:2", 8)])
        self.assertEqual(res, {"1": {"id": "cibernarium-edicion:1"}, "2": fallida, "4": previa})
