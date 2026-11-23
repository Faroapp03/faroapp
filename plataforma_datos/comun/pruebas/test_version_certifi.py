"""La comprobación de certifi observa la última versión publicada y avisa sin cambiar nada.

La respuesta de PyPI es simulada con la forma de su índice JSON (https://pypi.org/pypi/certifi/json): un objeto con
«info» (nombre, versión y demás metadatos), «releases», «urls» y «vulnerabilities». Ninguna prueba usa la red.
"""

import json
import unittest

import plataforma_datos.comun.fuentes.version_certifi.lector as certifi
from plataforma_datos.comun.confianza_tls import CERTIFI_VERSION
from plataforma_datos.comun.entrada_salida import leer_json, ruta_del_conjunto
from plataforma_datos.comun.nucleo import FormatoInesperado, ValidacionFallida
from plataforma_datos.mercado.pruebas.ayuda_productores import ConDatosAislados, Respuesta


def indice(version: str, nombre: str = "certifi") -> bytes:
    """Un índice JSON de PyPI con la forma real y la versión dada.

    Returns:
        Sus bytes.
    """
    return json.dumps(
        {
            "info": {
                "name": nombre,
                "version": version,
                "summary": "Python package for providing Mozilla's CA Bundle.",
            },
            "last_serial": 1,
            "releases": {version: []},
            "urls": [],
            "vulnerabilities": [],
        }
    ).encode()


class PruebaVersionCertifi(ConDatosAislados):
    """Con la misma versión no hay aviso; con otra, un aviso cerrado en los dos idiomas."""

    def vuelta(self, version: str) -> dict:
        """Descarga con un doble de red, prepara y valida.

        Returns:
            El conjunto validado.
        """
        with self.con_red({certifi.URL: Respuesta(indice(version))}):
            certifi.descargar(True)
        certifi.preparar()
        certifi.validar()
        return leer_json(ruta_del_conjunto(certifi.FUENTE))

    def test_misma_version_sin_aviso(self) -> None:
        """Si PyPI publica la fijada, no hay nada que avisar."""
        conjunto = self.vuelta(CERTIFI_VERSION)
        self.assertEqual((conjunto["publicada"], conjunto["aviso"]), (CERTIFI_VERSION, None))
        self.assertEqual(self.pedidas, [certifi.URL])

    def test_version_nueva_deja_un_aviso_cerrado(self) -> None:
        """Una versión posterior deja el aviso con su forma cerrada y sin tocar el almacén fijado."""
        aviso = self.vuelta("2099.01.01")["aviso"]
        self.assertEqual(set(aviso), {"clave", "fijada", "publicada", "consultado", "texto"})
        self.assertEqual((aviso["fijada"], aviso["publicada"]), (CERTIFI_VERSION, "2099.01.01"))
        self.assertIn("certifi 2099.01.01", aviso["texto"]["es"])
        self.assertIn("Faro no lo cambia solo", aviso["texto"]["es"])
        self.assertIn("Faro no el canvia tot sol", aviso["texto"]["ca"])

    def test_version_nueva_por_la_via_de_la_descarga_sin_aceptar_cambio(self) -> None:
        """Con otro índice que el capturado, `descargar(False)` lo acepta y deja el aviso de versión nueva."""
        with self.con_red({certifi.URL: Respuesta(indice(CERTIFI_VERSION))}):
            certifi.descargar(False)
        with self.con_red({certifi.URL: Respuesta(indice("2099.01.01"))}):
            certifi.descargar(False)
        certifi.preparar()
        certifi.validar()
        conjunto = leer_json(ruta_del_conjunto(certifi.FUENTE))
        self.assertEqual(conjunto["publicada"], "2099.01.01")
        self.assertEqual(conjunto["aviso"]["publicada"], "2099.01.01")

    def test_por_el_camino_real_de_la_peticion(self) -> None:
        """Con el transporte doblado en `abrir_peticion`, la consulta pasa por la identidad, el turno y los topes."""
        with self.con_transporte({certifi.URL: Respuesta(indice(CERTIFI_VERSION))}):
            certifi.descargar(False)
        certifi.preparar()
        certifi.validar()
        self.assertIsNone(leer_json(ruta_del_conjunto(certifi.FUENTE))["aviso"])

    def test_respuesta_ajena_o_version_anterior_se_rechazan(self) -> None:
        """Otro paquete o una versión sin forma de certifi no se guardan; una anterior a la fijada no se admite."""
        for cuerpo in (indice("2099.01.01", "requests"), indice("2.0"), b"<html>"):
            with (
                self.subTest(cuerpo=cuerpo[:30]),
                self.con_red({certifi.URL: Respuesta(cuerpo)}),
                self.assertRaises(FormatoInesperado),
            ):
                certifi.descargar(True)
        with self.assertRaises(ValidacionFallida):
            self.vuelta("2000.01.01")


if __name__ == "__main__":
    unittest.main()
