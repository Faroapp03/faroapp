"""Pruebas de la lectura de las tablas del Idescat sobre el clima empresarial (clima_empresarial.py)."""

import copy
import importlib.util
import sys
import unittest
from unittest import mock

import plataforma_datos.ia_y_trabajo.fuentes.clima_empresarial.lector as clima_empresarial
from plataforma_datos.comun.nucleo import Controles, FormatoInesperado


class PruebaClimaEmpresarial(unittest.TestCase):
    """Las tablas del Idescat se leen literales: «..» no es una cifra y una fila sin cifras abre un bloque."""

    TABLA = (
        "\ufeffTreballadors que fan servir tecnologies d'intel·ligència artificial a l'establiment. Per sector\n"
        "Catalunya. 2n trimestre del 2024\nUnitats: % d'establiments.\nFont: Idescat.\n"
        ";Indústria;Construcció;Total\n"
        "Treballadors no qualificats o poc qualificats;4,2;..;1,9\n"
        "Competències digitals;;;\nMolta;21,9;12,6;19,7\n"
    )

    def test_cada_cifra_por_su_bloque_fila_y_columna(self) -> None:
        """Cada cifra se encuentra por su bloque, su fila y su columna, con la coma decimal leída."""
        tabla = clima_empresarial.leer_tabla(self.TABLA)
        self.assertEqual(tabla["cifras"][""]["Treballadors no qualificats o poc qualificats"]["Total"], 1.9)
        self.assertEqual(tabla["cifras"]["Competències digitals"]["Molta"]["Total"], 19.7)

    def test_otra_marca_en_una_celda_detiene_la_lectura_diciendo_donde(self) -> None:
        """Una celda que no es cifra, vacío ni «..» se nombra con su fila y su columna, no con un ValueError."""
        with self.assertRaisesRegex(FormatoInesperado, "«-» en Molta / Construcció"):
            clima_empresarial.leer_tabla(self.TABLA.replace("21,9;12,6", "21,9;-"))

    def test_el_dato_confidencial_no_tiene_cifra(self) -> None:
        """El dato confidencial («..») no tiene cifra."""
        tabla = clima_empresarial.leer_tabla(self.TABLA)
        self.assertIsNone(tabla["cifras"][""]["Treballadors no qualificats o poc qualificats"]["Construcció"])

    def test_titulo_periodo_y_unidades_literales(self) -> None:
        """El título, el periodo y las unidades se guardan literales, para vigilar que no cambien."""
        tabla = clima_empresarial.leer_tabla(self.TABLA)
        self.assertEqual(
            (tabla["periodo"], tabla["unidades"]), ("Catalunya. 2n trimestre del 2024", "Unitats: % d'establiments.")
        )


class PruebaClimaEmpresarialConOtraForma(unittest.TestCase):
    """Una fila con otras celdas o repetida detiene la lectura en lugar de perder cifras en silencio."""

    CABECERA = "Título\nCatalunya. 2n trimestre del 2024\nUnitats: % d'establiments.\n;Indústria;Total\n"

    def test_una_fila_con_otras_celdas(self) -> None:
        """Una fila con menos o más celdas que columnas se rechaza diciendo cuál."""
        for fila in ("Molta;21,9\n", "Molta;21,9;19,7;3\n"):
            with self.subTest(fila=fila), self.assertRaisesRegex(FormatoInesperado, "Molta"):
                clima_empresarial.leer_tabla(self.CABECERA + fila)

    def test_una_fila_repetida_en_su_bloque(self) -> None:
        """Una etiqueta repetida dentro del mismo bloque no sobrescribe la anterior: se rechaza."""
        with self.assertRaisesRegex(FormatoInesperado, "se repite"):
            clima_empresarial.leer_tabla(self.CABECERA + "Molta;21,9;19,7\nMolta;1,0;2,0\n")


