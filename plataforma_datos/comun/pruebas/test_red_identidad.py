"""Identidad genérica configurada, sin datos del entorno ni identidad antigua en las peticiones."""

import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from plataforma_datos.comun import red
from plataforma_datos.comun.nucleo import FormatoInesperado

AGENTE_DE_PRUEBA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36"
)
FIREFOX_GENERICO = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0"


def configuracion(agente: str = AGENTE_DE_PRUEBA) -> str:
    """Construye JSON sintético sin leer archivos del equipo.

    Returns:
        Identidad completa con agente sustituible para las pruebas negativas.
    """
    identidad = red.perfil_web.identidad_publica(red.perfil_web.perfil_chrome())
    identidad["User-Agent"] = agente
    return json.dumps({"version": 1, "identidad": identidad})


class PruebaIdentidadDeRed(unittest.TestCase):
    """La configuración se valida al usarla y ninguna cabecera cambia esa identidad."""

    def setUp(self) -> None:
        """Aísla configuración y esperas de cada prueba, sin leer la identidad del equipo."""
        temporal = tempfile.TemporaryDirectory(prefix="Identidad Año ")
        self.addCleanup(temporal.cleanup)
        self.carpeta = Path(temporal.name)
        self.configuracion = self.carpeta / "identidad-web.json"
        self.configuracion.write_text(configuracion(), encoding="utf-8")
        parche = mock.patch.object(red.perfil_web, "RUTA_IDENTIDAD", self.configuracion)
        parche.start()
        self.addCleanup(parche.stop)
        pausa = mock.patch.object(red, "PAUSAS", red.PausasPorDominio(lambda: 0.0, lambda _segundos: None))
        pausa.start()
        self.addCleanup(pausa.stop)

    def test_lee_solo_identidad_y_el_entorno_no_la_sustituye(self) -> None:
        """Opciones no relacionadas y variables heredadas nunca se convierten en cabeceras."""
        (self.carpeta / ".curlrc").write_text('header = "X-Prueba: no reenviar"')
        for valor in ("OtroAgente/2.0", " nombre@example.invalid ", "", "  "):
            with self.subTest(valor=valor), mock.patch.dict(os.environ, {"FARO_AGENTE": valor}):
                self.assertEqual(red.agente_de_usuario(), AGENTE_DE_PRUEBA)

    def test_sin_archivo_del_proyecto_no_hay_repuesto_silencioso(self) -> None:
        """La configuración portable pertenece a la entrega y debe existir."""
        self.configuracion.unlink()
        with self.assertRaises(FormatoInesperado):
            red.agente_de_usuario()

    def test_configuracion_explicita_y_agente_directo(self) -> None:
        """El llamador puede configurar sin una ruta personal ni consultar el sistema."""
        self.assertEqual(red.agente_de_usuario(self.configuracion), AGENTE_DE_PRUEBA)
        with mock.patch.object(Path, "open", side_effect=AssertionError("no leer archivos")):
            self.assertEqual(red.agente_de_usuario(agente=AGENTE_DE_PRUEBA), AGENTE_DE_PRUEBA)
        with self.assertRaises(FormatoInesperado):
            red.agente_de_usuario(self.configuracion, agente=AGENTE_DE_PRUEBA)
        with self.assertRaises(FormatoInesperado):
            red.agente_de_usuario(self.carpeta / "no-existe")

    def test_rechaza_identidades_ambiguas_antiguas_o_personales_antes_de_abrir(self) -> None:
        """Una configuración presente e inválida nunca cae silenciosamente en otra identidad."""
        casos = [
            configuracion("AgentePrivado"),
            configuracion("Python-urllib/3.12"),
            configuracion("nombre@example.invalid"),
            configuracion(AGENTE_DE_PRUEBA + " Proyecto/1"),
            configuracion().replace('"version": 1', '"version": 1, "version": 1'),
            configuracion().replace('"User-Agent":', '"User-Agent": "duplicado", "User-Agent":'),
            configuracion(""),
            "no es JSON",
        ]
        for contenido in casos:
            self.configuracion.write_text(contenido, encoding="utf-8")
            with self.subTest(contenido=contenido), mock.patch.object(red, "abrir_peticion") as abrir:
                with self.assertRaises(FormatoInesperado):
                    red.descargar_url("https://ejemplo.invalid/a")
                abrir.assert_not_called()

    def test_formatos_comunes_y_ningun_anadido(self) -> None:
        """Solo formatos completos de navegador y plataforma fija pasan la validación."""
        chromium = (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
        )
        safari = (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 "
            "(KHTML, like Gecko) Version/18.0 Safari/605.1.15"
        )
        for agente in (AGENTE_DE_PRUEBA, FIREFOX_GENERICO, chromium, chromium + " Edg/130.0", safari):
            self.assertEqual(red.validar_agente(agente), agente)
        for agente in (None, True, AGENTE_DE_PRUEBA + "\r\nX-Prueba: valor", "x" * 513):
            with self.subTest(agente=agente), self.assertRaises(FormatoInesperado):
                red.validar_agente(agente)

    def test_cambio_de_configuracion_invalida_no_reutiliza_la_anterior(self) -> None:
        """No queda una identidad antigua cacheada que eluda un error de configuración posterior."""
        with mock.patch.object(red, "abrir_peticion", side_effect=lambda *_a, **_k: self.respuesta()) as abrir:
            red.descargar_url("https://ejemplo.invalid/a")
            self.configuracion.write_text(configuracion("AgentePrivado"), encoding="utf-8")
            with self.assertRaises(FormatoInesperado):
                red.descargar_url("https://ejemplo.invalid/b")
        self.assertEqual(abrir.call_count, 1)

    @staticmethod
    def respuesta() -> mock.MagicMock:
        """Crea una respuesta en memoria sin conexiones.

        Returns:
            El doble del contexto HTTP, con cuerpo acotado.
        """
        respuesta = mock.MagicMock(url="https://ejemplo.invalid/final", headers={"Content-Type": "text/plain"})
        respuesta.__enter__.return_value = respuesta
        respuesta.read1.side_effect = io.BytesIO(b"respuesta").read1
        return respuesta

    def test_las_cabeceras_no_sustituyen_la_identidad(self) -> None:
        """GET, POST y otras cabeceras siguen intactos; el navegador válido se conserva en el salto."""
        variantes = (
            {},
            {"User-Agent": "AgentePrivado"},
            {"USER-AGENT": "Otro"},
            {"User-Agent": "Uno", "user-agent": "Dos"},
        )
        for variante in variantes:
            for cuerpo in (None, b'{"consulta":1}'):
                cabeceras = {"Accept": "application/json", "Content-Type": "application/json", **variante}
                previas = dict(cabeceras)
                with (
                    self.subTest(cabeceras=variante, cuerpo=cuerpo),
                    mock.patch.object(red, "abrir_peticion", return_value=self.respuesta()) as abrir,
                ):
                    descarga = red.descargar_url("https://ejemplo.invalid/dato", cabeceras, 7, cuerpo)
                    peticion = abrir.call_args.args[0]
                    agentes = [valor for clave, valor in peticion.header_items() if clave.lower() == "user-agent"]
                    self.assertEqual(agentes, [AGENTE_DE_PRUEBA])
                    self.assertEqual(peticion.get_header("Accept"), "application/json")
                    self.assertIsNone(peticion.get_header("X-prueba"))
                    self.assertEqual(
                        (peticion.get_method(), peticion.data), ("GET" if cuerpo is None else "POST", cuerpo)
                    )
                    abrir.assert_called_once_with(peticion, timeout=7)
                    self.assertEqual(tuple(descarga), (b"respuesta", "https://ejemplo.invalid/final", "text/plain"))
                    self.assertEqual(cabeceras, previas)
                    seguida = red._RedireccionSoloWeb().redirect_request(
                        peticion, io.BytesIO(), 302, "Found", {}, "https://ejemplo.invalid/otra"
                    )
                    self.assertEqual(seguida.get_header("User-agent"), AGENTE_DE_PRUEBA)

    def test_configuracion_ilegible_no_envia_el_generico_a_escondidas(self) -> None:
        """Una configuración que existe pero no puede leerse se declara inválida antes del HTTP."""
        with (
            mock.patch.object(Path, "open", side_effect=PermissionError("sin permiso sintético")),
            mock.patch.object(red, "abrir_peticion") as abrir,
            self.assertRaises(FormatoInesperado),
        ):
            red.descargar_url("https://ejemplo.invalid/a")
        abrir.assert_not_called()

    def test_redireccion_no_propaga_una_identidad_antigua(self) -> None:
        """El handler tampoco puede continuar una petición ajena que lleva AgentePrivado."""
        peticion = red.Request("https://ejemplo.invalid/a", headers={"User-Agent": "AgentePrivado"})
        with self.assertRaises(FormatoInesperado):
            red._RedireccionSoloWeb().redirect_request(
                peticion, io.BytesIO(), 302, "Found", {}, "https://ejemplo.invalid/b"
            )
