"""Metadatos abiertos de ocupados y partes temporales de Taules por debajo de su límite oficial.

Cada descriptor representa un GET y un original HTTP íntegro. El plan es puro: depende únicamente de las cuatro
respuestas oficiales de metadatos, conserva la geografía del producto y nunca recorta años para hacerlos caber.
"""

import datetime
import math
import re
from collections.abc import Callable, Iterator, Mapping
from typing import Any

from plataforma_datos.comun.lugares import COMARCAS_DE_LA_ZONA
from plataforma_datos.comun.nucleo import ArchivoDescargable, FormatoInesperado, exigir
from plataforma_datos.comun.observacion_remota import MAX_PETICIONES
from plataforma_datos.mercado.fuentes.ocupados.piezas.constantes_ocupados import (
    ANIOS,
    ARCHIVOS,
    ARCHIVOS_AUXILIARES,
    CATALUNA_IDESCAT,
    DIMENSION_OCUPACION,
    METADATOS_IDESCAT,
    MUNICIPIOS,
    PLANTILLA_DEL_TITULO,
    SEXO_IDESCAT,
)
from plataforma_datos.mercado.fuentes.ocupados.piezas.rotulos_ocupados import componer

# Límite documentado de Taules por petición de datos; los metadatos llevan value:[] y no materializan el producto.
MAX_CELDAS_IDESCAT = 20_000
METODO_DECENAL = "Idescat, a partir del Censo de población y viviendas del INE."


def fecha_actualizada(valor: object) -> datetime.date:
    """Comprueba la fecha literal de actualización del Idescat.

    Returns:
        Fecha comprobada.

    Raises:
        FormatoInesperado: Si no es AAAA-MM-DD o no existe en el calendario.
    """
    exigir(
        isinstance(valor, str) and re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", valor) is not None,
        f"fecha de actualización del Idescat no válida: {valor!r}",
    )
    try:
        return datetime.date.fromisoformat(valor)
    except ValueError as error:
        raise FormatoInesperado(f"fecha de actualización del Idescat no válida: {valor!r}") from error


def _categorias(tabla: dict[str, Any], dimension: str) -> tuple[str, ...]:
    dimensiones = tabla.get("dimension")
    exigir(isinstance(dimensiones, dict), "ocupados Idescat: dimensiones ausentes o inválidas")
    detalle = dimensiones.get(dimension)
    exigir(isinstance(detalle, dict), f"ocupados Idescat: dimensión inválida {dimension}")
    categoria = detalle.get("category")
    exigir(isinstance(categoria, dict), f"ocupados Idescat: categorías inválidas en {dimension}")
    indice = categoria.get("index")
    exigir(isinstance(indice, (list, dict)) and bool(indice), f"ocupados Idescat: categorías de {dimension}")
    exigir(
        all(isinstance(codigo, str) for codigo in indice) and len(indice) == len(set(indice)),
        f"ocupados Idescat: categorías duplicadas o inválidas en {dimension}",
    )
    if isinstance(indice, dict):
        exigir(
            all(type(posicion) is int for posicion in indice.values())
            and sorted(indice.values()) == list(range(len(indice))),
            f"ocupados Idescat: posiciones de {dimension}",
        )
        return tuple(sorted(indice, key=indice.get))
    return tuple(indice)


def _anios(tabla: dict[str, Any], completa: bool) -> tuple[str, ...]:
    anios = _categorias(tabla, "YEAR")
    exigir(
        all(re.fullmatch(r"[0-9]{4}", anio) and anio >= ANIOS[0] for anio in anios),
        "ocupados Idescat: año no anual canónico desde 2021",
    )
    ordenados = tuple(sorted(anios))
    exigir(
        ordenados == tuple(str(anio) for anio in range(int(ordenados[0]), int(ordenados[-1]) + 1)),
        "ocupados Idescat: serie con huecos",
    )
    exigir(not completa or set(ANIOS) <= set(anios), "ocupados Idescat: años históricos ausentes")
    exigir(
        str(fecha_actualizada(tabla.get("updated")).year) >= ordenados[-1],
        "ocupados Idescat: año posterior a la fecha de actualización",
    )
    return ordenados


