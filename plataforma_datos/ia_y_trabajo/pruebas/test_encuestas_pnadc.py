"""Errores de entrada PNADC: posiciones, ancho fijo, diccionario y códigos COD sintéticos."""

import io
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

import plataforma_datos.ia_y_trabajo.fuentes.encuestas_isco4.pnadc as pnadc
from plataforma_datos.comun.nucleo import MAX_DESCARGA_BYTES, FormatoInesperado
from plataforma_datos.ia_y_trabajo.fuentes.encuestas_isco4.diseno import Estructura

VARIABLES = (
    ("Ano", 4),
    ("Trimestre", 1),
    ("V2007", 1),
    ("V4010", 4),
    ("VD4002", 1),
    *((nombre, 8) for nombre in pnadc.PESOS_PNADC),
)


def entrada_sas() -> str:
    """El input de ancho fijo para las variables consumidas.

    Returns:
        Las líneas de posiciones SAS.
    """
    inicio = 1
    lineas = []
    for nombre, ancho in VARIABLES:
        lineas.append(f"@{inicio:04d} {nombre} ${ancho}.")
        inicio += ancho
    return "\n".join(lineas)


def registro(condicion: str = "1", ultimo_peso: str = "12345678") -> str:
    """Un registro con 201 pesos; el último permite demostrar un corte aún convertible.

    Returns:
        El registro sin salto de línea.
    """
    return f"2026214110{condicion}" + f"{1:>8}" * (len(pnadc.PESOS_PNADC) - 1) + f"{ultimo_peso:>8}"


class PruebasEntradaPnadc(unittest.TestCase):
    """Se rechazan archivos ambiguos o cortados antes de perder observaciones o pesos."""

    def test_posicion_repetida(self) -> None:
        """Dos definiciones del mismo campo no eligen silenciosamente la última."""
        for nombre in ("Ano", "V1028200"):
            with self.subTest(nombre=nombre), self.assertRaisesRegex(FormatoInesperado, f"IBGE:.*{nombre}.*repetid"):
                pnadc.posiciones_sas(entrada_sas() + f"\n@0001 {nombre} $4.")

    def test_posicion_y_ancho_positivos(self) -> None:
        """Las posiciones SAS empiezan en uno y cada campo tiene un ancho positivo."""
        for definicion in ("@0000 Ano $4.", "@0001 Ano $0."):
            texto = entrada_sas().replace("@0001 Ano $4.", definicion)
            with self.subTest(definicion=definicion), self.assertRaisesRegex(FormatoInesperado, "IBGE:.*Ano.*positiv"):
                pnadc.posiciones_sas(texto)

    def test_linea_cortada_no_desaparece(self) -> None:
        """Un corte antes de VD4002 no se interpreta como persona no ocupada."""
        posiciones = pnadc.posiciones_sas(entrada_sas())
        with self.assertRaisesRegex(FormatoInesperado, "IBGE:.*línea 1.*corta"):
            list(pnadc.ocupados_pnadc(iter([registro()[:10] + "\n"]), posiciones, set()))

    def test_ultima_replica_cortada(self) -> None:
        """El último peso sigue siendo float válido tras un corte, pero ya es otra cifra."""
        posiciones = pnadc.posiciones_sas(entrada_sas())
        for final in ("", "\n", "\r\n"):
            with self.subTest(final=repr(final)), self.assertRaisesRegex(FormatoInesperado, "IBGE:.*línea 1.*corta"):
                list(pnadc.ocupados_pnadc(iter([registro()[:-1] + final]), posiciones, set()))

    def test_peso_ilegible_tiene_contexto_y_causa(self) -> None:
        """Una conversión inválida identifica la línea y el peso concreto."""
        posiciones = pnadc.posiciones_sas(entrada_sas())
        with self.assertRaisesRegex(FormatoInesperado, "IBGE:.*línea 2.*V1028200") as captura:
            list(pnadc.ocupados_pnadc(iter([registro("2"), registro(ultimo_peso="no")]), posiciones, set()))
        self.assertIsInstance(captura.exception.__cause__, ValueError)

    def test_fin_de_linea_y_campos_no_ocupados(self) -> None:
        """CRLF no cuenta como ancho; los pesos vacíos de no ocupados siguen sin convertirse."""
        posiciones = pnadc.posiciones_sas(entrada_sas())
        no_ocupada = registro("2")[:11] + " " * (len(registro()) - 11)
        periodo: set[tuple[str, str]] = set()
        resultado = list(
            pnadc.ocupados_pnadc(iter([no_ocupada + "\r\n", registro(ultimo_peso="0") + "\r\n"]), posiciones, periodo)
        )
        self.assertEqual(resultado, [("4110", [1.0] * (len(pnadc.PESOS_PNADC) - 1) + [0.0])])
        self.assertEqual(periodo, {("2026", "2")})

    def test_codigos_numericos_no_enteros(self) -> None:
        """La columna COD no trunca decimales ni deja escapar errores NaN/inf."""
        for codigo in (1111.5, float("nan"), float("inf")):
            libro = {"COD": [["Classificação de Ocupações", "", "", "", ""], ["", "", "", codigo, "grupo"]]}
            with self.subTest(codigo=codigo), self.assertRaisesRegex(FormatoInesperado, "IBGE:.*COD.*entero"):
                pnadc.estructura_cod(libro)

    def test_diccionario_zip_sin_miembro(self) -> None:
        """El diccionario ausente falla con el diagnóstico común antes de abrir microdatos."""
        with tempfile.TemporaryDirectory() as temporal:
            ruta = Path(temporal) / "diccionario.zip"
            with zipfile.ZipFile(ruta, "w") as archivo:
                archivo.writestr("otro.txt", "")
            estructura = Estructura({}, set(), {}, set(), {})
            with self.assertRaisesRegex(FormatoInesperado, "zip no contiene.*input_PNADC"):
                pnadc.leer_pnadc(estructura, lambda _: ruta)

    def test_diccionario_sobre_tope_no_se_descomprime(self) -> None:
        """La cabecera ZIP basta para rechazar un diccionario mayor que el límite común."""
        memoria = io.BytesIO()
        with zipfile.ZipFile(memoria, "w") as archivo:
            archivo.writestr(pnadc.ENTRADA_PNADC, entrada_sas())
        with zipfile.ZipFile(memoria) as archivo:
            archivo.getinfo(pnadc.ENTRADA_PNADC).file_size = MAX_DESCARGA_BYTES + 1
            with (
                patch.object(pnadc.zipfile, "ZipFile", return_value=archivo),
                patch.object(archivo, "open", side_effect=AssertionError("no se debe descomprimir")) as abrir,
                self.assertRaisesRegex(FormatoInesperado, "input_PNADC.*tope"),
            ):
                pnadc.leer_pnadc(Estructura({}, set(), {}, set(), {}), lambda _: Path("no-se-lee"))
            abrir.assert_not_called()


if __name__ == "__main__":
    unittest.main()
