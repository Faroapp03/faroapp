"""Ejecuta las pruebas Python del producto y rechaza una suite sin casos ejecutados."""

import argparse
import hashlib
import json
import os
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from collections.abc import Iterable, Iterator
from contextlib import contextmanager
from dataclasses import asdict, dataclass
from pathlib import Path
from types import FrameType, TracebackType
from typing import Never, override

type ErrorDePrueba = tuple[type[BaseException], BaseException, TracebackType | None]


class ResultadoConEjecuciones(unittest.TextTestResult):
    """Resultado de unittest que distingue éxitos reales de omisiones y fallos esperados."""

    hay_casos_aprobados = False
    _subcaso_aprobado = False
    _modulo = ""
    _inicio_modulo = 0.0

    def _terminar_modulo(self) -> None:
        segundos = time.monotonic() - self._inicio_modulo
        if self._modulo and segundos >= SEGUNDOS_MODULO_LENTO:
            print(f"[Python {os.getpid()}] termina {self._modulo} en {segundos:.1f} s", file=sys.stderr, flush=True)

    def empieza_modulo(self, nombre: str) -> None:
        """Anota la unidad en ejecución y el tiempo monotónico de la anterior si fue lenta."""
        if self._modulo != nombre:
            self._terminar_modulo()
            self._modulo = nombre
            self._inicio_modulo = time.monotonic()
            print(f"[Python {os.getpid()}] empieza {nombre}", file=sys.stderr, flush=True)

    @override
    def stopTestRun(self) -> None:
        """Incluye en las mediciones el último módulo de cada proceso."""
        self._terminar_modulo()
        super().stopTestRun()

    @override
    def startTest(self, test: unittest.TestCase) -> None:
        """Aísla el resultado provisional de los subcasos de cada método."""
        self._subcaso_aprobado = False
        self.empieza_modulo(type(test).__module__)
        super().startTest(test)

    @override
    def stopTest(self, test: unittest.TestCase) -> None:
        """Admite los subcasos una vez conocido el resultado completo del método."""
        self.hay_casos_aprobados |= self._subcaso_aprobado
        super().stopTest(test)

    @override
    def addSuccess(self, test: unittest.TestCase) -> None:
        """Registra un método completo que ha terminado correctamente."""
        self.hay_casos_aprobados = True
        super().addSuccess(test)

    @override
    def addSubTest(self, test: unittest.TestCase, subtest: unittest.TestCase, err: ErrorDePrueba | None) -> None:
        """Registra un subcaso aprobado sin confundirlo con los métodos que lo contienen."""
        if err is None:
            self._subcaso_aprobado = True
        super().addSubTest(test, subtest, err)

    @override
    def addExpectedFailure(self, test: unittest.TestCase, err: ErrorDePrueba) -> None:
        """Un fallo esperado no acredita el método ni los subcasos que lo precedieron."""
        self._subcaso_aprobado = False
        super().addExpectedFailure(test, err)


CARPETA_GUARDIA = Path(__file__).resolve().parent / "sin_red"
RAIZ = Path(__file__).resolve().parents[1]
CURSOS = "plataforma_datos.cursos."
CIRCUITO = "plataforma_datos.orquestacion.pruebas.test_ensayo_circuito"
DOS_CPU = 2
SEGUNDOS_MODULO_LENTO = 5


class _CancelacionDelProceso(KeyboardInterrupt):
    """Interrumpe unittest incluso dentro de un caso, para retirar los temporales del paso."""


def _al_terminar(senal: int, _marco: FrameType | None) -> Never:
    # El supervisor señala el grupo y los PID individuales. La segunda señal debe dejar terminar la limpieza.
    signal.signal(senal, signal.SIG_IGN)
    raise _CancelacionDelProceso


def preparar_guardia_red() -> None:
    """Pone la guardia de red en este proceso y la deja preparada para los intérpretes hijos.

    Los hijos la heredan por `FARO_PRUEBAS_SIN_RED=1` y por `sitecustomize.py` en `PYTHONPATH`; uno lanzado con `-I`
    ignora `PYTHONPATH` y no la hereda.
    """
    carpeta = str(CARPETA_GUARDIA)
    if carpeta not in sys.path:
        sys.path.insert(0, carpeta)
    import guardia_red

    guardia_red.aplicar()
    os.environ[guardia_red.VARIABLE] = "1"
    previas = os.environ.get("PYTHONPATH", "").split(os.pathsep)
    os.environ["PYTHONPATH"] = os.pathsep.join([carpeta, *(p for p in previas if p and p != carpeta)])


