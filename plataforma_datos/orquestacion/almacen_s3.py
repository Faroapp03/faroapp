"""Objetos privados inmutables mediante el SDK S3, con credenciales y destino explícitos.

Un PUT o un ETag no acreditan conservación: cada escritura termina con GET completo y SHA256. No se siguen
redirecciones, descubren credenciales o borran objetos. Los directorios de trabajo pertenecen al job.
"""

from __future__ import annotations

import hashlib
import io
import os
import re
import stat
import tempfile
import time
from collections.abc import Iterator
from contextlib import contextmanager
from http import HTTPStatus
from pathlib import Path
from types import TracebackType
from typing import BinaryIO
from urllib.parse import urlsplit

from botocore.awsrequest import AWSPreparedRequest, AWSRequest, AWSResponse
from botocore.exceptions import BotoCoreError, ClientError
from urllib3.response import HTTPResponse

from plataforma_datos.comun.nucleo import FormatoInesperado
from plataforma_datos.comun.perfil_web import cabeceras_identidad
from plataforma_datos.comun.red import registrar_redireccion, turno_por_dominio
from plataforma_datos.orquestacion.cliente_s3 import SOCKET_S, crear_cliente
from plataforma_datos.orquestacion.configuracion_almacen_s3 import (
    ERROR_INVALIDO,
    AlmacenS3Invalido,
    ConfiguracionAlmacenS3,
    comprobar_configuracion,
)
from plataforma_datos.orquestacion.formas_del_diario import CLAVE_RESUMEN, MAX_RESUMEN

MAX_OBJETO_BYTES = 4 * 1024**3
TAM_BLOQUE = 64 * 1024
# Una conexión que lleva más de un minuto sin usarse no se reutiliza. El proveedor o un intermediario pueden haberla
# cerrado sin avisar, y entonces la primera petición agota SOCKET_S antes de fallar: le pasó al recibo de un ciclo tras
# las dos horas del motor. Abrir una conexión nueva cuesta un saludo TLS; reutilizar una muerta cuesta la petición.
REPOSO_MAXIMO_S = 60
PLAZO_LECTURA_S = 300
PLAZO_SUBIDA_S = 300
SHA256 = re.compile(r"[0-9a-f]{64}")
CLAVE = re.compile(r"(?:blobs/([0-9a-f]{64})|(?:generaciones|artefactos)/([0-9a-f]{64})\.json)")
MAX_CONTROL_BYTES = 8192
MAX_ETAG = 1024
REFERENCIA = "referencias/mantenimiento.json"
CLAVE_CONTROL = re.compile(
    r"(?:referencias/mantenimiento\.json|agrupaciones/v1/(?:generaciones|artefactos)/[0-9a-f]{64}\.sha256|"
    r"diarios/[1-9][0-9]{0,15}/[1-9][0-9]{0,15}/(?:ejecutar|reanudar|activar|recuperar|reconciliar)\.json|"
    rf"{CLAVE_RESUMEN.pattern}|"
    r"inventarios/cursos/v1/[0-9a-f]{64}\.json|evidencias/fundae/v1/[0-9a-f]{64}\.sha256|"
    r"(?:trabajos|desbloqueos)/"
    r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/"
    r"[1-9][0-9]{0,15}/[1-9][0-9]{0,15}\.json)"
)
ERROR_DISPONIBILIDAD = "Almacén privado no disponible."
ERROR_AUSENTE = "El objeto pedido no existe en el almacén privado."


class AlmacenS3NoDisponible(OSError):
    """No se pudo acreditar la operación; no autoriza reenviar automáticamente."""


class AlmacenS3Ausente(AlmacenS3NoDisponible, FileNotFoundError):
    """Una lectura recibió 404: el objeto no existe. Quien no lo distingue lo trata como no disponible."""


class _ObjetoExistente(Exception):
    """El PUT condicional necesita cotejar el objeto completo que ya existe."""


class _ControlAusente(Exception):
    """Solo un GET404 de un control cerrado significa inexistencia."""


# Lo que una petición lanza cuando el almacén ha respondido: no dice nada malo de la conexión.
RESPUESTAS_DEL_ALMACEN = (_ObjetoExistente, _ControlAusente, AlmacenS3Ausente)


def _comprobar_plazo(plazo: float) -> None:
    if time.monotonic() >= plazo:
        raise AlmacenS3NoDisponible(ERROR_DISPONIBILIDAD)


