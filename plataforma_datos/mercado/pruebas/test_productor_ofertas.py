"""El productor de ofertas descubre el mes vigente, elige los libros por su fecha y se detiene si falta el anterior."""

import datetime
import io
import shutil
import unittest
import zipfile
from unittest import mock
from urllib.error import HTTPError

import plataforma_datos.mercado.fuentes.ofertas.lector as ofertas
from plataforma_datos.comun import descarga_acotada
from plataforma_datos.comun.dia_de_consulta import dia_de_consulta
from plataforma_datos.comun.entrada_salida import carpetas, guardar_json, leer_json, ruta_del_conjunto, sha256
from plataforma_datos.comun.nucleo import FormatoInesperado
from plataforma_datos.mercado.fuentes.ofertas.piezas.libro_de_ofertas import elegir_libros
from plataforma_datos.mercado.pruebas.ayuda_productores import RECORTES, ConDatosAislados, Respuesta, recorte

# Recortes de var/actualizacion/originales/ofertas/Ofertes_202509.xlsx y Ofertes_202609.xlsx (capturas del 21/10/2026):
# solo las tres hojas que se leen y sus columnas A, C y G, con los valores del libro tal cual.
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
SEPTIEMBRE_2026 = ofertas.archivo_del_mes(2026, 9)
SEPTIEMBRE_2025 = ofertas.archivo_del_mes(2025, 9)
PUBLICADOS = {
    SEPTIEMBRE_2026["url"]: Respuesta(recorte("Ofertes_202609.xlsx"), tipo=XLSX),
    SEPTIEMBRE_2025["url"]: Respuesta(recorte("Ofertes_202509.xlsx"), tipo=XLSX),
}


def recomprimido(nombre: str) -> bytes:
    """El mismo libro con otra compresión: otros bytes y el mismo contenido, como una nueva publicación del Observatori.

    Returns:
        Los bytes del libro recomprimido.
    """
    salida = io.BytesIO()
    with zipfile.ZipFile(RECORTES / nombre) as origen, zipfile.ZipFile(salida, "w", zipfile.ZIP_STORED) as destino:
        for parte in origen.infolist():
            destino.writestr(parte.filename, origen.read(parte))
    return salida.getvalue()


