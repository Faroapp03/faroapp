"""Descargas en paralelo, una cola por servidor, mientras la serie prepara, valida y publica en el orden del registro.

Casi todo el tiempo de las fuentes es esperar a servidores distintos. Esta pieza adelanta solo la etapa `descargar` de
las fuentes con red; preparar, validar y publicar siguen en la serie de siempre (actualizar.ejecutar_modulos), módulo a
módulo y en el orden del registro, así que los diarios, el estado y lo publicado tienen la misma forma.

- Cuándo empieza una descarga: cuando la serie ya ha resuelto todas las entradas de su módulo (`Modulo.entradas`, las
  dependencias de su fuente.json). Es la misma condición con que la serie decide si lo ejecuta: si una entrada quedó
  incompatible, la serie no lo ejecuta y la descarga no se hace. Las dos descargas que leen datos de otra fuente lo
  hacen de una entrada declarada: enlaces lee el validado de consorci y el paquete de formacion
  (cursos/fuentes/enlaces/lector.py, `_candidatos`), y acreditacion lee el original del SOC de formacion
  (cursos/fuentes/acreditacion/lector.py, `_certificados_del_soc`). Las de catálogo leen el almacén de Cursos, que en
  esta fase nadie escribe: lo revalida el ciclo antes de copiar el área y lo compone el paquete después.
- Colas: las fuentes que comparten un servidor declarado en su ficha (los recursos con dirección web) van en la misma
  cola, en el orden del registro, así que ese servidor recibe las mismas consultas en el mismo orden que en serie. Una
  fuente sin servidor declarado tiene cola propia. Cuando dos colas tocan el mismo servidor sin declararlo, los turnos
  entre procesos (comun/turnos_entre_procesos.py) mantienen su pausa, porque la carpeta de turnos llega a cada proceso.
  Como mucho corren MAXIMO_SIMULTANEAS descargas a la vez.
- La serie, al llegar a la descarga de un módulo, espera su resultado y sigue como siempre. El reintento de una
  descarga que falla lo hace la serie, igual que hoy. Si la descarga lanzó una excepción, la serie la recibe tal cual.
- En serie (`en_paralelo` falso, el modo por omisión), nada de esto existe: la serie recibe su mismo ejecutor y sus
  mismas opciones. En paralelo, las fuentes de `fuentes_en_serie` no se adelantan: las descarga la serie al llegar a
  ellas, con su pausa, como siempre (por ejemplo, una fuente que aún no conserva evidencia de lo que descarga).

Si la serie se detiene antes de llegar a un módulo (el plazo del motor, una ronda interrumpida), no empieza ninguna
descarga más; la que ya corría termina y su fuente queda en el registro de comprobaciones sin admitir, y el cierre del
ciclo la anota como interrumpida.
"""

import os
import sys
import tempfile
import threading
import time
from collections.abc import Callable, Iterator, Mapping, Sequence
from contextlib import contextmanager
from pathlib import Path
from typing import NamedTuple, Protocol, Self
from urllib.parse import urlsplit

from plataforma_datos.comun.turnos_entre_procesos import VARIABLE as CARPETA_DE_TURNOS
from plataforma_datos.contratos.fuentes import cargar_fuente
from plataforma_datos.orquestacion.hora_limite_del_motor import NECESARIO_S, segundos_hasta_la_hora_limite
from plataforma_datos.orquestacion.modulos import Modulo
from plataforma_datos.orquestacion.ordenes_de_la_actualizacion import Orden
from plataforma_datos.orquestacion.piezas_de_la_actualizacion import ETAPA_DE_DESCARGA, FUENTES
from plataforma_datos.orquestacion.procesos import admitir_grupos, detener_grupos_vivos
from plataforma_datos.orquestacion.reconstruir import FUENTES_EN_ORDEN

