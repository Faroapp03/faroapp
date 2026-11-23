"""La consulta de las páginas de las retiradas respeta su muestra y su tope, y lee bien lo que responde la página."""

import unittest
from unittest.mock import patch
from urllib.error import HTTPError, URLError

from plataforma_datos.comun.nucleo import Descarga
from plataforma_datos.cursos.comprobacion_pagina import transporte
from plataforma_datos.cursos.comprobacion_pagina.consulta_de_retirados import (
    CONFIRMA,
    CONTRADICE,
    NO_SE_SABE,
    PAGINA_NO_DECIDE,
    PARAMETROS,
    SIN_TIEMPO,
    Consulta,
    Ficha,
    comprobar_retiradas,
    muestra,
)
from plataforma_datos.cursos.comprobacion_pagina.pruebas import ejemplos as ej
from plataforma_datos.cursos.comprobacion_pagina.respuesta import Respuesta

DOMINIO = "https://cursos.ejemplo.test/ficha-actividad?activityId="


class Grabadas:
    """Un transporte que responde con páginas grabadas y un reloj que avanza `paso` segundos con cada petición."""

    def __init__(self, paginas: dict[str, bytes | int], paso: float = 1.0) -> None:
        """Guarda las páginas (cuerpo de un 200, o un estado HTTP) por su dirección."""
        self.paginas, self.paso, self.ahora = paginas, paso, 0.0
        self.pedidas: list[tuple[str, float]] = []

    def pedir(self, url: str, hasta: float) -> Respuesta:
        """Devuelve la página grabada; una dirección sin grabar es la sonda, que responde la ficha genérica.

        Returns:
            La respuesta grabada.
        """
        self.pedidas.append((url, self.ahora))
        self.ahora += self.paso
        if url not in self.paginas:
            return ej.sonda(url=url, url_final=url)
        grabada = self.paginas[url]
        if isinstance(grabada, int):
            return ej.respuesta(url=url, url_final=url, http=grabada)
        return ej.respuesta(grabada, url=url, url_final=url)

    def reloj(self) -> float:
        """El reloj simulado.

        Returns:
            Los segundos transcurridos.
        """
        return self.ahora

    def consultar(self, fuente: str, fichas: dict[str, Ficha], retiradas: list[str] | None = None) -> Consulta:
        """Consulta las retiradas con este transporte y un tope de 60 s desde ahora.

        Returns:
            La consulta.
        """
        return comprobar_retiradas(
            fuente,
            list(fichas) if retiradas is None else retiradas,
            fichas,
            semilla="ciclo",
            pedir=self.pedir,
            reloj=self.reloj,
            instante=lambda: ej.HORA,
            hasta=self.ahora + PARAMETROS.tope_s,
        )


def fichas(*numeros: int) -> dict[str, Ficha]:
    """Las fichas de esas ediciones, todas en el mismo dominio.

    Returns:
        La ficha de cada edición.
    """
    return {f"cibernarium:edicion:{n}": Ficha(url=f"{DOMINIO}{n}", titulo=ej.TITULO) for n in numeros}


class LoQueDiceLaPagina(unittest.TestCase):
    """Solo un cierre o una ficha inexistente confirman; solo una ficha abierta contradice."""

    def test_cada_veredicto_da_su_resultado(self) -> None:
        """Abierta contradice, cerrada y 404 confirman, sin respuesta no se sabe."""
        paginas = {
            f"{DOMINIO}1": ej.ficha_abierta(),
            f"{DOMINIO}2": ej.ficha_con("Inscripció tancada"),
            f"{DOMINIO}3": 404,
        }
        grabadas = Grabadas(paginas)
        consulta = grabadas.consultar("barcelonactiva", fichas(1, 2, 3))
        self.assertEqual(
            (consulta.cuenta(CONFIRMA), consulta.cuenta(CONTRADICE), consulta.cuenta(NO_SE_SABE)), (2, 1, 0)
        )
        self.assertEqual((consulta.sin_comprobar, consulta.motivo), (0, None))
        self.assertEqual(len(grabadas.pedidas), 4, "una sonda del dominio y las tres fichas")

    def test_una_pagina_que_no_contesta_no_prueba_nada(self) -> None:
        """Un error de red es «no se sabe»: ni confirma ni contradice."""
        grabadas = Grabadas({})
        grabadas.pedir = lambda url, hasta: Respuesta(url=url, http=None)
        consulta = grabadas.consultar("barcelonactiva", fichas(1))
        self.assertEqual((consulta.cuenta(NO_SE_SABE), consulta.cuenta(CONFIRMA)), (1, 0))


