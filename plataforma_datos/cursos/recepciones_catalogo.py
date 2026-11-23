"""Transporte y conservación de recepción para los productores de Cursos.

Usa identidad, TLS, serialización por dominio, EOF y cotas del transporte común.
No interpreta campos de cursos ni convierte una consulta en oferta acreditada.
"""

import fcntl
import hashlib
import json
import os
import re
import stat
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from http import HTTPStatus
from http.client import IncompleteRead
from pathlib import Path
from ssl import SSLError
from urllib.error import HTTPError, URLError

from plataforma_datos.comun import perfil_web, red
from plataforma_datos.comun.entrada_salida import temporal_hermano
from plataforma_datos.comun.nucleo import FormatoInesperado
from plataforma_datos.comun.observacion_remota import observar
from plataforma_datos.cursos import trozos_catalogo
from plataforma_datos.cursos.admision_catalogo import ReferenciaArchivo
from plataforma_datos.cursos.contrato_entrega_catalogo import ErrorEntregaCatalogo, exigir
from plataforma_datos.cursos.tipos_json import ObjetoJson

MAX_CUERPO = 8 * 1024 * 1024
MAX_CUERPO_CATALOGO = 64 * 1024 * 1024


@dataclass(frozen=True, kw_only=True)
class RespuestaCatalogo:
    """Un intento HTTP completo o fallido, con sus tiempos reales independientes."""

    url: str
    inicio_utc: str
    fin_utc: str
    cuerpo: bytes | None
    url_final: str | None = None
    http: int | None = None
    completo: bool = False
    content_type: str | None = None
    error: str | None = None
    redireccion: str | None = None


def ahora_utc() -> str:
    """Devuelve el reloj de recepción, nunca una fecha de consulta histórica.

    Returns:
        Instante real consciente de UTC.
    """
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def json_bytes(dato: ObjetoJson) -> bytes:
    """Serializa un recibo íntegro y determinista.

    Returns:
        UTF-8 sin constantes no JSON.
    """
    return (
        json.dumps(dato, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False) + "\n"
    ).encode()


def _limite(maximo: int) -> int:
    exigir(type(maximo) is int and 0 < maximo <= MAX_CUERPO_CATALOGO, "Cota de recepción no admitida")
    return maximo


def _mismo_cuerpo(ruta: Path, cuerpo: bytes, sha: str) -> None:
    # El destino puede guardar el cuerpo entero o su manifiesto: se compara lo reconstruido y verificado.
    try:
        conservado = trozos_catalogo.leer(ruta, sha, limite=MAX_CUERPO_CATALOGO)
    except trozos_catalogo.ErrorTrozos as error:
        raise ErrorEntregaCatalogo("Colisión de recepción conservada") from error
    exigir(conservado == cuerpo, "Colisión de recepción conservada")


def _mismos_bytes(ruta: Path, cuerpo: bytes) -> None:
    exigir(
        stat.S_ISREG(ruta.lstat().st_mode) and ruta.stat().st_size == len(cuerpo), "Colisión de recepción conservada"
    )
    with ruta.open("rb") as archivo:
        exigir(archivo.read(len(cuerpo) + 1) == cuerpo, "Colisión de recepción conservada")


def _retirar_temporales(area: Path, sha: str, destino: Path) -> None:
    # Espacio reservado del escritor. El flock excluye cualquier temporal todavía activo.
    patron = re.compile(r"\.recepcion-" + sha + r"-[a-z0-9_]{8}\.tmp")
    propios = [p for p in area.glob(".recepcion-" + sha + "-*.tmp") if patron.fullmatch(p.name)]
    for ruta in propios:
        dato = ruta.lstat()
        exigir(stat.S_ISREG(dato.st_mode) and dato.st_uid == os.getuid(), "Temporal sin propiedad acreditada")
        exigir(ruta.samefile(destino) or dato.st_nlink == 1, "Temporal con alias ajeno")
    exigir(destino.stat().st_nlink == 1 + sum(p.samefile(destino) for p in propios), "Recepción con alias ajeno")
    for ruta in propios:
        ruta.unlink()


def _promover(destino: Path, cuerpo: bytes, sha: str, *, trozos: bool) -> None:
    """Escribe un temporal propio y lo enlaza en exclusiva; el llamador tiene el cerrojo.

    Un cuerpo grande se guarda como manifiesto y trozos compartidos; su ruta y su huella no cambian.
    """
    manifiesto = trozos_catalogo.preparar_manifiesto(destino, cuerpo) if trozos else None
    contenido = cuerpo if manifiesto is None else manifiesto
    temporal = None
    try:
        with temporal_hermano(destino.parent, prefijo=".recepcion-" + sha + "-", sufijo=".tmp") as archivo:
            temporal = Path(archivo.name)
            archivo.write(contenido)
            archivo.flush()
            os.fsync(archivo.fileno())
        _mismos_bytes(temporal, contenido)
        if manifiesto is not None:
            _mismo_cuerpo(temporal, cuerpo, sha)
        try:
            # link crea exclusivamente: ni siquiera un escritor ajeno puede ser sobrescrito.
            os.link(temporal, destino, follow_symlinks=False)
        except FileExistsError:
            _mismo_cuerpo(destino, cuerpo, sha)
    finally:
        if temporal is not None:
            temporal.unlink(missing_ok=True)


