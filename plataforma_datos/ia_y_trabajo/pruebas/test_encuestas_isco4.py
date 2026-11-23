"""Exposición calculada con encuestas: lector de Stata, cotas, linealización, réplicas, Casen, GEIH, ECH y PNAD."""

import hashlib
import io
import json
import math
import struct
import tempfile
import unittest
from collections.abc import Iterator
from contextlib import contextmanager, redirect_stdout
from pathlib import Path
from unittest import mock

import plataforma_datos.ia_y_trabajo.fuentes.encuestas_isco4.diseno as diseno
import plataforma_datos.ia_y_trabajo.fuentes.encuestas_isco4.lector as encuestas
import plataforma_datos.ia_y_trabajo.fuentes.encuestas_isco4.pnadc as pnadc
from plataforma_datos.comun import entrada_salida
from plataforma_datos.comun.nucleo import CORRECTO, Carpetas, FormatoInesperado, ValidacionFallida
from plataforma_datos.comun.stata import leer_dta
from plataforma_datos.orquestacion import admision

GRAD = {"4110": "gradiente_4", "4120": "gradiente_1", "4130": None, "5110": "no_expuesta", "5120": "exposicion_minima"}
ESTRUCTURA = diseno.Estructura(GRAD, set(GRAD), {"41": True, "51": False}, {*GRAD, "0110"}, {})


def _dta(variables: list[tuple[str, int]], filas: list[bytes]) -> bytes:
    """Un .dta 118 mínimo (LSF) con esas variables (nombre, tipo) y registros ya empaquetados.

    Args:
        variables: Nombre y tipo de cada variable.
        filas: Los registros, ya empaquetados.

    Returns:
        Los bytes del archivo .dta.
    """
    k = len(variables)
    cabecera = (
        b"<stata_dta><header><release>118</release><byteorder>LSF</byteorder><K>"
        + struct.pack("<H", k)
        + b"</K><N>"
        + struct.pack("<Q", len(filas))
        + b"</N><label>"
        + struct.pack("<H", 0)
        + b"</label><timestamp>"
        + struct.pack("<B", 0)
        + b"</timestamp></header>"
    )
    tipos = b"<variable_types>" + b"".join(struct.pack("<H", tipo) for _, tipo in variables) + b"</variable_types>"
    nombres = b"<varnames>" + b"".join(nombre.encode().ljust(129, b"\0") for nombre, _ in variables) + b"</varnames>"
    datos = b"<data>" + b"".join(filas) + b"</data>"
    inicio_mapa = len(cabecera)
    largo_mapa = len(b"<map>") + 14 * 8 + len(b"</map>")
    posiciones = [0, inicio_mapa, inicio_mapa + largo_mapa, inicio_mapa + largo_mapa + len(tipos)]
    inicio_datos = posiciones[3] + len(nombres)
    mapa = [*posiciones, *([inicio_datos] * 5), inicio_datos, *([inicio_datos + len(datos)] * 4)]
    return cabecera + b"<map>" + struct.pack("<14Q", *mapa) + b"</map>" + tipos + nombres + datos


class PruebasStata(unittest.TestCase):
    """El lector de .dta devuelve las columnas pedidas, con los ausentes como None."""

    def test_columnas_y_ausentes(self) -> None:
        """Números, cadenas y valores ausentes de Stata."""
        variables = [("activ", 65530), ("expr", 65526), ("oficio", 4), ("otra", 65529)]
        filas = [
            struct.pack("<bd", 1, 2.5) + b"2411" + struct.pack("<h", 7),
            struct.pack("<bd", 101, 8.98846567431158e307) + b"41\0\0" + struct.pack("<h", 32741),
        ]
        leidas = list(leer_dta(io.BytesIO(_dta(variables, filas)), ("activ", "expr", "oficio")))
        self.assertEqual(leidas[0], {"activ": 1, "expr": 2.5, "oficio": "2411"})
        self.assertEqual(leidas[1], {"activ": None, "expr": None, "oficio": "41"})

    def test_variable_que_falta(self) -> None:
        """Pedir una variable que no está es un error de formato."""
        with self.assertRaises(FormatoInesperado):
            list(leer_dta(io.BytesIO(_dta([("activ", 65530)], [b"\x01"])), ("expr",)))


