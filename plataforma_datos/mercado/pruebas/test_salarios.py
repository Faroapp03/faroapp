"""Pruebas de los salarios por grupo (salarios.py): la tabla de España por subgrupo, su bloque y la correspondencia.

Las reglas se prueban con series mínimas de Tempus y descargas simuladas, sin datos ni acceso a la red.
"""

import copy
import io
import json
import tempfile
import unittest
from contextlib import ExitStack, redirect_stdout
from pathlib import Path
from unittest import mock

import plataforma_datos.mercado.fuentes.salarios.lector as salarios
from plataforma_datos.comun import red
from plataforma_datos.comun.entrada_salida import guardar_json, sha256_bytes
from plataforma_datos.comun.nucleo import Controles, Descarga, FormatoInesperado, OriginalCambiado
from plataforma_datos.mercado.pruebas.test_ediciones_salarios import catalogo

NOTA_SIGNO = salarios.NOTA_VARIABILIDAD + " entre 100 y 500."


def serie(
    sexo: str, ocupacion: str, medida: str, valor: float | None, notas: tuple[str, ...] = ()
) -> dict[str, object]:
    """Una serie de la tabla 36830 como la da Tempus con metadatos (`tip=AM`).

    Args:
        sexo: El sexo de la serie («Ambos sexos», «Mujeres»…).
        ocupacion: El código de la ocupación.
        medida: «Media» o el percentil.
        valor: La cifra, o None si falta.
        notas: Las notas del INE de la cifra.

    Returns:
        La serie con sus metadatos y su dato.
    """
    variable_medida = "Medidas estadísticas" if medida == "Media" else "Percentiles simples"
    return {
        "MetaData": [
            {"T3_Variable": "Sexo", "Nombre": sexo, "Codigo": ""},
            {"T3_Variable": "OCUPACIONES", "Nombre": f"Ocupación {ocupacion}", "Codigo": ocupacion},
            {"T3_Variable": variable_medida, "Nombre": medida, "Codigo": ""},
        ],
        "Data": [{"Anyo": 2022, "Valor": valor, "Notas": [{"texto": nota} for nota in notas]}],
    }


def fila(subgrupo: str, medida: str, salario: float | None, fiabilidad: str = salarios.FIABLE) -> dict[str, object]:
    """Una fila preparada de España.

    Args:
        subgrupo: El subgrupo de la CNO-11.
        medida: La medida («p25», «p50»…).
        salario: La cifra en euros, o None si falta.
        fiabilidad: Si la cifra es fiable, de variabilidad alta o sin dato.

    Returns:
        La fila preparada.
    """
    return {"tabla": "36830", "subgrupo": subgrupo, "medida": medida, "salario": salario, "fiabilidad": fiabilidad}


class PruebaFilasDeEspana(unittest.TestCase):
    """Qué cifras de la tabla 36830 se toman y cómo se marcan."""

    def test_solo_ambos_sexos_y_subgrupos_de_dos_cifras(self) -> None:
        """Las mujeres, el total y los grupos con letra no pasan; el subgrupo 43 de ambos sexos sí."""
        series = [
            serie("Ambos sexos", "43", "Mediana", 23575.82),
            serie("Mujeres", "43", "Mediana", 22000.0),
            serie("Ambos sexos", "E", "Mediana", 21000.0),
            serie("Ambos sexos", "", "Media", 26948.87),
        ]
        self.assertEqual(salarios.filas_espana(series), [fila("43", "p50", 23575.82)])

    def test_marcas_del_ine(self) -> None:
        """Signo «−» con su nota: variabilidad alta, en valor absoluto; sin valor: sin dato."""
        series = [
            serie("Ambos sexos", "57", "Percentil 10", -4177.08, (NOTA_SIGNO,)),
            serie("Ambos sexos", "57", "Percentil 90", None, (salarios.NOTA_SIN_DATO + ".",)),
        ]
        self.assertEqual(
            salarios.filas_espana(series),
            [fila("57", "p10", 4177.08, salarios.VARIABILIDAD_ALTA), fila("57", "p90", None, salarios.SIN_DATO)],
        )

    def test_medida_desconocida_detiene(self) -> None:
        """Una medida que no es la media ni uno de los cinco percentiles no se adivina."""
        with self.assertRaises(FormatoInesperado):
            salarios.filas_espana([serie("Ambos sexos", "43", "Percentil 95", 40000.0)])


