"""Índice, declaración y lección públicos de Academy, con alcances separados.

Leer una lección no acredita el curso completo. La declaración general del
proveedor y la ficha individual se conservan como pruebas distintas; vídeo,
prácticas, progreso y acreditaciones no se comprueban por este lector.
"""

import re
import unicodedata
from collections.abc import Mapping
from dataclasses import dataclass
from urllib.parse import urljoin, urlsplit

from plataforma_datos.cursos.fuentes.claude_academy import lector

ORIGEN = "https://academy.claude.com"
INDICE = ORIGEN + "/courses"
PORTADA = ORIGEN + "/"
LECCION = re.compile(r"/courses/([a-z0-9]+(?:-[a-z0-9]+)*)/([a-z0-9]+(?:-[a-z0-9]+)*)")
DECLARACION = (
    "Learn to use AI safely, effectively, and with intention. "
    "Free courses, tutorials, and use cases from Anthropic’s education team."
)
RESUMEN_GRATUIDAD = "Free courses on Claude and AI, from Anthropic."
MAX_CURSOS = 500
PRECIO = re.compile(r"\b(?:free|paid|payments?|pricing|prices?|costs?|fees?|charges?|charged|tuition)\b", re.I)
FORMACION = re.compile(r"\b(?:courses?|enrol{1,2}ment|registration|tuition)\b", re.I)


@dataclass(frozen=True, kw_only=True)
class IndiceAcademy:
    """Enlaces presentes en una página cerrada; la ausencia no acredita retirada."""

    urls: tuple[str, ...]
    capturado_utc: str
    sha256: str
    archivo: str


@dataclass(frozen=True, kw_only=True)
class LeccionAcademy:
    """Texto público de una lección concreta; no garantía del curso completo."""

    curso_id: str
    url: str
    titulo: str
    contenido: str
    bloques: tuple[lector.EvidenciaTexto, ...]
    capturado_utc: str
    sha256: str
    archivo: str


def _documento(cuerpo: bytes, meta: Mapping[str, object], url: str) -> tuple[lector._Lector, tuple[str, str, str]]:
    prueba = lector._verificar_captura(cuerpo, meta, url)
    pagina = lector._Lector()
    try:
        pagina.feed(cuerpo.decode("utf-8"))
        pagina.close()
    except UnicodeError as error:
        raise lector.ErrorFichaAcademy("Página no interpretable como HTML UTF-8") from error
    lector._exigir(
        {"main", "body", "html"} <= pagina.cierres and not pagina.pila,
        "Página sin cierre HTML íntegro",
    )
    lector._exigir(pagina.canonical == [url], "Canonical ausente, repetido o ajeno")
    lector._exigir(all(u == url for u in pagina.identidades), "og:url ajeno")
    lector._exigir(all(p == urlsplit(url).path for p in pagina.rutas_de_curso), "Identidad prerender ajena")
    return pagina, prueba


def _titulo(pagina: lector._Lector) -> str:
    h1 = [b for b in pagina.bloques if b.tag == "h1"]
    lector._exigir(len(h1) == 1, "Falta un título h1 inequívoco")
    return lector._plano("".join(pagina.fragmentos[h1[0].inicio : h1[0].fin]))


def extraer_indice(cuerpo: bytes, meta: Mapping[str, object]) -> IndiceAcademy:
    """Lee enlaces nativos, sin declarar que la página constituye un censo global.

    Returns:
        Identidades enlazadas y prueba exacta de su aparición en el índice.
    """
    pagina, (archivo, fecha, sha) = _documento(cuerpo, meta, INDICE)
    lector._exigir(_titulo(pagina) == "Courses" and pagina.titulos == ["Courses · Claude Academy"], "Índice ajeno")
    urls = set()
    for bloque in pagina.bloques:
        if bloque.tag != "a" or not bloque.atributos.get("href"):
            continue
        url = urljoin(INDICE, bloque.atributos["href"])
        partes = urlsplit(url)
        if (
            partes.scheme == "https"
            and partes.netloc == lector.HOST_ACADEMY
            and lector.PATRON_CURSO.fullmatch(partes.path)
            and not partes.query
            and not partes.fragment
        ):
            urls.add(url)
    lector._exigir(0 < len(urls) <= MAX_CURSOS, "Índice vacío o excesivo: no acredita ausencias")
    return IndiceAcademy(urls=tuple(sorted(urls)), capturado_utc=fecha, sha256=sha, archivo=archivo)


def declaracion_gratuidad(cuerpo: bytes, meta: Mapping[str, object]) -> lector.EvidenciaTexto | None:
    """Reconoce una declaración completa del proveedor, sin buscar una mera subcadena.

    Returns:
        Declaración general o resumen público reconocido, con su texto literal.
        El resumen requiere una declaración de precio en la ficha del curso.
        No acredita precio de prácticas, productos, certificados o admisión personal.
    """
    pagina, _prueba = _documento(cuerpo, meta, PORTADA)
    bloques = [
        lector._evidencia(lector._plano("".join(pagina.fragmentos[b.inicio : b.fin])), b)
        for b in pagina.bloques
        if b.tag == "p"
    ]
    precios_formacion = [b for b in bloques if PRECIO.search(b.texto) and FORMACION.search(b.texto)]
    if any(b.texto not in (DECLARACION, RESUMEN_GRATUIDAD) for b in precios_formacion):
        return None
    return next(
        (b for b in precios_formacion if b.texto == DECLARACION), precios_formacion[0] if precios_formacion else None
    )