class PruebaProductorOfertas(ConDatosAislados):
    """Descarga con un doble de red, prepara y valida los recortes reales."""

    def actualizar(self, hoy: datetime.date, publicados: dict[str, Respuesta] = PUBLICADOS) -> None:
        """Una vuelta completa del productor en la fecha dada.

        Args:
            hoy: El día de la consulta.
            publicados: Las direcciones que existen en el portal; las demás responden 404.
        """
        with self.con_red(publicados), mock.patch.object(ofertas, "hoy_utc", return_value=hoy):
            ofertas.descargar(True)
        ofertas.preparar()
        ofertas.validar()

    def test_descubre_el_mes_vigente_y_compara_con_el_del_anio_anterior(self) -> None:
        """En octubre aún no está el libro de octubre: el vigente es septiembre y se compara con septiembre de 2025."""
        self.actualizar(datetime.date(2026, 10, 15))
        self.assertEqual(self.pedidas[0], ofertas.archivo_del_mes(2026, 10)["url"])
        self.assertEqual(self.pedidas[1:], [SEPTIEMBRE_2026["url"], SEPTIEMBRE_2025["url"]])
        conjunto = leer_json(ruta_del_conjunto("ofertas"))
        self.assertEqual(conjunto["vigente"], "2026-09")
        self.assertEqual((conjunto["actual"]["mes"], conjunto["anterior"]["mes"]), (9, 9))
        self.assertEqual(
            (conjunto["actual"]["periodo"], conjunto["anterior"]["periodo"]),
            ("enero-septiembre de 2026", "enero-septiembre de 2025"),
        )
        self.assertTrue(conjunto["cita"].endswith("(SOC i Feina Activa), gener-setembre de 2026"))

    def test_sin_mes_nuevo_consulta_hasta_el_vigente_incluido_y_lo_conserva(self) -> None:
        """Un mes después, sin libro nuevo, se consultan noviembre, octubre y otra vez septiembre, que sigue vigente."""
        self.actualizar(datetime.date(2026, 10, 15))
        self.pedidas.clear()
        self.actualizar(datetime.date(2026, 11, 3))
        self.assertEqual(
            self.pedidas,
            [
                ofertas.archivo_del_mes(2026, 11)["url"],
                ofertas.archivo_del_mes(2026, 10)["url"],
                SEPTIEMBRE_2026["url"],
            ],
        )
        self.assertEqual(leer_json(ruta_del_conjunto("ofertas"))["vigente"], "2026-09")

    def test_una_revision_del_libro_vigente_se_incorpora(self) -> None:
        """Una nueva publicación del libro vigente, con otros bytes, cambia su huella y su fecha, no sus cifras."""
        self.actualizar(datetime.date(2026, 10, 15))
        antes = self.entrada_registrada("Ofertes_202609.xlsx")
        cifras = leer_json(ruta_del_conjunto("ofertas"))["actual"]
        revisado = {**PUBLICADOS, SEPTIEMBRE_2026["url"]: Respuesta(recomprimido("Ofertes_202609.xlsx"), tipo=XLSX)}
        self.actualizar(datetime.date(2026, 10, 20), revisado)
        despues = self.entrada_registrada("Ofertes_202609.xlsx")
        self.assertNotEqual(despues["sha256"], antes["sha256"])
        self.assertNotEqual(despues["descargado_utc"], antes["descargado_utc"])
        self.assertEqual(leer_json(ruta_del_conjunto("ofertas"))["actual"], cifras)

    def test_un_error_en_el_libro_del_anio_anterior_no_deja_el_libro_nuevo(self) -> None:
        """Con un 5xx o una página de error en el libro del año anterior, el libro nuevo no queda sin registrar."""
        self.actualizar(datetime.date(2026, 10, 15))
        carpeta = carpetas("ofertas").original
        procedencia = (carpeta / "procedencia.json").read_bytes()
        octubre = {**PUBLICADOS, ofertas.archivo_del_mes(2026, 10)["url"]: PUBLICADOS[SEPTIEMBRE_2026["url"]]}
        fallos = (
            (Respuesta(b"", estado=503), HTTPError),
            (Respuesta(b"<html>Error</html>", "text/html"), FormatoInesperado),
        )
        for respuesta, error in fallos:
            with (
                self.subTest(estado=respuesta.estado, tipo=respuesta.tipo),
                self.con_red({**octubre, ofertas.archivo_del_mes(2025, 10)["url"]: respuesta}),
                mock.patch.object(ofertas, "hoy_utc", return_value=datetime.date(2026, 11, 3)),
                self.assertRaises(error),
            ):
                ofertas.descargar(True)
            self.assertFalse((carpeta / "Ofertes_202610.xlsx").exists())
            self.assertEqual((carpeta / "procedencia.json").read_bytes(), procedencia)

    def entrada_registrada(self, nombre: str) -> dict[str, str]:
        """La entrada con que la procedencia registra un libro.

        Returns:
            Su entrada de procedencia.
        """
        procedencia = leer_json(carpetas("ofertas").original / "procedencia.json")
        return next(entrada for entrada in procedencia["archivos"] if entrada["archivo"] == nombre)

    def test_si_falta_el_libro_del_anio_anterior_se_detiene_y_conserva_lo_publicado(self) -> None:
        """Con octubre de 2026 publicado y octubre de 2025 no, la descarga se detiene con su motivo."""
        self.actualizar(datetime.date(2026, 10, 15))
        procedencia = (carpetas("ofertas").original / "procedencia.json").read_bytes()
        validado = ruta_del_conjunto("ofertas").read_bytes()
        con_octubre = {**PUBLICADOS, ofertas.archivo_del_mes(2026, 10)["url"]: PUBLICADOS[SEPTIEMBRE_2026["url"]]}
        with (
            self.con_red(con_octubre),
            mock.patch.object(ofertas, "hoy_utc", return_value=datetime.date(2026, 11, 3)),
            self.assertRaisesRegex(
                FormatoInesperado, "no se encuentra el libro de octubre de 2025.*se conserva lo publicado"
            ),
        ):
            ofertas.descargar(True)
        self.assertEqual((carpetas("ofertas").original / "procedencia.json").read_bytes(), procedencia)
        self.assertEqual(ruta_del_conjunto("ofertas").read_bytes(), validado)
        self.assertFalse((carpetas("ofertas").original / "Ofertes_202610.xlsx").exists())

    def test_si_falla_la_procedencia_no_queda_ningun_libro_descargado_sin_registrar(self) -> None:
        """Si no se escribe la procedencia, se retiran los dos libros nuevos; los ya registrados se quedan."""
        self.actualizar(datetime.date(2026, 10, 15))
        carpeta = carpetas("ofertas").original
        octubre = {
            **PUBLICADOS,
            ofertas.archivo_del_mes(2026, 10)["url"]: PUBLICADOS[SEPTIEMBRE_2026["url"]],
            ofertas.archivo_del_mes(2025, 10)["url"]: PUBLICADOS[SEPTIEMBRE_2025["url"]],
        }
        with (
            self.con_red(octubre),
            mock.patch.object(ofertas, "hoy_utc", return_value=datetime.date(2026, 11, 3)),
            mock.patch.object(ofertas, "guardar_json", side_effect=OSError("disco lleno")),
            self.assertRaisesRegex(OSError, "disco lleno"),
        ):
            ofertas.descargar(True)
        self.assertFalse((carpeta / "Ofertes_202610.xlsx").exists())
        self.assertFalse((carpeta / "Ofertes_202510.xlsx").exists())
        self.assertTrue((carpeta / "Ofertes_202609.xlsx").exists())
        self.assertTrue((carpeta / "Ofertes_202509.xlsx").exists())

    def test_un_fallo_tras_escribir_el_libro_tampoco_lo_deja_sin_registrar(self) -> None:
        """Si falla algo después de escribir el libro del año anterior y antes de anotarlo, también se retira."""
        self.actualizar(datetime.date(2026, 10, 15))
        carpeta = carpetas("ofertas").original
        octubre = {
            **PUBLICADOS,
            ofertas.archivo_del_mes(2026, 10)["url"]: PUBLICADOS[SEPTIEMBRE_2026["url"]],
            ofertas.archivo_del_mes(2025, 10)["url"]: PUBLICADOS[SEPTIEMBRE_2025["url"]],
        }

        def observar(url: str, *_argumentos: object) -> None:
            if url == ofertas.archivo_del_mes(2025, 10)["url"]:
                raise OSError("corte tras escribir")

        with (
            self.con_red(octubre),
            mock.patch.object(ofertas, "hoy_utc", return_value=datetime.date(2026, 11, 3)),
            mock.patch.object(descarga_acotada, "observar_original", side_effect=observar),
            self.assertRaisesRegex(OSError, "corte tras escribir"),
        ):
            ofertas.descargar(True)
        self.assertEqual(
            sorted(libro.name for libro in carpeta.glob("*.xlsx")), ["Ofertes_202509.xlsx", "Ofertes_202609.xlsx"]
        )

    def test_un_validado_con_el_mes_de_0_a_11_se_lee_como_periodo_iso(self) -> None:
        """El conjunto validado anterior con [2026, 8] es septiembre de 2026 y no hace retroceder la validación."""
        self.assertEqual(ofertas.vigente_validado({"vigente": [2026, 8]}), "2026-09")
        self.assertEqual(ofertas.vigente_validado({"vigente": "2026-09"}), "2026-09")
        self.actualizar(datetime.date(2026, 10, 15))
        ruta = ruta_del_conjunto("ofertas")
        guardar_json(ruta, {**leer_json(ruta), "vigente": [2026, 8]})
        ofertas.validar()
        self.assertEqual(leer_json(ruta)["vigente"], "2026-09")

    def test_con_un_mes_nuevo_se_conservan_los_libros_anteriores(self) -> None:
        """Al pasar a octubre, los libros de septiembre siguen en originales/ y en la procedencia."""
        self.actualizar(datetime.date(2026, 10, 15))
        octubre = {
            **PUBLICADOS,
            ofertas.archivo_del_mes(2026, 10)["url"]: PUBLICADOS[SEPTIEMBRE_2026["url"]],
            ofertas.archivo_del_mes(2025, 10)["url"]: PUBLICADOS[SEPTIEMBRE_2025["url"]],
        }
        with self.con_red(octubre), mock.patch.object(ofertas, "hoy_utc", return_value=datetime.date(2026, 11, 3)):
            ofertas.descargar(True)
        carpeta = carpetas("ofertas").original
        registrados = [entrada["archivo"] for entrada in leer_json(carpeta / "procedencia.json")["archivos"]]
        self.assertEqual(
            registrados, ["Ofertes_202509.xlsx", "Ofertes_202510.xlsx", "Ofertes_202609.xlsx", "Ofertes_202610.xlsx"]
        )
        self.assertEqual(sorted(libro.name for libro in carpeta.glob("*.xlsx")), registrados)

    def test_captura_manual_con_solo_el_dia_se_vuelve_a_descargar_y_valida(self) -> None:
        """Una entrada con `descargado: "2026-10-21"` y los mismos bytes conserva ese día y se cita como 21/10/2026."""
        self.actualizar(datetime.date(2026, 10, 15))
        ruta = carpetas("ofertas").original / "procedencia.json"
        procedencia = leer_json(ruta)
        for entrada in procedencia["archivos"]:
            entrada["descargado"] = "2026-10-21"
            del entrada["descargado_utc"]
        guardar_json(ruta, procedencia)
        self.actualizar(datetime.date(2026, 10, 22))
        self.assertEqual(
            dia_de_consulta(self.entrada_registrada("Ofertes_202609.xlsx")["descargado_utc"]), "21/10/2026"
        )
        self.assertEqual(leer_json(ruta_del_conjunto("ofertas"))["consultado"], "2026-10-21")

    def test_por_el_camino_real_de_la_peticion(self) -> None:
        """Por `abrir_peticion` doblado, el 404 del mes sin publicar y los libros pasan por los topes reales."""
        with (
            self.con_transporte(PUBLICADOS),
            mock.patch.object(ofertas, "hoy_utc", return_value=datetime.date(2026, 10, 15)),
        ):
            ofertas.descargar(False)
        ofertas.preparar()
        ofertas.validar()
        self.assertEqual(leer_json(ruta_del_conjunto("ofertas"))["vigente"], "2026-09")

    def test_mes_sin_publicar_con_404_o_con_pagina_de_error(self) -> None:
        """Un 404 es «aún sin publicar»; una página HTML con 200 no es un libro: la vuelta se detiene y lo conserva."""
        self.actualizar(datetime.date(2026, 10, 15))
        self.assertEqual(self.pedidas[0], ofertas.archivo_del_mes(2026, 10)["url"])
        procedencia = (carpetas("ofertas").original / "procedencia.json").read_bytes()
        pagina = {
            **PUBLICADOS,
            ofertas.archivo_del_mes(2026, 10)["url"]: Respuesta(b"<html>No trobat</html>", "text/html"),
        }
        with (
            self.con_red(pagina),
            mock.patch.object(ofertas, "hoy_utc", return_value=datetime.date(2026, 10, 20)),
            self.assertRaisesRegex(FormatoInesperado, "tipo de contenido «text/html»"),
        ):
            ofertas.descargar(True)
        self.assertEqual((carpetas("ofertas").original / "procedencia.json").read_bytes(), procedencia)
        self.assertFalse((carpetas("ofertas").original / "Ofertes_202610.xlsx").exists())

    def test_con_tres_libros_elige_por_fecha(self) -> None:
        """Con agosto de 2026 añadido, el par sigue siendo septiembre de 2026 y septiembre de 2025."""
        nombres = ["Ofertes_202509.xlsx", "Ofertes_202608.xlsx", "Ofertes_202609.xlsx"]
        self.assertEqual(elegir_libros(nombres), ("Ofertes_202609.xlsx", "Ofertes_202509.xlsx"))
        self.assertEqual(elegir_libros(list(reversed(nombres))), ("Ofertes_202609.xlsx", "Ofertes_202509.xlsx"))
        with self.assertRaisesRegex(FormatoInesperado, "falta el libro de agosto de 2025"):
            elegir_libros(["Ofertes_202509.xlsx", "Ofertes_202608.xlsx"])

    def test_preparar_con_tres_libros_registrados(self) -> None:
        """Con un tercer libro registrado (agosto de 2026), la preparación sigue eligiendo por fecha."""
        self.actualizar(datetime.date(2026, 10, 15))
        carpeta = carpetas("ofertas").original
        # El contenido del tercer libro no se lee: solo cuenta que su nombre queda entre los otros dos.
        shutil.copyfile(RECORTES / "Ofertes_202509.xlsx", carpeta / "Ofertes_202608.xlsx")
        procedencia = leer_json(carpeta / "procedencia.json")
        tercero = {"archivo": "Ofertes_202608.xlsx", "sha256": sha256(carpeta / "Ofertes_202608.xlsx")}
        procedencia["archivos"].append(tercero)
        guardar_json(carpeta / "procedencia.json", procedencia)
        ofertas.preparar()
        preparado = leer_json(carpetas("ofertas").preparado / ofertas.LIBROS)
        self.assertEqual(preparado["libros"], ["Ofertes_202609.xlsx", "Ofertes_202509.xlsx"])


if __name__ == "__main__":
    unittest.main()
