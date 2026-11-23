"""La sonda de un dominio: una ficha que no puede existir, para reconocer los sitios que responden 200 a todo.

Algunos sitios devuelven una página corriente, con su menú y su pie, ante cualquier dirección. Pedir una ficha
inventada con la misma forma que las reales dice cómo responde ese sitio a lo inexistente: una página de un curso que
responde igual que la sonda no es una ficha, es el molde del sitio.

La dirección de la sonda es una función de la dirección de un curso y de una semilla que llega como dato, así que
repetir la petición da la misma sonda.
"""

import hashlib
import re
from dataclasses import dataclass
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

DIGITOS = "0123456789"
MAYUSCULAS_Y_DIGITOS = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789"
MINUSCULAS = "abcdefghijklmnopqrstuvwxyz"
LONGITUD_MINIMA_NUMERICA = 8
LONGITUD_DEL_CODIGO = 6
LONGITUD_DEL_NOMBRE = 10
# Marcas que ningún identificador real lleva y que dejan claro que la dirección es inventada.
PREFIJO_NUMERICO = "9"
PREFIJO_DEL_CODIGO = "ZZ"
PREFIJO_DEL_NOMBRE = "no-existe-"


# Elige `cantidad` símbolos del alfabeto de forma determinista a partir de la semilla y la dirección.
def _elegir(alfabeto: str, cantidad: int, semilla: str, url: str) -> str:
    simbolos: list[str] = []
    bloque = 0
    while len(simbolos) < cantidad:
        resumen = hashlib.sha256(f"{semilla}|{url}|{bloque}".encode()).digest()
        simbolos.extend(alfabeto[octeto % len(alfabeto)] for octeto in resumen)
        bloque += 1
    return "".join(simbolos[:cantidad])


# Un valor de parámetro con la misma forma que el real y que no puede existir.
def _valor_inexistente(valor: str, semilla: str, url: str) -> str:
    if re.fullmatch(r"\d+", valor):
        return PREFIJO_NUMERICO + _elegir(DIGITOS, max(len(valor), LONGITUD_MINIMA_NUMERICA), semilla, url)
    cifras = iter(_elegir(DIGITOS, len(re.findall(r"\d", valor)), semilla, url))
    return PREFIJO_DEL_CODIGO + re.sub(r"\d", lambda _: next(cifras), valor)


# El último trozo del camino con la misma forma que el real (número, código en mayúsculas o nombre).
def _segmento_inexistente(segmento: str, semilla: str, url: str) -> str:
    if re.fullmatch(r"\d+", segmento):
        return PREFIJO_NUMERICO + _elegir(DIGITOS, max(len(segmento), LONGITUD_MINIMA_NUMERICA), semilla, url)
    if re.fullmatch(r"[A-Z0-9]+", segmento):
        return PREFIJO_DEL_CODIGO + _elegir(MAYUSCULAS_Y_DIGITOS, LONGITUD_DEL_CODIGO, semilla, url)
    return PREFIJO_DEL_NOMBRE + _elegir(MINUSCULAS, LONGITUD_DEL_NOMBRE, semilla, url)


def url_de_la_sonda(url: str, semilla: str) -> str:
    """La dirección de una ficha inexistente con la misma forma que la de un curso real del dominio.

    Si la dirección lleva parámetros, cambia el valor del último; si no, el último trozo del camino. Se descarta el
    fragmento, que nunca llega al servidor.

    Returns:
        La dirección de la sonda; la misma para la misma dirección y la misma semilla.
    """
    partes = urlsplit(url)
    consulta = parse_qsl(partes.query, keep_blank_values=True)
    if consulta:
        clave, valor = consulta[-1]
        consulta[-1] = (clave, _valor_inexistente(valor, semilla, url))
        return urlunsplit((partes.scheme, partes.netloc, partes.path, urlencode(consulta), ""))
    segmentos = partes.path.rstrip("/").split("/")
    segmentos[-1] = _segmento_inexistente(segmentos[-1], semilla, url)
    return urlunsplit((partes.scheme, partes.netloc, "/".join(segmentos), "", ""))


@dataclass(frozen=True, kw_only=True)
class Huellas:
    """Lo que identifica una respuesta para compararla con otra: su estado, su cuerpo y su texto visible.

    La huella del texto no cuenta las cifras, porque una página de molde puede repetir en el texto el identificador.
    """

    http: int | None
    sha256_cuerpo: str
    huella_texto: str
    longitud_texto: int
    longitud_cuerpo: int


def es_igual_a_la_sonda(pagina: Huellas, sonda: Huellas | None) -> bool:
    """Si la página responde exactamente como el sitio responde a lo inexistente.

    Es igual si tiene el mismo estado HTTP y el mismo cuerpo o el mismo texto visible. Un cuerpo o un texto vacíos no
    se comparan: dos páginas vacías no dicen que sean la misma.

    Returns:
        Verdadero si la sonda existe y la página es igual a ella.
    """
    if sonda is None or sonda.http != pagina.http:
        return False
    mismo_cuerpo = pagina.longitud_cuerpo > 0 and sonda.sha256_cuerpo == pagina.sha256_cuerpo
    mismo_texto = pagina.longitud_texto > 0 and sonda.huella_texto == pagina.huella_texto
    return mismo_cuerpo or mismo_texto
