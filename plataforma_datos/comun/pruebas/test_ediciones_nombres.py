"""La edición de residentes se comprueba antes de sustituir las entradas del filtro de nombres."""

import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import plataforma_datos.comun.fuentes.nombres.lector as nombres
from plataforma_datos.comun import red
from plataforma_datos.comun.nucleo import Descarga, FormatoInesperado
from plataforma_datos.comun.observacion_remota import VARIABLE_RECEPCION, contexto_descarga, observar


def catalogo(fecha: str = "01/01/2025", publicado: str = "23/04/2026") -> bytes:
    """Reproduce las dos pestañas de residentes, junto a la edición distinta de recién nacidos.

    Returns:
        HTML sintético sin red ni entradas operativas.
    """
    secciones = (
        ("1254736195454", ("nombres_por_edad_media.xlsx", "nombres_por_nacionalidades.xlsx", "nota_nombres.pdf")),
        ("1254736195497", ("apellidos_frecuencia.xls", "apellidos_por_nacionalidad.xls", "nota_apellidos.pdf")),
    )
    pagina = '<div id="tabs-1254736195498">Últimos datos 2024 Publicado:19/11/2025</div>'
    for identificador, archivos in secciones:
        pagina += f'<div id="tabs-{identificador}"><div>Últimos datos</div><div><span>'
        pagina += f"<strong>{fecha}</strong> Publicado:<strong>{publicado}</strong></span></div>"
        pagina += "".join(f'<a href="/daco/daco42/nombyapel/{archivo}">Tabla</a>' for archivo in archivos)
        pagina += "</div>"
    return pagina.encode()


def catalogos_ambiguos() -> list[bytes]:
    """Genera publicaciones y atributos de identidad repetidos en las pestañas observadas.

    Returns:
        Variantes que no permiten decidir la publicación o el destino de un enlace.
    """
    pagina = catalogo()
    identificador = b'id="tabs-1254736195454"'
    enlace = b'href="/daco/daco42/nombyapel/nombres_por_edad_media.xlsx"'
    return [
        pagina.replace(b"23/04/2026</strong>", b"23/04/2026</strong> Publicado:24/04/2026", 1),
        pagina.replace(enlace, b'href="https://otro.example/tabla.xlsx" ' + enlace),
        pagina.replace(enlace, enlace + b' href="https://otro.example/tabla.xlsx"'),
        pagina.replace(identificador, b'id="otra" ' + identificador),
        pagina.replace(identificador, identificador + b' id="otra"'),
    ]


class PruebaCatalogoDeNombres(unittest.TestCase):
    """Nombres y apellidos de residentes deben identificar la misma edición y sus seis recursos."""

    def test_lee_residentes_sin_confundir_recien_nacidos(self) -> None:
        """La fecha de nacimiento y las fechas de página no desplazan el corte de residentes."""
        self.assertEqual(
            nombres.edicion_del_catalogo(catalogo() + b"<p>2029 Copyright</p>"),
            {"fecha_datos": "01/01/2025", "publicado": "23/04/2026"},
        )

    def test_rechaza_fecha_discordante_o_invalida_y_seccion_incompleta(self) -> None:
        """Un catálogo ambiguo no acredita la edición anterior por encontrarla en otra pestaña."""
        for pagina in (
            b"sin catalogo",
            catalogo() + catalogo(),
            catalogo().replace(b"01/01/2025", b"01/01/2026", 1),
            catalogo().replace(b"23/04/2026", b"24/04/2026", 1),
            catalogo(fecha="31/02/2025"),
            catalogo(publicado="31/02/2026"),
            catalogo().replace(b"tabs-1254736195497", b"tabs-otra"),
            catalogo().removesuffix(b"</div>"),
        ):
            with self.subTest(pagina=pagina), self.assertRaises(FormatoInesperado):
                nombres.edicion_del_catalogo(pagina)

    def test_cada_recurso_debe_estar_en_su_seccion_y_con_direccion_oficial(self) -> None:
        """Las hojas y ambas notas se vinculan al corte de residentes, sin aceptar URL fabricadas."""
        for archivo in nombres.ARCHIVOS:
            ruta = archivo["url"].removeprefix("https://www.ine.es").encode()
            for cambio in (b"/otro", b"https://otro.example" + ruta, ruta + b"?edicion=otra"):
                with self.subTest(archivo=archivo["archivo"], cambio=cambio), self.assertRaises(FormatoInesperado):
                    nombres.edicion_del_catalogo(catalogo().replace(ruta, cambio))
            duplicado = catalogo().replace(ruta + b'">Tabla</a>', ruta + b'">Tabla</a><a href="' + ruta + b'">Otra</a>')
            with self.subTest(duplicado=archivo["archivo"]), self.assertRaises(FormatoInesperado):
                nombres.edicion_del_catalogo(duplicado)

    def test_publicaciones_y_atributos_de_identidad_repetidos_se_rechazan(self) -> None:
        """El orden de atributos repetidos no puede escoger una identidad admitida."""
        for pagina in catalogos_ambiguos():
            with self.subTest(pagina=pagina), self.assertRaises(FormatoInesperado):
                nombres.edicion_del_catalogo(pagina)


