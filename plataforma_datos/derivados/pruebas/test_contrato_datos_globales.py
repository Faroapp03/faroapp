"""Pruebas del contrato del archivo de datos globales (contrato_datos_globales.py)."""

import copy
import math
import unittest
from collections.abc import Callable
from typing import Any

from plataforma_datos.derivados.fuentes.datos_globales.piezas.contrato_datos_globales import problemas_del_contrato


def recuento(cifra: float) -> dict[str, Any]:
    """Compone un recuento que cumple el contrato, con una cifra de España.

    Args:
        cifra: valor del recuento, en miles de personas.

    Returns:
        Recuento con la forma del contrato.
    """
    return {
        **contrato_minimo()["indicadores"][0],
        "id": "empleo-tic",
        "unidad": "miles de personas",
        "valores": [{"territorio": "ESP", "valor": cifra, "anio": 2025, "nota": None}],
    }


def contrato_minimo() -> dict[str, Any]:
    """Compone un archivo que cumple el contrato: un indicador, Cataluña y un país.

    Returns:
        Datos globales mínimos con la forma del contrato.
    """
    return {
        "version": "1",
        "generado": "2026-10-11",
        "indicadores": [
            {
                "id": "empresas-ia",
                "nombre": {"es": "Empresas que usan IA", "ca": "Empreses que fan servir IA"},
                "definicion": {"es": "Porcentaje…", "ca": "Percentatge…"},
                "unidad": "porcentaje",
                "naturaleza": "medido",
                "fuente": "Eurostat",
                "tabla": "isoc_eb_ai",
                "licencia": "Citar la fuente.",
                "url": "https://doi.org/10.2908/ISOC_EB_AI",
                "comparable": True,
                "cobertura": "ue",
            }
        ],
        "territorios": [
            {
                "codigo": "ES51",
                "iso3": None,
                "tipo": "region",
                "nombre": {"es": "Cataluña", "ca": "Catalunya"},
                "valores": [{"indicador": "empresas-ia", "valor": 24.04, "anio": 2025, "nota": None}],
            },
            {
                "codigo": "ESP",
                "iso3": "ESP",
                "tipo": "pais",
                "nombre": {"es": "España", "ca": "Espanya"},
                "valores": [{"indicador": "empresas-ia", "valor": 20.27, "anio": 2025, "nota": "provisional"}],
            },
        ],
        "recuentos": [],
        "metas": [],
        "encuestas": [],
        "calculados": [],
    }


Cambio = Callable[[dict[str, Any]], None]


def en_el_archivo(**campos: object) -> Cambio:
    """Prepara un cambio de las claves de primer nivel del archivo.

    Args:
        **campos: claves del archivo y su valor nuevo.

    Returns:
        Función que aplica el cambio a unos datos con la forma del contrato.
    """

    def cambiar(datos: dict[str, Any]) -> None:
        datos.update(campos)

    return cambiar


def en_el_indicador(**campos: object) -> Cambio:
    """Prepara un cambio del único indicador del contrato mínimo.

    Args:
        **campos: claves del indicador y su valor nuevo.

    Returns:
        Función que aplica el cambio a unos datos con la forma del contrato.
    """

    def cambiar(datos: dict[str, Any]) -> None:
        datos["indicadores"][0].update(campos)

    return cambiar


def en_el_territorio(posicion: int, **campos: object) -> Cambio:
    """Prepara un cambio de un territorio del contrato mínimo (0 Cataluña, 1 España).

    Args:
        posicion: posición del territorio en «territorios».
        **campos: claves del territorio y su valor nuevo.

    Returns:
        Función que aplica el cambio a unos datos con la forma del contrato.
    """

    def cambiar(datos: dict[str, Any]) -> None:
        datos["territorios"][posicion].update(campos)

    return cambiar


def en_la_cifra_de_espana(**campos: object) -> Cambio:
    """Prepara un cambio de la única cifra de España del contrato mínimo.

    Args:
        **campos: claves de la cifra y su valor nuevo.

    Returns:
        Función que aplica el cambio a unos datos con la forma del contrato.
    """

    def cambiar(datos: dict[str, Any]) -> None:
        datos["territorios"][1]["valores"][0].update(campos)

    return cambiar


