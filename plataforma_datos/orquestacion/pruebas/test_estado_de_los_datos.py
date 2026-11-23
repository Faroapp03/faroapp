"""Pruebas del estado de los datos que lee el doctor: el plazo de cada política, la edad y la última actualización."""

import io
import json
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from datetime import date
from pathlib import Path
from unittest import mock

from plataforma_datos.comun.nucleo import FormatoInesperado
from plataforma_datos.cursos.pruebas.test_abierta import documento
from plataforma_datos.orquestacion import estado_de_los_datos as estado
from plataforma_datos.orquestacion.estado_de_la_actualizacion import SIN_INTENTO
from plataforma_datos.orquestacion.modulos import IDS
from plataforma_datos.orquestacion.piezas_de_la_actualizacion import CARPETA_DE_INFORMES, FUENTES
from plataforma_datos.orquestacion.pruebas.test_estado_panel import documento as documento_estado


class PruebaEstadoDeLosDatos(unittest.TestCase):
    """Lo que el doctor recibe para juzgar el apartado «Datos»."""

    def setUp(self) -> None:
        """Documento sintético admitido para los nominales que necesitan formación abierta."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.raiz_operativa = Path(temporal.name) / "Mis documentos" / "Año 2026"
        carpeta = self.raiz_operativa / "var" / "actualizacion" / "preparados" / "abierta"
        carpeta.mkdir(parents=True)
        (carpeta / "fichas.json").write_text(json.dumps(documento()), encoding="utf-8")
        parche = mock.patch.object(estado, "RAIZ", self.raiz_operativa)
        parche.start()
        self.addCleanup(parche.stop)

    def test_el_plazo_sale_de_la_politica_de_cada_fuente(self) -> None:
        """Manual: su plazo de renovación; mensual o edición por red: mes y medio; fija: ninguno."""
        self.assertEqual(estado.plazo("cambra"), FUENTES["cambra"].renovar_dias)
        self.assertEqual(estado.plazo("ocupados"), estado.PLAZO_DE_LA_ACTUALIZACION_MENSUAL)
        self.assertIsNone(estado.plazo("esco"))

    def test_el_plazo_explicito_de_la_fuente_prevalece_sobre_el_margen_mensual(self) -> None:
        """El diagnóstico respeta la renovación declarada, sin tocar fecha ni vigencia de ofertas."""
        for nombre, dias in {
            "hp_life": 1,
            "cibervoluntarios": 1,
            "claude_academy": 1,
            "enlaces_lecturas": 7,
            "formacion": 90,
            "citilab": 30,
            "consorci": 30,
        }.items():
            with self.subTest(fuente=nombre):
                self.assertEqual(FUENTES[nombre].renovar_dias, dias)
                self.assertEqual(estado.plazo(nombre), dias)

    def test_la_edad_se_cuenta_desde_la_fecha_de_la_procedencia(self) -> None:
        """Días entre la fecha más reciente de la procedencia y hoy; sin procedencia, sin fecha."""
        with tempfile.TemporaryDirectory() as temporal:
            carpeta = Path(temporal) / "var" / "actualizacion" / "originales" / "cambra"
            carpeta.mkdir(parents=True)
            (carpeta / "procedencia.json").write_text('{"fecha": "2026-10-01"}', encoding="utf-8")
            filas = {fila["fuente"]: fila for fila in estado.estado_de_las_fuentes(Path(temporal), date(2026, 10, 7))}
        self.assertEqual(filas["cambra"]["dias"], 6)
        self.assertIsNone(filas["consorci"]["dias"])

    def test_la_ultima_actualizacion_es_el_informe_mas_reciente(self) -> None:
        """Entre varios informes fechados (se ordenan por el nombre, que es la fecha), el último; sin ninguno, None."""
        with tempfile.TemporaryDirectory() as temporal:
            raiz = Path(temporal)
            self.assertIsNone(estado.ultima_actualizacion(raiz))
            carpeta = raiz / CARPETA_DE_INFORMES
            carpeta.mkdir(parents=True)
            # Del más reciente al más antiguo, con uno intermedio: ni el orden de escritura ni el del sistema de
            # archivos dan el resultado; solo el nombre fechado.
            for nombre, veredicto in (
                ("2026-10-10-0400", "rojo"),
                ("2026-08-10-0400", "verde"),
                ("2026-09-10-0400", "ámbar"),
            ):
                datos = {"veredicto": veredicto, "utc": f"{nombre[:10]}T04:00:00+00:00"}
                (carpeta / f"{nombre}.json").write_text(json.dumps(datos), encoding="utf-8")
            ultima = estado.ultima_actualizacion(raiz)
        self.assertEqual(ultima["veredicto"], "rojo")
        self.assertEqual(ultima["informe"], f"{CARPETA_DE_INFORMES}/2026-10-10-0400.md")
        self.assertEqual(ultima["conservados"], [])

    def test_los_conservados_son_los_modulos_en_ambar_de_estado_json(self) -> None:
        """Por módulo en ámbar, de cuándo es su versión buena y su próximo reintento; los verdes no salen."""
        buena = {"publicada_utc": "2026-09-10T04:00:00+00:00", "huella": "x"}
        modulos = {
            "consorci": {"veredicto": "ámbar", "ultima_version_buena": buena, "proximo_reintento_utc": "2026-10-11"},
            "paquete": {"veredicto": "ámbar", "ultima_version_buena": None, "proximo_reintento_utc": "2026-10-11"},
            "esco": {"veredicto": "verde", "ultima_version_buena": buena, "proximo_reintento_utc": None},
        }
        with tempfile.TemporaryDirectory() as temporal:
            raiz = Path(temporal)
            (raiz / CARPETA_DE_INFORMES).mkdir(parents=True)
            (raiz / CARPETA_DE_INFORMES / "estado.json").write_text(
                json.dumps(
                    {
                        **documento_estado(),
                        "modulos": {
                            nombre: {**registro, **modulos.get(nombre, {})}
                            for nombre, registro in {k: dict(SIN_INTENTO) for k in IDS}.items()
                        },
                    }
                ),
                encoding="utf-8",
            )
            conservados = estado.conservados(raiz)
        self.assertEqual(
            conservados,
            [
                {
                    "modulo": "consorci",
                    "version_buena_utc": buena["publicada_utc"],
                    "proximo_reintento_utc": "2026-10-11",
                },
                {"modulo": "paquete", "version_buena_utc": None, "proximo_reintento_utc": "2026-10-11"},
            ],
        )

    def test_un_archivo_roto_da_un_motivo_y_no_una_traza(self) -> None:
        """Un fichas.json que no es JSON es FormatoInesperado (con su ruta); main lo escribe sin traza."""
        with tempfile.TemporaryDirectory() as temporal:
            carpeta = Path(temporal) / "var" / "actualizacion" / "preparados" / "abierta"
            carpeta.mkdir(parents=True)
            (carpeta / "fichas.json").write_text("{roto", encoding="utf-8")
            with self.assertRaisesRegex(FormatoInesperado, "fichas.json"):
                estado.revision_pendiente_de_la_formacion_abierta(Path(temporal), date(2026, 10, 7))
            with (
                mock.patch.object(estado, "RAIZ", Path(temporal)),
                redirect_stdout(io.StringIO()),
                redirect_stderr(io.StringIO()) as errores,
            ):
                self.assertEqual(estado.main(["--hoy", "2026-10-07"]), 1)
            self.assertIn("Error: ", errores.getvalue())

    def test_sin_fichas_admitidas_no_hay_revision_pendiente(self) -> None:
        """Sin ninguna ficha admitida no hay revisión pendiente; una fecha mal escrita no se confunde con ese caso."""
        with tempfile.TemporaryDirectory() as temporal:
            carpeta = Path(temporal) / "var" / "actualizacion" / "preparados" / "abierta"
            carpeta.mkdir(parents=True)
            (carpeta / "fichas.json").write_text('{"fichas": [], "plataformas": {}}', encoding="utf-8")
            self.assertIsNone(estado.revision_pendiente_de_la_formacion_abierta(Path(temporal), date(2026, 10, 7)))

    def test_la_formacion_abierta_admitida_tiene_fecha_de_revision(self) -> None:
        """Con fichas admitidas, una fecha AAAA-MM-DD; el ensayo operativo usa las mismas aserciones."""
        pendiente = estado.revision_pendiente_de_la_formacion_abierta(self.raiz_operativa, date(2026, 10, 7))
        self.assertIsNotNone(pendiente)
        # date.fromisoformat admite también «20261007»: solo la vuelta a texto exige la forma AAAA-MM-DD exacta.
        self.assertEqual(date.fromisoformat(pendiente).isoformat(), pendiente)

    def test_main_escribe_el_estado_con_sus_cinco_claves(self) -> None:
        """Contrato con el doctor: el JSON lleva el día y las cuatro secciones, y --hoy lo fija."""
        with redirect_stdout(io.StringIO()) as salida:
            self.assertEqual(estado.main(["--hoy", "2026-10-07"]), 0)
        datos = json.loads(salida.getvalue())
        self.assertEqual(
            set(datos), {"hoy", "fuentes", "formacion_abierta_revision_pendiente", "ultima_actualizacion", "cuarentena"}
        )
        self.assertEqual(datos["cuarentena"], [])
        self.assertEqual(datos["hoy"], "2026-10-07")
        self.assertTrue(all("plazo" in fila for fila in datos["fuentes"]))

    def test_sin_fecha_del_dato_fecha_y_dias_son_none(self) -> None:
        """Una fuente sin procedencia da None en «fecha» y «dias» (no una cadena vacía ni un 0)."""
        with tempfile.TemporaryDirectory() as temporal:
            filas = estado.estado_de_las_fuentes(Path(temporal), date(2026, 10, 7))
        self.assertTrue(filas)
        self.assertTrue(all(fila["fecha"] is None and fila["dias"] is None for fila in filas))


if __name__ == "__main__":
    unittest.main()
