"""Ejecución acotada de órdenes de mantenimiento en macOS y Linux."""

import codecs
import contextlib
import io
import os
import selectors
import signal
import subprocess
import sys
import time
from collections.abc import Mapping, Sequence
from pathlib import Path

# El mayor stdout contractual actual es el descriptor de artefacto (8 MiB + 4 KiB).
# La cota común conserva ese contrato y limita por separado cada canal normalizado a UTF-8.
MAX_SALIDA_BYTES = 16 * 1024 * 1024
BLOQUE_SALIDA_BYTES = 64 * 1024
AVISO_TRUNCADO = "[Salida truncada: se conserva el final del canal]\n"


class _ColaDeSalida:
    """Drena todo, conserva solo una cola UTF-8 acotada y señala el descarte sin alterar el código del hijo."""

    def __init__(self) -> None:
        self.datos = bytearray()
        self.decodificador = io.IncrementalNewlineDecoder(
            codecs.getincrementaldecoder("utf-8")("replace"), translate=True
        )
        self.truncada = False

    def incorporar(self, contenido: bytes, *, final: bool = False) -> None:
        """Normaliza por fragmentos; un carácter UTF-8 partido entre lecturas no se pierde."""
        self.datos.extend(self.decodificador.decode(contenido, final=final).encode())
        if len(self.datos) > MAX_SALIDA_BYTES:
            del self.datos[:-MAX_SALIDA_BYTES]
            self.truncada = True

    def texto(self) -> str:
        """Devuelve la cola y el aviso dentro de la misma cota, sin cortar un carácter UTF-8.

        Returns:
            Texto completo si cabe; de lo contrario, aviso y final del canal.
        """
        if not self.truncada:
            return self.datos.decode()
        capacidad = MAX_SALIDA_BYTES - len(AVISO_TRUNCADO.encode())
        return AVISO_TRUNCADO + self.datos[-capacidad:].decode(errors="ignore")


def _drenar(proceso: subprocess.Popen[bytes], orden: Sequence[str], plazo: float) -> tuple[str, str]:
    """Consume ambos canales simultáneamente hasta EOF y espera al hijo dentro del mismo plazo.

    Returns:
        Las dos colas acotadas, incluso cuando el proceso acaba con código no cero.

    Raises:
        TimeoutExpired: Si el hijo o un descendiente mantienen abiertos los canales más allá del plazo.
        RuntimeError: Si Popen no creó las dos tuberías solicitadas.
    """
    limite = time.monotonic() + plazo
    salida, errores = _ColaDeSalida(), _ColaDeSalida()
    try:
        with selectors.DefaultSelector() as selector:
            colas = {}
            for canal, cola in ((proceso.stdout, salida), (proceso.stderr, errores)):
                if canal is None:
                    raise RuntimeError("el proceso no tiene las tuberías solicitadas")
                descriptor = canal.fileno()
                os.set_blocking(descriptor, False)
                colas[descriptor] = cola
                selector.register(descriptor, selectors.EVENT_READ)
            while selector.get_map():
                restante = limite - time.monotonic()
                if restante <= 0:
                    raise subprocess.TimeoutExpired(orden, plazo)
                for clave, _evento in selector.select(restante):
                    try:
                        bloque = os.read(clave.fd, BLOQUE_SALIDA_BYTES)
                    except BlockingIOError:
                        continue
                    colas[clave.fd].incorporar(bloque, final=not bloque)
                    if not bloque:
                        selector.unregister(clave.fd)
            proceso.wait(timeout=max(0, limite - time.monotonic()))
    except subprocess.TimeoutExpired as error:
        raise subprocess.TimeoutExpired(orden, plazo, output=salida.texto(), stderr=errores.texto()) from error
    return salida.texto(), errores.texto()


def bibliotecas_de_python() -> dict[str, str]:
    """Devuelve solo la biblioteca del Python base en Linux, sin heredar rutas del ambiente.

    Returns:
        LD_LIBRARY_PATH de la instalación del intérprete, o un diccionario vacío en otros sistemas.
    """
    return {"LD_LIBRARY_PATH": str(Path(sys.base_prefix) / "lib")} if sys.platform == "linux" else {}


def ejecutar_con_plazo(
    orden: Sequence[str],
    cwd: Path,
    plazo: float,
    entorno: Mapping[str, str] | None = None,
) -> subprocess.CompletedProcess[str]:
    """Ejecuta sin shell y cierra su grupo de procesos al terminar o superar el plazo.

    Un descendiente que cree una sesión nueva queda fuera del grupo. La salida usa UTF-8 con sustitución
    de bytes inválidos. Ambos canales se drenan aun después de alcanzar MAX_SALIDA_BYTES (por canal, UTF-8),
    conservando su cola y un aviso dentro de la misma cota. No hay spool en disco ni retención destructiva.
    El llamador decide cómo tratar un código de salida distinto de cero.

    Args:
        orden: Programa y argumentos separados.
        cwd: Directorio propio de la operación.
        plazo: Tiempo máximo de espera en segundos.
        entorno: Variables del hijo; None conserva las del proceso que llama.

    Returns:
        Código de salida y textos de stdout y stderr.

    Raises:
        OSError: Si no se puede iniciar o detener el proceso.
        TimeoutExpired: Si se agota el plazo; su grupo ya se ha detenido.
    """
    with subprocess.Popen(
        orden,
        cwd=cwd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=entorno,
        start_new_session=True,
    ) as proceso:
        try:
            salida, errores = _drenar(proceso, orden, plazo)
        finally:
            # Nunca se buscan procesos por nombre: este grupo pertenece al Popen anterior.
            with contextlib.suppress(ProcessLookupError):
                os.killpg(proceso.pid, signal.SIGKILL)
        return subprocess.CompletedProcess(orden, proceso.returncode, salida, errores)
