"""Pruebas del cerrojo, la sustitución con diario y el estado de la actualización (sustitucion.py y su estado).

El corte del proceso se simula con una excepción que no es OSError, lanzada antes de la operación de disco número N de
la sustitución (copiar, borrar, renombrar o anotar el diario), para cada N hasta que la sustitución termina.
"""

import json
import shutil
import tempfile
import unittest
from collections.abc import Iterator
from contextlib import contextmanager, suppress
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any
from unittest import mock

from plataforma_datos.orquestacion import actualizar, estado_de_los_datos, sustitucion
from plataforma_datos.orquestacion import piezas_de_la_actualizacion as piezas
from plataforma_datos.orquestacion.pruebas.ayudas import Corte
from plataforma_datos.orquestacion.pruebas.ayudas import corte_en as corte_comun
from plataforma_datos.orquestacion.pruebas.test_actualizar import PAQUETE_VIGENTE, EjecutorSimulado, escribir_paquete
from plataforma_datos.orquestacion.reconstruir import ORDEN

SUSTITUIDOS = ("var/actualizacion/fixture", "datos")
VIGENTE = {
    "var/actualizacion/fixture/a.json": "a1",
    "var/actualizacion/fixture/sub/b.json": "b1",
    "var/actualizacion/fixture/quitado.json": "q",
    "datos/p.json": "p1",
}
NUEVO = {
    "var/actualizacion/fixture/a.json": "a2",
    "var/actualizacion/fixture/sub/b.json": "b1",
    "var/actualizacion/fixture/sub/c.json": "c2",
    "datos/p.json": "p2",
}


def escribir(raiz: Path, archivos: dict[str, str]) -> None:
    """Escribe cada archivo con su contenido."""
    for relativa, contenido in archivos.items():
        (raiz / relativa).parent.mkdir(parents=True, exist_ok=True)
        (raiz / relativa).write_text(contenido, encoding="utf-8")


def contenido(raiz: Path) -> dict[str, Any]:
    """Lo vigente archivo por archivo y los restos que no deberían quedar.

    Args:
        raiz: La raíz del repositorio de prueba.

    Returns:
        Las huellas de lo vigente, los restos (`.nuevo`, `.anterior`, `.tmp`) y si queda el diario.
    """
    vigente = {
        f"{relativa}/{ruta}": huella
        for relativa in SUSTITUIDOS
        for ruta, huella in sustitucion.huellas_del_arbol(raiz / relativa).items()
    }
    restos = sorted(ruta.name for ruta in raiz.rglob("*") if ruta.name.endswith((".nuevo", ".anterior", ".tmp")))
    diario = (raiz / sustitucion.CARPETA / sustitucion.ARCHIVO_DEL_DIARIO).exists()
    return {"vigente": vigente, "restos": restos, "diario": diario}


@contextmanager
def corte_en(numero: int) -> Iterator[list[str]]:
    """Corta el proceso antes de la operación de disco `numero` de la sustitución (copiar, borrar, renombrar, diario).

    Args:
        numero: La operación, contada desde 1, que no llega a hacerse.

    Yields:
        Las operaciones de disco hechas antes del corte, en orden.
    """
    with corte_comun(
        numero,
        (
            (shutil, "copytree", "copiar"),
            (shutil, "rmtree", "borrar"),
            (Path, "rename", "renombrar"),
            (sustitucion, "escribir_atomico", "diario"),
        ),
    ) as hechas:
        yield hechas


