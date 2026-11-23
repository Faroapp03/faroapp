"""Ciber tiene páginas reales mayores que una ficha HTML: cotas propias sin elevar las otras."""

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from plataforma_datos.cursos import cobertura_catalogo, trozos_catalogo
from plataforma_datos.cursos import operacion_fuente as operacion
from plataforma_datos.cursos import recepciones_catalogo as recepciones
from plataforma_datos.cursos.contrato_entrega_catalogo import ErrorEntregaCatalogo

LIMITE_CIBER = 64 * 1024 * 1024
URL = "https://www.cibervoluntarios.org/api/public/activity_catalogs?lang=es&itemsPerPage=100&page=1"


class LimitesRecepcionCiberPruebas(unittest.TestCase):
    """Solo bytes sintéticos y transporte simulado; no descargas."""

    def setUp(self) -> None:
        """Prepara una página completa cuyo tamaño supera la cota de ficha HTML."""
        temporal = tempfile.TemporaryDirectory(prefix="Ciber páginas ñ ")
        self.addCleanup(temporal.cleanup)
        self.area = Path(temporal.name)
        self.cuerpo = recepciones.json_bytes(
            {
                "hydra:totalItems": 1,
                "hydra:member": [
                    {"id": 19, "activityCatalogMaterials": [{"id": 30, "title": "Material", "slug": "material"}]}
                ],
                "relleno": " " * recepciones.MAX_CUERPO,
            }
        )
        self.respuesta = recepciones.RespuestaCatalogo(
            url=URL,
            inicio_utc="2026-10-22T16:00:00Z",
            fin_utc="2026-10-22T16:00:01Z",
            cuerpo=self.cuerpo,
            url_final=URL,
            http=200,
            completo=True,
            content_type="application/ld+json",
        )

    def test_ciber_conserva_y_extrae_pagina_mayor_que_8_mib_con_cota_propia(self) -> None:
        """La respuesta mayor no acaba como fuente incompleta por la cota de HP."""
        with patch.object(operacion, "consultar", return_value=self.respuesta) as consultar:
            captura = operacion.recibir_pagina_de_fuente("cibervoluntarios", URL, self.area, None)
        self.assertEqual(consultar.call_args.kwargs["maximo_bytes"], LIMITE_CIBER)
        # La página grande se conserva por trozos; la lectura común la reconstruye exacta.
        self.assertTrue((self.area / captura["cuerpo"]["archivo"]).read_bytes().startswith(trozos_catalogo.MAGIA))
        self.assertEqual(
            operacion.leer_conservado(self.area, captura["cuerpo"], maximo_bytes=LIMITE_CIBER), self.cuerpo
        )
        extraida = operacion.extraer("cibervoluntarios", self.area, captura)
        self.assertEqual(extraida["ids"], ["cibervoluntarios:material:30"])
        self.assertEqual(extraida["fin_utc"], self.respuesta.fin_utc)
        recibida = cobertura_catalogo._recepcion("cibervoluntarios", self.area, captura)
        self.assertEqual(recibida["bytes"], len(self.cuerpo))
        self.assertEqual(recibida["http"], self.respuesta.http)

    def test_conservacion_predeterminada_sigue_rechazando_cuerpos_mayores(self) -> None:
        """Optar por la cota API no altera la conservación normal de fichas."""
        with self.assertRaises(ErrorEntregaCatalogo):
            recepciones.conservar_bytes(self.area, self.cuerpo, ".body")
        self.assertEqual(list(self.area.iterdir()), [])

    def test_transporte_recibe_cota_explicita_y_rechaza_exceso_sin_consulta(self) -> None:
        """El mismo límite se exige antes de consultar y durante la recepción."""

        def descargar(_url: str, **opciones: object) -> tuple[bytes, str, str]:
            self.assertEqual(opciones["maximo_bytes"], LIMITE_CIBER)
            opciones["comprobar_cabeceras"](200, URL, {})
            return self.cuerpo, URL, "application/ld+json"

        with patch.object(recepciones.red, "descargar_url", side_effect=descargar) as descargar_url:
            self.assertTrue(recepciones.consultar(URL, perfil="datos", maximo_bytes=LIMITE_CIBER).completo)
            for limite in (0, True, LIMITE_CIBER + 1):
                with self.assertRaises(ValueError):
                    recepciones.consultar(URL, perfil="datos", maximo_bytes=limite)
            self.assertEqual(descargar_url.call_count, 1)


if __name__ == "__main__":
    unittest.main()
