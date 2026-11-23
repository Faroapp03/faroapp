"""La tabla de uso y la de errores de cada edición se localizan por su título desde el catálogo real del INE."""

import io
import json
import tempfile
import unittest
from collections.abc import Callable
from contextlib import redirect_stdout
from email.message import Message
from pathlib import Path
from unittest import mock
from urllib.error import HTTPError, URLError

import plataforma_datos.ia_y_trabajo.fuentes.tich.lector as tich
from plataforma_datos.comun import red
from plataforma_datos.comun.entrada_salida import sha256_bytes
from plataforma_datos.comun.nucleo import Descarga, FormatoInesperado
from plataforma_datos.ia_y_trabajo.fuentes.tich.constantes import ARCHIVOS, CSV_INE
from plataforma_datos.ia_y_trabajo.fuentes.tich.navegacion import (
    MOTIVOS,
    TITULO_ERRORES,
    TITULO_USO,
    NavegacionDetenida,
    navegar,
    tablas_de_la_edicion_nueva,
)

DATOS = Path(__file__).parent / "datos" / "ine-tich"
PROCEDENCIA = json.loads((DATOS / "procedencia.json").read_text(encoding="utf-8"))
# Las páginas capturadas, por su dirección: el catálogo de la operación, los tres índices de 2026 y la página de
# metodología y cuestionarios.
PAGINAS = {
    archivo["url"]: (DATOS / archivo["archivo"]).read_bytes()
    for archivo in PROCEDENCIA["archivos"]
    if archivo["archivo"].endswith(".html")
}
CATALOGO = PAGINAS[tich.RESULTADOS]
IA = "https://www.ine.es/dynt3/inebase/index.htm?padre=14075&capsel=14104"
ERRORES = "https://www.ine.es/dynt3/inebase/index.htm?padre=14074&capsel=14103"
METODOLOGIA = (
    "https://www.ine.es/dyngs/INEbase/es/operacion.htm?c=Estadistica_C&cid=1254736176741&menu=metodologia"
    "&idp=1254735576692"
)
DOCUMENTOS_2026 = {
    "metodologia": "https://www.ine.es/metodologia/t25/t25304506626.pdf",
    "cuestionario": "https://www.ine.es/metodologia/t25/t25p450_tich_cues_26.pdf",
}
PENDIENTE = {"estado": "pendiente-de-incorporar", "anio": "2026"}


def con(cambios: dict[str, bytes]) -> dict[str, bytes]:
    """Las páginas capturadas con algunas sustituidas.

    Returns:
        {dirección: bytes}.
    """
    return {**PAGINAS, **cambios}


