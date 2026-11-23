"""Personas ocupadas en Cataluña por gran grupo de la CNO-11, de la Encuesta de Población Activa (INE, tabla 65314).

Se descargan de la API Tempus del INE los últimos 17 trimestres de la tabla y los códigos de su variable de ocupación.
De la tabla se toman las series de Cataluña, ambos sexos, en valor absoluto (miles de personas), una por gran grupo y
la del total. El último trimestre se lee de los datos, no de un calendario: cuando el INE publica uno nuevo, la
descarga lo trae y la validación lo admite si la serie sigue completa y no retrocede respecto a lo ya validado. La cita
dice el último trimestre leído. Python estándar.

Uso: python3 -m plataforma_datos.mercado.fuentes.epa.lector {descargar,preparar,validar,todo} [--aceptar-cambio]
"""

import datetime
import sys
from pathlib import Path
from typing import Any

from plataforma_datos.comun import tempus
from plataforma_datos.comun.descarga_acotada import Contrato, descargar_acotados
from plataforma_datos.comun.dia_de_consulta import dia_iso_en_cataluna
from plataforma_datos.comun.entrada_salida import (
    ahora_utc,
    carpetas,
    comprobar_originales,
    controles_de_huella,
    guardar_json,
    hoy_utc,
    leer_json,
    original,
    ruta_del_conjunto,
)
from plataforma_datos.comun.nucleo import ARCHIVO_DE_PROCEDENCIA, ArchivoDescargable, Controles, exigir
from plataforma_datos.orquestacion.admision import cerrar_validacion
from plataforma_datos.orquestacion.ordenes import principal_fuente_con_descarga

FUENTE = "epa"
# Lo que escribe preparar y lee validar: las series de Cataluña y su último trimestre.
SERIES = "series.json"
TABLA, CODIGOS = "ine-epa-65314.json", "ine-epa-65314-ocupaciones.json"
LICENCIA = (
    "Creative Commons Reconocimiento 4.0 (CC BY 4.0), según el aviso legal del INE "
    "(https://www.ine.es/dyngs/AYU/index.htm?cid=125): citar la fuente («Elaboración propia con datos extraídos del "
    "sitio web del INE: www.ine.es»), mencionar la fecha de la última actualización y no sugerir que el INE participa, "
    "patrocina o apoya la reutilización."
)
# Cuatro trimestres para la media del último año y cuatro más para la del año anterior; el INE da diecisiete.
TRIMESTRES_PEDIDOS = 17
MIN_TRIMESTRES = 8
ARCHIVOS: tuple[ArchivoDescargable, ...] = (
    {
        "archivo": TABLA,
        "nivel": "oficial",
        "titulo": "INE, EPA, tabla 65314: ocupados por sexo, comunidad autónoma y gran grupo de ocupación, últimos "
        f"{TRIMESTRES_PEDIDOS} trimestres",
        "url": f"https://servicios.ine.es/wstempus/js/ES/DATOS_TABLA/65314?nult={TRIMESTRES_PEDIDOS}",
        "licencia": LICENCIA,
    },
    {
        "archivo": CODIGOS,
        "nivel": "oficial",
        "titulo": "INE, EPA, tabla 65314: valores y códigos de la variable «Ocupación CNO-11» (grandes grupos)",
        "url": "https://servicios.ine.es/wstempus/js/ES/VALORES_GRUPOSTABLA/65314/133119",
        "licencia": LICENCIA,
    },
)
COMPROBAR = {TABLA: tempus.comprobar_tabla, CODIGOS: tempus.comprobar_valores}
# La tabla entera ocupa algo más de 1 MB; el tope deja margen para que crezca sin admitir otra cosa.
MAX_BYTES = 16 * 1024 * 1024
PREFIJO = "Ocupados. Ambos sexos. Cataluña. "
SUFIJO = ". Valor absoluto."
TOTAL = "total"
# Los diez grandes grupos de la CNO-11 (0 a 9) y el total.
GRUPOS = (*(str(cifra) for cifra in range(10)), TOTAL)
NOMBRE = "INE · Encuesta de Población Activa: ocupados por gran grupo de ocupación (CNO-11) y comunidad autónoma"


