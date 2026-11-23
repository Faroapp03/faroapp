"""Volumen realista de rutas con cuerpos pequeños, sin red ni datos de producción."""

import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from plataforma_datos.orquestacion import almacen_artefactos as artefactos
from plataforma_datos.orquestacion import almacen_generaciones as generaciones
from plataforma_datos.orquestacion import bloques_almacen as bloques
from plataforma_datos.orquestacion import generacion_operativa as generacion
from plataforma_datos.orquestacion.pruebas.test_almacen_artefactos import REVISION, contenidos, serializar, sha
from plataforma_datos.orquestacion.pruebas.test_almacen_trabajos import Memoria
from plataforma_datos.orquestacion.pruebas.test_generacion_operativa import preparar


class PruebaBloquesRemotos(unittest.TestCase):
    """La recuperación depende del manifiesto auténtico y conserva todas las rutas de un artefacto."""

    def setUp(self) -> None:
        """Prepara una entrega con cientos de assets, duplicados y cuerpos vacíos."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.base = Path(temporal.name)
        self.origen = self.base / "origen"
        self.destino = self.base / "recuperado"
        self.remoto = Memoria()
        self.archivos, self.paquete, manifiesto = contenidos()
        self.archivos.update({f"web/recurso-{i}.txt": f"recurso {i}".encode() for i in range(600)})
        for ruta, contenido in self.archivos.items():
            archivo = self.origen / ruta
            archivo.parent.mkdir(parents=True, exist_ok=True)
            archivo.write_bytes(contenido)
        descriptor = serializar(
            {
                "version": 1,
                "revisionCodigo": REVISION,
                "huellaPaquete": self.paquete,
                "sha256ManifiestoPaquete": sha(manifiesto),
                "sha256ManifiestoDispositivo": sha(self.archivos["web/firmas/manifiesto.json"]),
                "archivos": [
                    {"ruta": ruta, "bytes": len(c), "sha256": sha(c)} for ruta, c in sorted(self.archivos.items())
                ],
            }
        )
        (self.origen / "artefacto.json").write_bytes(descriptor)
        self.huella = hashlib.sha256(descriptor).hexdigest()
        self.marcador = f"artefactos/{self.huella}.json"
        self.puntero = f"agrupaciones/v1/artefactos/{self.huella}.sha256"

    def guardar(self) -> dict:
        """Guarda por el punto de entrada del producto.

        Returns:
            Resumen del verificador del artefacto.
        """
        return artefactos.guardar_artefacto(self.origen, REVISION, self.paquete, self.huella, self.remoto)

    def recuperar(self) -> dict:
        """Intenta promover una carpeta independiente.

        Returns:
            Resumen del verificador completo tras la extracción.
        """
        return artefactos.recuperar_artefacto(self.destino, REVISION, self.paquete, self.huella, self.remoto)

    def sin_salida(self) -> None:
        """Comprueba que un fallo de integridad no promueve contenido ni deja el staging."""
        self.assertFalse(self.destino.exists())
        self.assertFalse(any(self.base.glob(".recuperando-artefacto-*")))
        self.assertFalse(any(self.base.glob(".bloques-almacen-*")))

    def test_cientos_de_archivos_viajan_en_pocas_operaciones(self) -> None:
        """Reduce tanto las escrituras como las lecturas manteniendo identidades y bytes."""
        resumen = self.guardar()
        self.assertLess(len(self.remoto.eventos), 32)
        self.assertEqual(self.remoto.eventos[-1], ("guardar", f"artefactos/{self.huella}.json"))
        self.remoto.eventos.clear()
        self.assertEqual(self.recuperar(), resumen)
        self.assertLess(len(self.remoto.eventos), 32)
        self.assertEqual({p: (self.destino / p).read_bytes() for p in self.archivos}, self.archivos)
        vacio, copia = self.destino / "web/vacio.txt", self.destino / "web/otro-vacio.txt"
        self.assertNotEqual(vacio.stat().st_ino, copia.stat().st_ino)

    def test_artefacto_grande_anterior_sigue_legible_sin_puntero(self) -> None:
        """Un 404 del puntero permite recuperar exactamente el formato histórico del mismo marcador."""
        self.remoto.objetos[self.marcador] = (self.origen / "artefacto.json").read_bytes()
        self.remoto.objetos.update({f"blobs/{sha(c)}": c for c in self.archivos.values()})
        self.recuperar()
        self.assertEqual((self.destino / "web/recurso-599.txt").read_bytes(), b"recurso 599")
        self.assertNotIn(self.puntero, self.remoto.objetos)

    def test_puntero_cortado_no_publica_marcador_y_reintento_es_idempotente(self) -> None:
        """Una respuesta perdida puede dejar el puntero comprometido; el reintento coteja los bytes existentes."""
        self.remoto.corte = (self.puntero, "despues")
        with self.assertRaises(artefactos.AlmacenArtefactosInvalido):
            self.guardar()
        self.assertNotIn(self.marcador, self.remoto.objetos)
        objetos = dict(self.remoto.objetos)
        self.assertIn(self.puntero, objetos)
        self.remoto.corte = None
        resumen = self.guardar()
        self.assertEqual({k: v for k, v in self.remoto.objetos.items() if k != self.marcador}, objetos)
        self.assertEqual(self.guardar(), resumen)
        self.assertEqual(self.recuperar(), resumen)

    def test_discrepancia_del_puntero_existente_no_publica_marcador(self) -> None:
        """Dos escritores no pueden reemplazar una asociación distinta para el mismo manifiesto."""
        self.remoto.guardar_control(self.puntero, b"f" * 64, None)
        with self.assertRaises(artefactos.AlmacenArtefactosInvalido):
            self.guardar()
        self.assertEqual(self.remoto.objetos[self.puntero], b"f" * 64)
        self.assertNotIn(self.marcador, self.remoto.objetos)

    def test_ausencia_de_un_bloque_o_indice_invalido_no_recurre_al_legado(self) -> None:
        """Incluso cuando también existen blobs históricos, se rechaza un formato agrupado incompleto."""
        self.guardar()
        self.remoto.objetos.update({f"blobs/{sha(c)}": c for c in self.archivos.values()})
        puntero = self.remoto.objetos[self.puntero]
        indice = self.remoto.objetos["blobs/" + puntero.decode()]
        del self.remoto.objetos["blobs/" + indice[:32].hex()]
        with self.assertRaises(artefactos.AlmacenArtefactosInvalido):
            self.recuperar()
        self.sin_salida()
        self.remoto.objetos[self.puntero] = b"../fuera"
        with self.assertRaises(artefactos.AlmacenArtefactosInvalido):
            self.recuperar()
        self.sin_salida()

    def test_timeout_al_leer_puntero_no_desencadena_una_descarga_historica(self) -> None:
        """Una indisponibilidad del control aborta antes de descargar cualquier contenido."""
        self.guardar()
        self.remoto.eventos.clear()
        with (
            mock.patch.object(self.remoto, "leer_control", side_effect=TimeoutError("consulta interrumpida")),
            self.assertRaises(artefactos.AlmacenArtefactosInvalido),
        ):
            self.recuperar()
        self.assertEqual(self.remoto.eventos, [("recuperar", self.marcador)])
        self.sin_salida()

    def test_indice_con_huella_valida_y_tamano_imposible_falla(self) -> None:
        """El número de hashes está fijado por el inventario incluso si el índice tiene SHA auténtico."""
        self.guardar()
        original = self.remoto.objetos["blobs/" + self.remoto.objetos[self.puntero].decode()]
        for indice in (original[:-32], original + bytes(32)):
            with self.subTest(tamano=len(indice)):
                huella = sha(indice)
                self.remoto.objetos[self.puntero] = huella.encode()
                self.remoto.objetos["blobs/" + huella] = indice
                with self.assertRaises(artefactos.AlmacenArtefactosInvalido):
                    self.recuperar()
                self.sin_salida()

    def test_bloque_de_otro_contenido_no_pasa_aunque_la_cadena_remota_sea_coherente(self) -> None:
        """El índice no manda sobre el tamaño ni el SHA auténticos de cada miembro."""
        self.guardar()
        puntero = self.remoto.objetos[self.puntero]
        indice = self.remoto.objetos["blobs/" + puntero.decode()]
        original = self.remoto.objetos["blobs/" + indice[:32].hex()]
        for alterado in (b"X" + original[1:], original[:-1], original + b"X"):
            with self.subTest(tamano=len(alterado)):
                huella = sha(alterado)
                nuevo = bytes.fromhex(huella) + indice[32:]
                self.remoto.objetos[self.puntero] = sha(nuevo).encode()
                self.remoto.objetos["blobs/" + sha(nuevo)] = nuevo
                self.remoto.objetos["blobs/" + huella] = alterado
                with self.assertRaises(artefactos.AlmacenArtefactosInvalido):
                    self.recuperar()
                self.sin_salida()

    def test_cortes_de_bloque_y_archivos_individuales_grandes(self) -> None:
        """Fuerza varias fronteras y transferencias por SHA individual con el mismo descriptor."""
        with mock.patch.object(bloques, "BYTES_BLOQUE", 40):
            resumen = self.guardar()
            self.assertIn("blobs/" + sha(self.archivos["web/firmas/manifiesto.json"]), self.remoto.objetos)
            self.assertEqual(self.recuperar(), resumen)


class PruebaGeneracionAgrupada(unittest.TestCase):
    """Prueba el mismo transporte mediante el exportador, el marcador y la admisión de generaciones."""

    def test_generacion_integra_con_cientos_de_archivos(self) -> None:
        """Guarda y restaura una generación completa sin modificar el resumen ni el manifiesto."""
        with tempfile.TemporaryDirectory() as nombre:
            base = Path(nombre)
            origen, semilla, recuperada = base / "origen", base / "semilla", base / "recuperada"
            preparar(origen)
            ruta = origen / "datos/manifiesto.json"
            datos = json.loads(ruta.read_bytes())
            for i in range(400):
                nombre_json = f"apartado-{i}.json"
                contenido = serializar({"indice": i})
                (ruta.parent / nombre_json).write_bytes(contenido)
                datos[nombre_json] = {"sha256": sha(contenido)}
            ruta.write_bytes(serializar(datos))
            resumen = generacion.exportar_generacion(origen, semilla, REVISION)
            huella, remoto = resumen["sha256Manifiesto"], Memoria()
            self.assertEqual(generaciones.guardar_generacion(semilla, REVISION, huella, remoto), resumen)
            self.assertLess(len(remoto.eventos), 32)
            self.assertEqual(remoto.eventos[-1], ("guardar", f"generaciones/{huella}.json"))
            remoto.eventos.clear()
            self.assertEqual(generaciones.recuperar_generacion(recuperada, REVISION, huella, remoto), resumen)
            self.assertLess(len(remoto.eventos), 32)
            self.assertEqual((semilla / "manifiesto.json").read_bytes(), (recuperada / "manifiesto.json").read_bytes())