# Procesos de descarga a la vez. Es un límite de prudencia, sin medida de memoria detrás: cada descarga es un proceso
# de Python que casi siempre espera a la red. Con las duraciones de los ciclos 44984285818 y 45093060752, el camino
# crítico calculado es el mismo con este límite que sin él (42,9 y 42,8 minutos el 22/11).
MAXIMO_SIMULTANEAS = 6
ESPERA_AL_CANCELAR_S = 30  # lo que se espera a cada hilo tras detener sus procesos por una interrupción


class OpcionesDeLaRonda(Protocol):
    """Lo que esta pieza lee de las opciones de la actualización (actualizar.Opciones)."""

    @property
    def en_paralelo(self) -> bool:
        """Si las descargas se adelantan; falso es la serie de siempre."""

    @property
    def pausa(self) -> float:
        """Segundos antes de cada fuente con red."""

    @property
    def solo(self) -> tuple[str, ...] | None:
        """La selección inicial de módulos, o None para todos."""

    @property
    def sin_descargar(self) -> tuple[str, ...]:
        """Las fuentes que esta vez no se descargan."""

    @property
    def fuentes_en_serie(self) -> tuple[str, ...]:
        """Las fuentes que, aun en paralelo, descarga la serie al llegar a ellas, como siempre."""

    def _replace(self, **cambios: float) -> Self:
        """Las mismas opciones con los cambios indicados (el de una NamedTuple)."""


class ModoDeLasFuentes(NamedTuple):
    """Cómo se descargan las fuentes de un ciclo: en serie, o en paralelo salvo las que se quedan en serie."""

    en_paralelo: bool = False
    en_serie: tuple[str, ...] = ()


TODAS_EN_SERIE = ModoDeLasFuentes()  # el modo por omisión


class PlanDeDescargas(NamedTuple):
    """Los módulos de la ronda y cómo construye y comprueba la actualización las órdenes de cada uno."""

    modulos: tuple[Modulo, ...]
    ordenes_del_modulo: Callable[[Modulo, tuple[str, ...]], Mapping[str, Sequence[Orden]]]


class Descarga(NamedTuple):
    """La descarga de una fuente con red, con el módulo que la publica."""

    modulo: Modulo
    orden: Orden


class _Excepcion(NamedTuple):
    """La excepción de una descarga adelantada, que la serie recibe como si la hubiera ejecutado ella."""

    error: Exception


_DESCARTADA = object()  # no se hizo: la serie no la pedirá o la ejecutará ella misma


def descargas_del_plan(plan: PlanDeDescargas, opciones: OpcionesDeLaRonda) -> list[Descarga]:
    """Las descargas con red que la serie hará en esta ronda, en el orden del registro.

    Returns:
        Una por fuente con red de los módulos seleccionados que se descarga esta vez y cuyas órdenes se construyen.
    """
    descargas = []
    for modulo in plan.modulos:
        if opciones.solo is not None and modulo.id not in opciones.solo:
            continue  # fuera de la selección, la serie solo lo recompone sin descargar
        try:
            por_fuente = plan.ordenes_del_modulo(modulo, opciones.sin_descargar)
        except Exception:
            # No se oculta: el módulo queda entero para la serie, que vuelve a construir sus órdenes y diagnostica el
            # error en rojo como siempre.
            continue
        for fuente, ordenes in por_fuente.items():
            if ordenes and ordenes[0].etapa == ETAPA_DE_DESCARGA and FUENTES[fuente].red:
                descargas.append(Descarga(modulo, ordenes[0]))
    return descargas


def servidores(fuente: str) -> frozenset[str]:
    """Los servidores que declara la ficha de una fuente en sus recursos con dirección web.

    Returns:
        Sus nombres de servidor, en minúsculas; vacío si la ficha no declara ninguno.
    """
    tema = dict(FUENTES_EN_ORDEN)[fuente].__name__.split(".")[1]
    direcciones = (recurso.ubicacion or "" for recurso in cargar_fuente(fuente, tema=tema).recursos)
    return frozenset(
        nombre.lower()
        for direccion in direcciones
        if direccion.startswith(("https://", "http://")) and (nombre := urlsplit(direccion).hostname)
    )


