"""El reparto de la descarga del catálogo es un registro fuente → adquisición, sin red."""

import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from plataforma_datos.cursos import adquisicion_por_fuente, operacion_fuente


class PruebaRepartoDeAdquisicion(unittest.TestCase):
    """Cada fuente del catálogo tiene una adquisición registrada y solo esa se ejecuta."""

    def test_registro_cubre_exactamente_las_fuentes_del_catalogo(self) -> None:
        """Una fuente nueva no puede quedar sin adquisición ni heredar la de otra."""
        self.assertEqual(set(adquisicion_por_fuente.ADQUIRIENTES), set(operacion_fuente.FUENTES))
        self.assertEqual(len(set(adquisicion_por_fuente.ADQUIRIENTES.values())), len(operacion_fuente.FUENTES))

    def test_descargar_llama_solo_a_la_adquisicion_de_su_fuente(self) -> None:
        """Recibe identidades conocidas, carpeta, procedencia anterior y raíz; las demás no se tocan."""
        for fuente in operacion_fuente.FUENTES:
            with self.subTest(fuente=fuente), tempfile.TemporaryDirectory() as temporal:
                raiz = Path(temporal)
                original, _, _ = operacion_fuente.rutas_de_la_fuente(fuente, raiz)
                original.mkdir(parents=True)
                (original / "procedencia.json").write_text(json.dumps({"fuente": fuente}))
                # Cada adquisición devuelve los problemas de su lectura; aquí ninguno.
                dobles = {nombre: mock.Mock(return_value=()) for nombre in adquisicion_por_fuente.ADQUIRIENTES}
                programas = [{"id": fuente + ":uno"}]
                with (
                    mock.patch.dict(adquisicion_por_fuente.ADQUIRIENTES, dobles),
                    mock.patch.object(operacion_fuente, "conocidos", return_value=programas),
                ):
                    operacion_fuente.descargar(fuente, raiz=raiz)
                dobles[fuente].assert_called_once_with(programas, original, {"fuente": fuente}, raiz)
                for otra, doble in dobles.items():
                    if otra != fuente:
                        doble.assert_not_called()


if __name__ == "__main__":
    unittest.main()
