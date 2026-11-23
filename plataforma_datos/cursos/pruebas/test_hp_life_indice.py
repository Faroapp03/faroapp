"""Altas de HP LIFE por su índice público: censo completo comprobable, sin red y con recortes de las páginas reales."""

import tempfile
import unittest
from collections.abc import Callable
from dataclasses import replace
from pathlib import Path
from unittest.mock import patch
from urllib.error import URLError

from plataforma_datos.comun.nucleo import Descarga
from plataforma_datos.cursos import recepciones_catalogo as recepciones
from plataforma_datos.cursos.fuentes.hp_life import adquisicion, descubrimiento, indice
from plataforma_datos.cursos.fuentes.hp_life.recepciones import leer_recepcion

CAPTURAS = Path(__file__).with_name("capturas_hp_life_indice")
PAGINAS = {n: (CAPTURAS / f"pagina-{n}.html").read_bytes() for n in range(1, 6)}
TOTAL = 37


class IndiceHpLifePruebas(unittest.TestCase):
    """Cada caso conserva en su propia carpeta lo que recibe."""

    def setUp(self) -> None:
        """Crea la carpeta de recepciones del caso."""
        temporal = tempfile.TemporaryDirectory(prefix="Índice HP ñ ")
        self.addCleanup(temporal.cleanup)
        self.area = Path(temporal.name)

    def servir(
        self,
        paginas: dict[int, bytes] | None = None,
        *,
        fallos: dict[int, Callable[[], None]] | None = None,
        estados: dict[int, int] | None = None,
    ) -> list[int]:
        """Sustituye el transporte por las páginas dadas y devuelve las solicitadas.

        Returns:
            Lista, que se llena con el número de cada página pedida.
        """
        cuerpos, caidas, codigos, pedidas = paginas or PAGINAS, fallos or {}, estados or {}, []

        def descargar(url: str, **opciones: object) -> Descarga:
            numero = indice.numero_de_pagina(url)
            pedidas.append(numero)
            if numero in caidas:
                caidas[numero]()
            opciones["comprobar_cabeceras"](codigos.get(numero, 200), url, {})
            return Descarga(cuerpos[numero], url, "text/html; charset=utf-8")

        parche = patch.object(recepciones.red, "descargar_url", side_effect=descargar)
        parche.start()
        self.addCleanup(parche.stop)
        return pedidas

    def recorrer(self) -> descubrimiento.RecorridoIndice:
        """Recorre el índice servido.

        Returns:
            Resultado del recorrido.
        """
        return descubrimiento.recorrer(area=self.area)

    def test_las_37_identidades_de_las_paginas_reales_se_leen_y_cuadran(self) -> None:
        """Las cinco páginas capturadas declaran 37 cursos y las cuatro primeras los traen todos."""
        self.servir()
        recorrido = self.recorrer()
        self.assertTrue(recorrido.censo.completo)
        self.assertEqual(len(recorrido.censo.cursos), TOTAL)
        self.assertEqual(len({c.identidad for c in recorrido.censo.cursos}), TOTAL)
        self.assertEqual([len(p.cursos) for p in recorrido.paginas], [12, 12, 12, 1])
        self.assertTrue(all(p.total == TOTAL for p in recorrido.paginas))
        rx = recorrido.adquiridas[0].recepcion
        recibo = leer_recepcion(rx.cuerpo.ruta.read_bytes(), rx.recibo.ruta.read_bytes())
        self.assertEqual(recibo.captura.url_solicitada, indice.url_pagina(1))

    def test_la_quinta_pagina_real_declara_el_total_y_no_trae_cursos(self) -> None:
        """Una página sin cursos y con el total completo es una página legible, no un error."""
        self.servir()
        adquirida = adquisicion.recibir_indice(5, area=self.area)
        recepcion = leer_recepcion(
            adquirida.recepcion.cuerpo.ruta.read_bytes(), adquirida.recepcion.recibo.ruta.read_bytes()
        )
        pagina = indice.extraer_indice(recepcion.cuerpo, recepcion.captura)
        self.assertEqual((pagina.pagina, pagina.total, pagina.cursos), (5, TOTAL, ()))

    def test_un_curso_nuevo_del_indice_es_una_alta_con_su_ficha(self) -> None:
        """Lo que el índice trae y el catálogo no conoce se descubre con la URL de su ficha."""
        self.servir()
        recorrido = self.recorrer()
        conocidas = {c.identidad for c in recorrido.censo.cursos}
        nueva = recorrido.censo.cursos[7]
        nuevas = descubrimiento.altas(recorrido.censo, conocidas - {nueva.identidad})
        self.assertEqual([c.identidad for c in nuevas], [nueva.identidad])
        self.assertEqual(nuevas[0].url, f"https://www.life-global.org/es/course/{nueva.id}")

    def test_paginas_que_no_suman_el_total_son_consulta_parcial_con_las_altas_vistas(self) -> None:
        """Si el total no cuadra el censo es parcial, pero lo visto sigue acreditando que esos cursos existen."""
        mayor = {n: cuerpo.replace(b'"totalCourses":37', b'"totalCourses":38') for n, cuerpo in PAGINAS.items()}
        self.servir(mayor)
        recorrido = self.recorrer()
        self.assertFalse(recorrido.censo.completo)
        self.assertEqual(recorrido.censo.motivo, "las páginas no suman el total declarado")
        self.assertEqual(len(descubrimiento.altas(recorrido.censo, set())), TOTAL)

    def test_pagina_caida_deja_censo_parcial_y_conserva_el_intento(self) -> None:
        """Un corte en la tercera página no se lee como el final del índice."""
        pedidas = self.servir(fallos={3: lambda: (_ for _ in ()).throw(URLError("corte sintético"))})
        recorrido = self.recorrer()
        self.assertEqual(pedidas, [1, 2, 3])
        self.assertFalse(recorrido.censo.completo)
        self.assertEqual(len(recorrido.censo.cursos), 24)
        self.assertEqual(len(recorrido.adquiridas), 3)
        self.assertEqual(sum(a.recepcion is not None for a in recorrido.adquiridas), 2)

    def test_error_del_servidor_deja_censo_parcial_sin_excepcion(self) -> None:
        """Un 503 en la segunda página conserva su recibo y no se lee como el final del índice."""
        self.servir(estados={2: 503})
        recorrido = self.recorrer()
        self.assertFalse(recorrido.censo.completo)
        self.assertEqual(len(recorrido.censo.cursos), 12)
        self.assertEqual(len(recorrido.paginas), 1)

    def test_respuesta_mal_formada_deja_la_pagina_sin_noticia(self) -> None:
        """Una lista rota o una página ajena no producen excepción ni cursos inventados."""
        rota = PAGINAS[2].replace(b'"initialCourses":[', b'"initialCourses":[7,')
        ajena = PAGINAS[1]
        casos = {"lista rota": {**PAGINAS, 2: rota}, "página ajena": {**PAGINAS, 2: ajena}}
        for nombre, paginas in casos.items():
            with self.subTest(nombre):
                self.servir(paginas)
                with tempfile.TemporaryDirectory() as otra:
                    recorrido = descubrimiento.recorrer(area=Path(otra))
                self.assertFalse(recorrido.censo.completo)
                self.assertEqual(len(recorrido.censo.cursos), 12)

    def test_url_ajena_al_indice_se_rechaza_antes_de_red(self) -> None:
        """Solo las páginas del índice público pueden salir por el transporte."""
        for url in (
            "https://example.org/es/allcourses?page=1",
            "https://www.life-global.org/es/allcourses?page=1&x=2",
            "https://www.life-global.org/es/allcourses?page=0",
            "https://www.life-global.org/es/courses?page=1",
        ):
            with self.subTest(url=url), self.assertRaises(indice.ErrorIndiceHpLife):
                indice.numero_de_pagina(url)
        with self.assertRaises(indice.ErrorIndiceHpLife):
            indice.url_pagina(0)

    def test_un_indice_sin_cursos_no_es_un_censo_completo(self) -> None:
        """Total cero, o primera página vacía, es parcial: un 200 vacío no puede dar por ausente a todo el catálogo."""
        vacio = {n: c.replace(b'"totalCourses":37', b'"totalCourses":0') for n, c in PAGINAS.items()}
        sin_cursos = {1: PAGINAS[5].replace(b'"page":5', b'"page":1'), 2: PAGINAS[5]}
        for nombre, paginas in (("total cero", vacio), ("primera página vacía", sin_cursos)):
            with self.subTest(nombre):
                self.servir(paginas)
                with tempfile.TemporaryDirectory() as otra:
                    recorrido = descubrimiento.recorrer(area=Path(otra))
                self.assertFalse(recorrido.censo.completo)
                self.assertEqual(recorrido.censo.motivo, "el índice no lista ningún curso")

    def test_una_respuesta_de_otra_direccion_no_es_la_pagina_pedida(self) -> None:
        """Una redirección a otra ruta o idioma deja la página sin noticia."""
        self.servir()
        adquirida = adquisicion.recibir_indice(1, area=self.area)
        recepcion = leer_recepcion(
            adquirida.recepcion.cuerpo.ruta.read_bytes(), adquirida.recepcion.recibo.ruta.read_bytes()
        )
        redirigida = replace(recepcion.captura, url_final="https://www.life-global.org/en/allcourses?page=1")
        with self.assertRaises(indice.ErrorIndiceHpLife):
            indice.extraer_indice(recepcion.cuerpo, redirigida)
