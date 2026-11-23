"""Almacén del ensayo. Comparación e intercambio en SQLite y objetos locales inmutables por SHA-256."""

import hashlib
import os
import shutil
import sqlite3
import tempfile
from contextlib import suppress
from pathlib import Path

from plataforma_datos.comun.entrada_salida import sha256
from plataforma_datos.orquestacion.almacen_s3 import CLAVE, CLAVE_CONTROL, MAX_CONTROL_BYTES
from plataforma_datos.orquestacion.almacen_trabajos import REFERENCIA
from plataforma_datos.orquestacion.formas_del_diario import CLAVE_RESUMEN, MAX_RESUMEN


def _exigir(condicion: bool) -> None:
    if not condicion:
        raise ValueError("Objeto de ensayo no verificable")


def _tope(clave: str) -> int:
    # El mismo tope que el almacén remoto: solo el resumen del diario supera el común de los controles.
    return MAX_RESUMEN if CLAVE_RESUMEN.fullmatch(clave) else MAX_CONTROL_BYTES


class AlmacenDeEnsayo:
    """Controles independientes por ensayo. Los blobs verificados se pueden compartir entre ejecuciones locales."""

    def __init__(self, objetos: Path, conexion: sqlite3.Connection) -> None:
        self.objetos = objetos
        self.conexion = conexion
        objetos.mkdir(mode=0o700, parents=True, exist_ok=True)
        conexion.execute("CREATE TABLE IF NOT EXISTS controles (clave TEXT PRIMARY KEY, valor BLOB NOT NULL)")

    def _ruta(self, clave: str, huella: str) -> Path:
        identificada = CLAVE.fullmatch(clave)
        _exigir(identificada is not None and huella in identificada.groups())
        return self.objetos / clave

    def guardar(self, clave: str, origen: Path, huella: str, bytes_esperados: int) -> None:
        """Coteja el archivo indicado incluso al reutilizar un objeto existente."""
        destino = self._ruta(clave, huella)
        _exigir(origen.stat().st_size == bytes_esperados and sha256(origen) == huella)
        if not destino.exists():
            destino.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            with tempfile.NamedTemporaryFile(dir=destino.parent) as temporal:
                with origen.open("rb") as entrada:
                    shutil.copyfileobj(entrada, temporal)
                temporal.flush()
                os.fsync(temporal.fileno())
                _exigir(sha256(Path(temporal.name)) == huella)
                with suppress(FileExistsError):
                    os.link(temporal.name, destino)
        _exigir(destino.stat().st_size == bytes_esperados and sha256(destino) == huella)

    def recuperar(self, clave: str, destino: Path, huella: str, bytes_maximos: int) -> None:
        """Entrega una copia exclusiva después de comprobar tamaño y contenido."""
        origen = self._ruta(clave, huella)
        _exigir(origen.stat().st_size <= bytes_maximos)
        with tempfile.NamedTemporaryFile(dir=destino.parent) as temporal:
            with origen.open("rb") as entrada:
                shutil.copyfileobj(entrada, temporal)
            temporal.flush()
            _exigir(sha256(Path(temporal.name)) == huella)
            os.link(temporal.name, destino)

    def leer_control(self, clave: str, bytes_maximos: int) -> tuple[bytes, str] | None:
        """Consulta el control con la misma semántica de ausencia y versión del almacén remoto.

        Returns:
            Bytes y ETag del control, o ausencia confirmada.
        """
        _exigir(CLAVE_CONTROL.fullmatch(clave) is not None)
        fila = self.conexion.execute("SELECT valor FROM controles WHERE clave = ?", (clave,)).fetchone()
        if fila is None:
            return None
        valor = fila[0]
        _exigir(len(valor) <= bytes_maximos)
        return valor, '"' + hashlib.sha256(valor).hexdigest() + '"'

    def guardar_control(self, clave: str, contenido: bytes, etag_esperado: str | None) -> bool:
        """Aplica una creación o sustitución condicionada en una única transacción SQLite.

        Returns:
            Verdadero cuando se aplicó la escritura solicitada.
        """
        _exigir(CLAVE_CONTROL.fullmatch(clave) is not None and (etag_esperado is None or clave == REFERENCIA))
        _exigir(0 < len(contenido) <= _tope(clave))
        with self.conexion:
            self.conexion.execute("BEGIN IMMEDIATE")
            valor = self.leer_control(clave, _tope(clave))
            if (None if valor is None else valor[1]) != etag_esperado:
                return False
            self.conexion.execute("INSERT OR REPLACE INTO controles VALUES (?, ?)", (clave, contenido))
            return True