class PruebaNavegacionTich(unittest.TestCase):
    """Cada paso exige una sola coincidencia del título, y lo encontrado lleva la huella de cada página."""

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

    def test_desde_el_catalogo_real_llega_a_la_82804_y_a_la_82907(self) -> None:
        """Con las capturas del 15/11/2026: la tabla de uso es la 82804 y la de errores, la 82907."""
        encontrado = navegar("2026", tich.RESULTADOS, CATALOGO, PAGINAS.__getitem__)
        self.assertEqual(
            (encontrado["uso"], encontrado["errores"]),
            (
                {"tabla": "82804", "titulo": TITULO_USO, "url": f"{CSV_INE}/82804.csv"},
                {"tabla": "82907", "titulo": TITULO_ERRORES, "url": f"{CSV_INE}/82907.csv"},
            ),
        )
        huellas = {archivo["url"]: archivo["sha256"] for archivo in PROCEDENCIA["archivos"]}
        self.assertEqual(
            [pagina["url"] for pagina in encontrado["paginas"]],
            [
                tich.RESULTADOS,
                "https://www.ine.es/dynt3/inebase/index.htm?padre=14075&capsel=14079",
                IA,
                ERRORES,
                METODOLOGIA,
            ],
        )
        for pagina in encontrado["paginas"]:
            self.assertEqual(pagina["sha256"], huellas[pagina["url"]])
        self.assertEqual(encontrado["documentos"], DOCUMENTOS_2026)

    def test_los_documentos_del_anio_salen_de_sus_selectores_con_una_sola_opcion(self) -> None:
        """Sin la opción del año, con dos, con un PDF fuera del INE o sin el enlace del catálogo: motivo cerrado."""
        pagina = PAGINAS[METODOLOGIA]
        opcion = b'<option value="/metodologia/t25/t25304506626.pdf">2026</option>'
        self.assertEqual(pagina.count(opcion), 1)
        enlace = b"menu=metodologia&idp=1254735576692"
        self.assertEqual(CATALOGO.count(enlace), 1)
        for paginas, motivo in (
            (con({METODOLOGIA: pagina.replace(opcion, b"")}), "sin-coincidencia"),
            (
                con({METODOLOGIA: pagina.replace(opcion, opcion + opcion.replace(b"626", b"627"))}),
                "varias-coincidencias",
            ),
            (
                con({METODOLOGIA: pagina.replace(opcion, opcion.replace(b"/metodologia/", b"https://otro.example/"))}),
                "fuera-de-inebase",
            ),
            (con({METODOLOGIA: b"\xff" + pagina}), "pagina-no-utf8"),
        ):
            with self.subTest(motivo=motivo), self.assertRaises(NavegacionDetenida) as detenida:
                navegar("2026", tich.RESULTADOS, CATALOGO, paginas.__getitem__)
            self.assertEqual(detenida.exception.motivo, motivo)
        sin_enlace = CATALOGO.replace(b"Metodolog\xc3\xada y Cuestionarios", b"Otra cosa")
        with self.assertRaises(NavegacionDetenida) as detenida:
            navegar("2026", tich.RESULTADOS, sin_enlace, PAGINAS.__getitem__)
        self.assertEqual(detenida.exception.motivo, "sin-coincidencia")

    def test_un_indice_con_dos_tablas_del_mismo_titulo_o_ninguna_se_detiene(self) -> None:
        """Dos enlaces con el título de la tabla de uso, o ninguno, detienen la navegación con su motivo."""
        indice = PAGINAS[IA]
        enlace = b'<a href="/jaxi/Tabla.htm?tpx=82804&amp;L=0"'
        self.assertEqual(indice.count(enlace), 1)
        duplicado = indice.replace(
            enlace, b'<a href="/jaxi/Tabla.htm?tpx=99999&amp;L=0">' + TITULO_USO.encode() + b"</a>" + enlace
        )
        sin_titulo = indice.replace(TITULO_USO.encode(), b"Otra tabla")
        for paginas, motivo in ((con({IA: duplicado}), "hay 2 enlaces"), (con({IA: sin_titulo}), "hay 0 enlaces")):
            with self.subTest(motivo=motivo), self.assertRaisesRegex(FormatoInesperado, motivo):
                navegar("2026", tich.RESULTADOS, CATALOGO, paginas.__getitem__)

    def test_otro_anio_un_enlace_fuera_de_inebase_o_una_pagina_rota_se_detienen(self) -> None:
        """El catálogo de 2026 no da tablas de 2027; un enlace a otro sitio o una página que no es UTF-8, tampoco."""
        with self.assertRaisesRegex(FormatoInesperado, "hay 0 enlaces"):
            navegar("2027", tich.RESULTADOS, CATALOGO, PAGINAS.__getitem__)
        fuera = PAGINAS[ERRORES].replace(
            b'href="/jaxi/Tabla.htm?tpx=82907', b'href="https://otro.example/Tabla.htm?tpx=82907'
        )
        with self.assertRaisesRegex(FormatoInesperado, "no es el de una tabla del INE"):
            navegar("2026", tich.RESULTADOS, CATALOGO, con({ERRORES: fuera}).__getitem__)
        with self.assertRaisesRegex(FormatoInesperado, "no es UTF-8"):
            navegar("2026", tich.RESULTADOS, CATALOGO, con({IA: b"\xff" + PAGINAS[IA]}).__getitem__)

    def test_solo_se_navega_con_la_edicion_pendiente_y_un_fallo_no_tumba_la_consulta(self) -> None:
        """Sin edición nueva o sin sus microdatos no se pide nada; si la navegación se detiene, queda su motivo."""
        bajar = mock.Mock(side_effect=PAGINAS.__getitem__)
        for observada in (None, {"estado": "publicada-sin-microdatos", "anio": "2026"}):
            self.assertEqual(tablas_de_la_edicion_nueva(observada, tich.RESULTADOS, lambda: CATALOGO, bajar), {})
        bajar.assert_not_called()
        encontradas = tablas_de_la_edicion_nueva(PENDIENTE, tich.RESULTADOS, lambda: CATALOGO, bajar)
        self.assertEqual(encontradas["tablas_edicion_nueva"]["uso"]["tabla"], "82804")
        rota = con({IA: PAGINAS[IA].replace(TITULO_USO.encode(), b"Otra tabla")})
        detenida = tablas_de_la_edicion_nueva(PENDIENTE, tich.RESULTADOS, lambda: CATALOGO, rota.__getitem__)
        self.assertEqual(list(detenida), ["tablas_edicion_nueva_detenida"])
        self.assertEqual(detenida["tablas_edicion_nueva_detenida"]["anio"], "2026")
        self.assertEqual(detenida["tablas_edicion_nueva_detenida"]["motivo"], "sin-coincidencia")
        self.assertIn("hay 0 enlaces", detenida["tablas_edicion_nueva_detenida"]["detalle"])

    def test_cada_paso_detenido_lleva_su_motivo_cerrado(self) -> None:
        """Dos tablas, ninguna, otro año, fuera de INEbase, página rota o fallo de red: cada uno con su código."""
        enlace = b'<a href="/jaxi/Tabla.htm?tpx=82804&amp;L=0"'
        duplicada = PAGINAS[IA].replace(
            enlace, b'<a href="/jaxi/Tabla.htm?tpx=99999&amp;L=0">' + TITULO_USO.encode() + b"</a>" + enlace
        )
        otro_anio = PAGINAS[IA].replace(b"/TICH/TICH2026_14074/", b"/TICH/TICH2025_14074/")
        otro_numero = PAGINAS[IA].replace(b'data-tpx="82804"', b'data-tpx="82803"', 1)
        fuera = PAGINAS[ERRORES].replace(b'href="/jaxi/Tabla.htm?tpx=82907', b'href="https://otro.example/x?tpx=82907')

        def caida(error: OSError) -> mock.Mock:
            return mock.Mock(side_effect=lambda url: PAGINAS[url] if url != IA else (_ for _ in ()).throw(error))

        http = HTTPError(IA, 503, "Service Unavailable", Message(), None)
        for bajar, motivo in (
            (con({IA: duplicada}).__getitem__, "varias-coincidencias"),
            (con({IA: PAGINAS[IA].replace(TITULO_USO.encode(), b"Otra")}).__getitem__, "sin-coincidencia"),
            (con({IA: otro_anio}).__getitem__, "otro-anio"),
            (con({IA: otro_numero}).__getitem__, "otro-anio"),
            (con({ERRORES: fuera}).__getitem__, "fuera-de-inebase"),
            (con({IA: b"\xff"}).__getitem__, "pagina-no-utf8"),
            (caida(http), "red"),
            (caida(TimeoutError("tiempo agotado")), "red"),
            (caida(URLError("sin conexión")), "red"),
        ):
            with self.subTest(motivo=motivo):
                detenida = tablas_de_la_edicion_nueva(PENDIENTE, tich.RESULTADOS, lambda: CATALOGO, bajar)
                self.assertEqual(detenida["tablas_edicion_nueva_detenida"]["motivo"], motivo)
                self.assertIn(detenida["tablas_edicion_nueva_detenida"]["motivo"], MOTIVOS)

    def test_una_redireccion_de_un_indice_se_detiene(self) -> None:
        """Un índice que llega de otra dirección no se lee."""
        otra = Descarga(PAGINAS[IA], "https://www.ine.es/otra", "text/html")
        with mock.patch.object(red, "descargar_url", return_value=otra):
            detenida = tablas_de_la_edicion_nueva(PENDIENTE, tich.RESULTADOS, lambda: CATALOGO)
        self.assertEqual(detenida["tablas_edicion_nueva_detenida"]["motivo"], "redireccion")

    def test_descargar_con_el_catalogo_real_guarda_las_tablas_de_2026_en_la_procedencia(self) -> None:
        """La consulta conserva la edición admitida, observa 2026 pendiente y registra sus tablas y sus páginas."""

        def responder(url: str, *_: object, **__: object) -> Descarga:
            return Descarga(PAGINAS.get(url, b"original"), url, "text/html")

        with tempfile.TemporaryDirectory() as temporal:
            raiz = Path(temporal)
            with (
                mock.patch.object(tich, "ORIGINAL", raiz),
                mock.patch.object(tich, "PROCEDENCIA", raiz / "procedencia.json"),
                mock.patch.object(red, "descargar_url", side_effect=responder) as consultar,
                mock.patch.object(tich.time, "sleep"),
                redirect_stdout(io.StringIO()),
            ):
                self.assertEqual(tich.main(["descargar", "--aceptar-cambio"]), 0)
            procedencia = json.loads((raiz / "procedencia.json").read_text(encoding="utf-8"))
            del_anio = json.loads((raiz / "2026" / "procedencia.json").read_text(encoding="utf-8"))
        pedidas = [llamada.args[0] for llamada in consultar.call_args_list]
        self.assertEqual(pedidas[1 : 1 + len(ARCHIVOS)], [archivo["url"] for archivo in ARCHIVOS])
        self.assertEqual(
            pedidas[1 + len(ARCHIVOS) :],
            [archivo["url"] for archivo in PROCEDENCIA["archivos"][5:6]]
            + [IA, ERRORES, METODOLOGIA]
            + [
                "https://www.ine.es/ftp/microdatos/tich/datos_2026.zip",
                f"{CSV_INE}/82804.csv",
                f"{CSV_INE}/82907.csv",
                ARCHIVOS[3]["url"].replace("time=2025", "time=2026"),
                *DOCUMENTOS_2026.values(),
            ],
        )
        self.assertEqual(procedencia["edicion_nueva"]["estado"], "pendiente-de-incorporar")
        tablas = procedencia["tablas_edicion_nueva"]
        self.assertEqual(
            (tablas["anio"], tablas["uso"]["tabla"], tablas["errores"]["tabla"]), ("2026", "82804", "82907")
        )
        self.assertEqual(len(tablas["paginas"]), 5)
        self.assertEqual(tablas["documentos"], DOCUMENTOS_2026)
        # La candidata: sus originales y sus dos PDF en la carpeta de 2026, y la EPA de 2025 copiada de la admitida.
        candidata = procedencia["candidata"]
        self.assertEqual(
            (candidata["edicion"]["anio"], candidata["edicion"]["tablas"], candidata["edicion"]["epa_anio"]),
            ("2026", {"uso": "82804", "errores": "82907"}, "2025"),
        )
        self.assertEqual(
            [entrada["archivo"] for entrada in candidata["archivos"]],
            [
                "2026/tich-2026-microdatos.zip",
                "2026/ine-82804.csv",
                "2026/ine-82907.csv",
                "2026/eurostat-lfsa_egai2d-ES-2025.json",
                "2026/ine-tich-2026-metodologia.pdf",
                "2026/ine-tich-2026-cuestionario.pdf",
            ],
        )
        self.assertEqual(del_anio["epa_sondeo"]["resultado"], "respuesta-no-verificable")
        self.assertEqual(del_anio["archivos"][3]["copia_de"], "2025/eurostat-lfsa_egai2d-ES-2025.json")

    def test_un_fallo_al_bajar_la_candidata_la_detiene_por_tablas_y_la_consulta_sigue(self) -> None:
        """Un 503 en los microdatos de 2026: la consulta termina en 0, sin candidata y con su detención."""

        def responder(url: str, *_: object, **__: object) -> Descarga:
            if url.endswith("datos_2026.zip"):
                raise HTTPError(url, 503, "Service Unavailable", Message(), None)
            return Descarga(PAGINAS.get(url, b"original"), url, "text/html")

        with tempfile.TemporaryDirectory() as temporal:
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
        self.assertNotIn("candidata", procedencia)
        self.assertEqual(procedencia["candidata_detenida"]["motivo"], "tablas")
        self.assertIn("503", procedencia["candidata_detenida"]["detalle"])
        self.assertEqual(
            [archivo["archivo"] for archivo in procedencia["archivos"]], [f"2025/{v['archivo']}" for v in ARCHIVOS]
        )

    def test_un_fallo_a_medias_registra_las_peticiones_hechas_hasta_el_fallo(self) -> None:
        """Un 503 en la tercera petición de la candidata: la detención guarda las dos primeras con su huella."""

        def responder(url: str, *_: object, **__: object) -> Descarga:
            if url.endswith("82907.csv"):
                raise HTTPError(url, 503, "Service Unavailable", Message(), None)
            return Descarga(PAGINAS.get(url, b"original"), url, "text/html")

        with tempfile.TemporaryDirectory() as temporal:
            raiz = Path(temporal)
            self.consultar(raiz, responder)
            detenida = json.loads((raiz / "procedencia.json").read_text(encoding="utf-8"))["candidata_detenida"]
        self.assertEqual(detenida["motivo"], "tablas")
        self.assertNotIn("epa_sondeo", detenida)
        self.assertIn("503", detenida["detalle"])
        self.assertEqual(
            [(archivo["archivo"], archivo["sha256"], archivo["url"]) for archivo in detenida["archivos"]],
            [
                (nombre, sha256_bytes(b"original"), url)
                for nombre, url in (
                    ("tich-2026-microdatos.zip", "https://www.ine.es/ftp/microdatos/tich/datos_2026.zip"),
                    ("ine-82804.csv", f"{CSV_INE}/82804.csv"),
                )
            ],
        )
        self.assertTrue(all(archivo["descargado_utc"] for archivo in detenida["archivos"]))

    def test_un_fallo_tras_el_sondeo_de_la_epa_lo_conserva_en_la_detencion(self) -> None:
        """Un 503 en el cuestionario: la detención lleva los cinco originales hechos y el sondeo ya consultado."""

        def responder(url: str, *_: object, **__: object) -> Descarga:
            if url == DOCUMENTOS_2026["cuestionario"]:
                raise HTTPError(url, 503, "Service Unavailable", Message(), None)
            return Descarga(PAGINAS.get(url, b"original"), url, "text/html")

        with tempfile.TemporaryDirectory() as temporal:
            raiz = Path(temporal)
            self.consultar(raiz, responder)
            detenida = json.loads((raiz / "procedencia.json").read_text(encoding="utf-8"))["candidata_detenida"]
        self.assertEqual(detenida["motivo"], "tablas")
        self.assertEqual(len(detenida["archivos"]), 5)
        self.assertEqual(detenida["epa_sondeo"]["resultado"], "respuesta-no-verificable")
        self.assertEqual(detenida["epa_sondeo"]["anio"], "2026")

    def consultar(self, raiz: Path, responder: Callable[..., Descarga]) -> list[str]:
        """Una consulta completa de la TIC-H en `raiz`, con la red simulada.

        Returns:
            Las direcciones que pidió, en orden.
        """
        with (
            mock.patch.object(tich, "ORIGINAL", raiz),
            mock.patch.object(tich, "PROCEDENCIA", raiz / "procedencia.json"),
            mock.patch.object(red, "descargar_url", side_effect=responder) as consultar,
            mock.patch.object(tich.time, "sleep"),
            redirect_stdout(io.StringIO()),
        ):
            self.assertEqual(tich.main(["descargar"]), 0)
        return [llamada.args[0] for llamada in consultar.call_args_list]

    def test_cada_consulta_pide_otra_vez_la_candidata_y_acepta_lo_que_el_ine_corrige(self) -> None:
        """La segunda consulta pide los seis; si el INE cambia los microdatos en la misma dirección, se baja."""
        microdatos = "https://www.ine.es/ftp/microdatos/tich/datos_2026.zip"
        cuerpo = {microdatos: b"original"}

        def responder(url: str, *_: object, **__: object) -> Descarga:
            return Descarga(cuerpo.get(url, PAGINAS.get(url, b"original")), url, "text/html")

        de_la_candidata = [microdatos, f"{CSV_INE}/82804.csv", f"{CSV_INE}/82907.csv", *DOCUMENTOS_2026.values()]
        with tempfile.TemporaryDirectory() as temporal:
            raiz = Path(temporal)
            self.consultar(raiz, responder)
            segunda = self.consultar(raiz, responder)
            primera_huella = sha256_bytes(b"original")
            cuerpo[microdatos] = b"corregido por el INE"
            tercera = self.consultar(raiz, responder)
            en_la_carpeta = (raiz / "2026" / "tich-2026-microdatos.zip").read_bytes()
            procedencia = json.loads((raiz / "procedencia.json").read_text(encoding="utf-8"))
            del_anio = json.loads((raiz / "2026" / "procedencia.json").read_text(encoding="utf-8"))
        for pedidas in (segunda, tercera):
            self.assertEqual([url for url in pedidas if url in de_la_candidata], de_la_candidata)
        self.assertEqual(en_la_carpeta, b"corregido por el INE")
        registrada = next(a for a in procedencia["candidata"]["archivos"] if a["archivo"].endswith("microdatos.zip"))
        self.assertEqual(registrada["sha256"], sha256_bytes(b"corregido por el INE"))
        self.assertNotEqual(registrada["sha256"], primera_huella)
        self.assertEqual(del_anio["archivos"][0]["sha256"], registrada["sha256"])


if __name__ == "__main__":
    unittest.main()