def tablas_de_prueba() -> dict:
    """Tres tablas sintéticas con los seis indicadores y sus metadatos literales.

    Returns:
        Las tres tablas preparadas autónomas.
    """
    tablas = {
        numero: {"titulo": titulo, "periodo": periodo, "unidades": clima_empresarial.UNIDADES, "cifras": {}}
        for numero, (titulo, periodo) in clima_empresarial.TABLAS_DEL_IDESCAT.items()
    }
    valores = (11.6, 9.0, 9.8, 8.4, 1.9, 19.7)
    for ubicacion, valor in zip(clima_empresarial.CIFRAS_DE_CADA_INDICADOR.values(), valores, strict=True):
        tablas[ubicacion.tabla]["cifras"].setdefault(ubicacion.bloque, {})[ubicacion.fila] = {"Total": valor}
    return tablas


def procedencia_de_prueba() -> dict:
    """Los tres originales esperados, cada uno fechado por separado.

    Returns:
        La procedencia sintética con un registro por tabla.
    """
    return {
        "archivos": [
            {"archivo": f"idescat-clem-{numero}.ssv", "descargado_utc": f"2026-10-0{indice + 1}T23:30:00-03:00"}
            for indice, numero in enumerate(clima_empresarial.TABLAS_DEL_IDESCAT)
        ]
    }


def validar_sin_archivos(tablas: dict, procedencia: dict | None = None) -> tuple[Controles, dict]:
    """Captura controles y conjunto sin escribir ni consultar entradas reales.

    Returns:
        Los controles registrados y el conjunto propuesto.
    """
    with (
        mock.patch.object(clima_empresarial, "leer_json", side_effect=[tablas, procedencia or procedencia_de_prueba()]),
        mock.patch.object(clima_empresarial, "controles_de_huella"),
        mock.patch.object(clima_empresarial, "cerrar_validacion") as cerrar,
    ):
        clima_empresarial.validar()
        return cerrar.call_args.args[2], cerrar.call_args.args[3]()


class PruebaControlesClima(unittest.TestCase):
    """La lectura y los controles del clima conservan el contrato de sus tablas."""

    def test_una_celda_invalida_se_detiene_con_su_ubicacion(self) -> None:
        """Solo cifras con coma y las marcas sin dato son celdas admitidas."""
        for valor in ("x", "11.6", "NaN", "11,6%"):
            with self.subTest(valor=valor), self.assertRaisesRegex(FormatoInesperado, "fila / Total"):
                clima_empresarial._cifra_de_la_celda(valor, "fila / Total")
        for valor in ("", ".."):
            with self.subTest(valor=valor):
                self.assertIsNone(clima_empresarial._cifra_de_la_celda(valor, "fila / Total"))
        self.assertEqual(clima_empresarial._cifra_de_la_celda("-11,6", "fila / Total"), -11.6)

    def test_una_cifra_sin_fila_o_columna_queda_sin_dato(self) -> None:
        """Una tabla sin la fila o sin Total devuelve None para el indicador solicitado."""
        tablas = {"18149": {"cifras": {}}}
        self.assertIsNone(clima_empresarial.cifra(tablas, "establecimientos-ia"))
        tablas["18149"]["cifras"] = {"": {"Ús de tecnologies d'intel·ligència artificial": {"Otros": 11.6}}}
        self.assertIsNone(clima_empresarial.cifra(tablas, "establecimientos-ia"))

    def test_los_controles_detectan_titulo_rango_y_referencia_distintos(self) -> None:
        """Cada alteración de una tabla preparada hace fallar el control correspondiente."""
        original = tablas_de_prueba()
        for campo, valor, mensaje in (
            ("titulo", "Otro título", "título, periodo y unidades"),
            ("valor", 101.0, "las cifras están entre 0 y 100"),
            ("valor", 11.5, "las cifras de referencia"),
        ):
            tablas = copy.deepcopy(original)
            if campo == "titulo":
                tablas["18149"][campo] = valor
            else:
                tablas["18149"]["cifras"][""]["Ús de tecnologies d'intel·ligència artificial"]["Total"] = valor
            with (
                self.subTest(campo=campo, valor=valor),
                mock.patch.object(
                    clima_empresarial,
                    "leer_json",
                    side_effect=[tablas, procedencia_de_prueba()],
                ),
                mock.patch.object(clima_empresarial, "controles_de_huella"),
                mock.patch.object(clima_empresarial, "cerrar_validacion") as cerrar,
            ):
                clima_empresarial.validar()
                self.assertTrue(any(mensaje in fallo for fallo in cerrar.call_args.args[2].fallidos))


