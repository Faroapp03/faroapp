"""Pruebas del registro común del Censo perturbado, con la petición simulada y originales temporales."""

import io
import re
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

import plataforma_datos.mercado.fuentes.censo.lector as censo
import plataforma_datos.mercado.fuentes.censo.piezas.constantes_censo as constantes_censo
import plataforma_datos.mercado.fuentes.censo.piezas.consultas_del_censo as consultas_del_censo
from plataforma_datos.comun.entrada_salida import sha256_bytes
from plataforma_datos.comun.nucleo import ArchivoFaltante, Descarga, FormatoInesperado


class PruebaRegistro(unittest.TestCase):
    """Orden, huellas y error antes de sustituir una copia."""

    def test_consultas_en_orden_con_cuerpo_y_fecha_conservados(self) -> None:
        """Dos consultas guardan sus bytes y cuerpo en orden; la respuesta idéntica conserva su fecha."""
        consultas = [
            {"archivo": nombre, "nivel": "oficial", "titulo": nombre, "url": "https://example.org", "cuerpo": cuerpo}
            for nombre, cuerpo in (("primera.json", {"a": 1}), ("segunda.json", {"b": 2}))
        ]
        datos = b'{"data":[1]}'
        fecha = "2026-10-01T00:00:00Z"
        previos = {"primera.json": {"sha256": sha256_bytes(datos), "descargado_utc": fecha}}
        pedir = mock.Mock(return_value=Descarga(datos, "https://example.org/final", "application/json"))
        with (
            tempfile.TemporaryDirectory() as temporal,
            mock.patch.object(consultas_del_censo, "registros_previos", return_value=previos),
            redirect_stdout(io.StringIO()),
        ):
            carpeta = Path(temporal)
            registros = consultas_del_censo.registrar_consultas(consultas, carpeta, carpeta / "procedencia.json", pedir)
            self.assertEqual([peticion.args[0] for peticion in pedir.call_args_list], consultas)
            self.assertEqual(
                [registro["archivo"] for registro in registros], [consulta["archivo"] for consulta in consultas]
            )
            self.assertEqual(
                [registro["cuerpo"] for registro in registros], [consulta["cuerpo"] for consulta in consultas]
            )
            self.assertEqual(registros[0]["descargado_utc"], fecha)
            for registro in registros:
                with self.subTest(archivo=registro["archivo"]):
                    self.assertEqual(registro["metodo"], "POST")
                    self.assertEqual((carpeta / registro["archivo"]).read_bytes(), datos)

    def test_rechazo_preserva_original_y_mismo_error(self) -> None:
        """El rechazo de la petición conserva la copia anterior y el mismo objeto de error."""
        error = FormatoInesperado("respuesta rechazada")
        consulta = {"archivo": "copia.json", "cuerpo": {}}
        with tempfile.TemporaryDirectory() as temporal:
            carpeta = Path(temporal)
            copia = carpeta / "copia.json"
            copia.write_bytes(b"anterior")
            with (
                mock.patch.object(consultas_del_censo, "registros_previos", return_value={}),
                self.assertRaises(FormatoInesperado) as fallo,
            ):
                consultas_del_censo.registrar_consultas(
                    [consulta], carpeta, carpeta / "procedencia.json", mock.Mock(side_effect=error)
                )
            self.assertIs(fallo.exception, error)
            self.assertEqual(copia.read_bytes(), b"anterior")


