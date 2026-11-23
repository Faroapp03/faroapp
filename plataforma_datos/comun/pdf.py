"""Texto de un PDF con la biblioteca estándar: lo justo para leer los anexos de los reales decretos del BOE de 2008.

Lee la tabla de referencias cruzadas (con sus actualizaciones), descomprime los flujos (FlateDecode y ASCII85Decode),
sigue el árbol de páginas en orden y, en cada página, interpreta los operadores de texto con la codificación de cada
fuente: su tabla ToUnicode o, si no la tiene, WinAnsi con sus diferencias por nombre de glifo. Devuelve una línea por
renglón, en el orden en que la página dibuja el texto: un cambio de altura empieza otro renglón, y un salto dentro del
mismo renglón deja un espacio. No es un lector general: no entiende tablas de referencias en flujos ni documentos
cifrados, y entonces falla con su motivo.
"""

import math
import re
from copy import copy
from typing import Any

from plataforma_datos.comun.nucleo import FormatoInesperado, exigir
from plataforma_datos.comun.objetos_pdf import (
    MAX_ANIDAMIENTO,
    Documento,
    Flujo,
    Operador,
    Referencia,
    fichas,
    valor,
)

# Un hueco en un TJ mayor que esto (en milésimas del cuerpo de letra) separa dos palabras.
HUECO_DE_ESPACIO = 200
# Diferencia de altura, en puntos, a partir de la cual el texto está en otro renglón.
SALTO_DE_RENGLON = 2.0
# Un CID no pasa de 65 535 (ISO 32000-1, anexo C): ningún rango de códigos de una fuente es más ancho.
MAX_CODIGOS_POR_RANGO = 0x10000
# Tope conjunto por fuente: varios rangos no deben eludir el límite de memoria del lector.
MAX_CODIGOS_POR_FUENTE = 0x10000
# Límites de los sustitutos UTF-16 y del último byte que incrementa un bfrange.
PRIMER_SUSTITUTO = 0xD800
ULTIMO_SUSTITUTO = 0xDFFF
MAX_VALOR_BYTE = 0xFF
# Un código de una tabla ToUnicode ocupa de 1 a 4 bytes (ISO 32000-1, 9.7.6.2): con 0, la lectura no avanzaría.
MIN_BYTES_POR_CODIGO = 1
MAX_BYTES_POR_CODIGO = 4
# Lo que lanza Python al leer un PDF mal formado (una pieza que falta, un número que no lo es, un tipo inesperado):
# se convierte en FormatoInesperado con la página, para que salga con su motivo y no como una traza.
ERRORES_DE_FORMA = (IndexError, KeyError, TypeError, ValueError, AttributeError)
# Nombres de glifo que no son una letra o una cifra sin tilde (esas se llaman por sí mismas: «a», «B»).
GLIFOS = {
    "space": " ", "exclam": "!", "quotedbl": '"', "numbersign": "#", "dollar": "$", "percent": "%",
    "ampersand": "&", "quotesingle": "'", "quoteright": "’", "quoteleft": "‘", "parenleft": "(", "parenright": ")",
    "asterisk": "*", "plus": "+", "comma": ",", "hyphen": "-", "minus": "−", "period": ".", "slash": "/",
    "colon": ":", "semicolon": ";", "less": "<", "equal": "=", "greater": ">", "question": "?", "at": "@",
    "bracketleft": "[", "backslash": "\\", "bracketright": "]", "underscore": "_", "braceleft": "{", "bar": "|",
    "braceright": "}", "endash": "–", "emdash": "—", "bullet": "•", "ellipsis": "…", "quotedblleft": "“",
    "quotedblright": "”", "guillemotleft": "«", "guillemotright": "»", "ordfeminine": "ª", "ordmasculine": "º",
    "degree": "°", "periodcentered": "·", "exclamdown": "¡", "questiondown": "¿", "fi": "fi", "fl": "fl",
    "aacute": "á", "eacute": "é", "iacute": "í", "oacute": "ó", "uacute": "ú", "Aacute": "Á", "Eacute": "É",
    "Iacute": "Í", "Oacute": "Ó", "Uacute": "Ú", "agrave": "à", "egrave": "è", "ograve": "ò", "Agrave": "À",
    "Egrave": "È", "Ograve": "Ò", "ntilde": "ñ", "Ntilde": "Ñ", "udieresis": "ü", "Udieresis": "Ü",
    "idieresis": "ï", "Idieresis": "Ï", "ccedilla": "ç", "Ccedilla": "Ç", "dotlessi": "ı", "zero": "0",
    "one": "1", "two": "2", "three": "3", "four": "4", "five": "5", "six": "6", "seven": "7", "eight": "8",
    "nine": "9", "euro": "€", "section": "§", "copyright": "©", "registered": "®", "multiply": "×",
    "lslash": "ł", "Lslash": "Ł",
}  # fmt: skip