class PruebaEstructuraYProcedencia(unittest.TestCase):
    """La estructura y la trazabilidad no pueden ocultar una cifra o fechar otro original."""

    CABECERA = PruebaClimaEmpresarialConOtraForma.CABECERA

    def test_la_importacion_no_necesita_el_contrato_global(self) -> None:
        """El lector se carga por sí solo aunque el compositor y su contrato estén bloqueados."""
        nombre = "plataforma_datos.ia_y_trabajo.fuentes.clima_autonomo"
        spec = importlib.util.spec_from_file_location(nombre, clima_empresarial.__file__)
        modulo = importlib.util.module_from_spec(spec)
        with mock.patch.dict(
            sys.modules,
            {
                nombre: modulo,
                "plataforma_datos.derivados.fuentes.datos_globales.piezas.contrato_datos_globales": None,
                "plataforma_datos.derivados.fuentes.datos_globales.lector": None,
            },
        ):
            spec.loader.exec_module(modulo)
        self.assertEqual(modulo.PORCENTAJE_MAXIMO, 100)

    def test_las_columnas_tienen_nombre_unico_y_total(self) -> None:
        """Una columna duplicada, vacía o sin Total no se acepta como tabla oficial."""
        for columnas in (";Total;Total", ";;Total", ";Indústria;Otros"):
            with self.subTest(columnas=columnas), self.assertRaisesRegex(FormatoInesperado, "columnas|Total"):
                clima_empresarial.leer_tabla(self.CABECERA.replace(";Indústria;Total", columnas) + "Fila;1;2\n")

    def test_un_bloque_no_se_puede_abrir_dos_veces(self) -> None:
        """Reabrir un bloque con filas distintas tampoco permite unir tablas ambiguas."""
        with self.assertRaisesRegex(FormatoInesperado, "bloque.*repite"):
            clima_empresarial.leer_tabla(self.CABECERA + "Bloque;;\nUna;1;2\nBloque;;\nOtra;3;4\n")

    def test_una_fila_sin_valores_conserva_el_ancho(self) -> None:
        """Un bloque de otra anchura no elude el control de columnas."""
        for fila in ("Bloque;\n", "Bloque;;;\n"):
            with self.subTest(fila=fila), self.assertRaisesRegex(FormatoInesperado, "Bloque.*celdas"):
                clima_empresarial.leer_tabla(self.CABECERA + fila)

    def test_las_celdas_vacias_no_inventan_un_bloque(self) -> None:
        """Una fila íntegramente vacía se ignora; la siguiente cifra mantiene su bloque."""
        tabla = clima_empresarial.leer_tabla(self.CABECERA + "Bloque;;\nUna;1;2\n ;;\nOtra;3;4\n")
        self.assertEqual(tabla["cifras"]["Bloque"]["Otra"]["Total"], 4.0)

    def test_las_columnas_van_despues_del_titulo_periodo_y_unidades(self) -> None:
        """Una cabecera prematura no se usa como título."""
        with self.assertRaisesRegex(FormatoInesperado, "título|periodo|unidades"):
            clima_empresarial.leer_tabla(";Indústria;Total\nPeriodo\nUnidades\nFila;1;2\n")

    def test_una_tabla_sin_filas_de_cifras_se_rechaza(self) -> None:
        """Cabecera sola o bloques vacíos no cuentan como una tabla leída."""
        for texto in ("", self.CABECERA, self.CABECERA + "Bloque;;\n"):
            with self.subTest(texto=texto), self.assertRaisesRegex(FormatoInesperado, "vacía|sin.*cifras"):
                clima_empresarial.leer_tabla(texto)

    def test_una_cifra_es_finita_y_con_digitos_ascii(self) -> None:
        """El formato publicado no incluye otras escrituras de dígitos ni desbordamientos."""
        for valor in ("١١,٦", "9" * 400):
            with self.subTest(valor=valor), self.assertRaisesRegex(FormatoInesperado, "fila / Total"):
                clima_empresarial._cifra_de_la_celda(valor, "fila / Total")

    def test_preparar_identifica_el_ssv_de_una_fila_invalida(self) -> None:
        """La preparación conserva el nombre del original junto a fila y columna."""
        archivo = mock.Mock()
        archivo.read_text.return_value = self.CABECERA + "Molta;1;x\n"
        with (
            mock.patch.object(clima_empresarial, "comprobar_originales"),
            mock.patch.object(clima_empresarial, "original", return_value=archivo),
            mock.patch.object(clima_empresarial, "guardar_json"),
            self.assertRaisesRegex(FormatoInesperado, "idescat-clem-18149.ssv.*Molta / Total"),
        ):
            clima_empresarial.preparar()

    def test_la_sexta_cifra_tambien_se_contrasta_con_la_referencia(self) -> None:
        """IA generativa no puede variar dentro del rango sin que falle la referencia."""
        tablas = tablas_de_prueba()
        ubicacion = clima_empresarial.CIFRAS_DE_CADA_INDICADOR["establecimientos-ia-generativa"]
        tablas[ubicacion.tabla]["cifras"][ubicacion.bloque][ubicacion.fila]["Total"] = 8.9
        controles, _ = validar_sin_archivos(tablas)
        self.assertTrue(any("las cifras de referencia" in fallo for fallo in controles.fallidos))

    def test_una_tabla_ausente_se_nombra(self) -> None:
        """No se accede a una tabla ausente mediante un KeyError sin contexto."""
        tablas = tablas_de_prueba()
        del tablas["18162"]
        with self.assertRaisesRegex(FormatoInesperado, "18162"):
            validar_sin_archivos(tablas)

    def test_periodo_unidades_y_total_tambien_estan_controlados(self) -> None:
        """Se conservan los controles nominales sobre todos los metadatos y la cobertura."""
        for campo, valor in (("periodo", "Otro periodo"), ("unidades", "Empresas")):
            tablas = tablas_de_prueba()
            tablas["18149"][campo] = valor
            with self.subTest(campo=campo):
                controles, _ = validar_sin_archivos(tablas)
                self.assertTrue(any("título, periodo y unidades" in fallo for fallo in controles.fallidos))
        tablas = tablas_de_prueba()
        tablas["18149"]["cifras"] = {}
        controles, _ = validar_sin_archivos(tablas)
        self.assertIn("cada indicador tiene su cifra de Cataluña", controles.fallidos)

    def test_la_consulta_exige_cada_original_una_vez(self) -> None:
        """Otro archivo no sustituye a una tabla esperada ni altera la última consulta."""
        base = procedencia_de_prueba()
        for archivos in (
            [],
            base["archivos"][:-1],
            base["archivos"] + [base["archivos"][0]],
            [{"archivo": "otro.ssv", "descargado_utc": "2099-01-01"}] + base["archivos"],
        ):
            with self.subTest(archivos=archivos), self.assertRaisesRegex(FormatoInesperado, "original|18149|22205"):
                validar_sin_archivos(tablas_de_prueba(), {"archivos": archivos})

    def test_la_consulta_rechaza_fechas_imposibles_y_tipos_con_contexto(self) -> None:
        """La procedencia se fecha por día civil válido, sin cortar texto arbitrario."""
        for fecha in ("2026-02-30T12:00:00+00:00", "2026-10-01 basura", None, 20261001):
            procedencia = procedencia_de_prueba()
            procedencia["archivos"][0]["descargado_utc"] = fecha
            with (
                self.subTest(fecha=fecha),
                self.assertRaisesRegex(FormatoInesperado, "idescat-clem-18149.ssv.*descargado_utc"),
            ):
                validar_sin_archivos(tablas_de_prueba(), procedencia)

    def test_la_consulta_es_el_ultimo_dia_civil_y_conserva_las_notas(self) -> None:
        """El desfase horario no mueve el día de consulta; cada cifra mantiene nota None."""
        controles, conjunto = validar_sin_archivos(tablas_de_prueba())
        self.assertTrue(controles.admitido)
        self.assertEqual(conjunto["consultado"], "2026-10-03")
        self.assertEqual(len(conjunto["cifras"]), 6)
        self.assertTrue(all(cifra["nota"] is None for cifra in conjunto["cifras"].values()))


if __name__ == "__main__":
    unittest.main()