def _fuentes(tabla: dict[str, Any], anios: tuple[str, ...]) -> None:
    extension = tabla.get("extension")
    exigir(isinstance(extension, dict), "ocupados Idescat: extensión de fuentes ausente")
    fuentes = extension.get("source")
    exigir(
        isinstance(fuentes, list)
        and bool(fuentes)
        and all(isinstance(fuente, str) for fuente in fuentes)
        and tabla.get("source") == " ".join(fuentes),
        "ocupados Idescat: fuentes ausentes o incompatibles",
    )
    cubiertos: set[str] = set()
    for fuente in fuentes:
        coincidencia = re.fullmatch(
            r"(?:([0-9]{4})"
            r"(?:-([0-9]{4}))?: )?"
            r"(Idescat, a partir del Censo de población (?:y viviendas|anual) del INE\.)",
            fuente,
        )
        exigir(coincidencia is not None, "ocupados Idescat: base censal desconocida")
        primero, ultimo, metodo = coincidencia.groups()
        propios = {anio for anio in anios if (anio == "2021") == (metodo == METODO_DECENAL)}
        declarados = {str(anio) for anio in range(int(primero), int(ultimo or primero) + 1)} if primero else propios
        exigir(
            bool(propios) and declarados == propios and not cubiertos.intersection(propios),
            "ocupados Idescat: base decenal de 2021 o anual desde 2022 distinta o incompleta",
        )
        cubiertos.update(propios)
    exigir(cubiertos == set(anios), "ocupados Idescat: base censal sin cobertura de todos los años")


def _estructura(tabla: dict[str, Any], territorio: str) -> None:
    dimensiones = ["YEAR", territorio, DIMENSION_OCUPACION, "SEX", "CONCEPT"]
    exigir(
        isinstance(tabla, dict) and tabla.get("class") == "dataset" and tabla.get("id") == dimensiones,
        "ocupados Idescat: dimensiones distintas de las solicitadas",
    )
    exigir(
        isinstance(tabla.get("dimension"), dict) and set(tabla["dimension"]) == set(dimensiones),
        "ocupados Idescat: dimensión ausente o adicional",
    )
    categorias = {dimension: _categorias(tabla, dimension) for dimension in dimensiones}
    exigir(
        isinstance(tabla.get("size"), list)
        and all(type(tamano) is int and tamano > 0 for tamano in tabla["size"])
        and tabla["size"] == [len(categorias[dimension]) for dimension in dimensiones],
        "ocupados Idescat: tamaño distinto de las categorías",
    )
    exigir(set(categorias["SEX"]) == set(SEXO_IDESCAT), "ocupados Idescat: sexo distinto o incompleto")
    exigir(
        categorias["CONCEPT"] == ("POP_EMP",)
        and tabla["dimension"]["CONCEPT"]["category"].get("unit") == {"POP_EMP": {"decimals": 0}},
        "ocupados Idescat: concepto o unidad distinta de personas ocupadas",
    )


def comprobar_datos(tabla: dict[str, Any], territorio: str) -> None:
    """Comprueba una captura histórica completa; no impone el límite HTTP a originales ya conservados."""
    _estructura(tabla, territorio)
    _fuentes(tabla, _anios(tabla, completa=True))
    exigir(
        isinstance(tabla.get("value"), list) and len(tabla["value"]) == math.prod(tabla["size"]),
        "ocupados Idescat: valores incompletos o no posicionales",
    )


def _comprobar_metadatos(tabla: dict[str, Any], numero: int) -> tuple[str, ...]:
    dimension, territorios = (
        ("CAT", {CATALUNA_IDESCAT}),
        ("CAT", {CATALUNA_IDESCAT}),
        ("COM", set(COMARCAS_DE_LA_ZONA)),
        ("MUN", set(MUNICIPIOS)),
    )[numero]
    _estructura(tabla, dimension)
    anios = _anios(tabla, completa=True)
    _fuentes(tabla, anios)
    exigir(tabla.get("value") == [] and not tabla.get("status"), "ocupados Idescat: metadatos con valores o estados")
    exigir(set(_categorias(tabla, dimension)) == territorios, "ocupados Idescat: geografía distinta del producto")
    patron = r"[A-Q][0-9]{3}" if numero == 0 else r"[A-Q][0-9]{2}"
    exigir(
        all(
            codigo in ("TOTAL", "_U") or re.fullmatch(patron, codigo)
            for codigo in _categorias(tabla, DIMENSION_OCUPACION)
        ),
        "ocupados Idescat: códigos CNO no canónicos",
    )
    return anios


def _partes(archivo: ArchivoDescargable, tabla: dict[str, Any]) -> list[ArchivoDescargable]:
    anios = tuple(sorted(_categorias(tabla, "YEAR")))
    por_anio = math.prod(tabla["size"][1:])
    capacidad = MAX_CELDAS_IDESCAT // por_anio
    exigir(capacidad > 0, "ocupados Idescat: un año supera 20.000 celdas; requiere revisión de la consulta")
    partes = []
    for comienzo in range(0, len(anios), capacidad):
        bloque = anios[comienzo : comienzo + capacidad]
        partes.append(
            {
                **archivo,
                "archivo": f"{archivo['archivo'][:-5]}-{bloque[0]}-{bloque[-1]}.json",
                "titulo": componer(PLANTILLA_DEL_TITULO[archivo["archivo"]], periodo=f"{bloque[0]}–{bloque[-1]}"),
                "url": f"{archivo['url']}&YEAR={','.join(bloque)}",
            }
        )
    return partes


