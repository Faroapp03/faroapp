"""Lo que el robots.txt de un sitio deja leer a un programa, con comodines y la regla más larga (RFC 9309).

`urllib.robotparser` no entiende los comodines «*» ni el final «$», y el BOE los usa en cientos de reglas: con él, una
dirección prohibida podría parecer permitida. Aquí cada regla se compara como patrón, la más larga manda y, a igual
longitud, gana la que permite. Las reglas que se aplican son las del grupo con el nombre de producto del agente de
usuario que envían las descargas (`red.AGENTE`) o, si el robots.txt no lo nombra, las del grupo «*». Python
estándar.

El robots.txt lo escribe un sitio ajeno: sus patrones no se convierten en expresiones regulares (un patrón con muchos
«*» haría que una expresión con retroceso tardase un tiempo polinómico en la longitud de la ruta, CWE-1333). El patrón
se parte por sus «*» y cada trozo se busca lo más a la izquierda posible tras el anterior, sin volver atrás. Antes de
comparar, la ruta y el patrón se normalizan como pide el apartado 2.2.2 de la RFC 9309: lo que no es ASCII se codifica
en UTF-8 con «%XX» y un «%XX» de un carácter no reservado (RFC 3986, apartado 2.3) se descodifica; los demás se dejan
codificados, con la cifra hexadecimal en mayúsculas.
"""

import re
import string
from urllib.parse import urlsplit

from plataforma_datos.comun.red import AGENTE

TODOS = "*"
COMODIN = "*"
FINAL = "$"
# Los caracteres no reservados de la RFC 3986 (apartado 2.3): codificados o no, son el mismo.
NO_RESERVADOS = frozenset(string.ascii_letters + string.digits + "-._~")
ESCAPE = re.compile(r"%([0-9A-Fa-f]{2})")


def _grupos(texto: str) -> dict[str, list[tuple[bool, str]]]:
    """Las reglas `(permite, patrón)` de cada agente; varios `User-agent` seguidos comparten las mismas.

    Returns:
        {agente: reglas (permite, patrón)}.
    """
    grupos: dict[str, list[tuple[bool, str]]] = {}
    agentes: list[str] = []
    con_reglas = False
    for linea in texto.splitlines():
        sin_comentario = linea.split("#", 1)[0].strip()
        if ":" not in sin_comentario:
            continue
        clave, valor = (parte.strip() for parte in sin_comentario.split(":", 1))
        clave = clave.lower()
        if clave == "user-agent":
            if con_reglas:
                agentes, con_reglas = [], False
            agentes.append(valor.lower())
            grupos.setdefault(valor.lower(), [])
        elif clave in ("allow", "disallow"):
            con_reglas = True
            # «Disallow:» sin ruta no prohíbe nada: no es una regla.
            for agente in agentes if valor else ():
                grupos[agente].append((clave == "allow", valor))
    return grupos


def normalizar(texto: str) -> str:
    """La forma en que se comparan rutas y patrones (RFC 9309, 2.2.2): un mismo octeto se escribe siempre igual.

    Returns:
        La ruta o el patrón normalizado.
    """
    en_ascii = "".join(
        letra if letra.isascii() else "".join(f"%{octeto:02X}" for octeto in letra.encode()) for letra in texto
    )

    def _escape(encontrado: re.Match[str]) -> str:
        caracter = chr(int(encontrado[1], 16))
        return caracter if caracter in NO_RESERVADOS else f"%{encontrado[1].upper()}"

    return ESCAPE.sub(_escape, en_ascii)


def _coincide(patron: str, ruta: str) -> bool:
    """Si la ruta empieza como el patrón, donde «*» es cualquier texto y un «$» final obliga a terminar ahí.

    Ambos llegan normalizados. Con «*» como único comodín, buscar cada trozo lo más a la izquierda posible tras el
    anterior nunca pierde una coincidencia: deja a los trozos siguientes la mayor parte de la ruta. Cada búsqueda
    empieza donde acabó la anterior y no se vuelve atrás: la ruta se recorre una vez, tenga el patrón los «*» que tenga.

    Returns:
        True si la ruta casa con el patrón.
    """
    final = patron.endswith(FINAL)
    primero, *resto = (patron[: -len(FINAL)] if final else patron).split(COMODIN)
    if not ruta.startswith(primero):
        return False
    if not resto:
        return not final or len(ruta) == len(primero)
    ultimo = resto.pop()
    posicion = len(primero)
    for trozo in resto:
        hallado = ruta.find(trozo, posicion)
        if hallado < 0:
            return False
        posicion = hallado + len(trozo)
    if final:
        return len(ruta) - len(ultimo) >= posicion and ruta.endswith(ultimo)
    return ruta.find(ultimo, posicion) >= 0


def nombre_de_producto(agente: str) -> str:
    """El nombre que busca un agente de usuario en un robots.txt: su primera palabra, sin versión y en minúsculas.

    Returns:
        El nombre de producto en minúsculas.
    """
    return re.split(r"[/\s]", agente.strip(), maxsplit=1)[0].lower()


def permitido(texto_robots: str, url: str, agente: str = AGENTE) -> bool:
    """Si el robots.txt `texto_robots` deja pedir `url` al agente de usuario `agente`, el que se envía por defecto.

    Sin ninguna regla que coincida, se permite. La ruta incluye la consulta («?id=…»), como la compara el sitio.

    Returns:
        True si la regla más específica que casa con la ruta la permite (o si ninguna casa).
    """
    partes = urlsplit(url)
    ruta = normalizar((partes.path or "/") + (f"?{partes.query}" if partes.query else ""))
    grupos = _grupos(texto_robots)
    reglas = grupos.get(nombre_de_producto(agente), grupos.get(TODOS, []))
    mejor: tuple[int, bool] | None = None
    for permite, original in reglas:
        patron = normalizar(original)
        if _coincide(patron, ruta):
            candidata = (len(patron), permite)
            mejor = candidata if mejor is None or candidata > mejor else mejor
    return True if mejor is None else mejor[1]
