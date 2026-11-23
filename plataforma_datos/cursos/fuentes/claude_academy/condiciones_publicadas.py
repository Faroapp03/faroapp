"""Condiciones comerciales específicas: curso, inscripción y complementos separados.

Reconoce campos/afirmaciones completos dentro de la ficha identificada. La
portada general no prevalece sobre precio o cierre propios, ni sobre una
condición comercial pertinente que no puede resolverse. No busca cualquier
mención de dinero o de «closed», ni convierte un producto práctico en matrícula.
"""

import json
import re
from dataclasses import dataclass, field
from decimal import Decimal
from html.parser import HTMLParser
from urllib.parse import urldefrag, urljoin

from plataforma_datos.cursos.fuentes.claude_academy import lector

EXTRAS = r"certificat\w*|badge|exam\w*|practic\w*|exercis\w*|hands-on|subscription|paid plan|account"
EXTRA = re.compile(r"\b(?:" + EXTRAS + r")\b", re.I)
SOLO_EXTRA = re.compile(r"\b(?:only|solely)\s+for\s+(?:(?:its|the|an?|optional)\s+)*(?:" + EXTRAS + r")\b", re.I)
CAMPO_PRECIO = re.compile(
    r"^(?P<campo>(?:(?:this|the|full|complete)\s+)*(?:(?:course|enrollment|registration)\s+)?(?:price|cost|coste|precio|preu|fee|tuition|tarifa)"
    r"(?:\s+(?:of|for)\s+(?:(?:the|this|full|complete)\s+)*course)?(?:\s+fee)?)\s*(?::|=|\bis\b)\s*(?P<valor>.+)$",
    re.I,
)
SUJETO_CURSO = re.compile(r"^(?:this|the)\s+(?:full\s+|complete\s+)?course\s+(?P<valor>.+)$", re.I)
COBRO = re.compile(
    r"^(?:costs?\b|requires? (?:a |you to )?(?:payment|pay)\b|is (?:not free|paid)\b|"
    r"(?:may|might|could|will) (?:cost|require (?:a )?(?:fee|payment)|be paid)\b)",
    re.I,
)
GRATIS = re.compile(r"(?:is )?(?:free(?: of charge)?|gratis|gratuit[oa]?)[.!]?", re.I)
PAGO = re.compile(r"(?:is (?:not free|paid)|requires? (?:a )?payment)[.!]?", re.I)
IMPORTE = re.compile(
    r"(?P<simbolo>[$€£])?\s*(?P<importe>\d+(?:[.,]\d+)?)\s*(?:euros?|dollars?|pounds?|EUR|USD|GBP)?[.!]?", re.I
)
COMERCIAL_DUDOSO = re.compile(r"^(?:pricing|tuition|fees?|price|cost|precio|preu|tarifa)\b", re.I)
INSCRIPCION = (
    r"enroll?ments?|enrolments?|registration|applications?|"
    r"inscripci[oó]n(?:es)?|inscripci[oó](?:ns)?|matr[ií]cula(?:s|es)?"
)
CAMPO_INSCRIPCION = re.compile(
    r"^(?:course\s+)?(?:"
    + INSCRIPCION
    + r")(?:\s+for\s+(?:this|the)\s+course)?(?:\s+status)?\s*(?::|=|\bis\b|\bare\b)?\s*(?P<valor>.+)$",
    re.I,
)
CERRADA = re.compile(r"(?:currently )?(?:closed|not open|cerrad[oa]s?|tancad[ae]s?)[.!]?", re.I)
ABIERTA = re.compile(r"(?:currently )?(?:open|abiert[oa]s?|obert[ae]s?)[.!]?", re.I)
CURSO_CERRADO = re.compile(r"(?:this|the) course is (?:closed|no longer available)[.!]?", re.I)
CURSO_CIERRE_DUDOSO = re.compile(r"^(?:this|the) course is (?:closed|no longer available)\b", re.I)
PARTIR = re.compile(r"(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚ])|;\s*")


