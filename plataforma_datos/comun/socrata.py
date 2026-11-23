"""Cliente de Dades Obertes de Catalunya: la API pública (Socrata) de analisi.transparenciacatalunya.cat.

Lo comparten las fuentes que leen conjuntos de Dades Obertes. Cada conjunto se descarga entero (o las filas de su
filtro) en un orden fijo, junto con sus metadatos, en una copia que lleva en el nombre el día de la descarga. Los
metadatos cambian en cada petición (cuentan visitas y descargas): dos descargas del mismo día son la misma copia si
dicen lo mismo de los datos, su instante de actualización y sus recuentos. Python estándar.
"""

import json
import re
import shutil
import tempfile
import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any, NamedTuple
from urllib.parse import urlencode

from plataforma_datos.comun import red
from plataforma_datos.comun.entrada_salida import guardar_json, hoy_utc, leer_json, original, sha256_bytes
from plataforma_datos.comun.nucleo import (
    CAMPOS_OPCIONALES_DE_PROCEDENCIA,
    ArchivoDescargable,
    Descarga,
    EntradaDeDescarga,
    FormatoInesperado,
    ReglaDeCambio,
    exigir,
)
from plataforma_datos.comun.red import descargar_originales
from plataforma_datos.orquestacion import sustitucion

API = "https://analisi.transparenciacatalunya.cat"
# robots.txt de la API (comprobado el 05/10/2026): «Crawl-delay: 1»; la política común exige al menos 2 segundos.
# La pausa explícita se conserva; red aplica además el turno por dominio a peticiones, redirecciones y errores.
PAUSA_DE_SOCRATA_S = red.PAUSA_ENTRE_PETICIONES_S
# Filas por petición: muy por encima del conjunto mayor que se lee (5.306 filas de 7vig-4syr). Una descarga que llegue a
# este número puede haberse cortado: cada fuente lo comprueba al validar.
LIMITE_FILAS = 50000
# Licencia de los conjuntos de la Generalitat; `cita` es el organismo que publica cada uno.
LICENCIA_DE_LA_GENERALITAT = (
    "Llicència oberta d'ús d'informació – Catalunya (https://web.gencat.cat/ca/generalitat/dades-indicadors/"
    "dades-obertes/llicencies): citar la fuente{cita} e informar de la fecha de la última actualización; no alterar el "
    "contenido ni desnaturalizar su sentido; sin sublicencia ni uso de logotipos, marcas o símbolos de la Generalitat."
)


class Conjunto(NamedTuple):
    """Un conjunto de Dades Obertes: identificador, título, licencia y, si solo se leen unas filas, su filtro (SoQL)."""

    identificador: str
    titulo: str
    licencia: str
    filtro: str | None = None


class RutasDeLaCopia(NamedTuple):
    """Carpeta de originales y archivo de procedencia de una copia diaria de Socrata."""

    original: Path
    procedencia: Path


def nombre_de_datos(conjunto: Conjunto, fecha: str) -> str:
    """Archivo con las filas de un conjunto en la copia del día `fecha`.

    Returns:
        El nombre del archivo.
    """
    return f"{conjunto.identificador}-{fecha}.json"


def nombre_de_metadatos(conjunto: Conjunto, fecha: str) -> str:
    """Archivo con los metadatos de un conjunto en la copia del día `fecha`.

    Returns:
        El nombre del archivo.
    """
    return f"{conjunto.identificador}-{fecha}-metadatos.json"


def url_de_datos(conjunto: Conjunto) -> str:
    """Dirección de la API que devuelve todas las filas de un conjunto (o las de su filtro), en un orden fijo.

    Returns:
        La dirección de la API.
    """
    consulta = {"$limit": str(LIMITE_FILAS), "$order": ":id"}
    if conjunto.filtro:
        consulta["$where"] = conjunto.filtro
    return f"{API}/resource/{conjunto.identificador}.json?{urlencode(consulta)}"


def _mismos_metadatos(previo: bytes, nuevo: bytes, contexto: str = "Socrata") -> bool:
    """Si dos metadatos tienen los mismos recuentos y el mismo instante de actualización.

    Returns:
        Si dicen lo mismo de sus datos, sin perder la hora que usa el emparejamiento de ofertas.
    """
    anterior, actual = json.loads(previo), json.loads(nuevo)
    return metadatos(anterior, contexto) == metadatos(actual, contexto) and actualizado_utc(
        anterior, contexto
    ) == actualizado_utc(actual, contexto)


