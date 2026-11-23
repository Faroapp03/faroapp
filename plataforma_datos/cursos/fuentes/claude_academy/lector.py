"""Lectura candidata de fichas HTML de Claude Academy, sin red ni activación de productores."""

import hashlib
import re
from collections.abc import Iterator, Mapping
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from html.parser import HTMLParser
from pathlib import PurePosixPath
from typing import NamedTuple
from urllib.parse import urldefrag, urljoin, urlsplit

HTTP_CORRECTO = 200
HOST_ACADEMY = "academy.claude.com"
VACIOS = frozenset(
    {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}
)
SEPARADORES = frozenset(
    {
        "p",
        "div",
        "section",
        "article",
        "li",
        "ul",
        "ol",
        "br",
        "dt",
        "dd",
        "summary",
        "button",
        "tr",
        "td",
        "th",
        "pre",
        "blockquote",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
    }
)
BLOQUES = frozenset({"p", "li", "dt", "dd", "summary", "button", "h1", "h2", "h3", "h4", "h5", "h6"})
IGNORADOS = frozenset({"script", "style", "template"})
PATRON_CURSO = re.compile(r"/courses/([a-z0-9]+(?:-[a-z0-9]+)*)")
REQUISITOS = re.compile(r"prerequisites?|requirements?|before you (?:start|begin)|what (?:do |will )?i need", re.I)
DESTINATARIOS = re.compile(r"who (?:this|the course|it)|audience|who (?:is|should|can)|is this course for", re.I)
REQUISITO_EN_PARRAFO = re.compile(r"\b(?:participants|learners|students) should complete\b|\bprerequisites?\b", re.I)
DESTINATARIO_EN_PARRAFO = re.compile(r"\bthis course is (?:designed |intended )?for\b", re.I)
ARTICULO_DEL_CURSO = re.compile(r"/main\[\d+\](?:/div\[\d+\])*/article\[\d+\]$")
CABECERA_DEL_CURSO = re.compile(r"/main\[\d+\]/header\[\d+\](?:/div\[\d+\])*$")
PERFIL = (
    r"(?:builders|creators|writers|illustrators|(?:instructional )?designers|musicians|(?:other )?makers|"
    r"faculty|(?:education(?:al)? )?leaders|(?:p?k[-–]12 )?(?:teachers|educators)|(?:creative )?professionals|"
    r"(?:(?:nonprofit|small business) )?staff|small business owners|students)"
)
PUBLICO_QUE_APRENDE = re.compile(
    rf"^this (?:train the trainer )?course (?:helps|empowers|prepares) {PERFIL}(?:(?:, (?:and )?| and ){PERFIL})*"
    r"(?:\s*[—–]\s*whether [^—–.!?]+[—–]\s*| )(?:to )?(?:apply|build|develop|facilitate|lead|learn)\b",
    re.I,
)


FUENTE = "claude_academy"


class ErrorFichaAcademy(ValueError):
    """La captura no acredita integridad o identidad suficientes para extraer esta ficha."""


class EvidenciaTexto(NamedTuple):
    """Texto íntegro de un bloque o sección y su localizador en la captura identificada."""

    texto: str
    localizador: str
    sha256_texto: str
    encabezado: str | None
    tipo: str


class EnlaceAcademy(NamedTuple):
    """Texto completo del enlace y href original, sin seguirlo ni reparar su destino."""

    texto: str
    href: str
    localizador: str


@dataclass(frozen=True, kw_only=True)
class FichaAcademy:
    """Hechos extraídos y evidencia completa; ausencia de mapeo no significa ausencia de requisitos."""

    id: str
    url: str
    titulo: str
    titulo_documento: str
    archivo: str
    capturado_utc: str
    sha256_captura: str
    bytes_captura: int
    contenido: str
    bloques: tuple[EvidenciaTexto, ...]
    enlaces: tuple[EnlaceAcademy, ...]
    requisitos: tuple[EvidenciaTexto, ...] | None
    destinatarios: tuple[EvidenciaTexto, ...] | None


@dataclass
class _Marco:
    tag: str
    atributos: dict[str, str | None]
    ruta: str
    inicio: int
    posicion: tuple[int, int]
    hijos: dict[str, int] = field(default_factory=dict)


class _Bloque(NamedTuple):
    tag: str
    atributos: dict[str, str | None]
    ruta: str
    inicio: int
    fin: int
    posicion: tuple[int, int]


def _exigir(condicion: object, motivo: str) -> None:
    if not condicion:
        raise ErrorFichaAcademy(motivo)


def _plano(texto: str) -> str:
    return " ".join(texto.split())


def _contenido(fragmentos: list[str]) -> str:
    return "\n".join(linea for trozo in "".join(fragmentos).splitlines() if (linea := _plano(trozo)))