# ---------------------------------------------------------------------------------------------------------------------
# Fuentes: de los códigos de una cadena a su texto
# ---------------------------------------------------------------------------------------------------------------------


def _glifo(nombre: str) -> str:
    """El carácter de un nombre de glifo: «aacute», «uni00F3», «a»; vacío si no se conoce.

    Returns:
        El carácter, o un texto vacío si el nombre no se conoce.
    """
    if nombre in GLIFOS:
        return GLIFOS[nombre]
    unicode = re.fullmatch(r"uni([0-9A-Fa-f]{4})", nombre)
    if unicode:
        codigo = int(unicode.group(1), 16)
        exigir(not PRIMER_SUSTITUTO <= codigo <= ULTIMO_SUSTITUTO, "PDF: un glifo Unicode es un sustituto suelto")
        return chr(codigo)
    return nombre if len(nombre) == 1 and nombre.isalnum() else ""


def _utf16(destino: bytes) -> str:
    """El texto de un destino de una tabla ToUnicode, en UTF-16BE.

    Returns:
        El texto decodificado.

    Raises:
        FormatoInesperado: Si el destino no contiene UTF-16BE válido.
    """
    exigir(isinstance(destino, bytes), "PDF: un destino ToUnicode no es UTF-16BE válido")
    try:
        return destino.decode("utf-16-be")
    except UnicodeDecodeError as error:
        raise FormatoInesperado("PDF: un destino ToUnicode no es UTF-16BE válido") from error


def tabla_tounicode(cmap: bytes) -> tuple[int, dict[int, str]]:
    """Los bytes por código y el texto de cada código de una tabla ToUnicode (bfchar y bfrange).

    Returns:
        Los bytes de cada código y {código: texto}.
    """
    piezas = fichas(cmap)
    ancho, tabla = 1, {}
    for posicion, pieza in enumerate(piezas):
        if pieza == "begincodespacerange" and isinstance(piezas[posicion + 1], bytes):
            ancho = len(piezas[posicion + 1])
            exigir(
                MIN_BYTES_POR_CODIGO <= ancho <= MAX_BYTES_POR_CODIGO,
                f"PDF: un código de {ancho} bytes en la tabla ToUnicode (de {MIN_BYTES_POR_CODIGO} a "
                f"{MAX_BYTES_POR_CODIGO})",
            )
        elif pieza == "beginbfchar":
            fin = piezas.index("endbfchar", posicion)
            pares = piezas[posicion + 1 : fin]
            exigir(len(pares) % 2 == 0, "PDF: un bfchar sin pareja de origen y destino")
            for origen, destino in zip(pares[0::2], pares[1::2], strict=True):
                tabla[int.from_bytes(origen, "big")] = _utf16(destino)
                _acotar_fuente(tabla)
        elif pieza == "beginbfrange":
            fin = piezas.index("endbfrange", posicion)
            _rangos(piezas[posicion + 1 : fin], tabla)
    return ancho, tabla


