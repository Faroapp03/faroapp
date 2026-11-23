"""Pruebas de Eurostat por país (mundo_eurostat.py): cada cifra con su marca, la serie y el contraste con el INE."""

import unittest
from typing import Any
from unittest import mock

import plataforma_datos.derivados.fuentes.datos_globales.piezas.constantes_datos_globales as constantes_datos_globales
import plataforma_datos.ia_y_trabajo.comun.tablas_eurostat as tablas_eurostat
import plataforma_datos.ia_y_trabajo.fuentes.mundo_eurostat.lector as mundo_eurostat
import plataforma_datos.mercado.fuentes.empresas.piezas.constantes_empresas as constantes_empresas
from plataforma_datos.comun.nucleo import Controles, FormatoInesperado


def tabla_jsonstat() -> dict[str, Any]:
    """Compone una tabla mínima de Eurostat: un indicador, dos países y dos años.

    Una cifra va marcada como poco fiable («u») y otra, que no se publica, como confidencial («c»).

    Returns:
        Tabla JSON-stat 2.0 con la forma que publica Eurostat.
    """
    return {
        "class": "dataset",
        "id": ["freq", "indic_is", "geo", "time"],
        "size": [1, 1, 2, 2],
        "dimension": {
            "freq": {"category": {"index": {"A": 0}, "label": {"A": "Annual"}}},
            "indic_is": {"category": {"index": {"I_IUAI": 0}, "label": {"I_IUAI": "Use of generative AI tools"}}},
            "geo": {"category": {"index": {"ES": 0, "FR": 1}, "label": {"ES": "Spain", "FR": "France"}}},
            "time": {"category": {"index": {"2024": 0, "2025": 1}, "label": {"2024": "2024", "2025": "2025"}}},
        },
        "value": {"0": 30.0, "1": 37.88, "2": 20.0},
        "status": {"1": "u", "3": "c"},
    }


