"""Lectores propios de hojas de cálculo: .xlsx (Office Open XML) y .xls (BIFF8 dentro de un contenedor OLE2).

Evitan depender de librerías externas: solo leen lo que usan las fuentes de Faro (valores de celdas, cadenas
compartidas o en línea, números RK y fórmulas con resultado). Python estándar: el XML de los .xlsx se lee con
`xml.etree`, y los .xls, registro a registro.

Referencias de los formatos binarios: [MS-CFB] para el contenedor OLE2 y [MS-XLS] para los registros BIFF8.
"""

import struct
import zipfile
from collections.abc import Iterable, Iterator
from pathlib import Path
from typing import NamedTuple
from xml.etree import ElementTree

from plataforma_datos.comun import constantes_hojas as formatos
from plataforma_datos.comun.nucleo import FormatoInesperado, exigir, leer_del_zip

# ---------------------------------------------------------------------------------------------------------------------
# Tipos
# ---------------------------------------------------------------------------------------------------------------------

type Posicion = tuple[int, int]  # (fila, columna), desde 0


class _EntradaDirectorio(NamedTuple):
    """Entrada del directorio de un contenedor OLE2."""

    nombre: str
    tipo: int
    inicio: int
    tamano: int


class _Ole2:
    """Lector mínimo de un contenedor OLE2: sectores, cadenas de la FAT y flujos por nombre.

    Invariante: `fat` tiene una entrada por sector de las tablas leídas, y cada sector que se lee existe en el archivo.
    """

    def __init__(self, datos: bytes, nombre: str) -> None:
        """Lee la cabecera del contenedor y su tabla de sectores.

        Args:
            datos: Bytes del archivo.
            nombre: Nombre del archivo, para el motivo de un error.

        Raises:
            FormatoInesperado: Si no es un contenedor OLE2 o su cabecera no es válida.
        """
        if datos[: len(formatos.FIRMA_OLE2)] != formatos.FIRMA_OLE2:
            raise FormatoInesperado(f"{nombre} no es un .xls OLE2")
        self.datos = datos
        self.nombre = nombre
        self.tamano_sector = 1 << struct.unpack_from("<H", datos, formatos.POSICION_POTENCIA_SECTOR)[0]
        self.tamano_mini = 1 << struct.unpack_from("<H", datos, formatos.POSICION_POTENCIA_MINI_SECTOR)[0]
        exigir(self.tamano_sector in formatos.TAMANOS_DE_SECTOR, f"{nombre}: sector OLE2 de {self.tamano_sector} bytes")
        exigir(
            self.tamano_mini == formatos.TAMANO_MINI_SECTOR, f"{nombre}: minisector OLE2 de {self.tamano_mini} bytes"
        )
        exigir(len(datos) >= formatos.CABECERA_OLE2, f"{nombre}: cabecera OLE2 cortada ({len(datos)} bytes)")
        (
            sectores_fat,
            self.inicio_directorio,
            _,
            self.corte_mini_flujo,
            self.inicio_minifat,
            _,
            inicio_difat,
            sectores_difat,
        ) = struct.unpack_from("<8I", datos, formatos.POSICION_CAMPOS_CABECERA)
        self.fat = self._fat(sectores_fat, inicio_difat, sectores_difat)

    @property
    def sectores_del_archivo(self) -> int:
        """Número de sectores completos que hay en el archivo después de la cabecera."""
        return len(self.datos) // self.tamano_sector - 1

    def _sector(self, numero: int) -> bytes:
        """Lee un sector del contenedor.

        Args:
            numero: Número del sector, desde 0.

        Returns:
            Los `tamano_sector` bytes del sector.

        Raises:
            FormatoInesperado: Si el sector no está entero en el archivo.
        """
        exigir(0 <= numero < self.sectores_del_archivo, f"{self.nombre}: sector OLE2 {numero} fuera del archivo")
        inicio = (numero + 1) * self.tamano_sector
        return self.datos[inicio : inicio + self.tamano_sector]

    def _enteros(self, sector: bytes) -> tuple[int, ...]:
        """Lee un sector como enteros sin signo de 32 bits.

        Args:
            sector: Bytes de un sector entero.

        Returns:
            Los enteros del sector, en orden.
        """
        return struct.unpack(f"<{self.tamano_sector // formatos.BYTES_POR_ENTERO}I", sector)

    def _fat(self, sectores_fat: int, inicio_difat: int, sectores_difat: int) -> list[int]:
        """Tabla de sectores: sus sectores se listan en la DIFAT, que empieza en la cabecera y sigue encadenada.

        La cadena de la DIFAT no puede tener más sectores que el archivo: ese es su tope, aunque tuviera un ciclo. La
        FAT tampoco: así no crece sin relación con el archivo aunque la DIFAT repita un sector.

        Args:
            sectores_fat: Sectores de la FAT, según la cabecera.
            inicio_difat: Primer sector de la DIFAT fuera de la cabecera.
            sectores_difat: Sectores de la DIFAT fuera de la cabecera.

        Returns:
            La FAT: el sector siguiente de cada sector, o una marca.

        Raises:
            FormatoInesperado: Si la FAT o la DIFAT declaran más sectores de los que tiene el archivo.
        """
        sectores_del_archivo = self.sectores_del_archivo
        exigir(sectores_difat <= sectores_del_archivo, f"{self.nombre}: DIFAT de {sectores_difat} sectores")
        exigir(sectores_fat <= sectores_del_archivo, f"{self.nombre}: FAT de {sectores_fat} sectores")
        difat = list(
            struct.unpack_from(
                f"<{formatos.ENTRADAS_DIFAT_EN_CABECERA}I", self.datos, formatos.POSICION_DIFAT_EN_CABECERA
            )
        )
        siguiente = inicio_difat
        for _ in range(sectores_difat):
            valores = self._enteros(self._sector(siguiente))
            difat += valores[:-1]
            siguiente = valores[-1]
        fat: list[int] = []
        for numero in difat[:sectores_fat]:
            if numero < formatos.MARCA_ESPECIAL:
                fat += self._enteros(self._sector(numero))
        return fat

    def _cadena(self, inicio: int) -> list[int]:
        """Sectores encadenados desde `inicio` (con tope por si la FAT tuviera un ciclo).

        Returns:
            Los números de sector de la cadena, en orden; como mucho tantos como entradas tiene la FAT.
        """
        sectores: list[int] = []
        numero = inicio
        while numero < formatos.MARCA_ESPECIAL and len(sectores) <= len(self.fat):
            sectores.append(numero)
            numero = self.fat[numero]
        return sectores

    def _leer_cadena(self, inicio: int) -> bytes:
        """Contenido de los sectores encadenados desde `inicio`.

        Returns:
            Los bytes de los sectores de la cadena, unidos.
        """
        return b"".join(self._sector(numero) for numero in self._cadena(inicio))

    def _entradas(self) -> list[_EntradaDirectorio]:
        """Entradas del directorio; la primera es la raíz, dueña de los minisectores.

        Returns:
            Cada entrada del directorio con su nombre, tipo, primer sector y tamaño en bytes.
        """
        directorio = self._leer_cadena(self.inicio_directorio)
        entradas: list[_EntradaDirectorio] = []
        for i in range(len(directorio) // formatos.ENTRADA_DIRECTORIO):
            entrada = directorio[i * formatos.ENTRADA_DIRECTORIO : (i + 1) * formatos.ENTRADA_DIRECTORIO]
            largo = struct.unpack_from("<H", entrada, formatos.POSICION_LARGO_NOMBRE)[0]
            inicio, tamano = struct.unpack_from("<II", entrada, formatos.POSICION_INICIO_Y_TAMANO)
            nombre = entrada[: max(largo - 2, 0)].decode("utf-16-le", "ignore")
            entradas.append(_EntradaDirectorio(nombre, entrada[formatos.POSICION_TIPO_ENTRADA], inicio, tamano))
        return entradas

    def _mini_flujo(self, inicio_raiz: int, inicio: int, tamano: int) -> bytes:
        """Flujo pequeño: vive en minisectores dentro del flujo de la entrada raíz, encadenados por la MiniFAT.

        Returns:
            El contenido del flujo, recortado a `tamano` bytes.
        """
        mini = self._leer_cadena(inicio_raiz)
        minifat: list[int] = []
        for numero in self._cadena(self.inicio_minifat):
            minifat += self._enteros(self._sector(numero))
        trozos: list[bytes] = []
        numero = inicio
        # Con tope, como `cadena`, por si la MiniFAT tuviera un ciclo.
        while numero < formatos.MARCA_ESPECIAL and len(trozos) <= len(minifat):
            trozos.append(mini[numero * self.tamano_mini : (numero + 1) * self.tamano_mini])
            numero = minifat[numero]
        return b"".join(trozos)[:tamano]

    def flujo(self, nombres: tuple[str, ...]) -> bytes:
        """Lee el primer flujo cuyo nombre esté en `nombres`.

        Args:
            nombres: Nombres aceptados para el flujo.

        Returns:
            El contenido del flujo, con el tamaño que declara su entrada.

        Raises:
            FormatoInesperado: Si el directorio está vacío, no hay ningún flujo con esos nombres o el flujo está
                cortado.
        """
        entradas = self._entradas()
        exigir(bool(entradas), f"{self.nombre}: directorio OLE2 vacío")
        inicio_raiz = entradas[0].inicio
        for entrada in entradas:
            if entrada.nombre not in nombres or entrada.tipo != formatos.TIPO_FLUJO:
                continue
            if entrada.tamano >= self.corte_mini_flujo:
                contenido = self._leer_cadena(entrada.inicio)[: entrada.tamano]
            else:
                contenido = self._mini_flujo(inicio_raiz, entrada.inicio, entrada.tamano)
            exigir(len(contenido) == entrada.tamano, f"{self.nombre}: flujo {entrada.nombre} cortado")
            return contenido
        raise FormatoInesperado(f"sin flujo Workbook en {self.nombre}")


class _LectorContinuo:
    """Recorre el registro SST y sus registros CONTINUE como si fueran uno solo."""

    def __init__(self, partes: list[bytes], desplazamiento: int) -> None:
        """Empieza a leer en `desplazamiento` de la primera parte.

        Args:
            partes: Cuerpo del registro SST y de cada CONTINUE que lo sigue; al menos uno.
            desplazamiento: Posición, en bytes, desde la que se lee la primera parte.
        """
        self.partes = partes
        self.parte = 0
        self.actual = partes[0]
        self.posicion = desplazamiento

    def agotado(self) -> bool:
        """Si se ha llegado al final de la parte actual.

        Returns:
            `True` si la posición está al final de la parte actual.
        """
        return self.posicion >= len(self.actual)

    def siguiente(self) -> None:
        """Pasa a la siguiente parte (registro CONTINUE).

        Raises:
            FormatoInesperado: Si no quedan partes: la SST declara más de lo que contiene.
        """
        exigir(self.parte + 1 < len(self.partes), "SST: la tabla de cadenas se acaba antes de lo que declara")
        self.parte += 1
        self.actual = self.partes[self.parte]
        self.posicion = 0

    def enteros(self, formato: str) -> tuple[int, ...]:
        """Lee enteros con `struct` y avanza.

        Returns:
            Los enteros leídos, como los da `struct.unpack_from`.
        """
        valores = struct.unpack_from(formato, self.actual, self.posicion)
        self.posicion += struct.calcsize(formato)
        return valores

    def texto(self, caracteres: int, ancho: int) -> str:
        """Lee una cadena que puede continuar en la parte siguiente, donde un byte indica su nueva anchura.

        Cada vuelta lee al menos un carácter o falla, y `siguiente` falla al acabarse las partes: el bucle termina.

        Args:
            caracteres: Caracteres de la cadena.
            ancho: Si los caracteres de la parte actual ocupan 2 bytes (UTF-16) en lugar de 1 (latin-1).

        Returns:
            La cadena entera.

        Raises:
            FormatoInesperado: Si la cadena se corta a mitad de un carácter o se acaban las partes.
        """
        trozos: list[str] = []
        ancho_actual = ancho
        leidos = 0
        while leidos < caracteres:
            if self.agotado():
                self.siguiente()
                ancho_actual = self.actual[0] & formatos.CADENA_ANCHA
                self.posicion = 1
            bytes_por_caracter = 2 if ancho_actual else 1
            cantidad = min(caracteres - leidos, (len(self.actual) - self.posicion) // bytes_por_caracter)
            exigir(cantidad > 0, "SST: una cadena se corta a mitad de un carácter")
            trozos.append(_cadena_biff(self.actual, self.posicion, cantidad, ancho_actual))
            self.posicion += cantidad * bytes_por_caracter
            leidos += cantidad
        return "".join(trozos)

    def saltar(self, cantidad: int) -> None:
        """Salta `cantidad` bytes, aunque crucen a la parte siguiente.

        Cada vuelta avanza o pasa de parte, y `siguiente` falla al acabarse las partes: el bucle termina.

        Args:
            cantidad: Bytes que se saltan.
        """
        restantes = cantidad
        while restantes:
            if self.agotado():
                self.siguiente()
            paso = min(restantes, len(self.actual) - self.posicion)
            self.posicion += paso
            restantes -= paso


# ---------------------------------------------------------------------------------------------------------------------
# XLSX: cadenas compartidas o en línea
# ---------------------------------------------------------------------------------------------------------------------


def _nombre_local(elemento: ElementTree.Element) -> str:
    """Nombre de una etiqueta sin su espacio de nombres: «{http://…/main}row» → «row».

    Returns:
        El nombre de la etiqueta sin su espacio de nombres.
    """
    return elemento.tag.rsplit("}", 1)[-1]


def _hijos(elemento: ElementTree.Element, nombre: str) -> list[ElementTree.Element]:
    """Hijos directos de un elemento con ese nombre local, tengan o no espacio de nombres.

    Returns:
        Los hijos directos con ese nombre local, en orden.
    """
    return [hijo for hijo in elemento if _nombre_local(hijo) == nombre]


def _texto_de_cadena(elemento: ElementTree.Element) -> str:
    """Texto de una cadena `<si>` o `<is>`: su `<t>` o la unión de los `<t>` de cada tramo con formato `<r>`.

    Se ignoran las guías fonéticas (`<rPh>`), que no forman parte del texto de la celda.

    Returns:
        El texto de la cadena, sin las guías fonéticas.
    """
    tramos = _hijos(elemento, "t") + [texto for tramo in _hijos(elemento, "r") for texto in _hijos(tramo, "t")]
    return "".join(texto.text or "" for texto in tramos)


def _cadenas_compartidas(libro: zipfile.ZipFile) -> list[str]:
    """Tabla de cadenas compartidas del libro; un texto con formato (varios <r>) se une en una sola cadena.

    Returns:
        Las cadenas compartidas en orden de índice; vacía si el libro no tiene tabla.
    """
    try:
        libro.getinfo("xl/sharedStrings.xml")
    except KeyError:
        return []
    raiz = ElementTree.fromstring(leer_del_zip(libro, "xl/sharedStrings.xml"))
    return [_texto_de_cadena(cadena) for cadena in _hijos(raiz, "si")]


def _valor_celda(celda: ElementTree.Element, compartidas: list[str]) -> str:
    """Valor de una celda: texto en línea, índice en la tabla de cadenas compartidas (t="s") o valor literal.

    Returns:
        El valor de la celda como texto; vacío si no tiene valor.
    """
    tipo = celda.get("t", "")
    if tipo == "inlineStr":
        return "".join(_texto_de_cadena(cadena) for cadena in _hijos(celda, "is"))
    valores = _hijos(celda, "v")
    valor = (valores[0].text or "") if valores else ""
    if tipo == "s" and valor != "":
        indice = int(valor)
        exigir(indice >= 0, f"índice de cadena compartida negativo: {indice}")
        return compartidas[indice]
    return valor


def _rutas_de_las_hojas(libro: zipfile.ZipFile, nombre: str) -> dict[str, str]:
    """Relaciona el nombre de cada hoja de un .xlsx con la ruta de su parte XML dentro del ZIP.

    Args:
        libro: Libro abierto.
        nombre: Nombre del archivo, para el motivo de un error.

    Returns:
        La ruta de cada hoja («xl/worksheets/sheet1.xml»), por su nombre.

    Raises:
        FormatoInesperado: Si una hoja cita una relación inexistente o sin destino.
    """
    destinos = {
        relacion.get("Id"): relacion.get("Target")
        for relacion in ElementTree.fromstring(leer_del_zip(libro, formatos.RELACIONES_DEL_LIBRO))
    }
    rutas: dict[str, str] = {}
    for nodo in ElementTree.fromstring(leer_del_zip(libro, formatos.LIBRO_XLSX)).iter():
        if _nombre_local(nodo) != "sheet":
            continue
        relacion = nodo.get(formatos.ATRIBUTO_RELACION)
        exigir(relacion in destinos, f"{nombre}: la hoja {nodo.get('name')} cita una relación que no existe")
        destino = destinos[relacion]
        if not destino:
            raise FormatoInesperado(f"{nombre}: la hoja {nodo.get('name')} cita una relación sin Target")
        rutas[str(nodo.get("name"))] = "xl/" + destino.lstrip("/").removeprefix("xl/")
    return rutas


def _filas_hoja(xml: bytes, compartidas: list[str]) -> list[dict[str, str]]:
    """Filas de una hoja como `{columna: valor}`, con la columna en letras (A, B…).

    Las celdas sin referencia `r` no se pueden situar en una columna y se omiten.

    Returns:
        Una fila por `<row>`, como `{columna en letras: valor}`.
    """
    filas: list[dict[str, str]] = []
    for datos_hoja in _hijos(ElementTree.fromstring(xml), "sheetData"):
        for fila in _hijos(datos_hoja, "row"):
            celdas: dict[str, str] = {}
            for celda in _hijos(fila, "c"):
                referencia = formatos.REFERENCIA_DE_CELDA.fullmatch(celda.get("r", ""))
                if referencia:
                    celdas[referencia.group(1)] = _valor_celda(celda, compartidas)
            filas.append(celdas)
    return filas


# ---------------------------------------------------------------------------------------------------------------------
# XLS: registros BIFF8
# ---------------------------------------------------------------------------------------------------------------------


def _registros(libro: bytes) -> Iterator[tuple[int, bytes]]:
    """Recorre los registros BIFF de un flujo. Cada registro avanza al menos su cabecera: el bucle acaba con el libro.

    Args:
        libro: Flujo del libro, o su parte desde el inicio de una hoja.

    Yields:
        El tipo y el cuerpo de cada registro.

    Raises:
        FormatoInesperado: Si un registro declara más bytes de los que quedan en el flujo.
    """
    posicion = 0
    while posicion + formatos.CABECERA_REGISTRO <= len(libro):
        tipo, largo = struct.unpack_from("<HH", libro, posicion)
        inicio = posicion + formatos.CABECERA_REGISTRO
        exigir(inicio + largo <= len(libro), f"registro BIFF 0x{tipo:04X} cortado al final del libro")
        yield tipo, libro[inicio : inicio + largo]
        posicion = inicio + largo


def _rk(rk: int) -> float:
    """Número RK de BIFF: entero de 30 bits o los 30 bits altos de un double, opcionalmente dividido entre 100.

    Returns:
        El número que codifica.
    """
    if rk & formatos.RK_ENTERO:
        entero = rk >> 2
        if entero & formatos.RK_SIGNO:
            entero -= formatos.RK_MODULO
        numero = float(entero)
    else:
        numero = struct.unpack(
            "<d", struct.pack("<Q", (rk & formatos.RK_MASCARA_VALOR) << formatos.RK_DESPLAZAMIENTO_DOUBLE)
        )[0]
    return numero / 100 if rk & formatos.RK_ENTRE_100 else numero


def _cadena_biff(datos: bytes, inicio: int, caracteres: int, ancho: int) -> str:
    """Cadena BIFF: UTF-16 si `ancho`, latin-1 comprimido si no.

    Returns:
        La cadena decodificada.

    Raises:
        FormatoInesperado: Si faltan bytes para los caracteres declarados.
    """
    exigir(inicio + caracteres * (2 if ancho else 1) <= len(datos), "cadena BIFF cortada")
    if ancho:
        return datos[inicio : inicio + 2 * caracteres].decode("utf-16-le")
    return datos[inicio : inicio + caracteres].decode("latin-1")


def _sst(partes: list[bytes]) -> list[str]:
    """Tabla de cadenas compartidas (SST) de un libro BIFF8.

    Returns:
        Las cadenas de la tabla, en orden de índice.
    """
    _, unicas = struct.unpack_from("<II", partes[0], 0)
    lector = _LectorContinuo(partes, formatos.POSICION_CADENAS_SST)
    cadenas: list[str] = []
    for _ in range(unicas):
        if lector.agotado():
            lector.siguiente()
        caracteres, opciones = lector.enteros("<HB")
        cantidad_formatos = lector.enteros("<H")[0] if opciones & formatos.SST_CON_FORMATOS else 0
        extension = lector.enteros("<I")[0] if opciones & formatos.SST_CON_EXTENSION else 0
        cadenas.append(lector.texto(caracteres, opciones & formatos.CADENA_ANCHA))
        # Cada formato ocupa 4 bytes; ni los formatos ni la extensión se usan.
        lector.saltar(cantidad_formatos * formatos.BYTES_POR_FORMATO_SST + extension)
    return cadenas


def _hojas_y_cadenas(registros: list[tuple[int, bytes]]) -> tuple[list[tuple[str, int]], list[str]]:
    """Nombre y posición de cada hoja, y tabla de cadenas, del bloque global del libro.

    Returns:
        El nombre de cada hoja con la posición de su BOF en el flujo, y la tabla de cadenas.
    """
    hojas: list[tuple[str, int]] = []
    cadenas: list[str] = []
    for i, (tipo, cuerpo) in enumerate(registros):
        if tipo == formatos.BOUNDSHEET:
            posicion = struct.unpack_from("<I", cuerpo, 0)[0]
            hojas.append(
                (
                    _cadena_biff(
                        cuerpo,
                        formatos.POSICION_NOMBRE_HOJA,
                        cuerpo[formatos.POSICION_LARGO_NOMBRE_HOJA],
                        cuerpo[formatos.POSICION_OPCIONES_NOMBRE_HOJA] & formatos.CADENA_ANCHA,
                    ),
                    posicion,
                )
            )
        elif tipo == formatos.SST:
            partes, j = [cuerpo], i + 1
            while j < len(registros) and registros[j][0] == formatos.CONTINUE:
                partes.append(registros[j][1])
                j += 1
            cadenas = _sst(partes)
        elif tipo == formatos.EOF:
            break
    return hojas, cadenas


def _es_formula_de_texto(cuerpo: bytes) -> bool:
    """Si una fórmula da un texto, que BIFF guarda aparte, en el registro STRING que la sigue.

    Returns:
        `True` si el resultado de la fórmula es un texto.
    """
    return (
        cuerpo[formatos.POSICION_MARCA_FORMULA : formatos.POSICION_MARCA_FORMULA + formatos.LARGO_MARCA_FORMULA]
        == formatos.SIN_VALOR_NUMERICO
        and cuerpo[formatos.POSICION_VALOR_CELDA] == 0
    )


def _valores_mulrk(fila: int, primera_columna: int, cuerpo: bytes) -> dict[Posicion, object]:
    """Números RK seguidos de una fila: tras fila y primera columna, bloques de 6 bytes (formato de 2 y número de 4).

    El registro se cierra con la última columna (2 bytes), por eso caben `(largo - 6) // 6` bloques.

    Returns:
        El número de cada celda del registro, por (fila, columna).
    """
    valores: dict[Posicion, object] = {}
    for i in range((len(cuerpo) - formatos.BYTES_FIJOS_MULRK) // formatos.LARGO_BLOQUE_MULRK):
        rk = struct.unpack_from("<I", cuerpo, formatos.POSICION_PRIMER_RK_MULRK + i * formatos.LARGO_BLOQUE_MULRK)[0]
        valores[(fila, primera_columna + i)] = _rk(rk)
    return valores


def _valor_de_celda(tipo: int, cuerpo: bytes, cadenas: list[str]) -> object | None:
    """Valor de un registro de una sola celda, que empieza por fila y columna; `None` si no aporta ninguno.

    Detrás de fila (2 bytes), columna (2) y formato (2), en el byte 6, está el valor o su referencia.

    Returns:
        El texto o el número de la celda, o `None` si el registro no aporta valor.
    """
    if tipo == formatos.LABELSST:
        return cadenas[struct.unpack_from("<I", cuerpo, formatos.POSICION_VALOR_CELDA)[0]]
    if tipo == formatos.RK:
        return _rk(struct.unpack_from("<I", cuerpo, formatos.POSICION_VALOR_CELDA)[0])
    if tipo == formatos.LABEL:
        caracteres = struct.unpack_from("<H", cuerpo, formatos.POSICION_VALOR_CELDA)[0]
        return _cadena_biff(
            cuerpo,
            formatos.POSICION_TEXTO_LABEL,
            caracteres,
            cuerpo[formatos.POSICION_OPCIONES_LABEL] & formatos.CADENA_ANCHA,
        )
    es_numero = tipo == formatos.NUMBER or (
        tipo == formatos.FORMULA
        and cuerpo[formatos.POSICION_MARCA_FORMULA : formatos.POSICION_MARCA_FORMULA + formatos.LARGO_MARCA_FORMULA]
        != formatos.SIN_VALOR_NUMERICO
    )
    if es_numero:
        return struct.unpack_from("<d", cuerpo, formatos.POSICION_VALOR_CELDA)[0]
    return None


def _valores_de_registro(tipo: int, cuerpo: bytes, cadenas: list[str]) -> dict[Posicion, object]:
    """Celdas que da un registro de valor: textos, números, números RK y resultados numéricos de fórmulas.

    Returns:
        El valor de cada celda del registro, por (fila, columna); vacío si no da ninguno.
    """
    if tipo not in formatos.TIPOS_CON_VALOR:
        return {}
    fila, columna = struct.unpack_from("<HH", cuerpo)
    if tipo == formatos.MULRK:
        return _valores_mulrk(fila, columna, cuerpo)
    valor = _valor_de_celda(tipo, cuerpo, cadenas)
    if valor is None:
        return {}
    return {(fila, columna): valor}


def _texto_de_string(cuerpo: bytes) -> str:
    """Texto de un registro STRING: el resultado de la fórmula de texto que lo precede.

    Returns:
        El texto del resultado.
    """
    caracteres, opciones = struct.unpack_from("<HB", cuerpo)
    return _cadena_biff(cuerpo, formatos.POSICION_TEXTO_STRING, caracteres, opciones & formatos.CADENA_ANCHA)


def _celdas_hoja(libro: bytes, cadenas: list[str]) -> dict[Posicion, object]:
    """Valores de las celdas de una hoja, por (fila, columna).

    Returns:
        El valor de cada celda con valor, por (fila, columna).
    """
    celdas: dict[Posicion, object] = {}
    pendiente: Posicion | None = None  # celda de una fórmula de texto: su valor llega en el registro STRING siguiente
    for tipo, cuerpo in _registros(libro):
        if tipo == formatos.EOF:
            break
        if tipo == formatos.FORMULA and _es_formula_de_texto(cuerpo):
            pendiente = struct.unpack_from("<HH", cuerpo)
        elif tipo == formatos.STRING and pendiente is not None:
            celdas[pendiente] = _texto_de_string(cuerpo)
            pendiente = None
        else:
            celdas.update(_valores_de_registro(tipo, cuerpo, cadenas))
    return celdas


def _tabla(celdas: dict[Posicion, object]) -> list[list[object]]:
    """Celdas como tabla rectangular; las vacías son ''.

    Returns:
        Las filas de la tabla, todas con el mismo número de columnas; vacía si no hay celdas.
    """
    if not celdas:
        return []
    filas = max(fila for fila, _ in celdas) + 1
    columnas = max(columna for _, columna in celdas) + 1
    exigir(columnas <= formatos.COLUMNAS_BIFF8, f"hoja BIFF8 con {columnas} columnas")
    return [[celdas.get((fila, columna), "") for columna in range(columnas)] for fila in range(filas)]


# ---------------------------------------------------------------------------------------------------------------------
# Lectura de libros
# ---------------------------------------------------------------------------------------------------------------------


def filas_xlsx(ruta: Path, hoja: int = 1) -> list[dict[str, str]]:
    """Devuelve las filas de una hoja tal cual, como `{columna: valor}` con la columna en letras (A, B…).

    Para las hojas cuya primera fila no es una cabecera (un título, notas o varias tablas una al lado de otra).

    Args:
        ruta: Archivo .xlsx.
        hoja: Número de la hoja (`xl/worksheets/sheet<hoja>.xml`), desde 1.

    Returns:
        Una fila por `<row>` de la hoja.

    Raises:
        FormatoInesperado: Si una celda cita una cadena compartida que no existe.
    """
    with zipfile.ZipFile(ruta) as libro:
        compartidas = _cadenas_compartidas(libro)
        xml = leer_del_zip(libro, f"xl/worksheets/sheet{hoja}.xml")
    try:
        return _filas_hoja(xml, compartidas)
    except formatos.ERRORES_DE_LECTURA as error:
        raise FormatoInesperado(f"{ruta}: hoja {hoja} ilegible ({error})") from error


def filas_xlsx_por_nombre(ruta: Path, nombres: Iterable[str]) -> dict[str, list[dict[str, str]]]:
    """Devuelve las filas de varias hojas de un .xlsx, buscadas por su nombre, como `{columna: valor}`.

    Las cadenas compartidas y el mapa de hojas del libro se leen una sola vez para todas.

    Args:
        ruta: Archivo .xlsx.
        nombres: Nombres de las hojas, tal como aparecen en el libro.

    Returns:
        Las filas de cada hoja pedida, por su nombre.

    Raises:
        FormatoInesperado: Si el libro no tiene una de las hojas o una celda cita una cadena compartida que no existe.
    """
    with zipfile.ZipFile(ruta) as libro:
        compartidas = _cadenas_compartidas(libro)
        rutas = _rutas_de_las_hojas(libro, str(ruta))
        resultado: dict[str, list[dict[str, str]]] = {}
        for hoja in nombres:
            exigir(hoja in rutas, f"{ruta}: el libro no tiene la hoja {hoja}")
            try:
                resultado[hoja] = _filas_hoja(leer_del_zip(libro, rutas[hoja]), compartidas)
            except formatos.ERRORES_DE_LECTURA as error:
                raise FormatoInesperado(f"{ruta}: hoja {hoja} ilegible ({error})") from error
    return resultado


def leer_xlsx(ruta: Path, hoja: int = 1) -> list[dict[str, str]]:
    """Devuelve las filas de una hoja como diccionarios, con la primera fila como cabecera.

    Las celdas se identifican por su columna (A, B…); la cabecera traduce cada columna a su nombre.

    Args:
        ruta: Archivo .xlsx.
        hoja: Número del archivo XML `xl/worksheets/sheet<hoja>.xml`, desde 1; no es la posición en el libro.

    Returns:
        Una fila por cada `<row>` después de la cabecera, con las columnas por su nombre.

    Raises:
        FormatoInesperado: Si la hoja no tiene ninguna fila.
    """
    filas = filas_xlsx(ruta, hoja)
    exigir(bool(filas), f"{ruta}: la hoja {hoja} no tiene filas")
    cabecera = filas[0]
    return [{cabecera.get(columna, columna): valor for columna, valor in fila.items()} for fila in filas[1:]]


def leer_xls(ruta: Path) -> dict[str, list[list[object]]]:
    """Devuelve `{hoja: [[celda, ...], ...]}` de un .xls BIFF8: textos como `str` y números como `float`.

    Args:
        ruta: Archivo .xls.

    Returns:
        Cada hoja como tabla rectangular, por su nombre; las celdas vacías son ''.

    Raises:
        FormatoInesperado: Si el archivo no es un .xls BIFF8 legible: firma, tamaños, índices o registros fuera de
            lo que el propio archivo contiene.
    """
    try:
        libro = _Ole2(Path(ruta).read_bytes(), str(ruta)).flujo(formatos.FLUJOS_LIBRO)
        hojas, cadenas = _hojas_y_cadenas(list(_registros(libro)))
        return {nombre: _tabla(_celdas_hoja(libro[posicion:], cadenas)) for nombre, posicion in hojas}
    except formatos.ERRORES_DE_LECTURA as error:
        raise FormatoInesperado(f"{ruta}: .xls ilegible ({type(error).__name__}: {error})") from error