class PruebasCorrespondencia(unittest.TestCase):
    """Un subgrupo pasa a ISCO-08 por identidad de código solo si tiene sus mismos grupos primarios."""

    def test_subgrupos_comparables(self) -> None:
        """El subgrupo 22 (con 2223 y sin 2230) no es comparable; el 24, con los mismos grupos, sí."""
        isco4 = {"2211", "2212", "2230", "2411", "2412"}
        nacional = {"2211", "2212", "2223", "2411", "2412"}
        self.assertEqual(diseno.subgrupos_comparables(nacional, isco4), {"22": False, "24": True})


class PruebasDiseno(unittest.TestCase):
    """Cuentas y varianza con resultado conocido."""

    def test_clase_y_codigos(self) -> None:
        """Exacta, acotada o fuera; los códigos Casen pasan a 4 cifras."""
        self.assertEqual(diseno.clase("4110", ESTRUCTURA), "exacta")
        self.assertEqual(diseno.clase("5110", ESTRUCTURA), "acotada")  # subgrupo no comparable
        self.assertEqual(diseno.clase("0110", ESTRUCTURA), "fuera")
        self.assertEqual(diseno.clase(None, ESTRUCTURA), "fuera")
        self.assertEqual(diseno.clase("9999", ESTRUCTURA), "invalido")
        self.assertEqual(encuestas.codigo_casen(110), "0110")
        self.assertIsNone(encuestas.codigo_casen(-99))

    def test_cifra_y_taylor(self) -> None:
        """La cifra y su error típico coinciden con la cuenta a mano."""
        personas = [
            diseno.Persona(True, "4110", 1.0, "1", "a"),
            diseno.Persona(True, "4120", 1.0, "1", "b"),
            diseno.Persona(True, "4110", 2.0, "2", "c"),
            diseno.Persona(True, "4130", 2.0, "2", "d"),
            diseno.Persona(False, None, 5.0, "2", "d"),
            diseno.Persona(True, "0110", 2.0, "2", "d"),
            diseno.Persona(True, "9999", 1.0, "2", "d"),
        ]
        resultado = diseno.exposicion_por_diseno(personas, ESTRUCTURA)
        self.assertEqual(resultado["alta"]["valor"], 50.0)  # (1 + 2) / 6
        self.assertEqual(resultado["alguna"]["valor"], round(100 * 4 / 6, 3))
        self.assertEqual(resultado["parte_fuera"], round(3 / 9, 5))
        self.assertEqual(resultado["parte_codigo_invalido"], round(1 / 9, 6))
        # z = (y − R·x) / X por UPM con R = 1/2 y X = 6: a +1/12, b −1/12, c +1/6, d −1/6.
        varianza = 2 * (1 / 12) ** 2 * 2 + 2 * (1 / 6) ** 2 * 2
        self.assertAlmostEqual(resultado["alta"]["error_tipico"], round(100 * math.sqrt(varianza), 3))
        self.assertEqual(resultado["muestra"]["conglomerados"], 4)

    def test_mucho_sin_correspondencia_solo_cotas(self) -> None:
        """Con más del 5 % acotado solo hay cotas, salvo que coincidan."""
        personas = [
            diseno.Persona(True, "4110", 1.0, "1", "a"),
            diseno.Persona(True, "5110", 1.0, "1", "b"),
        ]
        resultado = diseno.exposicion_por_diseno(personas, ESTRUCTURA)
        self.assertEqual(resultado["parte_sin_correspondencia"], 0.5)
        # 51 no tiene ningún grupo G4: lo acotado no cambia «alta», que sale con cifra.
        self.assertEqual(resultado["alta"]["valor"], 50.0)
        acotada = diseno.Estructura(GRAD, set(GRAD), {"41": False, "51": False}, set(GRAD), {})
        resultado = diseno.exposicion_por_diseno(personas, acotada)
        self.assertIsNone(resultado["alta"]["valor"])
        self.assertEqual((resultado["alta"]["cota_minima"], resultado["alta"]["cota_maxima"]), (0.0, 50.0))

    def test_codigos_validos_de_colombia(self) -> None:
        """En 73, 83 y 96 vale cualquier grupo propio; en el resto, solo los de ISCO-08."""
        validos = encuestas.codigos_col_validos({"7317", "7311", "2411"})
        self.assertIn("7331", validos)
        self.assertIn("2411", validos)
        self.assertNotIn("5629", validos)
        self.assertNotIn("0000", validos)

    def test_anexo_casen(self) -> None:
        """El anexo 1 da los grupos primarios y se reconoce por su título."""
        filas = [
            {"A": "Índice", "C": "Anexo 1: Códigos Clasificación Internacional Uniforme de Ocupaciones, CIUO 08"},
            {"B": "Gran Grupo", "C": "Grupo Primario"},
            *({"C": str(1000 + i)} for i in range(401)),
            {"C": "110", "D": "Oficiales de las Fuerzas Armadas"},
        ]
        codigos = encuestas.estructura_casen(filas)
        self.assertIn("0110", codigos)
        self.assertEqual(len(codigos), 402)
        with self.assertRaises(FormatoInesperado):
            encuestas.estructura_casen(filas[1:])


