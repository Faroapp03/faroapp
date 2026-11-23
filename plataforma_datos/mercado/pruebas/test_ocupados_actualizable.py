"""Años abiertos de ocupados con metodología, cobertura y contrastes conservados."""

import copy
import itertools
import unittest
from typing import Any
from unittest import mock

import plataforma_datos.mercado.fuentes.ocupados.lector as ocupados
from plataforma_datos.comun.nucleo import Controles, FormatoInesperado, ValidacionFallida
from plataforma_datos.mercado.fuentes.ocupados.piezas import constantes_ocupados, ocupados_idescat, rotulos_ocupados
from plataforma_datos.mercado.pruebas.test_ocupados import _fila


def tabla(anios: tuple[str, ...] = ("2021", "2022", "2023", "2024")) -> dict[str, Any]:
    """Una tabla Idescat pequeña con la estructura y la base oficiales.

    Returns:
        Tabla JSON-stat anual.
    """
    categorias = {
        "YEAR": list(anios),
        "CAT": ["TOTAL"],
        "OCC_2011": ["A111"],
        "SEX": ["M", "F", "TOTAL"],
        "CONCEPT": ["POP_EMP"],
    }
    fuentes = [
        "2021: Idescat, a partir del Censo de población y viviendas del INE.",
        f"2022-{anios[-1]}: Idescat, a partir del Censo de población anual del INE.",
    ]
    dimensiones = {clave: {"category": {"index": valores}} for clave, valores in categorias.items()}
    dimensiones["CONCEPT"]["category"]["unit"] = {"POP_EMP": {"decimals": 0}}
    return {
        "class": "dataset",
        "id": list(categorias),
        "size": [len(v) for v in categorias.values()],
        "dimension": dimensiones,
        "value": [150] * (len(anios) * 3),
        "updated": "2026-05-13",
        "source": " ".join(fuentes),
        "extension": {"source": fuentes},
    }


def filas(anios: tuple[str, ...], territorios: tuple[str, ...], grupos: tuple[str, ...]) -> list[dict[str, Any]]:
    """Una matriz completa de filas para probar la cobertura.

    Returns:
        Filas por año, territorio y grupo.
    """
    return [
        _fila(territorio, grupo, anio, 300) for anio, territorio, grupo in itertools.product(anios, territorios, grupos)
    ]


def series_ine() -> list[dict[str, Any]]:
    """Tres series anuales de personas ocupadas con metadatos de Tempus.

    Returns:
        Series de un grupo y un territorio para los tres sexos.
    """
    return [
        {
            "T3_Unidad": "Personas",
            "T3_Escala": " ",
            "MetaData": [
                {"T3_Variable": ocupados.VARIABLE_COMUNIDADES_INE, "Nombre": "Cataluña", "Codigo": "09"},
                {"T3_Variable": "Sexo", "Nombre": sexo, "Codigo": sexo},
                {"T3_Variable": "OCUPACIONES", "Nombre": "Grupo", "Codigo": "11"},
                {"T3_Variable": "Tipo de dato", "Nombre": "Dato base", "Codigo": ""},
                {"T3_Variable": "Relación con la actividad", "Nombre": "Ocupado/a", "Codigo": "2"},
            ],
            "Data": [
                {
                    "Fecha": f"{anio}-01-01T00:00:00.000+01:00",
                    "T3_TipoDato": "Definitivo",
                    "T3_Periodo": "A",
                    "Anyo": anio,
                    "Valor": 150.0,
                }
                for anio in (2021, 2022, 2023)
            ],
        }
        for sexo in ocupados.SEXO_INE
    ]