def planificar_partes(metadatos: Mapping[str, dict[str, Any]]) -> list[ArchivoDescargable]:
    """Deriva todas las partes temporales de las cuatro respuestas de metadatos sin modificar sus documentos.

    Returns:
        Descriptores de datos en el orden de tablas y de años, sin metadatos ni auxiliares.
    """
    exigir(
        isinstance(metadatos, Mapping) and set(metadatos) == {archivo["archivo"] for archivo in METADATOS_IDESCAT},
        "ocupados Idescat: se requieren los cuatro metadatos exactos",
    )
    periodos, clasificaciones, partes = [], [], []
    for numero, archivo in enumerate(METADATOS_IDESCAT):
        tabla = metadatos[archivo["archivo"]]
        periodos.append(_comprobar_metadatos(tabla, numero))
        if numero:
            clasificaciones.append(set(_categorias(tabla, DIMENSION_OCUPACION)))
        partes.extend(_partes(ARCHIVOS[numero], tabla))
    exigir(all(periodo == periodos[0] for periodo in periodos), "ocupados Idescat: años distintos entre metadatos")
    exigir(
        all(codigos == clasificaciones[0] for codigos in clasificaciones),
        "ocupados Idescat: CNO-11 distinta entre ámbitos de dos cifras",
    )
    exigir(
        len(METADATOS_IDESCAT) + len(partes) + len(ARCHIVOS_AUXILIARES) <= MAX_PETICIONES,
        "ocupados Idescat: el plan completo supera el límite de peticiones; requiere revisión",
    )
    return partes


def comprobar_parte(tabla: dict[str, Any], metadato: dict[str, Any], anios: tuple[str, ...]) -> None:
    """Exige el bloque YEAR exacto, categorías, método, fecha y valores íntegros de una parte HTTP."""
    territorio = metadato["id"][1]
    _estructura(tabla, territorio)
    exigir(
        _anios(tabla, completa=False) == anios and set(anios) <= set(_categorias(metadato, "YEAR")),
        "ocupados Idescat: YEAR de la parte distinto del plan",
    )
    _fuentes(tabla, anios)
    for dimension in metadato["id"][1:]:
        exigir(
            tabla["dimension"][dimension] == metadato["dimension"][dimension],
            f"ocupados Idescat: categorías o unidades distintas en la parte ({dimension})",
        )
    exigir(
        tabla.get("updated") == metadato.get("updated"),
        "ocupados Idescat: la parte y los metadatos pertenecen a revisiones distintas",
    )
    exigir(
        math.prod(tabla["size"]) <= MAX_CELDAS_IDESCAT
        and isinstance(tabla.get("value"), list)
        and len(tabla["value"]) == math.prod(tabla["size"]),
        "ocupados Idescat: parte incompleta o superior a 20.000 celdas",
    )


def tablas_del_plan(
    metadatos: Mapping[str, dict[str, Any]], partes: list[dict[str, Any]], lector: Callable[[str], dict[str, Any]]
) -> Iterator[tuple[str, dict[str, Any]]]:
    """Lee solo los originales enumerados por el plan y comprueba el alcance exacto de cada uno.

    Yields:
        Nombre histórico de tabla y cada respuesta íntegra que la compone.
    """
    for archivo, meta in zip(ARCHIVOS[:4], METADATOS_IDESCAT, strict=True):
        for parte in partes:
            if parte["url"].startswith(archivo["url"] + "&YEAR="):
                anios = tuple(parte["url"].partition("&YEAR=")[2].split(","))
                tabla = lector(parte["archivo"])
                comprobar_parte(tabla, metadatos[meta["archivo"]], anios)
                yield archivo["archivo"], tabla


def comprobar_plan(
    metadatos: Mapping[str, dict[str, Any]], partes: list[dict[str, Any]], lector: Callable[[str], dict[str, Any]]
) -> None:
    """Comprueba, antes de registrar la descarga, que cada parte del plan es de una de sus tablas y cubre su alcance.

    Raises:
        FormatoInesperado: Si una parte no cubre su alcance o no pertenece a ninguna tabla del plan.
    """
    comprobadas = [nombre for nombre, _tabla in tablas_del_plan(metadatos, partes, lector)]
    exigir(len(comprobadas) == len(partes), "ocupados: el plan trae partes que no son de ninguna de sus tablas")
