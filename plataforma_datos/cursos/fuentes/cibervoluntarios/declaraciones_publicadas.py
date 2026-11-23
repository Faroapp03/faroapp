"""Lee declaraciones estáticas de autoformación, sin ejecutar JavaScript remoto.

Reconoce el formato publicado de los diccionarios y la ruta española propia.
Una declaración distinta o sin vínculo queda desconocida; no busca «gratis» en
otras secciones, ni atribuye la gratuidad a prácticas, productos o certificados.
"""

import json
import re
from html.parser import HTMLParser
from urllib.parse import urlsplit

from plataforma_datos.comun.nucleo import FormatoInesperado
from plataforma_datos.cursos.contrato_entrega_catalogo import exigir
from plataforma_datos.cursos.tipos_json import ObjetoJson

PORTADA = "https://www.cibervoluntarios.org/es/formacion-gratuita/aprende-a-tu-ritmo"
RUTA_CURSO = "formacion-gratuita/aprende-a-tu-ritmo/cursos/:slug"
MODULO = re.compile(r"https://frontend\.cibervoluntarios\.org/vite/assets/main-[A-Za-z0-9_-]+\.js")
LITERALES = {
    "formacion": (
        "Sigue aprendiendo con Cibervoluntarios a tu ritmo desde nuestra plataforma. "
        "Accede desde tu teléfono móvil, ordenador o tablet. Te proponemos cursos gratuitos a elegir. "
        "Hazlo a tu ritmo, evalúa tus conocimientos y mejora tus competencias digitales "
        "con Cibervoluntarios. ¡Adelante!"
    ),
    "requisitos": (
        "Tus ganas de aprender y una conexión a Internet son lo único que necesitas para empezar a aprender. "
        "Puedes hacer el curso que más te interese desde casa, el autobús, la playa o la universidad"
    ),
    "registro": "Para comenzar el curso debes registrarte primero ;)",
}


class _Portada(HTMLParser):
    """Recoge únicamente módulos externos de la página pública, sin ejecutarlos."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.modulos: list[str] = []
        self.cerrada = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        """Conserva la URL del módulo principal, nunca píxeles o analítica."""
        valores = dict(attrs)
        if tag == "script" and valores.get("type") == "module" and isinstance(valores.get("src"), str):
            self.modulos.append(valores["src"])

    def handle_endtag(self, tag: str) -> None:
        """Exige el cierre del documento aportado."""
        if tag == "html":
            self.cerrada = True


def modulo_publicado(cuerpo: bytes, meta: ObjetoJson) -> str:
    """Selecciona un único módulo enlazado por la portada española exacta.

    Returns:
        URL del módulo autorizado; no se sigue ni interpreta otro destino.

    Raises:
        FormatoInesperado: Si la portada no conserva UTF8.
    """
    exigir(meta["url"] == meta["url_final"] == PORTADA, "Portada Ciber ajena")
    return modulo_enlazado(cuerpo)


def modulo_enlazado(cuerpo: bytes) -> str:
    """Lee el módulo de HTML ya vinculado por su recepción a una ruta permitida.

    Returns:
        Módulo principal único, sin ejecutar nada.

    Raises:
        FormatoInesperado: Si el HTML no es UTF8 o no conserva su módulo.
    """
    pagina = _Portada()
    try:
        pagina.feed(cuerpo.decode("utf-8"))
        pagina.close()
    except UnicodeError as error:
        raise FormatoInesperado("Portada Ciber sin UTF8") from error
    exigir(pagina.cerrada and len(pagina.modulos) == 1 and MODULO.fullmatch(pagina.modulos[0]), "Módulo Ciber ambiguo")
    return pagina.modulos[0]


def _objeto(texto: str, inicio: int) -> tuple[str, int]:
    # El formato de diccionario reconocido solo contiene objetos, funciones y
    # literales entre comillas. No interpreta expresiones, plantillas o regex.
    patron = r""""(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[{}]|`|//|/\*"""
    profundidad = 0
    for token in re.finditer(patron, texto[inicio:]):
        valor = token[0]
        if valor == "{":
            profundidad += 1
        elif valor == "}":
            profundidad -= 1
            if profundidad == 0:
                fin = inicio + token.end()
                return texto[inicio:fin], fin
        elif valor in ("`", "//", "/*"):
            raise FormatoInesperado("Formato de diccionario Ciber no reconocido")
    raise FormatoInesperado("Diccionario Ciber sin cierre")


