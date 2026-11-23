"""Pruebas autónomas de la TIC-H: estimaciones, publicación, correspondencias y descargas simuladas."""

import io
import json
import re
import tempfile
import unittest
import zipfile
from contextlib import ExitStack, redirect_stdout
from pathlib import Path
from unittest import mock

import plataforma_datos.ia_y_trabajo.fuentes.tich.constantes as constantes_tich
import plataforma_datos.ia_y_trabajo.fuentes.tich.lector as tich
from plataforma_datos.comun import red
from plataforma_datos.comun.entrada_salida import guardar_json, sha256_bytes
from plataforma_datos.comun.nucleo import Controles, Descarga, FormatoInesperado, OriginalCambiado
from plataforma_datos.comun.textos_y_cifras import numero_con_coma
from plataforma_datos.ia_y_trabajo.fuentes.tich import estimacion
from plataforma_datos.ia_y_trabajo.fuentes.tich.constantes import ARCHIVOS
from plataforma_datos.ia_y_trabajo.fuentes.tich.edicion import primera
from plataforma_datos.ia_y_trabajo.pruebas.test_documentos_tich import diseno_de_la_pregunta


class PruebaTich(unittest.TestCase):
    """Reglas de la TIC-H con datos mínimos, sin originales ni preparados operativos."""

    def test_un_archivo_del_zip_mayor_que_el_tope_no_se_descomprime(self) -> None:
        """Un archivo de dentro de un zip que declara más bytes que el tope se rechaza; uno que cabe, no."""
        contenido = io.BytesIO()
        with zipfile.ZipFile(contenido, "w", zipfile.ZIP_DEFLATED) as escrito:
            escrito.writestr("datos.tab", b"0" * 10)
        with zipfile.ZipFile(io.BytesIO(contenido.getvalue())) as libro:
            self.assertEqual(tich.leer_del_zip(libro, "datos.tab", 10), b"0" * 10)
        with zipfile.ZipFile(io.BytesIO(contenido.getvalue())) as libro, self.assertRaises(FormatoInesperado):
            tich.leer_del_zip(libro, "datos.tab", 9)

    def test_los_microdatos_se_leen_con_el_tope_de_la_fuente(self) -> None:
        """Al leer los microdatos, el zip interior y cada archivo de dentro se limitan con MAX_MIEMBRO_BYTES de tich.

        El zip interior va comprimido: un archivo de dentro puede declarar más bytes que el zip que lo contiene, y así
        cada caso supera el tope solo en el archivo que nombra el error.
        """
        relleno = " " * 10_000
        # Un diseño de registro con la pregunta: el del caso de los datos tiene que pasar su comprobación.
        valido = json.dumps(diseno_de_la_pregunta())
        casos = (
            ("{}", "", -1, constantes_tich.FICHERO_CUESTIONARIO),
            (
                "{" + relleno + "}",
                "",
                0,
                constantes_tich.nombres_del_anio("2025", constantes_tich.TABLAS_DE_LA_PRIMERA, "2025").diseno,
            ),
            (
                valido,
                relleno,
                0,
                constantes_tich.nombres_del_anio("2025", constantes_tich.TABLAS_DE_LA_PRIMERA, "2025").datos,
            ),
        )
        for diseno, datos, margen, excedido in casos:
            interno = io.BytesIO()
            with zipfile.ZipFile(interno, "w", zipfile.ZIP_DEFLATED) as escrito:
                escrito.writestr(
                    constantes_tich.nombres_del_anio("2025", constantes_tich.TABLAS_DE_LA_PRIMERA, "2025").diseno,
                    diseno,
                )
                escrito.writestr(
                    constantes_tich.nombres_del_anio("2025", constantes_tich.TABLAS_DE_LA_PRIMERA, "2025").datos, datos
                )
            with self.subTest(excedido=excedido), tempfile.TemporaryDirectory() as temporal:
                microdatos = Path(temporal) / "microdatos.zip"
                with zipfile.ZipFile(microdatos, "w") as escrito:
                    escrito.writestr(constantes_tich.FICHERO_CUESTIONARIO, interno.getvalue())
                with (
                    mock.patch.object(tich, "original", return_value=microdatos),
                    mock.patch.object(tich, "MAX_MIEMBRO_BYTES", len(interno.getvalue()) + margen),
                    self.assertRaisesRegex(FormatoInesperado, f"^{re.escape(excedido)}: declara"),
                ):
                    tich._cuestionario(primera())

    def test_numero_con_la_tipografia_del_ine(self) -> None:
        """Punto de miles y coma decimal."""
        self.assertEqual(numero_con_coma("37.132.240"), 37132240)
        self.assertEqual(numero_con_coma("33,7"), 33.7)

    def test_estimacion_ponderada_con_tamano_efectivo_de_kish(self) -> None:
        """El peso cuenta en el porcentaje, y pesos desiguales reducen la muestra efectiva.

        Con pesos 2, 1, 1 y 4, el tamaño efectivo de Kish es (Σw)² / Σw² = 64 / 22 ≈ 2,9, que se redondea a 3: menos
        que las 4 personas de la muestra, aun después de redondear.
        """
        filas = [
            {"FACTOR_P": "2", "IAG_TRAB": "1"},
            {"FACTOR_P": "1", "IAG_TRAB": "6"},
            {"FACTOR_P": "1", "IAG_TRAB": "6"},
            {"FACTOR_P": "4", "IAG_TRAB": ""},
        ]
        estimacion = tich.estimar(filas, "IAG_TRAB", 100)
        self.assertEqual(estimacion["pct"], 25.0)
        self.assertEqual((estimacion["muestra"], estimacion["muestra_efectiva"], estimacion["poblacion"]), (4, 3, 8))
        self.assertLess(estimacion["muestra_efectiva"], estimacion["muestra"])
        self.assertEqual(estimacion["regla_nchs"]["motivos"][0], "n o n efectiva < 30")

    def test_sin_muestra_suficiente_no_hay_cifra(self) -> None:
        """Un grupo con 99 personas encuestadas dice su muestra, pero no da porcentaje."""
        filas = [{"FACTOR_P": "1", "IAG_TRAB": "1"}] * 99
        self.assertEqual(estimacion._estimaciones({"35": filas}, 100), {"35": {"muestra": 99}})

    def test_la_cifra_que_no_pasa_la_regla_no_llega_al_motor(self) -> None:
        """Una cifra que no pasa la regla del NCHS no entra en el paquete; las demás, sin el detalle de la regla."""
        usan = 5  # 5 de 150: un porcentaje pequeño con un intervalo demasiado ancho para la regla del NCHS
        filas = [{"FACTOR_P": "1", "IAG_TRAB": "1" if i < usan else "6"} for i in range(150)]
        mitad = [{"FACTOR_P": "1", "IAG_TRAB": "1" if i % 2 else "6"} for i in range(150)]
        estimaciones = estimacion._estimaciones({"53": filas, "54": mitad}, 2405)
        self.assertFalse(estimaciones["53"]["regla_nchs"]["publicable"])
        self.assertEqual(list(tich._con_cifra(estimaciones)), ["54"])
        self.assertNotIn("regla_nchs", tich._con_cifra(estimaciones)["54"])

    def test_grados_de_libertad_del_diseno(self) -> None:
        """Secciones en muestra menos los estratos (comunidad y tamaño del municipio) con muestra."""
        filas = [{"CCAA": "09", "HABITAT_ESTRATO": "0"}, {"CCAA": "09", "HABITAT_ESTRATO": "6"}] * 3
        self.assertEqual(tich.grados_del_diseno(filas, 216), 214)

    def test_clase_manual_de_cada_grupo(self) -> None:
        """El reparto de cada grupo en entrevistas por la clase que el INE da a sus personas; «NS/NR» no es un grupo."""
        filas = [
            {"OCUPACION": "41", "OCUPACION1": "6"},
            {"OCUPACION": "93", "OCUPACION1": "1"},
            {"OCUPACION": "99", "OCUPACION1": "1"},
            {"OCUPACION": "52", "OCUPACION1": "6"},
            {"OCUPACION": "52", "OCUPACION1": "1"},
        ]
        self.assertEqual(
            tich.clases_por_isco2(filas),
            {"41": {"no_manual": 1}, "52": {"manual": 1, "no_manual": 1}, "93": {"manual": 1}},
        )

    def test_paso_de_la_cno11_a_la_isco08(self) -> None:
        """Cada código CNO-11 lleva a todos los grupos ISCO-08 de 2 cifras con que se corresponde."""
        correspondencia = {"4110": [{"cno11": "4309"}], "4419": [{"cno11": "4309"}], "5322": [{"cno11": "5710"}]}
        self.assertEqual(tich.isco2_por_cno11(correspondencia), {"4309": ["41", "44"], "5710": ["53"]})

    def test_paso_por_bloque_grupo_o_gran_grupo(self) -> None:
        """Desde la CNO-11 se llega al bloque si lo hay; si no, al grupo de 2 cifras; si no, a su gran grupo."""
        conjunto = {
            "bloque_por_isco2": {"35": "25+35"},
            "espana_bloques": {"25+35": {"pct": 73.6}},
            "espana_isco2": {"23": {"pct": 59.1}},
            "espana_isco1": {"4": {"pct": 20.7}},
        }
        self.assertEqual(tich.cifra_por_isco2(conjunto, "35"), {"pct": 73.6})
        self.assertEqual(tich.cifra_por_isco2(conjunto, "23"), {"pct": 59.1})
        self.assertEqual(tich.cifra_por_isco2(conjunto, "42"), {"pct": 20.7})
        self.assertIsNone(tich.cifra_por_isco2(conjunto, "03"))

    def test_el_paso_no_usa_grupos_que_la_entrevista_reparte_distinto(self) -> None:
        """Los grandes grupos 1 y 4 van enteros y el 25 va en su bloque, aunque tengan muestra; el 23 tiene su cifra."""
        grupos = {codigo: {"pct": 1.0, "regla_nchs": {"publicable": True}} for codigo in ("11", "23", "25", "41", "42")}
        self.assertEqual(list(tich._de_paso(grupos)), ["23"])

    def test_razon_de_cuota_dentro_del_gran_grupo(self) -> None:
        """La misma cuota dentro de su gran grupo da ×1, aunque el gran grupo pese distinto en cada encuesta."""
        poblacion = {"41": 30, "42": 10, "23": 50}
        epa = {"41": 150, "42": 150, "23": 400}
        self.assertEqual(tich.razones_de_cuota(poblacion, epa), {"41": 1.5, "42": 0.5, "23": 1.0})

    def test_razon_del_bloque_en_el_total_de_ocupados(self) -> None:
        """Un bloque de dos grandes grupos se mide en el total: el 25 y el 35 juntos, aunque se repartan al revés."""
        poblacion = {"25": 30, "35": 10, "41": 60}
        epa = {"25": 10, "35": 30, "41": 60}
        self.assertEqual(tich.razon_del_bloque(["25", "35"], poblacion, epa), 1.0)

    def test_la_regla_detiene_la_validacion_si_un_grupo_se_reparte_distinto(self) -> None:
        """Con otro año de la TIC-H, un grupo que se da a 2 cifras fuera de la mitad al doble es un control fallido."""
        epa = {"23": 50, "24": 50, "25": 20, "35": 20}
        conjunto = {"espana_isco2": {"23": {}, "24": {}}}
        dentro, fuera = Controles(), Controles()
        parecida = {"23": 60, "24": 40, "25": 20, "35": 20}
        distinta = {"23": 95, "24": 5, "25": 20, "35": 20}
        tich._controles_epa(dentro, {"poblacion_isco2": parecida, "epa_isco2": epa}, conjunto)
        tich._controles_epa(fuera, {"poblacion_isco2": distinta, "epa_isco2": epa}, conjunto)
        self.assertTrue(dentro.admitido, dentro.fallidos)
        self.assertEqual(len(fuera.fallidos), 1)
        self.assertIn("fuera: {'24'", fuera.fallidos[0])

    def test_un_grupo_sin_cuota_en_la_epa_hace_fallar_el_control_y_se_nombra(self) -> None:
        """Si un grupo que se da a 2 cifras no está en la EPA, el control falla con su código, sin KeyError."""
        preparado = {"poblacion_isco2": {"11": 10.0, "12": 10.0}, "epa_isco2": {"11": 5.0, "13": 5.0}}
        controles = Controles()
        with mock.patch.object(tich, "BLOQUES", {}):
            tich._controles_epa(controles, preparado, {"espana_isco2": {"11": {}, "12": {}}})
        self.assertEqual(len(controles.fallidos), 1)
        self.assertIn("sin cuota en la EPA: ['12']", controles.fallidos[0])


