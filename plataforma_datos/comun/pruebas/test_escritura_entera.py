"""Escritura entera o nada: temporal nuevo junto al destino, a disco antes de renombrar y retirado si algo falla."""

import os
import stat
import tempfile
import threading
import unittest
from collections.abc import Callable
from pathlib import Path
from unittest import mock

from plataforma_datos.comun import entrada_salida, red
from plataforma_datos.orquestacion import sustitucion


def escribir_con_el_escritor_comun(ruta: Path, texto: str) -> None:
    """Escribe con el escritor que usan guardar_json y los demás guardados de texto."""
    entrada_salida.escribir_entero_creando_carpeta(ruta, [texto])


def escribir_como_el_informe(ruta: Path, texto: str) -> None:
    """Escribe con `escribir_entero`, el escritor del informe de la actualización, sin crear carpetas."""
    entrada_salida.escribir_entero(ruta, [texto])


def escribir_un_original(ruta: Path, texto: str) -> None:
    """Escribe con el escritor de los originales descargados."""
    red._escribir_bytes_entero(ruta, texto.encode())


ESCRITORES: tuple[Callable[[Path, str], None], ...] = (
    escribir_con_el_escritor_comun,
    escribir_un_original,
    escribir_como_el_informe,
    sustitucion.escribir_atomico,
)