def actualizado_utc(contenido: dict[str, Any], contexto: str = "Socrata") -> str:
    """Instante ISO (UTC) de la última actualización de las filas según rowsUpdatedAt.

    Returns:
        El instante en formato ISO, en UTC.

    Raises:
        FormatoInesperado: Si rowsUpdatedAt no es un instante Unix entero representable.
    """
    exigir(isinstance(contenido, dict), f"{contexto}: los metadatos deben ser un objeto")
    instante = contenido.get("rowsUpdatedAt")
    exigir(type(instante) is int, f"{contexto}: rowsUpdatedAt debe ser un instante Unix entero")
    try:
        return datetime.fromtimestamp(instante, tz=UTC).isoformat()
    except (OverflowError, OSError, ValueError) as error:
        raise FormatoInesperado(f"{contexto}: rowsUpdatedAt fuera del intervalo de fechas: {instante}") from error


def _recuento(valor: object, campo: str, contexto: str) -> int:
    """Lee un recuento natural sin truncar decimales ni convertir booleanos.

    Returns:
        El recuento entero no negativo.
    """
    valido = (type(valor) is int and valor >= 0) or (
        isinstance(valor, str) and re.fullmatch(r"[0-9]+", valor) is not None
    )
    exigir(valido, f"{contexto}: {campo} debe ser un recuento entero no negativo")
    return int(valor)


def _reparto_por_origen(columna: dict[str, Any], contexto: str) -> dict[str, int]:
    """Comprueba y lee el reparto de filas que publica la columna origen.

    Returns:
        El recuento por nombre de origen.
    """
    recuento = columna.get("cachedContents")
    exigir(isinstance(recuento, dict), f"{contexto}: origen.cachedContents debe ser un objeto")
    valores = recuento.get("top")
    exigir(isinstance(valores, list), f"{contexto}: origen.cachedContents.top debe ser una lista")
    por_origen: dict[str, int] = {}
    for valor in valores:
        exigir(isinstance(valor, dict), f"{contexto}: cada elemento de origen.top debe ser un objeto")
        nombre = valor.get("item")
        exigir(isinstance(nombre, str) and bool(nombre), f"{contexto}: origen.top.item debe ser texto no vacío")
        por_origen[nombre] = _recuento(valor.get("count"), "origen.top.count", contexto)
    return por_origen


def metadatos(contenido: dict[str, Any], contexto: str = "Socrata") -> dict[str, Any]:
    """Fecha de actualización, número de filas y, si lo tiene, reparto por origen, con esquema comprobado.

    Returns:
        La fecha de actualización, el número de filas y su reparto por origen.
    """
    actualizado = actualizado_utc(contenido, contexto)[: len("AAAA-MM-DD")]
    columnas = contenido.get("columns")
    exigir(isinstance(columnas, list) and bool(columnas), f"{contexto}: columns debe ser una lista no vacía")
    por_origen: dict[str, int] = {}
    for columna in columnas:
        exigir(isinstance(columna, dict), f"{contexto}: cada elemento de columns debe ser un objeto")
        campo = columna.get("fieldName")
        exigir(isinstance(campo, str) and bool(campo), f"{contexto}: columns.fieldName debe ser texto no vacío")
        if campo == "origen":
            por_origen = _reparto_por_origen(columna, contexto)
    # cachedContents cuenta nulos y no nulos: la suma de la primera columna da todas las filas.
    recuento = columnas[0].get("cachedContents")
    exigir(isinstance(recuento, dict), f"{contexto}: columns[0].cachedContents debe ser un objeto")
    return {
        "actualizado": actualizado,
        "filas_segun_metadatos": _recuento(recuento.get("non_null"), "cachedContents.non_null", contexto)
        + _recuento(recuento.get("null"), "cachedContents.null", contexto),
        "filas_por_origen": por_origen,
    }


def equivalencia(archivo: ArchivoDescargable) -> Callable[[bytes, bytes], bool] | None:
    """Regla que decide si dos descargas del mismo día son la misma copia.

    Los metadatos se comparan por contenido (instante de actualización y recuentos); para los datos no hay regla propia
    (None): la copia es la misma si los bytes son idénticos.

    Returns:
        La función que decide si dos descargas son la misma copia, o None si no hay criterio.
    """
    if archivo["archivo"].endswith("-metadatos.json"):
        return lambda previo, nuevo: _mismos_metadatos(previo, nuevo, archivo["archivo"])
    return None