class PruebaEurostat(unittest.TestCase):
    """Cada cifra de Eurostat con su marca, la serie de cada territorio y las dos bases de la IA generativa."""

    def test_las_dos_bases_de_la_ia_generativa_no_se_mezclan(self) -> None:
        """Cada indicador de IA generativa fija su unidad: toda la población o, con «-usuarios-internet», usuarios."""
        codigos = mundo_eurostat.CODIGOS_DE_CADA_INDICADOR
        self.assertEqual(codigos["personas-ia-generativa"][1]["unit"], "PC_IND")
        self.assertEqual(codigos["personas-ia-generativa-usuarios-internet"][1]["unit"], "PC_IND_IU3")

    def test_cada_celda_con_cifra_o_marca_es_una_fila(self) -> None:
        """Una celda con cifra o con marca (también la confidencial «c») da una fila; las vacías no."""
        filas = tablas_eurostat.filas_de_la_tabla("isoc_ai_iaiu", tabla_jsonstat())
        self.assertEqual(
            [(fila["geo"], fila["anio"], fila["marca"]) for fila in filas],
            [
                ("ES", 2024, None),
                ("ES", 2025, "u"),
                ("FR", 2024, None),
                ("FR", 2025, "c"),
            ],
        )

    def test_la_serie_va_de_la_cifra_mas_reciente_a_la_mas_antigua_y_la_confidencial_no_cuenta(self) -> None:
        """La serie va de la cifra más reciente a la más antigua, cada una con su nota; la confidencial no cuenta."""
        filas = tablas_eurostat.filas_de_la_tabla("isoc_ai_iaiu", tabla_jsonstat())
        for fila in filas:
            fila.update(ind_type="IND_TOTAL", unit="PC_IND")
        espana = mundo_eurostat.serie_del_territorio(filas, "personas-ia-generativa", "ES")
        francia = mundo_eurostat.serie_del_territorio(filas, "personas-ia-generativa", "FR")
        self.assertEqual(
            espana,
            [
                {"valor": 37.88, "anio": 2025, "nota": "poco_fiable"},
                {"valor": 30.0, "anio": 2024, "nota": None},
            ],
        )
        self.assertEqual(francia, [{"valor": 20.0, "anio": 2024, "nota": None}])

    def test_solo_entran_los_paises_la_ue_27_y_cataluna(self) -> None:
        """Solo entran los países, la UE-27 y Cataluña: ni otras regiones ni la zona del euro."""
        codigos = ("ES", "EL", "EU27_2020", "ES51", "ES5", "ES511", "EA", "EA21", "BE10")
        self.assertEqual(
            [codigo for codigo in codigos if mundo_eurostat.es_territorio_del_archivo(codigo)],
            [
                "ES",
                "EL",
                "EU27_2020",
                "ES51",
            ],
        )

    def test_las_etiquetas_son_las_de_los_codigos_sin_frecuencia_paises_ni_anios(self) -> None:
        """Las etiquetas son las de los códigos, sin la frecuencia, los países ni los años."""
        self.assertEqual(
            tablas_eurostat.etiquetas_de_la_tabla(tabla_jsonstat()), {"I_IUAI": "Use of generative AI tools"}
        )

    def test_un_periodo_que_no_es_un_anio_se_rechaza(self) -> None:
        """Una tabla trimestral («2024-Q1») no se lee como si sus periodos fueran años: FormatoInesperado."""
        tabla = tabla_jsonstat()
        tabla["dimension"]["time"]["category"]["index"] = {"2024-Q1": 0, "2025-Q1": 1}
        with self.assertRaisesRegex(FormatoInesperado, "no es un año"):
            tablas_eurostat.filas_de_la_tabla("isoc_ai_iaiu", tabla)

    def test_un_codigo_con_dos_etiquetas_se_rechaza(self) -> None:
        """Si dos dimensiones etiquetan distinto el mismo código, una pisaría a la otra: FormatoInesperado."""

        def dimension(etiqueta: str) -> dict[str, Any]:
            """Una dimensión con el código «T».

            Args:
                etiqueta: Su etiqueta.

            Returns:
                La dimensión JSON-stat.
            """
            return {"category": {"index": ["T"], "label": {"T": etiqueta}}}

        tabla = {"id": ["unit", "sex"], "dimension": {"unit": dimension("Total"), "sex": dimension("Total")}}
        self.assertEqual(tablas_eurostat.etiquetas_de_la_tabla(tabla), {"T": "Total"})
        tabla["dimension"]["sex"] = dimension("Both sexes")
        with self.assertRaisesRegex(FormatoInesperado, "dos etiquetas"):
            tablas_eurostat.etiquetas_de_la_tabla(tabla)


# Un control por publicación del INE: IA generativa (TIC-H), IA para trabajar por clase de trabajo (TIC-H) y empresas
# con IA (ETICCE).
N_CONTROLES_DEL_CONTRASTE = 3