def _localizador(bloque: _Bloque) -> str:
    linea, columna = bloque.posicion
    identidad = f"#{bloque.atributos['id']} " if bloque.atributos.get("id") else ""
    return f"{identidad}{bloque.ruta} (línea {linea}, columna {columna + 1})"


def _evidencia(texto: str, bloque: _Bloque, encabezado: str | None = None) -> EvidenciaTexto:
    return EvidenciaTexto(
        texto, _localizador(bloque), hashlib.sha256(texto.encode()).hexdigest(), encabezado, bloque.tag
    )


class _Lector(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.pila: list[_Marco] = []
        self.fragmentos: list[str] = []
        self.bloques: list[_Bloque] = []
        self.regiones: list[_Bloque] = []
        self.articulos: list[_Bloque] = []
        self.titulos: list[str] = []
        self.canonical: list[str | None] = []
        self.identidades: list[str | None] = []
        self.rutas_de_curso: list[str | None] = []
        self.cierres: set[str] = set()

    def _cabecera(self, tag: str, atributos: dict[str, str | None]) -> None:
        if tag == "link" and "canonical" in (atributos.get("rel") or "").split():
            self.canonical.append(atributos.get("href"))
        if tag == "meta" and atributos.get("property") == "og:url":
            self.identidades.append(atributos.get("content"))
        if tag == "meta" and atributos.get("name") == "academy-prerender-path":
            self.rutas_de_curso.append(atributos.get("content"))

    def _dentro(self, etiquetas: frozenset[str]) -> bool:
        return any(m.tag in etiquetas for m in self.pila)

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        padre = self.pila[-1] if self.pila else None
        atributos = dict(attrs)
        self._cabecera(tag, atributos)
        numero = 1
        if padre:
            numero = padre.hijos.get(tag, 0) + 1
            padre.hijos[tag] = numero
        ruta = f"{padre.ruta if padre else ''}/{tag}[{numero}]"
        if tag in SEPARADORES and self._dentro(frozenset({"main"})):
            self.fragmentos.append("\n")
        if tag not in VACIOS:
            self.pila.append(_Marco(tag, atributos, ruta, len(self.fragmentos), self.getpos()))

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.handle_starttag(tag, attrs)
        if tag not in VACIOS:
            self.handle_endtag(tag)

    def handle_data(self, data: str) -> None:
        if self._dentro(IGNORADOS):
            return
        if self._dentro(frozenset({"head"})) and self.pila[-1].tag == "title":
            self.titulos.append(data)
        if self._dentro(frozenset({"main"})):
            self.fragmentos.append(data)

    def handle_endtag(self, tag: str) -> None:
        if not any(m.tag == tag for m in self.pila):
            return
        dentro = self._dentro(frozenset({"main"}))
        while self.pila:
            marco = self.pila.pop()
            if dentro and (marco.atributos.get("id") or marco.tag == "details" or "itemscope" in marco.atributos):
                self.regiones.append(
                    _Bloque(marco.tag, marco.atributos, marco.ruta, marco.inicio, len(self.fragmentos), marco.posicion)
                )
            if dentro and marco.tag == "article":
                self.articulos.append(
                    _Bloque(marco.tag, marco.atributos, marco.ruta, marco.inicio, len(self.fragmentos), marco.posicion)
                )
            if dentro and marco.tag in BLOQUES | {"a"}:
                self.bloques.append(
                    _Bloque(marco.tag, marco.atributos, marco.ruta, marco.inicio, len(self.fragmentos), marco.posicion)
                )
            if marco.tag == tag:
                break
        self.cierres.add(tag)
        if dentro and tag in SEPARADORES:
            self.fragmentos.append("\n")


def _verificar_captura(cuerpo: bytes, meta: Mapping[str, object], url: str) -> tuple[str, str, str]:
    _exigir(type(meta.get("http")) is int and meta["http"] == HTTP_CORRECTO, "La captura no es HTTP 200")
    _exigir(meta.get("completo") is True, "La captura no está declarada completa")
    _exigir(type(meta.get("bytes")) is int and meta["bytes"] == len(cuerpo), "Tamaño de captura distinto")
    huella = hashlib.sha256(cuerpo).hexdigest()
    _exigir(meta.get("sha256") == huella, "Huella de captura distinta")
    _exigir(meta.get("url_solicitada") == url and meta.get("url_final") == url, "URL de captura distinta del curso")
    archivo, fecha = meta.get("archivo"), meta.get("recibido_utc")
    _exigir(
        isinstance(archivo, str) and archivo and PurePosixPath(archivo).name == archivo and "\\" not in archivo,
        "Localizador de captura no válido",
    )
    _exigir(isinstance(fecha, str), "Falta el instante real de captura")
    try:
        instante = datetime.fromisoformat(fecha.replace("Z", "+00:00"))
    except ValueError as error:
        raise ErrorFichaAcademy("Instante de captura no válido") from error
    _exigir(instante.utcoffset() == timedelta(0), "La captura requiere instante UTC")
    return archivo, fecha, huella


def _identidad(lector: _Lector, url: str) -> tuple[str, str, str]:
    try:
        direccion = urlsplit(url)
    except ValueError as error:
        raise ErrorFichaAcademy("URL Academy no válida") from error
    curso = PATRON_CURSO.fullmatch(direccion.path)
    _exigir(
        direccion.scheme == "https"
        and direccion.netloc == HOST_ACADEMY
        and curso
        and not direccion.query
        and not direccion.fragment,
        "URL Academy no válida",
    )
    _exigir(lector.canonical == [url], "Canonical ausente, duplicado o distinto")
    _exigir(all(valor == url for valor in lector.identidades), "og:url no corresponde al curso")
    _exigir(all(valor == direccion.path for valor in lector.rutas_de_curso), "ID prerender distinto")
    h1 = [b for b in lector.bloques if b.tag == "h1"]
    _exigir(len(h1) == 1, "La ficha necesita un título h1 inequívoco")
    titulo = _plano("".join(lector.fragmentos[h1[0].inicio : h1[0].fin]))
    documento = _plano("".join(lector.titulos))
    _exigir(titulo and documento == titulo + " · Claude Academy", "Título de documento y curso no coinciden")
    return curso.group(1), titulo, documento


def _secciones(lector: _Lector) -> list[tuple[_Bloque, str, str]]:
    encabezados = sorted((b for b in lector.bloques if re.fullmatch(r"h[2-6]", b.tag)), key=lambda b: b.inicio)
    secciones = []
    for indice, bloque in enumerate(encabezados):
        limite = next((b.inicio for b in encabezados[indice + 1 :] if b.tag <= bloque.tag), len(lector.fragmentos))
        # Un apartado del artículo no incluye la navegación hermana posterior.
        finales = [a.fin for a in lector.articulos if a.inicio <= bloque.inicio and bloque.fin <= a.fin]
        limite = min([limite, *finales])
        titulo = _plano("".join(lector.fragmentos[bloque.inicio : bloque.fin]))
        texto = _contenido(lector.fragmentos[bloque.fin : limite])
        if texto:
            secciones.append((bloque, titulo, texto))
    return secciones


def _preguntas(lector: _Lector, patron: re.Pattern[str]) -> list[tuple[int, EvidenciaTexto]]:
    hechos = []
    for pregunta in lector.bloques:
        titulo = _plano("".join(lector.fragmentos[pregunta.inicio : pregunta.fin]))
        if pregunta.tag not in ("summary", "button") or not patron.search(titulo):
            continue
        if pregunta.tag == "summary":
            candidatas = [r for r in lector.regiones if r.tag == "details" and pregunta.ruta.startswith(r.ruta + "/")]
            panel = max(candidatas, key=lambda r: len(r.ruta)) if candidatas else None
            inicio = pregunta.fin
        else:
            candidatas = [
                r
                for r in lector.regiones
                if r.atributos.get("id") == pregunta.atributos.get("aria-controls")
                and pregunta.atributos.get("aria-controls")
            ]
            _exigir(len(candidatas) <= 1, "Pregunta con panel de respuesta ambiguo")
            panel = candidatas[0] if candidatas else None
            inicio = panel.inicio if panel else pregunta.fin
        texto = _contenido(lector.fragmentos[inicio : panel.fin]) if panel else ""
        if texto:
            hechos.append((pregunta.inicio, _evidencia(texto, panel, titulo)._replace(tipo="faq")))
    return hechos


def _hechos(lector: _Lector, patron: re.Pattern[str], parrafo: re.Pattern[str]) -> tuple[EvidenciaTexto, ...] | None:
    hechos = []
    for bloque, titulo, texto in _secciones(lector):
        if patron.search(titulo):
            hechos.append((bloque.inicio, _evidencia(texto, bloque, titulo)))
    hechos.extend(_preguntas(lector, patron))
    for bloque in sorted(lector.bloques, key=lambda b: b.inicio):
        texto = _plano("".join(lector.fragmentos[bloque.inicio : bloque.fin]))
        if bloque.tag == "p" and parrafo.search(texto) and not any(texto in hecho.texto for _, hecho in hechos):
            hechos.append((bloque.inicio, _evidencia(texto, bloque)))
    return tuple(hecho for _, hecho in sorted(hechos, key=lambda par: par[0])) or None


def _parrafos_de_presentacion(lector: _Lector) -> Iterator[tuple[_Bloque, bool]]:
    articulos = [a for a in lector.articulos if ARTICULO_DEL_CURSO.search(a.ruta)]
    if len(articulos) == 1:
        articulo = articulos[0]
        for b in lector.bloques:
            if not b.ruta.startswith(articulo.ruta + "/"):
                continue
            if b.tag.startswith("h"):
                titulo = _plano("".join(lector.fragmentos[b.inicio : b.fin])).casefold()
                if titulo not in ("overview", "course overview", "about this course", "about the course"):
                    break
            if b.tag == "p" and b.ruta.rsplit("/", 1)[0] == articulo.ruta:
                yield b, False
    h1 = next(b for b in lector.bloques if b.tag == "h1")
    padre_h1 = h1.ruta.rsplit("/", 1)[0]
    if CABECERA_DEL_CURSO.search(padre_h1):
        for b in lector.bloques:
            if b.tag == "p" and b.inicio >= h1.fin and b.ruta.rsplit("/", 1)[0] == padre_h1:
                yield b, True
                break


def _destinatarios_de_descripcion(lector: _Lector) -> tuple[EvidenciaTexto, ...] | None:
    for bloque, resumen in _parrafos_de_presentacion(lector):
        texto = _plano("".join(lector.fragmentos[bloque.inicio : bloque.fin]))
        # Solo la entradilla junto al h1 puede omitir el sujeto «this course».
        declaracion = "This course " + texto if resumen and not texto.lower().startswith("this ") else texto
        if PUBLICO_QUE_APRENDE.match(declaracion) and _parrafo_del_curso(lector, bloque):
            return (_evidencia(texto, bloque),)
    return None


def _parrafo_del_curso(lector: _Lector, bloque: _Bloque) -> bool:
    # Si el párrafo contiene o pertenece a otra entidad, sus alumnos pueden ser los de esa entidad.
    for region in lector.regiones:
        if "itemscope" not in region.atributos:
            continue
        if not (bloque.ruta + "/").startswith(region.ruta + "/") and not region.ruta.startswith(bloque.ruta + "/"):
            continue
        tipos = (region.atributos.get("itemtype") or "").split()
        identidad = region.atributos.get("itemid")
        curso = {"Course", "http://schema.org/Course", "https://schema.org/Course"}.intersection(tipos)
        if not curso or not identidad:
            return False
        try:
            direccion = urldefrag(urljoin(lector.canonical[0], identidad)).url
        except ValueError:
            return False
        if direccion != lector.canonical[0]:
            return False
    return True


def extraer_ficha(cuerpo: bytes, metadatos: Mapping[str, object], *, url_esperada: str) -> FichaAcademy:
    """Extrae evidencia íntegra de una captura verificada, sin clasificar ni activar cursos.

    Returns:
        Identidad, contenido ordenado, enlaces y evidencia de requisitos/destinatarios cuando se identifica.

    Raises:
        ErrorFichaAcademy: Si faltan integridad, cierre HTML, identidad o una codificación interpretable.
    """
    archivo, fecha, huella = _verificar_captura(cuerpo, metadatos, url_esperada)
    lector = _Lector()
    try:
        lector.feed(cuerpo.decode("utf-8"))
        lector.close()
    except UnicodeError as error:
        raise ErrorFichaAcademy("La captura no es HTML UTF-8 interpretable") from error
    _exigir({"main", "body", "html"} <= lector.cierres and not lector.pila, "Documento HTML sin cierre completo")
    identidad, titulo, documento = _identidad(lector, url_esperada)
    bloques = sorted(lector.bloques, key=lambda b: (b.inicio, -b.fin))
    enlaces = tuple(
        EnlaceAcademy(_plano("".join(lector.fragmentos[b.inicio : b.fin])), b.atributos["href"], _localizador(b))
        for b in bloques
        if b.tag == "a" and b.atributos.get("href")
    )
    evidencias = tuple(
        _evidencia(_plano("".join(lector.fragmentos[b.inicio : b.fin])), b) for b in bloques if b.tag != "a"
    )
    return FichaAcademy(
        id=identidad,
        url=url_esperada,
        titulo=titulo,
        titulo_documento=documento,
        archivo=archivo,
        capturado_utc=fecha,
        sha256_captura=huella,
        bytes_captura=len(cuerpo),
        contenido=_contenido(lector.fragmentos),
        bloques=evidencias,
        enlaces=enlaces,
        requisitos=_hechos(lector, REQUISITOS, REQUISITO_EN_PARRAFO),
        destinatarios=_hechos(lector, DESTINATARIOS, DESTINATARIO_EN_PARRAFO) or _destinatarios_de_descripcion(lector),
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
