"""Uso de la IA por las empresas de Brasil (Cetic.br/NIC.br, TIC Empresas 2025, tabla H9): su propio módulo.

Cetic.br, del Núcleo de Informação e Coordenação do Ponto BR (NIC.br), pregunta en TIC Empresas si la empresa usó
alguna tecnología de IA, con la lista de siete tecnologías que usó la encuesta europea hasta 2024. Universo: empresas
activas de 10 o más personas ocupadas. La pregunta solo se hizo a las empresas con especialistas, área o departamento
de TI, y el resultado se da sobre el total de empresas: la cifra es un mínimo. Se lee la fila «TOTAL», columna «Sim»,
de la página de la tabla H9, y se comprueban literales su título, su base y su nota al pie. Python estándar.

Uso: python3 -m plataforma_datos.ia_y_trabajo.fuentes.ia_nacional_bra.lector {descargar,preparar,validar,todo}
    [--aceptar-cambio]
"""

import html
import re
import sys
import time
from html.parser import HTMLParser
from typing import Any
from urllib.parse import urljoin, urlparse

from plataforma_datos.comun.entrada_salida import carpetas, comprobar_originales, guardar_json, original
from plataforma_datos.comun.nucleo import ARCHIVO_DE_PROCEDENCIA, Controles, FormatoInesperado, exigir
from plataforma_datos.comun.red import (
    PAUSA_ENTRE_PETICIONES_S,
    descargar_originales,
    descubrimiento_previo_unico,
    descubrir_edicion,
)
from plataforma_datos.ia_y_trabajo.comun.medida_nacional import (
    PORCENTAJE_MAXIMO,
    controles_del_indicador,
    indicador_nacional,
    validar_medida,
)
from plataforma_datos.orquestacion.ordenes import principal_fuente_con_descarga

FUENTE = "ia-nacional-bra"
PAIS = "BRA"
ORIGINAL, PREPARADO, VALIDADO = carpetas(FUENTE)
CIFRAS = PREPARADO / "cifras.json"
ANIO = 2025
ARCHIVO = "cetic-tic-empresas-2025-h9.html"
URL = "https://cetic.br/en/tics/pesquisa/2025/empresas/H9/"
# CC BY-SA 4.0 pide citar la obra y su licencia, decir si se ha cambiado y compartir lo adaptado con la misma licencia.
LICENCIA = (
    "Creative Commons Atribuição-CompartilhaIgual 4.0 Internacional (CC BY-SA 4.0, "
    "https://creativecommons.org/licenses/by-sa/4.0/): se cita a Cetic.br/NIC.br; la cifra se toma sin cambios y lo "
    "que se adapte de esta tabla se comparte con la misma licencia."
)
# La cita literal que da la propia tabla.
CITA = (
    "Núcleo de Informação e Coordenação do Ponto BR. (2026). Pesquisa sobre o uso das tecnologias de informação e "
    "comunicação nas empresas brasileiras: TIC Empresas 2025 [Tabelas]."
)
ARCHIVOS = [
    {
        "archivo": ARCHIVO,
        "nivel": "oficial",
        "titulo": "Cetic.br/NIC.br, TIC Empresas 2025, tabla H9: empresas que usaron tecnologías de IA (HTML)",
        "url": URL,
        "licencia": LICENCIA,
    }
]
PROCEDENCIA = ORIGINAL / ARCHIVO_DE_PROCEDENCIA
CATALOGO = {
    "archivo": "cetic-tic-empresas-ediciones.html",
    "nivel": "oficial",
    "titulo": "Cetic.br, TIC Empresas, ediciones disponibles",
    "url": "https://cetic.br/en/pesquisa/empresas/indicadores/",
    "licencia": LICENCIA,
}
MAX_CATALOGO_BYTES = 1 << 20
EDICION = {"anio": ANIO}

