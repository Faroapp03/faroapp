"""Las descargas en paralelo se paran a tiempo, no dejan procesos huérfanos y no pierden lo que avisan.

Usa el mismo registro reducido de cinco fuentes que test_descargas_en_paralelo: formacion, citilab y fundae pueden
empezar en seguida; consorci y enlaces esperan a sus entradas.
"""

import io
import os
import signal
import sys
import tempfile
import threading
import time
import unittest
from collections.abc import Sequence
from contextlib import redirect_stdout
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from plataforma_datos.comun.turnos_entre_procesos import VARIABLE as CARPETA_DE_TURNOS
from plataforma_datos.comun.turnos_entre_procesos import TurnosEntreProcesos
from plataforma_datos.orquestacion import actualizar, descargas_en_paralelo, procesos
from plataforma_datos.orquestacion.ejecucion_observada import etapa_de_fuente
from plataforma_datos.orquestacion.pruebas.test_descargas_en_paralelo import NOMBRES, REGISTRO, Reproduccion

RAIZ = Path(__file__).resolve().parents[3]
PLAZO_S = 10
LISTAS_EN_SEGUIDA = 3  # formacion, citilab y fundae no esperan a ninguna entrada del registro reducido


def plan() -> descargas_en_paralelo.PlanDeDescargas:
    """El plan del registro reducido.

    Returns:
        Sus módulos con la construcción real de sus órdenes.
    """
    return descargas_en_paralelo.PlanDeDescargas(REGISTRO, actualizar.exigir_ordenes_del_modulo)


def descargadas(ordenes: Sequence[tuple[str, str]]) -> list[str]:
    """Las fuentes cuya descarga se ejecutó.

    Returns:
        Sus nombres, en el orden en que empezaron.
    """
    return [nombre for nombre, etapa in ordenes if etapa == "descargar"]


class Retenida:
    """Una descarga que no termina hasta que la prueba la suelta; las demás órdenes terminan en seguida."""

    def __init__(self) -> None:
        self.empezada, self.suelta = threading.Event(), threading.Event()
        self.ordenes: list[tuple[str, str]] = []

    def __call__(self, orden: Sequence[str], _area: Path) -> actualizar.Resultado:
        """Anota la orden; una descarga espera a que la suelten.

        Returns:
            Éxito.
        """
        identificada = etapa_de_fuente(orden)
        if identificada is not None:
            self.ordenes.append(identificada)
            if identificada[1] == "descargar":
                self.empezada.set()
                self.suelta.wait(PLAZO_S)
        return actualizar.Resultado(0, "")


class ProcesoReal:
    """Cada descarga es un proceso real que anota su pid y duerme: lo que haría una descarga lenta."""

    def __init__(self, carpeta: Path) -> None:
        self.carpeta = carpeta

    def __call__(self, orden: Sequence[str], area: Path) -> actualizar.Resultado:
        """Lanza el proceso con el mismo ejecutor acotado que el ciclo.

        Returns:
            Su código.
        """
        identificada = etapa_de_fuente(orden)
        nombre = identificada[0] if identificada else "otra"
        pid = self.carpeta / f"{nombre}.pid"
        codigo = f"import os, time\nopen({str(pid)!r}, 'w').write(str(os.getpid()))\ntime.sleep(60)\n"
        hecho = procesos.ejecutar_con_plazo([sys.executable, "-c", codigo], area, 120)
        return actualizar.Resultado(hecho.returncode, "")

    def pids(self) -> list[int]:
        """Los procesos que llegaron a empezar.

        Returns:
            Sus pid.
        """
        return [int(ruta.read_text()) for ruta in self.carpeta.glob("*.pid") if ruta.read_text()]


def vivo(pid: int) -> bool:
    """Si el proceso sigue existiendo.

    Returns:
        Verdadero mientras no haya terminado y sido recogido.
    """
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    return True


class FallaLaValidacionDeFormacion(Reproduccion):
    """Como la reproducción, pero la validación de formacion no pasa nunca."""

    def __call__(self, orden: Sequence[str], area: Path) -> actualizar.Resultado:
        """Ejecuta la etapa; la validación de formacion falla.

        Returns:
            Fallo en esa validación; lo de la reproducción en todo lo demás.
        """
        if etapa_de_fuente(orden) == ("formacion", "validar"):
            self.ordenes.append(("formacion", "validar"))  # la serie valida en su hilo
            return actualizar.Resultado(1, "no valida")
        return super().__call__(orden, area)