@dataclass(frozen=True)
class CondicionesAcademy:
    """Estado de declaraciones, no elegibilidad, ejecución o precio de complementos."""

    precio: str
    inscripcion: str
    declaraciones: tuple[dict, ...]


@dataclass
class _MarcoComercial:
    tag: str
    ruta: str
    ajeno: bool
    hijos: dict[str, int] = field(default_factory=dict)


class _Metadatos(HTMLParser):
    """Conserva el ámbito explícito y las posiciones del texto; no atribuye entidades ajenas."""

    def __init__(self, url: str) -> None:
        super().__init__()
        self.url = url
        self.meta, self.jsonld = [], []
        self.script = None
        self.pila: list[_MarcoComercial] = []
        self.ajenos: list[str] = []
        self.texto, self.propio = [], []

    def _dentro(self, etiquetas: frozenset[str]) -> bool:
        return any(m.tag in etiquetas for m in self.pila)

    def _entidad_ajena(self, atributos: dict[str, str | None]) -> bool:
        identidad = atributos.get("itemid")
        if "itemscope" not in atributos or not identidad:
            return False
        url = urljoin(self.url, identidad)
        tipos = (atributos.get("itemtype") or "").split()
        curso = any(t in ("Course", "https://schema.org/Course", "http://schema.org/Course") for t in tipos)
        # Una ancla Course puede identificar la ficha; un producto con otra ancla es otra entidad.
        return (urldefrag(url)[0] if curso else url) != self.url

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        a = dict(attrs)
        padre = self.pila[-1] if self.pila else None
        numero = 1
        if padre:
            numero = padre.hijos.get(tag, 0) + 1
            padre.hijos[tag] = numero
        ruta = f"{padre.ruta if padre else ''}/{tag}[{numero}]"
        ajeno = bool(padre and padre.ajeno) or self._entidad_ajena(a)
        if ajeno and not (padre and padre.ajeno):
            self.ajenos.append(ruta)
        if tag in lector.SEPARADORES and self._dentro(frozenset({"main"})):
            self.texto.append("\n")
            self.propio.append("\n")
        if not ajeno and tag == "meta":
            nombre = (a.get("property") or a.get("name") or a.get("itemprop") or "").lower()
            if nombre in ("price", "product:price:amount", "course:price", "course:enrollment", "enrollmentstatus"):
                self.meta.append((nombre, a.get("content")))
        if not ajeno and tag == "script" and a.get("type") == "application/ld+json":
            self.script = ""
        if tag not in lector.VACIOS:
            self.pila.append(_MarcoComercial(tag, ruta, ajeno))

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.handle_starttag(tag, attrs)
        if tag not in lector.VACIOS:
            self.handle_endtag(tag)

    def handle_data(self, data: str) -> None:
        if self.script is not None:
            self.script += data
        if self._dentro(frozenset({"main"})) and not self._dentro(lector.IGNORADOS):
            self.texto.append(data)
            self.propio.append("".join(c if c.isspace() else " " for c in data) if self.pila[-1].ajeno else data)

    def handle_endtag(self, tag: str) -> None:
        if tag == "script" and self.script is not None:
            self.jsonld.append(self.script)
            self.script = None
        if not any(m.tag == tag for m in self.pila):
            return
        dentro = self._dentro(frozenset({"main"}))
        while self.pila:
            if self.pila.pop().tag == tag:
                break
        if dentro and tag in lector.SEPARADORES:
            self.texto.append("\n")
            self.propio.append("\n")

    def bloque_propio(self, bloque: lector.EvidenciaTexto) -> bool:
        ruta = bloque.localizador.rsplit(" (línea ", 1)[0].split()[-1]
        return not any(ruta == a or ruta.startswith(a + "/") or a.startswith(ruta + "/") for a in self.ajenos)

    def lineas_propias(self) -> list[tuple[int, str]]:
        originales = "".join(self.texto).splitlines()
        propias = "".join(self.propio).splitlines()
        resultado, posicion = [], 0
        for original, propio in zip(originales, propias, strict=True):
            if not original.strip():
                continue
            texto = " ".join(propio.split())
            if texto:
                resultado.append((posicion, texto))
            posicion += 1
        return resultado