# Los textos literales de la tabla que dicen qué se mide: si cambian, se para.
TITULO = "H9 - EMPRESAS QUE UTILIZARAM TECNOLOGIAS DE INTELIGÊNCIA ARTIFICIAL"
TITULO_EN_CATALOGO = "H9 - Empresas Que Utilizaram Tecnologias De Inteligência Artificial"
BASE = "Total de empresas¹"
NOTA = (
    "¹Este indicador foi coletado somente entre as empresas que possuem especialistas, área ou departamento de TI. "
    "Para fins de divulgação, são apresentados os resultados pelo total de empresas."
)
INDICADORES_NACIONALES: dict[str, dict[str, object]] = {
    PAIS: indicador_nacional(
        PAIS,
        nombre={
            "es": "Empresas que usan IA (Brasil, medida nacional)",
            "ca": "Empreses que fan servir IA (Brasil, mesura nacional)",
        },
        definicion={
            "es": "Porcentaje de empresas de Brasil con 10 o más personas ocupadas que usaron alguna tecnología de "
            "inteligencia artificial (TIC Empresas 2025 de Cetic.br/NIC.br, tabla H9; entrevistas telefónicas de "
            "febrero de 2025 a enero de 2026). La lista es de siete tecnologías, la de la encuesta europea hasta 2024. "
            "Es un mínimo: solo respondieron la pregunta las empresas con especialistas, área o departamento de TI, y "
            "el resultado se da sobre el total de empresas. Es otra pregunta y otro universo que los de la encuesta "
            "europea: no se compara con Europa ni con otros países.",
            "ca": "Percentatge d'empreses del Brasil amb 10 o més persones ocupades que van fer servir alguna "
            "tecnologia d'intel·ligència artificial (TIC Empresas 2025 de Cetic.br/NIC.br, taula H9; entrevistes "
            "telefòniques de febrer del 2025 a gener del 2026). La llista és de set tecnologies, la de l'enquesta "
            "europea fins al 2024. És un mínim: només van respondre la pregunta les empreses amb especialistes, àrea o "
            "departament de TI, i el resultat es dona sobre el total d'empreses. És una altra pregunta i un altre "
            "univers que els de l'enquesta europea: no es compara amb Europa ni amb altres països.",
        },
        fuente="Cetic.br/NIC.br, TIC Empresas",
        tabla="TIC Empresas 2025 · H9 · TOTAL · «Sim»",
        licencia=LICENCIA,
        url=URL,
    )
}
FRASES = {
    "es": ("Es un mínimo", "especialistas, área o departamento de TI", "siete tecnologías", "hasta 2024"),
    "ca": ("És un mínim", "especialistes, àrea o departament de TI", "set tecnologies", "fins al 2024"),
}


