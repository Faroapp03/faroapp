"""Pruebas de las citas de los derechos en el trabajo: la versión vigente de cada artículo y la comprobación literal.

Las de los derechos ante la tecnología están en test_tecnologia.py.
"""

import copy
import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest import mock

import plataforma_datos.derechos.fuentes.derechos.lector as derechos
from plataforma_datos.comun.nucleo import Descarga, ErrorFuente, FormatoInesperado

# Una respuesta de la API del BOE con dos versiones del artículo y la nota de modificaciones (texto abreviado).
XML = """<response><data><bloque id="a23">
<version id_norma="BOE-A-2015-11430" fecha_vigencia="20151113"><p>Texto de 2015.</p></version>
<version id_norma="BOE-A-2021-11472" fecha_vigencia="20210711"><p class="parrafo">d) A la formaci&#243;n vigente.</p>
<blockquote><p class="nota_pie">Se modifica la letra a).</p></blockquote></version>
</bloque></data></response>"""
ANIDAMIENTO_XML_PROFUNDO = 1100


class PruebaCitas(unittest.TestCase):
    """Las citas salen de la versión vigente y se comprueban letra a letra."""

    def test_version_vigente_sin_la_nota_de_modificaciones(self) -> None:
        """Se toma la versión de vigencia más reciente, sin la nota del BOE que la acompaña."""
        vigencia, texto = derechos.version_vigente(XML)
        self.assertEqual(vigencia, "20210711")
        self.assertEqual(texto, "d) A la formación vigente.")

    def test_un_fragmento_que_no_esta_en_su_fuente_detiene_la_preparacion(self) -> None:
        """Basta una letra distinta para que no se den por buenas las citas."""
        textos = {
            norma.enlace: " ".join(
                fragmento
                for cita in derechos.CITADAS
                if cita["enlace"].startswith(norma.enlace)
                for fragmento in cita["fragmentos"]
            )
            for norma in (derechos.ESTATUTO, derechos.PERMISO)
        }
        self.assertEqual(len(derechos.citas_comprobadas(textos)), len(derechos.CITADAS))
        self.assertIn("200", textos[derechos.PERMISO.enlace])
        cambiado = {**textos, derechos.PERMISO.enlace: textos[derechos.PERMISO.enlace].replace("200", "250")}
        with self.assertRaises(ErrorFuente):
            derechos.citas_comprobadas(cambiado)

    def test_cada_cita_enlaza_su_articulo_en_el_boe(self) -> None:
        """El Estatuto, en su artículo 23; el Real Decreto 694/2017, en su artículo 29 (bloque a2-11 de la API).

        Las URL se escriben a propósito aquí, sin tomarlas de la fuente: la prueba fija el contrato de los enlaces.
        """
        self.assertEqual(derechos.ESTATUTO.enlace, "https://www.boe.es/buscar/act.php?id=BOE-A-2015-11430#a23")
        self.assertEqual(derechos.PERMISO.enlace, "https://www.boe.es/buscar/act.php?id=BOE-A-2017-7769#a2-11")
        self.assertTrue(all(cita["enlace"].startswith("https://www.boe.es/") for cita in derechos.CITADAS))


class PruebaMotivoDelFallo(unittest.TestCase):
    """Un control que falla porque los originales no sostienen la comprobación dice por qué."""

    def test_se_comprueba_devuelve_el_motivo(self) -> None:
        """El resultado y un motivo vacío, o None y el mensaje del error de la fuente."""

        def falla() -> None:
            """Una comprobación que los originales no sostienen.

            Raises:
                ErrorFuente: Siempre, como un original que falta.
            """
            raise ErrorFuente("falta estatuto.xml")

        self.assertEqual(derechos.se_comprueba(lambda: 1), (1, ""))
        self.assertEqual(derechos.se_comprueba(falla), (None, "falta estatuto.xml"))


