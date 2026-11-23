"""Las fechas de la encuesta TIC de empresas salen del calendario del INE capturado, no de una tabla a mano.

`recortes/ine-calendario-recorte.ics` es un recorte del calendario de publicaciones del INE
(https://www.ine.es/dynt3/Calendario/calendario.ics, consultado el 15/11/2026; archivo completo de 1.781.879 bytes y
1.106 eventos, sha256 72a55e4163500bb031af39b09837590da9537b70d3849fc4602a2b569297ca5b). Conserva sus bytes tal cual
(finales de línea CRLF y líneas plegadas): la cabecera con su zona horaria, cuatro eventos seguidos (el anterior, los
de las ediciones 2024-2025 y 2025-2026 de la encuesta y el siguiente) y el cierre; se han quitado los demás eventos.
"""

import io
import unittest
from contextlib import redirect_stdout
from unittest import mock

from plataforma_datos.comun.descarga_acotada import descargar_acotados
from plataforma_datos.comun.entrada_salida import carpetas, guardar_json, leer_json, sha256
from plataforma_datos.comun.nucleo import FormatoInesperado, OriginalCambiado
from plataforma_datos.mercado.fuentes.empresas.piezas import calendario_ine, cifras_empresas, periodos_empresas
from plataforma_datos.mercado.pruebas.ayuda_productores import RECORTES, ConDatosAislados, Respuesta
from plataforma_datos.mercado.pruebas.ayuda_textos_sin_fecha import fechas_esperadas

RECORTE = (RECORTES / "ine-calendario-recorte.ics").read_text(encoding="utf-8")
EDICION_2026 = {"anio": 2026, "nombre": "2025–1T2026"}
CALENDARIO = "text/Calendar;charset=UTF8"
EUROSTAT = {"anio": 2025, "actualizado": "2026-06-15", "consulta": "15/11/2026"}
# El instante real de la captura: ya era 15/11/2026 en Barcelona y todavía 14/11 en UTC.
CAPTURA = "2026-11-14T23:40:38+00:00"


def evento(titulo: str, dia: str) -> str:
    """Un evento más, con la misma forma que los del calendario.

    Returns:
        El texto del evento.
    """
    return f"BEGIN:VEVENT\r\nDTSTART;TZID=Europe/Madrid:{dia}T110000\r\nSUMMARY:{titulo}\r\nEND:VEVENT\r\n"


def con(*eventos: str) -> str:
    """El recorte con eventos añadidos antes del cierre.

    Returns:
        El calendario.
    """
    return RECORTE.replace("END:VCALENDAR", "".join(eventos) + "END:VCALENDAR")


def titulo(desde: int) -> str:
    """El título de la edición que va de `desde` a `desde + 1`.

    Returns:
        El título.
    """
    return calendario_ine.TITULO.format(desde=desde, hasta=desde + 1)


