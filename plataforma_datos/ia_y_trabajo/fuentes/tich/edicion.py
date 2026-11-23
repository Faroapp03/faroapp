"""Estado de la edición admitida de la TIC-H: qué año publica Faro, con qué tablas y dónde están sus originales.

`validados/tich/edicion.json` lo escribe solo `validar`, cuando admite el conjunto de esa edición, y entero o nada.
Mientras no existe, la edición admitida es la primera (`PRIMERA_EDICION`, con sus tablas de contrato). Todo lo que
depende del año lo lee de aquí: los nombres y direcciones de sus originales, su carpeta, los años que mide el dato y lo
que dicen sus documentos, leídos una sola vez al admitirla: las secciones censales en muestra y la huella de su
metodología y de su cuestionario. La edición admitida no vuelve a leer sus PDF; solo la candidata los lee.

Cada edición guarda sus originales en `originales/tich/<año>/`, con su procedencia propia. La procedencia de la
operación, `originales/tich/procedencia.json`, guarda el catálogo y lo observado en él (la edición nueva y sus tablas) y
registra los originales de la edición admitida con su ruta dentro de la carpeta de la fuente (`<año>/<archivo>`): así
las comprobaciones comunes de huella, los módulos y las copias de trabajo los encuentran sin saber de años. Un original
suelto en `originales/tich/` pasa a la carpeta de su año con su huella comprobada antes y después de copiarlo; hasta
que la copia está completa y comprobada, se sigue leyendo donde estaba. El suelto se retira después, en una consulta,
cuando una validación ya admitió sus copias (`retirar_sueltos_migrados`).
"""

import re
from collections.abc import Collection, Mapping
from pathlib import Path
from typing import Any, TypedDict

from plataforma_datos.comun.entrada_salida import (
    escribir_bytes_entero,
    guardar_json,
    leer_json,
    sha256,
    sha256_bytes,
)
from plataforma_datos.comun.nucleo import ARCHIVO_DE_PROCEDENCIA, ArchivoDescargable, FormatoInesperado, exigir
from plataforma_datos.ia_y_trabajo.fuentes.tich.constantes import (
    ORIGINAL,
    PRIMERA_EDICION,
    TABLAS_DE_LA_PRIMERA,
    VALIDADO,
    NombresDelAnio,
    archivos_del_anio,
    nombres_del_anio,
)

ESTADO = VALIDADO / "edicion.json"
ANIO = re.compile(r"[0-9]{4}")
TABLA = re.compile(r"[0-9]{3,6}")
HUELLA = re.compile(r"[0-9a-f]{64}")
# Lo que dicen los documentos de la primera edición: metodología de la TIC-H 2025 (INE, IV.2: 2.500 secciones en
# España y 216 en Cataluña) y la huella de la metodología y del cuestionario con que se comprobó su enunciado.
SECCIONES_DE_LA_PRIMERA = {"espana": 2500, "cataluna": 216}
DOCUMENTOS_DE_LA_PRIMERA = {
    "metodologia": "500f7157aaed28b5af9129d665458c2a2347f7fd83735812d070d2d13ca67905",
    "cuestionario": "f05b29e1e4d917d6fe201f11246b452c82d9132d9d81ca894fe7bd97a43948ae",
}
# Lo que la procedencia de cada año guarda de la de la operación al migrar: sus originales y cómo se citan.
CAMPOS_DEL_ANIO = ("fuente", "cita", "licencia", "licencia_texto", "condiciones_microdatos", "archivos")


class Tablas(TypedDict):
    """Los números de la tabla de uso y de la de errores de una edición."""

    uso: str
    errores: str


class Secciones(TypedDict):
    """Las secciones censales en muestra de España y de Cataluña."""

    espana: int
    cataluna: int


class Documentos(TypedDict):
    """La huella de la metodología y del cuestionario de la edición."""

    metodologia: str
    cuestionario: str


class Edicion(TypedDict):
    """La edición admitida: año, años que mide el dato, tablas, año de la EPA y lo que dicen sus documentos."""

    anio: str
    anios_medidos: list[str]
    tablas: Tablas
    epa_anio: str
    secciones: Secciones
    documentos: Documentos


def primera() -> Edicion:
    """La edición admitida mientras no se ha validado ninguna con este estado.

    Returns:
        La primera edición, con sus tablas de contrato.
    """
    return {
        "anio": PRIMERA_EDICION,
        "anios_medidos": [PRIMERA_EDICION],
        "tablas": {"uso": TABLAS_DE_LA_PRIMERA["uso"], "errores": TABLAS_DE_LA_PRIMERA["errores"]},
        "epa_anio": PRIMERA_EDICION,
        "secciones": {"espana": SECCIONES_DE_LA_PRIMERA["espana"], "cataluna": SECCIONES_DE_LA_PRIMERA["cataluna"]},
        "documentos": {
            "metodologia": DOCUMENTOS_DE_LA_PRIMERA["metodologia"],
            "cuestionario": DOCUMENTOS_DE_LA_PRIMERA["cuestionario"],
        },
    }


