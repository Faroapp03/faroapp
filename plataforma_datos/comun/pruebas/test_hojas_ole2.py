"""Pruebas del lector de .xls (hojas.py) con contenedores OLE2 y registros BIFF8 construidos a mano.

No dependen de los originales: cada prueba arma el contenedor mínimo ([MS-CFB]) con su flujo Workbook ([MS-XLS]) y
recorre un camino del lector (FAT, DIFAT, MiniFAT, SST con CONTINUE, MULRK, fórmulas de texto) o uno de sus topes.
"""

import struct
import tempfile
import unittest
from pathlib import Path

from plataforma_datos.comun import constantes_hojas as formatos
from plataforma_datos.comun import hojas
from plataforma_datos.comun.nucleo import FormatoInesperado

# Marcas de la FAT [MS-CFB] 2.3: fin de cadena, sector de la FAT y sector libre.
FIN_DE_CADENA = 0xFFFFFFFE
SECTOR_DE_FAT = 0xFFFFFFFD
LIBRE = 0xFFFFFFFF
TIPO_RAIZ = 5
POTENCIA = {512: 9, 4096: 12}
VERSION = {512: 3, 4096: 4}
# Lo que se espera de la hoja que arma `libro`: textos, números, RK, MULRK y fórmulas de texto y de número.
TABLA = [
    ["uno", 1.5, 2.25],
    [7.0, 3.0, 4.0],
    ["etiqueta", "texto de fórmula", ""],
]


def registro(tipo: int, cuerpo: bytes) -> bytes:
    """Arma un registro BIFF.

    Args:
        tipo: Tipo del registro.
        cuerpo: Cuerpo del registro.

    Returns:
        La cabecera (tipo y largo) seguida del cuerpo.
    """
    return struct.pack("<HH", tipo, len(cuerpo)) + cuerpo


def cadena_corta(texto: str) -> bytes:
    """Arma una cadena BIFF en latin-1 con su número de caracteres (2 bytes) y sus opciones (1 byte).

    Args:
        texto: Texto representable en latin-1.

    Returns:
        Los bytes de la cadena.
    """
    return struct.pack("<HB", len(texto), 0) + texto.encode("latin-1")


def libro(sst: list[bytes], hoja: bytes, cola: bytes = b"") -> bytes:
    """Arma un flujo Workbook: una hoja «Hoja», la tabla de cadenas y los registros de la hoja.

    Args:
        sst: Cuerpo del registro SST seguido del de cada CONTINUE.
        hoja: Registros de la hoja, sin su EOF.
        cola: Bytes que se añaden tras el EOF de la hoja.

    Returns:
        El flujo Workbook.
    """
    nombre = b"Hoja"
    largo_hoja = len(registro(formatos.BOUNDSHEET, bytes(8) + nombre))
    tabla = registro(formatos.SST, sst[0]) + b"".join(registro(formatos.CONTINUE, parte) for parte in sst[1:])
    posicion = largo_hoja + len(tabla) + len(registro(formatos.EOF, b""))
    globales = registro(formatos.BOUNDSHEET, struct.pack("<IHBB", posicion, 0, len(nombre), 0) + nombre)
    return globales + tabla + registro(formatos.EOF, b"") + hoja + registro(formatos.EOF, b"") + cola


def sst_simple() -> list[bytes]:
    """Arma una tabla de cadenas con una sola cadena, «uno».

    Returns:
        El cuerpo del registro SST.
    """
    return [struct.pack("<II", 1, 1) + cadena_corta("uno")]


