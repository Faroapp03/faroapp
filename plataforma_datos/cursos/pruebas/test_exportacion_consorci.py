"""La exportación individual del Consorci exige admisión y conserva el conjunto compacto."""

import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from plataforma_datos.comun import entrada_salida
from plataforma_datos.comun.nucleo import ArchivoFaltante, Carpetas, Controles, ValidacionFallida
from plataforma_datos.orquestacion import admision
from plataforma_datos.orquestacion.exportacion import comun, validados


class PruebaExportacionConsorci(unittest.TestCase):
    """La lectura y la escritura comunes preservan orden, contenido y huellas de la fuente."""

    def test_conjunto_admitido_se_publica_sin_transformacion(self) -> None:
        """Un único origen produce los mismos bytes JSON compactos y su entrada de manifiesto."""
        with tempfile.TemporaryDirectory() as temporal:
            raiz = Path(temporal)
            carpetas = Carpetas(raiz / "original", raiz / "preparado", raiz / "validado")
            carpetas.validado.mkdir()
            datos = {"fuente": "Árbol", "ediciones": [{"id": "2"}, {"id": "1"}], "entidades": {"e2": None}}
            contenido = json.dumps(datos, ensure_ascii=False, separators=(",", ":")).encode()
            origen = carpetas.validado / "consorci.json"
            origen.write_bytes(contenido)
            controles = Controles()
            controles.comprobar(origen.read_bytes() == contenido, "bytes de la fixture Consorci conservados")
            carpetas.validacion.write_text(
                json.dumps({"estado": controles.estado, "controles": controles.lista}), encoding="utf-8"
            )
            with (
                mock.patch.object(entrada_salida, "carpetas", return_value=carpetas),
                mock.patch.object(admision, "carpetas", return_value=carpetas),
            ):
                paquete = validados.paquete_validado("consorci")
            self.assertEqual(paquete.datos, datos)
            self.assertEqual(list(paquete.datos), list(datos))
            self.assertEqual(paquete.origenes, [origen])
            entrada = comun.escribir("consorci.json", paquete, raiz, formato="compacto")
            self.assertEqual((raiz / "consorci.json").read_bytes(), contenido)
            huella = hashlib.sha256(contenido).hexdigest()
            self.assertEqual(entrada, {"origenes": {str(origen.resolve()): huella}, "sha256": huella})

    def test_no_lee_conjunto_sin_admision(self) -> None:
        """La validación real se exige antes de leer un conjunto existente."""
        with (
            mock.patch.object(admision, "exigir_admitido", side_effect=ValidacionFallida("no admitida")),
            mock.patch.object(admision, "leer_json") as leer,
            self.assertRaises(ValidacionFallida),
        ):
            validados.paquete_validado("consorci")
        leer.assert_not_called()

    def test_conjunto_ausente_no_se_sustituye_por_vacio(self) -> None:
        """La admisión no oculta la ausencia del único origen declarado."""
        with tempfile.TemporaryDirectory() as temporal:
            raiz = Path(temporal)
            with (
                mock.patch.object(admision, "exigir_admitido", return_value={}),
                mock.patch.object(admision, "ruta_del_conjunto", return_value=raiz / "ausente.json"),
                self.assertRaises(ArchivoFaltante),
            ):
                validados.paquete_validado("consorci")


if __name__ == "__main__":
    unittest.main()
