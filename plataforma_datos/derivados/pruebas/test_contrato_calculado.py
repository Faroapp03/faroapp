"""Pruebas del contrato del bloque calculado y sus entradas defectuosas."""

import copy
import unittest
from collections.abc import Callable
from typing import Any

import plataforma_datos.derivados.fuentes.datos_globales.piezas.catalogo_calculado as catalogo_calculado
import plataforma_datos.derivados.pruebas.test_contrato_datos_globales as base
from plataforma_datos.derivados.fuentes.datos_globales.piezas.contrato_datos_globales import problemas_del_contrato


def calculado() -> dict[str, Any]:
    """Un indicador calculado que cumple el contrato: una cifra de España y unas cotas de Chile.

    Returns:
        El indicador, que cumple el contrato.
    """
    return {
        **catalogo_calculado.INDICADORES_CALCULADOS["exposicion-alta"][1],
        "valores": [
            {
                "territorio": "CHL",
                "nombre": {"es": "Chile", "ca": "Xile"},
                "valor": None,
                "intervalo": {"desde": 2.311, "hasta": 3.428, "metodo": "linealizacion_taylor"},
                "cotas": {
                    "inferior": 2.485,
                    "superior": 3.254,
                    "motivo": "sin_correspondencia_4_digitos",
                    "parte_sin_correspondencia": 10.955,
                },
                "anio": 2022,
                "encuesta": "Encuesta Casen 2022",
                "licencia": "CC BY 4.0",
                "cita": "Ministerio de Desarrollo Social y Familia, Encuesta Casen 2022",
                "url": "https://bid-ckan.ministeriodesarrollosocial.gob.cl",
            },
            {
                "territorio": "ESP",
                "nombre": {"es": "España", "ca": "Espanya"},
                "valor": 4.983,
                "intervalo": {"desde": 4.837, "hasta": 5.128, "metodo": "replicas_bootstrap"},
                "cotas": None,
                "anio": 2026,
                "encuesta": "Encuesta de prueba",
                "licencia": "Citar la fuente.",
                "cita": "Fuente: prueba",
                "url": "https://example.org/encuesta",
            },
        ],
    }


