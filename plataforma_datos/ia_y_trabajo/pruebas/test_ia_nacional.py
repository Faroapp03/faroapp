"""Medidas nacionales del uso de la IA fuera de la UE: lectura del BTOS y su lugar en los datos globales."""

import contextlib
import copy
import hashlib
import io
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest import mock

import plataforma_datos.ia_y_trabajo.fuentes.ia_nacional.lector as ia_nacional
from plataforma_datos.comun import entrada_salida
from plataforma_datos.comun.entrada_salida import guardar_json, leer_json
from plataforma_datos.comun.nucleo import (
    MAX_DESCARGA_BYTES,
    RAIZ,
    Carpetas,
    Controles,
    FormatoInesperado,
    ValidacionFallida,
)
from plataforma_datos.ia_y_trabajo.comun.medida_nacional import controles_del_indicador
from plataforma_datos.orquestacion import admision


def _estimaciones(pregunta: str = ia_nacional.PREGUNTA_BTOS) -> list[dict[str, str]]:
    """La hoja «Response Estimates» mínima: dos períodos y la pregunta del uso de IA.

    Args:
        pregunta: El texto de la pregunta.

    Returns:
        Las filas de la hoja, con sus columnas por letra.
    """
    return [
        {"A": "Question ID", "B": "Question", "C": "Answer ID", "D": "Answer", "E": "202620", "F": "202619"},
        {"A": "7", "B": pregunta, "C": "1", "D": "Yes", "E": "23.8%", "F": "23.1%"},
        {"A": "7", "B": pregunta, "C": "2", "D": "No", "E": "66.4%", "F": "66.5%"},
    ]


FECHAS = [
    {"D": "Smpdt", "G": "Reference Period Start", "H": "Ref End"},
    {"D": "202620", "G": "46272", "H": "46285"},
]


