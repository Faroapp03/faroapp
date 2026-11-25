"""Descargas de la cadena de datos: el agente de usuario, cada original con su huella y su entrada de procedencia."""

import time
from collections.abc import Callable, Iterator, Mapping
from contextlib import ExitStack, contextmanager
from contextvars import ContextVar
from functools import partial
from http.client import HTTPConnection, HTTPResponse, HTTPSConnection
from pathlib import Path
from ssl import SSLContext
from threading import RLock
from typing import Any
from urllib.parse import urlparse
from urllib.request import HTTPHandler, HTTPRedirectHandler, HTTPSHandler, Request, build_opener

from plataforma_datos.comun import perfil_web
from plataforma_datos.comun.confianza_tls import CIFRADOS_HEREDADOS, contexto_tls
from plataforma_datos.comun.entrada_salida import (
    ahora_utc,
    carpetas,
    comprobar_originales,
    entradas_procedencia,
    escribir_bytes_entero,
    leer_json,
    relativa,
    sha256_bytes,
)
from plataforma_datos.comun.nucleo import (
    AGENTE_POR_DEFECTO,
    ARCHIVO_DE_PROCEDENCIA,
    CAMPOS_OPCIONALES_DE_PROCEDENCIA,
    MAX_DESCARGA_BYTES,
    REGLA_ESTRICTA,
    SEGUNDOS_DESCARGA,
    ArchivoDescargable,
    Descarga,
    EntradaDeDescarga,
    FormatoInesperado,
    OriginalCambiado,
    ReglaDeCambio,
    exigir,
)
from plataforma_datos.comun.observacion_remota import observar, observar_original
from plataforma_datos.comun.respuesta_http import LimiteDescargaExcedido as LimiteDescargaExcedido
from plataforma_datos.comun.respuesta_http import conexion_con_plazo as _conexion_acotada
from plataforma_datos.comun.respuesta_http import leer_cuerpo, vigilar_lectura
from plataforma_datos.comun.turnos_entre_procesos import TurnosEntreProcesos, turnos_del_entorno

# ---------------------------------------------------------------------------------------------------------------------
# Descargas
# ---------------------------------------------------------------------------------------------------------------------

# Segundos entre dos peticiones al mismo sitio oficial: los que se consultan (BOE, INE…) no fijan una pausa en su
# robots.txt, y esta es la de cortesía de todas las fuentes que hacen varias peticiones seguidas.
PAUSA_ENTRE_PETICIONES_S = 2.0
# Los únicos esquemas que se piden, también tras una redirección: nunca file:, ftp: ni data:.
ESQUEMAS_WEB = frozenset({"https", "http"})
# Plazo de una descarga entera, en segundos. SEGUNDOS_DESCARGA limita cada espera del socket, no la suma: un servidor
# que manda un byte cada pocos segundos la alargaría sin fin. El original más grande (unos 30 MB) llega en minutos.
PLAZO_DESCARGA_S = 30 * 60
# Lo que se pide al socket de cada vez (1 MiB): cada lectura devuelve lo que ya ha llegado, y el plazo se mira entre
# una y otra.
TROZO_DE_LECTURA = 1 << 20


class PlazoSinEnvio(TimeoutError):
    """El turno consumió el plazo antes de salir a la red."""


def leer_respuesta_hasta(respuesta: HTTPResponse, url: str, hasta: float | None, maximo: int | None) -> bytes:
    """Lee el cuerpo dentro del plazo de la petición, compartido con las cabeceras y los saltos.

    Returns:
        Bytes completos antes del límite de la fuente y del límite común de lectura.
    """
    if hasta is None:
        return leer_respuesta_con_plazo(respuesta, url, PLAZO_DESCARGA_S, maximo)
    limite = min(hasta, time.monotonic() + PLAZO_DESCARGA_S)
    with vigilar_lectura(respuesta, limite):
        return leer_respuesta_con_plazo(respuesta, url, limite - time.monotonic(), maximo)


