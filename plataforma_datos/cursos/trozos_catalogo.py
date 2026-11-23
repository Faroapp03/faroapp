"""Conservación por trozos de los cuerpos grandes del almacén del catálogo.

Las capturas grandes cambian poco de una consulta a otra. Un cuerpo de al menos
UMBRAL bytes se conserva en su ruta de siempre como manifiesto (huella y tamaño
del cuerpo original más la lista ordenada de trozos), y cada trozo se guarda una
sola vez por su huella en `evidencias/trozos/` (véase carpeta_trozos). La identidad pública no
cambia: la ruta y la huella del inventario siguen siendo las del cuerpo original.

Los cortes dependen del contenido, no de la posición: una inserción solo altera
los trozos que la rodean. Toda lectura reconstruye y verifica huella y tamaño
antes de devolver un solo byte.
"""

import hashlib
import json
import os
import re
import stat
import zlib
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

from plataforma_datos.comun.entrada_salida import temporal_hermano

MAGIA = b"faro-trozos\n"
VERSION = 1
# Solo las capturas grandes justifican el manifiesto; las pequeñas se guardan enteras como siempre.
UMBRAL = 4 * 1024 * 1024
# Las fichas web comparten cabeceras y plantillas incluso entre ediciones de pocos KiB.
UMBRAL_FICHA = 32 * 1024
MIN_TROZO_FICHA = 4 * 1024
MAX_TROZO_FICHA = 32 * 1024
MASCARA_FICHA = 255
MIN_TROZO = 8 * 1024
MAX_TROZO = 128 * 1024
# Con un candidato cada 10-30 bytes (también dentro de base64), 1/1024 da trozos de unos 30 KiB.
MASCARA = 1023
VENTANA = 32
# Un cuerpo nunca supera la cota de entrada de la admisión; de ahí salen las cotas del manifiesto.
MAX_CUERPO = 128 * 1024 * 1024
MAX_TROZOS = MAX_CUERPO // MIN_TROZO + 1
MAX_MANIFIESTO = 2 * 1024 * 1024
CARPETA = "trozos"
RAIZ_EVIDENCIAS = "evidencias"
CARPETA_CUERPOS = "cuerpos"
# La evidencia más profunda del almacén está a cinco carpetas de `evidencias/`.
NIVELES_EVIDENCIAS = 5
# Cada trozo del manifiesto es el par [huella, bytes].
CAMPOS_TROZO = 2
TAMANO_BLOQUE = 1024 * 1024
# Candidatos de corte: separadores frecuentes en JSON y HTML y los símbolos de base64 (imágenes incrustadas),
# localizados por la expresión regular en C para no recorrer cada byte en Python.
_CANDIDATO = re.compile(rb'[\n,;:}>\]" +/]')
_SHA = re.compile("[0-9a-f]{64}")


class ErrorTrozos(ValueError):
    """Cuerpo, manifiesto o trozo que no cumple el contrato; nunca se devuelve su contenido."""


def exigir(condicion: object, mensaje: str) -> None:
    """Rechaza una condición incumplida.

    Raises:
        ErrorTrozos: Si la condición no se cumple.
    """
    if not condicion:
        raise ErrorTrozos(mensaje)


@dataclass(frozen=True, kw_only=True)
class Manifiesto:
    """Cuerpo original identificado por huella y tamaño, y sus trozos en orden."""

    sha256: str
    bytes: int
    trozos: tuple[tuple[str, int], ...]


def cortes(datos: bytes, *, ficha_mediana: bool = False) -> tuple[int, ...]:
    """Calcula los finales de trozo deterministas y definidos por el contenido.

    Un corte cae tras un separador cuya ventana previa cumple la máscara, sin bajar
    de MIN_TROZO; si no aparece ninguno antes de MAX_TROZO, se corta ahí.

    Returns:
        Posiciones finales crecientes; la última es len(datos).
    """
    minimo, maximo, mascara = (
        (MIN_TROZO_FICHA, MAX_TROZO_FICHA, MASCARA_FICHA) if ficha_mediana else (MIN_TROZO, MAX_TROZO, MASCARA)
    )
    salida, inicio, total = [], 0, len(datos)
    while total - inicio > maximo:
        fin = None
        posicion = inicio + minimo - 1
        limite = inicio + maximo
        while (encontrado := _CANDIDATO.search(datos, posicion, limite)) is not None:
            candidato = encontrado.end()
            if zlib.crc32(datos[candidato - VENTANA : candidato]) & mascara == 0:
                fin = candidato
                break
            posicion = candidato
        inicio = limite if fin is None else fin
        salida.append(inicio)
    if total > inicio or not salida:
        salida.append(total)
    return tuple(salida)


