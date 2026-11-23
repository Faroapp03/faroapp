"""El catálogo detecta una edición distinta antes de tocar los originales del método admitido."""

import contextlib
import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

import plataforma_datos.ia_y_trabajo.fuentes.tich.lector as tich
from plataforma_datos.comun import red
from plataforma_datos.comun.entrada_salida import sha256_bytes
from plataforma_datos.comun.nucleo import Descarga, FormatoInesperado
from plataforma_datos.comun.observacion_remota import VARIABLE_RECEPCION, contexto_descarga, observar
from plataforma_datos.ia_y_trabajo.fuentes.tich.constantes import ARCHIVOS
from plataforma_datos.ia_y_trabajo.fuentes.tich.edicion import primera
from plataforma_datos.ia_y_trabajo.fuentes.tich.edicion_nueva import (
    anios_medidos_validos,
    ediciones_del_dato,
    serie_medida,
)
from plataforma_datos.ia_y_trabajo.fuentes.tich.ediciones import edicion_del_catalogo

VISTO = "2026-11-12T03:00:00+00:00"
AHORA = "2026-11-19T03:00:00+00:00"


def catalogo(resultados: int = 2025, microdatos: int = 2025) -> str:
    """Catálogo mínimo con el rótulo y las opciones reales de INEbase.

    Returns:
        HTML sintético sin depender de la web ni de las rutas operativas.
    """
    return (
        f'<p><strong>Resultados año {resultados}</strong></p><select id="ir_1254736063703">'
        f'<option value="/ftp/microdatos/tich/datos_{microdatos}.zip">{microdatos}</option>'
        '<option value="/ftp/microdatos/tich/datos_2023.zip">2023</option></select>'
    )


class PruebaCatalogoTich(unittest.TestCase):
    """Resultados y disponibilidad de microdatos se leen como dos hechos distintos."""

    def test_lee_ultimo_zip_sin_confundir_otras_fechas(self) -> None:
        """Solo los resultados y las opciones de microdatos determinan los años descubiertos."""
        pagina = catalogo() + '<p>Actualizado 2027</p><option value="/otro.zip">2029</option>'
        self.assertEqual(
            edicion_del_catalogo(pagina),
            {
                "anio_resultados": 2025,
                "anio_microdatos": 2025,
                "url_microdatos": "https://www.ine.es/ftp/microdatos/tich/datos_2025.zip",
            },
        )

    def test_no_infiere_microdatos_del_anio_de_resultados(self) -> None:
        """Una publicación puede preceder a la disponibilidad de sus microdatos."""
        edicion = edicion_del_catalogo(catalogo(2026, 2025))
        self.assertEqual((edicion["anio_resultados"], edicion["anio_microdatos"]), (2026, 2025))

    def test_sucesora_con_ruta_desconocida_y_parrafo_anidado_no_se_ocultan(self) -> None:
        """Una ruta nueva o un párrafo abierto no permiten acreditar la edición anterior."""
        for pagina in (
            catalogo().replace(
                "</select>", '<option value="/ftp/microdatos/tich2026/datos_2026.zip">2026</option></select>'
            ),
            catalogo() + "<p>Resultados año 2026<p>Otro</p>",
            catalogo().replace('id="ir_1254736063703"', 'id="otro"'),
            catalogo() + catalogo().split("</p>", 1)[1],
        ):
            with self.subTest(pagina=pagina), self.assertRaises(FormatoInesperado):
                edicion_del_catalogo(pagina)

    def test_rechaza_catalogos_ambiguos_incompletos_o_direcciones_ajenas(self) -> None:
        """Los errores de identidad o de estructura fallan sin fabricar una dirección alternativa."""
        base = catalogo()
        for pagina in (
            "<p>Sin catálogo</p>",
            base.replace("Resultados año 2025", "Resultados desconocidos"),
            base + "<p>Resultados año 2026</p>",
            base.replace(
                "/ftp/microdatos/tich/datos_2025.zip", "https://otro.example/ftp/microdatos/tich/datos_2025.zip"
            ),
            base.replace("datos_2025.zip", "datos_2025.zip?version=otra"),
            base.replace(">2025</option>", ">2026</option>"),
            base.replace("</select>", '<option value="/ftp/microdatos/tich/datos_2025.zip">2025</option></select>'),
            base.rsplit("</option>", 1)[0],
            base + "<p>Resultados año 2026",
            base.removesuffix("</select>"),
        ):
            with self.subTest(pagina=pagina), self.assertRaises(FormatoInesperado):
                edicion_del_catalogo(pagina)


