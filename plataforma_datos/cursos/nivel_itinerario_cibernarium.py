"""Orientación por progresión en un itinerario publicado y vinculado a la ficha."""

import hashlib
import re
import unicodedata
from html.parser import HTMLParser

from plataforma_datos.cursos.fuentes.barcelonactiva.ficha_edicion import _texto
from plataforma_datos.cursos.fuentes.barcelonactiva.idiomas_edicion import _FichaIdiomas
from plataforma_datos.cursos.nivel_sugerencias_cibernarium import NEGACION_ACCION

VERSION = "cibernarium-itinerario-v1"
VERSION_TAREAS = "cibernarium-ficha-tareas-v1"
MINIMO_ETAPAS = 2
VACIOS = frozenset(
    {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}
)


def _normalizar(texto: str) -> str:
    texto = "".join(c for c in unicodedata.normalize("NFKD", texto.casefold()) if not unicodedata.combining(c))
    texto = re.sub(r"\bnivell?\s*\d+\b", " ", texto)
    return re.sub(r"[^a-z0-9]+", " ", texto).strip()


class _Itinerarios(HTMLParser):
    """Lee solo cajas anidadas en el bloque contiguo al título del itinerario."""

    def __init__(self) -> None:
        super().__init__()
        self.profundidad = 0
        self.parrafo = None
        self.pendiente = False
        self.contenedor = None
        self.caja = None
        self.cajas = []
        self.itinerarios = []
        self.objetivo = None
        self.texto_objetivos = []
        self.ignorado = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in VACIOS:
            return
        self.profundidad += 1
        clases = set((dict(attrs).get("class") or "").split())
        if tag == "div" and "objectius-content" in clases and self.objetivo is None:
            self.objetivo = self.profundidad
        if tag in ("style", "script"):
            self.ignorado = self.profundidad
        if tag == "p" and "section-title" in clases and self.contenedor is None:
            self.parrafo = [self.profundidad, ""]
        if tag == "div" and "flex-container" in clases and self.pendiente and self.contenedor is None:
            self.contenedor, self.pendiente = self.profundidad, False
            self.cajas = []
        if self.contenedor is not None and "box" in clases and self.caja is None:
            self.caja = [self.profundidad, ""]

    def handle_data(self, datos: str) -> None:
        if self.objetivo is not None and self.ignorado is None:
            self.texto_objetivos.append(datos)
        if self.parrafo is not None:
            self.parrafo[1] += " " + datos
        if self.caja is not None:
            self.caja[1] += " " + datos

    def handle_endtag(self, tag: str) -> None:
        if tag in VACIOS:
            return
        if self.ignorado == self.profundidad:
            self.ignorado = None
        if self.objetivo == self.profundidad and tag == "div":
            self.objetivo = None
        if self.parrafo is not None and self.parrafo[0] == self.profundidad and tag == "p":
            self.pendiente = "itinerari formatiu" in _normalizar(self.parrafo[1])
            self.parrafo = None
        if self.caja is not None and self.caja[0] == self.profundidad:
            self.cajas.append(self.caja[1])
            self.caja = None
        if self.contenedor == self.profundidad and tag == "div":
            self.itinerarios.append(self.cajas)
            self.contenedor = None
        self.profundidad -= 1


def _tareas_html(texto: str) -> dict | None:
    # Solo términos conjuntos en el bloque publicado de objetivos y temario, no en la página completa.
    if NEGACION_ACCION.search(texto):
        return None
    texto = _normalizar(texto)
    reglas = (
        ("inicial", ("aprendre a crear gifs animats", "crear i publicar un mem")),
        ("intermedio", ("bases de coneixement", "llistes de tasques", "planificacio i seguiment de projectes")),
        ("intermedio", ("crear i administrar anuncis", "informes de campanyes", "fonaments de la publicitat")),
        ("intermedio", ("que son els algorismes", "fonaments i objectius", "estrategies mes adequades")),
        ("intermedio", ("tipologies dels textos", "auditoria i millora de continguts", "aplicacio practica")),
    )
    niveles = {nivel for nivel, frases in reglas if all(frase in texto for frase in frases)}
    if len(niveles) != 1:
        return None
    return {"valor": next(iter(niveles)), "version": VERSION_TAREAS, "localizador": "objectius-content"}


