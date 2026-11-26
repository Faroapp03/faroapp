"""Persistencia aislada por fuente, con almacén de prueba y sin ejecutar ningún productor."""

import hashlib
import json
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path
from unittest import mock

from plataforma_datos.comun.entrada_salida import guardar_json, sha256
from plataforma_datos.comun.nucleo import CORRECTO
from plataforma_datos.orquestacion import almacen_s3, bloques_almacen
from plataforma_datos.orquestacion import entradas_por_fuente as entradas
from plataforma_datos.orquestacion.pruebas.test_almacen_generaciones import AlmacenDeDisco

FUENTE = "tich"
BASE = Path("var/actualizacion")
ORIGINALES = BASE / "originales/tich"
PREPARADOS = BASE / "preparados/tich"
VALIDADOS = BASE / "validados/tich"
LECTOR = "d" * 64
DEPENDENCIAS = {"clasificaciones": "e" * 64}
OBSERVADO = "2026-11-27T00:10:00Z"
IDENTIDAD = entradas.IdentidadEntradas(
    "45731459565", "1", "238c57d0-16e6-4ab5-b870-cb40d684e840", 44, "a" * 40, "b" * 64, "2026-11-26"
)
CLAVE = "entradas/v1/45731459565/1/tich.json"


class AlmacenPrivado(AlmacenDeDisco):
    """Doble del transporte y del control inmutable con la misma lista de claves que el adaptador S3."""

    def __init__(self, raiz: Path) -> None:
        super().__init__(raiz)
        self.controles: dict[str, bytes] = {}

    def leer_control(self, clave: str, bytes_maximos: int) -> tuple[bytes, str] | None:
        """Devuelve bytes acotados o la ausencia del objeto.

        Returns:
            Bytes y ETag opaco de la prueba, o None.
        """
        if clave not in self.controles:
            return None
        contenido = self.controles[clave]
        assert len(contenido) <= bytes_maximos <= almacen_s3._control(clave)
        return contenido, f'"{hashlib.sha256(contenido).hexdigest()}"'

    def guardar_control(self, clave: str, contenido: bytes, etag: str | None) -> bool:
        """Simula una creación condicional sin aceptar sustituciones.

        Returns:
            Si la creación obtuvo el único lugar disponible.
        """
        assert len(contenido) <= almacen_s3._control(clave)
        if etag is not None:
            assert almacen_s3.CLAVE_ULTIMO_LOTE.fullmatch(clave) is not None
        vigente = self.controles.get(clave)
        esperado = f'"{hashlib.sha256(vigente).hexdigest()}"' if vigente is not None else None
        if esperado != etag:
            return False
        self.controles[clave] = contenido
        return True


