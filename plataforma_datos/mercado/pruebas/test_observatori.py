"""Pruebas de los ficheros del Observatori por comarca y en series (observatori.py) y del periodo de cataluna.py.

Cubren la regla de las cifras, el periodo que sale del propio fichero y la descarga que se detiene ante uno nuevo,
con red simulada. Los indicadores, la metodología y el conjunto usan ejemplos pequeños autónomos.
"""

import io
import json
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any
from unittest import mock

import plataforma_datos.mercado.fuentes.cataluna.lector as cataluna
import plataforma_datos.mercado.fuentes.observatori.lector as observatori
import plataforma_datos.mercado.fuentes.observatori.piezas.conjunto_observatori as conjunto_observatori
import plataforma_datos.mercado.fuentes.observatori.piezas.constantes_observatori as constantes_observatori
import plataforma_datos.mercado.fuentes.observatori.piezas.preparar_observatori as preparar_observatori
from plataforma_datos.comun import periodos
from plataforma_datos.comun.entrada_salida import guardar_json, leer_jsonl
from plataforma_datos.comun.nucleo import Controles, Descarga, FormatoInesperado, OriginalCambiado
from plataforma_datos.mercado.pruebas.ayuda_textos_sin_fecha import fechas_esperadas


def respuesta(items: list[dict[str, object]]) -> Descarga:
    """Compone una respuesta del visor con esas filas.

    Args:
        items: filas del visor, como las devuelve su API.

    Returns:
        Descarga simulada en JSON.
    """
    return Descarga(json.dumps({"items": items}).encode(), "https://visor", "application/json")


class PruebaPeriodo(unittest.TestCase):
    """El periodo sale del fichero; una edición nueva del Observatori se detecta."""

    def test_periodo_en_castellano(self) -> None:
        """«juny de 2026» es «12 meses a junio de 2026»; un mes desconocido no se interpreta."""
        self.assertEqual(cataluna.periodo_en_castellano("juny de 2026"), "12 meses a junio de 2026")
        self.assertEqual(cataluna.periodo_en_castellano("setembre de 2026"), "12 meses a septiembre de 2026")
        with self.assertRaises(FormatoInesperado):
            cataluna.periodo_en_castellano("junio de 2026")

    def test_la_cita_del_observatori_es_la_del_paquete(self) -> None:
        """La cita sintética conserva el periodo del fichero y la actualización de su procedencia."""
        entrada = {"archivo": "observatori-C_P2_MES_IND-2026-06.json", "version": "actualització del 20/07/2026"}
        with (
            mock.patch.object(cataluna, "periodo_archivado", return_value="2026-06"),
            mock.patch.object(cataluna, "_items", return_value=[{"d_periode": "juny de 2026"}]),
            mock.patch.object(cataluna, "procedencia", return_value={"archivos": [entrada]}),
        ):
            self.assertIn("juny de 2026", cataluna.fuentes()["observatori"])
            self.assertIn("20/07/2026", cataluna.fuentes()["observatori"])

    def test_el_periodo_es_el_de_la_copia_mas_reciente(self) -> None:
        """Con varias copias registradas, manda la de mes más reciente."""
        archivos = [
            "observatori-C_P2_MES_IND-2026-03.json",
            "observatori-C_P2_MES_IND-2026-06.json",
            "ine-censo2021-ocu3-sexo.json",
        ]
        registradas = {"archivos": [{"archivo": archivo} for archivo in archivos]}
        with mock.patch.object(cataluna, "procedencia", return_value=registradas):
            self.assertEqual(cataluna.periodo_archivado(), "2026-06")

    def test_un_fichero_de_otro_periodo_detiene_la_descarga(self) -> None:
        """Si el visor ya trae otro mes, el fichero no se guarda: primero se registra la copia de cataluna.py."""
        archivo = observatori.archivos("2026-06")[0]
        otro = respuesta([{"c_mes": 202609}])
        with (
            mock.patch.object(observatori, "descargar_url", return_value=otro),
            mock.patch.object(observatori, "conservar_o_sustituir") as conservar,
            self.assertRaises(OriginalCambiado),
        ):
            observatori._descargar_uno(archivo, "2026-06", previo=None, aceptar_cambio=False)
        conservar.assert_not_called()

    def test_series_completas(self) -> None:
        """Una serie de variaciones tiene 49 meses y termina en el del periodo; los indicadores, un solo mes."""
        meses = [periodos.mes_de(periodos.mes_anterior("2026-06", atras)) for atras in range(48, -1, -1)]
        serie = json.dumps({"items": [{"c_mes": mes} for mes in meses]}).encode()
        self.assertEqual((meses[0], meses[-1], len(set(meses))), (202206, 202606, 49))
        self.assertTrue(observatori._meses_del_periodo("C_P5_EVOL_2", observatori.meses_de(serie), "2026-06"))
        self.assertFalse(observatori._meses_del_periodo("C_P5_EVOL_2", observatori.meses_de(serie), "2026-09"))
        self.assertFalse(observatori._meses_del_periodo("C_P8_IND_COMARQUES", observatori.meses_de(serie), "2026-06"))


