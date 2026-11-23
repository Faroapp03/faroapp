"""Almacén de las lecturas de cada fuente: un archivo inmutable por lectura, junto a lo validado de la fuente.

Cada lectura se guarda en `var/actualizacion/validados/<fuente>/lecturas/<lectura_id>.json`, en JSON canónico. Esa
carpeta viaja con la generación que el ciclo archiva y recupera, así que el registro no depende de volver a leer los
originales. Guardar dos veces la misma lectura no cambia nada; guardar otra con el mismo identificador y otro
veredicto es un error, porque lo observado ya tiene el suyo. Un solo ciclo escribe a la vez, bajo su cerrojo.
En la misma carpeta viven las aceptaciones (`aceptacion-<id>.json`, módulo `aceptaciones`), que no son lecturas.
No consulta la red ni el reloj: la hora de cada lectura llega dentro de la lectura.
"""

import re
from pathlib import Path

from plataforma_datos.comun.entrada_salida import escribir_bytes_entero
from plataforma_datos.comun.nucleo import DATOS_RELATIVOS
from plataforma_datos.cursos.lecturas.contrato_lectura import (
    MAX_BYTES,
    ErrorLectura,
    Lectura,
    bytes_de,
    exigir,
    exigir_fuente,
    leer_lectura,
)
from plataforma_datos.cursos.tipos_json import ObjetoJson

CARPETA = "lecturas"
NOMBRE = re.compile(r"(?P<lectura_id>[0-9a-f]{64})\.json")
PREFIJO_DE_ACEPTACION = "aceptacion-"
NOMBRE_DE_ACEPTACION = re.compile(rf"{PREFIJO_DE_ACEPTACION}(?P<aceptacion_id>[0-9a-f]{{64}})\.json")
# El temporal que deja una escritura cortada en seco (`escribir_bytes_entero`): no es una lectura y no se lista.
TEMPORAL = re.compile(rf"\.(?:{PREFIJO_DE_ACEPTACION})?[0-9a-f]{{64}}\.json\.[a-z0-9_]+\.parcial")


def carpeta_de_lecturas(raiz: Path, fuente: str) -> Path:
    """La carpeta de las lecturas de una fuente dentro de una instalación.

    Returns:
        `var/actualizacion/validados/<fuente>/lecturas` bajo `raiz`.
    """
    exigir_fuente(fuente)
    return raiz / DATOS_RELATIVOS / "validados" / fuente / CARPETA


def bytes_guardados(ruta: Path) -> bytes:
    """Lee un archivo del almacén con sus límites: propio (no un enlace) y de tamaño acotado.

    Returns:
        Sus bytes.

    Raises:
        ErrorLectura: Si no es un archivo propio o es demasiado grande.
    """
    exigir(not ruta.is_symlink() and ruta.is_file(), f"{ruta.name} no es un archivo propio")
    exigir(ruta.stat().st_size <= MAX_BYTES, f"{ruta.name} es demasiado grande")
    return ruta.read_bytes()


def guardar_inmutable(destino: Path, contenido: bytes, que: str) -> Path:
    """Escribe un archivo del almacén una sola vez; si ya existe, debe tener exactamente esos bytes.

    `que` nombra lo que se guarda («lectura», «aceptación») en el mensaje de error.

    Returns:
        La ruta del archivo.

    Raises:
        ErrorLectura: Si ya hay otro contenido con el mismo nombre.
    """
    if destino.exists() or destino.is_symlink():
        exigir(
            bytes_guardados(destino) == contenido,
            f"ya hay otra {que} {destino.stem} con otro contenido; una {que} guardada no cambia",
        )
        return destino
    destino.parent.mkdir(parents=True, exist_ok=True)
    escribir_bytes_entero(destino, contenido)
    return destino


