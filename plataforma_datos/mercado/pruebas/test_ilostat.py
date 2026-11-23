"""Pruebas del empleo por país de ILOSTAT (ilostat.py)."""

import unittest
from typing import Any
from unittest import mock

import plataforma_datos.mercado.fuentes.ilostat.lector as ilostat
from plataforma_datos.comun.nucleo import FormatoInesperado


def fila_csv(pais: str, fuente: str, sexo: str, cifra: tuple[str, str, str], marca: str = "") -> dict[str, str]:
    """Compone una fila del CSV de ILOSTAT con las columnas que se leen.

    Args:
        pais: código ISO alfa-3 del país.
        fuente: código de la encuesta en ILOSTAT («BA:…» para las de fuerza de trabajo).
        sexo: categoría de sexo (SEX_T, SEX_F…).
        cifra: gran grupo ISCO-08 (o TOTAL), año y valor, como texto.
        marca: marca de la observación de ILOSTAT, si la tiene.

    Returns:
        Fila del CSV por nombre de columna.
    """
    grupo, anio, valor = cifra
    return {
        "ref_area": pais,
        "source": fuente,
        "indicator": "EMP_TEMP_SEX_OCU_NB",
        "sex": sexo,
        "classif1": f"OCU_ISCO08_{grupo}",
        "time": anio,
        "obs_value": valor,
        "obs_status": marca,
    }