def _exigir_web(url: str) -> None:
    """Comprueba que una dirección es http o https.

    Args:
        url: La dirección pedida o la de una redirección.

    Raises:
        FormatoInesperado: Si el esquema es otro (file:, ftp:, data:…).
    """
    esquema = urlparse(url).scheme.lower()
    if esquema not in ESQUEMAS_WEB:
        raise FormatoInesperado(f"{url}: solo se descarga por http o https, no por «{esquema}»")


def _dominio(url: str) -> str:
    """Normaliza el hostname, compartiendo el turno entre esquemas, puertos e IDN equivalentes.

    Returns:
        El hostname ASCII, sin punto final.

    Raises:
        FormatoInesperado: Si la URL no identifica un host.
    """
    try:
        nombre = urlparse(url).hostname
        if nombre and (normalizado := nombre.encode("idna").decode("ascii").lower().rstrip(".")):
            return normalizado
    except (UnicodeError, ValueError) as error:
        raise FormatoInesperado("La dirección no identifica un dominio web válido.") from error
    raise FormatoInesperado("La dirección no identifica un dominio web válido.")


class PausasPorDominio:
    """Serializa consultas del proceso y separa dos intentos al mismo hostname al menos dos segundos.

    El reloj y la espera se inyectan: con `PausasPorDominio(lambda: 0.0, lambda _segundos: None)` una prueba
    conserva los turnos y su orden sin esperar de verdad. Con `turnos`, cada consulta toma además el turno de su
    servidor entre procesos (turnos_entre_procesos) y lo suelta al cerrarse o al saltar a otro servidor: nunca tiene
    dos a la vez, así que dos procesos no pueden quedar esperándose el uno al otro.
    """

    def __init__(
        self,
        reloj: Callable[[], float] | None = None,
        dormir: Callable[[float], None] | None = None,
        turnos: TurnosEntreProcesos | None = None,
    ) -> None:
        self._reloj = reloj if reloj is not None else lambda: time.monotonic()
        self._dormir = dormir if dormir is not None else lambda segundos: time.sleep(segundos)
        self._turnos = turnos
        self._turno_abierto = ExitStack()  # el turno entre procesos de la consulta en curso, si hay turnos
        self._ultimas: dict[str, float] = {}
        self._cerrojo = RLock()
        self._visitados: ContextVar[set[str] | None] = ContextVar("dominios_de_la_consulta", default=None)

    def _esperar(self, url: str) -> None:
        """Reserva el siguiente intento; el llamador mantiene el cerrojo."""
        dominio = _dominio(url)
        ahora = self._reloj()
        anterior = self._ultimas.get(dominio)
        if anterior is not None and (espera := anterior + PAUSA_ENTRE_PETICIONES_S - ahora) > 0:
            self._dormir(espera)
        if self._turnos is not None:
            self._turno_abierto.enter_context(self._turnos.turno(dominio, PAUSA_ENTRE_PETICIONES_S))
        self._ultimas[dominio] = self._reloj()
        visitados = self._visitados.get()
        if visitados is not None:
            visitados.add(dominio)

    @contextmanager
    def consulta(self, url: str) -> Iterator[None]:
        """Mantiene la serie hasta terminar/cerrar o fallar; el siguiente intento también espera tras un error.

        Yields:
            El turno de esta consulta, incluidas sus redirecciones.

        Raises:
            FormatoInesperado: Si un control intenta descargar de nuevo antes de cerrar la consulta actual.
        """
        if self._visitados.get() is not None:
            raise FormatoInesperado("No se admite otra descarga dentro de una consulta web todavía abierta.")
        with self._cerrojo:
            visitados: set[str] = set()
            anterior = self._visitados.set(visitados)
            try:
                self._esperar(url)
                yield
            finally:
                try:
                    fin = self._reloj()
                    for dominio in visitados:
                        self._ultimas[dominio] = fin
                    self._turno_abierto.close()
                finally:
                    self._visitados.reset(anterior)  # aunque soltar el turno falle, la siguiente consulta puede abrirse

    def redireccion(self, origen: str, destino: str) -> None:
        """Registra el cierre anterior y reserva el siguiente intento dentro de una consulta propia.

        Raises:
            FormatoInesperado: Si no hay un turno activo o el origen no participó en él.
        """
        visitados = self._visitados.get()
        if visitados is None or _dominio(origen) not in visitados:
            raise FormatoInesperado("La siguiente petición exige un turno activo que incluya su origen.")
        with self._cerrojo:
            self._ultimas[_dominio(origen)] = self._reloj()
            self._turno_abierto.close()  # el origen ya respondió: su turno se suelta antes de pedir el del destino
            self._esperar(destino)


