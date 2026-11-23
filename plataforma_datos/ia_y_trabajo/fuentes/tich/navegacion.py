"""Localiza por su título, en INEbase, las tablas de una edición de la TIC-H que el lector usa.

Cada edición trae números de tabla y de capítulo nuevos, así que no se fijan: se navega desde el catálogo de la
operación por los títulos que el INE da a cada paso, y cada paso exige una sola coincidencia. Del bloque «Resultados
año AAAA» del catálogo se va al capítulo de los resultados nacionales «Uso de productos TIC por las personas de 16 a 74
años» y al de «Errores de muestreo»; del primero, al subcapítulo «Inteligencia Artificial Generativa», y de los
índices, a la tabla de uso y a la de errores por su título. Cada tabla tiene que ser de ese año: su entrada del índice
la sitúa en la operación del año (`data-path` con `TICH<año>_`) y declara el mismo número que su enlace. Del enlace
«Metodología y Cuestionarios» del catálogo se va a su página, y en sus selectores «Metodología» y «Cuestionarios», a la
opción de ese año: la dirección del PDF de la metodología y la del cuestionario, que tienen que ser PDF del INE. Lo
encontrado queda con la dirección y la huella de cada página consultada.

Si un paso no se puede dar, la navegación se detiene con un motivo cerrado (`MOTIVOS`) y su detalle, y la fuente
conserva la edición admitida: un fallo de red al consultar un índice tampoco tumba la consulta.
"""

import re
from collections.abc import Callable, Mapping
from html.parser import HTMLParser
from typing import Any, Literal, NamedTuple, TypedDict
from urllib.parse import parse_qs, urljoin, urlsplit

from plataforma_datos.comun import red
from plataforma_datos.comun.entrada_salida import sha256_bytes
from plataforma_datos.comun.nucleo import FormatoInesperado
from plataforma_datos.ia_y_trabajo.fuentes.tich.constantes import CSV_INE
from plataforma_datos.ia_y_trabajo.fuentes.tich.edicion_nueva import PENDIENTE

SITIO = "https://www.ine.es"
SECCION_NACIONAL = "RESULTADOS NACIONALES"
CAPITULO_PERSONAS = "Uso de productos TIC por las personas de 16 a 74 años"
CAPITULO_ERRORES = "Errores de muestreo"
SUBCAPITULO_IA = "Inteligencia Artificial Generativa"
TITULO_USO = (
    "Uso de alguna herramienta de Inteligencia Artificial Generativa en los últimos 3 meses por características "
    "socioeconómicas"
)
TITULO_ERRORES = (
    "Errores estándar relativos a la utilización de TIC y a la incidencia del teletrabajo por las personas de 16 a 74 "
    "años por Comunidades y Ciudades Autónomas y principales usos de TIC"
)
INDICE = "/dynt3/inebase/index.htm"
TABLA = "/jaxi/Tabla.htm"
ENLACE_METODOLOGIA = "Metodología y Cuestionarios"
PAGINA_INEBASE = "/dyngs/INEbase/es/operacion.htm"
# El rótulo de cada selector de la página de metodología y la forma de la dirección de sus PDF.
SELECTORES = {"metodologia": "Metodología:", "cuestionario": "Cuestionarios:"}
RUTA_PDF = re.compile(r"/metodologia/t25/[A-Za-z0-9_]+\.pdf")
type Motivo = Literal[
    "sin-coincidencia", "varias-coincidencias", "otro-anio", "fuera-de-inebase", "redireccion", "pagina-no-utf8", "red"
]
MOTIVOS: tuple[Motivo, ...] = (
    "sin-coincidencia",
    "varias-coincidencias",
    "otro-anio",
    "fuera-de-inebase",
    "redireccion",
    "pagina-no-utf8",
    "red",
)


