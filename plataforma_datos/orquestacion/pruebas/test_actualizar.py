"""Pruebas de la actualización (actualizar.py y su biblioteca): un fallo no para a los demás y no cambia lo vigente.

Cada prueba monta un repositorio mínimo en una carpeta temporal y sustituye las órdenes reales por un ejecutor simulado
que exporta un paquete nuevo y puede fallar en el paso que se le diga; así se comprueba la regla sin red ni datos.
"""

import contextlib
import hashlib
import io
import json
import os
import sys
import tempfile
import unittest
from collections.abc import Callable, Sequence
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any
from unittest import mock

from plataforma_datos.comun import perfil_web
from plataforma_datos.comun.nucleo import FormatoInesperado
from plataforma_datos.comun.pruebas.test_permisos_publicados import ModoDeLoPublicado
from plataforma_datos.orquestacion import actualizar, pasos_del_ciclo
from plataforma_datos.orquestacion import cuarentena_del_paquete as cuarentena
from plataforma_datos.orquestacion import informe_de_la_actualizacion as informe_fechado
from plataforma_datos.orquestacion import piezas_de_la_actualizacion as piezas
from plataforma_datos.orquestacion.reconstruir import ORDEN

PAQUETE_VIGENTE = {"oit.json": [1, 2, 3], "cambra.json": {"filas": [1, 2, 3, 4, 5]}}
SUSTITUIBLES = ("var/actualizacion/originales", "var/actualizacion/preparados", "var/actualizacion/validados", "datos")
# «Falla siempre»: más fallos simulados de los que una actualización llega a pedir.
SIEMPRE = sys.maxsize
# La llamada a Path.rename que falla en la prueba de la sustitución a medias: la segunda, que es la que publica lo nuevo
# (la primera aparta lo vigente). Si la sustitución cambia de nº de renombrados, la prueba lo dirá al no ver ámbar.
RENOMBRADO_QUE_FALLA = 2


def escribir_paquete(carpeta: Path, archivos: dict[str, Any]) -> None:
    """Escribe los archivos de un paquete y su manifiesto con la huella de cada uno.

    Args:
        carpeta: Dónde se escribe el paquete (se crea si falta).
        archivos: El contenido JSON de cada archivo, por nombre.
    """
    carpeta.mkdir(parents=True, exist_ok=True)
    manifiesto = {}
    for nombre, datos in archivos.items():
        contenido = json.dumps(datos).encode()
        (carpeta / nombre).write_bytes(contenido)
        manifiesto[nombre] = {"origenes": {}, "sha256": hashlib.sha256(contenido).hexdigest()}
    (carpeta / "manifiesto.json").write_text(json.dumps(manifiesto), encoding="utf-8")


def huellas(raiz: Path) -> dict[str, str]:
    """Huella de cada archivo de lo que la actualización puede sustituir.

    Args:
        raiz: La raíz del repositorio mínimo.

    Returns:
        La huella SHA-256 de cada archivo, por su ruta relativa a la raíz.
    """
    rutas = [ruta for relativa in SUSTITUIBLES for ruta in sorted((raiz / relativa).rglob("*"))]
    return {
        str(ruta.relative_to(raiz)): hashlib.sha256(ruta.read_bytes()).hexdigest() for ruta in rutas if ruta.is_file()
    }


NPM = "npm"
POSICION_DEL_NOMBRE = 2  # Tras el programa y «run» o «-m» va el nombre del guion o del módulo.


def coincide_paso(orden: Sequence[str], selector: str) -> bool:
    """Indica si la orden ejecuta el paso del selector, mirando su nombre y sus argumentos.

    El selector es «npm» (cualquier orden npm), el nombre de un guion npm («verificar») o un módulo
    Python, completo o por su final, seguido de los argumentos que debe llevar
    («fuentes.tich.lector validar»). La ruta del programa no cuenta: un intérprete instalado en una
    carpeta llamada «verificar» no es el paso «verificar».

    Returns:
        Si la orden es ese paso.
    """
    partes = selector.split()
    if not partes or not orden:
        return False
    es_npm = Path(orden[0]).name == NPM
    if partes == [NPM]:
        return es_npm
    if len(orden) <= POSICION_DEL_NOMBRE:
        return False
    _, modo, nombre, *argumentos = orden
    if es_npm:
        return modo == "run" and partes == [nombre]
    modulo, *esperados = partes
    return (
        modo == "-m"
        and (nombre == modulo or nombre.endswith("." + modulo))
        and argumentos[: len(esperados)] == esperados
    )


class EjecutorSimulado:
    """Hace como que ejecuta cada orden: exporta `paquete_nuevo` y falla con código 1 en `falla_en`."""

    def __init__(self, paquete_nuevo: dict[str, Any], falla_en: str | None = None, veces: int = SIEMPRE) -> None:
        self.paquete_nuevo = paquete_nuevo
        self.falla_en = falla_en
        self.veces = veces
        self.ordenes: list[list[str]] = []

    def __call__(self, orden: list[str], area: Path) -> actualizar.Resultado:
        """Registra la orden y responde como lo haría la de verdad.

        Args:
            orden: La orden que la actualización quiere ejecutar.
            area: El área de ensayo en que se ejecutaría.

        Returns:
            Éxito, salvo mientras queden fallos simulados para la orden identificada por `falla_en`.
        """
        self.ordenes.append(orden)
        if self.falla_en and coincide_paso(orden, self.falla_en) and self.veces > 0:
            self.veces -= 1
            return actualizar.Resultado(1, "fallo simulado")
        if "plataforma_datos.orquestacion.exportar_paquete" in orden:
            escribir_paquete(area / "datos", self.paquete_nuevo)
        return actualizar.Resultado(0, "")


