"""Lee el HTML de una página: su texto visible, su título y los datos que trae para pintarse en el navegador.

No ejecuta nada: recorre el marcado con el analizador de la biblioteca estándar, que lee hasta donde puede un HTML
roto, porque una página mal formada sigue siendo una observación.
"""

import re
from dataclasses import dataclass
from html import unescape
from html.parser import HTMLParser

# Lo que hay dentro de estas etiquetas no es texto que lea una persona.
ETIQUETAS_OCULTAS = frozenset({"script", "style", "noscript", "template", "svg", "head"})
# Al abrir estas etiquetas empieza una línea nueva en el texto visible.
ETIQUETAS_DE_BLOQUE = frozenset({"br", "p", "div", "li", "h1", "h2", "h3", "h4", "tr", "section", "article"})
IDENTIFICADOR_DE_DATOS_NEXT = "__NEXT_DATA__"
CODIFICACION_POR_DEFECTO = "utf-8"
BYTES_PARA_BUSCAR_CODIFICACION = 4096
MAX_TITULO = 300


@dataclass(frozen=True, kw_only=True)
class Documento:
    """Lo que se lee de una página sin ejecutarla.

    `datos_next` es el JSON que una página Next.js incrusta en `__NEXT_DATA__`, o `None` si no lo trae.
    """

    texto: str
    titulo: str
    titulo_social: str
    scripts: int
    datos_next: str | None


class _Lector(HTMLParser):
    """Recoge el texto fuera de las etiquetas ocultas, los títulos, los `<script>` y los datos de Next.js."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.partes: list[str] = []
        self.pila: list[str] = []
        self.titulo = ""
        self.titulo_social = ""
        self.scripts = 0
        self.datos_next: list[str] | None = None
        self._en_titulo = False
        self._en_datos_next = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        atributos = dict(attrs)
        if tag == "title":
            self._en_titulo = True
        if tag == "script":
            self.scripts += 1
            if atributos.get("id") == IDENTIFICADOR_DE_DATOS_NEXT:
                self._en_datos_next = True
                self.datos_next = []
        if tag == "meta" and "og:title" in (atributos.get("property"), atributos.get("name")):
            self.titulo_social = atributos.get("content") or ""
        if tag in ETIQUETAS_OCULTAS:
            self.pila.append(tag)
        if tag in ETIQUETAS_DE_BLOQUE:
            self.partes.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag == "title":
            self._en_titulo = False
        if tag == "script":
            self._en_datos_next = False
        if self.pila and self.pila[-1] == tag:
            self.pila.pop()

    def handle_data(self, data: str) -> None:
        if self._en_titulo:
            self.titulo += data
        if self.pila:
            if self._en_datos_next and self.datos_next is not None:
                self.datos_next.append(data)
            return
        self.partes.append(data)

    def texto(self) -> str:
        """El texto visible con los espacios y las líneas en blanco colapsados.

        Returns:
            El texto, sin espacios de más al principio ni al final.
        """
        texto = re.sub(r"[ \t\r\f\v]+", " ", "".join(self.partes))
        return re.sub(r"\s*\n\s*", "\n", texto).strip()


def decodificar(cuerpo: bytes, tipo: str | None) -> str:
    """Decodifica el cuerpo con la codificación que declara la cabecera o, si no, la de su `<meta>`.

    Returns:
        El texto del documento; un byte que no se puede decodificar queda como carácter de sustitución.
    """
    declarada = re.search(r"charset=([\w-]+)", tipo or "", re.IGNORECASE)
    if declarada:
        codificacion = declarada.group(1)
    else:
        en_meta = re.search(
            rb"<meta[^>]+charset=[\"']?([\w-]+)", cuerpo[:BYTES_PARA_BUSCAR_CODIFICACION], re.IGNORECASE
        )
        codificacion = en_meta.group(1).decode("ascii", "replace") if en_meta else CODIFICACION_POR_DEFECTO
    try:
        return cuerpo.decode(codificacion, "replace")
    except LookupError:
        return cuerpo.decode(CODIFICACION_POR_DEFECTO, "replace")


def leer_documento(cuerpo: bytes, tipo: str | None) -> Documento:
    """Lee el cuerpo de una página.

    Returns:
        El texto visible, los títulos, el número de `<script>` y los datos de Next.js si los trae.
    """
    lector = _Lector()
    lector.feed(decodificar(cuerpo, tipo))
    lector.close()
    datos = None if lector.datos_next is None else "".join(lector.datos_next)
    return Documento(
        texto=lector.texto(),
        titulo=re.sub(r"\s+", " ", unescape(lector.titulo)).strip()[:MAX_TITULO],
        titulo_social=lector.titulo_social[:MAX_TITULO],
        scripts=lector.scripts,
        datos_next=datos,
    )