class PruebasEch(unittest.TestCase):
    """Lectura de un mes de la ECH de Uruguay y su total publicado."""

    CABECERA = "ID,nper,anio,mes,ESTRED13,f71_2,POBPCOAC,NIV_EDU,W\n"

    def test_codigo_ech(self) -> None:
        """Las fuerzas armadas vienen sin el cero inicial; 0 y vacío son ocupación no declarada."""
        self.assertEqual(encuestas.codigo_ech("110"), "0110")
        self.assertEqual(encuestas.codigo_ech("4110"), "4110")
        self.assertIsNone(encuestas.codigo_ech("0"))
        self.assertIsNone(encuestas.codigo_ech(""))

    def test_personas_de_un_mes(self) -> None:
        """Ocupados con su código, `W`/12, estrato `ESTRED13` y hogar `ID`; el resto, sin ocupación."""
        texto = self.CABECERA + '7,1,2023,3,4,4110,2,"1. CB, incompleto",120\n7,2,2023,3,4,0,9,x,60\n'
        personas = list(encuestas.personas_ech(texto, "03"))
        self.assertEqual(personas[0], diseno.Persona(True, "4110", 10.0, "4", "7"))
        self.assertEqual(personas[1], diseno.Persona(False, None, 5.0, "4", "7"))

    def test_mes_o_campo_inesperado(self) -> None:
        """Una persona de otro mes o un campo que falta son errores de formato."""
        with self.assertRaises(FormatoInesperado):
            list(encuestas.personas_ech(self.CABECERA + "7,1,2023,4,4,4110,2,x,120\n", "03"))
        with self.assertRaises(FormatoInesperado):
            list(encuestas.personas_ech("ID,mes,W\n7,3,120\n", "03"))

    def test_publicado_anual(self) -> None:
        """El total anual publicado es la media de los 12 meses (centenas de personas), a la centena."""
        self.assertEqual(len(encuestas.OCUPADOS_ECH_2023_POR_MES), len(encuestas.MESES_ECH))
        self.assertEqual(encuestas.OCUPADOS_ECH_2023, (1_697_542, 100))
        self.assertEqual((encuestas.MESES_ECH["01"], encuestas.MESES_ECH["12"]), (1280, 1291))


