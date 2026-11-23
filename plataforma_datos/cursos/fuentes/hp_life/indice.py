"""Índice público de cursos de HP LIFE: lectura de sus páginas y censo completo comprobable.

El índice (`/es/allcourses?page=N`) declara en cada página cuántos cursos tiene en total. Un censo es completo solo
si las páginas leídas, consecutivas desde la primera, suman exactamente ese total, sin repetir ningún curso y con
al menos uno. Con cualquier otra forma (página caída, malformada, total que cambia, suma que no cuadra) el censo es
parcial: los cursos vistos siguen siendo evidencia de que existen, pero ninguna ausencia permite concluir nada.
"""

import re
from collections.abc import Sequence
from dataclasses import dataclass
from http import HTTPStatus
from urllib.parse import parse_qs, urlsplit

from plataforma_datos.cursos.fuentes.hp_life import lector
from plataforma_datos.cursos.fuentes.hp_life.lector import CapturaHpLife, ErrorFichaHpLife
from plataforma_datos.cursos.tipos_json import ObjetoJson

HOST = "www.life-global.org"
RUTA = "/es/allcourses"
INDICE = f"https://{HOST}{RUTA}"
MAX_PAGINAS = 100
# Idiomas con los que la fuente da de alta una ficha; los demás cursos del índice se cuentan sin darse de alta.
IDIOMAS_ALTA = frozenset({"es"})
IDIOMA = re.compile(r"[a-z]{2}")
PAGINA = re.compile(r"[1-9][0-9]{0,3}")


class ErrorIndiceHpLife(ErrorFichaHpLife):
    """Una página del índice no acredita su integridad o su estructura: queda sin noticia."""


@dataclass(frozen=True, kw_only=True)
class CursoIndice:
    """Curso que el índice declara; su identidad es la de la ficha, no un dato inventado."""

    id: int
    idioma: str

    @property
    def identidad(self) -> str:
        """Identidad nativa que usa el catálogo para este curso.

        Returns:
            Identificador con la forma `hp-life:<id>:<idioma>`.
        """
        return f"hp-life:{self.id}:{self.idioma}"

    @property
    def url(self) -> str:
        """Dirección canónica de la ficha, con la misma forma que las ya conocidas.

        Returns:
            URL de la ficha en su idioma, sin parte descriptiva.
        """
        return f"https://{HOST}/{self.idioma}/course/{self.id}"


@dataclass(frozen=True, kw_only=True)
class PaginaIndice:
    """Una página leída: su número, el total declarado y sus cursos, con la captura que la sostiene."""

    pagina: int
    total: int
    cursos: tuple[CursoIndice, ...]
    captura: CapturaHpLife


@dataclass(frozen=True, kw_only=True)
class CensoIndice:
    """Cursos vistos en el índice y si la lectura cubre el total declarado."""

    cursos: tuple[CursoIndice, ...]
    completo: bool
    motivo: str | None


def url_pagina(numero: int) -> str:
    """Construye la dirección de una página del índice.

    Returns:
        URL con el número de página.

    Raises:
        ErrorIndiceHpLife: Si el número no es una página posible.
    """
    if type(numero) is not int or not 1 <= numero <= MAX_PAGINAS:
        raise ErrorIndiceHpLife("Número de página del índice fuera de rango")
    return f"{INDICE}?page={numero}"


def numero_de_pagina(url: str) -> int:
    """Lee el número de página de una dirección del índice, rechazando cualquier otra.

    Returns:
        Número de página solicitado.

    Raises:
        ErrorIndiceHpLife: Si la URL no es de una página del índice.
    """
    partes = urlsplit(url)
    consulta = parse_qs(partes.query, keep_blank_values=True)
    if (
        partes.scheme != "https"
        or partes.netloc != HOST
        or partes.path != RUTA
        or partes.fragment
        or set(consulta) != {"page"}
        or len(consulta["page"]) != 1
        or not PAGINA.fullmatch(consulta["page"][0])
    ):
        raise ErrorIndiceHpLife("URL ajena al índice público de HP LIFE")
    return int(consulta["page"][0])