class PruebaBloqueYControles(unittest.TestCase):
    """El bloque del paquete y los controles de la tabla."""

    def test_bloque_lleva_rotulo_y_solo_cifras_fiables(self) -> None:
        """Ámbito, año, medida y cita; la cifra marcada no entra y el subgrupo sin cifras fiables tampoco."""
        bloque = salarios.bloque_espana(
            [
                fila("43", "p50", 23575.82),
                fila("43", "p90", 1.0, salarios.VARIABILIDAD_ALTA),
                fila("91", "p50", None, salarios.SIN_DATO),
            ]
        )
        self.assertEqual((bloque["ambito"], bloque["anio"]), ("España", 2022))
        self.assertIn("todas las jornadas", bloque["medida"])
        self.assertIn("tabla 36830", bloque["fuente"])
        self.assertEqual(bloque["subgrupos"], {"43": {"p50": 23575.82}})

    def test_percentiles_desordenados(self) -> None:
        """Un P25 mayor que la mediana se señala; los huecos marcados no cuentan."""
        filas = [fila("43", "p25", 30000.0), fila("43", "p50", 23575.82), fila("44", "p10", 9000.0)]
        filas += [fila("44", "p25", 1.0, salarios.SIN_DATO), fila("44", "p50", 17720.0)]
        self.assertEqual(salarios.percentiles_desordenados(filas), ["43"])

    def test_cifras_del_estudio_con_su_tolerancia_de_un_euro(self) -> None:
        """Con céntimos dentro del margen coincide, fuera no; marcada o ausente, tampoco."""
        buenas = [fila("43", "p25", 16926.49), fila("43", "p50", 23575.82), fila("43", "p75", 29626.65)]
        self.assertEqual(salarios.distintas_del_estudio([*buenas, fila("57", "p50", 10641.24)]), [])
        dentro = salarios.MARGEN_ESTUDIO - 0.01
        fuera = salarios.MARGEN_ESTUDIO + 0.01
        for diferencia, esperado in ((dentro, []), (-dentro, []), (fuera, ["57 p50"]), (-fuera, ["57 p50"])):
            with self.subTest(diferencia=diferencia):
                dudosa = fila("57", "p50", 10641.0 + diferencia)
                self.assertEqual(salarios.distintas_del_estudio([*buenas, dudosa]), esperado)
        marcada = fila("57", "p50", 10641.24, salarios.VARIABILIDAD_ALTA)
        self.assertEqual(salarios.distintas_del_estudio([*buenas, marcada]), ["57 p50"])
        self.assertEqual(salarios.distintas_del_estudio(buenas[:2]), ["43 p75", "57 p50"])


class PruebaControlesDeLasTablas(unittest.TestCase):
    """Los controles de las tablas de Cataluña."""

    def test_si_falta_un_total_queda_el_control_fallido_sin_keyerror(self) -> None:
        """Sin el total de un gran grupo, el control de tablas completas falla y el de totales no se calcula."""
        filas = [
            {"dimension": dimension, "gran_grupo": salarios.TOTAL_OCUPACIONES, "categoria": "total", "salario": 1.0}
            for dimension in salarios.TABLAS
        ]
        controles = Controles()
        salarios._controles_tablas(controles, filas)
        self.assertEqual(
            controles.fallidos, ["las tres tablas traen el total de Cataluña y el de los diez grandes grupos"]
        )
        self.assertEqual(len(controles.lista), 1)


class PruebaCorrespondencia(unittest.TestCase):
    """De la ocupación de la persona (ISCO-08 o CNO-11 a 4 cifras) a su subgrupo."""

    CLASIFICACIONES = {
        "cno11": {
            "4309": {"nivel": "4"},
            "5000": {"nivel": "4"},
            "43": {"nivel": "2"},
        },
        "isco08_es": {
            "4110": "Oficinistas",
            "5120": "Cocineros",
            "9624": "Acarreadores",
            "6121": "Ganaderos",
            "41": "",
        },
        "isco08_a_cno11": {
            "4110": [{"cno11": "4309", "tipo": "1:1"}],
            "5120": [{"cno11": "5000", "tipo": "1:n"}, {"cno11": "5110", "tipo": "1:n"}],
            "6121": [{"cno11": "6201", "tipo": "1:1"}],
        },
    }

    def setUp(self) -> None:
        """Una copia propia de las clasificaciones: ninguna prueba ve lo que otra cambie."""
        self.clasificaciones = copy.deepcopy(self.CLASIFICACIONES)
        self.resultado = salarios.correspondencia(self.clasificaciones, {"43", "51"})

    def test_la_isco_con_un_subgrupo_con_mediana_se_cuenta(self) -> None:
        """Cuatro grupos ISCO-08 de cuatro cifras, de los que uno cae en un solo subgrupo con mediana."""
        isco = self.resultado["isco08_4_cifras"]
        self.assertEqual((isco["grupos"], isco["con_subgrupo"]), (4, 1))

    def test_la_isco_repartida_entre_varios_subgrupos_no_elige_uno(self) -> None:
        """Un grupo que la correspondencia reparte entre varios subgrupos queda con todos, sin elegir."""
        self.assertEqual(self.resultado["isco08_4_cifras"]["en_varios_subgrupos"], {"5120": ["50", "51"]})

    def test_la_isco_con_subgrupo_sin_mediana_o_sin_correspondencia_se_senala(self) -> None:
        """Un subgrupo sin mediana y un grupo sin correspondencia se listan aparte."""
        isco = self.resultado["isco08_4_cifras"]
        self.assertEqual(isco["subgrupo_sin_mediana"], {"6121": "62"})
        self.assertEqual(isco["sin_correspondencia"], ["9624"])

    def test_la_cno_a_cuatro_cifras_senala_las_que_no_tienen_mediana(self) -> None:
        """De dos grupos CNO-11 de cuatro cifras, el 5000 está en un subgrupo sin mediana."""
        self.assertEqual(self.resultado["cno11_4_cifras"], {"grupos": 2, "sin_mediana": ["5000"]})

    def test_la_correspondencia_no_cambia_sus_entradas(self) -> None:
        """Calcular la correspondencia deja las clasificaciones tal como estaban."""
        self.assertEqual(self.clasificaciones, self.CLASIFICACIONES)


