"""Dos procesos que consultan el mismo servidor quedan separados al menos su pausa, y nunca a la vez.

Las pruebas con procesos reales los arrancan a la vez (a una misma hora de `time.monotonic`, común a la máquina) y
cada uno anota cuándo empezó y terminó cada consulta. Un control con carpetas separadas, sin turno común, muestra que
esa misma medida detecta el solapamiento: la prueba puede fallar.
"""

import json
import os
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from unittest import mock

from plataforma_datos.comun import red
from plataforma_datos.comun.turnos_entre_procesos import VARIABLE, TurnosEntreProcesos, turnos_del_entorno

RAIZ = Path(__file__).resolve().parents[3]
PLAZO = 60
HOLGURA = 0.01  # segundos de redondeo entre el fin anotado y el que mide el proceso
# Un proceso hijo: espera a la hora de salida y hace sus consultas, cada una con su turno, anotando cuándo empieza y
# termina. Con «red», la consulta es la de red.PausasPorDominio, con su pausa real de dos segundos.
HIJO = """
import json, sys, time
from pathlib import Path
from plataforma_datos.comun import red
from plataforma_datos.comun.turnos_entre_procesos import TurnosEntreProcesos
carpeta, salida, pausa, veces, salida_a, modo = sys.argv[1:]
turnos = TurnosEntreProcesos(Path(carpeta))
pausas = red.PausasPorDominio(turnos=turnos)
while time.monotonic() < float(salida_a):
    time.sleep(0.001)
tramos = []
for _ in range(int(veces)):
    turno = turnos.turno("servidor.example", float(pausa))
    with pausas.consulta("https://servidor.example/") if modo == "red" else turno:
        inicio = time.monotonic()
        time.sleep(0.1)
        tramos.append([inicio, time.monotonic()])
Path(salida).write_text(json.dumps(tramos))
"""


def consultas_de_dos_procesos(carpetas: tuple[Path, Path], pausa: float, veces: int, modo: str) -> list[list[float]]:
    """Lanza dos procesos reales que consultan el mismo servidor a la vez.

    Returns:
        Los tramos [inicio, fin] de todas sus consultas, ordenados por inicio.

    Raises:
        AssertionError: Si un proceso no termina bien.
    """
    salida_a = time.monotonic() + 1.5  # da tiempo a que ambos arranquen
    procesos = []
    for numero, carpeta in enumerate(carpetas):
        salida = carpeta.parent / f"tramos-{numero}.json"
        orden = [sys.executable, "-c", HIJO, str(carpeta), str(salida), str(pausa), str(veces), str(salida_a), modo]
        procesos.append((subprocess.Popen(orden, cwd=RAIZ), salida))
    tramos = []
    for proceso, salida in procesos:
        if proceso.wait(timeout=PLAZO) != 0:
            raise AssertionError("un proceso de la prueba no terminó bien")
        tramos += json.loads(salida.read_text())
    return sorted(tramos)


def separaciones(tramos: list[list[float]]) -> list[float]:
    """Lo que pasa entre el fin de una consulta y el principio de la siguiente (negativo si se solapan).

    Returns:
        Una separación por cada par de consultas seguidas.
    """
    return [siguiente[0] - anterior[1] for anterior, siguiente in zip(tramos, tramos[1:], strict=False)]


# Un hijo que toma el turno, avisa de que lo tiene y se queda dentro hasta que lo matan.
DENTRO_DEL_TURNO = """
import sys, time
from pathlib import Path
from plataforma_datos.comun.turnos_entre_procesos import TurnosEntreProcesos
with TurnosEntreProcesos(Path(sys.argv[1])).turno("servidor.example", float(sys.argv[3])):
    Path(sys.argv[2]).write_text("dentro")
    time.sleep(60)
"""


class TurnoQueFallaAlSoltarse:
    """Turnos de mentira cuya primera suelta falla, como un disco lleno al anotar la hora de fin."""

    def __init__(self) -> None:
        self.fallos = 1

    @contextmanager
    def turno(self, _dominio: str, _pausa: float) -> Iterator[None]:
        """Da el turno; la primera vez falla al soltarlo.

        Yields:
            El turno.

        Raises:
            OSError: En la primera suelta.
        """
        yield
        if self.fallos:
            self.fallos -= 1
            raise OSError("no se pudo anotar el fin del turno")


