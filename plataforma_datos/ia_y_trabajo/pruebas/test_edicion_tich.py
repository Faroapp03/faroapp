"""El estado de la edición admitida de la TIC-H y sus originales por año: forma, migración, escritura y lectores."""

import contextlib
import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from datetime import UTC, datetime
from email.message import Message
from pathlib import Path
from unittest import mock
from urllib.error import HTTPError

import plataforma_datos.ia_y_trabajo.fuentes.tich.lector as tich
from plataforma_datos.comun import red
from plataforma_datos.comun.entrada_salida import guardar_json, sha256_bytes
from plataforma_datos.comun.nucleo import DATOS_RELATIVOS, Descarga, FormatoInesperado, ValidacionFallida
from plataforma_datos.ia_y_trabajo.fuentes.tich import edicion as estado
from plataforma_datos.ia_y_trabajo.fuentes.tich.constantes import ARCHIVOS, CSV_INE
from plataforma_datos.ia_y_trabajo.fuentes.tich.edicion_nueva import ediciones_del_dato, observar
from plataforma_datos.ia_y_trabajo.fuentes.tich.ediciones import edicion_del_catalogo
from plataforma_datos.ia_y_trabajo.pruebas.test_ediciones_tich import catalogo
from plataforma_datos.orquestacion.ediciones_observadas import campos_del_panel

PAGINAS = Path(__file__).parent / "datos"
CATALOGO_REAL = (PAGINAS / "ine-tich-2026-operacion.html").read_bytes()


class PruebaEstadoDeLaEdicion(unittest.TestCase):
    """La edición admitida sale del estado; sin él, la primera, con el contrato de originales de siempre."""

    def test_la_primera_edicion_conserva_el_contrato_de_sus_originales(self) -> None:
        """Nombres, direcciones y títulos de 2025, como estaban fijados antes del estado."""
        primera = estado.primera()
        self.assertEqual(estado.archivos(primera), ARCHIVOS)
        self.assertEqual(
            [(archivo["archivo"], archivo["url"]) for archivo in ARCHIVOS],
            [
                ("tich-2025-microdatos.zip", "https://www.ine.es/ftp/microdatos/tich/datos_2025.zip"),
                ("ine-76444.csv", f"{CSV_INE}/76444.csv"),
                ("ine-76849.csv", f"{CSV_INE}/76849.csv"),
                (
                    "eurostat-lfsa_egai2d-ES-2025.json",
                    "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/lfsa_egai2d?format=JSON"
                    "&lang=EN&geo=ES&time=2025&age=Y15-74&sex=T&unit=THS_PER",
                ),
            ],
        )
        nombres = estado.nombres(primera)
        self.assertEqual(
            (nombres.datos, nombres.diseno), ("CSV/TICHcuestionario_2025.tab", "dr_TICHcuestionario_2025.json")
        )
        dos = {
            **primera,
            "anio": "2026",
            "anios_medidos": ["2025", "2026"],
            "tablas": {"uso": "82804", "errores": "82907"},
        }
        self.assertEqual(
            [archivo["archivo"] for archivo in estado.archivos(estado.valida(dos))],
            [
                "tich-2026-microdatos.zip",
                "ine-82804.csv",
                "ine-82907.csv",
                "eurostat-lfsa_egai2d-ES-2025.json",
            ],
        )

    def test_un_estado_mal_formado_se_rechaza(self) -> None:
        """Campos de más o de menos, años sin orden o sin terminar en el suyo, EPA posterior o tablas raras."""
        buena = {**estado.primera(), "anio": "2026", "anios_medidos": ["2025", "2026"]}
        self.assertEqual(estado.valida(buena)["anio"], "2026")
        for mala in (
            {**buena, "otro": 1},
            {clave: valor for clave, valor in buena.items() if clave != "epa_anio"},
            {**buena, "anios_medidos": ["2026", "2025"]},
            {**buena, "anios_medidos": ["2025"]},
            {**buena, "anios_medidos": ["2024", "2026"]},
            {**buena, "epa_anio": "2027"},
            {**buena, "tablas": {"uso": "x", "errores": "82907"}},
            {**buena, "anio": "26"},
            [],
        ):
            with self.subTest(mala=mala), self.assertRaisesRegex(FormatoInesperado, "estado de la edición"):
                estado.valida(mala)

    def test_sin_estado_la_primera_y_con_el_la_suya_escrito_entero(self) -> None:
        """Leer sin estado da 2025; guardar un estado mal formado no toca el anterior."""
        with tempfile.TemporaryDirectory() as temporal:
            ruta = Path(temporal) / "edicion.json"
            self.assertEqual(estado.leer(ruta), estado.primera())
            dos = {**estado.primera(), "anio": "2026", "anios_medidos": ["2025", "2026"]}
            estado.guardar(estado.valida(dos), ruta)
            antes = ruta.read_bytes()
            with self.assertRaises(FormatoInesperado):
                estado.guardar({**dos, "anio": "x"}, ruta)  # type: ignore[typeddict-item]
            self.assertEqual(ruta.read_bytes(), antes)
            self.assertEqual(estado.leer(ruta)["anio"], "2026")


