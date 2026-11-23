"""Descubrimiento de las dos tablas TIC sin otra fuente ni retirada implícita."""

import copy
import unittest
from unittest import mock

from plataforma_datos.comun.nucleo import FormatoInesperado
from plataforma_datos.mercado.fuentes.empresas import lector
from plataforma_datos.mercado.fuentes.empresas.piezas import plantilla_tic


class PruebaDescubrimientoPlantilla(unittest.TestCase):
    """La ampliación pertenece a los dos capítulos oficiales, sin modificar las partes de D.1."""

    def test_dos_tablas_con_la_misma_edicion_y_no_un_indice_aislado(self) -> None:
        """Las URL se toman de ambos capítulos y se contrastan con el contrato revisado."""
        paginas = {
            "sectores": '<a href="/jaxi/Tabla.htm?tpx=82386">Especialistas TIC</a>',
            "comunidades": '<a href="/jaxi/Tabla.htm?tpx=82408">Especialistas TIC</a>',
        }
        bloque = lector.descubrir_plantilla(2026, paginas)
        self.assertEqual(bloque["plantilla_tic"]["tablas"], {"sectores": "82386", "comunidades": "82408"})
        for parte in paginas:
            alteradas = {**paginas, parte: "sin tabla"}
            with self.subTest(parte=parte), self.assertRaises(FormatoInesperado):
                lector.descubrir_plantilla(2026, alteradas)
        paginas["sectores"] += '<a href="/jaxi/Tabla.htm?tpx=99999">Especialistas TIC</a>'
        with self.assertRaises(FormatoInesperado):
            lector.descubrir_plantilla(2026, paginas)
        self.assertEqual(lector.descubrir_plantilla(2025, {}), {})
        self.assertEqual(lector.descubrir_plantilla(2026, dict.fromkeys(plantilla_tic.PARTES, "sin ampliación")), {})

    def test_descriptores_no_aceptan_tablas_o_ediciones_arbitrarias(self) -> None:
        """Ni el JSON de procedencia ni un año nuevo deciden por sí solos qué se descarga."""
        edicion = {
            "anio": 2026,
            "nombre": "2025–1T2026",
            "plantilla_tic": plantilla_tic.metadatos("2025–1T2026", {"sectores": "82386", "comunidades": "82408"}),
        }
        self.assertEqual(len(plantilla_tic.archivos(edicion)), 2)
        self.assertEqual(len(plantilla_tic.archivos(edicion, notas=True)), 2)
        alterada = copy.deepcopy(edicion)
        alterada["plantilla_tic"]["tablas"]["sectores"] = "99999"
        with self.assertRaises(FormatoInesperado):
            plantilla_tic.archivos(alterada)

    def test_perder_ambas_tablas_no_autoriza_retirar_el_bloque_previo(self) -> None:
        """Una observación parcial conserva el conjunto anterior y detiene la descarga."""
        anterior = {"anio": 2026, "nombre": "2025–1T2026", "plantilla_tic": {"contrato": plantilla_tic.IDENTIFICADOR}}
        with (
            mock.patch.object(lector, "edicion_publicada", return_value={"anio": 2026, "nombre": "2025–1T2026"}),
            mock.patch.object(lector, "leer_json", return_value={"edicion": anterior}),
            mock.patch.object(type(lector.PROCEDENCIA), "exists", return_value=True),
            mock.patch.object(lector, "descargar_url") as descargar,
            self.assertRaises(FormatoInesperado),
        ):
            lector.descargar(True)
        descargar.assert_not_called()


if __name__ == "__main__":
    unittest.main()
