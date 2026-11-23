"""Empleo por gran grupo de ocupación ISCO-08 en cada país, de ILOSTAT (OIT): el dato medido que cubre el mundo.

La OIT armoniza en la ISCO-08 el empleo por ocupación que miden las encuestas de fuerza de trabajo de cada país
(indicador `EMP_TEMP_SEX_OCU_NB_A`, miles de personas, por sexo). De cada país se toma el último año con una encuesta
de fuerza de trabajo (fuente «BA»); nunca las estimaciones modeladas de la OIT (fuente «XA»), los censos ni otras
encuestas de hogares, que miden otra cosa. Con esas cifras, Faro calcula dos porcentajes por gran grupo: su peso en
el empleo del país y la parte de mujeres. La propia OIT atribuye a la mezcla de ocupaciones las diferencias de
exposición a la IA entre países, y por eso este es el dato medido que sostiene el globo; la OIT no publica la
exposición por país. Python estándar.

Uso: python3 -m plataforma_datos.mercado.fuentes.ilostat.lector {descargar,preparar,validar,todo} [--aceptar-cambio]
"""

import csv
import datetime
import io
import math
import re
import sys
from collections import Counter
from typing import Any

from plataforma_datos.comun.dia_de_consulta import dia_iso_en_cataluna
from plataforma_datos.comun.entrada_salida import (
    ahora_utc,
    carpetas,
    comprobar_originales,
    controles_de_huella,
    guardar_json,
    leer_json,
    original,
)
from plataforma_datos.comun.nucleo import (
    ARCHIVO_DE_PROCEDENCIA,
    ArchivoDescargable,
    Controles,
    FormatoInesperado,
    exigir,
)
from plataforma_datos.comun.red import descargar_originales
from plataforma_datos.derivados.fuentes.datos_globales.piezas.constantes_datos_globales import (
    CITA_ILOSTAT,
    LICENCIA_ILOSTAT,
    PRIORIDAD_DE_NOTAS,
    nota_de_la_marca,
)
from plataforma_datos.orquestacion.admision import cerrar_validacion, leer_validado
from plataforma_datos.orquestacion.ordenes import principal_fuente_con_descarga

FUENTE = "ilostat"
ORIGINAL, PREPARADO, VALIDADO = carpetas(FUENTE)
PROCEDENCIA = ORIGINAL / ARCHIVO_DE_PROCEDENCIA
# Lo que escribe preparar y lee validar: por país, su último año de encuesta de fuerza de trabajo y sus cifras.
EMPLEO = PREPARADO / "empleo.json"