class PruebasReplicas(unittest.TestCase):
    """Brasil: lectura de la PNAD Contínua, subgrupos propios de la COD y error de muestreo con pesos replicados."""

    # Ano (4), Trimestre (1), V2007 (1), V4010 (4), VD4002 (1) y los 201 pesos (6 cada uno) en ancho fijo.
    VARIABLES = (("Ano", 4), ("Trimestre", 1), ("V2007", 1), ("V4010", 4), ("VD4002", 1)) + tuple(
        (nombre, 6) for nombre in pnadc.PESOS_PNADC
    )

    def _entrada(self, variables: tuple[tuple[str, int], ...]) -> str:
        """El archivo de entrada oficial (formato SAS) con esas variables, una tras otra.

        Args:
            variables: Nombre y ancho de cada variable.

        Returns:
            El texto del archivo de entrada.
        """
        lineas, inicio = [], 1
        for nombre, ancho in variables:
            lineas.append(f"@{inicio:04d} {nombre} ${ancho}.")
            inicio += ancho
        return "\n".join(lineas)

    def _persona(self, codigo: str, condicion: str, pesos: list[float]) -> str:
        """Una persona del 2.º trimestre de 2026 con sus 201 pesos.

        Args:
            codigo: El código de ocupación a cuatro cifras.
            condicion: La condición de actividad.
            pesos: Los 201 pesos.

        Returns:
            La línea de la persona, terminada en salto de línea.
        """
        return f"20262{1}{codigo:<4}{condicion}" + "".join(f"{peso:>6}" for peso in pesos) + "\n"

    def test_ocupados_y_pesos(self) -> None:
        """Solo los ocupados, con su código (0000 es no declarada) y sus 201 pesos; sin réplicas, se detiene."""
        posiciones = pnadc.posiciones_sas(self._entrada(self.VARIABLES))
        pesos = [float(indice + 1) for indice in range(len(pnadc.PESOS_PNADC))]
        lineas = [
            self._persona("2511", "1", pesos),
            self._persona("0000", "1", pesos),
            self._persona("2511", "2", pesos),
        ]
        periodo: set[tuple[str, str]] = set()
        personas = list(pnadc.ocupados_pnadc(iter(lineas), posiciones, periodo))
        self.assertEqual(personas, [("2511", pesos), (None, pesos)])
        self.assertEqual(periodo, {("2026", "2")})
        sin_replicas = pnadc.posiciones_sas(self._entrada(self.VARIABLES[:6]))
        with self.assertRaises(FormatoInesperado):
            list(pnadc.ocupados_pnadc(iter(lineas), sin_replicas, set()))
        with self.assertRaises(FormatoInesperado):
            pnadc.posiciones_sas(self._entrada(self.VARIABLES[:3]))

    def test_cifra_y_replicas(self) -> None:
        """La cifra es la del peso principal; su varianza, Σ (θ_r − θ)² / (R − 1) sobre las réplicas."""
        personas = [("4110", [1.0, 2.0, 1.0]), ("4120", [1.0, 1.0, 1.0]), (None, [1.0, 1.0, 1.0]), ("0110", [1.0] * 3)]
        resultado = diseno.exposicion_por_replicas(personas, ESTRUCTURA)
        # «alta»: θ = 1/2; réplicas 2/3 y 1/2; varianza (1/6)² / (2 − 1).
        self.assertEqual(resultado["alta"]["valor"], 50.0)
        self.assertEqual(resultado["alta"]["error_tipico"], round(100 / 6, 3))
        self.assertEqual(resultado["alguna"]["error_tipico"], 0.0)
        self.assertEqual(resultado["parte_fuera"], 0.5)
        self.assertEqual(resultado["muestra"]["replicas"], 2)
        self.assertEqual(resultado["muestra"]["personas"], 2)

    def test_subgrupos_propios(self) -> None:
        """Un subgrupo propio de la clasificación nacional se acota sobre los grupos ISCO-08 que se le asignan."""
        propios = diseno.Estructura(GRAD, set(GRAD), {"04": False, "41": True}, {*GRAD, "0411"}, {"04": ("4110",)})
        self.assertEqual(diseno.clase("0411", propios), "acotada")
        self.assertEqual(diseno.cotas("0411", propios), {"alguna": (1.0, 1.0), "alta": (1.0, 1.0)})
        sin_propios = propios._replace(propios={})
        self.assertEqual(diseno.cotas("0411", sin_propios), {"alguna": (0.0, 1.0), "alta": (0.0, 1.0)})

    def test_estructura_cod(self) -> None:
        """Los grupos de base salen de la cuarta columna, como número o como texto con ceros a la izquierda."""
        libro = {
            "Estrutura COD": [
                ["Classificação de Ocupações para Pesquisas Domiciliares", "", "", "", ""],
                ["Grande Grupo", "Subgrupo principal", "Subgrupo", "Grupo de base", "Denominação"],
                [1.0, "", "", "", "DIRETORES E GERENTES"],
                ["", "", "", 1111.0, "Legisladores "],
                ["", "", "", "0411", "Oficiais da polícia militar"],
            ]
        }
        self.assertEqual(pnadc.estructura_cod(libro), {"1111": "Legisladores", "0411": "Oficiais da polícia militar"})
        with self.assertRaises(FormatoInesperado):
            pnadc.estructura_cod({"Otra": [["Nada", "", "", 1111.0, "x"]]})


