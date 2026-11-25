"""Turnos por servidor entre procesos: la pausa de cortesía se respeta aunque dos descargas corran a la vez.

Dentro de un proceso, `red.PausasPorDominio` ya separa dos consultas al mismo servidor. Cuando el ciclo descarga
varias fuentes a la vez, cada una corre en su propio proceso y esa memoria no se comparte. Esta pieza la lleva a disco:
cada servidor tiene un archivo en una carpeta común a los procesos del ciclo (la nombra la variable VARIABLE). Quien
consulta bloquea el archivo con `fcntl.flock`, lee la hora en que terminó la última consulta, espera lo que falte para
la pausa, consulta y, al soltarlo, escribe la hora de su fin. Así dos procesos nunca consultan el mismo servidor a la
vez y, entre el fin de una consulta y el principio de la siguiente, pasan al menos `pausa` segundos. Al tomar el turno
deja escrito EN_CURSO: si el proceso muere sin soltarlo (SIGKILL), el sistema suelta el cerrojo y el siguiente ve una
consulta sin fin, que cuenta como recién terminada: espera la pausa entera desde que la ve, por tarde que llegue.

La hora es la de `time.monotonic`, que en Linux y en macOS cuenta desde el arranque del sistema y es la misma para
todos los procesos de la máquina. Un archivo recién creado (vacío) es un servidor aún no consultado en el ciclo. Un
contenido que no se entiende, o una hora posterior a la actual, cuenta como una consulta que acaba de terminar: se
espera la pausa entera, nunca menos.
"""

import fcntl
import hashlib
import math
import os
import time
from collections.abc import Callable, Iterator, Mapping
from contextlib import contextmanager
from pathlib import Path

VARIABLE = "FARO_TURNOS_ENTRE_PROCESOS"
BYTES_DE_LA_HORA = 64  # una hora escrita con repr(float) cabe de sobra
EN_CURSO = b"en-curso"  # una toma sin fin anotado: su consulta pudo terminar en cualquier momento


class TurnosEntreProcesos:
    """Reparte el turno de cada servidor entre todos los procesos que comparten una carpeta.

    El reloj y la espera se inyectan para probar los turnos sin esperar de verdad; por omisión son `time.monotonic` y
    `time.sleep`.
    """

    def __init__(
        self,
        carpeta: Path,
        reloj: Callable[[], float] = time.monotonic,
        dormir: Callable[[float], None] = time.sleep,
    ) -> None:
        self.carpeta = carpeta
        self._reloj = reloj
        self._dormir = dormir

    def archivo(self, dominio: str) -> Path:
        """El archivo del turno de un servidor; el nombre es su huella, sin caracteres del dominio en la ruta.

        Returns:
            La ruta del archivo dentro de la carpeta común.
        """
        return self.carpeta / f"{hashlib.sha256(dominio.encode()).hexdigest()[:32]}.turno"

    @contextmanager
    def turno(self, dominio: str, pausa: float) -> Iterator[None]:
        """Espera el turno del servidor, lo conserva mientras dura la consulta y anota su fin al soltarlo.

        Yields:
            El turno; ningún otro proceso consulta ese servidor hasta salir.

        Raises:
            OSError: Si la carpeta común no existe o no se puede usar: la consulta no se hace sin su turno.
        """
        descriptor = os.open(self.archivo(dominio), os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX)
            espera = self._espera(os.pread(descriptor, BYTES_DE_LA_HORA, 0), pausa)
            if espera > 0:
                self._dormir(espera)
            self._anotar(descriptor, EN_CURSO)  # por si este proceso muere en la consulta, sin llegar a soltarlo
            try:
                yield
            finally:
                self._anotar(descriptor, repr(self._reloj()).encode())
        finally:
            os.close(descriptor)  # cerrar el descriptor suelta el cerrojo

    @staticmethod
    def _anotar(descriptor: int, contenido: bytes) -> None:
        # Primero se escribe y después se recorta: un corte entre las dos deja restos que no se entienden (pausa
        # entera), nunca un archivo vacío, que diría «servidor aún no consultado».
        os.pwrite(descriptor, contenido, 0)
        os.ftruncate(descriptor, len(contenido))

    def _espera(self, contenido: bytes, pausa: float) -> float:
        """Los segundos que faltan para la pausa desde la última consulta anotada.

        Returns:
            0 si el servidor aún no se consultó en el ciclo; la pausa entera si la consulta anterior no anotó su fin
            (EN_CURSO), si la hora no se entiende o si es futura.
        """
        if not contenido:
            return 0.0
        if contenido == EN_CURSO:
            return pausa
        try:
            anterior = float(contenido.decode("ascii"))
        except (UnicodeDecodeError, ValueError):
            return pausa
        ahora = self._reloj()
        if not math.isfinite(anterior) or anterior > ahora:
            return pausa
        return anterior + pausa - ahora


def turnos_del_entorno(entorno: Mapping[str, str] = os.environ) -> TurnosEntreProcesos | None:
    """Los turnos del ciclo si quien lanza el proceso le dio una carpeta común; si no, ninguno.

    Returns:
        Los turnos sobre la carpeta de VARIABLE, o None si no está definida (una sola descarga a la vez).
    """
    carpeta = entorno.get(VARIABLE)
    return TurnosEntreProcesos(Path(carpeta)) if carpeta else None