def hoja_completa(columna_numero: int = 1) -> bytes:
    """Arma los registros de la hoja de TABLA.

    Args:
        columna_numero: Columna del registro NUMBER de la primera fila.

    Returns:
        Los registros de la hoja.
    """
    rk_7 = (7 << 2) | formatos.RK_ENTERO
    rk_3, rk_4 = (3 << 2) | formatos.RK_ENTERO, (4 << 2) | formatos.RK_ENTERO
    formula_de_texto = struct.pack("<HHH", 2, 1, 0) + bytes(6) + formatos.SIN_VALOR_NUMERICO + bytes(6)
    return b"".join(
        [
            registro(formatos.LABELSST, struct.pack("<HHHI", 0, 0, 0, 0)),
            registro(formatos.NUMBER, struct.pack("<HHHd", 0, columna_numero, 0, 1.5)),
            registro(formatos.FORMULA, struct.pack("<HHHd", 0, 2, 0, 2.25) + bytes(6)),
            registro(formatos.RK, struct.pack("<HHHI", 1, 0, 0, rk_7)),
            registro(formatos.MULRK, struct.pack("<HHHIHIH", 1, 1, 0, rk_3, 0, rk_4, 2)),
            registro(formatos.LABEL, struct.pack("<HHHH", 2, 0, 0, len("etiqueta")) + b"\x00" + b"etiqueta"),
            registro(formatos.FORMULA, formula_de_texto),
            registro(
                formatos.STRING, struct.pack("<HB", len("texto de fórmula"), 1) + "texto de fórmula".encode("utf-16-le")
            ),
        ]
    )


def entrada(nombre: str, tipo: int, inicio: int, tamano: int) -> bytes:
    """Arma una entrada de 128 bytes del directorio OLE2.

    Args:
        nombre: Nombre de la entrada.
        tipo: Tipo de la entrada (flujo o raíz).
        inicio: Primer sector (o minisector) de su contenido.
        tamano: Tamaño del contenido, en bytes.

    Returns:
        La entrada.
    """
    datos = bytearray(formatos.ENTRADA_DIRECTORIO)
    codificado = (nombre + "\x00").encode("utf-16-le")
    datos[: len(codificado)] = codificado
    struct.pack_into("<H", datos, formatos.POSICION_LARGO_NOMBRE, len(codificado))
    datos[formatos.POSICION_TIPO_ENTRADA] = tipo
    struct.pack_into("<II", datos, formatos.POSICION_INICIO_Y_TAMANO, inicio, tamano)
    return bytes(datos)


