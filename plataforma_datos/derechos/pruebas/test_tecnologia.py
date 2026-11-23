"""Pruebas de los derechos ante la tecnología: citas del texto consolidado, resumen del CRL y cláusulas sectoriales."""

import copy
import unittest
from unittest import mock

import plataforma_datos.derechos.fuentes.derechos.piezas.tecnologia as tecnologia
from plataforma_datos.comun.nucleo import ErrorFuente

# Un texto consolidado del BOE en miniatura: dos artículos, una nota de modificación y su fecha de actualización.
CONSOLIDADO = """<html><body><p>Última actualización publicada el 03/10/2026</p>
<div class="bloque" id="a64"><p class="bloque">[Bloque 97: #a64]</p>
<h5 class="articulo">Artículo 64. Derechos de información.</h5>
<p class="parrafo">4. El comité de empresa tendrá derecho a:</p>
<p class="parrafo">d) Ser informado de los algoritmos.</p>
<p class="nota_pie">Se añade la letra d) al apartado 4 por la Ley 12/2021.</p></div>
<div class="bloque" id="a65"><p class="bloque">[Bloque 98: #a65]</p>
<h5 class="articulo">Artículo 65. Capacidad.</h5><p class="parrafo">Texto del 65.</p></div></body></html>"""


class PruebaDerechosAnteLaTecnologia(unittest.TestCase):
    """Las citas del texto consolidado, el resumen del CRL y las cláusulas sectoriales se comprueban letra a letra."""

    def test_cada_articulo_con_su_bloque_y_sin_las_notas_del_boe(self) -> None:
        """El ancla del enlace es el bloque del artículo; las notas de modificación no son texto citado."""
        articulos = tecnologia.bloques_de_articulos(CONSOLIDADO.encode())
        self.assertEqual(articulos[64][0], "a64")
        self.assertIn("d) Ser informado de los algoritmos.", articulos[64][1])
        self.assertFalse(any(parrafo.startswith("Se añade") for parrafo in articulos[64][1]))
        self.assertEqual(articulos[65], ("a65", ["Artículo 65. Capacidad.", "Texto del 65."]))
        self.assertEqual(tecnologia.version_consolidada(CONSOLIDADO.encode()), "2026-10-03")

    def test_una_copia_nueva_equivale_si_sus_articulos_citados_no_cambian(self) -> None:
        """La página cambia de bytes sin cambiar de texto; un cambio en un artículo citado no se admite solo."""
        equivalentes = tecnologia.equivalencia(tecnologia.ESTATUTO)
        original = CONSOLIDADO.encode()
        self.assertTrue(equivalentes(original, original.replace(b"<body>", b"<body><!-- otra visita -->")))
        self.assertFalse(equivalentes(original, original.replace(b"los algoritmos", b"las herramientas")))
        self.assertFalse(equivalentes(original, original.replace(b"03/10/2026", b"10/10/2026")))

    def test_solo_las_letras_enteras_pasan_del_maximo_de_caracteres(self) -> None:
        """Un párrafo entero de más de MAX_CARACTERES solo se admite en una cita de LETRAS_ENTERAS."""
        largo = "x" * (tecnologia.MAX_CARACTERES + 1)
        cita = {"id": "otra", "fuente": "Otra", "norma": "N", "articulo": 1, "fragmentos": [largo]}
        with (
            mock.patch.object(tecnologia, "CITADAS", (cita,)),
            mock.patch.object(tecnologia, "bloques_de_articulos", return_value={1: ("a1", [largo])}),
            mock.patch.object(tecnologia, "version_consolidada", return_value="2026-10-03"),
            self.assertRaisesRegex(ErrorFuente, "fragmento largo"),
        ):
            tecnologia.citas_comprobadas({"N": b""}, "2026-10-12")

    def test_un_sector_del_boe_sin_clausula_detiene_la_comprobacion(self) -> None:
        """EN_EL_BOE se indexa por el sector de CLAUSULAS: un rótulo que no casa no se omite en silencio."""
        with (
            mock.patch.object(tecnologia, "EN_EL_BOE", {"Sector renombrado": ("BOE-A-2025-1", [])}),
            self.assertRaisesRegex(ErrorFuente, "Sector renombrado"),
        ):
            tecnologia.clausulas_comprobadas({}, {})

    def test_un_pasaje_del_crl_que_falta_en_su_pagina_detiene_el_resumen(self) -> None:
        """Cada punto del resumen se apoya en su página: si el pasaje falta, el resumen no se da."""
        paginas = {
            punto["pagina"]: " ".join(ancla for otro in tecnologia.RECOMENDACIONES for ancla in otro["anclas"])
            for punto in tecnologia.RECOMENDACIONES
        }
        self.assertEqual(len(tecnologia.recomendaciones_comprobadas(paginas)), len(tecnologia.RECOMENDACIONES))
        with self.assertRaises(ErrorFuente):
            tecnologia.recomendaciones_comprobadas({**paginas, tecnologia.RECOMENDACIONES[0]["pagina"]: ""})

    def test_los_glifos_de_las_vinetas_no_rompen_un_pasaje(self) -> None:
        """Los caracteres de otras escrituras que dejan las viñetas y los saltos de línea se leen como un espacio."""
        self.assertEqual(tecnologia.texto_de_pagina("de las \u085f\ncompetencias \ufffc"), "de las competencias")

    def test_cada_clausula_lleva_su_boletin_y_su_fecha_de_la_referencia(self) -> None:
        """Las nueve, de sectores distintos; el boletín, su número y su fecha salen de la referencia del documento."""
        self.assertEqual(len(tecnologia.CLAUSULAS), 9)
        self.assertEqual(len({clausula["sector"] for clausula in tecnologia.CLAUSULAS}), len(tecnologia.CLAUSULAS))
        hosteleria = next(clausula for clausula in tecnologia.CLAUSULAS if clausula["sector"].startswith("Hostelería"))
        self.assertEqual((hosteleria["boletin"], hosteleria["numero_boletin"]), ("DOGC", 8827))
        self.assertEqual(hosteleria["fecha_publicacion"], "2023-01-05")
        self.assertIsNone(
            next(clausula for clausula in tecnologia.CLAUSULAS if clausula["sector"] == "Corcho")["codigo_convenio"]
        )