# Pausas compartidas por todas las descargas del proceso y, si el ciclo descarga varias fuentes a la vez, con los
# procesos hermanos (turnos_entre_procesos.VARIABLE). Una prueba puede sustituirlas por otras con su propio reloj y su
# propia espera (`patch.object(red, "PAUSAS", ...)`).
PAUSAS = PausasPorDominio(turnos=turnos_del_entorno())


@contextmanager
def turno_por_dominio(url: str) -> Iterator[None]:
    """Turno compartido para un envío HTTP propio, su lectura, cierre y saltos instrumentados.

    Mantenerlo hasta cerrar o fallar la respuesta. No envolver descargar_url, que ya toma este turno, ni iniciar otra
    consulta anidada. El mismo controlador serializa los transportes del proceso, también ante excepciones. No añade
    identidad ni instrumenta reintentos/redirecciones ocultos de una biblioteca: cada salto requiere el hook público.

    Yields:
        El permiso para iniciar el envío a url; la espera precede al primer intento.
    """
    _exigir_web(url)
    with PAUSAS.consulta(url):
        yield


def registrar_redireccion(origen: str, destino: str) -> None:
    """Reserva otro envío del turno activo, después de cerrar/fallar el anterior y antes de enviar.

    Se llama por cada redirección o reintento instrumentado; puede repetirse la misma URL. No abre conexiones ni crea
    un turno paralelo. Al terminar el contexto también se registra el fin de todos los hosts alcanzados.

    Raises:
        FormatoInesperado: Si los destinos no son web o no existe un turno activo que incluya el origen.
    """
    _exigir_web(origen)
    _exigir_web(destino)
    PAUSAS.redireccion(origen, destino)


class _RedireccionSoloWeb(HTTPRedirectHandler):
    """Valida la identidad y espacia también los intentos que siguen una redirección web."""

    def __init__(self, hasta: float | None = None) -> None:
        self._anteriores: dict[Request, str] = {}
        self.hasta = hasta

    def http_request(self, req: Request) -> Request:
        """Reserva el salto después de cerrar la respuesta anterior y antes de enviarlo.

        Returns:
            La misma petición, sin añadir cabeceras de control.

        Raises:
            TimeoutError: Si el turno de redirección agota el plazo de una petición ya iniciada.
        """
        anterior = self._anteriores.pop(req, None)
        if anterior is not None:
            registrar_redireccion(anterior, req.full_url)
            if self.hasta is not None:
                restante = self.hasta - time.monotonic()
                if restante <= 0:
                    raise TimeoutError("Plazo de la petición agotado tras la redirección")
                req.timeout = min(req.timeout, restante)
        return req

    https_request = http_request

    def redirect_request(self, req: Request, *resto: object) -> Request | None:
        """Comprueba el esquema de la dirección nueva antes de seguirla.

        Args:
            req: La petición redirigida.
            *resto: Lo demás que pasa urllib, en su orden: respuesta, código, texto del código, cabeceras y, el
                último, la dirección nueva.

        Returns:
            La petición nueva, o None si urllib no la sigue.
        """
        nueva = resto[-1]
        _exigir_web(str(nueva))
        siguiente = super().redirect_request(req, *resto)
        if siguiente is not None:
            if self.hasta is not None:
                # urllib leería entero el cuerpo descartado antes del siguiente salto.
                # HTTPResponse.read() tras el cierre devuelve EOF y el salto abre su propia conexión.
                resto[0].close()
            agente = req.get_header("User-agent")
            siguiente.remove_header("User-agent")
            siguiente.add_header("User-Agent", agente_de_usuario() if agente is None else validar_agente(agente))
            self._anteriores[siguiente] = req.full_url
        return siguiente