class PruebaMigracionDeLosOriginales(unittest.TestCase):
    """Los originales sueltos pasan a la carpeta de su año sin perder su procedencia ni borrarse."""

    def sueltos(self, carpeta: Path, cambiado: str = "") -> dict:
        """Escribe la disposición anterior: originales sueltos y la procedencia que los registra.

        Returns:
            La procedencia escrita.
        """
        registros = []
        for archivo in ARCHIVOS:
            datos = f"original {archivo['archivo']}".encode()
            (carpeta / archivo["archivo"]).write_bytes(datos + (b"!" if archivo["archivo"] == cambiado else b""))
            registros.append({"archivo": archivo["archivo"], "sha256": sha256_bytes(datos), "descargado_utc": "x"})
        procedencia = {"fuente": "TIC-H", "cita": "INE", "edicion": {"anio_resultados": 2025}, "archivos": registros}
        guardar_json(carpeta / "procedencia.json", procedencia)
        return procedencia

    def test_migra_comprobando_cada_huella_y_conserva_los_registros(self) -> None:
        """Copias con su huella, procedencia del año con los mismos registros y la operación apuntando a ellas."""
        with tempfile.TemporaryDirectory() as temporal:
            carpeta = Path(temporal)
            antes = self.sueltos(carpeta)
            self.assertTrue(estado.migrar_originales_planos(carpeta))
            del_anio = json.loads((carpeta / "2025" / "procedencia.json").read_text(encoding="utf-8"))
            self.assertEqual(del_anio["anio"], "2025")
            self.assertEqual(del_anio["archivos"], antes["archivos"])
            operacion = json.loads((carpeta / "procedencia.json").read_text(encoding="utf-8"))
            self.assertEqual(operacion["edicion"], antes["edicion"])
            self.assertEqual([e["archivo"] for e in operacion["archivos"]], [f"2025/{a['archivo']}" for a in ARCHIVOS])
            for archivo in ARCHIVOS:
                self.assertEqual(
                    (carpeta / "2025" / archivo["archivo"]).read_bytes(), (carpeta / archivo["archivo"]).read_bytes()
                )
            self.assertFalse(estado.migrar_originales_planos(carpeta))
            # Las comprobaciones comunes de huella encuentran los originales con su ruta.
            with (
                mock.patch.object(tich, "ORIGINAL", carpeta),
                mock.patch.object(tich, "PROCEDENCIA", carpeta / "procedencia.json"),
            ):
                self.assertEqual(
                    tich._original(estado.primera(), ARCHIVOS[1]["archivo"]), carpeta / "2025" / ARCHIVOS[1]["archivo"]
                )

    def test_un_original_sin_su_huella_no_se_migra_y_se_sigue_leyendo_donde_estaba(self) -> None:
        """La migración se detiene antes de cambiar la procedencia de la operación."""
        with tempfile.TemporaryDirectory() as temporal:
            carpeta = Path(temporal)
            self.sueltos(carpeta, cambiado=ARCHIVOS[2]["archivo"])
            antes = (carpeta / "procedencia.json").read_bytes()
            with self.assertRaisesRegex(FormatoInesperado, "no conserva su huella"):
                estado.migrar_originales_planos(carpeta)
            self.assertEqual((carpeta / "procedencia.json").read_bytes(), antes)
            self.assertFalse((carpeta / "2025" / "procedencia.json").exists())