def valida(objeto: object) -> Edicion:
    """Exige la forma del estado de la edición.

    Returns:
        El estado, con sus campos y nada más.

    Raises:
        FormatoInesperado: Si le falta o le sobra un campo, o si un año o un número de tabla no tienen su forma.
    """
    exigir(
        isinstance(objeto, dict) and set(objeto) == set(Edicion.__annotations__),
        "TIC-H: el estado de la edición no tiene la forma esperada",
    )
    anio, medidos, tablas, epa = objeto["anio"], objeto["anios_medidos"], objeto["tablas"], objeto["epa_anio"]
    exigir(
        all(isinstance(valor, str) and ANIO.fullmatch(valor) for valor in (anio, epa))
        and isinstance(medidos, list)
        and all(isinstance(valor, str) and ANIO.fullmatch(valor) for valor in medidos)
        and medidos == sorted(set(medidos))
        and bool(medidos)
        and medidos[-1] == anio
        and medidos[0] >= PRIMERA_EDICION
        and epa <= anio
        and isinstance(tablas, dict)
        and set(tablas) == {"uso", "errores"}
        and all(isinstance(valor, str) and TABLA.fullmatch(valor) for valor in tablas.values()),
        "TIC-H: el estado de la edición no tiene años o tablas válidos",
    )
    secciones, documentos = objeto["secciones"], objeto["documentos"]
    exigir(
        isinstance(secciones, dict)
        and set(secciones) == {"espana", "cataluna"}
        and all(type(valor) is int and valor > 0 for valor in secciones.values())
        and isinstance(documentos, dict)
        and set(documentos) == {"metodologia", "cuestionario"}
        and all(isinstance(valor, str) and HUELLA.fullmatch(valor) for valor in documentos.values()),
        "TIC-H: el estado de la edición no tiene secciones en muestra o huellas de documentos válidas",
    )
    return {
        "anio": anio,
        "anios_medidos": list(medidos),
        "tablas": {"uso": tablas["uso"], "errores": tablas["errores"]},
        "epa_anio": epa,
        "secciones": {"espana": secciones["espana"], "cataluna": secciones["cataluna"]},
        "documentos": {"metodologia": documentos["metodologia"], "cuestionario": documentos["cuestionario"]},
    }


def con_lo_leido(edicion: Mapping[str, Any], documentos: Mapping[str, Any]) -> Edicion:
    """La edición con lo que dicen sus documentos: las secciones en muestra y la huella de cada PDF.

    Args:
        edicion: El año, los años medidos, las tablas y el año de la EPA de la edición.
        documentos: Lo leído de sus documentos, con la forma de `documentos_de_la_edicion.leer_documentos`.

    Returns:
        La edición completa, con su forma exigida.
    """
    secciones, enunciado = documentos["secciones_en_muestra"], documentos["enunciado"]
    return valida(
        {
            "anio": edicion["anio"],
            "anios_medidos": edicion["anios_medidos"],
            "tablas": edicion["tablas"],
            "epa_anio": edicion["epa_anio"],
            "secciones": {"espana": secciones["espana"], "cataluna": secciones["cataluna"]},
            "documentos": {"metodologia": secciones["sha256"], "cuestionario": enunciado["sha256_cuestionario"]},
        }
    )


def leer(ruta: Path = ESTADO) -> Edicion:
    """La edición admitida: la del estado, o la primera si aún no hay estado.

    Returns:
        La edición.

    Raises:
        FormatoInesperado: Si el estado existe y no tiene su forma.
    """
    return valida(leer_json(ruta)) if ruta.exists() else primera()


def guardar(edicion: Edicion, ruta: Path = ESTADO) -> None:
    """Escribe el estado entero o nada; solo lo llama `validar` tras admitir el conjunto de esa edición."""
    guardar_json(ruta, valida(edicion))


def carpeta(edicion: Mapping[str, Any], original: Path = ORIGINAL) -> Path:
    """La carpeta de originales de la edición.

    Returns:
        `originales/tich/<año>/`.
    """
    return original / edicion["anio"]


def nombres(edicion: Mapping[str, Any]) -> NombresDelAnio:
    """Los nombres de los originales de la edición y de lo que se lee dentro de sus microdatos.

    Returns:
        Los nombres.
    """
    return nombres_del_anio(edicion["anio"], edicion["tablas"], edicion["epa_anio"])


def archivos(edicion: Mapping[str, Any]) -> list[ArchivoDescargable]:
    """Los originales de la edición con su dirección oficial.

    Returns:
        Los archivos descargables.
    """
    return archivos_del_anio(edicion["anio"], edicion["tablas"], edicion["epa_anio"])


