"""Cliente privado del job: OIDC fresco por fase y confirmación explícita antes de continuar.

No verifica criptografía, conserva JWT, reintenta peticiones ni ejecuta el motor. El presupuesto monotónico
rechaza confirmaciones tardías; DNS y una operación del SDK/SO ya iniciada pueden añadir margen al cierre.
"""

from __future__ import annotations

import base64
import hashlib
import json
import re
import ssl
import time
from http import HTTPStatus
from types import TracebackType
from typing import Any, Literal
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import urllib3
from urllib3.exceptions import HTTPError
from urllib3.response import HTTPResponse
from urllib3.util import Timeout

from plataforma_datos.comun.confianza_tls import contexto_tls
from plataforma_datos.comun.nucleo import FormatoInesperado
from plataforma_datos.comun.perfil_web import cabeceras_identidad
from plataforma_datos.comun.red import turno_por_dominio
from plataforma_datos.orquestacion import diario_mantenimiento as diario
from plataforma_datos.orquestacion.almacen_trabajos import ACCIONES

MAX_INICIO_BYTES = 4096
MAX_RESULTADO_BYTES = 132 * 1024 + 4 * 1024 * 1024
MAX_TOKEN_BYTES = 16_384
MAX_RESPUESTA_OIDC = 32 * 1024
MAX_CONFIRMACION_BYTES = 1024
MAX_CONSTRUCCION_BYTES = 1024
MAX_ACTIVACION_BYTES = 16 * 1024
MAX_MANIFIESTO_WEB_BYTES = 8 * 1024 * 1024
RUTA_ACTIVACION = "/mantenimiento/activacion"
MAX_URL_BYTES = 8192
MAX_AUDIENCIA_BYTES = 256
MAX_REVISION = 2**53 - 1
PLAZO_FASE_S = 15
PUERTO_HTTPS = 443
MAX_DIGITOS_LONGITUD = 10
CONEXION_S = 5
LECTURA_S = 5
TAM_BLOQUE = 4096
RUTA_INICIO = "/mantenimiento/inicio"
RUTA_RESULTADO = "/mantenimiento/resultado"
RUTA_CONSTRUCCION = "/mantenimiento/construccion"
UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}")
VERSION_ID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
JWT = re.compile(r"[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+")
TIPO_JSON = re.compile(r"application/json(?:;\s*charset=utf-8)?", re.IGNORECASE)
ERROR_GENERICO = "No se ha confirmado la operación de mantenimiento."
type Confirmacion = Literal["aplicado", "repetido"]


class ErrorMantenimiento(ValueError):
    """Un fallo o una respuesta ambigua no conceden permiso para ejecutar el motor."""


def _exigir(condicion: bool) -> None:
    if not condicion:
        raise ErrorMantenimiento(ERROR_GENERICO)


def _comparar_claim(claims: dict, nombre: str, esperado: str) -> str:
    if nombre not in claims:
        return "ausente"
    return "coincide" if claims[nombre] == claims.get(esperado) else "distinto"


def _restante(plazo: float) -> float:
    restante = plazo - time.monotonic()
    _exigir(restante > 0)
    return restante


def _url_https(valor: str) -> None:
    _exigir(isinstance(valor, str) and 0 < len(valor) <= MAX_URL_BYTES and valor.isascii())
    _exigir(not re.search(r"[\s\x00-\x1f\x7f\\]", valor))
    url = urlsplit(valor)
    _exigir(url.scheme == "https" and bool(url.hostname) and not url.username and not url.password)
    _exigir(url.username is None and url.password is None and not url.fragment and url.geturl() == valor)
    host = f"[{url.hostname}]" if ":" in url.hostname else url.hostname
    autoridad = host + (f":{url.port}" if url.port is not None and url.port != PUERTO_HTTPS else "")
    _exigir(url.netloc == autoridad and url.port != 0)


def validar_origen_publico(origen: str) -> None:
    """Valida un origen HTTPS canónico antes de reservar o ejecutar efectos remotos."""
    _url_https(origen)
    url = urlsplit(origen)
    _exigir(not url.path and not url.query)


def _direccion_oidc(origen: str, direccion: str) -> str:
    _url_https(origen)
    _exigir(not urlsplit(origen).path and not urlsplit(origen).query)
    audiencia = origen + RUTA_RESULTADO
    _exigir(len(audiencia.encode()) <= MAX_AUDIENCIA_BYTES)
    _url_https(direccion)
    url = urlsplit(direccion)
    audiencias = [
        valor
        for clave, valor in parse_qsl(
            url.query, keep_blank_values=True, strict_parsing=True, encoding="utf-8", errors="strict"
        )
        if clave == "audience"
    ]
    _exigir(not audiencias or audiencias == [audiencia])
    if audiencias:
        return direccion
    query = (url.query + "&" if url.query else "") + urlencode({"audience": audiencia})
    resultado = urlunsplit((url.scheme, url.netloc, url.path, query, ""))
    _exigir(len(resultado) <= MAX_URL_BYTES)
    return resultado