def _rangos(piezas: list[Any], tabla: dict[int, str]) -> None:
    """Los rangos «<inicio> <fin> <destino>» o «<inicio> <fin> [<d1> <d2> …]» de una tabla ToUnicode."""
    posicion = 0
    while posicion < len(piezas):
        exigir(posicion + 2 < len(piezas), "PDF: un rango ToUnicode incompleto")
        inicio, fin = int.from_bytes(piezas[posicion], "big"), int.from_bytes(piezas[posicion + 1], "big")
        exigir(0 <= fin - inicio < MAX_CODIGOS_POR_RANGO, "PDF: un rango ToUnicode invertido o demasiado grande")
        if type(piezas[posicion + 2]) is str and piezas[posicion + 2] == "[":
            cierre = next(
                (i for i in range(posicion + 3, len(piezas)) if type(piezas[i]) is str and piezas[i] == "]"), None
            )
            exigir(cierre is not None, "PDF: un rango ToUnicode sin cierre de lista")
            destinos = piezas[posicion + 3 : cierre]
            exigir(len(destinos) == fin - inicio + 1, "PDF: un rango ToUnicode con distinto número de destinos")
            for orden, destino in enumerate(destinos):
                tabla[inicio + orden] = _utf16(destino)
            posicion = cierre + 1
        else:
            base = piezas[posicion + 2]
            exigir(isinstance(base, bytes) and bool(base), "PDF: un destino de rango ToUnicode vacío o no válido")
            exigir(
                base[-1] + fin - inicio <= MAX_VALOR_BYTE, "PDF: un destino de rango ToUnicode desborda su último byte"
            )
            for orden in range(fin - inicio + 1):
                tabla[inicio + orden] = _utf16(base[:-1] + bytes([base[-1] + orden]))
            posicion += 3
        _acotar_fuente(tabla)


def _acotar_fuente(tabla: dict[int, Any] | list[Any]) -> None:
    """Acota los códigos distintos de una fuente, aunque los reparta en varios rangos."""
    exigir(len(tabla) <= MAX_CODIGOS_POR_FUENTE, f"PDF: una fuente pasa de {MAX_CODIGOS_POR_FUENTE} códigos")


class Fuente:
    """Cómo se lee una fuente: el texto de cada código (ToUnicode, o WinAnsi con diferencias) y su anchura."""

    def __init__(self, documento: Documento, diccionario: dict[str, Any]) -> None:
        self.anchuras = _anchuras(documento, diccionario)
        tounicode = documento.resolver(diccionario.get("ToUnicode"))
        if isinstance(tounicode, Flujo):
            self.ancho, self.tabla = tabla_tounicode(documento.bytes_de(tounicode))
            return
        self.ancho = 2 if diccionario.get("Subtype") == "Type0" else 1
        self.tabla = {codigo: bytes([codigo]).decode("cp1252", "replace") for codigo in range(256)}
        codificacion = documento.resolver(diccionario.get("Encoding"))
        diferencias = documento.resolver(codificacion.get("Differences", [])) if isinstance(codificacion, dict) else []
        codigo = 0
        for elemento in diferencias:
            if isinstance(elemento, int):
                codigo = elemento
                continue
            self.tabla[codigo] = _glifo(str(elemento))
            codigo += 1

    def codigos(self, cadena: bytes) -> list[int]:
        """Los códigos de una cadena, del ancho declarado por la fuente.

        Returns:
            Los códigos, en orden.
        """
        return [
            int.from_bytes(cadena[inicio : inicio + self.ancho], "big") for inicio in range(0, len(cadena), self.ancho)
        ]

    def texto(self, cadena: bytes) -> str:
        """El texto de una cadena mostrada con esta fuente; un código desconocido no da nada.

        Returns:
            El texto de los códigos conocidos, en orden.
        """
        return "".join(self.tabla.get(codigo, "") for codigo in self.codigos(cadena))