def raiz_y_area(base: Path) -> tuple[Path, Path]:
    """Una raíz con las carpetas publicadas del registro reducido y su área.

    Returns:
        La raíz y el área preparada.
    """
    raiz = base / "raiz"
    for modulo in REGISTRO:
        for carpeta in actualizar.carpetas(modulo):
            (raiz / carpeta).mkdir(parents=True)
            (raiz / carpeta / "dato.txt").write_bytes(b"vigente")
    area = base / "area"
    actualizar.preparar_area(raiz, area)
    return raiz, area


class AnotaElHilo(Reproduccion):
    """La reproducción, anotando en qué hilo corre cada descarga."""

    def __init__(self, fallan: frozenset[str] = frozenset()) -> None:
        super().__init__(fallan)
        self.hilos: dict[str, str] = {}

    def __call__(self, orden: Sequence[str], area: Path) -> actualizar.Resultado:
        """Anota el hilo de la descarga y la reproduce.

        Returns:
            Lo de la reproducción.
        """
        identificada = etapa_de_fuente(orden)
        if identificada is not None and identificada[1] == "descargar":
            self.hilos[identificada[0]] = threading.current_thread().name
        return super().__call__(orden, area)


class PruebaParadas(unittest.TestCase):
    """Parar, cancelar, construir el plan y avisar."""

    def setUp(self) -> None:
        """Una carpeta temporal propia."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.base = Path(temporal.name)

    def test_una_parada_con_descargas_esperando_plaza_no_empieza_ninguna_mas(self) -> None:
        """Una plaza y tres descargas listas: la serie se para con una en curso y las otras dos no empiezan.

        Raises:
            RuntimeError: La parada de la serie, que la prueba provoca y espera.
        """
        transporte = Retenida()
        opciones = actualizar.Opciones(pausa=0, en_paralelo=True)
        with (
            mock.patch.object(descargas_en_paralelo, "MAXIMO_SIMULTANEAS", 1),
            redirect_stdout(io.StringIO()),
            self.assertRaises(RuntimeError),
            descargas_en_paralelo.adelantar_descargas(plan(), self.base, transporte, opciones),
        ):
            self.assertTrue(transporte.empezada.wait(PLAZO_S))
            threading.Timer(0.3, transporte.suelta.set).start()  # la que corre termina después de la parada
            raise RuntimeError("la serie se detiene, como con la hora límite o una ronda interrumpida")
        self.assertEqual(len(descargadas(transporte.ordenes)), 1)

    def test_una_interrupcion_detiene_los_procesos_de_descarga_en_curso(self) -> None:
        """Ctrl-C con tres descargas de un minuto en procesos reales: sale en seguida y no queda ninguno vivo.

        Raises:
            KeyboardInterrupt: La interrupción, que la prueba provoca y espera.
        """
        transporte = ProcesoReal(self.base)
        opciones = actualizar.Opciones(pausa=0, en_paralelo=True)
        self.addCleanup(lambda: [os.kill(pid, signal.SIGKILL) for pid in transporte.pids() if vivo(pid)])
        with (
            redirect_stdout(io.StringIO()),
            self.assertRaises(KeyboardInterrupt),
            descargas_en_paralelo.adelantar_descargas(plan(), self.base, transporte, opciones),
        ):
            limite = time.monotonic() + PLAZO_S
            while len(transporte.pids()) < LISTAS_EN_SEGUIDA and time.monotonic() < limite:
                time.sleep(0.05)
            interrumpida = time.monotonic()
            raise KeyboardInterrupt
        self.assertLess(time.monotonic() - interrumpida, PLAZO_S)  # no espera a que acaben las descargas
        pids = transporte.pids()
        self.assertEqual(len(pids), LISTAS_EN_SEGUIDA)
        limite = time.monotonic() + 5
        while any(vivo(pid) for pid in pids) and time.monotonic() < limite:
            time.sleep(0.05)
        self.assertEqual([pid for pid in pids if vivo(pid)], [])

    def test_un_modulo_cuyas_ordenes_no_se_construyen_queda_entero_para_la_serie(self) -> None:
        """Si construir las órdenes de citilab falla por lo que sea, no se adelanta; las demás, sí."""

        def ordenes(modulo: object, sin_descargar: tuple[str, ...]) -> object:
            if getattr(modulo, "id", None) == "citilab":
                raise ValueError("defecto al construir sus órdenes")
            return actualizar.exigir_ordenes_del_modulo(modulo, sin_descargar)

        roto = descargas_en_paralelo.PlanDeDescargas(REGISTRO, ordenes)
        fuentes = [
            descarga.orden.fuente for descarga in descargas_en_paralelo.descargas_del_plan(roto, actualizar.Opciones())
        ]
        self.assertEqual(fuentes, [nombre for nombre in NOMBRES if nombre != "citilab"])

    def test_los_avisos_de_las_colas_van_a_la_salida_de_la_serie_aunque_alguien_la_redirija(self) -> None:
        """Mientras otra pieza redirige la salida, el aviso de la descarga adelantada llega a la de la serie."""
        descargas = descargas_en_paralelo.descargas_del_plan(plan(), actualizar.Opciones())[:1]
        de_la_serie, redirigida = io.StringIO(), io.StringIO()
        transporte = Retenida()
        transporte.suelta.set()
        with redirect_stdout(de_la_serie):
            adelantadas = descargas_en_paralelo.Adelantadas(descargas, transporte, self.base, 0)
        with redirect_stdout(redirigida):
            adelantadas.empezar([modulo.id for modulo in REGISTRO])
            adelantadas.ejecutar(descargas[0].orden.orden, self.base)
            adelantadas.parar()
        self.assertIn("formacion · descargar: descarga adelantada", de_la_serie.getvalue())
        self.assertNotIn("descarga adelantada", redirigida.getvalue())

    def test_con_una_entrada_en_rojo_la_descarga_se_descarta_como_en_serie(self) -> None:
        """Formacion sigue en rojo: consorci y enlaces no se ejecutan ni se descargan, en serie ni en paralelo."""
        vistas = {}
        for en_paralelo in (False, True):
            raiz = self.base / f"paralelo-{en_paralelo}" / "raiz"
            for modulo in REGISTRO:
                for carpeta in actualizar.carpetas(modulo):
                    (raiz / carpeta).mkdir(parents=True)
                    (raiz / carpeta / "dato.txt").write_bytes(b"vigente")
            area = raiz.parent / "area"
            actualizar.preparar_area(raiz, area)
            transporte = FallaLaValidacionDeFormacion()
            with (
                mock.patch.object(actualizar, "MODULOS", REGISTRO),
                mock.patch.object(actualizar, "leer_estado", lambda _raiz: {"formacion": {"veredicto": "rojo"}}),
                redirect_stdout(io.StringIO()),
            ):
                _pasos, resultados = actualizar.ejecutar_modulos(
                    raiz, area, transporte, actualizar.Opciones(pausa=0, reintento=0, en_paralelo=en_paralelo)
                )
            vistas[en_paralelo] = ({m: r.veredicto for m, r in resultados.items()}, sorted(set(transporte.ordenes)))
        self.assertEqual(vistas[True], vistas[False])
        self.assertEqual(vistas[True][0]["consorci"], actualizar.ROJO)
        self.assertNotIn(("consorci", "descargar"), vistas[True][1])
        self.assertNotIn(("enlaces", "descargar"), vistas[True][1])

    def test_la_pausa_de_una_fuente_en_serie_va_solo_antes_del_primer_intento(self) -> None:
        """Fundae en serie falla y se reintenta: la serie hace su pausa una vez, no antes del reintento."""
        raiz, area = raiz_y_area(self.base)
        pausas_de_la_serie: list[float] = []

        def dormir(segundos: float) -> None:
            if threading.current_thread() is threading.main_thread():
                pausas_de_la_serie.append(segundos)

        relojes = SimpleNamespace(sleep=dormir, time=time.time, monotonic=time.monotonic)
        opciones = actualizar.Opciones(pausa=5, reintento=0, en_paralelo=True, fuentes_en_serie=("fundae",))
        with (
            mock.patch.object(actualizar, "MODULOS", REGISTRO),
            mock.patch.object(descargas_en_paralelo, "time", relojes),
            redirect_stdout(io.StringIO()),
        ):
            actualizar.ejecutar_modulos(raiz, area, Reproduccion(frozenset({"fundae"})), opciones)
        self.assertEqual(pausas_de_la_serie, [5])

    def test_una_interrupcion_mientras_se_espera_a_las_colas_las_cancela(self) -> None:
        """Si Ctrl-C llega durante la espera final, las descargas en curso se cancelan en vez de abandonarse."""
        transporte = Retenida()
        transporte.suelta.set()
        original = descargas_en_paralelo.Adelantadas.parar
        llamadas: list[bool] = []

        def parar(adelantadas: descargas_en_paralelo.Adelantadas, *, cancelar: bool = False) -> None:
            llamadas.append(cancelar)
            original(adelantadas, cancelar=cancelar)
            if len(llamadas) == 1:
                raise KeyboardInterrupt

        opciones = actualizar.Opciones(pausa=0, en_paralelo=True)
        with (
            mock.patch.object(descargas_en_paralelo.Adelantadas, "parar", parar),
            redirect_stdout(io.StringIO()),
            self.assertRaises(KeyboardInterrupt),
            descargas_en_paralelo.adelantar_descargas(plan(), self.base, transporte, opciones),
        ):
            pass
        self.assertEqual(llamadas, [False, True])

    def test_si_quedan_hilos_tras_cancelar_se_avisa_y_no_se_admiten_procesos(self) -> None:
        """Una descarga que no termina dentro del plazo de espera deja el aviso y la cancelación puesta.

        Raises:
            KeyboardInterrupt: La interrupción, que la prueba provoca y espera.
        """
        transporte = Retenida()  # no se suelta hasta el final: su hilo sigue vivo tras la espera
        self.addCleanup(procesos.admitir_grupos)
        self.addCleanup(transporte.suelta.set)
        salida = io.StringIO()
        opciones = actualizar.Opciones(pausa=0, en_paralelo=True)
        with (
            mock.patch.object(descargas_en_paralelo, "ESPERA_AL_CANCELAR_S", 0.1),
            redirect_stdout(salida),
            self.assertRaises(KeyboardInterrupt),
            descargas_en_paralelo.adelantar_descargas(plan(), self.base, transporte, opciones),
        ):
            self.assertTrue(transporte.empezada.wait(PLAZO_S))
            raise KeyboardInterrupt
        self.assertIn("Quedan descargas sin terminar tras cancelarlas", salida.getvalue())
        tarde = procesos.ejecutar_con_plazo([sys.executable, "-c", "import time; time.sleep(30)"], self.base, 60)
        self.assertNotEqual(tarde.returncode, 0)

    def test_un_proceso_que_nace_tras_la_cancelacion_se_detiene_en_el_acto(self) -> None:
        """Tras detener los grupos vivos, uno que llega tarde no corre; tras admitirlos, todo vuelve a la normalidad."""
        procesos.detener_grupos_vivos()
        self.addCleanup(procesos.admitir_grupos)
        inicio = time.monotonic()
        tarde = procesos.ejecutar_con_plazo([sys.executable, "-c", "import time; time.sleep(30)"], self.base, 60)
        self.assertLess(time.monotonic() - inicio, PLAZO_S)
        self.assertNotEqual(tarde.returncode, 0)
        procesos.admitir_grupos()
        self.assertEqual(procesos.ejecutar_con_plazo([sys.executable, "-c", "pass"], self.base, 60).returncode, 0)

    def test_una_ficha_ilegible_deja_la_fuente_en_la_serie(self) -> None:
        """Si no se leen los servidores de citilab, su descarga la hace la serie y las demás siguen en sus colas."""
        raiz, area = raiz_y_area(self.base)
        leer = descargas_en_paralelo.servidores

        def servidores(fuente: str) -> frozenset[str]:
            if fuente == "citilab":
                raise ValueError("ficha ilegible")
            return leer(fuente)

        transporte = AnotaElHilo()
        with (
            mock.patch.object(actualizar, "MODULOS", REGISTRO),
            mock.patch.object(descargas_en_paralelo, "servidores", servidores),
            redirect_stdout(io.StringIO()),
        ):
            actualizar.ejecutar_modulos(raiz, area, transporte, actualizar.Opciones(pausa=0, en_paralelo=True))
        serie = threading.current_thread().name
        self.assertEqual(transporte.hilos["citilab"], serie)
        self.assertTrue(all(hilo != serie for fuente, hilo in transporte.hilos.items() if fuente != "citilab"))

    def test_un_hijo_lanzado_por_el_ciclo_toma_los_turnos_de_la_carpeta_comun(self) -> None:
        """Con la carpeta de turnos en el entorno, una consulta de red.PAUSAS en el hijo deja su turno en ella."""
        carpeta = self.base / "turnos"
        carpeta.mkdir()
        codigo = (
            "from plataforma_datos.comun import red\nwith red.PAUSAS.consulta('https://servidor.example/'):\n    pass\n"
        )
        with mock.patch.dict(os.environ, {CARPETA_DE_TURNOS: str(carpeta)}):
            resultado = actualizar.ejecutar_orden([sys.executable, "-c", codigo], RAIZ)
        self.assertEqual(resultado.codigo, 0, resultado.salida)
        self.assertTrue(TurnosEntreProcesos(carpeta).archivo("servidor.example").is_file())


if __name__ == "__main__":
    unittest.main()
