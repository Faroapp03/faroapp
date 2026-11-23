"""El idioma de una edición se lee solo en su propio bloque comprobado."""

import hashlib
import json
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace

from plataforma_datos.cursos import recibos_compartidos
from plataforma_datos.cursos.fuentes.barcelonactiva import adquisicion
from plataforma_datos.cursos.fuentes.barcelonactiva.idiomas_edicion import (
    aplicar_a_colecciones,
    horario_de_sesiones,
    idiomas_por_edicion,
)
from plataforma_datos.cursos.pruebas.test_cibernarium_matricula_actual import actividad

DIA = "dilluns 23 de novembre, 15:30h - 19:30h"
SEGUNDO = "dimarts 24 de novembre, 15:30h - 19:30h"
SESION = {"inicio": "2026-11-23T15:30:00+01:00", "fin": "2026-11-23T19:30:00+01:00"}
SIGUIENTE = {"inicio": "2026-11-24T15:30:00+01:00", "fin": "2026-11-24T19:30:00+01:00"}
AVISO = "Obertura de la inscripció 04/11/2026 a les 08:30h."
URL_FICHA = "https://cibernarium.barcelonactiva.cat/ca/formacio?activityId=101"


def _bloque(ident: int, idioma: str, clase: int) -> str:
    accion = "javascript:_com_davinci_ba_ciber_activity_record_"
    accion += f"CibernariumActivityRecordPortlet_INSTANCE_x_setRedirect(101,{ident});"
    return (
        f'<div class="item-ediciones izq item{clase}">'
        f'<div class="idioma language"><b>Idioma:</b> {idioma}</div>'
        f'<a class="botonRosaDerecha" onclick="{accion}">Inscriure</a></div>'
    )


def _ficha(contenido: str) -> bytes:
    return (
        """<html><head><meta property="og:url" content="https://cibernarium.barcelonactiva.cat/ca/formacio?activityId=101">
      <meta property="og:title" content="Curso de ejemplo - Cibernarium"></head><body><div id="edicionesList">"""
        + contenido
        + "</div></body></html>"
    ).encode()


def _sesiones(rotulo: str, dias: list[str], extra: str = "", clase: int = 1) -> str:
    lista = "".join(f'<li class="activity-session-date">{dia}</li>' for dia in dias)
    return (
        f'<div class="item-ediciones izq item{clase}"><div class="dates">{rotulo}</div>{lista}'
        f'<div class="idioma language">Idioma: Català</div>{extra}</div>'
    )


def _leer(bloques: str, calendarios: dict) -> dict:
    return idiomas_por_edicion(_ficha(bloques), actividad_id="101", titulo="Curso de ejemplo", calendarios=calendarios)


def _captura(raiz: Path, url: str, contenido: bytes, indice: dict) -> dict:
    sha = hashlib.sha256(contenido).hexdigest()
    ruta = raiz / sha
    ruta.write_bytes(contenido)
    indice[sha] = SimpleNamespace(ruta=ruta)
    return {"url": url, "sha256": sha}


def _api(ident: str, aviso: str = AVISO) -> bytes:
    a = actividad()
    a.update(activityId="101", title="Curso de ejemplo")
    e = a["listEditions"][0]
    e.update(activityId=ident, registrationCode="DISP52", registrationDesc=aviso)
    e["listSessions"][0].update(
        beginDateTime="Mon Nov 23 15:30:00 CET 2026", endDateTime="Mon Nov 23 19:30:00 CET 2026"
    )
    return json.dumps({"numActivities": 1, "start": 0, "end": 15, "activities": [a]}).encode()


def _colecciones(refs: list) -> dict:
    programa = {"id": "cibernarium:101", "proveedor_id": "cibernarium", "titulo": "Curso de ejemplo"}
    edicion = {
        "id": "cibernarium-edicion:201",
        "programa_id": programa["id"],
        "referencias": refs,
        "hechos": {
            "idiomas_declarados": {"valor": None, "motivo": "sin_soporte_de_campo", "alcance": "edicion"},
            "calendario_formacion": {
                "valor": {"tipo": "sesiones", "sesiones": [SESION]},
                "motivo": "conocido",
                "alcance": "edicion",
            },
        },
    }
    return {"unidades": [programa], "ediciones": [edicion]}