def _cuota_suficiente(montaje: Path, relativa: str, unificada: bool) -> bool:
    """Comprueba las cuotas heredadas de CPU desde el grupo de este proceso hasta el montaje.

    Returns:
        Si todas las cuotas visibles permiten al menos dos CPU a tiempo completo.
    """
    grupo = montaje if ".." in Path(relativa).parts else montaje / relativa.lstrip("/")
    for carpeta in (grupo, *grupo.parents):
        if not carpeta.is_relative_to(montaje):
            break
        if unificada:
            limite = carpeta / "cpu.max"
            if not limite.is_file():
                continue
            cuota, periodo = limite.read_text().split()
        else:
            limite = carpeta / "cpu.cfs_quota_us"
            if not limite.is_file():
                continue
            cuota, periodo = limite.read_text().strip(), (carpeta / "cpu.cfs_period_us").read_text().strip()
        periodo_us = int(periodo)
        if periodo_us <= 0 or (cuota not in {"max", "-1"} and int(cuota) < DOS_CPU * periodo_us):
            return False
    return True


def cuotas_linux_suficientes(base: Path, pertenencia: Path) -> bool:
    """Lee los límites cgroup v1 y v2, incluidos los de grupos antecesores y el montaje de un contenedor.

    Returns:
        Si ninguno de los grupos a los que pertenece el proceso restringe la segunda CPU.
    """
    for linea in pertenencia.read_text().splitlines():
        _, nombres, relativa = linea.split(":", 2)
        if not nombres and not _cuota_suficiente(base, relativa, True):
            return False
        if "cpu" in nombres.split(","):
            for nombre in {"cpu", "cpu,cpuacct", "cpuacct,cpu", nombres}:
                if not _cuota_suficiente(base / nombre, relativa, False):
                    return False
    return True


def admite_dos_procesos() -> bool:
    """Exige dos CPU permitidas por la afinidad y, en Linux, también por el cupo del proceso.

    Returns:
        Si los recursos que pudo identificar permiten dos procesos.
    """
    try:
        permitidas = len(os.sched_getaffinity(0)) if hasattr(os, "sched_getaffinity") else os.cpu_count()
        return (permitidas or 1) >= DOS_CPU and (
            sys.platform != "linux" or cuotas_linux_suficientes(Path("/sys/fs/cgroup"), Path("/proc/self/cgroup"))
        )
    except (OSError, ValueError):
        return False


def _casos(suite: unittest.TestSuite) -> Iterator[unittest.TestCase]:
    """Recorre el descubrimiento canónico en el mismo orden que unittest.

    Yields:
        Cada caso producido por el descubridor.
    """
    for caso in suite:
        if isinstance(caso, unittest.TestSuite):
            yield from _casos(caso)
        else:
            yield caso


def agrupar(pruebas: unittest.TestSuite) -> dict[str, list[unittest.TestCase]]:
    """Agrupa el descubrimiento real por módulo para mantener juntas sus clases y sus preparativos.

    Returns:
        Los módulos y sus casos en el orden descubierto.
    """
    modulos: dict[str, list[unittest.TestCase]] = {}
    for caso in _casos(pruebas):
        modulos.setdefault(type(caso).__module__, []).append(caso)
    return modulos


def descubrir() -> unittest.TestSuite:
    """Usa el mismo descubrimiento que una instalación con un solo proceso.

    Returns:
        La suite completa, incluidos los errores de importación.
    """
    return unittest.TestLoader().discover(str(RAIZ / "plataforma_datos"), top_level_dir=str(RAIZ))


def _suite_ordinaria(suite: unittest.TestSuite) -> bool:
    """Conserva íntegra una suite con ejecución propia devuelta por load_tests.

    Returns:
        Si todos los contenedores son suites nativas de unittest.
    """
    return type(suite) is unittest.TestSuite and all(
        _suite_ordinaria(caso) for caso in suite if isinstance(caso, unittest.TestSuite)
    )


