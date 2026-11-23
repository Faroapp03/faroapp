"""Objetos, referencias, flujos y análisis léxico de PDF; la representación del texto vive en pdf.py."""

import base64
import math
import re
import zlib
from typing import NamedTuple

from plataforma_datos.comun.nucleo import FormatoInesperado, exigir

# Lo que separa dos piezas del PDF y lo que es espacio en blanco.
ESPACIOS = b"\x00\t\n\x0c\r "
PALABRA = re.compile(rb"[^\x00\t\n\x0c\r ()<>\[\]{}/%]+")
NOMBRE = re.compile(rb"/[^\x00\t\n\x0c\r ()<>\[\]{}/%]*")


# Topes contra un PDF dañado o hostil. Un diccionario de fuente anida tres o cuatro niveles y un anexo del BOE dibuja
# sus formularios sin anidarlos; 64 niveles quedan muy por encima y muy por debajo del límite de recursión de Python.
MAX_ANIDAMIENTO = 64
# Un flujo de texto de un anexo ocupa kilobytes descomprimido: el tope corta una bomba de descompresión.
MAX_FLUJO_BYTES = 64 * 1024 * 1024
# Cada entrada de una tabla de referencias ocupa 20 bytes con su fin de línea (ISO 32000-1, 7.5.4): el número de
# entradas que declara un bloque se acota con los bytes que quedan, sin fiarse de la cabecera.
LARGO_ENTRADA_XREF = 20
# Cifras del desplazamiento de un objeto al principio de cada entrada de la tabla, y posición de su marca «n» (en uso).
CIFRAS_DEL_DESPLAZAMIENTO = 10
POSICION_DE_LA_MARCA = 17
# Bytes del final del archivo en que se busca «startxref» (ISO 32000-1, 7.5.5: va en las últimas líneas).
COLA_CON_STARTXREF = 2048

# Lo que puede ser un valor del PDF: un número, un booleano, null, una cadena, un nombre, un operador, una referencia,
# una lista o un diccionario (o un flujo, una vez leído su objeto).
type Valor = object


class Nombre(str):
    """Un nombre del PDF («/Font»), sin la barra."""


class Operador(str):
    """Una palabra que no es un número ni un valor: un operador de contenido o una palabra clave («obj», «R»)."""


class Referencia(NamedTuple):
    """Una referencia a un objeto indirecto («12 0 R»)."""

    numero: int
    generacion: int


class Flujo(NamedTuple):
    """Un flujo: su diccionario y sus bytes tal como están en el archivo."""

    diccionario: dict[str, Valor]
    crudo: bytes


# ---------------------------------------------------------------------------------------------------------------------
# Piezas sueltas: el analizador léxico
# ---------------------------------------------------------------------------------------------------------------------


def _cadena_literal(datos: bytes, posicion: int) -> tuple[bytes, int]:
    """Lee la cadena «(…)» que empieza en `posicion`, con sus paréntesis anidados y sus escapes.

    Args:
        datos: El PDF o el flujo.
        posicion: Dónde está el «(».

    Returns:
        Los bytes de la cadena y la posición que sigue al «)».

    Raises:
        FormatoInesperado: Si la cadena no se cierra.
    """
    salida, nivel, posicion = bytearray(), 1, posicion + 1
    escapes = {ord("n"): 10, ord("r"): 13, ord("t"): 9, ord("b"): 8, ord("f"): 12}
    while nivel:
        exigir(posicion < len(datos), "PDF: una cadena no se cierra")
        byte = datos[posicion]
        if byte == ord("\\"):
            octal = re.match(rb"[0-7]{1,3}", datos[posicion + 1 : posicion + 4])
            if octal:
                salida.append(int(octal.group(), 8) & 0xFF)
                posicion += 1 + len(octal.group())
                continue
            siguiente = datos[posicion + 1] if posicion + 1 < len(datos) else ord("\\")
            if siguiente not in b"\r\n":
                salida.append(escapes.get(siguiente, siguiente))
            posicion += 3 if datos[posicion + 1 : posicion + 3] == b"\r\n" else 2
            continue
        if byte == ord("\r"):
            salida.append(ord("\n"))
            posicion += 2 if datos[posicion : posicion + 2] == b"\r\n" else 1
            continue
        if byte == ord("("):
            nivel += 1
        elif byte == ord(")"):
            nivel -= 1
        if nivel:
            salida.append(byte)
        posicion += 1
    return bytes(salida), posicion


