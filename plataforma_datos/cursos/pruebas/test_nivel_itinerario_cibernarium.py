"""El itinerario es orientación trazable, no dificultad oficial ni prerrequisito."""

import hashlib
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from plataforma_datos.cursos.nivel_itinerario_cibernarium import aplicar, orientar


def ficha(cajas: str) -> bytes:
    """Construye una ficha sintética con identidad y un itinerario propio.

    Returns:
        Bytes de la ficha.
    """
    return (
        '<html><head><meta property="og:url" content="https://cibernarium.barcelonactiva.cat/ca/formacio?activityId=101">'
        '<meta property="og:title" content="Curs d’exemple - Cibernarium"></head><body>'
        '<p class="section-title">ITINERARI FORMATIU RECOMANAT</p><div class="flex-container">'
        + cajas
        + "</div></body></html>"
    ).encode()


def caja(n: int, titulo: str) -> str:
    """Genera una etapa de la lista.

    Returns:
        HTML de la etapa.
    """
    return f'<a class="box"><p>Nivell {n}</p><p>{titulo}</p></a>'


class Itinerario(unittest.TestCase):
    """La orientación solo corresponde a un título y una secuencia inequívocos."""

    def test_producto_vincula_solo_ficha_y_unidad_referenciadas(self) -> None:
        """La proyección exige bytes íntegros, URL del programa y copia sin cuerpo."""
        with tempfile.TemporaryDirectory() as nombre:
            cuerpo = ficha(caja(0, "Introducció") + caja(1, "Curs d’exemple"))
            ruta = Path(nombre) / "ficha.html"
            ruta.write_bytes(cuerpo)
            sha = hashlib.sha256(cuerpo).hexdigest()
            ref = {
                "url": "https://cibernarium.barcelonactiva.cat/ca/formacio?activityId=101",
                "sha256": sha,
                "fecha_referencia": "2026-11-18T12:00:00Z",
            }
            p = {"id": "cibernarium:101", "proveedor_id": "cibernarium", "titulo": "Curs d’exemple"}
            ed = {"id": "cibernarium-edicion:201", "programa_id": p["id"], "referencias": [ref]}
            aplicar({"unidades": [p], "ediciones": [ed]}, {sha: SimpleNamespace(ruta=ruta)})
            self.assertEqual(ed["nivel_itinerario"]["sha256"], sha)
            self.assertEqual(ed["nivel_itinerario"]["unidad_id"], ed["id"])
            self.assertNotIn("cuerpo", ed["nivel_itinerario"])
            ed.pop("nivel_itinerario")
            ruta.write_bytes(b"contenido alterado")
            aplicar({"unidades": [p], "ediciones": [ed]}, {sha: SimpleNamespace(ruta=ruta)})
            self.assertNotIn("nivel_itinerario", ed)

    def test_etapa_posterior_y_revocacion(self) -> None:
        """Se requiere anterior, identidad propia y lista ordenada sin duplicidades."""
        fuente = ficha(caja(0, "Introducció") + caja(1, "Curs d’exemple") + caja(2, "Ampliació"))
        self.assertEqual(orientar(fuente, actividad_id="101", titulo="Curs d’exemple")["valor"], "intermedio")
        self.assertIsNone(orientar(fuente, actividad_id="102", titulo="Curs d’exemple"))
        self.assertIsNone(orientar(fuente, actividad_id="101", titulo="Un altre curs"))
        self.assertIsNone(
            orientar(
                ficha(caja(1, "Curs d’exemple") + caja(2, "Ampliació")), actividad_id="101", titulo="Curs d’exemple"
            )
        )
        self.assertIsNone(
            orientar(
                ficha(caja(0, "Introducció") + caja(1, "Curs d’exemple") + caja(1, "Curs d’exemple")),
                actividad_id="101",
                titulo="Curs d’exemple",
            )
        )