def _pares(pares: list[tuple[str, Any]]) -> dict[str, Any]:
    resultado = {}
    for clave, valor in pares:
        _exigir(clave not in resultado)
        resultado[clave] = valor
    return resultado


def _constante_invalida(_valor: str) -> None:
    raise ErrorMantenimiento(ERROR_GENERICO)


def _json(cuerpo: bytes) -> dict[str, Any]:
    valor = json.loads(cuerpo.decode("utf-8"), object_pairs_hook=_pares, parse_constant=_constante_invalida)
    _exigir(isinstance(valor, dict))
    return valor


def _leer(respuesta: HTTPResponse, limite: int, plazo: float) -> dict[str, Any]:
    _exigir(respuesta.status == HTTPStatus.OK)
    _exigir(TIPO_JSON.fullmatch(respuesta.headers.get("content-type", "")) is not None)
    _exigir(respuesta.headers.get("content-encoding", "identity").lower() == "identity")
    longitud = respuesta.headers.get("content-length")
    if longitud is not None:
        _exigir(len(longitud) <= MAX_DIGITOS_LONGITUD and re.fullmatch(r"0|[1-9][0-9]*", longitud) is not None)
        _exigir(int(longitud) <= limite)
    partes = []
    total = 0
    while True:
        restante = _restante(plazo)
        conexion = respuesta.connection
        if conexion is not None and conexion.sock is not None:
            conexion.sock.settimeout(min(LECTURA_S, restante))
        bloque = respuesta.read1(min(TAM_BLOQUE, limite - total + 1), decode_content=False)
        _restante(plazo)
        if not bloque:
            break
        total += len(bloque)
        _exigir(total <= limite)
        partes.append(bloque)
    _exigir(longitud is None or total == int(longitud))
    return _json(b"".join(partes))