class PruebaOcupadosActualizable(unittest.TestCase):
    """No fija el último año ni convierte una publicación parcial en una serie completa."""

    def test_anio_nuevo_se_publica_y_2021_se_conserva_fuera_del_paquete(self) -> None:
        """El paquete usa los años reales comparables y conserva revisiones compatibles."""
        datos = filas(("2021", "2022", "2023", "2024"), ("TOTAL",), ("111",))
        datos[-1]["total"] = 333
        contexto = {"actualizado_idescat": "2026-05-13", "fuente_idescat": "Idescat", "nombres": {}, "comarca_de": {}}
        with mock.patch.object(ocupados, "_territorios", return_value={}):
            conjunto = ocupados._conjunto_validado(datos, [], contexto)
        self.assertEqual(conjunto["anios"], ["2022", "2023", "2024"])
        self.assertNotIn("2021", conjunto["cataluna_cno3"]["111"])
        self.assertEqual(conjunto["cataluna_cno3"]["111"]["2024"]["ocupados"], 333)
        self.assertEqual(datos[0]["anio"], "2021")

    def leer(self, contenido: dict[str, Any]) -> list[dict[str, Any]]:
        """Lee un doble sin consultar originales operativos.

        Returns:
            Filas preparadas.
        """
        with mock.patch.object(ocupados, "leer_json", return_value=contenido), mock.patch.object(ocupados, "original"):
            return ocupados._filas_idescat(ocupados.TABLA_17980, ocupados.DIMENSION_CATALUNA)

    def test_lector_admite_anio_nuevo_y_revision(self) -> None:
        """La respuesta descubre el periodo sin consultar el reloj."""
        contenido = tabla()
        contenido["value"][-1] = 333
        self.assertEqual(self.leer(contenido)[-1]["total"], 333)
        self.assertEqual(self.leer(contenido)[-1]["anio"], "2024")

    def test_lector_rechaza_celdas_duplicadas_truncadas_y_cifras_invalidas(self) -> None:
        """No sobrescribe observaciones ni redondea otra unidad a personas."""
        casos = []
        duplicada = tabla()
        duplicada["dimension"]["SEX"]["category"]["index"] = ["M", "M", "TOTAL"]
        casos.append(duplicada)
        truncada = tabla()
        truncada["value"].pop()
        casos.append(truncada)
        for valor in (None, True, -1, 1.5, float("inf")):
            invalida = tabla()
            invalida["value"][0] = valor
            casos.append(invalida)
        estado = tabla()
        estado["status"] = {"0": "?"}
        casos.append(estado)
        for contenido in casos:
            with self.subTest(contenido=contenido), self.assertRaises(FormatoInesperado):
                self.leer(contenido)

    def test_metodologia_unidad_fecha_y_dimensiones_exigen_revision(self) -> None:
        """Un año nuevo solo se acepta bajo el mismo concepto y base censal."""
        casos = [tabla(("2021", "2022", "2024"))]
        for fuente in ("2021-2024: Idescat, a partir del Censo de población anual del INE.", "Otra encuesta"):
            cambio = tabla()
            cambio["source"] = fuente
            casos.append(cambio)
        cambio = tabla()
        cambio["dimension"]["CONCEPT"]["category"]["unit"]["POP_EMP"] = {"decimals": 1}
        casos.append(cambio)
        cambio = tabla()
        cambio["updated"] = "2024-02-30"
        casos.append(cambio)
        cambio = tabla()
        cambio["updated"] = "2023-12-31"
        casos.append(cambio)
        cambio = tabla()
        cambio["id"].append("AGE")
        casos.append(cambio)
        for anio in ("2024-Q1", "02024", "٢٠٢٤", "2020"):
            cambio = tabla()
            cambio["dimension"]["YEAR"]["category"]["index"][-1] = anio
            casos.append(cambio)
        for contenido in casos:
            with self.subTest(contenido=contenido), self.assertRaises(FormatoInesperado):
                self.leer(contenido)

    def test_periodo_incompleto_no_parece_completo(self) -> None:
        """El mismo año debe cubrir todas las geografías y clasificaciones del producto."""
        anios = ("2021", "2022", "2023", "2024")
        cno3 = filas(anios, ("TOTAL",), ("111", ocupados.TOTAL_OCUPACIONES, ocupados.CODIGO_NO_CONSTA))
        cno2 = filas(
            anios,
            ("TOTAL", *ocupados.COMARCAS_DE_LA_ZONA, *ocupados.MUNICIPIOS),
            ("11", ocupados.TOTAL_OCUPACIONES, ocupados.CODIGO_NO_CONSTA),
        )
        ine = [
            {**fila, "tabla": ocupados.TABLA_69959}
            for fila in filas(anios[:-1], ("09",), ("11", ocupados.TOTAL_OCUPACIONES, ocupados.CODIGO_NO_CONSTA))
        ]
        ine += [
            {**fila, "tabla": ocupados.TABLA_69979}
            for fila in filas(
                anios[:-1], ocupados.CIUDADES_INE, ("11", ocupados.TOTAL_OCUPACIONES, ocupados.CODIGO_NO_CONSTA)
            )
        ]
        cno = {"111": {"nivel": "3"}, "11": {"nivel": "2"}}
        ocupados._comprobar_cobertura(cno3, cno2, ine, cno)
        for grupo in (cno3, cno2, ine):
            alteradas = copy.deepcopy((cno3, cno2, ine))
            indice = next(i for i, original in enumerate((cno3, cno2, ine)) if original is grupo)
            alteradas[indice].pop()
            with self.subTest(indice=indice), self.assertRaises(ValidacionFallida):
                ocupados._comprobar_cobertura(*alteradas, cno)
        repetidas = [*cno3, cno3[-1]]
        with self.assertRaises(ValidacionFallida):
            ocupados._comprobar_cobertura(repetidas, cno2, ine, cno)
        for indice in range(3):
            alteradas = copy.deepcopy((cno3, cno2, ine))
            alteradas[indice][-1]["hombres"] = None
            with self.subTest(nulo=indice), self.assertRaises(ValidacionFallida):
                ocupados._comprobar_cobertura(*alteradas, cno)
        militares = filas(anios, ("TOTAL",), ("001",))
        for fila in militares:
            fila.update(dict.fromkeys(ocupados.SEXOS))
        con_militares = {**cno, "001": {"nivel": "3"}}
        ocupados._comprobar_cobertura([*cno3, *militares], cno2, ine, con_militares)
        militares[-1]["total"] = 300
        with self.assertRaisesRegex(ValidacionFallida, "supresiones distintas"):
            ocupados._comprobar_cobertura([*cno3, *militares], cno2, ine, con_militares)

    def test_ine_adelantado_o_retrasado_solo_contrasta_anios_comunes(self) -> None:
        """El desfase de publicación no compara años distintos ni oculta diferencias."""
        for anios_idescat, anios_ine in (
            (("2022", "2023", "2024"), ("2022", "2023")),
            (("2022", "2023"), ("2022", "2023", "2024")),
        ):
            cno2 = filas(anios_idescat, ("TOTAL",), ("11",))
            ine = [
                {**fila, "tabla": nombre}
                for nombre in (ocupados.TABLA_69959, ocupados.TABLA_69979)
                for fila in filas(anios_ine, ("09",), ("11",))
            ]
            controles = Controles()
            ocupados._controles_ine(controles, cno2, ine)
            self.assertTrue(controles.admitido, controles.fallidos)
            ine[0]["total"] += 10
            controles = Controles()
            ocupados._controles_ine(controles, cno2, ine)
            self.assertFalse(controles.admitido)

    def test_los_rotulos_se_componen_desde_los_anios(self) -> None:
        """Con otro último año el rótulo sale bien; una plantilla sin hueco o con uno sin valor falla."""
        self.assertEqual(
            rotulos_ocupados.de_los_anios(ocupados.PLANTILLA_LIMITES, ("2021", "2022", "2023", "2024", "2025")),
            ocupados.LIMITES.replace("2022–2023", "2022–2025").replace("2022 y 2023", "los años desde 2022 hasta 2025"),
        )
        self.assertIn(
            "Censo anual 2021–2025",
            rotulos_ocupados.de_los_anios(ocupados.PLANTILLA_DEL_TITULO[ocupados.TABLA_69959], ("2021", "2025")),
        )
        for plantilla in ("Censo anual 2021–2023", "Censo anual {periodo} y {otro}"):
            with self.subTest(plantilla=plantilla), self.assertRaises(FormatoInesperado):
                rotulos_ocupados.de_los_anios(plantilla, ("2021", "2024"))

    def test_una_parte_del_plan_sin_tabla_detiene_la_descarga(self) -> None:
        """El plan se comprueba entero: una parte que no es de ninguna de sus tablas no pasa en silencio."""
        ajena = {"archivo": "ajena.json", "url": "https://api.idescat.cat/taules/v2/otra?YEAR=2024"}
        with self.assertRaisesRegex(FormatoInesperado, "no son de ninguna de sus tablas"):
            ocupados_idescat.comprobar_plan({}, [ajena], lambda _nombre: {})

    def test_periodos_y_privacidad_conservan_literales_actuales(self) -> None:
        """Las citas históricas quedan idénticas y los nuevos años respetan el umbral."""
        plantillas = {
            constantes_ocupados.CITA: constantes_ocupados.PLANTILLA_CITA,
            constantes_ocupados.NOMBRE_FUENTE: constantes_ocupados.PLANTILLA_NOMBRE_FUENTE,
            ocupados.LIMITES: ocupados.PLANTILLA_LIMITES,
        }
        for texto, plantilla in plantillas.items():
            self.assertEqual(rotulos_ocupados.de_los_anios(plantilla, ("2022", "2023")), texto)
            ampliado = rotulos_ocupados.de_los_anios(plantilla, ("2022", "2023", "2024"))
            self.assertIn("2024", ampliado)
            self.assertNotIn("2023", ampliado)
        for total in (None, 99, 100):
            fila = _fila("TOTAL", "111", "2024", total)
            resultado = ocupados._por_grupo([fila])
            self.assertEqual(bool(resultado), total == ocupados.MIN_PERSONAS)

    def test_fecha_publicada_no_adelanta_ninguna_tabla(self) -> None:
        """Una fecha más reciente de municipios no se atribuye a las otras tablas."""
        fechas = {ocupados.TABLA_17980: "2026-03-01", **dict.fromkeys(ocupados.TABLA_17977.values(), "2026-05-13")}
        with (
            mock.patch.object(ocupados, "original", side_effect=lambda _, nombre: nombre),
            mock.patch.object(
                ocupados, "leer_json", side_effect=lambda nombre: {"updated": fechas[nombre], "source": "Idescat"}
            ),
            mock.patch.object(ocupados, "_comarcas_del_nomenclator", return_value={}),
            mock.patch.object(ocupados, "_nombres_de_territorios", return_value={}),
        ):
            self.assertEqual(ocupados._contexto()["actualizado_idescat"], "2026-03-01")

    def test_titulos_de_procedencia_describen_periodo_de_cada_organismo(self) -> None:
        """El adelanto del Idescat no se atribuye al INE en la procedencia."""
        from plataforma_datos.mercado.pruebas.test_ocupados_partes import cuerpo_parte, metadatos

        documentos = metadatos(("2021", "2022", "2023", "2024", "2025"))
        partes = ocupados.planificar_partes(documentos)
        for parte in partes:
            numero = next(
                i
                for i, archivo in enumerate(ocupados.ARCHIVOS[:4])
                if parte["url"].startswith(archivo["url"] + "&YEAR=")
            )
            meta = documentos[ocupados.METADATOS_IDESCAT[numero]["archivo"]]
            documentos[parte["archivo"]] = cuerpo_parte(meta, tuple(parte["url"].partition("&YEAR=")[2].split(",")))
        with (
            mock.patch.object(
                ocupados,
                "descargar_originales",
                side_effect=lambda archivos, *_: [dict(archivo) for archivo in archivos],
            ),
            mock.patch.object(
                ocupados,
                "leer_json",
                side_effect=lambda ruta: (
                    series_ine() if ruta.name in (ocupados.TABLA_69959, ocupados.TABLA_69979) else documentos[ruta.name]
                ),
            ),
            mock.patch.object(ocupados, "guardar_json") as guardar,
        ):
            ocupados.descargar()
        procedencia = guardar.call_args.args[1]
        por_nombre = {registro["archivo"]: registro for registro in procedencia["archivos"]}
        self.assertIn("2021–2025", por_nombre[partes[0]["archivo"]]["titulo"])
        municipales = [parte for parte in partes if "municipios" in parte["archivo"]]
        self.assertIn("2021–2024", por_nombre[municipales[0]["archivo"]]["titulo"])
        self.assertIn("2025–2025", por_nombre[municipales[1]["archivo"]]["titulo"])
        self.assertIn("2021–2023", por_nombre[ocupados.TABLA_69959]["titulo"])
        self.assertIn("2022–2025", procedencia["cita"])

    def test_ine_sin_anio_comun_no_pasa_por_un_contraste_vacio(self) -> None:
        """Una respuesta sin periodos comunes se registra como fallo."""
        ine = [
            {**fila, "tabla": nombre}
            for nombre in (ocupados.TABLA_69959, ocupados.TABLA_69979)
            for fila in filas(("2024",), ("09",), ("11",))
        ]
        controles = Controles()
        ocupados._controles_ine(controles, filas(("2023",), ("TOTAL",), ("11",)), ine)
        self.assertFalse(controles.admitido)


