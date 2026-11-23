"""Lectura pura de negocio HP LIFE; no admite ofertas ni consulta cuentas o red."""

import hashlib
import json
import re
from dataclasses import dataclass
from datetime import datetime, timedelta
from html.parser import HTMLParser
from typing import Literal
from urllib.parse import urlsplit

from plataforma_datos.cursos.tipos_json import ObjetoJson, ValorJson

HTTP_CORRECTO = 200
CURSO = re.compile(r"/([a-z]{2})/course/([1-9][0-9]*)(?:-[^/]+)?/?")
HASH = re.compile(r"[0-9a-f]{64}")
Formato = Literal["html_next", "json_next", "curso_observado", "html_general_observado"]


FUENTE = "hp_life"


class ErrorFichaHpLife(ValueError):
    """La entrada no acredita integridad, identidad o estructura suficientes."""


@dataclass(frozen=True, kw_only=True)
class CapturaHpLife:
    """Procedencia explícita: el hash del cuerpo leído nunca sustituye al de la respuesta."""

    url_solicitada: str
    url_final: str
    localizador: str
    formato: Formato
    sha256_cuerpo: str
    bytes_cuerpo: int
    http: int | None
    completo: bool
    original_conservado: bool
    sha256_respuesta: str | None = None
    recibido_utc: str | None = None
    fecha_declarada_utc: str | None = None


@dataclass(frozen=True, kw_only=True)
class DeclaracionHpLife:
    """Bloque textual completo; su alcance no se convierte en condición individual."""

    texto: str
    encabezado: str
    localizador: str
    sha256_texto: str
    alcance: Literal["curso", "general"]


@dataclass(frozen=True, kw_only=True)
class CondicionesHpLife:
    """Declaraciones generales observadas, sin afirmar que estén vigentes hoy."""

    captura: CapturaHpLife
    destinatarios: tuple[DeclaracionHpLife, ...] | None
    gratuidad: tuple[DeclaracionHpLife, ...] | None
    registro: tuple[DeclaracionHpLife, ...] | None
    certificacion: tuple[DeclaracionHpLife, ...] | None


@dataclass(frozen=True, kw_only=True)
class FichaHpLife:
    """Un programa por identidad nativa e idioma; no fabrica edición ni disponibilidad."""

    id: str
    id_fuente: int
    codigo: str
    titulo: str
    idioma: str
    cuerpo_html: str
    descripcion: str | None
    captura: CapturaHpLife
    arbol_next: bool
    tipo: str | None
    privacidad: str | None
    estado: str | None
    certificado: bool | None
    requiere_licencia: bool | None
    requiere_grupo: bool | None
    producto_declarado: bool
    producto_id: str | int | None
    numero_localizaciones_externas: int | None
    inicio_publicado: str | None
    fin_publicado: str | None
    duracion_publicada: str | None
    destinatarios_curso: tuple[DeclaracionHpLife, ...] | None
    requisitos_curso: tuple[DeclaracionHpLife, ...] | None
    precios_curso: tuple[DeclaracionHpLife, ...] | None
    registro_curso: tuple[DeclaracionHpLife, ...] | None
    costes_practica: tuple[DeclaracionHpLife, ...] | None
    condiciones_generales: CondicionesHpLife | None


def _exigir(condicion: object, motivo: str) -> None:
    if not condicion:
        raise ErrorFichaHpLife(motivo)


def _sha(cuerpo: bytes) -> str:
    return hashlib.sha256(cuerpo).hexdigest()


def _fecha(fecha: str | None) -> None:
    if fecha is None:
        return
    try:
        instante = datetime.fromisoformat(fecha)
    except (TypeError, ValueError) as error:
        raise ErrorFichaHpLife("Fecha UTC inválida") from error
    _exigir(instante.utcoffset() == timedelta(0), "Fecha sin zona UTC explícita")


def _url(url: str) -> str:
    partes = urlsplit(url)
    _exigir(
        partes.scheme == "https"
        and partes.netloc == "www.life-global.org"
        and not partes.query
        and not partes.fragment,
        "URL ajena a HP LIFE o con parámetros no admitidos",
    )
    return partes.path