class MuestraYTope(unittest.TestCase):
    """Pocas consultas por fuente y ciclo, y nunca después del tope de tiempo."""

    def test_la_muestra_tiene_su_tamano(self) -> None:
        """De diez retiradas solo se consultan cuatro; las demás quedan sin comprobar."""
        grabadas = Grabadas({f"{DOMINIO}{n}": 404 for n in range(10)})
        consulta = grabadas.consultar("barcelonactiva", fichas(*range(10)))
        self.assertEqual(len(consulta.comprobaciones), PARAMETROS.muestra_por_fuente)
        self.assertEqual(consulta.sin_comprobar, 10 - PARAMETROS.muestra_por_fuente)
        self.assertEqual(len(grabadas.pedidas), 1 + PARAMETROS.muestra_por_fuente)

    def test_la_muestra_es_estable_y_cambia_con_el_ciclo(self) -> None:
        """La misma semilla da la misma muestra; otra semilla, otra."""
        cursos = [f"c{n}" for n in range(50)]
        self.assertEqual(muestra(cursos, "a", 4), muestra(reversed(cursos), "a", 4))
        self.assertNotEqual(muestra(cursos, "a", 4), muestra(cursos, "b", 4))

    def test_el_tope_de_tiempo_corta_la_consulta_y_lo_dice(self) -> None:
        """Con 25 s por petición y 60 s de tope caben la sonda y dos fichas; nada empieza después del tope."""
        grabadas = Grabadas({f"{DOMINIO}{n}": 404 for n in range(4)}, paso=25.0)
        consulta = grabadas.consultar("barcelonactiva", fichas(*range(4)))
        self.assertEqual((len(consulta.comprobaciones), consulta.sin_comprobar), (2, 2))
        self.assertEqual(consulta.motivo, SIN_TIEMPO)
        self.assertTrue(all(empezada < PARAMETROS.tope_s for _, empezada in grabadas.pedidas))

    def test_sin_tiempo_no_se_pide_nada(self) -> None:
        """Si el tope ya pasó, ninguna petición sale y todas quedan sin comprobar."""
        grabadas = Grabadas({})
        consulta = comprobar_retiradas(
            "barcelonactiva",
            list(fichas(1, 2)),
            fichas(1, 2),
            semilla="ciclo",
            pedir=grabadas.pedir,
            reloj=lambda: 100.0,
            instante=lambda: ej.HORA,
            hasta=50.0,
        )
        self.assertEqual((grabadas.pedidas, consulta.sin_comprobar, consulta.motivo), ([], 2, SIN_TIEMPO))

    def test_una_fuente_cuya_pagina_no_decide_no_se_consulta(self) -> None:
        """FUNDAE pinta su ficha con JavaScript: no se pide nada y se dice por qué."""
        grabadas = Grabadas({})
        consulta = grabadas.consultar("fundae", fichas(1, 2))
        self.assertEqual((grabadas.pedidas, consulta.sin_comprobar, consulta.motivo), ([], 2, PAGINA_NO_DECIDE))

    def test_un_curso_sin_pagina_publicada_no_se_pide(self) -> None:
        """Una retirada sin ficha en lo publicado queda sin comprobar, sin peticiones."""
        grabadas = Grabadas({})
        consulta = grabadas.consultar("barcelonactiva", {}, retiradas=["cibernarium:edicion:9"])
        self.assertEqual((grabadas.pedidas, consulta.sin_comprobar, consulta.motivo), ([], 1, None))


class Transporte(unittest.TestCase):
    """El transporte real deja cada respuesta en la forma que lee el veredicto, sin salir a la red en la prueba."""

    URL = f"{DOMINIO}1"

    def test_una_respuesta_de_error_conserva_su_estado(self) -> None:
        """Un 404 es una observación: llega con su estado y su cuerpo."""
        error = HTTPError(self.URL, 404, "Not Found", {"Content-Type": "text/html"}, None)
        with patch.object(transporte, "descargar_url", side_effect=error):
            respuesta = transporte.pedir_pagina(self.URL, 10.0)
        self.assertEqual((respuesta.http, respuesta.url_final, respuesta.saltos), (404, self.URL, 0))

    def test_sin_respuesta_no_hay_estado(self) -> None:
        """Un fallo de red o de plazo queda sin estado ni dirección final."""
        for fallo in (URLError("sin red"), TimeoutError("plazo")):
            with patch.object(transporte, "descargar_url", side_effect=fallo):
                respuesta = transporte.pedir_pagina(self.URL, 10.0)
            self.assertEqual(respuesta, Respuesta(url=self.URL, http=None))

    def test_una_respuesta_buena_lleva_su_estado_y_la_redireccion(self) -> None:
        """El estado sale de las cabeceras que vio el transporte; una dirección final distinta es una redirección."""

        def descargar(url: str, **opciones: object) -> Descarga:
            opciones["comprobar_cabeceras"](200, url, {})
            self.assertEqual((opciones["perfil"], opciones["hasta"]), ("pagina", 10.0))
            return Descarga(b"<html></html>", f"{DOMINIO}2", "text/html")

        with patch.object(transporte, "descargar_url", side_effect=descargar):
            respuesta = transporte.pedir_pagina(self.URL, 10.0)
        esperada = Respuesta(
            url=self.URL, http=200, url_final=f"{DOMINIO}2", saltos=1, tipo="text/html", cuerpo=b"<html></html>"
        )
        self.assertEqual(respuesta, esperada)


if __name__ == "__main__":
    unittest.main()