class PruebaIdentidadDeOrden(unittest.TestCase):
    """El simulador reconoce cada paso por su nombre de orden, nunca por la ruta del intérprete."""

    PYTHON_EN_CARPETA_TRAMPA = "/tmp/verificar/bin/python"

    def test_ruta_del_interprete_no_finge_un_paso(self) -> None:
        """Una carpeta «verificar» en la ruta del intérprete no convierte otra orden en ese paso."""
        python = self.PYTHON_EN_CARPETA_TRAMPA
        publicar = [python, "-m", "plataforma_datos.orquestacion.publicar_globales"]
        self.assertFalse(coincide_paso(publicar, "verificar"))
        self.assertTrue(coincide_paso(publicar, "plataforma_datos.orquestacion.publicar_globales"))
        self.assertTrue(coincide_paso(["npm", "run", "verificar"], "verificar"))
        self.assertFalse(coincide_paso(["npm", "run", "web:preparar"], "verificar"))
        self.assertTrue(coincide_paso(["npm", "run", "web:preparar"], "npm"))
        self.assertFalse(coincide_paso(publicar, "npm"))
        tich = [python, "-m", "plataforma_datos.mercado.fuentes.tich.lector"]
        self.assertTrue(coincide_paso([*tich, "validar"], "fuentes.tich.lector validar"))
        self.assertFalse(coincide_paso([*tich, "descargar"], "fuentes.tich.lector validar"))
        self.assertFalse(coincide_paso([*tich, "validar"], "tich.lector.validar"))

    def test_el_fallo_simulado_cae_solo_en_el_paso_nombrado(self) -> None:
        """Con la ruta trampa, el fallo de «verificar» no alcanza a una orden Python anterior."""
        publicar = [self.PYTHON_EN_CARPETA_TRAMPA, "-m", "plataforma_datos.orquestacion.publicar_globales"]
        ejecutor = EjecutorSimulado(PAQUETE_VIGENTE, falla_en="verificar")
        self.assertEqual(ejecutor(publicar, Path("/tmp")).codigo, 0)
        self.assertEqual(ejecutor(["npm", "run", "verificar"], Path("/tmp")).codigo, 1)