class NavegacionDetenida(FormatoInesperado):
    """Un paso de la navegación no se puede dar: lleva su motivo cerrado y el detalle."""

    def __init__(self, motivo: Motivo, detalle: str) -> None:
        super().__init__(f"TIC-H: {detalle}")
        self.motivo: Motivo = motivo
        self.detalle = detalle


class Pagina(TypedDict):
    """Una página consultada al navegar: su dirección y la huella de sus bytes."""

    url: str
    sha256: str


class TablaEncontrada(TypedDict):
    """Una tabla localizada por su título: su número, su título y la dirección de su CSV."""

    tabla: str
    titulo: str
    url: str


class DocumentosEncontrados(TypedDict):
    """La dirección del PDF de la metodología y la del cuestionario de una edición."""

    metodologia: str
    cuestionario: str


class Navegacion(TypedDict):
    """Las tablas y los documentos de una edición localizados desde el catálogo, con las páginas recorridas."""

    anio: str
    uso: TablaEncontrada
    errores: TablaEncontrada
    documentos: DocumentosEncontrados
    paginas: list[Pagina]


class Enlace(NamedTuple):
    """Un enlace con su texto, su bloque de año y su sección, y la entrada de tabla del índice que lo contiene."""

    url: str
    texto: str
    anio: str
    seccion: str
    tpx: str
    ruta: str


class _Enlaces(HTMLParser):
    """Los enlaces de una página del INE con su texto, su bloque de año, su sección y su entrada de tabla.

    El bloque de año es el del último párrafo «Resultados año AAAA»; la sección, el último rótulo que no es enlace
    (`<span>` fuera de un `<a>`), como «RESULTADOS NACIONALES»; la entrada de tabla, el último `<li>` con `data-tpx`.
    """

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.enlaces: list[Enlace] = []
        self.anio = ""
        self.seccion = ""
        self.tpx = ""
        self.ruta = ""
        self.href: str | None = None
        self.texto: list[str] = []
        self.parrafo: list[str] | None = None
        self.rotulo: list[str] | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        atributos = dict(attrs)
        if tag == "a":
            self.href = atributos.get("href") or ""
            self.texto = []
        elif tag == "p":
            self.parrafo = []
        elif tag == "span" and self.href is None:
            self.rotulo = []
        elif tag == "li" and "data-tpx" in atributos:
            self.tpx, self.ruta = atributos.get("data-tpx") or "", atributos.get("data-path") or ""

    def handle_data(self, data: str) -> None:
        for destino in (self.texto if self.href is not None else None, self.parrafo, self.rotulo):
            if destino is not None:
                destino.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag == "a" and self.href is not None:
            self.enlaces.append(Enlace(self.href, _limpio(self.texto), self.anio, self.seccion, self.tpx, self.ruta))
            self.href = None
        elif tag == "p" and self.parrafo is not None:
            rotulo = _limpio(self.parrafo)
            if rotulo.startswith("Resultados año "):
                self.anio = rotulo.removeprefix("Resultados año ")
            self.parrafo = None
        elif tag == "span" and self.rotulo is not None:
            self.seccion = _limpio(self.rotulo)
            self.rotulo = None
        elif tag == "li":
            self.tpx = self.ruta = ""