def _guardar_json(raiz: Path, dato: ObjetoJson) -> Path:
    destino = carpeta_de_lecturas(raiz, dato["fuente"]) / f"{dato['lectura_id']}.json"
    return guardar_inmutable(destino, bytes_de(dato), "lectura")


def guardar_lectura(raiz: Path, lectura: Lectura) -> Path:
    """Guarda una lectura en el almacén de su fuente; si ya está guardada igual, no hace nada.

    Returns:
        La ruta del archivo de la lectura.

    Raises:
        ErrorLectura: Si ya hay otra lectura con el mismo identificador y otro contenido.
    """
    return _guardar_json(raiz, lectura.a_json())


def copiar_lecturas(origen: Path, destino: Path, fuente: str) -> list[str]:
    """Añade al almacén de `destino` las lecturas legibles de una fuente que tiene `origen` y él aún no.

    Sirve para que las lecturas de un ciclo sobrevivan aunque su área vuelva a lo publicado: como solo se añaden y
    nunca cambian, copiarlas no puede alterar ninguna lectura ya guardada. Un archivo que no es una lectura válida, o
    que choca con otra ya guardada, no se copia: se devuelve con su motivo para que quede dicho, y las demás siguen.

    Returns:
        Los archivos de `origen` que no se han copiado, cada uno con su motivo; vacía si se copiaron todos.

    Raises:
        ErrorLectura: Si la carpeta de lecturas de `origen` no es una carpeta propia.
    """
    carpeta = carpeta_de_lecturas(origen, fuente)
    if not carpeta.exists():
        return []
    exigir(not carpeta.is_symlink() and carpeta.is_dir(), f"la carpeta de lecturas de {fuente} no es propia")
    no_copiadas = []
    for ruta in sorted(carpeta.iterdir()):
        try:
            lectura = _lectura_del_archivo(ruta, fuente)
            if lectura is not None:
                _guardar_json(destino, lectura)
        except ErrorLectura as error:
            no_copiadas.append(f"{ruta.name} ({error})")
    return no_copiadas


def _lectura_del_archivo(ruta: Path, fuente: str) -> ObjetoJson | None:
    """Lee un archivo de la carpeta de lecturas; un temporal o una aceptación no son lecturas y dan `None`.

    Returns:
        La lectura validada, o `None` si el archivo no es una lectura.

    Raises:
        ErrorLectura: Si el archivo no es una lectura válida de esa fuente con el nombre que le toca.
    """
    if TEMPORAL.fullmatch(ruta.name) or NOMBRE_DE_ACEPTACION.fullmatch(ruta.name):
        return None
    nombre = NOMBRE.fullmatch(ruta.name)
    exigir(nombre is not None, f"{ruta.name} no es el nombre de una lectura")
    lectura = leer_lectura(bytes_guardados(ruta))
    exigir(lectura["lectura_id"] == nombre["lectura_id"], f"{ruta.name} guarda otra lectura")
    exigir(lectura["fuente"] == fuente, f"{ruta.name} es una lectura de otra fuente")
    return lectura


def listar_lecturas(raiz: Path, fuente: str) -> list[ObjetoJson]:
    """Lee todas las lecturas de una fuente, validadas, de la más antigua a la más reciente.

    Returns:
        Las lecturas ordenadas por su hora de observación y, a igual hora, por su identificador; vacía si la fuente
        aún no tiene ninguna.

    Raises:
        ErrorLectura: Si un archivo de la carpeta no es una lectura válida de esa fuente con el nombre que le toca.
    """
    carpeta = carpeta_de_lecturas(raiz, fuente)
    if not carpeta.exists():
        return []
    exigir(not carpeta.is_symlink() and carpeta.is_dir(), f"la carpeta de lecturas de {fuente} no es propia")
    lecturas = [lectura for ruta in sorted(carpeta.iterdir()) if (lectura := _lectura_del_archivo(ruta, fuente))]
    return sorted(lecturas, key=lambda lectura: (lectura["observado_utc"], lectura["lectura_id"]))