class EscrituraEntera(unittest.TestCase):
    """Los escritores enteros o nada ofrecen las mismas garantías ante enlaces, fallos y cortes."""

    def setUp(self) -> None:
        """Prepara una carpeta propia con nombres portátiles."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.carpeta = Path(temporal.name) / "Mis documentos" / "Año 2026"
        self.carpeta.mkdir(parents=True)
        self.destino = self.carpeta / "estado.json"
        self.destino.write_text("anterior\n", encoding="utf-8")

    def ajenos(self) -> list[str]:
        """Archivos de la carpeta distintos del destino.

        Returns:
            Nombres ordenados.
        """
        return sorted(p.name for p in self.carpeta.iterdir() if p != self.destino)

    def test_un_enlace_con_nombre_de_temporal_no_se_sigue(self) -> None:
        """Un enlace previo con cualquier nombre de temporal no recibe los bytes ni desaparece."""
        ajeno = self.carpeta / "ajeno.txt"
        for escribir in ESCRITORES:
            with self.subTest(escritor=escribir.__name__):
                ajeno.write_text("intacto\n", encoding="utf-8")
                self.destino.unlink()
                self.destino.write_text("anterior\n", encoding="utf-8")
                enlaces = [self.carpeta / f".estado.json.{s}" for s in ("tmp", "parcial")]
                for enlace in enlaces:
                    enlace.unlink(missing_ok=True)
                    enlace.symlink_to(ajeno)
                escribir(self.destino, "nuevo\n")
                self.assertEqual(self.destino.read_text(encoding="utf-8"), "nuevo\n")
                self.assertFalse(self.destino.is_symlink())
                self.assertEqual(ajeno.read_text(encoding="utf-8"), "intacto\n")
                # Cada escritura usa un temporal propio: los enlaces previos ni se siguen ni se tocan.
                self.assertTrue(all(e.is_symlink() and e.readlink() == ajeno for e in enlaces))
                self.assertEqual(self.ajenos(), sorted([ajeno.name, *(e.name for e in enlaces)]))

    def test_fallo_al_renombrar_conserva_el_anterior_y_retira_el_temporal(self) -> None:
        """Si el renombrado falla, el destino sigue entero y no queda ningún temporal."""
        for escribir in ESCRITORES:
            with (
                self.subTest(escritor=escribir.__name__),
                mock.patch.object(Path, "replace", side_effect=OSError("disco lleno")),
                self.assertRaises(OSError),
            ):
                escribir(self.destino, "nuevo\n")
            self.assertEqual(self.destino.read_text(encoding="utf-8"), "anterior\n")
            self.assertEqual(self.ajenos(), [])

    def test_los_bytes_llegan_a_disco_antes_de_renombrar_y_el_renombrado_despues(self) -> None:
        """El contenido se sincroniza en el temporal antes de sustituir al destino, y la carpeta del destino después."""
        carpeta = self.carpeta.stat().st_ino
        for escribir in ESCRITORES:
            orden: list[str] = []
            sincronizar, renombrar = os.fsync, Path.replace

            def fsync(descriptor: int, orden: list[str] = orden, sincronizar: Callable = sincronizar) -> None:
                estado = os.fstat(descriptor)
                if not stat.S_ISDIR(estado.st_mode):
                    orden.append("fsync del temporal")
                elif estado.st_ino == carpeta:
                    orden.append("fsync de la carpeta del destino")
                else:
                    orden.append("fsync de otra carpeta")
                sincronizar(descriptor)

            def replace(ruta: Path, destino: Path, orden: list[str] = orden, renombrar: Callable = renombrar) -> Path:
                orden.append("replace")
                return renombrar(ruta, destino)

            with (
                self.subTest(escritor=escribir.__name__),
                mock.patch.object(os, "fsync", side_effect=fsync),
                mock.patch.object(Path, "replace", autospec=True, side_effect=replace),
            ):
                escribir(self.destino, "nuevo\n")
                self.assertEqual(orden, ["fsync del temporal", "replace", "fsync de la carpeta del destino"])
                self.assertEqual(self.destino.read_text(encoding="utf-8"), "nuevo\n")

    def test_dos_escrituras_simultaneas_no_se_pisan(self) -> None:
        """Dos escrituras que se cruzan antes de renombrar terminan bien y el destino queda entero (la última gana).

        Cada hilo se detiene justo antes de sustituir el destino, con su temporal ya escrito: A espera a que B haya
        escrito el suyo, A renombra y después B. Con un temporal de nombre fijo, B retiraba el de A y fallaba; con la
        limpieza de restos dentro de `escribir_atomico`, B retiraba el temporal activo de A y A fallaba al renombrar.
        Cubre los escritores públicos, también `escribir_atomico`, que usan órdenes manuales sin cerrojo.
        """
        renombrar = Path.replace
        for escribir in ESCRITORES:
            with self.subTest(escritor=escribir.__name__):
                self.destino.write_text("anterior\n", encoding="utf-8")
                pausas = {nombre: (threading.Event(), threading.Event()) for nombre in "AB"}
                resultados: dict[str, str] = {}

                def replace(ruta: Path, destino: Path, pausas: dict = pausas) -> Path:
                    listo, seguir = pausas[threading.current_thread().name]
                    listo.set()
                    seguir.wait(5)
                    return renombrar(ruta, destino)

                def correr(escribir: Callable = escribir, resultados: dict = resultados) -> None:
                    nombre = threading.current_thread().name
                    try:
                        escribir(self.destino, f"{nombre}\n")
                        resultados[nombre] = "ok"
                    except OSError as error:
                        resultados[nombre] = type(error).__name__

                with mock.patch.object(Path, "replace", autospec=True, side_effect=replace):
                    hilos = {nombre: threading.Thread(target=correr, name=nombre) for nombre in "AB"}
                    hilos["A"].start()
                    self.assertTrue(pausas["A"][0].wait(5))
                    hilos["B"].start()
                    self.assertTrue(pausas["B"][0].wait(5))
                    pausas["A"][1].set()
                    hilos["A"].join(5)
                    pausas["B"][1].set()
                    hilos["B"].join(5)
                self.assertEqual(resultados, {"A": "ok", "B": "ok"})
                self.assertEqual(self.destino.read_text(encoding="utf-8"), "B\n")
                self.assertEqual(self.ajenos(), [])

    def test_retirar_temporales_solo_quita_los_propios_y_no_sigue_enlaces(self) -> None:
        """Tras un corte se retiran los temporales del destino; enlaces, carpetas y nombres ajenos se quedan."""
        ajeno = self.carpeta / "ajeno.txt"
        ajeno.write_text("intacto\n", encoding="utf-8")
        (self.carpeta / ".estado.json.abcd_234.tmp").write_text("resto", encoding="utf-8")
        (self.carpeta / ".estado.json.wxyz5678.tmp").symlink_to(ajeno)
        (self.carpeta / ".estado.json.carpeta1.tmp").mkdir()
        conservados = [".estado.json.wxyz5678.tmp", ".estado.json.carpeta1.tmp", ajeno.name]
        # Mismo prefijo, sufijo y largo, pero fuera del alfabeto de `temporal_hermano`: no son temporales propios.
        for nombre in (".estado.json.ABCD1234.tmp", ".estado.json.abcd-234.tmp", ".estado.json.otro.tmp"):
            (self.carpeta / nombre).write_text("no es un temporal propio", encoding="utf-8")
            conservados.append(nombre)
        (self.carpeta / ".otro.json.abcd1234.tmp").write_text("de otro destino", encoding="utf-8")
        conservados.append(".otro.json.abcd1234.tmp")
        entrada_salida.retirar_temporales(self.destino, ".tmp")
        self.assertEqual(self.ajenos(), sorted(conservados))
        self.assertEqual(ajeno.read_text(encoding="utf-8"), "intacto\n")

    def test_escribir_atomico_no_retira_temporales_ajenos(self) -> None:
        """Un temporal con nombre de resto puede ser de otra escritura en curso: la escritura pública no lo toca."""
        activo = self.carpeta / ".estado.json.abcd1234.tmp"
        activo.write_text("de otra escritura", encoding="utf-8")
        sustitucion.escribir_atomico(self.destino, "nuevo\n")
        self.assertEqual(self.destino.read_text(encoding="utf-8"), "nuevo\n")
        self.assertEqual(activo.read_text(encoding="utf-8"), "de otra escritura")

    def test_la_recuperacion_bajo_cerrojo_retira_los_restos_junto_al_diario(self) -> None:
        """Con el cerrojo real tomado (flock), `recuperar` retira los temporales que un corte dejó junto al diario."""
        raiz = self.carpeta / "repositorio"
        control = raiz / sustitucion.CARPETA
        control.mkdir(parents=True)
        resto = control / f".{sustitucion.ARCHIVO_DEL_DIARIO}.abcd1234.tmp"
        resto.write_text("corte", encoding="utf-8")
        ajeno = control / f".{sustitucion.ARCHIVO_DEL_DIARIO}.abcd-234.tmp"
        ajeno.write_text("no es un temporal propio", encoding="utf-8")
        with sustitucion.cerrojo(raiz):
            with self.assertRaises(sustitucion.ActualizacionEnCurso), sustitucion.cerrojo(raiz):
                pass
            self.assertIsNone(sustitucion.recuperar(raiz, ("vigente",)))
        self.assertFalse(resto.exists())
        self.assertTrue(ajeno.exists())


if __name__ == "__main__":
    unittest.main()
