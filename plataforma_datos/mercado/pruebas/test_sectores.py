"""Pruebas autónomas de sectores: reglas, originales sintéticos y controles, sin datos operativos."""

import copy
import io
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from typing import Any
from unittest import mock
from urllib.error import HTTPError

import plataforma_datos.mercado.fuentes.sectores.lector as sectores
from plataforma_datos.comun import entrada_salida
from plataforma_datos.comun.entrada_salida import guardar_json, leer_json, leer_jsonl, sha256
from plataforma_datos.comun.nucleo import CON_ERRORES, Controles, Descarga, FormatoInesperado
from plataforma_datos.mercado.pruebas.ayuda_textos_sin_fecha import fechas_esperadas


class PruebaReglas(unittest.TestCase):
    """La regla de las celdas, el paso de 3 a 2 cifras y cómo se leen las etiquetas de la API."""

    def test_separa_el_codigo_del_nombre_y_deja_no_consta_aparte(self) -> None:
        """«82 - Actividades…» es la 82; «No consta» va aparte."""
        self.assertEqual(
            sectores.codigo_y_nombre("82 - Actividades administrativas"), ("82", "Actividades administrativas")
        )
        self.assertEqual(sectores.codigo_y_nombre("No consta")[0], sectores.NO_CONSTA)

    def test_cataluna_suma_las_provincias_catalanas_y_no_las_demas(self) -> None:
        """Cataluña suma sus provincias; Barcelona es la suya; las demás y las celdas vacías no cuentan."""

        def fila(provincia: str, personas: int) -> dict[str, str | int]:
            """Una fila de la API del grupo 430 en la Administración Pública.

            Returns:
                La fila, con la provincia y las personas dadas.
            """
            return {
                sectores.LUGAR: provincia,
                "ID_OCU171": "430 - Otros empleados administrativos",
                "ID_ACT89": "84 - Administración Pública",
                "SPERSONAS": personas,
            }

        filas = [
            fila("08 Barcelona", 100),
            fila("17 Girona", 20),
            fila("25 Lleida", 30),
            fila("43 Tarragona", 0),
            fila("28 Madrid", 500),
        ]
        self.assertEqual(sectores.repartos(filas, "cataluna", "3"), {"430": {"84": 150}})
        self.assertEqual(sectores.repartos(filas, "barcelona", "3"), {"430": {"84": 100}})

    def test_un_sector_necesita_100_personas_y_el_3_por_ciento(self) -> None:
        """Con 99 personas o menos del 3 % del grupo, un sector va a «otros»; los que quedan suman 100 con «otros»."""
        reparto = sectores.reparto({"84": 2000, "46": 99, "47": 110, "68": 1791})
        self.assertEqual([sector[0] for sector in reparto["sectores"]], ["84", "68"])
        self.assertEqual(reparto["personas"], 4000)
        self.assertAlmostEqual(sum(sector[1] for sector in reparto["sectores"]) + reparto["otros_pct"], 100, places=1)
        pequeno = sectores.reparto({"84": 3000, "46": 120, "47": 6880})
        self.assertNotIn("46", [sector[0] for sector in pequeno["sectores"]], "120 de 10.000 es el 1,2 %")

    def test_grupos_pequenos_remiten_a_2_cifras_o_se_quedan_sin_reparto(self) -> None:
        """Un grupo de 3 cifras con menos de 1.000 personas remite a su grupo de 2; uno de 2 cifras pequeño, a nada."""
        tres = {
            "571": {"personas": 999, "actividades": {"88": 999}},
            "430": {"personas": 1000, "actividades": {"84": 1000}},
        }
        paquete = sectores._grupos_del_paquete(tres, "3")
        self.assertEqual(paquete["571"], {"personas": 999, "ver_cno2": "57"})
        self.assertIn("sectores", paquete["430"])
        dos = {"57": {"personas": 400, "actividades": {"88": 400}}}
        self.assertEqual(sectores._grupos_del_paquete(dos, "2")["57"], {"personas": 400, "sin_reparto": True})

    def test_perturbacion_cuenta_las_celdas_que_quedan_en_cero(self) -> None:
        """Un grupo de 3 cifras sin cifra en una actividad también puede haber restado hasta 3: el margen lo cuenta."""
        tres = {
            "211": {"actividades": {"86": 6}},
            "212": {"actividades": {"85": 50}},
            "213": {"actividades": {"85": 40}},
        }
        dos = {"21": {"actividades": {"86": 15, "85": 90}}}
        self.assertEqual(sectores._fuera_de_la_perturbacion(tres, dos, 1), [])
        self.assertEqual(
            sectores._fuera_de_la_perturbacion(tres, {"21": {"actividades": {"86": 30, "85": 90}}}, 1), ["21·86"]
        )

    def test_una_respuesta_vacia_de_la_api_no_vale(self) -> None:
        """La API responde a veces con `data` vacía: no es una copia."""
        self.assertFalse(sectores.con_datos(b'{"metadata":[],"data":[]}'))
        self.assertFalse(sectores.con_datos(b"<html>"))
        self.assertTrue(sectores.con_datos(b'{"data":[{"SPERSONAS":1}]}'))
        for otro_json in (b"[]", b"null", b"3", b'"data"'):
            with self.subTest(respuesta=otro_json):
                self.assertFalse(sectores.con_datos(otro_json))

    def test_una_actividad_sin_cifra_en_sus_grupos_de_3_tambien_se_compara(self) -> None:
        """Una actividad del grupo de 2 cifras que no está en ninguno de sus grupos de 3 se compara con 0."""
        tres = {"211": {"actividades": {"85": 50}}, "212": {"actividades": {"85": 40}}}
        self.assertEqual(sectores._fuera_de_la_perturbacion(tres, {"21": {"actividades": {"85": 90}}}, 1), [])
        dos = {"21": {"actividades": {"85": 90, "86": 40}}, "59": {"actividades": {"01": 48}}}
        # El 59 no tiene grupos de 3 cifras en la consulta: no se desglosa y no hay suma que comparar.
        self.assertEqual(sectores._fuera_de_la_perturbacion(tres, dos, 1), ["21·86"])

    def test_sin_todas_las_consultas_el_informe_dice_por_que_se_para(self) -> None:
        """Si faltan consultas o provincias, la validación acaba con su control fallido, no con un KeyError."""
        with mock.patch.multiple(
            sectores,
            leer_validado=lambda fuente: {"cno11": {}},
            leer_jsonl=lambda ruta: [],
            leer_json=lambda ruta: {"provincias": {}, "actividades": {}, "archivos": []},
            controles_de_huella=lambda *argumentos: None,
            cerrar_validacion=mock.DEFAULT,
        ) as parches:
            sectores.validar()
        informe = parches["cerrar_validacion"].call_args.args[1]
        self.assertEqual(informe["estado"], CON_ERRORES)

    def test_sin_ocupados_por_residencia_el_contraste_falla_sin_dividir_por_cero(self) -> None:
        """Un censo por residencia vacío deja el contraste fallido con su motivo."""
        controles = Controles()
        grupos = [{"territorio": "cataluna", "nivel": "3", "cno11": "211", "personas": 5, "actividades": {}}]
        sectores._controles_contraste(controles, grupos, {})
        self.assertFalse(controles.admitido)


