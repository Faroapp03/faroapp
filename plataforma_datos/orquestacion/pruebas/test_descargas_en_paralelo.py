"""Las descargas en paralelo dejan lo mismo que la serie, y la serie sigue siendo la de siempre.

Cinco fuentes de servidores distintos (formacion, consorci, citilab, fundae y enlaces) recorren el motor real con su
registro de comprobaciones (`Seguimiento`), con un reloj fijo y un transporte que reproduce respuestas grabadas. Cada
descarga tarda un tiempo distinto, para que en paralelo terminen en otro orden, y la de enlaces lee el validado de
consorci y de formacion, como la real: si se adelantara a ellas, su original sería otro.
"""

import io
import json
import os
import re
import tempfile
import threading
import time
import unittest
from collections.abc import Sequence
from contextlib import redirect_stdout
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from plataforma_datos.comun import instante_del_ciclo
from plataforma_datos.comun.turnos_entre_procesos import VARIABLE as CARPETA_DE_TURNOS
from plataforma_datos.orquestacion import (
    actualizar,
    comprobaciones_remotas,
    descargas_en_paralelo,
    ejecucion_observada,
    informe_de_la_actualizacion,
    pasos_del_ciclo,
)
from plataforma_datos.orquestacion.ejecucion_observada import etapa_de_fuente
from plataforma_datos.orquestacion.hora_limite_del_motor import VARIABLE as HORA_LIMITE
from plataforma_datos.orquestacion.modulos import MODULOS, carpetas
from plataforma_datos.orquestacion.piezas_de_la_actualizacion import CARPETA_DE_INFORMES, FUENTES
from plataforma_datos.orquestacion.seguimiento_de_comprobaciones import Seguimiento

NOMBRES = ("formacion", "consorci", "citilab", "fundae", "enlaces")
REGISTRO = tuple(modulo for modulo in MODULOS if modulo.id in NOMBRES)
POR_ID = {modulo.id: modulo for modulo in REGISTRO}
# Respuestas grabadas y lo que tarda cada servidor en darlas: las más rápidas no son las primeras del registro.
GRABADAS = {"formacion": b"oferta del SOC", "consorci": b"cursos", "citilab": b"fichas", "fundae": b"ediciones"}
TARDA = {"formacion": 0.15, "consorci": 0.05, "citilab": 0.3, "fundae": 0.4, "enlaces": 0.05}
AYER = (datetime(2026, 11, 23, 3, 0, tzinfo=UTC), "00000000-0000-4000-8000-000000000023")
HOY = (datetime(2026, 11, 24, 3, 0, tzinfo=UTC), "00000000-0000-4000-8000-000000000024")


def reloj_fijo(instante: datetime) -> type[datetime]:
    """Un reloj que siempre da la misma hora: dos ejecuciones del mismo ciclo escriben las mismas horas.

    Returns:
        Una clase con la interfaz de datetime cuyo `now` da `instante`.
    """

    class RelojFijo(datetime):
        @classmethod
        def now(cls, tz: object = None) -> datetime:
            """La misma firma que datetime.now; la zona no cambia nada.

            Returns:
                El instante fijo.
            """
            return instante

    return RelojFijo


def archivo(raiz: Path, nombre: str, etapa: int) -> Path:
    """El archivo de una carpeta operativa real (0 originales, 1 preparados, 2 validados).

    Returns:
        Su ruta bajo la raíz.
    """
    return raiz / carpetas(POR_ID[nombre])[etapa] / "dato.txt"


