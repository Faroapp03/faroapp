"""Pide al servidor, con la identidad OIDC del propio run, la reserva de un ciclo lanzado a demanda.

El paso «Pedir la reserva a demanda» lo ejecuta con `/usr/bin/python3 -I` antes de preparar las herramientas: por eso
solo usa la biblioteca estándar y lee del checkout la misma lista de autoridades TLS y la misma identidad de navegador
que el resto del proyecto. Si el servidor concede la reserva, el paso deja `solicitud_id` y `revision_reserva` como
salidas y el run sigue igual que si la reserva la hubiera creado el servidor. La activación usa `reserva_del_run` en un
intento posterior, cuando las salidas del candidato pueden faltar: el servidor devuelve la reserva anotada para el run.
Las dos peticiones tienen la misma forma, `{"operacion", "accion"}`, la que fija el contrato común con el servidor
(`pruebas/fixtures/contrato-reserva-a-demanda.json`).

El token OIDC solo vive en memoria durante la petición: no se imprime, no se escribe y no sale de este proceso.
"""

from __future__ import annotations

import http.client
import json
import os
import re
import ssl
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, Any
from urllib.parse import SplitResult, parse_qsl, urlencode, urlsplit, urlunsplit

if TYPE_CHECKING:
    from collections.abc import Mapping
    from typing import TextIO

RAIZ = Path(__file__).resolve().parents[2]
RUTA_CA = RAIZ / "plataforma_datos" / "comun" / "confianza_tls" / "cacert.pem"
RUTA_IDENTIDAD = RAIZ / "config" / "identidad-web.json"
RUTA_RESERVA = "/mantenimiento/reserva"
# El canal de máquina del servidor admite una sola audiencia: la del permiso de inicio y el resultado.
RUTA_AUDIENCIA = "/mantenimiento/resultado"
ACCIONES_A_DEMANDA = ("actualizar-datos", "actualizar-cursos", "comprobar-vencidas")
ESTADOS_CONCEDIDOS = {"reservar": ("reservada", "repetida"), "consultar": ("reservada",)}
MOTIVOS_DE_RECHAZO = (
    "ocupado",
    "activacion_pendiente",
    "candidato_en_plazo",
    "separacion",
    "tope_dia",
    "tope_mes",
    "presupuesto",
)
CABECERAS_IDENTIDAD = ("User-Agent", "sec-ch-ua", "sec-ch-ua-mobile", "sec-ch-ua-platform")
# Cada intento (token y petición) tiene su plazo; con el reintento, el paso cabe de sobra en su minuto.
PLAZO_S = 12.0
ESPERA_REINTENTO_S = 3.0
INTENTOS = 2
PUERTO_HTTPS = 443
MAX_URL_BYTES = 8192
MAX_CREDENCIAL_BYTES = 16_384
MAX_RESPUESTA_OIDC = 32 * 1024
MAX_RESPUESTA_RESERVA = 1024
MAX_IDENTIDAD_BYTES = 16_384
MAX_REVISION = 2**53 - 1
TAM_BLOQUE = 4096
UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}")
JWT = re.compile(r"[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+")
CREDENCIAL = re.compile(r"[\x21-\x7e]+")
TEXTO_DE_CABECERA = re.compile(r"[\x20-\x7e]+")
TIPO_JSON = re.compile(r"application/json(?:;\s*charset=utf-8)?", re.IGNORECASE)
SALIDA_CONCEDIDA = 0
SALIDA_ERROR = 1
SALIDA_RECHAZADA = 3
TITULO = "Faro · reserva"
NO_CONCEDIDA = "El servidor no ha concedido la reserva."
SIN_RESPUESTA = "El servidor no ha respondido a tiempo; puedes lanzar el run de nuevo más tarde."
CONFIGURACION = "El lanzamiento a demanda no tiene una configuración válida en el repositorio."
ACCION_NO_ADMITIDA = "Solo se pueden pedir a demanda actualizar-datos, actualizar-cursos y comprobar-vencidas."
SIN_SALIDAS = "No se han podido guardar las salidas del paso; la reserva caducará sin usarse."