class PruebaReglas(unittest.TestCase):
    """La regla de las cifras y las definiciones de la metodología."""

    def test_razones_y_porcentajes_solo_con_base(self) -> None:
        """Con menos de 100 de base no hay porcentaje ni razón; con 100, sí; los días, enteros."""
        self.assertIsNone(conjunto_observatori.con_base(0.25, 99, 1, 100))
        self.assertEqual(conjunto_observatori.con_base(0.25, 100, 1, 100), 25.0)
        self.assertEqual(conjunto_observatori.con_base(88.37, 150, 0), 88)
        self.assertIsNone(conjunto_observatori.serie_publicable([0.1, 0.2], 999))
        self.assertEqual(conjunto_observatori.serie_publicable([0.1, None], 1000), [10.0, None])

    def test_fila_incoherente(self) -> None:
        """Más personas que contratos, una rotación mal hecha o una fracción fuera de [0, 1] son incoherentes."""
        buena = {
            "contratos": 120,
            "personas_contratadas": 100,
            "contratos_por_persona": 1.2,
            "demandantes_no_ocupados_12m": 200,
            "contratadas_por_demandante": 0.5,
            "fraccion_parcial": 0.3,
        }
        self.assertFalse(observatori.incoherente(buena))
        self.assertTrue(observatori.incoherente({**buena, "personas_contratadas": 130, "contratos_por_persona": 0.92}))
        self.assertTrue(observatori.incoherente({**buena, "contratos_por_persona": 1.5}))
        self.assertTrue(observatori.incoherente({**buena, "fraccion_parcial": 1.2}))

    def test_rotacion_nula_se_conserva_como_ausente(self) -> None:
        """Una rotación no publicada no se resta ni se inventa a partir de los recuentos."""
        fila = {**fila_preparada("4309", 2000), "contratos_por_persona": None}
        self.assertFalse(observatori.incoherente(fila))
        self.assertIsNone(conjunto_observatori.cifras_del_grupo(fila)["contratos_por_persona"])

    def test_la_metodologia_avisa_si_cambia_una_definicion(self) -> None:
        """Si el visor deja de decir que cada demandante cuenta en hasta seis ocupaciones, la validación lo dice."""
        texto = " ".join(constantes_observatori.DEFINICIONES.values())
        textos = {"metodologia_i_taules_de_detall": {"metodologia": {"metodologia_text_inicial": f"<p>{texto}</p>"}}}
        self.assertTrue(all(preparar_observatori.metodologia(textos)["definiciones"].values()))
        cambiado = texto.replace("un màxim de sis ocupacions", "un màxim de deu ocupacions")
        textos["metodologia_i_taules_de_detall"]["metodologia"]["metodologia_text_inicial"] = cambiado
        documentada = preparar_observatori.metodologia(textos)
        controles = Controles()
        observatori._controles_metodologia(controles, documentada)
        self.assertEqual(len(controles.fallidos), 1)
        self.assertIn("seis_ocupaciones", controles.fallidos[0])


