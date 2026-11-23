"""Pruebas de las consultas locales a la biblioteca ESCO.

(plataforma_datos/ocupaciones/fuentes/esco/piezas/consultas.py).

Sin la base real, que git no versiona: cada prueba construye una base mínima con el mismo esquema que esco.py, con dos
ocupaciones, dos competencias y sus relaciones.
"""

import io
import json
import os
import sqlite3
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest import mock

import plataforma_datos.ocupaciones.fuentes.esco.lector as esco
import plataforma_datos.ocupaciones.fuentes.esco.piezas.consultas as consultas
from plataforma_datos.comun import entrada_salida
from plataforma_datos.comun.nucleo import ArchivoFaltante, ErrorFuente, ValidacionFallida

RECEPCIONISTA = "http://data.europa.eu/esco/occupation/recepcionista"
RECEPCIONISTA_HOTEL = "http://data.europa.eu/esco/occupation/recepcionista-hotel"
ATENDER = "http://data.europa.eu/esco/skill/atender"
RESERVAR = "http://data.europa.eu/esco/skill/reservar"


def ficha(uri: str, titulo: str, alternativos: list[str], descripcion: str, **propios: str) -> dict[str, object]:
    """Una ficha preparada con los campos que guarda la base.

    Args:
        uri: La dirección única de la ficha.
        titulo: Su título en castellano.
        alternativos: Sus nombres alternativos en castellano.
        descripcion: Su descripción en castellano.
        **propios: Los campos propios de su tipo (el código ESCO o el tipo de competencia).

    Returns:
        La ficha con los campos que guarda la base.
    """
    comunes = {"uri": uri, "titulo_es": titulo, "nombres_alternativos_es": alternativos, "descripcion_es": descripcion}
    return {**comunes, **propios}


def relacion(ocupacion: str, competencia: str, tipo: str) -> dict[str, str]:
    """Una relación ocupación-competencia preparada.

    Args:
        ocupacion: La URI de la ocupación.
        competencia: La URI de la competencia.
        tipo: «esencial» u «opcional».

    Returns:
        La relación con los campos que guarda la base.
    """
    return {"ocupacion_uri": ocupacion, "competencia_uri": competencia, "tipo": tipo}


DATOS = {
    "ocupaciones": [
        ficha(
            RECEPCIONISTA, "recepcionista", ["recepcionista de oficina"], "Atiende a las visitas.", codigo_esco="4226.1"
        ),
        ficha(RECEPCIONISTA_HOTEL, "recepcionista de hotel", [], "Recibe a los huéspedes.", codigo_esco="4224.1"),
    ],
    "competencias": [
        ficha(
            ATENDER, "atender a visitantes", ["recibir visitas"], "Recibir y orientar.", tipo="capacidad_competencia"
        ),
        ficha(RESERVAR, "gestionar reservas", [], "Reservar habitaciones.", tipo="capacidad_competencia"),
    ],
    "relaciones": [
        relacion(RECEPCIONISTA, ATENDER, "esencial"),
        relacion(RECEPCIONISTA_HOTEL, ATENDER, "esencial"),
        relacion(RECEPCIONISTA_HOTEL, RESERVAR, "opcional"),
    ],
}
HUELLA_NULA = "0" * 64
CAPTURA = {"fuente": "ESCO de prueba", "version_solicitada": "v0", "sha256": HUELLA_NULA}


def construir_base_de_prueba(ruta: Path) -> None:
    """Construye en `ruta` una base con el esquema de esco.py y los DATOS de prueba.

    Args:
        ruta: Dónde se crea la base.
    """
    esco.construir_base(ruta, CAPTURA, DATOS)


