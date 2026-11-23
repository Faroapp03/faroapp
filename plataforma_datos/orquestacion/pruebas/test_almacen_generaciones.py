"""Almacén por contenido sobre un filesystem real pequeño; ningún SDK, red o dato de producción."""

import hashlib
import json
import re
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from plataforma_datos.orquestacion import almacen_generaciones as almacen
from plataforma_datos.orquestacion import generacion_operativa as generacion
from plataforma_datos.orquestacion.pruebas.test_generacion_operativa import REVISION, preparar
from plataforma_datos.orquestacion.sustitucion import huellas_del_arbol


class AlmacenDeDisco:
    """Doble que conserva objetos reales inmutables y exige los hashes del protocolo."""

    def __init__(self, raiz: Path) -> None:
        self.raiz = raiz
        self.raiz.mkdir()
        self.guardados: list[str] = []
        self.recuperados: list[str] = []
        self.creados: list[str] = []

    def ruta(self, clave: str) -> Path:
        """Resuelve solo claves cerradas de objetos.

        Returns:
            Archivo del almacén de fixture.

        Raises:
            ValueError: Si no pertenece al espacio cerrado de objetos.
        """
        if re.fullmatch(r"(?:blobs/[0-9a-f]{64}|generaciones/[0-9a-f]{64}\.json)", clave) is None:
            raise ValueError("Clave inválida")
        return self.raiz / clave

    def guardar(self, clave: str, origen: Path, huella: str, tamano: int) -> None:
        """Guarda solo contenido íntegro, sin reemplazar una colisión.

        Raises:
            ValueError: Si los bytes o la identidad del objeto no coinciden.
        """
        self.guardados.append(clave)
        contenido = origen.read_bytes()
        if len(contenido) != tamano or hashlib.sha256(contenido).hexdigest() != huella:
            raise ValueError("Origen inválido")
        ruta = self.ruta(clave)
        ruta.parent.mkdir(parents=True, exist_ok=True)
        if not ruta.exists():
            with ruta.open("xb") as salida:
                salida.write(contenido)
            self.creados.append(clave)
        if ruta.read_bytes() != contenido:
            raise ValueError("Colisión")

    def recuperar(self, clave: str, destino: Path, huella: str, maximo: int) -> None:
        """Lee con cota y hash antes de publicar un archivo exclusivo.

        Raises:
            ValueError: Si el objeto supera su cota o no coincide con la huella esperada.
        """
        self.recuperados.append(clave)
        with self.ruta(clave).open("rb") as entrada:
            contenido = entrada.read(maximo + 1)
        if len(contenido) > maximo or hashlib.sha256(contenido).hexdigest() != huella:
            raise ValueError("Contenido inválido")
        with destino.open("xb") as salida:
            salida.write(contenido)


