"""Estado observado de la edición que anuncia el INE frente a la edición que publica Faro.

Una edición más reciente en el catálogo no es un fallo de la consulta: es un hecho observado, con la fecha y la huella
del catálogo en que se vio. Mientras no se incorpora, la fuente conserva y publica la edición admitida y declara la
observación en el dato, para que el informe diga lo que se sabe. Un catálogo incoherente con la edición admitida (un
año anterior, o microdatos de un año sin resultados) sí detiene la consulta.
"""

import re
from collections.abc import Callable
from datetime import datetime
from pathlib import Path
from typing import Any, Literal, TypedDict

from plataforma_datos.comun.entrada_salida import escribir_bytes_entero, sha256, sha256_bytes
from plataforma_datos.comun.nucleo import FormatoInesperado, exigir
from plataforma_datos.ia_y_trabajo.fuentes.tich.constantes import CATALOGO

SIN_MICRODATOS: Literal["publicada-sin-microdatos"] = "publicada-sin-microdatos"
PENDIENTE: Literal["pendiente-de-incorporar"] = "pendiente-de-incorporar"
ANIO_DE_CUATRO_CIFRAS = re.compile(r"[0-9]{4}")
# La carpeta, dentro de los originales de la fuente, de las capturas del catálogo en que se vio cada edición nueva.
CAPTURAS = "observaciones"
SHA256 = re.compile(r"[0-9a-f]{64}")
# Un instante ISO 8601 con zona: el que escribe `ahora_utc`, con o sin fracciones de segundo.
INSTANTE = re.compile(
    r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,6})?(?:Z|[+-][0-9]{2}:[0-9]{2})"
)


class EdicionNueva(TypedDict):
    """Una edición publicada por el INE que el dato aún no incorpora, con la evidencia de su observación."""

    estado: Literal["publicada-sin-microdatos", "pendiente-de-incorporar"]
    anio: str
    observado_utc: str
    sha256_catalogo: str


def estado_de_la_edicion(edicion: dict[str, int | str], anio_admitido: int) -> str | None:
    """Clasifica la edición del catálogo respecto a la admitida.

    Solo hay microdatos de la edición nueva si el último ZIP del catálogo es del mismo año que sus resultados: con
    resultados de 2027 y microdatos de 2026, la edición de 2027 aún no tiene microdatos.

    Args:
        edicion: Los años de resultados y microdatos que anuncia el catálogo.
        anio_admitido: El año de la edición que publica Faro.

    Returns:
        None si el catálogo anuncia la edición admitida; si no, el estado de la edición nueva.

    Raises:
        FormatoInesperado: Si el catálogo anuncia una edición anterior a la admitida o microdatos sin sus resultados.
    """
    resultados, microdatos = edicion["anio_resultados"], edicion["anio_microdatos"]
    exigir(
        isinstance(resultados, int) and isinstance(microdatos, int) and anio_admitido <= microdatos <= resultados,
        f"TIC-H: el INE anuncia resultados {resultados} y microdatos {microdatos}, incoherentes con la edición "
        f"admitida {anio_admitido}",
    )
    if resultados == anio_admitido:
        return None
    return PENDIENTE if microdatos == resultados else SIN_MICRODATOS


def comprobar_edicion(edicion: dict[str, int | str], anio_admitido: str) -> None:
    """Exige un catálogo coherente con la edición admitida; una edición más reciente es una observación, no un fallo.

    Cuando el último ZIP del catálogo es el de la edición admitida, su dirección debe ser la de sus originales.
    """
    estado_de_la_edicion(edicion, int(anio_admitido))
    direccion = f"https://www.ine.es/ftp/microdatos/tich/datos_{anio_admitido}.zip"
    exigir(
        edicion["anio_microdatos"] != int(anio_admitido) or edicion["url_microdatos"] == direccion,
        f"TIC-H: el INE anuncia los microdatos {anio_admitido} en {edicion['url_microdatos']}, no en la dirección "
        "admitida",
    )


def observacion_previa(anterior: object, anio_admitido: str) -> tuple[EdicionNueva | None, str | None]:
    """La observación de la procedencia anterior, o el motivo por el que se descarta si está mal formada.

    Una observación corrupta no bloquea la consulta: se descarta, su motivo queda en la procedencia y en los controles
    de la validación, y la edición nueva se observa de nuevo con la fecha de esta consulta.

    Returns:
        La observación válida y None, o None y el motivo del descarte (None y None si no había observación).
    """
    if anterior is None:
        return None, None
    try:
        return observacion_valida(anterior, anio_admitido), None
    except FormatoInesperado as error:
        return None, str(error)