class PruebaProvincias(unittest.TestCase):
    """Las comarcas se suman en su provincia; una comarca sin provincia no se reparte."""

    def test_suma_por_provincia(self) -> None:
        """Dos comarcas de Barcelona y una de Lleida; un recuento vacío cuenta como cero."""
        filas = [
            {"c_grup_primari": "4309", "c_comarca_42": "11", "eo_cont_sum_12m": 70},
            {"c_grup_primari": "4309", "c_comarca_42": "13", "eo_cont_sum_12m": 20},
            {"c_grup_primari": "4309", "c_comarca_42": "33", "eo_cont_sum_12m": 10},
            {"c_grup_primari": "9602", "c_comarca_42": "33", "eo_cont_sum_12m": None},
        ]
        provincia_de = {"11": "Barcelona", "13": "Barcelona", "33": "Lleida"}
        self.assertEqual(
            preparar_observatori.contratos_por_provincia(filas, provincia_de),
            [
                {"cno11": "4309", "contratos": {"Barcelona": 90, "Girona": 0, "Lleida": 10, "Tarragona": 0}},
                {"cno11": "9602", "contratos": {"Barcelona": 0, "Girona": 0, "Lleida": 0, "Tarragona": 0}},
            ],
        )

    def test_una_comarca_sin_provincia_rompe_la_suma(self) -> None:
        """Si la tabla no tiene una comarca, sus contratos no van a ninguna provincia y el control lo detiene.

        La tabla y el visor son coherentes (todas las comarcas, con su nombre, en las cuatro provincias): solo puede
        fallar la suma.
        """
        codigos = [f"{numero:02d}" for numero in range(1, constantes_observatori.COMARCAS_DE_CATALUNA + 1)]
        provincias_de_cataluna = constantes_observatori.PROVINCIAS
        tabla = {
            "comarcas": {
                codigo: {
                    "nombre": f"Comarca {codigo}",
                    "provincia": provincias_de_cataluna[i % len(provincias_de_cataluna)],
                }
                for i, codigo in enumerate(codigos)
            }
        }
        del_visor = {codigo: comarca["nombre"] for codigo, comarca in tabla["comarcas"].items()}
        provincia_de = preparar_observatori.provincia_de_cada_comarca(tabla)
        del_cataluna = [{"cno11": "4309", "contratos": 5}]

        def controles_con_la_comarca(comarca: str) -> Controles:
            filas = [{"c_grup_primari": "4309", "c_comarca_42": comarca, "eo_cont_sum_12m": 5}]
            provincias = preparar_observatori.contratos_por_provincia(filas, provincia_de)
            controles = Controles()
            observatori._controles_provincias(controles, tabla, del_visor, del_cataluna, provincias)
            return controles

        self.assertTrue(controles_con_la_comarca(codigos[0]).admitido)
        fuera_de_la_tabla = controles_con_la_comarca("99")
        self.assertEqual(len(fuera_de_la_tabla.fallidos), 1)
        self.assertIn("suman exactamente los contratos", fuera_de_la_tabla.fallidos[0])
        self.assertIn("4309", fuera_de_la_tabla.fallidos[0])


