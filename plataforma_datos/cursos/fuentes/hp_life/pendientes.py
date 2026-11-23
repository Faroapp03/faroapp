"""Pendientes de HP LIFE: una alta cuya ficha no se puede leer espera con un único pendiente por curso.

El pendiente de un curso (cuerpo, recibo y su estado) se sustituye en cada consulta en que sigue ilegible, en lugar de
sumar un archivo por día. El estado guarda la fecha de la primera y de la última vez que se vio así. Los cuerpos,
recibos e intentos de cada consulta siguen conservados entre los originales de la fuente, que nada borra.
"""

import hashlib
import json
import re
from dataclasses import dataclass
from pathlib import Path

from plataforma_datos.cursos.fuentes.hp_life.lector import ErrorFichaHpLife
from plataforma_datos.cursos.fuentes.hp_life.recepciones import fecha_utc
from plataforma_datos.cursos.tipos_json import ObjetoJson

CARPETA = "pendientes"
SUFIJO_ESTADO = ".estado.json"


def reemplazable(archivo: str) -> bool:
    """Indica si un archivo conservado es el cuerpo o el recibo de un pendiente, que la consulta siguiente sustituye.

    Returns:
        True para los archivos de `pendientes/` que no son el estado del curso.
    """
    return archivo.startswith(CARPETA + "/") and not archivo.endswith(SUFIJO_ESTADO)


def nombre(id: str | None) -> str:
    """Nombre de archivo de un curso, distinto para cada identificador.

    Cada byte que no es una letra minúscula o un dígito se escribe `_` y su valor en hexadecimal; el identificador
    ausente se escribe `_n`, que ninguna secuencia anterior puede producir.

    Returns:
        Un nombre de solo letras minúsculas, dígitos y guiones bajos.
    """
    if id is None:
        return "_n"
    return re.sub(rb"[^a-z0-9]", lambda m: b"_%02x" % m.group()[0], id.encode()).decode()


def _visto_el(recibo: bytes, corte: str) -> str:
    """Instante de la recepción si el recibo lo dice; si no se puede leer, el corte de la consulta.

    Returns:
        Instante UTC en texto.
    """
    try:
        visto = json.loads(recibo)["captura"]["recibido_utc"]
        fecha_utc(visto)
    except (ValueError, KeyError, TypeError, ErrorFichaHpLife):
        return corte
    return visto


def _primera_vez(estado: Path, ultima: str) -> str:
    try:
        previo = json.loads(estado.read_bytes())
    except (OSError, ValueError):
        return ultima
    primera = previo.get("primera_vez_utc") if isinstance(previo, dict) else None
    try:
        return primera if fecha_utc(primera) <= fecha_utc(ultima) else ultima
    except ErrorFichaHpLife:
        return ultima


@dataclass(frozen=True)
class Pendiente:
    """Lo que una consulta recibió de un curso que no se puede leer, con su causa y el corte de la consulta."""

    id: str | None
    cuerpo: bytes
    cuerpo_sha256: str
    recibo: bytes
    recibo_sha256: str
    motivo: str
    corte: str


def registrar(pendiente: Pendiente, area: Path) -> ObjetoJson:
    """Escribe el pendiente de un curso, sustituyendo el de la consulta anterior, y su estado.

    Returns:
        La fila de control, con las fechas de la primera y la última vez y los archivos que conserva.
    """
    archivo = nombre(pendiente.id)
    carpeta = area / CARPETA
    carpeta.mkdir(parents=True, exist_ok=True)
    ultima = _visto_el(pendiente.recibo, pendiente.corte)
    fila = {
        "id": pendiente.id,
        "estado": "pendiente",
        "motivo": pendiente.motivo,
        "cuerpo_sha256": pendiente.cuerpo_sha256,
        "recibo_sha256": pendiente.recibo_sha256,
        "primera_vez_utc": _primera_vez(carpeta / (archivo + SUFIJO_ESTADO), ultima),
        "ultima_vez_utc": ultima,
    }
    contenido = json.dumps(fila, ensure_ascii=False, sort_keys=True).encode() + b"\n"
    archivos = []
    for datos, sha, extension in (
        (pendiente.cuerpo, pendiente.cuerpo_sha256, ".body"),
        (pendiente.recibo, pendiente.recibo_sha256, ".json"),
        (contenido, hashlib.sha256(contenido).hexdigest(), SUFIJO_ESTADO),
    ):
        (carpeta / (archivo + extension)).write_bytes(datos)
        archivos.append({"archivo": f"{CARPETA}/{archivo}{extension}", "sha256": sha})
    return {**fila, "archivos": archivos}


def retirar_resueltos(area: Path, filas: list[ObjetoJson], heredadas: list[ObjetoJson]) -> list[ObjetoJson]:
    """Retira de la preparación el estado de los cursos que ya no están pendientes.

    Solo se quitan las copias de esta preparación; los cuerpos, recibos e intentos siguen entre los originales.

    Returns:
        El inventario heredado sin los archivos de pendientes que esta consulta no vuelve a escribir.
    """
    vigentes = {a["archivo"] for fila in filas if fila["estado"] == "pendiente" for a in fila["archivos"]}
    conservados = []
    for prueba in heredadas:
        if prueba["archivo"].startswith(CARPETA + "/") and prueba["archivo"] not in vigentes:
            (area / prueba["archivo"]).unlink(missing_ok=True)
        else:
            conservados.append(prueba)
    return conservados