def colas(
    descargas: Sequence[Descarga], servidores_de: Callable[[str], frozenset[str]] = servidores
) -> list[list[Descarga]]:
    """Agrupa en una misma cola las descargas que comparten algún servidor, conservando el orden del registro.

    Returns:
        Las colas, cada una con sus descargas en el orden en que llegan.
    """
    grupos: list[tuple[set[str], list[Descarga]]] = []
    for descarga in descargas:
        propios = set(servidores_de(descarga.orden.fuente)) or {f"fuente:{descarga.orden.fuente}"}
        unidos = [grupo for grupo in grupos if grupo[0] & propios]
        servidores_unidos = propios.union(*(grupo[0] for grupo in unidos))
        juntas = sorted((d for grupo in unidos for d in grupo[1]), key=descargas.index)
        grupos = [grupo for grupo in grupos if grupo not in unidos] + [(servidores_unidos, [*juntas, descarga])]
    return sorted((grupo[1] for grupo in grupos), key=lambda cola: descargas.index(cola[0]))


def queda_tiempo_para_empezar(entorno: Mapping[str, str] = os.environ) -> bool:
    """Si una descarga adelantada puede empezar sin dejar el paquete sin hacer; no anota nada.

    La parada del motor la anota la serie (hora_limite_del_motor.queda_tiempo), con el paso que de verdad no empezó.

    Returns:
        Verdadero si no hay hora límite o si lo que queda cubre lo necesario para el paquete.
    """
    quedan = segundos_hasta_la_hora_limite(entorno)
    return quedan is None or quedan >= NECESARIO_S