class PruebaLectoresDelEstado(unittest.TestCase):
    """validar escribe el estado solo al admitir; el panel y la descarga leen el año de él."""

    def validar(self, cerrar: mock.Mock, ruta: Path, edicion: estado.Edicion | None = None) -> None:
        """Ejecuta validar con los controles fijos y el cierre dado.

        Raises:
            ValidacionFallida: Si el cierre la lanza.
        """
        anio = int((edicion or estado.primera())["anio"])
        cuerpo = catalogo(anio, anio).encode()
        preparado = {
            "edicion": edicion or estado.primera(),
            "estimaciones": {
                clave: {}
                for clave in (
                    "espana_isco2",
                    "espana_isco1",
                    "espana_bloques",
                    "espana_grupos",
                    "cataluna_isco1",
                    "cataluna_grupos",
                )
            },
            "clases_por_isco2": {},
            "grupos_isco": {},
            "contraste_errores": {},
            "contraste_no_sabe_como": {"descripcion": None, "por_clase": {}},
            "enunciado": {"diferencias": [], "sha256_cuestionario": "0" * 64},
            "secciones_en_muestra": {"espana": 2500, "cataluna": 216, "sha256": "0" * 64},
            "poblacion_isco2": {},
            "epa_isco2": {},
        }
        archivos = {
            tich.ESTIMACIONES: preparado,
            tich.PUBLICADAS: {"errores": {}},
            tich.PROCEDENCIA: {
                "archivos": [],
                "edicion": edicion_del_catalogo(cuerpo.decode()),
                "descubrimiento": [{"archivo": tich.CATALOGO, "sha256": sha256_bytes(cuerpo)}],
            },
        }
        with contextlib.ExitStack() as parches:
            for nombre in (
                "controles_de_huella",
                "_controles_publicadas",
                "_controles_grupos",
                "_controles_correspondencia",
                "_controles_regla",
                "contraste_errores_ine",
                "_controles_epa",
            ):
                parches.enter_context(mock.patch.object(tich, nombre, return_value={}))
            parches.enter_context(
                mock.patch.object(tich, "leer_validado", return_value={"isco08_es": {}, "isco08_a_cno11": {}})
            )
            parches.enter_context(mock.patch.object(tich, "leer_json", side_effect=archivos.__getitem__))
            parches.enter_context(mock.patch.object(tich, "cerrar_validacion", cerrar))
            parches.enter_context(mock.patch.object(tich, "ESTADO_EDICION", ruta))
            tich.validar()

    def test_validar_escribe_el_estado_solo_si_admite_el_conjunto(self) -> None:
        """Con un control fallido no hay estado; admitido, el estado es el de la edición calculada."""
        with tempfile.TemporaryDirectory() as temporal:
            ruta = Path(temporal) / "edicion.json"
            with self.assertRaises(ValidacionFallida):
                self.validar(mock.Mock(side_effect=ValidacionFallida("tich")), ruta)
            self.assertFalse(ruta.exists())
            self.validar(mock.Mock(), ruta)
            self.assertEqual(estado.leer(ruta), estado.primera())

    def test_la_epa_del_anio_queda_en_el_estado_al_admitir(self) -> None:
        """Preparada con la EPA de su año, la edición la registra en el estado; otra edición preparada se detiene."""
        dos = estado.valida({**estado.primera(), "anio": "2026", "anios_medidos": ["2025", "2026"]})
        with tempfile.TemporaryDirectory() as temporal:
            ruta = Path(temporal) / "edicion.json"
            estado.guardar(dos, ruta)
            self.validar(mock.Mock(), ruta, {**dos, "epa_anio": "2026"})
            self.assertEqual(estado.leer(ruta)["epa_anio"], "2026")
            with self.assertRaisesRegex(FormatoInesperado, "otra edición"):
                self.validar(mock.Mock(), ruta, estado.primera())
            self.assertEqual(estado.leer(ruta)["anio"], "2026")

    def test_el_panel_lee_el_anio_admitido_del_estado(self) -> None:
        """Con 2026 admitido, un catálogo que anuncia 2026 no es edición nueva; con 2025, sí."""
        cuerpo = catalogo(2026, 2026).encode()
        procedencia = {
            "archivos": [],
            "edicion": edicion_del_catalogo(cuerpo.decode()),
            "edicion_nueva": {
                "estado": "pendiente-de-incorporar",
                "anio": "2026",
                "observado_utc": "2026-11-12T03:00:00+00:00",
                "sha256_catalogo": sha256_bytes(cuerpo),
            },
            "descubrimiento": [{"archivo": tich.CATALOGO, "sha256": sha256_bytes(cuerpo)}],
        }
        ahora = datetime(2026, 11, 15, tzinfo=UTC)
        with tempfile.TemporaryDirectory() as temporal:
            raiz = Path(temporal)
            originales = raiz / DATOS_RELATIVOS / "originales" / "tich"
            originales.mkdir(parents=True)
            (originales / "procedencia.json").write_text(json.dumps(procedencia), encoding="utf-8")
            self.assertEqual(campos_del_panel(raiz, "tich", ahora)["edicionNueva"]["anio"], "2026")
            validados = raiz / DATOS_RELATIVOS / "validados" / "tich"
            validados.mkdir(parents=True)
            sin_observacion = {**procedencia}
            del sin_observacion["edicion_nueva"]
            (originales / "procedencia.json").write_text(json.dumps(sin_observacion), encoding="utf-8")
            estado.guardar(
                estado.valida({**estado.primera(), "anio": "2026", "anios_medidos": ["2025", "2026"]}),
                validados / "edicion.json",
            )
            self.assertEqual(campos_del_panel(raiz, "tich", ahora), {})
            (validados / "edicion.json").write_text("{}", encoding="utf-8")
            self.assertEqual(campos_del_panel(raiz, "tich", ahora), {"avisoEdicion": "edicion-no-verificable"})