def orientar(cuerpo: bytes, *, actividad_id: str, titulo: str) -> dict | None:
    """Identifica el título propio y un paso anterior inequívoco en la misma lista.

    Returns:
        Orientación intermedia por continuidad, no un nivel oficial ni requisito previo.
    """
    pagina = _FichaIdiomas()
    texto = cuerpo.decode("utf-8")
    pagina.feed(texto)
    pagina.close()
    url = f"https://cibernarium.barcelonactiva.cat/ca/formacio?activityId={actividad_id}"
    if pagina.urls != {url} or pagina.titulos != {_texto(titulo)}:
        return None
    parser = _Itinerarios()
    parser.feed(texto)
    parser.close()
    objetivo = _normalizar(titulo)
    candidatas = []
    for numero_itinerario, itinerario in enumerate(parser.itinerarios, start=1):
        niveles = []
        for caja in itinerario:
            match = re.match(r"\s*Nivell\s+(\d+)\s+(.*)", caja, re.IGNORECASE | re.DOTALL)
            if match:
                niveles.append((int(match[1]), _normalizar(match[2])))
        posiciones = [i for i, (_, nombre) in enumerate(niveles) if nombre == objetivo]
        if posiciones:
            candidatas.append((numero_itinerario, niveles, posiciones))
    if not candidatas:
        return _tareas_html(" ".join(parser.texto_objetivos))
    if len(candidatas) != 1:
        return None
    numero_itinerario, niveles, posiciones = candidatas[0]
    if len(posiciones) != 1 or len(niveles) < MINIMO_ETAPAS:
        return None
    posicion = posiciones[0]
    numeros = [x[0] for x in niveles]
    if posicion == 0 or any(a >= b for a, b in zip(numeros, numeros[1:], strict=False)):
        return None
    return {
        "valor": "intermedio",
        "version": VERSION,
        "localizador": f"itinerario/{numero_itinerario}/caja/{posicion + 1}",
    }


def aplicar(colecciones: dict, referencias: dict) -> None:
    """Proyecta solo evidencia de ficha propia referenciada, sin distribuir su cuerpo."""
    programas = {p["id"]: p for p in colecciones["unidades"] if p["proveedor_id"] == "cibernarium"}
    for edicion in colecciones["ediciones"]:
        programa = programas.get(edicion["programa_id"])
        if not programa:
            continue
        id = programa["id"].removeprefix("cibernarium:")
        url = f"https://cibernarium.barcelonactiva.cat/ca/formacio?activityId={id}"
        refs = [r for r in edicion.get("referencias", []) if r["url"] == url]
        refs.sort(key=lambda r: r["fecha_referencia"], reverse=True)
        if not refs:
            continue
        ref = refs[0]
        if any(r["fecha_referencia"] == ref["fecha_referencia"] and r["sha256"] != ref["sha256"] for r in refs[1:]):
            continue
        fuente = referencias.get(ref["sha256"])
        if fuente is None:
            continue
        cuerpo = fuente.ruta.read_bytes()
        if hashlib.sha256(cuerpo).hexdigest() != ref["sha256"]:
            continue
        try:
            nivel = orientar(cuerpo, actividad_id=id, titulo=programa["titulo"])
        except (UnicodeDecodeError, ValueError):
            continue
        if nivel:
            edicion["nivel_itinerario"] = {
                **nivel,
                "unidad_id": edicion["id"],
                "programa_id": programa["id"],
                "titulo": programa["titulo"],
                "url": ref["url"],
                "sha256": ref["sha256"],
            }
