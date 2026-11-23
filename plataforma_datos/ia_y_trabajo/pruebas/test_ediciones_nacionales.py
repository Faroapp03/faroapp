"""Sondas de las ediciones oficiales GBR/BRA, sin autorizar cambios de método."""

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import plataforma_datos.ia_y_trabajo.fuentes.ia_nacional_bra.lector as bra
import plataforma_datos.ia_y_trabajo.fuentes.ia_nacional_gbr.lector as gbr
from plataforma_datos.comun import red
from plataforma_datos.comun.nucleo import Descarga, FormatoInesperado

ONS = b"""<div id="results"><ul class="ons-document-list"><li><a
href="/businessindustryandtrade/business/businessservices/articles/artificialintelligenceinukbusinesses/2023to2026"
data-gtm-search-result-title="Artificial intelligence in UK businesses"
data-gtm-search-result-url="/businessindustryandtrade/business/businessservices/articles/artificialintelligenceinukbusinesses/2023to2026"
data-gtm-search-result-release-date="20260720">2023 to 2026</a></li></ul></div>"""
CETIC = """<h2 class="page-title">ICT Enterprises - 2025</h2>
<ul aria-labelledby="anosDropdown"><li><a href="#">2025</a><ul><li>
<a href="/en/tics/pesquisa/2025/empresas/">Empresas</a></li></ul></li></ul>
<a href="/en/tics/pesquisa/2025/empresas/H9/">H9 - Empresas Que Utilizaram Tecnologias De Inteligência Artificial
</a>""".encode()


class Ediciones(unittest.TestCase):
    """Una sucesora o un catálogo ambiguo se detienen antes de tocar los originales."""

    def setUp(self) -> None:
        """Cada fuente consulta su procedencia y sus originales en una carpeta temporal."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        for modulo in (gbr, bra):
            original = Path(temporal.name) / modulo.FUENTE
            for nombre, ruta in (("ORIGINAL", original), ("PROCEDENCIA", original / "procedencia.json")):
                parche = patch.object(modulo, nombre, ruta)
                parche.start()
                self.addCleanup(parche.stop)

    def test_actuales(self) -> None:
        """La edición vigente conserva identificador y fecha explícitos del catálogo."""
        self.assertEqual(gbr.edicion_del_catalogo(ONS), {"url": gbr.ARTICULO, "publicado": "2026-07-20"})
        self.assertEqual(bra.edicion_del_catalogo(CETIC), {"anio": 2025})
        for modulo, contenido in ((gbr, ONS), (bra, CETIC)):
            modulo.comprobar_edicion(modulo.edicion_del_catalogo(contenido))

    def test_ons_no_oculta_sucesora_sin_metadatos(self) -> None:
        """Todo enlace del listado debe ser una edición identificada por completo."""
        nueva = ONS[ONS.index(b"<li>") : ONS.index(b"</li>") + len(b"</li>")].replace(b"2023to2026", b"2023to2027")
        for atributo in (
            b'data-gtm-search-result-title="Artificial intelligence in UK businesses"',
            b'data-gtm-search-result-url="/businessindustryandtrade/business/businessservices/articles/'
            b'artificialintelligenceinukbusinesses/2023to2027"',
            b'data-gtm-search-result-release-date="20260720"',
        ):
            with self.subTest(atributo=atributo), self.assertRaises(FormatoInesperado):
                gbr.edicion_del_catalogo(ONS.replace(b"</ul>", nueva.replace(atributo, b"") + b"</ul>"))

    def test_cetic_enlaces_historicos_y_otra_unidad_no_cambian_el_maximo(self) -> None:
        """Los archivos antiguos usan otra ruta y pueden incluir microempresas, otra base."""
        antigua = b"""<li><a href="#">2017</a><ul><li>