def _palabra(texto: str) -> Valor:
    """Interpreta una palabra: un número, un booleano, null o un operador.

    Args:
        texto: La palabra.

    Returns:
        Su valor.

    Raises:
        FormatoInesperado: Si un entero supera las cifras convertibles o un real queda fuera del rango finito.
    """
    if re.fullmatch(r"[+-]?\d+", texto):
        try:
            return int(texto)
        except ValueError as error:
            raise FormatoInesperado(f"PDF: un número de {len(texto)} cifras") from error
    if re.fullmatch(r"[+-]?(\d+\.\d*|\.\d+)", texto):
        numero = float(texto)
        exigir(math.isfinite(numero), "PDF: un número real fuera del rango finito")
        return numero
    return {"true": True, "false": False, "null": None}.get(texto, Operador(texto))


def _delimitador(datos: bytes, posicion: int) -> tuple[Valor, int]:
    """Lee un corchete o una llave.

    Args:
        datos: El PDF o el flujo.
        posicion: Dónde está.

    Returns:
        El delimitador y la posición siguiente.
    """
    return datos[posicion : posicion + 1].decode(), posicion + 1


def _hexadecimal(datos: bytes, posicion: int) -> tuple[Valor, int]:
    """Lee una cadena «<48656C6C6F>»; con una cifra impar, la última se completa con 0.

    Args:
        datos: El PDF o el flujo.
        posicion: Dónde está el «<».

    Returns:
        Los bytes de la cadena y la posición que sigue al «>».

    Raises:
        FormatoInesperado: Si no se cierra o lleva algo que no es una cifra hexadecimal.
    """
    fin = datos.find(b">", posicion)
    exigir(fin >= 0, "PDF: una cadena hexadecimal no se cierra")
    cifras = re.sub(rb"\s", b"", datos[posicion + 1 : fin])
    exigir(re.fullmatch(rb"[0-9A-Fa-f]*", cifras) is not None, "PDF: una cadena hexadecimal con otras letras")
    return bytes.fromhex((cifras + b"0" * (len(cifras) % 2)).decode()), fin + 1


def _nombre(datos: bytes, posicion: int) -> tuple[Valor, int]:
    """Lee un nombre «/Font», con sus «#xx» ya convertidos.

    Args:
        datos: El PDF o el flujo.
        posicion: Dónde está la «/».

    Returns:
        El nombre y la posición siguiente.
    """
    nombre = NOMBRE.match(datos, posicion)
    limpio = re.sub(rb"#([0-9A-Fa-f]{2})", lambda par: bytes([int(par.group(1), 16)]), nombre.group()[1:])
    return Nombre(limpio.decode("latin-1")), nombre.end()


# Cómo se lee cada pieza según su primer carácter; las demás son palabras (números, valores u operadores).
LECTORES = {
    b"[": _delimitador,
    b"]": _delimitador,
    b"{": _delimitador,
    b"}": _delimitador,
    b"(": _cadena_literal,
    b"<": _hexadecimal,
    b"/": _nombre,
}


def _ficha(datos: bytes, posicion: int) -> tuple[Valor, int]:
    """Lee la pieza que empieza en `posicion` (sin espacios delante).

    Args:
        datos: El PDF o el flujo.
        posicion: Dónde empieza.

    Returns:
        La pieza y dónde termina.
    """
    if datos.startswith((b"<<", b">>"), posicion):
        return datos[posicion : posicion + 2].decode(), posicion + 2
    lector = LECTORES.get(datos[posicion : posicion + 1])
    if lector is not None:
        return lector(datos, posicion)
    palabra = PALABRA.match(datos, posicion)
    if palabra is None:
        return Operador(datos[posicion : posicion + 1].decode("latin-1")), posicion + 1
    return _palabra(palabra.group().decode("latin-1")), palabra.end()