def contenedor(flujo: bytes, tamano: int = 512, mini: bool = False, **cabecera: int) -> bytes:
    """Arma un contenedor OLE2 con un flujo Workbook: FAT en el sector 0, directorio en el 1 y el flujo después.

    Con `mini`, el flujo va en minisectores: la MiniFAT en el sector 2 y el flujo de la raíz desde el 3.

    Args:
        flujo: Contenido del flujo Workbook.
        tamano: Tamaño de sector, 512 o 4096.
        mini: Si el flujo se guarda en minisectores.
        **cabecera: Campos de la cabecera que se cambian: sectores_fat, sectores_difat, difat_0, fat_del_flujo.

    Returns:
        Los bytes del contenedor.
    """
    unidad = formatos.TAMANO_MINI_SECTOR if mini else tamano
    piezas = -(-len(flujo) // unidad)
    relleno = flujo + bytes(piezas * unidad - len(flujo))
    contenido = relleno + bytes(-len(relleno) % tamano)
    primero = 3 if mini else 2
    sectores = len(contenido) // tamano
    cadena = [primero + i + 1 for i in range(sectores - 1)] + [FIN_DE_CADENA]
    fat = [SECTOR_DE_FAT, FIN_DE_CADENA] + ([FIN_DE_CADENA] if mini else []) + cadena
    if "fat_del_flujo" in cabecera:
        fat[primero] = cabecera["fat_del_flujo"]
    enteros = tamano // struct.calcsize("<I")
    sector_fat = struct.pack(f"<{enteros}I", *(fat + [LIBRE] * (enteros - len(fat))))
    if mini:
        minifat = [i + 1 for i in range(piezas - 1)] + [FIN_DE_CADENA]
        raiz = entrada("Root Entry", TIPO_RAIZ, primero, len(relleno))
        directorio = raiz + entrada("Workbook", formatos.TIPO_FLUJO, 0, len(flujo))
        extra = struct.pack(f"<{enteros}I", *(minifat + [LIBRE] * (enteros - len(minifat))))
    else:
        directorio = entrada("Root Entry", TIPO_RAIZ, FIN_DE_CADENA, 0)
        directorio += entrada("Workbook", formatos.TIPO_FLUJO, primero, len(flujo))
        extra = b""
    cabeza = bytearray(tamano)
    cabeza[: len(formatos.FIRMA_OLE2)] = formatos.FIRMA_OLE2
    struct.pack_into("<HHHHH", cabeza, 0x18, 0x3E, VERSION[tamano], 0xFFFE, POTENCIA[tamano], 6)
    campos = (
        cabecera.get("sectores_fat", 1),
        1,
        0,
        formatos.TAMANO_MINI_SECTOR * 64 if mini else 0,
        2 if mini else FIN_DE_CADENA,
        1 if mini else 0,
        FIN_DE_CADENA,
        cabecera.get("sectores_difat", 0),
    )
    struct.pack_into("<8I", cabeza, formatos.POSICION_CAMPOS_CABECERA, *campos)
    difat = [cabecera.get("difat_0", 0)] + [LIBRE] * (formatos.ENTRADAS_DIFAT_EN_CABECERA - 1)
    struct.pack_into(f"<{formatos.ENTRADAS_DIFAT_EN_CABECERA}I", cabeza, formatos.POSICION_DIFAT_EN_CABECERA, *difat)
    return bytes(cabeza) + sector_fat + directorio + bytes(tamano - len(directorio)) + extra + contenido


class PruebaContenedorOle2(unittest.TestCase):
    """El lector recorre el contenedor y los registros, y se detiene con su motivo ante cada tope."""

    def setUp(self) -> None:
        """Abre una carpeta temporal para los archivos de cada prueba."""
        self.temporal = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporal.cleanup)

    def leer(self, datos: bytes) -> dict[str, list[list[object]]]:
        """Escribe un .xls y lo lee.

        Args:
            datos: Bytes del archivo.

        Returns:
            Lo que devuelve `leer_xls`.
        """
        ruta = Path(self.temporal.name) / "libro.xls"
        ruta.write_bytes(datos)
        return hojas.leer_xls(ruta)

    def test_cada_tipo_de_registro(self) -> None:
        """LABELSST, NUMBER, RK, MULRK, LABEL y fórmulas de número y de texto dan su celda."""
        self.assertEqual(self.leer(contenedor(libro(sst_simple(), hoja_completa()))), {"Hoja": TABLA})

    def test_sectores_de_4096_bytes(self) -> None:
        """Con sectores de 4096 la cabecera ocupa el primero: el sector n empieza en (n + 1) × 4096."""
        datos = contenedor(libro(sst_simple(), hoja_completa()), tamano=4096)
        self.assertEqual(self.leer(datos), {"Hoja": TABLA})

    def test_flujo_en_minisectores(self) -> None:
        """Un flujo menor que el corte se lee de los minisectores de la raíz, encadenados por la MiniFAT."""
        self.assertEqual(self.leer(contenedor(libro(sst_simple(), hoja_completa()), mini=True)), {"Hoja": TABLA})

    def test_sst_con_continue(self) -> None:
        """Una cadena que empieza en un CONTINUE y otra partida entre dos, que cambia de anchura, se leen enteras."""
        primera = struct.pack("<II", 3, 3) + cadena_corta("uno") + struct.pack("<HB", 4, 0) + b"Ho"
        segunda = b"\x01" + "la".encode("utf-16-le")
        tercera = cadena_corta("tres")
        hoja = registro(formatos.LABELSST, struct.pack("<HHHI", 0, 0, 0, 1))
        hoja += registro(formatos.LABELSST, struct.pack("<HHHI", 0, 1, 0, 2))
        self.assertEqual(self.leer(contenedor(libro([primera, segunda, tercera], hoja))), {"Hoja": [["Hola", "tres"]]})

    def test_ciclo_en_la_fat(self) -> None:
        """Una cadena de la FAT que vuelve sobre sí misma no deja la lectura en un bucle: tiene su tope."""
        flujo = libro(sst_simple(), hoja_completa())
        self.assertLessEqual(len(flujo), 512)
        self.assertEqual(self.leer(contenedor(flujo, fat_del_flujo=2)), {"Hoja": TABLA})

    def test_topes_de_la_cabecera(self) -> None:
        """Una DIFAT o una FAT mayores que el archivo, o un sector de la DIFAT fuera de él, se rechazan."""
        flujo = libro(sst_simple(), hoja_completa())
        for campos, motivo in [
            ({"sectores_difat": 1000}, "DIFAT de 1000 sectores"),
            ({"sectores_fat": 1000}, "FAT de 1000 sectores"),
            ({"difat_0": 50}, "sector OLE2 50 fuera del archivo"),
        ]:
            with self.subTest(campos=campos), self.assertRaisesRegex(FormatoInesperado, motivo):
                self.leer(contenedor(flujo, **campos))

    def test_mas_de_256_columnas(self) -> None:
        """Una celda más allá de la columna 256 no cabe en una hoja BIFF8."""
        with self.assertRaisesRegex(FormatoInesperado, "301 columnas"):
            self.leer(contenedor(libro(sst_simple(), hoja_completa(columna_numero=300))))

    def test_archivo_o_registros_danados(self) -> None:
        """Un archivo cortado, un índice de la SST que no existe o un registro final cortado dan su motivo."""
        completo = contenedor(libro(sst_simple(), hoja_completa()))
        indice_inexistente = registro(formatos.LABELSST, struct.pack("<HHHI", 0, 0, 0, 99))
        for datos, motivo in [
            (completo[: len(completo) - 100], "fuera del archivo|cortado"),
            (contenedor(libro(sst_simple(), indice_inexistente)), "ilegible"),
            (contenedor(libro(sst_simple(), hoja_completa(), cola=struct.pack("<HH", 0x0201, 100))), "cortado"),
        ]:
            with self.subTest(motivo=motivo), self.assertRaisesRegex(FormatoInesperado, motivo):
                self.leer(datos)

    def test_cadenas_de_registros_cortadas(self) -> None:
        """Nombre de hoja, LABEL y STRING declaran su longitud: no se devuelve una cadena truncada."""
        nombre_cortado = bytearray(libro(sst_simple(), hoja_completa()))
        nombre_cortado[formatos.CABECERA_REGISTRO + formatos.POSICION_LARGO_NOMBRE_HOJA] = len("Hoja") + 1
        etiqueta = registro(formatos.LABEL, struct.pack("<HHHH", 0, 0, 0, 2) + b"\x00a")
        etiqueta_utf16 = registro(formatos.LABEL, struct.pack("<HHHH", 0, 0, 0, 2) + b"\x01a\x00")
        formula = registro(
            formatos.FORMULA, struct.pack("<HHH", 0, 0, 0) + bytes(6) + formatos.SIN_VALOR_NUMERICO + bytes(6)
        )
        resultado = registro(formatos.STRING, struct.pack("<HB", 2, 0) + b"a")
        casos = {
            "nombre": bytes(nombre_cortado),
            "LABEL": libro(sst_simple(), etiqueta),
            "LABEL UTF-16": libro(sst_simple(), etiqueta_utf16),
            "STRING": libro(sst_simple(), formula + resultado),
        }
        for caso, flujo in casos.items():
            with self.subTest(caso=caso), self.assertRaisesRegex(FormatoInesperado, "cadena BIFF cortada"):
                self.leer(contenedor(flujo))


if __name__ == "__main__":
    unittest.main()