class ClienteMantenimientoGitHub:
    """Mantiene solo la credencial privada de solicitud; nunca guarda el JWT de una fase."""

    def __init__(self, origen: str, url_oidc: str, token_solicitud: str) -> None:
        try:
            direccion = _direccion_oidc(origen, url_oidc)
            _exigir(isinstance(token_solicitud, str) and 0 < len(token_solicitud) <= MAX_TOKEN_BYTES)
            _exigir(re.fullmatch(r"[\x21-\x7e]+", token_solicitud) is not None)
            self._identidad = cabeceras_identidad()
        except (ValueError, TypeError, FormatoInesperado):
            raise ErrorMantenimiento(ERROR_GENERICO) from None
        self._origen = origen
        self._direccion_oidc = direccion
        self._token_solicitud = token_solicitud
        self._cerrado = False
        self._http = urllib3.PoolManager(
            num_pools=2, maxsize=1, block=True, cert_reqs=ssl.CERT_REQUIRED, ssl_context=contexto_tls()
        )

    def _pedir(  # noqa: PLR0913 - Límites diferentes para OIDC, llamada de retorno y activación; mismo transporte.
        self,
        url: str,
        token: str,
        plazo: float,
        cuerpo: bytes | None = None,
        *,
        limite_get: int = MAX_RESPUESTA_OIDC,
        limite_post: int = MAX_CONFIRMACION_BYTES,
    ) -> dict[str, Any]:
        metodo = "GET" if cuerpo is None else "POST"
        limite = limite_get if cuerpo is None else limite_post
        with turno_por_dominio(url):
            restante = _restante(plazo)
            cabeceras = {
                **self._identidad,
                "Accept": "application/json",
                "Accept-Encoding": "identity",
                "Cache-Control": "no-store",
                "Authorization": f"Bearer {token}",
            }
            if cuerpo is not None:
                cabeceras["Content-Type"] = "application/json"
            respuesta = self._http.request(
                metodo,
                url,
                body=cuerpo,
                headers=cabeceras,
                redirect=False,
                retries=False,
                preload_content=False,
                decode_content=False,
                timeout=Timeout(total=restante, connect=min(CONEXION_S, restante), read=min(LECTURA_S, restante)),
                pool_timeout=restante,
            )
            try:
                _restante(plazo)
                try:
                    return _leer(respuesta, limite, plazo)
                except ValueError:
                    diario.anotar(
                        "respuesta-http",
                        "rechazada",
                        servicio="oidc" if url == self._direccion_oidc else "autoridad",
                        http=respuesta.status,
                        tipoJsonAdmitido=bool(TIPO_JSON.fullmatch(respuesta.headers.get("content-type", ""))),
                        sinCompresion=respuesta.headers.get("content-encoding", "identity").lower() == "identity",
                    )
                    raise
            finally:
                respuesta.close()
                respuesta.release_conn()

    def _token(self, plazo: float) -> str:
        _exigir(not self._cerrado)
        respuesta = self._pedir(self._direccion_oidc, self._token_solicitud, plazo)
        token = respuesta.get("value")
        _exigir(isinstance(token, str) and 0 < len(token) <= MAX_TOKEN_BYTES and JWT.fullmatch(token) is not None)
        if diario.activo():
            # Solo orienta el diagnóstico. La autoridad continúa verificando la firma, el origen y todos sus pins.
            try:
                claims = _json(base64.urlsafe_b64decode(token.split(".")[1] + "==="))
                diario.anotar(
                    "identidad-oidc",
                    "metadatos",
                    audienciaEsperada=claims.get("aud") == self._origen + RUTA_RESULTADO,
                    referenciaDeJob=_comparar_claim(claims, "job_workflow_ref", "workflow_ref"),
                    revisionDeJob=_comparar_claim(claims, "job_workflow_sha", "workflow_sha"),
                )
            except (ValueError, TypeError, UnicodeError):
                diario.anotar("identidad-oidc", "metadatos-ilegibles")
        return token

    def _confirmar(self, ruta: str, cuerpo: bytes) -> Confirmacion:
        try:
            plazo = time.monotonic() + PLAZO_FASE_S
            with diario.paso("identidad-oidc"):
                token = self._token(plazo)
            confirmacion = self._pedir(self._origen + ruta, token, plazo, cuerpo)
            _exigir(set(confirmacion) == {"estado"} and confirmacion["estado"] in ("aplicado", "repetido"))
            _restante(plazo)
            return confirmacion["estado"]
        except (HTTPError, OSError, ValueError, TypeError, RecursionError):
            raise ErrorMantenimiento(ERROR_GENERICO) from None

    def confirmar_inicio(self, solicitud_id: str, revision_reserva: int, accion: str) -> Confirmacion:
        """Obtiene permiso solo tras una respuesta confirmada para la reserva explícita.

        Returns:
            aplicado o repetido; ningún error autoriza continuar.
        """
        _exigir(isinstance(solicitud_id, str) and UUID.fullmatch(solicitud_id) is not None)
        _exigir(type(revision_reserva) is int and 0 < revision_reserva <= MAX_REVISION and accion in ACCIONES)
        cuerpo = json.dumps(
            {"solicitudId": solicitud_id, "revisionReserva": revision_reserva, "accion": accion}, separators=(",", ":")
        ).encode()
        _exigir(len(cuerpo) <= MAX_INICIO_BYTES)
        return self._confirmar(RUTA_INICIO, cuerpo)

    def enviar_resultado(self, cuerpo: bytes) -> Confirmacion:
        """Envía los mismos bytes conservados por el ejecutor, sin modificar el recibo.

        Returns:
            aplicado o repetido, sin afirmar activación de datos.
        """
        _exigir(isinstance(cuerpo, bytes) and 0 < len(cuerpo) <= MAX_RESULTADO_BYTES)
        return self._confirmar(RUTA_RESULTADO, cuerpo)

    def observar_construccion(self) -> str:
        """Consulta la versión ejecutada; observarla no concede permiso ni confirma una activación.

        Returns:
            Identificador canónico de versión Cloudflare tras una respuesta confirmada.

        Raises:
            ErrorMantenimiento: Si no se confirma la identidad dentro del plazo y el contrato cerrados.
        """
        try:
            plazo = time.monotonic() + PLAZO_FASE_S
            with diario.paso("identidad-oidc"):
                token = self._token(plazo)
            respuesta = self._pedir(self._origen + RUTA_CONSTRUCCION, token, plazo, limite_get=MAX_CONSTRUCCION_BYTES)
            _exigir(
                set(respuesta) == {"version", "versionId"}
                and type(respuesta["version"]) is int
                and respuesta["version"] == 1
                and isinstance(respuesta["versionId"], str)
                and VERSION_ID.fullmatch(respuesta["versionId"]) is not None
            )
            _restante(plazo)
            return respuesta["versionId"]
        except (HTTPError, OSError, ValueError, TypeError, RecursionError):
            raise ErrorMantenimiento(ERROR_GENERICO) from None

    def activacion(self, operacion: str, solicitud: dict[str, Any] | None = None) -> dict[str, Any]:
        """Transfiere una operación privada cerrada con OIDC nuevo, sin reintentar.

        Returns:
            Estado privado recibido, acotado y sin interpretar como permiso de efecto remoto.

        Raises:
            ErrorMantenimiento: Si no se confirma el intercambio cerrado dentro del plazo.
        """
        _exigir(
            operacion
            in ("leer", "reservar", "reintentar", "paso", "leer-recuperacion", "recuperar", "paso-recuperacion")
        )
        _exigir((operacion in ("leer", "leer-recuperacion")) == (solicitud is None))
        documento = {"operacion": operacion}
        if solicitud is not None:
            _exigir(type(solicitud) is dict)
            documento["solicitud"] = solicitud
        try:
            cuerpo = json.dumps(documento, separators=(",", ":"), allow_nan=False).encode()
            _exigir(0 < len(cuerpo) <= MAX_ACTIVACION_BYTES)
            plazo = time.monotonic() + PLAZO_FASE_S
            respuesta = self._pedir(
                self._origen + RUTA_ACTIVACION,
                self._token(plazo),
                plazo,
                cuerpo,
                limite_post=MAX_ACTIVACION_BYTES,
            )
            estados = (
                ("leido",)
                if operacion in ("leer", "leer-recuperacion")
                else ("aplicado", "repetido", "conflicto", "ocupado")
            )
            _exigir(set(respuesta) == {"estado", "activacion"} and respuesta["estado"] in estados)
            _exigir(type(respuesta["activacion"]) is dict)
            _restante(plazo)
            return respuesta
        except (HTTPError, OSError, ValueError, TypeError, RecursionError):
            raise ErrorMantenimiento(ERROR_GENERICO) from None

    def comprobar_manifiesto_web(self, origen: str, sha256: str) -> None:
        """Coteja los bytes públicos exactos mediante HTTPS sin enviar credencial OIDC.

        Raises:
            ErrorMantenimiento: Si los bytes o el transporte no confirman la expectativa.
        """
        try:
            _exigir(not self._cerrado)
            validar_origen_publico(origen)
            _exigir(isinstance(sha256, str) and re.fullmatch(r"[0-9a-f]{64}", sha256) is not None)
            plazo = time.monotonic() + PLAZO_FASE_S
            with turno_por_dominio(origen + "/firmas/manifiesto.json"):
                restante = _restante(plazo)
                respuesta = self._http.request(
                    "GET",
                    origen + "/firmas/manifiesto.json",
                    headers={**self._identidad, "Accept-Encoding": "identity", "Cache-Control": "no-cache"},
                    redirect=False,
                    retries=False,
                    preload_content=False,
                    decode_content=False,
                    timeout=Timeout(total=restante, connect=min(CONEXION_S, restante), read=min(LECTURA_S, restante)),
                    pool_timeout=restante,
                )
                try:
                    _exigir(respuesta.status == HTTPStatus.OK)
                    _exigir(respuesta.headers.get("content-encoding", "identity").lower() == "identity")
                    longitud = respuesta.headers.get("content-length")
                    if longitud is not None:
                        _exigir(re.fullmatch(r"0|[1-9][0-9]{0,9}", longitud) is not None)
                        _exigir(int(longitud) <= MAX_MANIFIESTO_WEB_BYTES)
                    huella, total = hashlib.sha256(), 0
                    while True:
                        restante = _restante(plazo)
                        conexion = respuesta.connection
                        if conexion is not None and conexion.sock is not None:
                            conexion.sock.settimeout(min(LECTURA_S, restante))
                        bloque = respuesta.read1(
                            min(TAM_BLOQUE, MAX_MANIFIESTO_WEB_BYTES - total + 1), decode_content=False
                        )
                        _restante(plazo)
                        if not bloque:
                            break
                        total += len(bloque)
                        _exigir(total <= MAX_MANIFIESTO_WEB_BYTES)
                        huella.update(bloque)
                    _exigir(total > 0 and (longitud is None or total == int(longitud)) and huella.hexdigest() == sha256)
                finally:
                    respuesta.close()
                    respuesta.release_conn()
        except (HTTPError, OSError, ValueError, TypeError, RecursionError):
            raise ErrorMantenimiento(ERROR_GENERICO) from None

    def close(self) -> None:
        """Cierra las conexiones una sola vez y retira la credencial de la instancia."""
        if not self._cerrado:
            self._cerrado = True
            self._token_solicitud = ""
            self._direccion_oidc = ""
            self._http.clear()

    def __enter__(self) -> ClienteMantenimientoGitHub:
        _exigir(not self._cerrado)
        return self

    def __exit__(
        self, _tipo: type[BaseException] | None, _error: BaseException | None, _traza: TracebackType | None
    ) -> None:
        self.close()
