"""Lo que la acreditación lee del BOE: el texto de cada real decreto de certificados y, en él, el anexo de cada uno.

Cada certificado de profesionalidad es un anexo de su real decreto, con su código, su nivel, sus unidades de competencia
y la lista «Ocupaciones o puestos de trabajo relacionados». Esa lista es la relación oficial entre ocupación y
certificado, y usa la codificación de su época:
- «4111.1011» (o «41111011» desde 2011): código CO-SISPE de la CNO-11, el mismo que Faro tiene para cada ocupación ESCO
  por la tabla EURES;
- «5330.001.0» y los de 8 cifras anteriores a 2011: SISPE de la CNO-94, que solo se une por su grupo, con la tabla de
  correspondencia del INE;
- sin código («Auxiliar de oficina.»): se conserva el texto, pero no relaciona ninguna ocupación.
El texto sale del HTML consolidado (los reales decretos desde 2009) o del PDF original (los de 2008, cuyo consolidado
no trae los anexos). Python estándar.
"""

import re
from datetime import date
from html.parser import HTMLParser
from typing import Literal, NamedTuple

from plataforma_datos.comun.nucleo import FormatoInesperado
from plataforma_datos.comun.periodos import MESES_ES

# Etiquetas que empiezan una línea del texto, como un párrafo del BOE o una celda de sus tablas.
BLOQUES = frozenset({"p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "td", "th", "tr", "div", "br", "dt", "dd"})
OMITIDAS = frozenset({"script", "style", "noscript", "head"})
# Una referencia a un real decreto de certificados en el análisis del Real Decreto 189/2013: lo que modifica son «los
# apartados III y IV de los anexos del Real Decreto …» (las demás referencias, como la del Real Decreto 34/2008, no
# nombran sus anexos).
PATRON_REFERENCIA = re.compile(
    r"anexos? del Real Decreto (\d+)/(\d{4}), de (\d{1,2}) de ([a-z]+)[^(]*?\(Ref\. (BOE-A-\d{4}-\d+)", re.IGNORECASE
)
# El PDF original de una disposición, por su ELI («is_embodied_by»): el robots.txt del BOE cierra algunos días de
# /boe/dias/ enteros, pero no el ELI de las disposiciones.
PATRON_PDF = re.compile(r'resource="(https://www\.boe\.es/eli/[a-z0-9/]+/dof/spa/pdf)"')
PATRON_TITULO = re.compile(r"Real Decreto (\d+)/(\d{4}), de (\d{1,2}) de ([a-z]+)", re.IGNORECASE)
# Líneas del principio de una página en que se busca su título: va antes del texto de la disposición.
LINEAS_DEL_TITULO = 200
# Partes del anexo de un certificado.
INICIO_DE_ANEXO = re.compile(r"^C[óo]digo\s*:?\s*([A-Za-z]{4}\d{4})(?:_\d)?\b")
NIVEL = re.compile(r"^Nivel de cualificaci[óo]n profesional\s*:\s*(\d)")
DENOMINACION = re.compile(r"^Denominaci[óo]n\s*:\s*(.+?)$", re.IGNORECASE)
# Un código de unidad de competencia al principio de un renglón, tal como lo escribe el BOE: «UC0249_2: nombre» y sus
# variantes, con espacios dentro («UC 1518_3», «UC0875 _3», «UC1462_ 2»), con guion o espacio antes del nivel
# («UC2173-3», «UC0250 2») y con erratas que no se pueden corregir sin adivinar: cifras de menos o de más («UC987_3»,
# «UC14789_3») o sin nivel («UC0490»).
UNIDAD = re.compile(
    r"^(?P<publicado>UC\s*(?P<cifras>\d+)(?:(?:\s*[_\-]\s*|\s+)(?P<nivel>\d))?)(?!\d)"
    r"\s*(?P<dos_puntos>:)?\s*(?P<nombre>.*?)\.?$"
)
CIFRAS_DE_UNIDAD = 4
# El título de la lista, con las variantes que publica el BOE: «Otras ocupaciones…», «Ocupación o puestos…»,
# «relevantes», sin calificativo, con una errata («v» por «y») y hasta con una nota de edición («Faltan códigos»).
CALIFICATIVOS = "relacionados|relevantes"
OCUPACIONES = re.compile(
    rf"^(?:Otras )?Ocupaci(?:ón|ones) [oyv] puestos? de trabajo(?: (?:{CALIFICATIVOS}))?\s*[:.]*"
    r"(?: Faltan códigos)?$",
    re.IGNORECASE,
)
# El mismo título partido en dos renglones («Ocupaciones y puestos de trabajo» / «relacionados.»).
OCUPACIONES_PARTIDO = re.compile(r"^Ocupaciones (?:o|y) puestos? de trabajo$", re.IGNORECASE)
# El segundo renglón de ese título partido: solo el calificativo.
CALIFICATIVO_SUELTO = re.compile(rf"^(?:{CALIFICATIVOS})[.:]*$")
# Renglones como mucho entre el código de un certificado y el final de su lista de ocupaciones.
LINEAS_DE_CABECERA = 400
# Renglones antes del código de un certificado en que se busca su denominación, que puede ocupar varios.
LINEAS_DE_LA_DENOMINACION = 4
UNIDADES = re.compile(r"^Relaci[óo]n de unidades de competencia", re.IGNORECASE)
# El título que sigue a la lista de unidades, que el BOE publica con dos puntos, con punto o sin nada.
TRAS_LAS_UNIDADES = re.compile(r"^(Competencia general|Entorno profesional)\b", re.IGNORECASE)
# Varias unidades en un mismo renglón («…red telemática.UC0229_3: Coordinar…»): se separan antes de cada código seguido
# de «:», con las mismas variantes que UNIDAD.
OTRA_UNIDAD = re.compile(r"(?<=\S)\s*(?=UC\s*\d+(?:(?:\s*[_\-]\s*|\s+)\d)?\s*:)")
# Lo que cierra la lista de ocupaciones: la línea siguiente del anexo.
FIN_DE_OCUPACIONES = re.compile(
    r"^(Requisitos necesarios|Duraci[óo]n de la formaci[óo]n|Relaci[óo]n de m[óo]dulos|II\. PERFIL|2\. PERFIL)",
    re.IGNORECASE,
)
# Lo que no es una ocupación dentro de la lista: la nota sobre el género gramatical y las viñetas.
NOTA_DE_GENERO = re.compile(r"^Los términos de la siguiente relación")
VINETA = re.compile(r"^[−–•·\-]\s*")
# Las formas de un código de ocupación al principio de una línea, de la más larga a la más corta.
FormaDelCodigo = Literal["4.4", "4.3.1", "8", "4"]
FORMAS_DE_CODIGO: tuple[tuple[FormaDelCodigo, re.Pattern[str]], ...] = (
    ("4.3.1", re.compile(r"^(\d{4})\.(\d{3})\.(\d)\s+(.+)$")),
    ("4.4", re.compile(r"^(\d{4})\.(\d{4})\s+(.+)$")),
    ("8", re.compile(r"^(\d{8})\s+(.+)$")),
    ("4", re.compile(r"^(\d{4})\s+(\D.+)$")),
)
# Anexo XIII-a del Real Decreto 151/2022: unidades suprimidas y sus equivalentes actuales.
INICIO_EQUIVALENCIAS = re.compile(r"^ANEXO XIII\s*[–-]\s*a$")
FIN_EQUIVALENCIAS = re.compile(r"^ANEXO XIII\s*[–-]\s*b$")
# La cabecera de cada página de un PDF del BOE: número de página, fecha y número del diario, en cualquier orden.
DIAS_DE_LA_SEMANA = "Lunes|Martes|Miércoles|Jueves|Viernes|Sábado|Domingo"
CABECERA_DE_PAGINA = re.compile(
    rf"({DIAS_DE_LA_SEMANA}) \d{{1,2}} [a-z]+ \d{{4}}.*BOE núm\. \d+"
    rf"|BOE núm\. \d+ .*({DIAS_DE_LA_SEMANA}) \d{{1,2}} [a-z]+ \d{{4}}"
)


class Disposicion(NamedTuple):
    """Un real decreto: su número, su año, su fecha (AAAA-MM-DD) y su identificador del BOE."""

    numero: str
    anio: int
    fecha: str
    boe: str


class Ocupacion(NamedTuple):
    """Una línea de «Ocupaciones o puestos de trabajo relacionados», con su código tal como viene.

    `codigo` son las cifras del código, sin puntos (None si la línea no trae código); `forma`, cómo estaba escrito:
    «4.4» («4111.1011», CO-SISPE de la CNO-11), «4.3.1» («5330.001.0», SISPE de la CNO-94), «8» (ocho cifras seguidas,
    de una época o de otra según el año) o «4» (solo el grupo). Qué clasificación es lo decide quien la lee, con el año
    de la disposición y las tablas oficiales.
    """

    codigo: str | None
    texto: str
    forma: FormaDelCodigo | None


class TablasDeClasificacion(NamedTuple):
    """Las tablas oficiales con que se decide de qué clasificación es un código de ocupación.

    `grupos_cno11` son los grupos de cuatro cifras de la CNO-11; `correspondencia_cno94`, la correspondencia del INE de
    cada grupo de la CNO-94 con los de la CNO-11.
    """

    grupos_cno11: set[str]
    correspondencia_cno94: dict[str, list[str]]


class Anexo(NamedTuple):
    """El anexo de un certificado tal como lo publica su real decreto.

    `unidades` son las de código regular, normalizado («UC1518_3»); `irregulares`, las que el BOE publica con una errata
    que no se corrige sin adivinar («UC987_3», «UC0490»), con el código tal como sale: no dan nombre a ninguna unidad.
    """

    codigo: str
    denominacion: str
    nivel: int | None
    unidades: list[tuple[str, str]]
    ocupaciones: list[Ocupacion]
    irregulares: list[tuple[str, str]]


class Unidad(NamedTuple):
    """Una unidad de competencia al principio de un renglón: su código, lo que sigue y cómo está escrito.

    `regular` si el código tiene cuatro cifras y nivel, y entonces va normalizado («UC 1518_3» da «UC1518_3»); si no,
    va tal como se publica. `con_dos_puntos` si el código va seguido de «:», como en una lista «código: nombre».
    """

    codigo: str
    nombre: str
    regular: bool
    con_dos_puntos: bool


class _Texto(HTMLParser):
    """Texto de una página HTML del BOE, una línea por párrafo o celda."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.trozos: list[str] = []
        self.omitiendo = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in OMITIDAS:
            self.omitiendo += 1
        elif tag in BLOQUES:
            self.trozos.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in OMITIDAS and self.omitiendo:
            self.omitiendo -= 1
        elif tag in BLOQUES:
            self.trozos.append("\n")

    def handle_data(self, data: str) -> None:
        # Un salto de línea dentro de un párrafo es un espacio, como lo muestra el navegador.
        if not self.omitiendo:
            self.trozos.append(data.replace("\n", " "))


# ---------------------------------------------------------------------------------------------------------------------
# Texto
# ---------------------------------------------------------------------------------------------------------------------


def lineas_no_vacias(texto: str) -> list[str]:
    """Separa las líneas no vacías de un texto, con los espacios agrupados.

    Args:
        texto: El texto.

    Returns:
        Sus líneas no vacías, cada una con sus espacios reducidos a uno.
    """
    limpias = (" ".join(linea.split()) for linea in texto.splitlines())
    return [linea for linea in limpias if linea]


def texto_de_html(contenido: bytes) -> list[str]:
    """Extrae las líneas de texto de una página HTML del BOE (en UTF-8), sin scripts ni estilos.

    Args:
        contenido: Los bytes de la página.

    Returns:
        Sus líneas de texto no vacías.

    Raises:
        FormatoInesperado: Si la página no es UTF-8 válido.
    """
    try:
        texto = contenido.decode("utf-8")
    except UnicodeDecodeError as error:
        raise FormatoInesperado(f"BOE: HTML con UTF-8 inválido en el byte {error.start}") from error
    lector = _Texto()
    lector.feed(texto)
    lector.close()
    return lineas_no_vacias("".join(lector.trozos))


def fecha_iso(dia: str, mes: str, anio: str) -> str:
    """Escribe como fecha ISO una fecha dada en palabras: «9», «mayo», «2011» da «2011-05-09».

    Args:
        dia: El día.
        mes: El nombre del mes, en castellano.
        anio: El año.

    Returns:
        La fecha AAAA-MM-DD.

    Raises:
        FormatoInesperado: Si el mes no se reconoce o la fecha no existe en el calendario.
    """
    try:
        return date(int(anio), MESES_ES.index(mes.lower()) + 1, int(dia)).isoformat()
    except ValueError as error:
        raise FormatoInesperado(f"BOE: fecha inválida: {dia} de {mes} de {anio}") from error


# ---------------------------------------------------------------------------------------------------------------------
# Índice y disposiciones
# ---------------------------------------------------------------------------------------------------------------------


def referencias_anteriores(contenido: bytes) -> dict[str, Disposicion]:
    """Los reales decretos que cita una disposición en sus «Referencias anteriores», por «número/año».

    El índice es el análisis del Real Decreto 189/2013, que modificó todos los certificados publicados hasta entonces.
    La sección va de «Referencias anteriores» a «Materias»; si la página no trae «Materias», hasta el final.

    Args:
        contenido: La página HTML de la disposición.

    Returns:
        Cada real decreto cuyos anexos cita la sección, por «número/año»; vacío si la página no tiene la sección.
    """
    texto = " ".join(texto_de_html(contenido))
    inicio = texto.find("Referencias anteriores")
    fin = texto.find("Materias", inicio)
    if fin < 0:
        fin = len(texto)
    citadas = {}
    for numero, anio, dia, mes, boe in PATRON_REFERENCIA.findall(texto[inicio:fin] if inicio >= 0 else ""):
        citadas.setdefault(f"{numero}/{anio}", Disposicion(numero, int(anio), fecha_iso(dia, mes, anio), boe))
    return citadas


def titulo_de(lineas_del_texto: list[str]) -> tuple[str, str] | None:
    """Lee del título de una página el real decreto que publica.

    Args:
        lineas_del_texto: Las líneas de la página.

    Returns:
        «número/año» y su fecha ISO; None si las primeras líneas no traen el título.
    """
    for linea in lineas_del_texto[:LINEAS_DEL_TITULO]:
        coincidencia = PATRON_TITULO.search(linea)
        if coincidencia:
            numero, anio, dia, mes = coincidencia.groups()
            return f"{numero}/{anio}", fecha_iso(dia, mes, anio)
    return None


def enlace_al_pdf(contenido: bytes) -> str | None:
    """Busca la dirección ELI del PDF original de una disposición, tal como la declara su página.

    Args:
        contenido: Los bytes de la página.

    Returns:
        La dirección absoluta del PDF; None si la página no la declara.
    """
    coincidencia = PATRON_PDF.search(contenido.decode("utf-8", "replace"))
    return coincidencia.group(1) if coincidencia else None


# ---------------------------------------------------------------------------------------------------------------------
# Anexos de certificados
# ---------------------------------------------------------------------------------------------------------------------


def separar_codigo_de_ocupacion(linea: str) -> Ocupacion:
    """Separa una línea de ocupaciones relacionadas en su código (si lo trae) y su texto.

    Args:
        linea: La línea.

    Returns:
        La ocupación, con la forma de su código (o sin código) y su texto.
    """
    for forma, patron in FORMAS_DE_CODIGO:
        coincidencia = patron.match(linea)
        if coincidencia:
            *cifras, texto = coincidencia.groups()
            return Ocupacion("".join(cifras), texto, forma)
    return Ocupacion(None, linea, None)


def unidad_del_renglon(linea: str) -> Unidad | None:
    """Lee la unidad de competencia con que empieza un renglón.

    Args:
        linea: El renglón.

    Returns:
        La unidad (código normalizado, si es regular, y su nombre); None si no empieza por un código de unidad.
    """
    coincidencia = UNIDAD.match(linea)
    if not coincidencia:
        return None
    cifras, nivel = coincidencia.group("cifras"), coincidencia.group("nivel")
    regular = len(cifras) == CIFRAS_DE_UNIDAD and nivel is not None
    return Unidad(
        f"UC{cifras}_{nivel}" if regular else coincidencia.group("publicado"),
        coincidencia.group("nombre"),
        regular,
        coincidencia.group("dos_puntos") is not None,
    )


def _ocupaciones_desde(lineas_del_anexo: list[str], inicio: int) -> list[Ocupacion]:
    """Lee las ocupaciones que siguen a su título, hasta la parte siguiente del anexo.

    Args:
        lineas_del_anexo: Las líneas del anexo.
        inicio: La posición de la línea con el título de las ocupaciones.

    Returns:
        Las ocupaciones, en orden, sin las notas de género.

    Raises:
        FormatoInesperado: Si una línea de la lista no contiene texto de ocupación.
    """
    lista = []
    for linea in lineas_del_anexo[inicio:]:
        if FIN_DE_OCUPACIONES.match(linea) or INICIO_DE_ANEXO.match(linea):
            break
        if not NOTA_DE_GENERO.match(linea):
            texto = VINETA.sub("", linea).rstrip(".").strip()
            if not texto:
                raise FormatoInesperado(f"BOE: ocupación vacía en la línea {linea!r}")
            lista.append(separar_codigo_de_ocupacion(texto))
    return lista


def _cierra_la_lista(linea: str, hay_unidades: bool) -> bool:
    """Indica si un renglón cierra la lista de unidades de competencia.

    El título siguiente («Competencia general:») la cierra; antes de la primera unidad, un renglón que acaba en «:» es
    el final del propio título («… del certificado de» / «profesionalidad:») y no la cierra.

    Args:
        linea: El renglón.
        hay_unidades: Si ya se ha leído alguna unidad.

    Returns:
        True si el renglón cierra la lista.
    """
    return bool(TRAS_LAS_UNIDADES.match(linea)) or (hay_unidades and linea.endswith(":"))


def _unidades_y_nivel(
    lineas_del_anexo: list[str],
) -> tuple[list[tuple[str, str]], list[tuple[str, str]], int | None]:
    """Las unidades de competencia de la cabecera de un anexo (regulares e irregulares) y su nivel.

    En el PDF, el nombre de una unidad puede seguir en el renglón siguiente: se une hasta la unidad siguiente o hasta el
    título que cierra la lista («Competencia general:», a veces sin los dos puntos). Todo renglón que empieza por un
    código de unidad, aunque sea una errata, cierra la anterior: el texto de una unidad nunca pasa a otra. Un renglón
    con varias unidades se lee como varios.

    Args:
        lineas_del_anexo: Las líneas del anexo.

    Returns:
        Las unidades regulares (código, nombre), las de código irregular (tal cual, nombre) y el nivel (None si no
        consta).
    """
    leidas: list[Unidad] = []
    nivel: int | None = None
    en_unidades = False
    for linea in (parte for renglon in lineas_del_anexo for parte in OTRA_UNIDAD.split(renglon)):
        if OCUPACIONES.match(linea):
            break
        if coincidencia := NIVEL.match(linea):
            nivel = int(coincidencia.group(1))
        if UNIDADES.match(linea):
            en_unidades = True
            continue
        unidad = unidad_del_renglon(linea) if en_unidades else None
        if unidad:
            leidas.append(unidad)
        elif en_unidades and _cierra_la_lista(linea, hay_unidades=bool(leidas)):
            en_unidades = False
        elif en_unidades and leidas:
            leidas[-1] = leidas[-1]._replace(nombre=f"{leidas[-1].nombre} {linea}")
    limpias = [unidad._replace(nombre=unidad.nombre.strip().rstrip(".")) for unidad in leidas]
    regulares = [(unidad.codigo, unidad.nombre) for unidad in limpias if unidad.regular]
    irregulares = [(unidad.codigo, unidad.nombre) for unidad in limpias if not unidad.regular]
    return regulares, irregulares, nivel


def _anexo(lineas_del_anexo: list[str], denominacion: str) -> Anexo | None:
    """Lee el anexo que empieza en la primera línea («Código: …»).

    Args:
        lineas_del_anexo: Las líneas desde la del código hasta el anexo siguiente.
        denominacion: La denominación que precede al código.

    Returns:
        El anexo completo, con su código en mayúsculas, unidades, nivel y ocupaciones; None si no trae la lista de
        ocupaciones relacionadas.
    """
    codigo = INICIO_DE_ANEXO.match(lineas_del_anexo[0])
    if not codigo:
        return None
    for posicion, linea in enumerate(lineas_del_anexo[1:], start=1):
        if INICIO_DE_ANEXO.match(linea):
            return None
        if OCUPACIONES.match(linea):
            unidades, irregulares, nivel = _unidades_y_nivel(lineas_del_anexo[1:posicion])
            ocupaciones = _ocupaciones_desde(lineas_del_anexo, posicion + 1)
            return Anexo(codigo.group(1).upper(), denominacion, nivel, unidades, ocupaciones, irregulares)
    return None


def _denominacion(lineas_previas: list[str]) -> str:
    """Lee la denominación que precede al código, aunque ocupe varios renglones.

    Args:
        lineas_previas: Las líneas anteriores a la del código.

    Returns:
        La denominación en una línea; vacía si no la hay.
    """
    for desde in reversed(range(len(lineas_previas))):
        coincidencia = DENOMINACION.match(lineas_previas[desde])
        if coincidencia:
            return " ".join([coincidencia.group(1), *lineas_previas[desde + 1 :]]).strip().rstrip(".")
    return ""


def _titulos_enteros(lineas_del_texto: list[str]) -> list[str]:
    """Une en una sola línea el título de la lista de ocupaciones, si el texto lo parte en dos renglones.

    Args:
        lineas_del_texto: Las líneas del texto.

    Returns:
        Las líneas, con cada título partido unido en la primera de sus dos.
    """
    unidas: list[str] = []
    for linea in lineas_del_texto:
        if unidas and OCUPACIONES_PARTIDO.match(unidas[-1]) and CALIFICATIVO_SUELTO.match(linea):
            unidas[-1] = f"{unidas[-1]} {linea}"
        else:
            unidas.append(linea)
    return unidas


def anexos(lineas_del_texto: list[str]) -> dict[str, list[Anexo]]:
    """Los anexos de certificado de un texto, por código, con la denominación que precede a su código.

    Un código puede salir dos veces: el BOE tiene erratas (el Real Decreto 717/2011 publica «MAMA0209» para dos
    certificados distintos). Se guardan todos, en orden, y quien los lee elige por la denominación.

    Args:
        lineas_del_texto: Las líneas del texto.

    Returns:
        Por código, sus anexos en orden de aparición.
    """
    encontrados: dict[str, list[Anexo]] = {}
    unidas = _titulos_enteros(lineas_del_texto)
    for posicion, linea in enumerate(unidas):
        if not INICIO_DE_ANEXO.match(linea):
            continue
        denominacion = _denominacion(unidas[max(0, posicion - LINEAS_DE_LA_DENOMINACION) : posicion])
        anexo = _anexo(unidas[posicion : posicion + LINEAS_DE_CABECERA], denominacion)
        if anexo is not None:
            encontrados.setdefault(anexo.codigo, []).append(anexo)
    return encontrados


# ---------------------------------------------------------------------------------------------------------------------
# Equivalencias de unidades y texto de los PDF
# ---------------------------------------------------------------------------------------------------------------------


def _codigo_solo(celda: str) -> str | None:
    """Lee una celda que solo trae un código de unidad regular.

    Args:
        celda: El texto de la celda.

    Returns:
        El código normalizado; None si la celda trae otra cosa.
    """
    unidad = unidad_del_renglon(celda)
    return unidad.codigo if unidad and unidad.regular and not unidad.nombre else None


def equivalencias(lineas_del_texto: list[str]) -> list[tuple[str, str, str]]:
    """Las filas del anexo XIII-a del Real Decreto 151/2022: (unidad suprimida, requisitos adicionales, equivalente).

    Cada celda de la tabla es una línea del texto; una fila son tres celdas seguidas, la primera y la última con un
    código de unidad de competencia regular (normalizado). La tabla termina donde empieza el anexo XIII-b.

    Args:
        lineas_del_texto: Las líneas del Real Decreto 151/2022.

    Returns:
        Las filas, en orden; vacía si el texto no tiene el anexo XIII-a.
    """
    inicio = next((numero for numero, linea in enumerate(lineas_del_texto) if INICIO_EQUIVALENCIAS.match(linea)), None)
    if inicio is None:
        return []
    tabla = []
    for linea in lineas_del_texto[inicio + 1 :]:
        if FIN_EQUIVALENCIAS.match(linea):
            break
        tabla.append(linea)
    filas, posicion = [], 0
    # Termina porque `posicion` crece en cada vuelta (3 si la fila casa, 1 si no) y `tabla` es finita.
    while posicion + 2 < len(tabla):
        suprimida, actual = _codigo_solo(tabla[posicion]), _codigo_solo(tabla[posicion + 2])
        if suprimida and actual:
            filas.append((suprimida, tabla[posicion + 1], actual))
            posicion += 3
        else:
            posicion += 1
    return filas


def nombres_de_unidades(lineas_del_texto: list[str]) -> dict[str, str]:
    """El nombre de cada unidad de competencia que un texto enumera como «UC2259_2: nombre» (el primero que da).

    Solo las de código regular: una errata no se puede atribuir a ninguna unidad sin adivinar.

    Args:
        lineas_del_texto: Las líneas del texto.

    Returns:
        El nombre de cada unidad, por su código normalizado.
    """
    nombres: dict[str, str] = {}
    for linea in lineas_del_texto:
        unidad = unidad_del_renglon(linea)
        if unidad and unidad.regular and unidad.con_dos_puntos and unidad.nombre:
            nombres.setdefault(unidad.codigo, unidad.nombre)
    return nombres


def sin_cabeceras(lineas_del_texto: list[str]) -> list[str]:
    """Quita de las líneas de un PDF del BOE la cabecera de cada página («36680 Martes 9 septiembre 2008 BOE núm. 218»).

    Args:
        lineas_del_texto: Las líneas del PDF.

    Returns:
        Las mismas líneas sin las de cabecera.
    """
    return [linea for linea in lineas_del_texto if not CABECERA_DE_PAGINA.search(linea)]
