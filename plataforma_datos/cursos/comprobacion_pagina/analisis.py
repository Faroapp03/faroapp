"""Análisis local del cuerpo de una página: señales literales, aparición del título y datos incrustados.

Todo se calcula del cuerpo y del título publicado; no hay red ni reloj, así que repetir el análisis da lo mismo.
"""

import hashlib
import json
import re
import unicodedata
from dataclasses import dataclass

from plataforma_datos.cursos.comprobacion_pagina.documento import leer_documento
from plataforma_datos.cursos.comprobacion_pagina.reconocedores import Reconocedor

PALABRAS_VACIAS = frozenset(
    {"a", "al", "ante", "con", "de", "del", "desde", "el", "en", "entre", "hacia", "hasta", "la", "las", "lo", "los"}
    | {"para", "por", "que", "se", "sin", "sobre", "tu", "tus", "un", "una", "unos", "unas", "y", "o", "e", "u", "i"}
    | {"amb", "als", "dels", "per", "les", "els", "uns", "tes", "teu", "teva", "com", "como"}
    | {"the", "and", "of", "to", "for", "with", "in", "on", "your", "an", "how"}
)
LONGITUD_MINIMA_DE_PALABRA = 3
# Fracción de las palabras principales del título que deben estar en la página para darlo por presente.
FRACCION_DE_TITULO = 0.8
MAX_SENAL = 120

COMPLETO = "completo"
PALABRAS_PRINCIPALES = "palabras_principales"
AUSENTE = "ausente"


def normalizar(texto: str) -> str:
    """Pasa a minúsculas y quita las tildes.

    Returns:
        El texto sin marcas combinadas.
    """
    descompuesto = unicodedata.normalize("NFKD", texto)
    return "".join(c for c in descompuesto if not unicodedata.combining(c)).lower()


# Normaliza carácter a carácter para que un hallazgo en el texto normalizado sea el mismo en el original.
def _normalizar_sin_cambiar_longitud(texto: str) -> str:
    return "".join(normalizar(c)[:1] or " " for c in texto)


def palabras(texto: str) -> list[str]:
    """Las palabras de un texto: letras y cifras sin tildes ni mayúsculas.

    Returns:
        La lista de palabras en el orden del texto.
    """
    return re.findall(r"[a-z0-9]+", normalizar(texto))


@dataclass(frozen=True, kw_only=True)
class Senal:
    """Una frase literal de la página que dice algo del curso y el idioma del patrón que la reconoció."""

    idioma: str
    frase: str


@dataclass(frozen=True, kw_only=True)
class DatosDelCurso:
    """El curso que la página incrusta en sus datos, con su estado de publicación."""

    nombre: str
    estado: str | None
    privacidad: str | None
    titulo_coincide: bool


@dataclass(frozen=True, kw_only=True)
class Analisis:
    """Lo que se lee de una página: su texto, su título, sus señales y los datos que incrusta.

    `hay_datos_next`: la página trae `__NEXT_DATA__`. `datos_legibles`: se pudo leer como JSON. `datos_del_curso`: el
    curso que incrusta, si lo hay. `apertura_propia`: la señal de ficha abierta que declara el reconocedor de su fuente.
    """

    longitud_texto: int
    huella_texto: str
    titulo: str
    scripts: int
    hay_datos_next: bool
    datos_legibles: bool
    datos_del_curso: DatosDelCurso | None
    cierre: tuple[Senal, ...]
    apertura: tuple[Senal, ...]
    apertura_propia: tuple[Senal, ...]


# La primera aparición de cada patrón en el texto normalizado, con el literal de la página.
def _senales(patrones: tuple[tuple[str, str], ...], texto: str, normalizado: str) -> tuple[Senal, ...]:
    halladas = []
    for idioma, patron in patrones:
        coincidencia = re.search(patron, normalizado)
        if coincidencia:
            literal = texto[coincidencia.start() : coincidencia.end()]
            halladas.append(Senal(idioma=idioma, frase=literal[:MAX_SENAL]))
    return tuple(halladas)


# Las frases de menú o de pie se tapan con espacios, así que no cuentan y el resto del texto no se desplaza.
def _sin_plantilla(normalizado: str, plantilla: tuple[str, ...]) -> str:
    for frase in plantilla:
        normalizado = normalizado.replace(frase, " " * len(frase))
    return normalizado


# Si el título publicado aparece entero, con sus palabras principales o no aparece en lo que muestra la página.
def _aparicion_del_titulo(titulo: str, visible: str) -> str:
    todas = palabras(titulo)
    principales = [p for p in todas if p not in PALABRAS_VACIAS and len(p) >= LONGITUD_MINIMA_DE_PALABRA]
    en_la_pagina = palabras(visible)
    if todas and " ".join(todas) in " ".join(en_la_pagina):
        return COMPLETO
    if principales and sum(p in set(en_la_pagina) for p in principales) / len(principales) >= FRACCION_DE_TITULO:
        return PALABRAS_PRINCIPALES
    return AUSENTE


# Lee `props.pageProps.initialCourseData` de los datos de Next.js, si están y son legibles.
def _datos_del_curso(datos_next: str | None, titulo: str) -> tuple[bool, DatosDelCurso | None]:
    if datos_next is None:
        return False, None
    try:
        datos = json.loads(datos_next)
    except ValueError:
        return False, None
    paginas = datos.get("props") if isinstance(datos, dict) else None
    propiedades = paginas.get("pageProps") if isinstance(paginas, dict) else None
    curso = propiedades.get("initialCourseData") if isinstance(propiedades, dict) else None
    if not isinstance(curso, dict):
        return True, None
    nombre = str(curso.get("name") or "")
    return True, DatosDelCurso(
        nombre=nombre,
        estado=curso.get("status"),
        privacidad=curso.get("privacyLevel"),
        titulo_coincide=palabras(nombre) == palabras(titulo),
    )


def analizar(cuerpo: bytes, tipo: str | None, titulo: str, reconocedor: Reconocedor) -> Analisis:
    """Analiza el cuerpo de una página con lo que declara el reconocedor de su fuente.

    Returns:
        Las medidas, las señales y los datos incrustados de la página.
    """
    documento = leer_documento(cuerpo, tipo)
    normalizado = _normalizar_sin_cambiar_longitud(documento.texto)
    propio = _sin_plantilla(normalizado, reconocedor.plantilla)
    visible = f"{documento.texto} {documento.titulo} {documento.titulo_social}"
    propia = () if reconocedor.apertura_propia is None else (("", reconocedor.apertura_propia),)
    legibles, datos = _datos_del_curso(documento.datos_next, titulo)
    return Analisis(
        longitud_texto=len(documento.texto),
        huella_texto=hashlib.sha256(re.sub(r"\d+", "0", normalizado).encode()).hexdigest(),
        titulo=_aparicion_del_titulo(titulo, visible),
        scripts=documento.scripts,
        hay_datos_next=documento.datos_next is not None,
        datos_legibles=legibles,
        datos_del_curso=datos,
        cierre=_senales(reconocedor.cierre(), documento.texto, propio),
        apertura=_senales(reconocedor.apertura(), documento.texto, propio),
        apertura_propia=_senales(propia, documento.texto, propio),
    )