class PruebaDescubrimientoDeNombres(unittest.TestCase):
    """Aceptar cambios de bytes no autoriza otra edición del filtro de privacidad."""

    def test_otra_edicion_frena_antes_de_escribir_o_descargar_originales(self) -> None:
        """Año, revisión de publicación y retroceso requieren revisión del método y sus consumidores."""
        for fecha, publicado in (
            ("01/01/2026", "23/04/2027"),
            ("01/01/2025", "24/04/2026"),
            ("01/01/2024", "23/04/2025"),
        ):
            for aceptar in (False, True):
                with (
                    tempfile.TemporaryDirectory() as temporal,
                    self.subTest(fecha=fecha, publicado=publicado, aceptar=aceptar),
                ):
                    carpeta = Path(temporal)
                    procedencia = carpeta / "procedencia.json"
                    procedencia.write_bytes(b"procedencia anterior")
                    with (
                        mock.patch.object(nombres, "ORIGINAL", carpeta),
                        mock.patch.object(nombres, "PROCEDENCIA", procedencia),
                        mock.patch.object(
                            red,
                            "descargar_url",
                            return_value=Descarga(catalogo(fecha, publicado), nombres.PAGINA, "text/html"),
                        ) as consultar,
                        mock.patch.object(nombres, "descargar_originales") as originales,
                        mock.patch.object(red, "conservar_o_sustituir") as escribir,
                        self.assertRaisesRegex(FormatoInesperado, "revisar.*privacidad"),
                    ):
                        nombres.descargar(aceptar)
                    consultar.assert_called_once_with(nombres.PAGINA)
                    originales.assert_not_called()
                    escribir.assert_not_called()
                    self.assertEqual(list(carpeta.iterdir()), [procedencia])
                    self.assertEqual(procedencia.read_bytes(), b"procedencia anterior")

    def test_transporte_invalido_frena_antes_de_escribir(self) -> None:
        """Ni redirección ajena ni cuerpo ilegible se conservan como un catálogo admitido."""
        for contenido, url in ((catalogo(), "https://otro.example"), (b"\xff", nombres.PAGINA)):
            with (
                self.subTest(url=url),
                mock.patch.object(red, "descargar_url", return_value=Descarga(contenido, url, "text/html")),
                mock.patch.object(red, "conservar_o_sustituir") as escribir,
                mock.patch.object(nombres, "descargar_originales") as originales,
                mock.patch.object(nombres, "guardar_json") as guardar,
                self.assertRaises(FormatoInesperado),
            ):
                nombres.descargar(True)
            escribir.assert_not_called()
            originales.assert_not_called()
            guardar.assert_not_called()

    def test_catalogos_ambiguos_no_descargan_originales_ni_escriben(self) -> None:
        """Aceptar bytes no elimina la ambigüedad de publicación, id o href."""
        for contenido in catalogos_ambiguos():
            for aceptar in (False, True):
                with (
                    self.subTest(contenido=contenido, aceptar=aceptar),
                    mock.patch.object(
                        red, "descargar_url", return_value=Descarga(contenido, nombres.PAGINA, "text/html")
                    ),
                    mock.patch.object(red, "conservar_o_sustituir") as escribir,
                    mock.patch.object(nombres, "descargar_originales") as originales,
                    mock.patch.object(nombres, "guardar_json") as guardar,
                    self.assertRaises(FormatoInesperado),
                ):
                    nombres.descargar(aceptar)
                escribir.assert_not_called()
                originales.assert_not_called()
                guardar.assert_not_called()

    def test_recibo_vincula_catalogo_y_los_seis_originales(self) -> None:
        """La consulta completa conserva siete cuerpos observados en el mismo intento."""
        with tempfile.TemporaryDirectory() as temporal:
            carpeta = Path(temporal)
            recibo = carpeta / "recibo.json"
            respuestas = {
                nombres.PAGINA: catalogo(),
                **{archivo["url"]: archivo["archivo"].encode() for archivo in nombres.ARCHIVOS},
            }

            def consultar(url: str) -> Descarga:
                contenido = respuestas[url]
                observar(url, "GET", None, url, contenido)
                return Descarga(contenido, url, "application/octet-stream")

            with (
                mock.patch.dict(
                    "os.environ",
                    {
                        VARIABLE_RECEPCION: json.dumps(
                            {"ruta": str(recibo), "fuente": "nombres", "intento": "nombres95"}
                        )
                    },
                ),
                mock.patch.object(nombres, "ORIGINAL", carpeta),
                mock.patch.object(nombres, "PROCEDENCIA", carpeta / "procedencia.json"),
                mock.patch.object(red, "descargar_url", side_effect=consultar),
                mock.patch.object(nombres.time, "sleep"),
                contexto_descarga(),
            ):
                nombres.descargar()
            evidencia = json.loads(recibo.read_bytes())
            self.assertEqual(len(evidencia["peticiones"]), len(respuestas))
            self.assertTrue(
                all(peticion["original_sha256"] == peticion["respuesta_sha256"] for peticion in evidencia["peticiones"])
            )
            self.assertEqual((carpeta / nombres.CATALOGO["archivo"]).read_bytes(), catalogo())
            for archivo in nombres.ARCHIVOS:
                self.assertEqual((carpeta / archivo["archivo"]).read_bytes(), respuestas[archivo["url"]])

    def test_catalogo_identico_conserva_fecha_historica_y_solicita_seis_originales(self) -> None:
        """La sonda se registra aparte y los bytes idénticos mantienen su fecha histórica."""
        with tempfile.TemporaryDirectory() as temporal:
            carpeta = Path(temporal)
            procedencia = carpeta / "procedencia.json"
            with (
                mock.patch.object(nombres, "ORIGINAL", carpeta),
                mock.patch.object(nombres, "PROCEDENCIA", procedencia),
                mock.patch.object(red, "descargar_url", return_value=Descarga(catalogo(), nombres.PAGINA, "text/html")),
                mock.patch.object(nombres, "descargar_originales", return_value=[]) as originales,
                mock.patch.object(nombres.time, "sleep") as pausa,
            ):
                nombres.descargar()
                previo = json.loads(procedencia.read_bytes())
                previo["descubrimiento"][0]["descargado_utc"] = "2026-01-01T00:00:00+00:00"
                nombres.guardar_json(procedencia, previo)
                nombres.descargar()
            self.assertEqual(json.loads(procedencia.read_bytes()), previo)
            self.assertEqual(previo["edicion"], {"fecha_datos": "01/01/2025", "publicado": "23/04/2026"})
            self.assertEqual(len(previo["descubrimiento"]), 1)
            self.assertEqual(originales.call_args_list, [mock.call(nombres.ARCHIVOS, carpeta, False)] * 2)
            self.assertEqual(pausa.call_args_list, [mock.call(red.PAUSA_ENTRE_PETICIONES_S)] * 2)


if __name__ == "__main__":
    unittest.main()
