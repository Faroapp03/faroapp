"""VersionHistory se contrasta offline; ninguna prueba acredita una descarga real."""

import io
import json
import os
import tempfile
import unittest
from datetime import UTC, datetime
from http.client import HTTPResponse
from pathlib import Path
from unittest import mock

from plataforma_datos.comun import entrada_salida, observacion_remota, red
from plataforma_datos.comun.fuentes.versiones_navegadores import lector
from plataforma_datos.comun.nucleo import Carpetas, Descarga, FormatoInesperado
from plataforma_datos.orquestacion import admision

FECHA = "2026-10-22T10:00:00+00:00"
SIGUIENTE = "2026-10-23T10:00:00+00:00"
VERSION = "156.0.8078.48"


def release(version: str = VERSION, fraction: float = 1.0) -> dict[str, object]:
    """Construye una publicación específica de Chrome estable.

    Returns:
        Registro sintético de la estructura pública.
    """
    return {
        "name": f"chrome/platforms/win/channels/stable/versions/{version}/releases/1792526214",
        "version": version,
        "fraction": fraction,
        "serving": {"startTime": "2026-10-20T19:56:54.652014Z"},
    }


def captura(*releases: dict[str, object]) -> bytes:
    """Codifica una respuesta completa de prueba.

    Returns:
        JSON sin paginación.
    """
    return json.dumps({"releases": releases, "nextPageToken": ""}).encode()