class PruebaConservacion(unittest.TestCase):
    """Sin aceptación explícita, Censo conserva la copia y no consulta la API."""

    def test_censo_comprueba_sin_pedir_otra_copia(self) -> None:
        """La guarda común conserva el orden y las salidas de las copias verificadas en Censo."""
        with tempfile.TemporaryDirectory() as temporal:
            procedencia = Path(temporal) / "procedencia.json"
            procedencia.write_text("{}", encoding="utf-8")
            modulo = censo
            salida = io.StringIO()
            with (
                self.subTest(fuente=modulo.FUENTE),
                mock.patch.object(modulo, "PROCEDENCIA", procedencia),
                mock.patch.object(modulo, "descargar_url", side_effect=AssertionError("consultó la API")),
                mock.patch.object(
                    consultas_del_censo, "comprobar_originales", return_value=[Path("z.json"), Path("a.json")]
                ) as comprobar,
                redirect_stdout(salida),
            ):
                modulo.descargar(False)
            comprobar.assert_called_once_with(modulo.FUENTE)
            self.assertEqual(
                salida.getvalue().splitlines()[:2],
                ["✓ z.json coincide con su huella registrada", "✓ a.json coincide con su huella registrada"],
            )

    def test_sin_procedencia_falla_antes_de_comprobar(self) -> None:
        """Sin registro se nombra la fuente y cómo aceptar otra copia, sin tocar originales."""
        with (
            tempfile.TemporaryDirectory() as temporal,
            mock.patch.object(consultas_del_censo, "comprobar_originales") as comprobar,
            self.assertRaises(ArchivoFaltante) as fallo,
        ):
            consultas_del_censo.comprobar_copias_registradas("censo", Path(temporal) / "falta.json")
        comprobar.assert_not_called()
        self.assertEqual(
            str(fallo.exception),
            f"censo: no hay copias registradas; {consultas_del_censo.NOTA_PERTURBACION} Usa --aceptar-cambio.",
        )

    def test_censo_rechaza_respuesta_sin_datos(self) -> None:
        """Censo rechaza inmediatamente una respuesta sin data."""
        consulta = {"archivo": "copia.json", "cuerpo": {}}
        vacia = Descarga(b"{}", "https://example.org", "application/json")
        with mock.patch.object(censo, "_consultar_api", return_value=vacia) as pedir:
            with self.assertRaisesRegex(FormatoInesperado, re.escape("copia.json: la API no devolvió datos")):
                censo._consultar_con_datos(consulta)
            pedir.assert_called_once_with({})


class PruebaSustitucionCompleta(unittest.TestCase):
    """Las copias registradas solo se sustituyen cuando todas las consultas han respondido."""

    def test_fallo_en_la_segunda_consulta_conserva_todas_las_copias(self) -> None:
        """Si la segunda consulta falla, la primera copia registrada sigue intacta y no queda ningún temporal."""
        consultas = [
            {"archivo": nombre, "nivel": "oficial", "titulo": nombre, "url": "https://example.org", "cuerpo": {}}
            for nombre in ("primera.json", "segunda.json")
        ]
        nueva = Descarga(b"nueva", "https://example.org", "application/json")
        pedir = mock.Mock(side_effect=[nueva, FormatoInesperado("respuesta rechazada")])
        with tempfile.TemporaryDirectory() as temporal:
            carpeta = Path(temporal) / "originales"
            carpeta.mkdir()
            for consulta in consultas:
                (carpeta / consulta["archivo"]).write_bytes(b"anterior")
            with (
                mock.patch.object(consultas_del_censo, "registros_previos", return_value={}),
                redirect_stdout(io.StringIO()),
                self.assertRaises(FormatoInesperado),
            ):
                consultas_del_censo.registrar_consultas(consultas, carpeta, carpeta / "procedencia.json", pedir)
            copias = [(carpeta / consulta["archivo"]).read_bytes() for consulta in consultas]
            self.assertEqual(copias, [b"anterior", b"anterior"])
            self.assertEqual(sorted(ruta.name for ruta in Path(temporal).iterdir()), ["originales"])


