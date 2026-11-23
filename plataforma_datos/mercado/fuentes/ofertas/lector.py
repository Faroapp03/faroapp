"""Puestos ofertados por el SOC y Feina Activa en Cataluña, del Excel mensual del Observatori del Treball.

El Observatori publica cada mes un libro `Ofertes_AAAAMM.xlsx` con el acumulado de enero a ese mes, en una dirección
con su año y su mes. El mes vigente se descubre en la fuente: se consulta la dirección de cada mes, del en curso al
último conocido incluido (así se ve también una revisión de ese libro), y el primero que existe es el vigente. Con él se
descarga el libro del mismo mes del año anterior, con el que se compara (las variaciones del propio libro no se usan:
su nota CCAE-2025 avisa de una ruptura). Si ese libro no se encuentra, la fuente se detiene con su motivo, retira el
libro nuevo de originales/ y conserva lo publicado. Los libros se eligen por su fecha, nunca por el orden de sus
nombres. Python estándar.

Uso: python3 -m plataforma_datos.mercado.fuentes.ofertas.lector {descargar,preparar,validar,todo} [--aceptar-cambio]
"""

import sys
from pathlib import Path
from typing import Any
from urllib.error import HTTPError

from plataforma_datos.comun.descarga_acotada import Contrato, descargar_acotados
from plataforma_datos.comun.dia_de_consulta import dia_iso_en_cataluna
from plataforma_datos.comun.entrada_salida import (
    ahora_utc,
    carpetas,
    comprobar_originales,
    controles_de_huella,
    entradas_procedencia,
    guardar_json,
    hoy_utc,
    leer_json,
    original,
    ruta_del_conjunto,
)
from plataforma_datos.comun.nucleo import (
    ARCHIVO_DE_PROCEDENCIA,
    ArchivoDescargable,
    Controles,
    FormatoInesperado,
    exigir,
)
from plataforma_datos.mercado.fuentes.ofertas.piezas.libro_de_ofertas import (
    MESES,
    MESES_CATALAN,
    elegir_libros,
    fecha_del_libro,
    nombre_del_libro,
    ofertas_de_un_libro,
)
from plataforma_datos.orquestacion.admision import cerrar_validacion
from plataforma_datos.orquestacion.ordenes import principal_fuente_con_descarga

FUENTE = "ofertas"
LIBROS = "libros.json"
NOMBRE = "Observatori del Treball i Model Productiu · Estadística d'ofertes de llocs de treball (SOC i Feina Activa)"
PAGINA = "https://observatoritreball.gencat.cat/ca/ambits_tematics/treball/ofertes_llocs_treball/"
BASE = "https://observatoritreball.gencat.cat/web/.content/generic/documents/treball/estadistica/ofertes"
LICENCIA = (
    "Avís legal de la Generalitat (https://tramits.gencat.cat/ca/ajuda/avis_legal/), régimen de la Llicència oberta "
    "d'ús d'informació – Catalunya: reutilización citando la fuente y la fecha de actualización, sin desnaturalizar la "
    "información (art. 17.1 de la Ley 19/2014 y art. 8 de la Ley 37/2007). El Excel no declara licencia específica."
)
TIPOS_XLSX = ("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/octet-stream")
MAX_BYTES = 32 * 1024 * 1024
# Respuestas del portal que significan «ese mes aún no está publicado».
SIN_PUBLICAR = frozenset({404, 410})
# Sin un mes conocido, cuántos meses hacia atrás se busca el vigente.
MESES_DE_BUSQUEDA = 12


def cita(anio: int, mes: int) -> str:
    """La cita, con el periodo del libro vigente (mes de 1 a 12), en catalán como la publica el Observatori.

    Returns:
        El texto de la cita.
    """
    periodo = f"gener-{MESES_CATALAN[mes - 1]} de {anio}" if mes > 1 else f"gener de {anio}"
    return (
        "Font: Observatori del Treball i Model Productiu, Generalitat de Catalunya. Estadística d'ofertes de llocs de "
        f"treball (SOC i Feina Activa), {periodo}"
    )


def archivo_del_mes(anio: int, mes: int) -> ArchivoDescargable:
    """El libro de un mes (1 a 12) con su dirección oficial.

    Returns:
        El archivo descargable.
    """
    return {
        "archivo": nombre_del_libro(anio, mes),
        "nivel": "oficial",
        "titulo": "Observatori del Treball, Estadística d'ofertes de llocs de treball: llocs de treball oferts pel SOC "
        f"i Feina Activa ({MESES_CATALAN[mes - 1]} de {anio})",
        "url": f"{BASE}/{anio}/arxius/{nombre_del_libro(anio, mes)}",
        "licencia": LICENCIA,
    }


