"""Hechos técnicos separados de autoría editorial, actualidad intelectual y disponibilidad futura.

La identidad requiere revisión explícita de una captura exacta. Un título de Faro,
una URL que responde o una fecha de ingestión nunca sustituyen esa evidencia.
"""

import hashlib
import re
from collections import OrderedDict
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta
from html.parser import HTMLParser
from http import HTTPStatus
from urllib.parse import urlsplit

from plataforma_datos.biblioteca.fuentes.enlaces_lecturas.pdf import MAX_BYTES, extraer
from plataforma_datos.comun.nucleo import FormatoInesperado

MIN_TEXTO_HTML = 80
MAX_LECTURAS_REUTILIZADAS = 128
HTTP_MIN, HTTP_MAX = 100, 599
SHA256 = re.compile(r"[0-9a-f]{64}")
ACCESOS = re.compile(r"(?:^|/)(?:login|signin|sign-in|auth|acceso|account)(?:/|$)", re.I)
PORTADAS = frozenset({"/", "", "/es", "/ca", "/en", "/index.html", "/home"})
# Hechos observados sobre la URL consultada, no sobre la obra: ninguno afirma que haya desaparecido.
EVIDENCIAS_CONTRARIAS = frozenset({"http_no_encontrado", "http_retirado", "redireccion_generica", "destino_no_seguro"})


@dataclass(frozen=True)
class Contexto:
    """Reloj explícito UTC y plazo de revisión interna, ajenos a la revisión editorial.

    El plazo (`validez_dias`) solo marca cuándo conviene volver a consultar: avisa en la
    cobertura de comprobaciones y nunca cambia el estado de una captura.
    """

    ahora: datetime
    validez_dias: int


@dataclass(frozen=True, kw_only=True)
class Captura:
    """Recepción completa por URL; un fallo sin cuerpo no inventa una respuesta HTTP."""

    url: str
    url_final: str | None
    capturado_utc: str
    cuerpo_sha256: str | None
    content_type: str
    resultado: str
    codigo_http: int | None
    error_tipo: str | None = None


@dataclass(frozen=True, kw_only=True)
class Identidad:
    """Revisión específica de una captura; PDF exige además huella del texto extraído.

    El archivo operativo que contiene estas decisiones es una entrada separada,
    ligada por huella a la admisión; no lo genera el robot a partir de sus títulos.
    """

    url: str
    url_final: str
    cuerpo_sha256: str
    revisado_utc: str
    texto_sha256: str | None = None


def instante(valor: str) -> datetime:
    """Exige un instante UTC completo y consciente.

    Returns:
        Fecha con zona, sin convertir una fecha de ingestión en recepción.

    Raises:
        FormatoInesperado: Si falta zona UTC o no es una fecha válida.
    """
    try:
        fecha = datetime.fromisoformat(valor.replace("Z", "+00:00"))
    except (ValueError, AttributeError) as error:
        raise FormatoInesperado("enlaces_lecturas: instante no válido") from error
    if "T" not in valor or fecha.utcoffset() != timedelta(0):
        raise FormatoInesperado("enlaces_lecturas: se requiere instante UTC")
    return fecha


def url_web(url: str) -> None:
    """Exige dirección web pública declarada, sin credenciales.

    Raises:
        FormatoInesperado: Si no tiene un host HTTPS o contiene credenciales.
    """
    try:
        partes = urlsplit(url)
        valida = partes.scheme == "https" and bool(partes.hostname) and partes.username is None
    except (ValueError, TypeError) as error:
        raise FormatoInesperado("enlaces_lecturas: URL no válida") from error
    if not valida:
        raise FormatoInesperado("enlaces_lecturas: se requiere URL HTTPS sin credenciales")