class _SinRedirecciones(HTTPRedirectHandler):
    """No sigue ninguna redirección: la respuesta 3xx llega tal cual, con su cabecera `Location`."""

    def redirect_request(self, *_argumentos: object) -> None:
        """No genera petición nueva.

        Returns:
            Siempre None: urllib entrega la redirección como error HTTP.
        """
        return


class _HTTPConPlazo(HTTPHandler):
    """Usa el mismo presupuesto para HTTP que para HTTPS."""

    def __init__(self, hasta: float) -> None:
        super().__init__()
        self.hasta = hasta

    def http_open(self, req: Request) -> HTTPResponse:
        """Abre HTTP dentro del plazo de la fuente.

        Returns:
            La respuesta de urllib.
        """
        return self.do_open(partial(_conexion_acotada, HTTPConnection, self.hasta), req)


class _HTTPSPorDominio(HTTPSHandler):
    """Conecta con el contexto de siempre, salvo en los dominios que admiten un cifrado heredado.

    El dominio se mira en cada conexión, así que una redirección a otro dominio vuelve al contexto normal.
    """

    def __init__(self, *, context: SSLContext, hasta: float | None = None) -> None:
        super().__init__(context=context)
        self.hasta = hasta

    def https_open(self, req: Request) -> HTTPResponse:
        """Abre la conexión con el contexto que corresponde al dominio de la petición.

        Returns:
            La respuesta de urllib.
        """
        dominio = _dominio(req.full_url)
        contexto = contexto_tls(dominio) if dominio in CIFRADOS_HEREDADOS else self._context
        tipo = HTTPSConnection if self.hasta is None else partial(_conexion_acotada, HTTPSConnection, self.hasta)
        return self.do_open(tipo, req, context=contexto)


def abrir_peticion(
    peticion: Request, timeout: float, *, seguir_redirecciones: bool = True, hasta: float | None = None
) -> HTTPResponse:
    """Abre una petición con el abridor de urllib, que solo sigue redirecciones web o ninguna.

    Es el único punto en que una petición sale a la red: las pruebas lo sustituyen por respuestas controladas y
    conservan así la identidad, los turnos, los límites y la lectura reales.

    Args:
        peticion: La petición.
        timeout: La espera máxima de cada operación del socket, en segundos.
        seguir_redirecciones: Si es falso, una redirección se devuelve como respuesta y no se sigue.
        hasta: Límite monotónico compartido entre saltos de una petición presupuestada.

    Returns:
        La respuesta, como gestor de contexto (con http y https, urllib da una HTTPResponse).
    """
    redireccion = _RedireccionSoloWeb(hasta) if seguir_redirecciones else _SinRedirecciones()
    http = [] if hasta is None else [_HTTPConPlazo(hasta)]
    return build_opener(redireccion, _HTTPSPorDominio(context=contexto_tls(), hasta=hasta), *http).open(
        peticion, timeout=timeout
    )


def leer_respuesta_con_plazo(respuesta: HTTPResponse, url: str, plazo_s: float, maximo: int | None = None) -> bytes:
    """Lee el cuerpo dentro de las cotas comunes de tiempo, tamaño de cable y expansión.

    Returns:
        Cuerpo completo tras verificar longitud y codificación.
    """
    return leer_cuerpo(respuesta, url, plazo_s, _limite_de_lectura(maximo), TROZO_DE_LECTURA)


def validar_agente(agente: object) -> str:
    """Valida una identidad genérica con el contrato central.

    Returns:
        La identidad original comprobada.

    Raises:
        FormatoInesperado: Si no describe un navegador genérico.
    """
    try:
        return perfil_web.validar_agente(agente)
    except perfil_web.PerfilInvalido as error:
        raise FormatoInesperado(str(error)) from error