class PruebaConexion(unittest.TestCase):
    """Rutas explícitas portables, solo lectura y cierre de la conexión aun ante un error."""

    def setUp(self) -> None:
        """Crea una base mínima en una ruta que necesita codificación al convertirse en URI."""
        temporal = tempfile.TemporaryDirectory(prefix="ESCO Año 2026 ?#% ")
        self.addCleanup(temporal.cleanup)
        self.base = Path(temporal.name) / "biblioteca ?#.sqlite"
        base = sqlite3.connect(self.base)
        try:
            base.execute("CREATE TABLE prueba (valor TEXT)")
            base.execute("INSERT INTO prueba VALUES (?)", ("ñ",))
            base.commit()
        finally:
            base.close()

    def test_ruta_relativa(self) -> None:
        """Una ruta explícita relativa abre la misma base que su ruta absoluta."""
        relativa = Path(os.path.relpath(self.base))
        with consultas.conexion(relativa) as base:
            self.assertEqual(base.execute("SELECT valor FROM prueba").fetchone()["valor"], "ñ")

    def test_ruta_unicode_solo_lectura_y_cierre(self) -> None:
        """La URI escapa espacios y signos; la conexión no escribe y se cierra al salir."""
        antes = self.base.read_bytes()
        with consultas.conexion(self.base) as base:
            self.assertEqual(base.execute("SELECT valor FROM prueba").fetchone()[0], "ñ")
            with self.assertRaises(sqlite3.OperationalError):
                base.execute("DELETE FROM prueba")
        self.assertEqual(self.base.read_bytes(), antes)
        with self.assertRaises(sqlite3.ProgrammingError):
            base.execute("SELECT 1")

    def test_error_cierra_la_conexion(self) -> None:
        """Un fallo del lector se propaga después de cerrar su conexión.

        Raises:
            RuntimeError: Fallo simulado y capturado por la prueba para comprobar el cierre.
        """
        with self.assertRaisesRegex(RuntimeError, "fallo del lector"), consultas.conexion(self.base) as base:
            raise RuntimeError("fallo del lector")
        with self.assertRaises(sqlite3.ProgrammingError):
            base.execute("SELECT 1")

    def test_base_ausente_no_se_crea(self) -> None:
        """Una ruta inexistente conserva el error común y no crea una SQLite vacía."""
        ausente = self.base.with_name("ausente.sqlite")
        with self.assertRaises(ArchivoFaltante), consultas.conexion(ausente):
            self.fail("no debe abrir una base ausente")
        self.assertFalse(ausente.exists())