def archivos_de_la_copia(conjuntos: tuple[Conjunto, ...], fecha: str) -> list[ArchivoDescargable]:
    """Los originales de una copia: las filas y los metadatos de cada conjunto, con su dirección oficial.

    Returns:
        Los archivos de la copia, con su dirección oficial.
    """
    archivos: list[ArchivoDescargable] = []
    for conjunto in conjuntos:
        comun = {"nivel": "oficial", "licencia": conjunto.licencia}
        archivos.append(
            {
                **comun,
                "archivo": nombre_de_datos(conjunto, fecha),
                "titulo": conjunto.titulo,
                "url": url_de_datos(conjunto),
            }
        )
        archivos.append(
            {
                **comun,
                "archivo": nombre_de_metadatos(conjunto, fecha),
                "titulo": f"Metadatos de {conjunto.identificador}: recuento y fecha de la última actualización",
                "url": f"{API}/api/views/{conjunto.identificador}.json",
            }
        )
    return archivos


def _conservar_respuesta(archivo: ArchivoDescargable, descarga: Descarga, capturas: Path) -> None:
    """Conserva el cuerpo recibido antes de compararlo con los originales admitidos."""
    capturado = red.ahora_utc()
    capturas.mkdir(exist_ok=True)
    respuesta = Path(tempfile.mkdtemp(prefix="respuesta-", dir=capturas))
    (respuesta / "cuerpo.json").write_bytes(descarga.datos)
    guardar_json(
        respuesta / "respuesta.json",
        {
            **archivo,
            "url_final": descarga.url_final,
            "content_type": descarga.content_type,
            "capturado_utc": capturado,
            "sha256": sha256_bytes(descarga.datos),
            "bytes": len(descarga.datos),
            "cuerpo": "cuerpo.json",
            "alcance": "respuesta_recibida_sin_acreditar_admision",
        },
    )


def _descargar_con_evidencia(
    archivo: ArchivoDescargable, carpeta: Path, aceptar_cambio: bool, capturas: Path
) -> EntradaDeDescarga:
    """Conserva también una respuesta que la política común rechace inmediatamente.

    Returns:
        El registro del contenido conservado, con las reglas y fechas de red.
    """
    previo = red.registros_previos(carpeta / "procedencia.json").get(archivo["archivo"])
    regla = ReglaDeCambio(equivalencia(archivo), previo["sha256"] if previo else None, aceptar_cambio)
    descarga = red.descargar_url(archivo["url"])
    _conservar_respuesta(archivo, descarga, capturas)
    datos = red.conservar_o_sustituir(carpeta / archivo["archivo"], descarga, regla)
    red.observar_original(archivo["url"], descarga, datos)
    declarados = {campo: archivo[campo] for campo in CAMPOS_OPCIONALES_DE_PROCEDENCIA if campo in archivo}
    registro = red.registro_descarga(archivo, descarga, datos, previo, **declarados)
    print(archivo["archivo"], len(datos), "bytes")
    return registro


def descargar_copia(
    conjuntos: tuple[Conjunto, ...], fecha: str, carpeta: Path, aceptar_cambio: bool, *, capturas: Path | None = None
) -> list[EntradaDeDescarga]:
    """Descarga la copia del día en `carpeta`, un archivo por petición con la pausa del robots.txt; da sus registros.

    Una copia del mismo día que ya no coincide con su huella detiene la descarga, salvo con `aceptar_cambio`.
    Si se indica capturas, conserva allí cada cuerpo recibido antes de aplicar esa política, incluso si se rechaza.

    Returns:
        Los registros de lo descargado.
    """
    registros: list[EntradaDeDescarga] = []
    for archivo in archivos_de_la_copia(conjuntos, fecha):
        if capturas is None:
            registros += descargar_originales([archivo], carpeta, aceptar_cambio, equivalencia)
        else:
            registros.append(_descargar_con_evidencia(archivo, carpeta, aceptar_cambio, capturas))
        time.sleep(PAUSA_DE_SOCRATA_S)
    return registros


def leer_copia(
    fuente: str, conjuntos: tuple[Conjunto, ...], fecha: str
) -> tuple[dict[str, list[dict[str, Any]]], dict[str, dict[str, Any]]]:
    """Filas y metadatos de cada conjunto de la copia del día `fecha`, cada original comprobado con su huella.

    Returns:
        Las filas y los metadatos de cada conjunto, por clave del conjunto.
    """
    filas = {
        conjunto.identificador: leer_json(original(fuente, nombre_de_datos(conjunto, fecha))) for conjunto in conjuntos
    }
    resumen = {
        conjunto.identificador: metadatos(
            leer_json(original(fuente, nombre_de_metadatos(conjunto, fecha))), nombre_de_metadatos(conjunto, fecha)
        )
        for conjunto in conjuntos
    }
    return filas, resumen