def con_recuentos(*recuentos: dict[str, Any]) -> Cambio:
    """Prepara un cambio que añade recuentos al archivo.

    Args:
        *recuentos: recuentos que se añaden, en orden.

    Returns:
        Función que aplica el cambio a unos datos con la forma del contrato.
    """

    def cambiar(datos: dict[str, Any]) -> None:
        datos["recuentos"].extend(recuentos)

    return cambiar


class PruebaContrato(unittest.TestCase):
    """Cada regla del contrato, con un caso que la cumple y otro que la rompe solo a ella."""

    def roto(self, cambio: Cambio) -> list[str]:
        """Aplica un cambio al contrato mínimo y lo valida.

        Args:
            cambio: función que modifica los datos en su sitio.

        Returns:
            Problemas del contrato tras el cambio.
        """
        datos = contrato_minimo()
        cambio(datos)
        return problemas_del_contrato(datos)

    def solo_rompe(self, cambio: Cambio, regla: str) -> None:
        """Comprueba que un cambio da un único problema y que es el de la regla esperada.

        Args:
            cambio: función que modifica los datos en su sitio.
            regla: fragmento del texto del problema que la regla tiene que dar.
        """
        problemas = self.roto(cambio)
        self.assertEqual(len(problemas), 1, problemas)
        self.assertIn(regla, problemas[0])

    def test_el_contrato_minimo_se_cumple(self) -> None:
        """El archivo mínimo de la prueba cumple el contrato: sin él, ninguna prueba de rotura distinguiría la causa."""
        self.assertEqual(problemas_del_contrato(contrato_minimo()), [])

    def test_una_clave_de_mas_no_pasa(self) -> None:
        """Una clave de más, en el archivo o en una cifra, no pasa."""
        self.solo_rompe(en_el_archivo(personas=[]), "el archivo no tiene exactamente las claves")
        self.solo_rompe(en_la_cifra_de_espana(fuente="x"), "ESP: valor con otras claves")

    def test_la_naturaleza_es_medido_o_estimado(self) -> None:
        """La naturaleza de un indicador solo puede ser «medido» o «estimado»."""
        self.solo_rompe(en_el_indicador(naturaleza="calculado"), "empresas-ia: «medido» o «estimado»")

    def test_un_porcentaje_fuera_de_rango_o_sin_anio_no_pasa(self) -> None:
        """Un porcentaje fuera de rango, sin año o que no es una cifra no pasa."""
        self.solo_rompe(en_la_cifra_de_espana(valor=120.0), "porcentaje entre 0 y 100")
        self.solo_rompe(en_la_cifra_de_espana(anio=None), "año entero")
        self.solo_rompe(en_la_cifra_de_espana(valor=True), "cifra numérica")

    def test_la_nota_es_del_vocabulario(self) -> None:
        """La nota de una cifra tiene que ser una del vocabulario del contrato."""
        self.solo_rompe(en_la_cifra_de_espana(nota="dudosa"), "nota del vocabulario o null")

    def test_un_pais_se_nombra_por_su_iso_alfa_3(self) -> None:
        """Un país se nombra por su ISO alfa-3, y una región no lleva iso3."""
        self.solo_rompe(en_el_territorio(1, codigo="ES"), "ES: código, tipo e iso3 no casan")
        self.solo_rompe(en_el_territorio(1, iso3="ES"), "ESP: código, tipo e iso3 no casan")
        self.solo_rompe(en_el_territorio(0, iso3="ESP"), "ES51: código, tipo e iso3 no casan")

    def test_una_serie_va_del_anio_mas_reciente_al_mas_antiguo(self) -> None:
        """Una serie (varios años del mismo indicador) pasa si va del año más reciente al más antiguo, y no al revés."""

        def con_serie(orden: tuple[int, int]) -> Cambio:
            return en_el_territorio(
                1, valores=[{"indicador": "empresas-ia", "valor": 13.0, "anio": anio, "nota": None} for anio in orden]
            )

        self.assertEqual(self.roto(con_serie((2025, 2024))), [])
        self.solo_rompe(con_serie((2024, 2025)), "una serie que no va del año más reciente al más antiguo")

    def test_lo_de_solo_cataluna_no_va_en_otro_territorio_ni_se_compara(self) -> None:
        """Un indicador de cobertura «cataluna» no está en otro territorio y no se marca como comparable."""
        en_otro_territorio = "indicadores de solo Cataluña en otros territorios: ['ESP · empresas-ia']"
        no_se_compara = "empresas-ia: lo de solo Cataluña no se compara"
        self.assertEqual(self.roto(en_el_indicador(cobertura="cataluna", comparable=False)), [en_otro_territorio])
        # Con la misma cifra de España, marcarlo comparable añade su propio problema: la regla se ve por sí sola.
        self.assertEqual(self.roto(en_el_indicador(cobertura="cataluna")), [no_se_compara, en_otro_territorio])

    def test_un_indicador_repetido_en_un_territorio_no_pasa(self) -> None:
        """Un territorio no puede llevar dos veces el mismo indicador."""

        def repetir(datos: dict[str, Any]) -> None:
            valores = datos["territorios"][1]["valores"]
            valores.append(copy.deepcopy(valores[0]))

        self.solo_rompe(repetir, "ESP: un indicador repetido el mismo año")

    def test_un_id_sin_la_forma_del_contrato_no_pasa_ni_rompe_la_validacion(self) -> None:
        """Un id vacío, con mayúsculas o que no es texto da un problema, no una excepción."""
        for id_ in ("", "Empresas IA", ["empresas-ia"]):
            with self.subTest(id_=id_):
                self.assertIn(f"{id_}: id con forma válida", self.roto(en_el_indicador(id=id_)))

    def test_una_cifra_que_no_es_finita_no_pasa(self) -> None:
        """NaN e infinito no son JSON: no pasan ni en un territorio ni en un recuento."""
        for cifra in (math.nan, math.inf):
            with self.subTest(cifra=cifra):
                self.solo_rompe(en_la_cifra_de_espana(valor=cifra), "ESP · empresas-ia: cifra numérica")
                self.solo_rompe(con_recuentos(recuento(cifra)), "empleo-tic: valor sin territorio, cifra, año o nota")

    def test_dos_recuentos_con_el_mismo_id_no_pasan(self) -> None:
        """Cada recuento tiene su id, como los indicadores y las encuestas."""
        self.assertEqual(self.roto(con_recuentos(recuento(10.0))), [])
        self.solo_rompe(con_recuentos(recuento(10.0), recuento(12.0)), "los recuentos no tienen un id válido y único")

    def test_un_recuento_sin_valores_lo_dice(self) -> None:
        """Un recuento con la lista de valores vacía da el problema «sin valores»."""
        self.assertEqual(self.roto(con_recuentos({**recuento(10.0), "valores": []})), ["empleo-tic: sin valores"])

    def test_una_fecha_imposible_en_generado_no_pasa(self) -> None:
        """«generado» es una fecha que existe, no solo algo con forma AAAA-MM-DD."""
        self.assertEqual(self.roto(en_el_archivo(generado="2026-13-45")), ["«generado» no es una fecha AAAA-MM-DD"])

    def test_una_cifra_de_un_anio_posterior_al_del_archivo_no_pasa(self) -> None:
        """Una cifra no puede ser de un año que aún no ha llegado cuando se genera el archivo."""
        self.solo_rompe(en_la_cifra_de_espana(anio=2027), "cifras de un año posterior al de «generado»")

    def test_un_recuento_de_un_territorio_que_no_esta_en_el_archivo_no_pasa(self) -> None:
        """El territorio de un recuento o de una encuesta es uno de «territorios», no solo un código con forma."""
        de_francia = {**recuento(10.0), "valores": [{"territorio": "FRA", "valor": 1.0, "anio": 2025, "nota": None}]}
        self.solo_rompe(con_recuentos(de_francia), "con un territorio que no está en «territorios»: ['FRA']")

    def test_unos_valores_nulos_dan_un_problema_y_no_rompen_la_validacion(self) -> None:
        """Un territorio con `valores: null` se nombra en lugar de hacer caer el validador."""
        self.assertIn("ESP: sin valores", self.roto(en_el_territorio(1, valores=None)))


