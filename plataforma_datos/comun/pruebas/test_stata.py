"""Variantes declaradas y errores del lector Stata en flujos sintéticos hacia delante."""

import io
import struct
import unittest

from plataforma_datos.comun.nucleo import FormatoInesperado
from plataforma_datos.comun.stata import leer_dta


def archivo_dta(
    variables: list[tuple[bytes, int]], filas: list[bytes], version: int = 119, orden: str = ">", relleno: bytes = b""
) -> bytes:
    """Construye las secciones que consume el lector, con posiciones y tamaños exactos.

    Returns:
        Los bytes de la cabecera, mapa, tipos, nombres, relleno y datos.
    """
    tipo_k = {118: "H", 119: "I"}[version]
    cabecera = (
        (
            f"<stata_dta><header><release>{version}</release><byteorder>"
            f"{'LSF' if orden == '<' else 'MSF'}</byteorder><K>"
        ).encode()
        + struct.pack(f"{orden}{tipo_k}", len(variables))
        + b"</K><N>"
        + struct.pack(f"{orden}Q", len(filas))
        + b"</N><label>"
        + struct.pack(f"{orden}H", 3)
        + b"uno</label><timestamp>"
        + struct.pack("B", 0)
        + b"</timestamp></header>"
    )
    tipos = (
        b"<variable_types>" + b"".join(struct.pack(f"{orden}H", tipo) for _, tipo in variables) + b"</variable_types>"
    )
    nombres = b"<varnames>" + b"".join(nombre.ljust(129, b"\0") for nombre, _ in variables) + b"</varnames>"
    inicio_tipos = len(cabecera) + len(b"<map></map>") + 14 * 8
    inicio_nombres = inicio_tipos + len(tipos)
    inicio_datos = inicio_nombres + len(nombres) + len(relleno)
    datos = b"<data>" + b"".join(filas) + b"</data>"
    mapa = [0, len(cabecera), inicio_tipos, inicio_nombres, *([inicio_datos] * 6), *([inicio_datos + len(datos)] * 4)]
    return cabecera + b"<map>" + struct.pack(f"{orden}14Q", *mapa) + b"</map>" + tipos + nombres + relleno + datos


class FlujoHaciaDelante(io.BytesIO):
    """Un flujo sin búsqueda y con descartes de metadatos acotados."""

    def seek(self, offset: int, whence: int = 0) -> int:
        """Impide que una implementación dependa de rebobinar.

        Raises:
            AssertionError: Si el lector intenta buscar una posición.
        """
        raise AssertionError("el lector no debe usar seek")

    def read(self, size: int = -1) -> bytes:
        """Comprueba que el descarte no pide todo un bloque arbitrariamente grande.

        Returns:
            Los bytes solicitados.

        Raises:
            AssertionError: Si se solicita más de un bloque de descarte.
        """
        if size < 0 or size > io.DEFAULT_BUFFER_SIZE:
            raise AssertionError(f"lectura sin acotar: {size}")
        return super().read(size)


