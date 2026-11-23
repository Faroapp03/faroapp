"""Edición de residentes anunciada por INEbase, separada de los nombres de recién nacidos."""

import re
from datetime import datetime
from html.parser import HTMLParser

from plataforma_datos.comun.nucleo import FormatoInesperado, exigir

SITIO = "https://www.ine.es"
RUTA = "/daco/daco42/nombyapel/"
SECCIONES = {
    "tabs-1254736195454": ("nombres_por_edad_media.xlsx", "nombres_por_nacionalidades.xlsx", "nota_nombres.pdf"),
    "tabs-1254736195497": ("apellidos_frecuencia.xls", "apellidos_por_nacionalidad.xls", "nota_apellidos.pdf"),
}
FECHAS = re.compile(r"Últimos datos ([0-9]{2}/[0-9]{2}/[0-9]{4}) Publicado:\s*([0-9]{2}/[0-9]{2}/[0-9]{4})")


class _Catalogo(HTMLParser):
    """Recoge texto y enlaces de las dos pestañas de residentes, con sus límites de div."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.profundidad = 0
        self.inicio = 0
        self.seccion: str | None = None
        self.textos: dict[str, list[str]] = {}
        self.enlaces: dict[str, list[str]] = {}

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "div":
            self.profundidad += 1
            identificadores = [valor for clave, valor in attrs if clave == "id"]
            if self.seccion is not None or any(valor in SECCIONES for valor in identificadores):
                exigir(len(identificadores) <= 1, "nombres: atributo id duplicado en una pestaña de residentes")
            identificador = identificadores[-1] if identificadores else None
            if identificador in SECCIONES:
                exigir(
                    self.seccion is None and identificador not in self.textos,
                    "nombres: pestaña de residentes duplicada o anidada en el catálogo del INE",
                )
                self.seccion = identificador
                self.inicio = self.profundidad
                self.textos[identificador] = []
                self.enlaces[identificador] = []
        elif tag == "a" and self.seccion is not None:
            enlaces = [valor for clave, valor in attrs if clave == "href"]
            exigir(len(enlaces) <= 1, "nombres: atributo href duplicado en una pestaña de residentes")
            self.enlaces[self.seccion].append((enlaces[0] if enlaces else None) or "")

    def handle_endtag(self, tag: str) -> None:
        if tag == "div":
            if self.profundidad == self.inicio:
                self.seccion = None
            self.profundidad -= 1

    def handle_data(self, data: str) -> None:
        if self.seccion is not None:
            self.textos[self.seccion].append(data)


def _edicion_de_seccion(textos: list[str], enlaces: list[str], archivos: tuple[str, ...]) -> dict[str, str]:
    """Exige un único corte válido y sus tres recursos oficiales en una pestaña de residentes.

    Returns:
        Fecha de referencia y fecha de publicación anunciadas por el INE.

    Raises:
        FormatoInesperado: Si las fechas o los recursos no identifican una edición inequívoca.
    """
    texto = " ".join(" ".join(textos).split())
    fechas = FECHAS.findall(texto)
    exigir(
        len(fechas) == 1 and texto.count("Últimos datos") == 1 and len(re.findall(r"\bPublicado\s*:", texto)) == 1,
        "nombres: fechas ambiguas o ausentes en INEbase",
    )
    for fecha in fechas[0]:
        try:
            datetime.strptime(fecha, "%d/%m/%Y")
        except ValueError as error:
            raise FormatoInesperado("nombres: fecha inválida en el catálogo del INE") from error
    exigir(
        all(enlaces.count(RUTA + archivo) + enlaces.count(SITIO + RUTA + archivo) == 1 for archivo in archivos),
        "nombres: hojas o notas metodológicas ausentes o duplicadas en su pestaña de residentes",
    )
    return dict(zip(("fecha_datos", "publicado"), fechas[0], strict=True))


def edicion_del_catalogo(contenido: bytes) -> dict[str, str]:
    """Lee las fechas concordantes de nombres y apellidos de residentes y exige sus seis enlaces.

    Returns:
        Fecha de referencia y publicación de la edición anunciada.

    Raises:
        FormatoInesperado: Si el catálogo no identifica inequívocamente la edición de residentes.
    """
    try:
        pagina = contenido.decode("utf-8", "strict")
    except UnicodeDecodeError as error:
        raise FormatoInesperado("nombres: catálogo del INE no codificado en UTF-8") from error
    catalogo = _Catalogo()
    catalogo.feed(pagina)
    catalogo.close()
    exigir(
        set(catalogo.textos) == set(SECCIONES) and catalogo.seccion is None,
        "nombres: pestañas de residentes incompletas en el catálogo del INE",
    )
    ediciones = [
        _edicion_de_seccion(catalogo.textos[seccion], catalogo.enlaces[seccion], archivos)
        for seccion, archivos in SECCIONES.items()
    ]
    exigir(ediciones[0] == ediciones[1], "nombres: nombres y apellidos anuncian ediciones distintas en INEbase")
    return ediciones[0]