def _procedencia() -> Path:
    return carpetas(FUENTE).original / ARCHIVO_DE_PROCEDENCIA


def _es_xlsx(datos: bytes) -> None:
    exigir(datos[:4] == b"PK\x03\x04", "Ofertas: la respuesta no es un libro XLSX")


CONTRATO = Contrato(TIPOS_XLSX, MAX_BYTES, _es_xlsx)


def _anterior_mes(anio: int, mes: int) -> tuple[int, int]:
    return (anio, mes - 1) if mes > 1 else (anio - 1, 12)


def meses_a_consultar(conocido: tuple[int, int] | None, hoy: tuple[int, int]) -> list[tuple[int, int]]:
    """Los meses cuya publicación se consulta, del más reciente al más antiguo, hasta el último conocido incluido.

    El conocido se vuelve a pedir en cada vuelta: así se ve una revisión del Observatori.

    Returns:
        Los meses (año, mes de 1 a 12), desde el mes en curso.
    """
    meses, cursor = [], hoy
    while (conocido is None and len(meses) < MESES_DE_BUSQUEDA) or (conocido is not None and cursor >= conocido):
        meses.append(cursor)
        cursor = _anterior_mes(*cursor)
    return meses


def _intentar(archivo: ArchivoDescargable, aceptar_cambio: bool) -> list[dict[str, Any]]:
    """Descarga un libro; si el portal responde que no existe, devuelve una lista vacía.

    Returns:
        Su entrada de procedencia, o nada si no está publicado.

    Raises:
        HTTPError: Si el portal responde con un error que no significa «aún sin publicar».
    """
    try:
        return descargar_acotados([archivo], carpetas(FUENTE).original, aceptar_cambio, CONTRATO)
    except HTTPError as error:
        if error.code in SIN_PUBLICAR:
            return []
        raise


def descargar(aceptar_cambio: bool = False) -> None:
    """Descubre el mes vigente, descarga su libro y el del mismo mes del año anterior; registra huella y fecha.

    Raises:
        FormatoInesperado: Si no se encuentra el libro del año anterior; el libro nuevo no queda en originales/.
    """
    previas = _registrados()
    conocidos = [fecha for nombre in previas if (fecha := fecha_del_libro(nombre))]
    conocido = max(conocidos) if conocidos else None
    hoy = hoy_utc()
    vigente, nuevas = conocido, []
    for anio, mes in meses_a_consultar(conocido, (hoy.year, hoy.month)):
        nuevas = _intentar(archivo_del_mes(anio, mes), aceptar_cambio)
        if nuevas:
            vigente = (anio, mes)
            break
    exigir(vigente is not None, f"Ofertas: no hay ningún libro publicado en los últimos {MESES_DE_BUSQUEDA} meses")
    anio, mes = vigente
    anterior = archivo_del_mes(anio - 1, mes)
    registrado = False
    try:
        if anterior["archivo"] not in previas:
            registro = _intentar(anterior, aceptar_cambio)
            if not registro:
                raise FormatoInesperado(
                    f"Ofertas: no se encuentra el libro de {MESES[mes - 1]} de {anio - 1} para comparar con "
                    f"{MESES[mes - 1]} de {anio}; se conserva lo publicado"
                )
            nuevas += registro
        # La procedencia conserva todos los libros registrados: ninguno se retira ni se olvida.
        archivos = {**previas, **{entrada["archivo"]: entrada for entrada in nuevas}}
        guardar_json(
            _procedencia(),
            {
                "fuente": NOMBRE,
                "pagina": PAGINA,
                "licencia": LICENCIA,
                "archivos": sorted(archivos.values(), key=_clave),
            },
        )
        registrado = True
    finally:
        # Ningún libro queda en originales/ sin su procedencia, falle lo que falle antes de registrarlo: se mira lo que
        # hay en disco, no la lista de la vuelta, que puede ir por detrás. Uno ya registrado nunca se retira.
        if not registrado:
            for libro in carpetas(FUENTE).original.glob("Ofertes_*.xlsx"):
                if libro.name not in previas and fecha_del_libro(libro.name) is not None:
                    libro.unlink(missing_ok=True)


def _registrados() -> dict[str, dict[str, Any]]:
    if not _procedencia().exists():
        return {}
    return {entrada["archivo"]: entrada for entrada in entradas_procedencia(leer_json(_procedencia()))}


def _clave(entrada: dict[str, Any]) -> tuple[int, int]:
    return fecha_del_libro(entrada["archivo"]) or (0, 0)


