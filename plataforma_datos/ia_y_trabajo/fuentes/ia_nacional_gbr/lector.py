"""Uso de la IA por las empresas del Reino Unido (ONS, BICS, 10 o más personas): su propio módulo de actualización.

La Office for National Statistics pregunta en su encuesta quincenal Business Insights and Conditions Survey (BICS)
qué tecnologías de IA usa la empresa ahora, de una lista de seis más «Other». La serie que se lee es la de la figura 1
del artículo «Artificial intelligence in UK businesses: 2023 to 2026» (estimaciones ponderadas, solo empresas de 10 o
más personas empleadas): el último período publicado. Es una estadística oficial en desarrollo («official statistics
in development») y la respuesta es voluntaria. La cifra de todas las empresas (también las de 0 a 9 personas) es otra
base y no se mezcla con esta: la nota de la figura que dice el universo se comprueba literal. Python estándar.

Uso: python3 -m plataforma_datos.ia_y_trabajo.fuentes.ia_nacional_gbr.lector {descargar,preparar,validar,todo}
    [--aceptar-cambio]
"""

import csv
import io
import re
import sys
import time
from datetime import date
from html.parser import HTMLParser
from typing import Any
from urllib.parse import urljoin, urlparse

from plataforma_datos.comun.entrada_salida import (
    carpetas,
    comprobar_originales,
    guardar_json,
    hoy_utc,
    original,
)
from plataforma_datos.comun.nucleo import ARCHIVO_DE_PROCEDENCIA, Controles, FormatoInesperado, exigir
from plataforma_datos.comun.red import (
    PAUSA_ENTRE_PETICIONES_S,
    descargar_originales,
    descubrimiento_previo_unico,
    descubrir_edicion,
)
from plataforma_datos.ia_y_trabajo.comun.medida_nacional import (
    controles_del_indicador,
    indicador_nacional,
    validar_medida,
)
from plataforma_datos.orquestacion.ordenes import principal_fuente_con_descarga

FUENTE = "ia-nacional-gbr"
PAIS = "GBR"
ORIGINAL, PREPARADO, VALIDADO = carpetas(FUENTE)
CIFRAS = PREPARADO / "cifras.json"
ARCHIVO = "ons-bics-ia-figura-1.csv"
ARTICULO = (
    "https://www.ons.gov.uk/businessindustryandtrade/business/businessservices/articles/"
    "artificialintelligenceinukbusinesses/2023to2026"
)
URL = (
    "https://www.ons.gov.uk/generator?uri=/businessindustryandtrade/business/businessservices/articles/"
    "artificialintelligenceinukbusinesses/2023to2026/808491a0&format=csv"
)
# La atribución que pide la Open Government Licence v3.0, literal, y la cita a la ONS.
ATRIBUCION_OGL = "Contains public sector information licensed under the Open Government Licence v3.0."
LICENCIA = (
    "Open Government Licence v3.0 (https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/): "
    f"«{ATRIBUCION_OGL}» Se cita a la Office for National Statistics (ONS)."
)
CITA = "Office for National Statistics (ONS), Artificial intelligence in UK businesses: 2023 to 2026, figura 1."
ARCHIVOS = [
    {
        "archivo": ARCHIVO,
        "nivel": "oficial",
        "titulo": "Office for National Statistics, BICS: empresas de 10 o más personas que usan IA, serie de la "
        "figura 1 del artículo «Artificial intelligence in UK businesses: 2023 to 2026» (CSV)",
        "url": URL,
        "licencia": LICENCIA,
    }
]
PROCEDENCIA = ORIGINAL / ARCHIVO_DE_PROCEDENCIA
CATALOGO = {
    "archivo": "ons-bics-ia-ediciones.html",
    "nivel": "oficial",
    "titulo": "ONS, Artificial intelligence in UK businesses, ediciones publicadas",
    "url": ARTICULO.rsplit("/", 1)[0] + "/previousreleases",
    "licencia": LICENCIA,
}
MAX_CATALOGO_BYTES = 1 << 20
EDICION = {"url": ARTICULO, "publicado": "2026-07-20"}

