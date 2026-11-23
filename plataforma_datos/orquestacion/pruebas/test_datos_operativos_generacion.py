"""Traslado de la estructura real de entradas activas sin aceptar archivos arbitrarios."""

import json
import shutil
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from plataforma_datos.comun.entrada_salida import guardar_json, sha256
from plataforma_datos.comun.nucleo import RAIZ, ErrorFuente
from plataforma_datos.orquestacion import generacion_operativa as generacion
from plataforma_datos.orquestacion import indices_operativos
from plataforma_datos.orquestacion.pruebas.test_generacion_operativa import REVISION, preparar


class DatosOperativosGeneracionPruebas(unittest.TestCase):
    """Usa solo entradas versionadas públicas; ninguna descarga ni estado de la instalación."""

    def setUp(self) -> None:
        """Copia las carpetas cerradas y las salidas que las consumen."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.temporal = Path(temporal.name)
        self.raiz = self.temporal / "Copia Año 2026"
        preparar(self.raiz)
        self.ruta_manifiesto = self.raiz / "datos/manifiesto.json"
        self.manifiesto = json.loads(self.ruta_manifiesto.read_bytes())
        original = json.loads((RAIZ / "datos/manifiesto.json").read_bytes())
        self.entradas = set()
        for carpeta in generacion.DOCUMENTOS_OPERATIVOS:
            relativa = f"datos/{carpeta}"
            shutil.copytree(RAIZ / relativa, self.raiz / relativa)
            self.entradas |= {
                p.relative_to(self.raiz).as_posix() for p in (self.raiz / relativa).rglob("*") if p.is_file()
            }
        for nombre in generacion.ORIGENES_OPERATIVOS:
            shutil.copyfile(RAIZ / "datos" / nombre, self.raiz / "datos" / nombre)
            self.manifiesto[nombre] = original[nombre]
        guardar_json(self.ruta_manifiesto, self.manifiesto)

    def test_estructura_real_se_exporta_restaura_y_conserva_bytes(self) -> None:
        """Los vectores, el ZIP fijo y la procedencia local llegan al siguiente candidato."""
        self.assertTrue(self.entradas <= generacion._datos(self.raiz))
        bundle, destino = self.temporal / "generación", self.temporal / "Restauración ñ"
        recibo = generacion.exportar_generacion(self.raiz, bundle, REVISION)
        generacion.restaurar_generacion(bundle, destino, REVISION, recibo["sha256Manifiesto"])
        self.assertTrue(self.entradas <= generacion._datos(destino))
        for nombre in self.entradas:
            self.assertEqual((self.raiz / nombre).read_bytes(), (destino / nombre).read_bytes())
        for nombre in (
            "datos/vectores-movil/ocup_es.i8",
            "datos/vectores-movil/indices.json",
            "datos/fuentes/recursos-fijados/captura.zip",
            "datos/fuentes/hoja-de-ruta/procedencia.json",
        ):
            self.assertIn(nombre, self.entradas)

    def test_extra_y_origen_fuera_del_contrato_siguen_rechazados(self) -> None:
        """Ni una carpeta conocida ni un origen añadido convierten otro archivo en entrada."""
        extra = self.raiz / "datos/vectores-movil/no-declarado.json"
        extra.write_bytes(b"{}")
        with self.assertRaises(ValueError):
            generacion._datos(self.raiz)
        extra.unlink()
        entrada = self.manifiesto["vectores-movil.json"]["origenes"]
        entrada["datos/vectores-movil/../fuera.json"] = "a" * 64
        guardar_json(self.ruta_manifiesto, self.manifiesto)
        with self.assertRaises(ValueError):
            generacion._datos(self.raiz)

    def test_huellas_alteradas_y_limite_de_captura_rechazan(self) -> None:
        """Los índices no autorizan otra ruta ni silencian bytes modificados."""
        ruta = self.raiz / "datos/vectores-movil/huellas.json"
        original = ruta.read_bytes()
        dato = json.loads(original)
        dato["../fuera.json"] = "b" * 64
        guardar_json(ruta, dato)
        with self.assertRaises(ValueError):
            generacion._datos(self.raiz)
        ruta.write_bytes(original)
        with patch.object(indices_operativos, "MAX_ENTRADA_CAPTURA", 1), self.assertRaises(ValueError):
            generacion._datos(self.raiz)
        (self.raiz / "datos/vectores-movil/ocup_es.i8").write_bytes(b"otro vector")
        with self.assertRaises(ErrorFuente):
            generacion._datos(self.raiz)

    def test_zip_nuevo_no_sustituye_el_registro_fijo_admitido(self) -> None:
        """Una nueva huella del contenedor no acredita contenidos distintos ni entradas extra."""
        ruta = self.raiz / "datos/fuentes/recursos-fijados/captura.zip"
        with zipfile.ZipFile(ruta, "w") as archivo:
            for nombre in indices_operativos.CAPTURAS_FIJADAS:
                archivo.writestr(nombre, b"otro contenido")
        for nombre in indices_operativos.RECURSOS_FIJADOS_DEL_PAQUETE:
            self.manifiesto[nombre]["origenes"]["datos/fuentes/recursos-fijados/captura.zip"] = sha256(ruta)
        guardar_json(self.ruta_manifiesto, self.manifiesto)
        with self.assertRaises(ValueError):
            generacion._datos(self.raiz)
