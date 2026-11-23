"""La EPA de cada edición: la de su año cuando Eurostat la publica; mientras tanto, la del año declarado."""

import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from email.message import Message
from http.client import IncompleteRead
from pathlib import Path
from unittest import mock
from urllib.error import HTTPError

from plataforma_datos.comun import red
from plataforma_datos.comun.entrada_salida import guardar_json, sha256_bytes
from plataforma_datos.comun.nucleo import Descarga, FormatoInesperado
from plataforma_datos.ia_y_trabajo.fuentes.tich import edicion as estado
from plataforma_datos.ia_y_trabajo.fuentes.tich import epa_por_anio

DOS = {
    **estado.primera(),
    "anio": "2026",
    "anios_medidos": ["2025", "2026"],
    "tablas": {"uso": "82804", "errores": "82907"},
}
# La forma de la respuesta de Eurostat a un año que aún no publica: 200 con `value` vacío.
SIN_VALORES = json.dumps({"extension": {"id": "LFSA_EGAI2D"}, "value": {}}).encode()
CON_VALORES = json.dumps({"extension": {"id": "LFSA_EGAI2D"}, "value": {"0": 50.0}}).encode()


class PruebaEpaPorAnio(unittest.TestCase):
    """Se pide el año de la edición en cada consulta; sin valores, el anterior, declarado."""

    def descargar(self, del_anio: bytes) -> tuple[list[str], tuple]:
        """Descarga la EPA de 2026 con la respuesta dada para `time=2026`.

        Returns:
            Las direcciones pedidas y lo que devuelve la descarga.
        """
        edicion = estado.valida(DOS)
        url_del_anio = estado.archivos({**edicion, "epa_anio": "2026"})[3]["url"]

        def responder(url: str, *_: object, **__: object) -> Descarga:
            return Descarga(del_anio if url == url_del_anio else CON_VALORES, url, "application/json")

        with tempfile.TemporaryDirectory() as temporal, redirect_stdout(io.StringIO()):
            with mock.patch.object(red, "descargar_url", side_effect=responder) as consultar:
                resultado = epa_por_anio.descargar(edicion, Path(temporal), aceptar_cambio=False)
            pedidas = [llamada.args[0] for llamada in consultar.call_args_list]
            self.assertTrue((Path(temporal) / resultado[0]["archivo"]).exists())
        return pedidas, resultado

    def test_sin_el_anio_usa_el_declarado_y_guarda_el_sondeo(self) -> None:
        """Eurostat sin 2026: la EPA es la de 2025, y la respuesta vacía queda con su dirección y su huella."""
        pedidas, (registro, epa_anio, sondeo) = self.descargar(SIN_VALORES)
        self.assertEqual(epa_anio, "2025")
        self.assertEqual(registro["archivo"], "eurostat-lfsa_egai2d-ES-2025.json")
        self.assertEqual(len(pedidas), 2)
        self.assertIn("time=2026", pedidas[0])
        self.assertIn("time=2025", pedidas[1])
        self.assertEqual(
            (sondeo["epa_sondeo"]["anio"], sondeo["epa_sondeo"]["resultado"], sondeo["epa_sondeo"]["sha256"]),
            ("2026", "sin-el-anio", sha256_bytes(SIN_VALORES)),
        )

    def test_una_respuesta_que_no_es_la_esperada_es_no_verificable_y_no_sin_el_anio(self) -> None:
        """Una página de error o un JSON de otra tabla: «respuesta-no-verificable», y se usa la EPA declarada."""
        for respuesta in (b"<html>error</html>", json.dumps({"extension": {"id": "OTRA"}, "value": {}}).encode()):
            with self.subTest(respuesta=respuesta):
                _, (_, epa_anio, sondeo) = self.descargar(respuesta)
                self.assertEqual((epa_anio, sondeo["epa_sondeo"]["resultado"]), ("2025", "respuesta-no-verificable"))

    def test_un_fallo_de_red_en_el_sondeo_no_tumba_la_consulta(self) -> None:
        """Sin respuesta entera y verificable del año (red, corte, límite, transporte): «fallido» y la EPA declarada."""
        edicion = estado.valida(DOS)
        url_del_anio = estado.archivos({**edicion, "epa_anio": "2026"})[3]["url"]
        for error in (
            HTTPError(url_del_anio, 503, "Service Unavailable", Message(), None),
            TimeoutError("agotado"),
            IncompleteRead(b"{", 10),
            red.LimiteDescargaExcedido("La longitud HTTP supera el límite de recepción."),
            FormatoInesperado("Codificación de transferencia HTTP no verificable."),
        ):

            def responder(url: str, *_: object, error: Exception = error, **__: object) -> Descarga:
                if url == url_del_anio:
                    raise error
                return Descarga(CON_VALORES, url, "application/json")

            with (
                self.subTest(error=type(error).__name__),
                tempfile.TemporaryDirectory() as temporal,
                redirect_stdout(io.StringIO()),
                mock.patch.object(red, "descargar_url", side_effect=responder),
            ):
                registro, epa_anio, sondeo = epa_por_anio.descargar(edicion, Path(temporal), aceptar_cambio=False)
            self.assertEqual((epa_anio, registro["archivo"]), ("2025", "eurostat-lfsa_egai2d-ES-2025.json"))
            self.assertEqual(sondeo["epa_sondeo"]["resultado"], "fallido")
            self.assertIn(type(error).__name__, sondeo["epa_sondeo"]["detalle"])

    def test_la_epa_se_busca_por_su_nombre_y_no_por_su_posicion(self) -> None:
        """Con los originales en otro orden, la EPA sigue siendo la EPA."""
        edicion = estado.valida(DOS)
        orden = list(reversed(estado.archivos(edicion)))
        with mock.patch.object(epa_por_anio.estado, "archivos", return_value=orden):
            self.assertEqual(epa_por_anio._la_epa(edicion, "2025")["archivo"], "eurostat-lfsa_egai2d-ES-2025.json")

    def test_con_el_anio_lo_usa_y_lo_pide_una_sola_vez(self) -> None:
        """Eurostat con 2026: la EPA es la de 2026, sin sondeo y sin pedirla dos veces."""
        pedidas, (registro, epa_anio, sondeo) = self.descargar(CON_VALORES)
        self.assertEqual((epa_anio, sondeo), ("2026", {}))
        self.assertEqual(registro["archivo"], "eurostat-lfsa_egai2d-ES-2026.json")
        self.assertEqual(len(pedidas), 1)

    def test_la_edicion_de_su_mismo_anio_no_sondea(self) -> None:
        """La primera edición ya tiene la EPA de su año: se pide una vez, como un original más."""
        with (
            tempfile.TemporaryDirectory() as temporal,
            redirect_stdout(io.StringIO()),
            mock.patch.object(
                red, "descargar_url", side_effect=lambda url, *_, **__: Descarga(CON_VALORES, url, "application/json")
            ) as consultar,
        ):
            _, epa_anio, sondeo = epa_por_anio.descargar(estado.primera(), Path(temporal), aceptar_cambio=False)
        self.assertEqual((epa_anio, sondeo, consultar.call_count), ("2025", {}, 1))

    def test_la_preparacion_usa_la_epa_que_registro_la_descarga(self) -> None:
        """La procedencia del año dice qué EPA se descargó; sin ella, la del estado."""
        edicion = estado.valida(DOS)
        with tempfile.TemporaryDirectory() as temporal:
            carpeta = Path(temporal)
            guardar_json(carpeta / "2026" / "procedencia.json", {"anio": "2026", "epa_anio": "2026", "archivos": []})
            self.assertEqual(epa_por_anio.con_la_epa_descargada(edicion, carpeta)["epa_anio"], "2026")
            guardar_json(carpeta / "2026" / "procedencia.json", {"anio": "2026", "archivos": []})
            self.assertEqual(epa_por_anio.con_la_epa_descargada(edicion, carpeta)["epa_anio"], "2025")

    def test_cada_respuesta_tiene_su_resultado_cerrado(self) -> None:
        """La tabla con cifras, la tabla sin cifras (o solo nulos) y cualquier otra cosa."""
        tabla = {"extension": {"id": "LFSA_EGAI2D"}}
        for datos, esperado in (
            (SIN_VALORES, "sin-el-anio"),
            (json.dumps({**tabla, "value": [None, None]}).encode(), "sin-el-anio"),
            (CON_VALORES, "con-valores"),
            (json.dumps({**tabla, "value": [None, 3.0]}).encode(), "con-valores"),
            (b"{}", "respuesta-no-verificable"),
            (json.dumps({"value": [3.0]}).encode(), "respuesta-no-verificable"),
            (b"no es json", "respuesta-no-verificable"),
            (b"[1, 2]", "respuesta-no-verificable"),
        ):
            with self.subTest(datos=datos):
                self.assertEqual(epa_por_anio.leer_respuesta(datos), esperado)


if __name__ == "__main__":
    unittest.main()