class PruebaContratoIneOcupados(unittest.TestCase):
    """La serie abierta de control sigue siendo anual, base y personas residentes."""

    def leer(self, contenido: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Lee las series sintéticas sin tocar originales.

        Returns:
            Filas preparadas de control.
        """
        with mock.patch.object(ocupados, "leer_json", return_value=contenido), mock.patch.object(ocupados, "original"):
            return ocupados._filas_ine(ocupados.TABLA_69959, ocupados.VARIABLE_COMUNIDADES_INE)

    def test_lector_preserva_revision_y_admite_nuevo_anio(self) -> None:
        """Un nuevo dato definitivo no depende del año fijado en el código."""
        contenido = series_ine()
        for serie in contenido:
            serie["Data"].append(
                {**serie["Data"][-1], "Anyo": 2024, "Fecha": "2024-01-01T00:00:00.000+01:00", "Valor": 333.0}
            )
        self.assertEqual(self.leer(contenido)[-1]["anio"], "2024")
        self.assertEqual(self.leer(contenido)[-1]["total"], 333)

    def test_metadatos_incompatibles_se_rechazan(self) -> None:
        """No convierte otra unidad, escala, sexo o actividad en el control oficial."""
        casos = []
        for campo, valor in (("T3_Unidad", "Porcentaje"), ("T3_Escala", "Miles")):
            cambio = series_ine()
            cambio[0][campo] = valor
            casos.append(cambio)
        for posicion, valor in ((1, "9"), (3, "Variación"), (4, "1")):
            cambio = series_ine()
            cambio[0]["MetaData"][posicion]["Codigo"] = valor
            casos.append(cambio)
        cambio = series_ine()
        cambio[0]["MetaData"].append(cambio[0]["MetaData"][0])
        casos.append(cambio)
        for contenido in casos:
            with self.subTest(contenido=contenido), self.assertRaises(FormatoInesperado):
                self.leer(contenido)

    def test_periodos_estados_fechas_y_valores_incompatibles_se_rechazan(self) -> None:
        """No redondea decimales ni admite un trimestre o un dato provisional como año completo."""
        for campo, valor in (
            ("T3_Periodo", "Q1"),
            ("T3_TipoDato", "Provisional"),
            ("Anyo", "2023"),
            ("Anyo", True),
            ("Fecha", "2021-07-01T00:00:00.000+01:00"),
            ("Notas", [{"texto": "Cambio de base"}]),
            ("Valor", None),
            ("Valor", -1),
            ("Valor", 1.5),
            ("Valor", True),
            ("Valor", float("inf")),
        ):
            cambio = series_ine()
            cambio[0]["Data"][0][campo] = valor
            with self.subTest(campo=campo, valor=valor), self.assertRaises(FormatoInesperado):
                self.leer(cambio)

    def test_observaciones_duplicadas_no_se_sobrescriben(self) -> None:
        """Ni revisiones mezcladas ni duplicados idénticos se eligen según el orden."""
        for valor in (150.0, 333.0):
            cambio = series_ine()
            cambio[0]["Data"].append({**cambio[0]["Data"][0], "Valor": valor})
            with self.subTest(valor=valor), self.assertRaisesRegex(FormatoInesperado, "duplicada"):
                self.leer(cambio)


if __name__ == "__main__":
    unittest.main()