class PruebasDelBtos(unittest.TestCase):
    """La cifra del último período, con su referencia, y la pregunta literal."""

    def test_ultimo_periodo_con_sus_fechas(self) -> None:
        """Toma el período más reciente, «Yes», y el año del final de la referencia."""
        cifra = ia_nacional.cifra_del_btos(_estimaciones(), FECHAS)
        self.assertEqual((cifra["valor"], cifra["anio"], cifra["periodo"]), (23.8, 2026, "202620"))
        self.assertEqual(cifra["referencia"], ["2026-09-07", "2026-09-20"])

    def test_otra_pregunta_detiene_la_lectura(self) -> None:
        """Si el Census cambia el texto de la pregunta, la cifra mide otra cosa: no se lee."""
        with self.assertRaises(FormatoInesperado):
            ia_nacional.cifra_del_btos(_estimaciones("Did this business use AI?"), FECHAS)

    def test_un_periodo_de_la_serie_antigua_detiene_la_lectura(self) -> None:
        """La pregunta cambió en el período 202524: uno anterior no se lee ni se encadena con la serie nueva."""
        antiguas = [{**fila, "E": fila["F"]} for fila in _estimaciones()]
        antiguas[0] = {**antiguas[0], "E": "202523", "F": "202522"}
        with self.assertRaises(FormatoInesperado):
            ia_nacional.cifra_del_btos(antiguas, [*FECHAS, {"D": "202523", "G": "45950", "H": "45963"}])

    def test_la_definicion_de_eeuu_dice_que_es_una_serie_nueva(self) -> None:
        """Con las frases de la serie nueva, admitida; sin ellas, no."""
        indicador = ia_nacional.INDICADORES_NACIONALES["USA"]
        for definicion, admitida in (
            (indicador["definicion"], True),
            ({"es": "Porcentaje.", "ca": "Percentatge."}, False),
        ):
            controles = Controles()
            controles_del_indicador(
                controles,
                "USA",
                {**indicador, "definicion": definicion},
                ia_nacional.LICENCIA_CENSUS,
                ia_nacional.FRASES_USA,
            )
            self.assertEqual(controles.admitido, admitida, controles.fallidos)

    def test_canada_todas_las_industrias(self) -> None:
        """Canadá, todas las industrias, «Yes»: una sola fila; otra fila o un duplicado detienen la lectura."""
        fila = {
            "REF_DATE": "2025",
            "GEO": "Canada",
            "Business characteristics": ia_nacional.TODAS_LAS_INDUSTRIAS,
            ia_nacional.DIMENSION_CSBC: ia_nacional.RESPUESTA_CSBC,
            "UOM": "Percent",
            "VALUE": "12.2",
            "STATUS": "A",
        }
        otra = {**fila, "GEO": "Ontario", "VALUE": "13.0"}
        self.assertEqual(ia_nacional.cifra_de_la_csbc([fila, otra]), {"valor": 12.2, "anio": 2025, "calidad": "A"})
        with self.assertRaises(FormatoInesperado):
            ia_nacional.cifra_de_la_csbc([fila, fila])

    def test_australia_fila_total_y_marca_de_cautela(self) -> None:
        """Australia: la fila «Total» de la columna de la IA; la marca «^» pasa a «poco_fiable»."""
        filas = [
            {"A": "This tab contains a single table"},
            {"A": "Table 2: Selected ICTs used by the business, by employment size"},
            {"B": "Cloud technology", "L": "Artificial intelligence (AI) "},
            {"A": "Total", "B": "72.8", "L": "12.1"},
            {"A": "0–4 persons", "B": "68.5", "L": "10.7"},
        ]
        self.assertEqual(ia_nacional.cifra_de_la_bcs(filas), {"valor": 12.1, "anio": 2025, "nota": None})
        filas[3] = {"A": "Total", "L": "^12.1"}
        self.assertEqual(ia_nacional.cifra_de_la_bcs(filas)["nota"], "poco_fiable")
        filas[3] = {"A": "Total", "L": "np"}
        with self.assertRaises(FormatoInesperado):
            ia_nacional.cifra_de_la_bcs(filas)

    def test_en_los_datos_globales_sin_comparar_y_solo_en_su_pais(self) -> None:
        """Cada indicador nacional es medido, no comparable, y solo lo trae su país."""
        globales = leer_json(RAIZ / "datos" / "globales" / "datos-globales.json")
        for codigo in ("USA", "CAN", "AUS"):
            id_ = f"empresas-ia-nacional-{codigo.lower()}"
            indicador = next(fila for fila in globales["indicadores"] if fila["id"] == id_)
            self.assertEqual((indicador["naturaleza"], indicador["comparable"]), ("medido", False))
            con_valor = [
                territorio["codigo"]
                for territorio in globales["territorios"]
                if any(valor["indicador"] == id_ for valor in territorio["valores"])
            ]
            self.assertEqual(con_valor, [codigo])