def _calculada_sintetica() -> dict:
    """Cuatro agregados sintéticos para comprobar validación, sin microdatos.

    Returns:
        Un conjunto independiente con cifras puntuales y controles satisfechos.
    """
    return {
        iso3: {
            "anio": 2024,
            "fuente": "Encuesta sintética",
            "error_de_muestreo": "linealización de Taylor (datos sintéticos)",
            "empleo": 100,
            "ocupados_publicados": [100, 1],
            "codigos_fuera_de_la_estructura": [],
            "parte_codigo_invalido": 0,
            "parte_sin_correspondencia": 0,
            "muestra": {"regla_nchs_n_30": True},
            **{
                medida: {"valor": 20, "desde_95": 19, "cota_minima": 20, "cota_maxima": 20, "hasta_95": 21}
                for medida in ("alguna", "alta")
            },
        }
        for iso3 in ("CHL", "COL", "URY", "BRA")
    }


@contextmanager
def _ensayo_validacion(preparado: object) -> Iterator[Carpetas]:
    """Monta entradas propias y el cierre real; conserva un validado anterior como testigo.

    Yields:
        Las carpetas del montaje temporal exclusivo.
    """
    with tempfile.TemporaryDirectory(prefix="encuestas-isco4-") as directorio:
        raiz = Path(directorio)
        carpetas = Carpetas(raiz / "originales", raiz / "preparados", raiz / "validados")
        for carpeta in carpetas:
            carpeta.mkdir()
        contenido = b"Entrada sintetica de prueba; no son microdatos.\n"
        (carpetas.original / "entrada-sintetica.txt").write_bytes(contenido)
        entrada_salida.guardar_json(
            carpetas.original / "procedencia.json",
            {"archivos": [{"archivo": "entrada-sintetica.txt", "sha256": hashlib.sha256(contenido).hexdigest()}]},
        )
        # Los casos defectuosos también llegan al lector desde un archivo, incluidos NaN/infinito.
        (carpetas.preparado / "calculada.json").write_text(json.dumps(preparado), encoding="utf-8")
        (carpetas.validado / "encuestas-isco4.json").write_bytes(b'{"anterior": true}\n')
        with (
            mock.patch.object(encuestas, "ORIGINAL", carpetas.original),
            mock.patch.object(encuestas, "PROCEDENCIA", carpetas.original / "procedencia.json"),
            mock.patch.object(encuestas, "CALCULADA", carpetas.preparado / "calculada.json"),
            mock.patch.object(encuestas, "ahora_utc", return_value="2026-10-15T00:00:00Z"),
            mock.patch.object(entrada_salida, "carpetas", return_value=carpetas),
            mock.patch.object(admision, "carpetas", return_value=carpetas),
            redirect_stdout(io.StringIO()),
        ):
            yield carpetas