# Cuatro grupos pequeños, inventados: un único sector por grupo y 1.000 personas por provincia.
# Los códigos ilustran servicios sociales, construcción, Administración y hogares.
CASOS = (("571", "88"), ("960", "41"), ("430", "84"), ("910", "97"))
FECHA_CONSULTA = "06/10/2026"


def grupos_de_ejemplo() -> list[dict[str, Any]]:
    """Filas esperadas de los dos niveles.

    Returns:
        Los 16 grupos, en el orden de los preparados.
    """
    return sorted(
        [
            {
                "territorio": territorio,
                "nivel": nivel,
                "cno11": codigo if nivel == "3" else codigo[:2],
                "personas": personas,
                "actividades": {actividad: personas},
            }
            for territorio, personas in (("barcelona", 1000), ("cataluna", 4000))
            for nivel in ("2", "3")
            for codigo, actividad in CASOS
        ],
        key=lambda fila: (fila["territorio"], fila["nivel"], fila["cno11"]),
    )


class PruebaControles(unittest.TestCase):
    """Los controles usan originales sintéticos con huellas y rutas temporales."""

    def setUp(self) -> None:
        """Registra consultas inventadas y redirige toda E/S a una carpeta temporal."""
        self.temporal = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporal.cleanup)
        raiz = Path(self.temporal.name)
        originales, preparados, validados = (raiz / nombre for nombre in ("originales", "preparados", "validados"))
        parche_io = mock.patch.multiple(
            entrada_salida,
            ORIGINALES=originales,
            PREPARADOS=preparados,
            VALIDADOS=validados,
        )
        parche_io.start()
        self.addCleanup(parche_io.stop)
        rutas = entrada_salida.carpetas("sectores")
        parche_fuente = mock.patch.multiple(
            sectores,
            ORIGINAL=rutas.original,
            PREPARADO=rutas.preparado,
            VALIDADO=rutas.validado,
            PROCEDENCIA=rutas.original / "procedencia.json",
            GRUPOS=rutas.preparado / "grupos.jsonl",
            RESUMEN=rutas.preparado / "consultas.json",
        )
        parche_fuente.start()
        self.addCleanup(parche_fuente.stop)
        registros = []
        for nivel in ("3", "2"):
            filas = [
                {
                    sectores.LUGAR: provincia,
                    sectores.OCUPACION[nivel]: f"{codigo if nivel == '3' else codigo[:2]} - Grupo",
                    sectores.ACTIVIDAD: f"{actividad} - Actividad {actividad}",
                    sectores.METRICA: 1000,
                }
                for codigo, actividad in CASOS
                for provincia in sectores.TERRITORIOS["cataluna"][0]
            ]
            ruta = rutas.original / sectores.archivo_de_la_consulta(nivel)
            guardar_json(ruta, {"data": filas})
            registros.append({"archivo": ruta.name, "sha256": sha256(ruta), "descargado_utc": "2026-10-06T12:00:00Z"})
        guardar_json(sectores.PROCEDENCIA, {"archivos": registros})
        self.grupos = grupos_de_ejemplo()
        self.resumen = {
            "actividades": {
                actividad: f"Actividad {actividad}" for actividad in sorted({actividad for _, actividad in CASOS})
            },
            "provincias": {nivel: sorted(sectores.TERRITORIOS["cataluna"][0]) for nivel in ("3", "2")},
        }
        cita = f"{sectores.CITA} Consulta del {FECHA_CONSULTA}."
        self.conjunto = {
            "vigencia": {
                "periodo": "2021-01-01",
                "publicado": "2023",
                "siguiente_prevista": None,
                "calendario": sectores.CALENDARIO,
                "fuente": cita,
            },
            "fuentes": {"sectores": cita},
            "fecha_de_referencia": sectores.FECHA_DE_REFERENCIA,
            "lugar": "lugar de trabajo",
            "min_personas_sector": 100,
            "min_pct_sector": 3.0,
            "min_personas_grupo": 1000,
            "actividades": self.resumen["actividades"],
            "territorios": {
                territorio: {
                    "nombre": nombre,
                    **{
                        f"cno{nivel}": {
                            codigo if nivel == "3" else codigo[:2]: {
                                "personas": personas,
                                "sectores": [[actividad, 100.0, personas]],
                                "otros_pct": 0.0,
                            }
                            for codigo, actividad in sorted(CASOS)
                        }
                        for nivel in ("3", "2")
                    },
                }
                for territorio, personas, nombre in (
                    ("cataluna", 4000, "Cataluña"),
                    ("barcelona", 1000, "Provincia de Barcelona"),
                )
            },
        }

    def test_el_ancla_salta_si_la_actividad_se_lee_cruzada(self) -> None:
        """El ancla doméstica admite hogares y detecta una actividad cruzada."""
        controles = Controles()
        sectores._controles_ancla(controles, self.grupos)
        self.assertTrue(controles.admitido, controles.fallidos)
        cruzados = [
            {**fila, "actividades": {"10": fila["personas"]}} if fila["cno11"] == "910" else fila
            for fila in self.grupos
        ]
        controles = Controles()
        sectores._controles_ancla(controles, cruzados)
        self.assertEqual(len(controles.fallidos), 1)
        self.assertIn("ancla", controles.fallidos[0])

    def test_el_conjunto_se_reproduce(self) -> None:
        """La composición conserva todos los campos del conjunto esperado."""
        self.assertEqual(
            sectores._conjunto_validado(self.grupos, self.resumen["actividades"], FECHA_CONSULTA), self.conjunto
        )

    def test_ningun_sector_baja_del_minimo_de_personas_ni_del_porcentaje(self) -> None:
        """La alarma distingue el mínimo de personas del mínimo porcentual."""
        controles = Controles()
        sectores._controles_del_conjunto(controles, self.conjunto)
        self.assertTrue(controles.admitido, controles.fallidos)
        for posicion, valor in ((2, 99), (1, 2.9)):
            conjunto = copy.deepcopy(self.conjunto)
            grupo = conjunto["territorios"]["cataluna"]["cno3"]["571"]
            grupo["sectores"][0][posicion] = valor
            grupo["otros_pct"] = 100 - grupo["sectores"][0][1]
            controles = Controles()
            with self.subTest(posicion=posicion):
                sectores._controles_del_conjunto(controles, conjunto)
                self.assertEqual(len(controles.fallidos), 1)
                self.assertIn("ningún sector", controles.fallidos[0])

    def test_los_casos_de_referencia_tienen_su_sector_principal(self) -> None:
        """Cada grupo conserva la actividad principal de sus consultas sintéticas."""
        conjunto = sectores._conjunto_validado(self.grupos, self.resumen["actividades"], FECHA_CONSULTA)
        cataluna = conjunto["territorios"]["cataluna"]["cno3"]
        for codigo, actividad in CASOS:
            self.assertEqual(cataluna[codigo]["sectores"][0][0], actividad)
        self.assertEqual(conjunto["vigencia"]["periodo"], "2021-01-01")

    def test_el_calendario_publicado_no_anuncia_ninguna_fecha(self) -> None:
        """El texto de calendario del conjunto dice lo que es verdad sin fecha: ningún día, mes ni previsión."""
        conjunto = sectores._conjunto_validado(self.grupos, self.resumen["actividades"], FECHA_CONSULTA)
        self.assertEqual(fechas_esperadas(conjunto["vigencia"]["calendario"]), [])
        self.assertIn("el INE aún no ha publicado la fecha del siguiente", conjunto["vigencia"]["calendario"])

    def test_descargar_sin_aceptar_cambio_no_consulta_la_api(self) -> None:
        """Conservar la copia registrada no solicita otra perturbación."""
        with mock.patch.object(sectores, "descargar_url") as consulta, redirect_stdout(io.StringIO()):
            sectores.descargar(False)
        consulta.assert_not_called()

    def test_preparar_reproduce_los_preparados(self) -> None:
        """Los originales producen los grupos esperados y repetir conserva los bytes."""
        with redirect_stdout(io.StringIO()):
            sectores.preparar()
        self.assertEqual(leer_jsonl(sectores.GRUPOS), self.grupos)
        self.assertEqual(leer_json(sectores.RESUMEN), self.resumen)
        primeros = (sectores.GRUPOS.read_bytes(), sectores.RESUMEN.read_bytes())
        with redirect_stdout(io.StringIO()):
            sectores.preparar()
        self.assertEqual((sectores.GRUPOS.read_bytes(), sectores.RESUMEN.read_bytes()), primeros)

    def test_validar_guarda_el_conjunto_del_ejemplo_admitido(self) -> None:
        """La preparación y los controles admiten y guardan el ejemplo mínimo."""
        cno = {fila["cno11"]: {"nivel": fila["nivel"]} for fila in self.grupos}
        dependencias = {
            "clasificaciones": {"cno11": cno},
            "cataluna": {"ocupados_cno3": {codigo: {"ocupados": 4000} for codigo, _ in CASOS}},
        }
        with (
            mock.patch.object(sectores, "DIVISIONES_CNAE", len(self.resumen["actividades"])),
            mock.patch.object(sectores, "leer_validado", side_effect=dependencias.__getitem__),
            redirect_stdout(io.StringIO()),
        ):
            sectores.preparar()
            sectores.validar()
        self.assertEqual(leer_json(entrada_salida.ruta_del_conjunto("sectores")), self.conjunto)
        informe = leer_json(entrada_salida.carpetas("sectores").validacion)
        self.assertEqual(informe["estado"], "Admitido")
        self.assertTrue(all(control["resultado"] == "correcto" for control in informe["controles"]))

    def test_una_fecha_imposible_de_procedencia_no_se_exporta(self) -> None:
        """La fecha de consulta debe existir antes de componer y guardar el conjunto."""
        raiz_temporal = Path(self.temporal.name)
        self.assertTrue(sectores.PROCEDENCIA.is_relative_to(raiz_temporal))
        self.assertTrue(entrada_salida.ruta_del_conjunto("sectores").is_relative_to(raiz_temporal))
        registro = leer_json(sectores.PROCEDENCIA)
        registro["archivos"][0]["descargado_utc"] = "2026-02-31T12:00:00Z"
        guardar_json(sectores.PROCEDENCIA, registro)
        cno = {fila["cno11"]: {"nivel": fila["nivel"]} for fila in self.grupos}
        dependencias = {
            "clasificaciones": {"cno11": cno},
            "cataluna": {"ocupados_cno3": {codigo: {"ocupados": 4000} for codigo, _ in CASOS}},
        }
        with (
            mock.patch.object(sectores, "DIVISIONES_CNAE", len(self.resumen["actividades"])),
            mock.patch.object(sectores, "leer_validado", side_effect=dependencias.__getitem__),
            redirect_stdout(io.StringIO()),
        ):
            sectores.preparar()
            with self.assertRaisesRegex(FormatoInesperado, "procedencia.json.*fecha.*consulta"):
                sectores.validar()
        self.assertFalse(entrada_salida.ruta_del_conjunto("sectores").exists())