class ReservaNoConcedida(Exception):
    """El run no tiene una reserva confirmada. El texto es fijo: nunca lleva datos del servidor ni credenciales."""


class SinRespuesta(ReservaNoConcedida):
    """El servidor no ha respondido en ninguno de los dos intentos."""


@dataclass(frozen=True)
class Concedida:
    """Reserva confirmada por el servidor para este run."""

    estado: str
    solicitud_id: str
    revision_reserva: int


@dataclass(frozen=True)
class Rechazada:
    """El servidor reconoce el run pero no le da hueco, por un motivo de la lista cerrada."""

    motivo: str


@dataclass(frozen=True)
class Ajustes:
    """Dónde están la confianza TLS y la identidad, y cuánto se espera; las pruebas los cambian por los suyos."""

    ruta_ca: Path = RUTA_CA
    ruta_identidad: Path = RUTA_IDENTIDAD
    plazo_s: float = PLAZO_S
    espera_s: float = ESPERA_REINTENTO_S


AJUSTES = Ajustes()


@dataclass(frozen=True)
class Canal:
    """Lo necesario para hablar con el servidor en nombre del run; la credencial no aparece en su representación."""

    origen: str
    direccion_oidc: str
    credencial_oidc: str = field(repr=False)
    contexto: ssl.SSLContext = field(repr=False)
    cabeceras: dict[str, str] = field(repr=False)
    ajustes: Ajustes = AJUSTES


def _exigir(condicion: bool, mensaje: str = NO_CONCEDIDA) -> None:
    if not condicion:
        raise ReservaNoConcedida(mensaje)


def _https(valor: str) -> SplitResult:
    """Acepta solo una URL HTTPS canónica, sin credenciales, fragmento ni caracteres de control.

    Returns:
        La URL descompuesta.

    Raises:
        ReservaNoConcedida: Si la URL no tiene esa forma.
    """
    _exigir(isinstance(valor, str) and 0 < len(valor) <= MAX_URL_BYTES and valor.isascii(), CONFIGURACION)
    _exigir(re.search(r"[\s\x00-\x1f\x7f\\]", valor) is None, CONFIGURACION)
    try:
        url = urlsplit(valor)
        puerto = url.port
    except ValueError:
        raise ReservaNoConcedida(CONFIGURACION) from None
    _exigir(url.scheme == "https" and bool(url.hostname), CONFIGURACION)
    _exigir(url.username is None and url.password is None and not url.fragment, CONFIGURACION)
    _exigir(url.geturl() == valor and puerto != 0, CONFIGURACION)
    host = f"[{url.hostname}]" if ":" in (url.hostname or "") else url.hostname
    _exigir(url.netloc == f"{host}{f':{puerto}' if puerto not in (None, PUERTO_HTTPS) else ''}", CONFIGURACION)
    return url


def validar_origen(origen: str) -> str:
    """El origen del servidor es solo esquema, nombre y puerto.

    Returns:
        El mismo origen, ya comprobado.
    """
    url = _https(origen)
    _exigir(not url.path and not url.query, CONFIGURACION)
    return origen


def direccion_oidc(url_oidc: str, audiencia: str) -> str:
    """Añade la audiencia a la dirección de tokens del runner, o comprueba que la que trae es la misma.

    Returns:
        La dirección con una sola audiencia, la del servidor.

    Raises:
        ReservaNoConcedida: Si la dirección trae otra audiencia o una consulta ilegible.
    """
    url = _https(url_oidc)
    try:
        pares = parse_qsl(url.query, keep_blank_values=True, strict_parsing=bool(url.query))
    except ValueError:
        raise ReservaNoConcedida(CONFIGURACION) from None
    audiencias = [valor for clave, valor in pares if clave == "audience"]
    _exigir(audiencias in ([], [audiencia]), CONFIGURACION)
    if audiencias:
        return url_oidc
    consulta = (url.query + "&" if url.query else "") + urlencode({"audience": audiencia})
    return urlunsplit((url.scheme, url.netloc, url.path, consulta, ""))