class EntradasDefectuosas(unittest.TestCase):
    """Los lectores no eligen entre columnas ambiguas ni dejan escapar errores sin su campo."""

    def test_btos_hoja_vacia(self) -> None:
        """Una hoja sin cabecera tiene diagnóstico de la fuente."""
        with self.assertRaisesRegex(FormatoInesperado, "BTOS"):
            ia_nacional.cifra_del_btos([], FECHAS)

    def test_btos_periodos_unicos_y_de_seis_digitos_ascii(self) -> None:
        """Un período mal escrito o repetido no se resuelve por posición de columna."""
        for periodo in ("202620", "20262", "２０２６２０", "20262x"):
            estimaciones = _estimaciones()
            estimaciones[0]["F"] = periodo
            with self.subTest(periodo=periodo), self.assertRaisesRegex(FormatoInesperado, "BTOS.*período"):
                ia_nacional.cifra_del_btos(estimaciones, FECHAS)

    def test_btos_cifra_y_fechas_invalidas_con_contexto(self) -> None:
        """La cifra y las fechas Excel señalan archivo/campo, sin ValueError ni KeyError."""
        for texto in ("no disponible%", "nan%", "inf%"):
            estimaciones = _estimaciones()
            estimaciones[1]["E"] = texto
            with self.subTest(texto=texto), self.assertRaisesRegex(FormatoInesperado, "BTOS.*E"):
                ia_nacional.cifra_del_btos(estimaciones, FECHAS)
        for columna in "GH":
            for texto in (None, "n/a", "nan", "inf", "1e309"):
                fecha = {**FECHAS[1], columna: texto}
                if texto is None:
                    del fecha[columna]
                with (
                    self.subTest(columna=columna, texto=texto),
                    self.assertRaisesRegex(FormatoInesperado, f"BTOS.*{columna}"),
                ):
                    ia_nacional.cifra_del_btos(_estimaciones(), [FECHAS[0], fecha])

    def test_btos_referencia_invertida(self) -> None:
        """Inicio posterior al final no es una referencia publicable."""
        with self.assertRaisesRegex(FormatoInesperado, "BTOS.*referencia"):
            ia_nacional.cifra_del_btos(_estimaciones(), [FECHAS[0], {**FECHAS[1], "G": "46286"}])

    def test_abs_titulo_y_columna_unicos(self) -> None:
        """Dos títulos o dos celdas de IA no autorizan escoger la primera."""
        base = [{"A": ia_nacional.TITULO_BCS}, {"L": ia_nacional.COLUMNA_IA_BCS}, {"A": "Total", "L": "12.1"}]
        for filas in (
            [base[0], base[0], *base[1:]],
            [base[0], base[1], base[1], base[2]],
            [base[0], {**base[1], "M": ia_nacional.COLUMNA_IA_BCS}, base[2]],
        ):
            with self.subTest(filas=filas), self.assertRaisesRegex(FormatoInesperado, "ABS"):
                ia_nacional.cifra_de_la_bcs(filas)

    def test_abs_unicode_no_se_convierte_silenciosamente(self) -> None:
        """Se conserva la gramática decimal del XLSX, incluida la cautela, sin normalizar dígitos."""
        for texto in ("１２.１", "¹².¹"):
            filas = [{"A": ia_nacional.TITULO_BCS}, {"L": ia_nacional.COLUMNA_IA_BCS}, {"A": "Total", "L": texto}]
            with self.subTest(texto=texto), self.assertRaisesRegex(FormatoInesperado, "ABS"):
                ia_nacional.cifra_de_la_bcs(filas)

    def test_statcan_campos_y_numeros_con_contexto(self) -> None:
        """La fila seleccionada debe traer sus campos consumidos, sin truncar un año mal formado."""
        base = {
            "GEO": "Canada",
            "Business characteristics": ia_nacional.TODAS_LAS_INDUSTRIAS,
            ia_nacional.DIMENSION_CSBC: ia_nacional.RESPUESTA_CSBC,
            "UOM": "Percent",
            "VALUE": "19.2",
            "REF_DATE": "2026",
            "STATUS": "A",
        }
        for campo in ("UOM", "VALUE", "REF_DATE", "STATUS"):
            fila = {k: v for k, v in base.items() if k != campo}
            with self.subTest(campo=campo), self.assertRaisesRegex(FormatoInesperado, f"33101167.*{campo}"):
                ia_nacional.cifra_de_la_csbc([fila])
        for campo, texto in (("VALUE", "n/a"), ("VALUE", "nan"), ("VALUE", "inf"), ("REF_DATE", "2026otra")):
            with (
                self.subTest(campo=campo, texto=texto),
                self.assertRaisesRegex(FormatoInesperado, f"33101167.*{campo}"),
            ):
                ia_nacional.cifra_de_la_csbc([{**base, campo: texto}])


