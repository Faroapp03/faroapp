"""Cada consultor lee la respuesta grabada de la API de su fuente: confirma, contradice o no permite saber."""

import unittest

from plataforma_datos.cursos.comprobacion_api import cibervoluntarios, citilab, consorci, fundae, soc
from plataforma_datos.cursos.comprobacion_api.consultor import Lectura, sin_respuesta
from plataforma_datos.cursos.comprobacion_api.pruebas import ejemplos as ej
from plataforma_datos.cursos.comprobacion_pagina.consulta_de_retirados import Ficha
from plataforma_datos.cursos.pruebas.test_lectura_soc import fila, ident, oferta


def veredicto(lectura: Lectura) -> tuple[str, str]:
    """El veredicto y el motivo de una lectura.

    Returns:
        El par.
    """
    return lectura.veredicto, lectura.motivo


class Soc(unittest.TestCase):
    """El curso retirado se busca en la oferta oficial entera."""

    def test_la_oferta_decide_cada_curso(self) -> None:
        """Abierto contradice, terminado o ausente confirman y un estado nuevo no permite saber."""
        self.assertEqual(soc.direccion(ej.CURSO_SOC, {}), soc.lector.URL_OFERTA_SOC)
        casos = {
            (ej.CURSO_SOC, ej.HORA): ("disponible", "en_la_oferta_de_hoy"),
            (ej.CURSO_SOC, ej.MAS_TARDE): ("cerrado", "fin_pasado"),
            (ident(9), ej.HORA): ("no_existe", "ausente_de_la_oferta"),
        }
        for (curso, hora), esperado in casos.items():
            with self.subTest(curso=curso, hora=hora):
                self.assertEqual(veredicto(soc.decidir(curso, ej.soc(), hora)), esperado)
        anulado = ej.soc(oferta(fila(1, estat_curs="Curs anul·lat"), fila(2)))
        self.assertEqual(veredicto(soc.decidir(ej.CURSO_SOC, anulado, ej.HORA)), ("dudoso", "estado_desconocido"))

    def test_una_oferta_que_no_es_la_publicada_no_decide(self) -> None:
        """Un cuerpo que no es la oferta, o que no es JSON, no da a ningún curso por ausente."""
        for cuerpo in (b"[]", b"<html></html>", oferta({"curs": "1"})):
            with self.subTest(cuerpo=cuerpo[:20]):
                lectura = soc.decidir(ej.CURSO_SOC, ej.soc(cuerpo), ej.HORA)
                self.assertEqual(veredicto(lectura), ("dudoso", "respuesta_con_otra_forma"))


class Fundae(unittest.TestCase):
    """La edición se busca en la ficha de difusiones de su especialidad."""

    def test_la_direccion_sale_del_codigo_de_su_ficha(self) -> None:
        """Una edición con la ficha servida de su especialidad se pregunta; Digitalízate y lo que no tiene ficha, no."""
        self.assertEqual(
            fundae.direccion(ej.EDICION_FUNDAE, ej.FICHAS_FUNDAE),
            "https://agora.fundae.es/Oferta/RecuperarDifusionesRFO?idModalidad=2&codigoTitulacion=IFCT0089",
        )
        self.assertIsNone(fundae.direccion(ej.EDICION_FUNDAE, {}))
        sin_api = {"fundae:1:3462": Ficha(url="https://ciber.be/introduccion-ecommerce", titulo="Digitalízate")}
        self.assertIsNone(fundae.direccion("fundae:1:3462", sin_api))

    def test_el_plazo_de_preinscripcion_decide(self) -> None:
        """Dentro del plazo contradice, terminado o sin la difusión confirma y aún sin abrir no permite saber."""
        casos = {
            ej.difusiones(ej.difusion()): ("disponible", "plazo_abierto"),
            ej.difusiones(ej.difusion(fin="2026-11-20")): ("cerrado", "plazo_terminado"),
            ej.difusiones(ej.difusion(identificador=1972)): ("no_existe", "ausente_de_la_oferta"),
            ej.difusiones(ej.difusion(inicio="2026-12-01")): ("dudoso", "plazo_sin_abrir"),
            ej.difusiones(ej.difusion(fin="28/02/2027")): ("dudoso", "respuesta_con_otra_forma"),
            ej.difusiones(http=404): ("dudoso", "respuesta_con_otra_forma"),
        }
        for respuesta, esperado in casos.items():
            with self.subTest(esperado=esperado):
                self.assertEqual(veredicto(fundae.decidir(ej.EDICION_FUNDAE, respuesta, ej.HORA)), esperado)