def contexto_tls(ruta_ca: Path) -> ssl.SSLContext:
    """Verifica certificado y nombre solo con la lista de autoridades del checkout, nunca con la del sistema.

    Returns:
        Contexto TLS de cliente con TLS 1.2 como mínimo.
    """
    contexto = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    contexto.minimum_version = ssl.TLSVersion.TLSv1_2
    contexto.load_verify_locations(cadata=ruta_ca.read_text(encoding="ascii"))
    return contexto


def _sin_duplicados(pares: list[tuple[str, Any]]) -> dict[str, Any]:
    resultado: dict[str, Any] = {}
    for clave, valor in pares:
        _exigir(clave not in resultado)
        resultado[clave] = valor
    return resultado


def _constante_no_admitida(_valor: str) -> None:
    raise ReservaNoConcedida(NO_CONCEDIDA)


def _objeto_json(contenido: bytes) -> dict[str, Any]:
    valor = json.loads(
        contenido.decode("utf-8"), object_pairs_hook=_sin_duplicados, parse_constant=_constante_no_admitida
    )
    _exigir(isinstance(valor, dict))
    return valor


def cabeceras_identidad(ruta: Path) -> dict[str, str]:
    """Lee las cuatro cabeceras del perfil genérico de navegador que usan todas las peticiones del proyecto.

    Returns:
        Las cabeceras de identidad, sin compresión ni idioma.
    """
    with ruta.open("rb") as archivo:
        contenido = archivo.read(MAX_IDENTIDAD_BYTES + 1)
    _exigir(len(contenido) <= MAX_IDENTIDAD_BYTES, CONFIGURACION)
    documento = _objeto_json(contenido)
    _exigir(set(documento) == {"version", "identidad"} and documento["version"] == 1, CONFIGURACION)
    identidad = documento["identidad"]
    _exigir(isinstance(identidad, dict) and set(identidad) == set(CABECERAS_IDENTIDAD), CONFIGURACION)
    _exigir(all(isinstance(v, str) and TEXTO_DE_CABECERA.fullmatch(v) for v in identidad.values()), CONFIGURACION)
    return dict(identidad)


def abrir_canal(entorno: Mapping[str, str], ajustes: Ajustes = AJUSTES) -> Canal:
    """Reúne el origen del servidor, la dirección de tokens del runner y la confianza TLS del checkout.

    Returns:
        Canal listo para pedir tokens y hablar con el servidor.

    Raises:
        ReservaNoConcedida: Si falta algo o no tiene la forma esperada; nada se ha enviado todavía.
    """
    origen = validar_origen(entorno.get("FARO_ACTUALIZACION_ORIGEN", ""))
    credencial = entorno.get("ACTIONS_ID_TOKEN_REQUEST_TOKEN", "")
    _exigir(0 < len(credencial) <= MAX_CREDENCIAL_BYTES and CREDENCIAL.fullmatch(credencial) is not None, CONFIGURACION)
    direccion = direccion_oidc(entorno.get("ACTIONS_ID_TOKEN_REQUEST_URL", ""), origen + RUTA_AUDIENCIA)
    try:
        contexto = contexto_tls(ajustes.ruta_ca)
        cabeceras = cabeceras_identidad(ajustes.ruta_identidad)
    except (OSError, ValueError):
        raise ReservaNoConcedida(CONFIGURACION) from None
    return Canal(origen, direccion, credencial, contexto, cabeceras, ajustes)


