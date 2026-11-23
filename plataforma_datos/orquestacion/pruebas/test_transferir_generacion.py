"""Configuración privada y CLI de transferencias, con almacén local y sin peticiones de red."""

import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from plataforma_datos.orquestacion import transferir_generacion as cli
from plataforma_datos.orquestacion.generacion_operativa import exportar_generacion
from plataforma_datos.orquestacion.pruebas.test_almacen_generaciones import AlmacenDeDisco
from plataforma_datos.orquestacion.pruebas.test_generacion_operativa import REVISION, preparar
from plataforma_datos.orquestacion.sustitucion import huellas_del_arbol

CONFIG = {
    "version": 1,
    "endpoint": "https://almacen.example.test",
    "bucket": "datos-privados",
    "prefijo": "generaciones",
    "region": "auto",
}
ENTORNO = {
    "FARO_ALMACEN_S3": json.dumps(CONFIG),
    "FARO_ALMACEN_ACCESS_KEY_ID": "PRUEBAACCESO1234567890",
    "FARO_ALMACEN_SECRET_ACCESS_KEY": "secreto-ficticio-que-no-debe-aparecer-en-salidas",
}


class PruebaTransferirGeneracion(unittest.TestCase):
    """La herramienta solo usa su perfil explícito y emite éxito tras verificar la generación."""

    def invocar(self, accion: str = "guardar", directorio: Path = Path("ausente"), huella: str = "a" * 64) -> tuple:
        """Recoge código de salida y canales de la CLI sin capturar secretos del sistema.

        Returns:
            Código, salida estándar y salida de error.
        """
        salida, error = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(salida), contextlib.redirect_stderr(error):
            codigo = cli.main(
                [accion, str(directorio), "--revision-generacion", REVISION, "--sha256-manifiesto", huella]
            )
        return codigo, salida.getvalue(), error.getvalue()

    def test_configuracion_cerrada_rechaza_antes_de_crear_cliente(self) -> None:
        """Duplicados, claves desconocidas, tipos incorrectos y cotas no abren el almacén."""
        documentos = ["", "{", "[]", "null", " " * (cli.MAX_CONFIG_BYTES + 1)]
        documentos.append(json.dumps(CONFIG)[:-1] + ',"version":1}')
        documentos.extend(json.dumps({**CONFIG, "version": valor}) for valor in (True, 2, None))
        documentos.extend(json.dumps({**CONFIG, "endpoint": valor}) for valor in (None, 1, [], {}))
        documentos.extend((json.dumps({**CONFIG, "extra": "ignorar"}), json.dumps({"version": 1})))
        for texto in documentos:
            with (
                self.subTest(texto=texto[:80]),
                mock.patch.dict(cli.os.environ, {**ENTORNO, "FARO_ALMACEN_S3": texto}, clear=True),
                mock.patch.object(cli, "AlmacenS3") as cliente,
            ):
                codigo, salida, error = self.invocar()
                self.assertEqual((codigo, salida, error), (1, "", cli.ERROR_GENERICO + "\n"))
                cliente.assert_not_called()

    def test_credenciales_ambientales_no_sustituyen_las_explicitas(self) -> None:
        """Tener claves AWS no habilita un perfil Faro incompleto."""
        ambientales = {"AWS_ACCESS_KEY_ID": "otra-clave", "AWS_SECRET_ACCESS_KEY": "otro-secreto"}
        for ausente in ENTORNO:
            entorno = {**ENTORNO, **ambientales}
            del entorno[ausente]
            with (
                self.subTest(ausente=ausente),
                mock.patch.dict(cli.os.environ, entorno, clear=True),
                mock.patch.object(cli, "AlmacenS3") as cliente,
            ):
                self.assertEqual(self.invocar(), (1, "", cli.ERROR_GENERICO + "\n"))
                cliente.assert_not_called()

    def test_perfil_conserva_campos_y_no_representa_secretos(self) -> None:
        """La entrega separa el perfil de sus claves y no las incorpora al repr."""
        configuracion = cli.configuracion_privada(ENTORNO)
        for campo in CONFIG.keys() - {"version"}:
            self.assertEqual(getattr(configuracion, campo), CONFIG[campo])
        self.assertEqual(configuracion.access_key_id, ENTORNO["FARO_ALMACEN_ACCESS_KEY_ID"])
        self.assertEqual(configuracion.secret_access_key, ENTORNO["FARO_ALMACEN_SECRET_ACCESS_KEY"])
        for secreto in (configuracion.access_key_id, configuracion.secret_access_key):
            self.assertNotIn(secreto, repr(configuracion))

    def test_referencia_malformada_no_crea_cliente(self) -> None:
        """La huella debe venir completa del ejecutor; no se infiere ni corrige."""
        with mock.patch.dict(cli.os.environ, ENTORNO, clear=True), mock.patch.object(cli, "AlmacenS3") as cliente:
            self.assertEqual(self.invocar(huella="incompleta"), (1, "", cli.ERROR_GENERICO + "\n"))
            cliente.assert_not_called()

    def test_guardar_y_recuperar_desde_cli_conserva_generacion(self) -> None:
        """La ruta pública de la CLI llega a ambas operaciones y verifica sus archivos completos."""
        with tempfile.TemporaryDirectory() as nombre:
            base = Path(nombre).resolve()
            instalacion = base / "Instalación Año 2026"
            preparar(instalacion)
            origen, destino = base / "origen", base / "recuperada"
            resumen = exportar_generacion(instalacion, origen, REVISION)
            almacen = AlmacenDeDisco(base / "almacén")
            with (
                mock.patch.dict(cli.os.environ, ENTORNO, clear=True),
                mock.patch.object(cli, "AlmacenS3", side_effect=lambda _: contextlib.nullcontext(almacen)),
            ):
                for accion, ruta in (("guardar", origen), ("recuperar", destino)):
                    codigo, salida, error = self.invocar(accion, ruta, resumen["sha256Manifiesto"])
                    self.assertEqual((codigo, error), (0, ""))
                    self.assertEqual(json.loads(salida), resumen)
            self.assertEqual(huellas_del_arbol(origen), huellas_del_arbol(destino))

    def test_fallo_cierra_cliente_y_no_publica_diagnostico_privado(self) -> None:
        """Un error de transporte no imprime credenciales ni un resumen de éxito."""
        for accion, operacion in (("guardar", "guardar_generacion"), ("recuperar", "recuperar_generacion")):
            with (
                self.subTest(accion=accion),
                mock.patch.dict(cli.os.environ, ENTORNO, clear=True),
                mock.patch.object(cli, "AlmacenS3") as cliente,
                mock.patch.object(cli, operacion, side_effect=OSError(ENTORNO["FARO_ALMACEN_SECRET_ACCESS_KEY"])),
            ):
                self.assertEqual(self.invocar(accion), (1, "", cli.ERROR_GENERICO + "\n"))
                cliente.return_value.__exit__.assert_called_once()


if __name__ == "__main__":
    unittest.main()