class PruebaCalendarioIne(unittest.TestCase):
    """Una coincidencia por edición; sin la siguiente en el calendario, sin fecha."""

    def test_el_recorte_real_da_las_dos_publicaciones_y_ninguna_siguiente(self) -> None:
        """2024-2025 salió el 22/10/2025 y 2025-2026 el 22/10/2026; el calendario no trae aún 2026-2027."""
        self.assertEqual(calendario_ine.fechas(RECORTE, CAPTURA, 2025).publicado, "2025-10-22")
        fechas = calendario_ine.fechas(RECORTE, CAPTURA, 2026)
        self.assertEqual((fechas.publicado, fechas.siguiente), ("2026-10-22", None))
        self.assertIn("consultado el 15/11/2026: el calendario del INE aún no publica", fechas.calendario)

    def test_con_el_evento_de_la_siguiente_la_da(self) -> None:
        """Si el calendario capturado trae la edición siguiente, su fecha es la prevista."""
        fechas = calendario_ine.fechas(con(evento(titulo(2026), "20271021")), "2027-01-10T09:00:00+00:00", 2026)
        self.assertEqual(fechas.siguiente, "2027-10-21")

    def test_titulo_duplicado_o_ausente_es_fallo_de_metodo(self) -> None:
        """Dos eventos con el mismo título, o ninguno de la edición vigente, no dan ninguna fecha."""
        with self.assertRaisesRegex(FormatoInesperado, "aparece 2 veces"):
            calendario_ine.fechas(con(evento(titulo(2025), "20261023")), CAPTURA, 2026)
        # Sin el evento de la edición 2025-2026 (el que empieza el 22/10/2026), con lo demás tal cual.
        sin_la_edicion = "BEGIN:VEVENT".join(
            bloque for bloque in RECORTE.split("BEGIN:VEVENT") if "DTSTART;TZID=Europe/Madrid:20261022" not in bloque
        )
        with self.assertRaisesRegex(FormatoInesperado, "no trae la edición 2025-2026"):
            calendario_ine.fechas(sin_la_edicion, CAPTURA, 2026)

    def test_la_cita_lleva_la_fecha_de_la_captura_y_cambia_con_ella(self) -> None:
        """La vigencia de empresas cita la consulta real del calendario y su nota sin fecha inventada."""
        bloques = []
        for consulta in (CAPTURA, "2026-12-02T10:00:00+00:00"):
            fechas = calendario_ine.fechas(RECORTE, consulta, 2026)
            with mock.patch.object(calendario_ine, "capturadas", return_value=fechas):
                bloques.append(cifras_empresas._vigencias(EDICION_2026)["ine"])
        primero, segundo = bloques
        self.assertEqual((primero["publicado"], primero["siguiente_prevista"]), ("2026-10-22", None))
        self.assertIn("consultado el 15/11/2026", primero["calendario"])
        self.assertIn("consultado el 02/12/2026", segundo["calendario"])
        self.assertTrue(
            primero["calendario"].endswith("el calendario del INE aún no publica la edición siguiente (2026–2027)")
        )

    def test_los_calendarios_de_empresas_no_anuncian_nada_sin_evidencia(self) -> None:
        """La vigencia del INE (con y sin la siguiente), la de Eurostat y la de Cataluña no traen previsiones."""
        textos = []
        for calendario in (RECORTE, con(evento(titulo(2026), "20271021"))):
            fechas = calendario_ine.fechas(calendario, CAPTURA, 2026)
            with mock.patch.object(calendario_ine, "capturadas", return_value=fechas):
                partes = cifras_empresas._vigencias({**EDICION_2026, "eurostat": EUROSTAT})
            textos += [partes["ine"]["calendario"], partes["eurostat"]["calendario"]]
        filas = [{"nace": "C", "anio": 2025, "valor": 10.0, "marca": None}]
        textos.append(cifras_empresas.cataluna_por_seccion(filas, EUROSTAT)["vigencia"]["calendario"])
        for texto in textos:
            with self.subTest(texto=texto):
                self.assertEqual(fechas_esperadas(texto), [])
        self.assertIn("está anunciada en el calendario del INE para el 21/10/2027", textos[2])

    def test_la_guardia_detecta_previsiones_y_anios_futuros(self) -> None:
        """La guardia no deja pasar ninguna de las formas que tenían los textos retirados."""
        for texto in (
            "suele llegar a mediados de año",
            "(deducción por las ediciones anteriores)",
            "la edición siguiente sale el 22/10/2026",
            "el siguiente es el de 2031",
        ):
            with self.subTest(texto=texto):
                self.assertNotEqual(fechas_esperadas(texto, anio_en_curso=2026), [])
        self.assertEqual(fechas_esperadas("la edición siguiente (2026–2027)", anio_en_curso=2026), [])

    def test_la_cita_de_eurostat_lleva_el_dia_de_cataluna(self) -> None:
        """La consulta de Eurostat de `empresas` se cita con el día de Cataluña, como la del INE."""
        self.assertEqual(
            periodos_empresas.fechas_del_original({"updated": "2026-06-15T23:00:00+0200"}, {"descargado_utc": CAPTURA}),
            {"actualizado": "2026-06-15", "consulta": "15/11/2026"},
        )

    def test_la_captura_se_lee_de_la_procedencia_por_su_huella(self) -> None:
        """`capturadas` toma el calendario registrado y la fecha de su descarga."""
        procedencia = {"archivos": [{"archivo": calendario_ine.ARCHIVO, "descargado_utc": "2026-11-14T23:40:39+00:00"}]}
        ruta = mock.Mock(read_text=lambda **_: RECORTE)
        with (
            mock.patch.object(calendario_ine, "procedencia", return_value=procedencia),
            mock.patch.object(calendario_ine, "original", return_value=ruta) as original,
        ):
            fechas = calendario_ine.capturadas(2026)
        original.assert_called_once_with("empresas", calendario_ine.ARCHIVO)
        self.assertIn("consultado el 15/11/2026", fechas.calendario)


