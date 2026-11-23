"""Campos, marcas y límites de los formatos OLE2, BIFF8 y Office Open XML que lee hojas.py."""

import re
import struct

# OLE2 [MS-CFB]: cabecera, entradas del directorio y marcas de la tabla de sectores (FAT). La cabecera ocupa 512 bytes
# y, con sectores de 4096, el primer sector entero ([MS-CFB] 2.2): el sector n empieza en (n + 1) × tamaño de sector.
FIRMA_OLE2 = bytes.fromhex("D0CF11E0A1B11AE1")
CABECERA_OLE2 = 512
BYTES_POR_ENTERO = 4  # las tablas de sectores (FAT, DIFAT, MiniFAT) son enteros sin signo de 32 bits
POSICION_POTENCIA_SECTOR = 0x1E  # el tamaño de sector es 2 elevado a este valor
POSICION_POTENCIA_MINI_SECTOR = 0x20
TAMANOS_DE_SECTOR = (512, 4096)  # [MS-CFB] 2.2: la potencia del sector solo puede ser 9 o 12
TAMANO_MINI_SECTOR = 64  # [MS-CFB] 2.2: la potencia del minisector siempre es 6
POSICION_CAMPOS_CABECERA = 0x2C  # ocho enteros: FAT, directorio, minisectores y DIFAT
POSICION_DIFAT_EN_CABECERA = 0x4C
ENTRADAS_DIFAT_EN_CABECERA = 109
ENTRADA_DIRECTORIO = 128
POSICION_LARGO_NOMBRE = 64  # en bytes, con el carácter nulo final
POSICION_TIPO_ENTRADA = 66
POSICION_INICIO_Y_TAMANO = 116
MARCA_ESPECIAL = 0xFFFFFFFA  # umbral del lector: último sector normal MAXREGSECT y, por encima, marcas [MS-CFB]
TIPO_FLUJO = 2
FLUJOS_LIBRO = ("Workbook", "Book")

# BIFF8 [MS-XLS]: tipos de registro que se leen.
BOUNDSHEET = 0x0085
SST = 0x00FC
CONTINUE = 0x003C
EOF = 0x000A
LABELSST = 0x00FD
NUMBER = 0x0203
RK = 0x027E
MULRK = 0x00BD
LABEL = 0x0204
FORMULA = 0x0006
STRING = 0x0207
TIPOS_CON_VALOR = (LABELSST, NUMBER, RK, MULRK, LABEL, FORMULA)  # empiezan por fila y columna
CABECERA_REGISTRO = 4  # tipo y largo, dos enteros de 16 bits
SIN_VALOR_NUMERICO = b"\xff\xff"  # bytes 6-7 del resultado de una fórmula que no es un número
RK_ENTRE_100 = 1  # bit del número RK: el valor está multiplicado por 100
RK_ENTERO = 2  # bit del número RK: entero de 30 bits en lugar de los bits altos de un double
RK_SIGNO = 0x20000000
RK_MODULO = 0x40000000
SST_CON_FORMATOS = 8  # bits de opciones de una cadena de la SST
SST_CON_EXTENSION = 4
CADENA_ANCHA = 1
COLUMNAS_BIFF8 = 256  # [MS-XLS]: una hoja BIFF8 tiene como mucho 256 columnas (y 65 536 filas, el tope de su entero)

# XLSX (Office Open XML): relación de cada hoja del libro con su parte XML.
LIBRO_XLSX = "xl/workbook.xml"
RELACIONES_DEL_LIBRO = "xl/_rels/workbook.xml.rels"
ATRIBUTO_RELACION = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
# Campos de los registros BIFF8 [MS-XLS]: SST, BoundSheet8, Cell, Label, Formula, MulRk, String y RK.
RK_MASCARA_VALOR = 0xFFFFFFFC
RK_DESPLAZAMIENTO_DOUBLE = 32
POSICION_CADENAS_SST = 8
POSICION_LARGO_NOMBRE_HOJA = 6
POSICION_OPCIONES_NOMBRE_HOJA = 7
POSICION_NOMBRE_HOJA = 8
POSICION_VALOR_CELDA = 6
POSICION_MARCA_FORMULA = 12
LARGO_MARCA_FORMULA = 2
POSICION_OPCIONES_LABEL = 8
POSICION_TEXTO_LABEL = 9
POSICION_TEXTO_STRING = 3
BYTES_POR_FORMATO_SST = 4
LARGO_BLOQUE_MULRK = 6
BYTES_FIJOS_MULRK = 6
POSICION_PRIMER_RK_MULRK = 6
REFERENCIA_DE_CELDA = re.compile(r"([A-Z]+)\d+")

# Lo que sale de un archivo dañado al leerlo byte a byte: se traduce a FormatoInesperado con el nombre del archivo.
ERRORES_DE_LECTURA = (IndexError, struct.error, UnicodeDecodeError, ValueError)