# Los textos literales de la figura que dicen qué se mide: si cambian, se para.
CABECERA = ["Date", "Percentage of businesses reporting AI use"]
NOTA_DEL_INDICADOR = "AI use is based on businesses reporting use of at least one artificial intelligence technology."
NOTA_DEL_UNIVERSO = "Results include businesses with 10 or more employees."
UNIDAD = "Percentage share (%)"
# Una fila de la serie: el período y su valor.
COLUMNAS_DE_LA_SERIE = 2
MESES = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
]
PERIODO = re.compile(r"(\d{1,2}) (\w+) (\d{4})\s*(?:<br>)?\s*to (\d{1,2}) (\w+) (\d{4})")
INDICADORES_NACIONALES: dict[str, dict[str, object]] = {
    PAIS: indicador_nacional(
        PAIS,
        nombre={
            "es": "Empresas que usan IA (Reino Unido, medida nacional)",
            "ca": "Empreses que fan servir IA (Regne Unit, mesura nacional)",
        },
        definicion={
            "es": "Porcentaje de empresas del Reino Unido con 10 o más personas empleadas que dicen usar ahora al "
            "menos una tecnología de inteligencia artificial de una lista (aprendizaje automático para datos o "
            "imágenes, generación de texto con grandes modelos de lenguaje, creación de contenido visual, robótica, "
            "vehículos autónomos u otra). Encuesta quincenal Business Insights and Conditions Survey de la Office for "
            "National Statistics, estimación ponderada, último período publicado. Es una estadística oficial en "
            "desarrollo, de respuesta voluntaria, y no cubre la agricultura, la energía, las finanzas y los seguros, "
            "la administración pública ni la educación y la sanidad públicas. Es otra pregunta y otro universo que "
            "los de la encuesta europea: no se compara con Europa ni con otros países.",
            "ca": "Percentatge d'empreses del Regne Unit amb 10 o més persones ocupades que diuen que ara fan servir "
            "almenys una tecnologia d'intel·ligència artificial d'una llista (aprenentatge automàtic per a dades o "
            "imatges, generació de text amb grans models de llenguatge, creació de contingut visual, robòtica, "
            "vehicles autònoms o una altra). Enquesta quinzenal Business Insights and Conditions Survey de l'Office "
            "for National Statistics, estimació ponderada, darrer període publicat. És una estadística oficial en "
            "desenvolupament, de resposta voluntària, i no cobreix l'agricultura, l'energia, les finances i les "
            "assegurances, l'administració pública ni l'educació i la sanitat públiques. És una altra pregunta i un "
            "altre univers que els de l'enquesta europea: no es compara amb Europa ni amb altres països.",
        },
        fuente="Office for National Statistics, Business Insights and Conditions Survey (BICS)",
        tabla="Artificial intelligence in UK businesses: 2023 to 2026 · figura 1 · empresas de 10 o más personas",
        licencia=LICENCIA,
        url=ARTICULO,
    )
}
FRASES = {
    "es": ("estadística oficial en desarrollo", "10 o más personas empleadas"),
    "ca": ("estadística oficial en desenvolupament", "10 o més persones ocupades"),
}