def _anotar_fallo(area: Path, manifiesto: dict[str, Any], error: BaseException) -> None:
    """Intenta registrar la causa sin ocultarla si también falla la escritura diagnóstica."""
    diagnostico = {"tipo": type(error).__name__, "mensaje": str(error)}
    error.add_note(f"Intento Socrata conservado para revisión: {area}")
    try:
        guardar_json(area / "intento.json", {**manifiesto, "estado": "fallido", "error": diagnostico})
    except Exception as fallo:
        error.add_note(f"No se pudo registrar el manifiesto de fallo: {type(fallo).__name__}: {fallo}")
        try:
            with (area / "fallo-manifiesto.txt").open("x", encoding="utf-8") as respaldo:
                respaldo.write(
                    json.dumps(
                        {
                            "propietario": manifiesto["propietario"],
                            "intento": manifiesto["intento"],
                            "originales": manifiesto["originales"],
                            "error_original": diagnostico,
                            "error_manifiesto": str(fallo),
                        }
                    )
                )
        except Exception as segundo:
            error.add_note(f"Tampoco pudo escribirse el diagnóstico alternativo: {segundo}")


@contextmanager
def _intento_de_copia(control: Path, manifiesto: dict[str, Any]) -> Iterator[Path]:
    """Crea una identidad exclusiva y conserva el intento tanto si termina como si falla.

    Yields:
        El área recién creada por esta llamada; ninguna carpeta preexistente se recorre ni retira.
    """
    area = Path(tempfile.mkdtemp(prefix="candidata-", dir=control))
    manifiesto.update(propietario="socrata.registrar_copia", intento=area.name, estado="en_curso")
    try:
        guardar_json(area / "intento.json", manifiesto)
        yield area
    except BaseException as error:
        _anotar_fallo(area, manifiesto, error)
        raise


def _completar_intento(area: Path, originales: Path, manifiesto: dict[str, Any]) -> None:
    """Retira solo la copia propia que acaba de publicarse y conserva manifiesto y capturas.

    Raises:
        OSError: Si la candidata no coincide con lo publicado o cambió su manifiesto; no autoriza su retirada.
    """
    candidata = area / originales.name
    if leer_json(area / "intento.json") != manifiesto:
        raise OSError("cambió la identidad del intento; no se retira la candidata")
    if sustitucion.huellas_del_arbol(candidata) != sustitucion.huellas_del_arbol(originales):
        raise OSError("la candidata no coincide con lo publicado; se conserva para revisión")
    guardar_json(area / "intento.json", {**manifiesto, "estado": "completado"})
    shutil.rmtree(candidata)


def registrar_copia(
    conjuntos: tuple[Conjunto, ...],
    rutas: RutasDeLaCopia,
    cabecera: dict[str, str],
    aceptar_cambio: bool,
    hoy: date | None = None,
) -> None:
    """Prepara la copia completa y admite juntos los datos, metadatos y procedencia.

    Conserva la política de cambio, las equivalencias y las capturas previas de red. Serializa escritores de esta
    carpeta y recupera una promoción cortada antes de descargar de nuevo. Conserva los intentos y sus capturas crudas
    fuera de lo vigente, con identidad y causa si fallan. No realiza purga de intentos anteriores. Los lectores pueden
    observar una ausencia transitoria entre renombres si no usan el mismo cerrojo. No es una sustitución de carpeta
    estrictamente atómica del sistema.

    Raises:
        ValueError: Si procedencia no está en la carpeta propia de originales, o esta raíz es un enlace.
    """
    if rutas.procedencia != rutas.original / "procedencia.json" or rutas.original.is_symlink():
        raise ValueError("Socrata exige procedencia.json en la carpeta propia de originales, sin raíz enlazada")
    fecha = (hoy or hoy_utc()).isoformat()
    raiz, relativa = rutas.original.parent, rutas.original.name
    control = raiz / f".{relativa}-socrata"
    diario = control / "diario.json"
    with sustitucion.cerrojo(raiz, carpeta=control):
        sustitucion.recuperar(raiz, (relativa,), diario)
        manifiesto = {
            "version": 1,
            "originales": str(rutas.original),
            "cabecera": cabecera,
            "copia": fecha,
            "aceptar_cambio": aceptar_cambio,
            "archivos_esperados": archivos_de_la_copia(conjuntos, fecha),
        }
        with _intento_de_copia(control, manifiesto) as area:
            candidata = area / relativa
            if rutas.original.exists():
                shutil.copytree(rutas.original, candidata, symlinks=True)
            else:
                candidata.mkdir()
            registros = descargar_copia(conjuntos, fecha, candidata, aceptar_cambio, capturas=area / "capturas")
            guardar_json(candidata / "procedencia.json", {**cabecera, "copia": fecha, "archivos": registros})
            sustitucion.sustituir(raiz, area, (relativa,), diario)
            _completar_intento(area, rutas.original, manifiesto)