def _verificar(cuerpo: bytes, captura: CapturaHpLife) -> str:
    _exigir(type(cuerpo) is bytes, "El cuerpo debe ser bytes")
    http_observado = type(captura.http) is int and captura.http == HTTP_CORRECTO
    http_desconocido = (
        captura.http is None
        and captura.formato in {"curso_observado", "html_general_observado"}
        and captura.original_conservado is False
        and captura.recibido_utc is None
    )
    _exigir(http_observado or http_desconocido, "HTTP no satisfactorio o desconocido para una captura Next")
    _exigir(captura.completo is True, "Cuerpo físico incompleto")
    _exigir(type(captura.bytes_cuerpo) is int and captura.bytes_cuerpo == len(cuerpo), "Tamaño incoherente")
    _exigir(captura.sha256_cuerpo == _sha(cuerpo), "SHA del cuerpo incoherente")
    _exigir(
        bool(captura.localizador.strip())
        and captura.localizador not in {".", ".."}
        and "/" not in captura.localizador
        and "\\" not in captura.localizador,
        "Se requiere localizador opaco, sin ruta local",
    )
    _url(captura.url_solicitada)
    _url(captura.url_final)
    _fecha(captura.recibido_utc)
    _fecha(captura.fecha_declarada_utc)
    if captura.sha256_respuesta is not None:
        _exigir(HASH.fullmatch(captura.sha256_respuesta), "SHA de respuesta inválido")
    _exigir(type(captura.original_conservado) is bool, "Indicador de original inválido")
    if captura.original_conservado:
        _exigir(captura.sha256_respuesta == captura.sha256_cuerpo, "Original y cuerpo no coinciden")
    try:
        return cuerpo.decode("utf-8", errors="strict")
    except UnicodeDecodeError as error:
        raise ErrorFichaHpLife("Cuerpo no UTF-8") from error


def _objeto(valor: ValorJson, nombre: str) -> ObjetoJson:
    _exigir(isinstance(valor, dict), f"Falta objeto {nombre}")
    if isinstance(valor, dict):
        return valor
    raise ErrorFichaHpLife(nombre)


def _pares(pares: list[tuple[str, ValorJson]]) -> ObjetoJson:
    resultado: ObjetoJson = {}
    for clave, valor in pares:
        _exigir(clave not in resultado, f"Clave JSON duplicada: {clave}")
        resultado[clave] = valor
    return resultado


def _constante(valor: str) -> ValorJson:
    raise ErrorFichaHpLife(f"Constante JSON no admitida: {valor}")