class PruebaHuellaDelDatoPublicado(unittest.TestCase):
    """El dato publicado no cambia con cada consulta del catálogo, que el INE compone en cada petición."""

    def test_dos_consultas_con_otra_huella_dan_el_mismo_dato_byte_a_byte(self) -> None:
        """Mismo año y estado, catálogos con bytes distintos: el mismo dato publicado; la huella nueva, aparte."""
        primero, segundo = CATALOGO_REAL, CATALOGO_REAL + b"\n"
        edicion = edicion_del_catalogo(primero.decode())
        procedencias = []
        anterior = None
        for cuerpo, cuando in ((primero, "2026-11-15T00:36:01Z"), (segundo, "2026-11-22T00:36:01Z")):
            entrada = {"archivo": tich.CATALOGO, "sha256": sha256_bytes(cuerpo), "descargado_utc": cuando}
            observada = observar(edicion, entrada, anterior, cuando, "2025")
            anterior = {"edicion": edicion, **observada, "descubrimiento": [entrada]}
            procedencias.append(anterior)
        publicados = [json.dumps(ediciones_del_dato(p, "2025"), sort_keys=True).encode() for p in procedencias]
        self.assertEqual(publicados[0], publicados[1])
        self.assertNotEqual(
            procedencias[0]["descubrimiento"][0]["sha256"], procedencias[1]["descubrimiento"][0]["sha256"]
        )


class PruebaDescargaConLaRedCaida(unittest.TestCase):
    """Un índice del INE que falla por la red detiene la navegación, no la consulta."""

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

    def test_un_503_o_un_tiempo_agotado_terminan_en_0_y_guardan_la_procedencia(self) -> None:
        """Los originales de 2025 llegan; la navegación queda detenida por «red» con su detalle."""
        for error in (
            HTTPError("https://www.ine.es/dynt3/inebase/index.htm", 503, "Service Unavailable", Message(), None),
            TimeoutError("tiempo agotado"),
        ):

            def responder(url: str, *_: object, error: OSError = error, **__: object) -> Descarga:
                if url == tich.RESULTADOS:
                    return Descarga(CATALOGO_REAL, url, "text/html")
                if "/dynt3/inebase/" in url:
                    raise error
                return Descarga(b"original", url, "text/plain")

            with self.subTest(error=type(error).__name__), tempfile.TemporaryDirectory() as temporal:
                raiz = Path(temporal)
                with (
                    mock.patch.object(tich, "ORIGINAL", raiz),
                    mock.patch.object(tich, "PROCEDENCIA", raiz / "procedencia.json"),
                    mock.patch.object(red, "descargar_url", side_effect=responder),
                    mock.patch.object(tich.time, "sleep"),
                    redirect_stdout(io.StringIO()),
                ):
                    self.assertEqual(tich.main(["descargar", "--aceptar-cambio"]), 0)
                procedencia = json.loads((raiz / "procedencia.json").read_text(encoding="utf-8"))
                self.assertEqual(procedencia["tablas_edicion_nueva_detenida"]["motivo"], "red")
                self.assertIn(type(error).__name__, procedencia["tablas_edicion_nueva_detenida"]["detalle"])
                self.assertEqual(len(procedencia["archivos"]), len(ARCHIVOS))
                self.assertTrue((raiz / "2025" / "procedencia.json").exists())


if __name__ == "__main__":
    unittest.main()