def _anchuras(documento: Documento, diccionario: dict[str, Any]) -> dict[int, float]:
    """La anchura de cada código, en milésimas del cuerpo: /Widths (fuente simple) o /W (fuente compuesta).

    Returns:
        {código: anchura en milésimas del cuerpo}.
    """
    if diccionario.get("Subtype") != "Type0":
        primero = int(documento.resolver(diccionario.get("FirstChar", 0)))
        anchuras = documento.resolver(diccionario.get("Widths", []))
        _acotar_fuente(anchuras)
        return {primero + orden: float(documento.resolver(anchura)) for orden, anchura in enumerate(anchuras)}
    descendiente = documento.resolver(documento.resolver(diccionario.get("DescendantFonts", [{}]))[0])
    lista, salida, posicion = documento.resolver(descendiente.get("W", [])), {}, 0
    while posicion < len(lista):
        exigir(posicion + 1 < len(lista), "PDF: un rango /W incompleto")
        inicio, siguiente = int(lista[posicion]), documento.resolver(lista[posicion + 1])
        if isinstance(siguiente, list):
            _acotar_fuente(siguiente)
            salida.update({inicio + orden: float(anchura) for orden, anchura in enumerate(siguiente)})
            posicion += 2
        else:
            exigir(
                0 <= int(siguiente) - inicio < MAX_CODIGOS_POR_RANGO,
                f"PDF: un rango /W invertido o de más de {MAX_CODIGOS_POR_RANGO} códigos",
            )
            exigir(posicion + 2 < len(lista), "PDF: un rango /W incompleto")
            salida.update(dict.fromkeys(range(inicio, int(siguiente) + 1), float(lista[posicion + 2])))
            posicion += 3
        _acotar_fuente(salida)
    return salida


# ---------------------------------------------------------------------------------------------------------------------
# Páginas: los operadores de texto
# ---------------------------------------------------------------------------------------------------------------------

IDENTIDAD = (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)
# Anchura de un código que la fuente no declara, en milésimas del cuerpo (la media de una letra).
ANCHURA_POR_DEFECTO = 500.0
# Un hueco entre dos trozos del mismo renglón mayor que esta parte del cuerpo de letra es un espacio.
HUECO_ENTRE_TROZOS = 0.15


def _producto(primera: tuple[float, ...], segunda: tuple[float, ...]) -> tuple[float, ...]:
    """El producto de dos matrices de transformación [a b c d e f]: primero `primera`, después `segunda`.

    Cada componente lleva el número de su matriz: a1 es la «a» de `primera` y a2, la de `segunda`.

    Returns:
        La matriz producto, como seis números.
    """
    a1, b1, c1, d1, e1, f1 = primera
    a2, b2, c2, d2, e2, f2 = segunda
    return (
        a1 * a2 + b1 * c2,
        a1 * b2 + b1 * d2,
        c1 * a2 + d1 * c2,
        c1 * b2 + d1 * d2,
        e1 * a2 + f1 * c2 + e2,
        e1 * b2 + f1 * d2 + f2,
    )


def _traslacion(horizontal: float, vertical: float) -> tuple[float, ...]:
    """La matriz que desplaza un punto `horizontal` unidades a lo ancho y `vertical` a lo alto.

    Returns:
        La matriz de traslación, como seis números.
    """
    return (1.0, 0.0, 0.0, 1.0, horizontal, vertical)


class _Estado:
    """El estado de texto de una página: matrices, fuente, cuerpo, espaciados e interlineado."""

    def __init__(self) -> None:
        self.ctm: tuple[float, ...] = IDENTIDAD
        self.guardadas: list[_Estado] = []
        self.linea = self.matriz = IDENTIDAD
        self.fuente: Fuente | None = None
        self.cuerpo = 1.0
        self.caracter = self.palabra = self.interlineado = 0.0
        self.escala = 1.0

    def mover(self, horizontal: float, vertical: float) -> None:
        """Td: empieza un renglón desplazado (`horizontal`, `vertical`) respecto al anterior."""
        self.linea = self.matriz = _producto(_traslacion(horizontal, vertical), self.linea)

    def avanzar(self, milesimas: float, espacios: int = 0) -> None:
        """Avanza el punto de escritura lo que ocupan unas letras: su anchura más los espaciados."""
        avance = (milesimas / 1000 * self.cuerpo + self.palabra * espacios) * self.escala
        self.matriz = _producto(_traslacion(avance, 0.0), self.matriz)

    def en_pagina(self) -> tuple[float, ...]:
        """La matriz de texto en el espacio de la página.

        Returns:
            La matriz de texto multiplicada por la matriz de transformación actual.
        """
        return _producto(self.matriz, self.ctm)