def _precio(valor: str) -> str:
    valor = valor.strip()
    if GRATIS.fullmatch(valor):
        return "gratis"
    if PAGO.fullmatch(valor):
        return "pago"
    importe = IMPORTE.fullmatch(re.sub(r"^costs?\s+", "", valor, flags=re.I))
    if importe is not None:
        return "pago" if Decimal(importe["importe"].replace(",", ".")) > 0 else "gratis"
    return "incierto"


def _declaracion(texto: str, contexto_extra: bool) -> tuple[str, str] | None:
    sujeto = SUJETO_CURSO.fullmatch(texto)
    campo = CAMPO_PRECIO.fullmatch(texto)
    if SOLO_EXTRA.search(texto):
        return None
    explicito = (
        campo is not None
        and "course" in campo["campo"].lower()
        or sujeto is not None
        and COBRO.search(sujeto["valor"])
        or re.match(
            r"^(?:course (?:enroll?ment|registration)|(?:enroll?ment|registration) for (?:the|this) course)\b",
            texto,
            re.I,
        )
    )
    if EXTRA.search(texto) and not explicito or contexto_extra and not (explicito or sujeto):
        return None
    if campo is not None:
        return "precio", _precio(campo["valor"])
    if sujeto is not None and (COBRO.search(sujeto["valor"]) or GRATIS.fullmatch(sujeto["valor"])):
        return "precio", _precio(sujeto["valor"])
    return _control_comercial(texto) or _inscripcion_o_ambigua(texto)


def _control_comercial(texto: str) -> tuple[str, str] | None:
    precio_directo = re.match(r"^(?:enroll?|enrol|register) for ([\d$€£].*)$", texto, re.I)
    if precio_directo is not None:
        return "precio", _precio(precio_directo[1])
    compra = re.match(r"^(?:buy|purchase) (?:now|(?:the |this |full |complete )?course)\b", texto, re.I)
    acceso = re.match(r"^(?:enroll?|enrol|register|access|take)(?: in| for| to)? (?:the |this )?course\b", texto, re.I)
    pago = re.search(r"\b(?:fee|payment|pay|purchase)\b|[$€£]|\d+\s*(?:EUR|USD|euros?|dollars?)", texto, re.I)
    return ("precio", "incierto") if compra or acceso and pago else None


def _inscripcion_o_ambigua(texto: str) -> tuple[str, str] | None:
    if CURSO_CERRADO.fullmatch(texto):
        return "inscripcion", "cerrada"
    if CURSO_CIERRE_DUDOSO.search(texto):
        return "inscripcion", "incierta"
    inscripcion = CAMPO_INSCRIPCION.fullmatch(texto)
    if inscripcion is not None:
        return "inscripcion", _estado_inscripcion(inscripcion["valor"])
    return ("precio", "incierto") if COMERCIAL_DUDOSO.search(texto) else None


def _estado_inscripcion(valor: str | None) -> str:
    return (
        "cerrada"
        if valor is not None and CERRADA.fullmatch(valor)
        else "abierta"
        if valor is not None and ABIERTA.fullmatch(valor)
        else "incierta"
    )


def _actualizar_contexto(niveles: dict, nivel: int, texto: str) -> dict:
    anteriores = {n: v for n, v in niveles.items() if n < nivel}
    heredado = next(reversed(anteriores.values()), False)
    anteriores[nivel] = False if re.search(r"\bcourse\b", texto, re.I) else True if EXTRA.search(texto) else heredado
    return anteriores


