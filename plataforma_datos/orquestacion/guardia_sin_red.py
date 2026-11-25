"""La guardia que impide salir a la red a una orden y a todos sus procesos hijos y nietos.

La impone el sistema operativo, no la buena voluntad del código que se ejecuta: así un paso que intentara descargar
algo falla en el acto, en vez de consultar una fuente real. La orden se envuelve en `sandbox-exec` (macOS) con un
perfil que niega toda conexión saliente salvo el bucle local, y también las conexiones a sockets unix por su ruta,
entre ellas la del resolvedor de nombres: ni siquiera se resuelve un dominio. En otro sistema el ensayo no se ejecuta,
porque sin esta guardia ya no sería un ensayo con datos grabados.

El bucle local hace falta: el humo de datos sirve la web con el servidor local del producto en 127.0.0.1
(`pruebas/web-publicacion/humo-de-datos.test.ts`). Ninguna conexión a un socket unix por ruta hace falta: las pruebas
de la guardia (Python, Node, `ps`, un servidor local y un proceso nieto) pasan sin ninguna.

Dentro del sandbox no se ejecuta un programa con setuid, y `ps` lo es: las comprobaciones que leen la tabla de
procesos (`scripts/detener-arbol.ts`) fallarían. `ps` no usa la red, así que se ejecuta fuera del sandbox.
"""

import errno
import shutil
import socket
import sys
from collections.abc import Callable, Sequence

# Manda la última regla que coincide: primero se niega toda salida, luego se admite solo el bucle local.
PERFIL = (
    "(version 1)"
    "(allow default)"
    "(deny network-outbound)"
    '(allow network-outbound (remote ip "localhost:*"))'
    '(allow process-exec (with no-sandbox) (literal "/bin/ps"))'
)
# Una dirección de documentación (RFC 5737): no se enruta, así que la sonda nunca llega a nadie.
SONDA = ("192.0.2.1", 443)
SEGUNDOS_DE_LA_SONDA = 2.0
MENSAJE_SIN_GUARDIA = (
    "El ensayo con datos grabados solo se ejecuta en macOS, bajo sandbox-exec: sin esa guardia podría salir a la red."
)


# Cómo se envuelve una orden en la guardia: `con_guardia`, salvo en las pruebas que solo miran la orden construida.
Guardia = Callable[[Sequence[str]], list[str]]


class SinGuardiaDeRed(RuntimeError):
    """El ensayo no puede asegurar que no sale a la red, así que no se ejecuta."""


def con_guardia(orden: Sequence[str], sistema: str = sys.platform) -> list[str]:
    """Envuelve una orden para que ni ella ni sus descendientes puedan salir de este equipo.

    Args:
        orden: La orden y sus argumentos.
        sistema: El sistema operativo, con los nombres de `sys.platform`.

    Returns:
        La orden envuelta en `sandbox-exec` con PERFIL.

    Raises:
        SinGuardiaDeRed: Si el sistema no es macOS o no tiene `sandbox-exec`.
    """
    if sistema != "darwin" or shutil.which("sandbox-exec") is None:
        raise SinGuardiaDeRed(MENSAJE_SIN_GUARDIA)
    return ["sandbox-exec", "-p", PERFIL, *orden]


def _conectar_a_la_sonda() -> None:
    with socket.create_connection(SONDA, timeout=SEGUNDOS_DE_LA_SONDA):
        pass


def exigir_sin_red(conectar: Callable[[], None] = _conectar_a_la_sonda) -> None:
    """Comprueba que este proceso está bajo la guardia: una conexión externa tiene que negarse en el acto.

    Args:
        conectar: El intento de conexión a una dirección que no se enruta.

    Raises:
        SinGuardiaDeRed: Si la conexión no la niega el sistema (llega a intentarse, o se agota su plazo).
    """
    try:
        conectar()
    except PermissionError:
        return
    except OSError as error:
        if error.errno in (errno.EPERM, errno.EACCES):
            return
    raise SinGuardiaDeRed("este proceso no está bajo la guardia de red: el ciclo del ensayo no empieza")