class PruebaReglaDelVerde(unittest.TestCase):
    """El paquete solo se sustituye en verde y sin alarmas; una fuente que falla no detiene a las demás."""

    def setUp(self) -> None:
        """Un repositorio mínimo con su paquete vigente y una fuente manual."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.raiz = Path(temporal.name) / "repositorio"
        escribir_paquete(self.raiz / "datos", PAQUETE_VIGENTE)
        originales = self.raiz / "var" / "actualizacion" / "originales" / "cambra"
        originales.mkdir(parents=True)
        procedencia = {"archivos": [{"archivo": "tabla.xlsx", "sha256": "a1", "fecha": "2026-09-25"}]}
        (originales / "procedencia.json").write_text(json.dumps(procedencia), encoding="utf-8")
        self.antes = huellas(self.raiz)
        self.area = Path(temporal.name) / "area"

    def actualizar(self, ejecutor: EjecutorSimulado, ensayo: bool = False) -> int:
        """Ejecuta la actualización sobre el repositorio mínimo, sin pausas.

        Args:
            ejecutor: El ejecutor simulado de las órdenes.
            ensayo: Si es un ensayo (no sustituye lo vigente).

        Returns:
            El código de salida de la actualización.
        """
        opciones = actualizar.Opciones(ensayo=ensayo, area=self.area, pausa=0, reintento=0)
        with contextlib.redirect_stdout(io.StringIO()):
            return actualizar.actualizar(self.raiz, opciones, ejecutor)

    def informe(self) -> dict[str, Any]:
        """El informe JSON que dejó la actualización.

        Returns:
            El contenido del único informe fechado.
        """
        (ruta,) = piezas.informes_fechados(self.raiz)
        return json.loads(ruta.read_text(encoding="utf-8"))

    def test_un_fallo_en_una_fuente_no_detiene_a_las_demas(self) -> None:
        """Si falla la validación de una fuente, las siguientes y el paquete siguen; la orden termina en ámbar (3)."""
        nuevo = {**PAQUETE_VIGENTE, "cambra.json": {"filas": [1, 2, 3, 4, 5, 6]}}
        ejecutor = EjecutorSimulado(nuevo, falla_en="fuentes.tich.lector validar")
        self.assertEqual(self.actualizar(ejecutor), actualizar.CODIGO_AMBAR)
        informe = self.informe()
        self.assertEqual(informe["veredicto"], "ámbar (conservan su última versión buena: tich)")
        ordenes = [" ".join(orden) for orden in ejecutor.ordenes]
        self.assertIn(
            f"{actualizar.PYTHON} -m plataforma_datos.derivados.fuentes.datos_globales.lector validar", ordenes
        )
        self.assertEqual(
            json.loads((self.raiz / "datos" / "cambra.json").read_text(encoding="utf-8")),
            nuevo["cambra.json"],
        )

    def test_un_fallo_en_las_comprobaciones_deja_lo_vigente_intacto(self) -> None:
        """Si fallan las pruebas tras exportar, se compara pero el paquete no se sustituye."""
        ejecutor = EjecutorSimulado({**PAQUETE_VIGENTE, "cambra.json": {"filas": [1, 2, 3, 4, 5, 6]}}, falla_en="npm")
        self.assertEqual(self.actualizar(ejecutor), actualizar.CODIGO_AMBAR)
        self.assertEqual(huellas(self.raiz), self.antes)
        filas = {fila["archivo"]: fila for fila in self.informe()["comparacion"]["paquete"]}
        self.assertEqual(filas["cambra.json"]["estado"], "cambia")

    def test_una_alarma_deja_lo_vigente_intacto(self) -> None:
        """Un cambio de oit.json (vectores de significado) detiene la sustitución aunque todo pase."""
        ejecutor = EjecutorSimulado({**PAQUETE_VIGENTE, "oit.json": [1, 2, 3, 4]})
        self.assertEqual(self.actualizar(ejecutor), actualizar.CODIGO_AMBAR)
        self.assertEqual(huellas(self.raiz), self.antes)
        (alarma,) = self.informe()["comparacion"]["alarmas"]
        self.assertIn("oit.json cambia: los vectores", alarma)

    def cuarentena(self) -> dict[str, Any]:
        """El estado de la cuarentena que dejó la actualización.

        Returns:
            Los archivos en cuarentena, por nombre.
        """
        return cuarentena.leer_cuarentena(self.raiz)

    def test_una_perdida_deja_en_cuarentena_solo_ese_archivo(self) -> None:
        """Pierde más del 20 %: ese archivo conserva su versión publicada, el resto se publica y queda el aviso."""
        escribir_paquete(self.raiz / "datos", {**PAQUETE_VIGENTE, "tich.json": [1]})
        vigente_cambra = (self.raiz / "datos" / "cambra.json").read_bytes()
        nuevo = {**PAQUETE_VIGENTE, "cambra.json": {"filas": [1, 2]}, "tich.json": [1, 2]}
        self.assertEqual(self.actualizar(EjecutorSimulado(nuevo)), 0)
        paquete = self.raiz / "datos"
        self.assertEqual((paquete / "cambra.json").read_bytes(), vigente_cambra)
        self.assertEqual(json.loads((paquete / "tich.json").read_text(encoding="utf-8")), [1, 2])
        manifiesto = json.loads((paquete / "manifiesto.json").read_text(encoding="utf-8"))
        self.assertEqual(manifiesto["cambra.json"]["sha256"], hashlib.sha256(vigente_cambra).hexdigest())
        registro = self.cuarentena()["cambra.json"]
        self.assertEqual(
            registro["perdidas"], [{"archivo": "cambra.json", "medida": "entradas", "antes": 5, "despues": 2}]
        )
        self.assertEqual(registro["grupo"], ["cambra.json"])
        self.assertIsNone(registro["aceptada_utc"])
        self.assertEqual(registro["desde_utc"], registro["ultima_utc"])
        comparacion = self.informe()["comparacion"]
        self.assertEqual(comparacion["alarmas"], [])
        self.assertEqual(
            [(fila["archivo"], fila["grupo"]) for fila in comparacion["cuarentena"]], [("cambra.json", ["cambra.json"])]
        )
        exportado = hashlib.sha256(json.dumps({"filas": [1, 2]}).encode()).hexdigest()
        self.assertEqual(registro["exportado_sha256"], exportado)
        estado = json.loads((self.raiz / piezas.CARPETA_DE_INFORMES / "estado.json").read_text(encoding="utf-8"))
        self.assertIn("cuarentena): cambra.json", estado["modulos"]["paquete"]["motivo"])
        avisos = (self.raiz / piezas.CARPETA_DE_INFORMES / "avisos.log").read_text(encoding="utf-8")
        self.assertIn("cuarentena · cambra.json pierde más del 20 % de sus entradas (5 → 2)", avisos)
        self.assertIn("--aceptar-cuarentena cambra.json", avisos)
        markdown = piezas.informes_fechados(self.raiz)[-1].with_suffix(".md").read_text(encoding="utf-8")
        self.assertIn(
            "## Cuarentena\n\n- cambra.json pierde más del 20 % de sus entradas (5 → 2). "
            "Conservan su versión publicada: cambra.json.",
            markdown,
        )

    def test_las_comprobaciones_leen_el_paquete_ya_en_cuarentena(self) -> None:
        """Las pruebas y el cotejo de la web acreditan el paquete que se publicaría, no el exportado."""
        vistos: list[bytes] = []
        simulado = EjecutorSimulado({**PAQUETE_VIGENTE, "cambra.json": {"filas": [1, 2]}})

        def ejecutor(orden: list[str], area: Path) -> actualizar.Resultado:
            if coincide_paso(orden, "verificar:datos"):
                vistos.append((area / "datos" / "cambra.json").read_bytes())
            return simulado(orden, area)

        self.assertEqual(self.actualizar(ejecutor), 0)
        self.assertEqual(vistos, [(self.raiz / "datos" / "cambra.json").read_bytes()])

    def test_la_cuarentena_se_mantiene_hasta_aceptar_el_cambio(self) -> None:
        """Sin decisión, conserva la fecha de entrada; aceptado, la siguiente ejecución lo publica y lo anota."""
        nuevo = {**PAQUETE_VIGENTE, "cambra.json": {"filas": [1, 2]}}
        self.assertEqual(self.actualizar(EjecutorSimulado(nuevo)), 0)
        desde = self.cuarentena()["cambra.json"]["desde_utc"]
        self.assertEqual(self.actualizar(EjecutorSimulado(nuevo)), 0)
        self.assertEqual(self.cuarentena()["cambra.json"]["desde_utc"], desde)
        self.assertEqual(huellas(self.raiz)["datos/cambra.json"], self.antes["datos/cambra.json"])
        with self.assertRaises(cuarentena.NoEnCuarentena):
            cuarentena.aceptar_cuarentena(self.raiz, ["oit.json"], datetime.now(UTC))
        cuarentena.aceptar_cuarentena(self.raiz, ["cambra.json"], datetime.now(UTC))
        self.assertIsNotNone(self.cuarentena()["cambra.json"]["aceptada_utc"])
        self.assertEqual(self.actualizar(EjecutorSimulado(nuevo)), 0)
        self.assertEqual(
            json.loads((self.raiz / "datos" / "cambra.json").read_text(encoding="utf-8")), {"filas": [1, 2]}
        )
        self.assertEqual(self.cuarentena(), {})
        informe = piezas.informes_fechados(self.raiz)[-1]
        self.assertEqual(json.loads(informe.read_text(encoding="utf-8"))["comparacion"]["aceptados"], ["cambra.json"])
        estado = json.loads((self.raiz / piezas.CARPETA_DE_INFORMES / "estado.json").read_text(encoding="utf-8"))
        self.assertIn("cambio aceptado: cambra.json", estado["modulos"]["paquete"]["motivo"])

    def test_la_orden_de_aceptar_no_actualiza_ni_inventa_cuarentenas(self) -> None:
        """Aceptar un archivo que no está en cuarentena es un error de argumentos; con otras opciones, también."""
        with contextlib.redirect_stderr(io.StringIO()) as errores:
            self.assertEqual(cuarentena.aceptar_desde_la_cli(self.raiz, ["cambra.json"]), 2)
            with self.assertRaises(SystemExit) as salida:
                actualizar.main(["--aceptar-cuarentena", "cambra.json", "--ensayo"])
        self.assertEqual(salida.exception.code, 2)
        self.assertIn("no está en cuarentena: cambra.json", errores.getvalue())
        self.assertFalse((self.raiz / piezas.CARPETA_DE_INFORMES / cuarentena.ARCHIVO_DE_CUARENTENA).exists())

    def test_un_estado_de_cuarentena_roto_no_publica(self) -> None:
        """Roto o ilegible, con pérdidas o sin ellas: no se publica, queda la alarma y la ronda cierra su estado."""
        ejecuciones = self.raiz / piezas.CARPETA_DE_INFORMES
        ejecuciones.mkdir(parents=True)
        cambio = {"filas": [1, 2, 3, 4, 5, 6]}
        for contenido, cambra in (
            ('{"version": 9}', {"filas": [1, 2]}),
            ("{no es json", cambio),
            ('{"version": 9}', cambio),
        ):
            with self.subTest(contenido=contenido, cambra=cambra):
                (ejecuciones / cuarentena.ARCHIVO_DE_CUARENTENA).write_text(contenido, encoding="utf-8")
                ejecutor = EjecutorSimulado({**PAQUETE_VIGENTE, "cambra.json": cambra})
                self.assertEqual(self.actualizar(ejecutor), actualizar.CODIGO_AMBAR)
                self.assertEqual(huellas(self.raiz), self.antes)
                informe = json.loads(piezas.informes_fechados(self.raiz)[-1].read_text(encoding="utf-8"))
                (alarma,) = informe["comparacion"]["alarmas"]
                self.assertIn("no se pudo aplicar la cuarentena", alarma)
                estado = json.loads((ejecuciones / "estado.json").read_text(encoding="utf-8"))
                self.assertEqual(estado["modulos"]["paquete"]["veredicto"], actualizar.AMBAR)

    def test_la_orden_de_aceptar_no_acepta_sobre_un_estado_roto(self) -> None:
        """Con el estado roto o ilegible, aceptar falla con un mensaje y no escribe nada."""
        ejecuciones = self.raiz / piezas.CARPETA_DE_INFORMES
        ejecuciones.mkdir(parents=True)
        for contenido in ('{"version": 9}', "{no es json"):
            with self.subTest(contenido=contenido):
                ruta = ejecuciones / cuarentena.ARCHIVO_DE_CUARENTENA
                ruta.write_text(contenido, encoding="utf-8")
                with contextlib.redirect_stderr(io.StringIO()) as errores:
                    codigo = cuarentena.aceptar_desde_la_cli(self.raiz, ["cambra.json"])
                self.assertEqual(codigo, actualizar.CODIGO_ROJO)
                self.assertIn("No se acepta", errores.getvalue())
                self.assertEqual(ruta.read_text(encoding="utf-8"), contenido)

    def test_una_aceptacion_publica_sin_bajar_de_lo_aceptado(self) -> None:
        """Se aceptó 5 → 2: se publica si llega 5 → 2 con otros bytes o 5 → 3."""
        for filas in ([7, 8], [1, 2, 3]):
            with self.subTest(filas=filas):
                escribir_paquete(self.raiz / "datos", PAQUETE_VIGENTE)
                (self.raiz / piezas.CARPETA_DE_INFORMES / cuarentena.ARCHIVO_DE_CUARENTENA).unlink(missing_ok=True)
                self.assertEqual(
                    self.actualizar(EjecutorSimulado({**PAQUETE_VIGENTE, "cambra.json": {"filas": [1, 2]}})), 0
                )
                cuarentena.aceptar_cuarentena(self.raiz, ["cambra.json"], datetime.now(UTC))
                self.assertEqual(
                    self.actualizar(EjecutorSimulado({**PAQUETE_VIGENTE, "cambra.json": {"filas": filas}})), 0
                )
                publicado = json.loads((self.raiz / "datos" / "cambra.json").read_text(encoding="utf-8"))
                self.assertEqual(publicado, {"filas": filas})
                self.assertEqual(self.cuarentena(), {})

    def test_la_orden_de_aceptar_dice_que_cifras_acepta_y_con_que_condiciones(self) -> None:
        """La salida dice hasta dónde puede bajar el archivo y qué tiene que cumplir la próxima actualización."""
        self.assertEqual(self.actualizar(EjecutorSimulado({**PAQUETE_VIGENTE, "cambra.json": {"filas": [1, 2]}})), 0)
        with contextlib.redirect_stdout(io.StringIO()) as salida:
            self.assertEqual(cuarentena.aceptar_desde_la_cli(self.raiz, ["cambra.json"]), 0)
        self.assertEqual(
            salida.getvalue(),
            "Aceptado: cambra.json puede bajar hasta 5 → 2 entradas. La próxima actualización lo publica si su versión "
            "publicada sigue siendo la misma, no trae menos ni otra pérdida y el paquete pasa sus comprobaciones.\n",
        )

    def test_una_aceptacion_no_vale_si_cambia_lo_publicado(self) -> None:
        """Si entre medias se publica otra versión del archivo, la aceptación anterior no se aplica."""
        self.assertEqual(self.actualizar(EjecutorSimulado({**PAQUETE_VIGENTE, "cambra.json": {"filas": [1, 2]}})), 0)
        cuarentena.aceptar_cuarentena(self.raiz, ["cambra.json"], datetime.now(UTC))
        escribir_paquete(self.raiz / "datos", {**PAQUETE_VIGENTE, "cambra.json": {"filas": [1, 2, 3, 4, 5, 9]}})
        otra_publicada = (self.raiz / "datos" / "cambra.json").read_bytes()
        self.assertEqual(self.actualizar(EjecutorSimulado({**PAQUETE_VIGENTE, "cambra.json": {"filas": [1, 2]}})), 0)
        self.assertEqual((self.raiz / "datos" / "cambra.json").read_bytes(), otra_publicada)
        self.assertIsNone(self.cuarentena()["cambra.json"]["aceptada_utc"])

    def test_una_aceptacion_no_publica_otro_cambio_que_el_visto(self) -> None:
        """Se aceptó 5 → 2; si la siguiente trae menos (5 → 1), no se publica y se vuelve a pedir decisión."""
        self.assertEqual(self.actualizar(EjecutorSimulado({**PAQUETE_VIGENTE, "cambra.json": {"filas": [1, 2]}})), 0)
        cuarentena.aceptar_cuarentena(self.raiz, ["cambra.json"], datetime.now(UTC))
        self.assertEqual(self.actualizar(EjecutorSimulado({**PAQUETE_VIGENTE, "cambra.json": {"filas": []}})), 0)
        self.assertEqual(huellas(self.raiz)["datos/cambra.json"], self.antes["datos/cambra.json"])
        registro = self.cuarentena()["cambra.json"]
        self.assertIsNone(registro["aceptada_utc"])
        self.assertEqual(registro["perdidas"][0]["despues"], 1)
        avisos = (self.raiz / piezas.CARPETA_DE_INFORMES / "avisos.log").read_text(encoding="utf-8")
        self.assertIn("se aceptó «cambra.json pierde más del 20 % de sus entradas (5 → 2)»", avisos)
        self.assertIn("trae «cambra.json pierde más del 20 % de sus entradas (5 → 1)»", avisos)

    def test_el_ensayo_no_registra_cuarentena(self) -> None:
        """Un ensayo describe la cuarentena en su informe pero no la registra."""
        ejecutor = EjecutorSimulado({**PAQUETE_VIGENTE, "cambra.json": {"filas": [1, 2]}})
        self.assertEqual(self.actualizar(ejecutor, ensayo=True), 0)
        self.assertEqual(huellas(self.raiz), self.antes)
        self.assertEqual(len(self.informe()["comparacion"]["cuarentena"]), 1)
        self.assertFalse((self.raiz / piezas.CARPETA_DE_INFORMES / cuarentena.ARCHIVO_DE_CUARENTENA).exists())

    def test_en_verde_sustituye_el_paquete_entero(self) -> None:
        """En verde, el paquete nuevo queda en su sitio y no quedan copias intermedias."""
        nuevo = {**PAQUETE_VIGENTE, "cambra.json": {"filas": [1, 2, 3, 4, 5, 6]}}
        self.assertEqual(self.actualizar(EjecutorSimulado(nuevo)), 0)
        paquete = self.raiz / "datos"
        self.assertEqual(json.loads((paquete / "cambra.json").read_text(encoding="utf-8")), nuevo["cambra.json"])
        self.assertEqual(self.informe()["veredicto"], "verde")
        restos = [ruta.name for ruta in self.raiz.rglob("*") if ruta.name.endswith((".nuevo", ".anterior"))]
        self.assertEqual(restos, [])
        registros = pasos_del_ciclo.leer(self.raiz)
        claves = [r["paso"] for r in registros]
        self.assertLess(claves.index("exportar-paquete"), claves.index("componer-catalogo"))
        self.assertLess(claves.index("componer-catalogo"), claves.index("verificar-datos"))
        self.assertTrue(registros and all(r["fin"] and r["codigo"] == 0 for r in registros))

    def test_una_descarga_que_falla_una_vez_se_repite(self) -> None:
        """Un fallo pasajero de la red se repite una vez y no deja la fuente en ámbar; si persiste, sí."""
        ejecutor = EjecutorSimulado(PAQUETE_VIGENTE, falla_en="fuentes.ocupados.lector descargar", veces=1)
        self.assertEqual(self.actualizar(ejecutor, ensayo=True), 0)
        self.assertEqual(sum("fuentes.ocupados.lector descargar" in " ".join(orden) for orden in ejecutor.ordenes), 2)
        persistente = EjecutorSimulado(PAQUETE_VIGENTE, falla_en="fuentes.ocupados.lector descargar", veces=2)
        self.assertEqual(self.actualizar(persistente, ensayo=True), actualizar.CODIGO_AMBAR)

    def test_el_ensayo_no_sustituye(self) -> None:
        """El ensayo llega al verde sin tocar lo vigente."""
        nuevo = {**PAQUETE_VIGENTE, "cambra.json": {"filas": [1, 2, 3, 4, 5, 6]}}
        self.assertEqual(self.actualizar(EjecutorSimulado(nuevo), ensayo=True), 0)
        self.assertEqual(huellas(self.raiz), self.antes)
        self.assertEqual(self.informe()["veredicto"], "verde (ensayo)")
        self.assertEqual(pasos_del_ciclo.leer(self.raiz), [])

    def test_una_sustitucion_a_medias_se_deshace(self) -> None:
        """Si el disco falla al poner lo nuevo (segundo renombrado), se restaura lo anterior y termina en ámbar."""
        renombrar = Path.rename
        llamadas: list[Path] = []

        def falla_en_el_renombrado(ruta: Path, destino: Path) -> Path:
            """Hace el renombrado de verdad salvo en el RENOMBRADO_QUE_FALLA, donde simula un disco lleno.

            Args:
                ruta: Lo que se renombra.
                destino: Su nombre nuevo.

            Returns:
                El resultado del renombrado real.

            Raises:
                OSError: En el renombrado que debe fallar.
            """
            llamadas.append(ruta)
            if len(llamadas) == RENOMBRADO_QUE_FALLA:
                raise OSError("disco lleno (simulado)")
            return renombrar(ruta, destino)

        nuevo = {**PAQUETE_VIGENTE, "cambra.json": {"filas": [1, 2, 3, 4, 5, 6]}}
        with mock.patch.object(Path, "rename", falla_en_el_renombrado):
            self.assertEqual(self.actualizar(EjecutorSimulado(nuevo)), actualizar.CODIGO_AMBAR)
        self.assertEqual(huellas(self.raiz), self.antes)
        self.assertEqual(self.informe()["veredicto"], "ámbar (conservan su última versión buena: paquete)")


class PruebaConductaDeLasOrdenes(unittest.TestCase):
    """Cómo se ejecutan las órdenes del área: entorno, salida, reintento y veredicto."""

    def setUp(self) -> None:
        """Identidad configurable propia sin leer el hogar real de quien ejecuta las pruebas."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.hogar = Path(temporal.name)
        self.identidad = self.hogar / "identidad-web.json"
        self.agente = (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36"
        )
        self.identidad.write_text(
            json.dumps({"version": 1, "identidad": perfil_web.identidad_publica(perfil_web.perfil_chrome())})
        )
        self.identidad_original = self.identidad.read_bytes()
        hogar = mock.patch.object(perfil_web, "RUTA_IDENTIDAD", self.identidad)
        hogar.start()
        self.addCleanup(hogar.stop)

    def test_npm_recibe_identidad_exacta_configurada_sin_sufijos_ambientales(self) -> None:
        """La orden real recibe la identidad común en vez de la identidad inyectada por entorno."""
        orden = [sys.executable, "-c", "import os; print(os.environ['npm_config_user_agent'])"]
        with mock.patch.dict(os.environ, {"npm_config_user_agent": "npm/10 Python/3.12 entorno-sintetico"}):
            resultado = actualizar.ejecutar_orden(orden, self.hogar)
        self.assertEqual(resultado.codigo, 0)
        self.assertEqual(resultado.salida.strip(), self.agente)
        self.assertEqual(self.identidad.read_bytes(), self.identidad_original)
        filtrado = actualizar.entorno_de_las_ordenes({"HOME": "/hogar-permitido", "PATH": "/bin", "CLAVE": "privada"})
        self.assertEqual(filtrado["HOME"], "/hogar-permitido")
        self.assertEqual(filtrado["PATH"], "/bin")
        self.assertEqual(filtrado["npm_config_update_notifier"], "false")
        self.assertNotIn("CLAVE", filtrado)

    def test_identidad_invalida_impide_ejecutar_orden(self) -> None:
        """Una configuración inválida falla antes del subproceso; no usa el agente ambiental."""
        self.identidad.write_text('user-agent = "AgentePrivado"\n')
        with mock.patch.object(actualizar, "ejecutar_con_plazo") as ejecutar, self.assertRaises(FormatoInesperado):
            actualizar.ejecutar_orden(["npm", "--version"], self.hogar)
        ejecutar.assert_not_called()

    def test_una_salida_que_no_es_utf8_no_rompe_la_orden(self) -> None:
        """Un byte que no es UTF-8 en la salida se sustituye; ejecutar_orden no lanza."""
        orden = [sys.executable, "-c", "import sys; sys.stdout.buffer.write(b'a\\xffb')"]
        with tempfile.TemporaryDirectory() as temporal:
            resultado = actualizar.ejecutar_orden(orden, Path(temporal))
        self.assertEqual(resultado, actualizar.Resultado(0, "a\ufffdb"))

    def test_las_ordenes_no_heredan_claves_del_entorno(self) -> None:
        """Una clave del entorno de quien actualiza no llega a la orden; PATH y la fecha FARO_HOY sí."""
        orden = [sys.executable, "-c", "import os; print(sorted(set(os.environ) & {'CLAVE_DE_PRUEBA', 'FARO_HOY'}))"]
        with (
            tempfile.TemporaryDirectory() as temporal,
            mock.patch.dict(os.environ, {"CLAVE_DE_PRUEBA": "secreto", "FARO_HOY": "2026-10-15"}),
        ):
            resultado = actualizar.ejecutar_orden(orden, Path(temporal))
        self.assertEqual(resultado.salida.strip(), "['FARO_HOY']")
        self.assertIn("PATH", actualizar.entorno_de_las_ordenes({"PATH": "/bin", "OTRA": "x"}))

    def test_la_conducta_sale_de_la_fuente_y_la_etapa_no_del_rotulo(self) -> None:
        """Una descarga se repite aunque su rótulo no siga ningún formato; otra etapa con ese rótulo, no."""
        opciones = actualizar.Opciones(pausa=0, reintento=0)
        llamadas: list[list[str]] = []

        def falla(orden: list[str], _area: Path) -> actualizar.Resultado:
            """Registra la orden y falla siempre.

            Args:
                orden: La orden que se ejecutaría.
                _area: El área (no se usa).

            Returns:
                Un fallo.
            """
            llamadas.append(orden)
            return actualizar.Resultado(1, "")

        with contextlib.redirect_stdout(io.StringIO()):
            actualizar.ejecutar_pasos(
                Path(), falla, [actualizar.Orden("rótulo libre", ["x"], "consorci", "descargar")], opciones
            )
            self.assertEqual(len(llamadas), 2)
            actualizar.ejecutar_pasos(
                Path(), falla, [actualizar.Orden("x · descargar", ["y"], "consorci", "validar")], opciones
            )
        self.assertEqual(len(llamadas), 3)

    def test_el_veredicto_lleva_su_estado_aparte_del_texto(self) -> None:
        """El estado (verde, ámbar, rojo) decide el código; el texto solo se escribe."""
        ambar = actualizar.ResultadoDelModulo(actualizar.AMBAR, "x")
        self.assertEqual(actualizar.decidir({}, True), actualizar.Veredicto("verde", "verde (ensayo)"))
        self.assertEqual(actualizar.decidir({"oit": ambar}, False).estado, "ámbar")
        self.assertEqual(actualizar.CODIGO_DE_SALIDA[actualizar.decidir({"oit": ambar}, False).estado], 3)

    def test_un_fallo_al_preparar_el_area_no_deja_la_copia(self) -> None:
        """Si preparar el área lanza, el área se borra igualmente."""
        with tempfile.TemporaryDirectory() as temporal:
            raiz, area = Path(temporal) / "repositorio", Path(temporal) / "area"
            raiz.mkdir()

            def a_medias(_raiz: Path, destino: Path) -> None:
                destino.mkdir()
                raise OSError("disco lleno")

            opciones = actualizar.Opciones(area=area, pausa=0, reintento=0)
            with mock.patch.object(actualizar, "preparar_area", a_medias), self.assertRaises(OSError):
                actualizar.actualizar(raiz, opciones, EjecutorSimulado(PAQUETE_VIGENTE))
            self.assertFalse(area.exists())