class PruebaConfiguracionDeConsultas(unittest.TestCase):
    """Una configuración inválida se rechaza antes de capturar o escribir respuestas."""

    def test_nombres_no_simples_no_escriben_fuera_del_temporal(self) -> None:
        """Los nombres con rutas no pueden sustituir archivos fuera de la captura temporal."""
        with tempfile.TemporaryDirectory() as temporal:
            raiz = Path(temporal)
            carpeta = raiz / "originales"
            carpeta.mkdir()
            exterior = raiz / "exterior.json"
            exterior.write_bytes(b"anterior")
            for nombre in ("../exterior.json", str(exterior), "sub/copia.json", "", ".", ".."):
                with self.subTest(nombre=nombre):
                    pedir = mock.Mock(return_value=Descarga(b"nueva", "https://example.org", "application/json"))
                    with self.assertRaises(FormatoInesperado), redirect_stdout(io.StringIO()):
                        consultas_del_censo.registrar_consultas(
                            [
                                {
                                    "archivo": nombre,
                                    "cuerpo": {},
                                    "nivel": "oficial",
                                    "titulo": nombre,
                                    "url": "https://example.org",
                                }
                            ],
                            carpeta,
                            carpeta / "procedencia.json",
                            pedir,
                        )
                    pedir.assert_not_called()
                    self.assertEqual(exterior.read_bytes(), b"anterior")
                    self.assertEqual(list(carpeta.iterdir()), [])

    def test_nombre_repetido_en_generador_se_rechaza_antes_de_capturar(self) -> None:
        """Dos consultas al mismo archivo no dejan una sustitución parcial ni consumen el generador dos veces."""
        with tempfile.TemporaryDirectory() as temporal:
            carpeta = Path(temporal)
            copia = carpeta / "copia.json"
            copia.write_bytes(b"anterior")
            consulta = {
                "archivo": "copia.json",
                "cuerpo": {},
                "nivel": "oficial",
                "titulo": "copia",
                "url": "https://example.org",
            }
            pedir = mock.Mock(return_value=Descarga(b"nueva", "https://example.org", "application/json"))
            with self.assertRaises(FormatoInesperado), redirect_stdout(io.StringIO()):
                consultas_del_censo.registrar_consultas(
                    (dict(consulta) for _ in range(2)), carpeta, carpeta / "procedencia.json", pedir
                )
            pedir.assert_not_called()
            self.assertEqual(copia.read_bytes(), b"anterior")

    def test_generador_valido_con_nombre_unicode_conserva_orden_y_bytes(self) -> None:
        """Un iterable de una sola pasada admite nombres simples con espacios y Unicode sin transformarlos."""
        consultas = [
            {"archivo": n, "cuerpo": {}, "nivel": "oficial", "titulo": n, "url": "https://example.org"}
            for n in ("Año 2026.json", "segunda.json")
        ]
        pedir = mock.Mock(return_value=Descarga(b"nueva", "https://example.org", "application/json"))
        with tempfile.TemporaryDirectory() as temporal, redirect_stdout(io.StringIO()):
            carpeta = Path(temporal)
            registros = consultas_del_censo.registrar_consultas(
                (consulta for consulta in consultas), carpeta, carpeta / "procedencia.json", pedir
            )
            self.assertEqual([llamada.args[0] for llamada in pedir.call_args_list], consultas)
            self.assertEqual([registro["archivo"] for registro in registros], [c["archivo"] for c in consultas])
            self.assertTrue(all((carpeta / c["archivo"]).read_bytes() == b"nueva" for c in consultas))


class PruebaContratoDeConsultas(unittest.TestCase):
    """Los nombres de originales y los cuerpos POST definen el contrato de la captura."""

    def test_las_consultas_del_censo_conservan_archivos_y_cuerpos(self) -> None:
        """Los diez originales municipales y de perfil tienen sus variables oficiales exactas."""
        esperadas = {
            f"ine-censo2021-{lugar}-ocu{nivel}-sexo.json": [variable, ocupacion, "ID_SEXO"]
            for lugar, variable in (("residencia", "ID_RESIDENCIA_N3"), ("trabajo", "ID_LUGAR_TRAB_N3"))
            for nivel, ocupacion in (("3", "ID_OCU171"), ("2", "ID_OCU63"))
        }
        esperadas.update(
            {
                f"ine-censo2021-cataluna-ocu{nivel}-{nombre}.json": ["ID_RESIDENCIA_N1", ocupacion, variable]
                for nombre, variable in (
                    ("estudios", "ID_ESREAL_CNEDA"),
                    ("situacion", "ID_SITU"),
                    ("nacionalidad", "ID_NACIONALIDAD_N1"),
                )
                for nivel, ocupacion in (("3", "ID_OCU171"), ("2", "ID_OCU63"))
            }
        )
        self.assertEqual(
            [(consulta["archivo"], consulta["cuerpo"]) for consulta in constantes_censo.CONSULTAS],
            [
                (archivo, {"idioma": "ES", "metrica": ["SPERSONAS"], "tabla": "viv.ppal", "variables": variables})
                for archivo, variables in esperadas.items()
            ],
        )


if __name__ == "__main__":
    unittest.main()