class _CopiaConPlazo(io.BufferedReader):
    """La misma cota protege las lecturas del SDK al firmar y al transmitir el cuerpo.

    No interrumpe una escritura de socket ya comenzada: permanece el margen de timeout del SDK/SO.
    """

    def __init__(self, archivo: BinaryIO, plazo: float) -> None:
        super().__init__(archivo)
        self.plazo = plazo

    def read(self, size: int | None = -1) -> bytes:
        _comprobar_plazo(self.plazo)
        bloque = super().read(size)
        _comprobar_plazo(self.plazo)
        return bloque


def _exigir(condicion: bool) -> None:
    if not condicion:
        raise AlmacenS3Invalido(ERROR_INVALIDO)


def _limite(valor: int) -> None:
    _exigir(type(valor) is int and 0 <= valor <= MAX_OBJETO_BYTES)


def _clave(clave: str, sha256: str) -> None:
    _exigir(isinstance(sha256, str) and SHA256.fullmatch(sha256) is not None)
    coincidencia = CLAVE.fullmatch(clave) if isinstance(clave, str) else None
    _exigir(coincidencia is not None and sha256 in coincidencia.groups())


def _control(clave: str) -> int:
    _exigir(isinstance(clave, str) and CLAVE_CONTROL.fullmatch(clave) is not None)
    if clave.startswith(("trabajos/", "desbloqueos/")):
        _exigir(all(int(valor) <= 2**53 - 1 for valor in clave.removesuffix(".json").split("/")[2:]))
    # Solo el resumen del diario supera el tope común de los controles.
    return MAX_RESUMEN if CLAVE_RESUMEN.fullmatch(clave) else MAX_CONTROL_BYTES


def _etag(valor: object) -> None:
    # Una entidad fuerte única: '*' y listas alterarían la semántica de IfMatch, aunque sean ASCII.
    _exigir(
        isinstance(valor, str) and len(valor) <= MAX_ETAG and re.fullmatch(r'"[\x21\x23-\x7e]*"', valor) is not None
    )


def _sin_reenvio(response: tuple | None = None, caught_exception: Exception | None = None, **_opciones: object) -> None:
    if caught_exception is not None:
        raise caught_exception
    if response is not None and response[0].status_code >= HTTPStatus.MULTIPLE_CHOICES:
        raise AlmacenS3NoDisponible(ERROR_DISPONIBILIDAD)


def _copiar_origen(origen: Path, salida: BinaryIO, sha256: str, esperados: int, plazo: float) -> None:
    _exigir(stat.S_ISREG(origen.lstat().st_mode))
    descriptor = os.open(origen, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC | os.O_NONBLOCK)
    with os.fdopen(descriptor, "rb") as archivo:
        datos = os.fstat(archivo.fileno())
        _exigir(stat.S_ISREG(datos.st_mode) and datos.st_nlink == 1 and datos.st_size == esperados)
        huella = hashlib.sha256()
        total = 0
        while True:
            _comprobar_plazo(plazo)
            bloque = archivo.read(TAM_BLOQUE)
            _comprobar_plazo(plazo)
            if not bloque:
                break
            total += len(bloque)
            _exigir(total <= esperados)
            huella.update(bloque)
            salida.write(bloque)
        _exigir(total == esperados and huella.hexdigest() == sha256)
        _comprobar_plazo(plazo)
    salida.seek(0)


def _destino_nuevo(destino: Path) -> None:
    _exigir(stat.S_ISDIR(destino.parent.lstat().st_mode))
    _exigir(not destino.exists() and not destino.is_symlink())