def _trozos(datos: bytes, *, ficha_mediana: bool) -> Iterator[bytes]:
    inicio = 0
    for fin in cortes(datos, ficha_mediana=ficha_mediana):
        yield datos[inicio:fin]
        inicio = fin


def _bytes_manifiesto(manifiesto: Manifiesto) -> bytes:
    dato = {
        "formato": "trozos",
        "version": VERSION,
        "sha256": manifiesto.sha256,
        "bytes": manifiesto.bytes,
        "trozos": [list(t) for t in manifiesto.trozos],
    }
    return MAGIA + (json.dumps(dato, sort_keys=True, separators=(",", ":")) + "\n").encode()


def _objeto(pares: list[tuple[str, object]]) -> dict:
    resultado = {}
    for clave, valor in pares:
        exigir(clave not in resultado, "Clave repetida en manifiesto de trozos")
        resultado[clave] = valor
    return resultado


def leer_manifiesto(contenido: bytes, *, limite: int) -> Manifiesto:
    """Valida un manifiesto canónico y acotado.

    Un trozo puede repetirse en la lista (contenido repetido, como una imagen
    incrustada dos veces): se guarda una vez y se lee una vez por admisión.

    Returns:
        Manifiesto cuyo tamaño declarado no supera el límite pedido.

    Raises:
        ErrorTrozos: Si el manifiesto no cumple el contrato.
    """
    exigir(len(contenido) <= MAX_MANIFIESTO and contenido.startswith(MAGIA), "Manifiesto de trozos no válido")
    try:
        dato = json.loads(contenido[len(MAGIA) :], object_pairs_hook=_objeto)
    except ErrorTrozos:
        raise
    except (ValueError, RecursionError) as error:
        raise ErrorTrozos("Manifiesto de trozos no válido") from error
    exigir(
        isinstance(dato, dict) and set(dato) == {"formato", "version", "sha256", "bytes", "trozos"},
        "Manifiesto de trozos incompatible",
    )
    exigir(
        dato["formato"] == "trozos" and type(dato["version"]) is int and dato["version"] == VERSION,
        "Versión de manifiesto desconocida",
    )
    exigir(isinstance(dato["sha256"], str) and _SHA.fullmatch(dato["sha256"]), "Huella de cuerpo no válida")
    exigir(type(dato["bytes"]) is int and 0 < dato["bytes"] <= min(limite, MAX_CUERPO), "Cuerpo reconstruido excesivo")
    lista = dato["trozos"]
    exigir(isinstance(lista, list) and 0 < len(lista) <= MAX_TROZOS, "Demasiados trozos o ninguno")
    trozos = []
    for trozo in lista:
        exigir(
            isinstance(trozo, list)
            and len(trozo) == CAMPOS_TROZO
            and isinstance(trozo[0], str)
            and _SHA.fullmatch(trozo[0])
            and type(trozo[1]) is int
            and 0 < trozo[1] <= MAX_TROZO,
            "Trozo declarado no válido",
        )
        trozos.append((trozo[0], trozo[1]))
    exigir(sum(t[1] for t in trozos) == dato["bytes"], "Tamaño de trozos incoherente")
    manifiesto = Manifiesto(sha256=dato["sha256"], bytes=dato["bytes"], trozos=tuple(trozos))
    exigir(_bytes_manifiesto(manifiesto) == contenido, "Manifiesto de trozos no canónico")
    return manifiesto


