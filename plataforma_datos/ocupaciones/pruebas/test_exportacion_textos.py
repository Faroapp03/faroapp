"""La exportación conserva los bytes admitidos y vuelve a contrastar las tareas oficiales."""

import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import plataforma_datos.ocupaciones.fuentes.textos.exportacion as exportacion
import plataforma_datos.ocupaciones.fuentes.textos.lector as textos
from plataforma_datos.comun.entrada_salida import guardar_json, guardar_jsonl, sha256
from plataforma_datos.comun.nucleo import ValidacionFallida


class ExportacionTextos(unittest.TestCase):
    """Pruebas de composición con entradas propias, sin datos operativos de la instalación."""

    def test_un_cambio_posterior_no_sustituye_los_bytes_admitidos(self) -> None:
        """El archivo puede cambiar tras comprobarse; se exporta el contenido que se comprobó."""
        with tempfile.TemporaryDirectory() as temporal:
            carpeta = Path(temporal)
            piloto = {"tareas": {"1111-1": {"corto": "Archivar", "texto_es": "Archivar documentos"}}}
            guardar_json(carpeta / textos.PILOTO, piloto)
            for nombre in (textos.GENERADAS, textos.TRADUCIDAS):
                guardar_jsonl(carpeta / nombre, [])
            validacion = {"sha256": {nombre: sha256(carpeta / nombre) for nombre in textos.ARCHIVOS}}

            def comprobar_y_sustituir() -> dict[str, bytes]:
                archivos = textos.archivos_validados()
                modificado = json.loads((carpeta / textos.PILOTO).read_text(encoding="utf-8"))
                modificado["tareas"]["1111-1"]["texto_es"] = "Contenido posterior sin validar"
                guardar_json(carpeta / textos.PILOTO, modificado)
                return archivos

            with (
                mock.patch.object(textos, "PREPARADO", carpeta),
                mock.patch.object(textos, "exigir_admitido", return_value=validacion),
                mock.patch.object(textos, "aviso_traduccion", return_value="Aviso de prueba"),
                mock.patch.object(exportacion, "PREPARADO_TEXTOS", carpeta),
                mock.patch.object(exportacion, "textos_validados", side_effect=comprobar_y_sustituir),
                mock.patch.object(exportacion, "leer_validado", return_value={"tareas": {"1111-1": {}}}),
            ):
                paquete = exportacion.paquete_textos()
            self.assertEqual(paquete.datos["tareas"]["1111-1"]["texto_es"], "Archivar documentos")
            self.assertEqual(paquete.origenes, [carpeta / nombre for nombre in textos.ARCHIVOS])

    def test_una_fuente_rechazada_no_se_combina(self) -> None:
        """Una huella o admisión incorrecta se propaga antes de componer el paquete."""
        error = ValidacionFallida("textos no admitidos")
        with (
            mock.patch.object(exportacion, "textos_validados", side_effect=error),
            mock.patch.object(exportacion, "combinar_textos") as combinar,
            self.assertRaises(ValidacionFallida) as resultado,
        ):
            exportacion.paquete_textos()
        self.assertIs(resultado.exception, error)
        combinar.assert_not_called()

    def test_la_combinacion_se_contrasta_con_el_catalogo_actual(self) -> None:
        """Una tarea retirada de la OIT no se exporta aunque sus archivos conserven sus huellas."""
        datos = {"tareas": {"9999-1": {"corto": "Archivar", "texto_es": "Archivar", "estado": "redacción manual"}}}
        with (
            mock.patch.object(exportacion, "textos_validados", return_value={}),
            mock.patch.object(exportacion, "combinar_textos", return_value=datos),
            mock.patch.object(exportacion, "leer_validado", return_value={"tareas": {"1111-1": {}}}),
            self.assertRaises(ValidacionFallida),
        ):
            exportacion.paquete_textos()


if __name__ == "__main__":
    unittest.main()