def agente_de_usuario(ruta: Path | None = None, *, agente: str | None = None) -> str:
    """Resuelve la identidad del perfil central sin consultar la red ni el equipo.

    Returns:
        El agente declarado en la configuración del proyecto.

    Raises:
        FormatoInesperado: Si la configuración es inválida o se indican dos identidades.
    """
    if agente is not None:
        if ruta is not None:
            raise FormatoInesperado("Indica una identidad o un archivo de configuración, no ambos.")
        return validar_agente(agente)
    try:
        return perfil_web.leer_perfil(ruta)["User-Agent"]
    except perfil_web.PerfilInvalido as error:
        raise FormatoInesperado(str(error)) from error


# Referencia portable para consumidores offline (robots compara su producto Mozilla); la petición resuelve su config.
AGENTE = validar_agente(AGENTE_POR_DEFECTO)


def _limite_de_lectura(maximo: int | None) -> int:
    """Valida la activación expresa sin permitir elevar el límite común.

    Returns:
        Entero positivo y finito, o la cota anterior cuando no se indicó.

    Raises:
        FormatoInesperado: Si no es un entero positivo dentro de la cota común.
    """
    if maximo is None:
        return MAX_DESCARGA_BYTES
    if type(maximo) is not int or not 0 < maximo <= MAX_DESCARGA_BYTES:
        raise FormatoInesperado("El límite de lectura debe ser un entero positivo dentro de la cota común.")
    return maximo


def descargar_url(  # noqa: PLR0913 - Perfil explícito sin romper la interfaz de los lectores existentes.
    url: str,
    cabeceras: dict[str, str] | None = None,
    segundos: int = SEGUNDOS_DESCARGA,
    cuerpo: bytes | None = None,
    *,
    comprobar: Callable[[bytes, Mapping[str, str]], None] | None = None,
    maximo_bytes: int | None = None,
    comprobar_cabeceras: Callable[[int, str, Mapping[str, str]], None] | None = None,
    perfil: perfil_web.Uso = "datos",
    seguir_redirecciones: bool = True,
    hasta: float | None = None,
) -> Descarga:
    """Descarga con la identidad genérica configurada y el turno central de su dominio.

    Sin `cuerpo`, la petición es GET; con él, POST con esos bytes. Solo se pide por http o https, también tras una
    redirección. Las llamadas de este proceso se serializan; cada hostname comparte pausa entre esquemas y puertos.
    Tras cerrar/fallar se registra el fin, incluso si el error procede del socket, lector o control de contenido.

    Args:
        url: La dirección.
        cabeceras: Negociación del lector; no puede sustituir identidad ni compresión centrales.
        segundos: La espera máxima de cada operación del socket, en segundos.
        cuerpo: Los bytes de un POST; None para GET.
        comprobar: Control del contenido descomprimido y sus cabeceras antes de observarlo.
        maximo_bytes: Activación expresa de una cota inferior de cable y contenido expandido.
        comprobar_cabeceras: Control de status, destino y cabeceras antes de leer; no acredita identidad.
        perfil: Datos por defecto; página HTML solo por elección explícita y sin idioma sensible.
        seguir_redirecciones: Si es falso, una redirección no se sigue y llega como error HTTP con sus cabeceras.
        hasta: Límite monotónico opcional que incluye el turno, la apertura y el cuerpo de la respuesta.

    Returns:
        La descarga, con sus bytes, su tipo de contenido y la dirección final.

    Raises:
        FormatoInesperado: Si la dirección no es http o https, si la respuesta pasa de MAX_DESCARGA_BYTES o si no
            acaba en PLAZO_DESCARGA_S.
    """
    maximo = _limite_de_lectura(maximo_bytes)
    _exigir_web(url)
    try:
        resueltas = perfil_web.cabeceras_peticion(cabeceras, perfil, cuerpo=cuerpo)
    except perfil_web.PerfilInvalido as error:
        raise FormatoInesperado(str(error)) from error
    peticion = Request(url, data=cuerpo, headers=resueltas)
    apertura = {} if seguir_redirecciones else {"seguir_redirecciones": False}
    if hasta is not None:
        apertura["hasta"] = hasta

    def espera_para_abrir() -> float:
        if hasta is None:
            return segundos
        restante = hasta - time.monotonic()
        if restante <= 0:
            raise PlazoSinEnvio("El turno agotó el plazo antes de abrir la conexión")
        return min(segundos, restante)

    with turno_por_dominio(url), abrir_peticion(peticion, timeout=espera_para_abrir(), **apertura) as respuesta:
        if comprobar_cabeceras is not None:
            status = respuesta.status
            if type(status) is not int:
                raise FormatoInesperado("Estado HTTP no verificable.")
            comprobar_cabeceras(status, respuesta.url, respuesta.headers)
        datos = leer_respuesta_hasta(respuesta, url, hasta, maximo)
        if comprobar is not None:
            cabeceras_logicas = respuesta.headers
            if respuesta.headers.get("Content-Encoding"):
                cabeceras_logicas = {
                    k: v
                    for k, v in respuesta.headers.items()
                    if k.lower() not in {"content-encoding", "content-length"}
                }
                cabeceras_logicas["Content-Length"] = str(len(datos))
            comprobar(datos, cabeceras_logicas)
        observar(url, "GET" if cuerpo is None else "POST", cuerpo, respuesta.url, datos)
        return Descarga(datos, respuesta.url, respuesta.headers.get("Content-Type", ""))