ETIQUETA_PRECIO = re.compile(
    r"(?:course |tuition |enrollment |registration )?(?:price|fee|cost|precio|preu)(?: fee)?[:\s]*", re.I
)
ETIQUETA_INSCRIPCION = re.compile(r"(?:course )?(?:" + INSCRIPCION + r")(?: status)?[:\s]*", re.I)


def _lineas_visibles(
    bloques: tuple[lector.EvidenciaTexto, ...], lineas: list[tuple[int, str]]
) -> list[tuple[str, str, str, str]]:
    cabeceras = {b.texto: int(b.tipo[1]) for b in bloques if re.fullmatch(r"h[1-6]", b.tipo)}
    niveles, resultado, pendiente = {}, [], None
    for i, linea in lineas:
        linea = linea.strip()
        if linea in cabeceras:
            niveles = _actualizar_contexto(niveles, cabeceras[linea], linea)
        extra = next(reversed(niveles.values()), False)
        if pendiente is not None:
            campo, etiqueta, posicion = pendiente
            valor = _precio(linea) if campo == "precio" else _estado_inscripcion(linea)
            resultado.append((campo, valor, etiqueta + "\n" + linea, f"main, líneas de texto {posicion + 1}-{i + 1}"))
            pendiente = None
            continue
        if not extra and (ETIQUETA_PRECIO.fullmatch(linea) or ETIQUETA_INSCRIPCION.fullmatch(linea)):
            pendiente = ("precio" if ETIQUETA_PRECIO.fullmatch(linea) else "inscripcion", linea, i)
            continue
        declaracion = _declaracion(linea, extra)
        if declaracion is not None:
            resultado.append((*declaracion, linea, f"main, línea de texto {i + 1}"))
    if pendiente is not None:
        campo, literal, posicion = pendiente
        resultado.append(
            (campo, "incierto" if campo == "precio" else "incierta", literal, f"main, línea de texto {posicion + 1}")
        )
    return resultado


def _resolver(valores: set[str], inicial: str, desconocido: str) -> str:
    if not valores:
        return inicial
    if desconocido in valores or len(valores) > 1:
        return desconocido
    return next(iter(valores))


def _ofertas_jsonld(dato: object, ficha: lector.FichaAcademy) -> list[tuple[str, str]]:
    if isinstance(dato, list):
        return [r for x in dato for r in _ofertas_jsonld(x, ficha)]
    if not isinstance(dato, dict):
        return []
    salida = _curso_jsonld(dato, ficha)
    if "@graph" in dato:
        salida.extend(_ofertas_jsonld(dato["@graph"], ficha))
    return salida


def _curso_jsonld(dato: dict, ficha: lector.FichaAcademy) -> list[tuple[str, str]]:
    salida = []
    tipos = dato.get("@type")
    tipos = [tipos] if isinstance(tipos, str) else tipos
    if isinstance(tipos, list) and any(
        t in ("Course", "schema:Course", "https://schema.org/Course", "http://schema.org/Course") for t in tipos
    ):
        identidad = dato.get("url", dato.get("@id"))
        identificada = isinstance(identidad, str) and urldefrag(identidad)[0] == ficha.url
        identificada = identificada or identidad is None and dato.get("name") == ficha.titulo
        ofertas = dato.get("offers")
        if ofertas is not None:
            ofertas = ofertas if isinstance(ofertas, list) else [ofertas]
            for oferta in ofertas:
                if isinstance(identidad, str) and not identificada:
                    continue
                if not identificada or not isinstance(oferta, dict):
                    salida.append(("precio", "incierto"))
                    continue
                salida.extend(_oferta(oferta))
        gratuito = dato.get("isAccessibleForFree")
        if gratuito is not None and identificada:
            salida.append(("precio", "gratis" if gratuito is True else "incierto"))
    return salida