class TurnoAnotado:
    """Turnos de mentira que anotan cuándo se toma y se suelta cada uno."""

    def __init__(self) -> None:
        self.sucesos: list[str] = []

    @contextmanager
    def turno(self, dominio: str, pausa: float) -> Iterator[None]:
        """Anota la toma y la suelta del turno del servidor.

        Yields:
            El turno.
        """
        self.sucesos.append(f"toma {dominio} {pausa:g}")
        try:
            yield
        finally:
            self.sucesos.append(f"suelta {dominio}")


class PruebaTurnosEntreProcesos(unittest.TestCase):
    """El turno de cada servidor se comparte entre procesos por una carpeta común."""

    def setUp(self) -> None:
        """Una carpeta temporal propia, con un espacio en la ruta."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.base = Path(temporal.name) / "turnos del ciclo"
        self.base.mkdir()

    def carpeta(self, nombre: str) -> Path:
        """Crea una carpeta de turnos.

        Returns:
            Su ruta.
        """
        carpeta = self.base / nombre
        carpeta.mkdir()
        return carpeta

    def test_dos_procesos_reales_nunca_consultan_a_la_vez_y_respetan_la_pausa(self) -> None:
        """Con la carpeta común, cada consulta empieza al menos la pausa después del fin de la anterior."""
        comun = self.carpeta("comun")
        tramos = consultas_de_dos_procesos((comun, comun), pausa=0.4, veces=2, modo="turno")
        self.assertEqual(len(tramos), 4)
        self.assertTrue(all(hueco >= 0.4 - HOLGURA for hueco in separaciones(tramos)), separaciones(tramos))

    def test_sin_carpeta_comun_los_procesos_se_solapan(self) -> None:
        """Control: con una carpeta cada uno, la misma medida ve dos consultas a la vez."""
        carpetas = (self.carpeta("uno"), self.carpeta("otro"))
        tramos = consultas_de_dos_procesos(carpetas, pausa=0.4, veces=1, modo="turno")
        self.assertLess(min(separaciones(tramos)), 0)

    def test_las_pausas_de_red_separan_dos_procesos_dos_segundos(self) -> None:
        """La consulta de red.PausasPorDominio toma el turno: dos procesos quedan a la pausa de red, 2 s."""
        comun = self.carpeta("red")
        tramos = consultas_de_dos_procesos((comun, comun), pausa=0, veces=1, modo="red")
        self.assertGreaterEqual(separaciones(tramos)[0], red.PAUSA_ENTRE_PETICIONES_S - HOLGURA)

    def test_una_redireccion_suelta_el_turno_del_origen_antes_de_pedir_el_del_destino(self) -> None:
        """Una consulta nunca tiene dos turnos a la vez: dos procesos no pueden esperarse el uno al otro."""
        turnos = TurnoAnotado()
        pausas = red.PausasPorDominio(lambda: 0.0, lambda _segundos: None, turnos=turnos)
        with pausas.consulta("https://origen.example/a"):
            pausas.redireccion("https://origen.example/a", "https://destino.example/b")
        self.assertEqual(
            turnos.sucesos,
            ["toma origen.example 2", "suelta origen.example", "toma destino.example 2", "suelta destino.example"],
        )
        with pausas.consulta("https://origen.example/c"):
            pass
        self.assertEqual(turnos.sucesos[-2:], ["toma origen.example 2", "suelta origen.example"])

    def test_la_espera_cuenta_desde_el_fin_anotado_y_nunca_es_menor_que_la_pausa_si_no_se_entiende(self) -> None:
        """Vacío no espera; tras un fin, lo que falta; ilegible o futuro, la pausa entera."""
        ahora, esperas = [10.0], []
        turnos = TurnosEntreProcesos(self.carpeta("reloj"), lambda: ahora[0], esperas.append)
        with turnos.turno("servidor.example", 2.0):
            pass
        ahora[0] = 10.5
        with turnos.turno("servidor.example", 2.0):
            pass
        archivo = turnos.archivo("servidor.example")
        for contenido in (b"no es una hora", b"99.0", b"nan"):
            archivo.write_bytes(contenido)
            with turnos.turno("servidor.example", 2.0):
                pass
        self.assertEqual(esperas, [1.5, 2.0, 2.0, 2.0])

    def test_un_proceso_muerto_con_el_turno_no_deja_consultar_antes_de_la_pausa(self) -> None:
        """Un hijo toma el turno y muere por SIGKILL: el siguiente espera la pausa entera desde que lo tomó."""
        carpeta, dentro = self.carpeta("muerto"), self.base / "dentro"
        hijo = subprocess.Popen([sys.executable, "-c", DENTRO_DEL_TURNO, str(carpeta), str(dentro), "0.5"], cwd=RAIZ)
        self.addCleanup(hijo.wait)
        limite = time.monotonic() + PLAZO
        while not dentro.exists() and time.monotonic() < limite:
            time.sleep(0.01)
        tomado = time.monotonic()
        os.kill(hijo.pid, signal.SIGKILL)
        hijo.wait(PLAZO)
        with TurnosEntreProcesos(carpeta).turno("servidor.example", 0.5):
            consulta = time.monotonic()
        self.assertGreaterEqual(consulta - tomado, 0.5 - 0.1)

    def test_un_proceso_muerto_tarde_con_el_turno_cuenta_como_recien_terminado(self) -> None:
        """Muere por SIGKILL pasada ya la pausa: el siguiente espera la pausa entera desde que toma el turno."""
        carpeta, dentro = self.carpeta("muerto-tarde"), self.base / "dentro-tarde"
        hijo = subprocess.Popen([sys.executable, "-c", DENTRO_DEL_TURNO, str(carpeta), str(dentro), "0.5"], cwd=RAIZ)
        self.addCleanup(hijo.wait)
        limite = time.monotonic() + PLAZO
        while not dentro.exists() and time.monotonic() < limite:
            time.sleep(0.01)
        time.sleep(1.0)  # el doble de la pausa: una hora provisional de la toma ya habría vencido
        os.kill(hijo.pid, signal.SIGKILL)
        hijo.wait(PLAZO)
        pide = time.monotonic()
        with TurnosEntreProcesos(carpeta).turno("servidor.example", 0.5):
            consulta = time.monotonic()
        self.assertGreaterEqual(consulta - pide, 0.5 - 0.05)

    def test_un_corte_al_anotar_el_turno_no_deja_el_archivo_vacio(self) -> None:
        """Si escribir falla al tomar el turno, queda la hora anterior: un archivo vacío diría «nunca consultado»."""
        turnos = TurnosEntreProcesos(self.carpeta("corte"))
        with turnos.turno("servidor.example", 0.0):
            pass
        anterior = turnos.archivo("servidor.example").read_bytes()
        with (
            mock.patch("os.pwrite", side_effect=OSError("disco lleno")),
            self.assertRaises(OSError),
            turnos.turno("servidor.example", 0.0),
        ):
            pass
        self.assertEqual(turnos.archivo("servidor.example").read_bytes(), anterior)

    def test_si_soltar_el_turno_falla_la_siguiente_consulta_puede_abrirse(self) -> None:
        """El error de la suelta se ve, y la consulta siguiente no queda bloqueada por una consulta «abierta»."""
        pausas = red.PausasPorDominio(lambda: 0.0, lambda _segundos: None, turnos=TurnoQueFallaAlSoltarse())
        with self.assertRaises(OSError), pausas.consulta("https://servidor.example/a"):
            pass
        with pausas.consulta("https://servidor.example/b"):
            pass

    def test_sin_carpeta_en_el_entorno_no_hay_turnos(self) -> None:
        """Una sola descarga a la vez no necesita turnos; con la variable, se comparten en su carpeta."""
        self.assertIsNone(turnos_del_entorno({}))
        turnos = turnos_del_entorno({VARIABLE: str(self.base)})
        self.assertIsNotNone(turnos)
        self.assertEqual(turnos.carpeta if turnos else None, self.base)

    def test_una_carpeta_que_no_existe_impide_la_consulta(self) -> None:
        """Sin su turno la consulta no se hace: el error se ve, no se consulta sin pausa."""
        turnos = TurnosEntreProcesos(self.base / "no existe")
        with self.assertRaises(FileNotFoundError), turnos.turno("servidor.example", 2.0):
            pass


if __name__ == "__main__":
    unittest.main()