class ZipDeStatcan(unittest.TestCase):
    """El miembro del CSV usa el límite compartido antes de abrir su contenido."""

    def test_tamano_declarado_excesivo_no_se_descomprime(self) -> None:
        """Un ZipInfo sobre el límite no llega a open ni read, sin crear un ZIP grande."""
        miembro = zipfile.ZipInfo(ia_nacional.TABLA_CSBC)
        miembro.file_size = MAX_DESCARGA_BYTES + 1
        libro = mock.MagicMock()
        libro.__enter__.return_value = libro
        libro.namelist.return_value = [ia_nacional.TABLA_CSBC]
        libro.getinfo.return_value = miembro
        libro.read.return_value = b"VALUE\n19.2\n"
        with (
            mock.patch.object(ia_nacional.zipfile, "ZipFile", return_value=libro),
            self.assertRaisesRegex(FormatoInesperado, "33101167.csv.*tope"),
        ):
            ia_nacional.filas_de_statcan(Path("captura.zip"))
        libro.open.assert_not_called()
        libro.read.assert_not_called()

    def test_miembro_ausente_tiene_diagnostico(self) -> None:
        """Un ZIP pequeño real sin la tabla señala el nombre que falta."""
        with tempfile.TemporaryDirectory() as temporal:
            ruta = Path(temporal) / "captura.zip"
            with zipfile.ZipFile(ruta, "w") as libro:
                libro.writestr("otra.csv", b"VALUE\n19.2\n")
            with self.assertRaisesRegex(FormatoInesperado, "no contiene 33101167.csv"):
                ia_nacional.filas_de_statcan(ruta)