class PruebaAlmacenGeneraciones(unittest.TestCase):
    """Inventario vigente, confirmación remota y promoción local sin mezclar instalaciones."""

    def setUp(self) -> None:
        """Generación Unicode pequeña y un almacén distinto del destino."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.base = Path(temporal.name).resolve()
        self.instalacion = self.base / "Instalación Año 2026"
        preparar(self.instalacion)
        self.origen = self.base / "generación original"
        self.resumen = generacion.exportar_generacion(self.instalacion, self.origen, REVISION)
        self.huella = self.resumen["sha256Manifiesto"]
        self.manifiesto = generacion.verificar_generacion(self.origen, REVISION, self.huella)
        self.remoto = AlmacenDeDisco(self.base / "almacén privado")
        self.destino = self.base / "generación recuperada"

    def guardar(self) -> dict:
        """Guarda la generación de prueba.

        Returns:
            Resumen cerrado de persistencia confirmada.
        """
        return almacen.guardar_generacion(self.origen, REVISION, self.huella, self.remoto)

    def recuperar(self, huella: str | None = None) -> dict:
        """Recupera a un destino que no existe.

        Returns:
            Resumen cerrado de la generación verificada.
        """
        return almacen.recuperar_generacion(self.destino, REVISION, huella or self.huella, self.remoto)

    def sin_destino(self) -> None:
        """No quedan salida ni staging de esta invocación."""
        self.assertFalse(self.destino.exists())
        self.assertEqual(list(self.base.glob(".recuperando-generacion-*")), [])

    def poner_manifiesto(self, contenido: bytes) -> str:
        """Inyecta un objeto remoto con hash auténtico para probar su esquema.

        Returns:
            Hash del manifiesto de fixture, no una autorización derivada del contenido.
        """
        huella = hashlib.sha256(contenido).hexdigest()
        ruta = self.remoto.ruta(f"generaciones/{huella}.json")
        ruta.parent.mkdir(exist_ok=True)
        ruta.write_bytes(contenido)
        return huella

    def test_roundtrip_bytes_exactos_estado_historial_y_resumen(self) -> None:
        """Preserva todos los bytes y solo devuelve el resumen existente."""
        antes = huellas_del_arbol(self.origen)
        self.assertEqual(self.guardar(), self.resumen)
        self.assertEqual(self.recuperar(), self.resumen)
        self.assertEqual(huellas_del_arbol(self.origen), antes)
        self.assertEqual(huellas_del_arbol(self.destino), antes)
        self.assertEqual({p.name for p in self.destino.iterdir()}, {"manifiesto.json", "contenido"})
        self.assertEqual(generacion.verificar_generacion(self.destino, REVISION, self.huella), self.manifiesto)
        self.assertNotIn("interno", json.dumps(self.resumen))

    def test_manifiesto_ultimo_dedup_por_hash_e_idempotencia(self) -> None:
        """Cada blob único se envía una vez; otra llamada no crea ni reemplaza objetos."""
        self.guardar()
        hashes = {r["sha256"] for r in self.manifiesto["archivos"]}
        self.assertEqual(
            self.remoto.guardados[:-1],
            [f"blobs/{h}" for h in dict.fromkeys(r["sha256"] for r in self.manifiesto["archivos"])],
        )
        self.assertEqual(len(self.remoto.creados), len(hashes) + 1)
        self.assertEqual(self.remoto.guardados[-1], f"generaciones/{self.huella}.json")
        antes = huellas_del_arbol(self.remoto.raiz)
        creados = list(self.remoto.creados)
        self.guardar()
        self.assertEqual(self.remoto.creados, creados)
        self.assertEqual(huellas_del_arbol(self.remoto.raiz), antes)

    def test_cambio_parcial_reutiliza_blobs_anteriores(self) -> None:
        """Una generación distinta no vuelve a crear los objetos que ya coinciden."""
        self.guardar()
        anteriores = set(self.remoto.creados)
        (self.instalacion / "datos/lecturas.json").write_text('{"cambio":true}', encoding="utf-8")
        otra = self.base / "segunda generación"
        resumen = generacion.exportar_generacion(self.instalacion, otra, REVISION)
        almacen.guardar_generacion(otra, REVISION, resumen["sha256Manifiesto"], self.remoto)
        nuevos = set(self.remoto.creados) - anteriores
        self.assertEqual(len(nuevos), 2)
        self.assertIn(f"generaciones/{resumen['sha256Manifiesto']}.json", nuevos)

    def test_fallo_blob_no_publica_manifiesto_ni_borra_objetos_confirmados(self) -> None:
        """Un corte deja solo blobs completos no referenciados, sin marcador de éxito."""
        original = self.remoto.guardar
        llamadas = 0

        def fallar(clave: str, ruta: Path, huella: str, tamano: int) -> None:
            nonlocal llamadas
            llamadas += 1
            if llamadas > 1:
                raise OSError("diagnóstico interno no exportable")
            original(clave, ruta, huella, tamano)

        with (
            mock.patch.object(self.remoto, "guardar", side_effect=fallar),
            self.assertRaisesRegex(almacen.AlmacenGeneracionesInvalido, f"^{almacen.ERROR_GENERICO}$"),
        ):
            self.guardar()
        self.assertEqual(len(self.remoto.creados), 1)
        self.assertFalse((self.remoto.raiz / "generaciones").exists())
        self.assertEqual(self.guardar(), self.resumen)

    def test_fallo_confirmacion_manifiesto_no_devuelve_resumen(self) -> None:
        """Completar blobs no equivale a confirmar el manifiesto."""
        original = self.remoto.guardar

        def fallar(clave: str, ruta: Path, huella: str, tamano: int) -> None:
            if clave.startswith("generaciones/"):
                raise OSError("sin confirmación")
            original(clave, ruta, huella, tamano)

        with (
            mock.patch.object(self.remoto, "guardar", side_effect=fallar),
            self.assertRaises(almacen.AlmacenGeneracionesInvalido),
        ):
            self.guardar()
        self.assertTrue(self.remoto.creados)
        self.assertFalse((self.remoto.raiz / "generaciones").exists())

    def test_corrupcion_remota_no_se_sobrescribe_y_no_se_recupera(self) -> None:
        """El transporte rechaza una colisión y la recuperación falla cerrada."""
        self.guardar()
        clave = self.remoto.creados[0]
        ruta = self.remoto.ruta(clave)
        ruta.write_bytes(b"corrupto")
        with self.assertRaises(almacen.AlmacenGeneracionesInvalido):
            self.guardar()
        self.assertEqual(ruta.read_bytes(), b"corrupto")
        with self.assertRaises(almacen.AlmacenGeneracionesInvalido) as fallo:
            self.recuperar()
        self.assertNotIsInstance(fallo.exception, almacen.AlmacenGeneracionesNoDisponible)
        self.sin_destino()

    def test_recuperacion_cortada_por_el_almacen_se_distingue_de_la_no_integra(self) -> None:
        """Un almacén sin respuesta no se confunde con una generación rota y sigue siendo un fallo de recuperación."""
        self.guardar()
        with (
            mock.patch.object(self.remoto, "recuperar", side_effect=OSError("sin respuesta")),
            self.assertRaises(almacen.AlmacenGeneracionesNoDisponible) as fallo,
        ):
            self.recuperar()
        self.assertIsInstance(fallo.exception, almacen.AlmacenGeneracionesInvalido)
        self.assertEqual(str(fallo.exception), almacen.ERROR_GENERICO)
        self.sin_destino()

    def test_generacion_local_rota_o_expectativa_invalida_no_contacta_almacen(self) -> None:
        """Nunca comienza una publicación partiendo de contenido no verificado."""
        for revision, huella in (("b" * 40, self.huella), (REVISION, "0" * 64), ("HEAD", self.huella)):
            with self.subTest(revision=revision), self.assertRaises(almacen.AlmacenGeneracionesInvalido):
                almacen.guardar_generacion(self.origen, revision, huella, self.remoto)
        (self.origen / "contenido/datos/uno.json").write_bytes(b"alterado")
        with self.assertRaises(almacen.AlmacenGeneracionesInvalido):
            self.guardar()
        self.assertEqual(self.remoto.guardados, [])

    def test_lector_publico_valida_manifiesto_sin_abrir_contenido(self) -> None:
        """Puede validar rutas antes de que exista ningún blob descargado."""
        (self.origen / "contenido").rename(self.base / "fuera de lectura")
        self.assertEqual(generacion.leer_manifiesto_generacion(self.origen, REVISION, self.huella), self.manifiesto)
        with self.assertRaises((OSError, ValueError)):
            generacion.verificar_generacion(self.origen, REVISION, self.huella)

    def test_manifiesto_invalido_no_pide_blobs_ni_crea_rutas_de_contenido(self) -> None:
        """La huella correcta no admite traversal, esquemas abiertos o inventarios ambiguos."""

        def colision(documento: dict) -> None:
            registros = documento["archivos"]
            registros[0]["ruta"] = "datos/OTRO/a"
            registros[1]["ruta"] = "datos/otro/b"
            registros.sort(key=lambda r: r["ruta"])

        mutaciones = (
            ("traversal", lambda d: d["archivos"][0].update(ruta="../fuera")),
            ("extra", lambda d: d.update(extra="no-exportar")),
            ("duplicado", lambda d: d["archivos"].append(d["archivos"][0])),
            ("orden", lambda d: d["archivos"].reverse()),
            ("booleano", lambda d: d["archivos"][0].update(bytes=True)),
            ("suma", lambda d: d.update(bytesTotales=d["bytesTotales"] + 1)),
            ("arbol", lambda d: d["archivos"][0].update(ruta="otro/archivo")),
            ("antecesor", lambda d: d["archivos"][0].update(ruta="datos")),
            ("casefold", colision),
            ("estado", lambda d: d.update(estadoSha256=None)),
            ("paquete", lambda d: d.update(manifiestoPaqueteSha256="0" * 64)),
        )
        for defecto, modificar in mutaciones:
            documento = json.loads((self.origen / "manifiesto.json").read_bytes())
            modificar(documento)
            huella = self.poner_manifiesto(json.dumps(documento).encode())
            self.remoto.recuperados.clear()
            with self.subTest(defecto=defecto), self.assertRaises(almacen.AlmacenGeneracionesInvalido):
                self.recuperar(huella)
            self.assertEqual(self.remoto.recuperados, [f"generaciones/{huella}.json"])
            self.sin_destino()
        self.assertFalse((self.base / "fuera").exists())

    def test_manifiesto_truncado_json_duplicado_y_cota_rechazan(self) -> None:
        """Solo se solicita el manifiesto, siempre con la cota pública de ocho MiB."""
        for contenido in (b"{", b'{"version":1,"version":1}', b"\xff"):
            huella = self.poner_manifiesto(contenido)
            with self.subTest(contenido=contenido), self.assertRaises(almacen.AlmacenGeneracionesInvalido):
                self.recuperar(huella)
            self.sin_destino()
        self.guardar()
        with (
            mock.patch.object(almacen, "MAX_MANIFIESTO_BYTES", 1),
            self.assertRaises(almacen.AlmacenGeneracionesInvalido),
        ):
            self.recuperar()
        self.sin_destino()

    def test_blob_faltante_o_parcial_no_deja_generacion_ni_staging(self) -> None:
        """La recuperación no repara el remoto ni publica un candidato incompleto."""
        self.guardar()
        clave = self.remoto.creados[0]
        original = self.remoto.ruta(clave).read_bytes()
        self.remoto.ruta(clave).unlink()
        with self.assertRaises(almacen.AlmacenGeneracionesInvalido):
            self.recuperar()
        self.sin_destino()
        self.remoto.ruta(clave).write_bytes(original)
        recuperar = self.remoto.recuperar

        def cortar(clave: str, ruta: Path, huella: str, maximo: int) -> None:
            recuperar(clave, ruta, huella, maximo)
            if clave.startswith("blobs/"):
                ruta.write_bytes(b"parcial")
                raise OSError("corte")

        with (
            mock.patch.object(self.remoto, "recuperar", side_effect=cortar),
            self.assertRaises(almacen.AlmacenGeneracionesInvalido),
        ):
            self.recuperar()
        self.sin_destino()

    def test_tamano_blob_es_exacto_aunque_transporte_reciba_cota(self) -> None:
        """Un hash correcto no hace coincidir un tamaño de inventario falso."""
        self.guardar()
        documento = json.loads((self.origen / "manifiesto.json").read_bytes())
        documento["archivos"][0]["bytes"] += 1
        documento["bytesTotales"] += 1
        huella = self.poner_manifiesto(json.dumps(documento).encode())
        with self.assertRaises(almacen.AlmacenGeneracionesInvalido):
            self.recuperar(huella)
        self.sin_destino()

    def test_transporte_que_devuelve_bytes_alterados_no_elude_verificacion_final(self) -> None:
        """La admisión local independiente sigue siendo obligatoria."""
        self.guardar()
        recuperar = self.remoto.recuperar

        def alterar(clave: str, ruta: Path, huella: str, maximo: int) -> None:
            recuperar(clave, ruta, huella, maximo)
            if clave.startswith("blobs/"):
                ruta.write_bytes(b"alterado")

        with (
            mock.patch.object(self.remoto, "recuperar", side_effect=alterar),
            self.assertRaises(almacen.AlmacenGeneracionesInvalido),
        ):
            self.recuperar()
        self.sin_destino()

    def test_ausencia_original_estado_y_duplicados_son_archivos_propios(self) -> None:
        """No fabrica estado ni reconstruye los blobs repetidos con hardlinks."""
        (self.instalacion / generacion.ESTADO).unlink()
        otra = self.base / "sin intentos"
        resumen = generacion.exportar_generacion(self.instalacion, otra, REVISION)
        almacen.guardar_generacion(otra, REVISION, resumen["sha256Manifiesto"], self.remoto)
        self.recuperar(resumen["sha256Manifiesto"])
        self.assertFalse((self.destino / "contenido" / generacion.ESTADO).exists())
        for ruta in (self.destino / "contenido").rglob("*"):
            if ruta.is_file():
                self.assertEqual(ruta.stat().st_nlink, 1)

    def test_destino_existente_enlace_y_carrera_se_conservan(self) -> None:
        """La promoción no mezcla ni reemplaza árboles de otro propietario."""
        self.guardar()
        self.destino.mkdir()
        with self.assertRaises(almacen.AlmacenGeneracionesInvalido):
            self.recuperar()
        self.assertEqual(self.remoto.recuperados, [])
        self.destino.rmdir()
        self.destino.symlink_to(self.base / "ausente", target_is_directory=True)
        with self.assertRaises(almacen.AlmacenGeneracionesInvalido):
            self.recuperar()
        self.assertTrue(self.destino.is_symlink())
        self.destino.unlink()
        promover = almacen.promover_directorio

        def ganar(temporal: Path, destino: Path) -> None:
            destino.mkdir()
            (destino / "ajeno").write_bytes(b"conservar")
            promover(temporal, destino)

        with (
            mock.patch.object(almacen, "promover_directorio", side_effect=ganar),
            self.assertRaises(almacen.AlmacenGeneracionesInvalido),
        ):
            self.recuperar()
        self.assertEqual((self.destino / "ajeno").read_bytes(), b"conservar")
        self.assertEqual(list(self.base.glob(".recuperando-generacion-*")), [])


if __name__ == "__main__":
    unittest.main()