class PruebaSustitucionConDiario(unittest.TestCase):
    """Un corte en cualquier paso deja lo anterior entero y recuperable; tras «hecho», lo nuevo."""

    def montar(self) -> tuple[Path, Path]:
        """Un repositorio con lo vigente y un área con lo nuevo, en una carpeta temporal propia.

        Returns:
            La raíz del repositorio y el área con lo nuevo.
        """
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        raiz, area = Path(temporal.name) / "repositorio", Path(temporal.name) / "area"
        escribir(raiz, VIGENTE)
        escribir(area, NUEVO)
        (raiz / sustitucion.CARPETA).mkdir(parents=True, exist_ok=True)
        return raiz, area

    def esperado(self, archivos: dict[str, str]) -> dict[str, Any]:
        """Lo que debe quedar: esos archivos, sin restos ni diario.

        Args:
            archivos: Ruta relativa y contenido de cada archivo que debe quedar.

        Returns:
            El contenido del repositorio con solo esos archivos.
        """
        raiz, _ = self.montar()
        shutil.rmtree(raiz / "datos")
        shutil.rmtree(raiz / "var" / "actualizacion" / "fixture")
        escribir(raiz, archivos)
        return contenido(raiz)

    def test_corte_en_cada_paso(self) -> None:
        """Antes de «hecho», recuperar devuelve lo anterior; después, deja lo nuevo. Nunca quedan restos."""
        antes, despues = self.esperado(VIGENTE), self.esperado(NUEVO)
        numero, completa = 0, False
        while not completa:
            numero += 1
            raiz, area = self.montar()
            with self.subTest(corte=numero), corte_en(numero) as hechas:
                try:
                    sustitucion.sustituir(raiz, area, SUSTITUIDOS)
                    completa = True
                except Corte:
                    pass
            if completa:
                self.assertEqual(contenido(raiz), despues)
                break
            diario = raiz / sustitucion.CARPETA / sustitucion.ARCHIVO_DEL_DIARIO
            hecho = diario.exists() and json.loads(diario.read_text())["fase"] == sustitucion.HECHO
            sustitucion.recuperar(raiz, SUSTITUIDOS)
            self.assertEqual(contenido(raiz), despues if hecho else antes, f"corte en la operación {numero}: {hechas}")
        self.assertGreater(numero, 8)

    def test_recuperar_tambien_se_puede_cortar(self) -> None:
        """Un corte durante la recuperación (tras cortar antes del diario o entre renombrados) se arregla con otra."""
        antes = self.esperado(VIGENTE)
        for corte in range(6, 12):
            for segundo in range(1, 8):
                raiz, area = self.montar()
                with self.subTest(corte=corte, segundo=segundo):
                    with corte_en(corte), self.assertRaises(Corte):
                        sustitucion.sustituir(raiz, area, SUSTITUIDOS)
                    with corte_en(segundo), suppress(Corte):
                        sustitucion.recuperar(raiz, SUSTITUIDOS)
                    sustitucion.recuperar(raiz, SUSTITUIDOS)
                    self.assertEqual(contenido(raiz), antes)

    def test_copia_no_identica_se_rechaza(self) -> None:
        """Si la copia al lado no es idéntica a la del área, no se renombra nada y lo vigente sigue igual."""
        raiz, area = self.montar()
        antes = contenido(raiz)
        copiar = shutil.copytree

        def copia_corrupta(*argumentos: object, **opciones: object) -> None:
            copiar(*argumentos, **opciones)
            destino = Path(str(argumentos[1]), "a.json")
            if destino.exists():
                destino.write_text("dañado", encoding="utf-8")

        with mock.patch.object(shutil, "copytree", copia_corrupta), self.assertRaises(OSError):
            sustitucion.sustituir(raiz, area, SUSTITUIDOS)
        self.assertEqual(contenido(raiz), antes)