class PruebaDescubrimientoTich(unittest.TestCase):
    """Una edición nueva se observa sin dejar de servir la admitida; los recibos vinculan los cinco recursos."""

    def setUp(self) -> None:
        """Aísla los originales y el estado de la edición admitida."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        raiz = Path(temporal.name)
        original = raiz / "originales"
        original.mkdir()
        validado = raiz / "validados"
        self.enterContext(mock.patch.object(tich, "ORIGINAL", original))
        self.enterContext(mock.patch.object(tich, "PROCEDENCIA", original / "procedencia.json"))
        self.enterContext(mock.patch.object(tich, "VALIDADO", validado))
        self.enterContext(mock.patch.object(tich, "ESTADO_EDICION", validado / "edicion.json"))

    def test_catalogo_incoherente_se_detiene_antes_de_descargar_o_escribir_originales(self) -> None:
        """Un año anterior o microdatos sin sus resultados detienen la consulta, también con --aceptar-cambio."""
        for resultados, microdatos in ((2025, 2026), (2024, 2024), (2024, 2025)):
            for aceptar in (False, True):
                with self.subTest(resultados=resultados, microdatos=microdatos, aceptar=aceptar):
                    descarga = Descarga(catalogo(resultados, microdatos).encode(), tich.RESULTADOS, "text/html")
                    with (
                        mock.patch.object(red, "descargar_url", return_value=descarga) as consultar,
                        mock.patch.object(tich.epa_por_anio, "originales_de_la_edicion") as descargar,
                        mock.patch.object(red, "conservar_o_sustituir") as escribir,
                        mock.patch.object(tich, "guardar_json") as guardar,
                        mock.patch.object(tich.time, "sleep") as pausa,
                        self.assertRaisesRegex(FormatoInesperado, "incoherentes con la edición admitida 2025"),
                    ):
                        tich.descargar(aceptar)
                    consultar.assert_called_once_with(tich.RESULTADOS)
                    for operacion in (descargar, escribir, guardar, pausa):
                        operacion.assert_not_called()

    def descargar_con(self, raiz: Path, cuerpo: bytes, previa: dict[str, object]) -> dict[str, object]:
        """Ejecuta la etapa `descargar` con un catálogo dado sobre una procedencia previa; exige que termine con 0.

        Returns:
            La procedencia que deja escrita.
        """
        procedencia = raiz / "procedencia.json"
        procedencia.write_text(json.dumps({"archivos": [], **previa}), encoding="utf-8")

        def descargar(url: str, *_: object) -> Descarga:
            return Descarga(cuerpo if url == tich.RESULTADOS else b"original", url, "text/plain")

        with (
            mock.patch.object(tich, "ORIGINAL", raiz),
            mock.patch.object(tich, "PROCEDENCIA", procedencia),
            mock.patch.object(red, "descargar_url", side_effect=descargar) as consultar,
            mock.patch.object(red, "ahora_utc", return_value=AHORA),
            mock.patch.object(tich.time, "sleep"),
            redirect_stdout(io.StringIO()),
        ):
            self.assertEqual(tich.main(["descargar", "--aceptar-cambio"]), 0)
        pedidas = [llamada.args[0] for llamada in consultar.call_args_list]
        self.assertEqual(pedidas[1:], [archivo["url"] for archivo in ARCHIVOS])
        return json.loads(procedencia.read_text())

    def test_edicion_nueva_es_una_observacion_fechada_y_no_un_fallo(self) -> None:
        """Una edición posterior: la consulta termina, conserva 2025 y registra lo observado.

        Solo hay microdatos de la edición nueva si su año es el de los resultados: con resultados de 2027 y microdatos
        de 2026, la de 2027 sigue sin microdatos. La fecha es la primera vez que se vio ese catálogo y la huella es la
        suya. Como la etapa termina bien, no suma fallos para los reintentos.
        """
        for resultados, microdatos, estado in (
            (2026, 2025, "publicada-sin-microdatos"),
            (2026, 2026, "pendiente-de-incorporar"),
            (2027, 2026, "publicada-sin-microdatos"),
        ):
            with self.subTest(resultados=resultados, microdatos=microdatos), tempfile.TemporaryDirectory() as temporal:
                cuerpo = catalogo(resultados, microdatos).encode()
                entrada = {"archivo": tich.CATALOGO, "sha256": sha256_bytes(cuerpo), "descargado_utc": VISTO}
                registrada = self.descargar_con(Path(temporal), cuerpo, {"descubrimiento": [entrada]})
                esperada = {
                    "estado": estado,
                    "anio": str(resultados),
                    "observado_utc": VISTO,
                    "sha256_catalogo": sha256_bytes(cuerpo),
                }
                self.assertEqual(registrada["edicion_nueva"], esperada)
                self.assertEqual(
                    [v["archivo"] for v in registrada["archivos"]], [f"2025/{v['archivo']}" for v in ARCHIVOS]
                )
                self.assertEqual(
                    ediciones_del_dato(registrada, "2025"), {"anios_medidos": ["2025"], "edicion_nueva": esperada}
                )

    def test_la_captura_de_la_primera_observacion_se_conserva_con_su_huella(self) -> None:
        """La huella que cita el dato se comprueba con su captura, que otra consulta del mismo estado no reescribe."""
        primero = catalogo(2026, 2025).encode()
        with tempfile.TemporaryDirectory() as temporal:
            raiz = Path(temporal)
            entrada = {"archivo": tich.CATALOGO, "sha256": sha256_bytes(primero), "descargado_utc": VISTO}
            registrada = self.descargar_con(raiz, primero, {"descubrimiento": [entrada]})
            esperada = {"archivo": f"observaciones/{sha256_bytes(primero)}.html", "sha256": sha256_bytes(primero)}
            self.assertEqual(registrada["captura_edicion_nueva"], esperada)
            otra = self.descargar_con(raiz, primero + b"<p>Otra noticia</p>", registrada)
            self.assertEqual(otra["captura_edicion_nueva"], esperada)
            self.assertEqual(otra["edicion_nueva"]["sha256_catalogo"], sha256_bytes(primero))
            self.assertEqual((raiz / esperada["archivo"]).read_bytes(), primero)
            self.assertEqual(
                [ruta.name for ruta in (raiz / "observaciones").iterdir()], [f"{sha256_bytes(primero)}.html"]
            )
            (raiz / "otra").mkdir()
            sin_captura = self.descargar_con(raiz / "otra", primero + b"<p>Otra</p>", registrada)
            self.assertNotIn("captura_edicion_nueva", sin_captura)
            de_vuelta = self.descargar_con(raiz, catalogo().encode(), otra)
            self.assertNotIn("captura_edicion_nueva", de_vuelta)

    def test_la_fecha_observada_se_conserva_mientras_sigan_el_anio_y_el_estado(self) -> None:
        """Otra huella con el mismo año y estado conserva la fecha; otro estado la renueva; volver a 2025 la retira."""
        antes = catalogo(2026, 2025).encode()
        previa = {
            "edicion": edicion_del_catalogo(antes.decode()),
            "edicion_nueva": {
                "estado": "publicada-sin-microdatos",
                "anio": "2026",
                "observado_utc": VISTO,
                "sha256_catalogo": sha256_bytes(antes),
            },
            "descubrimiento": [{"archivo": tich.CATALOGO, "sha256": sha256_bytes(antes), "descargado_utc": VISTO}],
        }
        for cuerpo, esperada in (
            (antes + b"<p>Otra noticia</p>", ("publicada-sin-microdatos", VISTO)),
            (catalogo(2026, 2026).encode(), ("pendiente-de-incorporar", AHORA)),
            (catalogo(2027, 2025).encode(), ("publicada-sin-microdatos", AHORA)),
            (catalogo().encode(), None),
        ):
            with self.subTest(esperada=esperada), tempfile.TemporaryDirectory() as temporal:
                registrada = self.descargar_con(Path(temporal), cuerpo, previa)
                if esperada is None:
                    self.assertNotIn("edicion_nueva", registrada)
                    self.assertEqual(ediciones_del_dato(registrada, "2025"), {"anios_medidos": ["2025"]})
                    continue
                nueva = registrada["edicion_nueva"]
                self.assertEqual((nueva["estado"], nueva["observado_utc"]), esperada)
                # La huella publicada es la de la primera observación de ese año y estado; la de cada consulta, en
                # la entrada del catálogo.
                misma = esperada == ("publicada-sin-microdatos", VISTO)
                self.assertEqual(nueva["sha256_catalogo"], sha256_bytes(antes if misma else cuerpo))
                self.assertEqual(registrada["descubrimiento"][0]["sha256"], sha256_bytes(cuerpo))

    def test_una_observacion_anterior_corrupta_se_descarta_con_su_motivo_y_se_observa_de_nuevo(self) -> None:
        """La descarga no se bloquea en cada ciclo: la observación mal formada se descarta y se fecha esta consulta."""
        cuerpo = catalogo(2026, 2025).encode()
        previa = {
            "edicion": edicion_del_catalogo(cuerpo.decode()),
            "edicion_nueva": {"estado": "publicada-sin-microdatos", "anio": "2026x", "observado_utc": VISTO},
            "descubrimiento": [{"archivo": tich.CATALOGO, "sha256": sha256_bytes(cuerpo), "descargado_utc": VISTO}],
        }
        consulta = "2026-11-20T03:00:00+00:00"
        with tempfile.TemporaryDirectory() as temporal, mock.patch.object(tich, "ahora_utc", return_value=consulta):
            registrada = self.descargar_con(Path(temporal), cuerpo, previa)
        self.assertEqual(registrada["edicion_nueva"]["observado_utc"], consulta)
        self.assertIn("forma esperada", registrada["edicion_nueva_descartada"])
        self.assertEqual(ediciones_del_dato(registrada, "2025")["edicion_nueva"], registrada["edicion_nueva"])

    def test_el_dato_declara_sus_ediciones_y_rechaza_observaciones_mal_formadas(self) -> None:
        """Sin observación, el dato solo declara su año; una observación mal formada o que no casa detiene."""
        self.assertEqual(ediciones_del_dato({}, "2025"), {"anios_medidos": ["2025"]})
        cuerpo = catalogo(2026, 2025).encode()
        buena = {
            "estado": "publicada-sin-microdatos",
            "anio": "2026",
            "observado_utc": VISTO,
            "sha256_catalogo": sha256_bytes(cuerpo),
        }
        base = {
            "edicion": edicion_del_catalogo(cuerpo.decode()),
            "descubrimiento": [{"archivo": tich.CATALOGO, "sha256": sha256_bytes(cuerpo)}],
        }
        self.assertEqual(ediciones_del_dato({**base, "edicion_nueva": buena}, "2025")["edicion_nueva"], buena)
        for mala, motivo in (
            ({**buena, "anio": "2025"}, "forma esperada"),
            ({**buena, "anio": "999"}, "forma esperada"),
            ({**buena, "anio": "2026x"}, "forma esperada"),
            ({**buena, "estado": "fallo"}, "forma esperada"),
            ({key: valor for key, valor in buena.items() if key != "sha256_catalogo"}, "forma esperada"),
            ({**buena, "observado_utc": "ayer"}, "forma esperada"),
            ({**buena, "observado_utc": "2026-11-12T03:00:00"}, "forma esperada"),
            ({**buena, "observado_utc": "2026-13-12T03:00:00+00:00"}, "forma esperada"),
            ({**buena, "sha256_catalogo": "y" * 64}, "forma esperada"),
            ("2026", "forma esperada"),
            ({**buena, "estado": "pendiente-de-incorporar"}, "no casa"),
            ({**buena, "anio": "2027"}, "no casa"),
        ):
            with self.subTest(mala=mala), self.assertRaisesRegex(FormatoInesperado, motivo):
                ediciones_del_dato({**base, "edicion_nueva": mala}, "2025")
        with self.assertRaisesRegex(FormatoInesperado, "sin el catálogo"):
            ediciones_del_dato({"edicion_nueva": buena}, "2025")
        with self.assertRaisesRegex(FormatoInesperado, "que la procedencia no observa"):
            ediciones_del_dato(base, "2025")

    def test_los_anios_medidos_van_en_orden_sin_repetir_y_terminan_en_el_vigente(self) -> None:
        """Una serie vacía, desordenada, repetida o que no acaba en el año calculado se rechaza."""
        self.assertEqual(anios_medidos_validos(["2025", "2026"], "2026"), ["2025", "2026"])
        for mala in ([], ["2026", "2025"], ["2025", "2025"], ["2025"], ["25", "2026"], "2026", [2026]):
            with self.subTest(mala=mala), self.assertRaisesRegex(FormatoInesperado, "años medidos"):
                anios_medidos_validos(mala, "2026")

    def test_el_conjunto_validado_lleva_la_observacion_de_su_procedencia(self) -> None:
        """Validar publica la edición calculada con sus años medidos y la edición nueva que registró la descarga."""
        cuerpo = catalogo(2026, 2025).encode()
        nueva = {
            "estado": "publicada-sin-microdatos",
            "anio": "2026",
            "observado_utc": VISTO,
            "sha256_catalogo": sha256_bytes(cuerpo),
        }
        preparado = {
            "estimaciones": {"espana_isco2": {}, "espana_isco1": {}},
            "clases_por_isco2": {},
            "grupos_isco": {},
            "contraste_errores": {},
            "contraste_no_sabe_como": {"descripcion": None, "por_clase": {}},
            "enunciado": {"diferencias": [], "sha256_cuestionario": "0" * 64},
            "secciones_en_muestra": {"espana": 2500, "cataluna": 216, "sha256": "0" * 64},
            "edicion": primera(),
            "poblacion_isco2": {},
            "epa_isco2": {},
        }
        archivos = {
            tich.ESTIMACIONES: preparado,
            tich.PUBLICADAS: {"errores": {}},
            tich.PROCEDENCIA: {
                "archivos": [],
                "edicion": edicion_del_catalogo(cuerpo.decode()),
                "edicion_nueva": nueva,
                "edicion_nueva_descartada": "TIC-H: no tiene la forma esperada",
                "descubrimiento": [{"archivo": tich.CATALOGO, "sha256": sha256_bytes(cuerpo)}],
            },
        }
        auxiliares = (
            "controles_de_huella",
            "_controles_publicadas",
            "_controles_grupos",
            "_controles_correspondencia",
            "_controles_regla",
            "contraste_errores_ine",
            "_controles_epa",
            "_con_cifra",
        )
        with contextlib.ExitStack() as parches:
            for nombre in auxiliares:
                parches.enter_context(mock.patch.object(tich, nombre, return_value={}))
            parches.enter_context(
                mock.patch.object(tich, "leer_validado", return_value={"isco08_es": {}, "isco08_a_cno11": {}})
            )
            parches.enter_context(mock.patch.object(tich, "leer_json", side_effect=archivos.__getitem__))
            parches.enter_context(
                mock.patch.object(
                    tich,
                    "_conjunto_validado",
                    return_value={
                        "espana_isco2": {},
                        "espana_bloques": {},
                        "cataluna_grupos": {},
                        "cataluna_isco1": {},
                        "clase_por_isco2": {},
                        "grupos_sin_clase": [],
                    },
                )
            )
            cerrar = parches.enter_context(mock.patch.object(tich, "cerrar_validacion"))
            temporal = parches.enter_context(tempfile.TemporaryDirectory())
            parches.enter_context(mock.patch.object(tich, "ESTADO_EDICION", Path(temporal) / "edicion.json"))
            tich.validar()
        conjunto = cerrar.call_args.args[3]()
        self.assertEqual(conjunto["anios_medidos"], ["2025"])
        self.assertEqual(conjunto["edicion_nueva"], nueva)
        # El cálculo de contraste del motivo va al informe de validación, no al conjunto publicado.
        self.assertNotIn("contraste_no_sabe_como", conjunto)
        self.assertIn("contraste_no_sabe_como", cerrar.call_args.args[1])
        self.assertIn("Primer año de la pregunta: no hay serie.", cerrar.call_args.args[1]["limites"])
        informe = cerrar.call_args.args[1]
        self.assertEqual(informe["observacion_descartada"], "TIC-H: no tiene la forma esperada")
        self.assertFalse(any("descart" in c["control"] for c in informe["controles"]))

    def test_la_frase_de_limites_sale_de_los_anios_medidos(self) -> None:
        """Con una edición no hay serie; con dos, la frase dice desde cuándo y cuántas."""
        self.assertEqual(serie_medida({"anios_medidos": ["2025"]}), "Primer año de la pregunta: no hay serie.")
        self.assertEqual(serie_medida({"anios_medidos": ["2025", "2026"]}), "Serie de 2 ediciones, desde 2025.")

    def test_microdatos_admitidos_en_otra_direccion_se_detienen(self) -> None:
        """El ZIP de la edición admitida solo se acepta en la dirección del contrato."""
        edicion = {"anio_resultados": 2025, "anio_microdatos": 2025, "url_microdatos": "https://www.ine.es/otro.zip"}
        with self.assertRaisesRegex(FormatoInesperado, "no en la dirección admitida"):
            tich.ediciones.comprobar_edicion(edicion, "2025")

    def test_procedencia_con_catalogo_duplicado_se_rechaza_con_la_guarda_comun(self) -> None:
        """La búsqueda del descubrimiento previo es la común de la red, con su forma exigida."""
        cuerpo = catalogo().encode()
        with tempfile.TemporaryDirectory() as temporal:
            procedencia = Path(temporal) / "procedencia.json"
            procedencia.write_text(json.dumps({"descubrimiento": [{"archivo": tich.CATALOGO}] * 2}), encoding="utf-8")
            with (
                mock.patch.object(tich, "ORIGINAL", Path(temporal)),
                mock.patch.object(tich, "PROCEDENCIA", procedencia),
                mock.patch.object(red, "descargar_url", return_value=Descarga(cuerpo, tich.RESULTADOS, "text/html")),
                mock.patch.object(tich.epa_por_anio, "originales_de_la_edicion") as descargar,
                self.assertRaisesRegex(FormatoInesperado, "TIC-H: catálogo duplicado en procedencia"),
            ):
                tich.descargar()
            descargar.assert_not_called()

    def test_catalogo_y_sus_originales_quedan_vinculados_a_sus_respuestas(self) -> None:
        """Las cinco respuestas tienen originales exactos y el mismo catálogo conserva su fecha histórica."""
        with tempfile.TemporaryDirectory() as temporal:
            raiz = Path(temporal)
            recibo = raiz / "recibo.json"
            configuracion = json.dumps({"ruta": str(recibo), "fuente": "tich", "intento": "ediciones93"})
            fecha_previa = "2026-01-01T00:00:00+00:00"
            (raiz / "procedencia.json").write_text(
                json.dumps(
                    {
                        "archivos": [],
                        "descubrimiento": [
                            {
                                "archivo": tich.CATALOGO,
                                "sha256": sha256_bytes(catalogo().encode()),
                                "descargado_utc": fecha_previa,
                            }
                        ],
                    }
                )
            )

            def descargar(url: str, *_: object) -> Descarga:
                datos = catalogo().encode() if url == tich.RESULTADOS else b"original sintetico"
                observar(url, "GET", None, url, datos)
                return Descarga(datos, url, "text/html" if url == tich.RESULTADOS else "text/plain")

            with (
                mock.patch.dict("os.environ", {VARIABLE_RECEPCION: configuracion}),
                mock.patch.object(tich, "ORIGINAL", raiz),
                mock.patch.object(tich, "PROCEDENCIA", raiz / "procedencia.json"),
                mock.patch.object(red, "descargar_url", side_effect=descargar),
                mock.patch.object(tich.time, "sleep") as pausa,
                redirect_stdout(io.StringIO()),
                contexto_descarga(),
            ):
                tich.descargar()
            pausa.assert_called_once_with(red.PAUSA_ENTRE_PETICIONES_S)
            procedencia = json.loads((raiz / "procedencia.json").read_text())
            self.assertEqual(procedencia["edicion"], edicion_del_catalogo(catalogo()))
            self.assertEqual(
                [v["archivo"] for v in procedencia["archivos"]], [f"2025/{v['archivo']}" for v in ARCHIVOS]
            )
            descubrimiento = procedencia["descubrimiento"]
            self.assertEqual(len(descubrimiento), 1)
            self.assertEqual(descubrimiento[0]["archivo"], tich.CATALOGO)
            self.assertEqual(descubrimiento[0]["descargado_utc"], fecha_previa)
            self.assertEqual((raiz / tich.CATALOGO).read_text(), catalogo())
            peticiones = json.loads(recibo.read_text())["peticiones"]
            self.assertEqual(len(peticiones), 1 + len(ARCHIVOS))
            for peticion in peticiones:
                self.assertEqual(peticion["respuesta_sha256"], peticion["original_sha256"])
                self.assertEqual(peticion["bytes"], peticion["original_bytes"])

    def test_catalogo_redirigido_o_no_utf8_no_es_admitido(self) -> None:
        """Un transporte sin identidad o codificación verificable no inicia las descargas de datos."""
        for descarga, motivo in (
            (Descarga(catalogo().encode(), "https://otro.example/", "text/html"), "redirige"),
            (Descarga(b"\xff", tich.RESULTADOS, "text/html"), "UTF-8"),
        ):
            with (
                self.subTest(motivo=motivo),
                mock.patch.object(red, "descargar_url", return_value=descarga),
                mock.patch.object(red, "conservar_o_sustituir") as escribir,
                mock.patch.object(tich.epa_por_anio, "originales_de_la_edicion") as descargar,
                self.assertRaisesRegex(FormatoInesperado, motivo),
            ):
                tich.descargar()
            escribir.assert_not_called()
            descargar.assert_not_called()

    def test_catalogo_se_registra_al_completar_los_originales(self) -> None:
        """Con huella nueva, `descargado_utc` del catálogo es el momento posterior a los cuatro originales.

        Una entrada anterior con la misma huella y sin fecha falla también después de descargarlos, sin guardar la
        procedencia: TIC-H conserva el momento de su registro aunque comparta el descubrimiento con otras fuentes.
        """
        cuerpo = catalogo().encode()
        descarga = Descarga(cuerpo, tich.RESULTADOS, "text/html")
        for previo, esperado in (
            (None, "reloj"),
            ({"archivo": tich.CATALOGO, "sha256": sha256_bytes(cuerpo)}, KeyError),
        ):
            with self.subTest(previo=previo), tempfile.TemporaryDirectory() as carpeta:
                procedencia = Path(carpeta) / "procedencia.json"
                if previo is not None:
                    procedencia.write_text(json.dumps({"descubrimiento": [previo]}), encoding="utf-8")
                efectos: list[str] = []

                def descargar_originales(*_: object, efectos: list[str] = efectos) -> tuple[list[object], str, dict]:
                    efectos.append("originales")
                    return [], "2025", {}

                def conservar(*_: object, efectos: list[str] = efectos) -> bytes:
                    efectos.append("catalogo")
                    return cuerpo

                def reloj(efectos: list[str] = efectos) -> str:
                    efectos.append("reloj")
                    return "2026-10-29T03:00:00+00:00"

                with (
                    mock.patch.object(tich, "ORIGINAL", Path(carpeta)),
                    mock.patch.object(tich, "PROCEDENCIA", procedencia),
                    mock.patch.object(red, "descargar_url", return_value=descarga),
                    mock.patch.object(red, "conservar_o_sustituir", side_effect=conservar),
                    mock.patch.object(red, "observar_original"),
                    mock.patch.object(red, "ahora_utc", side_effect=reloj),
                    mock.patch.object(tich.epa_por_anio, "originales_de_la_edicion", side_effect=descargar_originales),
                    mock.patch.object(tich, "guardar_json") as guardar,
                    mock.patch.object(tich.time, "sleep"),
                ):
                    if esperado is KeyError:
                        with self.assertRaises(KeyError):
                            tich.descargar()
                        self.assertEqual(efectos, ["catalogo", "originales"])
                        guardar.assert_not_called()
                    else:
                        tich.descargar()
                        self.assertEqual(efectos, ["catalogo", "originales", "reloj"])
                        registro = guardar.call_args.args[1]["descubrimiento"][0]
                        self.assertEqual(registro["descargado_utc"], "2026-10-29T03:00:00+00:00")
                        self.assertEqual(registro["sha256"], sha256_bytes(cuerpo))


if __name__ == "__main__":
    unittest.main()
