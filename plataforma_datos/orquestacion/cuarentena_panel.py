"""Los cambios retenidos que esperan a una persona, tal como viajan al panel: cuarentena del paquete y censo del SOC.

Una actualización que perdería más de PERDIDA_MAXIMA de un conjunto conserva lo publicado y deja el cambio retenido en
dos sitios: `cuarentena.json` (cuarentena_del_paquete) para los archivos del paquete y las cifras de la oferta del SOC
pendiente (censo_soc). Este módulo los lee sin escribir y los proyecta a un bloque cerrado, solo con cifras, códigos,
huellas e instantes: ni rutas, ni direcciones, ni texto libre.

Un archivo que no se puede leer, o que no tiene la forma esperada, se dice así («ilegible»): nunca se presenta como si
no hubiera nada retenido.
"""

import json
import os
import re
import stat
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from plataforma_datos.comun.nucleo import DATOS_RELATIVOS, ErrorFuente
from plataforma_datos.cursos.fuentes.formacion.censo_soc import CIFRAS_PENDIENTE, OFERTA_PENDIENTE
from plataforma_datos.cursos.fuentes.formacion.constantes import FUENTE as FUENTE_SOC
from plataforma_datos.orquestacion.contrato_comprobaciones_panel import instante_panel
from plataforma_datos.orquestacion.cuarentena_del_paquete import leer_cuarentena

CLAVE_RETENIDOS = "retenidos"
LEIDA = "leida"
ILEGIBLE = "ilegible"
# Las medidas de una pérdida son las de la comparación del paquete; al panel viajan como códigos sin espacios.
MEDIDAS_DEL_PANEL = {"entradas": "entradas", "cursos SOC": "cursos-soc"}
ARCHIVO_DEL_PAQUETE = re.compile(r"[a-z0-9][a-z0-9_-]{0,94}\.json")
HUELLA = re.compile(r"[0-9a-f]{64}")
MAX_CAMBIOS = 64
MAX_ENTERO = (1 << 53) - 1
# Las cifras del censo pendiente son un documento pequeño; uno mayor no es el que escribe censo_soc.
MAX_CIFRAS_BYTES = 64 * 1024
CAMPOS_CIFRAS_SOC = frozenset(
    {
        "archivo",
        "sha256",
        "bytes",
        "comprobado_remoto_utc",
        "cursos",
        "copia_anterior",
        "cursos_copia_anterior",
        "perdida_maxima",
    }
)
ERROR = "Retenidos del panel no verificables."


class RetenidosInvalidos(ValueError):
    """El bloque de retenidos, o el archivo del que sale, no cumple el contrato del panel."""


def _exigir(condicion: bool) -> None:
    if not condicion:
        raise RetenidosInvalidos(ERROR)


def _objeto(valor: object, campos: str) -> dict[str, Any]:
    _exigir(type(valor) is dict and set(valor) == set(campos.split(",")))
    return valor


def _entero(valor: object) -> int:
    _exigir(type(valor) is int and 0 <= valor <= MAX_ENTERO)
    return valor


def _huella(valor: object) -> None:
    _exigir(isinstance(valor, str) and HUELLA.fullmatch(valor) is not None)


def _instante(valor: object) -> datetime:
    try:
        return instante_panel(valor)
    except ValueError as error:
        raise RetenidosInvalidos(ERROR) from error


def _archivo(valor: object) -> None:
    _exigir(isinstance(valor, str) and ARCHIVO_DEL_PAQUETE.fullmatch(valor) is not None)


def _utc(valor: str) -> str:
    """Pasa a UTC un instante con zona, sin redondearlo: los segundos y los microsegundos se conservan.

    Returns:
        El instante como AAAA-MM-DDTHH:MM:SS[.ffffff]Z.

    Raises:
        RetenidosInvalidos: Si no es un instante ISO 8601 con zona horaria.
    """
    _exigir(isinstance(valor, str))
    try:
        instante = datetime.fromisoformat(valor)
    except ValueError as error:
        raise RetenidosInvalidos(ERROR) from error
    _exigir(instante.utcoffset() is not None)
    return instante.astimezone(UTC).isoformat().replace("+00:00", "Z")


