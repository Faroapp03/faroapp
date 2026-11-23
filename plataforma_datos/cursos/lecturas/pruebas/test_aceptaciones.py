"""Las aceptaciones: contrato cerrado, archivo inmutable junto a las lecturas y lista ordenada que valida cada una."""

import tempfile
import unittest
from pathlib import Path

from plataforma_datos.cursos.lecturas.aceptaciones import (
    Aceptacion,
    ErrorAceptacion,
    guardar_aceptacion,
    leer_aceptacion,
    listar_aceptaciones,
)
from plataforma_datos.cursos.lecturas.almacen_lecturas import guardar_lectura, listar_lecturas
from plataforma_datos.cursos.lecturas.contrato_lectura import ErrorLectura, bytes_de
from plataforma_datos.cursos.lecturas.pruebas import ejemplos


def aceptacion(**cambios: object) -> Aceptacion:
    """Una persona acepta la segunda lectura de ejemplo como referencia.

    Returns:
        La aceptación, con los campos cambiados que se pidan.
    """
    datos = {
        "fuente": ejemplos.FUENTE,
        "ambito": ejemplos.AMBITO,
        "lectura_id": ejemplos.segunda().a_json()["lectura_id"],
        "aceptada_utc": "2026-11-18T09:30:00Z",
        "motivo": "Cibernàrium publica ahora el programa en cada edición; la forma nueva es correcta.",
    }
    return Aceptacion(**{**datos, **cambios})


class AceptacionesPruebas(unittest.TestCase):
    """Cada prueba trabaja en una instalación temporal propia."""

    def setUp(self) -> None:
        """Una raíz vacía en una carpeta temporal."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.raiz = Path(temporal.name) / "Instalación"
        self.raiz.mkdir()

    def test_se_guarda_junto_a_las_lecturas_y_se_lee_igual(self) -> None:
        """El archivo vive en la carpeta de lecturas, con bytes canónicos, y la lista de lecturas no lo confunde."""
        guardar_lectura(self.raiz, ejemplos.primera())
        ruta = guardar_aceptacion(self.raiz, aceptacion())
        dato = aceptacion().a_json()
        self.assertEqual(ruta.name, f"aceptacion-{dato['aceptacion_id']}.json")
        self.assertEqual(ruta.parent.name, "lecturas")
        self.assertEqual(leer_aceptacion(ruta.read_bytes()), dato)
        self.assertEqual(listar_aceptaciones(self.raiz, ejemplos.FUENTE), [dato])
        self.assertEqual(listar_lecturas(self.raiz, ejemplos.FUENTE), [ejemplos.primera().a_json()])

    def test_guardar_dos_veces_es_inocuo_y_otro_contenido_no_la_sustituye(self) -> None:
        """Una aceptación guardada no cambia."""
        ruta = guardar_aceptacion(self.raiz, aceptacion())
        self.assertEqual(guardar_aceptacion(self.raiz, aceptacion()), ruta)
        ruta.write_bytes(bytes_de(aceptacion(motivo="Otro motivo.").a_json()))
        with self.assertRaisesRegex(ErrorLectura, "una aceptación guardada no cambia"):
            guardar_aceptacion(self.raiz, aceptacion())
        with self.assertRaisesRegex(ErrorAceptacion, "guarda otra aceptación"):
            listar_aceptaciones(self.raiz, ejemplos.FUENTE)

    def test_el_contrato_es_cerrado(self) -> None:
        """Rechaza un campo de más, un motivo vacío o con control, una hora inexistente y bytes no canónicos."""
        dato = aceptacion().a_json()
        with self.assertRaisesRegex(ErrorAceptacion, "campo no admitido"):
            leer_aceptacion(bytes_de({**dato, "persona": "x"}))
        for motivo in ("", "con\ttabulador"):
            with self.subTest(motivo=motivo), self.assertRaisesRegex(ErrorAceptacion, "motivo"):
                aceptacion(motivo=motivo)
        with self.assertRaisesRegex(ErrorAceptacion, "fecha inexistente"):
            aceptacion(aceptada_utc="2026-02-30T00:00:00Z")
        with self.assertRaisesRegex(ErrorAceptacion, "forma canónica"):
            leer_aceptacion(bytes_de(dato).replace(b"\n", b" \n"))
        with self.assertRaisesRegex(ErrorAceptacion, "aceptacion_id"):
            leer_aceptacion(bytes_de({**dato, "motivo": "Cambiado a mano."}))


if __name__ == "__main__":
    unittest.main()