def firma_casos(modulos: dict[str, list[unittest.TestCase]]) -> str:
    """Identifica todos los métodos y su orden; incluye las posibles repeticiones de un descubridor.

    Returns:
        La huella de la lista de identificadores.
    """
    nombres = [caso.id() for casos in modulos.values() for caso in casos]
    return hashlib.sha256(json.dumps(nombres).encode()).hexdigest()


class ModuloConProgreso(unittest.TestSuite):
    """Publica el módulo antes de su primer fixture, incluso si la verificación vence dentro de él."""

    def __init__(self, nombre: str, casos: Iterable[unittest.TestCase]) -> None:
        super().__init__(casos)
        self.nombre = nombre

    @override
    def run(self, result: unittest.TestResult, debug: bool = False) -> unittest.TestResult:
        """Identifica el módulo incluso si se detiene en un fixture anterior al primer caso.

        Returns:
            El resultado del recorrido nativo de unittest.
        """
        if isinstance(result, ResultadoConEjecuciones):
            result.empieza_modulo(self.nombre)
        return super().run(result, debug)


@dataclass(frozen=True)
class Resumen:
    """Contadores de un proceso, sin transportar objetos de unittest ni sus excepciones."""

    casos: int
    correcto: bool
    aprobado: bool
    omitidos: int
    fallos: int
    errores: int
    esperados: int
    inesperados: int


def por_modulos(modulos: dict[str, list[unittest.TestCase]]) -> unittest.TestSuite:
    """Prepara el aviso de progreso que precede a cada módulo delegado.

    Returns:
        Una suite que contiene cada módulo entero en su orden de ejecución.
    """
    return unittest.TestSuite(ModuloConProgreso(nombre, casos) for nombre, casos in modulos.items())


def ejecutar(suite: unittest.TestSuite) -> Resumen:
    """Mantiene los fixtures, el diagnóstico de los fallos y el cómputo nativo de subcasos.

    Returns:
        Los contadores del lote y si hubo algún éxito efectivo.
    """
    r = unittest.TextTestRunner(verbosity=0, resultclass=ResultadoConEjecuciones).run(suite)
    return Resumen(
        r.testsRun,
        r.wasSuccessful(),
        r.hay_casos_aprobados,
        len(r.skipped),
        len(r.failures),
        len(r.errors),
        len(r.expectedFailures),
        len(r.unexpectedSuccesses),
    )


@contextmanager
def con_temporal(carpeta: Path) -> Iterator[None]:
    """Asigna a este proceso y a sus hijos un temporal físico propio y lo restaura antes de retirarlo.

    Yields:
        El intervalo durante el que se usa la carpeta.
    """
    anterior = tempfile.tempdir
    variable = os.environ.get("TMPDIR")
    tempfile.tempdir = os.environ["TMPDIR"] = str(carpeta.resolve(strict=True))
    try:
        yield
    finally:
        tempfile.tempdir = anterior
        if variable is None:
            os.environ.pop("TMPDIR", None)
        else:
            os.environ["TMPDIR"] = variable


def _cursos(modulos: dict[str, list[unittest.TestCase]]) -> dict[str, list[unittest.TestCase]]:
    return {nombre: casos for nombre, casos in modulos.items() if nombre.startswith(CURSOS)}


def ejecutar_cursos(hijo: Path, esperada: str) -> int:
    """Comprueba que el hijo ha descubierto exactamente el lote delegado antes de ejecutar su unittest.

    Returns:
        El estado de la ejecución del hijo. La admisión de omisiones se decide en el padre.
    """
    cursos = _cursos(agrupar(descubrir()))
    if firma_casos(cursos) != esperada:
        print("El descubrimiento de pruebas de Cursos cambió entre procesos", file=sys.stderr)
        return 1
    resumen = ejecutar(por_modulos(cursos))
    hijo.write_text(json.dumps(asdict(resumen)), encoding="utf-8")
    return 0 if resumen.correcto else 1