class ValidacionDeEntradas(unittest.TestCase):
    """Se valida con cierre real en temporales; una entrada defectuosa conserva lo admitido."""

    def setUp(self) -> None:
        """Prepara tres originales propios y sus referencias, sin tocar datos operativos."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        raiz = Path(temporal.name)
        self.rutas = Carpetas(raiz / "originales", raiz / "preparados", raiz / "validados")
        for ruta in self.rutas:
            ruta.mkdir()
        for nombre, valor in (
            ("ORIGINAL", self.rutas.original),
            ("CIFRAS", self.rutas.preparado / "cifras.json"),
            ("PROCEDENCIA", self.rutas.original / "procedencia.json"),
        ):
            parche = mock.patch.object(ia_nacional, nombre, valor)
            parche.start()
            self.addCleanup(parche.stop)
        for modulo in (entrada_salida, admision):
            parche = mock.patch.object(modulo, "carpetas", return_value=self.rutas)
            parche.start()
            self.addCleanup(parche.stop)
        self.anterior = b'{"admitido":"anterior"}\n'
        self.conjunto = self.rutas.validado / "ia-nacional.json"
        self.conjunto.write_bytes(self.anterior)
        self.procedencia = {"archivos": []}
        for entrada in ia_nacional.ARCHIVOS:
            contenido = entrada["archivo"].encode()
            (self.rutas.original / entrada["archivo"]).write_bytes(contenido)
            self.procedencia["archivos"].append(
                {
                    "archivo": entrada["archivo"],
                    "licencia": entrada["licencia"],
                    "sha256": hashlib.sha256(contenido).hexdigest(),
                    "descargado_utc": "2026-10-11T21:57:00+00:00",
                }
            )
        self.preparado = {
            "paises": {
                "AUS": {"valor": 12.1, "anio": 2025, "nota": None},
                "CAN": {"valor": 19.2, "anio": 2026, "calidad": "A"},
                "USA": {
                    "valor": 23.8,
                    "anio": 2026,
                    "periodo": "202620",
                    "referencia": ["2026-09-07", "2026-09-20"],
                    "pregunta": ia_nacional.PREGUNTA_BTOS,
                    "respuesta": ia_nacional.RESPUESTA_BTOS,
                },
            }
        }

    def validar(self) -> None:
        """Ejercita lectura, huella y cierre verdaderos sobre los temporales."""
        guardar_json(ia_nacional.CIFRAS, self.preparado)
        guardar_json(ia_nacional.PROCEDENCIA, self.procedencia)
        with contextlib.redirect_stdout(io.StringIO()):
            ia_nacional.validar()

    def test_booleanos_no_son_porcentajes(self) -> None:
        """True no puede publicar un 1 por ciento en ninguno de los tres países."""
        base = copy.deepcopy(self.preparado)
        for pais in ("AUS", "CAN", "USA"):
            with self.subTest(pais=pais):
                self.preparado = copy.deepcopy(base)
                self.conjunto.write_bytes(self.anterior)
                self.preparado["paises"][pais]["valor"] = True
                with self.assertRaises(ValidacionFallida):
                    self.validar()
                self.assertEqual(self.conjunto.read_bytes(), self.anterior)

    def test_preparado_valido_publica_los_tres_paises_completos(self) -> None:
        """Los mismos campos válidos siguen pasando el cierre real, con fecha civil y sin pérdidas."""
        self.validar()
        self.assertEqual(leer_json(self.conjunto), {"consultado": "2026-10-11", "paises": self.preparado["paises"]})
        self.assertEqual(leer_json(self.rutas.validacion)["estado"], "Admitido")

    def test_formas_incompletas_del_preparado(self) -> None:
        """Falta de país/campo o contenedor incorrecto se diagnostica con el archivo."""
        base = copy.deepcopy(self.preparado)
        variantes = [
            [],
            {},
            {"paises": []},
            {"paises": {k: v for k, v in base["paises"].items() if k != "CAN"}},
            {"paises": {**base["paises"], "USA": []}},
        ]
        for pais, campo in (("USA", "pregunta"), ("CAN", "calidad"), ("AUS", "valor")):
            variante = copy.deepcopy(base)
            del variante["paises"][pais][campo]
            variantes.append(variante)
        for preparado in variantes:
            with self.subTest(preparado=preparado):
                self.preparado = preparado
                with self.assertRaisesRegex(FormatoInesperado, "cifras.json"):
                    self.validar()
                self.assertEqual(self.conjunto.read_bytes(), self.anterior)

    def test_referencia_preparada_forma_calendario_y_respuesta(self) -> None:
        """No se publican fechas imposibles o una respuesta distinta de la que se suma."""
        base = copy.deepcopy(self.preparado)
        for campo, valor in (
            ("referencia", []),
            ("referencia", [None, "2026-09-20"]),
            ("referencia", ["2026-02-30", "2026-09-20"]),
            ("respuesta", "No"),
            ("periodo", "2026xx"),
            ("anio", True),
        ):
            with self.subTest(campo=campo, valor=valor):
                self.preparado = copy.deepcopy(base)
                self.conjunto.write_bytes(self.anterior)
                self.preparado["paises"]["USA"] = {**self.preparado["paises"]["USA"], campo: valor}
                with self.assertRaisesRegex(FormatoInesperado, "cifras.json"):
                    self.validar()
                self.assertEqual(self.conjunto.read_bytes(), self.anterior)

    def test_procedencia_originales_y_fechas_consumidas(self) -> None:
        """No basta una huella ajena, duplicada o una fecha truncable pero imposible."""
        base = copy.deepcopy(self.procedencia)
        variantes = [
            [],
            {},
            {"archivos": []},
            {"archivos": base["archivos"][:1]},
            {"archivos": [*base["archivos"], base["archivos"][0]]},
        ]
        for campo, valor in (
            ("descargado_utc", "2026-02-30T21:00:00+00:00"),
            ("descargado_utc", None),
            ("licencia", "otra"),
            ("archivo", "otro.xlsx"),
        ):
            variante = copy.deepcopy(base)
            variante["archivos"][0][campo] = valor
            variantes.append(variante)
        for procedencia in variantes:
            with self.subTest(procedencia=procedencia):
                self.procedencia = procedencia
                with self.assertRaisesRegex(FormatoInesperado, "procedencia.json"):
                    self.validar()
                self.assertEqual(self.conjunto.read_bytes(), self.anterior)


if __name__ == "__main__":
    unittest.main()
