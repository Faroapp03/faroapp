"""Pruebas de la ficha de cada edición ausente y del significado de un fallo de transporte."""

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from plataforma_datos.cursos import vigencia
from plataforma_datos.cursos.fuentes.barcelonactiva import contraste_ediciones as contraste
from plataforma_datos.cursos.fuentes.barcelonactiva import ficha_edicion as ficha
from plataforma_datos.cursos.pruebas import test_cibernarium_adquisicion as capturas
from plataforma_datos.cursos.pruebas.test_cibernarium_matricula_actual import politica

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


def _bloque(marca: str = MARCA, primera: str = "17") -> str:
    return f"""<div class="item-ediciones izq item1">
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