def _exigir_cambio_aceptado(nombre: str, motivo: str, regla: ReglaDeCambio) -> None:
    """Detiene la descarga salvo que la persona haya aceptado la versión nueva con `--aceptar-cambio`.

    Args:
        nombre: El archivo, para el motivo.
        motivo: Por qué hace falta aceptarla.
        regla: La regla de cambio, con `aceptar_cambio`.

    Raises:
        OriginalCambiado: Si la versión nueva no se ha aceptado.
    """
    if not regla.aceptar_cambio:
        raise OriginalCambiado(f"{nombre}: {motivo}; revisar la versión nueva y repetir con --aceptar-cambio")


def conservar_o_sustituir(destino: Path, descarga: Descarga, regla: ReglaDeCambio = REGLA_ESTRICTA) -> bytes:
    """Guarda la descarga y devuelve los bytes que quedan como original.

    Nunca sustituye en silencio un original distinto. Si el original está en disco y la descarga difiere, se conserva
    cuando `regla.equivalentes` lo admite; si no, lanza `OriginalCambiado`. Si el original falta pero su procedencia
    registra una huella, la descarga tiene que coincidir con ella: es la única forma de saber que la copia nueva es la
    misma que se validó. En los dos casos, `regla.aceptar_cambio` permite sustituirlo a propósito.

    Returns:
        Los bytes que quedan como original: los registrados si la regla los da por equivalentes; si no, los nuevos.
    """
    destino.parent.mkdir(parents=True, exist_ok=True)
    # Se lee una sola vez: la comparación y lo que se devuelve son los mismos bytes.
    previo = destino.read_bytes() if destino.exists() else None
    if previo is not None and previo != descarga.datos:
        if regla.equivalentes is not None and regla.equivalentes(previo, descarga.datos):
            return previo
        _exigir_cambio_aceptado(destino.name, "la versión oficial ha cambiado", regla)
    elif previo is None and regla.huella_registrada not in (None, sha256_bytes(descarga.datos)):
        _exigir_cambio_aceptado(destino.name, "falta el original y la descarga no coincide con su huella", regla)
    _escribir_bytes_entero(destino, descarga.datos)
    return descarga.datos


def _escribir_bytes_entero(destino: Path, datos: bytes) -> None:
    """Escribe un archivo entero o nada con el escritor común (`escribir_bytes_entero`).

    Un corte a mitad deja el original anterior intacto, en vez de uno truncado cuya huella no coincidiría.

    Args:
        destino: El archivo.
        datos: Su contenido.
    """
    escribir_bytes_entero(destino, datos)


