"""Plantilla y formación TIC de ETICCE: medidas distintas con su base y periodo publicados.

El contrato fija los literales y las notas de las tablas, nunca sus cifras. Un código de cuestionario repetido no
identifica una medida. No se agregan territorios, actividades o porcentajes ni se calcula exposición individual.
"""

import hashlib
import json
import math

from plataforma_datos.comun.entrada_salida import Json
from plataforma_datos.comun.estadisticas import API_TEMPUS, LICENCIA_INE, SITIO_INE
from plataforma_datos.comun.nucleo import exigir
from plataforma_datos.mercado.fuentes.empresas.piezas import contrato_eticce
from plataforma_datos.mercado.fuentes.empresas.piezas.cifras_empresas import cifras_tempus

type Objeto = dict[str, Json]
IDENTIFICADOR = "eticce-plantilla-tic2026"
RUTA_CONTRATO = contrato_eticce.RUTA_PLANTILLA
PARTES = ("sectores", "comunidades")
TITULO = "Especialistas TIC"
MAX_PORCENTAJE = 100


def contrato() -> Objeto:
    """Lee los bytes contractuales fijados durante la validación.

    Returns:
        Contrato de tablas, variables, notas y periodos revisados.
    """
    return contrato_eticce.cargar_recurso(contrato_eticce.RUTA_PLANTILLA)


def firma(series: list[Objeto]) -> str:
    """Firma los nombres completos y todas las categorías, sin incluir las cifras.

    Returns:
        SHA256 independiente del orden de las series y de los metadatos.
    """
    cifras = cifras_tempus(series)
    exigir(all(set(s["Data"][0]) == {"Valor"} for s in series), "empresas: campos temporales TIC no revisados")
    nombres = [s.get("Nombre") for s in series]
    exigir(all(isinstance(n, str) and n for n in nombres), "empresas: serie TIC sin nombre completo")
    definiciones = [(s["Nombre"], tuple(sorted(c.variables.items()))) for s, c in zip(series, cifras, strict=True)]
    exigir(len(set(definiciones)) == len(definiciones), "empresas: series TIC duplicadas")
    cuerpo = json.dumps(sorted(definiciones), ensure_ascii=False, separators=(",", ":")).encode()
    return hashlib.sha256(cuerpo).hexdigest()


def metadatos(nombre: str, tablas: dict[str, str]) -> Objeto:
    """Admite únicamente las dos tablas revisadas de la edición publicada.

    Returns:
        Identificador y tablas, sin usar la fecha de consulta como periodo estadístico.
    """
    esperado = contrato()
    exigir(nombre == esperado["edicion"], "empresas: edición de plantilla TIC sin contrato revisado")
    exigir(
        tablas == {parte: datos["tabla"] for parte, datos in esperado["partes"].items()},
        "empresas: tablas de plantilla TIC no revisadas o incompletas",
    )
    return {"contrato": IDENTIFICADOR, "tablas": tablas}


def comprobar_edicion(edicion: Objeto) -> None:
    """Recalcula la identidad del bloque declarado antes de resolver sus archivos."""
    exigir(edicion.get("anio") == contrato()["anio"], "empresas: año TIC incompatible con su edición oficial")
    bloque = edicion.get("plantilla_tic")
    exigir(isinstance(bloque, dict), "empresas: falta el bloque de plantilla TIC")
    exigir(
        bloque == metadatos(edicion.get("nombre"), bloque.get("tablas")),
        "empresas: contrato de plantilla TIC desconocido",
    )


def archivos(edicion: Objeto, *, notas: bool = False) -> list[Objeto]:
    """Deriva nombres y URL oficiales cerradas para los datos o las notas de cada tabla.

    Returns:
        Los dos originales de la edición declarada y comprobada.
    """
    comprobar_edicion(edicion)
    return [
        {
            "archivo": f"ine-eticce-{edicion['anio']}-plantilla-{parte}{'-notas.html' if notas else '.json'}",
            "nivel": "oficial",
            "titulo": f"INE ETICCE {edicion['nombre']}: plantilla TIC ({parte}{', notas' if notas else ''})",
            "url": f"{SITIO_INE}/jaxi/Tabla.htm?tpx={tabla}&L=0" if notas else f"{API_TEMPUS}/{tabla}?tip=AM",
            "licencia": LICENCIA_INE,
        }
        for parte, tabla in sorted(edicion["plantilla_tic"]["tablas"].items())
    ]


def comprobar_notas(parte: str, pagina: str) -> None:
    """Exige el listado íntegro de notas, incluidas todas las bases condicionadas."""
    exigir(parte in contrato()["partes"], "empresas: parte TIC desconocida")
    exigir(
        contrato_eticce.notas_publicadas(pagina) == contrato()["partes"][parte]["notas"],
        "empresas: cambian las notas o las bases de plantilla TIC",
    )


def _valor(valor: Json) -> float | int | None:
    exigir(
        valor is None or (type(valor) in (int, float) and math.isfinite(valor) and 0 <= valor <= MAX_PORCENTAJE),
        "empresas: porcentaje TIC inválido; no convertir nulos, booleanos ni marcas en cifras",
    )
    return valor


def _fila(serie: Objeto, parte: str, tabla: str, definicion: Objeto) -> Objeto:
    variables = {m["T3_Variable"]: m["Nombre"] for m in serie["MetaData"]}
    literal = variables["Principales variables"]
    medida = definicion["variables"][literal]
    return {
        "tabla": tabla,
        "serie": serie["Nombre"],
        "variable": literal,
        "nota": medida["nota"],
        "base": medida["base"],
        "unidad": medida["unidad"],
        "periodo": medida["periodo"],
        "origen_periodo": medida["origen_periodo"],
        "precision_periodo": medida["precision_periodo"],
        "territorio": variables["Comunidades y ciudades autónomas"] if parte == "comunidades" else "España",
        "dimensiones": variables,
        "valor": _valor(serie["Data"][0]["Valor"]),
    }


def comprobar_series(parte: str, series: list[Objeto], edicion: Objeto) -> list[Objeto]:
    """Comprueba toda la estructura y las cifras antes de conservar una respuesta.

    Returns:
        Filas sin agregación, pendientes de la comprobación separada de las notas oficiales.
    """
    comprobar_edicion(edicion)
    definicion = contrato()
    exigir(parte in definicion["partes"], "empresas: parte TIC desconocida")
    esperado = definicion["partes"][parte]
    exigir(firma(series) == esperado["sha256_definicion"], "empresas: cambia la definición de plantilla TIC")
    return [_fila(s, parte, esperado["tabla"], definicion) for s in series]


def normalizar(parte: str, series: list[Objeto], pagina_notas: str, edicion: Objeto) -> list[Objeto]:
    """Conserva cada serie literal y sus dimensiones, nota, base, unidad y periodo.

    Returns:
        Una fila por serie, sin fusionar códigos ni sustituir los valores nulos.
    """
    filas = comprobar_series(parte, series, edicion)
    comprobar_notas(parte, pagina_notas)
    return filas


def mismas_filas(esperadas: list[Objeto], recibidas: list[Objeto]) -> bool:
    """Compara el JSON sin confundir 0 con false ni admitir claves o tipos añadidos.

    Returns:
        True solo si ambas representaciones JSON canónicas son iguales.
    """
    opciones = {"sort_keys": True, "ensure_ascii": False, "allow_nan": False}
    return json.dumps(esperadas, **opciones) == json.dumps(recibidas, **opciones)