class PruebaCerrojoYEstado(unittest.TestCase):
    """El cerrojo, la recuperación al empezar y CARPETA_DE_INFORMES/estado.json en una actualización simulada."""

    def setUp(self) -> None:
        """Un repositorio mínimo con su paquete vigente y una fuente."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.raiz, self.area = Path(temporal.name) / "repositorio", Path(temporal.name) / "area"
        escribir_paquete(self.raiz / "datos", PAQUETE_VIGENTE)
        escribir(self.raiz, {"var/actualizacion/originales/cambra/procedencia.json": json.dumps({"archivos": []})})

    def actualizar(self, ejecutor: EjecutorSimulado) -> int:
        """Una actualización sin pausas ni salida.

        Args:
            ejecutor: El ejecutor simulado de las órdenes.

        Returns:
            El código de salida de la actualización.
        """
        shutil.rmtree(self.area, ignore_errors=True)
        with mock.patch("builtins.print"):
            return actualizar.actualizar(self.raiz, actualizar.Opciones(area=self.area, pausa=0, reintento=0), ejecutor)

    def estado(self) -> dict[str, Any]:
        """El estado que dejó la actualización.

        Returns:
            El contenido de `estado.json`.
        """
        return json.loads((self.raiz / piezas.CARPETA_DE_INFORMES / "estado.json").read_text(encoding="utf-8"))

    def test_cerrojo_ocupado(self) -> None:
        """Con otra actualización en curso no se hace nada: ni área, ni informe, ni estado; código 1."""
        with sustitucion.cerrojo(self.raiz):
            with self.assertRaises(sustitucion.ActualizacionEnCurso), sustitucion.cerrojo(self.raiz):
                pass
            ejecutor = EjecutorSimulado(PAQUETE_VIGENTE)
            self.assertEqual(self.actualizar(ejecutor), 1)
        self.assertEqual(ejecutor.ordenes, [])
        self.assertFalse(self.area.exists())
        self.assertEqual([ruta.name for ruta in (self.raiz / piezas.CARPETA_DE_INFORMES).iterdir()], [".cerrojo"])
        with sustitucion.cerrojo(self.raiz):
            pass

    def test_empieza_recuperando_lo_vigente(self) -> None:
        """La publicación cortada de un módulo se deshace al empezar la siguiente actualización (aquí, en ámbar)."""
        antes = contenido(self.raiz)
        cambra = self.raiz / "var" / "actualizacion" / "originales" / "cambra"
        cambra.rename(cambra.with_name("cambra.anterior"))
        escribir(self.raiz, {"var/actualizacion/originales/cambra/a medias.json": "x"})
        (self.raiz / piezas.CARPETA_DE_INFORMES).mkdir(parents=True, exist_ok=True)
        diario = self.raiz / piezas.CARPETA_DE_INFORMES / actualizar.diario("cambra")
        sustitucion.escribir_atomico(diario, '{"fase": "preparado"}\n')
        ejecutor = EjecutorSimulado(PAQUETE_VIGENTE, falla_en="fuentes.tich.lector validar")
        self.assertEqual(self.actualizar(ejecutor), actualizar.CODIGO_AMBAR)
        self.assertEqual(contenido(self.raiz), antes)

    def test_estado_de_cada_modulo(self) -> None:
        """Ámbar en el Consorci, luego verde y otra vez ámbar: cada módulo con su intento, veredicto y versión buena."""
        self.assertEqual(
            self.actualizar(EjecutorSimulado(PAQUETE_VIGENTE, falla_en="fuentes.consorci.lector validar")), 3
        )
        primero = self.estado()
        modulos = primero["modulos"]
        comienzo = primero["actualizacion"]["comienzo_utc"]
        self.assertTrue(primero["actualizacion"]["veredicto"].startswith("ámbar"))
        self.assertEqual({modulos[nombre]["veredicto"] for nombre in ORDEN if nombre != "consorci"}, {"verde"})
        self.assertEqual(modulos["consorci"]["veredicto"], "ámbar")
        self.assertEqual(modulos["consorci"]["fallos_seguidos"], 1)
        un_dia = datetime.fromisoformat(comienzo) + timedelta(days=1)
        self.assertEqual(modulos["consorci"]["proximo_reintento_utc"], un_dia.isoformat(timespec="seconds"))
        self.assertEqual({modulo["ultima_version_buena"] for modulo in modulos.values()}, {None})

        nuevo = {**PAQUETE_VIGENTE, "cambra.json": {"filas": [1, 2, 3, 4, 5, 6]}}
        self.assertEqual(self.actualizar(EjecutorSimulado(nuevo)), 0)
        verde = self.estado()
        paquete = verde["modulos"]["paquete"]["ultima_version_buena"]
        self.assertEqual(paquete["publicada_utc"], verde["actualizacion"]["comienzo_utc"])
        self.assertEqual(verde["modulos"]["consorci"]["fallos_seguidos"], 0)

        self.assertEqual(self.actualizar(EjecutorSimulado(nuevo, falla_en="fuentes.consorci.lector validar")), 3)
        tercero = self.estado()["modulos"]
        self.assertEqual(tercero["consorci"]["veredicto"], "ámbar")
        self.assertEqual(tercero["paquete"]["ultima_version_buena"], paquete)
        carpeta = self.raiz / piezas.CARPETA_DE_INFORMES
        self.assertEqual(sorted(ruta.name for ruta in carpeta.glob(".*")), [".cerrojo"])
        # El doctor sigue leyendo el último informe fechado, no el estado.
        ultima = estado_de_los_datos.ultima_actualizacion(self.raiz)
        self.assertTrue((ultima or {}).get("veredicto", "").startswith("ámbar"))
        self.assertTrue((ultima or {}).get("informe", "").endswith(".md"))


if __name__ == "__main__":
    unittest.main()
