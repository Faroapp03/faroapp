"""Las revisiones y años nuevos de ILOSTAT conservan la metodología y el contraste anual."""

import datetime
import unittest
from unittest import mock

import plataforma_datos.mercado.fuentes.ilostat.lector as ilostat
from plataforma_datos.comun.nucleo import FormatoInesperado
from plataforma_datos.mercado.pruebas.test_ilostat import fila_csv


def encuesta(anio: str, valor: str = "100", fuente: str = "BA:1") -> list[dict[str, str]]:
    """Una encuesta con total y un grupo que suma todo el empleo.

    Returns:
        Filas anuales del país de prueba.
    """
    return [
        fila_csv("ESP", fuente, "SEX_T", (grupo, anio, valor if grupo in ("TOTAL", "4") else "0"))
        for grupo in ("TOTAL", "4", *(grupo for grupo in ilostat.GRUPOS_CON_PORCENTAJE if grupo != "4"))
    ]


def empleo_europeo(valor: float = 100.0) -> dict[str, dict[str, float]]:
    """El mismo reparto, con todos los grupos y TOTAL firmes de Eurostat.

    Returns:
        Empleo total por gran grupo.
    """
    return {
        "T": {grupo: valor if grupo in ("TOTAL", "4") else 0.0 for grupo in (*ilostat.GRUPOS_CON_PORCENTAJE, "TOTAL")}
    }


