"""El veredicto de una página: cada veredicto y cada motivo con su caso, y lo desconocido siempre `dudoso`."""

import unittest

from plataforma_datos.cursos.comprobacion_pagina import contrato
from plataforma_datos.cursos.comprobacion_pagina.pruebas import ejemplos as ej
from plataforma_datos.cursos.comprobacion_pagina.respuesta import Respuesta
from plataforma_datos.cursos.comprobacion_pagina.veredicto import comprobar_pagina

URL_PORTADA = "https://cursos.ejemplo.test/"


def comprobar(respuesta: Respuesta, sonda: Respuesta | None = None, fuente: str = "barcelonactiva") -> dict:
    """Comprueba una página con la sonda por defecto.

    Returns:
        La comprobación tal como se guarda.
    """
    sonda = ej.sonda() if sonda is None else sonda
    return comprobar_pagina(ej.curso(fuente), respuesta, sonda, pedido_utc=ej.HORA).a_json()


class VeredictoPruebas(unittest.TestCase):
    """Cada caso fija el veredicto y el motivo que la lista cerrada le asigna."""

    def veredicto(self, esperado: str, motivo: str, **kwargs: object) -> dict:
        """Comprueba el veredicto y el motivo de una página.

        Returns:
            La comprobación, para seguir mirando sus campos.
        """
        comprobacion = comprobar(**kwargs)
        self.assertEqual((comprobacion["veredicto"], comprobacion["motivo"]), (esperado, motivo))
        return comprobacion

    def test_ficha_con_titulo_y_boton_de_inscripcion_esta_disponible(self) -> None:
        """La ficha propia con el título y la señal de apertura de su fuente es `disponible`, con su literal."""
        c = self.veredicto("disponible", "ficha_con_senal_de_apertura", respuesta=ej.respuesta(ej.ficha_abierta()))
        self.assertEqual(c["senales"], ["Inscriure'm"])
        self.assertTrue(c["titulo_presente"])
        self.assertEqual((c["http"], c["saltos"], c["url_final"]), (200, 0, ej.URL_CURSO))

    def test_frase_del_pie_no_cuenta_como_senal(self) -> None:
        """«Inscriu-te a la IT Academy» es del pie de toda la web: no aparece entre las señales de la ficha."""
        c = comprobar(ej.respuesta(ej.ficha_abierta()))
        self.assertNotIn("Inscriu-te", " ".join(c["senales"]))

    def test_datos_publicados_que_trae_la_ficha(self) -> None:
        """HP LIFE se lee por el curso que incrusta: título coincidente, `Published` y `Public`."""
        c = self.veredicto(
            "disponible",
            "datos_publicados_en_la_ficha",
            respuesta=ej.respuesta(ej.datos_next("Published")),
            fuente="hp_life",
        )
        self.assertEqual(c["senales"], ["privacyLevel=Public", "status=Published"])
        self.assertTrue(c["titulo_presente"])

    def test_senal_literal_de_cierre(self) -> None:
        """Una frase de cierre en la ficha, sin señales de apertura, es `cerrado` y queda escrita tal cual."""
        c = self.veredicto("cerrado", "senal_de_cierre", respuesta=ej.respuesta(ej.ficha_con("Inscripció tancada")))
        self.assertEqual(c["senales"], ["Inscripció tancada"])

    def test_cada_frase_de_cierre_de_la_fuente_es_cerrado(self) -> None:
        """«Sense places», «Places esgotades» y «Curs finalitzat» cierran la ficha de Cibernàrium."""
        for frase in ("Sense places", "Places esgotades", "Curs finalitzat"):
            with self.subTest(frase=frase):
                c = self.veredicto("cerrado", "senal_de_cierre", respuesta=ej.respuesta(ej.ficha_con(frase)))
                self.assertEqual(c["senales"], [frase])

    def test_http_404_y_410_son_no_existe(self) -> None:
        """El sitio dice que la dirección no existe."""
        for estado in (404, 410):
            with self.subTest(estado=estado):
                self.veredicto("no_existe", "http_no_encontrada", respuesta=ej.respuesta(http=estado))

    def test_un_no_existe_que_responde_200(self) -> None:
        """Una página con 200 igual a la que el sitio da a lo inexistente y sin el título es `no_existe`."""
        c = self.veredicto("no_existe", "igual_a_la_sonda", respuesta=ej.respuesta(ej.ficha_generica()))
        self.assertEqual(c["http"], 200)
        self.assertFalse(c["titulo_presente"])
        self.assertIsNotNone(c["sonda_sha256"])

    def test_redireccion_a_la_misma_portada_que_la_sonda(self) -> None:
        """Si la sonda y la página terminan en la misma portada, el sitio manda lo inexistente allí."""
        portada = ej.pagina(f"<h1>Portada</h1><p>{ej.RELLENO}</p>")
        respuesta = ej.respuesta(portada, url_final=URL_PORTADA, saltos=1)
        self.veredicto(
            "no_existe",
            "igual_a_la_sonda",
            respuesta=respuesta,
            sonda=ej.sonda(portada, url_final=URL_PORTADA, saltos=1),
        )

    def test_redireccion_a_otra_pagina_es_dudosa(self) -> None:
        """Si la ficha redirige fuera de sí misma y la sonda no hace lo mismo, no se sabe qué dice la página."""
        portada = ej.pagina(f"<h1>Portada</h1><p>{ej.RELLENO}</p>")
        self.veredicto(
            "dudoso", "redirige_fuera_de_la_ficha", respuesta=ej.respuesta(portada, url_final=URL_PORTADA, saltos=1)
        )

    def test_pagina_igual_a_la_sonda_pero_con_el_titulo(self) -> None:
        """Una página que se parece a la sonda y trae el título del curso no se da por inexistente."""
        cuerpo = ej.ficha_abierta()
        self.veredicto("dudoso", "igual_a_la_sonda_con_titulo", respuesta=ej.respuesta(cuerpo), sonda=ej.sonda(cuerpo))

    def test_acceso_rechazado(self) -> None:
        """Un 403 o un 401 no dicen nada del curso."""
        for estado in (401, 403, 451):
            with self.subTest(estado=estado):
                self.veredicto("dudoso", "acceso_rechazado", respuesta=ej.respuesta(http=estado))

    def test_fuente_sin_reconocedor(self) -> None:
        """Una fuente cuyas fichas no se han declarado nunca se lee: lo que diga su página es `dudoso`."""
        self.veredicto(
            "dudoso",
            "fuente_sin_reconocedor",
            respuesta=ej.respuesta(ej.ficha_con("Inscripció tancada")),
            fuente="otra",
        )

    def test_el_http_se_lee_aunque_la_fuente_no_este_declarada(self) -> None:
        """Un 404 es un 404 en cualquier fuente; un error de red sigue siendo `sin_respuesta`."""
        self.veredicto("no_existe", "http_no_encontrada", respuesta=ej.respuesta(http=404), fuente="otra")
        self.veredicto("sin_respuesta", "error_de_red", respuesta=Respuesta(url=ej.URL_CURSO, http=None), fuente="otra")

    def test_pagina_identica_para_cualquier_identificador(self) -> None:
        """FUNDAE y Cibervoluntarios pintan la ficha con JavaScript: su página no decide nada."""
        for fuente in ("fundae", "cibervoluntarios"):
            with self.subTest(fuente=fuente):
                self.veredicto(
                    "dudoso", "pagina_identica_para_todo", respuesta=ej.respuesta(ej.ficha_generica()), fuente=fuente
                )

    def test_contenido_que_solo_se_pinta_con_javascript(self) -> None:
        """Poco texto y scripts: la ficha la pinta el navegador y la página sola no dice nada."""
        cuerpo = ej.pagina("<div id='app'></div>", scripts=3)
        self.veredicto("dudoso", "contenido_con_javascript", respuesta=ej.respuesta(cuerpo), fuente="claude_academy")

    def test_datos_incrustados_con_otro_titulo_o_sin_publicar(self) -> None:
        """El curso de los datos tiene otro nombre o no está publicado y público: `dudoso`."""
        otro = ej.datos_next("Published", nombre="Otro curso distinto")
        self.veredicto("dudoso", "datos_con_otro_titulo", respuesta=ej.respuesta(otro), fuente="hp_life")
        for estado, privacidad in (("Draft", "Public"), ("Published", "Private")):
            with self.subTest(estado=estado, privacidad=privacidad):
                cuerpo = ej.datos_next(estado, privacidad)
                self.veredicto("dudoso", "datos_sin_publicar", respuesta=ej.respuesta(cuerpo), fuente="hp_life")

    def test_ficha_sin_datos_del_curso(self) -> None:
        """Una fuente que se lee por sus datos incrustados no se lee por el texto: sin datos, `dudoso`."""
        self.veredicto(
            "dudoso", "ficha_sin_datos_del_curso", respuesta=ej.respuesta(ej.ficha_abierta()), fuente="hp_life"
        )
        roto = ej.pagina('<script id="__NEXT_DATA__">{no es json</script>')
        self.veredicto("dudoso", "ficha_sin_datos_del_curso", respuesta=ej.respuesta(roto), fuente="hp_life")

    def test_senales_contradictorias(self) -> None:
        """Cierre y apertura a la vez: no se decide."""
        c = self.veredicto(
            "dudoso", "senales_contradictorias", respuesta=ej.respuesta(ej.ficha_con("Inscripció tancada. Inscriu-te"))
        )
        self.assertEqual(c["senales"], ["Inscripció tancada", "Inscriu-te"])

    def test_texto_muy_corto(self) -> None:
        """Una página sin scripts y con muy poco texto no es una ficha."""
        cuerpo = ej.pagina(f"<h1>{ej.TITULO}</h1><p>Inscriure'm</p>")
        self.veredicto("dudoso", "texto_muy_corto", respuesta=ej.respuesta(cuerpo))

    def test_titulo_ausente(self) -> None:
        """Una página larga y sin señales que no menciona el título del curso no es su ficha."""
        cuerpo = ej.pagina(f"<h1>Catálogo</h1><p>{ej.RELLENO}</p>")
        c = self.veredicto("dudoso", "titulo_ausente", respuesta=ej.respuesta(cuerpo))
        self.assertFalse(c["titulo_presente"])

    def test_ficha_sin_la_senal_de_apertura_de_su_fuente(self) -> None:
        """Con el título y sin señal de cierre, pero sin el botón propio de la fuente, no se da por disponible."""
        self.veredicto("dudoso", "sin_senal_de_apertura", respuesta=ej.respuesta(ej.ficha_con("Más información")))

    def test_sin_sonda_nunca_disponible(self) -> None:
        """Sin la respuesta de la sonda no se sabe si el sitio responde 200 a todo: no se da por disponible."""
        sin_sonda = comprobar_pagina(ej.curso(), ej.respuesta(ej.ficha_abierta()), None, pedido_utc=ej.HORA).a_json()
        self.assertEqual((sin_sonda["veredicto"], sin_sonda["motivo"]), ("dudoso", "sin_sonda"))
        self.assertIsNone(sin_sonda["sonda_sha256"])
        caida = ej.sonda(http=None, cuerpo=b"")
        self.veredicto("dudoso", "sin_sonda", respuesta=ej.respuesta(ej.ficha_abierta()), sonda=caida)

    def test_un_cierre_se_lee_aunque_no_haya_sonda(self) -> None:
        """Lo que dice la propia ficha no necesita la sonda: «Sense places» sigue siendo `cerrado`."""
        c = comprobar_pagina(ej.curso(), ej.respuesta(ej.ficha_con("Sense places")), None, pedido_utc=ej.HORA)
        self.assertEqual(c.veredicto, "cerrado")

    def test_sin_respuesta_no_es_evidencia(self) -> None:
        """Error de red, 5xx y límite de peticiones son `sin_respuesta`, sin señales ni dirección final."""
        c = self.veredicto("sin_respuesta", "error_de_red", respuesta=Respuesta(url=ej.URL_CURSO, http=None))
        self.assertEqual((c["http"], c["url_final"], c["saltos"], c["senales"]), (None, None, 0, []))
        for estado in (500, 502, 503, 429):
            with self.subTest(estado=estado):
                self.veredicto("sin_respuesta", "error_del_servidor", respuesta=ej.respuesta(http=estado))

    def test_sitio_que_responde_500_a_lo_inexistente(self) -> None:
        """Un 5xx igual al de la sonda no distingue un curso retirado de una caída: `dudoso`, no `sin_respuesta`."""
        error = ej.pagina("<p>Error del servidor</p>")
        self.veredicto(
            "dudoso",
            "servidor_igual_a_la_sonda",
            respuesta=ej.respuesta(error, http=500),
            sonda=ej.sonda(error, http=500),
        )

    def test_sonda_que_responde_404_no_confunde_una_ficha_normal(self) -> None:
        """Claude Academy responde 404 a lo inexistente: una ficha con 200 se lee por sí misma."""
        cuerpo = ej.pagina(f"<h1>{ej.TITULO}</h1><p>{ej.RELLENO}</p><a>Start course</a>", scripts=1)
        self.veredicto(
            "disponible",
            "ficha_con_senal_de_apertura",
            respuesta=ej.respuesta(cuerpo),
            sonda=ej.sonda(b"", http=404),
            fuente="claude_academy",
        )

    def test_toda_comprobacion_cumple_el_contrato_y_es_reproducible(self) -> None:
        """Lo que sale de la función se valida, y la misma entrada da exactamente la misma comprobación."""
        casos = [ej.ficha_abierta(), ej.ficha_con("Sense places"), ej.ficha_generica(), b"", b"\xff\xfe<html"]
        for cuerpo in casos:
            with self.subTest(cuerpo=cuerpo[:20]):
                primera, segunda = comprobar(ej.respuesta(cuerpo)), comprobar(ej.respuesta(cuerpo))
                contrato.validar_comprobacion(primera)
                self.assertEqual(primera, segunda)

    def test_ningun_veredicto_se_da_por_descarte(self) -> None:
        """Páginas que ninguna regla reconoce acaban `dudoso`, nunca `disponible` ni `cerrado`."""
        desconocidas = [b"", b"<html></html>", b"\x00\x01\x02", ej.pagina(f"<p>{ej.RELLENO}</p>")]
        for cuerpo in desconocidas:
            with self.subTest(cuerpo=cuerpo[:20]):
                self.assertEqual(comprobar(ej.respuesta(cuerpo))["veredicto"], "dudoso")


if __name__ == "__main__":
    unittest.main()