class PruebaAreaDeEnsayo(unittest.TestCase):
    """El área es una copia del repositorio sin secretos, con las plantillas versionadas que citan los documentos."""

    def test_los_secretos_no_se_copian_y_las_plantillas_si(self) -> None:
        """.dev.vars, .env y sus variantes se quedan fuera; .dev.vars.example se copia."""
        with tempfile.TemporaryDirectory() as temporal:
            raiz, area = Path(temporal) / "repositorio", Path(temporal) / "area"
            (raiz / "motor").mkdir(parents=True)
            nombres = (".dev.vars", ".dev.vars.produccion", ".env", ".env.local", ".dev.vars.example", "a.ts")
            for nombre in nombres:
                (raiz / "motor" / nombre).write_text("x", encoding="utf-8")
            actualizar.preparar_area(raiz, area)
            copiados = sorted(ruta.name for ruta in (area / "motor").iterdir())
        self.assertEqual(copiados, [".dev.vars.example", "a.ts"])


class PruebaInformeFechado(unittest.TestCase):
    """El informe de cada actualización se escribe entero, con su segundo, y nunca pisa otro."""

    def test_dos_informes_del_mismo_minuto_no_se_pisan(self) -> None:
        """Dos instantes del mismo minuto dan dos informes; el mismo segundo pasa al siguiente libre, sin pisar."""
        resumen = informe_fechado.Resumen("verde", [], piezas.Comparacion(None, [], []), [], 0.0)
        with tempfile.TemporaryDirectory() as temporal:
            raiz = Path(temporal)
            primero = datetime(2026, 10, 12, 4, 0, 1, tzinfo=UTC)
            informe_fechado.escribir_informe(raiz, resumen, primero)
            informe_fechado.escribir_informe(raiz, resumen, primero.replace(second=30))
            self.assertEqual(len(piezas.informes_fechados(raiz)), 2)
            informe_fechado.escribir_informe(raiz, resumen, primero)
            self.assertEqual(
                sorted(ruta.name for ruta in (raiz / piezas.CARPETA_DE_INFORMES).iterdir()),
                [
                    "2026-10-12-040001.json",
                    "2026-10-12-040001.md",
                    "2026-10-12-040002.json",
                    "2026-10-12-040002.md",
                    "2026-10-12-040030.json",
                    "2026-10-12-040030.md",
                ],
            )

    def test_colision_de_nombre_conserva_instante_real_del_informe(self) -> None:
        """El nombre avanza al siguiente libre sin inventar la fecha del contenido."""
        resumen = informe_fechado.Resumen("verde", [], piezas.Comparacion(None, [], []), [], 0.0)
        momento = datetime(2026, 10, 12, 4, 0, 59, tzinfo=UTC)
        with tempfile.TemporaryDirectory() as temporal:
            raiz = Path(temporal)
            primero = informe_fechado.escribir_informe(raiz, resumen, momento)
            segundo = informe_fechado.escribir_informe(raiz, resumen, momento)
            self.assertNotEqual(primero, segundo)
            for ruta in (primero, segundo):
                self.assertEqual(json.loads(ruta.with_suffix(".json").read_text())["utc"], momento.isoformat())
                self.assertIn("2026-10-12 04:00 UTC", ruta.read_text())

    def test_cada_plazo_tiene_fecha_observable_de_origen_o_revision(self) -> None:
        """Los plazos necesitan originales o una revisión editorial realmente fechada."""
        for nombre, fuente in piezas.FUENTES.items():
            if fuente.renovar_dias and not fuente.originales:
                with self.subTest(fuente=nombre):
                    self.assertEqual(fuente.politica, piezas.REDACTADA)
                    self.assertIsInstance(piezas.fecha_de_la_fuente(piezas.RAIZ, nombre), date)