def _boton(ident: str) -> str:
    return (
        '<a class="botonRosaDerecha" onclick="javascript:_com_davinci_ba_ciber_activity_record_'
        f'CibernariumActivityRecordPortlet_INSTANCE_x_setRedirect(101,{ident});">Inscriure</a>'
    )


def _serie() -> tuple[dict, str]:
    filas = [
        ("200", "Sun Nov 22", "diumenge 22 de novembre", "DISP0"),
        ("201", "Mon Nov 23", "dilluns 23 de novembre", "DISP3"),
        ("202", "Tue Nov 24", "dimarts 24 de novembre", "DISP0"),
    ]
    doc = json.loads(_api("201"))
    actividad_api = doc["activities"][0]
    plantilla = actividad_api["listEditions"][0]
    actividad_api["listEditions"] = []
    bloques = ""
    for num, (ident, fecha, dia, estado) in enumerate(filas, 1):
        edicion = deepcopy(plantilla)
        edicion.update(activityId=ident, registrationCode=estado)
        edicion["listSessions"][0].update(
            beginDateTime=fecha + " 15:30:00 CET 2026", endDateTime=fecha + " 19:30:00 CET 2026"
        )
        actividad_api["listEditions"].append(edicion)
        señal = _boton(ident) if estado == "DISP0" else '<span class="no-places">Sense places</span>'
        bloque = _sesiones("Data: " + dia + ", 15:30h - 19:30h", [], señal, num)
        bloques += bloque.replace("Idioma: Català", "Idioma: Castellà") if ident == "201" else bloque
    return doc, bloques


def _archivar_ficha(raiz: Path, indice: dict, cuerpo: bytes, url: str = URL_FICHA) -> tuple[str, dict]:
    fin = "2026-11-01T08:05:00Z"
    cuerpo_ref = _captura(raiz, url, cuerpo, indice)
    estable, evento = recibos_compartidos.separar(
        recibos_compartidos.canonico(
            {
                "url": "https://cibernarium.barcelonactiva.cat/ficha-actividad?activityId=101",
                "url_final": url,
                "http": 200,
                "content_type": "text/html;charset=UTF-8",
                "completo": True,
                "error": None,
                "bytes": len(cuerpo),
                "cuerpo_sha256": cuerpo_ref["sha256"],
                "inicio_utc": "2026-11-01T08:04:59Z",
                "fin_utc": fin,
            }
        ),
        campos_evento=frozenset({"inicio_utc", "fin_utc"}),
    )
    _captura(raiz, url, estable, indice)
    ref_evento = _captura(raiz, url, evento, indice)
    return ref_evento["sha256"], {**cuerpo_ref, "fecha_referencia": fin}


def _agenda_en_coleccion(
    raiz: Path, doc: dict, bloques: str, *, fecha: str = "2026-11-01T08:00:00Z", destino: str = URL_FICHA
) -> tuple[dict, dict, str, dict]:
    indice = {}
    api = _captura(raiz, adquisicion.url_pagina(0), json.dumps(doc).encode(), indice)
    evento, ficha = _archivar_ficha(raiz, indice, _ficha(bloques), url=destino)
    filas = _colecciones([{**api, "fecha_referencia": fecha}])
    # El identificador estable se acuñó antes que la cabecera de la captura conservada.
    filas["unidades"][0]["id"] = filas["ediciones"][0]["programa_id"] = "cibernarium:102"
    return filas, indice, evento, ficha