def _secciones(texto: str, nombre: str) -> list[tuple[str, int]]:
    return [(_objeto(texto, m.end() - 1)[0], m.end() - 1) for m in re.finditer(r"(?:^|[,{])" + nombre + r":\{", texto)]


def _literal(texto: str, clave: str) -> tuple[str, int, int] | None:
    patron = (
        r"(?:^|[,{])"
        + re.escape(clave)
        + r':([A-Za-z_$][\w$]*)=>\{const\{normalize:([A-Za-z_$][\w$]*)\}=\1;return \2\(\[("(?:[^"\\]|\\.)*")\]\)\}'
    )
    coincidencias = list(re.finditer(patron, texto))
    if len(coincidencias) != 1:
        return None
    m = coincidencias[0]
    return json.loads(m[3]), m.start(3), m.end(3)


def _training(codigo: str) -> tuple[str, int] | None:
    candidatas = []
    for objeto, inicio in _secciones(codigo, "training1"):
        secciones = _secciones(objeto, "atyourpace")
        if len(secciones) == 1:
            titulo = _literal(secciones[0][0], "title")
            if titulo is not None and titulo[0] == "APRENDE A TU RITMO":
                candidatas.append((objeto, inicio))
    return candidatas[0] if len(candidatas) == 1 else None


def extraer(portada: bytes, meta_portada: ObjetoJson, codigo: bytes, meta_codigo: ObjetoJson) -> ObjetoJson:
    """Liga portada, módulo y ruta propias antes de leer tres declaraciones exactas.

    Returns:
        Declaraciones reconocidas con localizador de caracteres UTF8 decodificados;
        los cambios o ausencias conservan null y nunca renuevan una afirmación.

    Raises:
        FormatoInesperado: Si el código no conserva UTF8 o el formato estático reconocido.
    """
    url = modulo_publicado(portada, meta_portada)
    exigir(meta_codigo["url"] == meta_codigo["url_final"] == url and not urlsplit(url).fragment, "Código Ciber ajeno")
    try:
        texto = codigo.decode("utf-8")
    except UnicodeError as error:
        raise FormatoInesperado("Declaraciones Ciber sin UTF8") from error
    ruta = 'path:"' + RUTA_CURSO + '",name:"es.training-atyourpace-course"'
    rutas = [m.start() for m in re.finditer(re.escape(ruta), texto)]
    resultado = {
        "url_modulo": url,
        "ruta_curso": RUTA_CURSO if len(rutas) == 1 else None,
        "declaraciones": dict.fromkeys(LITERALES),
    }
    training = _training(texto)
    if training is None or len(rutas) != 1:
        return resultado
    objeto, inicio = training
    for nombre, seccion, clave in (
        ("formacion", "atyourpace", "screens_text"),
        ("requisitos", "atyourpace", "customized_img_2_text"),
        ("registro", "register_form", "title_atyourpace"),
    ):
        bloques = _secciones(objeto, seccion)
        literal = _literal(bloques[0][0], clave) if len(bloques) == 1 else None
        if literal is not None and literal[0] == LITERALES[nombre]:
            desde = inicio + bloques[0][1] + literal[1]
            resultado["declaraciones"][nombre] = {
                "literal": literal[0],
                "localizador": f"caracteres:{desde}:{desde + literal[2] - literal[1]}",
                "campo": "es.training1." + seccion + "." + clave,
                "alcance": "declaracion_general_de_autoformacion",
            }
    return resultado
