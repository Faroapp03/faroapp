"""La línea cerrada con que una orden del paquete dice, al fallar, en qué tramo y con qué error.

El supervisor no recoge la salida de los pasos: solo su código. Una orden del paquete que falla (`componer_catalogo`,
`exportar_paquete`, `publicar_globales`, con `ordenes.con_motivo(…, linea_de_fallo=True)`) termina su salida de errores
con una línea de forma fija, `fallo-paso tramo=… clase=… errno=… motivoAlmacen=…`, cuyos valores salen siempre de las
listas de este módulo. El informe del candidato conserva esa línea en el diagnóstico del paso; `causas_del_ciclo` la lee
con `leer`, que vuelve a validar cada valor y deja `otra` en el que no encaja, y la anota en `paquete retenido`. Así el
motivo llega al diario, a la consola y al resumen sin texto libre, rutas ni datos.

- `tramo`: el tramo de `componer` en que saltó el error (`tramo` lo marca al salir), o `-` fuera de un tramo.
- `clase`: la clase más concreta de la jerarquía del error que está en `CLASES`, u `otra`.
- `errno`: el nombre simbólico del `errno` de un `OSError` (`ENOSPC`, `EACCES`…); `-` si no es uno o no lo trae.
- `motivoAlmacen`: el código de `fallos_almacen.CODIGOS` del error que lo lleva; `-` si no lleva ninguno.

Python estándar; sin dependencias del motor, porque lo importan las órdenes y el diario.
"""

import errno
import re
from collections.abc import Iterator
from contextlib import contextmanager

from plataforma_datos.cursos.fallos_almacen import CODIGOS as MOTIVOS_DEL_ALMACEN

PREFIJO = "fallo-paso"
NINGUNO = "-"
OTRA = "otra"
# Las fuentes que `componer` aplica tras HP LIFE, en su orden; cada una tiene su tramo y el de sus pendientes.
FUENTES_DE_COMPONER = ("cibervoluntarios", "claude_academy", "fundae", "barcelonactiva")
# Los tramos de `componer`, en el orden en que corren.
TRAMOS = (
    "corte",
    "almacen-admitido",
    "fundae-retenido",
    "temporales",
    "hp_life",
    *(tramo for fuente in FUENTES_DE_COMPONER for tramo in (f"pendiente-{fuente}", fuente)),
    "fundae-ediciones",
    "reevaluacion",
    "candidata",
    "proyeccion",
    "entrega-preparar",
    "entrega-validar",
    "publicar",
    "sustituir",
    "limpieza",
)
# Las clases de error que se nombran en el diario. Las primeras son las de la generación no conservada.
CLASES_DE_ERROR = (
    "GeneracionInvalida",
    "HuellaIncorrecta",
    "FormatoInesperado",
    "ErrorFuente",
    "ActualizacionEnCurso",
    "FileNotFoundError",
    "PermissionError",
    "OSError",
    "ValueError",
    "KeyError",
    "TypeError",
)
# Las de un paso del paquete añaden las del almacén de Cursos, las de SQLite y las de un original dañado. Un error se
# nombra por la clase más concreta de su jerarquía que está aquí (`clase`); las de SQLite, con su módulo delante.
CLASES = (
    *CLASES_DE_ERROR,
    "AlmacenNoDisponible",
    "RecuperacionIncompleta",
    "sqlite3.OperationalError",
    "sqlite3.IntegrityError",
    "sqlite3.DatabaseError",
    "sqlite3.Error",
    "JSONDecodeError",
    "BadZipFile",
)
# Los nombres simbólicos de errno que conoce este sistema.
ERRNOS = tuple(sorted(set(errno.errorcode.values())))
_VALOR = r"(\S{1,64})"
LINEA = re.compile(rf"{PREFIJO} tramo={_VALOR} clase={_VALOR} errno={_VALOR} motivoAlmacen={_VALOR}")
_TRAMO_DEL_ERROR = "_faro_tramo_del_paso"


@contextmanager
def tramo(nombre: str) -> Iterator[None]:
    """Marca con su tramo el error que sale de él; si un tramo interior ya lo marcó, ese es el que vale.

    Yields:
        El cuerpo del tramo; su error sale igual, con la marca.

    Raises:
        ValueError: Si el tramo no es de `TRAMOS` (antes de ejecutar el cuerpo).
    """
    if nombre not in TRAMOS:
        raise ValueError(f"Tramo fuera de la lista: {nombre}")
    try:
        yield
    except Exception as error:
        if not hasattr(error, _TRAMO_DEL_ERROR):
            setattr(error, _TRAMO_DEL_ERROR, nombre)
        raise


def _nombre(tipo: type) -> str:
    return f"sqlite3.{tipo.__name__}" if tipo.__module__ == "sqlite3" else tipo.__name__


def clase(error: BaseException) -> str:
    """Nombra un error por la clase más concreta de su jerarquía que está en `CLASES`.

    Returns:
        El nombre de esa clase, u `OTRA` si ninguna está en la lista.
    """
    return next((_nombre(tipo) for tipo in type(error).__mro__ if _nombre(tipo) in CLASES), OTRA)


def linea(error: BaseException) -> str:
    """Compone la línea de fallo de un error, con valores de sus listas.

    Returns:
        `fallo-paso tramo=… clase=… errno=… motivoAlmacen=…`, sin salto de línea.
    """
    marcado = getattr(error, _TRAMO_DEL_ERROR, NINGUNO)
    numero = error.errno if isinstance(error, OSError) else None
    simbolo = NINGUNO if type(numero) is not int else errno.errorcode.get(numero, OTRA)
    codigo = getattr(error, "codigo", None)
    return (
        f"{PREFIJO} tramo={marcado if marcado in TRAMOS else NINGUNO} clase={clase(error)} errno={simbolo} "
        f"motivoAlmacen={codigo if codigo in MOTIVOS_DEL_ALMACEN else NINGUNO}"
    )


def _de_lista(valor: str, admitidos: tuple[str, ...]) -> str:
    return valor if valor in admitidos else OTRA


def leer(salida: str) -> dict[str, str] | None:
    """Lee la última línea de fallo de la salida de un paso y valida cada valor con su lista.

    La línea tiene que encajar entera con `LINEA`; un valor que no es de su lista se lee como `OTRA`, y uno ausente
    (`-`) no se anota, salvo la clase, que siempre la tiene. Ningún texto libre pasa.

    Returns:
        `tramo`, `clase`, `errno` y `motivoAlmacen` (los presentes), o None si la salida no trae una línea de fallo.
    """
    propias = [fila for fila in salida.splitlines() if fila.startswith(f"{PREFIJO} ")]
    encaje = LINEA.fullmatch(propias[-1].rstrip()) if propias else None
    if encaje is None:
        return None
    tramo_leido, clase_leida, errno_leido, motivo_leido = encaje.groups()
    leido = {
        "tramo": None if tramo_leido == NINGUNO else _de_lista(tramo_leido, TRAMOS),
        "clase": _de_lista(clase_leida, CLASES),
        "errno": None if errno_leido == NINGUNO else _de_lista(errno_leido, ERRNOS),
        "motivoAlmacen": None if motivo_leido == NINGUNO else _de_lista(motivo_leido, MOTIVOS_DEL_ALMACEN),
    }
    return {campo: valor for campo, valor in leido.items() if valor is not None}