class _Pagina:
    """El texto de una página en renglones, según sus operadores y la posición de cada trozo."""

    def __init__(self, documento: Documento) -> None:
        self.documento = documento
        self.renglones: list[list[Any]] = []  # [altura, texto, fin del último trozo sobre la línea base]
        self.fuentes: dict[Any, Fuente] = {}
        self.estado = _Estado()
        self.recursos: dict[str, Any] = {}
        self.formularios_abiertos = 0
        self.operadores = {
            "q": self._guardar, "Q": self._restaurar, "cm": self._cm, "BT": self._bt, "Tf": self._tf,
            "Tc": self._tc, "Tw": self._tw, "Tz": self._tz, "TL": self._tl, "Td": self._td, "TD": self._td_y_tl,
            "Tm": self._tm, "T*": self._siguiente, "Tj": self._tj, "TJ": self._tj_con_huecos, "'": self._apostrofo,
            '"': self._comillas, "Do": self._formulario,
        }  # fmt: skip

    # Operadores: cada uno recibe los operandos que lo preceden en el flujo.

    def _guardar(self, _operandos: list[Any]) -> None:
        guardado = copy(self.estado)
        guardado.guardadas = []
        self.estado.guardadas.append(guardado)

    def _restaurar(self, _operandos: list[Any]) -> None:
        if self.estado.guardadas:
            guardado = self.estado.guardadas.pop()
            # Las matrices de texto no pertenecen al estado gráfico: Q no rebobina la escritura.
            guardado.linea, guardado.matriz = self.estado.linea, self.estado.matriz
            guardado.guardadas = self.estado.guardadas
            self.estado = guardado

    def _cm(self, operandos: list[Any]) -> None:
        self.estado.ctm = _producto(tuple(float(numero) for numero in operandos[-6:]), self.estado.ctm)

    def _bt(self, _operandos: list[Any]) -> None:
        self.estado.linea = self.estado.matriz = IDENTIDAD

    def _tf(self, operandos: list[Any]) -> None:
        self.estado.fuente = self._fuente(str(operandos[-2]))
        self.estado.cuerpo = float(operandos[-1])

    def _tc(self, operandos: list[Any]) -> None:
        self.estado.caracter = float(operandos[-1])

    def _tw(self, operandos: list[Any]) -> None:
        self.estado.palabra = float(operandos[-1])

    def _tz(self, operandos: list[Any]) -> None:
        self.estado.escala = float(operandos[-1]) / 100

    def _tl(self, operandos: list[Any]) -> None:
        self.estado.interlineado = float(operandos[-1])

    def _td(self, operandos: list[Any]) -> None:
        self.estado.mover(float(operandos[-2]), float(operandos[-1]))

    def _td_y_tl(self, operandos: list[Any]) -> None:
        self.estado.interlineado = -float(operandos[-1])
        self._td(operandos)

    def _tm(self, operandos: list[Any]) -> None:
        self.estado.linea = self.estado.matriz = tuple(float(numero) for numero in operandos[-6:])

    def _siguiente(self, _operandos: list[Any]) -> None:
        self.estado.mover(0.0, -self.estado.interlineado)

    def _tj(self, operandos: list[Any]) -> None:
        if isinstance(operandos[-1], bytes):
            self._mostrar([operandos[-1]])

    def _tj_con_huecos(self, operandos: list[Any]) -> None:
        if isinstance(operandos[-1], list):
            self._mostrar(operandos[-1])

    def _apostrofo(self, operandos: list[Any]) -> None:
        self._siguiente(operandos)
        self._tj(operandos)

    def _comillas(self, operandos: list[Any]) -> None:
        self.estado.palabra, self.estado.caracter = float(operandos[-3]), float(operandos[-2])
        self._apostrofo(operandos)

    def _formulario(self, operandos: list[Any]) -> None:
        """El texto de un formulario (XObject Form) que dibuja la página, con sus propios recursos.

        Un formulario puede dibujar otro, y uno dañado, a sí mismo: `MAX_ANIDAMIENTO` acota esa recursión.
        """
        exigir(self.formularios_abiertos < MAX_ANIDAMIENTO, f"PDF: más de {MAX_ANIDAMIENTO} formularios anidados")
        objetos = self.documento.resolver(self.recursos.get("XObject", {}))
        formulario = self.documento.resolver(objetos.get(str(operandos[-1])))
        if not isinstance(formulario, Flujo) or formulario.diccionario.get("Subtype") != "Form":
            return
        matriz = tuple(float(numero) for numero in formulario.diccionario.get("Matrix", IDENTIDAD))
        propios = self.documento.resolver(formulario.diccionario.get("Resources", self.recursos))
        anteriores, estado = self.recursos, self.estado
        self.estado = copy(estado)
        self.estado.guardadas = []
        self.estado.linea = self.estado.matriz = IDENTIDAD
        self.estado.ctm = _producto(matriz, estado.ctm)
        self.formularios_abiertos += 1
        try:
            self.leer(self.documento.bytes_de(formulario), propios)
        finally:
            self.formularios_abiertos -= 1
            self.recursos, self.estado = anteriores, estado

    # Escritura

    def _fuente(self, nombre: str) -> Fuente | None:
        referencia = self.documento.resolver(self.recursos.get("Font", {})).get(nombre)
        if referencia is None:
            return None
        clave = referencia if isinstance(referencia, Referencia) else id(referencia)
        if clave not in self.fuentes:
            self.fuentes[clave] = Fuente(self.documento, self.documento.resolver(referencia))
        return self.fuentes[clave]

    def _mostrar(self, elementos: list[Any]) -> None:
        """Escribe las cadenas de un Tj o un TJ y avanza el punto de escritura; un hueco de palabra es un espacio."""
        fuente = self.estado.fuente
        if fuente is None:
            return
        for elemento in elementos:
            if isinstance(elemento, (int, float)):
                if -elemento > HUECO_DE_ESPACIO and self._escribir(" "):
                    self.renglones[-1][2] = self._posicion()[0]
                self.estado.avanzar(-float(elemento))
                continue
            for codigo in fuente.codigos(elemento):
                escrito = self._escribir(fuente.tabla.get(codigo, ""))
                anchura = fuente.anchuras.get(codigo, ANCHURA_POR_DEFECTO)
                es_espacio = fuente.ancho == 1 and codigo == ord(" ")
                self.estado.avanzar(anchura + self.estado.caracter * 1000 / max(self.estado.cuerpo, 1e-6), es_espacio)
                if escrito:
                    self.renglones[-1][2] = self._posicion()[0]

    def _posicion(self) -> tuple[float, float, float]:
        """El punto de escritura sobre la línea base, su altura perpendicular a ella y el cuerpo, en la página.

        Medir la altura en perpendicular a la línea base permite leer también los anexos apaisados del BOE, cuyo texto
        está girado 90 grados.

        Returns:
            (abscisa, altura perpendicular a la línea base, cuerpo), en unidades de la página.
        """
        base_x, base_y, _, _, origen_x, origen_y = self.estado.en_pagina()
        escala = math.hypot(base_x, base_y) or 1.0
        avance = (base_x * origen_x + base_y * origen_y) / escala
        altura = (base_x * origen_y - base_y * origen_x) / escala
        return avance, altura, self.estado.cuerpo * escala

    def _escribir(self, texto: str) -> bool:
        """Añade texto en el punto de escritura: al renglón actual (con un espacio si hay hueco) o a uno nuevo.

        Devuelve si ha escrito algo; quien llama apunta después dónde termina.

        Returns:
            True si se ha escrito texto.
        """
        if not texto:
            return False
        avance, altura, cuerpo = self._posicion()
        if not self.renglones or abs(self.renglones[-1][0] - altura) > SALTO_DE_RENGLON:
            self.renglones.append([altura, texto, avance])
            return True
        renglon = self.renglones[-1]
        hueco = avance - renglon[2]
        if hueco > HUECO_ENTRE_TROZOS * cuerpo and not renglon[1].endswith(" ") and texto != " ":
            renglon[1] += " "
        renglon[1] += texto
        return True

    def leer(self, contenido: bytes, recursos: dict[str, Any]) -> None:
        """Interpreta un flujo de contenido: cada operador con los operandos que lo preceden."""
        self.recursos = recursos
        piezas, operandos, posicion = fichas(contenido), [], 0
        while posicion < len(piezas):
            pieza = piezas[posicion]
            if type(pieza) is str and pieza in ("[", "<<"):
                compuesto, posicion = valor(piezas, posicion)
                operandos.append(compuesto)
                continue
            posicion += 1
            if not isinstance(pieza, Operador):
                operandos.append(pieza)
                continue
            accion = self.operadores.get(pieza)
            if accion is not None and operandos_suficientes(pieza, operandos):
                accion(operandos)
            operandos = []