def _entero(valor: object, nombre: str, *, minimo: int) -> int:
    if type(valor) is not int or valor < minimo:
        raise ErrorIndiceHpLife(f"{nombre} del índice ausente o inválido")
    return valor


def _curso(dato: object) -> CursoIndice:
    if not isinstance(dato, dict):
        raise ErrorIndiceHpLife("Curso del índice sin forma de objeto")
    idioma = dato.get("language")
    if not isinstance(idioma, str) or not IDIOMA.fullmatch(idioma):
        raise ErrorIndiceHpLife("Idioma de un curso del índice ausente o inválido")
    return CursoIndice(id=_entero(dato.get("id"), "Identificador de un curso", minimo=1), idioma=idioma)


def _propiedades(cuerpo: bytes, captura: CapturaHpLife) -> ObjetoJson:
    if captura.http != HTTPStatus.OK or captura.completo is not True:
        raise ErrorIndiceHpLife("Página del índice sin respuesta íntegra")
    if captura.formato != "html_next" or captura.bytes_cuerpo != len(cuerpo):
        raise ErrorIndiceHpLife("Captura del índice incoherente con su cuerpo")
    if captura.sha256_cuerpo != lector._sha(cuerpo) or captura.sha256_respuesta != captura.sha256_cuerpo:
        raise ErrorIndiceHpLife("Huella de la página del índice incoherente")
    try:
        return lector._negocio(cuerpo.decode("utf-8"), "html_next")
    except (UnicodeDecodeError, ErrorFichaHpLife) as error:
        raise ErrorIndiceHpLife(f"Página del índice ilegible: {error}") from error


def extraer_indice(cuerpo: bytes, captura: CapturaHpLife) -> PaginaIndice:
    """Lee una página del índice sin inferir nada que ella no declare.

    Returns:
        Página con su total declarado y sus cursos.

    Raises:
        ErrorIndiceHpLife: Si la página no es íntegra, no llega de la dirección pedida o su lista está mal formada.
    """
    solicitada = numero_de_pagina(captura.url_solicitada)
    if numero_de_pagina(captura.url_final) != solicitada:
        raise ErrorIndiceHpLife("La respuesta llega de otra dirección que la solicitada")
    propiedades = _propiedades(cuerpo, captura)
    lista = propiedades.get("initialCourses")
    if not isinstance(lista, list):
        raise ErrorIndiceHpLife("Lista de cursos del índice ausente")
    if _entero(propiedades.get("page"), "Número de página", minimo=1) != solicitada:
        raise ErrorIndiceHpLife("La página recibida no es la solicitada")
    return PaginaIndice(
        pagina=solicitada,
        total=_entero(propiedades.get("totalCourses"), "Total de cursos", minimo=0),
        cursos=tuple(_curso(c) for c in lista),
        captura=captura,
    )


def censo(paginas: Sequence[PaginaIndice]) -> CensoIndice:
    """Reúne las páginas leídas y dice si cubren el total que ellas mismas declaran.

    Returns:
        Cursos vistos y, si el censo es parcial, el motivo; nunca una conclusión sobre ausencias.
    """
    ordenadas = sorted(paginas, key=lambda p: p.pagina)
    vistos: dict[str, CursoIndice] = {}
    repetido = False
    for pagina in ordenadas:
        for curso in pagina.cursos:
            repetido = repetido or curso.identidad in vistos
            vistos.setdefault(curso.identidad, curso)
    cursos = tuple(vistos.values())
    totales = {p.total for p in ordenadas}
    motivo = None
    if not ordenadas:
        motivo = "ninguna página legible"
    elif [p.pagina for p in ordenadas] != list(range(1, len(ordenadas) + 1)):
        motivo = "faltan páginas del índice"
    elif len(totales) != 1:
        motivo = "el total declarado cambia entre páginas"
    elif repetido:
        motivo = "un curso aparece dos veces"
    elif next(iter(totales)) < 1 or not ordenadas[0].cursos:
        motivo = "el índice no lista ningún curso"
    elif len(cursos) != next(iter(totales)):
        motivo = "las páginas no suman el total declarado"
    return CensoIndice(cursos=cursos, completo=motivo is None, motivo=motivo)