def registro_descarga(
    archivo: ArchivoDescargable, descarga: Descarga, datos: bytes, previo: dict[str, Any] | None, **extra: str
) -> EntradaDeDescarga:
    """Entrada de procedencia de un archivo descargado; conserva la fecha anterior si la huella no ha cambiado.

    Returns:
        La entrada de procedencia del archivo.
    """
    huella = sha256_bytes(datos)
    fecha = previo["descargado_utc"] if previo and previo.get("sha256") == huella else ahora_utc()
    return {
        "archivo": archivo["archivo"],
        "nivel": archivo["nivel"],
        "titulo": archivo["titulo"],
        "url": archivo["url"],
        "url_final": descarga.url_final,
        "content_type": descarga.content_type,
        **extra,
        "bytes": len(datos),
        "sha256": huella,
        "descargado_utc": fecha,
        "licencia": archivo["licencia"],
    }


def registros_previos(ruta: Path) -> dict[str, dict[str, Any]]:
    """Entradas de una procedencia ya existente, por nombre de archivo (vacío si aún no existe).

    Returns:
        {nombre de archivo: su entrada}, vacío si la procedencia no existe.
    """
    if not ruta.exists():
        return {}
    return {entrada["archivo"]: entrada for entrada in entradas_procedencia(leer_json(ruta))}


def _sin_equivalencia(_archivo: ArchivoDescargable) -> Callable[[bytes, bytes], bool] | None:
    """Ningún archivo admite una descarga con otros bytes que diga lo mismo: cualquier cambio lo decide una persona.

    Returns:
        Siempre None.
    """
    return None


def descargar_originales(
    archivos: list[ArchivoDescargable],
    carpeta: Path,
    aceptar_cambio: bool,
    equivalentes: Callable[[ArchivoDescargable], Callable[[bytes, bytes], bool] | None] = _sin_equivalencia,
    *,
    comprobar: Callable[[bytes, Mapping[str, str]], None] | None = None,
) -> list[EntradaDeDescarga]:
    """Descarga cada original de su dirección oficial a `carpeta` y devuelve sus entradas de procedencia.

    Cada archivo es un ArchivoDescargable: `{archivo, nivel, titulo, url, licencia}` y, si la tiene, su norma. Un
    original que ya no coincide con la procedencia guardada en `carpeta` detiene la descarga, salvo con
    `aceptar_cambio` o si `equivalentes` (por archivo) admite la descarga nueva como igual a la conservada.
    `comprobar` permite exigir un contrato específico de cuerpo y cabeceras antes de conservar los bytes.

    Returns:
        Las entradas de procedencia, una por archivo y en el orden de `archivos`.
    """
    previos = registros_previos(carpeta / ARCHIVO_DE_PROCEDENCIA)
    registros = []
    for archivo in archivos:
        previo = previos.get(archivo["archivo"])
        regla = ReglaDeCambio(equivalentes(archivo), previo["sha256"] if previo else None, aceptar_cambio)
        descarga = (
            descargar_url(archivo["url"]) if comprobar is None else descargar_url(archivo["url"], comprobar=comprobar)
        )
        datos = conservar_o_sustituir(carpeta / archivo["archivo"], descarga, regla)
        observar_original(archivo["url"], descarga, datos)
        declarados = {campo: archivo[campo] for campo in CAMPOS_OPCIONALES_DE_PROCEDENCIA if campo in archivo}
        registros.append(registro_descarga(archivo, descarga, datos, previo, **declarados))
        print(archivo["archivo"], len(datos), "bytes")
    return registros


def primer_descubrimiento_previo(procedencia: Path, archivo: str) -> dict[str, Any] | None:
    """La primera entrada de `descubrimiento` de una procedencia anterior que registra `archivo`.

    Args:
        procedencia: El archivo de procedencia de la fuente; puede no existir todavía.
        archivo: El nombre del catálogo.

    Returns:
        Esa entrada, o None si la procedencia no existe o no la registra.
    """
    anterior = leer_json(procedencia) if procedencia.exists() else {}
    return next((entrada for entrada in anterior.get("descubrimiento", []) if entrada["archivo"] == archivo), None)