class PruebaFiabilidad(unittest.TestCase):
    """Las notas oficiales deciden qué cifras se publican."""

    def test_fiabilidad_segun_las_notas_del_ine(self) -> None:
        """Un signo «−» con su nota es variabilidad alta; sin valor, sin dato; un «−» sin nota no se interpreta."""
        nota = salarios.NOTA_VARIABILIDAD + " entre 100 y 500"
        self.assertEqual(salarios.fiabilidad(25944.52, ()), salarios.FIABLE)
        self.assertEqual(salarios.fiabilidad(-21666.44, (nota,)), salarios.VARIABILIDAD_ALTA)
        self.assertEqual(salarios.fiabilidad(None, (salarios.NOTA_SIN_DATO,)), salarios.SIN_DATO)
        with self.assertRaises(FormatoInesperado):
            salarios.fiabilidad(-1.0, ())


class PruebaDescargasSinRed(unittest.TestCase):
    """Conserva los dos contratos de descarga aplicados a salarios con bytes sintéticos."""

    def descargar(self, carpeta: Path, registrado: bytes) -> None:
        """Descarga en un temporal, simulando que cada URL devuelve los bytes «nuevo»."""
        procedencia = carpeta / "procedencia.json"
        registros = [
            {
                "archivo": archivo["archivo"],
                "sha256": sha256_bytes(registrado),
                "descargado_utc": "2026-01-01T00:00:00+00:00",
            }
            for archivo in salarios.ARCHIVOS
        ]
        guardar_json(procedencia, {"archivos": registros})
        with ExitStack() as parches:
            parches.enter_context(mock.patch.object(salarios, "ORIGINAL", carpeta))
            parches.enter_context(mock.patch.object(salarios, "PROCEDENCIA", procedencia))
            parches.enter_context(mock.patch.object(salarios.time, "sleep"))
            parches.enter_context(
                mock.patch.object(
                    red,
                    "descargar_url",
                    side_effect=lambda url, *_: Descarga(
                        catalogo() if url == salarios.CATALOGO["url"] else b"nuevo", url, "text/plain"
                    ),
                )
            )
            parches.enter_context(redirect_stdout(io.StringIO()))
            salarios.descargar(False)

    def test_version_cambiada(self) -> None:
        """Una descarga distinta de la huella registrada se detiene sin escribir el original."""
        with tempfile.TemporaryDirectory() as temporal:
            carpeta = Path(temporal)
            with self.assertRaises(OriginalCambiado):
                self.descargar(carpeta, b"antiguo")
            self.assertFalse((carpeta / salarios.ARCHIVOS[0]["archivo"]).exists())

    def test_misma_version(self) -> None:
        """Los mismos bytes recuperan todos los originales declarados."""
        with tempfile.TemporaryDirectory() as temporal:
            carpeta = Path(temporal)
            self.descargar(carpeta, b"nuevo")
            for archivo in salarios.ARCHIVOS:
                with self.subTest(archivo=archivo["archivo"]):
                    self.assertEqual((carpeta / archivo["archivo"]).read_bytes(), b"nuevo")
            procedencia = json.loads((carpeta / "procedencia.json").read_bytes())
            self.assertEqual(procedencia["edicion"], {"anio": 2022, "publicado": "23/09/2024"})
            self.assertEqual(len(procedencia["archivos"]), 4)
            self.assertEqual(len(procedencia["descubrimiento"]), 1)
            self.assertEqual(procedencia["descubrimiento"][0]["sha256"], sha256_bytes(catalogo()))
            self.assertEqual((carpeta / salarios.CATALOGO["archivo"]).read_bytes(), catalogo())


if __name__ == "__main__":
    unittest.main()
