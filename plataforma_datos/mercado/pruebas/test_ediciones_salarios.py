"""La sonda de salarios distingue la EES cuatrienal antes de tocar originales."""

import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import plataforma_datos.mercado.fuentes.salarios.lector as salarios
from plataforma_datos.comun import red
from plataforma_datos.comun.nucleo import Descarga, FormatoInesperado


def catalogo(anio: int = 2022, estado: str = "Definitivos", publicado: str = "23/09/2024") -> bytes:
    """Catálogo mínimo con una encuesta anual más reciente que la cuatrienal.

    Returns:
        HTML sintético de las dos pestañas, sin acceso a red.
    """
    return (
        '<div id="tabs-1254736061996"><strong>Definitivos 2024</strong>'
        ' Publicado: <strong>28/05/2026</strong><a href="/dyngs/Prensa/EAES2024.htm">Nota</a></div>'
        f'<div id="tabs-1254736195109"><div><strong>{estado} {anio}</strong>'
        f" Publicado: <strong>{publicado}</strong></div>"
        f'<a href="/dyngs/Prensa/EES{anio}.htm">Nota de prensa</a></div>'
    ).encode()


class PruebaEdicionDeSalarios(unittest.TestCase):
    """Identidad de la cuatrienal y guardia anterior a toda escritura."""

    def test_anual_mas_reciente_no_sustituye_cuatrienal(self) -> None:
        """La anual 2024 no desplaza los definitivos de la EES 2022."""
        self.assertEqual(salarios.edicion_del_catalogo(catalogo()), {"anio": 2022, "publicado": "23/09/2024"})

    def test_catalogo_incompleto_ambiguo_o_no_definitivo_frena(self) -> None:
        """Un catálogo no reconocible no se interpreta como la edición conocida."""
        for pagina in (
            b"<html>sin encuesta</html>",
            catalogo() + catalogo(),
            catalogo().replace(b"EES2022.htm", b"EAES2022.htm"),
            catalogo().replace(b"23/09/2024", b"31/02/2024"),
            catalogo(estado="Provisionales"),
            catalogo()[:-6],
            catalogo().replace(b"Definitivos 2022", b"Definitivos 2022 Definitivos 2026"),
        ):
            with self.subTest(pagina=pagina), self.assertRaises(FormatoInesperado):
                salarios.edicion_del_catalogo(pagina)

    def test_guardia_no_confunde_tipos_ni_fecha_de_publicacion(self) -> None:
        """La igualdad numérica no acredita el contrato entero del año de la EES."""
        for anio, publicado in ((2022.0, "23/09/2024"), (True, "23/09/2024"), (2022, "24/09/2024")):
            with self.subTest(anio=anio, publicado=publicado), self.assertRaises(FormatoInesperado):
                salarios.comprobar_edicion({"anio": anio, "publicado": publicado})

    def test_sucesora_frena_antes_de_descargar_o_escribir_tablas(self) -> None:
        """Aceptar bytes nuevos nunca autoriza cambiar edición o método."""
        for aceptar in (False, True):
            with tempfile.TemporaryDirectory() as temporal:
                carpeta = Path(temporal)
                previo = carpeta / "procedencia.json"
                previo.write_bytes(b"procedencia anterior")
                with (
                    mock.patch.object(salarios, "ORIGINAL", carpeta),
                    mock.patch.object(salarios, "PROCEDENCIA", previo),
                    mock.patch.object(
                        red,
                        "descargar_url",
                        return_value=Descarga(
                            catalogo(2026, publicado="23/09/2028"), salarios.CATALOGO["url"], "text/html"
                        ),
                    ) as descargar,
                    mock.patch.object(salarios, "descargar_originales", return_value=[]) as tablas,
                    self.subTest(aceptar=aceptar),
                    self.assertRaisesRegex(FormatoInesperado, "revisar.*contrato"),
                ):
                    salarios.descargar(aceptar)
                self.assertEqual(descargar.call_count, 1)
                tablas.assert_not_called()
                self.assertEqual(list(carpeta.iterdir()), [previo])
                self.assertEqual(previo.read_bytes(), b"procedencia anterior")

    def test_transporte_invalido_frena_sin_escritura(self) -> None:
        """Una redirección o un cuerpo no UTF-8 no se convierte en catálogo operativo."""
        for cuerpo, url in ((catalogo(), "https://otro.example"), (b"\xff", salarios.CATALOGO["url"])):
            with tempfile.TemporaryDirectory() as temporal, self.subTest(url=url, cuerpo=cuerpo):
                carpeta = Path(temporal)
                with (
                    mock.patch.object(salarios, "ORIGINAL", carpeta),
                    mock.patch.object(salarios, "PROCEDENCIA", carpeta / "procedencia.json"),
                    mock.patch.object(red, "descargar_url", return_value=Descarga(cuerpo, url, "text/html")),
                    mock.patch.object(salarios, "descargar_originales") as tablas,
                    self.assertRaises(FormatoInesperado),
                ):
                    salarios.descargar(True)
                tablas.assert_not_called()
                self.assertEqual(list(carpeta.iterdir()), [])

    def test_catalogo_identico_conserva_fecha_y_deja_pausa_antes_de_tablas(self) -> None:
        """Reconsultar los mismos bytes no renueva su fecha histórica de descarga."""
        with tempfile.TemporaryDirectory() as temporal:
            carpeta = Path(temporal)
            procedencia = carpeta / "procedencia.json"
            with (
                mock.patch.object(salarios, "ORIGINAL", carpeta),
                mock.patch.object(salarios, "PROCEDENCIA", procedencia),
                mock.patch.object(
                    red, "descargar_url", return_value=Descarga(catalogo(), salarios.CATALOGO["url"], "text/html")
                ),
                mock.patch.object(salarios, "descargar_originales", return_value=[]),
                mock.patch.object(salarios.time, "sleep") as pausa,
            ):
                salarios.descargar()
                previo = json.loads(procedencia.read_bytes())
                previo["descubrimiento"][0]["descargado_utc"] = "2026-01-01T00:00:00+00:00"
                salarios.guardar_json(procedencia, previo)
                salarios.descargar()
                self.assertEqual(json.loads(procedencia.read_bytes()), previo)
                self.assertEqual(pausa.call_args_list, [mock.call(red.PAUSA_ENTRE_PETICIONES_S)] * 2)


if __name__ == "__main__":
    unittest.main()
