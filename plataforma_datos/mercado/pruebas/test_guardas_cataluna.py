"""Los meses y las bases ausentes de Cataluña se rechazan sin fabricar cifras."""

import json
import unittest
from unittest import mock

import plataforma_datos.mercado.fuentes.cataluna.lector as cataluna
import plataforma_datos.mercado.fuentes.cataluna.piezas.controles_cataluna as controles_cataluna
from plataforma_datos.comun.nucleo import ERROR, Controles, FormatoInesperado


class PruebaGuardasCataluna(unittest.TestCase):
    """Entradas sintéticas defectuosas y fronteras de los contratos existentes."""

    def test_la_copia_archivada_rechaza_mes_cero_o_trece(self) -> None:
        """Una fecha inválida registrada no se toma como la copia vigente ni se omite en silencio."""
        for periodo in ("2026-00", "2026-13"):
            procedencia = {
                "archivos": [
                    {"archivo": cataluna.OBSERVATORI.format(cataluna.TABLA_CONTRATACION, p)}
                    for p in ("2026-06", periodo)
                ]
            }
            with (
                self.subTest(periodo=periodo),
                mock.patch.object(cataluna, "procedencia", return_value=procedencia),
                self.assertRaises(FormatoInesperado),
            ):
                cataluna.periodo_archivado()

    def test_los_meses_validos_conservan_la_seleccion(self) -> None:
        """Enero y diciembre siguen aceptados y se selecciona la copia más reciente."""
        procedencia = {
            "archivos": [
                {"archivo": cataluna.OBSERVATORI.format(cataluna.TABLA_CONTRATACION, p)} for p in ("2026-12", "2026-01")
            ]
        }
        with mock.patch.object(cataluna, "procedencia", return_value=procedencia):
            self.assertEqual(cataluna.periodo_archivado(), "2026-12")

    def test_variacion_conserva_tipo_y_serializacion_del_cero(self) -> None:
        """La variación conserva cero entero, cero decimal y ausencia al serializar la fila."""
        base = {
            "c_grup_primari": "1111",
            "d_grup_primari_cno11": "x",
            "c_mes": "202606",
            "eo_cont_sum_12m": 500,
            "eo_perc_indef_tot_cont": None,
            "eo_dno_mitj": None,
            "eo_per_cont_com_anual": 300,
        }
        for variacion, tipo, serializado in ((0, int, "0"), (0.0, float, "0.0"), (None, type(None), "null")):
            with self.subTest(variacion=variacion, tipo=tipo):
                fila = cataluna._contratacion({**base, "eo_per_cont_var_anual": variacion}, {}, {})
                self.assertIs(type(fila["variacion_pct"]), tipo)
                self.assertEqual(json.dumps(fila["variacion_pct"]), serializado)
        self.assertIs(type(cataluna._pct_de_fraccion(0)), float)

    def test_variacion_sin_base_no_inventa_cifra(self) -> None:
        """Sin filas con dato en ambos años no se devuelve una variación inventada."""
        for filas in ([], [{"personas_contratadas": None, "personas_contratadas_anterior": 0}]):
            with self.subTest(filas=filas), self.assertRaises(FormatoInesperado):
                cataluna._variacion_conjunto(filas)

    def test_preparar_falla_antes_de_guardar_contexto_sin_base(self) -> None:
        """La falta de base impide guardar CONTEXTO; no presupone transacción de preparados previos."""
        with (
            mock.patch.object(cataluna, "leer_validado", return_value={"cno11": {}}),
            mock.patch.object(cataluna, "_preparar_censo", return_value=({}, {})),
            mock.patch.object(cataluna, "periodo_archivado", return_value="2026-06"),
            mock.patch.object(cataluna, "_preparar_contratacion", return_value=[]),
            mock.patch.object(cataluna, "guardar_json") as guardar,
            self.assertRaises(FormatoInesperado),
        ):
            cataluna.preparar()
        guardar.assert_not_called()

    def test_conjunto_sin_porcentajes_registra_fallo(self) -> None:
        """Tanto sin grupos como con un grupo cuyos porcentajes son todos None, el control falla."""
        fila = {"ocupados": 100, "pct_mujeres": None, "pct_menores_30": None, "pct_55_o_mas": None}
        for grupos in ({}, {"11": fila}):
            contexto = {"conjunto_censo": {**fila, "ocupados": sum(f["ocupados"] for f in grupos.values())}}
            controles = Controles()
            with self.subTest(grupos=grupos):
                controles_cataluna.controles_conjunto_censo(controles, grupos, contexto)
                self.assertEqual(len(controles.lista), 1)
                self.assertEqual(controles.lista[0]["resultado"], ERROR)

    def test_total_observatori_cero_registra_fallo(self) -> None:
        """El control de totales no divide por cero ni admite una contratación vacía."""
        controles = Controles()
        controles_cataluna.controles_totales_observatori(controles, {}, {"personas_contratadas_total": 0})
        self.assertEqual(len(controles.lista), 2)
        self.assertEqual(controles.lista[0]["resultado"], ERROR)
        self.assertFalse(controles.admitido)

    def test_porcentajes_con_dato_mantienen_limites(self) -> None:
        """Cero y cien se admiten, None no aporta dato y los valores que salen del total se rechazan."""
        for valor, esperado in ((0, True), (100, True), (None, True), (-0.1, False), (100.1, False)):
            with self.subTest(valor=valor):
                self.assertEqual(controles_cataluna.porcentajes_validos([{"p": valor}], ("p",)), esperado)


if __name__ == "__main__":
    unittest.main()