# Operandos que necesita cada operador; uno con menos se ignora (un flujo dañado no detiene la lectura).
OPERANDOS = {
    "cm": 6, "Tf": 2, "Tc": 1, "Tw": 1, "Tz": 1, "TL": 1, "Td": 2, "TD": 2, "Tm": 6, "Tj": 1, "TJ": 1, "'": 1, '"': 3,
    "Do": 1,
}  # fmt: skip


def operandos_suficientes(operador: str, operandos: list[Any]) -> bool:
    """Si un operador llega con los operandos que necesita.

    Returns:
        True si en la pila hay al menos los operandos que pide el operador.
    """
    return len(operandos) >= OPERANDOS.get(operador, 0)


def renglones_de_la_pagina(documento: Documento, pagina: dict[str, Any], numero: int | None = None) -> list[str]:
    """Lee los renglones de texto de una página de `documento.paginas()`, en el orden en que se dibujan.

    Args:
        documento: El PDF.
        pagina: El diccionario de la página.
        numero: El número de la página (la primera es la 1), para el motivo del error.

    Returns:
        Los renglones de la página, en el orden en que se dibujan.

    Raises:
        FormatoInesperado: Si la página o una de sus fuentes no tiene la forma que se espera; dice la página.
    """
    try:
        return _renglones(documento, pagina)
    except ERRORES_DE_FORMA as error:
        cual = f"la página {numero}" if numero is not None else "una página"
        raise FormatoInesperado(f"PDF: {cual} está mal formada ({type(error).__name__}: {error})") from error


