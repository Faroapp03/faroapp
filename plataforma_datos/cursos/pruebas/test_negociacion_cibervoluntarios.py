"""La API debe negociar la representación que verifica su lector y su censo."""

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from plataforma_datos.comun.nucleo import Descarga
from plataforma_datos.cursos import operacion_fuente as fuente
from plataforma_datos.cursos import recepciones_catalogo as recepciones
from plataforma_datos.cursos.contrato_entrega_catalogo import ErrorEntregaCatalogo
from plataforma_datos.cursos.pruebas import test_lectura_cibervoluntarios as casos

URL = "https://www.cibervoluntarios.org/api/public/activity_catalogs?lang=es&itemsPerPage=100&page=1"


class NegociacionCiberPruebas(unittest.TestCase):
    """Transporte simulado y lector real; no se modifica el perfil central."""

    def setUp(self) -> None:
        """Reproduce el servidor: sin Accept entrega lista, con JSON-LD entrega Hydra."""
        temporal = tempfile.TemporaryDirectory(prefix="Ciber representación ñ ")
        self.addCleanup(temporal.cleanup)
        self.area = Path(temporal.name)
        self.caso = casos.LecturaCiberPruebas()
        self.caso.setUp()
        self.addCleanup(self.caso.doCleanups)
        self.llamadas = []

    def descargar(self, url: str, **opciones: object) -> Descarga:
        """Representaciones alternativas del mismo catálogo, igual que el caso real observado.

        Returns:
            Respuesta íntegra con forma elegida por la negociación HTTP.
        """
        self.llamadas.append((url, opciones))
        ld = opciones.get("cabeceras", {}).get("Accept") == "application/ld+json"
        cuerpo = self.caso.cuerpo if ld else json.dumps(self.caso.pagina["hydra:member"]).encode()
        mime = "application/ld+json" if ld else "application/json"
        opciones["comprobar_cabeceras"](200, url, {"Content-Type": mime})
        return Descarga(cuerpo, url, mime)

    def test_ciber_pide_hydra_compatible_con_lector_y_conserva_negociacion(self) -> None:
        """HTTP200 sin representación correcta no basta para actualizar la fuente."""
        with patch.object(recepciones.red, "descargar_url", side_effect=self.descargar):
            cap = fuente.recibir_pagina_de_fuente("cibervoluntarios", URL, self.area, None)
        self.assertEqual(
            fuente.extraer("cibervoluntarios", self.area, cap)["ids"],
            ["cibervoluntarios:material:30", "cibervoluntarios:material:31"],
        )
        meta = fuente.leer_recibo(self.area, cap)
        self.assertEqual(meta["tipo_solicitado"], "application/ld+json")
        self.assertEqual(meta["content_type"], "application/ld+json")
        self.assertEqual(self.llamadas[0][1]["cabeceras"], {"Accept": "application/ld+json"})
        self.assertEqual(self.llamadas[0][1]["perfil"], "datos")

    def test_otros_productores_conservan_su_perfil_sin_negociacion_ciber(self) -> None:
        """No se añade Accept de API a las páginas ni se cambia la identidad genérica."""
        with patch.object(recepciones.red, "descargar_url", side_effect=self.descargar):
            cap = fuente.recibir_pagina_de_fuente(
                "claude_academy", "https://academy.claude.com/courses/curso", self.area, "curso"
            )
        self.assertNotIn("cabeceras", self.llamadas[0][1])
        self.assertEqual(self.llamadas[0][1]["perfil"], "pagina")
        self.assertNotIn("tipo_solicitado", fuente.leer_recibo(self.area, cap))

    def test_tipo_no_admitido_falla_antes_de_consultar(self) -> None:
        """La negociación es un contrato de lectura, no configuración libre de identidad."""
        with patch.object(recepciones.red, "descargar_url") as descargar, self.assertRaises(ErrorEntregaCatalogo):
            recepciones.consultar(URL, perfil="datos", tipo_respuesta="identidad-ajena")
        descargar.assert_not_called()


if __name__ == "__main__":
    unittest.main()
