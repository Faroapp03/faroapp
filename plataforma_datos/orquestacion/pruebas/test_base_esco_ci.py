"""Entrega privada de la base ESCO para un checkout de pruebas vacío."""

import hashlib
import io
import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError

from plataforma_datos.comun.nucleo import Descarga
from plataforma_datos.orquestacion import base_esco_ci as ci


class PruebaBaseEscoCi(unittest.TestCase):
    """La base y su informe se instalan juntos y con las expectativas del código."""

    def setUp(self) -> None:
        """Una instalación sin estado y las huellas de dos entradas conocidas."""
        carpeta = tempfile.TemporaryDirectory()
        self.addCleanup(carpeta.cleanup)
        self.raiz = Path(carpeta.name).resolve()
        self.base = b"contenido de la base para el ensayo de transporte"
        self.sha = hashlib.sha256(self.base).hexdigest()
        self.original = hashlib.sha256(b"captura fijada").hexdigest()
        huellas = self.raiz / ci.HUELLAS
        huellas.parent.mkdir(parents=True)
        huellas.write_text(f"{self.original}  {ci.CAPTURA}\n")
        self.informe = json.dumps({"sha256_sqlite": self.sha, "sha256_original": self.original}).encode()

    def paquete(self, base: bytes, informe: bytes) -> bytes:
        """Construye un ZIP pequeño con los mismos nombres que la distribución.

        Returns:
            Bytes del activo privado.
        """
        salida = io.BytesIO()
        with zipfile.ZipFile(salida, "w") as z:
            z.writestr(ci.BASE.name, base)
            z.writestr("validacion.json", informe)
        return salida.getvalue()

    def test_instalacion_exacta_y_destino_exclusivo(self) -> None:
        """El segundo intento conserva un directorio que ya pertenece al checkout."""
        paquete = self.paquete(self.base, self.informe)
        ci._instalar(self.raiz, paquete, self.sha)
        self.assertEqual((self.raiz / ci.BASE).read_bytes(), self.base)
        with self.assertRaises(ValueError):
            ci._instalar(self.raiz, paquete, self.sha)
        self.assertEqual((self.raiz / ci.BASE).with_name("validacion.json").read_bytes(), self.informe)

    def test_base_o_informe_alterado_no_se_instalan(self) -> None:
        """Aunque el ZIP sea legible, ambas huellas se cotejan antes de promover el directorio."""
        for paquete in (
            self.paquete(b"otro", self.informe),
            self.paquete(self.base, self.informe.replace(self.original.encode(), b"0" * 64)),
        ):
            with self.subTest(), self.assertRaises(ValueError):
                ci._instalar(self.raiz, paquete, self.sha)
            self.assertFalse((self.raiz / ci.BASE).parent.exists())

    def test_solo_la_api_recibe_el_token(self) -> None:
        """La descarga firmada se solicita de nuevo sin autenticación del repositorio."""
        api = "https://api.github.com/repos/entidad/ejemplo/releases/assets/12"
        cdn = "https://release-assets.githubusercontent.com/paquete"
        redireccion = HTTPError(api, 302, "Found", {"Location": cdn}, None)
        with patch.object(ci, "descargar_url", side_effect=[redireccion, Descarga(b"bytes", cdn, "")]) as pedir:
            self.assertEqual(ci._descargar_activo(api, "lectura", 5), b"bytes")
            self.assertEqual(pedir.call_args_list[0].args[1]["Authorization"], "Bearer lectura")
            self.assertEqual(pedir.call_args_list[1].args, (cdn,))
            self.assertFalse(pedir.call_args_list[1].kwargs["seguir_redirecciones"])

    def test_destino_ajeno_no_recibe_peticion(self) -> None:
        """Solo se aceptan los dominios HTTPS de entrega de activos."""
        api = "https://api.github.com/repos/entidad/ejemplo/releases/assets/12"
        redireccion = HTTPError(api, 302, "Found", {"Location": "https://tercero.example/otro"}, None)
        with patch.object(ci, "descargar_url", side_effect=redireccion) as pedir, self.assertRaises(ValueError):
            ci._descargar_activo(api, "lectura", 5)
        self.assertEqual(pedir.call_count, 1)