def edicion_nueva(
    edicion: dict[str, int | str], anio_admitido: int, catalogo: dict[str, Any], previa: EdicionNueva | None
) -> EdicionNueva | None:
    """La observación de una edición nueva, fechada con la primera vez que se vio con ese año y ese estado.

    Args:
        edicion: Los años que anuncia el catálogo.
        anio_admitido: El año de la edición que publica Faro.
        catalogo: La entrada de descubrimiento del catálogo consultado: su huella y su fecha de descarga.
        previa: La observación válida de la procedencia anterior, o None. Si anuncia el mismo año en el mismo estado,
            se conservan su fecha y su huella aunque los bytes del catálogo hayan cambiado (el INE compone la página en
            cada petición): el dato publicado no cambia mientras no cambie lo observado. La huella de cada consulta
            queda en la entrada del catálogo de la procedencia.

    Returns:
        La observación, o None si el catálogo anuncia la edición admitida (y la anterior, si la había, se retira).
    """
    estado = estado_de_la_edicion(edicion, anio_admitido)
    if estado is None:
        return None
    anio = str(edicion["anio_resultados"])
    misma = previa is not None and (previa["anio"], previa["estado"]) == (anio, estado)
    return {
        "estado": PENDIENTE if estado == PENDIENTE else SIN_MICRODATOS,
        "anio": anio,
        "observado_utc": previa["observado_utc"] if previa is not None and misma else catalogo["descargado_utc"],
        "sha256_catalogo": previa["sha256_catalogo"] if previa is not None and misma else catalogo["sha256"],
    }


def observar(
    edicion: dict[str, int | str], catalogo: dict[str, Any], anterior: dict[str, Any] | None, ahora: str, anio: str
) -> dict[str, Any]:
    """Los campos de la procedencia nueva sobre la edición observada en el catálogo.

    Args:
        edicion: Los años que anuncia el catálogo.
        catalogo: La entrada de descubrimiento del catálogo consultado.
        anterior: La procedencia anterior, o None si no la había.
        ahora: El instante de esta consulta. Descartada una observación corrupta, la nueva lleva esta fecha y no la
            del catálogo guardado.
        anio: El año de la edición admitida.

    Returns:
        `edicion_nueva`, si la hay, y `edicion_nueva_descartada` con su motivo, si la anterior estaba mal formada.
    """
    previa, descartada = observacion_previa((anterior or {}).get("edicion_nueva"), anio)
    vista = {**catalogo, "descargado_utc": ahora} if descartada else catalogo
    nueva = edicion_nueva(edicion, int(anio), vista, previa)
    return {
        **({"edicion_nueva": nueva} if nueva else {}),
        **({"edicion_nueva_descartada": descartada} if descartada else {}),
    }


def captura_de_la_observacion(
    observada: dict[str, Any], contenido: Callable[[], bytes], original: Path
) -> dict[str, Any]:
    """La captura del catálogo en que se vio por primera vez la edición nueva, conservada junto a los originales.

    El dato cita la huella del catálogo de la primera observación de ese año y estado, no la de cada consulta: para que
    esa huella se pueda comprobar, los bytes de esa consulta se guardan en `observaciones/<huella>.html`, en la carpeta
    de originales de la fuente, y no se reescriben. Una observación anterior a esta conservación no tiene captura: sus
    bytes ya no están, y la procedencia no registra ninguna.

    Args:
        observada: Lo observado en esta consulta (`observar`).
        contenido: Lee los bytes del catálogo de esta consulta; solo se llama si hay edición nueva.
        original: La carpeta de originales de la fuente.

    Returns:
        `{"captura_edicion_nueva": {"archivo", "sha256"}}` si la captura está conservada con su huella; si no, nada.
    """
    nueva = observada.get("edicion_nueva")
    if nueva is None:
        return {}
    huella = nueva["sha256_catalogo"]
    archivo = f"{CAPTURAS}/{huella}.html"
    if not (original / archivo).exists() and sha256_bytes(bytes_del_catalogo := contenido()) == huella:
        (original / CAPTURAS).mkdir(parents=True, exist_ok=True)
        escribir_bytes_entero(original / archivo, bytes_del_catalogo)
    if not (original / archivo).is_file() or sha256(original / archivo) != huella:
        return {}
    return {"captura_edicion_nueva": {"archivo": archivo, "sha256": huella}}


def aviso_de_descarte(procedencia: dict[str, Any]) -> dict[str, str]:
    """El aviso de la validación cuando se descartó una observación anterior mal formada, con su motivo.

    No es un control: el descarte no detiene la fuente, solo se dice. El panel lo muestra mientras la procedencia lo
    registre (`avisoEdicion`).

    Returns:
        `{"observacion_descartada": motivo}`, o nada si no hubo descarte.
    """
    motivo = procedencia.get("edicion_nueva_descartada")
    return {"observacion_descartada": motivo} if isinstance(motivo, str) else {}


def _instante_valido(valor: object) -> bool:
    if not isinstance(valor, str) or INSTANTE.fullmatch(valor) is None:
        return False
    try:
        return datetime.fromisoformat(valor).tzinfo is not None
    except ValueError:
        return False