def _regular(ruta: Path, *, sin_alias: bool = True) -> os.stat_result:
    # Los padres ya los comprueba cada llamador (rutas de almacén canónicas); aquí, el archivo y su carpeta de trozos.
    dato = ruta.lstat()
    exigir(not stat.S_ISLNK(dato.st_mode), "Archivo con enlace simbólico")
    exigir(stat.S_ISREG(dato.st_mode), "Archivo no regular")
    exigir(not sin_alias or dato.st_nlink == 1, "Archivo de trozos con alias duro")
    return dato


def carpeta_trozos(cuerpo: Path) -> Path:
    """Sitúa los trozos por la ruta del cuerpo, nunca por lo que diga el manifiesto.

    Los originales de una fuente (`<fuente>/cuerpos/`) comparten `cuerpos/trozos/`.
    Dentro de un almacén, todas las evidencias comparten `evidencias/trozos/`, de modo
    que una captura conservada en dos rutas (por fuente y como conservada) no duplica
    sus trozos. La búsqueda de `evidencias` sube como mucho NIVELES_EVIDENCIAS carpetas:
    así nunca alcanza una carpeta homónima fuera del almacén. En otro caso, los trozos
    van junto al cuerpo.

    Returns:
        Carpeta de trozos que corresponde al cuerpo.
    """
    if cuerpo.parent.name == CARPETA_CUERPOS:
        return cuerpo.parent / CARPETA
    for padre in cuerpo.parents[:NIVELES_EVIDENCIAS]:
        if padre.name == RAIZ_EVIDENCIAS:
            return padre / CARPETA
    return cuerpo.parent / CARPETA


def ruta_trozo(cuerpo: Path, sha: str) -> Path:
    """Ruta canónica de un trozo por su huella.

    Returns:
        `<carpeta de trozos>/<sha>.trozo`.
    """
    exigir(_SHA.fullmatch(sha) is not None, "Huella de trozo no válida")
    carpeta = carpeta_trozos(cuerpo)
    exigir(not carpeta.is_symlink(), "Carpeta de trozos con enlace simbólico")
    return carpeta / (sha + ".trozo")


def _leer_trozo(cuerpo: Path, sha: str, tamano: int) -> bytes:
    ruta = ruta_trozo(cuerpo, sha)
    exigir(ruta.exists(), "Trozo ausente")
    _regular(ruta)
    with ruta.open("rb") as archivo:
        datos = archivo.read(tamano + 1)
    exigir(len(datos) == tamano and hashlib.sha256(datos).hexdigest() == sha, "Trozo alterado")
    return datos


def manifiesto_de(ruta: Path, sha: str, *, limite: int) -> Manifiesto | None:
    """Distingue un cuerpo entero de un manifiesto sin ambigüedad.

    Un archivo es manifiesto solo si empieza por MAGIA, es pequeño, su propia huella
    no es la esperada y declara exactamente la huella esperada.

    Returns:
        Manifiesto validado, o None si el archivo es el cuerpo entero.
    """
    dato = _regular(ruta, sin_alias=False)
    if dato.st_size > MAX_MANIFIESTO:
        return None
    with ruta.open("rb") as archivo:
        prefijo = archivo.read(len(MAGIA))
        if prefijo != MAGIA:
            return None
        contenido = prefijo + archivo.read(MAX_MANIFIESTO + 1 - len(prefijo))
    if hashlib.sha256(contenido).hexdigest() == sha:
        return None
    exigir(dato.st_nlink == 1, "Archivo de trozos con alias duro")
    manifiesto = leer_manifiesto(contenido, limite=limite)
    exigir(manifiesto.sha256 == sha, "Manifiesto de otro cuerpo")
    return manifiesto