class PruebaEntradasPorFuente(unittest.TestCase):
    """Prueba original, preparado y validado sin necesidad de generación ni paquete publicable."""

    def setUp(self) -> None:
        """Datos privados pequeños, con procedencia y admisión contrastables."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.base = Path(temporal.name).resolve()
        self.raiz = self.base / "candidato"
        self.destino = self.base / "recuperada"
        self.almacen = AlmacenPrivado(self.base / "almacen")
        for relativa in (ORIGINALES, PREPARADOS, VALIDADOS):
            (self.raiz / relativa).mkdir(parents=True)
        self.original = self.raiz / ORIGINALES / "microdatos.txt"
        self.original.write_bytes(b"edicion admitida")
        self.conjunto = self.raiz / VALIDADOS / "tich.json"
        self.conjunto.write_bytes(b'{"anio":"2026"}')
        (self.raiz / VALIDADOS / "edicion.json").write_bytes(b'{"anio":"2026"}')
        (self.raiz / PREPARADOS / "tich.json").write_bytes(self.conjunto.read_bytes())
        guardar_json(
            self.raiz / VALIDADOS / "validacion.json",
            {
                "estado": "Admitido",
                "controles": [{"control": "cuadra", "resultado": CORRECTO}],
            },
        )
        self.registrar_procedencia([self.original])

    def registrar_procedencia(self, archivos: list[Path]) -> None:
        """Publica la lista exacta de originales de la prueba."""
        guardar_json(
            self.raiz / ORIGINALES / "procedencia.json",
            {
                "archivos": [{"archivo": p.name, "sha256": sha256(p)} for p in archivos],
            },
        )

    def guardar(self, identidad: entradas.IdentidadEntradas = IDENTIDAD) -> dict:
        """Sella esta fuente.

        Returns:
            Descriptor inmutable del intento.
        """
        return entradas.guardar_entrada(
            identidad,
            FUENTE,
            self.raiz,
            observado_en=OBSERVADO,
            lector_sha256=LECTOR,
            dependencias=DEPENDENCIAS,
            almacen=self.almacen,
        )

    def recuperar(self, identidad: entradas.IdentidadEntradas = IDENTIDAD) -> dict | None:
        """Recupera con la identidad esperada.

        Returns:
            Descriptor del árbol nuevo, o None si no existe su control.
        """
        return entradas.recuperar_entrada(identidad, FUENTE, self.destino, almacen=self.almacen)

    def test_rechazo_del_paquete_no_impide_guardar_entradas_independientes(self) -> None:
        """El archivo trae solo las rutas del módulo admitido y comprueba los bytes de su precarga."""
        (self.raiz / "datos").mkdir()
        (self.raiz / "datos/manifiesto.json").write_bytes(b"paquete no utilizable")
        (self.raiz / ORIGINALES / "intento-anterior.tmp").write_bytes(b"sobrante sin procedencia")
        control = self.guardar()
        self.assertEqual(control["base"], {"revisionCodigo": "a" * 40, "sha256Manifiesto": "b" * 64})
        self.assertEqual((control["dia"], control["observadoEn"]), ("2026-11-26", OBSERVADO))
        self.assertEqual(control["dependencias"], DEPENDENCIAS)
        self.assertEqual(control["lectorSha256"], LECTOR)
        self.assertEqual(self.recuperar(), control)
        self.assertEqual((self.destino / ORIGINALES / self.original.name).read_bytes(), self.original.read_bytes())
        self.assertEqual((self.destino / VALIDADOS / self.conjunto.name).read_bytes(), self.conjunto.read_bytes())
        self.assertEqual((self.destino / PREPARADOS / "tich.json").read_bytes(), self.conjunto.read_bytes())
        self.assertFalse((self.destino / "datos").exists())
        self.assertFalse((self.destino / ORIGINALES / "intento-anterior.tmp").exists())
        with self.assertRaises(entradas.EntradaInvalida):
            self.recuperar()

    def test_repetir_tras_respuesta_perdida_es_idempotente(self) -> None:
        """Relee el sello de una escritura incierta y conserva ese único inventario."""
        guardar_control = self.almacen.guardar_control

        def escribir_sin_respuesta(clave: str, contenido: bytes, etag: str | None) -> bool:
            guardar_control(clave, contenido, etag)
            raise almacen_s3.AlmacenS3NoDisponible("respuesta perdida")

        with mock.patch.object(self.almacen, "guardar_control", side_effect=escribir_sin_respuesta):
            anterior = self.guardar()
        transferencias = self.almacen.guardados.copy()
        self.assertEqual(self.guardar(), anterior)
        self.assertEqual(self.almacen.guardados, transferencias)
        self.conjunto.write_bytes(b"otro contenido")
        with self.assertRaises(entradas.EntradaInvalida):
            self.guardar()
        self.assertEqual(self.recuperar(), anterior)
        self.assertNotEqual((self.destino / VALIDADOS / self.conjunto.name).read_bytes(), self.conjunto.read_bytes())

    def test_parte_subida_sin_control_no_es_una_captura(self) -> None:
        """Tras un fallo de transporte el lector solo ve ausencia, hasta que una repetición confirma el control."""
        guardar = self.almacen.guardar

        def guardar_y_cortar(clave: str, origen: Path, huella: str, tamano: int) -> None:
            guardar(clave, origen, huella, tamano)
            raise almacen_s3.AlmacenS3NoDisponible("corte")

        with (
            mock.patch.object(self.almacen, "guardar", side_effect=guardar_y_cortar),
            self.assertRaises(entradas.EntradaNoDisponible),
        ):
            self.guardar()
        self.assertIsNone(self.recuperar())
        self.assertFalse(self.destino.exists())
        confirmado = self.guardar()
        self.assertEqual(self.recuperar(), confirmado)

    def test_identidad_equivocada_se_rechaza_antes_de_leer_blobs(self) -> None:
        """Ni otra reserva, ni otro día, ni otra base abren el inventario de ese intento."""
        self.guardar()
        casos = (
            replace(IDENTIDAD, revision_reserva=45),
            replace(IDENTIDAD, sha256_base="c" * 64),
            replace(IDENTIDAD, revision_base="9" * 40),
            replace(IDENTIDAD, dia="2026-11-27"),
            replace(IDENTIDAD, solicitud_id="e94ce173-13c4-410b-8c45-a19c524da027"),
        )
        for identidad in casos:
            with self.subTest(identidad=identidad), self.assertRaises(entradas.EntradaInvalida):
                self.recuperar(identidad)
        self.assertEqual(self.almacen.recuperados, [])
        self.assertIsNone(self.recuperar(replace(IDENTIDAD, intento="2")))

    def test_control_o_blob_ausente_o_corrupto_deja_el_destino_intacto(self) -> None:
        """Un objeto incompleto bajo un control confirmado falla cerrado."""
        control = self.guardar()
        clave = f"blobs/{control['inventario']['sha256']}"
        ruta = self.almacen.ruta(clave)
        ruta.write_bytes(b"contenido manipulado")
        with self.assertRaises(entradas.EntradaInvalida):
            self.recuperar()
        ruta.unlink()
        with self.assertRaises(entradas.EntradaInvalida):
            self.recuperar()
        self.assertFalse(self.destino.exists())
        self.assertFalse(list(self.base.glob(".recuperando-entradas-*")))

    def test_inventario_ajeno_con_sha_valido_no_abre_rutas(self) -> None:
        """Una ruta ajena a TICH se rechaza aunque el manifiesto tenga autenticidad de transporte."""
        control = self.guardar()
        inventario = json.loads(self.almacen.ruta(f"blobs/{control['inventario']['sha256']}").read_bytes())
        inventario["archivos"][0]["ruta"] = "var/actualizacion/originales/empresas/procedencia.json"
        contenido = json.dumps(inventario).encode()
        huella = hashlib.sha256(contenido).hexdigest()
        self.almacen.ruta(f"blobs/{huella}").write_bytes(contenido)
        control["inventario"] = {"sha256": huella, "bytes": len(contenido)}
        self.almacen.controles[CLAVE] = json.dumps(control).encode()
        with self.assertRaises(entradas.EntradaInvalida):
            self.recuperar()
        self.assertEqual(self.almacen.recuperados, [f"blobs/{huella}"])
        self.assertFalse(self.destino.exists())

    def test_solo_originales_cotejados_y_validacion_admitida(self) -> None:
        """Cambiar el original o fallar la admisión no crea un sello."""
        self.original.write_bytes(b"original sustituido")
        with self.assertRaises(entradas.EntradaInvalida):
            self.guardar()
        self.registrar_procedencia([self.original])
        (self.raiz / VALIDADOS / "validacion.json").write_bytes(b'{"estado":"no admitido","controles":[]}')
        with self.assertRaises(entradas.EntradaInvalida):
            self.guardar()
        self.assertEqual(self.almacen.guardados, [])
        self.assertEqual(self.almacen.controles, {})

    def test_informe_admitido_sin_conjunto_no_sella(self) -> None:
        """El informe por sí solo no acredita el conjunto que usa el exportador."""
        self.conjunto.unlink()
        with self.assertRaises(entradas.EntradaInvalida):
            self.guardar()
        self.assertEqual(self.almacen.guardados, [])
        self.assertIsNone(self.recuperar())

    def test_procedencia_repetida_exige_la_misma_huella(self) -> None:
        """El último registro correcto no disimula una declaración incompatible."""
        ruta = self.raiz / ORIGINALES / "procedencia.json"
        correcta = {"archivo": self.original.name, "sha256": sha256(self.original)}
        guardar_json(ruta, {"archivos": [{**correcta, "sha256": "0" * 64}, correcta]})
        with self.assertRaises(entradas.EntradaInvalida):
            self.guardar()
        self.assertEqual(self.almacen.guardados, [])
        guardar_json(ruta, {"archivos": [correcta, correcta]})
        self.assertEqual(self.guardar(), self.recuperar())

    def test_ausencia_preparados_y_bloques_de_archivos(self) -> None:
        """Los bloques restauran originales abundantes, sin exigir una carpeta de preparados."""
        (self.raiz / PREPARADOS / "tich.json").unlink()
        (self.raiz / PREPARADOS).rmdir()
        archivos = [self.original]
        for numero in range(18):
            ruta = self.raiz / ORIGINALES / f"ficha-{numero}.json"
            ruta.write_bytes(str(numero).encode())
            archivos.append(ruta)
        self.registrar_procedencia(archivos)
        with mock.patch.object(bloques_almacen, "DESDE_CONTENIDOS", 10):
            control = self.guardar()
            self.assertIn(f"agrupaciones/v1/entradas/{control['inventario']['sha256']}.sha256", self.almacen.controles)
            self.assertEqual(self.recuperar(), control)
        self.assertFalse((self.destino / PREPARADOS).exists())
        self.assertEqual(
            {p.name for p in (self.destino / ORIGINALES).iterdir()},
            {p.name for p in archivos} | {"procedencia.json"},
        )

    def test_cotas_y_enlaces_se_rechazan_antes_de_escribir(self) -> None:
        """El inventario acotado no admite un enlace aunque dirija a un archivo válido."""
        with mock.patch.object(entradas, "MAX_MANIFIESTO_BYTES", 16), self.assertRaises(entradas.EntradaInvalida):
            self.guardar()
        (self.raiz / VALIDADOS / "copia.json").symlink_to(self.conjunto)
        with self.assertRaises(entradas.EntradaInvalida):
            self.guardar()
        self.assertEqual(self.almacen.guardados, [])

    def test_el_transporte_acepta_solo_claves_cerradas(self) -> None:
        """No se pueden abrir controles arbitrarios con un identificador de la captura."""
        self.assertEqual(almacen_s3._control(CLAVE), almacen_s3.MAX_CONTROL_BYTES)
        for clave in (
            "entradas/v1/45731459565/1/../tich.json",
            "entradas/v1/45731459565/0/tich.json",
            "entradas/v1/9999999999999999/1/tich.json",
            "agrupaciones/v1/entradas/../x.sha256",
        ):
            with self.subTest(clave=clave), self.assertRaises(ValueError):
                almacen_s3._control(clave)