class PruebaContrasteConElIne(unittest.TestCase):
    """Eurostat frente al INE, cada cifra con el año de la del INE, no con la más reciente de la serie."""

    VALIDADOS: dict[str, Any] = {
        "tich": {
            "anio": "2025",
            "espana_grupos": {"manual": {"pct": 7.7}, "no_manual": {"pct": 33.7}, "tic": {"pct": 73.0}},
        },
        "empresas": {"vigencia": {"periodo": "2025-T1"}, "espana": {"total": 21.14}},
    }

    def cifras(self, con_2026: bool = True, con_2025: bool = True) -> dict[str, Any]:
        """Compone la serie de España de cada indicador: 2025 cuadra con el INE; 2026, publicada después, no.

        Args:
            con_2026: si la serie lleva la cifra de 2026.
            con_2025: si la serie lleva la cifra de 2025, el año del INE.

        Returns:
            Cifras de España por indicador, de la más reciente a la más antigua.
        """
        de_2025 = {
            "personas-ia-generativa": 37.88,
            "ia-generativa-trabajo-manual": 7.6,
            "ia-generativa-trabajo-no-manual": 33.8,
            "ia-generativa-trabajo-tic": 73.0,
            "empresas-ia": 20.27,
        }
        return {
            indicador: {
                "ES": ([{"valor": valor + 9, "anio": 2026, "nota": None}] if con_2026 else [])
                + ([{"valor": valor, "anio": 2025, "nota": None}] if con_2025 else [])
            }
            for indicador, valor in de_2025.items()
        }

    def contraste(self, cifras: dict[str, Any]) -> Controles:
        """Ejecuta el contraste con el INE con las cifras dadas y los conjuntos validados de prueba.

        Args:
            cifras: series de Eurostat por indicador y territorio.

        Returns:
            Controles del contraste.
        """
        controles = Controles()
        with mock.patch.object(mundo_eurostat, "leer_validado", side_effect=self.VALIDADOS.__getitem__):
            mundo_eurostat._contraste_con_el_ine(controles, cifras)
        return controles

    def test_con_un_anio_posterior_en_la_serie_se_compara_el_anio_del_ine(self) -> None:
        """Con 2026 delante en la serie, cada control compara 2025 y lo dice en su texto."""
        controles = self.contraste(self.cifras())
        self.assertEqual(controles.fallidos, [])
        self.assertEqual(len(controles.lista), N_CONTROLES_DEL_CONTRASTE)
        self.assertTrue(all(", 2025" in control["control"] for control in controles.lista))

    def test_sin_el_anio_del_ine_en_eurostat_el_contraste_falla(self) -> None:
        """Si Eurostat no trae el año del INE, ningún control pasa por casualidad con otro año."""
        self.assertEqual(len(self.contraste(self.cifras(con_2025=False)).fallidos), N_CONTROLES_DEL_CONTRASTE)

    def test_si_eurostat_aun_no_publica_el_anio_del_ine_el_contraste_queda_pendiente(self) -> None:
        """INE con 2026 y Eurostat solo hasta 2025: el control queda pendiente, sin dar la cifra por cotejada."""
        validados = {
            "tich": {**self.VALIDADOS["tich"], "anio": "2026"},
            "empresas": {"vigencia": {"periodo": "2026-T1"}, "espana": {"total": 33.6}},
        }
        controles = Controles()
        with mock.patch.object(mundo_eurostat, "leer_validado", side_effect=validados.__getitem__):
            mundo_eurostat._contraste_con_el_ine(controles, self.cifras(con_2026=False))
        self.assertEqual(controles.fallidos, [])
        textos = [control["control"] for control in controles.lista]
        self.assertEqual(len(textos), N_CONTROLES_DEL_CONTRASTE)
        self.assertIn(", 2025: Eurostat 37.88 frente al INE", textos[0])
        for texto in textos[1:]:
            self.assertIn(", 2026: Eurostat aún no publica 2026 (su último año es 2025)", texto)
            self.assertIn("queda pendiente", texto)

    def test_una_serie_vacia_no_cuenta_como_aun_sin_publicar(self) -> None:
        """Sin ninguna cifra de España no hay último año: el contraste falla en vez de quedar pendiente."""
        vacias = {indicador: {"ES": []} for indicador in self.cifras()}
        self.assertEqual(len(self.contraste(vacias).fallidos), N_CONTROLES_DEL_CONTRASTE)