class Cibervoluntarios(unittest.TestCase):
    """El material se busca en el catálogo filtrado por el slug de su ficha."""

    def test_la_direccion_filtra_por_el_slug_de_su_ficha(self) -> None:
        """El slug sale de la ficha servida; sin ficha no se pregunta."""
        self.assertEqual(
            cibervoluntarios.direccion(ej.MATERIAL_CIBER, ej.FICHAS_CIBER),
            "https://www.cibervoluntarios.org/api/public/activity_catalogs?activityCatalogMaterials.slug=youtube-intermedio",
        )
        self.assertIsNone(cibervoluntarios.direccion(ej.MATERIAL_CIBER, {}))

    def test_el_estado_del_material_decide(self) -> None:
        """Disponible contradice; borrado, descatalogado o ausente confirman; lo demás no permite saber."""
        casos = {
            ej.catalogo(ej.material()): ("disponible", "material_disponible"),
            ej.catalogo(ej.material(erased=True)): ("cerrado", "material_borrado"),
            ej.catalogo(ej.material(), actividad={"erased": True}): ("cerrado", "material_borrado"),
            ej.catalogo(ej.material(status="Descatalogado")): ("cerrado", "material_descatalogado"),
            ej.catalogo(): ("no_existe", "ausente_de_la_oferta"),
            ej.catalogo(ej.material(status="Pendiente")): ("dudoso", "estado_desconocido"),
            ej.catalogo(ej.material(identificador=904)): ("dudoso", "identificador_distinto"),
            ej.catalogo(ej.material(slug="otro")): ("dudoso", "filtro_no_aplicado"),
        }
        for respuesta, esperado in casos.items():
            with self.subTest(esperado=esperado):
                self.assertEqual(veredicto(cibervoluntarios.decidir(ej.MATERIAL_CIBER, respuesta, ej.HORA)), esperado)


class Consorci(unittest.TestCase):
    """La edición se busca entre las filas de su acción en el conjunto de acciones programadas."""

    def test_la_direccion_filtra_por_su_accion(self) -> None:
        """Se pide la acción de la edición; un identificador que no es de edición no se pregunta."""
        self.assertEqual(
            consorci.direccion(ej.EDICION_CONSORCI, {}),
            "https://analisi.transparenciacatalunya.cat/resource/qv5z-dgk3.json"
            "?%24where=identificador%3D%27294021%27&%24order=%3Aid",
        )
        self.assertIsNone(consorci.direccion("294021", {}))

    def test_la_fila_de_la_edicion_decide(self) -> None:
        """Con fin por llegar contradice; con fin pasado o sin esa edición confirma; un fin ilegible no decide."""
        otro_grupo = ej.accion(num_grup="3")
        casos = {
            (ej.acciones(otro_grupo, ej.accion()), ej.HORA): ("disponible", "en_la_oferta_de_hoy"),
            (ej.acciones(ej.accion()), ej.MAS_TARDE): ("cerrado", "fin_pasado"),
            (ej.acciones(otro_grupo), ej.HORA): ("no_existe", "ausente_de_la_oferta"),
            (ej.acciones(), ej.HORA): ("no_existe", "ausente_de_la_oferta"),
            (ej.respuesta(consorci.direccion(ej.EDICION_CONSORCI, {}), {"error": True}), ej.HORA): (
                "dudoso",
                "respuesta_con_otra_forma",
            ),
        }
        for (respuesta, hora), esperado in casos.items():
            with self.subTest(esperado=esperado):
                self.assertEqual(veredicto(consorci.decidir(ej.EDICION_CONSORCI, respuesta, hora)), esperado)