class PruebaContratoMalFormado(unittest.TestCase):
    """Un archivo mal formado sale en la lista de problemas: el validador no se rompe con una excepción."""

    def problemas(self, cambio: Callable[[dict[str, Any]], object]) -> list[str]:
        """Los problemas del contrato mínimo tras aplicarle un cambio.

        Args:
            cambio: Lo que se le hace al contrato mínimo, en su sitio.

        Returns:
            Los problemas que encuentra el validador.
        """
        datos = contrato_minimo()
        cambio(datos)
        return problemas_del_contrato(datos)

    def test_indicador_sin_unidad(self) -> None:
        """Un indicador con id válido y sin «unidad» es un problema, no un KeyError."""
        self.assertTrue(self.problemas(lambda datos: datos["indicadores"][0].pop("unidad")))

    def test_indicador_con_cobertura_y_sin_id(self) -> None:
        """Un indicador con «cobertura» y sin «id» es un problema, no un KeyError."""
        self.assertTrue(self.problemas(lambda datos: datos["indicadores"][0].pop("id")))

    def test_valores_que_no_son_texto(self) -> None:
        """Un indicador o una nota que son una lista se describen, sin TypeError."""
        for campo in ("indicador", "nota"):
            with self.subTest(campo=campo):
                problemas = self.problemas(
                    lambda datos, campo=campo: datos["territorios"][1]["valores"][0].update({campo: ["a"]})
                )
                self.assertTrue(any(problema.startswith("ESP") for problema in problemas))