def conservar_bytes(area: Path, cuerpo: bytes, extension: str, *, maximo_bytes: int = MAX_CUERPO) -> ReferenciaArchivo:
    """Conserva por SHA con temporal y promoción exclusiva, sin reemplazar bytes distintos.

    Un corte durante escritura solo deja un temporal propio; un corte después del
    enlace deja bytes completos. El siguiente intento conserva el nombre/mtime
    final y retira únicamente temporales del mismo SHA bajo el mismo cerrojo.

    Returns:
        Referencia a bytes íntegros, conservando mtime si ya existían.
    """
    exigir(type(cuerpo) is bytes and len(cuerpo) <= _limite(maximo_bytes), "Cuerpo de recepción excesivo o inválido")
    exigir(re.fullmatch(r"\.[a-z][a-z0-9.-]{0,31}", extension) is not None, "Extensión no admitida")
    sha = hashlib.sha256(cuerpo).hexdigest()
    destino = area / (sha + extension)
    exigir(all(not p.is_symlink() for p in (destino.absolute(), *destino.absolute().parents)), "Destino enlazado")
    area.mkdir(parents=True, exist_ok=True)
    fd = os.open(area / ".recepciones.cerrojo", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "a") as cerrojo:
        exigir(stat.S_ISREG(os.fstat(fd).st_mode) and os.fstat(fd).st_nlink == 1, "Cerrojo no regular o enlazado")
        fcntl.flock(cerrojo, fcntl.LOCK_EX)
        if not destino.exists():
            _promover(destino, cuerpo, sha, trozos=extension == ".body")
        _mismo_cuerpo(destino, cuerpo, sha)
        # Eliminar temporales y verificar alias aún exige la misma exclusión.
        try:
            _retirar_temporales(area, sha, destino)
            directorio = os.open(area, os.O_RDONLY)
            try:
                os.fsync(directorio)
            finally:
                os.close(directorio)
        finally:
            fcntl.flock(cerrojo, fcntl.LOCK_UN)
    return ReferenciaArchivo(ruta=destino, sha256=sha)


def consultar(  # noqa: PLR0913 - El plazo de red explícito lo fija quien tiene un presupuesto propio.
    url: str,
    *,
    perfil: perfil_web.Uso,
    reloj: Callable[[], str] = ahora_utc,
    maximo_bytes: int = MAX_CUERPO,
    tipo_respuesta: str | None = None,
    segundos: int | None = None,
    seguir_redirecciones: bool = True,
) -> RespuestaCatalogo:
    """Consulta un recurso público; el productor valida previamente su identidad/URL.

    Sin `seguir_redirecciones`, una redirección es la respuesta: conserva su código y su destino (`redireccion`).

    Los fallos técnicos de lectura conservan su causa y el HTTP observado si
    existe; no acreditan cuerpo completo ni cierre. Errores de programación se propagan.

    Returns:
        Respuesta completa, parcial o fallo sin respuesta. No decide disponibilidad.

    Raises:
        RuntimeError: Si el transporte viola su contrato y no aporta estado HTTP.
        FormatoInesperado: Si se rechaza configuración o contrato local antes de recibir HTTP.
        PlazoSinEnvio: Si el tiempo se agotó en la espera previa a la petición.
    """
    maximo = _limite(maximo_bytes)
    exigir(tipo_respuesta in (None, "application/ld+json"), "Representación de catálogo no admitida")
    negociacion = {} if tipo_respuesta is None else {"cabeceras": {"Accept": tipo_respuesta}}
    inicio, status, parcial, destino = reloj(), None, False, None
    apertura = {} if seguir_redirecciones else {"seguir_redirecciones": False}
    hasta = None if segundos is None else time.monotonic() + segundos
    if hasta is not None:
        apertura["hasta"] = hasta

    def cabeceras(codigo: int, _final: str, recibidas: Mapping[str, str]) -> None:
        nonlocal status, parcial
        status = codigo
        parcial = any(str(k).lower() == "content-range" for k in recibidas)

    try:
        descarga = red.descargar_url(
            url,
            **negociacion,
            **apertura,
            segundos=red.SEGUNDOS_DESCARGA if segundos is None else segundos,
            perfil=perfil,
            maximo_bytes=maximo,
            comprobar_cabeceras=cabeceras,
        )
        cuerpo, final, mime = descarga
    except HTTPError as error:
        destino = None if seguir_redirecciones else error.headers.get("Location")
        try:
            with error:
                cuerpo = red.leer_respuesta_hasta(error, url, hasta, maximo)
                final, mime, status = error.geturl(), error.headers.get("Content-Type", ""), error.code
                parcial = any(str(k).lower() == "content-range" for k in error.headers)
                observar(url, "GET", None, final, cuerpo)
        except (URLError, TimeoutError, ConnectionError, SSLError, IncompleteRead, FormatoInesperado) as fallo:
            return RespuestaCatalogo(
                url=url,
                inicio_utc=inicio,
                fin_utc=reloj(),
                cuerpo=None,
                url_final=error.geturl(),
                http=error.code,
                error=type(fallo).__name__,
                redireccion=destino,
            )
    except red.PlazoSinEnvio:
        raise
    except FormatoInesperado as error:
        if status is None:
            # Configuración/contrato local rechazado antes de recibir HTTP: no lo atribuye al proveedor.
            raise
        return RespuestaCatalogo(
            url=url, inicio_utc=inicio, fin_utc=reloj(), cuerpo=None, http=status, error=type(error).__name__
        )
    except (URLError, TimeoutError, ConnectionError, SSLError, IncompleteRead) as error:
        return RespuestaCatalogo(
            url=url, inicio_utc=inicio, fin_utc=reloj(), cuerpo=None, http=status, error=type(error).__name__
        )
    if status is None:
        raise RuntimeError("El transporte no aporta el estado HTTP de la recepción")
    return RespuestaCatalogo(
        url=url,
        inicio_utc=inicio,
        fin_utc=reloj(),
        cuerpo=cuerpo,
        url_final=final,
        http=status,
        completo=status != HTTPStatus.PARTIAL_CONTENT and not parcial,
        content_type=mime,
        redireccion=destino,
    )