def _leer_json(respuesta: http.client.HTTPResponse, limite: int, fin: float) -> dict[str, Any]:
    _exigir(TIPO_JSON.fullmatch(respuesta.getheader("Content-Type", "")) is not None)
    _exigir(respuesta.getheader("Content-Encoding", "identity").lower() == "identity")
    partes: list[bytes] = []
    total = 0
    while True:
        # Cada lectura espera como mucho el plazo del socket; entre lecturas se comprueba el del intento.
        if time.monotonic() >= fin:
            raise TimeoutError
        bloque = respuesta.read1(min(TAM_BLOQUE, limite - total + 1))
        if not bloque:
            return _objeto_json(b"".join(partes))
        total += len(bloque)
        _exigir(total <= limite)
        partes.append(bloque)


def _pedir(  # noqa: PLR0913 - Token del runner y petición al servidor comparten transporte, con límites distintos.
    canal: Canal, url: str, *, credencial: str, cuerpo: bytes | None, limite: int, fin: float
) -> tuple[int, dict[str, Any] | None]:
    """Hace una petición HTTPS sin redirecciones, proxies ni compresión: GET sin cuerpo y POST con él.

    Returns:
        El estado HTTP y, solo para 200 y 409, el documento JSON de la respuesta.

    Raises:
        TimeoutError: Si el plazo del intento ya se ha agotado.
    """
    restante = fin - time.monotonic()
    if restante <= 0:
        raise TimeoutError
    destino = urlsplit(url)
    conexion = http.client.HTTPSConnection(
        destino.hostname or "", destino.port or PUERTO_HTTPS, timeout=restante, context=canal.contexto
    )
    try:
        cabeceras = {
            **canal.cabeceras,
            "Accept": "application/json",
            "Accept-Encoding": "identity",
            "Cache-Control": "no-store",
            "Authorization": f"Bearer {credencial}",
        }
        if cuerpo is not None:
            cabeceras["Content-Type"] = "application/json"
        ruta = destino.path + (f"?{destino.query}" if destino.query else "")
        conexion.request("GET" if cuerpo is None else "POST", ruta, body=cuerpo, headers=cabeceras)
        respuesta = conexion.getresponse()
        if respuesta.status not in (http.client.OK, http.client.CONFLICT):
            return respuesta.status, None
        return respuesta.status, _leer_json(respuesta, limite, fin)
    finally:
        conexion.close()


def _token(canal: Canal, fin: float) -> str:
    estado, documento = _pedir(
        canal, canal.direccion_oidc, credencial=canal.credencial_oidc, cuerpo=None, limite=MAX_RESPUESTA_OIDC, fin=fin
    )
    _exigir(estado == http.client.OK and documento is not None)
    token = documento.get("value")
    _exigir(isinstance(token, str) and 0 < len(token) <= MAX_CREDENCIAL_BYTES and JWT.fullmatch(token) is not None)
    return token


def interpretar(operacion: str, estado: int, documento: dict[str, Any] | None) -> Concedida | Rechazada:
    """Solo dos respuestas tienen sentido: la reserva confirmada y, al reservar, un rechazo con motivo conocido.

    Returns:
        La reserva concedida o el motivo del rechazo.

    Raises:
        ReservaNoConcedida: Ante cualquier otro estado o una respuesta mal formada, sin detallar cuál.
    """
    if estado == http.client.OK and documento is not None:
        _exigir(set(documento) == {"estado", "solicitudId", "revisionReserva"})
        _exigir(documento["estado"] in ESTADOS_CONCEDIDOS[operacion])
        solicitud, revision = documento["solicitudId"], documento["revisionReserva"]
        _exigir(isinstance(solicitud, str) and UUID.fullmatch(solicitud) is not None)
        _exigir(type(revision) is int and 0 < revision <= MAX_REVISION)
        return Concedida(documento["estado"], solicitud, revision)
    _exigir(estado == http.client.CONFLICT and operacion == "reservar" and documento is not None)
    _exigir(set(documento) == {"error"} and documento["error"] in MOTIVOS_DE_RECHAZO)
    return Rechazada(documento["error"])


