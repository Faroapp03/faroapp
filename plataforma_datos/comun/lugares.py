"""Lugares de las fuentes: zona común, códigos territoriales y municipio legible.

Los conjuntos del Consorci publican el municipio en mayúsculas («L'HOSPITALET DE LLOBREGAT») con sus códigos INE y de
comarca. Faro no ordena por lugar (no sabe dónde vive la persona): el lugar se enseña en cada curso y la comarca solo
sirve para comprobar que una edición presencial es de Cataluña. Las fuentes de ocupación y formación comparten la
zona de Cornellà, Baix Llobregat y Barcelonès; los códigos de comarca coinciden en Idescat y Observatori, y el código
INE de la comunidad autónoma se conserva aparte de los códigos de municipio. Python estándar.
"""

from plataforma_datos.comun.textos_y_cifras import texto

# Palabras que van en minúscula en el nombre de un municipio catalán («Sant Joan Despí», «Vilanova i la Geltrú»).
PARTICULAS_MUNICIPIO = frozenset({"de", "del", "dels", "la", "les", "el", "els", "i", "a", "en"})
ELISIONES_MUNICIPIO = frozenset({"d", "l"})
# Prefijo provincial del código INE de un municipio de Cataluña: Barcelona, Girona, Lleida y Tarragona.
PROVINCIAS_DE_CATALUNA = ("08", "17", "25", "43")
# Zona que describen los bloques: las mismas comarcas oficiales en Idescat y Observatori, en este orden.
COMARCAS_DE_LA_ZONA = {"11": "Baix Llobregat", "13": "Barcelonès"}
# Comunidad autónoma de Cataluña en las tablas del INE; no es un código de municipio ni de Tempus.
CODIGO_INE_DE_CATALUNA = "09"


def municipio_legible(nombre: str) -> str:
    """Capitaliza un municipio en mayúsculas, con partículas y elisiones mediante apóstrofo recto.

    Aplica reglas tipográficas, sin consultar un nomenclátor: no garantiza la forma oficial de cada nombre.

    Returns:
        El nombre capitalizado, como «L'Hospitalet de Llobregat».
    """
    palabras: list[str] = []
    for posicion, palabra in enumerate(texto(nombre).lower().split(" ")):
        elision, apostrofo, resto = palabra.rpartition("'")
        if apostrofo and elision in ELISIONES_MUNICIPIO:
            inicial = elision.capitalize() if posicion == 0 else elision
            palabras.append(f"{inicial}'{resto.capitalize()}")
        elif posicion and palabra in PARTICULAS_MUNICIPIO:
            palabras.append(palabra)
        else:
            palabras.append(palabra.capitalize())
    return " ".join(palabras)


def comarca_en_cataluna(codigo_municipio: str, codigo_comarca: str) -> str | None:
    """La comarca que publica el Consorci si el municipio es de Cataluña (por su código INE); si no, None.

    Recibe códigos de municipio válidos de la fuente; aquí se comprueba únicamente el prefijo provincial.

    Returns:
        La comarca, o None si el municipio no es de Cataluña.
    """
    if not texto(codigo_municipio).startswith(PROVINCIAS_DE_CATALUNA):
        return None
    return texto(codigo_comarca) or None