def validar_cambio(valor: object) -> None:
    """Un cambio retenido del paquete: su archivo, el grupo que se conserva con él, sus pérdidas, fechas y huellas."""
    cambio = _objeto(valor, "archivo,grupo,perdidas,desdeUtc,ultimaUtc,vigenteSha256,exportadoSha256,aceptadaUtc")
    _archivo(cambio["archivo"])
    grupo = cambio["grupo"]
    _exigir(type(grupo) is list and 0 < len(grupo) <= MAX_CAMBIOS and cambio["archivo"] in grupo)
    for otro in grupo:
        _archivo(otro)
    # El grupo se escribe ordenado y sin repetidos; otro orden no es el de cuarentena_del_paquete.
    _exigir(grupo == sorted(set(grupo)))
    perdidas = cambio["perdidas"]
    _exigir(type(perdidas) is list and 0 < len(perdidas) <= len(MEDIDAS_DEL_PANEL))
    for perdida in perdidas:
        fila = _objeto(perdida, "medida,antes,despues")
        _exigir(isinstance(fila["medida"], str) and fila["medida"] in MEDIDAS_DEL_PANEL.values())
        _entero(fila["antes"])
        _entero(fila["despues"])
    _exigir(len({perdida["medida"] for perdida in perdidas}) == len(perdidas))
    desde, ultima = _instante(cambio["desdeUtc"]), _instante(cambio["ultimaUtc"])
    _exigir(desde <= ultima)
    # Solo se acepta lo que ya estaba retenido: la aceptación no puede ser anterior a la retención.
    _exigir(cambio["aceptadaUtc"] is None or desde <= _instante(cambio["aceptadaUtc"]))
    _huella(cambio["vigenteSha256"])
    _huella(cambio["exportadoSha256"])


def validar_censo_pendiente(valor: object) -> None:
    """La oferta del SOC pendiente: sus cursos, los de la copia que sigue vigente, su huella y cuándo se consultó."""
    censo = _objeto(valor, "cursosOferta,cursosCopia,huella,consultadoEn")
    # Solo queda pendiente una oferta que pierde cursos frente a la copia: con tantos o más se habría admitido.
    _exigir(_entero(censo["cursosOferta"]) < _entero(censo["cursosCopia"]))
    _huella(censo["huella"])
    _instante(censo["consultadoEn"])


def validar_retenidos(valor: object) -> None:
    """El bloque cerrado de retenidos: cada parte dice si se pudo leer y, si se leyó, qué retiene.

    Raises:
        RetenidosInvalidos: Si sobra o falta un campo, o un valor no es del tipo o del formato del contrato.
    """
    bloque = _objeto(valor, "cuarentena,censoSoc")
    cuarentena = _objeto(bloque["cuarentena"], "lectura,cambios")
    _exigir(cuarentena["lectura"] in (LEIDA, ILEGIBLE))
    cambios = cuarentena["cambios"]
    if cuarentena["lectura"] == ILEGIBLE:
        _exigir(cambios is None)
    else:
        _exigir(type(cambios) is list and len(cambios) <= MAX_CAMBIOS)
        for cambio in cambios:
            validar_cambio(cambio)
        archivos = [cambio["archivo"] for cambio in cambios]
        _exigir(archivos == sorted(set(archivos)))
    censo = _objeto(bloque["censoSoc"], "lectura,pendiente")
    _exigir(censo["lectura"] in (LEIDA, ILEGIBLE))
    if censo["lectura"] == ILEGIBLE:
        _exigir(censo["pendiente"] is None)
    elif censo["pendiente"] is not None:
        validar_censo_pendiente(censo["pendiente"])


def _cambio_del_panel(archivo: str, registro: dict[str, Any]) -> dict[str, Any]:
    """Proyecta una entrada de cuarentena.json, ya comprobada por leer_cuarentena, sin repetir su archivo.

    Returns:
        El cambio retenido con los nombres del contrato del panel.
    """
    _exigir(all(perdida["medida"] in MEDIDAS_DEL_PANEL for perdida in registro["perdidas"]))
    cambio = {
        "archivo": archivo,
        "grupo": registro["grupo"],
        "perdidas": [
            {"medida": MEDIDAS_DEL_PANEL[p["medida"]], "antes": p["antes"], "despues": p["despues"]}
            for p in registro["perdidas"]
        ],
        "desdeUtc": _utc(registro["desde_utc"]),
        "ultimaUtc": _utc(registro["ultima_utc"]),
        "vigenteSha256": registro["vigente_sha256"],
        "exportadoSha256": registro["exportado_sha256"],
        "aceptadaUtc": None if registro["aceptada_utc"] is None else _utc(registro["aceptada_utc"]),
    }
    validar_cambio(cambio)
    return cambio