class PruebaPoliticaDeLasFuentes(unittest.TestCase):
    """Cada fuente tiene su política; las renovables aceptan versiones nuevas bajo sus controles."""

    def test_cada_fuente_de_la_cadena_tiene_politica(self) -> None:
        """La tabla de políticas cubre exactamente las fuentes de reconstruir.py."""
        self.assertEqual(set(piezas.FUENTES), set(ORDEN))

    def test_solo_las_renovables_aceptan_el_cambio(self) -> None:
        """Las políticas diaria y mensual descargan con --aceptar-cambio."""
        for nombre, fuente in piezas.FUENTES.items():
            primera_orden = actualizar.ordenes_de_la_fuente(nombre)[0][1]
            aceptan = "--aceptar-cambio" in primera_orden
            self.assertEqual(aceptan, fuente.politica in (piezas.DIARIA, piezas.MENSUAL), nombre)

    def test_una_fuente_sin_descargar_se_prepara_con_su_copia_vigente(self) -> None:
        """Con --sin-descargar, la fuente pierde solo su descarga y conserva preparar y validar."""
        etapas = [orden.nombre for orden in actualizar.ordenes_de_la_fuente("consorci", ("consorci",))]
        self.assertEqual(etapas, ["consorci · preparar", "consorci · validar"])

    def test_sin_descargar_quita_un_solo_paso_a_la_cuenta(self) -> None:
        """La cuenta de pasos esperados de la fuente baja en uno: el de la descarga."""
        etapas = actualizar.ordenes_de_la_fuente("consorci", ("consorci",))
        menos = len(actualizar.ordenes_de_la_fuente("consorci")) - len(etapas)
        self.assertEqual(menos, 1)

    def test_una_fuente_manual_antigua_se_marca_para_renovar(self) -> None:
        """La fecha sale de la procedencia, y pasada su frecuencia se aconseja renovar."""
        with tempfile.TemporaryDirectory() as temporal:
            carpeta = Path(temporal) / "var" / "actualizacion" / "originales" / "cambra"
            carpeta.mkdir(parents=True)
            (carpeta / "procedencia.json").write_text('{"fecha": "2025-09-01"}', encoding="utf-8")
            filas = {fila["fuente"]: fila for fila in piezas.estado_de_las_manuales(Path(temporal), date(2026, 10, 7))}
            # Un repositorio sin carpeta de originales: ninguna fuente tiene procedencia, luego ninguna tiene fecha.
            sin_fecha = piezas.estado_de_las_manuales(Path(temporal) / "sin-originales", hoy=date(2026, 10, 7))
        self.assertEqual(filas["cambra"]["fecha"], "2025-09-01")
        self.assertTrue(filas["cambra"]["renovar"])
        self.assertTrue(all(fila["fecha"] is None and not fila["renovar"] for fila in sin_fecha))

    def test_la_fecha_de_verificacion_cuenta_como_fecha_del_dato(self) -> None:
        """Una procedencia que solo registra cuándo se verificó cada documento también tiene fecha."""
        with tempfile.TemporaryDirectory() as temporal:
            carpeta = Path(temporal) / "var" / "actualizacion" / "originales" / "agencia"
            carpeta.mkdir(parents=True)
            (carpeta / "procedencia.json").write_text(
                '{"documentos": [{"verificado": "2026-10-07"}]}', encoding="utf-8"
            )
            self.assertEqual(piezas.fecha_del_dato(Path(temporal), "agencia"), date(2026, 10, 7))