class PruebasValidacionDeEncuestas(unittest.TestCase):
    """La validación rechaza agregados defectuosos y conserva el conjunto anterior."""

    def test_paises_obligatorios(self) -> None:
        """El conjunto contiene los cuatro países, sin ausencias ni añadidos."""
        base = _calculada_sintetica()
        casos = [None, [], {}, {k: v for k, v in base.items() if k != "BRA"}, {**base, "MEX": base["CHL"]}]
        for preparado in casos:
            with self.subTest(preparado=preparado), _ensayo_validacion(preparado) as carpetas:
                with self.assertRaisesRegex(FormatoInesperado, "encuestas-isco4.*países"):
                    encuestas.validar()
                self.assertEqual((carpetas.validado / "encuestas-isco4.json").read_bytes(), b'{"anterior": true}\n')

    def test_forma_de_campos_consumidos(self) -> None:
        """Las rutas utilizadas se comprueban antes de indexar o hacer cuentas."""
        for ruta, valor in (
            (("CHL",), None),
            (("CHL", "fuente"), None),
            (("CHL", "error_de_muestreo"), None),
            (("CHL", "anio"), True),
            (("CHL", "empleo"), "100"),
            (("CHL", "ocupados_publicados"), []),
            (("CHL", "ocupados_publicados"), [100]),
            (("CHL", "ocupados_publicados"), [100, 0]),
            (("CHL", "codigos_fuera_de_la_estructura"), None),
            (("CHL", "parte_codigo_invalido"), "0"),
            (("CHL", "parte_sin_correspondencia"), None),
            (("CHL", "parte_sin_correspondencia"), -0.1),
            (("CHL", "parte_sin_correspondencia"), 1.1),
            (("CHL", "muestra"), []),
            (("CHL", "muestra", "regla_nchs_n_30"), "sí"),
            (("CHL", "alguna"), []),
            (("CHL", "alguna", "desde_95"), None),
            (("CHL", "alta", "cota_minima"), True),
        ):
            preparado = _calculada_sintetica()
            objeto = preparado
            for clave in ruta[:-1]:
                objeto = objeto[clave]
            objeto[ruta[-1]] = valor
            with self.subTest(ruta=ruta), _ensayo_validacion(preparado) as carpetas:
                with self.assertRaisesRegex(FormatoInesperado, "encuestas-isco4.*" + ".*".join(ruta)):
                    encuestas.validar()
                self.assertEqual((carpetas.validado / "encuestas-isco4.json").read_bytes(), b'{"anterior": true}\n')
        preparado = _calculada_sintetica()
        del preparado["CHL"]["alta"]["valor"]
        with _ensayo_validacion(preparado), self.assertRaisesRegex(FormatoInesperado, "CHL.*alta.*valor"):
            encuestas.validar()

    def test_cifra_puntual_numerica_dentro_de_cotas(self) -> None:
        """Una cifra puntual no puede escapar de sus cotas ni ser un booleano o no finita."""
        for valor in (20.5, -1, 101, True, "20", float("inf"), float("nan")):
            preparado = _calculada_sintetica()
            preparado["CHL"]["alta"]["valor"] = valor
            with self.subTest(valor=valor), _ensayo_validacion(preparado) as carpetas:
                with self.assertRaisesRegex(FormatoInesperado, "CHL.*alta.*valor"):
                    encuestas.validar()
                self.assertEqual((carpetas.validado / "encuestas-isco4.json").read_bytes(), b'{"anterior": true}\n')

    def test_cierre_real_con_cifra_y_con_cotas(self) -> None:
        """Los agregados válidos se publican intactos mediante el cierre y la huella reales."""
        for solo_cotas in (False, True):
            preparado = _calculada_sintetica()
            if solo_cotas:
                preparado["CHL"]["parte_sin_correspondencia"] = 0.1
                for medida in ("alguna", "alta"):
                    preparado["CHL"][medida].update(valor=None, cota_maxima=40, hasta_95=41)
            with self.subTest(solo_cotas=solo_cotas), _ensayo_validacion(preparado) as carpetas:
                encuestas.validar()
                self.assertEqual(entrada_salida.leer_json(carpetas.validado / "encuestas-isco4.json"), preparado)
                informe = entrada_salida.leer_json(carpetas.validacion)
                self.assertEqual(informe["estado"], "Admitido")
                self.assertTrue(all(control["resultado"] == CORRECTO for control in informe["controles"]))

    def test_controles_existentes_preservan_validado(self) -> None:
        """Una escala invertida sigue fallando su control y no publica el agregado."""
        preparado = _calculada_sintetica()
        preparado["CHL"]["alta"]["desde_95"] = 22
        with _ensayo_validacion(preparado) as carpetas:
            with self.assertRaises(ValidacionFallida):
                encuestas.validar()
            self.assertEqual((carpetas.validado / "encuestas-isco4.json").read_bytes(), b'{"anterior": true}\n')


