"""Cibernàrium sin red: las formaciones de IA salen del censo diario del ámbito de IA, cruzado con el censo admitido.

Las páginas son simuladas y se conservan con cuerpo y recibo reales; la lectura y la composición con la salida
anterior son las de producción.
"""

import hashlib
import io
import tempfile
import unittest
from contextlib import ExitStack, redirect_stdout
from pathlib import Path
from typing import Any
from unittest.mock import patch

import plataforma_datos.cursos.fuentes.barcelonactiva.lector as barcelonactiva
from plataforma_datos.comun.entrada_salida import guardar_json, leer_json
from plataforma_datos.comun.nucleo import FormatoInesperado
from plataforma_datos.cursos import almacen_catalogo, recibos_compartidos
from plataforma_datos.cursos.adquisicion_por_fuente import ADQUIRIENTES
from plataforma_datos.cursos.fuentes.barcelonactiva import adquisicion, ambitos, censo_ia, edicion_ia
from plataforma_datos.cursos.fuentes.barcelonactiva import lectura as lectura_cibernarium
from plataforma_datos.cursos.fuentes.barcelonactiva import robot_cibernarium as robot
from plataforma_datos.cursos.recepciones_catalogo import json_bytes

PAGINA = 15
# Recorte fiel de la página de filtros real (https://cibernarium.barcelonactiva.cat/ca/web/guest/formacions, capturada
# el 15/11/2026; sha256 de la página completa
# f39d860159cb8ab57311e6e1c4486a14931aff46e980c3eb6f528cb6d6dde92a): el bloque del ámbito 22 y el subámbito 22, que es
# otro.
RECORTE_FILTROS = (
    '<div class="scopeParent" idscope="22"><!-- NUEVO: AÃ±adido el span para usar el puntero como toggle --> '
    '<span class="trigger-toggle"></span> <a id="_cAct_INSTANCE_uhcx_a_scope_22" class="facet-value scope-search" '
    "href=\"javascript:_cAct_INSTANCE_uhcx_searchScope(22, 'Intel·ligència Artificial (IA)')\">"
    "Intel·ligència Artificial (IA)</a>\n"
    '<li idsubcode="22" id="_cAct_INSTANCE_uhcx_li_subscope_22" class="facet-value arrowPinkLeft dirRight '
    'subscope-list-search"><a id="_cAct_INSTANCE_uhcx_a_subscope_22" '
    'href="javascript:_cAct_INSTANCE_uhcx_searchSubscope(22,\'Disseny gràfic i maquetació\')" data-value="22">'
    "Disseny gràfic i maquetació</a></li>"
)


def conservar(carpeta: Path, url: str, dato: object, http: int, fin: str) -> dict[str, Any]:
    """Conserva una página simulada como lo hace `recibir_url`: cuerpo, metadatos y recibo con sus huellas.

    Returns:
        La captura con sus referencias.
    """
    carpeta.mkdir(parents=True, exist_ok=True)
    cuerpo = dato if isinstance(dato, bytes) else json_bytes(dato)
    sha = hashlib.sha256(cuerpo).hexdigest()
    (carpeta / (sha + ".body")).write_bytes(cuerpo)
    meta = {
        "url": url,
        "url_final": url,
        "http": http,
        "completo": True,
        "content_type": "text/html; charset=UTF-8" if isinstance(dato, bytes) else "application/json",
        "inicio_utc": fin.replace(":01Z", ":00Z"),
        "fin_utc": fin,
        "bytes": len(cuerpo),
        "cuerpo_sha256": sha,
    }
    estable, evento = recibos_compartidos.separar(json_bytes(meta), campos_evento=frozenset({"inicio_utc", "fin_utc"}))
    refs = {}
    for clave, contenido in (("metadatos", estable), ("recibo", evento)):
        huella = hashlib.sha256(contenido).hexdigest()
        (carpeta / (huella + ".json")).write_bytes(contenido)
        refs[clave] = {"archivo": huella + ".json", "sha256": huella}
    return {"id": None, "cuerpo": {"archivo": sha + ".body", "sha256": sha}, **refs, "intento": refs["recibo"]}