def pedir(canal: Canal, documento: dict[str, str]) -> Concedida | Rechazada:
    """Pide un token nuevo y envía la operación; si la red falla, lo intenta una vez más.

    Repetir es seguro: el servidor ata la reserva al run y una segunda petición recibe la misma reserva.

    Returns:
        La respuesta del servidor ya interpretada.

    Raises:
        SinRespuesta: Si los dos intentos fallan por la red o por el plazo.
        ReservaNoConcedida: Si el servidor responde algo distinto de una reserva o un rechazo conocido.
    """
    cuerpo = json.dumps(documento, separators=(",", ":")).encode()
    for intento in range(1, INTENTOS + 1):
        fin = time.monotonic() + canal.ajustes.plazo_s
        try:
            token = _token(canal, fin)
            estado, respuesta = _pedir(
                canal,
                canal.origen + RUTA_RESERVA,
                credencial=token,
                cuerpo=cuerpo,
                limite=MAX_RESPUESTA_RESERVA,
                fin=fin,
            )
        except (OSError, http.client.HTTPException):
            if intento < INTENTOS:
                time.sleep(canal.ajustes.espera_s)
                continue
            raise SinRespuesta(SIN_RESPUESTA) from None
        except (ValueError, TypeError, RecursionError):
            raise ReservaNoConcedida(NO_CONCEDIDA) from None
        return interpretar(documento["operacion"], estado, respuesta)
    raise SinRespuesta(SIN_RESPUESTA)


def _accion(entorno: Mapping[str, str]) -> str:
    accion = entorno.get("FARO_ACCION", "")
    _exigir(accion in ACCIONES_A_DEMANDA, ACCION_NO_ADMITIDA)
    return accion


def reserva_del_run(entorno: Mapping[str, str], ajustes: Ajustes = AJUSTES) -> tuple[str, str]:
    """Consulta la reserva que el servidor tiene anotada para este run; nunca crea una.

    La consulta lleva la acción del run, como la reserva: el servidor exige las dos claves en las dos operaciones.

    Returns:
        El identificador de la solicitud y su revisión, en el formato de las variables de entorno.

    Raises:
        ReservaNoConcedida: Si el servidor no confirma una reserva de este run.
    """
    documento = {"operacion": "consultar", "accion": _accion(entorno)}
    resultado = pedir(abrir_canal(entorno, ajustes), documento)
    _exigir(isinstance(resultado, Concedida))
    return resultado.solicitud_id, str(resultado.revision_reserva)


def _anunciar(salida: TextIO, tipo: str, texto: str) -> None:
    salida.write(f"::{tipo} title={TITULO}::{texto}\n")


def ejecutar(entorno: Mapping[str, str], salida: TextIO, ajustes: Ajustes = AJUSTES) -> int:
    """Paso del workflow: pide la reserva y, si se concede, la deja como salidas del paso.

    Returns:
        0 si hay reserva, 3 si el servidor la rechaza con motivo y 1 ante cualquier otro fallo.
    """
    try:
        accion = _accion(entorno)
        salidas = entorno.get("GITHUB_OUTPUT", "")
        _exigir(bool(salidas), CONFIGURACION)
        resultado = pedir(abrir_canal(entorno, ajustes), {"operacion": "reservar", "accion": accion})
    except ReservaNoConcedida as error:
        _anunciar(salida, "error", str(error))
        return SALIDA_ERROR
    if isinstance(resultado, Rechazada):
        _anunciar(salida, "notice", f"rechazada motivo={resultado.motivo}")
        return SALIDA_RECHAZADA
    try:
        with Path(salidas).open("a", encoding="utf-8") as archivo:
            archivo.write(f"solicitud_id={resultado.solicitud_id}\nrevision_reserva={resultado.revision_reserva}\n")
    except OSError:
        _anunciar(salida, "error", SIN_SALIDAS)
        return SALIDA_ERROR
    _anunciar(salida, "notice", f"aceptada estado={resultado.estado}")
    return SALIDA_CONCEDIDA


if __name__ == "__main__":
    sys.exit(ejecutar(os.environ, sys.stdout))