class IdiomasEdicion(unittest.TestCase):
    """Prueba vínculo exclusivo por edición."""

    def test_idiomas_diferentes_no_se_trasladan(self) -> None:
        """Dos idiomas y dos IDs no se mezclan."""
        datos = idiomas_por_edicion(
            _ficha(_bloque(201, "Català", 1) + _bloque(202, "Castellà", 2)),
            actividad_id="101",
            titulo="Curso de ejemplo",
        )
        self.assertEqual(datos["201"][0], "català")
        self.assertEqual(datos["202"][0], "castellà")
        self.assertEqual(
            idiomas_por_edicion(_ficha(_bloque(201, "Català", 1)), actividad_id="101", titulo="Otro curso"), {}
        )

    def test_identidad_ambigua_no_se_admite(self) -> None:
        """Un ID repetido no produce hecho."""
        datos = idiomas_por_edicion(
            _ficha(_bloque(201, "Català", 1) + _bloque(201, "Castellà", 2)),
            actividad_id="101",
            titulo="Curso de ejemplo",
        )
        self.assertNotIn("201", datos)

    def test_sin_boton_contrasta_todas_las_sesiones_por_ano_y_hora(self) -> None:
        """Dos sesiones completas identifican la edición; cambiar el año, una hora o una sesión la invalida."""
        calendario = {"201": horario_de_sesiones([SESION, SIGUIENTE])}
        rotulo = "Dates: Del 23/11/2026 al 24/11/2026"
        bloque = _sesiones(rotulo, [DIA, SEGUNDO])
        self.assertEqual(
            _leer(bloque, calendario)["201"], ("català", "#edicionesList .item-ediciones.izq.item1 .idioma.language")
        )
        for distinto in (
            bloque.replace("2026", "2027"),
            bloque.replace("19:30h", "19:45h"),
            _sesiones(rotulo, [DIA]),
            bloque.replace("Català", "Idioma desconocido"),
            bloque + _sesiones(rotulo, [DIA, SEGUNDO], clase=2),
        ):
            with self.subTest(distinto=distinto):
                self.assertEqual(_leer(distinto, calendario), {})
        self.assertEqual(horario_de_sesiones([SESION, {"inicio": SIGUIENTE["inicio"]}]), [])
        self.assertEqual(_leer(bloque, {**calendario, "202": calendario["201"]}), {})

    def test_boton_contradictorio_y_metas_ajenas_no_se_atribuyen(self) -> None:
        """El horario coincide, pero la acción asigna otro ID o la página identifica otro programa."""
        calendario = {"201": horario_de_sesiones([SESION, SIGUIENTE])}
        boton = (
            '<a class="botonRosaDerecha" onclick="javascript:_com_davinci_ba_ciber_activity_record_'
            'CibernariumActivityRecordPortlet_INSTANCE_x_setRedirect(101,202);">Inscripció</a>'
        )
        bloque = _sesiones("Dates: Del 23/11/2026 al 24/11/2026", [DIA, SEGUNDO])
        self.assertEqual(_leer(bloque.replace("Idioma: Català</div>", "Idioma: Català</div>" + boton), calendario), {})
        otras = _ficha(bloque).replace(b"activityId=101", b"activityId=202")
        self.assertEqual(
            idiomas_por_edicion(otras, actividad_id="101", titulo="Curso de ejemplo", calendarios=calendario), {}
        )

    def test_un_dia_sin_ano_necesita_dos_capturas_con_la_misma_apertura_e_identidad(self) -> None:
        """Acredita el castellano o catalán de la edición sin adivinar el año por fecha del recibo."""
        html = _ficha(_sesiones("Data: " + DIA, [], f'<span class="next-edition code-DISP52">{AVISO}</span>'))
        with tempfile.TemporaryDirectory() as temporal:
            base, indice = Path(temporal), {}
            propia = _captura(base, URL_FICHA, html, indice)
            url_api = adquisicion.url_pagina(0)
            correcta = _captura(base, url_api, _api("201"), indice)
            mal_id = _captura(base, url_api, _api("202"), indice)
            mal_ano = _captura(base, url_api, _api("201", AVISO.replace("2026", "2024")), indice)
            mal_horario = _captura(base, url_api, _api("201").replace(b"19:30:00", b"18:30:00"), indice)
            for refs in (
                [propia],
                [correcta],
                [propia, mal_id],
                [propia, mal_ano],
                [propia, mal_horario],
                [propia, {**correcta, "url": "https://example.org"}],
            ):
                with self.subTest(refs=refs):
                    self.assertEqual(aplicar_a_colecciones(_colecciones(refs), indice), 0)
            filas = _colecciones([propia, correcta])
            self.assertEqual(aplicar_a_colecciones(filas, indice), 1)
            self.assertEqual(filas["ediciones"][0]["hechos"]["idiomas_declarados"]["valor"], ["ca"])
            antes = deepcopy(filas)
            self.assertEqual(aplicar_a_colecciones(filas, indice), 0)
            self.assertEqual(filas, antes)

    def test_agenda_completa_entre_dos_botones_recupera_su_idioma_y_la_procedencia(self) -> None:
        """Reproduce la edición que cambió de cabecera y que carece de año y botón en su propio bloque."""
        doc, bloques = _serie()
        with tempfile.TemporaryDirectory() as temporal:
            filas, indice, evento, ficha = _agenda_en_coleccion(Path(temporal), doc, bloques)
            sin_recibo = dict(indice)
            sin_recibo.pop(evento)
            self.assertEqual(aplicar_a_colecciones(filas, sin_recibo), 0)
            ruta = indice[ficha["sha256"]].ruta
            original = ruta.read_bytes()
            ruta.write_bytes(original + b" ")
            self.assertEqual(aplicar_a_colecciones(filas, indice), 0)
            ruta.write_bytes(original)
            self.assertEqual(aplicar_a_colecciones(filas, indice), 1)
            edicion = filas["ediciones"][0]
            self.assertEqual(edicion["hechos"]["idiomas_declarados"]["valor"], ["es"])
            self.assertTrue(any(ficha.items() <= ref.items() for ref in edicion["referencias"]))
            resuelto = deepcopy(filas)
            self.assertEqual(aplicar_a_colecciones(filas, indice), 0)
            self.assertEqual(resuelto, filas)

    def test_agenda_rechaza_posiciones_horarios_recibos_y_anclas_que_no_coinciden(self) -> None:
        """Una misma fecha aparente o título no basta para atribuir el idioma de una edición."""
        doc, bloques = _serie()
        invertida = deepcopy(doc)
        ediciones = invertida["activities"][0]["listEditions"]
        ediciones[0], ediciones[1] = ediciones[1], ediciones[0]
        incompleta = deepcopy(doc)
        incompleta["activities"][0]["listEditions"].pop()
        mismo_horario = deepcopy(doc)
        ediciones = mismo_horario["activities"][0]["listEditions"]
        ediciones[0]["listSessions"] = deepcopy(ediciones[1]["listSessions"])
        for pagina, html in (
            (invertida, bloques),
            (incompleta, bloques),
            (mismo_horario, bloques),
            (doc, bloques.replace("item2", "item7")),
            (doc, bloques.replace(_boton("200"), "")),
            (doc, bloques.replace(_boton("202"), _boton("204"))),
            (doc, bloques.replace("dilluns 23", "dilluns 30")),
            (doc, bloques.replace("Sense places", "Places disponibles")),
        ):
            with self.subTest(pagina=pagina, html=html), tempfile.TemporaryDirectory() as temporal:
                filas, indice, _, _ = _agenda_en_coleccion(Path(temporal), pagina, html)
                self.assertEqual(aplicar_a_colecciones(filas, indice), 0)
        for parametros in (
            {"fecha": "2026-10-22T08:00:00Z"},
            {"destino": "https://example.org/ca/formacio?activityId=101"},
        ):
            with self.subTest(parametros=parametros), tempfile.TemporaryDirectory() as temporal:
                filas, indice, _, _ = _agenda_en_coleccion(Path(temporal), doc, bloques, **parametros)
                self.assertEqual(aplicar_a_colecciones(filas, indice), 0)

    def test_boton_con_id_del_curso_bajo_su_cabecera_anterior(self) -> None:
        """Una ficha histórica con botón identifica su edición al cotejar título, fechas y lista de la misma captura."""
        doc, bloques = _serie()
        bloque = bloques.replace('<span class="no-places">Sense places</span>', _boton("201"))
        with tempfile.TemporaryDirectory() as temporal:
            filas, indice, _, ficha = _agenda_en_coleccion(Path(temporal), doc, bloque)
            filas["unidades"][0]["titulo"] = "Otro título"
            self.assertEqual(aplicar_a_colecciones(filas, indice), 0)
            filas["unidades"][0]["titulo"] = "Curso de ejemplo"
            self.assertEqual(aplicar_a_colecciones(filas, indice), 1)
            self.assertTrue(any(ficha.items() <= ref.items() for ref in filas["ediciones"][0]["referencias"]))

    def test_variante_oficial_sin_prefijo_y_enlace_de_otra_ficha(self) -> None:
        """Solo el destino acreditado coincide con la URL de documento de esa edición."""
        doc, bloques = _serie()
        sin_prefijo = URL_FICHA.replace("/ca/formacio", "/formacio")
        with tempfile.TemporaryDirectory() as temporal:
            path = Path(temporal)
            filas, indice, _, _ = _agenda_en_coleccion(path, doc, bloques, destino=sin_prefijo)
            self.assertEqual(aplicar_a_colecciones(filas, indice), 0)
            html = _ficha(bloques).replace(URL_FICHA.encode(), sin_prefijo.encode())
            _, ficha = _archivar_ficha(path, indice, html, url=sin_prefijo)
            self.assertEqual(aplicar_a_colecciones(filas, indice), 1)
            self.assertEqual(filas["ediciones"][0]["hechos"]["idiomas_declarados"]["valor"], ["es"])
            self.assertTrue(any(ficha.items() <= ref.items() for ref in filas["ediciones"][0]["referencias"]))

    def test_dos_variantes_con_idioma_contradictorio_revierten_el_enriquecimiento(self) -> None:
        """La ficha ya vinculada tampoco gana contra una segunda declaración comprobada de otro idioma."""
        doc, bloques = _serie()
        bloques = bloques.replace('<span class="no-places">Sense places</span>', _boton("201"))
        sin_prefijo = URL_FICHA.replace("/ca/formacio", "/formacio")
        with tempfile.TemporaryDirectory() as temporal:
            path = Path(temporal)
            filas, indice, _, ficha = _agenda_en_coleccion(path, doc, bloques)
            filas["unidades"][0]["id"] = filas["ediciones"][0]["programa_id"] = "cibernarium:101"
            filas["ediciones"][0]["referencias"].append(ficha)
            html = _ficha(bloques.replace("Castellà", "Català")).replace(URL_FICHA.encode(), sin_prefijo.encode())
            _archivar_ficha(path, indice, html, url=sin_prefijo)
            anterior = deepcopy(filas)
            self.assertEqual(aplicar_a_colecciones(filas, indice), 0)
            self.assertEqual(filas, anterior)

    def test_ficha_propia_mismo_dia_exige_ano_y_todas_las_sesiones_de_la_edicion(self) -> None:
        """Cada fuente nombra la misma edición y sus dos sesiones, aunque se haya recibido a otra hora."""
        rotulo = "Dates: Del 23/11/2026 al 24/11/2026"
        for ident, bloque, hora, esperado in (
            ("101", _sesiones(rotulo, [DIA, SEGUNDO]), "2026-11-01T10:10:00Z", 1),
            ("101", _sesiones(rotulo, [DIA]), "2026-11-01T10:10:00Z", 0),
            ("101", _sesiones("Dates: Del 23/11 al 24/11", [DIA, SEGUNDO]), "2026-11-01T10:10:00Z", 0),
            ("101", _sesiones(rotulo, [DIA, SEGUNDO]), "2026-11-02T10:10:00Z", 0),
            ("201", _sesiones(rotulo, [DIA, SEGUNDO]), "2026-11-01T10:10:00Z", 0),
        ):
            with self.subTest(ident=ident, bloque=bloque, hora=hora), tempfile.TemporaryDirectory() as t:
                doc = json.loads(_api(ident))
                ed = doc["activities"][0]["listEditions"][0]
                sesion = deepcopy(ed["listSessions"][0])
                sesion.update(beginDateTime="Tue Nov 24 15:30:00 CET 2026", endDateTime="Tue Nov 24 19:30:00 CET 2026")
                ed["listSessions"].append(sesion)
                filas, indice, _, _ = _agenda_en_coleccion(Path(t), doc, bloque, fecha=hora)
                actual = filas["ediciones"][0]
                actual["id"] = "cibernarium-edicion:" + ident
                actual["hechos"]["calendario_formacion"]["valor"]["sesiones"].append(SIGUIENTE)
                self.assertEqual(aplicar_a_colecciones(filas, indice), esperado)


if __name__ == "__main__":
    unittest.main()