def cita(trimestre: str) -> str:
    """La cita de la fuente, con el último trimestre leído («2026T3» → «trimestre 3/2026»).

    Returns:
        El texto de la cita.
    """
    anio, numero = trimestre.split("T")
    return (
        "Elaboración propia con datos extraídos del sitio web del INE: www.ine.es (Encuesta de Población Activa, "
        f"tabla 65314; última publicación: trimestre {numero}/{anio})."
    )


def _procedencia() -> Path:
    return carpetas(FUENTE).original / ARCHIVO_DE_PROCEDENCIA


def _contrato(archivo: str) -> Contrato:
    return Contrato(tempus.TIPOS_TEMPUS, MAX_BYTES, lambda datos: COMPROBAR[archivo](datos, f"EPA {archivo}"))


def descargar(aceptar_cambio: bool = False) -> None:
    """Descarga la tabla y sus códigos; la procedencia guarda la huella y la fecha real de cada captura."""
    archivos = [
        entrada
        for archivo in ARCHIVOS
        for entrada in descargar_acotados(
            [archivo], carpetas(FUENTE).original, aceptar_cambio, _contrato(archivo["archivo"])
        )
    ]
    guardar_json(_procedencia(), {"fuente": NOMBRE, "licencia": LICENCIA, "archivos": archivos})


def _trimestre(dato: dict[str, Any], que: str) -> str:
    exigir(dato.get("FK_Periodo") in tempus.TRIMESTRES, f"{que}: periodo {dato.get('FK_Periodo')!r} no trimestral")
    exigir(isinstance(dato.get("Anyo"), int), f"{que}: año {dato.get('Anyo')!r}")
    return f"{dato['Anyo']}T{tempus.TRIMESTRES[dato['FK_Periodo']]}"


def series_de_cataluna(tabla: list[dict[str, Any]], valores: list[dict[str, Any]]) -> dict[str, Any]:
    """Las series de Cataluña, ambos sexos, por gran grupo, en miles de personas y con el nombre del INE.

    Returns:
        {código del grupo o «total»: {nombre, miles: {«AAAAT#»: cifra o None}}}.
    """
    codigo_de = {valor["Nombre"]: valor.get("Codigo") or TOTAL for valor in valores}
    grupos: dict[str, Any] = {}
    for serie in tabla:
        nombre = serie["Nombre"].strip()
        if not (nombre.startswith(PREFIJO) and nombre.endswith(SUFIJO)):
            continue
        literal = nombre.removeprefix(PREFIJO).removesuffix(SUFIJO)
        exigir(literal in codigo_de, f"EPA: grupo sin código en la tabla: {literal!r}")
        clave = codigo_de[literal]
        exigir(clave not in grupos, f"EPA: serie repetida de {literal!r}")
        miles: dict[str, float | None] = {}
        for dato in serie["Data"]:
            periodo = _trimestre(dato, f"EPA {literal}")
            exigir(periodo not in miles, f"EPA: trimestre repetido {periodo} en {literal!r}")
            miles[periodo] = tempus.cifra(dato["Valor"], f"EPA {literal} {periodo}")
        grupos[clave] = {"nombre": literal, "miles": dict(sorted(miles.items(), key=lambda par: _orden(par[0])))}
    return dict(sorted(grupos.items()))


def _orden(trimestre: str) -> tuple[int, int]:
    anio, numero = trimestre.split("T")
    return int(anio), int(numero)


def preparar() -> None:
    """Deja las series de Cataluña por gran grupo y el último trimestre que traen."""
    comprobar_originales(FUENTE)
    grupos = series_de_cataluna(leer_json(original(FUENTE, TABLA)), leer_json(original(FUENTE, CODIGOS)))
    exigir(TOTAL in grupos, "EPA: falta la serie del total de Cataluña")
    ultimo = max(grupos[TOTAL]["miles"], key=_orden)
    guardar_json(carpetas(FUENTE).preparado / SERIES, {"ultimo_trimestre": ultimo, "grupos": grupos})
    print(f"{len(grupos)} series de Cataluña; último trimestre {ultimo}")