class _TextoHTML(HTMLParser):
    """Cuenta texto visible conservadoramente; excluye scripts y detecta acceso por contraseña."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.omitir = 0
        self.textos: list[str] = []
        self.password = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        """Ignora código y detecta formularios de acceso."""
        if tag in {"head", "script", "style", "noscript", "template"}:
            self.omitir += 1
        if tag == "input" and dict(attrs).get("type", "").lower() == "password":
            self.password = True

    def handle_endtag(self, tag: str) -> None:
        """Termina una región omitida sin alterar las fechas."""
        if tag in {"head", "script", "style", "noscript", "template"} and self.omitir:
            self.omitir -= 1

    def handle_data(self, data: str) -> None:
        """Recoge texto, nunca interpreta instrucciones del documento."""
        if not self.omitir:
            self.textos.append(data)


def _html(cuerpo: bytes) -> str:
    """Distingue texto legible de páginas de acceso o cuerpos no decodificables.

    Returns:
        Estado técnico de la lectura HTML, sin establecer identidad.
    """
    if len(cuerpo) > MAX_BYTES:
        return "html_limite_bytes"
    try:
        texto = cuerpo.decode("utf-8-sig", errors="strict")
    except UnicodeError:
        return "legibilidad_no_acreditada"
    parser = _TextoHTML()
    parser.feed(texto)
    visible = " ".join(" ".join(parser.textos).split())
    if re.search(
        r"server temporarily unavailable|service temporarily unavailable|page not found|página no encontrada",
        visible,
        re.I,
    ):
        return "servicio_no_disponible"
    if parser.password or re.search(r"verify you are human|checking your browser|access denied", visible, re.I):
        return "acceso_restringido"
    if len(visible) < MIN_TEXTO_HTML or "<" not in texto:
        return "legibilidad_no_acreditada"
    return "legible"


def tipo_medio(content_type: str) -> str:
    """Normaliza MIME por igual para extracción y comprobación de identidad.

    Returns:
        Tipo de medio sin parámetros, espacios exteriores ni diferencias de mayúsculas.
    """
    return content_type.split(";", 1)[0].strip().lower()


def _legibilidad(captura: Captura, cuerpo: bytes) -> dict[str, object]:
    """Extrae texto sin equiparar su extracción a revisión visual.

    Returns:
        Método y estado técnico, sin establecer identidad.
    """
    tipo = tipo_medio(captura.content_type)
    if tipo in {"text/html", "application/xhtml+xml"}:
        return {"estado": _html(cuerpo), "metodo": "HTMLParser-texto-visible-conservador"}
    if tipo == "application/pdf":
        return extraer(cuerpo)
    return {"estado": "legibilidad_no_acreditada", "metodo": "tipo_no_admitido"}


class _Lecturas:
    """Reutiliza solo extracciones propias durante una operación, con memoria acotada.

    Las firmas pertenecen al contrato técnico y a los dos módulos que fijan el
    método. No recibe diagnósticos de archivos externos ni conserva cuerpos.
    """

    def __init__(self, firmas: tuple[str, str, str]) -> None:
        self._firmas = firmas
        self._resultados: OrderedDict[tuple[str, str, tuple[str, str, str]], dict[str, object]] = OrderedDict()

    def leer(self, captura: Captura, cuerpo: bytes) -> dict[str, object]:
        """Extrae o reutiliza por bytes, MIME normalizado y contrato/método exactos.

        Returns:
            Una copia del diagnóstico producido en esta misma operación.
        """
        clave = (hashlib.sha256(cuerpo).hexdigest(), tipo_medio(captura.content_type), self._firmas)
        if clave not in self._resultados:
            self._resultados[clave] = _legibilidad(captura, cuerpo)
            if len(self._resultados) > MAX_LECTURAS_REUTILIZADAS:
                self._resultados.popitem(last=False)
        self._resultados.move_to_end(clave)
        return dict(self._resultados[clave])


def _tipos_captura(captura: Captura) -> None:
    """Rechaza hechos incompletos o códigos HTTP que no se recibieron.

    Raises:
        FormatoInesperado: Si los campos no tienen tipos y alcance coherentes.
    """
    if not isinstance(captura.url, str) or not isinstance(captura.content_type, str):
        raise FormatoInesperado("enlaces_lecturas: tipos de captura no válidos")
    if captura.resultado == "http_error":
        if type(captura.codigo_http) is not int or not HTTP_MIN <= captura.codigo_http <= HTTP_MAX:
            raise FormatoInesperado("enlaces_lecturas: código HTTP no válido")
    elif captura.codigo_http is not None:
        raise FormatoInesperado("enlaces_lecturas: código HTTP no recibido")


def validar_captura(captura: Captura, cuerpo: bytes | None, contexto: Contexto) -> datetime:
    """Comprueba integridad y causalidad de los hechos antes de clasificarlos.

    Returns:
        Instante efectivo de la captura.

    Raises:
        FormatoInesperado: Ante fechas futuras, tipos desconocidos o cuerpos alterados.
    """
    _tipos_captura(captura)
    fecha = instante(captura.capturado_utc)
    if contexto.ahora.utcoffset() != timedelta(0) or fecha > contexto.ahora:
        raise FormatoInesperado("enlaces_lecturas: captura futura o reloj sin UTC")
    if type(contexto.validez_dias) is not int or contexto.validez_dias <= 0:
        raise FormatoInesperado("enlaces_lecturas: plazo técnico no válido")
    url_web(captura.url)
    if captura.resultado not in {"respuesta", "fallo_temporal", "http_error"}:
        raise FormatoInesperado("enlaces_lecturas: resultado desconocido")
    if captura.resultado == "respuesta":
        if captura.url_final is None or cuerpo is None or captura.codigo_http is not None:
            raise FormatoInesperado("enlaces_lecturas: respuesta incompleta")
        url_web(captura.url_final)
        if hashlib.sha256(cuerpo).hexdigest() != captura.cuerpo_sha256:
            raise FormatoInesperado("enlaces_lecturas: cuerpo distinto de su huella")
    elif cuerpo is not None or captura.cuerpo_sha256 is not None or captura.url_final is not None:
        raise FormatoInesperado("enlaces_lecturas: fallo con cuerpo no recibido")
    return fecha


def _identificada(captura: Captura, identidad: Identidad | None, contexto: Contexto, texto_sha256: object) -> bool:
    """Vincula solo la evidencia revisada de esa URL, destino y contenido.

    Returns:
        True para una revisión temporalmente posible y específica de esos bytes.
    """
    if identidad is None:
        return False
    revision = instante(identidad.revisado_utc)
    if revision > contexto.ahora:
        return False
    if tipo_medio(captura.content_type) == "application/pdf" and (
        texto_sha256 is None or identidad.texto_sha256 != texto_sha256
    ):
        return False
    return (identidad.url, identidad.url_final, identidad.cuerpo_sha256) == (
        captura.url,
        captura.url_final,
        captura.cuerpo_sha256,
    )


def es_evidencia_concluyente(estado: object) -> bool:
    """Limita las conclusiones a observaciones que acreditan presencia o impedimento.

    Returns:
        True solo para identidad acreditada, ausencia HTTP o destino genérico/inseguro.
    """
    return estado == "verificado" or estado in EVIDENCIAS_CONTRARIAS


def _estado_sin_cuerpo(captura: Captura) -> str:
    """Interpreta solo hechos de transporte preservados, sin atribuir identidad.

    Returns:
        Diagnóstico concreto;404/410 se refieren a la URL consultada, no a la obra.
    """
    if captura.resultado == "http_error":
        if captura.codigo_http == HTTPStatus.NOT_FOUND:
            return "http_no_encontrado"
        if captura.codigo_http == HTTPStatus.GONE:
            return "http_retirado"
    if captura.resultado == "fallo_temporal":
        return {"LimiteDescargaExcedido": "limite_tamano", "DestinoNoSeguro": "destino_no_seguro"}.get(
            captura.error_tipo, "fallo_temporal"
        )
    return captura.resultado


def _estado(captura: Captura, cuerpo: bytes | None, lecturas: _Lecturas | None) -> dict[str, object]:
    """Clasifica recepción y contenido sin convertir un error en retirada.

    Returns:
        Resultado técnico conservador anterior a identidad y vencimiento.
    """
    if captura.resultado != "respuesta":
        return {"estado": _estado_sin_cuerpo(captura)}
    assert captura.url_final is not None and cuerpo is not None
    destino = urlsplit(captura.url_final).path.rstrip("/")
    origen = urlsplit(captura.url).path.rstrip("/")
    if ACCESOS.search(destino):
        return {"estado": "acceso_restringido"}
    if captura.url_final != captura.url and destino in PORTADAS and origen not in PORTADAS:
        return {"estado": "redireccion_generica"}
    return _legibilidad(captura, cuerpo) if lecturas is None else lecturas.leer(captura, cuerpo)


def evaluar(
    captura: Captura,
    cuerpo: bytes | None,
    identidad: Identidad | None,
    contexto: Contexto,
    *,
    _lecturas: _Lecturas | None = None,
) -> dict[str, object]:
    """Evalúa hechos con reloj explícito; repetir no renueva captura ni revisión.

    La edad no cambia el estado: una identidad acreditada sigue `verificado` con su fecha;
    `vence_utc` solo marca la próxima revisión interna.

    Returns:
        Estado y evidencia, independientes de la selección editorial de la lectura.
    """
    fecha = validar_captura(captura, cuerpo, contexto)
    lectura = _estado(captura, cuerpo, _lecturas)
    identificada = _identificada(captura, identidad, contexto, lectura.get("texto_sha256"))
    estado = lectura["estado"]
    vence = fecha + timedelta(days=contexto.validez_dias)
    if isinstance(estado, str) and estado.startswith("legible"):
        estado = "verificado" if identificada else "identidad_no_acreditada"
    return {
        **asdict(captura),
        "estado": estado,
        "identidad_acreditada": identificada,
        "vence_utc": vence.isoformat(),
        "lectura_tecnica": lectura,
    }
