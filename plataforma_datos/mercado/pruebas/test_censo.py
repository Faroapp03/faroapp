"""Reglas del Censo 2021 con datos sintéticos, sin copias ni preparados externos."""

import tempfile
import unittest
from pathlib import Path
from unittest import mock

import plataforma_datos.mercado.fuentes.censo.lector as censo
from plataforma_datos.comun.nucleo import ARCHIVO_DE_PROCEDENCIA, ArchivoFaltante, Controles, FormatoInesperado
from plataforma_datos.mercado.fuentes.censo.piezas.constantes_censo import ESTUDIOS, NACIONALIDAD, SITUACION


class PruebaCenso(unittest.TestCase):
    """Agrupaciones, celdas pequeñas, respuestas y controles sin datos operativos."""

    def test_personas_por_sexo_suma_por_territorio_y_codigo(self) -> None:
        """Hombres, mujeres y total por (territorio, código); la ocupación sin código va a «No consta»."""
        filas = [
            {"T": "08073 Cornellà", "O": "430 - Otros", "ID_SEXO": "Hombre", censo.METRICA: 10.4},
            {"T": "08073 Cornellà", "O": "430 - Otros", "ID_SEXO": "Mujer", censo.METRICA: 5.6},
            {"T": "08073 Cornellà", "O": "No consta", "ID_SEXO": "Mujer", censo.METRICA: 3},
        ]
        personas = censo._personas_por_sexo(filas, ("T", "O"))
        self.assertEqual(personas[("08073 Cornellà", "430")], {"hombres": 10, "mujeres": 6, "total": 16})
        self.assertEqual(personas[("08073 Cornellà", censo.CODIGO_NO_CONSTA)], {"hombres": 0, "mujeres": 3, "total": 3})

    def test_perfil_con_categoria_desconocida_se_detiene(self) -> None:
        """Una categoría que la agrupación no conoce detiene la preparación en lugar de perderse."""
        fila = {"ID_RESIDENCIA_N1": censo.CATALUNA, "ID_ESREAL_CNEDA": "Categoría inventada", "ID_OCU171": "430 - X"}
        with (
            mock.patch.object(censo, "_filas", return_value=[{**fila, censo.METRICA: 4}]),
            self.assertRaisesRegex(FormatoInesperado, "categoría desconocida"),
        ):
            censo._perfil("3")

    def test_control_de_perfiles_falla_si_no_suma_la_referencia(self) -> None:
        """Un perfil que se aleja del censo de Cataluña más que la perturbación incumple el control."""
        perfil = {
            "cno11": "430",
            "nivel": "3",
            **{nombre: {"x": 1000, censo.CIFRAS_SUMADAS: 2} for nombre in censo.NOMBRES_DEL_PERFIL},
        }
        referencia = {"ocupados_cno3": {"430": {"ocupados": 2000}}, "ocupados_cno2": {}}
        controles = Controles()
        censo._controles_perfiles(controles, [perfil], referencia)
        self.assertFalse(controles.admitido)
        referencia["ocupados_cno3"]["430"]["ocupados"] = 1000 + censo.PERTURBACION
        controles = Controles()
        censo._controles_perfiles(controles, [perfil], referencia)
        self.assertTrue(controles.admitido)

    def test_regla_de_las_celdas_pequenas(self) -> None:
        """Una cifra municipal llega con 100 personas; un perfil, con 1.000."""
        self.assertIsNone(censo.cifras_municipales({"total": 99, "mujeres": 60}))
        self.assertEqual(
            censo.cifras_municipales({"total": 100, "mujeres": 50}), {"ocupados": 100, "pct_mujeres": 50.0}
        )
        self.assertEqual(
            censo.cifras_municipales({"total": 200, "mujeres": 150}), {"ocupados": 200, "pct_mujeres": 75.0}
        )
        self.assertIsNone(censo.porcentajes({"fp_grado_medio": 500, "universitarios": 499, "cifras_sumadas": 2}))
        self.assertEqual(
            censo.porcentajes({"fp_grado_medio": 250, "universitarios": 750, "cifras_sumadas": 2}),
            {"fp_grado_medio": 25.0, "universitarios": 75.0},
        )

    def test_categorias_agrupadas_como_se_publican(self) -> None:
        """La FP de grado medio y la de grado superior van por separado; la situación, en sus cuatro grupos."""
        agrupadas = set(ESTUDIOS.values())
        self.assertTrue({"fp_grado_medio", "fp_grado_superior", "bachillerato", "universitarios"} <= agrupadas)
        self.assertEqual(set(SITUACION.values()), {"indefinido", "temporal", "cuenta_propia", "otra"})
        self.assertEqual(set(NACIONALIDAD.values()), {"espanola", "extranjera"})

    def test_el_perfil_de_cataluna_suma_personas_y_no_medias(self) -> None:
        """Dos grupos de tamaño distinto: cada persona pesa lo mismo; «no consta» y los de 3 cifras no cuentan."""

        def grupo(cno11: str, nivel: str, universitarios: int, resto: int) -> dict[str, object]:
            """Compone un perfil preparado con universitarios y bachilleres, todos con contrato indefinido.

            Args:
                cno11: código CNO-11 del grupo.
                nivel: número de cifras del código («2» o «3»).
                universitarios: personas con estudios universitarios.
                resto: personas con bachillerato.

            Returns:
                Perfil preparado del grupo.
            """
            estudios = {"universitarios": universitarios, "bachillerato": resto, "cifras_sumadas": 2}
            situacion = {"indefinido": universitarios + resto, "cifras_sumadas": 1}
            return {"cno11": cno11, "nivel": nivel, "estudios": estudios, "situacion": situacion}

        perfiles = [
            grupo("21", "2", 900, 100),
            grupo("43", "2", 0, 3000),
            grupo(censo.CODIGO_NO_CONSTA, "2", 5000, 0),
            grupo("430", "3", 5000, 0),
        ]
        conjunto = censo.perfil_de_cataluna(perfiles)
        self.assertEqual(conjunto["personas"], 4000)
        self.assertEqual(conjunto["estudios"], {"bachillerato": 77.5, "universitarios": 22.5})
        self.assertEqual(conjunto["situacion"], {"indefinido": 100.0})

    def test_descargar_sin_copias_ni_aceptar_cambio_falla(self) -> None:
        """Sin copias registradas y sin --aceptar-cambio, `descargar` lo dice en lugar de consultar la API."""
        with tempfile.TemporaryDirectory() as temporal:
            sin_copias = Path(temporal) / ARCHIVO_DE_PROCEDENCIA
            with (
                mock.patch.object(censo, "_consultar_api", side_effect=AssertionError("consultó la API")),
                mock.patch.object(censo, "PROCEDENCIA", sin_copias),
                self.assertRaises(ArchivoFaltante),
            ):
                censo.descargar(False)

    def test_respuesta_de_la_api_con_sus_filas(self) -> None:
        """Solo vale un JSON cuyo «data» es una lista no vacía de filas; el texto «"data"» suelto no basta."""
        self.assertTrue(censo.respuesta_con_datos(b'{"metadata": [], "data": [{"SPERSONAS": 3}]}'))
        for mala in (b'{"data": []}', b'{"data": [1]}', b'{"error": "\\"data\\""}', b'{"data": [', b"[]"):
            with self.subTest(respuesta=mala):
                self.assertFalse(censo.respuesta_con_datos(mala))

    def test_contraste_con_el_idescat_sin_cruces(self) -> None:
        """Si ningún municipio del entorno casa con el Idescat, el control falla (sin ValueError de max)."""
        controles = Controles()
        with (
            mock.patch.object(censo, "exigir_admitido"),
            mock.patch.object(censo, "leer_jsonl", return_value=[]),
        ):
            censo._controles_contraste(controles, [])
        self.assertEqual(len(controles.fallidos), 1)
        self.assertIn("diferencia máxima None", controles.lista[0]["control"])

    def test_contraste_de_2021_no_compara_los_nuevos_anios_del_censo_anual(self) -> None:
        """El censo decenal conserva su contraste de 2021 aunque el preparado traiga otros años."""
        municipio = {
            "municipio": "08073",
            "lugar": "residencia",
            "nivel": "2",
            "cno11": "43",
            "hombres": 100,
            "mujeres": 200,
        }
        historica = {"territorio": "08073", "cno11": "43", "anio": "2021", "hombres": 100, "mujeres": 200}
        nueva = {**historica, "anio": "2024", "hombres": 300, "mujeres": 400}
        for filas, admitido in (([historica, nueva], True), ([nueva, historica], True), ([nueva], False)):
            with (
                self.subTest(anios=[fila["anio"] for fila in filas]),
                mock.patch.object(censo, "exigir_admitido"),
                mock.patch.object(censo, "leer_jsonl", return_value=filas),
            ):
                controles = Controles()
                censo._controles_contraste(controles, [municipio])
                self.assertEqual(controles.admitido, admitido)
                self.assertIn("2021; diferencia máxima", controles.lista[0]["control"])

    def test_conjunto_sin_cifras_municipales(self) -> None:
        """Un conjunto sin cifras municipales hace fallar su control en lugar de detener la validación."""
        controles = Controles()
        cataluna = {"estudios": {"universitarios": 100.0}, "situacion": {"indefinido": 100.0}}
        conjunto = {"perfil_cno3": {}, "perfil_cno2": {}, "perfil_cataluna": cataluna}
        censo._controles_del_conjunto(controles, {**conjunto, "municipios": {}})
        self.assertEqual(len(controles.fallidos), 1)
        self.assertIn("ninguna de las 0 cifras municipales", controles.fallidos[0])

    def test_el_recuento_de_cifras_no_suma_como_personas(self) -> None:
        """El perfil de Cataluña no suma el recuento de cifras de cada grupo como si fueran personas."""
        perfiles = [
            {
                "cno11": "11",
                "nivel": "2",
                "estudios": {"universitarios": 900, censo.CIFRAS_SUMADAS: 4},
                "situacion": {},
            },
            {
                "cno11": "12",
                "nivel": "2",
                "estudios": {"universitarios": 300, censo.CIFRAS_SUMADAS: 7},
                "situacion": {},
            },
        ]
        self.assertEqual(censo.perfil_de_cataluna(perfiles)["personas"], 1200)


if __name__ == "__main__":
    unittest.main()