class PruebasCsvDeEncuestas(unittest.TestCase):
    """Cada fallo de lectura identifica fuente, mes y fila sin exponer el registro."""

    def test_geih_truncada_o_peso_invalido(self) -> None:
        """Cabecera ausente y filas cortas o no numéricas dan error con contexto."""
        cabecera = ";".join(encuestas.CAMPOS_GEIH) + "\n"
        for texto in (
            "",
            cabecera + "03;hogar\n",
            cabecera + "03;hogar;01;1;x;4110\n",
            cabecera + "03;hogar;01;1;inf;4110\n",
        ):
            with self.subTest(texto=texto), self.assertRaisesRegex(FormatoInesperado, "GEIH.*03.*fila"):
                list(encuestas.personas_geih(texto, "03"))

    def test_ech_truncada_o_peso_invalido(self) -> None:
        """Una fila incompleta no llega a zfill/float sin diagnóstico de ubicación."""
        cabecera = ",".join(encuestas.CAMPOS_ECH) + "\n"
        for fila in ("hogar\n", "hogar,03,4,2,4110\n", "hogar,03,4,2,4110,x\n", "hogar,03,4,2,4110,nan\n"):
            with self.subTest(fila=fila), self.assertRaisesRegex(FormatoInesperado, "ECH.*03.*fila 2"):
                list(encuestas.personas_ech(cabecera + fila, "03"))

    def test_geih_nominal_y_periodo(self) -> None:
        """Se conserva el peso anual, el código y la unidad aproximada de diseño."""
        cabecera = ";".join(encuestas.CAMPOS_GEIH) + "\n"
        texto = cabecera + "03;hogar;01;1;120;4110\n"
        self.assertEqual(
            list(encuestas.personas_geih(texto, "03")), [diseno.Persona(True, "4110", 10, "01-1", "03-hogar")]
        )
        with self.assertRaises(FormatoInesperado):
            list(encuestas.personas_geih(texto, "04"))


class PruebasCodigoCasen(unittest.TestCase):
    """Los códigos no se redondean ni se truncan para asignarles una ocupación."""

    def test_codigo_fraccionario_o_no_finito(self) -> None:
        """Un código positivo fraccionario se diagnostica sin convertirlo a otro grupo."""
        for valor in (1111.5, "1111.5", True, float("inf"), float("nan")):
            with self.subTest(valor=valor), self.assertRaisesRegex(FormatoInesperado, "Casen.*oficio4_08"):
                encuestas.codigo_casen(valor)

    def test_codigos_y_ausencias_originales(self) -> None:
        """Enteros, cadenas enteras, ausencia y códigos negativos conservan su significado."""
        for valor in (1111, 1111.0, "1111", " 1111 "):
            self.assertEqual(encuestas.codigo_casen(valor), "1111")
        self.assertEqual(encuestas.codigo_casen(110), "0110")
        for valor in (None, -99, -88, -66, -1.5, "-1.5"):
            self.assertIsNone(encuestas.codigo_casen(valor))


if __name__ == "__main__":
    unittest.main()