class AlmacenS3:
    """Transporte síncrono con PUT condicional, GET cotejado y cierre definitivo del cliente."""

    def __init__(self, configuracion: ConfiguracionAlmacenS3) -> None:
        comprobar_configuracion(configuracion)
        try:
            self._identidad = cabeceras_identidad()
            self._agente = self._identidad["User-Agent"]
        except (FormatoInesperado, ValueError):
            raise AlmacenS3Invalido(ERROR_INVALIDO) from None
        self._configuracion = configuracion
        self._cerrado = False
        self._ultimo_envio: str | None = None
        self._ultima_respuesta: AWSResponse | None = None
        self._plazo_peticion: float | None = None
        # Cuándo terminó la última petición y si falló por algo que no es una respuesta del almacén.
        self._fin_ultima_peticion: float | None = None
        self._ultima_fallida = False
        self._cliente = crear_cliente(configuracion, self._agente)
        self._cliente.meta.events.register_last("before-sign.s3", self._identificar)
        self._cliente.meta.events.register_first("before-send.s3", self._enviar)
        self._cliente.meta.events.register_first("needs-retry.s3", _sin_reenvio)

    def _comprobar_abierto(self) -> None:
        if self._cerrado:
            raise AlmacenS3NoDisponible(ERROR_DISPONIBILIDAD)

    def _nombre(self, clave: str) -> str:
        prefijo = self._configuracion.prefijo
        return f"{prefijo}/{clave}" if prefijo else clave

    @contextmanager
    def _peticion(self, clave: str, plazo: float) -> Iterator[None]:
        """Mantiene el turno común hasta cerrar el cuerpo, incluso si falla el parser del SDK.

        Yields:
            Permiso para una operación del SDK con todos sus intentos HTTP instrumentados.
        """
        url = f"{self._configuracion.endpoint}/{self._configuracion.bucket}/{self._nombre(clave)}"
        with turno_por_dominio(url):
            self._ultimo_envio = None
            self._ultima_respuesta = None
            self._plazo_peticion = plazo
            try:
                _comprobar_plazo(plazo)
                self._conexiones_para_la_peticion()
                yield
            except BaseException as error:
                # Un objeto existente o ausente es una respuesta del almacén: la conexión ha funcionado.
                self._ultima_fallida = not isinstance(error, RESPUESTAS_DEL_ALMACEN)
                raise
            finally:
                try:
                    if self._ultima_respuesta is not None:
                        self._ultima_respuesta.raw.close()
                finally:
                    self._ultimo_envio = None
                    self._ultima_respuesta = None
                    self._plazo_peticion = None
                    self._fin_ultima_peticion = time.monotonic()
            _comprobar_plazo(plazo)

    def _conexiones_para_la_peticion(self) -> None:
        """Vacía el conjunto de conexiones si la petición anterior falló o lleva más de REPOSO_MAXIMO_S en reposo.

        Así la petición abre una conexión nueva en lugar de reutilizar una que el otro extremo puede haber cerrado.
        """
        en_reposo = (
            self._fin_ultima_peticion is not None and time.monotonic() - self._fin_ultima_peticion > REPOSO_MAXIMO_S
        )
        if self._ultima_fallida or en_reposo:
            self._cliente._endpoint.http_session.close()
        self._ultima_fallida = False

    def _identificar(self, request: AWSRequest, **_opciones: object) -> None:
        """Fija la identidad antes de firmar; las pistas quedan incluidas en SigV4."""
        nombres = {nombre.lower() for nombre in self._identidad} | {"x-amz-user-agent"}
        for nombre in list(request.headers):
            if nombre.lower() in nombres:
                del request.headers[nombre]
        for nombre, valor in self._identidad.items():
            request.headers[nombre] = valor

    def _enviar(self, request: AWSPreparedRequest, **_opciones: object) -> AWSResponse:
        configuracion = self._configuracion
        url = urlsplit(request.url)
        base = urlsplit(configuracion.endpoint)
        _exigir(url.scheme == base.scheme and url.netloc == base.netloc and not url.query and not url.fragment)
        inicio = f"/{configuracion.bucket}/{self._nombre('')}"
        _exigir(url.path.startswith(inicio))
        clave = url.path[len(inicio) :]
        es_control = CLAVE_CONTROL.fullmatch(clave) is not None
        _exigir(CLAVE.fullmatch(clave) is not None or es_control)
        _exigir(request.method in ("GET", "PUT"))
        if request.method == "PUT":
            _exigir(isinstance(request.body, _CopiaConPlazo))
            _comprobar_plazo(request.body.plazo)
        _exigir(self._plazo_peticion is not None)
        if self._ultimo_envio is not None:
            if self._ultima_respuesta is not None:
                self._ultima_respuesta.raw.close()
            registrar_redireccion(self._ultimo_envio, request.url)
        _comprobar_plazo(self._plazo_peticion)
        self._ultimo_envio = request.url
        self._ultima_respuesta = None
        # El SDK ya ha firmado la petición; User-Agent no forma parte de sus cabeceras firmadas.
        for nombre, valor in self._identidad.items():
            request.headers[nombre] = valor
        _exigir(not any(nombre.lower() == "x-amz-user-agent" for nombre in request.headers))
        request.stream_output = True
        respuesta = self._cliente._endpoint.http_session.send(request)
        self._ultima_respuesta = respuesta
        _comprobar_plazo(self._plazo_peticion)
        if request.method == "GET" and respuesta.status_code == HTTPStatus.OK:
            return respuesta
        respuesta.raw.close()
        _comprobar_plazo(self._plazo_peticion)
        if es_control and request.method == "GET" and respuesta.status_code == HTTPStatus.NOT_FOUND:
            raise _ControlAusente()
        if request.method == "PUT" and respuesta.status_code == HTTPStatus.PRECONDITION_FAILED:
            raise _ObjetoExistente()
        if request.method == "GET" and respuesta.status_code == HTTPStatus.NOT_FOUND:
            raise AlmacenS3Ausente(ERROR_AUSENTE)
        if request.method != "PUT" or respuesta.status_code != HTTPStatus.OK:
            raise AlmacenS3NoDisponible(ERROR_DISPONIBILIDAD)
        # Evita que el parser del SDK acumule o registre un cuerpo PUT inesperado o un error del proveedor.
        return AWSResponse(
            request.url, HTTPStatus.OK, respuesta.headers, HTTPResponse(body=io.BytesIO(b""), preload_content=False)
        )

    def _descargar(self, clave: str, sha256: str, limite: int, salida: BinaryIO | None) -> int:
        comienzo = time.monotonic()
        with self._peticion(clave, comienzo + PLAZO_LECTURA_S):
            respuesta = self._cliente.get_object(Bucket=self._configuracion.bucket, Key=self._nombre(clave))
            return self._leer_respuesta(respuesta, comienzo, limite, salida, sha256)

    def _leer_respuesta(
        self, respuesta: dict, comienzo: float, limite: int, salida: BinaryIO | None, sha256: str | None = None
    ) -> int:
        cuerpo = respuesta["Body"]
        try:
            longitud = respuesta.get("ContentLength")
            _exigir(type(longitud) is int and 0 <= longitud <= limite)
            huella = hashlib.sha256()
            total = 0
            while True:
                restante = comienzo + PLAZO_LECTURA_S - time.monotonic()
                if restante <= 0:
                    raise AlmacenS3NoDisponible(ERROR_DISPONIBILIDAD)
                # Al llegar a Content-Length, urllib3 puede haber devuelto el socket al pool.
                # La lectura final sigue comprobando el fin del cuerpo y su plazo total.
                if total < longitud:
                    cuerpo.set_socket_timeout(min(SOCKET_S, restante))
                bloque = cuerpo.read(min(TAM_BLOQUE, limite - total + 1))
                if time.monotonic() - comienzo >= PLAZO_LECTURA_S:
                    raise AlmacenS3NoDisponible(ERROR_DISPONIBILIDAD)
                if not bloque:
                    break
                total += len(bloque)
                _exigir(total <= longitud)
                huella.update(bloque)
                if salida is not None:
                    salida.write(bloque)
            _exigir(total == longitud and (sha256 is None or huella.hexdigest() == sha256))
            return total
        finally:
            cuerpo.close()

    def leer_control(self, clave: str, bytes_maximos: int) -> tuple[bytes, str] | None:
        """Lee un índice/referencia íntegro y acotado; el ETag solo permite una CAS, no acredita integridad.

        Returns:
            Bytes exactos y ETag opaco, o None exclusivamente ante 404 de la clave cerrada.

        Raises:
            AlmacenS3NoDisponible: Si no puede acreditar una lectura íntegra dentro de sus cotas.
            ValueError: Si el control o su ETag no tienen la forma admitida.
        """
        self._comprobar_abierto()
        tope = _control(clave)
        _exigir(type(bytes_maximos) is int and 0 < bytes_maximos <= tope)
        comienzo = time.monotonic()
        try:
            with self._peticion(clave, comienzo + PLAZO_LECTURA_S):
                respuesta = self._cliente.get_object(Bucket=self._configuracion.bucket, Key=self._nombre(clave))
                try:
                    etag = respuesta.get("ETag")
                    _etag(etag)
                except ValueError:
                    respuesta["Body"].close()
                    raise
                with io.BytesIO() as salida:
                    self._leer_respuesta(respuesta, comienzo, bytes_maximos, salida)
                    return salida.getvalue(), etag
        except _ControlAusente:
            return None
        except (BotoCoreError, ClientError, OSError):
            raise AlmacenS3NoDisponible(ERROR_DISPONIBILIDAD) from None

    def guardar_control(self, clave: str, contenido: bytes, etag_esperado: str | None) -> bool:
        """PUT condicional de control, sin retry ni confirmación implícita; el consumidor debe releer exacto.

        Returns:
            False solo ante 412; True significa respuesta 200, todavía pendiente del cotejo por lectura.

        Raises:
            AlmacenS3NoDisponible: Si el resultado del PUT es incierto o no admitido.
        """
        self._comprobar_abierto()
        tope = _control(clave)
        _exigir(type(contenido) is bytes and 0 < len(contenido) <= tope)
        condicion = {"IfNoneMatch": "*"}
        if etag_esperado is not None:
            _exigir(clave == REFERENCIA)
            _etag(etag_esperado)
            condicion = {"IfMatch": etag_esperado}
        try:
            with (
                _CopiaConPlazo(io.BytesIO(contenido), time.monotonic() + PLAZO_SUBIDA_S) as cuerpo,
                self._peticion(clave, cuerpo.plazo),
            ):
                self._cliente.put_object(
                    Bucket=self._configuracion.bucket,
                    Key=self._nombre(clave),
                    Body=cuerpo,
                    ContentLength=len(contenido),
                    **condicion,
                )
            return True
        except _ObjetoExistente:
            return False
        except ClientError as error:
            if error.response.get("ResponseMetadata", {}).get("HTTPStatusCode") == HTTPStatus.PRECONDITION_FAILED:
                return False
            raise AlmacenS3NoDisponible(ERROR_DISPONIBILIDAD) from None
        except (BotoCoreError, OSError):
            raise AlmacenS3NoDisponible(ERROR_DISPONIBILIDAD) from None

    def guardar(self, clave: str, origen: Path, sha256: str, bytes_esperados: int) -> None:
        """Conserva un objeto solo tras PUT condicional o 412 y GET completo de sus bytes exactos.

        Raises:
            AlmacenS3NoDisponible: Si no se acredita la operación dentro de sus cotas.
        """
        self._comprobar_abierto()
        _clave(clave, sha256)
        _limite(bytes_esperados)
        plazo = time.monotonic() + PLAZO_SUBIDA_S
        try:
            with tempfile.TemporaryFile() as copia:
                _copiar_origen(origen, copia, sha256, bytes_esperados, plazo)
                with _CopiaConPlazo(copia, plazo) as cuerpo:
                    self._guardar_copia(clave, cuerpo, bytes_esperados)
                _comprobar_plazo(plazo)
                _exigir(self._descargar(clave, sha256, bytes_esperados, None) == bytes_esperados)
        except (BotoCoreError, ClientError, OSError):
            raise AlmacenS3NoDisponible(ERROR_DISPONIBILIDAD) from None

    def _guardar_copia(self, clave: str, cuerpo: _CopiaConPlazo, esperados: int) -> None:
        try:
            with self._peticion(clave, cuerpo.plazo):
                self._cliente.put_object(
                    Bucket=self._configuracion.bucket,
                    Key=self._nombre(clave),
                    Body=cuerpo,
                    ContentLength=esperados,
                    IfNoneMatch="*",
                )
        except _ObjetoExistente:
            pass
        except ClientError as error:
            if error.response.get("ResponseMetadata", {}).get("HTTPStatusCode") != HTTPStatus.PRECONDITION_FAILED:
                raise AlmacenS3NoDisponible(ERROR_DISPONIBILIDAD) from None

    def recuperar(self, clave: str, destino_nuevo: Path, sha256: str, bytes_maximos: int) -> None:
        """Recupera a un archivo nuevo, acotado y verificado; nunca deja una salida final parcial.

        Raises:
            AlmacenS3Ausente: Si la lectura recibe 404.
            AlmacenS3NoDisponible: Si no se acredita la lectura o la promoción del archivo.
        """
        self._comprobar_abierto()
        _clave(clave, sha256)
        _limite(bytes_maximos)
        temporal: Path | None = None
        try:
            # Dentro del try: una carpeta local que desaparece es un fallo de disponibilidad, nunca un objeto ausente.
            _destino_nuevo(destino_nuevo)
            with tempfile.NamedTemporaryFile(dir=destino_nuevo.parent, prefix=".objeto-", delete=False) as archivo:
                temporal = Path(archivo.name)
                self._descargar(clave, sha256, bytes_maximos, archivo)
                archivo.flush()
                os.fsync(archivo.fileno())
                os.link(temporal, destino_nuevo, follow_symlinks=False)
        except AlmacenS3Ausente:
            raise
        except (BotoCoreError, ClientError, OSError):
            raise AlmacenS3NoDisponible(ERROR_DISPONIBILIDAD) from None
        finally:
            if temporal is not None:
                temporal.unlink(missing_ok=True)

    def close(self) -> None:
        """Libera el cliente una sola vez; ninguna operación posterior lo reabre."""
        if not self._cerrado:
            self._cerrado = True
            self._cliente.close()

    def __enter__(self) -> AlmacenS3:
        return self

    def __exit__(
        self, _tipo: type[BaseException] | None, _error: BaseException | None, _traza: TracebackType | None
    ) -> None:
        self.close()