class PruebaIlostat(unittest.TestCase):
    """Solo encuestas de fuerza de trabajo, el último año con total, y los porcentajes con su nota."""

    def filas(self) -> list[dict[str, str]]:
        """Compone las filas de un país con dos años de encuesta, una estimación modelada más reciente y un censo.

        Returns:
            Filas del CSV de ILOSTAT.
        """
        return [
            fila_csv("ESP", "BA:1", "SEX_T", ("TOTAL", "2024", "100")),
            fila_csv("ESP", "BA:1", "SEX_T", ("TOTAL", "2025", "200")),
            fila_csv("ESP", "BA:1", "SEX_T", ("4", "2025", "50"), "U"),
            fila_csv("ESP", "BA:1", "SEX_T", ("2", "2025", "150")),
            fila_csv("ESP", "BA:1", "SEX_F", ("4", "2025", "35")),
            fila_csv("ESP", "BA:1", "SEX_F", ("2", "2025", "75"), "B"),
            fila_csv("ESP", "XA:9", "SEX_T", ("TOTAL", "2026", "210")),
            fila_csv("ESP", "AA:7", "SEX_T", ("TOTAL", "2026", "205")),
        ]

    def test_se_queda_el_ultimo_anio_de_la_encuesta_de_fuerza_de_trabajo(self) -> None:
        """De cada país se queda el último año con encuesta de fuerza de trabajo, y la fuente de ese año."""
        pais = ilostat.empleo_por_pais(self.filas())["ESP"]
        self.assertEqual((pais["anio"], pais["fuente"], pais["total"]["TOTAL"]), (2025, "BA:1", 200.0))

    def test_los_porcentajes_heredan_la_nota_de_sus_cifras(self) -> None:
        """Un porcentaje lleva la nota (marca de fiabilidad) de las cifras con que se calcula."""
        resultado = ilostat.porcentajes(ilostat.empleo_por_pais(self.filas())["ESP"])
        self.assertEqual(resultado["empleo"]["4"], {"valor": 25.0, "nota": "poco_fiable"})
        self.assertEqual(resultado["mujeres"]["4"], {"valor": 70.0, "nota": "poco_fiable"})
        self.assertEqual(resultado["mujeres"]["2"], {"valor": 50.0, "nota": "ruptura_de_serie"})

    def test_un_pais_cuya_suma_no_da_el_total_se_nombra(self) -> None:
        """Un país cuya suma de grupos no da su total se nombra, con su desviación."""
        pais = {"total": {"TOTAL": 200.0, "4": 50.0, "2": 140.0}}
        self.assertEqual(ilostat._descuadres({"ESP": pais}), {"ESP": 0.05})

    def test_un_anio_o_una_cifra_que_no_lo_son_o_un_total_de_cero_detienen_la_lectura(self) -> None:
        """Ni un ValueError ni una división por cero: FormatoInesperado con el país y lo que se leyó."""
        for cambio, motivo in (
            (("TOTAL", "2025x", "200"), "año «2025x» en ESP"),
            (("TOTAL", "2025", "n/a"), "cifra «n/a» en ESP 2025"),
            (("TOTAL", "2025", "nan"), "cifra nan en ESP 2025"),
            (("TOTAL", "2025", "-1"), "cifra -1.0 en ESP 2025"),
            (("TOTAL", "2025", "0"), "ESP 2025 .* empleo total de 0"),
        ):
            filas = [*self.filas()[:1], fila_csv("ESP", "BA:1", "SEX_T", cambio), *self.filas()[2:]]
            with self.subTest(cambio=cambio), self.assertRaisesRegex(FormatoInesperado, motivo):
                ilostat.empleo_por_pais(filas)

    def test_un_grupo_de_eurostat_con_cero_ocupados_sale_como_apartado(self) -> None:
        """Si Eurostat da 0 en un grupo, el contraste lo aparta en vez de dividir por cero."""
        pais = ilostat.empleo_por_pais(self.filas())["ESP"]
        eurostat = {"empleo_por_grupo": {"ES": {"2025": {ilostat.SEXO_TOTAL_EUROSTAT: {"2": 0.0, "4": 50.0}}}}}
        with mock.patch.object(ilostat, "leer_validado", return_value=eurostat):
            apartados = ilostat._contraste_con_eurostat({"ESP": pais}, {"ES": {"iso3": "ESP"}})
        self.assertEqual(
            apartados,
            {
                "DE": "sin el mismo año en las dos fuentes",
                "ES": "cobertura insuficiente para el contraste: faltan grandes grupos o TOTAL de sexo T",
                "ES:2": (150.0, 0.0),
                "FR": "sin el mismo año en las dos fuentes",
                "IT": "sin el mismo año en las dos fuentes",
            },
        )

    def test_el_preparado_solo_guarda_los_paises_con_encuesta(self) -> None:
        """El preparado guarda solo los países con encuesta de fuerza de trabajo (clave «paises»)."""
        texto = "ref_area,source,indicator,sex,classif1,time,obs_value,obs_status\nESP,BA:1,x,SEX_T,TOTAL,2025,200,\n"
        guardados: list[Any] = []
        with (
            mock.patch.object(ilostat, "comprobar_originales"),
            mock.patch.object(ilostat, "original", return_value=mock.Mock(read_text=lambda **_: texto)),
            mock.patch.object(ilostat, "guardar_json", side_effect=lambda _ruta, datos: guardados.append(datos)),
            mock.patch("builtins.print"),
        ):
            ilostat.preparar()
        self.assertEqual([list(datos) for datos in guardados], [["paises"]])

    def test_un_codigo_propio_de_ilostat_pasa_al_alfa_3_de_su_codigo_de_cldr(self) -> None:
        """Un alfa-3 conocido se queda; KOS pasa por XK al alfa-3 que CLDR le da."""
        territorios_cldr = {"XK": {"iso3": "XKK"}, "ES": {"iso3": "ESP"}}
        self.assertEqual(ilostat._codigo_iso3("ESP", territorios_cldr, {"ESP": "ES"}), "ESP")
        self.assertEqual(ilostat._codigo_iso3("KOS", territorios_cldr, {"ESP": "ES"}), "XKK")

    def test_un_pais_sin_nombre_ni_territorio_hace_fallar_la_validacion_sin_romperla(self) -> None:
        """Un país sin nombre en CLDR da un control fallido en validacion.json; el conjunto no se llega a construir."""
        pais = {
            "anio": 2024,
            "fuente": f"{ilostat.ENCUESTA_DE_FUERZA_DE_TRABAJO}x",
            "fuentes_del_anio": 1,
            "total": {ilostat.TOTAL: 100.0, ilostat.GRUPOS[0]: 100.0},
        }
        leidos = {
            ilostat.EMPLEO: {"paises": {"ZZZ": pais}},
            ilostat.PROCEDENCIA: {"archivos": [{"descargado_utc": "2026-10-11T00:00:00+00:00"}]},
        }
        validados = {"territorios": {"paises": {}}, "mundo-eurostat": {"empleo_por_grupo": {}}}
        cerradas: list[bool] = []
        with (
            mock.patch.object(ilostat, "leer_json", side_effect=leidos.__getitem__),
            mock.patch.object(ilostat, "leer_validado", side_effect=validados.__getitem__),
            mock.patch.object(ilostat, "controles_de_huella"),
            mock.patch.object(
                ilostat,
                "cerrar_validacion",
                side_effect=lambda _f, _i, controles, _c: cerradas.append(controles.admitido),
            ),
        ):
            ilostat.validar()
        self.assertEqual(cerradas, [False])