class _EdicionesONS(HTMLParser):
    """Los enlaces de resultados con identidad y fecha explícitas de ONS."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.profundidad = 0
        self.bloques = 0
        self.lista = 0
        self.listas = 0
        self.ediciones: list[dict[str, str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        campos = {
            "div": ("id",),
            "ul": ("class",),
            "a": (
                "href",
                "data-gtm-search-result-title",
                "data-gtm-search-result-url",
                "data-gtm-search-result-release-date",
            )
            if self.lista
            else (),
        }.get(tag, ())
        nombres = [clave for clave, _valor in attrs if clave in campos]
        exigir(len(nombres) == len(set(nombres)), "ONS: atributo de identidad duplicado")
        atributos = dict(attrs)
        if tag == "div":
            if self.profundidad:
                self.profundidad += 1
            elif atributos.get("id") == "results":
                self.profundidad = 1
                self.bloques += 1
        if tag == "ul":
            if self.lista:
                self.lista += 1
            elif self.profundidad and "ons-document-list" in (atributos.get("class") or "").split():
                self.lista = 1
                self.listas += 1
        if tag != "a" or not self.lista:
            return
        href = atributos.get("href") or ""
        ruta = urlparse(urljoin(CATALOGO["url"], href))
        prefijo = urlparse(ARTICULO).path.rsplit("/", 1)[0] + "/"
        exigir(
            atributos.get("data-gtm-search-result-title") == "Artificial intelligence in UK businesses"
            and atributos.get("data-gtm-search-result-url") == href
            and ruta.scheme == "https"
            and ruta.netloc == "www.ons.gov.uk"
            and ruta.path.startswith(prefijo)
            and ruta.path != prefijo
            and "/" not in ruta.path[len(prefijo) :]
            and not ruta.query
            and not ruta.fragment,
            "ONS: enlace de edición incoherente",
        )
        fecha = atributos.get("data-gtm-search-result-release-date") or ""
        exigir(re.fullmatch(r"[0-9]{8}", fecha) is not None, "ONS: fecha de publicación inválida")
        try:
            publicado = date.fromisoformat(f"{fecha[:4]}-{fecha[4:6]}-{fecha[6:]}").isoformat()
        except ValueError as error:
            raise FormatoInesperado("ONS: fecha de publicación imposible") from error
        self.ediciones.append({"url": ruta.geturl(), "publicado": publicado})

    def handle_endtag(self, tag: str) -> None:
        if tag == "div" and self.profundidad:
            self.profundidad -= 1
        elif tag == "ul" and self.lista:
            self.lista -= 1


def edicion_del_catalogo(contenido: bytes) -> dict[str, str]:
    """Identifica la publicación más reciente en los resultados del catálogo oficial.

    Returns:
        URL y día de publicación, sin inferirlos del año que aparece en el título.

    Raises:
        FormatoInesperado: Si el catálogo no es UTF-8 o no identifica una edición inequívoca.
    """
    exigir(0 < len(contenido) <= MAX_CATALOGO_BYTES, "ONS: catálogo fuera de tamaño")
    catalogo = _EdicionesONS()
    try:
        catalogo.feed(contenido.decode("utf-8", "strict"))
    except UnicodeDecodeError as error:
        raise FormatoInesperado("ONS: catálogo no es UTF-8") from error
    catalogo.close()
    ediciones = catalogo.ediciones
    exigir(
        catalogo.bloques == 1
        and not catalogo.profundidad
        and catalogo.listas == 1
        and not catalogo.lista
        and bool(ediciones),
        "ONS: catálogo incompleto",
    )
    exigir(len({fila["url"] for fila in ediciones}) == len(ediciones), "ONS: ediciones repetidas")
    ultima = max(ediciones, key=lambda fila: fila["publicado"])
    exigir(sum(fila["publicado"] == ultima["publicado"] for fila in ediciones) == 1, "ONS: última edición ambigua")
    return ultima


def comprobar_edicion(edicion: dict[str, str]) -> None:
    """Aceptar bytes distintos no autoriza una nueva publicación o figura."""
    exigir(
        edicion == EDICION,
        f"ONS: edición anunciada {edicion}; contrato {EDICION}. Revisar método y figura antes de descargar los datos",
    )


def _fecha(dia: str, mes: str, anio: str) -> str:
    """Una fecha en inglés («15 June 2026») en ISO 8601, sin depender del idioma del sistema.

    Returns:
        La fecha, en ISO 8601 (AAAA-MM-DD).

    Raises:
        FormatoInesperado: Si la fecha no existe o el mes es desconocido.
    """
    exigir(mes in MESES, f"ONS: {ARCHIVO}, Date: mes desconocido {mes!r}")
    try:
        return date(int(anio), MESES.index(mes) + 1, int(dia)).isoformat()
    except ValueError as error:
        raise FormatoInesperado(f"ONS: {ARCHIVO}, Date: fecha imposible {dia} {mes} {anio}") from error


def cifra_de_la_figura(texto: str) -> dict[str, Any]:
    """La cifra del último período de la serie, con sus fechas de referencia y las notas literales de la figura.

    Returns:
        La cifra (porcentaje) con sus fechas de referencia y las notas literales de la figura.
    """
    filas = list(csv.reader(io.StringIO(texto)))
    metadatos = {}
    for campo in ("Notes", "Unit"):
        coincidencias = [fila for fila in filas if fila[:1] == [campo]]
        exigir(
            len(coincidencias) == 1 and len(coincidencias[0]) == COLUMNAS_DE_LA_SERIE,
            f"ONS: {ARCHIVO}, {campo}: se espera una fila con dos columnas",
        )
        metadatos[campo] = coincidencias[0][1]
    notas, unidad = metadatos["Notes"], metadatos["Unit"]
    exigir(CABECERA in filas, "ONS: sin la cabecera de la serie")
    serie = []
    referencias = set()
    for fila in filas[filas.index(CABECERA) + 1 :]:
        periodo = PERIODO.fullmatch(fila[0].strip()) if fila else None
        exigir(periodo is not None and len(fila) == COLUMNAS_DE_LA_SERIE, f"ONS: fila inesperada {fila!r:.80}")
        partes = periodo.groups() if periodo else ()
        referencia = (_fecha(*partes[:3]), _fecha(*partes[3:]))
        exigir(referencia[0] <= referencia[1], f"ONS: {ARCHIVO}, Date: período fuera de orden {referencia}")
        exigir(referencia not in referencias, f"ONS: {ARCHIVO}, Date: período repetido {referencia}")
        referencias.add(referencia)
        serie.append((list(referencia), fila[1]))
    exigir(serie, "ONS: la serie está vacía")
    referencia, texto_cifra = max(serie)
    exigir(re.fullmatch(r"\d{1,2}\.\d", texto_cifra) is not None, f"ONS: cifra inesperada {texto_cifra!r}")
    return {
        "valor": float(texto_cifra),
        "anio": int(referencia[1][:4]),
        "referencia": referencia,
        "notas": [nota.strip() for nota in re.split(r"\s*\d\.\s+", notas) if nota.strip()],
        "unidad": unidad,
    }


def descargar(aceptar_cambio: bool = False) -> None:
    """Comprueba la edición anunciada antes de descargar los datos del método conocido."""
    edicion, registrar = descubrir_edicion(
        CATALOGO,
        ORIGINAL,
        redireccion="GBR: URL final del catálogo inesperada",
        leer=edicion_del_catalogo,
        comprobar=comprobar_edicion,
        previo=lambda: descubrimiento_previo_unico(PROCEDENCIA, CATALOGO["archivo"], "GBR"),
    )
    descubrimiento = registrar()
    time.sleep(PAUSA_ENTRE_PETICIONES_S)
    archivos = descargar_originales(ARCHIVOS, ORIGINAL, aceptar_cambio)
    guardar_json(
        PROCEDENCIA,
        {
            "fuente": "Office for National Statistics (ONS)",
            "cita": CITA,
            "licencia": LICENCIA,
            "archivos": archivos,
            "descubrimiento": [descubrimiento],
            "edicion": edicion,
        },
    )


def preparar() -> None:
    """Deja la cifra del último período con sus fechas y las notas de la figura."""
    comprobar_originales(FUENTE)
    cifra = cifra_de_la_figura(original(FUENTE, ARCHIVO).read_text(encoding="utf-8-sig"))
    guardar_json(CIFRAS, {"paises": {PAIS: cifra}})
    print(f"Reino Unido: {cifra['valor']} % ({cifra['referencia'][0]}–{cifra['referencia'][1]})")


def _propios(controles: Controles, cifra: dict[str, Any], _procedencia: dict[str, Any]) -> None:
    """Las notas que dicen qué se mide y en qué universo, literales; el período; la definición que lo dice."""
    controles.comprobar(
        cifra.get("notas") == [NOTA_DEL_INDICADOR, NOTA_DEL_UNIVERSO], "Reino Unido: al menos una tecnología, 10 o más"
    )
    controles.comprobar(cifra.get("unidad") == UNIDAD, "Reino Unido: la cifra es un porcentaje")
    referencia = cifra.get("referencia")
    periodo_valido = False
    if (
        isinstance(referencia, list)
        and len(referencia) == COLUMNAS_DE_LA_SERIE
        and all(isinstance(fecha, str) and re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", fecha) for fecha in referencia)
    ):
        try:
            inicio, fin = (date.fromisoformat(fecha) for fecha in referencia)
        except ValueError:
            pass  # El control del período registra la fecha imposible junto al archivo y campo.
        else:
            periodo_valido = inicio <= fin and cifra.get("anio") == fin.year
    detalle = "" if periodo_valido else "; cifras.json: referencia debe contener dos fechas ISO válidas y ordenadas"
    controles.comprobar(periodo_valido, f"Reino Unido: año del período{detalle}")
    controles_del_indicador(controles, PAIS, INDICADORES_NACIONALES[PAIS], LICENCIA, FRASES)


def validar() -> None:
    """Comprueba la huella, la licencia, la cifra, el año, las notas de la figura y lo que dice la definición."""
    limites = (
        "Estadística oficial en desarrollo, de respuesta voluntaria; solo empresas de 10 o más personas (la cifra de "
        "todas las empresas es otra base). No se compara con Eurostat ni con otros países."
    )
    validar_medida(FUENTE, PAIS, range(2023, hoy_utc().year + 1), _propios, limites)


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