class _Next(HTMLParser):
    """Lee únicamente el script de negocio; ignora traducciones y campos de interfaz."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=False)
        self.activo = False
        self.inicios = 0
        self.cierres = 0
        self.partes: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "script" and dict(attrs).get("id") == "__NEXT_DATA__":
            _exigir(dict(attrs).get("type") == "application/json", "Script Next no JSON")
            self.activo = True
            self.inicios += 1

    def handle_endtag(self, tag: str) -> None:
        if tag == "script" and self.activo:
            self.activo = False
            self.cierres += 1

    def handle_data(self, data: str) -> None:
        if self.activo:
            self.partes.append(data)


def _negocio(texto: str, formato: Formato) -> ObjetoJson:
    if formato == "html_next":
        parser = _Next()
        parser.feed(texto)
        parser.close()
        _exigir(parser.inicios == 1 and parser.cierres == 1, "Debe existir un único script Next completo")
        texto = "".join(parser.partes)
    try:
        valor: ValorJson = json.loads(texto, object_pairs_hook=_pares, parse_constant=_constante)
    except (ValueError, RecursionError) as error:
        raise ErrorFichaHpLife(f"JSON de negocio inválido: {error}") from error
    raiz = _objeto(valor, "raíz")
    if formato == "curso_observado":
        return _objeto(raiz.get("campos"), "campos observados")
    _exigir(formato in {"html_next", "json_next"}, "Formato no válido para negocio Next")
    props = _objeto(raiz.get("props"), "props")
    return _objeto(props.get("pageProps"), "pageProps")


def _texto(datos: ObjetoJson, clave: str, *, obligatorio: bool = False) -> str | None:
    valor = datos.get(clave)
    if valor is None and not obligatorio:
        return None
    _exigir(isinstance(valor, str) and bool(valor.strip()), f"Texto inválido: {clave}")
    if isinstance(valor, str):
        return valor
    raise ErrorFichaHpLife(clave)


def _booleano(datos: ObjetoJson, clave: str) -> bool | None:
    valor = datos.get(clave)
    _exigir(valor is None or type(valor) is bool, f"Booleano inválido: {clave}")
    return valor if isinstance(valor, bool) else None


def _producto(datos: ObjetoJson) -> str | int | None:
    valor = datos.get("productId")
    _exigir(
        valor is None or isinstance(valor, str) or (type(valor) is int and valor > 0),
        "Identidad de producto no soportada",
    )
    return valor


def _localizaciones(datos: ObjetoJson) -> int | None:
    valor = datos.get("externalProductLocations")
    _exigir(valor is None or isinstance(valor, list), "Localizaciones externas no son una lista")
    return len(valor) if isinstance(valor, list) else None


class _Bloques(HTMLParser):
    """Conserva bloques completos, incluidos texto posterior a enlaces y listas anidadas."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.encabezado = ""
        self.activos: list[tuple[str, list[str], int]] = []
        self.bloques: list[tuple[str, str, int]] = []
        self.numero = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in {"p", "li", "h1", "h2", "h3", "h4", "h5", "h6"}:
            self.numero += 1
            self.activos.append((tag, [], self.numero))
        elif tag == "br":
            self.handle_data(" ")

    def handle_data(self, data: str) -> None:
        for _, partes, _ in self.activos:
            partes.append(data)

    def handle_endtag(self, tag: str) -> None:
        if not self.activos or self.activos[-1][0] != tag:
            return
        _, partes, numero = self.activos.pop()
        texto = " ".join("".join(partes).split())
        if tag.startswith("h"):
            self.encabezado = texto
        elif texto:
            self.bloques.append((self.encabezado, texto, numero))


def _declaraciones(
    html: str,
    patron: str,
    alcance: Literal["curso", "general"],
    *,
    parrafo: str = r"(?!)",
) -> tuple[DeclaracionHpLife, ...] | None:
    parser = _Bloques()
    parser.feed(html)
    parser.close()
    resultado = tuple(
        DeclaracionHpLife(
            texto=texto,
            encabezado=encabezado,
            localizador=f"{'body' if alcance == 'curso' else 'staticHelpTopics'}/bloque[{numero}]",
            sha256_texto=_sha(texto.encode()),
            alcance=alcance,
        )
        for encabezado, texto, numero in parser.bloques
        if re.search(patron, encabezado, flags=re.I) or re.search(parrafo, texto, flags=re.I)
    )
    return resultado or None


def extraer_condiciones_generales(cuerpo: bytes, captura: CapturaHpLife) -> CondicionesHpLife:
    """Lee FAQ de HP LIFE; solo devuelve las secciones generales pertinentes.

    Returns:
        Declaraciones generales con su propia captura, separadas de cada curso.
    """
    texto = _verificar(cuerpo, captura)
    for url in (captura.url_solicitada, captura.url_final):
        _exigir(_url(url) in {"/es/help", "/es/help/"}, "Las condiciones requieren la FAQ española")
    if captura.formato != "html_general_observado":
        datos = _negocio(texto, captura.formato)
        texto = _texto(datos, "staticHelpTopics", obligatorio=True) or ""
    gratuitos = _declaraciones(texto, r"^Los cursos de HP LIFE son gratuitos$", "general")
    audiencia = tuple(
        declaracion
        for declaracion in gratuitos or ()
        if re.search(r"todas las personas|cualquier persona|abierto a todos", declaracion.texto, re.I)
    )
    return CondicionesHpLife(
        captura=captura,
        destinatarios=audiencia or None,
        gratuidad=gratuitos,
        registro=_declaraciones(
            texto, r"^Inscribirse en un curso\.?$|^Crear una .nueva. cuenta de HP LIFE\.?$", "general"
        ),
        certificacion=_declaraciones(texto, r"^Cómo obtener una Certificación de finalización\.?$", "general"),
    )