class PruebaFronteras(unittest.TestCase):
    """Una copia defectuosa o futura no cambia las citas ni se admite sin motivo."""

    def test_la_vigencia_se_elige_el_dia_de_la_copia_no_el_de_una_version_futura(self) -> None:
        """Una redacción publicada con vigencia futura aún no se cita como vigente."""
        xml = XML.replace("</bloque>", '<version fecha_vigencia="20270101"><p>Texto futuro.</p></version></bloque>')
        self.assertEqual(derechos.version_vigente(xml, date(2026, 10, 6)), ("20210711", "d) A la formación vigente."))
        self.assertEqual(derechos.version_vigente(xml, date(2027, 1, 1)), ("20270101", "Texto futuro."))
        with self.assertRaisesRegex(FormatoInesperado, "vigente"):
            derechos.version_vigente(xml, date(2010, 1, 1))

    def test_la_fecha_actual_tampoco_adelanta_una_version_futura(self) -> None:
        """La interfaz sin día explícito tampoco elige el máximo de todas las vigencias publicadas."""
        xml = XML.replace("</bloque>", '<version fecha_vigencia="20270101"><p>Texto futuro.</p></version></bloque>')
        with mock.patch.object(derechos, "hoy_utc", return_value=date(2026, 10, 6)):
            self.assertEqual(derechos.version_vigente(xml), ("20210711", "d) A la formación vigente."))

    def test_el_xml_admite_saltos_atributos_y_cdata_sin_confundirlos_con_etiquetas(self) -> None:
        """El XML se interpreta como XML: un signo mayor dentro de un atributo no es su cierre."""
        xml = """<response><version
            titulo="a > b" fecha_vigencia="20210101"><p><![CDATA[Texto <literal>]]></p>
            <p>Otra <strong>palabra</strong>.</p><blockquote><p>Nota fuera.</p></blockquote>
            </version></response>"""
        self.assertEqual(derechos.version_vigente(xml), ("20210101", "Texto <literal> Otra palabra ."))

    def test_un_xml_profundo_se_lee_sin_depender_de_la_pila_de_python(self) -> None:
        """La estructura de un documento válido no termina con RecursionError por sus elementos anidados."""
        cuerpo = "<span>" * ANIDAMIENTO_XML_PROFUNDO + "Texto." + "</span>" * ANIDAMIENTO_XML_PROFUNDO
        xml = f'<version fecha_vigencia="20210101">{cuerpo}</version>'
        self.assertEqual(derechos.version_vigente(xml), ("20210101", "Texto."))

    def test_el_texto_mixto_conserva_las_colas_sin_incluir_notas(self) -> None:
        """Se conserva el orden de texto e hijos, incluido el texto posterior a una nota omitida."""
        xml = """<version fecha_vigencia="20210101"><p>Primero <em>entre</em> final.</p>
            <blockquote>Nota <b>omitida</b></blockquote> cola <p>Segundo</p></version>"""
        self.assertEqual(derechos.version_vigente(xml), ("20210101", "Primero entre final. cola Segundo"))

    def test_un_xml_roto_o_una_vigencia_imposible_da_error_de_fuente(self) -> None:
        """La fecha y el documento deben ser reales; no se dejan pasar fechas por comparación textual."""
        for xml in ("<version", '<version fecha_vigencia="20260230"><p>Texto</p></version>'):
            with self.subTest(xml=xml), self.assertRaises(FormatoInesperado):
                derechos.version_vigente(xml)

    def test_la_fecha_del_original_es_una_fecha_real(self) -> None:
        """La fecha del nombre que determina la vigencia no admite días imposibles."""
        self.assertEqual(derechos.dia_del_original(Path("norma-2026-10-06.xml")), "2026-10-06")
        with self.assertRaisesRegex(FormatoInesperado, "norma-2026-02-30.xml"):
            derechos.dia_del_original(Path("norma-2026-02-30.xml"))

    def test_cambiar_los_fragmentos_de_la_salida_no_cambia_las_citas(self) -> None:
        """Los consumidores reciben datos propios, sin listas compartidas con el catálogo de citas."""
        textos = {
            norma.enlace: " ".join(
                fragmento
                for cita in derechos.CITADAS
                if cita["enlace"] == norma.enlace
                for fragmento in cita["fragmentos"]
            )
            for norma in derechos.ARTICULOS
        }
        antes = copy.deepcopy(derechos.CITADAS)
        try:
            derechos.citas_comprobadas(textos)[0]["fragmentos"].append("Cambio ajeno")
            self.assertEqual(derechos.CITADAS, antes)
        finally:
            for cita, original in zip(derechos.CITADAS, antes, strict=True):
                cita["fragmentos"][:] = original["fragmentos"]

    def test_la_ausencia_de_un_articulo_dice_cual_falta(self) -> None:
        """Un diccionario incompleto no termina con un KeyError sin contexto."""
        with self.assertRaisesRegex(FormatoInesperado, "BOE-A-2015-11430"):
            derechos.citas_comprobadas({})

    def test_la_extraccion_necesita_el_registro_y_la_huella_del_pdf(self) -> None:
        """La extracción sin metadato de origen falla con motivo antes de leer su contenido."""
        rutas = [Path("pdf-2026-10-07.pdf"), Path("paginas-2026-10-07.json")]
        for registro in ({}, {rutas[1].name: {}}):
            with (
                self.subTest(registro=registro),
                mock.patch.object(derechos, "mas_reciente", side_effect=rutas),
                mock.patch.object(derechos, "registros_previos", return_value=registro),
                mock.patch.object(derechos, "sha256", return_value="pdf"),
                mock.patch.object(derechos, "leer_json") as leer,
                self.assertRaisesRegex(FormatoInesperado, "extracción.*CRL"),
            ):
                derechos.paginas_del_crl()
            leer.assert_not_called()

    def test_la_extraccion_rechaza_paginas_duplicadas_o_sin_forma(self) -> None:
        """Cada página es positiva, única y lleva texto; nunca se sobrescribe silenciosamente."""
        rutas = [Path("pdf.pdf"), Path("paginas.json")]
        pagina = {"pagina": 1, "texto": "Texto de prueba"}
        for paginas in ([pagina, pagina], [{"pagina": True, "texto": "x"}], [{"pagina": 1}], {}):
            with (
                self.subTest(paginas=paginas),
                mock.patch.object(derechos, "mas_reciente", side_effect=rutas),
                mock.patch.object(
                    derechos, "registros_previos", return_value={"paginas.json": {"sha256_de_origen": "h"}}
                ),
                mock.patch.object(derechos, "sha256", return_value="h"),
                mock.patch.object(derechos, "leer_json", return_value=paginas),
                self.assertRaises(FormatoInesperado),
            ):
                derechos.paginas_del_crl()

    def test_preparados_incompletos_no_llegan_a_publicarse(self) -> None:
        """La forma mínima se exige antes de comparar; ni claves ausentes ni null producen trazas."""
        base = {
            "copia": "2026-10-07",
            "vigencias": {},
            "citas": [{"id": cita["id"]} for cita in derechos.CITADAS],
            "tecnologia": {"citas": [], "recomendaciones": {}},
            "clausulas_sectoriales": {"registros": []},
        }
        rotos = [[], {**base, "tecnologia": None}, {**base, "citas": [None]}]
        rotos += [{k: v for k, v in base.items() if k != campo} for campo in base]
        for preparado in rotos:
            with (
                self.subTest(preparado=preparado),
                mock.patch.object(derechos, "controles_de_huella"),
                mock.patch.object(derechos, "procedencia", return_value={"copia": base["copia"]}),
                mock.patch.object(derechos, "leer_json", return_value=preparado),
                mock.patch.object(derechos, "leer_copia", return_value=object()),
                mock.patch.object(derechos, "conjunto", return_value=base),
                mock.patch.object(derechos, "cerrar_validacion") as cerrar,
                self.assertRaisesRegex(FormatoInesperado, "citas.json"),
            ):
                derechos.validar()
            cerrar.assert_not_called()

    def test_una_descarga_fallida_no_deja_originales_nuevos_ni_cambia_la_procedencia(self) -> None:
        """Una respuesta pendiente falla antes de publicar la copia preparada de varios archivos."""
        with tempfile.TemporaryDirectory() as temporal:
            original = Path(temporal) / "derechos"
            original.mkdir()
            procedencia = original / "procedencia.json"
            procedencia.write_bytes(b'{"archivos":[]}')
            uno = {
                "archivo": "uno.xml",
                "nivel": "oficial",
                "titulo": "Uno",
                "url": "https://example.test/uno",
                "licencia": "Prueba",
                "cabeceras": {},
            }
            dos = {**uno, "archivo": "dos.xml"}
            descarga = Descarga(b"nuevo", "https://example.test/uno", "application/xml")
            with (
                mock.patch.object(derechos, "ORIGINAL", original),
                mock.patch.object(derechos, "PROCEDENCIA", procedencia),
                mock.patch.object(derechos, "archivos_de_la_copia", return_value=[uno, dos]),
                mock.patch.object(derechos, "descargar_url", side_effect=[descarga, OSError("fallo simulado")]),
                mock.patch.object(derechos.time, "sleep"),
                self.assertRaisesRegex(OSError, "fallo simulado"),
            ):
                derechos.descargar(hoy=date(2026, 10, 7))
            self.assertEqual(list(original.iterdir()), [procedencia])
            self.assertEqual(procedencia.read_bytes(), b'{"archivos":[]}')

    def test_una_captura_completa_publica_la_copia_y_conserva_el_registro_de_extraccion(self) -> None:
        """La captura correcta registra ambos originales y mantiene el respaldo manual del CRL."""
        with tempfile.TemporaryDirectory() as temporal:
            original = Path(temporal) / "derechos"
            original.mkdir()
            procedencia = original / "procedencia.json"
            extraccion = {"archivo": "crl-paginas.json", "nivel": "extracción", "sha256_de_origen": "pdf"}
            archivo = {
                "archivo": "uno.xml",
                "nivel": "oficial",
                "titulo": "Uno",
                "url": "https://example.test/uno",
                "licencia": "Prueba",
                "cabeceras": {"Accept": "application/xml"},
            }
            archivos = [archivo, {**archivo, "archivo": "dos.xml"}]
            descargas = [Descarga(texto, archivo["url"], "application/xml") for texto in (b"uno", b"dos")]
            with (
                mock.patch.object(derechos, "ORIGINAL", original),
                mock.patch.object(derechos, "PROCEDENCIA", procedencia),
                mock.patch.object(derechos, "registros_previos", return_value={extraccion["archivo"]: extraccion}),
                mock.patch.object(derechos, "archivos_de_la_copia", return_value=archivos),
                mock.patch.object(derechos, "descargar_url", side_effect=descargas) as descargar,
                mock.patch.object(derechos.time, "sleep") as pausa,
            ):
                derechos.descargar(hoy=date(2026, 10, 7))
            self.assertEqual((original / "uno.xml").read_bytes(), b"uno")
            self.assertEqual((original / "dos.xml").read_bytes(), b"dos")
            registrada = derechos.leer_json(procedencia)
            self.assertEqual(registrada["copia"], "2026-10-07")
            self.assertEqual([r["archivo"] for r in registrada["archivos"]], ["uno.xml", "dos.xml", "crl-paginas.json"])
            self.assertEqual(registrada["archivos"][-1], extraccion)
            self.assertEqual(archivos[0]["cabeceras"], {"Accept": "application/xml"})
            self.assertEqual(descargar.call_count, len(archivos))
            pausa.assert_called_once_with(derechos.PAUSA_ENTRE_PETICIONES_S)


if __name__ == "__main__":
    unittest.main()
