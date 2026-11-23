"""Descubrimiento común de ediciones: el catálogo se comprueba antes de leer la procedencia o escribir nada."""

import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from plataforma_datos.comun import red
from plataforma_datos.comun.entrada_salida import sha256_bytes
from plataforma_datos.comun.nucleo import ArchivoDescargable, Descarga, FormatoInesperado

URL = "https://catalogo.example/ediciones"
CATALOGO: ArchivoDescargable = {
    "archivo": "catalogo.html",
    "nivel": "oficial",
    "titulo": "Catálogo sintético de ediciones",
    "url": URL,
    "licencia": "Licencia sintética",
}
CUERPO = b"<p>2025</p>"
FECHA_PREVIA = "2026-01-01T00:00:00+00:00"
EDICION = 2025


def leer(datos: bytes) -> int:
    """Lee el año sintético del catálogo.

    Returns:
        El año anunciado.
    """
    return int(datos.decode()[3:7])


def exigir_2025(edicion: int) -> None:
    """Exige la edición sintética del contrato.

    Raises:
        FormatoInesperado: Si la edición es otra.
    """
    if edicion != EDICION:
        raise FormatoInesperado(f"edición {edicion} fuera del contrato")


class PruebaDescubrirEdicion(unittest.TestCase):
    """El orden de las comprobaciones y lo que queda escrito no dependen de cada fuente."""

    def setUp(self) -> None:
        """Crea una carpeta aislada para el catálogo."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.carpeta = Path(temporal.name)

    def descubrir(
        self,
        descarga: Descarga,
        previo: mock.Mock | None = None,
        comprobar: mock.Mock | None = None,
    ) -> tuple[int, dict[str, object]]:
        """Descubre la edición con un transporte simulado.

        Returns:
            La edición y la entrada de procedencia del catálogo.
        """
        with mock.patch.object(red, "descargar_url", return_value=descarga) as transporte:
            edicion, registrar = red.descubrir_edicion(
                CATALOGO,
                self.carpeta,
                redireccion="sintética: redirección inesperada",
                leer=leer,
                comprobar=comprobar or mock.Mock(side_effect=exigir_2025),
                previo=previo or mock.Mock(return_value=None),
            )
        transporte.assert_called_once_with(URL)
        return edicion, registrar()

    def test_redireccion_se_detiene_con_el_mensaje_de_la_fuente(self) -> None:
        """Otra dirección final no se lee, no consulta la procedencia y no escribe."""
        previo = mock.Mock(return_value=None)
        comprobar = mock.Mock()
        with self.assertRaisesRegex(FormatoInesperado, "^sintética: redirección inesperada$"):
            self.descubrir(Descarga(CUERPO, "https://otro.example/", "text/html"), previo, comprobar)
        comprobar.assert_not_called()
        previo.assert_not_called()
        self.assertEqual(list(self.carpeta.iterdir()), [])

    def test_otra_edicion_se_detiene_antes_de_la_procedencia(self) -> None:
        """Una edición fuera del contrato no lee la procedencia ni conserva el catálogo."""
        previo = mock.Mock(return_value=None)
        with self.assertRaisesRegex(FormatoInesperado, "edición 2026 fuera del contrato"):
            self.descubrir(Descarga(b"<p>2026</p>", URL, "text/html"), previo)
        previo.assert_not_called()
        self.assertEqual(list(self.carpeta.iterdir()), [])

    def test_catalogo_ilegible_se_detiene_sin_comprobar(self) -> None:
        """Si `leer` falla, no se comprueba ni se escribe nada."""
        comprobar = mock.Mock()
        with self.assertRaises(ValueError):
            self.descubrir(Descarga(b"<p>xxxx</p>", URL, "text/html"), comprobar=comprobar)
        comprobar.assert_not_called()
        self.assertEqual(list(self.carpeta.iterdir()), [])

    def test_procedencia_rechazada_no_escribe(self) -> None:
        """Las guardas de la fuente sobre su procedencia anterior se aplican antes de conservar el catálogo."""
        previo = mock.Mock(side_effect=FormatoInesperado("sintética: catálogo duplicado"))
        with self.assertRaisesRegex(FormatoInesperado, "duplicado"):
            self.descubrir(Descarga(CUERPO, URL, "text/html"), previo)
        self.assertEqual(list(self.carpeta.iterdir()), [])

    def test_catalogo_admitido_se_conserva_y_registra(self) -> None:
        """La edición, los bytes, la observación y la entrada de procedencia salen de la misma respuesta."""
        descarga = Descarga(CUERPO, URL, "text/html")
        with mock.patch.object(red, "observar_original") as observar:
            edicion, registro = self.descubrir(descarga)
        self.assertEqual(edicion, EDICION)
        self.assertEqual((self.carpeta / "catalogo.html").read_bytes(), CUERPO)
        observar.assert_called_once_with(URL, descarga, CUERPO)
        self.assertEqual(
            {clave: valor for clave, valor in registro.items() if clave != "descargado_utc"},
            {
                "archivo": "catalogo.html",
                "nivel": "oficial",
                "titulo": "Catálogo sintético de ediciones",
                "url": URL,
                "url_final": URL,
                "content_type": "text/html",
                "bytes": len(CUERPO),
                "sha256": sha256_bytes(CUERPO),
                "licencia": "Licencia sintética",
            },
        )
        self.assertNotEqual(registro["descargado_utc"], FECHA_PREVIA)

    def test_mismo_catalogo_conserva_su_fecha(self) -> None:
        """Con la misma huella, la fecha de descarga es la de la procedencia anterior."""
        previo = mock.Mock(return_value={"sha256": sha256_bytes(CUERPO), "descargado_utc": FECHA_PREVIA})
        _, registro = self.descubrir(Descarga(CUERPO, URL, "text/html"), previo)
        self.assertEqual(registro["descargado_utc"], FECHA_PREVIA)

    def test_catalogo_cambiado_se_sustituye_sin_aceptar_cambio(self) -> None:
        """El catálogo es una sonda mutable: otros bytes con la misma edición sustituyen a los conservados."""
        (self.carpeta / "catalogo.html").write_bytes(b"<p>2025</p> anterior")
        previo = mock.Mock(return_value={"sha256": "otra", "descargado_utc": FECHA_PREVIA})
        _, registro = self.descubrir(Descarga(CUERPO, URL, "text/html"), previo)
        self.assertEqual((self.carpeta / "catalogo.html").read_bytes(), CUERPO)
        self.assertNotEqual(registro["descargado_utc"], FECHA_PREVIA)


class PruebaDescubrimientoPrevio(unittest.TestCase):
    """Las dos lecturas comunes de la procedencia anterior conservan sus diferencias de rigor."""

    def setUp(self) -> None:
        """Crea una carpeta aislada para la procedencia."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.procedencia = Path(temporal.name) / "procedencia.json"

    def escribir(self, contenido: object) -> None:
        """Escribe una procedencia sintética."""
        self.procedencia.write_text(json.dumps(contenido), encoding="utf-8")

    def test_sin_procedencia_no_hay_previo(self) -> None:
        """Una procedencia que aún no existe no aporta entrada anterior."""
        self.assertIsNone(red.primer_descubrimiento_previo(self.procedencia, "catalogo.html"))
        self.assertIsNone(red.descubrimiento_previo_unico(self.procedencia, "catalogo.html", "X"))

    def test_primer_previo_toma_la_primera_entrada_del_catalogo(self) -> None:
        """Se ignoran otros archivos y, si el catálogo se repite, vale la primera entrada."""
        self.escribir(
            {
                "descubrimiento": [
                    {"archivo": "otro.html", "sha256": "0"},
                    {"archivo": "catalogo.html", "sha256": "1"},
                    {"archivo": "catalogo.html", "sha256": "2"},
                ]
            }
        )
        self.assertEqual(
            red.primer_descubrimiento_previo(self.procedencia, "catalogo.html"),
            {"archivo": "catalogo.html", "sha256": "1"},
        )
        self.assertIsNone(red.primer_descubrimiento_previo(self.procedencia, "ausente.html"))

    def test_previo_unico_devuelve_su_entrada(self) -> None:
        """Una entrada única del catálogo se devuelve tal cual."""
        self.escribir({"descubrimiento": [{"archivo": "otro.html"}, {"archivo": "catalogo.html", "sha256": "1"}]})
        self.assertEqual(
            red.descubrimiento_previo_unico(self.procedencia, "catalogo.html", "X"),
            {"archivo": "catalogo.html", "sha256": "1"},
        )

    def test_previo_unico_rechaza_formas_invalidas_con_el_prefijo_de_la_fuente(self) -> None:
        """Ni un objeto ajeno, ni un descubrimiento mal formado, ni un catálogo repetido se normalizan."""
        for contenido, mensaje in (
            ([], "X: procedencia debe ser un objeto"),
            ({"descubrimiento": {}}, "X: descubrimiento inválido"),
            ({"descubrimiento": ["catalogo.html"]}, "X: descubrimiento inválido"),
            ({"descubrimiento": [{"archivo": "catalogo.html"}] * 2}, "X: catálogo duplicado en procedencia"),
        ):
            with self.subTest(mensaje=mensaje, contenido=contenido):
                self.escribir(contenido)
                with self.assertRaisesRegex(FormatoInesperado, f"^{mensaje}$"):
                    red.descubrimiento_previo_unico(self.procedencia, "catalogo.html", "X")


if __name__ == "__main__":
    unittest.main()