class PruebasContratoDeLoCalculado(unittest.TestCase):
    """Cada regla de «calculado», con un caso que la cumple y otro que la rompe."""

    def roto(self, cambio: Callable[[dict[str, Any]], object]) -> list[str]:
        """Los problemas del contrato mínimo con un indicador calculado, tras aplicarle un cambio.

        Returns:
            Los problemas hallados; vacía si el contrato aún se cumple.
        """
        datos = {**base.contrato_minimo(), "calculados": [calculado()]}
        cambio(datos["calculados"][0])
        return problemas_del_contrato(datos)

    def falla(self, cambio: Callable[[dict[str, Any]], object], regla: str) -> None:
        """Que el cambio rompa justo esa regla del contrato (no otra, como una clave de más en el archivo)."""
        problemas = self.roto(cambio)
        self.assertTrue(any(regla in problema for problema in problemas), problemas)

    def test_el_calculado_se_cumple(self) -> None:
        """Un valor con cifra e intervalo y otro con cotas y su motivo cumplen el contrato."""
        self.assertEqual(self.roto(lambda _calculado: None), [])

    def test_sin_metodo_del_intervalo_no_pasa(self) -> None:
        """Un intervalo sin método, o con uno que no es del vocabulario, no pasa."""
        self.falla(lambda calc: calc["valores"][1]["intervalo"].pop("metodo"), "intervalo del 95 % con su método")
        self.falla(
            lambda calc: calc["valores"][1]["intervalo"].update(metodo="a ojo"), "intervalo del 95 % con su método"
        )

    def test_un_intervalo_fuera_de_0_a_100_o_invertido_no_pasa(self) -> None:
        """El intervalo va dentro de [0, 100], de menor a mayor, y la cifra cae dentro."""
        self.falla(
            lambda calc: calc["valores"][1]["intervalo"].update(hasta=100.5),
            "intervalo dentro de [0, 100] y no invertido",
        )
        self.falla(
            lambda calc: calc["valores"][1]["intervalo"].update(desde=-0.1),
            "intervalo dentro de [0, 100] y no invertido",
        )
        self.falla(
            lambda calc: calc["valores"][1]["intervalo"].update(desde=5.2, hasta=4.8),
            "intervalo dentro de [0, 100] y no invertido",
        )
        self.falla(
            lambda calc: calc["valores"][1].update(valor=6.0),
            "una cifra dentro de su intervalo y sin cotas, o null con sus cotas",
        )

    def test_unas_cotas_invertidas_o_fuera_del_intervalo_no_pasan(self) -> None:
        """Cotas de menor a mayor, dentro del intervalo, con su motivo y la parte del empleo sin correspondencia."""
        self.falla(
            lambda calc: calc["valores"][0]["cotas"].update(inferior=3.3, superior=2.5),
            "una cifra dentro de su intervalo y sin cotas, o null con sus cotas",
        )
        self.falla(
            lambda calc: calc["valores"][0]["cotas"].update(superior=3.5),
            "una cifra dentro de su intervalo y sin cotas, o null con sus cotas",
        )
        self.falla(
            lambda calc: calc["valores"][0]["cotas"].update(motivo="otro"),
            "una cifra dentro de su intervalo y sin cotas, o null con sus cotas",
        )
        self.falla(
            lambda calc: calc["valores"][0]["cotas"].update(parte_sin_correspondencia=0),
            "una cifra dentro de su intervalo y sin cotas, o null con sus cotas",
        )

    def test_o_cifra_o_cotas(self) -> None:
        """Una cifra no lleva cotas; sin cifra, las cotas son obligatorias."""
        self.falla(
            lambda calc: calc["valores"][0].update(valor=3.0),
            "una cifra dentro de su intervalo y sin cotas, o null con sus cotas",
        )
        self.falla(
            lambda calc: calc["valores"][0].update(cotas=None),
            "una cifra dentro de su intervalo y sin cotas, o null con sus cotas",
        )

    def test_sin_cita_licencia_o_encuesta_no_pasa(self) -> None:
        """Cada cifra lleva su encuesta, su licencia y su cita."""
        for campo in ("cita", "licencia", "encuesta"):
            with self.subTest(campo=campo):
                self.falla(
                    lambda calc, campo=campo: calc["valores"][1].update({campo: ""}), "encuesta, licencia y cita"
                )
        self.falla(lambda calc: calc["valores"][1].pop("cita"), "valor calculado con otras claves")

    def test_la_naturaleza_es_calculado_y_el_nombre_el_de_territorios(self) -> None:
        """Un calculado «medido» no pasa; el nombre de un país que está en «territorios» es el mismo."""
        self.falla(lambda calc: calc.update(naturaleza="medido"), "naturaleza «calculado»")
        self.falla(
            lambda calc: calc["valores"][1].update(nombre={"es": "Spain", "ca": "Espanya"}), "no es el de «territorios»"
        )
        self.falla(lambda calc: calc["valores"].append(copy.deepcopy(calc["valores"][1])), "un país con dos cifras")
        self.falla(lambda calc: calc.update(id="empresas-ia"), "un calculado repite el id")

    def test_una_cifra_de_un_anio_posterior_al_del_archivo_no_pasa(self) -> None:
        """Una cifra calculada de un año posterior al de «generado» no pasa."""
        self.falla(lambda calc: calc["valores"][1].update(anio=2027), "cifras de un año posterior")


class FormasCalculadas(unittest.TestCase):
    """Los campos usados como claves o números se comprueban antes de indexar."""

    def test_metodo_no_hashable_se_describe(self) -> None:
        """Un método en lista no debe lanzar TypeError en el vocabulario."""
        for metodo in (["linealizacion_taylor"], {"metodo": "linealizacion_taylor"}):
            with self.subTest(metodo=metodo):
                fila = calculado()
                fila["valores"][1]["intervalo"]["metodo"] = metodo
                datos = {**base.contrato_minimo(), "calculados": [fila]}
                self.assertTrue(any("intervalo del 95 % con su método" in p for p in problemas_del_contrato(datos)))

    def test_territorio_no_hashable_se_describe(self) -> None:
        """Un territorio no textual no rompe duplicados ni la comparación de nombres."""
        for territorio in (["ESP"], {"codigo": "ESP"}):
            with self.subTest(territorio=territorio):
                fila = calculado()
                fila["valores"][1]["territorio"] = territorio
                datos = {**base.contrato_minimo(), "calculados": [fila]}
                self.assertTrue(any("país por su ISO" in p for p in problemas_del_contrato(datos)))

    def test_intervalo_entero_enorme_no_se_convierte_a_float(self) -> None:
        """El intervalo enorme da el diagnóstico de rango, sin OverflowError ni tope inventado."""
        fila = calculado()
        fila["valores"][1]["intervalo"]["hasta"] = 10**400
        datos = {**base.contrato_minimo(), "calculados": [fila]}
        self.assertTrue(any("intervalo dentro de [0, 100]" in p for p in problemas_del_contrato(datos)))


if __name__ == "__main__":
    unittest.main()