# Desde el año en que casi todos los países ya codifican la ocupación en la ISCO-08; cada cifra lleva su año.
PRIMER_ANIO = 2016
INDICADOR = "EMP_TEMP_SEX_OCU_NB"
ARCHIVO = "ilostat-EMP_TEMP_SEX_OCU_NB_A.csv"
ARCHIVOS: tuple[ArchivoDescargable, ...] = (
    {
        "archivo": ARCHIVO,
        "nivel": "oficial",
        "titulo": f"OIT, ILOSTAT: empleo por sexo y ocupación (miles), todos los países, desde {PRIMER_ANIO}, códigos",
        "url": f"https://rplumber.ilo.org/data/indicator/?id=EMP_TEMP_SEX_OCU_NB_A&timefrom={PRIMER_ANIO}&type=code"
        "&format=.csv",
        "licencia": LICENCIA_ILOSTAT,
    },
)
COLUMNAS = ("ref_area", "source", "indicator", "sex", "classif1", "time", "obs_value", "obs_status")
ENCUESTA_DE_FUERZA_DE_TRABAJO = "BA:"
ISCO08 = "OCU_ISCO08_"
SEXOS = {"SEX_T": "total", "SEX_F": "mujeres"}
# Los grandes grupos («0» son las ocupaciones militares) y «X», lo no clasificable, que cuenta en el total.
GRUPOS = ("1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "X")
# Los que llevan porcentaje: todos menos «X», que no es una ocupación.
GRUPOS_CON_PORCENTAJE = tuple(grupo for grupo in GRUPOS if grupo != "X")
TOTAL = "TOTAL"
# La suma de los grupos de cada país tiene que dar su total: más allá de esto, el desglose no es el del total.
MAX_DESCUADRE_DE_LA_SUMA = 0.01
# Decimales con los que el informe dice el descuadre relativo de un país (0,0512).
DECIMALES_DEL_DESCUADRE = 4
# Un país cuyo desglose no cuadra con su total no entra (sus porcentajes no sumarían 100); si son más de estos, lo que
# ha cambiado es la fuente y la validación se detiene.
MAX_PAISES_QUE_NO_CUADRAN = 5
# ILOSTAT frente a Eurostat (`lfsa_egai2d`), el mismo año: la OIT armoniza la misma encuesta europea, así que cada gran
# grupo no se aparta más de esto (tolerancia fijada en el diseño antes de medir).
MAX_DIFERENCIA_CON_EUROSTAT = 0.02
# El sexo «total» en el empleo por grupo de Eurostat que guarda «mundo-eurostat».
SEXO_TOTAL_EUROSTAT = "T"
PAISES_DEL_CONTRASTE = ("DE", "ES", "FR", "IT")
# Los códigos de país de ILOSTAT que no son ISO 3166-1 alfa-3, con el de dos letras que les da CLDR.
CODIGOS_PROPIOS = {"KOS": "XK"}
MIN_PAISES = 120
# Los países de la comparación que ILOSTAT tiene que traer, por su código de dos letras.
IMPRESCINDIBLES_EN_ILOSTAT = ("ES", "DE", "FR", "IT", "US")
DECIMALES = 1


def _detalle(lo_que_falla: object) -> str:
    """Lo que hace fallar un control, para su descripción; nada si no falla.

    Returns:
        «: » seguido de lo que falla, o un texto vacío si no falla nada.
    """
    return f": {lo_que_falla}" if lo_que_falla else ""


def filas_del_csv(texto: str) -> list[dict[str, str]]:
    """Las filas del CSV de ILOSTAT con las columnas que se usan; falla si falta alguna.

    Returns:
        Una fila por línea del CSV, solo con las columnas de COLUMNAS.
    """
    lector = csv.DictReader(io.StringIO(texto.lstrip("\ufeff")))
    exigir(set(COLUMNAS) <= set(lector.fieldnames or ()), f"ILOSTAT: faltan columnas {COLUMNAS}")
    exigir(
        len(lector.fieldnames or ()) == len(set(lector.fieldnames or ())),
        "ILOSTAT: columnas duplicadas en el CSV",
    )
    filas: list[dict[str, str]] = []
    for fila in lector:
        contexto = f"ILOSTAT: fila {lector.line_num}, país {fila.get('ref_area') or '(ausente)'}"
        faltan = [columna for columna in COLUMNAS if fila[columna] is None]
        exigir(not faltan, f"{contexto}: faltan valores en {faltan}")
        exigir(None not in fila, f"{contexto}: valores sobrantes")
        filas.append({columna: fila[columna] for columna in COLUMNAS})
    return filas


def _de_la_encuesta(fila: dict[str, str]) -> bool:
    """Si una fila es empleo por gran grupo ISCO-08, total o mujeres, de una encuesta de fuerza de trabajo.

    Returns:
        True si la fila es de empleo por gran grupo ISCO-08 (total o mujeres) de una encuesta de fuerza de trabajo.
    """
    return (
        fila["source"].startswith(ENCUESTA_DE_FUERZA_DE_TRABAJO)
        and fila["classif1"].startswith(ISCO08)
        and fila["sex"] in SEXOS
        and fila["obs_value"] != ""
    )


def empleo_por_pais(filas: list[dict[str, str]]) -> dict[str, dict[str, Any]]:
    """Por país, su último año de encuesta de fuerza de trabajo con el total, y sus cifras por sexo y grupo.

    Si ese año el país tiene dos encuestas de fuerza de trabajo, se queda la de código menor (orden estable), y la
    validación lo detiene.

    Returns:
        {código de país: su año, su fuente y las cifras por sexo y grupo}.
    """
    candidatas: dict[tuple[str, int, str], dict[str, Any]] = {}
    for fila in filter(_de_la_encuesta, filas):
        exigir(fila["indicator"] == INDICADOR, f"ILOSTAT: indicator «{fila['indicator']}», se esperaba {INDICADOR}")
        clave = (fila["ref_area"], _anio(fila), fila["source"])
        cifras = candidatas.setdefault(clave, {"total": {}, "mujeres": {}, "marcas": {}})
        grupo = fila["classif1"].removeprefix(ISCO08)
        exigir(grupo in (*GRUPOS, TOTAL), f"ILOSTAT: classif1 «{fila['classif1']}» no es un gran grupo ISCO-08")
        exigir(
            grupo not in cifras[SEXOS[fila["sex"]]],
            f"ILOSTAT: observación duplicada {clave} {fila['sex']} {grupo}",
        )
        cifras[SEXOS[fila["sex"]]][grupo] = _miles(fila)
        if fila["obs_status"]:
            cifras["marcas"][f"{SEXOS[fila['sex']]}:{grupo}"] = fila["obs_status"]
    paises: dict[str, dict[str, Any]] = {}
    for (pais, anio, fuente), cifras in sorted(candidatas.items()):
        if TOTAL not in cifras["total"]:
            continue
        exigir(cifras["total"][TOTAL] > 0, f"ILOSTAT: {pais} {anio} ({fuente}) da un empleo total de 0")
        previo = paises.get(pais)
        if previo is None or anio > previo["anio"]:
            paises[pais] = {"anio": anio, "fuente": fuente, "fuentes_del_anio": 1, **cifras}
        elif anio == previo["anio"]:
            previo["fuentes_del_anio"] += 1
    return paises


def _anio(fila: dict[str, str]) -> int:
    """El año anual canónico, dentro del intervalo consultado y hasta el año en curso.

    Returns:
        El año, como entero.
    """
    texto = fila["time"]
    contexto = f"ILOSTAT: año «{texto}» en {fila['ref_area']}"
    exigir(re.fullmatch(r"[0-9]{4}", texto) is not None, contexto)
    anio = int(texto)
    exigir(PRIMER_ANIO <= anio <= datetime.datetime.now(datetime.UTC).year, contexto)
    return anio


def _miles(fila: dict[str, str]) -> float:
    """Las personas ocupadas (miles) de una fila; lo que no es una cifra finita y no negativa detiene la lectura.

    Returns:
        Las personas ocupadas, en miles.

    Raises:
        FormatoInesperado: Si la cifra no es un número finito y no negativo.
    """
    try:
        valor = float(fila["obs_value"])
    except ValueError as error:
        raise FormatoInesperado(f"ILOSTAT: cifra «{fila['obs_value']}» en {fila['ref_area']} {fila['time']}") from error
    exigir(math.isfinite(valor) and valor >= 0, f"ILOSTAT: cifra {valor} en {fila['ref_area']} {fila['time']}")
    return valor


def _porcentaje(parte: float, todo: float) -> float:
    """Una parte sobre un todo, en porcentaje con una cifra decimal.

    Returns:
        La parte en porcentaje del todo, redondeada a DECIMALES.
    """
    exigir(
        math.isfinite(parte) and math.isfinite(todo) and 0 <= parte <= todo and todo > 0,
        f"ILOSTAT: porcentaje con parte {parte} y denominador {todo}",
    )
    porcentaje = round(100 * parte / todo, DECIMALES)
    exigir(math.isfinite(porcentaje), f"ILOSTAT: porcentaje no finito con parte {parte} y denominador {todo}")
    return porcentaje


def _nota(marcas: dict[str, str], *claves: str) -> str | None:
    """La nota de una cifra calculada: la de una de las cifras de las que sale; la poco fiable gana.

    Returns:
        La nota poco fiable si alguna de las cifras la lleva; si no, la primera que haya, o None.
    """
    notas = {nota_de_la_marca(marcas.get(clave)) for clave in claves} - {None}
    return next((nota for nota in PRIORIDAD_DE_NOTAS if nota in notas), None)


def porcentajes(pais: dict[str, Any]) -> dict[str, dict[str, dict[str, Any]]]:
    """El peso de cada gran grupo en el empleo y la parte de mujeres en él, con la nota que hereda de sus cifras.

    Returns:
        Empleo y parte de mujeres, por grupo, con su porcentaje y nota.
    """
    total, mujeres, marcas = pais["total"], pais["mujeres"], pais["marcas"]
    empleo, de_mujeres = {}, {}
    for grupo in GRUPOS_CON_PORCENTAJE:
        if grupo not in total:
            continue
        empleo[grupo] = {
            "valor": _porcentaje(total[grupo], total[TOTAL]),
            "nota": _nota(marcas, f"total:{grupo}", f"total:{TOTAL}"),
        }
        if grupo in mujeres:
            exigir(
                0 <= mujeres[grupo] <= total[grupo],
                f"ILOSTAT: mujeres {mujeres[grupo]} superan el total {total[grupo]} del grupo {grupo}",
            )
        if grupo in mujeres and total[grupo] > 0:
            de_mujeres[grupo] = {
                "valor": _porcentaje(mujeres[grupo], total[grupo]),
                "nota": _nota(marcas, f"mujeres:{grupo}", f"total:{grupo}"),
            }
    return {"empleo": empleo, "mujeres": de_mujeres}


def descargar(aceptar_cambio: bool = False) -> None:
    """Descarga el indicador de todos los países; un año nuevo de un país se detiene hasta aceptarlo a propósito."""
    guardar_json(
        PROCEDENCIA,
        {
            "fuente": "OIT · ILOSTAT · empleo por sexo y ocupación (EMP_TEMP_SEX_OCU_NB_A)",
            "cita": CITA_ILOSTAT,
            "licencia": LICENCIA_ILOSTAT,
            "archivos": descargar_originales(list(ARCHIVOS), ORIGINAL, aceptar_cambio),
        },
    )


def preparar() -> None:
    """Deja, por país, su último año de encuesta de fuerza de trabajo con sus cifras por sexo y gran grupo."""
    comprobar_originales(FUENTE)
    filas = filas_del_csv(original(FUENTE, ARCHIVO).read_text(encoding="utf-8"))
    paises = empleo_por_pais(filas)
    guardar_json(EMPLEO, {"paises": paises})
    print(f"{len(filas)} filas; {len(paises)} países con encuesta de fuerza de trabajo")


def _descuadres(paises: dict[str, Any]) -> dict[str, float]:
    """Los países cuya suma de grupos se aparta de su total más que la tolerancia, con su descuadre relativo.

    Returns:
        {país: descuadre relativo entre la suma de sus grupos y su total}, solo los que pasan de la tolerancia.
    """
    descuadres = {}
    for codigo, pais in paises.items():
        exigir(
            math.isfinite(pais["total"][TOTAL]) and pais["total"][TOTAL] > 0,
            f"ILOSTAT: {codigo} tiene un empleo total no positivo o no finito: {pais['total'][TOTAL]}",
        )
        suma = sum(pais["total"].get(grupo, 0.0) for grupo in GRUPOS)
        relativo = abs(suma - pais["total"][TOTAL]) / pais["total"][TOTAL]
        if relativo > MAX_DESCUADRE_DE_LA_SUMA:
            descuadres[codigo] = round(relativo, DECIMALES_DEL_DESCUADRE)
    return descuadres


def _contraste_con_eurostat(paises: dict[str, Any], territorios: dict[str, Any]) -> dict[str, Any]:
    """Los grandes grupos que se apartan de Eurostat el último año común más que la tolerancia.

    El código de Eurostat (alfa-2) pasa al de ILOSTAT (alfa-3) con el conjunto validado «territorios».
    Si la OIT se adelanta, se relee su original verificado para contrastar el último año común; el dato publicado
    conserva el año más reciente. No se duplica el histórico en el preparado ni se comparan años distintos.

    Returns:
        {«país:grupo»: (cifra de la OIT, cifra de Eurostat)} de los que se apartan más que la tolerancia.
    """
    eurostat = leer_validado("mundo-eurostat")["empleo_por_grupo"]
    apartados: dict[str, Any] = {}
    filas: list[dict[str, str]] | None = None
    for geo in sorted(set(eurostat) | set(PAISES_DEL_CONTRASTE)):
        por_anio = eurostat.get(geo, {})
        codigo = territorios.get(geo, {}).get("iso3")
        pais = paises.get(codigo)
        if pais and por_anio and str(pais["anio"]) not in por_anio:
            if filas is None:
                filas = filas_del_csv(original(FUENTE, ARCHIVO).read_text(encoding="utf-8"))
            pais = empleo_por_pais(
                [fila for fila in filas if fila["ref_area"] == codigo and fila["time"] in por_anio]
            ).get(codigo)
        europa = por_anio.get(str(pais["anio"])) if pais else None
        if not pais or not europa:
            apartados[geo] = "sin el mismo año en las dos fuentes"
            continue
        if pais["fuentes_del_anio"] != 1 or _descuadres({codigo: pais}):
            apartados[geo] = "el año común no tiene una encuesta única con desglose que cuadre"
            continue
        totales = europa.get(SEXO_TOTAL_EUROSTAT, {})
        if not {*GRUPOS_CON_PORCENTAJE, TOTAL} <= totales.keys():
            apartados[geo] = "cobertura insuficiente para el contraste: faltan grandes grupos o TOTAL de sexo T"
        for grupo, miles in totales.items():
            oit = pais["total"].get(grupo)
            _nota(pais["marcas"], f"total:{grupo}", f"total:{TOTAL}")
            if (
                oit is None
                or not math.isfinite(miles)
                or miles < 0
                or (oit != miles and (miles == 0 or abs(oit - miles) / miles > MAX_DIFERENCIA_CON_EUROSTAT))
            ):
                apartados[f"{geo}:{grupo}"] = (oit, miles)
    return apartados


def _codigo_iso3(codigo: str, territorios: dict[str, Any], iso3: dict[str, str]) -> str:
    """El código ISO 3166-1 alfa-3 de un país de ILOSTAT: el suyo, o el del código de CLDR de uno propio (KOS → XK).

    Returns:
        El código ISO 3166-1 alfa-3.
    """
    if codigo in iso3:
        return codigo
    return territorios[CODIGOS_PROPIOS[codigo]]["iso3"]


def _conjunto(
    paises: dict[str, Any], territorios: dict[str, Any], iso3: dict[str, str], procedencia: dict[str, Any]
) -> dict[str, Any]:
    """El conjunto validado: cada país por su código ISO alfa-3, con su año, su fuente y sus porcentajes.

    Solo se construye si la validación admite la fuente: con un país sin nombre o sin territorio, los controles ya han
    fallado y aquí no se llega.

    Returns:
        El conjunto, con la cita, la licencia, la fecha de consulta y los países.
    """
    return {
        "cita": CITA_ILOSTAT,
        "licencia": LICENCIA_ILOSTAT,
        "consultado": dia_iso_en_cataluna(procedencia["archivos"][0]["descargado_utc"]),
        "paises": {
            _codigo_iso3(codigo, territorios, iso3): {
                "anio": pais["anio"],
                "fuente": pais["fuente"],
                **porcentajes(pais),
            }
            for codigo, pais in sorted(paises.items())
        },
    }


def validar() -> None:
    """Comprueba la fuente de cada país, sus sumas, su nombre y el contraste con Eurostat; guarda los porcentajes."""
    preparado, procedencia = leer_json(EMPLEO), leer_json(PROCEDENCIA)
    paises = preparado["paises"]
    territorios = leer_validado("territorios")["paises"]
    iso3 = {pais["iso3"]: codigo for codigo, pais in territorios.items()}
    controles = Controles()
    controles_de_huella(controles, ORIGINAL, procedencia)
    controles.comprobar(len(paises) >= MIN_PAISES, f"{len(paises)} países con encuesta; al menos {MIN_PAISES}")
    controles.comprobar(
        all(pais["fuente"].startswith(ENCUESTA_DE_FUERZA_DE_TRABAJO) for pais in paises.values()),
        "todas las cifras son de una encuesta de fuerza de trabajo; ninguna estimación modelada",
    )
    dobles = sorted(codigo for codigo, pais in paises.items() if pais["fuentes_del_anio"] > 1)
    controles.comprobar(
        not dobles, "cada país tiene una sola encuesta de fuerza de trabajo su último año" + _detalle(dobles)
    )
    descuadres = _descuadres(paises)
    controles.comprobar(
        len(descuadres) <= MAX_PAISES_QUE_NO_CUADRAN,
        f"la suma de los grupos da el total (±{MAX_DESCUADRE_DE_LA_SUMA:.0%}) en todos los países salvo "
        f"{MAX_PAISES_QUE_NO_CUADRAN} como mucho, que no entran" + _detalle(descuadres),
    )
    paises = {codigo: pais for codigo, pais in paises.items() if codigo not in descuadres}
    sin_nombre = sorted(codigo for codigo in paises if codigo not in iso3 and codigo not in CODIGOS_PROPIOS)
    controles.comprobar(not sin_nombre, "cada país tiene su nombre en CLDR" + _detalle(sin_nombre))
    faltan = [codigo for codigo in IMPRESCINDIBLES_EN_ILOSTAT if territorios.get(codigo, {}).get("iso3") not in paises]
    controles.comprobar(not faltan, "están España, Alemania, Francia, Italia y EE. UU." + _detalle(faltan))
    apartados = _contraste_con_eurostat(paises, territorios)
    controles.comprobar(
        not apartados,
        f"DE, ES, FR e IT: cada gran grupo, a menos del {MAX_DIFERENCIA_CON_EUROSTAT:.0%} de Eurostat el mismo año"
        + _detalle(apartados),
    )
    informe = {
        "estado": controles.estado,
        "comprobado_utc": ahora_utc(),
        "cobertura": {
            "paises": len(paises),
            "fuera_porque_no_cuadran": descuadres,
            "por_anio": dict(sorted(Counter(str(pais["anio"]) for pais in paises.values()).items())),
        },
        "limites": "Solo encuestas de fuerza de trabajo armonizadas por la OIT; los países que solo tienen "
        "estimaciones modeladas, censos u otras encuestas no entran. Cada país con su último año: los años no "
        "coinciden. Los porcentajes los calcula Faro sobre las cifras publicadas.",
        "controles": controles.lista,
    }
    cerrar_validacion(FUENTE, informe, controles, lambda: _conjunto(paises, territorios, iso3, procedencia))


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