def _consecutivos(trimestres: list[str]) -> bool:
    ordinales = [anio * 4 + numero for anio, numero in map(_orden, trimestres)]
    return ordinales == list(range(ordinales[0], ordinales[0] + len(ordinales))) if ordinales else False


def _fin_del_trimestre(trimestre: str) -> datetime.date:
    anio, numero = _orden(trimestre)
    return datetime.date(anio + numero // 4, numero * 3 % 12 + 1, 1) - datetime.timedelta(days=1)


def _anterior_validado() -> str | None:
    """El último trimestre del conjunto validado anterior, si lo hay: la serie nueva no puede quedarse antes.

    Returns:
        El trimestre, o None si aún no hay conjunto validado.
    """
    ruta = ruta_del_conjunto(FUENTE)
    if not ruta.exists():
        return None
    return leer_json(ruta).get("ultimo_trimestre")


def controles_de_la_serie(preparado: dict[str, Any], anterior: str | None, hoy: datetime.date) -> Controles:
    """Los controles de la serie: grupos completos, trimestres consecutivos y comunes, cifras y periodo.

    Returns:
        Los controles, con su resultado.
    """
    grupos, ultimo = preparado["grupos"], preparado["ultimo_trimestre"]
    controles = Controles()
    controles.comprobar(set(grupos) == set(GRUPOS), f"están los diez grandes grupos y el total: {sorted(grupos)}")
    trimestres = list(grupos.get(TOTAL, {}).get("miles", {}))
    controles.comprobar(
        all(list(grupo["miles"]) == trimestres for grupo in grupos.values()),
        "todas las series tienen los mismos trimestres",
    )
    controles.comprobar(
        len(trimestres) >= MIN_TRIMESTRES and _consecutivos(trimestres),
        f"al menos {MIN_TRIMESTRES} trimestres consecutivos: {len(trimestres)}",
    )
    controles.comprobar(bool(trimestres) and trimestres[-1] == ultimo, f"el último trimestre es {ultimo}")
    controles.comprobar(
        all(cifra is None or cifra >= 0 for grupo in grupos.values() for cifra in grupo["miles"].values()),
        "ninguna cifra es negativa",
    )
    controles.comprobar(
        all(grupos.get(TOTAL, {}).get("miles", {}).get(t) for t in trimestres[-MIN_TRIMESTRES:]),
        "el total de Cataluña tiene cifra en los ocho últimos trimestres",
    )
    controles.comprobar(_fin_del_trimestre(ultimo) <= hoy, f"{ultimo} ya ha terminado")
    controles.comprobar(
        anterior is None or _orden(ultimo) >= _orden(anterior),
        f"el último trimestre ({ultimo}) no retrocede respecto al validado ({anterior})",
    )
    return controles


def validar() -> None:
    """Comprueba las series y el periodo; guarda las series con su cita, generada desde el último trimestre leído."""
    preparado, procedencia = leer_json(carpetas(FUENTE).preparado / SERIES), leer_json(_procedencia())
    anterior = _anterior_validado()
    controles = controles_de_la_serie(preparado, anterior, hoy_utc())
    controles_de_huella(controles, carpetas(FUENTE).original, procedencia)
    ultimo = preparado["ultimo_trimestre"]
    informe = {
        "estado": controles.estado,
        "comprobado_utc": ahora_utc(),
        "cobertura": {"ultimo_trimestre": ultimo, "anterior_validado": anterior},
        "limites": "Encuesta por muestreo: la tabla no trae el error de cada cifra, y nadie publica el de la "
        "comparación entre las dos medias de cuatro trimestres, que calcula Faro. Cataluña, ambos sexos, en miles de "
        "personas.",
        "controles": controles.lista,
    }
    consultado = max(dia_iso_en_cataluna(entrada["descargado_utc"]) for entrada in procedencia["archivos"])
    cerrar_validacion(
        FUENTE,
        informe,
        controles,
        lambda: {
            "cita": cita(ultimo),
            "licencia": LICENCIA,
            "consultado": consultado,
            "ultimo_trimestre": ultimo,
            "grupos": preparado["grupos"],
        },
    )


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