class PruebaMarcas(unittest.TestCase):
    """Cada marca de Eurostat tiene un destino declarado, y una marca de varias letras da la nota que le toca."""

    def test_cada_marca_de_eurostat_en_una_sola_lista(self) -> None:
        """Toda marca de la guía de Eurostat está con nota, sin cifra o sin nota, y solo en una de las tres."""
        listas = (
            set(constantes_datos_globales.NOTA_DE_LA_MARCA),
            set(constantes_datos_globales.SIN_CIFRA),
            set(constantes_datos_globales.MARCAS_SIN_NOTA),
        )
        for marca in constantes_empresas.MARCAS_EUROSTAT:
            with self.subTest(marca=marca):
                self.assertEqual(sum(marca in lista for lista in listas), 1)

    def test_nota_de_marcas_compuestas(self) -> None:
        """«bu» no se da como firme; «be», la nota prioritaria; sin marca o revisada, ninguna; otra letra se para."""
        nota = constantes_datos_globales.nota_de_la_marca
        self.assertEqual(nota("bu"), constantes_datos_globales.NOTA_POCO_FIABLE)
        self.assertEqual(nota("be"), "estimada")
        self.assertEqual(nota("s"), "estimada")
        for sin_nota in (None, "", "r"):
            with self.subTest(marca=sin_nota):
                self.assertIsNone(nota(sin_nota))
        with self.assertRaisesRegex(FormatoInesperado, "«x»"):
            nota("bx")

    def test_elision_catalana_en_la_formacion_de_adultos(self) -> None:
        """«Percentatge d'homes», no «de homes»: el catalán elide ante hache."""
        definiciones = {
            indicador["id"]: indicador["definicion"]["ca"]
            for indicador in constantes_datos_globales.INDICADORES_EUROSTAT
            if str(indicador["id"]).startswith("formacion-adultos")
        }
        self.assertTrue(definiciones["formacion-adultos-hombres"].startswith("Percentatge d'homes de 25"))
        self.assertTrue(definiciones["formacion-adultos-mujeres"].startswith("Percentatge de dones de 25"))
        self.assertTrue(definiciones["formacion-adultos"].startswith("Percentatge de persones de 25"))