class PruebaDescargaTich(unittest.TestCase):
    """Una descarga simulada conserva el control de versión de todos los originales de TIC-H."""

    def setUp(self) -> None:
        """Crea una carpeta aislada para originales y procedencia."""
        self.temporal = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporal.cleanup)
        self.carpeta = Path(self.temporal.name)
        validado = self.carpeta / "validados"
        self.enterContext(mock.patch.object(tich, "VALIDADO", validado))
        self.enterContext(mock.patch.object(tich, "ESTADO_EDICION", validado / "edicion.json"))

    def descargar(self, registrado: bytes) -> None:
        """Descarga bytes sintéticos contra una procedencia previa sin originales en disco."""
        procedencia = self.carpeta / "procedencia.json"
        del_anio = self.carpeta / "2025" / "procedencia.json"
        registros = [
            {
                "archivo": archivo["archivo"],
                "sha256": sha256_bytes(registrado),
                "descargado_utc": "2026-01-01T00:00:00+00:00",
            }
            for archivo in ARCHIVOS
        ]
        guardar_json(del_anio, {"anio": "2025", "archivos": registros})
        guardar_json(procedencia, {"archivos": [{**r, "archivo": f"2025/{r['archivo']}"} for r in registros]})
        catalogo = Descarga(
            b'<p>Resultados a\xc3\xb1o 2025</p><select id="ir_1254736063703">'
            b'<option value="/ftp/microdatos/tich/datos_2025.zip">'
            b"2025</option></select>",
            tich.RESULTADOS,
            "text/html",
        )

        def responder(url: str, *_: object) -> Descarga:
            return catalogo if url == tich.RESULTADOS else Descarga(b"nuevo", url, "text/plain")

        with ExitStack() as parches:
            parches.enter_context(mock.patch.object(tich.time, "sleep"))
            parches.enter_context(mock.patch.object(tich, "ORIGINAL", self.carpeta))
            parches.enter_context(mock.patch.object(tich, "PROCEDENCIA", procedencia))
            parches.enter_context(mock.patch.object(red, "descargar_url", side_effect=responder))
            parches.enter_context(redirect_stdout(io.StringIO()))
            tich.descargar(aceptar_cambio=False)

    def test_version_cambiada(self) -> None:
        """Si la descarga no coincide con la huella registrada, se detiene y no escribe originales."""
        with self.assertRaises(OriginalCambiado):
            self.descargar(b"antiguo")
        for archivo in ARCHIVOS:
            self.assertFalse((self.carpeta / "2025" / archivo["archivo"]).exists())

    def test_misma_version(self) -> None:
        """Si coincide con la huella registrada, recupera cada original."""
        self.descargar(b"nuevo")
        for archivo in ARCHIVOS:
            self.assertEqual((self.carpeta / "2025" / archivo["archivo"]).read_bytes(), b"nuevo")


if __name__ == "__main__":
    unittest.main()