def _identidad(datos: ObjetoJson, captura: CapturaHpLife) -> tuple[int, str]:
    identificador = datos.get("id")
    _exigir(type(identificador) is int and identificador > 0, "Identidad nativa inválida")
    idioma = _texto(datos, "language", obligatorio=True) or ""
    for url in (captura.url_solicitada, captura.url_final):
        ruta = CURSO.fullmatch(_url(url))
        _exigir(
            ruta and ruta.group(1) == idioma and int(ruta.group(2)) == identificador,
            "URL/idioma/identidad incoherentes",
        )
    if isinstance(identificador, int):
        return identificador, idioma
    raise ErrorFichaHpLife("Identidad inválida")


def extraer_ficha(
    cuerpo: bytes,
    captura: CapturaHpLife,
    *,
    condiciones_generales: CondicionesHpLife | None = None,
) -> FichaHpLife:
    """Extrae exclusivamente negocio observado, sin niveles, marcas ni disponibilidad inferidos.

    Returns:
        Ficha candidata inmutable; campos ausentes conservados como desconocidos.
    """
    texto = _verificar(cuerpo, captura)
    pagina = _negocio(texto, captura.formato)
    datos = (
        pagina
        if captura.formato == "curso_observado"
        else _objeto(pagina.get("initialCourseData"), "initialCourseData")
    )
    identificador, idioma = _identidad(datos, captura)
    cuerpo_html = _texto(datos, "body", obligatorio=True) or ""
    return FichaHpLife(
        id=f"hp-life:{identificador}:{idioma}",
        id_fuente=identificador,
        codigo=_texto(datos, "code", obligatorio=True) or "",
        titulo=_texto(datos, "name", obligatorio=True) or "",
        idioma=idioma,
        cuerpo_html=cuerpo_html,
        descripcion=_texto(datos, "description"),
        captura=captura,
        arbol_next=captura.formato != "curso_observado",
        tipo=_texto(datos, "type"),
        privacidad=_texto(datos, "privacyLevel"),
        estado=_texto(datos, "status"),
        certificado=_booleano(datos, "hasCertificate"),
        requiere_licencia=_booleano(datos, "requiresLicenseToEnroll"),
        requiere_grupo=_booleano(datos, "isGroupMembershipRequired"),
        producto_declarado="productId" in datos,
        producto_id=_producto(datos),
        numero_localizaciones_externas=_localizaciones(datos),
        inicio_publicado=_texto(datos, "startDate"),
        fin_publicado=_texto(datos, "finishDate"),
        duracion_publicada=_texto(datos, "duration"),
        destinatarios_curso=_declaraciones(
            cuerpo_html,
            r"^(?:destinatarios?(?: del curso)?|público del curso|¿?para quién es (?:este|el) curso\??)[.:]?$",
            "curso",
            parrafo=r"este curso (?:está|esta) (?:dirigido|diseñado|destinado) (?:a|para)",
        ),
        requisitos_curso=_declaraciones(
            cuerpo_html, r"^(?:requisitos?(?: del curso)?|antes de (?:comenzar|empezar))[.:]?$", "curso"
        ),
        precios_curso=_declaraciones(cuerpo_html, r"^(?:precio|coste|costo) del curso[.:]?$", "curso"),
        registro_curso=_declaraciones(
            cuerpo_html, r"^(?:registro|inscripción)(?: en el curso| del curso)?[.:]?$", "curso"
        ),
        costes_practica=_declaraciones(
            cuerpo_html, r"^(?:cost[eo]s? de (?:las? )?prácticas?|herramientas? de práctica)[.:]?$", "curso"
        ),
        condiciones_generales=condiciones_generales,
    )


def main(argv: list[str] | None = None) -> int:
    """Ejecuta la operación registrada conservando las APIs puras de lectura.

    Returns:
        Código de las etapas comunes de esta fuente.
    """
    from plataforma_datos.cursos.operacion_fuente import main as operacion

    return operacion(FUENTE, argv)


if __name__ == "__main__":
    raise SystemExit(main())