class Reproduccion:
    """Hace de transporte: reproduce las respuestas grabadas con su demora y escribe como lo haría cada etapa."""

    def __init__(
        self, fallan: frozenset[str] = frozenset(), dia: bytes = b"hoy:", rompe: frozenset[str] = frozenset()
    ) -> None:
        self.fallan = fallan
        self.rompe = rompe
        self.dia = dia
        self.ordenes: list[tuple[str, str]] = []
        self.turnos: list[str | None] = []
        self.a_la_vez = self.maximo = 0
        self._cerrojo = threading.Lock()

    def __call__(self, orden: Sequence[str], area: Path) -> actualizar.Resultado:
        """Ejecuta una etapa sobre el área.

        Returns:
            Fallo en la descarga de las fuentes de `fallan`; éxito en todo lo demás.
        """
        identificada = etapa_de_fuente(orden)
        if identificada is None:
            return actualizar.Resultado(0, "")
        nombre, etapa = identificada
        with self._cerrojo:
            self.ordenes.append((nombre, etapa))
        if etapa == "descargar":
            return self._descargar(nombre, area)
        if etapa == "preparar":
            archivo(area, nombre, 1).write_bytes(archivo(area, nombre, 0).read_bytes())
        else:
            archivo(area, nombre, 2).write_bytes(archivo(area, nombre, 1).read_bytes())
        return actualizar.Resultado(0, "")

    def _descargar(self, nombre: str, area: Path) -> actualizar.Resultado:
        with self._cerrojo:
            self.a_la_vez += 1
            self.maximo = max(self.maximo, self.a_la_vez)
            self.turnos.append(os.environ.get(CARPETA_DE_TURNOS))
        time.sleep(TARDA[nombre])
        if nombre == "enlaces":
            # Como la real: los candidatos salen del validado de consorci y del de formacion.
            cuerpo = b"+".join(archivo(area, fuente, 2).read_bytes() for fuente in ("consorci", "formacion"))
        else:
            cuerpo = self.dia + GRABADAS[nombre]
        with self._cerrojo:
            self.a_la_vez -= 1
        if nombre in self.rompe:
            raise OSError("disco lleno")
        if nombre in self.fallan:
            return actualizar.Resultado(1, "HTTP Error 502: Bad Gateway")
        archivo(area, nombre, 0).write_bytes(cuerpo)
        return actualizar.Resultado(0, "")


def foto(raiz: Path) -> dict[str, bytes]:
    """Todos los archivos de la raíz, byte a byte.

    Cada intento técnico vive en una carpeta con un UUID al azar, distinto en cada ejecución también en serie: se
    nombra por su fuente y su etapa, numerado por el orden de su contenido, y en su contenido solo se sustituye ese
    UUID.

    Returns:
        Por ruta relativa, sus bytes.
    """
    contenidos: dict[str, bytes] = {}
    intentos: dict[str, list[bytes]] = {}
    for ruta in sorted(raiz.rglob("*")):
        if not ruta.is_file():
            continue
        relativa = ruta.relative_to(raiz).as_posix()
        if "/intentos/" in relativa:
            documento = json.loads(ruta.read_bytes())
            relativa = re.sub(r"intentos/[^/]+/", f"intentos/{documento['fuente']}-{documento['etapa']}/", relativa)
            intentos.setdefault(relativa, []).append(ruta.read_bytes().replace(documento["id"].encode(), b"<id>"))
        else:
            contenidos[relativa] = ruta.read_bytes()
    for relativa, documentos in intentos.items():
        contenidos.update({f"{relativa}#{numero}": cuerpo for numero, cuerpo in enumerate(sorted(documentos))})
    return contenidos