class LimitesYFormas(unittest.TestCase):
    """El contrato informa entradas defectuosas sin convertirlas ni perder precisión."""

    def test_entero_enorme_se_diagnostica_sin_desbordar(self) -> None:
        """Un entero que desborda el número finito del consumidor se describe sin excepción."""
        for valor in (10**400, -(10**400)):
            with self.subTest(signo=valor > 0):
                datos = contrato_minimo()
                datos["territorios"][1]["valores"][0]["valor"] = valor
                self.assertEqual(problemas_del_contrato(datos), ["ESP · empresas-ia: cifra numérica"])
        datos = contrato_minimo()
        datos["recuentos"] = [recuento(10**400)]
        self.assertTrue(any("valor sin territorio, cifra, año o nota" in p for p in problemas_del_contrato(datos)))

    def test_numeros_finitos_del_consumidor_se_conservan(self) -> None:
        """El mayor float finito, su entero y el decimal actual conservan valor y admisión."""
        limite_finito = math.nextafter(math.inf, 0.0)
        for valor in (limite_finito, int(limite_finito), 20.27):
            with self.subTest(tipo=type(valor).__name__, valor=valor):
                datos = contrato_minimo()
                datos["recuentos"] = [recuento(valor)]
                anterior = copy.deepcopy(datos)
                self.assertEqual(problemas_del_contrato(datos), [])
                self.assertEqual(datos, anterior)

    def test_codigo_no_hashable_se_describe(self) -> None:
        """Un código no textual no puede romper los índices y conjuntos internos."""
        for codigo in (["ESP"], {"codigo": "ESP"}):
            with self.subTest(codigo=codigo):
                datos = contrato_minimo()
                datos["territorios"][1]["codigo"] = codigo
                self.assertTrue(problemas_del_contrato(datos))

    def test_territorio_de_recuento_no_hashable_se_describe(self) -> None:
        """La pertenencia a territorios requiere texto, además de la forma de la cifra."""
        for territorio in (["ESP"], {"codigo": "ESP"}):
            with self.subTest(territorio=territorio):
                datos = contrato_minimo()
                fila = recuento(10.0)
                fila["valores"][0]["territorio"] = territorio
                datos["recuentos"] = [fila]
                self.assertTrue(problemas_del_contrato(datos))

    def test_indicador_catalan_con_id_no_hashable_se_describe(self) -> None:
        """Un id inválido tampoco puede construir el conjunto de cobertura catalana."""
        datos = contrato_minimo()
        datos["indicadores"][0].update(id=["empresas-ia"], cobertura="cataluna", comparable=False)
        self.assertTrue(problemas_del_contrato(datos))

    def test_recuento_sin_unidad_no_rompe_los_indices(self) -> None:
        """El diagnóstico de forma precede a los índices auxiliares del contrato."""
        datos = contrato_minimo()
        fila = recuento(10.0)
        del fila["unidad"]
        datos["recuentos"] = [fila]
        self.assertTrue(problemas_del_contrato(datos))


if __name__ == "__main__":
    unittest.main()