def en_la_operacion(edicion: Mapping[str, Any], registros: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Los registros de los originales de una edición con su ruta dentro de la carpeta de la fuente.

    Returns:
        Los registros, con `archivo` como `<año>/<archivo>`.
    """
    return [{**registro, "archivo": f"{edicion['anio']}/{registro['archivo']}"} for registro in registros]


def _copiar_comprobado(origen: Path, destino: Path, esperada: str) -> None:
    """Copia un original exigiendo su huella antes y después de escribirlo.

    Raises:
        FormatoInesperado: Si el original o su copia no tienen la huella registrada.
    """
    exigir(origen.is_file(), f"TIC-H: falta el original {origen.name}; no se migra")
    datos = origen.read_bytes()
    exigir(sha256_bytes(datos) == esperada, f"TIC-H: {origen.name} no conserva su huella; no se migra")
    if not destino.exists() or sha256(destino) != esperada:
        escribir_bytes_entero(destino, datos)
    exigir(sha256(destino) == esperada, f"TIC-H: la copia de {origen.name} no conserva su huella")


def migrar_originales_planos(original: Path = ORIGINAL) -> bool:
    """Pasa los originales sueltos de la primera edición a su carpeta, sin perder su procedencia.

    Solo actúa si la procedencia de la operación aún registra originales sueltos (sin carpeta de año). Copia cada
    original comprobando su huella, escribe la procedencia del año con sus registros tal como estaban y, solo
    entonces, apunta la de la operación a las copias: hasta ese momento se siguen leyendo los sueltos, que no se
    borran.

    Returns:
        True si ha migrado; False si no había nada que migrar.

    Raises:
        FormatoInesperado: Si un original o su copia no conserva la huella registrada.
    """
    operacion = original / ARCHIVO_DE_PROCEDENCIA
    if not operacion.exists():
        return False
    procedencia: dict[str, Any] = leer_json(operacion)
    registrados = procedencia.get("archivos")
    if (
        not isinstance(registrados, list)
        or not registrados
        or any("/" in entrada["archivo"] for entrada in registrados)
    ):
        return False
    edicion = primera()
    destino = carpeta(edicion, original)
    destino.mkdir(parents=True, exist_ok=True)
    for entrada in registrados:
        _copiar_comprobado(original / entrada["archivo"], destino / entrada["archivo"], entrada["sha256"])
    guardar_json(
        destino / ARCHIVO_DE_PROCEDENCIA,
        {"anio": PRIMERA_EDICION, **{campo: procedencia[campo] for campo in CAMPOS_DEL_ANIO if campo in procedencia}},
    )
    guardar_json(operacion, {**procedencia, "archivos": en_la_operacion(edicion, registrados)})
    return True


def retirar_sueltos_migrados(original: Path, validados: Collection[str], ahora: str) -> list[dict[str, str]]:
    """Retira los originales sueltos de la primera edición cuando sus copias ya se han validado, y lo deja registrado.

    Solo la consulta lo llama, nunca la preparación ni la validación (las de una reconstrucción), y en una consulta en
    la que no ha migrado nada. Retira un suelto solo si se cumplen estas condiciones: la procedencia de la operación ya
    apunta a las copias; la última validación, que está admitida, listó como leídos todos los originales que esa
    procedencia registra, con su ruta de año (`validados`), así que es posterior a la migración; el suelto está
    registrado en la procedencia de su año; y la huella del suelto y la de su copia son, en este momento, la
    registrada. No comprueba nada más. Lo retirado queda en `<año>/sueltos-retirados.json`, con su huella y su instante.

    Args:
        original: La carpeta de originales de la fuente.
        validados: Los originales, con su ruta de año, que leyó la última validación admitida.
        ahora: El instante de la consulta.

    Returns:
        Los retirados en esta consulta.
    """
    operacion = original / ARCHIVO_DE_PROCEDENCIA
    del_anio = carpeta(primera(), original)
    if not validados or not operacion.exists() or not (del_anio / ARCHIVO_DE_PROCEDENCIA).exists():
        return []
    registrados = leer_json(operacion).get("archivos")
    if (
        not isinstance(registrados, list)
        or not all("/" in entrada["archivo"] for entrada in registrados)
        or not {entrada["archivo"] for entrada in registrados} <= set(validados)
    ):
        return []
    retirados = []
    for entrada in procedencia_del_anio(primera(), original).get("archivos", []):
        suelto, copia = original / entrada["archivo"], del_anio / entrada["archivo"]
        if suelto.is_file() and copia.is_file() and sha256(copia) == entrada["sha256"] == sha256(suelto):
            suelto.unlink()
            retirados.append({"archivo": entrada["archivo"], "sha256": entrada["sha256"], "retirado_utc": ahora})
    if retirados:
        registro = del_anio / "sueltos-retirados.json"
        guardar_json(registro, [*(leer_json(registro) if registro.exists() else []), *retirados])
    return retirados


def procedencia_del_anio(edicion: Mapping[str, Any], original: Path = ORIGINAL) -> dict[str, Any]:
    """La procedencia de los originales de la edición, que exige su año.

    Returns:
        La procedencia.

    Raises:
        FormatoInesperado: Si es de otro año.
    """
    procedencia: dict[str, Any] = leer_json(carpeta(edicion, original) / ARCHIVO_DE_PROCEDENCIA)
    if procedencia.get("anio") != edicion["anio"]:
        raise FormatoInesperado(f"TIC-H: la procedencia de {edicion['anio']} declara otro año")
    return procedencia