def _oferta(oferta: dict) -> list[tuple[str, str]]:
    salida = []
    if not {"price", "availability", "category"} & set(oferta):
        salida.append(("precio", "incierto"))
    if "category" in oferta:
        salida.append(
            (
                "precio",
                "gratis" if oferta["category"] == "Free" else "pago" if oferta["category"] == "Paid" else "incierto",
            )
        )
    if "price" in oferta:
        salida.append(("precio", _precio(str(oferta["price"]))))
    disponibilidad = oferta.get("availability")
    if disponibilidad is not None:
        literal = str(disponibilidad).rsplit("/", 1)[-1]
        salida.append(
            (
                "inscripcion",
                "cerrada"
                if literal in ("OutOfStock", "Discontinued", "SoldOut")
                else "abierta"
                if literal in ("InStock", "LimitedAvailability")
                else "incierta",
            )
        )
    return salida


def examinar(cuerpo: bytes, ficha: lector.FichaAcademy) -> CondicionesAcademy:
    """Une condiciones propias; una contradicción conserva incertidumbre y su evidencia.

    Returns:
        Precio/inscripción con declaraciones literales y localizadores, sin tocar originales.
    """
    pagina = _Metadatos(ficha.url)
    pagina.feed(cuerpo.decode("utf-8"))
    pagina.close()
    bloques = tuple(b for b in ficha.bloques if pagina.bloque_propio(b))
    precios, inscripciones, declaraciones = set(), set(), []

    def anotar(campo: str, valor: str, literal: str, localizador: str) -> None:
        (precios if campo == "precio" else inscripciones).add(valor)
        if any(d["campo"] == campo and d["interpretacion"] == valor and d["literal"] == literal for d in declaraciones):
            return
        declaraciones.append({"campo": campo, "interpretacion": valor, "literal": literal, "localizador": localizador})

    niveles = {}
    for bloque in bloques:
        if re.fullmatch(r"h[1-6]", bloque.tipo):
            nivel = int(bloque.tipo[1])
            niveles = _actualizar_contexto(niveles, nivel, bloque.texto)
            continue
        contexto_extra = next(reversed(niveles.values()), False)
        for texto in PARTIR.split(bloque.texto):
            declaracion = _declaracion(texto.strip(), contexto_extra)
            if declaracion is not None:
                anotar(*declaracion, texto.strip(), bloque.localizador)
    for campo, valor, literal, localizador in [
        *_lineas_visibles(bloques, pagina.lineas_propias()),
        *_metadatos(pagina, ficha),
    ]:
        anotar(campo, valor, literal, localizador)
    return CondicionesAcademy(
        _resolver(precios, "sin_declaracion", "incierto"),
        _resolver(inscripciones, "sin_declaracion", "incierta"),
        tuple(declaraciones),
    )


def _pares(pares: list[tuple[str, object]]) -> dict:
    resultado = {}
    for clave, valor in pares:
        if clave in resultado:
            raise ValueError("Clave JSON-LD repetida")
        resultado[clave] = valor
    return resultado


def _metadatos(pagina: _Metadatos, ficha: lector.FichaAcademy) -> list[tuple[str, str, str, str]]:
    resultado = []
    for nombre, valor in pagina.meta:
        campo = "inscripcion" if nombre in ("course:enrollment", "enrollmentstatus") else "precio"
        estado = (
            _estado_inscripcion(valor)
            if campo == "inscripcion"
            else _precio(valor)
            if valor is not None
            else "incierto"
        )
        resultado.append((campo, estado, valor or "", f'meta[name/property/itemprop="{nombre}"]'))
    for i, texto in enumerate(pagina.jsonld):
        localizador = f'script[type="application/ld+json"] número {i + 1}'
        try:
            dato = json.loads(texto, object_pairs_hook=_pares)
        except ValueError:
            if re.search(r'"(?:price|offers|availability|isAccessibleForFree)"\s*:', texto):
                resultado.append(("precio", "incierto", texto, localizador))
        else:
            resultado.extend((campo, valor, texto, localizador) for campo, valor in _ofertas_jsonld(dato, ficha))
    return resultado