def fila(identificador: str, fin: str = "Thu Nov 26 12:00:00 CET 2026") -> dict[str, Any]:
    """Una actividad como la publica la API.

    Returns:
        La actividad.
    """
    return {
        "activityId": identificador,
        "title": f"Intel·ligència artificial {identificador}",
        "beginDateTime": "Thu Oct 08 10:00:00 CEST 2026",
        "endDateTime": fin,
        "formationType": "ONLINE",
    }


def paginas(actividades: list[dict[str, Any]], total: int | None = None) -> dict[int, dict[str, Any]]:
    """Las páginas de la consulta con esas actividades y ese total publicado.

    Returns:
        Cada página por su desplazamiento.
    """
    total = len(actividades) if total is None else total
    return {
        desde: {
            "numActivities": total,
            "start": desde,
            "end": min(desde + PAGINA, total),
            "activities": actividades[desde : desde + PAGINA],
        }
        for desde in range(0, total, PAGINA)
    }


def previa(*actividades: dict[str, Any]) -> dict[str, Any]:
    """La salida admitida anterior con esas actividades.

    Returns:
        Conjunto y evidencias como los lee `anterior`.
    """
    return {
        "conjunto": {"consulta": "2026-11-01", "cibernarium": list(actividades)},
        "evidencias": [{"url": "anterior"}],
        "vistas": {},
    }


