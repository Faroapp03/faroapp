"""El núcleo y la interfaz de órdenes convierten los fallos de un original o de una fuente en un motivo legible."""

import io
import json
import tempfile
import unittest
import zipfile
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

from plataforma_datos.comun.nucleo import (
    ACCIONES,
    ADMITIDO,
    CON_ERRORES,
    ETAPAS,
    TODO,
    Controles,
    FormatoInesperado,
    leer_del_zip,
)
from plataforma_datos.orquestacion import ordenes


def _zip_con(miembros: dict[str, bytes]) -> zipfile.ZipFile:
    """Abre en memoria un .zip con esos miembros.

    Args:
        miembros: Ruta de cada miembro → su contenido.

    Returns:
        El .zip abierto para leer.
    """
    datos = io.BytesIO()
    with zipfile.ZipFile(datos, "w") as archivo:
        for nombre, contenido in miembros.items():
            archivo.writestr(nombre, contenido)
    return zipfile.ZipFile(datos)


class LeerDelZip(unittest.TestCase):
    """Un miembro que falta es un formato inesperado con su motivo, no un KeyError."""

    def test_miembro_presente(self) -> None:
        """El contenido del miembro, tal cual."""
        self.assertEqual(leer_del_zip(_zip_con({"a.xml": b"<a/>"}), "a.xml"), b"<a/>")

    def test_miembro_ausente(self) -> None:
        """Un libro sin sharedStrings (o un .zip reorganizado) se rechaza con el nombre que falta."""
        with self.assertRaisesRegex(FormatoInesperado, "no contiene xl/sharedStrings.xml"):
            leer_del_zip(_zip_con({"a.xml": b"<a/>"}), "xl/sharedStrings.xml")


class EstadoDeLaValidacion(unittest.TestCase):
    """El estado publicado sale de una sola definición."""

    def test_admitido_y_con_errores(self) -> None:
        """Todos los controles cumplen: ADMITIDO; uno falla: CON_ERRORES."""
        controles = Controles()
        controles.comprobar(True, "uno")
        self.assertEqual(controles.estado, ADMITIDO)
        controles.comprobar(False, "dos")
        self.assertEqual(controles.estado, CON_ERRORES)
        self.assertEqual((ADMITIDO, CON_ERRORES), ("Admitido", "Con errores"))


class Acciones(unittest.TestCase):
    """«todo» encadena las etapas en su orden, sea cual sea su posición en ACCIONES."""

    def test_acciones_son_las_etapas_y_todo(self) -> None:
        """Las acciones de la interfaz son las etapas y la que las encadena."""
        self.assertEqual(ACCIONES, (*ETAPAS, TODO))

    def test_todo_ejecuta_las_etapas_en_orden(self) -> None:
        """Cada etapa una vez, en el orden de ETAPAS."""
        hechas: list[str] = []
        etapas = {etapa: (lambda etapa=etapa: hechas.append(etapa)) for etapa in reversed(ETAPAS)}
        self.assertEqual(ordenes.ejecutar(TODO, etapas), 0)
        self.assertEqual(hechas, list(ETAPAS))

    def test_la_interfaz_no_admite_acciones_ajenas(self) -> None:
        """La interfaz solo ofrece las acciones comunes."""
        with self.assertRaises(TypeError):
            ordenes.interfaz("prueba", ("otra",))  # type: ignore[call-arg]


class ErroresConMotivo(unittest.TestCase):
    """Una orden que falla ante un original dañado o una etapa ausente termina en 1 con «Error: motivo»."""

    def _codigo_y_error(self, orden: object) -> tuple[int, str]:
        """Ejecuta la orden con con_motivo.

        Args:
            orden: Lo que se ejecuta.

        Returns:
            El código de salida y lo escrito en la salida de errores.
        """
        with redirect_stderr(io.StringIO()) as errores, redirect_stdout(io.StringIO()):
            codigo = ordenes.con_motivo(orden)  # type: ignore[arg-type]
        return codigo, errores.getvalue()

    def test_zip_danado(self) -> None:
        """Un .zip (o libro .xlsx) que no es un .zip."""
        with tempfile.TemporaryDirectory() as carpeta:
            ruta = Path(carpeta) / "libro.xlsx"
            ruta.write_bytes(b"no es un zip")
            codigo, errores = self._codigo_y_error(lambda: zipfile.ZipFile(ruta))
        self.assertEqual(codigo, 1)
        self.assertTrue(errores.startswith("Error: "))

    def test_json_danado(self) -> None:
        """Un JSON cortado."""
        codigo, errores = self._codigo_y_error(lambda: json.loads('{"a": '))
        self.assertEqual(codigo, 1)
        self.assertTrue(errores.startswith("Error: "))

    def test_etapa_que_la_fuente_no_define(self) -> None:
        """Ninguna etapa se ejecuta y el motivo nombra la que falta."""
        hechas: list[str] = []
        with redirect_stderr(io.StringIO()) as errores:
            codigo = ordenes.ejecutar(TODO, {"descargar": lambda: hechas.append("descargar")})
        self.assertEqual(codigo, 1)
        self.assertEqual(hechas, [])
        self.assertIn("no define la etapa «preparar»", errores.getvalue())


if __name__ == "__main__":
    unittest.main()