def descubrimiento_previo_unico(procedencia: Path, archivo: str, fuente: str) -> dict[str, Any] | None:
    """La única entrada de `descubrimiento` que registra `archivo`, tras exigir la forma de la procedencia anterior.

    Args:
        procedencia: El archivo de procedencia de la fuente; puede no existir todavía.
        archivo: El nombre del catálogo.
        fuente: El prefijo de los mensajes de error.

    Returns:
        Esa entrada, o None si la procedencia no existe o no la registra.

    Raises:
        FormatoInesperado: Si la procedencia no es un objeto, si su descubrimiento no es una lista de objetos o si
            registra el catálogo más de una vez.
    """
    anterior = leer_json(procedencia) if procedencia.exists() else {}
    exigir(isinstance(anterior, dict), f"{fuente}: procedencia debe ser un objeto")
    entradas = anterior.get("descubrimiento", [])
    exigir(
        isinstance(entradas, list) and all(isinstance(fila, dict) for fila in entradas),
        f"{fuente}: descubrimiento inválido",
    )
    previos = [fila for fila in entradas if fila.get("archivo") == archivo]
    exigir(len(previos) <= 1, f"{fuente}: catálogo duplicado en procedencia")
    return previos[0] if previos else None


def descubrir_edicion[E](  # noqa: PLR0913 - Cada diferencia entre fuentes, explícita y con nombre.
    catalogo: ArchivoDescargable,
    carpeta: Path,
    *,
    redireccion: str,
    leer: Callable[[bytes], E],
    comprobar: Callable[[E], None],
    previo: Callable[[], dict[str, Any] | None],
) -> tuple[E, Callable[[], EntradaDeDescarga]]:
    """Consulta el catálogo de ediciones de una fuente y lo conserva solo si su edición pasa la regla de la fuente.

    El catálogo debe llegar de la dirección pedida; `leer` saca su edición y `comprobar` aplica la regla de la fuente
    antes de leer la procedencia anterior o escribir nada: casi todas exigen la edición de su contrato, y TIC-H admite
    además una edición posterior, que registra como observación. Es una sonda mutable: lo que se valida es su edición,
    no sus bytes, así que se sustituye sin `--aceptar-cambio`; su fecha de descarga se conserva mientras su huella no
    cambie.
    La entrada de procedencia se registra cuando la fuente llama a la función devuelta: con huella nueva, su
    `descargado_utc` es ese momento (TIC-H la registra al completar sus originales; las demás, en el acto).

    Args:
        catalogo: El catálogo como archivo descargable: nombre, nivel, título, dirección y licencia.
        carpeta: La carpeta de originales de la fuente.
        redireccion: El mensaje de error si la dirección final no es la pedida.
        leer: Lee la edición de los bytes del catálogo; lanza si no la identifica.
        comprobar: Aplica la regla de edición de la fuente; lanza si la edición leída no la cumple.
        previo: Devuelve la entrada de descubrimiento anterior del catálogo, o None; aplica las guardas de la fuente.

    Returns:
        La edición leída y la función que registra la entrada de procedencia del catálogo.

    Raises:
        FormatoInesperado: Si el catálogo redirige a otra dirección, o lo que lancen `leer`, `comprobar` o `previo`.
    """
    descarga = descargar_url(catalogo["url"])
    exigir(descarga.url_final == catalogo["url"], redireccion)
    leida = leer(descarga.datos)
    comprobar(leida)
    anterior = previo()
    datos = conservar_o_sustituir(carpeta / catalogo["archivo"], descarga, ReglaDeCambio(aceptar_cambio=True))
    observar_original(catalogo["url"], descarga, datos)
    return leida, lambda: registro_descarga(catalogo, descarga, datos, anterior)


def aviso_descarga_manual(fuente: str, motivo: str) -> None:
    """Etapa `descargar` de una fuente sin descarga automática: lo explica y comprueba los originales conservados."""
    print(f"{fuente}: sus originales no se descargan con código. {motivo}")
    carpeta = relativa(carpetas(fuente).original)
    print(f"Cada original y su dirección oficial constan en {carpeta}/{ARCHIVO_DE_PROCEDENCIA}.")
    for ruta in comprobar_originales(fuente):
        print(f"✓ {ruta.name} coincide con su huella registrada")