class PruebaEntradasDefectuosas(unittest.TestCase):
    """Regresiones de respuestas, cobertura y celdas externas mal formadas."""

    def test_solo_acepta_listas_no_vacias_de_filas(self) -> None:
        """Un valor JSON verdadero en data no sustituye una lista de filas."""
        for datos in (b'{"data":true}', b'{"data":"error"}', b'{"data":{"error":1}}', b'{"data":[1]}'):
            with self.subTest(datos=datos):
                self.assertFalse(sectores.con_datos(datos))

    def test_no_duerme_despues_del_ultimo_intento_fallido(self) -> None:
        """Los cuatro intentos requieren tres pausas, sin espera tras el último."""
        descarga = Descarga(b'{"data":[]}', sectores.API, "application/json")
        with (
            mock.patch.object(sectores, "descargar_url", return_value=descarga) as consulta,
            mock.patch.object(sectores.time, "sleep") as pausa,
            self.assertRaisesRegex(FormatoInesperado, "4 intentos"),
        ):
            sectores._consultar_con_datos(sectores.CONSULTAS[0])
        self.assertEqual(consulta.call_count, sectores.INTENTOS)
        self.assertEqual(pausa.call_args_list, [mock.call(30), mock.call(60), mock.call(90)])

    def test_no_reintenta_errores_http_del_cliente(self) -> None:
        """Un error 400 termina con su motivo y sin pausa."""
        error = HTTPError(sectores.API, 400, "consulta inválida", None, None)
        with (
            mock.patch.object(sectores, "descargar_url", side_effect=error) as consulta,
            mock.patch.object(sectores.time, "sleep") as pausa,
            self.assertRaises(HTTPError),
        ):
            sectores._consultar_con_datos(sectores.CONSULTAS[0])
        consulta.assert_called_once()
        pausa.assert_not_called()

    def test_cada_nivel_debe_declarar_sus_provincias(self) -> None:
        """La falta del registro provincial de cualquier nivel impide admitir."""
        grupos = grupos_de_ejemplo()
        cno = {fila["cno11"]: {"nivel": fila["nivel"]} for fila in grupos}
        for provincias in ({}, {"3": list(sectores.TERRITORIOS["cataluna"][0])}):
            controles = Controles()
            resumen = {"actividades": {}, "provincias": provincias}
            with self.subTest(provincias=provincias):
                self.assertFalse(sectores._controles_cobertura(controles, grupos, resumen, cno))
                self.assertIn("cuatro provincias", controles.fallidos[0])

    def test_las_celdas_invalidas_dicen_original_y_fila(self) -> None:
        """Una etiqueta ausente o cifra inválida identifica el original y la fila."""
        fila = {
            sectores.LUGAR: "08 Barcelona",
            sectores.OCUPACION["3"]: "430 - Grupo",
            sectores.ACTIVIDAD: "84 - Actividad",
            sectores.METRICA: 3,
        }
        for campo, valor in ((sectores.METRICA, None), (sectores.METRICA, float("inf")), (sectores.LUGAR, None)):
            mala = {**fila, campo: valor}
            with (
                self.subTest(campo=campo, valor=valor),
                self.assertRaisesRegex(FormatoInesperado, "ocu3-act2.json.*fila 1"),
            ):
                sectores.repartos([mala], "cataluna", "3")
        with self.assertRaisesRegex(FormatoInesperado, "ocu3-act2.json.*fila 1"):
            sectores.repartos([{sectores.METRICA: 1}], "cataluna", "3")

    def test_un_entero_desmesurado_falla_con_original_y_fila(self) -> None:
        """Un entero que desborda la comprobación numérica conserva un motivo legible."""
        fila = {
            sectores.LUGAR: "08 Barcelona",
            sectores.OCUPACION["3"]: "430 - Grupo",
            sectores.ACTIVIDAD: "84 - Actividad",
            sectores.METRICA: 10**1000,
        }
        with self.assertRaisesRegex(FormatoInesperado, "ocu3-act2.json.*fila 1.*SPERSONAS"):
            sectores.repartos([fila], "cataluna", "3")

    def test_un_reparto_sin_personas_se_rechaza_con_motivo(self) -> None:
        """Un total nulo carece de reparto porcentual válido."""
        with self.assertRaisesRegex(FormatoInesperado, "personas.*positiv"):
            sectores.reparto({})


if __name__ == "__main__":
    unittest.main()