def fichas(datos: bytes, posicion: int = 0, hasta: tuple[str, ...] = ()) -> list[Valor]:
    """Separa las piezas de `datos` desde `posicion`.

    Una imagen en línea (BI … ID datos EI) se salta entera: sus bytes no son piezas.

    Args:
        datos: El PDF o el flujo.
        posicion: Dónde empezar.
        hasta: Palabras clave en las que se detiene («stream», «endobj»).

    Returns:
        Las piezas, en orden.
    """
    return _fichas_hasta(datos, posicion, hasta)[0]


def _fichas_hasta(datos: bytes, posicion: int, hasta: tuple[str, ...]) -> tuple[list[Valor], int]:
    """Lee piezas y conserva el final de la palabra de parada para delimitar el flujo de su propio objeto.

    Returns:
        Las piezas y la posición siguiente a la última pieza leída.
    """
    salida: list[Valor] = []
    while posicion < len(datos):
        if datos[posicion] in ESPACIOS:
            posicion += 1
            continue
        if datos[posicion] == ord("%"):
            fin = re.compile(rb"[\r\n]").search(datos, posicion)
            posicion = fin.end() if fin else len(datos)
            continue
        ficha, posicion = _ficha(datos, posicion)
        if isinstance(ficha, Operador) and ficha in hasta:
            break
        if isinstance(ficha, Operador) and ficha == "ID":
            fin = re.compile(rb"\sEI(?=\s|$)").search(datos, posicion)
            posicion = fin.end() if fin else len(datos)
            continue
        salida.append(ficha)
    return salida, posicion


def valor(piezas: list[Valor], posicion: int = 0, profundidad: int = 0) -> tuple[Valor, int]:
    """Lee el valor que empieza en `piezas[posicion]`: diccionario, lista, referencia o simple.

    Se llama a sí misma por cada diccionario o lista anidados: `MAX_ANIDAMIENTO` acota la recursión. Cada vuelta de
    sus bucles avanza `posicion`, y una lista o un diccionario sin cerrar acaban en el final de `piezas`.

    Args:
        piezas: Las piezas de `fichas`.
        posicion: Dónde empieza el valor.
        profundidad: Niveles de diccionarios o listas que lo contienen.

    Returns:
        El valor y la posición siguiente.

    Raises:
        FormatoInesperado: Si faltan piezas, si un diccionario o una lista no se cierran o si anidan demasiado.
    """
    exigir(profundidad < MAX_ANIDAMIENTO, f"PDF: más de {MAX_ANIDAMIENTO} niveles de diccionarios o listas")
    exigir(posicion < len(piezas), "PDF: falta un valor")
    pieza = piezas[posicion]
    if type(pieza) is str and pieza == "<<":
        diccionario, posicion = {}, posicion + 1
        while _sin_cerrar(piezas, posicion, ">>"):
            clave = piezas[posicion]
            exigir(isinstance(clave, Nombre), "PDF: una clave de diccionario no es un nombre")
            diccionario[clave], posicion = valor(piezas, posicion + 1, profundidad + 1)
        return diccionario, posicion + 1
    if type(pieza) is str and pieza == "[":
        lista, posicion = [], posicion + 1
        while _sin_cerrar(piezas, posicion, "]"):
            elemento, posicion = valor(piezas, posicion, profundidad + 1)
            lista.append(elemento)
        return lista, posicion + 1
    es_referencia = (
        type(pieza) is int
        and posicion + 2 < len(piezas)
        and type(piezas[posicion + 1]) is int
        and isinstance(piezas[posicion + 2], Operador)
        and piezas[posicion + 2] == "R"
    )
    if es_referencia:
        return Referencia(pieza, piezas[posicion + 1]), posicion + 3
    return pieza, posicion + 1


