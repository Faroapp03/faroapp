"""Las consultas del catálogo liberan SQLite al terminar, también si falla la lectura."""

import sqlite3
import unittest
from collections.abc import Callable
from unittest.mock import patch

from plataforma_datos.cursos import almacen_catalogo as almacen
from plataforma_datos.cursos import componer_catalogo as componer
from plataforma_datos.cursos import operacion_fuente as fuente
from plataforma_datos.cursos.pruebas import test_almacen_catalogo as fixtures


class ConexionObservada(sqlite3.Connection):
    """Conserva el recurso vivo para que el recolector no oculte un cierre ausente."""

    cerrada = False
    fallo: str | None = None

    def close(self) -> None:
        """Registra el cierre explícito antes de liberar el descriptor real."""
        self.cerrada = True
        super().close()

    def execute(self, sql: str, parameters: object = (), /) -> sqlite3.Cursor:
        """Ejecuta SQLite real, salvo un fallo de lectura concreto del ensayo.

        Returns:
            Cursor real de la consulta.

        Raises:
            sqlite3.OperationalError: Cuando se alcanza la consulta interceptada.
        """
        if self.fallo and self.fallo in sql:
            raise sqlite3.OperationalError("Lectura interrumpida en el ensayo")
        return super().execute(sql, parameters)


class CierreConsultasCatalogo(unittest.TestCase):
    """Usa un catálogo admitido sintético sin leer ni alterar datos operativos."""

    def setUp(self) -> None:
        """Instala datos reales de fixture antes de observar cada consulta."""
        self.caso = fixtures.AlmacenEntradasPruebas()
        self.addCleanup(self.caso.doCleanups)
        self.caso.setUp()
        self.raiz = self.caso.caso.raiz / "Instalación"
        almacen.conservar(self.caso.entrada, destino=self.raiz / almacen.RUTA)
        self.snapshot = almacen.solicitud(self.raiz / almacen.RUTA).snapshot.ruta
        self.ids = {fila["id"] for fila in fuente.conocidos("hp_life", self.raiz)}

    def consultas(self) -> tuple[tuple[str, Callable[[], object], str], ...]:
        """Identifica las lecturas que deben liberar el descriptor.

        Returns:
            Operaciones y sus consultas que pueden fallar.
        """
        return (
            ("corte", lambda: componer._corte(self.snapshot, "sin corte"), "SELECT max(corte_us)"),
            (
                "conservar",
                lambda: almacen.conservar(self.caso.entrada, destino=self.caso.destino),
                "SELECT archivo,sha256 FROM evidencias WHERE archivo IS NOT NULL",
            ),
            ("conocidos", lambda: fuente.conocidos("hp_life", self.raiz), "SELECT * FROM programas WHERE proveedor_id"),
            (
                "instaladas",
                lambda: fuente._unidades_instaladas(self.raiz, self.ids),
                "SELECT id FROM programas WHERE id IN",
            ),
        )

    def comprobar(self, operacion: Callable[[], object], fallo: str | None) -> object:
        """Observa los descriptores y garantiza su limpieza incluso al fallar la prueba.

        Returns:
            Resultado de la operación o None si se provoca un error de lectura.
        """
        conexiones: list[ConexionObservada] = []
        conectar = sqlite3.connect

        def observado(*args: object, **kwargs: object) -> ConexionObservada:
            conexion = conectar(*args, **kwargs, factory=ConexionObservada)
            conexion.fallo = fallo
            conexiones.append(conexion)
            return conexion

        resultado = None
        try:
            with patch.object(sqlite3, "connect", observado):
                if fallo:
                    with self.assertRaises(sqlite3.OperationalError):
                        operacion()
                else:
                    resultado = operacion()
            self.assertTrue(conexiones)
            self.assertTrue(all(c.cerrada for c in conexiones), "La operación dejó una conexión abierta")
        finally:
            for conexion in conexiones:
                conexion.close()
        return resultado

    def test_consultas_y_conservacion_cierran_antes_de_retornar(self) -> None:
        """Leer y conservar no dejan descriptores abiertos ni modifican la instantánea leída."""
        original = self.snapshot.read_bytes()
        for nombre, operacion, _ in self.consultas():
            with self.subTest(operacion=nombre):
                resultado = self.comprobar(operacion, None)
                if nombre == "instaladas":
                    self.assertEqual(resultado, self.ids)
        self.assertEqual(self.snapshot.read_bytes(), original)

    def test_error_de_lectura_tambien_cierra(self) -> None:
        """El error se propaga y cada conexión queda cerrada antes de salir."""
        for nombre, operacion, consulta in self.consultas():
            with self.subTest(operacion=nombre):
                self.comprobar(operacion, consulta)