class PruebaDescargasEnParalelo(unittest.TestCase):
    """Serie y paralelo dan el mismo árbol; la serie no cambia; el registro no pierde escrituras."""

    def setUp(self) -> None:
        """Una raíz portable por caso, con un espacio en la ruta."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.base = Path(temporal.name) / "Año 2026"

    def caso(self, nombre: str) -> Path:
        """Crea las carpetas operativas publicadas de las cinco fuentes.

        Returns:
            La raíz operativa.
        """
        raiz = self.base / nombre / "raiz"
        for modulo in REGISTRO:
            for etapa in range(3):
                ruta = archivo(raiz, modulo.id, etapa)
                ruta.parent.mkdir(parents=True)
                ruta.write_bytes(b"vigente")
        (raiz / CARPETA_DE_INFORMES).mkdir(parents=True)
        return raiz

    def ciclo(self, nombre: str, transporte: Reproduccion, en_paralelo: bool) -> tuple[Path, dict[str, str]]:
        """Sobre una base que ya pasó un ciclo en serie (el de ayer), ejecuta el de hoy.

        Las fuentes del registro de comprobaciones conservan así su sitio, como en un ciclo real; una fuente que entra
        por primera vez se añade en el orden en que se abre, que en paralelo puede ser otro.

        Returns:
            La raíz y el veredicto de cada módulo del ciclo de hoy.
        """
        raiz = self.caso(nombre)
        self.ejecutar(raiz, AYER, Reproduccion(dia=b"ayer:"), en_paralelo=False)
        return raiz, self.ejecutar(raiz, HOY, transporte, en_paralelo=en_paralelo)

    def ejecutar(
        self, raiz: Path, dia: tuple[datetime, str], transporte: Reproduccion, *, en_paralelo: bool
    ) -> dict[str, str]:
        """Ejecuta el motor real con su seguimiento, sin el paquete, con el reloj y el ciclo del día fijos.

        Returns:
            El veredicto de cada módulo.
        """
        area = raiz.parent / f"area-{dia[1][-2:]}"
        opciones = actualizar.Opciones(area=area, pausa=0, reintento=0, en_paralelo=en_paralelo)
        reloj = reloj_fijo(dia[0])
        paquete = ([], actualizar.Comparacion(None, [], []), actualizar.ResultadoDelModulo(actualizar.VERDE))
        relojes = SimpleNamespace(monotonic=lambda: 0.0, sleep=time.sleep)
        with (
            mock.patch.object(actualizar, "MODULOS", REGISTRO),
            mock.patch.object(actualizar, "ejecutar_paquete", return_value=paquete),
            mock.patch.object(actualizar, "datetime", reloj),
            # El comienzo del intento y el seguimiento leen el reloj del ciclo, la hora real sin FARO_INSTANTE.
            mock.patch.object(instante_del_ciclo, "datetime", reloj),
            mock.patch.object(actualizar, "time", relojes),
            mock.patch.object(pasos_del_ciclo, "datetime", reloj),
            mock.patch.object(informe_de_la_actualizacion, "datetime", reloj),
            mock.patch.object(ejecucion_observada, "datetime", reloj),
            mock.patch.object(comprobaciones_remotas, "uuid", SimpleNamespace(uuid4=lambda: dia[1])),
            redirect_stdout(io.StringIO()),
        ):
            resultado = actualizar.actualizar_con_resultado(raiz, opciones, transporte)
        return {modulo: hecho.veredicto for modulo, hecho in resultado.resultados.items()}

    def test_serie_y_paralelo_dejan_el_mismo_arbol_byte_a_byte(self) -> None:
        """Mismos veredictos, mismos datos, mismo registro de comprobaciones, mismos diarios y mismo estado."""
        en_serie, en_paralelo = Reproduccion(), Reproduccion()
        raiz_serie, veredictos_serie = self.ciclo("serie", en_serie, en_paralelo=False)
        raiz_paralelo, veredictos_paralelo = self.ciclo("paralelo", en_paralelo, en_paralelo=True)
        self.assertEqual(veredictos_paralelo, veredictos_serie)
        self.assertEqual(set(veredictos_serie.values()), {actualizar.VERDE})
        self.assertEqual(foto(raiz_paralelo), foto(raiz_serie))
        self.assertEqual(archivo(raiz_paralelo, "enlaces", 0).read_bytes(), b"hoy:cursos+hoy:oferta del SOC")
        # De verdad corrieron a la vez, cada proceso con la carpeta de turnos; en serie, una tras otra y sin ella.
        self.assertGreaterEqual(en_paralelo.maximo, 2)
        self.assertEqual(en_serie.maximo, 1)
        self.assertTrue(all(en_paralelo.turnos) and not any(en_serie.turnos))
        self.assertNotIn(CARPETA_DE_TURNOS, os.environ)

    def test_un_fallo_de_descarga_no_cambia_lo_que_hacen_las_demas(self) -> None:
        """Fundae falla dos veces: queda en ámbar como en serie y las otras cuatro publican igual."""
        fallan = frozenset({"fundae"})
        raiz_serie, veredictos_serie = self.ciclo("serie", Reproduccion(fallan), en_paralelo=False)
        raiz_paralelo, veredictos_paralelo = self.ciclo("paralelo", Reproduccion(fallan), en_paralelo=True)
        self.assertEqual(veredictos_serie["fundae"], actualizar.AMBAR)
        self.assertEqual(veredictos_paralelo, veredictos_serie)
        self.assertEqual(foto(raiz_paralelo), foto(raiz_serie))

    def test_una_excepcion_de_la_descarga_llega_a_la_serie_como_si_la_hubiera_ejecutado_ella(self) -> None:
        """Citilab lanza un error de disco al descargar: la serie lo recibe y conserva su versión; el resto, igual."""
        rompe = frozenset({"citilab"})
        raiz_serie, veredictos_serie = self.ciclo("serie", Reproduccion(rompe=rompe), en_paralelo=False)
        raiz_paralelo, veredictos_paralelo = self.ciclo("paralelo", Reproduccion(rompe=rompe), en_paralelo=True)
        self.assertEqual(veredictos_serie["citilab"], actualizar.AMBAR)
        self.assertEqual(veredictos_paralelo, veredictos_serie)
        for modulo in REGISTRO:
            self.assertEqual(
                actualizar.huella(raiz_paralelo, carpetas(modulo)), actualizar.huella(raiz_serie, carpetas(modulo))
            )

    def test_sin_tiempo_para_el_paquete_no_se_adelanta_ninguna_descarga(self) -> None:
        """Con la hora límite ya pasada, ninguna cola empieza; la serie es quien anota la parada."""
        transporte = Reproduccion()
        plan = descargas_en_paralelo.PlanDeDescargas(REGISTRO, actualizar.exigir_ordenes_del_modulo)
        opciones = actualizar.Opciones(pausa=0, en_paralelo=True)
        with mock.patch.dict(os.environ, {HORA_LIMITE: "1"}):
            self.assertFalse(descargas_en_paralelo.queda_tiempo_para_empezar())
            with descargas_en_paralelo.adelantar_descargas(plan, self.base, transporte, opciones):
                pass
        self.assertEqual(transporte.ordenes, [])
        self.assertTrue(descargas_en_paralelo.queda_tiempo_para_empezar({}))

    def test_la_carpeta_de_turnos_llega_a_cada_orden(self) -> None:
        """El entorno filtrado de las órdenes conserva la carpeta de turnos, y solo ella de lo nuevo."""
        entorno = actualizar.entorno_de_las_ordenes({CARPETA_DE_TURNOS: "/turnos", "OTRA_COSA": "no"})
        self.assertEqual(entorno[CARPETA_DE_TURNOS], "/turnos")
        self.assertNotIn("OTRA_COSA", entorno)

    def test_en_serie_hace_exactamente_lo_de_siempre(self) -> None:
        """Por omisión la serie recibe su mismo ejecutor y sus opciones, y llama en el mismo orden con sus pausas."""
        transporte = Reproduccion()
        opciones = actualizar.Opciones(pausa=0)
        plan = descargas_en_paralelo.PlanDeDescargas(REGISTRO, actualizar.exigir_ordenes_del_modulo)
        with descargas_en_paralelo.adelantar_descargas(plan, Path(), transporte, opciones) as ronda:
            self.assertIs(ronda.ejecutar, transporte)
            self.assertIs(ronda.opciones, opciones)
        self.assertFalse(actualizar.Opciones().en_paralelo)
        raiz = self.caso("orden")
        area = self.base / "orden" / "area"
        actualizar.preparar_area(raiz, area)
        esperas: list[float] = []
        relojes = SimpleNamespace(monotonic=time.monotonic, sleep=esperas.append)
        with (
            mock.patch.object(actualizar, "MODULOS", REGISTRO),
            mock.patch.object(actualizar, "time", relojes),
            redirect_stdout(io.StringIO()),
        ):
            actualizar.ejecutar_modulos(raiz, area, transporte, actualizar.Opciones(pausa=7.0))
        esperado = [(nombre, etapa) for nombre in NOMBRES for etapa in ("descargar", "preparar", "validar")]
        self.assertEqual(transporte.ordenes, esperado)
        self.assertEqual(esperas, [7.0] * sum(FUENTES[nombre].red for nombre in NOMBRES))
        self.assertEqual(transporte.maximo, 1)

    def test_la_cli_queda_en_serie_salvo_que_se_pida_en_paralelo(self) -> None:
        """Sin opción y con --en-serie, en serie; solo --en-paralelo adelanta las descargas."""
        vistas: list[bool] = []
        with mock.patch.object(actualizar, "actualizar", lambda _raiz, opciones: vistas.append(opciones.en_paralelo)):
            for argumentos in ([], ["--en-serie"], ["--en-paralelo"]):
                actualizar.main(argumentos)
        self.assertEqual(vistas, [False, False, True])

    def test_colas_juntan_las_fuentes_que_comparten_servidor(self) -> None:
        """Dos fuentes con un servidor común van en la misma cola, en el orden del registro; las demás, aparte."""
        plan = descargas_en_paralelo.PlanDeDescargas(REGISTRO, actualizar.exigir_ordenes_del_modulo)
        descargas = descargas_en_paralelo.descargas_del_plan(plan, actualizar.Opciones())
        servidores = {"formacion": {"a"}, "consorci": {"b"}, "citilab": {"c", "a"}, "fundae": {"d"}, "enlaces": {"b"}}
        colas = descargas_en_paralelo.colas(descargas, lambda fuente: frozenset(servidores[fuente]))
        nombres = [[descarga.orden.fuente for descarga in cola] for cola in colas]
        self.assertEqual(nombres, [["formacion", "citilab"], ["consorci", "enlaces"], ["fundae"]])
        self.assertIn("oficinadetreball.gencat.cat", descargas_en_paralelo.servidores("formacion"))

    def test_dos_fuentes_que_terminan_a_la_vez_no_pierden_su_registro(self) -> None:
        """Dos hilos abren y cierran su fuente a la vez; el registro conserva las dos, cada una con su resultado."""
        raiz = self.caso("registro")
        comprobaciones_remotas.migrar_registro(raiz)
        ciclo = comprobaciones_remotas.iniciar_ciclo(raiz, datetime.now(UTC), "manual")
        seguimiento = Seguimiento(raiz, ciclo, Reproduccion(), lambda: datetime.now(UTC))
        leer = comprobaciones_remotas.leer_registro

        def leer_despacio(*argumentos: object) -> dict:
            registro = leer(*argumentos)
            time.sleep(0.05)  # abre la ventana entre leer y reescribir, donde dos escrituras se pisarían
            return registro

        salida = threading.Barrier(2)

        def descargar(nombre: str) -> None:
            salida.wait()
            orden = actualizar.ordenes_de_la_fuente(nombre)[0]
            seguimiento.ejecutar(orden.orden, self.base / "registro" / "raiz")
            salida.wait()
            seguimiento.terminar_modulo(POR_ID[nombre], actualizar.ResultadoDelModulo(actualizar.VERDE))

        with mock.patch.object(comprobaciones_remotas, "leer_registro", leer_despacio):
            hilos = [threading.Thread(target=descargar, args=(nombre,)) for nombre in ("citilab", "consorci")]
            for hilo in hilos:
                hilo.start()
            for hilo in hilos:
                hilo.join()
        fuentes = comprobaciones_remotas.leer_registro(raiz)["fuentes"]
        self.assertEqual({fuentes[nombre]["resultado"] for nombre in ("citilab", "consorci")}, {"parcial"})


if __name__ == "__main__":
    unittest.main()
