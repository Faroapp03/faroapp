"""Ciclo completo de HP LIFE con altas por su índice: recibir, admitir, componer e instalar, sin red."""

import re
import sqlite3
import unittest
from contextlib import closing
from http import HTTPStatus
from unittest.mock import patch

from plataforma_datos.comun.nucleo import FormatoInesperado
from plataforma_datos.cursos import almacen_catalogo as almacen
from plataforma_datos.cursos import cobertura_catalogo
from plataforma_datos.cursos import operacion_fuente as fuente
from plataforma_datos.cursos import recepciones_catalogo as transporte
from plataforma_datos.cursos.fuentes.hp_life import gratuidad, indice, pendientes
from plataforma_datos.cursos.pruebas import ayuda_indice_hp as indice_hp
from plataforma_datos.cursos.pruebas import test_hp_life_fallos_por_unidad as base
from plataforma_datos.cursos.pruebas.ayuda_panel_copia import InstalacionConPanel
from plataforma_datos.orquestacion.estado_panel import salida_parcial

CONOCIDOS = [431, 432]
NUEVO = 433
URL_NUEVO = f"https://www.life-global.org/es/course/{NUEVO}"
Fichas = dict[int, str | int | bytes | tuple[int, bytes] | None]


class AltasHpPruebas(InstalacionConPanel, unittest.TestCase):
    """Parte de dos cursos instalados; el índice trae un tercero."""

    TIPO_OBSERVADO = "recurso"
    setUp = base.FallosPorUnidadHpPruebas.setUp
    componer = base.FallosPorUnidadHpPruebas.componer
    ofertas = staticmethod(base.FallosPorUnidadHpPruebas.ofertas)
    evidencia_de_consulta = base.FallosPorUnidadHpPruebas.evidencia_de_consulta

    def consultar(
        self, hora: str, paginas: dict[int, bytes], fichas: Fichas | None = None, *, ayuda: bytes | None = None
    ) -> bool:
        """Recibe, prepara y admite HP con el índice y las fichas dadas.

        `fichas` da por curso el estado publicado, un código de error, bytes de respuesta o None (sin respuesta);
        una pareja (código, cuerpo) responde eso tal cual; lo no indicado se publica. `ayuda` es el cuerpo de la
        página de ayuda; por defecto trae la declaración de gratuidad intacta.

        Returns:
            Si la recepción terminó sin fallo total.
        """
        fichas = fichas or {}

        def responder(url: str, **_opciones: object) -> transporte.RespuestaCatalogo:
            inicio, fin = f"2026-10-23T{hora}:00+00:00", f"2026-10-23T{hora}:01+00:00"
            if url == gratuidad.URL_AYUDA:
                return indice_hp.ayuda(url, inicio, fin, cuerpo=ayuda)
            if url.startswith(indice.INDICE):
                return indice_hp.respuesta(url, paginas, inicio, fin)
            numero = int(re.search(r"/course/(\d+)", url).group(1))
            dato = fichas.get(numero, "Published")
            if dato is None:
                return transporte.RespuestaCatalogo(url=url, inicio_utc=inicio, fin_utc=fin, cuerpo=None, error="x")
            if isinstance(dato, tuple):
                http, cuerpo = dato
                return transporte.RespuestaCatalogo(
                    url=url,
                    inicio_utc=inicio,
                    fin_utc=fin,
                    cuerpo=cuerpo,
                    url_final=url,
                    http=http,
                    completo=True,
                    content_type="text/html; charset=utf-8",
                )
            cuerpo = (
                dato
                if isinstance(dato, bytes)
                else b"<html>Error</html>"
                if isinstance(dato, int)
                else base.cuerpo_sintetico(numero, estado=dato)
            )
            http = dato if isinstance(dato, int) else HTTPStatus.OK
            return transporte.RespuestaCatalogo(
                url=url,
                inicio_utc=inicio,
                fin_utc=fin,
                cuerpo=cuerpo,
                url_final=url,
                http=http,
                completo=True,
                content_type="text/html; charset=utf-8",
            )

        with self._rutas_globales(), patch.object(transporte, "consultar", side_effect=responder):
            try:
                fuente.descargar("hp_life", raiz=self.raiz)
            except FormatoInesperado:
                return False
            fuente.preparar("hp_life", raiz=self.raiz)
            fuente.validar("hp_life", raiz=self.raiz)
        return True

    def programas(self) -> set[str]:
        """Identidades de HP LIFE en el catálogo instalado.

        Returns:
            Identidades de los programas.
        """
        ruta = almacen.solicitud(self.raiz / almacen.RUTA).snapshot.ruta
        with closing(sqlite3.connect(ruta.as_uri() + "?mode=ro&immutable=1", uri=True)) as conexion:
            return {f[0] for f in conexion.execute("SELECT id FROM programas WHERE proveedor_id='hp-life'")}

    def urls_de_evidencias(self, id: str) -> set[str]:
        """Direcciones de las evidencias que sostienen un programa.

        Returns:
            URL de cada evidencia vinculada al programa.
        """
        ruta = almacen.solicitud(self.raiz / almacen.RUTA).snapshot.ruta
        with closing(sqlite3.connect(ruta.as_uri() + "?mode=ro&immutable=1", uri=True)) as conexion:
            return {
                f[0]
                for f in conexion.execute(
                    "SELECT e.url FROM evidencias e JOIN vinculos_evidencia v ON v.evidencia_id=e.id "
                    "WHERE v.programa_id=?",
                    (id,),
                )
            }

    def test_un_curso_nuevo_del_indice_entra_como_alta_con_la_evidencia_del_indice_y_de_su_ficha(self) -> None:
        """La alta queda en el catálogo y se ofrece; la sostienen su ficha y la página del índice."""
        self.assertTrue(self.consultar("04:00", indice_hp.paginas([*CONOCIDOS, NUEVO])))
        conjunto = fuente.leer_validado("hp_life", self.raiz)
        self.assertEqual(sorted(conjunto["indice"]["cursos"]), [f"hp-life:{n}:es" for n in (*CONOCIDOS, NUEVO)])
        self.assertTrue(conjunto["indice"]["completo"])
        self.assertNotIn("consulta_parcial", conjunto)
        self.componer("2026-10-23T04:30:00Z")
        self.assertIn(f"hp-life:{NUEVO}:es", self.programas())
        self.assertIn(URL_NUEVO, self.ofertas(self.componer("2026-10-23T04:30:00Z")))
        evidencias = self.urls_de_evidencias(f"hp-life:{NUEVO}:es")
        self.assertIn(URL_NUEVO, evidencias)
        self.assertIn(indice.url_pagina(1), evidencias)

    def test_indice_sin_paginas_no_da_altas_ni_bajas_y_lo_dice(self) -> None:
        """Con todas las páginas caídas la consulta de fichas sigue y el conjunto declara el índice parcial."""
        self.assertTrue(self.consultar("04:00", {}))
        conjunto = fuente.leer_validado("hp_life", self.raiz)
        self.assertFalse(conjunto["indice"]["completo"])
        self.assertEqual(conjunto["indice"]["motivo"], "ninguna página legible")
        self.assertEqual(len(conjunto["recepciones"]), len(CONOCIDOS))
        self.componer("2026-10-23T04:30:00Z")
        self.assertEqual(self.programas(), {f"hp-life:{n}:es" for n in CONOCIDOS})

    def test_indice_parcial_no_da_altas_a_medias_ni_bajas(self) -> None:
        """Una página con el total que no cuadra no retira un conocido ni da de alta lo que la ficha no acredita."""
        mayor = {n: c.replace(b'"totalCourses": 1', b'"totalCourses": 40') for n, c in indice_hp.paginas([431]).items()}
        self.assertTrue(self.consultar("04:00", mayor))
        conjunto = fuente.leer_validado("hp_life", self.raiz)
        self.assertEqual(conjunto["indice"]["motivo"], "las páginas no suman el total declarado")
        self.componer("2026-10-23T04:30:00Z")
        self.assertEqual(self.programas(), {f"hp-life:{n}:es" for n in CONOCIDOS})
        self.assertEqual(
            set(self.ofertas(self.componer("2026-10-23T04:30:00Z"))), {u for u, _n in base.UNIDADES.values()}
        )

    def test_pagina_caida_deja_lo_instalado_como_estaba_y_lo_dice(self) -> None:
        """Instalada una alta, un índice que cae después no la retira ni cambia lo publicado."""
        self.consultar("04:00", indice_hp.paginas([*CONOCIDOS, NUEVO]))
        self.componer("2026-10-23T04:30:00Z")
        antes = self.ofertas(self.componer("2026-10-23T04:30:00Z"))
        self.assertTrue(self.consultar("05:00", {}))
        self.assertFalse(fuente.leer_validado("hp_life", self.raiz)["indice"]["completo"])
        despues = self.ofertas(self.componer("2026-10-23T05:30:00Z"))
        self.assertEqual(set(despues), set(antes))
        self.assertIn(URL_NUEVO, despues)

    def test_ficha_de_una_alta_mal_formada_o_caida_no_para_la_fuente(self) -> None:
        """Un 200 ilegible o un corte dejan a ese curso sin noticia; los demás se confirman."""
        for dato in (b"<html>sin datos</html>", None, HTTPStatus.SERVICE_UNAVAILABLE):
            with self.subTest(dato=dato):
                self.assertTrue(self.consultar("04:00", indice_hp.paginas([*CONOCIDOS, NUEVO]), {NUEVO: dato}))
                self.componer("2026-10-23T04:30:00Z")
                self.assertNotIn(f"hp-life:{NUEVO}:es", self.programas())
                self.assertEqual(len(self.ofertas(self.componer("2026-10-23T04:30:00Z"))), len(CONOCIDOS))

    def test_curso_de_otro_idioma_queda_visto_sin_alta(self) -> None:
        """El censo lo cuenta y no se consulta ni se da de alta su ficha."""
        paginas = indice_hp.paginas(CONOCIDOS, {900: "en"})
        self.assertTrue(self.consultar("04:00", paginas))
        conjunto = fuente.leer_validado("hp_life", self.raiz)
        self.assertEqual(conjunto["indice"]["otros_idiomas"], ["hp-life:900:en"])
        self.assertTrue(conjunto["indice"]["completo"])
        self.assertEqual(len(conjunto["recepciones"]), len(CONOCIDOS))

    # -- Declaración de gratuidad -----------------------------------------------------------------------------------

    def comprobado_el(self, id: str, corte: str) -> str:
        """Fecha de la última comprobación válida de un curso en el panel.

        Returns:
            Instante de la comprobación.
        """
        return self.panel(corte)[id]["comprobadoEl"]

    def test_la_declaracion_de_gratuidad_intacta_deja_la_consulta_como_hoy(self) -> None:
        """Con la ayuda íntegra no hay aviso y las comprobaciones se renuevan."""
        paginas = indice_hp.paginas(CONOCIDOS)
        self.assertTrue(self.consultar("04:00", paginas))
        self.componer("2026-10-23T04:30:00Z")
        self.assertTrue(fuente.leer_validado("hp_life", self.raiz)["gratuidad"]["intacta"])
        self.assertIsNone(salida_parcial(self.raiz, "hp_life"))
        self.assertTrue(cobertura_catalogo.comprobada(self.raiz, self.evidencia_de_consulta()))
        self.assertEqual(self.comprobado_el(base.PRIMERA, "2026-10-23T04:30:00Z"), "2026-10-23T04:00:01Z")

    def test_sin_la_declaracion_o_con_otro_texto_es_un_fallo_de_metodo_y_no_cambia_la_oferta(self) -> None:
        """No se retira ni se renueva nada, nadie pasa a «de pago» ni a «gratuito», y el panel lo dice."""
        paginas = indice_hp.paginas(CONOCIDOS)
        self.assertTrue(self.consultar("04:00", paginas))
        antes = self.ofertas(self.componer("2026-10-23T04:30:00Z"))
        casos = {
            "sin la declaración": indice_hp.cuerpo_de_ayuda(indice_hp.OTRAS_AYUDAS),
            "con otro texto": indice_hp.cuerpo_de_ayuda(
                "<h3>Los cursos de HP LIFE son gratuitos</h3><p>Solo algunos cursos son gratuitos.</p>"
            ),
            "con otro encabezado": indice_hp.cuerpo_de_ayuda(
                "<h3>Los cursos de HP LIFE son de pago</h3><p>Son de pago para todas las personas.</p>"
            ),
            "ilegible": b"<html>sin datos</html>",
        }
        for hora, (caso, cuerpo) in zip(("05:00", "06:00", "07:00", "08:00"), casos.items(), strict=True):
            with self.subTest(caso=caso):
                self.assertTrue(self.consultar(hora, paginas, ayuda=cuerpo))
                self.assertFalse(fuente.leer_validado("hp_life", self.raiz)["gratuidad"]["intacta"])
                # Con la ayuda respondiendo pero sin la declaración, la fuente no se acredita.
                self.assertFalse(cobertura_catalogo.comprobada(self.raiz, self.evidencia_de_consulta()))
                self.assertEqual(salida_parcial(self.raiz, "hp_life")["motivos"], [gratuidad.AVISO])
                despues = self.ofertas(self.componer(f"2026-10-23T{hora[:2]}:30:00Z"))
                self.assertEqual(set(despues), set(antes))
                self.assertEqual(
                    {u: o["hechos"] for u, o in despues.items()}, {u: o["hechos"] for u, o in antes.items()}
                )
                self.assertEqual(
                    self.comprobado_el(base.PRIMERA, f"2026-10-23T{hora[:2]}:30:00Z"), "2026-10-23T04:00:01Z"
                )
                fallos = [o for o in self.observaciones(base.PRIMERA) if o["resultado"] == "fallo"]
                self.assertEqual({o["detalle"]["motivo"] for o in fallos}, {gratuidad.MOTIVO_DE_FALLO})
        self.assertTrue(self.consultar("09:00", paginas))
        self.assertIsNone(salida_parcial(self.raiz, "hp_life"))
        self.componer("2026-10-23T09:30:00Z")
        self.assertEqual(self.comprobado_el(base.PRIMERA, "2026-10-23T09:30:00Z"), "2026-10-23T09:00:01Z")

    def test_una_alta_con_la_gratuidad_sin_comprobar_lleva_ese_motivo(self) -> None:
        """No entra, y su pendiente dice la causa verdadera; con la declaración intacta, entra."""
        paginas = indice_hp.paginas([*CONOCIDOS, NUEVO])
        cambiada = indice_hp.cuerpo_de_ayuda(indice_hp.OTRAS_AYUDAS)
        self.assertTrue(self.consultar("04:00", paginas, ayuda=cambiada))
        with patch.object(pendientes, "registrar", wraps=pendientes.registrar) as registrar:
            self.componer("2026-10-23T04:30:00Z")
        self.assertNotIn(f"hp-life:{NUEVO}:es", self.programas())
        motivos = {(c.args[0].id, c.args[0].motivo) for c in registrar.call_args_list}
        self.assertEqual(motivos, {(f"hp-life:{NUEVO}:es", gratuidad.MOTIVO_DE_FALLO)})
        self.assertTrue(self.consultar("05:00", paginas))
        with patch.object(pendientes, "registrar", wraps=pendientes.registrar) as registrar:
            self.componer("2026-10-23T05:30:00Z")
        registrar.assert_not_called()
        self.assertIn(f"hp-life:{NUEVO}:es", self.programas())

    def test_la_ayuda_que_no_responde_deja_la_declaracion_sin_comprobar(self) -> None:
        """Sin cuerpo, con un código de error o incompleta no hay declaración que leer."""
        leer = patch.object(gratuidad, "leer_recepcion", side_effect=gratuidad.lector.ErrorFichaHpLife("x"))
        with leer:
            self.assertEqual(gratuidad.estado({"cuerpo": {}, "recibo": {}}, lambda _r: b"")["intacta"], False)
        self.assertEqual(gratuidad.estado({"cuerpo": None, "recibo": None}, lambda _r: b"")["intacta"], False)
        self.assertIsNone(gratuidad.estado(None, lambda _r: b""))