class Adelantadas[R]:
    """Las colas de descarga de una ronda y el ejecutor con que la serie recoge sus resultados."""

    def __init__(
        self, descargas: Sequence[Descarga], ejecutor: Callable[[Sequence[str], Path], R], area: Path, pausa: float
    ) -> None:
        self._ejecutor, self._area, self._pausa = ejecutor, area, pausa
        self._en_serie: frozenset[tuple[str, ...]] = frozenset()  # descargas con red que hace la serie
        self._pausadas: set[tuple[str, ...]] = (
            set()
        )  # las de la serie que ya hicieron su pausa (no antes del reintento)
        self._registro: frozenset[str] = frozenset()  # los módulos de la ronda; una entrada de fuera no se espera
        self._colas = colas(descargas)
        self._pendientes = {tuple(descarga.orden.orden): descarga for descarga in descargas}
        self._hechas: dict[tuple[str, ...], object] = {}
        self._anotadas: set[tuple[str, ...]] = set()
        self._condicion = threading.Condition()
        self._simultaneas = threading.BoundedSemaphore(MAXIMO_SIMULTANEAS)
        self._resueltos: frozenset[str] = frozenset()
        self._incompatibles: frozenset[str] = frozenset()
        self._parar = False
        # Los avisos van a la salida que tenía la serie al empezar: otra pieza que la redirija un momento (como
        # ordenes.motivo_de_rechazo) no se los lleva.
        self._salida = sys.stdout
        self._cerrojo_de_salida = threading.Lock()
        self._hilos = [threading.Thread(target=self._atender, args=(cola,), daemon=True) for cola in self._colas]

    def empezar(self, registro: Sequence[str], en_serie: Sequence[Descarga] = ()) -> None:
        """Pone en marcha un hilo por cola, sabiendo qué módulos recorrerá la serie y qué descargas hará ella."""
        self._registro = frozenset(registro)
        self._en_serie = frozenset(tuple(descarga.orden.orden) for descarga in en_serie)
        for hilo in self._hilos:
            hilo.start()

    def llega(self, modulos_anteriores: Sequence[str], incompatibles: set[str]) -> None:
        """La serie ha resuelto estos módulos; las descargas que solo dependían de ellos ya pueden decidirse."""
        with self._condicion:
            self._resueltos = frozenset(modulos_anteriores)
            self._incompatibles = frozenset(incompatibles)
            self._condicion.notify_all()

    def ejecutar(self, orden: Sequence[str], area: Path) -> R:
        """El ejecutor de la serie: una descarga adelantada se espera; cualquier otra orden se ejecuta como siempre.

        Returns:
            El resultado de la orden.

        Raises:
            Exception: La misma que lanzó la descarga adelantada.
        """
        clave = tuple(orden)
        with self._condicion:
            adelantada = self._pendientes.pop(clave, None) is not None
            if adelantada:
                self._condicion.wait_for(lambda: clave in self._hechas)
                hecha = self._hechas.pop(clave)
        if not adelantada or hecha is _DESCARTADA:
            if clave in self._en_serie and clave not in self._pausadas:
                # Una fuente que se queda en serie conserva su pausa antes de la descarga, como siempre: solo antes del
                # primer intento; el reintento ya espera lo suyo (ejecutar_pasos).
                self._pausadas.add(clave)
                time.sleep(self._pausa)
            return self._ejecutor(orden, area)
        if isinstance(hecha, _Excepcion):
            raise hecha.error
        return hecha

    def parar(self, *, cancelar: bool = False) -> None:
        """No empieza ninguna descarga más y espera a que terminen las que corren.

        Con `cancelar` (una interrupción), además detiene los procesos que corren y espera a cada hilo un plazo.
        """
        with self._condicion:
            self._parar = True
            self._condicion.notify_all()
        if cancelar:
            detener_grupos_vivos()
        for hilo in self._hilos:
            if hilo.is_alive():
                hilo.join(ESPERA_AL_CANCELAR_S if cancelar else None)
        if cancelar and not any(hilo.is_alive() for hilo in self._hilos):
            admitir_grupos()  # ya no queda ningún hilo que pueda lanzar un proceso de esta ronda
        elif cancelar:
            self._avisar(
                "Quedan descargas sin terminar tras cancelarlas: este proceso no admite procesos nuevos hasta salir."
            )

    def _decidible(self, modulo: Modulo) -> bool:
        pendientes = set(modulo.entradas) & self._registro - self._resueltos
        return self._parar or not pendientes

    def _atender(self, cola: Sequence[Descarga]) -> None:
        """Descarga la cola en orden; lo que no llega a hacerse queda descartado para que la serie no espere."""
        try:
            for descarga in cola:
                with self._condicion:
                    self._condicion.wait_for(lambda descarga=descarga: self._decidible(descarga.modulo))
                    if self._parar:
                        return
                    if any(entrada in self._incompatibles for entrada in descarga.modulo.entradas):
                        self._anotar(descarga, _DESCARTADA)
                        continue
                if not queda_tiempo_para_empezar():
                    return
                self._anotar(descarga, self._descargar(descarga))
        finally:
            for descarga in cola:
                self._anotar(descarga, _DESCARTADA, si_falta=True)

    def _descargar(self, descarga: Descarga) -> object:
        time.sleep(self._pausa)  # la misma pausa antes de cada fuente con red que en serie, ahora por cola
        with self._simultaneas:
            # La plaza puede llegar cuando la serie ya se ha parado o ya no queda tiempo: entonces no se empieza.
            with self._condicion:
                if self._parar or not queda_tiempo_para_empezar():
                    return _DESCARTADA
            self._avisar(f"   {descarga.orden.nombre}: descarga adelantada")
            try:
                return self._ejecutor(descarga.orden.orden, self._area)
            except Exception as error:
                return _Excepcion(error)  # no se pierde: la serie la vuelve a lanzar al recogerla

    def _avisar(self, texto: str) -> None:
        with self._cerrojo_de_salida:
            print(texto, file=self._salida, flush=True)

    def _anotar(self, descarga: Descarga, hecha: object, *, si_falta: bool = False) -> None:
        clave = tuple(descarga.orden.orden)
        with self._condicion:
            if not si_falta or clave not in self._anotadas:
                self._hechas[clave] = hecha
                self._anotadas.add(clave)
            self._condicion.notify_all()