def fila_preparada(codigo: str, contratos: int) -> dict[str, Any]:
    """Una ocupación sintética con indicadores coherentes y bases conocidas.

    Returns:
        La fila de indicadores preparada.
    """
    return {
        "cno11": codigo,
        "contratos": contratos,
        "personas_contratadas": contratos // 2,
        "variacion_personas_contratadas": 0.25,
        "contratos_por_persona": 2.0,
        "fraccion_indefinidos": 0.5,
        "fraccion_parcial": 0.25,
        "fraccion_temporales_hasta_7_dias": 0.1,
        "duracion_media_temporales_dias": 90.0,
        "demandantes_no_ocupados_media": 2000,
        "demandantes_no_ocupados_12m": 2500,
        "variacion_demandantes_no_ocupados_12m": 0.1,
        "fraccion_demandantes_larga_duracion_12m": 0.2,
        "contratadas_por_demandante": contratos / 5000,
    }


class PruebaConjunto(unittest.TestCase):
    """Ejemplos pequeños de las bases y de la composición que consumen los informes."""

    def setUp(self) -> None:
        """Prepara tres ocupaciones sintéticas, con bases grande, mediana y pequeña."""
        self.tabla = {"fuente": {"cita": "Tabla sintética"}, "partidas": {"1": {"nombre": "Comarca partida"}}}
        self.filas = {
            "cataluna": [fila_preparada("4309", 2000), fila_preparada("5710", 500), fila_preparada("9602", 50)],
            "comarcas": [{"comarca": "11", **fila_preparada("4309", 200)}],
            "series": [
                {
                    "cno11": codigo,
                    "contratos_mes": [10, 20],
                    "personas_contratadas_mes": [5, 10],
                    "demandantes_no_ocupados_mes": [20, 30],
                    "variacion_contratos_mm12": [0.1, None],
                    "variacion_demandantes_mm12": [0.2, 0.3],
                }
                for codigo in ("4309", "5710", "9602")
            ],
            "provincias": [
                {"cno11": codigo, "contratos": {"Barcelona": contratos, "Girona": 0, "Lleida": 0, "Tarragona": 0}}
                for codigo, contratos in (("4309", 2000), ("5710", 500), ("9602", 50))
            ],
        }
        self.resumen = {
            "cita": "Font: actualització del 20/07/2026",
            "total": fila_preparada("TOTAL", 2550),
            "series": {
                "meses_mensuales": ["2026-05", "2026-06"],
                "meses_de_variacion": ["2026-05", "2026-06"],
                "variacion_contratos_mm12": [0.1, None],
                "variacion_demandantes_mm12": [0.2, 0.3],
            },
        }
        self.contexto = {"mes": 202606, "periodo": "12 meses a junio de 2026"}
        self.conjunto = conjunto_observatori.conjunto_validado(
            self.filas, self.resumen, self.contexto, self.resumen["cita"], self.tabla
        )

    def test_el_conjunto_se_reproduce(self) -> None:
        """Los indicadores preparados se exportan con su base y su redondeo."""
        self.assertEqual(
            self.conjunto["cataluna"]["cno4"]["4309"],
            {
                "contratos": 2000,
                "personas_contratadas": 1000,
                "variacion_personas_contratadas": 25.0,
                "contratos_por_persona": 2.0,
                "pct_indefinidos": 50.0,
                "pct_parcial": 25.0,
                "duracion_media_temporales_dias": 90,
                "demandantes_no_ocupados_12m": 2500,
                "demandantes_no_ocupados_media": 2000,
                "contratadas_por_demandante": 0.4,
            },
        )

    def test_tres_casos_reales(self) -> None:
        """Tres casos de bases diferentes ejercitan el mismo contrato que los casos reales."""
        cifras = self.conjunto["cataluna"]["cno4"]
        self.assertEqual([cifras[codigo]["pct_parcial"] for codigo in ("4309", "5710", "9602")], [25.0, 25.0, None])
        self.assertEqual(self.conjunto["comarca"]["cno4"]["4309"]["personas_contratadas"], 100)
        self.assertEqual(self.conjunto["vigencia"]["periodo"], "2025-07/2026-06")
        self.assertEqual(
            self.conjunto["contrato_indefinido"]["personas_ocupadas"]["periodo"]["es"],
            "enero de 2021, antes de la reforma laboral",
        )

    def test_provincias_de_los_tres_casos(self) -> None:
        """Las provincias preservan los recuentos y la cita de la tabla manual."""
        provincias = self.conjunto["provincias"]
        self.assertEqual(provincias["comarcas_partidas"], ["Comarca partida"])
        self.assertEqual(provincias["cita"], "Tabla sintética")
        self.assertEqual(provincias["cno4"]["4309"], {"Barcelona": 2000, "Girona": 0, "Lleida": 0, "Tarragona": 0})
        self.assertEqual(sum(provincias["cno4"]["5710"].values()), 500)

    def test_sin_provincias_por_debajo_de_la_base(self) -> None:
        """La ocupación de cincuenta contratos conserva recuentos y suprime provincias."""
        self.assertEqual(self.conjunto["cataluna"]["cno4"]["9602"]["contratos"], 50)
        self.assertEqual(set(self.conjunto["provincias"]["cno4"]), {"4309", "5710"})

    def test_ninguna_serie_pequena(self) -> None:
        """Los quinientos contratos permiten demanda, pero suprimen la serie de contratos."""
        self.assertEqual(self.conjunto["series"]["cno4"]["4309"]["contratos"], [10.0, None])
        self.assertIsNone(self.conjunto["series"]["cno4"]["5710"]["contratos"])
        self.assertEqual(self.conjunto["series"]["cno4"]["5710"]["demandantes_no_ocupados"], [20.0, 30.0])
        self.assertEqual(set(self.conjunto["mensual"]["cno4"]), {"4309"})

    def test_preparar_reproduce_los_preparados(self) -> None:
        """La preparación escribe filas y sumas a partir de originales sintéticos pequeños."""
        fila = fila_preparada("4309", 200)
        original = {codigo: fila[campo] for campo, codigo in constantes_observatori.CAMPOS.items()}
        original.update(
            {"c_mes": 202606, "c_grup_primari": "4309", "c_comarca_42": "11", "d_comarca": "Baix Llobregat"}
        )
        textos = {"metodologia_i_taules_de_detall": {"metodologia": {}}}
        resumen_series = self.resumen["series"]
        with TemporaryDirectory() as temporal, mock.patch.object(observatori, "comprobar_originales"):
            carpeta = Path(temporal)
            guardar_json(carpeta / "indicadores.json", {"items": [original]})
            guardar_json(carpeta / "textos.json", textos)
            cambios = {
                nombre: carpeta / nombre
                for nombre in (
                    "CATALUNA_CNO4",
                    "COMARCAS_CNO4",
                    "SUMAS_COMARCALES",
                    "SERIES_CNO4",
                    "PROVINCIAS_CNO4",
                    "CATALUNA",
                    "METODOLOGIA",
                )
            }
            with (
                mock.patch.multiple(observatori, **cambios),
                mock.patch.object(
                    observatori,
                    "original",
                    side_effect=lambda fuente, nombre: (
                        carpeta
                        / ("textos.json" if nombre == constantes_observatori.TEXTOS_DEL_VISOR else "indicadores.json")
                    ),
                ),
                mock.patch.object(
                    observatori,
                    "leer_json",
                    side_effect=lambda ruta: (
                        self.tabla if ruta == observatori.TABLA_DE_PROVINCIAS else {"items": [original]}
                    ),
                ),
                mock.patch.object(observatori, "filas_del_original", return_value=[original]),
                mock.patch.object(preparar_observatori, "filas_del_original", return_value=[original]),
                mock.patch.object(observatori, "preparar_series", return_value=(self.filas["series"], resumen_series)),
                mock.patch.object(observatori, "provincia_de_cada_comarca", return_value={"11": "Barcelona"}),
                mock.patch.object(cataluna, "archivo_del_observatori", return_value="indicadores.json"),
                mock.patch.object(cataluna, "fuentes", return_value={"observatori": self.resumen["cita"]}),
                redirect_stdout(io.StringIO()),
            ):
                observatori.preparar()
            self.assertEqual(leer_jsonl(cambios["CATALUNA_CNO4"]), [fila])
            self.assertEqual(
                leer_jsonl(cambios["SUMAS_COMARCALES"]),
                [{"cno11": "4309", "comarcas": 1, "contratos": 200, "demandantes_no_ocupados_media": 2000}],
            )