def cuarentena_del_panel(raiz: Path) -> dict[str, Any]:
    """Lee la cuarentena del paquete; sin su archivo no hay nada retenido, y uno que no se puede leer se dice así.

    Returns:
        `{"lectura": "leida", "cambios": [...]}` en el orden de los archivos, o `{"lectura": "ilegible", "cambios":
        None}` si el archivo existe pero no se puede leer o no es de la versión que se conoce.
    """
    try:
        registros = leer_cuarentena(raiz)
        cambios = [_cambio_del_panel(archivo, registros[archivo]) for archivo in sorted(registros)]
    except (ErrorFuente, OSError, RetenidosInvalidos):
        return {"lectura": ILEGIBLE, "cambios": None}
    return {"lectura": LEIDA, "cambios": cambios}


def _rechazar_constante(_valor: str) -> None:
    raise RetenidosInvalidos(ERROR)


def _sin_duplicados(pares: list[tuple[str, Any]]) -> dict[str, Any]:
    _exigir(len({clave for clave, _ in pares}) == len(pares))
    return dict(pares)


def _leer_cifras_soc(ruta: Path) -> dict[str, Any] | None:
    """Lee las cifras del censo pendiente sin seguir enlaces simbólicos; `None` si no hay oferta pendiente.

    Returns:
        El documento de cifras, o `None` si no existe.

    Raises:
        RetenidosInvalidos: Si no es un archivo normal, es demasiado grande, no es JSON estricto o tiene otros campos.
    """
    try:
        descriptor = os.open(ruta, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except FileNotFoundError:
        return None
    with os.fdopen(descriptor, "rb") as archivo:
        _exigir(stat.S_ISREG(os.fstat(archivo.fileno()).st_mode))
        contenido = archivo.read(MAX_CIFRAS_BYTES + 1)
    _exigir(len(contenido) <= MAX_CIFRAS_BYTES)
    try:
        documento = json.loads(contenido, object_pairs_hook=_sin_duplicados, parse_constant=_rechazar_constante)
    except (UnicodeDecodeError, json.JSONDecodeError, RecursionError) as error:
        raise RetenidosInvalidos(ERROR) from error
    _exigir(type(documento) is dict and set(documento) == CAMPOS_CIFRAS_SOC)
    return documento


def _censo_del_panel(cifras: dict[str, Any]) -> dict[str, Any]:
    """Proyecta las cifras del censo pendiente: sin el nombre de la copia ni el de la oferta guardada.

    Returns:
        Cursos de la oferta, cursos de la copia vigente, huella de la oferta y cuándo se consultó.
    """
    _exigir(cifras["archivo"] == OFERTA_PENDIENTE)
    censo = {
        "cursosOferta": cifras["cursos"],
        "cursosCopia": cifras["cursos_copia_anterior"],
        "huella": cifras["sha256"],
        "consultadoEn": _utc(cifras["comprobado_remoto_utc"]),
    }
    validar_censo_pendiente(censo)
    return censo


def censo_soc_del_panel(raiz: Path) -> dict[str, Any]:
    """Lee el censo del SOC pendiente de una persona; sin sus cifras no hay oferta pendiente.

    Returns:
        `{"lectura": "leida", "pendiente": {...} | None}`, o `{"lectura": "ilegible", "pendiente": None}` si las
        cifras existen pero no se pueden leer o no tienen la forma que escribe censo_soc.
    """
    ruta = raiz / DATOS_RELATIVOS / "originales" / FUENTE_SOC / CIFRAS_PENDIENTE
    try:
        cifras = _leer_cifras_soc(ruta)
        pendiente = None if cifras is None else _censo_del_panel(cifras)
    except (OSError, RetenidosInvalidos):
        return {"lectura": ILEGIBLE, "pendiente": None}
    return {"lectura": LEIDA, "pendiente": pendiente}


def retenidos_del_panel(raiz: Path) -> dict[str, Any]:
    """El bloque de retenidos que viaja en el estado del panel, validado con su contrato.

    Returns:
        La cuarentena del paquete y el censo del SOC pendiente, cada uno con su lectura.
    """
    bloque = {"cuarentena": cuarentena_del_panel(raiz), "censoSoc": censo_soc_del_panel(raiz)}
    validar_retenidos(bloque)
    return bloque