def _sin_cerrar(piezas: list[Valor], posicion: int, cierre: str) -> bool:
    """Comprueba si en `posicion` sigue el diccionario o la lista abiertos.

    Args:
        piezas: Las piezas.
        posicion: La posición.
        cierre: «>>» o «]».

    Returns:
        True si la pieza no es el cierre.

    Raises:
        FormatoInesperado: Si `piezas` se acaba antes del cierre.
    """
    exigir(posicion < len(piezas), f"PDF: falta un «{cierre}»")
    return not (type(piezas[posicion]) is str and piezas[posicion] == cierre)


# ---------------------------------------------------------------------------------------------------------------------
# El documento: objetos, flujos y páginas
# ---------------------------------------------------------------------------------------------------------------------


def _descodificar(datos: bytes, filtro: Valor) -> bytes:
    """Aplica un filtro admitido, con límite Flate y error del lector ante bytes dañados.

    Returns:
        Los bytes descodificados.

    Raises:
        FormatoInesperado: Si el filtro no se admite, sus datos están dañados o exceden el límite.
    """
    try:
        if filtro == "ASCII85Decode":
            limpio = re.sub(rb"\s", b"", datos)
            return base64.a85decode(limpio.removeprefix(b"<~").split(b"~>")[0])
        if filtro == "FlateDecode":
            descompresor = zlib.decompressobj()
            salida = descompresor.decompress(datos, MAX_FLUJO_BYTES)
            exigir(not descompresor.unconsumed_tail, f"PDF: un flujo pasa de {MAX_FLUJO_BYTES} bytes descomprimido")
            exigir(descompresor.eof, "PDF: un flujo FlateDecode está incompleto")
            return salida
    except (ValueError, zlib.error) as error:
        raise FormatoInesperado(f"PDF: un flujo {filtro} está dañado ({error})") from error
    raise FormatoInesperado(f"PDF: filtro {filtro} no soportado")