class RespuestaDelVisor(unittest.TestCase):
    """Una respuesta del visor que no es la esperada se rechaza con su motivo antes de leer ningún mes."""

    def test_respuestas_con_otra_forma(self) -> None:
        """No JSON, sin items, items vacío o una fila sin su mes entero: FormatoInesperado."""
        for datos in (b"<html>", b"[]", b'{"items": []}', b'{"items": [{"c_mes": "202608"}]}', b'{"otro": 1}'):
            with self.subTest(datos=datos), self.assertRaises(FormatoInesperado):
                observatori.meses_de(datos)

    def test_meses_ordenados_y_sin_repetir(self) -> None:
        """Los meses de las filas, ordenados y sin repetir."""
        datos = json.dumps({"items": [{"c_mes": 202608}, {"c_mes": 202607}, {"c_mes": 202608}]}).encode()
        self.assertEqual(observatori.meses_de(datos), [202607, 202608])


class PruebaConjuntoSinDatosSupuestos(unittest.TestCase):
    """El conjunto no supone lo que el Observatori no da."""

    def test_una_cita_sin_fecha_de_actualizacion(self) -> None:
        """Sin «actualització del dd/mm/aaaa» en la cita, la vigencia no toma el periodo como fecha de publicación."""
        with self.assertRaisesRegex(FormatoInesperado, "fecha de actualización"):
            conjunto_observatori.bloque_de_vigencia("2026-06", "Font: Observatori del Treball.")

    def test_el_calendario_publicado_no_anuncia_ninguna_fecha(self) -> None:
        """El texto de calendario de la vigencia no da ningún día, mes ni previsión, sea cual sea el periodo."""
        for periodo, mes in (("2026-06", "juny"), ("2026-09", "setembre"), ("2026-12", "desembre")):
            cita = (
                "Font: Observatori del Treball i Model Productiu, Generalitat de Catalunya. Treball per ocupacions: "
                f"dades a {mes} de 2026 (actualització del 22/01/2027)."
            )
            with self.subTest(periodo=periodo):
                calendario = conjunto_observatori.bloque_de_vigencia(periodo, cita)["calendario"]
                self.assertEqual(fechas_esperadas(calendario), [])
                self.assertIn("cada semana", calendario)

    def test_sin_parte_de_indefinidos_no_hay_duracion_de_los_temporales(self) -> None:
        """Sin la parte de indefinidos no se sabe cuántos contratos fueron temporales: la duración media no sale."""
        fila = {
            "contratos": 5000,
            "personas_contratadas": 3000,
            "demandantes_no_ocupados_12m": None,
            "demandantes_no_ocupados_media": None,
            "fraccion_indefinidos": None,
            "fraccion_parcial": None,
            "variacion_personas_contratadas": None,
            "contratos_por_persona": None,
            "duracion_media_temporales_dias": 90.0,
            "contratadas_por_demandante": None,
        }
        self.assertIsNone(conjunto_observatori.cifras_del_grupo(fila)["duracion_media_temporales_dias"])
        con_dato = conjunto_observatori.cifras_del_grupo({**fila, "fraccion_indefinidos": 0.5})
        self.assertEqual(con_dato["duracion_media_temporales_dias"], 90)