class _Selectores(HTMLParser):
    """Los selectores de una página del INE: el rótulo que los precede y sus opciones (dirección y texto)."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.selectores: list[tuple[str, list[tuple[str, str]]]] = []
        self.rotulo: list[str] | None = None
        self.ultimo_rotulo = ""
        self.opciones: list[tuple[str, str]] | None = None
        self.valor: str | None = None
        self.texto: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "label":
            self.rotulo = []
        elif tag == "select":
            self.opciones = []
        elif tag == "option" and self.opciones is not None:
            self.valor, self.texto = dict(attrs).get("value") or "", []

    def handle_data(self, data: str) -> None:
        for destino in (self.rotulo, self.texto if self.valor is not None else None):
            if destino is not None:
                destino.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag == "label" and self.rotulo is not None:
            self.ultimo_rotulo, self.rotulo = _limpio(self.rotulo), None
        elif tag == "option" and self.opciones is not None and self.valor is not None:
            self.opciones.append((self.valor, _limpio(self.texto)))
            self.valor = None
        elif tag == "select" and self.opciones is not None:
            self.selectores.append((self.ultimo_rotulo, self.opciones))
            self.opciones = None


def _documentos(contenido: bytes, pagina: str, anio: str) -> DocumentosEncontrados:
    """La dirección del PDF de la metodología y la del cuestionario de ese año, de los selectores de su página.

    Returns:
        Las dos direcciones.

    Raises:
        NavegacionDetenida: Si la página no es UTF-8, si no hay un solo selector con su rótulo y una sola opción de ese
            año en cada uno, o si la opción no lleva a un PDF del INE.
    """
    try:
        texto = contenido.decode("utf-8", "strict")
    except UnicodeDecodeError as error:
        raise NavegacionDetenida("pagina-no-utf8", f"la página {pagina} no es UTF-8 válido") from error
    lector = _Selectores()
    lector.feed(texto)
    lector.close()
    encontrados: dict[str, str] = {}
    for clave, rotulo in SELECTORES.items():
        selectores = [opciones for de_su_rotulo, opciones in lector.selectores if de_su_rotulo == rotulo]
        del_anio = sorted({valor for opciones in selectores for valor, cual in opciones if cual == anio})
        if len(selectores) != 1 or len(del_anio) != 1:
            raise NavegacionDetenida(
                "sin-coincidencia" if not del_anio else "varias-coincidencias",
                f"en {pagina} hay {len(selectores)} selectores «{rotulo}» y {len(del_anio)} opciones de {anio}, y la "
                "navegación exige una",
            )
        direccion = urljoin(pagina, del_anio[0])
        partes = urlsplit(direccion)
        if f"{partes.scheme}://{partes.netloc}" != SITIO or not RUTA_PDF.fullmatch(partes.path) or partes.query:
            raise NavegacionDetenida(
                "fuera-de-inebase", f"la opción {anio} de «{rotulo}» no es un PDF del INE: {direccion}"
            )
        encontrados[clave] = direccion
    return {"metodologia": encontrados["metodologia"], "cuestionario": encontrados["cuestionario"]}


def _pagina_de_metodologia(enlaces: list[Enlace], catalogo: str) -> str:
    """La página de metodología y cuestionarios de la operación, enlazada desde el catálogo.

    Returns:
        Su dirección.

    Raises:
        NavegacionDetenida: Si no hay un solo enlace o no lleva a una página de la operación en INEbase.
    """
    enlace = _unico([e for e in enlaces if e.texto == ENLACE_METODOLOGIA], f"«{ENLACE_METODOLOGIA}»", catalogo)
    partes = urlsplit(enlace.url)
    consulta = parse_qs(partes.query)
    if (
        f"{partes.scheme}://{partes.netloc}" != SITIO
        or partes.path != PAGINA_INEBASE
        or consulta.get("menu") != ["metodologia"]
    ):
        raise NavegacionDetenida(
            "fuera-de-inebase", f"el enlace «{ENLACE_METODOLOGIA}» no lleva a una página de INEbase: {enlace.url}"
        )
    return enlace.url


def _limpio(trozos: list[str]) -> str:
    """El texto con los espacios del HTML reducidos a uno.

    Returns:
        El texto normalizado.
    """
    return " ".join("".join(trozos).split())


def _enlaces(contenido: bytes, pagina: str) -> list[Enlace]:
    """Los enlaces de una página del INE, que debe llegar en UTF-8 estricto.

    Returns:
        Cada enlace, con su dirección absoluta.

    Raises:
        NavegacionDetenida: Si la página no es UTF-8 válido.
    """
    try:
        texto = contenido.decode("utf-8", "strict")
    except UnicodeDecodeError as error:
        raise NavegacionDetenida("pagina-no-utf8", f"la página {pagina} no es UTF-8 válido") from error
    lector = _Enlaces()
    lector.feed(texto)
    lector.close()
    return [enlace._replace(url=urljoin(pagina, enlace.url)) for enlace in lector.enlaces]


def _unico(coincidencias: list[Enlace], que: str, pagina: str) -> Enlace:
    """El único enlace que casa con un título.

    Returns:
        El enlace.

    Raises:
        NavegacionDetenida: Si no hay ninguno o hay más de uno.
    """
    distintas = sorted({enlace.url: enlace for enlace in coincidencias}.values())
    if len(distintas) != 1:
        raise NavegacionDetenida(
            "sin-coincidencia" if not distintas else "varias-coincidencias",
            f"en {pagina} hay {len(distintas)} enlaces a {que}, y la navegación exige uno: "
            f"{[enlace.url for enlace in distintas]}",
        )
    return distintas[0]


def _indice(enlace: Enlace, que: str) -> str:
    """Exige que el enlace lleve a un índice de INEbase.

    Returns:
        La dirección.

    Raises:
        NavegacionDetenida: Si lleva a otro sitio.
    """
    partes = urlsplit(enlace.url)
    if f"{partes.scheme}://{partes.netloc}" != SITIO or partes.path != INDICE:
        raise NavegacionDetenida("fuera-de-inebase", f"el enlace a {que} no lleva a un índice de INEbase: {enlace.url}")
    return enlace.url


def _tabla(enlaces: list[Enlace], titulo: str, pagina: str, anio: str) -> TablaEncontrada:
    """La tabla de un índice con ese título, con una sola coincidencia, de la operación de ese año.

    Returns:
        Su número, su título y la dirección de su CSV.

    Raises:
        NavegacionDetenida: Si no hay una sola, si su enlace no es el de una tabla del INE o si su entrada del índice
            no es de ese año o declara otro número.
    """
    enlace = _unico([enlace for enlace in enlaces if enlace.texto == titulo], f"la tabla «{titulo}»", pagina)
    partes = urlsplit(enlace.url)
    numero = parse_qs(partes.query).get("tpx", [""])
    if not (
        f"{partes.scheme}://{partes.netloc}" == SITIO
        and partes.path == TABLA
        and len(numero) == 1
        and re.fullmatch(r"[0-9]+", numero[0])
    ):
        raise NavegacionDetenida(
            "fuera-de-inebase", f"el enlace a la tabla «{titulo}» no es el de una tabla del INE: {enlace.url}"
        )
    if enlace.tpx != numero[0] or f"/TICH/TICH{anio}_" not in enlace.ruta:
        raise NavegacionDetenida(
            "otro-anio",
            f"la tabla «{titulo}» ({numero[0]}) no está en la operación de {anio} del índice: entrada "
            f"{enlace.tpx!r} en {enlace.ruta!r}",
        )
    return {"tabla": numero[0], "titulo": titulo, "url": f"{CSV_INE}/{numero[0]}.csv"}


def navegar(anio: str, catalogo: str, contenido: bytes, bajar: Callable[[str], bytes]) -> Navegacion:
    """Localiza la tabla de uso, la de errores y los dos documentos de la edición `anio` desde el catálogo.

    Args:
        anio: El año de la edición, el del bloque «Resultados año AAAA» del catálogo.
        catalogo: La dirección del catálogo.
        contenido: Los bytes del catálogo ya descargado.
        bajar: Descarga una página del INE y devuelve sus bytes.

    Returns:
        Las dos tablas y los dos documentos, con las cinco páginas recorridas y su huella.

    Raises:
        NavegacionDetenida: Si un paso no se puede dar.
    """
    paginas: list[Pagina] = [{"url": catalogo, "sha256": sha256_bytes(contenido)}]

    def consultar(direccion: str) -> list[Enlace]:
        datos = bajar(direccion)
        paginas.append({"url": direccion, "sha256": sha256_bytes(datos)})
        return _enlaces(datos, direccion)

    todos = _enlaces(contenido, catalogo)
    del_catalogo = [enlace for enlace in todos if enlace.anio == anio]
    nacional = [enlace for enlace in del_catalogo if enlace.seccion == SECCION_NACIONAL]
    personas = _indice(
        _unico(
            [enlace for enlace in nacional if enlace.texto == CAPITULO_PERSONAS],
            f"«{CAPITULO_PERSONAS}» de los resultados nacionales de {anio}",
            catalogo,
        ),
        CAPITULO_PERSONAS,
    )
    errores = _indice(
        _unico(
            [enlace for enlace in del_catalogo if enlace.texto == CAPITULO_ERRORES],
            f"«{CAPITULO_ERRORES}» de {anio}",
            catalogo,
        ),
        CAPITULO_ERRORES,
    )
    ia = _indice(
        _unico([enlace for enlace in consultar(personas) if enlace.texto == SUBCAPITULO_IA], SUBCAPITULO_IA, personas),
        SUBCAPITULO_IA,
    )
    uso = _tabla(consultar(ia), TITULO_USO, ia, anio)
    tabla_errores = _tabla(consultar(errores), TITULO_ERRORES, errores, anio)
    metodologia = _pagina_de_metodologia(todos, catalogo)
    de_la_metodologia = bajar(metodologia)
    paginas.append({"url": metodologia, "sha256": sha256_bytes(de_la_metodologia)})
    documentos = _documentos(de_la_metodologia, metodologia, anio)
    return {"anio": anio, "uso": uso, "errores": tabla_errores, "documentos": documentos, "paginas": paginas}


def pagina_del_ine(direccion: str) -> bytes:
    """Descarga una página de INEbase con el perfil de página y exige que no redirija.

    Returns:
        Sus bytes.

    Raises:
        NavegacionDetenida: Si la página llega de otra dirección.
    """
    descarga = red.descargar_url(direccion, perfil="pagina")
    if descarga.url_final != direccion:
        raise NavegacionDetenida("redireccion", f"la página {direccion} redirige a {descarga.url_final}")
    return descarga.datos


def tablas_de_la_edicion_nueva(
    observada: Mapping[str, Any] | None,
    catalogo: str,
    contenido: Callable[[], bytes],
    bajar: Callable[[str], bytes] = pagina_del_ine,
) -> dict[str, Any]:
    """Las tablas de la edición nueva observada con sus microdatos, para la procedencia.

    Solo se navega cuando la edición nueva está pendiente de incorporar. Si un paso no se puede dar, también por un
    fallo de red (`OSError`: un 404 o 5xx, un tiempo de espera o un corte), la navegación se detiene con su motivo y
    la fuente conserva la edición admitida.

    Args:
        observada: La observación de la edición nueva (`edicion_nueva`), o None.
        catalogo: La dirección del catálogo.
        contenido: Lee los bytes del catálogo ya descargado; solo se llama si se navega.
        bajar: Descarga una página del INE y devuelve sus bytes.

    Returns:
        `{}`, `{"tablas_edicion_nueva": …}` o `{"tablas_edicion_nueva_detenida": {"anio", "motivo", "detalle"}}`.
    """
    if observada is None or observada.get("estado") != PENDIENTE:
        return {}
    anio = str(observada["anio"])
    motivo: Motivo
    try:
        return {"tablas_edicion_nueva": navegar(anio, catalogo, contenido(), bajar)}
    except NavegacionDetenida as error:
        motivo, detalle = error.motivo, error.detalle
    except OSError as error:
        motivo, detalle = "red", f"{type(error).__name__}: {error}"
    return {"tablas_edicion_nueva_detenida": {"anio": anio, "motivo": motivo, "detalle": detalle}}