class PruebaRegresionesEurostat(unittest.TestCase):
    """Entradas defectuosas y marcas compuestas en los recorridos que consumen las cifras."""

    def fila(self, marca: str | None = None, **cambios: object) -> dict[str, Any]:
        """Una cifra de IA generativa con su unidad y territorio.

        Returns:
            La fila preparada.
        """
        return {
            "tabla": "isoc_ai_iaiu",
            "geo": "ES",
            "anio": 2025,
            "valor": 30.0,
            "marca": marca,
            "indic_is": "I_IUAI",
            "ind_type": "IND_TOTAL",
            "unit": "PC_IND",
            **cambios,
        }

    def test_las_marcas_compuestas_llegan_con_su_nota(self) -> None:
        """La serie usa la nota prioritaria de cada marca compuesta y conserva el valor cero."""
        for marca, nota in (("bu", "poco_fiable"), ("be", "estimada"), ("r", None)):
            with self.subTest(marca=marca):
                serie = mundo_eurostat.serie_del_territorio([self.fila(marca, valor=0)], "personas-ia-generativa", "ES")
                self.assertEqual(serie, [{"valor": 0, "anio": 2025, "nota": nota}])

    def test_confidencialidad_y_no_aplicable_dominan_las_marcas_compuestas(self) -> None:
        """Una cifra con c o z no llega a la serie aunque además tenga otras marcas."""
        for marca in ("bc", "cu", "ez", "zc"):
            with self.subTest(marca=marca):
                self.assertEqual(
                    mundo_eurostat.serie_del_territorio([self.fila(marca)], "personas-ia-generativa", "ES"), []
                )

    def test_la_marca_desconocida_detiene_la_serie_y_el_empleo(self) -> None:
        """Una marca no declarada no se interpreta como cifra firme en ninguno de los recorridos."""
        with self.assertRaisesRegex(FormatoInesperado, "«x»"):
            mundo_eurostat.serie_del_territorio([self.fila("bx")], "personas-ia-generativa", "ES")
        with self.assertRaisesRegex(FormatoInesperado, "«x»"):
            mundo_eurostat.empleo_por_grupo([self.fila("bx", tabla=mundo_eurostat.EMPLEO, sex="T", isco08="OC4")])

    def test_el_empleo_excluye_confidencialidad_y_poca_fiabilidad_compuestas(self) -> None:
        """El contraste de ILOSTAT no recibe empleo confidencial ni poco fiable, aunque combinen letras."""
        for marca in ("bu", "bc", "ez", "n"):
            with self.subTest(marca=marca):
                fila = self.fila(marca, tabla=mundo_eurostat.EMPLEO, sex="T", isco08="OC4")
                self.assertEqual(mundo_eurostat.empleo_por_grupo([fila]), {})
        fila = self.fila("b", tabla=mundo_eurostat.EMPLEO, sex="T", isco08="OC4")
        self.assertEqual(mundo_eurostat.empleo_por_grupo([fila]), {"ES": {"2025": {"T": {"4": 30.0}}}})

    def test_un_anio_es_cuatro_cifras_ascii_y_no_cero(self) -> None:
        """Ni cifras Unicode, tres o cinco cifras ni año cero se interpretan como años."""
        for periodo in ("²", "٢٠٢٥", "202", "20255", "0000"):
            with self.subTest(periodo=periodo):
                tabla = tabla_jsonstat()
                tabla["dimension"]["time"]["category"]["index"] = {periodo: 0, "2025": 1}
                with self.assertRaisesRegex(FormatoInesperado, "isoc_ai_iaiu.*no es un año"):
                    tablas_eurostat.filas_de_la_tabla("isoc_ai_iaiu", tabla)

    def test_una_tabla_sin_filas_tiene_diagnostico(self) -> None:
        """Una tabla sin valores ni marcas se rechaza con su identificador."""
        tabla = tabla_jsonstat()
        tabla.update(value={}, status={})
        with self.assertRaisesRegex(FormatoInesperado, "isoc_ai_iaiu.*sin filas"):
            tablas_eurostat.filas_de_la_tabla("isoc_ai_iaiu", tabla)

    def test_fecha_de_actualizacion_erronea_nombra_el_archivo(self) -> None:
        """La preparación diagnostica el original cuya fecha falta, tiene otro tipo o es imposible."""
        for fecha in ("2026-02-30T00:00:00Z", "no-fecha", None, 2026):
            with self.subTest(fecha=fecha):
                tabla = {**tabla_jsonstat(), "updated": fecha}
                with (
                    mock.patch.object(tablas_eurostat, "comprobar_originales"),
                    mock.patch.object(tablas_eurostat, "original"),
                    mock.patch.object(tablas_eurostat, "leer_json", return_value=tabla),
                    mock.patch.object(tablas_eurostat, "guardar_json") as guardar,
                    mock.patch.object(tablas_eurostat, "guardar_jsonl") as guardar_filas,
                ):
                    with self.assertRaisesRegex(FormatoInesperado, "eurostat-isoc_eb_ai.json.*fecha"):
                        mundo_eurostat.preparar()
                    guardar.assert_not_called()
                    guardar_filas.assert_not_called()

    def test_una_etiqueta_de_otra_tabla_no_oculta_una_definicion_cambiada(self) -> None:
        """El control de definiciones revisa cada etiqueta, aunque otro original repita el código correctamente."""
        correcta = dict(mundo_eurostat.ETIQUETAS)
        alterada = {**correcta, "F": "Changed"}
        for etiquetas in ((alterada, correcta), (correcta, alterada)):
            with self.subTest(etiquetas=etiquetas):
                tablas = {str(indice): {"etiquetas": valores} for indice, valores in enumerate(etiquetas)}
                controles = Controles()
                mundo_eurostat._controles(controles, [], tablas)
                self.assertIn(controles.lista[0]["control"], controles.fallidos)
        controles = Controles()
        mundo_eurostat._controles(controles, [], {"una": {"etiquetas": correcta}, "otra": {"etiquetas": correcta}})
        self.assertNotIn(controles.lista[0]["control"], controles.fallidos)

    def test_se_conserva_el_dia_civil_sin_conversion_horaria(self) -> None:
        """Un instante próximo a medianoche conserva la fecha local declarada por Eurostat."""
        self.assertEqual(tablas_eurostat.dia_de_actualizacion("2026-10-11T23:30:00-05:00"), "2026-10-11")


if __name__ == "__main__":
    unittest.main()