class PruebaRegresionesIlostat(unittest.TestCase):
    """Entradas defectuosas se detienen antes de publicar porcentajes."""

    def test_fila_csv_corta_nombra_linea_pais_y_columnas(self) -> None:
        """DictReader no deja pasar valores None como si fueran texto."""
        cabecera = ",".join(ilostat.COLUMNAS) + "\n"
        for valores, columnas in (("ESP", "source"), ("ESP,BA:1,x,SEX_T,OCU_ISCO08_TOTAL,2025,100", "obs_status")):
            with (
                self.subTest(valores=valores),
                self.assertRaisesRegex(FormatoInesperado, f"ILOSTAT: fila 2.*ESP.*{columnas}"),
            ):
                ilostat.empleo_por_pais(ilostat.filas_del_csv(cabecera + valores + "\n"))

    def test_fila_csv_con_valores_sobrantes_se_detiene(self) -> None:
        """Una coma adicional no se descarta sin diagnóstico."""
        texto = ",".join(ilostat.COLUMNAS) + "\nESP,BA:1,x,SEX_T,OCU_ISCO08_TOTAL,2025,100,,sobra\n"
        with self.assertRaisesRegex(FormatoInesperado, "ILOSTAT: fila 2.*ESP.*sobrantes"):
            ilostat.filas_del_csv(texto)

    def test_porcentajes_heredan_marcas_compuestas_de_numerador_y_denominador(self) -> None:
        """La fiabilidad prevalece también en una marca compuesta de cualquiera de las bases."""
        pais = ilostat.empleo_por_pais(PruebaIlostat().filas())["ESP"]
        pais["marcas"] = {"total:TOTAL": "BU", "total:4": "B", "mujeres:4": "BU"}
        cifras = ilostat.porcentajes(pais)
        self.assertEqual(cifras["empleo"]["4"], {"valor": 25.0, "nota": "poco_fiable"})
        self.assertEqual(cifras["mujeres"]["4"], {"valor": 70.0, "nota": "poco_fiable"})

    def test_marcas_desconocidas_o_confidenciales_no_se_publican_como_firmes(self) -> None:
        """No se pierde una marca desconocida ni la confidencialidad en una combinación."""
        for marca in ("?", "U?", "c", "Uc", "z"):
            pais = ilostat.empleo_por_pais(PruebaIlostat().filas())["ESP"]
            pais["marcas"]["total:4"] = marca
            with self.subTest(marca=marca), self.assertRaises(FormatoInesperado):
                ilostat.porcentajes(pais)

    def test_mujeres_no_pueden_superar_el_total_ni_con_total_cero(self) -> None:
        """Una parte mayor que su denominador se detiene sin truncarla a 100."""
        for total, mujeres in ((50.0, 50.1), (0.0, 1.0)):
            pais = ilostat.empleo_por_pais(PruebaIlostat().filas())["ESP"]
            pais["total"]["4"], pais["mujeres"]["4"] = total, mujeres
            with self.subTest(total=total), self.assertRaisesRegex(FormatoInesperado, "ILOSTAT:.*mujeres.*grupo 4"):
                ilostat.porcentajes(pais)

    def test_un_grupo_no_supera_el_empleo_total_aunque_la_suma_entre_en_tolerancia(self) -> None:
        """El margen de la suma no admite un peso del grupo superior a 100 %."""
        pais = {"total": {"TOTAL": 100.0, "4": 100.5}, "mujeres": {}, "marcas": {}}
        self.assertEqual(ilostat._descuadres({"ESP": pais}), {})
        with self.assertRaisesRegex(FormatoInesperado, "ILOSTAT: porcentaje"):
            ilostat.porcentajes(pais)

    def test_el_desbordamiento_de_un_porcentaje_tiene_diagnostico(self) -> None:
        """Cifras finitas no bastan si la multiplicación del porcentaje deja de ser finita."""
        pais = {"total": {"TOTAL": 1e308, "4": 1e308}, "mujeres": {}, "marcas": {}}
        with self.assertRaisesRegex(FormatoInesperado, "ILOSTAT: porcentaje.*no finito"):
            ilostat.porcentajes(pais)

    def test_denominador_del_pais_defectuoso_tiene_diagnostico(self) -> None:
        """Un preparado con total nulo o no finito no provoca ZeroDivisionError."""
        for total in (0.0, float("nan"), float("inf")):
            with self.subTest(total=total), self.assertRaisesRegex(FormatoInesperado, "ILOSTAT:.*ESP.*total"):
                ilostat._descuadres({"ESP": {"total": {"TOTAL": total, "4": 1.0}}})

    def test_cero_mujeres_es_cifra_y_un_grupo_vacio_no_tiene_porcentaje_de_mujeres(self) -> None:
        """Distingue el cero medido de un cociente que no tiene denominador."""
        pais = ilostat.empleo_por_pais(PruebaIlostat().filas())["ESP"]
        pais["mujeres"]["4"] = 0.0
        self.assertEqual(ilostat.porcentajes(pais)["mujeres"]["4"]["valor"], 0.0)
        pais["total"]["4"] = 0.0
        self.assertEqual(ilostat.porcentajes(pais)["empleo"]["4"]["valor"], 0.0)
        self.assertNotIn("4", ilostat.porcentajes(pais)["mujeres"])


if __name__ == "__main__":
    unittest.main()