class _EdicionesCetic(HTMLParser):
    """El título vigente y los enlaces del selector de años disponibles de TIC Empresas."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.profundidad = 0
        self.bloques = 0
        self.titulo: list[str] | None = None
        self.titulos: list[str] = []
        self.enlace: tuple[str, list[str], bool] | None = None
        self.anios: list[int] = []
        self.rotulos: list[int] = []
        self.tablas: list[tuple[str, str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        campos = {"ul": ("aria-labelledby",), "h2": ("class",), "a": ("href",)}.get(tag, ())
        nombres = [clave for clave, _valor in attrs if clave in campos]
        exigir(len(nombres) == len(set(nombres)), "Cetic.br: atributo de identidad duplicado")
        atributos = dict(attrs)
        if tag == "ul":
            if self.profundidad:
                self.profundidad += 1
            elif atributos.get("aria-labelledby") == "anosDropdown":
                self.profundidad = 1
                self.bloques += 1
        if tag == "h2" and "page-title" in (atributos.get("class") or "").split():
            exigir(self.titulo is None, "Cetic.br: títulos anidados")
            self.titulo = []
        if tag == "a":
            exigir(self.enlace is None, "Cetic.br: enlaces anidados")
            self.enlace = (atributos.get("href") or "", [], bool(self.profundidad))

    def handle_data(self, data: str) -> None:
        if self.titulo is not None:
            self.titulo.append(data)
        if self.enlace is not None:
            self.enlace[1].append(data)

    def _cerrar_enlace(self) -> None:
        if self.enlace is None:
            return
        href, partes, selector = self.enlace
        texto = " ".join(" ".join(partes).split())
        self.enlace = None
        if not selector:
            self.tablas.append((urljoin(CATALOGO["url"], href), texto))
            return
        if href == "#":
            exigir(re.fullmatch(r"[0-9]{4}", texto) is not None, "Cetic.br: año del selector inválido")
            self.rotulos.append(int(texto))
            return
        url = urlparse(urljoin(CATALOGO["url"], href))
        anio = re.fullmatch(
            r"/en/tics/(?:pesquisa/([0-9]{4})/empresas|empresas/([0-9]{4})/(empresas|microempresas|geral))/",
            url.path,
        )
        exigir(
            url.scheme == "https"
            and url.netloc == "cetic.br"
            and anio is not None
            and not url.query
            and not url.fragment,
            "Cetic.br: enlace de edición incoherente",
        )
        publicado = int(anio[1] or anio[2]) if anio else 0
        exigir(bool(self.rotulos) and self.rotulos[-1] == publicado, "Cetic.br: año y enlace desalineados")
        micro = anio is not None and anio[3] == "microempresas"
        exigir(texto == ("Microempresas" if micro else "Empresas"), "Cetic.br: unidad de análisis incoherente")
        if not micro:
            self.anios.append(publicado)

    def handle_endtag(self, tag: str) -> None:
        if tag == "a":
            self._cerrar_enlace()
        elif tag == "h2" and self.titulo is not None:
            self.titulos.append(" ".join(" ".join(self.titulo).split()))
            self.titulo = None
        elif tag == "ul" and self.profundidad:
            self.profundidad -= 1


def edicion_del_catalogo(contenido: bytes) -> dict[str, int]:
    """Lee el último año publicado y contrasta encabezado, selector y enlace a H9.

    Returns:
        El año anunciado, sin probar URLs de años que el catálogo no ofrece.

    Raises:
        FormatoInesperado: Si el catálogo no es UTF-8 o no identifica una edición inequívoca.
    """
    exigir(0 < len(contenido) <= MAX_CATALOGO_BYTES, "Cetic.br: catálogo fuera de tamaño")
    catalogo = _EdicionesCetic()
    try:
        catalogo.feed(contenido.decode("utf-8", "strict"))
    except UnicodeDecodeError as error:
        raise FormatoInesperado("Cetic.br: catálogo no es UTF-8") from error
    catalogo.close()
    anios = catalogo.anios
    exigir(
        catalogo.bloques == 1
        and not catalogo.profundidad
        and catalogo.enlace is None
        and catalogo.titulo is None
        and bool(anios)
        and len(set(anios)) == len(anios)
        and sorted(catalogo.rotulos) == sorted(anios),
        "Cetic.br: catálogo incompleto o con ediciones repetidas",
    )
    anio = max(anios)
    exigir(catalogo.titulos == [f"ICT Enterprises - {anio}"], "Cetic.br: título y selector incoherentes")
    tabla = (f"https://cetic.br/en/tics/pesquisa/{anio}/empresas/H9/", TITULO_EN_CATALOGO)
    exigir(catalogo.tablas.count(tabla) == 1, "Cetic.br: falta el enlace inequívoco a la tabla H9")
    return {"anio": anio}


def comprobar_edicion(edicion: dict[str, int]) -> None:
    """El año nuevo requiere revisar pregunta, base, entrevistas y notas antes de descargar H9."""
    exigir(
        edicion == EDICION and type(edicion.get("anio")) is int,
        f"Cetic.br: edición anunciada {edicion}; contrato {EDICION}. Revisar método antes de descargar la tabla H9",
    )


def _texto(fragmento: str) -> str:
    """El texto de un fragmento de HTML, sin etiquetas y con los espacios juntos.

    Returns:
        El texto limpio, con los espacios simples.
    """
    return " ".join(html.unescape(re.sub(r"<[^>]+>", " ", fragmento)).split())


def cifra_de_la_tabla(pagina: str) -> dict[str, Any]:
    """La cifra de la fila «TOTAL», columna «Sim», con el título, la base, la fuente y la nota literales.

    Returns:
        La cifra (porcentaje) con el título, la base, la fuente y la nota literales de la tabla.
    """
    tablas = re.findall(r"<table\b.*?</table>", pagina, re.S)
    exigir(len(tablas) == 1, f"Cetic.br: {len(tablas)} tablas en la página")
    tabla = tablas[0]
    cabeceras = [_texto(celda) for celda in re.findall(r"<th\b[^>]*>(.*?)</th>", tabla, re.S)]
    exigir(cabeceras[1:3] == ["Sim", "Não"], f"Cetic.br: columnas inesperadas {cabeceras[:3]}")
    total = re.findall(r"<th\b[^>]*>\s*TOTAL\s*</th>\s*<td>([^<]*)</td>\s*<td>([^<]*)</td>", tabla)
    exigir(len(total) == 1, f"Cetic.br: la fila «TOTAL» aparece {len(total)} veces")
    si, no = (texto.strip() for texto in total[0])
    exigir(
        re.fullmatch(r"[0-9]{1,3}", si) is not None
        and re.fullmatch(r"[0-9]{1,3}", no) is not None
        and int(si) + int(no) == PORCENTAJE_MAXIMO,
        f"Cetic.br: cifra inesperada {total[0]!r}",
    )
    textos = {}
    for clase in ("titulo", "olho"):
        encontrados = re.findall(rf'<p class="{clase}">(.*?)</p>', tabla, re.S)
        exigir(len(encontrados) == 1, f"Cetic.br: {clase} aparece {len(encontrados)} veces en la tabla")
        textos[clase] = _texto(encontrados[0])
    pies = [_texto(pie) for pie in re.findall(r'<li class="fonte">(.*?)</li>', pagina, re.S)]
    return {
        "valor": float(si),
        "anio": ANIO,
        "titulo": textos["titulo"],
        "base": textos["olho"],
        "pies": pies,
    }


def descargar(aceptar_cambio: bool = False) -> None:
    """Comprueba la edición anunciada antes de descargar los datos del método conocido."""
    edicion, registrar = descubrir_edicion(
        CATALOGO,
        ORIGINAL,
        redireccion="BRA: URL final del catálogo inesperada",
        leer=edicion_del_catalogo,
        comprobar=comprobar_edicion,
        previo=lambda: descubrimiento_previo_unico(PROCEDENCIA, CATALOGO["archivo"], "BRA"),
    )
    descubrimiento = registrar()
    time.sleep(PAUSA_ENTRE_PETICIONES_S)
    archivos = descargar_originales(ARCHIVOS, ORIGINAL, aceptar_cambio)
    guardar_json(
        PROCEDENCIA,
        {
            "fuente": "Cetic.br/NIC.br (TIC Empresas)",
            "cita": CITA,
            "licencia": LICENCIA,
            "archivos": archivos,
            "descubrimiento": [descubrimiento],
            "edicion": edicion,
        },
    )


def preparar() -> None:
    """Deja la cifra con su año y los textos literales de la tabla."""
    comprobar_originales(FUENTE)
    cifra = cifra_de_la_tabla(original(FUENTE, ARCHIVO).read_text(encoding="utf-8"))
    guardar_json(CIFRAS, {"paises": {PAIS: cifra}})
    print(f"Brasil: {cifra['valor']} % ({cifra['anio']})")


def _propios(controles: Controles, cifra: dict[str, Any], _procedencia: dict[str, Any]) -> None:
    """El título, la base, la cita y la nota de que es un mínimo, literales; y la definición que lo dice."""
    controles.comprobar(cifra.get("titulo") == TITULO, "Brasil: es la tabla H9 de TIC Empresas")
    controles.comprobar(cifra.get("base") == BASE, "Brasil: base, el total de empresas")
    controles.comprobar(cifra.get("pies") == [f"Fonte: {CITA}", NOTA], "Brasil: la cita de 2025 y la nota del mínimo")
    controles_del_indicador(controles, PAIS, INDICADORES_NACIONALES[PAIS], LICENCIA, FRASES)


def validar() -> None:
    """Comprueba la huella, la licencia, la cifra, el año (2025), la nota del mínimo y lo que dice la definición."""
    limites = (
        "La cifra es un mínimo (solo respondieron las empresas con personal de TI) y usa la lista de siete "
        "tecnologías de la encuesta europea hasta 2024. No se compara con Eurostat ni con otros países."
    )
    validar_medida(FUENTE, PAIS, range(ANIO, ANIO + 1), _propios, limites)


def main(argv: list[str] | None = None) -> int:
    """Interfaz de línea de órdenes: descargar, preparar, validar o todo.

    Returns:
        El código de salida del proceso (0 si todo fue bien).
    """
    return principal_fuente_con_descarga(
        __doc__,
        descargar=descargar,
        preparacion_y_validacion={"preparar": preparar, "validar": validar},
        argumentos=argv,
    )


if __name__ == "__main__":
    sys.exit(main())