class PruebaIlostatActualizable(unittest.TestCase):
    """No mezcla métodos, acepta revisiones inequívocas y compara el último año común."""

    def test_nuevo_anio_y_revision_sustituyen_la_cifra_anterior(self) -> None:
        """El punto de acceso abierto admite un año posterior y una revisión sin fijar su valor."""
        filas = encuesta("2024") + encuesta("2025", "110")
        pais = ilostat.empleo_por_pais(filas)["ESP"]
        self.assertEqual((pais["anio"], pais["total"]["TOTAL"]), (2025, 110.0))
        self.assertIn("timefrom=2016", ilostat.ARCHIVOS[0]["url"])
        self.assertNotIn("timeto=", ilostat.ARCHIVOS[0]["url"])

    def test_duplicados_no_se_resuelven_por_orden_de_fila(self) -> None:
        """Ni un duplicado idéntico ni una revisión mezclada sobreescriben otra observación."""
        for valor in ("100", "101"):
            for marca in ("", "U"):
                duplicada = fila_csv("ESP", "BA:1", "SEX_T", ("4", "2025", valor), marca)
                with self.subTest(valor=valor, marca=marca), self.assertRaisesRegex(FormatoInesperado, "duplicad"):
                    ilostat.empleo_por_pais(encuesta("2025") + [duplicada])

    def test_no_acepta_otro_indicador_o_grupos_isco_ajenos(self) -> None:
        """El total de otro indicador o una categoría nueva requieren revisión explícita."""
        for campo, valor in (("indicator", "EMP_TEMP_SEX_OCU_RT"), ("classif1", "OCU_ISCO08_42")):
            filas = encuesta("2025")
            filas[-1][campo] = valor
            with self.subTest(campo=campo), self.assertRaisesRegex(FormatoInesperado, campo):
                ilostat.empleo_por_pais(filas)

    def test_periodo_anual_canonico_y_dentro_del_intervalo(self) -> None:
        """No trata un trimestre, un entero decorado o un año imposible como dato anual."""
        futuro = str(datetime.datetime.now(datetime.UTC).year + 1)
        for anio in ("2025-Q1", "+2025", "2_025", "02025", "٢٠٢٥", "2015", futuro):
            with self.subTest(anio=anio), self.assertRaisesRegex(FormatoInesperado, "año"):
                ilostat.empleo_por_pais(encuesta(anio))

    def test_cabeceras_duplicadas_no_ocultan_dimensiones(self) -> None:
        """DictReader no puede elegir silenciosamente la última columna repetida."""
        texto = ",".join((*ilostat.COLUMNAS, "indicator")) + "\n"
        with self.assertRaisesRegex(FormatoInesperado, "columnas.*duplicad"):
            ilostat.filas_del_csv(texto)

    def contraste(
        self, filas: list[dict[str, str]], europa: dict[str, dict[str, dict[str, float]]]
    ) -> dict[str, object]:
        """Contrasta una captura local verificada sin escribirla ni consultar la red.

        Returns:
            Discrepancias encontradas en el último año común.
        """
        texto = ",".join(ilostat.COLUMNAS) + "\n"
        texto += "\n".join(",".join(fila[columna] for columna in ilostat.COLUMNAS) for fila in filas)
        paises = ilostat.empleo_por_pais(filas)
        with (
            mock.patch.object(ilostat, "PAISES_DEL_CONTRASTE", ("ES",), create=True),
            mock.patch.object(ilostat, "leer_validado", return_value={"empleo_por_grupo": {"ES": europa}}),
            mock.patch.object(ilostat, "original", return_value=mock.Mock(read_text=lambda **_: texto)),
        ):
            return ilostat._contraste_con_eurostat(paises, {"ES": {"iso3": "ESP"}})

    def test_ilo_adelantado_contrasta_ultimo_comun_y_conserva_ultimo_dato(self) -> None:
        """Un desfase de publicación no impide usar la nueva cifra de la misma metodología."""
        filas = encuesta("2024") + encuesta("2025", "110")
        self.assertEqual(self.contraste(filas, {"2024": empleo_europeo()}), {})
        self.assertEqual(ilostat.empleo_por_pais(filas)["ESP"]["anio"], 2025)

    def test_eurostat_adelantado_contrasta_el_anio_de_ilo(self) -> None:
        """El año más reciente de Eurostat no se compara con una cifra anterior de ILOSTAT."""
        self.assertEqual(
            self.contraste(encuesta("2024"), {"2024": empleo_europeo(), "2025": empleo_europeo(120.0)}),
            {},
        )

    def test_desfase_no_oculta_incoherencia_ni_ausencia_del_anio_comun(self) -> None:
        """Buscar un año común mantiene la tolerancia y exige encontrar uno."""
        filas = encuesta("2024") + encuesta("2025", "110")
        europeo = empleo_europeo()
        europeo["T"]["4"] = 90.0
        self.assertEqual(self.contraste(filas, {"2024": europeo}), {"ES:4": (100.0, 90.0)})
        self.assertEqual(
            self.contraste(filas, {"2023": empleo_europeo()}),
            {"ES": "sin el mismo año en las dos fuentes"},
        )

    def test_anio_comun_ambiguo_o_descuadrado_no_respalda_un_anio_nuevo(self) -> None:
        """La evidencia histórica del contraste conserva controles de encuesta y suma."""
        ambiguas = encuesta("2024") + encuesta("2024", fuente="BA:2") + encuesta("2025")
        descuadradas = encuesta("2024") + encuesta("2025")
        descuadradas[1]["obs_value"] = "90"
        for filas in (ambiguas, descuadradas):
            with self.subTest(filas=filas):
                self.assertIn("ES", self.contraste(filas, {"2024": empleo_europeo()}))

    def test_contraste_exige_los_cuatro_paises_aunque_no_llegue_ninguno(self) -> None:
        """Una tabla ausente no produce una comprobación vacía admitida."""
        with mock.patch.object(ilostat, "leer_validado", return_value={"empleo_por_grupo": {}}):
            apartados = ilostat._contraste_con_eurostat({}, {})
        self.assertEqual(set(apartados), {"DE", "ES", "FR", "IT"})

    def test_grupos_totales_ausentes_no_son_un_contraste_completo(self) -> None:
        """La pérdida de un grupo, todos o sexo T requiere revisión explícita."""
        incompleto = empleo_europeo()
        del incompleto["T"]["0"]
        for europeo in (incompleto, {"T": {}}, {"F": empleo_europeo()["T"]}):
            with self.subTest(europeo=europeo):
                self.assertIn("cobertura insuficiente", self.contraste(encuesta("2025"), {"2025": europeo})["ES"])

    def test_cero_en_ambas_fuentes_es_igualdad_y_no_divide_por_cero(self) -> None:
        """Una categoría sin ocupados en ambas encuestas sigue siendo contrastable."""
        self.assertEqual(self.contraste(encuesta("2025"), {"2025": empleo_europeo()}), {})

    def test_no_retrocede_a_un_comun_anterior_para_ocultar_una_revision_incoherente(self) -> None:
        """Con varios años compartidos, contrasta el más reciente aunque uno anterior cuadre."""
        filas = encuesta("2023") + encuesta("2024", "110") + encuesta("2025", "120")
        apartados = self.contraste(filas, {"2023": empleo_europeo(), "2024": empleo_europeo()})
        self.assertEqual(apartados, {"ES:TOTAL": (110.0, 100.0), "ES:4": (110.0, 100.0)})

    def test_marcas_del_historico_consumido_tambien_se_validan(self) -> None:
        """El contraste no consume como firmes marcas desconocidas o confidenciales de otro año."""
        for grupo in ("TOTAL", "4"):
            for marca in ("?", "c", "Uc"):
                filas = encuesta("2024") + encuesta("2025", "110")
                next(fila for fila in filas if fila["classif1"] == f"OCU_ISCO08_{grupo}")["obs_status"] = marca
                with self.subTest(grupo=grupo, marca=marca), self.assertRaises(FormatoInesperado):
                    self.contraste(filas, {"2024": empleo_europeo()})


if __name__ == "__main__":
    unittest.main()