class Documento:
    """Un PDF leído por su tabla de referencias cruzadas; cada objeto se lee la primera vez que se pide."""

    def __init__(self, datos: bytes) -> None:
        exigir(datos.startswith(b"%PDF-"), "PDF: no empieza por %PDF-")
        self.datos = datos
        self.desplazamientos: dict[int, int] = {}
        self.trailer: dict[str, Valor] = {}
        self._leidos: dict[int, Valor] = {}
        # Los objetos que se están leyendo: pedir otra vez uno de ellos (su /Length lleva a él) es un ciclo.
        self._en_lectura: set[int] = set()
        inicio = re.findall(rb"startxref\s+(\d+)", datos[-COLA_CON_STARTXREF:])
        exigir(bool(inicio), "PDF: no dice dónde empieza su tabla de referencias")
        self._leer_tablas(int(inicio[-1]))
        exigir("Encrypt" not in self.trailer, "PDF: el documento está cifrado")

    def _leer_tablas(self, posicion: int | None) -> None:
        """Cada tabla de referencias, de la más reciente a la más antigua: una entrada posterior manda.

        La cadena de `Prev` termina en la tabla que no lo lleva; una que vuelve a una tabla ya leída falla. Dentro de
        una tabla, cada bloque avanza `posicion` o falla, así que el bucle interior acaba en «trailer» o en un error.
        Las entradas que declara un bloque tienen que caber en los bytes que quedan: su bucle también tiene tope.
        """
        leidas: set[int] = set()
        resueltos: set[int] = set()
        while posicion is not None:
            exigir(posicion not in leidas, "PDF: la cadena de tablas de referencias (Prev) vuelve sobre sí misma")
            leidas.add(posicion)
            exigir(self.datos.startswith(b"xref", posicion), "PDF: tabla de referencias en flujo, no se lee")
            cabecera = re.compile(rb"\s*(\d+)\s+(\d+)\s*[\r\n]")
            posicion += len(b"xref")
            while not self.datos.startswith(b"trailer", posicion):
                bloque = cabecera.match(self.datos, posicion)
                exigir(bloque is not None, "PDF: tabla de referencias ilegible")
                primero, cuantos = int(bloque.group(1)), int(bloque.group(2))
                posicion = bloque.end()
                exigir(
                    posicion + cuantos * LARGO_ENTRADA_XREF <= len(self.datos),
                    f"PDF: la tabla de referencias declara {cuantos} entradas y no caben en lo que queda del archivo",
                )
                for orden in range(cuantos):
                    entrada = self.datos[posicion : posicion + LARGO_ENTRADA_XREF]
                    numero = primero + orden
                    marca = entrada[POSICION_DE_LA_MARCA : POSICION_DE_LA_MARCA + 1]
                    exigir(marca in (b"n", b"f"), "PDF: una entrada de la tabla de referencias con marca desconocida")
                    if numero not in resueltos and marca == b"n":
                        cifras = entrada[:CIFRAS_DEL_DESPLAZAMIENTO]
                        exigir(cifras.isdigit(), "PDF: una entrada de la tabla de referencias sin desplazamiento")
                        self.desplazamientos[numero] = int(cifras)
                    # Una entrada libre reciente también manda: Prev no puede resucitar el objeto.
                    resueltos.add(numero)
                    posicion += LARGO_ENTRADA_XREF
                posicion = re.compile(rb"\s*").match(self.datos, posicion).end()
            trailer, _ = valor(fichas(self.datos, posicion + len(b"trailer"), hasta=("startxref",)))
            exigir(isinstance(trailer, dict), "PDF: el trailer no es un diccionario")
            self.trailer = {**trailer, **self.trailer}
            anterior = trailer.get("Prev")
            exigir(anterior is None or type(anterior) is int, "PDF: Prev no es la posición de una tabla")
            posicion = anterior

    def objeto(self, numero: int) -> Valor:
        """Lee el objeto indirecto `numero` la primera vez que se pide.

        Args:
            numero: El número del objeto.

        Returns:
            Su valor o, si es un flujo, un Flujo con su diccionario y sus bytes; None si la tabla no lo tiene.

        Raises:
            FormatoInesperado: Si no está donde dice la tabla, si está mal formado o si su lectura lleva a él mismo.
        """
        if numero in self._leidos:
            return self._leidos[numero]
        desplazamiento = self.desplazamientos.get(numero)
        if desplazamiento is None:
            return None
        exigir(numero not in self._en_lectura, f"PDF: leer el objeto {numero} lleva otra vez a él")
        cabecera = re.compile(rb"\s*(\d+)\s+\d+\s+obj").match(self.datos, desplazamiento)
        exigir(cabecera is not None, f"PDF: el objeto {numero} no está donde dice la tabla")
        exigir(
            _palabra(cabecera.group(1).decode("ascii")) == numero,
            f"PDF: el objeto {numero} tiene otro número en la cabecera que indica la tabla",
        )
        self._en_lectura.add(numero)
        try:
            piezas, fin = _fichas_hasta(self.datos, cabecera.end(), ("stream", "endobj"))
            contenido, _ = valor(piezas)
            if self.datos[fin - len(b"stream") : fin] == b"stream":
                exigir(
                    isinstance(contenido, dict) and "Length" in contenido, "PDF: un stream sin diccionario con Length"
                )
                contenido = self._flujo(contenido, fin)
        finally:
            self._en_lectura.discard(numero)
        self._leidos[numero] = contenido
        return contenido

    def _flujo(self, diccionario: dict[str, Valor], desde: int) -> Flujo:
        """Lee los bytes del flujo que sigue al diccionario, con la longitud que declara.

        Args:
            diccionario: El diccionario del flujo, con su /Length.
            desde: Dónde termina la palabra «stream» del propio objeto.

        Returns:
            El flujo con sus bytes sin descodificar.

        Raises:
            FormatoInesperado: Si falta «stream» o /Length no es un número de bytes (≥ 0).
        """
        marca = re.compile(rb"\r?\n").match(self.datos, desde)
        exigir(marca is not None, "PDF: un flujo sin «stream»")
        largo = self.resolver(diccionario["Length"])
        exigir(
            type(largo) is int and largo >= 0,
            "PDF: la longitud de un flujo no es un número de bytes",
        )
        fin = marca.end() + largo
        exigir(fin <= len(self.datos), "PDF: la longitud de un flujo pasa del final del archivo")
        cierre = re.compile(rb"(?:\r\n|[\r\n])?endstream(?=[\x00\t\n\x0c\r ()<>\[\]{}/%]|$)")
        exigir(cierre.match(self.datos, fin) is not None, "PDF: la longitud del flujo no termina en «endstream»")
        return Flujo(diccionario, self.datos[marca.end() : fin])

    def resolver(self, contenido: Valor) -> Valor:
        """Sigue una referencia hasta su valor.

        Una cadena de referencias sin ciclo pasa como mucho una vez por cada objeto de la tabla: más saltos son ciclo.

        Args:
            contenido: Un valor o una referencia.

        Returns:
            El valor al que lleva la referencia, o el mismo valor si no lo es.

        Raises:
            FormatoInesperado: Si la cadena de referencias vuelve sobre sí misma.
        """
        for _ in range(len(self.desplazamientos) + 1):
            if not isinstance(contenido, Referencia):
                return contenido
            contenido = self.objeto(contenido.numero)
        raise FormatoInesperado("PDF: una referencia lleva, a través de otras, a sí misma")

    def bytes_de(self, flujo: Flujo) -> bytes:
        """Descodifica los bytes de un flujo con sus filtros.

        Args:
            flujo: El flujo.

        Returns:
            Los bytes descodificados, MAX_FLUJO_BYTES como mucho por filtro.

        Raises:
            FormatoInesperado: Si un filtro no se admite o el flujo descomprimido pasa del tope.
        """
        filtros = self.resolver(flujo.diccionario.get("Filter", []))
        filtros = filtros if isinstance(filtros, list) else [filtros]
        parametros = self.resolver(flujo.diccionario.get("DecodeParms"))
        parametros = parametros if isinstance(parametros, list) else [parametros] * len(filtros)
        exigir(len(parametros) == len(filtros), "PDF: DecodeParms no corresponde a los filtros")
        datos = flujo.crudo
        for filtro, propios in zip(filtros, parametros, strict=True):
            propios = self.resolver(propios)
            exigir(propios is None or isinstance(propios, dict), "PDF: DecodeParms no es un diccionario")
            if propios is not None and filtro == "FlateDecode":
                predictor = self.resolver(propios.get("Predictor", 1))
                exigir(type(predictor) is int and predictor == 1, "PDF: Predictor de FlateDecode no soportado")
            datos = _descodificar(datos, filtro)
        return datos

    def paginas(self) -> list[dict[str, Valor]]:
        """Recorre las páginas en su orden, cada una con los recursos que hereda de sus nodos.

        Cada nodo se visita una vez: un árbol que vuelve a un nodo ya visitado (un ciclo en `Kids`) falla.

        Returns:
            El diccionario de cada página con sus recursos.

        Raises:
            FormatoInesperado: Si el árbol de páginas vuelve a un nodo ya visitado.
        """
        raiz = self.resolver(self.trailer.get("Root"))
        exigir(isinstance(raiz, dict) and "Pages" in raiz, "PDF: el catálogo no declara su árbol de páginas")
        salida: list[dict[str, Valor]] = []
        pendientes = [(self.resolver(raiz["Pages"]), {})]
        visitados: set[int] = set()
        while pendientes:
            nodo, heredado = pendientes.pop(0)
            exigir(isinstance(nodo, dict), "PDF: un nodo del árbol de páginas no es un diccionario")
            exigir(id(nodo) not in visitados, "PDF: el árbol de páginas vuelve a un nodo ya visitado")
            visitados.add(id(nodo))
            propios = {**heredado, **{clave: nodo[clave] for clave in ("Resources",) if clave in nodo}}
            if nodo.get("Type") == "Page" or "Kids" not in nodo:
                salida.append({**nodo, **propios})
                continue
            referencias = self.resolver(nodo["Kids"])
            exigir(isinstance(referencias, list), "PDF: Kids no es una lista de páginas")
            hijos = [(self.resolver(hijo), propios) for hijo in referencias]
            pendientes = hijos + pendientes
        return salida