class PruebaCapturaDelCalendario(ConDatosAislados):
    """El calendario se acepta siempre y un fallo suyo no detiene `empresas`."""

    def descargar(self, respuesta: Respuesta) -> list[dict]:
        """Una descarga del calendario con el registrado de la procedencia, si lo hay.

        Returns:
            Lo que queda registrado.
        """
        procedencia = carpetas("empresas").original / "procedencia.json"
        previos = {e["archivo"]: e for e in leer_json(procedencia)["archivos"]} if procedencia.exists() else {}
        with self.con_red({calendario_ine.URL: respuesta}):
            registro = calendario_ine.descargar(carpetas("empresas").original, 2026, previos)
        guardar_json(procedencia, {"archivos": registro})
        return registro

    def test_el_calendario_se_acepta_siempre_y_los_demas_originales_no(self) -> None:
        """Con otros bytes, el calendario queda con su huella nueva sin aceptación; por la vía común se detendría."""
        primero = self.descargar(Respuesta(RECORTE.encode(), CALENDARIO))
        nuevo = con(evento("Otra publicación", "20261201")).encode()
        segundo = self.descargar(Respuesta(nuevo, CALENDARIO))
        self.assertNotEqual(primero[0]["sha256"], segundo[0]["sha256"])
        otro = con(evento("Otra más", "20261202")).encode()
        with self.con_red({calendario_ine.URL: Respuesta(otro, CALENDARIO)}), self.assertRaises(OriginalCambiado):
            descargar_acotados(
                [calendario_ine.CALENDARIO], carpetas("empresas").original, False, calendario_ine.contrato(2026)
            )

    def test_ine_caido_con_uno_anterior_registrado(self) -> None:
        """Si el INE no responde, se conserva el registrado y se cita su consulta."""
        primero = self.descargar(Respuesta(RECORTE.encode(), CALENDARIO))
        self.assertEqual(self.descargar(Respuesta(b"", estado=503)), primero)
        with redirect_stdout(io.StringIO()):
            fechas = calendario_ine.capturadas(2026)
        self.assertEqual(fechas.publicado, "2026-10-22")

    def test_ine_caido_sin_ninguno_registrado(self) -> None:
        """Sin calendario registrado, la vigencia va sin fecha de publicación y lo dice."""
        with redirect_stdout(io.StringIO()):
            self.assertEqual(self.descargar(Respuesta(b"", estado=503)), [])
        fechas = calendario_ine.capturadas(2026)
        self.assertIsNone(fechas.publicado)
        self.assertIn("aún no lo ha consultado; no consta la fecha de publicación", fechas.calendario)

    def test_titulo_ausente(self) -> None:
        """Un calendario sin la edición vigente no sustituye al registrado; registrado sin ella, sin fecha y dicho."""
        primero = self.descargar(Respuesta(RECORTE.encode(), CALENDARIO))
        sin_la_edicion = "BEGIN:VEVENT".join(
            bloque for bloque in RECORTE.split("BEGIN:VEVENT") if "DTSTART;TZID=Europe/Madrid:20261022" not in bloque
        ).encode()
        with redirect_stdout(io.StringIO()):
            self.assertEqual(self.descargar(Respuesta(sin_la_edicion, CALENDARIO)), primero)
        (carpetas("empresas").original / calendario_ine.ARCHIVO).write_bytes(sin_la_edicion)
        primero[0]["sha256"] = sha256(carpetas("empresas").original / calendario_ine.ARCHIVO)
        guardar_json(carpetas("empresas").original / "procedencia.json", {"archivos": primero})
        fechas = calendario_ine.capturadas(2026)
        self.assertIsNone(fechas.publicado)
        self.assertIn("no da la fecha de publicación de esta edición", fechas.calendario)


if __name__ == "__main__":
    unittest.main()