class PruebaPiezasDelInforme(unittest.TestCase):
    """Detalles del informe: tamaños con la tipografía española y la cola de una salida fallida."""

    def test_el_tamano_usa_el_punto_de_millares_espanol(self) -> None:
        """Bytes y entradas se escriben con punto de millares; sin lado, una raya."""
        self.assertEqual(informe_fechado._tamano({"bytes": 1234567, "entradas": 89}), "1.234.567 B · 89")
        self.assertEqual(informe_fechado._tamano(None), "—")

    def test_una_salida_fallida_conserva_solo_sus_ultimas_lineas(self) -> None:
        """El informe recoge las últimas LINEAS_DE_UN_FALLO líneas, que es donde una orden dice por qué falla."""
        salida = "\n".join(f"línea {numero}" for numero in range(informe_fechado.LINEAS_DE_UN_FALLO + 10))
        recortada = informe_fechado._ultimas_lineas(salida).splitlines()
        self.assertEqual(len(recortada), informe_fechado.LINEAS_DE_UN_FALLO)
        self.assertEqual(recortada[-1], f"línea {informe_fechado.LINEAS_DE_UN_FALLO + 9}")

    def test_cada_fuente_declara_sus_campos_por_nombre(self) -> None:
        """Una fuente manual lleva su plazo; una fija o de edición, ninguno (el orden de campos ya no importa)."""
        self.assertEqual(
            piezas.FUENTES["cambra"], piezas.Fuente(piezas.MANUAL, False, "anual (tabla de la Cambra)", 365, "cambra")
        )
        self.assertIsNone(piezas.FUENTES["esco"].renovar_dias)
        self.assertFalse(piezas.FUENTES["esco"].red)