def preparar() -> None:
    """Elige por su fecha el libro vigente y el del mismo mes del año anterior, y deja las cifras de los dos."""
    comprobar_originales(FUENTE)
    nombres = [entrada["archivo"] for entrada in entradas_procedencia(leer_json(_procedencia()))]
    actual, anterior = elegir_libros(nombres)
    libros = {"actual": ofertas_de_un_libro(original(FUENTE, actual))}
    libros["anterior"] = ofertas_de_un_libro(original(FUENTE, anterior))
    guardar_json(carpetas(FUENTE).preparado / LIBROS, {"libros": [actual, anterior], **libros})
    print(f"Ofertas: {libros['actual']['periodo']} frente a {libros['anterior']['periodo']}")


def periodo_iso(anio: int, mes: int) -> str:
    """El mes de un libro como periodo ISO (AAAA-MM), como el resto de la plataforma.

    Returns:
        «AAAA-MM».
    """
    return f"{anio}-{mes:02d}"


def vigente_validado(conjunto: dict[str, Any]) -> str | None:
    """El mes vigente del conjunto validado; uno guardado como [año, mes de 0 a 11] se lee como su periodo ISO.

    Returns:
        «AAAA-MM», o None si el conjunto no lo trae.
    """
    vigente = conjunto.get("vigente")
    if isinstance(vigente, list):
        anio, indice = vigente
        return periodo_iso(anio, indice + 1)
    return vigente


def controles_de_los_libros(preparado: dict[str, Any], anterior: str | None) -> Controles:
    """Los controles: periodos comparables, mismos subgrupos, totales positivos y mes que no retrocede.

    Returns:
        Los controles, con su resultado.
    """
    hoy, antes = preparado["actual"], preparado["anterior"]
    vigente = periodo_iso(hoy["anio"], hoy["mes"])
    controles = Controles()
    controles.comprobar(
        (antes["anio"], antes["mes"]) == (hoy["anio"] - 1, hoy["mes"]),
        f"los periodos son comparables: {hoy['periodo']} y {antes['periodo']}",
    )
    controles.comprobar(set(hoy["cno2"]) == set(antes["cno2"]), "los subgrupos de los dos años coinciden")
    controles.comprobar(hoy["total"] > 0 and antes["total"] > 0, "los dos libros tienen puestos ofertados")
    controles.comprobar(
        anterior is None or vigente >= anterior,
        f"el mes vigente ({hoy['periodo']}) no retrocede respecto al validado",
    )
    return controles


def validar() -> None:
    """Comprueba los dos libros y su periodo; guarda sus cifras con la cita generada desde el mes vigente."""
    preparado, procedencia = leer_json(carpetas(FUENTE).preparado / LIBROS), leer_json(_procedencia())
    ruta = ruta_del_conjunto(FUENTE)
    anterior = vigente_validado(leer_json(ruta)) if ruta.exists() else None
    controles = controles_de_los_libros(preparado, anterior)
    controles_de_huella(controles, carpetas(FUENTE).original, procedencia)
    hoy = preparado["actual"]
    informe = {
        "estado": controles.estado,
        "comprobado_utc": ahora_utc(),
        "cobertura": {"libros": preparado["libros"], "periodo": hoy["periodo"]},
        "limites": "Solo las ofertas que gestionan el SOC y Feina Activa, no todo el mercado; las 50 ocupaciones más "
        "ofertadas del acumulado del año y todos los subgrupos y grandes grupos.",
        "controles": controles.lista,
    }
    consultado = max(_fecha_de_captura(entrada) for entrada in procedencia["archivos"])
    cerrar_validacion(
        FUENTE,
        informe,
        controles,
        lambda: {
            "cita": cita(hoy["anio"], hoy["mes"]),
            "licencia": LICENCIA,
            "consultado": consultado,
            "vigente": periodo_iso(hoy["anio"], hoy["mes"]),
            "actual": hoy,
            "anterior": preparado["anterior"],
        },
    )


def _fecha_de_captura(entrada: dict[str, Any]) -> str:
    """La fecha real de la captura: la que registra la descarga automática o, en las capturas a mano, la anotada.

    Returns:
        La fecha ISO (AAAA-MM-DD).
    """
    if entrada.get("descargado_utc"):
        return dia_iso_en_cataluna(entrada["descargado_utc"])
    return str(entrada["descargado"])[:10]


def main(argv: list[str] | None = None) -> int:
    """Interfaz de línea de órdenes: descargar, preparar, validar o todo.

    Args:
        argv: Los argumentos; None toma los de la línea de órdenes.

    Returns:
        El código de salida del proceso.
    """
    return principal_fuente_con_descarga(
        __doc__,
        descargar=descargar,
        preparacion_y_validacion={"preparar": preparar, "validar": validar},
        argumentos=argv,
    )


if __name__ == "__main__":
    sys.exit(main())