def observacion_valida(nueva: object, anio_admitido: str) -> EdicionNueva:
    """Exige la forma de una observación: su estado, un año de cuatro cifras posterior, un instante y una huella.

    Returns:
        La observación, copiada.

    Raises:
        FormatoInesperado: Si no tiene esa forma.
    """
    exigir(
        isinstance(nueva, dict)
        and set(nueva) == set(EdicionNueva.__annotations__)
        and nueva["estado"] in {SIN_MICRODATOS, PENDIENTE}
        and isinstance(nueva["anio"], str)
        and ANIO_DE_CUATRO_CIFRAS.fullmatch(nueva["anio"]) is not None
        and int(nueva["anio"]) > int(anio_admitido)
        and _instante_valido(nueva["observado_utc"])
        and isinstance(nueva["sha256_catalogo"], str)
        and SHA256.fullmatch(nueva["sha256_catalogo"]) is not None,
        "TIC-H: la edición nueva registrada en la procedencia no tiene la forma esperada",
    )
    return {
        "estado": PENDIENTE if nueva["estado"] == PENDIENTE else SIN_MICRODATOS,
        "anio": nueva["anio"],
        "observado_utc": nueva["observado_utc"],
        "sha256_catalogo": nueva["sha256_catalogo"],
    }


def anios_medidos_validos(anios: object, anio_admitido: str) -> list[str]:
    """Exige la serie de años de un dato: años de cuatro cifras, en orden, sin repetir y con el vigente al final.

    Returns:
        Los años, copiados.

    Raises:
        FormatoInesperado: Si la lista está vacía o no tiene esa forma.
    """
    exigir(
        isinstance(anios, list)
        and bool(anios)
        and all(isinstance(anio, str) and ANIO_DE_CUATRO_CIFRAS.fullmatch(anio) is not None for anio in anios)
        and all(int(antes) < int(despues) for antes, despues in zip(anios, anios[1:], strict=False))
        and anios[-1] == anio_admitido,
        f"TIC-H: los años medidos {anios!r} no van en orden, sin repetir y terminando en {anio_admitido}",
    )
    return list(anios)


def observacion_de_la_procedencia(procedencia: dict[str, Any], anio_admitido: str) -> EdicionNueva | None:
    """La observación de una procedencia, cruzada con la edición y la huella del catálogo que registra.

    Una procedencia sin catálogo registrado (capturas anteriores a la sonda) no puede traer observación.

    Returns:
        La observación, o None si no la hay.

    Raises:
        FormatoInesperado: Si la observación no tiene la forma esperada o no casa con la edición o el catálogo.
    """
    nueva = procedencia.get("edicion_nueva")
    edicion = procedencia.get("edicion")
    if edicion is None:
        exigir(nueva is None, "TIC-H: la procedencia registra una edición nueva sin el catálogo en que se vio")
        return None
    estado = estado_de_la_edicion(edicion, int(anio_admitido))
    if nueva is None:
        exigir(estado is None, "TIC-H: el catálogo registrado anuncia una edición nueva que la procedencia no observa")
        return None
    observada = observacion_valida(nueva, anio_admitido)
    catalogos = [fila for fila in procedencia.get("descubrimiento", []) if fila.get("archivo") == CATALOGO]
    exigir(
        observada["estado"] == estado and observada["anio"] == str(edicion["anio_resultados"]) and len(catalogos) == 1,
        "TIC-H: la edición nueva registrada no casa con la edición ni con el catálogo de la procedencia",
    )
    return observada


def ediciones_del_dato(
    procedencia: dict[str, Any], anio_admitido: str, anios_medidos: list[str] | None = None
) -> dict[str, Any]:
    """Lo que el dato publicado declara de sus ediciones: los años medidos y, si la hay, la edición nueva observada.

    Args:
        procedencia: La procedencia de la operación, con el catálogo y lo observado en él.
        anio_admitido: El año de la edición calculada.
        anios_medidos: Los años que mide el dato, del estado de la edición; por omisión, solo el calculado.

    Returns:
        `anios_medidos` y, si la procedencia la registra, `edicion_nueva`.

    Raises:
        FormatoInesperado: Si la observación no tiene la forma esperada o no casa con la procedencia.
    """
    datos: dict[str, Any] = {"anios_medidos": anios_medidos_validos(anios_medidos or [anio_admitido], anio_admitido)}
    nueva = observacion_de_la_procedencia(procedencia, anio_admitido)
    return {**datos, "edicion_nueva": nueva} if nueva is not None else datos


def serie_medida(conjunto: dict[str, Any]) -> str:
    """La frase de límites sobre la serie, según los años que mide el dato.

    Returns:
        Con un año, que no hay serie; con más, desde qué año y cuántas ediciones la forman.
    """
    anios = conjunto["anios_medidos"]
    if len(anios) == 1:
        return "Primer año de la pregunta: no hay serie."
    return f"Serie de {len(anios)} ediciones, desde {anios[0]}."