class Citilab(unittest.TestCase):
    """La ficha se pide por su número; la comprobación antirrobots nunca se salta y no decide."""

    def test_la_ficha_publicada_decide_por_su_fin(self) -> None:
        """Con fin por llegar contradice; con fin pasado o un 404 confirma."""
        self.assertEqual(
            citilab.direccion(ej.FICHA_CITILAB, {}),
            "https://www.citilab.eu/wp-json/wp/v2/formacio/812"
            "?_fields=id,modified,link,title,content,public,estat,tipus-formacio",
        )
        self.assertEqual(
            veredicto(citilab.decidir("812", ej.ficha_de_citilab(), ej.HORA)), ("disponible", "en_la_oferta_de_hoy")
        )
        self.assertEqual(
            veredicto(citilab.decidir("812", ej.ficha_de_citilab(), ej.MAS_TARDE)), ("cerrado", "fin_pasado")
        )
        no_hay = ej.respuesta(citilab.direccion("812", {}), {"code": "rest_post_invalid_id"}, 404)
        self.assertEqual(veredicto(citilab.decidir("812", no_hay, ej.HORA)), ("no_existe", "http_no_encontrada"))
        for cuerpo in ([], {"id": 813}, b"no es JSON"):
            with self.subTest(cuerpo=cuerpo):
                otra_forma = ej.respuesta(citilab.direccion("812", {}), cuerpo)
                lectura = citilab.decidir("812", otra_forma, ej.HORA)
                self.assertEqual(veredicto(lectura), ("dudoso", "respuesta_con_otra_forma"))
        sin_fechas = ej.ficha_de_citilab(content={"rendered": "<p>Curs</p>"})
        self.assertEqual(veredicto(citilab.decidir("812", sin_fechas, ej.HORA)), ("dudoso", "fechas_ilegibles"))

    def test_citilab_bloqueado_no_se_sabe(self) -> None:
        """La página antirrobots, con 200 o con 403, y un acceso rechazado quedan sin decidir, con su motivo."""
        for http in (200, 202, 403):
            with self.subTest(http=http):
                lectura = citilab.decidir("812", ej.comprobacion_antirrobots(http), ej.HORA)
                self.assertEqual(veredicto(lectura), ("dudoso", "pagina_de_comprobacion"))
        rechazo = ej.respuesta(citilab.direccion("812", {}), {"code": "rest_forbidden"}, 403)
        self.assertEqual(veredicto(citilab.decidir("812", rechazo, ej.HORA)), ("dudoso", "acceso_rechazado"))


class SinRespuesta(unittest.TestCase):
    """Sin respuesta o con un error del servidor no se decide nada, en ninguna fuente."""

    def test_la_red_o_el_servidor_que_fallan_no_son_evidencia(self) -> None:
        """Sin estado, un 5xx o un límite de peticiones dan `sin_respuesta`; un 200 sigue a su fuente."""
        url = soc.lector.URL_OFERTA_SOC
        self.assertEqual(veredicto(sin_respuesta(ej.respuesta(url, b"", http=None))), ("sin_respuesta", "error_de_red"))
        for http in (500, 503, 429):
            with self.subTest(http=http):
                lectura = sin_respuesta(ej.respuesta(url, b"", http=http))
                self.assertEqual(veredicto(lectura), ("sin_respuesta", "error_del_servidor"))
        self.assertIsNone(sin_respuesta(ej.soc()))


if __name__ == "__main__":
    unittest.main()