<a href="/en/tics/empresas/2017/empresas/">Empresas</a>
<a href="/en/tics/empresas/2017/microempresas/">Microempresas</a></li></ul></li>"""
        self.assertEqual(bra.edicion_del_catalogo(CETIC.replace(b"</ul>\n<a", antigua + b"</ul>\n<a")), {"anio": 2025})

    def test_sucesoras_antes_de_escrituras_incluso_con_aceptacion(self) -> None:
        """Aceptar bytes distintos no acepta otra edición ni otra figura o método."""
        casos = ((gbr, ONS.replace(b"2023to2026", b"2023to2027")), (bra, CETIC.replace(b"2025", b"2026")))
        for modulo, contenido in casos:
            with self.subTest(fuente=modulo.FUENTE):
                descarga = Descarga(contenido, modulo.CATALOGO["url"], "text/html")
                with (
                    patch.object(red, "descargar_url", return_value=descarga),
                    patch.object(red, "conservar_o_sustituir") as conservar,
                    patch.object(modulo, "descargar_originales") as originales,
                    patch.object(modulo, "guardar_json") as guardar,
                    self.assertRaisesRegex(FormatoInesperado, "Revisar"),
                ):
                    modulo.descargar(aceptar_cambio=True)
                conservar.assert_not_called()
                originales.assert_not_called()
                guardar.assert_not_called()

    def test_descarga_actual_vincula_catalogo_y_edicion(self) -> None:
        """El catálogo comprobado se conserva con recibo y procedencia del mismo intento."""
        for modulo, contenido in ((gbr, ONS), (bra, CETIC)):
            with self.subTest(fuente=modulo.FUENTE):
                descarga = Descarga(contenido, modulo.CATALOGO["url"], "text/html")
                with (
                    patch.object(red, "descargar_url", return_value=descarga),
                    patch.object(red, "conservar_o_sustituir", return_value=contenido) as conservar,
                    patch.object(modulo, "descargar_originales", return_value=[{"original": True}]) as originales,
                    patch.object(red, "observar_original") as observar,
                    patch.object(modulo.time, "sleep"),
                    patch.object(modulo, "guardar_json") as guardar,
                ):
                    modulo.descargar()
                conservar.assert_called_once()
                observar.assert_called_once_with(modulo.CATALOGO["url"], descarga, contenido)
                originales.assert_called_once_with(modulo.ARCHIVOS, modulo.ORIGINAL, False)
                procedencia = guardar.call_args.args[1]
                self.assertEqual(procedencia["edicion"], modulo.EDICION)
                self.assertEqual(procedencia["archivos"], [{"original": True}])
                self.assertEqual(len(procedencia["descubrimiento"]), 1)
                self.assertEqual(procedencia["descubrimiento"][0]["url_final"], modulo.CATALOGO["url"])

    def test_catalogos_invalidos(self) -> None:
        """Ausencias, duplicados, dominios ajenos y UTF-8 inválido no acreditan vigencia."""
        for modulo, contenido in ((gbr, ONS), (bra, CETIC)):
            variantes = (
                b"",
                b"\xff",
                contenido + contenido,
                contenido.replace(b"/en/tics/", b"https://otro.invalid/en/tics/")
                if modulo is bra
                else contenido.replace(b"20260720", b"20260230"),
            )
            for variante in variantes:
                with self.subTest(fuente=modulo.FUENTE, contenido=variante[:60]), self.assertRaises(FormatoInesperado):
                    modulo.edicion_del_catalogo(variante)

    def test_cetic_titulo_y_selector_deben_coincidir(self) -> None:
        """El año del encabezado no suplanta el selector ni la tabla H9 publicada."""
        for antes, despues in (
            (b"ICT Enterprises - 2025", b"ICT Enterprises - 2024"),
            (b"/H9/", b"/H10/"),
            (b"anosDropdown", b"otro"),
        ):
            with self.subTest(cambio=despues), self.assertRaises(FormatoInesperado):
                bra.edicion_del_catalogo(CETIC.replace(antes, despues))

    def test_atributos_de_identidad_duplicados_no_se_sobrescriben(self) -> None:
        """Un segundo href o atributo de edición no oculta el primero, aunque sea válido."""
        casos = (
            (gbr, ONS, b'href="/', b'href="https://otro.invalid/" href="/'),
            (gbr, ONS, b'id="results"', b'id="otro" id="results"'),
            (gbr, ONS, b'class="ons-document-list"', b'class="otro" class="ons-document-list"'),
            (
                gbr,
                ONS,
                b"data-gtm-search-result-release-date=",
                b'data-gtm-search-result-release-date="20270720" data-gtm-search-result-release-date=',
            ),
            (
                bra,
                CETIC,
                b'href="/en/tics/pesquisa/2025/empresas/"',
                b'href="https://otro.invalid/" href="/en/tics/pesquisa/2025/empresas/"',
            ),
            (bra, CETIC, b'aria-labelledby="anosDropdown"', b'aria-labelledby="otro" aria-labelledby="anosDropdown"'),
            (bra, CETIC, b'class="page-title"', b'class="otro" class="page-title"'),
        )
        for modulo, contenido, antes, despues in casos:
            with (
                self.subTest(fuente=modulo.FUENTE, atributo=antes),
                self.assertRaisesRegex(FormatoInesperado, "duplicad"),
            ):
                modulo.edicion_del_catalogo(contenido.replace(antes, despues))


if __name__ == "__main__":
    unittest.main()