class PruebaEntradasDefectuosas(unittest.TestCase):
    """Los originales defectuosos se rechazan con el archivo y un motivo."""

    def test_titulos_respetan_la_ventana_de_cada_fichero(self) -> None:
        """Las descripciones de trece y cuarenta y nueve meses no dicen doce."""
        for archivo in observatori.archivos("2026-06"):
            if "EVOL" in archivo["archivo"]:
                self.assertNotIn("(12 meses", archivo["titulo"])

    def test_items_y_columnas_del_original_se_exigen(self) -> None:
        """La lista vacía y las filas sin sus columnas dicen su archivo."""
        for contenido in ({"items": []}, {"items": [1]}, {"items": [{"c_mes": 202606}]}):
            with (
                self.subTest(contenido=contenido),
                mock.patch.object(
                    preparar_observatori, "original", return_value=mock.Mock(read_bytes=mock.Mock(return_value=b"{}"))
                ),
                mock.patch.object(preparar_observatori, "contenido_visor", return_value=contenido),
                mock.patch.object(cataluna, "periodo_archivado", return_value="2026-06"),
                self.assertRaisesRegex(FormatoInesperado, "C_P5_EVOL_1"),
            ):
                preparar_observatori.filas_del_original("C_P5_EVOL_1")

    def test_las_cifras_no_desbordan_la_lectura(self) -> None:
        """Los infinitos y el entero que desborda isfinite tienen el mismo error con motivo."""
        for valor in (float("inf"), float("nan"), 10**1000):
            fila = {
                "c_mes": 202606,
                "c_grup_primari": "4309",
                "eo_cont_mes": valor,
                "eo_per_cont_mes": 5,
                "eo_dno_mes": 10,
            }
            with self.subTest(valor=valor), self.assertRaisesRegex(FormatoInesperado, "C_P5_EVOL_1.*cifra"):
                preparar_observatori.filas_de_datos({"items": [fila]}, "C_P5_EVOL_1")

    def test_series_vacias_tienen_motivo(self) -> None:
        """Una serie vacía no llega a next ni max."""
        with (
            mock.patch.object(preparar_observatori, "filas_del_original", return_value=[]),
            self.assertRaisesRegex(FormatoInesperado, "C_P5_EVOL_1"),
        ):
            preparar_observatori.preparar_series()

    def test_las_series_comparten_calendario(self) -> None:
        """El mismo número de meses no permite desplazar otra ocupación."""
        mensual = [
            {"c_grup_primari": "4309", "c_mes": 202606},
            {"c_grup_primari": "5710", "c_mes": 202605},
        ]
        for fila in mensual:
            fila.update(
                dict.fromkeys(
                    (
                        "eo_cont_mes",
                        "eo_per_cont_mes",
                        "eo_dno_mes",
                        "eo_var_cont_mm_12m",
                        "eo_var_dno_mm_12m",
                        "eo_var_cont_mm_12m_cat",
                        "eo_var_dno_mm_12m_cat",
                    ),
                    0.1,
                )
            )
        with (
            mock.patch.object(preparar_observatori, "filas_del_original", return_value=mensual),
            self.assertRaisesRegex(FormatoInesperado, "calendario"),
        ):
            preparar_observatori.preparar_series()

    def test_una_provincia_desconocida_tiene_motivo(self) -> None:
        """La tabla manual no puede enviar contratos a una provincia desconocida."""
        filas = [{"c_grup_primari": "4309", "c_comarca_42": "11", "eo_cont_sum_12m": 5}]
        with self.assertRaisesRegex(FormatoInesperado, "provincia.*Madrid"):
            preparar_observatori.contratos_por_provincia(filas, {"11": "Madrid"})

    def test_la_fecha_de_actualizacion_es_real(self) -> None:
        """Un día imposible de la cita no se exporta como fecha ISO."""
        with self.assertRaisesRegex(FormatoInesperado, "fecha de actualización"):
            conjunto_observatori.bloque_de_vigencia("2026-06", "actualització del 31/02/2026")


if __name__ == "__main__":
    unittest.main()
