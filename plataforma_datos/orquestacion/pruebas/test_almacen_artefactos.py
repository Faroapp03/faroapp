"""Artefactos pequeños reales y CLI TypeScript confiable, sin bucket, SDK, red ni compilación."""

import hashlib
import json
import os
import re
import subprocess
import tempfile
import unittest
from contextlib import chdir
from pathlib import Path
from unittest import mock

from plataforma_datos.orquestacion import almacen_artefactos as almacen
from plataforma_datos.orquestacion.pruebas.test_almacen_generaciones import AlmacenDeDisco
from plataforma_datos.orquestacion.sustitucion import huellas_del_arbol

REVISION = "a" * 40
SECRETO = "SECRETO-SENTINELA"


def serializar(valor: object) -> bytes:
    """Serializa solo la fixture.

    Returns:
        Bytes UTF-8 estables.
    """
    return (json.dumps(valor, ensure_ascii=False, indent=2) + "\n").encode()


def sha(contenido: bytes) -> str:
    """Identidad de un objeto de fixture.

    Returns:
        SHA256 hexadecimal.
    """
    return hashlib.sha256(contenido).hexdigest()


def contenidos() -> tuple[dict[str, bytes], str, bytes]:
    """Crea un artefacto sintético pequeño, no un constructor alternativo.

    Returns:
        Archivos, versión del paquete y bytes de su manifiesto.
    """
    dato = serializar({"fixture": True})
    manifiesto = serializar({"uno.json": {"sha256": sha(dato)}})
    version = sha(manifiesto)[:16]
    motor = b"export const motor = 1;\n"
    dispositivo = serializar(
        {
            "formato": 1,
            "paquete": version,
            "archivos": {
                "motor/entrada.js": sha(motor),
                f"paquete/{version}/manifiesto.json": sha(manifiesto),
                f"paquete/{version}/uno.json": sha(dato),
            },
        }
    )
    return (
        {
            "worker/worker.mjs": b"import datos from './datos/uno.json'; export default datos;\n",
            "worker/datos/uno.json": dato,
            f"web/paquete/{version}/uno.json": dato,
            f"web/paquete/{version}/manifiesto.json": manifiesto,
            "web/motor/entrada.js": motor,
            "web/firmas/manifiesto.json": dispositivo,
            "web/index.html": b"<!doctype html>",
            "web/vacio.txt": b"",
            "web/otro-vacio.txt": b"",
        },
        version,
        manifiesto,
    )


class AlmacenDeArtefactosDeDisco(AlmacenDeDisco):
    """Mismo protocolo y bytes que el doble existente; solo cambia el namespace admitido."""

    def ruta(self, clave: str) -> Path:
        """Resuelve claves cerradas de artefacto y blobs.

        Returns:
            Ruta propia del almacén de fixture.

        Raises:
            ValueError: Si la clave no pertenece al contrato.
        """
        if re.fullmatch(r"(?:blobs/[0-9a-f]{64}|artefactos/[0-9a-f]{64}\.json)", clave) is None:
            raise ValueError("Clave inválida")
        return self.raiz / clave