class PruebaConsultas(unittest.TestCase):
    """Búsqueda, ficha y consulta inversa sobre una base mínima, siempre de solo lectura."""

    @classmethod
    def setUpClass(cls) -> None:
        """Construye la base de prueba una vez y hace que las consultas la usen."""
        temporal = tempfile.TemporaryDirectory()
        cls.addClassCleanup(temporal.cleanup)
        cls.base = Path(temporal.name) / "biblioteca-esco.sqlite"
        construir_base_de_prueba(cls.base)
        conexion_real = consultas.conexion
        parche = mock.patch.object(consultas, "conexion", lambda: conexion_real(cls.base))
        parche.start()
        cls.addClassCleanup(parche.stop)

    def test_busca_por_prefijo_y_primero_el_nombre_exacto(self) -> None:
        """Cada palabra vale como prefijo; la ficha cuyo nombre coincide exactamente va primero."""
        self.assertEqual([fila["uri"] for fila in consultas.buscar("recepcion")], [RECEPCIONISTA, RECEPCIONISTA_HOTEL])
        self.assertEqual(consultas.buscar("Recepcionista")[0]["uri"], RECEPCIONISTA)
        self.assertEqual([fila["uri"] for fila in consultas.buscar("recep hotel")], [RECEPCIONISTA_HOTEL])

    def test_busca_en_alternativos_y_en_competencias(self) -> None:
        """Las denominaciones alternativas cuentan, y las competencias se buscan en su propia tabla."""
        self.assertEqual([fila["uri"] for fila in consultas.buscar("oficina")], [RECEPCIONISTA])
        self.assertEqual([fila["uri"] for fila in consultas.buscar("visitas", "competencias")], [ATENDER])

    def test_consultas_sin_resultado_o_maliciosas(self) -> None:
        """Una consulta vacía o sin coincidencias no devuelve nada, y una con sintaxis SQL o FTS5 tampoco falla."""
        self.assertEqual(consultas.buscar(""), [])
        self.assertEqual(consultas.buscar("zzzznofaro"), [])
        self.assertEqual(consultas.buscar('" OR 1=1; --'), [])
        for operador in ("NEAR(a b)", "titulo_es:*", '"', "recep*", "a AND"):
            with self.subTest(operador=operador):
                self.assertIsInstance(consultas.buscar(operador), list)
        with consultas.conexion() as base:
            self.assertEqual(base.execute("SELECT count(*) FROM ocupaciones").fetchone()[0], len(DATOS["ocupaciones"]))

    def test_tipo_de_busqueda_desconocido(self) -> None:
        """Solo se busca en ocupaciones o en competencias: el nombre de la tabla nunca sale de la consulta."""
        with self.assertRaises(ErrorFuente):
            consultas.buscar("recepcionista", "relaciones")

    def test_ficha_con_sus_competencias(self) -> None:
        """La ficha se pide por código ESCO o por URI y trae sus competencias, primero las esenciales."""
        por_codigo = consultas.ficha("4224.1")
        self.assertEqual(por_codigo, consultas.ficha(RECEPCIONISTA_HOTEL))
        relacionadas = [
            (fila["competencia"]["uri"], fila["relacion"]["tipo"]) for fila in por_codigo["competencias_relacionadas"]
        ]
        self.assertEqual(relacionadas, [(ATENDER, "esencial"), (RESERVAR, "opcional")])

    def test_ficha_que_no_existe(self) -> None:
        """Una ocupación que no está en la base se dice con un motivo que explica qué pedir."""
        with self.assertRaisesRegex(ErrorFuente, "ocupación no encontrada"):
            consultas.ficha("9999.9")

    def test_ocupaciones_por_competencia(self) -> None:
        """La consulta inversa da las ocupaciones de una competencia con su tipo de relación."""
        inversa = [
            (fila["ocupacion"]["uri"], fila["relacion"]["tipo"])
            for fila in consultas.ocupaciones_por_competencia(ATENDER)
        ]
        self.assertEqual(sorted(inversa), [(RECEPCIONISTA, "esencial"), (RECEPCIONISTA_HOTEL, "esencial")])

    def test_orden_de_la_linea_de_ordenes(self) -> None:
        """La búsqueda sale como JSON con su alcance; un error, como una línea con el motivo y el código 1."""
        salida = io.StringIO()
        with redirect_stdout(salida):
            self.assertEqual(consultas.main(["buscar", "recepcionista"]), 0)
        resultado = json.loads(salida.getvalue())
        self.assertEqual(resultado["alcance"], consultas.ALCANCE)
        self.assertEqual(resultado["resultados"][0]["uri"], RECEPCIONISTA)
        errores = io.StringIO()
        with redirect_stderr(errores), redirect_stdout(io.StringIO()):
            self.assertEqual(consultas.main(["ficha", "9999.9"]), 1)
        self.assertRegex(errores.getvalue(), r"^Error: ocupación no encontrada")


class PruebaBaseValidada(unittest.TestCase):
    """Las demás fuentes y el exportador solo leen la base ESCO que se validó."""

    def setUp(self) -> None:
        """Una base de prueba en el sitio de la real."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.base = Path(temporal.name) / "biblioteca-esco.sqlite"
        construir_base_de_prueba(self.base)
        parche = mock.patch.object(consultas, "BASE", self.base)
        parche.start()
        self.addCleanup(parche.stop)

    def test_base_que_se_valido(self) -> None:
        """Si su huella es la de la validación de ESCO, se abre de solo lectura."""
        validacion = {"sha256_sqlite": entrada_salida.sha256(self.base)}
        with (
            mock.patch.object(consultas, "exigir_admitido", return_value=validacion),
            consultas.base_validada() as base,
        ):
            self.assertEqual(base.execute("SELECT count(*) FROM ocupaciones").fetchone()[0], len(DATOS["ocupaciones"]))
            with self.assertRaises(sqlite3.OperationalError):
                base.execute("DELETE FROM ocupaciones")

    def test_base_distinta_de_la_validada(self) -> None:
        """Una base que no es la validada no se abre."""
        validacion = {"sha256_sqlite": HUELLA_NULA}
        admitida = mock.patch.object(consultas, "exigir_admitido", return_value=validacion)
        with admitida, self.assertRaisesRegex(ValidacionFallida, "no es la validada"):
            consultas.base_validada()


if __name__ == "__main__":
    unittest.main()
