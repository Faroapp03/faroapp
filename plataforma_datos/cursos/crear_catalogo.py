"""Primera creación explícita de un catálogo V10 vacío, sin recorrer formatos anteriores."""

import argparse
import fcntl
import hashlib
import json
import os
import re
import shutil
import sqlite3
import stat
import tempfile
from collections.abc import Iterator
from contextlib import closing, contextmanager
from pathlib import Path

from plataforma_datos.cursos import auditoria_snapshot_catalogo as auditoria
from plataforma_datos.cursos import catalogo, contenidos_vigencia, enriquecimiento_legado, unidades_vigencia
from plataforma_datos.cursos.tipos_json import ObjetoJson


def _sincronizar(carpeta: Path) -> None:
    fd = os.open(carpeta, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


@contextmanager
def _exclusion(carpeta: Path) -> Iterator[None]:
    # El propio directorio permite excluir creadores sin añadir un registro mutable.
    fd = os.open(carpeta, os.O_RDONLY | os.O_DIRECTORY)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX)
        yield
    finally:
        fcntl.flock(fd, fcntl.LOCK_UN)
        os.close(fd)


def _recuperar_enlace(base: Path) -> None:
    if base.stat().st_nlink == 1:
        return
    sha = hashlib.sha256(base.read_bytes()).hexdigest()
    patron = re.compile(r"\.crear-catalogo-" + sha + r"-[a-z0-9_]{8}")
    propios = []
    for carpeta in base.parent.glob(".crear-catalogo-" + sha + "-*"):
        if not patron.fullmatch(carpeta.name):
            continue
        dato = carpeta.lstat()
        catalogo.exigir(stat.S_ISDIR(dato.st_mode) and dato.st_uid == os.getuid(), "Intento de creación no propio")
        candidata = carpeta / "catalogo.sqlite3"
        catalogo.exigir(
            set(carpeta.iterdir()) == {candidata}
            and stat.S_ISREG(candidata.lstat().st_mode)
            and candidata.stat().st_uid == os.getuid(),
            "Intento de creación con contenido ajeno",
        )
        if candidata.samefile(base):
            propios.append(carpeta)
    catalogo.exigir(base.stat().st_nlink == 1 + len(propios), "La base conserva un alias ajeno")
    auditoria.auditar(base)
    for carpeta in propios:
        (carpeta / "catalogo.sqlite3").unlink()
        _sincronizar(carpeta)
        carpeta.rmdir()
    _sincronizar(base.parent)


def _verificar(base: Path) -> ObjetoJson:
    for parte in (base, *base.parents):
        catalogo.exigir(not parte.is_symlink(), "La base no admite enlaces simbólicos")
    dato = base.lstat()
    catalogo.exigir(stat.S_ISREG(dato.st_mode) and dato.st_nlink == 1, "La base debe ser un archivo regular único")
    return auditoria.auditar(base)


def esquema() -> str:
    """El DDL completo de un catálogo V10, en el orden en que se crea.

    Returns:
        Las sentencias de tablas, índices y disparadores de todas las piezas del catálogo.
    """
    return (
        catalogo.ESQUEMA
        + catalogo.ESQUEMA_OFERTA
        + catalogo.ESQUEMA_APRENDIZAJE
        + catalogo.ESQUEMA_PROCEDENCIAS_APRENDIZAJE
        + catalogo.ESQUEMA_TEMPORAL
        + enriquecimiento_legado.ESQUEMA
        + unidades_vigencia.ESQUEMA
        + unidades_vigencia.INDICES
        + contenidos_vigencia.ESQUEMA
    )


def _crear(candidata: Path) -> None:
    with closing(sqlite3.connect(candidata)) as conexion:
        conexion.execute("PRAGMA foreign_keys=ON")
        conexion.execute("BEGIN IMMEDIATE")
        try:
            catalogo.ejecutar_esquema(conexion, esquema())
            conexion.execute(f"PRAGMA user_version={catalogo.VERSION_SQLITE_CONTENIDOS}")
            conexion.commit()
        except BaseException:
            conexion.rollback()
            raise
    _verificar(candidata)
    with candidata.open("rb") as archivo:
        os.fsync(archivo.fileno())


def _publicar(base: Path) -> ObjetoJson:
    trabajo = Path(tempfile.mkdtemp(prefix=".crear-catalogo-", dir=base.parent))
    try:
        candidata = trabajo / "catalogo.sqlite3"
        _crear(candidata)
        sha = hashlib.sha256(candidata.read_bytes()).hexdigest()
        identificado = trabajo.with_name(".crear-catalogo-" + sha + "-" + trabajo.name.removeprefix(".crear-catalogo-"))
        trabajo.rename(identificado)
        trabajo = identificado
        candidata = trabajo / "catalogo.sqlite3"
        _sincronizar(trabajo)
        _sincronizar(base.parent)
        try:
            base.hardlink_to(candidata)
        except FileExistsError:
            _recuperar_enlace(base)
            return {"creada": False, "version": catalogo.VERSION_SQLITE_CONTENIDOS, "recuentos": _verificar(base)}
        _sincronizar(base.parent)
        candidata.unlink()
        _sincronizar(trabajo)
        return {"creada": True, "version": catalogo.VERSION_SQLITE_CONTENIDOS, "recuentos": _verificar(base)}
    finally:
        shutil.rmtree(trabajo)
        _sincronizar(base.parent)


def crear(base: str | Path) -> ObjetoJson:
    """Crea V10 directamente; repetir solo audita y conserva todos los bytes y fechas.

    No importa datos, observa fuentes, migra bases anteriores ni publica ofertas.
    Una candidata privada se enlaza al destino solo después de su auditoría.
    Un corte no capturable puede conservar el intento privado, nunca una base
    parcial en el destino. Si ya se enlazó, se retira solo su alias temporal
    identificado por SHA bajo la misma exclusión. No se sobrescribe un archivo aparecido concurrentemente.

    Returns:
        Estado de creación y recuentos descriptivos, sin admisión o vigencia remota.

    Raises:
        catalogo.ErrorCatalogo: Si el destino no es V10 íntegro o contiene enlaces.
    """
    base = Path(base).absolute()
    for parte in (base, *base.parents):
        catalogo.exigir(not parte.is_symlink(), "La base no admite enlaces simbólicos")
    with _exclusion(base.parent):
        if base.exists():
            _recuperar_enlace(base)
            return {"creada": False, "version": catalogo.VERSION_SQLITE_CONTENIDOS, "recuentos": _verificar(base)}
        return _publicar(base)


def main(argv: list[str] | None = None) -> int:
    """Expone la primera creación sin aceptar entradas de versiones anteriores.

    Returns:
        Cero tras crear o verificar V10; dos si la entrada o SQLite no son válidas.
    """
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        print(json.dumps(crear(args.base), ensure_ascii=False, indent=2))
    except (ValueError, OSError, sqlite3.Error) as error:
        print(f"No se creó el catálogo: {error}")
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