class PruebaAlmacenArtefactos(unittest.TestCase):
    """La validación TS precede siempre las transferencias y la promoción final."""

    def setUp(self) -> None:
        """Origen portable nuevo y almacenamiento privado de archivos reales."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.base = Path(temporal.name).resolve()
        self.origen = self.base / "Artefacto Año 2026"
        self.origen.mkdir()
        self.archivos, self.paquete, manifiesto = contenidos()
        for relativa, contenido in self.archivos.items():
            ruta = self.origen / relativa
            ruta.parent.mkdir(parents=True, exist_ok=True)
            ruta.write_bytes(contenido)
        self.descriptor = {
            "version": 1,
            "revisionCodigo": REVISION,
            "huellaPaquete": self.paquete,
            "sha256ManifiestoPaquete": sha(manifiesto),
            "sha256ManifiestoDispositivo": sha(self.archivos["web/firmas/manifiesto.json"]),
            "archivos": [
                {"ruta": ruta, "bytes": len(c), "sha256": sha(c)} for ruta, c in sorted(self.archivos.items())
            ],
        }
        self.huella = self.poner_descriptor(serializar(self.descriptor))
        self.remoto = AlmacenDeArtefactosDeDisco(self.base / "almacén privado")
        self.destino = self.base / "Recuperado Año 2026"

    def poner_descriptor(self, contenido: bytes) -> str:
        """Reemplaza solo el descriptor de fixture.

        Returns:
            Hash externo conocido de los bytes escritos.
        """
        (self.origen / "artefacto.json").write_bytes(contenido)
        return sha(contenido)

    def guardar(self) -> dict:
        """Conserva mediante el protocolo y el verificador reales.

        Returns:
            Resumen TS confirmado.
        """
        return almacen.guardar_artefacto(self.origen, REVISION, self.paquete, self.huella, self.remoto)

    def recuperar(self, huella: str | None = None) -> dict:
        """Recupera exclusivamente a un destino nuevo.

        Returns:
            Resumen TS confirmado.
        """
        return almacen.recuperar_artefacto(self.destino, REVISION, self.paquete, huella or self.huella, self.remoto)

    def sin_destino(self) -> None:
        """No conserva salidas parciales ni temporales de esta recuperación."""
        self.assertFalse(self.destino.exists())
        self.assertEqual(list(self.base.glob(".recuperando-artefacto-*")), [])

    def remoto_descriptor(self, contenido: bytes) -> str:
        """Crea una entrada remota inválida con hash auténtico para comprobar el lector TS.

        Returns:
            SHA esperada del descriptor, nunca confianza inferida del contenido.
        """
        huella = sha(contenido)
        ruta = self.remoto.ruta(f"artefactos/{huella}.json")
        ruta.parent.mkdir(exist_ok=True)
        ruta.write_bytes(contenido)
        return huella

    def test_roundtrip_exacto_dedup_marcador_ultimo_y_ningun_hardlink(self) -> None:
        """Preserva bytes y resumen; no vuelve a crear blobs compartidos ni publica marcador primero."""
        antes = huellas_del_arbol(self.origen)
        resumen = self.guardar()
        esperados = [f"blobs/{h}" for h in dict.fromkeys(r["sha256"] for r in self.descriptor["archivos"])]
        self.assertEqual(self.remoto.guardados, [*esperados, f"artefactos/{self.huella}.json"])
        creados = list(self.remoto.creados)
        self.assertEqual(self.guardar(), resumen)
        self.assertEqual(self.remoto.creados, creados)
        self.assertEqual(self.recuperar(), resumen)
        self.assertEqual(huellas_del_arbol(self.origen), antes)
        self.assertEqual(huellas_del_arbol(self.destino), antes)
        self.assertTrue(all(p.stat().st_nlink == 1 for p in self.destino.rglob("*") if p.is_file()))
        self.assertEqual((self.destino / "web/vacio.txt").read_bytes(), b"")

    def test_lector_de_marcador_no_descarga_payload_ni_promueve_destino(self) -> None:
        """El lector devuelve metadatos autenticados y no pretende verificar de nuevo todo el contenido."""
        self.guardar()
        for ruta in (self.remoto.raiz / "blobs").iterdir():
            ruta.unlink()
        self.remoto.recuperados.clear()
        self.assertEqual(
            almacen.leer_descriptor_artefacto(REVISION, self.paquete, self.huella, self.remoto), self.descriptor
        )
        self.assertEqual(self.remoto.recuperados, [f"artefactos/{self.huella}.json"])
        self.sin_destino()
        with self.assertRaises(almacen.AlmacenArtefactosInvalido):
            self.recuperar()

    def test_lector_de_marcador_rechaza_contexto_hash_y_rutas_invalidas(self) -> None:
        """El vínculo del trabajo pasa por la misma autoridad TypeScript y el hash externo completo."""
        self.guardar()
        for revision, paquete, huella in (
            ("b" * 40, self.paquete, self.huella),
            (REVISION, "0" * 16, self.huella),
            (REVISION, self.paquete, "0" * 64),
        ):
            with (
                self.subTest(revision=revision),
                self.assertRaisesRegex(almacen.AlmacenArtefactosInvalido, f"^{almacen.ERROR_GENERICO}$"),
            ):
                almacen.leer_descriptor_artefacto(revision, paquete, huella, self.remoto)
        invalido = json.loads(serializar(self.descriptor))
        invalido["archivos"][0]["ruta"] = "../fuera"
        huella = self.remoto_descriptor(serializar(invalido))
        self.remoto.recuperados.clear()
        with self.assertRaises(almacen.AlmacenArtefactosInvalido):
            almacen.leer_descriptor_artefacto(REVISION, self.paquete, huella, self.remoto)
        self.assertEqual(self.remoto.recuperados, [f"artefactos/{huella}.json"])
        self.sin_destino()

    def test_lector_de_marcador_acotado_y_transporte_sin_integridad_falla_cerrado(self) -> None:
        """La CLI vuelve a comprobar el hash aunque el transporte incumpla su contrato."""
        self.guardar()
        with (
            mock.patch.object(almacen, "MAX_DESCRIPTOR_BYTES", 1),
            self.assertRaises(almacen.AlmacenArtefactosInvalido),
        ):
            almacen.leer_descriptor_artefacto(REVISION, self.paquete, self.huella, self.remoto)
        real = self.remoto.recuperar

        def alterar(clave: str, ruta: Path, huella: str, maximo: int) -> None:
            real(clave, ruta, huella, maximo)
            ruta.write_bytes(b"{}")

        with (
            mock.patch.object(self.remoto, "recuperar", side_effect=alterar),
            self.assertRaisesRegex(almacen.AlmacenArtefactosInvalido, f"^{almacen.ERROR_GENERICO}$"),
        ):
            almacen.leer_descriptor_artefacto(REVISION, self.paquete, self.huella, self.remoto)
        self.sin_destino()

    def test_artefacto_local_roto_y_expectativas_erroneas_no_suben(self) -> None:
        """Solo un artefacto completo del paquete/revisión privados puede iniciar PUT."""
        for revision, paquete, huella in (
            ("HEAD", self.paquete, self.huella),
            ("b" * 40, self.paquete, self.huella),
            (REVISION, "0" * 16, self.huella),
            (REVISION, self.paquete, "0" * 64),
        ):
            with self.subTest(revision=revision), self.assertRaises(almacen.AlmacenArtefactosInvalido):
                almacen.guardar_artefacto(self.origen, revision, paquete, huella, self.remoto)
        (self.origen / "worker/worker.mjs").write_bytes(b"roto")
        with self.assertRaises(almacen.AlmacenArtefactosInvalido):
            self.guardar()
        self.assertEqual(self.remoto.guardados, [])

    def test_fallo_blob_y_fallo_marcador_no_devuelven_exito(self) -> None:
        """La incertidumbre conserva objetos confirmados sin simular descriptor publicado."""
        real = self.remoto.guardar
        for fase in ("blob", "descriptor"):

            def fallar(clave: str, ruta: Path, huella: str, tamano: int, fase_actual: str = fase) -> None:
                if fase_actual == "blob" or clave.startswith("artefactos/"):
                    raise OSError(SECRETO)
                real(clave, ruta, huella, tamano)

            with (
                self.subTest(fase=fase),
                mock.patch.object(self.remoto, "guardar", side_effect=fallar),
                self.assertRaisesRegex(almacen.AlmacenArtefactosInvalido, f"^{almacen.ERROR_GENERICO}$"),
            ):
                self.guardar()
            self.assertFalse((self.remoto.raiz / "artefactos").exists())
        self.guardar()

    def test_descriptor_invalido_no_pide_blobs_ni_crea_rutas(self) -> None:
        """Ni hash auténtico ni JSON bien formado eluden política de rutas del mismo lector TypeScript."""
        for ruta in ("../fuera", "worker/../fuera", "/absoluto", "registro/clientes.sqlite"):
            documento = json.loads(serializar(self.descriptor))
            documento["archivos"][0]["ruta"] = ruta
            huella = self.remoto_descriptor(serializar(documento))
            self.remoto.recuperados.clear()
            with self.subTest(ruta=ruta), self.assertRaises(almacen.AlmacenArtefactosInvalido):
                self.recuperar(huella)
            self.assertEqual(self.remoto.recuperados, [f"artefactos/{huella}.json"])
            self.sin_destino()
        self.assertFalse((self.base / "fuera").exists())

    def test_descriptor_remoto_roto_excesivo_y_expectativas_no_crean_contenido(self) -> None:
        """La recuperación no comienza blobs con descriptor roto, demasiado grande o de otro contexto."""
        for contenido in (b"{", b"\xff", serializar(self.descriptor | {"revisionCodigo": "b" * 40})):
            huella = self.remoto_descriptor(contenido)
            with self.subTest(bytes=len(contenido)), self.assertRaises(almacen.AlmacenArtefactosInvalido):
                self.recuperar(huella)
            self.sin_destino()
        self.guardar()
        with (
            mock.patch.object(almacen, "MAX_DESCRIPTOR_BYTES", 1),
            self.assertRaises(almacen.AlmacenArtefactosInvalido),
        ):
            self.recuperar()
        self.sin_destino()

    def test_blob_ausente_parcial_o_transporte_que_no_valida_no_promueven(self) -> None:
        """El último cotejo TS es independiente de las garantías que prometa el transporte."""
        self.guardar()
        clave = self.remoto.creados[0]
        original = self.remoto.ruta(clave).read_bytes()
        self.remoto.ruta(clave).unlink()
        with self.assertRaises(almacen.AlmacenArtefactosInvalido):
            self.recuperar()
        self.sin_destino()
        self.remoto.ruta(clave).write_bytes(original)
        real = self.remoto.recuperar

        def alterar(clave: str, ruta: Path, huella: str, maximo: int) -> None:
            real(clave, ruta, huella, maximo)
            if clave.startswith("blobs/"):
                ruta.write_bytes(b"parcial")

        with mock.patch.object(self.remoto, "recuperar", side_effect=alterar), self.assertRaises(ValueError):
            self.recuperar()
        self.sin_destino()

    def test_destino_existente_enlace_y_carrera_preservan_ajenos(self) -> None:
        """La recuperación no sustituye directorios ocupados ni acepta un enlace colgante."""
        self.guardar()
        self.destino.mkdir()
        with self.assertRaises(almacen.AlmacenArtefactosInvalido):
            self.recuperar()
        self.destino.rmdir()
        self.destino.symlink_to(self.base / "ausente", target_is_directory=True)
        with self.assertRaises(almacen.AlmacenArtefactosInvalido):
            self.recuperar()
        self.assertTrue(self.destino.is_symlink())
        self.destino.unlink()
        real = almacen.promover_directorio

        def ocupar(temporal: Path, destino: Path) -> None:
            destino.mkdir()
            (destino / "ajeno").write_bytes(b"conservar")
            real(temporal, destino)

        with mock.patch.object(almacen, "promover_directorio", side_effect=ocupar), self.assertRaises(ValueError):
            self.recuperar()
        self.assertEqual((self.destino / "ajeno").read_bytes(), b"conservar")

    def test_cli_real_recibe_entorno_minimo_y_rutas_absolutas_sin_secretos(self) -> None:
        """NODE_OPTIONS, proveedores y credenciales no llegan al proceso de comprobación."""
        real = almacen.ejecutar_con_plazo
        llamadas = []

        def comprobar(orden: list[str], cwd: Path, plazo: float, entorno: dict) -> subprocess.CompletedProcess:
            self.assertEqual(set(entorno), {"PATH", "HOME", "TMPDIR"})
            self.assertNotIn(SECRETO, json.dumps(orden + list(entorno.values())))
            self.assertTrue(Path(orden[0]).is_absolute())
            self.assertTrue(Path(orden[3]).is_absolute())
            self.assertEqual(plazo, almacen.PLAZO_COMPROBACION_S)
            llamadas.append(orden[2])
            return real(orden, cwd, plazo, entorno)

        with (
            mock.patch.dict(
                os.environ,
                {
                    "NODE_OPTIONS": SECRETO,
                    "NODE_PATH": SECRETO,
                    "FARO_SECRETO_FIRMA": SECRETO,
                    "AWS_SECRET_ACCESS_KEY": SECRETO,
                },
            ),
            mock.patch.object(almacen, "ejecutar_con_plazo", side_effect=comprobar),
        ):
            self.guardar()
            self.recuperar()
        self.assertEqual(llamadas, ["comprobar", "descriptor", "descriptor", "comprobar"])

    def test_timeout_y_salida_cli_excesiva_o_invalida_fallan_neutro(self) -> None:
        """No se usa JSON de otro canal ni se vuelca stderr; el helper recoge el proceso propio."""
        respuestas = [
            subprocess.TimeoutExpired("privado", 30),
            subprocess.CompletedProcess([], 1, "", SECRETO),
            subprocess.CompletedProcess([], 0, "x" * (almacen.MAX_RESUMEN_BYTES + 1), SECRETO),
            subprocess.CompletedProcess([], 0, "no-json", ""),
        ]
        for respuesta in respuestas:
            opciones = {"side_effect": respuesta} if isinstance(respuesta, Exception) else {"return_value": respuesta}
            with (
                self.subTest(respuesta=type(respuesta).__name__),
                mock.patch.object(almacen, "ejecutar_con_plazo", **opciones),
                self.assertRaisesRegex(almacen.AlmacenArtefactosInvalido, f"^{almacen.ERROR_GENERICO}$"),
            ):
                self.guardar()
        self.assertEqual(self.remoto.guardados, [])

    def test_defectos_de_programacion_no_se_ocultan_como_fallo_de_transporte(self) -> None:
        """Solo excepciones conocidas se normalizan; no se absorben KeyError o TypeError arbitrarios."""
        for error in (KeyError("defecto"), TypeError("defecto")):
            with mock.patch.object(almacen, "_comprobar", side_effect=error), self.assertRaises(type(error)):
                self.guardar()

    def test_ruta_relativa_desde_cwd_ajeno_y_alias_rechazado_antes_subir(self) -> None:
        """CLI y transporte usan la misma raíz física sin convertir un enlace en origen admitido."""
        enlace = self.base / "alias"
        enlace.symlink_to(self.origen, target_is_directory=True)
        with chdir(self.base):
            with self.assertRaises(almacen.AlmacenArtefactosInvalido):
                almacen.guardar_artefacto(Path("alias"), REVISION, self.paquete, self.huella, self.remoto)
            self.assertEqual(self.remoto.guardados, [])
            resumen = almacen.guardar_artefacto(
                Path(self.origen.name), REVISION, self.paquete, self.huella, self.remoto
            )
            recuperado = almacen.recuperar_artefacto(
                Path(self.destino.name), REVISION, self.paquete, self.huella, self.remoto
            )
        self.assertEqual(recuperado, resumen)
        self.assertEqual(huellas_del_arbol(self.destino), huellas_del_arbol(self.origen))


if __name__ == "__main__":
    unittest.main()