def dos_lotes(modulos: dict[str, list[unittest.TestCase]], cursos: dict[str, list[unittest.TestCase]]) -> list[Resumen]:
    """Empieza Cursos y el circuito largo de Orquestación juntos, con solo dos procesos de pruebas.

    Returns:
        Los resultados de ambos lotes una vez terminado el hijo.

    Raises:
        RuntimeError: El hijo terminó sin un resultado compatible con su código de salida.
    """
    resto = {nombre: casos for nombre, casos in modulos.items() if nombre not in cursos}
    if CIRCUITO in resto:
        resto = {CIRCUITO: resto[CIRCUITO], **resto}
    with tempfile.TemporaryDirectory(prefix="faro-pruebas-python-") as area:
        raiz = Path(area)
        padre, hijo = raiz / "general", raiz / "cursos"
        padre.mkdir()
        hijo.mkdir()
        recibo = raiz / "resultado-cursos.json"
        opciones = ["-B"] if sys.dont_write_bytecode else []
        orden = [
            sys.executable,
            *opciones,
            str(Path(__file__).resolve()),
            "--lote-cursos",
            str(recibo),
            firma_casos(cursos),
        ]
        n_cursos = sum(map(len, cursos.values()))
        n_general = sum(map(len, resto.values()))
        print(f"Python: 2 procesos, Cursos {n_cursos} casos y general {n_general} casos.", flush=True)
        with subprocess.Popen(orden, env={**os.environ, "TMPDIR": str(hijo)}) as proceso:
            try:
                with con_temporal(padre):
                    general = ejecutar(por_modulos(resto))
                codigo = proceso.wait()
            except BaseException:
                proceso.terminate()
                raise
        if not recibo.is_file():
            raise RuntimeError(f"El proceso de Cursos terminó con código {codigo} sin entregar su resultado")
        del_hijo = Resumen(**json.loads(recibo.read_text(encoding="utf-8")))
        if codigo != (0 if del_hijo.correcto else 1):
            raise RuntimeError(f"El proceso de Cursos terminó con código {codigo}, incompatible con su resultado")
        return [general, del_hijo]


def concluir(resultados: list[Resumen], segundos: float) -> int:
    """Combina fallos, omisiones y fallos esperados según las reglas de una sola suite.

    Returns:
        Cero al aprobar o uno si la suite falló o carece de un caso efectivo.
    """
    if len(resultados) > 1:
        total = sum(r.casos for r in resultados)
        print(
            f"Ran {total} tests in {segundos:.3f}s (Python, dos procesos); "
            f"omitidos={sum(r.omitidos for r in resultados)}, fallos={sum(r.fallos for r in resultados)}, "
            f"errores={sum(r.errores for r in resultados)}, fallos esperados={sum(r.esperados for r in resultados)}, "
            f"éxitos inesperados={sum(r.inesperados for r in resultados)}",
            file=sys.stderr,
        )
    if not any(r.aprobado for r in resultados):
        print("No hay pruebas Python ejecutadas sin omisión ni fallo esperado", file=sys.stderr)
        return 1
    return 0 if all(r.correcto for r in resultados) else 1


def principal(*, secuencial: bool = False, lote_cursos: list[str] | None = None) -> int:
    """Comprueba la plataforma completa, con un proceso en una CPU o en una instalación mínima.

    Returns:
        Cero si hay pruebas ejecutadas y la suite pasa; uno si falla o queda vacía.
    """
    sys.path.insert(0, str(RAIZ))
    preparar_guardia_red()
    with con_temporal(Path(tempfile.gettempdir())):
        if lote_cursos is not None:
            return ejecutar_cursos(Path(lote_cursos[0]), lote_cursos[1])
        inicio = time.monotonic()
        pruebas = descubrir()
        if not secuencial and admite_dos_procesos() and _suite_ordinaria(pruebas):
            modulos = agrupar(pruebas)
            cursos = _cursos(modulos)
            if len(cursos) > 1 and len(modulos) - len(cursos) > 1:
                anterior = signal.signal(signal.SIGTERM, _al_terminar)
                try:
                    return concluir(dos_lotes(modulos, cursos), time.monotonic() - inicio)
                except _CancelacionDelProceso:
                    return 128 + signal.SIGTERM
                finally:
                    signal.signal(signal.SIGTERM, anterior)
        print(f"Python: 1 proceso, {pruebas.countTestCases()} casos.", flush=True)
        return concluir([ejecutar(pruebas)], time.monotonic() - inicio)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    grupo = parser.add_mutually_exclusive_group()
    grupo.add_argument("--secuencial", action="store_true", help="Ejecuta todos los módulos en un solo proceso.")
    grupo.add_argument("--lote-cursos", nargs=2, help=argparse.SUPPRESS)
    args = parser.parse_args()
    sys.exit(principal(secuencial=args.secuencial, lote_cursos=args.lote_cursos))
