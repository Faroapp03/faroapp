"""La materia proyectada se ancla al objetivo real, no a etiquetas ni marcas."""

import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from plataforma_datos.cursos import materia_objetivos as m


class Objetivos(unittest.TestCase):
    """Pruebas con captura y referencias sintéticas."""

    def test_captura_de_programa_y_cambio_de_identidad(self) -> None:
        """La captura debe tener bytes, código y título correspondientes."""
        with tempfile.TemporaryDirectory() as carpeta:
            body = json.dumps(
                {
                    "respuesta": [
                        {
                            "codigoTitulacion": "IFCT0174",
                            "denominacion": "Curso",
                            "objetivos": "Comprender los sistemas de gestión de contenidos CMS y WordPress.",
                        }
                    ]
                }
            ).encode()
            sha = hashlib.sha256(body).hexdigest()
            ruta = Path(carpeta) / "cuerpo"
            ruta.write_bytes(body)
            ref = {
                "url": "https://agora.fundae.es/Buscador/BuscarRecursosFormativosFundaeSEB?idCatalogo=3",
                "sha256": sha,
                "fecha_referencia": "2026-11-18T09:00:00Z",
            }
            p = {
                "id": "fundae:oferta:programa:IFCT0174",
                "proveedor_id": "fundae:publicador:catalogo:3",
                "titulo": "Curso",
            }
            e = {"id": "fundae:edicion:1", "programa_id": p["id"], "referencias": [ref]}
            m.aplicar_fundae({"unidades": [p], "ediciones": [e]}, {sha: SimpleNamespace(ruta=ruta)})
            self.assertEqual(e["evidencia_temas"]["temas"], ["web"])
            self.assertEqual(e["evidencia_temas"]["localizador"], "/respuesta/0/objetivos")
            self.assertNotIn("objetivos", e["evidencia_temas"])
            e.pop("evidencia_temas")
            p["titulo"] = "Otro curso"
            m.aplicar_fundae({"unidades": [p], "ediciones": [e]}, {sha: SimpleNamespace(ruta=ruta)})
            self.assertNotIn("evidencia_temas", e)

    def test_nivel_se_recalcula_y_exige_la_misma_captura(self) -> None:
        """Exige identidad y huella de la captura también al recalcular."""
        with tempfile.TemporaryDirectory() as carpeta:
            cuerpo = json.dumps(
                {
                    "respuesta": [
                        {
                            "codigoTitulacion": "A1",
                            "denominacion": "Curso",
                            "objetivos": "Usar funciones básicas de hojas de cálculo",
                        }
                    ]
                }
            ).encode()
            sha = hashlib.sha256(cuerpo).hexdigest()
            ruta = Path(carpeta) / "cuerpo"
            ruta.write_bytes(cuerpo)
            ref = {
                "url": "https://agora.fundae.es/Buscador/BuscarRecursosFormativosFundaeSEB?idCatalogo=3",
                "sha256": sha,
                "fecha_referencia": "2026-11-18T09:00:00Z",
            }
            programa = {
                "id": "fundae:oferta:programa:A1",
                "proveedor_id": "fundae:publicador:catalogo:3",
                "titulo": "Curso",
            }
            edicion = {"id": "e1", "programa_id": programa["id"], "referencias": [ref]}
            colecciones = {"unidades": [programa], "ediciones": [edicion]}
            m.aplicar_fundae(colecciones, {sha: SimpleNamespace(ruta=ruta)})
            self.assertEqual(edicion["nivel_objetivos"]["valor"], "inicial")
            self.assertEqual(edicion["nivel_objetivos"]["sha256"], sha)
            programa["titulo"] = "Identidad cambiada"
            m.aplicar_fundae(colecciones, {sha: SimpleNamespace(ruta=ruta)})
            self.assertNotIn("nivel_objetivos", edicion)
            programa["titulo"] = "Curso"
            ruta.write_bytes(b"{}")
            m.aplicar_fundae(colecciones, {sha: SimpleNamespace(ruta=ruta)})
            self.assertNotIn("nivel_objetivos", edicion)

    def test_ambito_y_negacion(self) -> None:
        """Una etiqueta, una marca o una frase negativa no son el objetivo."""
        reglas, _ = m.leer_reglas()
        self.assertEqual(m.sugerir(["No utilizar sistemas de gestión de contenidos ni WordPress"], reglas), [])
        self.assertEqual(m.sugerir(["Behance"], reglas), [])
        self.assertEqual(m.sugerir(["Maquetación avanzada y accesible: crea un sistema visual"], reglas), ["diseno"])
        self.assertEqual(
            m.sugerir(["Usar herramientas para el teletrabajo, gestionar el tiempo y planificar tareas"], reglas),
            ["ofimatica"],
        )