class PruebasStataFormato(unittest.TestCase):
    """Cobertura de 118/119 y MSF/LSF, sin duplicar los dos nominales originales."""

    def test_variantes_y_tipos_numericos(self) -> None:
        """Ambos anchos de K y órdenes de bytes conservan todos los tipos y ausentes."""
        variables = [(b"b", 65530), (b"h", 65529), (b"i", 65528), (b"f", 65527), (b"d", 65526)]
        for version in (118, 119):
            for orden in ("<", ">"):
                with self.subTest(version=version, orden=orden):
                    filas = [
                        struct.pack(f"{orden}bhifd", -5, -1000, 42, 1.5, -2.25),
                        struct.pack(
                            f"{orden}bhifd", 127, 32767, 2147483647, 1.7014118346046923e38, 8.98846567431158e307
                        ),
                    ]
                    self.assertEqual(
                        list(
                            leer_dta(
                                io.BytesIO(archivo_dta(variables, filas, version, orden)), ("b", "h", "i", "f", "d")
                            )
                        ),
                        [
                            {"b": -5, "h": -1000, "i": 42, "f": 1.5, "d": -2.25},
                            dict.fromkeys(("b", "h", "i", "f", "d")),
                        ],
                    )

    def test_salto_grande_sigue_hacia_delante(self) -> None:
        """Los metadatos no solicitados se descartan por bloques, sin retenerlos ni buscar."""
        contenido = archivo_dta(
            [(b"codigo", 4), (b"larga", 32768)], [b"4110" + b"\0" * 8], relleno=b"x" * (io.DEFAULT_BUFFER_SIZE * 2)
        )
        self.assertEqual(list(leer_dta(FlujoHaciaDelante(contenido), ("codigo",))), [{"codigo": "4110"}])

    def test_release_ilegible_tiene_causa(self) -> None:
        """Un release no numérico se identifica como error del archivo Stata."""
        contenido = archivo_dta([(b"x", 65530)], [b"\1"]).replace(b">119</release>", b">abc</release>")
        with self.assertRaisesRegex(FormatoInesperado, "Stata:.*versión") as captura:
            list(leer_dta(io.BytesIO(contenido), ("x",)))
        self.assertIsInstance(captura.exception.__cause__, ValueError)

    def test_nombre_ilegible_tiene_causa(self) -> None:
        """Los nombres mal codificados no escapan como UnicodeDecodeError sin contexto."""
        with self.assertRaisesRegex(FormatoInesperado, "Stata:.*nombre.*UTF-8") as captura:
            list(leer_dta(io.BytesIO(archivo_dta([(b"\xff", 65530)], [b"\1"])), ("x",)))
        self.assertIsInstance(captura.exception.__cause__, UnicodeDecodeError)

    def test_cadena_ilegible_tiene_causa(self) -> None:
        """El error de una cadena identifica su variable."""
        with self.assertRaisesRegex(FormatoInesperado, "Stata:.*codigo.*UTF-8") as captura:
            list(leer_dta(io.BytesIO(archivo_dta([(b"codigo", 1)], [b"\xff"])), ("codigo",)))
        self.assertIsInstance(captura.exception.__cause__, UnicodeDecodeError)

    def test_etiquetas_intermedias(self) -> None:
        """Las secciones consumidas no aceptan cierres o aperturas intermedias corruptas."""
        contenido = archivo_dta([(b"x", 65530)], [b"\1"])
        for etiqueta in (
            b"</release>",
            b"<byteorder>",
            b"</K>",
            b"<N>",
            b"</label>",
            b"</timestamp>",
            b"</header>",
            b"</map>",
            b"</variable_types>",
            b"</varnames>",
        ):
            with self.subTest(etiqueta=etiqueta), self.assertRaisesRegex(FormatoInesperado, "Stata:.*etiqueta"):
                list(leer_dta(io.BytesIO(contenido.replace(etiqueta, etiqueta.replace(b">", b"!"), 1)), ("x",)))

    def test_nombres_duplicados(self) -> None:
        """Una variable duplicada no puede seleccionar silenciosamente la última columna."""
        with self.assertRaisesRegex(FormatoInesperado, "Stata:.*nombre.*repetid"):
            list(leer_dta(io.BytesIO(archivo_dta([(b"x", 65530), (b"x", 65530)], [b"\1\2"])), ("x",)))

    def test_truncamientos(self) -> None:
        """La cabecera, el mapa, los nombres y los registros cortados producen el error común."""
        contenido = archivo_dta([(b"x", 65530)], [b"\1"])
        for corte in (
            1,
            contenido.index(b"<map>") + 30,
            contenido.index(b"<varnames>") + 20,
            len(contenido) - 8,
            len(contenido) - 1,
        ):
            with self.subTest(corte=corte), self.assertRaisesRegex(FormatoInesperado, "Stata:"):
                list(leer_dta(io.BytesIO(contenido[:corte]), ("x",)))


if __name__ == "__main__":
    unittest.main()