class CensoIaPruebas(unittest.TestCase):
    """Un ciclo es: páginas del ámbito de IA en cibernarium-ia/, lectura y composición con el censo admitido."""

    def setUp(self) -> None:
        """Casa Barcelona Activa temporal y una API simulada."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.casa = Path(temporal.name) / "barcelonactiva"
        self.api: dict[str, tuple[int, object]] = {}
        self.pedidas: list[str] = []
        self.fin = "2026-11-14T10:00:01Z"
        self.filtros = RECORTE_FILTROS

    def recibir(self, url: str, carpeta: Path) -> dict[str, Any]:
        """La API simulada: lo que no está declarado responde 503.

        Returns:
            La captura conservada.
        """
        self.pedidas.append(url)
        http, dato = self.api.get(url, (503, {}))
        return conservar(carpeta, url, dato, http, self.fin)

    def leer(self, publicadas: dict[int, dict[str, Any]], caidas: tuple[int, ...] = ()) -> dict[str, Any]:
        """Descarga y lee el censo de IA con esas páginas; las caídas responden 503.

        Returns:
            La lectura del censo.
        """
        self.api = {censo_ia.url_pagina(d): (200, p) for d, p in publicadas.items() if d not in caidas}
        self.api[ambitos.FILTROS] = (200, self.filtros.encode())
        censo_ia.descargar(self.casa, self.recibir)
        return censo_ia.leer(self.casa, leer_json(self.casa / censo_ia.CARPETA / "procedencia.json"))

    @staticmethod
    def censo(*ids: str, completo: bool = True) -> dict[str, Any]:
        """El censo admitido del canal cibernarium/ con esas actividades.

        Returns:
            Lo que interesa del conjunto admitido.
        """
        return {"censo_completo": completo, "censo": {"actividades": ["cibernarium:" + i for i in ids]}}

    def test_la_consulta_es_la_del_ambito_de_ia_del_proveedor(self) -> None:
        """Las páginas piden el censo del canal con `scopeIds=22`; sin primera página no se pide ninguna más."""
        self.assertEqual(censo_ia.url_pagina(15), adquisicion.url_pagina(15) + "&_cAct_INSTANCE_uhcx_scopeIds=22")
        lectura = self.leer(paginas([fila(str(n)) for n in range(1, 21)]), caidas=(0,))
        self.assertEqual(self.pedidas, [ambitos.FILTROS, censo_ia.url_pagina(0)])
        self.assertFalse(lectura["completo"])

    def test_una_actividad_nueva_aparece(self) -> None:
        """Con los dos censos completos entra la actividad nueva del ámbito, con la evidencia de sus páginas."""
        lectura = self.leer(paginas([fila("1"), fila("2")]))
        compuesta = barcelonactiva.componer_cibernarium(lectura, self.censo("1", "2", "3"), previa())
        self.assertEqual([a["id"] for a in compuesta["cibernarium"]], ["1", "2"])
        self.assertEqual(compuesta["consulta"], "2026-11-14")
        self.assertEqual(compuesta["evidencias"][0]["url"], censo_ia.url_pagina(0))
        self.assertTrue(compuesta["evidencias"][0]["recibo"]["sha256"])
        self.assertNotIn("consulta_parcial", compuesta)

    def test_solo_entra_lo_que_tambien_publica_el_censo_admitido(self) -> None:
        """Una actividad del ámbito que el censo completo admitido no trae no se publica."""
        lectura = self.leer(paginas([fila("1"), fila("2")]))
        compuesta = barcelonactiva.componer_cibernarium(lectura, self.censo("1"), None)
        self.assertEqual([a["id"] for a in compuesta["cibernarium"]], ["1"])

    def test_un_censo_parcial_no_sustituye_la_salida(self) -> None:
        """Una página de IA caída, o un censo del canal parcial, dejan la salida anterior y dicen por qué."""
        anterior = previa(barcelonactiva.actividad(fila("9")))
        lectura = self.leer(paginas([fila(str(n)) for n in range(1, 17)]), caidas=(15,))
        self.assertFalse(lectura["completo"])
        compuesta = barcelonactiva.componer_cibernarium(lectura, self.censo(*map(str, range(1, 17))), anterior)
        self.assertEqual(compuesta["cibernarium"], anterior["conjunto"]["cibernarium"])
        self.assertEqual(compuesta["consulta"], "2026-11-01")
        self.assertEqual(compuesta["consulta_parcial"]["motivo"], "censo-ia-parcial")
        self.assertEqual(compuesta["consulta_parcial"]["paginas_caidas"][0]["http"], 503)
        completa = self.leer(paginas([fila("1")]))
        compuesta = barcelonactiva.componer_cibernarium(completa, self.censo("1", completo=False), anterior)
        self.assertEqual(compuesta["cibernarium"], anterior["conjunto"]["cibernarium"])
        self.assertEqual(compuesta["consulta_parcial"]["motivo"], "censo-del-canal-sin-admitir-completo")
        with self.assertRaisesRegex(FormatoInesperado, "sin salida anterior"):
            barcelonactiva.componer_cibernarium(lectura, self.censo("1"), None)

    def test_una_ausencia_en_un_censo_completo_sigue_la_politica_v3(self) -> None:
        """La que falta se conserva mientras dura su calendario; con el calendario acabado se retira por él."""
        vigente = barcelonactiva.actividad(fila("7"))
        acabada = barcelonactiva.actividad(fila("8", fin="Thu Oct 15 12:00:00 CEST 2026"))
        lectura = self.leer(paginas([fila("1")]))
        compuesta = barcelonactiva.componer_cibernarium(lectura, self.censo("1"), previa(vigente, acabada))
        self.assertEqual([a["id"] for a in compuesta["cibernarium"]], ["1", "7"])
        self.assertEqual(compuesta["conservadas"], ["7"])
        self.assertEqual(compuesta["retiradas"], [{"id": "8", "motivo": "calendario-acabado"}])

    def test_una_ausencia_en_un_censo_parcial_no_retira_nada(self) -> None:
        """Con una página caída, ni la acabada ni la vigente se retiran: la salida es la anterior entera."""
        vigente = barcelonactiva.actividad(fila("7"))
        acabada = barcelonactiva.actividad(fila("8", fin="Thu Oct 15 12:00:00 CEST 2026"))
        lectura = self.leer(paginas([fila(str(n)) for n in range(1, 17)]), caidas=(15,))
        compuesta = barcelonactiva.componer_cibernarium(lectura, self.censo("1"), previa(vigente, acabada))
        self.assertEqual(compuesta["retiradas"], [])
        self.assertEqual([a["id"] for a in compuesta["cibernarium"]], ["7", "8"])

    def test_la_salida_tiene_la_misma_forma(self) -> None:
        """Cada actividad lleva id, título, días y modalidad, sin campos nuevos; la cita da los dos días."""
        lectura = self.leer(paginas([fila("1")]))
        compuesta = barcelonactiva.componer_cibernarium(lectura, self.censo("1"), None)
        self.assertEqual(
            compuesta["cibernarium"],
            [
                {"id": "1", "titulo": "Intel·ligència artificial 1", "inicio": "2026-10-08", "fin": "2026-11-26"}
                | {"modalidad": "en-linea"}
            ],
        )
        self.assertIn("consultat el 07/10/2026", barcelonactiva.cita("2026-11-14", "2026-11-14"))
        self.assertIn("consultades el 14/11/2026.", barcelonactiva.cita("2026-11-14", "2026-11-14"))

    def test_la_cita_no_rejuvenece_lo_conservado(self) -> None:
        """Una conservada vista el 01/11 junto a una vista hoy: cada una guarda su día y la cita da el intervalo."""
        vigente = barcelonactiva.actividad(fila("7"))
        lectura = self.leer(paginas([fila("1")]))
        compuesta = barcelonactiva.componer_cibernarium(lectura, self.censo("1"), previa(vigente))
        self.assertEqual(compuesta["vistas"], {"1": "2026-11-14", "7": "2026-11-01"})
        dias = sorted(compuesta["vistas"].values())
        self.assertIn("consultades entre el 01/11/2026 i el 14/11/2026.", barcelonactiva.cita(dias[0], dias[-1]))
        anterior = previa(vigente)
        anterior["vistas"] = {"7": "2026-10-30"}
        siguiente = barcelonactiva.componer_cibernarium(lectura, self.censo("1"), anterior)
        self.assertEqual(siguiente["vistas"]["7"], "2026-10-30")

    def test_lo_completo_no_se_ofrece_y_lo_cerrado_no_se_publica(self) -> None:
        """La edición propia en DISP3 se publica con «sin-plazas»; con «tancada» la fuente la cierra y no se publica."""
        completa = {**fila("1"), "amagarBoto": False}
        completa["listEditions"] = [
            {"activityId": "1", "registrationCode": "DISP3", "registrationDesc": "Sense places."}
        ]
        cerrada = {**fila("2"), "listEditions": [{"activityId": "2", "tancada": True}]}
        lectura = self.leer(paginas([completa, cerrada]))
        compuesta = barcelonactiva.componer_cibernarium(lectura, self.censo("1", "2"), None)
        self.assertEqual([a["id"] for a in compuesta["cibernarium"]], ["1"])
        edicion = compuesta["cibernarium"][0]["edicion"]
        self.assertEqual(edicion["plazas"], "sin-plazas")
        self.assertEqual(edicion["vinculacion"], "id-edicion-publicado")
        self.assertIsNone(edicion["inscripcion"]["continuaDeclarada"])
        self.assertIsNone(edicion["horas"])
        self.assertTrue(edicion["inscripcion"]["botonVisible"])
        self.assertEqual(edicion["evidencia"]["localizador"], "activities[0].listEditions[0]")
        self.assertEqual(compuesta["retiradas"], [{"id": "2", "motivo": "cerrada-en-la-fuente"}])

    def test_una_ausente_se_retira_con_el_404_o_410_de_su_ficha_y_no_con_un_5xx(self) -> None:
        """De la publicada que falta en un censo completo se pide su ficha: 410 la retira; 503 la conserva."""
        vigente = barcelonactiva.actividad(fila("7"))
        for http, publicada in ((410, False), (404, False), (503, True)):
            self.api.clear()
            self.pedidas.clear()
            self.api.update({censo_ia.url_pagina(0): (200, paginas([fila("1")])[0])})
            self.api[ambitos.FILTROS] = (200, self.filtros.encode())
            self.api[robot.url_ficha("7")] = (http, {})
            censo_ia.descargar(self.casa, self.recibir, publicadas=["1", "7"])
            lectura = censo_ia.leer(self.casa, leer_json(self.casa / censo_ia.CARPETA / "procedencia.json"))
            compuesta = barcelonactiva.componer_cibernarium(lectura, self.censo("1"), previa(vigente))
            with self.subTest(http=http):
                self.assertIn(robot.url_ficha("7"), self.pedidas)
                self.assertNotIn(robot.url_ficha("1"), self.pedidas)
                self.assertEqual("7" in [a["id"] for a in compuesta["cibernarium"]], publicada)
                if not publicada:
                    self.assertEqual(compuesta["retiradas"], [{"id": "7", "motivo": "ficha-404-410"}])

    def test_el_dia_de_la_consulta_es_el_civil_de_barcelona(self) -> None:
        """A las 23:30 UTC del 14/11 ya es 15/11 en Barcelona."""
        self.fin = "2026-11-14T23:30:01Z"
        lectura = self.leer(paginas([fila("1")]))
        compuesta = barcelonactiva.componer_cibernarium(lectura, self.censo("1"), None)
        self.assertEqual(compuesta["consulta"], "2026-11-15")

    def test_la_descarga_diaria_empieza_por_los_filtros_y_el_canal_usa_su_portlet(self) -> None:
        """Primero la página de filtros con el censo de IA; el canal recibe la instancia de portlet que publica."""
        orden: list[str] = []
        raiz = self.casa.parent
        original = self.casa / "cibernarium"
        for descubierto, usado in (("cAct_INSTANCE_nou1", "cAct_INSTANCE_nou1"), (None, "cAct_INSTANCE_uhcx")):
            orden.clear()
            with (
                patch(
                    "plataforma_datos.cursos.adquisicion_por_fuente.time.monotonic",
                    side_effect=lambda: orden.append("inicio") or 42.0,
                ),
                # La adquisición del canal devuelve los problemas de su lectura; aquí ninguno.
                patch.object(
                    adquisicion,
                    "descargar",
                    autospec=True,
                    side_effect=lambda *_args, **_kwargs: (
                        orden.append("canal") or lectura_cibernarium.Resultado(emisiones=(), problemas=())
                    ),
                ) as descargar,
                patch.object(censo_ia, "descargar", lambda casa, d=descubierto: orden.append(casa.name) or d),
            ):
                ADQUIRIENTES["barcelonactiva"]([], original, {}, raiz)
            with self.subTest(descubierto=descubierto):
                self.assertEqual(orden, ["inicio", "barcelonactiva", "canal"])
                descargar.assert_called_once_with(
                    [], original, {}, usado, base=raiz / almacen_catalogo.RUTA / "catalogo.sqlite3", inicio=42.0
                )

    def test_el_ambito_22_se_lee_de_la_pagina_de_filtros_y_no_del_subambito(self) -> None:
        """Con el recorte real el ámbito se llama como siempre; renombrado o ausente, el censo de IA no se consulta."""
        self.assertEqual(ambitos.en_la_pagina(RECORTE_FILTROS), ("cAct_INSTANCE_uhcx", ambitos.NOMBRE_AMBITO_IA))
        anterior = previa(barcelonactiva.actividad(fila("9")))
        casos = {
            "ambito-ia-cambiado": RECORTE_FILTROS.replace("(22, 'Intel·ligència Artificial (IA)')", "(22, 'Robòtica')"),
            "ambito-ia-sin-nombre": RECORTE_FILTROS.replace('idscope="22"', 'idscope="23"'),
            "portlet-no-encontrado": "<html><body>Manteniment</body></html>",
        }
        for motivo, pagina in casos.items():
            self.filtros = pagina
            self.pedidas.clear()
            lectura = self.leer(paginas([fila("1")]))
            compuesta = barcelonactiva.componer_cibernarium(lectura, self.censo("1"), anterior)
            with self.subTest(motivo):
                self.assertEqual(self.pedidas, [ambitos.FILTROS])
                self.assertEqual(compuesta["consulta_parcial"]["motivo"], motivo)
                self.assertEqual(compuesta["cibernarium"], anterior["conjunto"]["cibernarium"])

    def test_una_instancia_de_portlet_nueva_se_usa_y_queda_dicha(self) -> None:
        """Si la página publica otra instancia, las páginas del censo la llevan y la salida lo avisa."""
        self.filtros = RECORTE_FILTROS.replace("cAct_INSTANCE_uhcx", "cAct_INSTANCE_nou1")
        self.api = {censo_ia.url_pagina(0, "cAct_INSTANCE_nou1"): (200, paginas([fila("1")])[0])}
        self.api[ambitos.FILTROS] = (200, self.filtros.encode())
        portlet = censo_ia.descargar(self.casa, self.recibir, publicadas=[])
        self.assertEqual(portlet, "cAct_INSTANCE_nou1")
        lectura = censo_ia.leer(self.casa, leer_json(self.casa / censo_ia.CARPETA / "procedencia.json"))
        compuesta = barcelonactiva.componer_cibernarium(lectura, self.censo("1"), None)
        self.assertEqual([a["id"] for a in compuesta["cibernarium"]], ["1"])
        self.assertEqual(compuesta["avisos"], [{"id": None, "motivo": "portlet-cambiado"}])

    def test_una_actividad_sin_fecha_se_descarta_y_el_resto_sigue(self) -> None:
        """La que no trae fecha no se publica, queda dicha con su motivo y las demás se preparan."""
        sin_fecha = {**fila("2")}
        del sin_fecha["endDateTime"]
        lectura = self.leer(paginas([fila("1"), sin_fecha]))
        compuesta = barcelonactiva.componer_cibernarium(lectura, self.censo("1", "2"), None)
        self.assertEqual([a["id"] for a in compuesta["cibernarium"]], ["1"])
        self.assertEqual(compuesta["descartadas"][0]["id"], "2")
        self.assertIn("endDateTime", compuesta["descartadas"][0]["motivo"])

    def test_un_codigo_o_un_texto_de_plazas_desconocido_no_consta_y_se_avisa(self) -> None:
        """Un código fuera de la lista o «Places disponibles» en otra forma dejan las plazas en no consta, con aviso."""
        nuevo = {**fila("1"), "listEditions": [{"activityId": "1", "registrationCode": "DISP9"}]}
        otra_lengua = {**fila("2"), "listEditions": [{"activityId": "2", "registrationCode": "DISP0"}]}
        otra_lengua["listEditions"][0]["registrationDesc"] = "Plazas disponibles: 4."
        conocido = {**fila("3"), "listEditions": [{"activityId": "3", "registrationCode": "DISP0"}]}
        conocido["listEditions"][0]["registrationDesc"] = "Places disponibles: 4."
        lectura = self.leer(paginas([nuevo, otra_lengua, conocido]))
        compuesta = barcelonactiva.componer_cibernarium(lectura, self.censo("1", "2", "3"), None)
        self.assertTrue(all(a["edicion"]["plazas"] is None for a in compuesta["cibernarium"]))
        self.assertEqual(
            compuesta["avisos"],
            [
                {"id": "1", "motivo": "codigo-de-inscripcion-desconocido"},
                {"id": "2", "motivo": "texto-de-plazas-desconocido"},
            ],
        )

    def test_el_estado_de_inscripcion_se_lee_del_codigo_publicado(self) -> None:
        """DISP0 es abierta y DISP52 apertura futura, con el botón visible o no; un código sin estado no consta."""
        filas = [
            {**fila(str(n)), "amagarBoto": False, "listEditions": [{"activityId": str(n), "registrationCode": c}]}
            for n, c in ((1, "DISP0"), (2, "DISP52"), (3, "DISP3"))
        ]
        filas[0]["listEditions"][0]["registrationDesc"] = "Places disponibles: 4."
        lectura = self.leer(paginas(filas))
        compuesta = barcelonactiva.componer_cibernarium(lectura, self.censo("1", "2", "3"), None)
        estados = {a["id"]: a["edicion"]["inscripcion"]["estado"] for a in compuesta["cibernarium"]}
        self.assertEqual(estados, {"1": "abierta", "2": "apertura-futura", "3": None})

    def test_una_conservada_que_hoy_no_se_ve_pierde_el_boton(self) -> None:
        """De la que falta hoy en el censo se conservan sus hechos con su fecha, pero su botón ya no consta."""
        visible = {**fila("7"), "amagarBoto": False, "listEditions": [{"activityId": "7", "registrationCode": "DISP0"}]}
        visible["listEditions"][0]["registrationDesc"] = "Places disponibles: 4."
        primera = barcelonactiva.componer_cibernarium(self.leer(paginas([visible])), self.censo("7"), None)
        self.assertTrue(primera["cibernarium"][0]["edicion"]["inscripcion"]["botonVisible"])
        anterior = previa(*primera["cibernarium"])
        self.fin = "2026-11-15T10:00:01Z"
        segunda = barcelonactiva.componer_cibernarium(self.leer(paginas([fila("1")])), self.censo("1"), anterior)
        conservada = next(a for a in segunda["cibernarium"] if a["id"] == "7")
        self.assertIsNone(conservada["edicion"]["inscripcion"]["botonVisible"])
        self.assertEqual(conservada["edicion"]["inscripcion"]["estado"], "abierta")

    def test_lo_republicado_con_un_censo_parcial_pierde_el_boton(self) -> None:
        """Censo de IA parcial, canal sin admitir completo o ámbitos detenidos: lo anterior se republica sin botón."""
        visible = {**fila("7"), "amagarBoto": False, "listEditions": [{"activityId": "7", "registrationCode": "DISP0"}]}
        visible["listEditions"][0]["registrationDesc"] = "Places disponibles: 4."
        primera = barcelonactiva.componer_cibernarium(self.leer(paginas([visible])), self.censo("7"), None)
        anterior = previa(*primera["cibernarium"])
        self.fin = "2026-11-15T10:00:01Z"
        parcial = self.leer(paginas([fila(str(n)) for n in range(1, 17)]), caidas=(15,))
        completa = self.leer(paginas([fila("1")]))
        self.filtros = RECORTE_FILTROS.replace("(22, 'Intel·ligència Artificial (IA)')", "(22, 'Robòtica')")
        detenida = self.leer(paginas([fila("1")]))
        casos = {
            "censo-ia-parcial": (parcial, self.censo("1")),
            "censo-del-canal-sin-admitir-completo": (completa, self.censo("1", completo=False)),
            "ambito-ia-cambiado": (detenida, self.censo("1")),
        }
        for motivo, (lectura, censo) in casos.items():
            compuesta = barcelonactiva.componer_cibernarium(lectura, censo, anterior)
            with self.subTest(motivo):
                self.assertEqual(compuesta["consulta_parcial"]["motivo"], motivo)
                republicada = compuesta["cibernarium"][0]
                self.assertEqual(republicada["id"], "7")
                self.assertIsNone(republicada["edicion"]["inscripcion"]["botonVisible"])
                self.assertEqual(republicada["edicion"]["inscripcion"]["estado"], "abierta")

    def test_cada_motivo_que_escriben_ambitos_y_plazas_esta_en_su_lista(self) -> None:
        """Todas las salidas de `ambitos.leer` y `edicion_ia.plazas` son motivos declarados, no literales sueltos."""
        carpeta = self.casa / "filtros"
        paginas_de_filtros = [
            (503, b""),
            (200, b"<html>Manteniment</html>"),
            (200, RECORTE_FILTROS.replace('idscope="22"', 'idscope="23"').encode()),
            (200, RECORTE_FILTROS.replace("Artificial (IA)')", "Artificial')").encode()),
            (200, RECORTE_FILTROS.replace("cAct_INSTANCE_uhcx", "cAct_INSTANCE_nou1").encode()),
        ]
        motivos = set()
        for http, cuerpo in paginas_de_filtros:
            motivos.add(ambitos.leer(carpeta, conservar(carpeta, ambitos.FILTROS, cuerpo, http, self.fin))[1])
        self.assertEqual(motivos, set(ambitos.MOTIVOS))
        plazas = {
            edicion_ia.plazas(e)[1]
            for e in ({"registrationCode": "DISP9"}, {"registrationCode": "DISP0", "registrationDesc": "Plazas: 4."})
        }
        self.assertEqual(plazas, set(edicion_ia.MOTIVOS))

    def test_el_boton_es_un_hecho_leido_y_su_ausencia_no_consta(self) -> None:
        """`amagarBoto` false lo muestra, true lo esconde y, si falta, el botón no consta (null)."""
        filas = [
            {**fila(str(n)), "listEditions": [{"activityId": str(n), "registrationCode": "DISP52"}]} for n in (1, 2, 3)
        ]
        filas[0]["amagarBoto"], filas[1]["amagarBoto"] = False, True
        lectura = self.leer(paginas(filas))
        compuesta = barcelonactiva.componer_cibernarium(lectura, self.censo("1", "2", "3"), None)
        botones = {a["id"]: a["edicion"]["inscripcion"]["botonVisible"] for a in compuesta["cibernarium"]}
        self.assertEqual(botones, {"1": True, "2": False, "3": None})

    def test_preparar_y_validar_publican_con_la_misma_forma_y_el_censo_admitido(self) -> None:
        """De punta a punta sin red: el conjunto conserva sus claves y un censo admitido distinto se rechaza."""
        self.leer(paginas([fila("1")]))
        preparado_canal = self.casa.parent / "preparados-canal"
        guardar_json(preparado_canal / "recepciones.json", {**self.censo("1"), "procedencia_sha256": "a" * 64})
        carpeta = self.casa.parent / "salidas"
        (carpeta / "catalogo.html").parent.mkdir(parents=True, exist_ok=True)
        (carpeta / "catalogo.html").write_text("", encoding="utf-8")
        guardados: list[dict[str, Any]] = []
        admitido = {"procedencia_sha256": "a" * 64}
        with ExitStack() as pila:
            recibo_materia = pila.enter_context(
                patch("plataforma_datos.cursos.materia_cibernarium.guardar_censo_admitido")
            )
            for nombre, valor in (
                ("ORIGINAL", self.casa),
                ("VALIDADO", carpeta / "validados"),
                ("FICHAS", carpeta / "fichas.jsonl"),
                ("ACTIVIDADES", carpeta / "cibernarium.json"),
                ("REVISION", carpeta / "revision.json"),
                ("PROCEDENCIA", carpeta / "procedencia.json"),
            ):
                pila.enter_context(patch.object(barcelonactiva, nombre, valor))
            guardar_json(carpeta / "procedencia.json", {})
            pila.enter_context(patch.object(barcelonactiva, "original", lambda *_: carpeta / "catalogo.html"))
            pila.enter_context(patch.object(barcelonactiva, "FICHAS_PUBLICADAS", 0))
            pila.enter_context(patch.object(barcelonactiva, "nombres_de_faro", dict))
            pila.enter_context(patch.object(barcelonactiva, "controles_de_huella", lambda *_: None))
            comun = barcelonactiva.operacion_fuente
            pila.enter_context(patch.object(comun, "preparar", lambda *_: None))
            pila.enter_context(patch.object(comun, "validar", lambda *_: None))
            pila.enter_context(patch.object(comun, "rutas_de_la_fuente", lambda *_: (None, preparado_canal, None)))
            pila.enter_context(patch.object(comun, "leer_validado", lambda *_: admitido))
            pila.enter_context(
                patch.object(
                    barcelonactiva, "cerrar_validacion", lambda _f, _i, _c, conjunto: guardados.append(conjunto())
                )
            )
            pila.enter_context(redirect_stdout(io.StringIO()))
            barcelonactiva.preparar()
            barcelonactiva.validar()
            recibo_materia.assert_called_once_with(barcelonactiva.RAIZ)
            self.assertEqual(
                set(guardados[0]), {"cita", "consulta", "url_ficha", "url_actividad", "ocupaciones", "cibernarium"}
            )
            self.assertEqual([a["id"] for a in guardados[0]["cibernarium"]], ["1"])
            admitido["procedencia_sha256"] = "b" * 64
            with self.assertRaisesRegex(FormatoInesperado, "censo distinto del admitido"):
                barcelonactiva.validar()
            recibo_materia.assert_called_once_with(barcelonactiva.RAIZ)


if __name__ == "__main__":
    unittest.main()