def leer(ruta: Path, sha: str, *, limite: int) -> bytes:
    """Devuelve el cuerpo original, entero o reconstruido, solo tras verificarlo.

    Returns:
        Bytes cuya huella SHA-256 y tamaño coinciden con lo esperado.

    Raises:
        ErrorTrozos: Si falta algo, excede el límite o no coincide.
    """
    exigir(_SHA.fullmatch(sha) is not None, "SHA256 esperado no válido")
    exigir(ruta.exists(), "Referencia ausente o no regular")
    manifiesto = manifiesto_de(ruta, sha, limite=limite)
    if manifiesto is None:
        exigir(ruta.stat().st_size <= limite, "Archivo excede el límite de bytes")
        with ruta.open("rb") as archivo:
            datos = archivo.read(limite + 1)
        exigir(len(datos) <= limite, "Archivo creció sobre el límite")
    else:
        datos = b"".join(_leer_trozo(ruta, s, n) for s, n in manifiesto.trozos)
        exigir(len(datos) == manifiesto.bytes, "Cuerpo reconstruido con otro tamaño")
    exigir(hashlib.sha256(datos).hexdigest() == sha, "Archivo alterado respecto a su SHA256 esperado")
    return datos


def comprobar_almacenado(ruta: Path, manifiesto: Manifiesto, vistos: dict[Path, int], *, restante: int) -> int:
    """Verifica los trozos de un manifiesto leyendo cada archivo físico una sola vez.

    La admisión acota así lo que de verdad lee del disco. La huella del cuerpo
    completo se verifica al escribirlo y en cada lectura de su contenido.

    Returns:
        Bytes físicos nuevos leídos (trozos aún no vistos en esta admisión).
    """
    leidos = 0
    for sha, tamano in manifiesto.trozos:
        trozo = ruta_trozo(ruta, sha).resolve()
        if trozo in vistos:
            exigir(vistos[trozo] == tamano, "Trozo con tamaños distintos")
            continue
        exigir(leidos + tamano <= restante, "Archivo excede el límite de bytes")
        _leer_trozo(ruta, sha, tamano)
        vistos[trozo] = tamano
        leidos += tamano
    return leidos


def _escribir_exclusivo(destino: Path, contenido: bytes, prefijo: str) -> None:
    """Crea con temporal y enlace exclusivo; si ya existe, exige los mismos bytes."""
    destino.parent.mkdir(parents=True, exist_ok=True)
    if destino.exists():
        _regular(destino)
        exigir(destino.read_bytes() == contenido, "Colisión de evidencia conservada")
        return
    temporal = None
    try:
        with temporal_hermano(destino.parent, prefijo=prefijo, sufijo=".tmp") as archivo:
            temporal = Path(archivo.name)
            archivo.write(contenido)
            archivo.flush()
            os.fsync(archivo.fileno())
        try:
            os.link(temporal, destino, follow_symlinks=False)
        except FileExistsError:
            exigir(destino.read_bytes() == contenido, "Colisión de evidencia conservada")
    finally:
        if temporal is not None:
            temporal.unlink(missing_ok=True)


def preparar_manifiesto(destino: Path, cuerpo: bytes) -> bytes | None:
    """Guarda los trozos de un cuerpo grande junto a su destino.

    Returns:
        Bytes del manifiesto que reconstruye el cuerpo, o None si es pequeño y se guarda entero.
    """
    exigir(len(cuerpo) <= MAX_CUERPO, "Cuerpo excesivo para conservar")
    ficha_mediana = (
        UMBRAL_FICHA <= len(cuerpo) < UMBRAL
        and any(p.name == RAIZ_EVIDENCIAS for p in destino.parents[:NIVELES_EVIDENCIAS])
        and (
            destino.suffix in {".body", ".html"}
            or (
                destino.suffix == ".ref"
                and destino.parent.name == "conservadas"
                and cuerpo[:256].lstrip().lower().startswith((b"<!doctype html", b"<html"))
            )
        )
    )
    if len(cuerpo) < UMBRAL and not ficha_mediana:
        return None
    piezas = [(hashlib.sha256(p).hexdigest(), p) for p in _trozos(cuerpo, ficha_mediana=ficha_mediana)]
    for sha, pieza in dict(piezas).items():
        _escribir_exclusivo(ruta_trozo(destino, sha), pieza, ".trozo-")
    manifiesto = Manifiesto(
        sha256=hashlib.sha256(cuerpo).hexdigest(), bytes=len(cuerpo), trozos=tuple((s, len(p)) for s, p in piezas)
    )
    return _bytes_manifiesto(manifiesto)