def _renglones(documento: Documento, pagina: dict[str, Any]) -> list[str]:
    """Lee los renglones de una página sin convertir los errores de forma (ver `renglones_de_la_pagina`).

    Args:
        documento: El PDF.
        pagina: El diccionario de la página.

    Returns:
        Los renglones de la página, en el orden en que se dibujan.
    """
    lector = _Pagina(documento)
    recursos = documento.resolver(pagina.get("Resources", {}))
    contenidos = documento.resolver(pagina.get("Contents", []))
    # Los flujos de una página son uno solo partido en trozos: un diccionario puede empezar en uno y acabar en otro.
    flujos = contenidos if isinstance(contenidos, list) else [contenidos]
    lector.leer(b"\n".join(documento.bytes_de(documento.resolver(flujo)) for flujo in flujos), recursos)
    return [" ".join(renglon[1].split()) for renglon in lector.renglones if renglon[1].strip()]


def texto(datos: bytes) -> list[str]:
    """Los renglones de texto de un PDF, página a página, en el orden en que se dibujan.

    Returns:
        Los renglones de todas las páginas, en orden.
    """
    documento = Documento(datos)
    return [
        renglon
        for numero, pagina in enumerate(documento.paginas(), 1)
        for renglon in renglones_de_la_pagina(documento, pagina, numero)
    ]
