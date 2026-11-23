"""Biblioteca cruza su productor real, el exportador común y la recuperación del paquete."""

import json
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from plataforma_datos.biblioteca.fuentes.enlaces_lecturas import lector as enlaces
from plataforma_datos.biblioteca.fuentes.lecturas import lector
from plataforma_datos.comun import entrada_salida
from plataforma_datos.comun.nucleo import RAIZ, ArchivoFaltante, ValidacionFallida
from plataforma_datos.orquestacion import exportar_paquete, modulos
from plataforma_datos.orquestacion.catalogo_de_datos import construir_catalogo


class IntegracionBiblioteca(unittest.TestCase):
    """Aísla el almacén; el productor editorial y su validador TS se ejecutan realmente."""

    def setUp(self) -> None:
        """Prepara el almacén temporal y simula solo los paquetes ajenos a Biblioteca."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.raiz = Path(temporal.name)
        for nombre in ("ORIGINALES", "PREPARADOS", "VALIDADOS"):
            parche = mock.patch.object(entrada_salida, nombre, self.raiz / nombre.lower())
            parche.start()
            self.addCleanup(parche.stop)
        self.destino = self.raiz / "datos"
        self.destino.mkdir()
        for nombre in ("oit.json", "lecturas.json", "observaciones-lecturas.json", "manifiesto.json"):
            (self.destino / nombre).write_bytes((nombre + " anterior").encode())
        self.previo = self.instantanea()
        parches = (
            mock.patch.object(
                exportar_paquete, "paquetes", return_value={"oit.json": exportar_paquete.Paquete({"v": 1}, [])}
            ),
            mock.patch.object(exportar_paquete, "entrada_escrita_por_herramienta", return_value=None),
            mock.patch.object(exportar_paquete, "enlaces_publicados", return_value=None),
        )
        for parche in parches:
            parche.start()
            self.addCleanup(parche.stop)

    def instantanea(self) -> dict[str, bytes]:
        """Devuelve todos los bytes visibles de la entrega de prueba.

        Returns:
            Nombre y contenido, sin leer una entrega de la instalación.
        """
        return {p.name: p.read_bytes() for p in self.destino.iterdir()}

    def admitir(self) -> None:
        """Ejecuta preparación y validación reales sin alterar entradas editoriales."""
        lector.preparar()
        lector.validar()
        enlaces.preparar()
        enlaces.validar()

    def test_exportacion_comun_repite_bytes_y_conserva_manifiesto_ocupacional(self) -> None:
        """La entrega editorial pasa por la guarda real y no cambia el contrato ocupacional."""
        self.admitir()
        manifiesto = exportar_paquete.exportar(self.destino)
        self.assertEqual((self.destino / "lecturas.json").read_bytes(), lector.CATALOGO.read_bytes())
        self.assertEqual(set(manifiesto), {"oit.json"})
        observaciones = json.loads((self.destino / "observaciones-lecturas.json").read_bytes())
        self.assertEqual(observaciones["verificados"], 0)
        self.assertTrue(all(f["ultimo_intento"] is None for f in observaciones["objetivos"]))
        self.assertTrue(all(f["ultima_confirmacion"] is None for f in observaciones["objetivos"]))
        primera = self.instantanea()
        exportar_paquete.exportar(self.destino)
        self.assertEqual(self.instantanea(), primera)

    def test_falta_de_admision_conserva_toda_la_entrega(self) -> None:
        """Registrar el productor no permite copiar el catálogo sin comprobarlo."""
        with self.assertRaises(ArchivoFaltante):
            exportar_paquete.exportar(self.destino)
        self.assertEqual(self.instantanea(), self.previo)

    def test_firma_alterada_no_se_salta_en_exportacion_general(self) -> None:
        """La exportación común llama la guarda de contratos y no copia el validado directamente."""
        self.admitir()
        ruta = lector.carpetas(lector.FUENTE).validacion
        informe = json.loads(ruta.read_text())
        informe["entradas"]["plataforma_datos/biblioteca/fuentes/lecturas/catalogo.json"] = "0" * 64
        entrada_salida.guardar_json(ruta, informe)
        with self.assertRaises(ValidacionFallida):
            exportar_paquete.exportar(self.destino)
        self.assertEqual(self.instantanea(), self.previo)

    def test_fallo_despues_de_promover_biblioteca_restaura_todo(self) -> None:
        """Un fallo posterior al nuevo catálogo restaura también la Biblioteca previa."""
        self.admitir()
        sustituir = Path.replace
        promovida = []

        def reemplazar(origen: Path, destino: Path) -> Path:
            if destino == self.destino / "manifiesto.json":
                raise OSError("fallo posterior a Biblioteca")
            resultado = sustituir(origen, destino)
            if destino.parent == self.destino and destino.name in {"lecturas.json", "observaciones-lecturas.json"}:
                promovida.append(destino.name)
            return resultado

        with mock.patch.object(Path, "replace", reemplazar), self.assertRaisesRegex(OSError, "posterior"):
            exportar_paquete.exportar(self.destino)
        self.assertEqual(promovida, ["lecturas.json", "observaciones-lecturas.json"])
        self.assertEqual(self.instantanea(), self.previo)

    def test_observacion_alterada_conserva_entrega_anterior(self) -> None:
        """La cadena común exige evidencia admitida de enlaces, sin aceptar contadores inventados."""
        self.admitir()
        validado = enlaces.carpetas(enlaces.FUENTE).validado / enlaces.ARCHIVO
        datos = json.loads(validado.read_text())
        datos["verificados"] = len(datos["objetivos"])
        validado.write_text(json.dumps(datos), encoding="utf-8")
        with self.assertRaises(ValidacionFallida):
            exportar_paquete.exportar(self.destino)
        self.assertEqual(self.instantanea(), self.previo)

    def test_productor_declarado_y_trazable_sin_acreditar_vigencia_remota(self) -> None:
        """El inventario atribuye las referencias editoriales a su productor, no a un rastreo."""
        self.assertEqual(modulos.comprobar_registro(), [])
        inventario = self.raiz / "inventario"
        for nombre in (
            "datos/manifiesto.json",
            "datos/lecturas.json",
            "src/plataforma/archivos-del-paquete.ts",
            "src/comun/nombres-propios.ts",
            "motores/ocupaciones/src/recorrido/pantalla/previa-fusion.ts",
        ):
            destino = inventario / nombre
            destino.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(RAIZ / nombre, destino)
        nodos = {n["id"]: n for n in construir_catalogo(inventario)["nodos"]}
        salida = nodos["archivo:datos/lecturas.json"]
        self.assertEqual(salida["productor"], "fuente:lecturas")
        self.assertEqual(salida["cobertura_productor"], "adaptador-declarado-sin-ejecucion-acreditada")
        registros = [n for id_, n in nodos.items() if id_.startswith("lectura:")]
        self.assertTrue(registros)
        self.assertTrue(all(n["productor"] == "fuente:lecturas" and n["editorial"] for n in registros))
        self.assertFalse(nodos["fuente:lecturas"]["automatizacion"]["red_declarada"])
        observaciones = nodos["archivo:datos/observaciones-lecturas.json"]
        self.assertEqual(observaciones["productor"], "fuente:enlaces_lecturas")
        self.assertEqual(
            {consumidor["ruta"] for consumidor in observaciones["consumidores"]},
            {
                "herramientas/web/lecturas.ts",
                "herramientas/web/lecturas/observaciones.ts",
                "web/scripts/enlaces-biblioteca.js",
            },
        )
        self.assertEqual(observaciones["cobertura_productor"], "adaptador-declarado-sin-ejecucion-acreditada")
        self.assertFalse(observaciones["editorial"])


if __name__ == "__main__":
    unittest.main()