class PruebaFronterasDeTecnologia(unittest.TestCase):
    """Las fuentes ausentes y los resultados mutables no pueden debilitar la comprobación."""

    def test_dos_copias_sin_el_articulo_citado_no_son_equivalentes(self) -> None:
        """Ausente en ambas no significa que el artículo citado sea el mismo."""
        sin_citado = CONSOLIDADO.replace("Artículo 64.", "Artículo 63.").encode()
        self.assertFalse(tecnologia.equivalencia(tecnologia.ESTATUTO)(sin_citado, sin_citado))

    def test_una_norma_ausente_nombra_su_identificador(self) -> None:
        """El motivo identifica qué original falta, antes de buscar sus artículos."""
        with self.assertRaisesRegex(ErrorFuente, "BOE-A-2015-11430"):
            tecnologia.citas_comprobadas({}, "2026-10-07")

    def test_un_convenio_ausente_nombra_su_identificador(self) -> None:
        """La cláusula que requiere BOE no puede saltarse por faltar el texto del convenio."""
        paginas = {
            pagina: " ".join([registro["referencia"], *registro["articulos"]])
            for registro in tecnologia.CLAUSULAS[:1]
            for pagina in registro["paginas"]
        }
        with self.assertRaisesRegex(ErrorFuente, "BOE-A-2025-3083"):
            tecnologia.clausulas_comprobadas(paginas, {})

    def test_las_anclas_de_salida_no_mutan_el_catalogo_del_crl(self) -> None:
        """Una aplicación que cambia la salida no cambia la evidencia de la llamada siguiente."""
        paginas = {punto["pagina"]: " ".join(punto["anclas"]) for punto in tecnologia.RECOMENDACIONES}
        antes = copy.deepcopy(tecnologia.RECOMENDACIONES)
        try:
            tecnologia.recomendaciones_comprobadas(paginas)[0]["anclas"].append("Cambio ajeno")
            self.assertEqual(tecnologia.RECOMENDACIONES, antes)
        finally:
            for punto, previo in zip(tecnologia.RECOMENDACIONES, antes, strict=True):
                punto["anclas"][:] = previo["anclas"]

    def test_los_fragmentos_y_las_paginas_de_salida_no_mutan_sus_catalogos(self) -> None:
        """Las otras dos salidas tampoco comparten sus listas internas con las constantes."""
        cita = {"id": "prueba", "norma": "N", "articulo": 1, "fuente": "Prueba", "fragmentos": ["Texto."]}
        registro = {"sector": "Sector", "referencia": "Referencia", "articulos": ["Artículo"], "paginas": [1]}
        with (
            mock.patch.object(tecnologia, "CITADAS", (cita,)),
            mock.patch.object(tecnologia, "bloques_de_articulos", return_value={1: ("a1", ["Texto."])}),
            mock.patch.object(tecnologia, "version_consolidada", return_value="2026-10-07"),
        ):
            tecnologia.citas_comprobadas({"N": b""}, "2026-10-07")[0]["fragmentos"].append("Ajeno")
        self.assertEqual(cita["fragmentos"], ["Texto."])
        with (
            mock.patch.object(tecnologia, "CLAUSULAS", (registro,)),
            mock.patch.object(tecnologia, "EN_EL_BOE", {}),
        ):
            tecnologia.clausulas_comprobadas({1: "Referencia Artículo"}, {})[0]["paginas"].append(2)
        self.assertEqual(registro["paginas"], [1])


if __name__ == "__main__":
    unittest.main()