class RevalidarEnLaActualizacionPruebas(unittest.TestCase):
    """La actualización revalida lo publicado antes de copiar el área: fuentes, área y seguimiento leen lo mismo."""

    def test_revalida_lo_publicado_antes_de_preparar_el_area(self) -> None:
        """La primera orden es la revalidación, en la raíz publicada y antes de copiar el área."""
        import tempfile
        from datetime import UTC, datetime
        from pathlib import Path

        carpeta = tempfile.TemporaryDirectory()
        self.addCleanup(carpeta.cleanup)
        raiz, area = Path(carpeta.name) / "raiz", Path(carpeta.name) / "area"
        raiz.mkdir()
        sucesos: list[tuple[str, object]] = []

        class Parada(Exception):
            """Detiene la actualización tras observar el orden de los primeros pasos."""

        def pasos(donde: Path, _ejecutor: object, ordenes: list, _opciones: object) -> list:
            sucesos.append(("ordenes", (donde, [orden.nombre for orden in ordenes])))
            return []

        def preparar(origen: Path, destino: Path) -> None:
            sucesos.append(("preparar_area", (origen, destino)))
            raise Parada

        opciones = actualizar.Opciones(area=area, pausa=0, reintento=0)
        with (
            mock.patch.object(actualizar, "ejecutar_pasos", side_effect=pasos),
            mock.patch.object(actualizar, "preparar_area", side_effect=preparar),
            self.assertRaises(Parada),
        ):
            actualizar._actualizar(raiz, opciones, mock.Mock(), datetime.now(UTC), None)
        self.assertEqual(
            sucesos[:2],
            [
                ("ordenes", (raiz, [actualizar.REVALIDAR_EL_CATALOGO.nombre])),
                ("preparar_area", (raiz, area)),
            ],
        )


class ModoDeLasCapturasRetenidas(ModoDeLoPublicado, unittest.TestCase):
    """Las capturas retenidas por la actualización quedan legibles por otro usuario: 0666 menos la umask."""

    def escritores(self) -> dict[str, Callable[[Path, bytes], None]]:
        """Escritores propios del paquete cuya salida lee otro servicio.

        Returns:
            Cada escritor real por su nombre, con la firma (ruta, bytes).
        """
        return {"capturas retenidas": actualizar._guardar_si_falta}


if __name__ == "__main__":
    unittest.main()