def _numero_de_entradas(pagina: lector._Lector, titulo: str) -> tuple[int, str] | None:
    patron = re.compile(
        r"Show course lessons\. "
        + re.escape(titulo)
        + r" — ([1-9]\d{0,3}) lessons?(?: · ([1-9]\d{0,3}) (?:quiz|quizzes))?"
    )
    botones = [
        (m, lector._localizador(b))
        for b in pagina.bloques
        if b.tag == "button"
        and (m := patron.fullmatch(b.atributos.get("aria-label") or ""))
        and pagina.disponible(b)
        and lector._parrafo_del_curso(pagina, b)
    ]
    if len(botones) != 1:
        return None
    cuenta, selector = botones[0]
    return int(cuenta[1]) + int(cuenta[2] or 0), selector


def _destinos_del_temario(pagina: lector._Lector, temario: lector._Bloque, url: str) -> set[str]:
    destinos = set()
    for b in pagina.bloques:
        if b.tag != "a" or not b.ruta.startswith(temario.ruta + "/"):
            continue
        href = b.atributos.get("href")
        if not href or not pagina.disponible(b):
            return set()
        try:
            destino = urljoin(url, href)
        except ValueError:
            return set()
        if not re.fullmatch(re.escape(url) + r"/[a-z0-9]+(?:-[a-z0-9]+)*", destino):
            return set()
        texto = lector._plano("".join(pagina.fragmentos[b.inicio : b.fin]))
        etiqueta = "".join(c for c in texto if unicodedata.category(c) != "Co").strip()
        if (destino, etiqueta) in (
            (url + "/badge", "Completion badge"),
            (url + "/complete", "Course complete"),
        ):
            continue
        if not etiqueta or destino in destinos:
            return set()
        destinos.add(destino)
    return destinos


def temario_publicado(
    cuerpo: bytes, meta: Mapping[str, object], ficha: lector.FichaAcademy, inicio: lector.EnlaceAcademy
) -> tuple[str, ...]:
    """Acredita el temario que ofrece la ficha con la cuenta y los enlaces del mismo curso.

    Returns:
        Localizadores del recuento y el programa si coinciden, o una tupla vacía ante una duda.
    """
    pagina, _ = _documento(cuerpo, meta, ficha.url)
    cuenta = _numero_de_entradas(pagina, ficha.titulo)
    temarios = [r for r in pagina.regiones if r.tag == "nav" and r.atributos.get("aria-label") == "Course outline"]
    if cuenta is None or len(temarios) != 1:
        return ()
    if not pagina.disponible(temarios[0]) or not lector._parrafo_del_curso(pagina, temarios[0]):
        return ()
    temario = temarios[0]
    destinos = _destinos_del_temario(pagina, temario, ficha.url)
    if len(destinos) != cuenta[0] or inicio.href not in destinos:
        return ()
    return cuenta[1], lector._localizador(temario)


def enlace_inicio(ficha: lector.FichaAcademy) -> lector.EnlaceAcademy | None:
    """Exige Start course y un destino del mismo curso; no abre ni sigue el enlace.

    Returns:
        Enlace inequívoco conservado, o None para declaraciones ausentes o distintas.
    """
    enlaces = {}
    for enlace in ficha.enlaces:
        texto = "".join(c for c in enlace.texto if unicodedata.category(c) != "Co").strip()
        if texto != "Start course":
            continue
        try:
            url = urljoin(ficha.url, enlace.href)
            partes = urlsplit(url)
        except ValueError:
            continue
        ruta = LECCION.fullmatch(partes.path)
        if (
            partes.scheme == "https"
            and partes.netloc == lector.HOST_ACADEMY
            and ruta
            and ruta[1] == ficha.id
            and not partes.query
            and not partes.fragment
        ):
            enlaces[url] = lector.EnlaceAcademy(enlace.texto, url, enlace.localizador)
    return next(iter(enlaces.values())) if len(enlaces) == 1 else None


def extraer_leccion(cuerpo: bytes, meta: Mapping[str, object], *, ficha: lector.FichaAcademy) -> LeccionAcademy:
    """Contrasta texto didáctico de la lección enlazada; HTTP200 genérico no basta.

    Returns:
        Identidad, contenido y localizadores del artículo de esa primera lección.

    Raises:
        lector.ErrorFichaAcademy: Si falta vínculo, identidad, artículo o cierre íntegro.
    """
    enlace = enlace_inicio(ficha)
    lector._exigir(enlace is not None, "Ficha sin inicio público inequívoco")
    pagina, (archivo, fecha, sha) = _documento(cuerpo, meta, enlace.href)
    titulo = _titulo(pagina)
    lector._exigir(
        pagina.titulos == [titulo + " · " + ficha.titulo + " · Claude Academy"],
        "Lección y curso no coinciden",
    )
    bloques = tuple(
        lector._evidencia(lector._plano("".join(pagina.fragmentos[b.inicio : b.fin])), b)
        for b in sorted(pagina.bloques, key=lambda b: (b.inicio, -b.fin))
        if "/article[" in b.ruta
        and b.tag in {"p", "li", "h2", "h3"}
        and lector._plano("".join(pagina.fragmentos[b.inicio : b.fin]))
    )
    lector._exigir(any(b.tipo in ("p", "li") for b in bloques), "Sin texto didáctico público de la lección")
    return LeccionAcademy(
        curso_id=ficha.id,
        url=enlace.href,
        titulo=titulo,
        contenido="\n".join(b.texto for b in bloques),
        bloques=bloques,
        capturado_utc=fecha,
        sha256=sha,
        archivo=archivo,
    )
