"""Lectura pura de materiales Ciber, sin convertir actividad o recurso en edición."""

import hashlib
import json
import unittest
from dataclasses import replace

from plataforma_datos.cursos.fuentes.cibervoluntarios.lector import CapturaCiber, ErrorLecturaCiber, extraer_materiales


class LecturaCiberPruebas(unittest.TestCase):
    """La identidad nativa y los tipos publicados prevalecen sobre el título."""

    def setUp(self) -> None:
        """Prepara una API sintética con dos materiales de una misma actividad."""
        self.pagina = {
            "hydra:totalItems": 1,
            "hydra:member": [
                {
                    "id": 19,
                    "title": "Actividad",
                    "type": "Taller",
                    "status": "Disponible",
                    "activityCatalogMaterials": [
                        {
                            "id": 30,
                            "title": "Mismo título",
                            "slug": "uno",
                            "type": "Autoformación",
                            "lang": "Español",
                            "paraTiContent": "<p>Personas interesadas</p>",
                            "image": "dato UI no necesario",
                        },
                        {"id": 31, "title": "Mismo título", "slug": "two", "type": "Autoformación", "lang": "Inglés"},
                    ],
                }
            ],
        }
        self.cuerpo = json.dumps(self.pagina).encode()
        self.meta = CapturaCiber(
            url="https://www.cibervoluntarios.org/api/public/activity_catalogs?page=1",
            sha256=hashlib.sha256(self.cuerpo).hexdigest(),
            bytes_cuerpo=len(self.cuerpo),
            inicio_utc="2026-10-22T16:00:00Z",
            recibido_utc="2026-10-22T16:00:10Z",
            http=200,
            completo=True,
            localizador="pagina-1",
        )

    def test_materiales_separados_y_tipo_publicado_sin_inventar_edicion(self) -> None:
        """Idiomas/materiales distintos no se fusionan por título o actividad."""
        materiales = extraer_materiales(self.cuerpo, self.meta)
        self.assertEqual([m.id for m in materiales], [30, 31])
        self.assertEqual(materiales[0].actividad_id, 19)
        self.assertEqual(materiales[0].tipo_actividad, "Taller")
        self.assertEqual(materiales[0].tipo_material, "Autoformación")
        self.assertNotIn("image", materiales[0].material_publicado)
        self.assertNotIn("edicion", materiales[0].material_publicado)
        self.assertEqual(materiales[0].material_publicado["paraTiContent"], "<p>Personas interesadas</p>")

    def test_integridad_http_y_causalidad_se_exigen(self) -> None:
        """No basta JSON legible si faltan cuerpo íntegro o captura causal."""
        for meta in (
            replace(self.meta, sha256="a" * 64),
            replace(self.meta, http=500),
            replace(self.meta, bytes_cuerpo=1),
            replace(self.meta, completo=False),
            replace(self.meta, recibido_utc="2026-10-22T15:59:59Z"),
            replace(self.meta, url="https://example.org/api/public/activity_catalogs"),
        ):
            with self.subTest(meta=meta), self.assertRaises(ErrorLecturaCiber):
                extraer_materiales(self.cuerpo, meta)

    def test_identidad_nativa_obligatoria_y_duplicados_distintos_rechazados(self) -> None:
        """No se sustituye ID por título ni se elige una variante conflictiva."""
        self.pagina["hydra:member"][0]["activityCatalogMaterials"][1]["id"] = 30
        cuerpo = json.dumps(self.pagina).encode()
        with self.assertRaisesRegex(ErrorLecturaCiber, "identidad"):
            extraer_materiales(
                cuerpo, replace(self.meta, sha256=hashlib.sha256(cuerpo).hexdigest(), bytes_cuerpo=len(cuerpo))
            )

    def test_valores_desconocidos_no_se_convierten_en_disponibilidad(self) -> None:
        """Se conserva la literalidad sin inferir admisión, nivel Faro ni gratuidad."""
        self.pagina["hydra:member"][0]["status"] = "Pendiente"
        cuerpo = json.dumps(self.pagina).encode()
        material = extraer_materiales(
            cuerpo, replace(self.meta, sha256=hashlib.sha256(cuerpo).hexdigest(), bytes_cuerpo=len(cuerpo))
        )[0]
        self.assertEqual(material.actividad_publicada["status"], "Pendiente")
        self.assertNotIn("disponible", material.actividad_publicada)
        self.assertNotIn("nivel_faro", material.actividad_publicada)


if __name__ == "__main__":
    unittest.main()