class Ronda[R, O: OpcionesDeLaRonda](NamedTuple):
    """Lo que usa la serie: su ejecutor, sus opciones y el aviso de cada módulo al que llega."""

    ejecutar: Callable[[Sequence[str], Path], R]
    opciones: O
    llega: Callable[[str, set[str]], None]


@contextmanager
def adelantar_descargas[R, O: OpcionesDeLaRonda](
    plan: PlanDeDescargas, area: Path, ejecutor: Callable[[Sequence[str], Path], R], opciones: O
) -> Iterator[Ronda[R, O]]:
    """Pone en marcha las colas de descarga de la ronda, si se pide en paralelo, y las cierra al terminar.

    En paralelo, la serie recibe opciones sin la pausa entre fuentes (la hace cada cola) y los procesos reciben una
    carpeta de turnos común. En serie, recibe su mismo ejecutor y sus mismas opciones, y su aviso no hace nada.

    Yields:
        El ejecutor, las opciones y el aviso con que la serie recorre los módulos.
    """
    if not opciones.en_paralelo:
        yield Ronda(ejecutor, opciones, lambda _modulo, _incompatibles: None)
        return
    descargas = descargas_del_plan(plan, opciones)
    en_serie = [
        descarga
        for descarga in descargas
        if descarga.orden.fuente in opciones.fuentes_en_serie or not _servidores_legibles(descarga.orden.fuente)
    ]
    orden_de_modulos = [modulo.id for modulo in plan.modulos]
    adelantadas = Adelantadas([d for d in descargas if d not in en_serie], ejecutor, area, opciones.pausa)

    def llega(modulo: str, incompatibles: set[str]) -> None:
        adelantadas.llega(orden_de_modulos[: orden_de_modulos.index(modulo)], incompatibles)

    with _carpeta_de_turnos():
        adelantadas.empezar(orden_de_modulos, en_serie)
        try:
            yield Ronda(adelantadas.ejecutar, opciones._replace(pausa=0.0), llega)
        except Exception:
            _parar_o_cancelar(adelantadas)
            raise
        except BaseException:
            adelantadas.parar(cancelar=True)  # Ctrl-C o salida del proceso: no quedan descargas huérfanas
            raise
        _parar_o_cancelar(adelantadas)


def _parar_o_cancelar(adelantadas: Adelantadas) -> None:
    """Para esperando a las descargas en curso; si mientras se espera llega una interrupción, las cancela."""
    try:
        adelantadas.parar()
    except BaseException:
        adelantadas.parar(cancelar=True)
        raise


def _servidores_legibles(fuente: str) -> bool:
    """Si se pueden leer los servidores de la ficha de la fuente; si no, la fuente no se adelanta.

    Returns:
        Verdadero si su ficha se lee; falso si no, y entonces la descarga la serie como siempre.
    """
    try:
        servidores(fuente)
    except Exception:
        # No se oculta: la descarga sigue, en la serie, y la ficha la comprueba su propia guardia del registro.
        return False
    return True


@contextmanager
def _carpeta_de_turnos() -> Iterator[Path]:
    """Una carpeta de turnos común para los procesos de la ronda, que heredan por su entorno.

    Yields:
        La carpeta, que se retira al terminar junto con la variable.
    """
    anterior = os.environ.get(CARPETA_DE_TURNOS)
    with tempfile.TemporaryDirectory(prefix="faro-turnos-") as carpeta:
        os.environ[CARPETA_DE_TURNOS] = carpeta
        try:
            yield Path(carpeta)
        finally:
            if anterior is None:
                os.environ.pop(CARPETA_DE_TURNOS, None)
            else:
                os.environ[CARPETA_DE_TURNOS] = anterior
