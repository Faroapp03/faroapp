"""Edición anunciada por INEbase; descubrir un año no acredita su compatibilidad estadística."""

import re
from html.parser import HTMLParser

from plataforma_datos.comun.nucleo import exigir

SITIO = "https://www.ine.es"
SELECTOR_MICRODATOS = "ir_1254736063703"


class _Catalogo(HTMLParser):
    """Lee el rótulo de resultados y las opciones de microdatos del catálogo de la operación."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.resultados: list[int] = []
        self.microdatos: dict[int, str] = {}
        self.parrafo: list[str] | None = None
        self.opcion: list[str] | None = None
        self.seleccion = False
        self.seleccion_microdatos = False
        self.selectores_microdatos = 0
        self.url = ""

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "p":
            exigir(self.parrafo is None, "TIC-H: párrafos anidados ambiguos en el catálogo del INE")
            self.parrafo = []
        elif tag == "select":
            exigir(not self.seleccion, "TIC-H: listas anidadas en el catálogo del INE")
            self.seleccion = True
            self.seleccion_microdatos = dict(attrs).get("id") == SELECTOR_MICRODATOS
            if self.seleccion_microdatos:
                self.selectores_microdatos += 1
                exigir(
                    self.selectores_microdatos == 1, "TIC-H: selector de microdatos duplicado en el catálogo del INE"
                )
        elif tag == "option":
            exigir(self.opcion is None, "TIC-H: opciones anidadas en el catálogo del INE")
            self.opcion = []
            self.url = dict(attrs).get("value") or ""

    def handle_data(self, data: str) -> None:
        if self.parrafo is not None:
            self.parrafo.append(data)
        if self.opcion is not None:
            self.opcion.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag == "p" and self.parrafo is not None:
            rotulo = " ".join(" ".join(self.parrafo).split())
            coincidencia = re.fullmatch(r"Resultados año ([0-9]{4})", rotulo)
            if coincidencia:
                self.resultados.append(int(coincidencia[1]))
            self.parrafo = None
        elif tag == "option" and self.opcion is not None:
            rotulo = "".join(self.opcion).strip()
            if self.seleccion_microdatos and (rotulo, self.url) != ("Seleccionar año", "#"):
                exigir(re.fullmatch(r"[0-9]{4}", rotulo) is not None, "TIC-H: opción de año de microdatos inesperada")
                anio = int(rotulo)
                direccion = SITIO + self.url if self.url.startswith("/") else self.url
                exigir(
                    direccion == f"{SITIO}/ftp/microdatos/tich/datos_{anio}.zip"
                    and rotulo == str(anio)
                    and anio not in self.microdatos,
                    "TIC-H: año, dirección o duplicado de microdatos incoherente en el catálogo del INE",
                )
                self.microdatos[anio] = direccion
            self.opcion = None
        elif tag == "select":
            exigir(self.seleccion and self.opcion is None, "TIC-H: lista incompleta en el catálogo del INE")
            self.seleccion = False
            self.seleccion_microdatos = False


def edicion_del_catalogo(pagina: str) -> dict[str, int | str]:
    """Extrae los últimos años de resultados y microdatos, sin inferir diseño ni fabricar URL.

    Returns:
        Los dos años anunciados y la dirección oficial del ZIP más reciente.

    Raises:
        FormatoInesperado: Si el catálogo no identifica inequívocamente resultados y microdatos.
    """
    catalogo = _Catalogo()
    catalogo.feed(pagina)
    catalogo.close()
    exigir(
        len(catalogo.resultados) == 1
        and catalogo.selectores_microdatos == 1
        and bool(catalogo.microdatos)
        and catalogo.opcion is None
        and catalogo.parrafo is None
        and not catalogo.seleccion,
        "TIC-H: el catálogo del INE no identifica una edición de resultados y sus microdatos",
    )
    anio = max(catalogo.microdatos)
    return {
        "anio_resultados": catalogo.resultados[0],
        "anio_microdatos": anio,
        "url_microdatos": catalogo.microdatos[anio],
    }