def conservar(destino: Path, cuerpo: bytes, sha: str) -> None:
    """Conserva un cuerpo verificado en su ruta, entero o por trozos, sin reemplazar nada.

    Si el destino ya existe debe reconstruir exactamente el mismo cuerpo.

    Raises:
        ErrorTrozos: Si el destino existente no reconstruye el mismo cuerpo.
    """
    exigir(hashlib.sha256(cuerpo).hexdigest() == sha, "Entrada alterada antes de conservar")
    if destino.exists():
        try:
            existente = leer(destino, sha, limite=MAX_CUERPO)
        except ErrorTrozos as error:
            raise ErrorTrozos("Colisión de evidencia conservada") from error
        exigir(existente == cuerpo, "Colisión de evidencia conservada")
        return
    manifiesto = preparar_manifiesto(destino, cuerpo)
    _escribir_exclusivo(destino, cuerpo if manifiesto is None else manifiesto, ".evidencia-")
    exigir(leer(destino, sha, limite=MAX_CUERPO) == cuerpo, "Copia de evidencia distinta")


def migrar_archivo(ruta: Path, sha: str) -> bool:
    """Sustituye un cuerpo entero grande por su manifiesto, solo tras verificarlo.

    El reemplazo es atómico: ante un corte, la ruta contiene el cuerpo entero o un
    manifiesto ya verificado; los trozos sobrantes no alteran ninguna evidencia.

    Returns:
        True si se migró; False si ya era manifiesto o es pequeño.
    """
    if manifiesto_de(ruta, sha, limite=MAX_CUERPO) is not None:
        leer(ruta, sha, limite=MAX_CUERPO)
        return False
    original = ruta.stat()
    cuerpo = leer(ruta, sha, limite=MAX_CUERPO)
    manifiesto = preparar_manifiesto(ruta, cuerpo)
    if manifiesto is None:
        return False
    temporal = None
    try:
        with temporal_hermano(ruta.parent, prefijo=".migracion-", sufijo=".tmp") as archivo:
            temporal = Path(archivo.name)
            archivo.write(manifiesto)
            archivo.flush()
            os.fsync(archivo.fileno())
        # El temporal es hermano del cuerpo: sus trozos se buscan en la misma carpeta.
        exigir(leer(temporal, sha, limite=MAX_CUERPO) == cuerpo, "Manifiesto no reconstruye el cuerpo")
        exigir(leer(ruta, sha, limite=MAX_CUERPO) == cuerpo, "Cuerpo cambió durante la migración")
        # La ruta conserva permisos y fecha de modificación del cuerpo original.
        temporal.chmod(stat.S_IMODE(original.st_mode))
        os.utime(temporal, ns=(original.st_atime_ns, original.st_mtime_ns))
        temporal.replace(ruta)
        temporal = None
        directorio = os.open(ruta.parent, os.O_RDONLY)
        try:
            os.fsync(directorio)
        finally:
            os.close(directorio)
    finally:
        if temporal is not None:
            temporal.unlink(missing_ok=True)
    exigir(leer(ruta, sha, limite=MAX_CUERPO) == cuerpo, "Migración no reconstruye el cuerpo")
    return True


_TEMPORAL = re.compile(r"\.(?:migracion|trozo|evidencia|manifiesto)-[a-z0-9_]+\.tmp")


def retirar_temporales(carpeta: Path) -> None:
    """Retira los temporales propios que deja una escritura o migración interrumpida.

    Solo archivos regulares con el patrón exacto de este módulo y sin alias; nunca
    toca un cuerpo, un manifiesto ni un trozo.
    """
    for directorio in (carpeta, carpeta_trozos(carpeta / "cuerpo")):
        if not directorio.is_dir():
            continue
        exigir(not directorio.is_symlink(), "Carpeta con enlace simbólico")
        for ruta in directorio.iterdir():
            if _TEMPORAL.fullmatch(ruta.name):
                _regular(ruta)
                ruta.unlink()