class PruebaVersionesNavegadores(unittest.TestCase):
    """Comprueba ventanas, identidad de publicación y continuidad de última buena."""

    def setUp(self) -> None:
        """Aísla todas las etapas y el reloj; no usa var del producto ni red."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.raiz = Path(temporal.name)
        self.carpetas = Carpetas(*(self.raiz / nombre for nombre in ("original", "preparado", "validado")))
        for parche in (
            mock.patch.object(lector, "carpetas", return_value=self.carpetas),
            mock.patch.object(entrada_salida, "carpetas", return_value=self.carpetas),
            mock.patch.object(admision, "carpetas", return_value=self.carpetas),
            mock.patch.object(lector, "ahora_utc", return_value=FECHA),
            mock.patch("plataforma_datos.comun.red.ahora_utc", return_value=FECHA),
        ):
            parche.start()
            self.addCleanup(parche.stop)

    def adquirir(self, datos: bytes, fecha: str = FECHA) -> None:
        """Simula solo el transporte, conservando preparación y validación reales."""
        with (
            mock.patch.object(lector, "descargar_url", return_value=Descarga(datos, lector.URL, "application/json")),
            mock.patch("plataforma_datos.comun.red.ahora_utc", return_value=fecha),
            mock.patch.object(lector, "ahora_utc", return_value=max(FECHA, fecha)),
        ):
            lector.descargar()
            lector.preparar()
            lector.validar()

    def test_orden_numerico_y_versiones_sin_duplicados(self) -> None:
        """Rollouts repetidos no duplican versiones ni el orden textual elige una antigua."""
        datos = captura(release("99.0.9.9"), release(), release(), release("157.0.0.1", 0))
        seleccion = lector.seleccionar(datos, FECHA)
        self.assertEqual(seleccion["version_completa"], VERSION)
        self.assertEqual(seleccion["versiones_activas"], [VERSION, "99.0.9.9"])

    def test_ventanas_y_limite_exacto(self) -> None:
        """El inicio es inclusivo y el final exclusivo con zonas horarias explícitas."""
        for serving in (
            {"startTime": SIGUIENTE},
            {"startTime": FECHA, "endTime": FECHA},
            {"startTime": "2026-10-22T10:00:00"},
        ):
            with self.subTest(serving=serving), self.assertRaises(FormatoInesperado):
                lector.seleccionar(captura({**release(), "serving": serving}), FECHA)
        resultado = lector.seleccionar(captura({**release(), "serving": {"startTime": FECHA}}), FECHA)
        self.assertEqual(resultado["version_completa"], VERSION)

    def test_producto_canal_y_version_deben_coincidir(self) -> None:
        """No acepta beta, otro producto ni versión contradictoria aunque HTTP haya funcionado."""
        for nombre in (
            str(release()["name"]).replace("/stable/", "/beta/"),
            str(release()["name"]).replace("chrome/", "edge/"),
            str(release()["name"]).replace(VERSION, "155.0.0.0"),
        ):
            with self.subTest(nombre=nombre), self.assertRaises(FormatoInesperado):
                lector.seleccionar(captura({**release(), "name": nombre}), FECHA)

    def test_json_incompleto_html_duplicados_y_fraction_invalidos(self) -> None:
        """Un cuerpo sintáctico o semánticamente incompleto nunca acredita una versión."""
        invalidos = [
            b"<html>error</html>",
            b'{"releases":[],"releases":[]}',
            json.dumps({"releases": [release()], "nextPageToken": "otra"}).encode(),
            captura(),
            captura(release(fraction=0)),
            *(captura({**release(), "fraction": valor}) for valor in (True, -1, 2, "1", float("nan"))),
        ]
        for datos in invalidos:
            with self.subTest(datos=datos), self.assertRaises(FormatoInesperado):
                lector.seleccionar(datos, FECHA)

    def test_admision_perfil_reducido_y_fecha_real(self) -> None:
        """La salida guarda el build como metadato y un único major para el perfil."""
        self.adquirir(captura(release()))
        datos = lector.admitido()
        self.assertEqual(datos["version_completa"], VERSION)
        self.assertEqual(datos["version_reducida"], "156.0.0.0")
        self.assertEqual(datos["observado_utc"], FECHA)
        self.assertEqual(datos["perfil"], lector.perfil_web.perfil_chrome(VERSION))

    def test_repeticion_no_reescribe_ni_rejuvenece(self) -> None:
        """Igual captura conserva fecha, bytes y mtime de todos los resultados estables."""
        datos = captura(release())
        self.adquirir(datos)
        anteriores = {
            p.relative_to(self.raiz): (p.read_bytes(), p.stat().st_mtime_ns)
            for p in self.raiz.rglob("*")
            if p.is_file()
        }
        self.adquirir(datos, FECHA)
        for relativo, (contenido, mtime) in anteriores.items():
            ruta = self.raiz / relativo
            self.assertEqual(ruta.read_bytes(), contenido)
            self.assertEqual(ruta.stat().st_mtime_ns, mtime)
        self.assertEqual(lector.admitido()["observado_utc"], FECHA)

    def test_error_transitorio_preserva_ultima_buena(self) -> None:
        """Un fallo de adquisición no equivale a retirada ni a comprobación nueva."""
        self.adquirir(captura(release()))
        previo = lector.admitido()
        with mock.patch.object(lector, "descargar_url", side_effect=TimeoutError), self.assertRaises(TimeoutError):
            lector.descargar()
        self.assertEqual(lector.admitido(), previo)

    def test_retroceso_conserva_ultima_buena_y_cuerpo_rechazado(self) -> None:
        """Una respuesta posterior con una versión menor exige revisión, incluso aceptar-cambio."""
        self.adquirir(captura(release()))
        previo = lector.admitido()
        datos = captura(release("155.0.8059.86"))
        with self.assertRaisesRegex(FormatoInesperado, "retroceso"):
            self.adquirir(datos, SIGUIENTE)
        self.assertEqual(lector.admitido(), previo)
        self.assertTrue(any(p.read_bytes() == datos for p in self.carpetas.original.glob("chrome-*.json")))
        with self.assertRaises(FormatoInesperado):
            lector.preparar()

    def test_recuperacion_tras_cuerpo_invalido_preserva_fecha_y_rechazo(self) -> None:
        """Volver a obtener el último cuerpo bueno recupera las etapas sin borrar el rechazo."""
        datos = captura(release())
        self.adquirir(datos)
        previo = lector.admitido()
        with self.assertRaises(FormatoInesperado):
            self.adquirir(b"<html>temporal</html>", SIGUIENTE)
        self.assertEqual(lector.admitido(), previo)
        self.adquirir(datos, SIGUIENTE)
        with mock.patch.object(lector, "ahora_utc", return_value=SIGUIENTE):
            recuperado = lector.admitido()
        self.assertEqual(recuperado["version_completa"], previo["version_completa"])
        self.assertEqual(recuperado["observado_utc"], SIGUIENTE)
        self.assertIn(previo["original"], lector._entradas())
        self.assertTrue(any(p.read_bytes() == b"<html>temporal</html>" for p in self.carpetas.original.glob("*.json")))

    def test_version_nueva_avanza_y_url_final_generica_no(self) -> None:
        """Una publicación mayor puede avanzar; una redirección genérica no acredita la API."""
        self.adquirir(captura(release()))
        self.adquirir(captura(release("157.0.0.1")), FECHA)
        self.assertEqual(lector.admitido()["version_completa"], "157.0.0.1")
        previo = lector.admitido()
        with (
            mock.patch.object(lector, "ahora_utc", return_value=SIGUIENTE),
            mock.patch.object(
                lector, "descargar_url", return_value=Descarga(b"{}", "https://google.com/", "text/html")
            ),
            self.assertRaisesRegex(FormatoInesperado, "redirección"),
        ):
            lector.descargar()
        with mock.patch.object(lector, "ahora_utc", return_value=SIGUIENTE):
            self.assertEqual(lector.admitido(), previo)

    def test_captura_anterior_no_gana(self) -> None:
        """Un build mayor llegado con observación anterior no reemplaza el último admitido."""
        self.adquirir(captura(release()))
        previo = lector.admitido()
        with self.assertRaisesRegex(FormatoInesperado, "anterior"):
            self.adquirir(captura(release("157.0.0.1")), "2026-10-21T10:00:00Z")
        self.assertEqual(lector.admitido(), previo)

    def test_alterar_preparado_original_o_contrato_impide_admision_y_reuso(self) -> None:
        """No basta un antiguo informe Admitido para aceptar contenido alterado."""
        self.adquirir(captura(release()))
        ruta = self.carpetas.preparado / "candidato.json"
        contenido = json.loads(ruta.read_bytes())
        contenido["version_completa"] = "999.0.0.0"
        ruta.write_text(json.dumps(contenido))
        with self.assertRaises(FormatoInesperado):
            lector.validar()
        with mock.patch.object(lector, "_firmas", return_value={}), self.assertRaises(FormatoInesperado):
            lector.admitido()
        original = next(self.carpetas.original.glob("chrome-*.json"))
        original.write_bytes(b"{}")
        with self.assertRaises(FormatoInesperado):
            lector.admitido()

    def test_captura_real_solo_estructura_sin_admision(self) -> None:
        """El fixture pequeño reproduce duplicados y fechas; no fabrica una recepción histórica."""
        datos = captura(release(), release(fraction=0), release("155.0.8059.86", 0.1))
        self.assertEqual(lector.seleccionar(datos, FECHA)["versiones_activas"], [VERSION, "155.0.8059.86"])
        self.assertFalse(self.carpetas.validacion.exists())

    def test_cli_vincula_cuerpo_con_recibo_comun_sin_red(self) -> None:
        """La CLI real acredita los mismos bytes conservados, no una observación inventada."""
        datos = captura(release())
        conexion = mock.Mock()
        conexion.makefile.return_value = io.BytesIO(
            b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: "
            + str(len(datos)).encode()
            + b"\r\n\r\n"
            + datos
        )
        respuesta = HTTPResponse(conexion)
        respuesta.begin()
        respuesta.url = lector.URL
        ruta = self.raiz / "recepcion.json"
        configuracion = json.dumps({"ruta": str(ruta), "fuente": lector.FUENTE, "intento": "ensayo_offline"})
        with (
            mock.patch.dict(os.environ, {observacion_remota.VARIABLE_RECEPCION: configuracion}),
            mock.patch.object(red, "abrir_peticion", return_value=respuesta),
            mock.patch.object(red, "PAUSAS", red.PausasPorDominio(lambda: 0.0, lambda _s: None)),
            mock.patch.object(lector.perfil_web, "leer_perfil", return_value=lector.perfil_web.perfil_chrome()),
        ):
            self.assertEqual(lector.main(["descargar"]), 0)
        recibo = observacion_remota.leer_recepcion(ruta, lector.FUENTE, "ensayo_offline")
        self.assertIsNotNone(recibo)
        if recibo is not None:
            self.assertEqual(len(recibo["peticiones"]), 1)
            peticion = recibo["peticiones"][0]
            self.assertEqual(peticion["original_sha256"], entrada_salida.sha256_bytes(datos))
            self.assertEqual(peticion["respuesta_sha256"], peticion["original_sha256"])
            self.assertEqual(peticion["original_bytes"], len(datos))

    def test_instante_utc_explicito(self) -> None:
        """La comparación no depende de la zona horaria del equipo."""
        self.assertEqual(lector._instante("2026-10-22T12:00:00+02:00"), datetime(2026, 10, 22, 10, tzinfo=UTC))
